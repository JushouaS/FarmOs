"""
app/schemas/websocket.py
─────────────────────────
Message envelopes broadcast over the WebSocket connection at
/ws/batches/{batch_id}/live.

All messages share a `type` discriminator so dashboard clients
can switch on it and update the correct UI widget.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional, Union
from uuid import UUID

from pydantic import BaseModel

from app.models.alert import AlertSeverity, AlertType
from app.schemas.telemetry import BirdDetection


# ── Individual message types ──────────────────────────────────────────────────

class LiveFrameMessage(BaseModel):
    """
    Published every time a new TelemetryFrame is ingested for this batch.
    Dashboard uses this to update the live-camera overlay.

    Fields added in v3.0 (pivot: 3-state behavioral model + weight categories):
      is_night_cycle   — True when server local time is 21:00–03:59
      behavior_label   — "Inactivity" | "Huddling" | "Sleeping"
      detections       — extended with weight_kg, weight_category, behavior_label
    """
    type: Literal["live_frame"] = "live_frame"
    batch_id: UUID
    timestamp: datetime
    is_night_cycle: bool
    behavior_label: str          # "Inactivity" | "Huddling" | "Sleeping"
    flock_density_pct: float
    bird_count: int
    detections: List[BirdDetection]


class LiveAlertMessage(BaseModel):
    """
    Published immediately when the rule engine raises a new Alert.
    Dashboard can show a toast / push notification.
    """
    type: Literal["alert"] = "alert"
    alert_id: UUID
    batch_id: UUID
    severity: AlertSeverity
    alert_type: AlertType
    message: str
    raised_at: datetime


class ConnectionAckMessage(BaseModel):
    """
    Sent once when a WebSocket client first connects.
    """
    type: Literal["connection_ack"] = "connection_ack"
    batch_id: UUID
    message: str = "Connected to live feed"


class ErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    detail: str


# ── Discriminated union for outbound messages ─────────────────────────────────
WsOutboundMessage = Union[
    LiveFrameMessage,
    LiveAlertMessage,
    ConnectionAckMessage,
    ErrorMessage,
]
