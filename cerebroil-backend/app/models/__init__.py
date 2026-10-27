"""
app/models/__init__.py
──────────────────────
Re-export every ORM model so Alembic (and any other import)
can reach the full model graph via a single:

    from app.models import Base, Farm, House, Batch, TrackingEvent, GrowthLog, Alert
"""
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin
from app.models.farm import Farm, House
from app.models.batch import Batch, BatchStatus
from app.models.telemetry import TrackingEvent
from app.models.growth import GrowthLog
from app.models.alert import Alert, AlertSeverity, AlertType

# Expose the declarative base so alembic env.py can import it
from app.database import Base

__all__ = [
    "Base",
    "TimestampMixin",
    "UUIDPrimaryKeyMixin",
    "Farm",
    "House",
    "Batch",
    "BatchStatus",
    "TrackingEvent",
    "GrowthLog",
    "Alert",
    "AlertSeverity",
    "AlertType",
]
