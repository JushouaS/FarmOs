"""
app/schemas/telemetry.py
─────────────────────────
Schemas for the Raspberry Pi 4 → FastAPI telemetry ingestion endpoint.

The Pi publishes one *TelemetryFrame* per processed video frame, which
contains a list of *BirdDetection* records (one per tracked bird).
The endpoint accepts a *batch* of frames in one POST to reduce round-trip
overhead over the network.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


# ── Per-bird detection ────────────────────────────────────────────────────────

class BBoxData(BaseModel):
    """Bounding box from YOLOv8 (pixel or normalised coords)."""
    x: float = Field(..., description="Top-left x coordinate")
    y: float = Field(..., description="Top-left y coordinate")
    w: float = Field(..., description="Box width")
    h: float = Field(..., description="Box height")
    conf: float = Field(..., ge=0.0, le=1.0, description="Detection confidence")


class SpatialCentroid(BaseModel):
    """Normalised (0–1) image-space centroid from the 2D CNN depth stage."""
    x: float = Field(..., ge=0.0, le=1.0)
    y: float = Field(..., ge=0.0, le=1.0)


class BirdDetection(BaseModel):
    """
    A single YOLOv8 + ByteTrack detection for one bird in one frame.

    track_id  – ByteTrack persistent ID (stable across frames)
    bbox      – bounding box in pixel coordinates
    depth_z   – depth estimate in metres from the RGBD sensor
    centroid  – spatial centroid in normalised image coords
    """
    track_id: int = Field(..., ge=0)
    bbox: BBoxData
    depth_z: Optional[float] = Field(None, ge=0.0)
    centroid: Optional[SpatialCentroid] = None


# ── Frame payload ─────────────────────────────────────────────────────────────

class TelemetryFrame(BaseModel):
    """
    One processed video frame from the Pi.

    timestamp         – ISO-8601 UTC timestamp of the frame capture
    flock_density_pct – fraction of pen floor area occupied by birds (0–1)
    temperature_c     – optional ambient temperature reading from the Pi
    detections        – list of per-bird detections
    """
    timestamp: datetime
    flock_density_pct: float = Field(..., ge=0.0, le=1.0)
    temperature_c: Optional[float] = Field(
        None, description="Ambient temperature °C from Pi sensor at frame capture"
    )
    detections: List[BirdDetection] = Field(default_factory=list)


# ── Batch ingestion request ───────────────────────────────────────────────────

class TelemetryBatchRequest(BaseModel):
    """
    The body sent to POST /api/v1/telemetry/events.

    batch_id – the Batch (grow-out cycle) these events belong to
    frames   – 1-N frames captured since the last POST
    """
    batch_id: UUID
    frames: List[TelemetryFrame] = Field(..., min_length=1)

    @field_validator("frames")
    @classmethod
    def check_max_frames(cls, v: List[TelemetryFrame]) -> List[TelemetryFrame]:
        if len(v) > 500:
            raise ValueError("Maximum 500 frames per request")
        return v


# ── Ingestion response ────────────────────────────────────────────────────────

class TelemetryIngestResponse(BaseModel):
    """
    Returned to the Pi after a successful ingestion.

    events_stored  – total TrackingEvent rows written
    alerts_raised  – alerts created by the rule engine
    """
    events_stored: int
    alerts_raised: int
