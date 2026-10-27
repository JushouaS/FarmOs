"""
app/api/v1/batches.py
──────────────────────
Batch lifecycle management endpoints.

POST   /api/v1/houses/{house_id}/batches         – create a batch for a house
GET    /api/v1/houses/{house_id}/batches          – list batches for a house
GET    /api/v1/batches/{batch_id}                 – get a single batch
PATCH  /api/v1/batches/{batch_id}                 – update status / harvest date
POST   /api/v1/batches/{batch_id}/close           – mark batch as completed

POST   /api/v1/batches/{batch_id}/growth-logs     – manually trigger a growth log
GET    /api/v1/batches/{batch_id}/growth-logs     – list growth logs for a batch
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.batch import Batch, BatchStatus
from app.models.farm import House
from app.models.growth import GrowthLog
from app.schemas.batch import BatchCreate, BatchResponse, BatchUpdate
from app.schemas.growth import GrowthLogCreate, GrowthLogResponse
from app.services.weight_service import build_growth_log

log = logging.getLogger(__name__)
router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _house_or_404(db: AsyncSession, house_id: UUID) -> House:
    obj: House | None = await db.get(House, house_id)
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"House {house_id} not found.")
    return obj


async def _batch_or_404(db: AsyncSession, batch_id: UUID) -> Batch:
    obj: Batch | None = await db.get(Batch, batch_id)
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Batch {batch_id} not found.")
    return obj


# ── Batch CRUD ────────────────────────────────────────────────────────────────

@router.post(
    "/houses/{house_id}/batches",
    response_model=BatchResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new grow-out batch for a house",
)
async def create_batch(
    house_id: UUID,
    body: BatchCreate,
    db: AsyncSession = Depends(get_db),
) -> BatchResponse:
    await _house_or_404(db, house_id)
    # INSERT via raw SQL so PostgreSQL handles the batchstatus enum cast
    from sqlalchemy import text as _text
    result = await db.execute(
        _text(
            "INSERT INTO batches "
            "(house_id, initial_bird_count, start_date, target_harvest_date, status) "
            "VALUES (:hid, :cnt, :sd, :hd, 'active'::batchstatus) "
            "RETURNING id, house_id, initial_bird_count, start_date, "
            "target_harvest_date, status::text, created_at, updated_at"
        ),
        {
            "hid": house_id,
            "cnt": body.initial_bird_count,
            "sd":  body.start_date,
            "hd":  body.target_harvest_date,
        },
    )
    await db.commit()
    row = result.mappings().one()
    batch = await db.get(Batch, row["id"])
    log.info("Batch created id=%s house=%s", row["id"], house_id)
    return BatchResponse.model_validate(batch)


@router.get(
    "/houses/{house_id}/batches",
    response_model=List[BatchResponse],
    summary="List batches for a house",
)
async def list_batches(
    house_id: UUID,
    status_filter: Optional[str] = Query(None, alias="status"),
    db: AsyncSession = Depends(get_db),
) -> List[BatchResponse]:
    await _house_or_404(db, house_id)
    q = select(Batch).where(Batch.house_id == house_id)
    if status_filter:
        q = q.where(Batch.status == status_filter)
    q = q.order_by(Batch.start_date.desc())
    result = await db.execute(q)
    return [BatchResponse.model_validate(b) for b in result.scalars().all()]


@router.get(
    "/batches/{batch_id}",
    response_model=BatchResponse,
    summary="Get a single batch",
)
async def get_batch(batch_id: UUID, db: AsyncSession = Depends(get_db)) -> BatchResponse:
    batch = await _batch_or_404(db, batch_id)
    return BatchResponse.model_validate(batch)


@router.patch(
    "/batches/{batch_id}",
    response_model=BatchResponse,
    summary="Update batch status or target harvest date",
)
async def update_batch(
    batch_id: UUID,
    body: BatchUpdate,
    db: AsyncSession = Depends(get_db),
) -> BatchResponse:
    batch = await _batch_or_404(db, batch_id)
    from sqlalchemy import text as _text
    if body.status is not None:
        await db.execute(
            _text("UPDATE batches SET status=CAST(:status AS batchstatus) WHERE id=:bid"),
            {"status": body.status.value, "bid": batch_id},
        )
    if body.target_harvest_date is not None:
        await db.execute(
            _text("UPDATE batches SET target_harvest_date=:hd WHERE id=:bid"),
            {"hd": body.target_harvest_date, "bid": batch_id},
        )
    await db.commit()
    await db.refresh(batch)
    return BatchResponse.model_validate(batch)


@router.post(
    "/batches/{batch_id}/close",
    response_model=BatchResponse,
    summary="Mark a batch as completed (harvest closed)",
)
async def close_batch(batch_id: UUID, db: AsyncSession = Depends(get_db)) -> BatchResponse:
    batch = await _batch_or_404(db, batch_id)
    if batch.status == BatchStatus.completed.value:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Batch {batch_id} is already completed.",
        )
    from sqlalchemy import text as _text
    await db.execute(
        _text("UPDATE batches SET status='completed'::batchstatus WHERE id=:bid"),
        {"bid": batch_id},
    )
    await db.commit()
    await db.refresh(batch)
    log.info("Batch closed id=%s", batch_id)
    return BatchResponse.model_validate(batch)


# ── Growth log endpoints ───────────────────────────────────────────────────────

@router.post(
    "/batches/{batch_id}/growth-logs",
    response_model=GrowthLogResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Trigger a daily growth log snapshot for a batch",
    description=(
        "Computes today's average weight from depth telemetry in the database, "
        "records a GrowthLog row, and fires a mortality-spike alert if needed. "
        "Call once per day, typically at end-of-day, or after a manual weigh-in."
    ),
)
async def trigger_growth_log(
    batch_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> GrowthLogResponse:
    await _batch_or_404(db, batch_id)
    try:
        growth_log = await build_growth_log(db, batch_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    await db.commit()
    await db.refresh(growth_log)
    log.info("GrowthLog created batch=%s weight=%.1fg", batch_id, growth_log.estimated_avg_weight_g or 0)
    return GrowthLogResponse.model_validate(growth_log)


@router.get(
    "/batches/{batch_id}/growth-logs",
    response_model=List[GrowthLogResponse],
    summary="List all growth log entries for a batch",
)
async def list_growth_logs(
    batch_id: UUID,
    limit: int  = Query(42, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> List[GrowthLogResponse]:
    await _batch_or_404(db, batch_id)
    result = await db.execute(
        select(GrowthLog)
        .where(GrowthLog.batch_id == batch_id)
        .order_by(GrowthLog.recorded_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return [GrowthLogResponse.model_validate(g) for g in result.scalars().all()]
