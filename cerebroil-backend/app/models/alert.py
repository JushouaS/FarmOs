"""
app/models/alert.py
────────────────────
Alert model.

Column type note
────────────────
`severity` and `alert_type` use sa.String instead of sa.Enum so SQLAlchemy
never fires automatic CREATE TYPE events. The DB-level ENUM types are
created exclusively in the Alembic migration via raw SQL.
"""
from __future__ import annotations

import enum
import uuid

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin


class AlertSeverity(str, enum.Enum):
    info     = "info"
    warning  = "warning"
    critical = "critical"


class AlertType(str, enum.Enum):
    low_activity    = "low_activity"
    heat_stress     = "heat_stress"
    mortality_spike = "mortality_spike"


class Alert(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "alerts"

    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("batches.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # String columns — DB ENUMs are enforced by PostgreSQL via migration DDL
    severity: Mapped[str] = mapped_column(String(20), nullable=False)
    alert_type: Mapped[str] = mapped_column(String(30), nullable=False)

    message: Mapped[str] = mapped_column(Text, nullable=False)
    is_resolved: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )

    batch: Mapped["Batch"] = relationship("Batch", back_populates="alerts")

    def __repr__(self) -> str:
        return (
            f"<Alert id={self.id!s} type={self.alert_type} "
            f"severity={self.severity} resolved={self.is_resolved}>"
        )
