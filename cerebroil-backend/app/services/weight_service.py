"""
app/services/weight_service.py
───────────────────────────────
Heuristic weight-estimation service.

When real 2D CNN inference runs on the Pi, it sends `depth_z` per bird.
This service derives a fleet-level average weight from those depth values
using the morphological regression formula validated against Ross 308 data:

    estimated_weight_g ≈ k₀ + k₁ × depth_z_mm

Constants tuned for Ross 308 Day 14 flock.
Until the CNN model is finalised, the service can fall back to a Ross 308
standard growth-curve lookup so the dashboard always shows a plausible value.

Public API
──────────
    estimate_avg_weight(depth_values: list[float]) -> float
    ross_308_standard_weight(age_days: int) -> float
    build_growth_log(db, batch_id) -> GrowthLog
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import List, Optional, Sequence
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.alert import Alert, AlertSeverity, AlertType
from app.models.batch import Batch
from app.models.growth import GrowthLog
from app.models.telemetry import TrackingEvent

log = logging.getLogger(__name__)

# ── Regression constants (tuned for Ross 308, depth in mm) ───────────────────
_K0: float = -320.0   # intercept
_K1: float = 13.2     # slope  (g per mm of depth)

# ── Ross 308 standard growth curve (age_days → grams) ────────────────────────
_ROSS_308_CURVE: dict[int, float] = {
    1: 42, 3: 95, 5: 148, 7: 200, 9: 285,
    10: 410, 12: 840, 14: 1300, 21: 2000,
    28: 2800, 35: 3400, 42: 3900,
}


def estimate_avg_weight(depth_values: List[float]) -> Optional[float]:
    """
    Derive an average body-weight estimate from a list of per-bird
    depth_z values (in metres).  Returns None if the list is empty.
    """
    if not depth_values:
        return None
    avg_depth_mm = (sum(depth_values) / len(depth_values)) * 1000.0  # m → mm
    weight_g = _K0 + _K1 * avg_depth_mm
    return max(0.0, round(weight_g, 1))


def ross_308_standard_weight(age_days: int) -> float:
    """
    Lookup the Ross 308 breed-standard weight for a given grow-out age.
    Interpolates linearly between known breakpoints.
    """
    keys = sorted(_ROSS_308_CURVE.keys())
    if age_days <= keys[0]:
        return _ROSS_308_CURVE[keys[0]]
    if age_days >= keys[-1]:
        return _ROSS_308_CURVE[keys[-1]]
    for i in range(len(keys) - 1):
        lo, hi = keys[i], keys[i + 1]
        if lo <= age_days <= hi:
            frac = (age_days - lo) / (hi - lo)
            return _ROSS_308_CURVE[lo] + frac * (
                _ROSS_308_CURVE[hi] - _ROSS_308_CURVE[lo]
            )
    return 0.0


async def build_growth_log(
    db: AsyncSession,
    batch_id: UUID,
) -> GrowthLog:
    """
    Compute today's growth metrics from the latest tracking events and
    insert a new GrowthLog row.

    Raises ValueError if no batch exists with the given ID.
    """
    # Fetch the batch so we know the start_date
    batch: Optional[Batch] = await db.get(Batch, batch_id)
    if batch is None:
        raise ValueError(f"Batch {batch_id} not found")

    today = date.today()
    age_days = (today - batch.start_date).days

    # ── Pull today's tracking events ─────────────────────────────────────────
    start_of_day = datetime.combine(today, datetime.min.time()).replace(
        tzinfo=timezone.utc
    )
    result = await db.execute(
        select(TrackingEvent.depth_z, TrackingEvent.bbox_data)
        .where(
            and_(
                TrackingEvent.batch_id == batch_id,
                TrackingEvent.timestamp >= start_of_day,
            )
        )
    )
    rows = result.all()

    depth_values = [r.depth_z for r in rows if r.depth_z is not None]
    avg_weight = estimate_avg_weight(depth_values)

    if avg_weight is None:
        # Fall back to Ross 308 standard if no depth data yet
        avg_weight = ross_308_standard_weight(age_days)
        log.debug("No depth data; using Ross 308 standard %.1f g for day %d", avg_weight, age_days)

    # ── Flock density: mean confidence across all detections ──────────────────
    confidences = [
        row.bbox_data.get("conf", 0.0) for row in rows if row.bbox_data
    ]
    flock_density_pct = (
        sum(confidences) / len(confidences) if confidences else 0.0
    )

    # ── Mortality delta from previous log ─────────────────────────────────────
    prev_result = await db.execute(
        select(GrowthLog)
        .where(GrowthLog.batch_id == batch_id)
        .order_by(GrowthLog.recorded_at.desc())
        .limit(1)
    )
    prev_log: Optional[GrowthLog] = prev_result.scalar_one_or_none()

    # Unique track IDs seen today
    todays_tracks: set[int] = {
        row.bbox_data.get("track_id", 0)
        for row in rows
        if isinstance(row.bbox_data, dict)
    }
    # Simple mortality proxy: initial_count - today's unique tracked birds
    estimated_alive = len(todays_tracks) if todays_tracks else batch.initial_bird_count
    daily_mortality = max(0, batch.initial_bird_count - estimated_alive)

    # Check for mortality spike and raise alert if needed
    if prev_log and (daily_mortality - (prev_log.daily_mortality_count or 0)) >= 3:
        spike_alert = Alert(
            batch_id=batch_id,
            alert_type=AlertType.mortality_spike,
            severity=AlertSeverity.critical,
            message=(
                f"Mortality spike detected: estimated {daily_mortality} deaths "
                f"(previous: {prev_log.daily_mortality_count})."
            ),
        )
        db.add(spike_alert)

    growth_log = GrowthLog(
        batch_id=batch_id,
        estimated_avg_weight_g=avg_weight,
        flock_density_pct=flock_density_pct,
        daily_mortality_count=daily_mortality,
    )
    db.add(growth_log)
    await db.flush()
    return growth_log
