"""
app/models/batch.py
────────────────────
Batch (grow-out cycle) model.

Column type note
────────────────
`status` uses sa.String instead of sa.Enum so SQLAlchemy never fires an
automatic CREATE TYPE event against the database during migrations.
The DB-level ENUM type (batchstatus) is created exclusively in the Alembic
migration script via raw SQL.  Python-level validation is handled by the
BatchStatus enum class used in application code.
"""
from __future__ import annotations

import enum
import uuid
from datetime import date
from typing import List, Optional

from sqlalchemy import Date, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin


class BatchStatus(str, enum.Enum):
    active    = "active"
    completed = "completed"


class Batch(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "batches"

    house_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("houses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    initial_bird_count: Mapped[int] = mapped_column(Integer, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    target_harvest_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # String in the ORM — DB constraint (ENUM cast) is enforced by PostgreSQL
    # via the migration DDL. Using String avoids SQLAlchemy auto-CREATE TYPE.
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=BatchStatus.active.value,
        server_default=BatchStatus.active.value,
    )

    house: Mapped["House"] = relationship("House", back_populates="batches")
    tracking_events: Mapped[List["TrackingEvent"]] = relationship(
        "TrackingEvent", back_populates="batch", cascade="all, delete-orphan"
    )
    growth_logs: Mapped[List["GrowthLog"]] = relationship(
        "GrowthLog", back_populates="batch", cascade="all, delete-orphan"
    )
    alerts: Mapped[List["Alert"]] = relationship(
        "Alert", back_populates="batch", cascade="all, delete-orphan"
    )

    @property
    def status_enum(self) -> BatchStatus:
        """Convenience accessor that returns a typed BatchStatus."""
        return BatchStatus(self.status)

    def __repr__(self) -> str:
        return f"<Batch id={self.id!s} status={self.status}>"
