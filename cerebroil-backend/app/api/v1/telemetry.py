"""
app/api/v1/telemetry.py
────────────────────────
POST /api/v1/telemetry/events

High-throughput ingestion endpoint for the Raspberry Pi 4 / ROS 2 bridge.

Security
────────
Requires a valid X-API-Key header (see app/api/dependencies.py).

Processing pipeline
───────────────────
1.  Validate the incoming TelemetryBatchRequest with Pydantic v2.
2.  Verify the batch exists and is 'active'.
3.  Bulk-insert all TrackingEvent rows in a single DB round-trip using
    session.add_all() instead of individual inserts.
4.  Run the alert rule engine over the ingested frames.
5.  Broadcast a LiveFrameMessage over the WebSocket to all connected
    dashboard clients for this batch.
6.  Return a TelemetryIngestResponse summary.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies import require_api_key
from app.config import get_settings
from app.database import get_db

settings = get_settings()
from app.models.batch import Batch, BatchStatus
from app.models.telemetry import TrackingEvent
from app.schemas.telemetry import TelemetryBatchRequest, TelemetryIngestResponse
from app.schemas.websocket import LiveFrameMessage
from app.services.alert_rules import evaluate_frames
from app.services.connection_manager import manager as ws_manager

from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

router = APIRouter()


@router.post(
    "/telemetry/events",
    response_model=TelemetryIngestResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_api_key)],
    summary="Ingest telemetry batch from the Raspberry Pi 4",
    description=(
        "Accepts a JSON payload containing one or more processed video frames "
        "(tracking events, depth estimates, flock density). "
        "Requires a valid `X-API-Key` header."
    ),
)
async def ingest_telemetry(
    payload: TelemetryBatchRequest,
    db: AsyncSession = Depends(get_db),
) -> TelemetryIngestResponse:
    # ── 1. Verify batch ───────────────────────────────────────────────────────
    batch: Batch | None = await db.get(Batch, payload.batch_id)
    if batch is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Batch {payload.batch_id} not found.",
        )
    if batch.status != BatchStatus.active.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Batch {payload.batch_id} is '{batch.status}', not active.",
        )

    # ── 2. Build ORM rows ─────────────────────────────────────────────────────
    events: List[TrackingEvent] = []
    for frame in payload.frames:
        for detection in frame.detections:
            events.append(
                TrackingEvent(
                    batch_id=payload.batch_id,
                    timestamp=frame.timestamp,
                    track_id=detection.track_id,
                    bbox_data={
                        "x":    detection.bbox.x,
                        "y":    detection.bbox.y,
                        "w":    detection.bbox.w,
                        "h":    detection.bbox.h,
                        "conf": detection.bbox.conf,
                    },
                    depth_z=detection.depth_z,
                    spatial_centroid=(
                        {"x": detection.centroid.x, "y": detection.centroid.y}
                        if detection.centroid
                        else None
                    ),
                    temperature_c=frame.temperature_c,
                )
            )

    if events:
        db.add_all(events)

    # ── 3. Run alert rule engine ──────────────────────────────────────────────
    raised = await evaluate_frames(db, payload.batch_id, payload.frames)

    # ── 4. Commit ─────────────────────────────────────────────────────────────
    await db.commit()

    # ── 5. Broadcast live frame to WebSocket subscribers ─────────────────────
    last_frame = payload.frames[-1]
    if ws_manager.subscriber_count > 0:
        try:
            from app.services.alert_rules import (
                is_night_cycle,
                behavior_label as compute_behavior_label,
                weight_category,
            )
            night = is_night_cycle()
            has_inactive = len(last_frame.detections) == 0
            b_label = compute_behavior_label(
                flock_density_pct=last_frame.flock_density_pct,
                has_inactive_birds=has_inactive,
                night=night,
                density_threshold=settings.CLUSTER_DENSITY_THRESHOLD,
            )
            await ws_manager.broadcast_json(
                payload.batch_id,
                LiveFrameMessage(
                    batch_id=payload.batch_id,
                    timestamp=last_frame.timestamp,
                    is_night_cycle=night,
                    behavior_label=b_label,
                    flock_density_pct=last_frame.flock_density_pct,
                    bird_count=len(last_frame.detections),
                    detections=last_frame.detections,
                ),
            )
        except Exception as exc:                # noqa: BLE001
            log.warning("WS broadcast failed (non-fatal): %s", exc)

    log.info(
        "Ingested batch=%s frames=%d events=%d alerts=%d",
        payload.batch_id, len(payload.frames), len(events), len(raised),
    )
    return TelemetryIngestResponse(
        events_stored=len(events),
        alerts_raised=len(raised),
    )
