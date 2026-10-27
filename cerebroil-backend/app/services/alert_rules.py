"""
app/services/alert_rules.py
────────────────────────────
Rule engine for behavioral anomaly detection.

Three-state behavioral model
─────────────────────────────
  "Inactivity" — minimal pixel movement during daytime
  "Huddling"   — high bounding-box cluster density during daytime
  "Sleeping"   — time-based override active 21:00–03:59 (local server time)

Night cycle rule
────────────────
Between 21:00 and 03:59 local time all birds are in "Sleeping" state.
Inactivity and Huddling alert triggers are suppressed during this window.
Only heat_stress alerts can fire at night (temperature doesn't care what
time it is).

Weight categories
─────────────────
  "Underweight" — weight_kg < 1.20
  "Optimal"     — 1.20 ≤ weight_kg ≤ 1.90
  "Overweight"  — weight_kg > 1.90

Alert deduplication: a new alert is only created when no identical
unresolved alert already exists for the same batch.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.alert import Alert, AlertSeverity, AlertType
from app.schemas.telemetry import TelemetryFrame

log = logging.getLogger(__name__)
settings = get_settings()


# ── Night cycle helpers ───────────────────────────────────────────────────────

def is_night_cycle(dt: datetime | None = None) -> bool:
    """
    Return True if local time is in the 21:00–03:59 sleep window.
    Uses server local time — matches what the frontend checks with
    new Date().getHours().
    """
    h = (dt or datetime.now()).hour
    return h >= 21 or h < 4


# ── Weight category ───────────────────────────────────────────────────────────

def weight_category(weight_g: float) -> str:
    kg = weight_g / 1000.0
    if kg < 1.20:  return "Underweight"
    if kg <= 1.90: return "Optimal"
    return "Overweight"


def behavior_label(
    flock_density_pct: float,
    has_inactive_birds: bool,
    night: bool,
    density_threshold: float,
) -> str:
    """
    Resolve the behavioral label for a frame.
    Returns one of: "Inactivity", "Huddling", "Sleeping".
    """
    if night:
        return "Sleeping"
    if flock_density_pct >= density_threshold:
        return "Huddling"
    if has_inactive_birds:
        return "Inactivity"
    return "Inactivity"   # default daytime state


# ── Alert existence check ─────────────────────────────────────────────────────

async def _alert_exists(
    db: AsyncSession,
    batch_id: UUID,
    alert_type: AlertType,
) -> bool:
    # Cast explicitly to text to bypass the alerttype ENUM/VARCHAR mismatch
    from sqlalchemy import cast, String as Str
    result = await db.execute(
        select(Alert.id).where(
            and_(
                Alert.batch_id == batch_id,
                cast(Alert.alert_type, Str) == alert_type.value,
                Alert.is_resolved.is_(False),
            )
        ).limit(1)
    )
    return result.scalar_one_or_none() is not None


async def _create_alert(
    db: AsyncSession,
    batch_id: UUID,
    alert_type: AlertType,
    severity: AlertSeverity,
    message: str,
) -> Alert:
    alert = Alert(
        batch_id=batch_id,
        alert_type=alert_type.value,
        severity=severity.value,
        message=message,
    )
    db.add(alert)
    await db.flush()
    log.info("Alert raised batch=%s type=%s severity=%s", batch_id, alert_type, severity)
    return alert


# ── Main rule engine ──────────────────────────────────────────────────────────

async def evaluate_frames(
    db: AsyncSession,
    batch_id: UUID,
    frames: List[TelemetryFrame],
) -> List[Alert]:
    """
    Evaluate a list of ingested frames and raise alerts as needed.

    Rules evaluated:
      1. Huddling      — flock_density_pct >= threshold (daytime only)
      2. Inactivity    — all detections == 0 in every frame (daytime only)
      3. Heat stress   — temperature_c >= HEAT_STRESS_THRESHOLD (any time)

    Night cycle (21:00–03:59): Rules 1 and 2 are suppressed.
    Rule 3 (heat_stress) fires at any hour.

    Returns only the alerts created during this call.
    The caller is responsible for committing the session.
    """
    raised: List[Alert] = []
    night = is_night_cycle()
    threshold = settings.CLUSTER_DENSITY_THRESHOLD

    # ── Rule 1: Huddling (daytime only) ──────────────────────────────────────
    if not night:
        huddle_frames = [f for f in frames if f.flock_density_pct >= threshold]
        if huddle_frames:
            if not await _alert_exists(db, batch_id, AlertType.low_activity):
                severity = (
                    AlertSeverity.critical
                    if len(huddle_frames) > len(frames) / 2
                    else AlertSeverity.warning
                )
                max_density = max(f.flock_density_pct for f in huddle_frames)
                alert = await _create_alert(
                    db, batch_id, AlertType.low_activity, severity,
                    (
                        f"Huddling detected: max cluster density {max_density:.1%} "
                        f"exceeded threshold {threshold:.1%} in "
                        f"{len(huddle_frames)}/{len(frames)} frame(s)."
                    ),
                )
                raised.append(alert)

    # ── Rule 2: Inactivity — zero detections (daytime only) ──────────────────
    if not night:
        empty_frames = [f for f in frames if len(f.detections) == 0]
        if len(empty_frames) == len(frames):
            if not await _alert_exists(db, batch_id, AlertType.low_activity):
                alert = await _create_alert(
                    db, batch_id, AlertType.low_activity, AlertSeverity.warning,
                    (
                        f"Inactivity: no birds detected in "
                        f"{len(frames)} consecutive frame(s). "
                        "Possible camera obstruction or complete flock inactivity."
                    ),
                )
                raised.append(alert)

    # ── Rule 3: Heat stress — temperature threshold (any time) ───────────────
    HEAT_THRESHOLD = 32.0   # °C
    hot_frames = [
        f for f in frames
        if f.temperature_c is not None and f.temperature_c >= HEAT_THRESHOLD
    ]
    if hot_frames:
        if not await _alert_exists(db, batch_id, AlertType.heat_stress):
            max_temp = max(f.temperature_c for f in hot_frames if f.temperature_c)
            alert = await _create_alert(
                db, batch_id, AlertType.heat_stress, AlertSeverity.critical,
                (
                    f"Heat stress: temperature reached {max_temp:.1f}°C "
                    f"(threshold: {HEAT_THRESHOLD}°C) in "
                    f"{len(hot_frames)}/{len(frames)} frame(s). "
                    "Improve ventilation immediately."
                ),
            )
            raised.append(alert)
            log.warning(
                "Heat stress alert raised batch=%s max_temp=%.1f",
                batch_id, max_temp,
            )

    return raised
