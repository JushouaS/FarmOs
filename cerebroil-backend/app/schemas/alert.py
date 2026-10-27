"""app/schemas/alert.py — Alert request/response schemas."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from app.models.alert import AlertSeverity, AlertType
from app.schemas.common import ORMBase


class AlertResponse(ORMBase):
    id: UUID
    batch_id: UUID
    severity: str
    alert_type: str
    message: str
    is_resolved: bool
    created_at: datetime
    updated_at: datetime


class AlertResolveResponse(ORMBase):
    id: UUID
    batch_id: UUID
    severity: str
    alert_type: str
    message: str
    is_resolved: bool
    created_at: datetime
    updated_at: datetime
