"""
app/api/v1/alerts.py
─────────────────────
Alert management endpoints.

GET   /api/v1/batches/{batch_id}/alerts      – list unresolved alerts
PATCH /api/v1/alerts/{alert_id}/resolve      – mark an alert as resolved
"""
from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.alert import Alert
from app.schemas.alert import AlertResolveResponse, AlertResponse
from app.schemas.common import PaginatedResponse

log = logging.getLogger(__name__)
router = APIRouter()


# ── GET /batches/{batch_id}/alerts ────────────────────────────────────────────

@router.get(
    "/batches/{batch_id}/alerts",
    response_model=PaginatedResponse[AlertResponse],
    summary="List unresolved alerts for a batch",
)
async def list_alerts(
    batch_id: UUID,
    limit: int  = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> PaginatedResponse[AlertResponse]:
    # total count
    from sqlalchemy import func
    count_q = await db.execute(
        select(func.count(Alert.id)).where(
            and_(Alert.batch_id == batch_id, Alert.is_resolved.is_(False))
        )
    )
    total: int = count_q.scalar_one()

    # paginated rows
    rows_q = await db.execute(
        select(Alert)
        .where(and_(Alert.batch_id == batch_id, Alert.is_resolved.is_(False)))
        .order_by(Alert.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    items = [AlertResponse.model_validate(a) for a in rows_q.scalars().all()]

    return PaginatedResponse(total=total, limit=limit, offset=offset, items=items)


# ── PATCH /alerts/{alert_id}/resolve ─────────────────────────────────────────

@router.patch(
    "/alerts/{alert_id}/resolve",
    response_model=AlertResolveResponse,
    summary="Mark an alert as resolved",
)
async def resolve_alert(
    alert_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> AlertResolveResponse:
    alert: Alert | None = await db.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert {alert_id} not found.",
        )
    if alert.is_resolved:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Alert is already resolved.",
        )

    alert.is_resolved = True
    await db.commit()
    await db.refresh(alert)

    log.info("Alert resolved alert_id=%s", alert_id)
    return AlertResolveResponse.model_validate(alert)
