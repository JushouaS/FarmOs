"""
app/api/v1/analytics.py
────────────────────────
Dashboard analytics endpoints.

GET /api/v1/batches/{batch_id}/summary        – KPI snapshot
GET /api/v1/batches/{batch_id}/growth-trend   – daily time-series
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.alert import Alert
from app.models.batch import Batch, BatchStatus
from app.models.growth import GrowthLog
from app.schemas.alert import AlertResponse
from app.schemas.batch import BatchSummaryResponse
from app.schemas.growth import GrowthTrendPoint, GrowthTrendResponse

log = logging.getLogger(__name__)
router = APIRouter()


# ── Helper ────────────────────────────────────────────────────────────────────
async def _get_batch_or_404(db: AsyncSession, batch_id: UUID) -> Batch:
    batch: Batch | None = await db.get(Batch, batch_id)
    if batch is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Batch {batch_id} not found.",
        )
    return batch


# ── GET /batches/{batch_id}/summary ──────────────────────────────────────────

@router.get(
    "/batches/{batch_id}/summary",
    response_model=BatchSummaryResponse,
    summary="Return KPI snapshot for a batch",
)
async def get_batch_summary(
    batch_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> BatchSummaryResponse:
    batch = await _get_batch_or_404(db, batch_id)

    # Current age
    today = date.today()
    current_age_days = (today - batch.start_date).days

    # Latest growth log
    growth_result = await db.execute(
        select(GrowthLog)
        .where(GrowthLog.batch_id == batch_id)
        .order_by(GrowthLog.recorded_at.desc())
        .limit(1)
    )
    latest_log: GrowthLog | None = growth_result.scalar_one_or_none()
    latest_avg_weight = latest_log.estimated_avg_weight_g if latest_log else None

    # Active alerts
    alerts_result = await db.execute(
        select(Alert)
        .where(
            and_(
                Alert.batch_id == batch_id,
                Alert.is_resolved.is_(False),
            )
        )
        .order_by(Alert.created_at.desc())
        .limit(5)
    )
    active_alerts: List[Alert] = list(alerts_result.scalars().all())

    count_result = await db.execute(
        select(func.count(Alert.id)).where(
            and_(
                Alert.batch_id == batch_id,
                Alert.is_resolved.is_(False),
            )
        )
    )
    active_alert_count: int = count_result.scalar_one()

    return BatchSummaryResponse(
        batch_id=batch.id,
        house_id=batch.house_id,
        status=batch.status,
        initial_bird_count=batch.initial_bird_count,
        start_date=batch.start_date,
        current_age_days=current_age_days,
        latest_avg_weight_g=latest_avg_weight,
        active_alert_count=active_alert_count,
        active_alerts=[AlertResponse.model_validate(a) for a in active_alerts],
    )


# ── GET /batches/{batch_id}/growth-trend ─────────────────────────────────────

@router.get(
    "/batches/{batch_id}/growth-trend",
    response_model=GrowthTrendResponse,
    summary="Return daily weight-vs-age time-series for a batch",
)
async def get_growth_trend(
    batch_id: UUID,
    limit: int = Query(42, ge=1, le=42, description="Max data points (default: full grow-out)"),
    db: AsyncSession = Depends(get_db),
) -> GrowthTrendResponse:
    batch = await _get_batch_or_404(db, batch_id)

    today = date.today()
    current_age_days = (today - batch.start_date).days

    logs_result = await db.execute(
        select(GrowthLog)
        .where(GrowthLog.batch_id == batch_id)
        .order_by(GrowthLog.recorded_at.asc())
        .limit(limit)
    )
    logs: List[GrowthLog] = list(logs_result.scalars().all())

    series: List[GrowthTrendPoint] = [
        GrowthTrendPoint(
            recorded_at=log.recorded_at,
            age_days=(log.recorded_at.date() - batch.start_date).days,
            avg_weight_g=log.estimated_avg_weight_g,
            flock_density_pct=log.flock_density_pct,
            daily_mortality_count=log.daily_mortality_count,
        )
        for log in logs
    ]

    return GrowthTrendResponse(
        batch_id=batch.id,
        start_date=batch.start_date.isoformat(),
        current_age_days=current_age_days,
        series=series,
    )
