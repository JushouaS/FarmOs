"""
app/models/growth.py
─────────────────────
GrowthLog – daily aggregate of flock metrics.

Written by the analytics service once per day (or triggered manually).
Drives the weight growth curve chart on the dashboard.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import UUIDPrimaryKeyMixin


class GrowthLog(Base, UUIDPrimaryKeyMixin):
    """
    Daily flock health snapshot.

    estimated_avg_weight_g  – 2D CNN weight estimate averaged across the flock
    flock_density_pct       – fraction of pen floor area occupied by detected birds
    daily_mortality_count   – deaths observed since the previous log entry
    """

    __tablename__ = "growth_logs"

    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("batches.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
    )
    estimated_avg_weight_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    flock_density_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    daily_mortality_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    # ── Relationships ────────────────────────────────────────
    batch: Mapped["Batch"] = relationship("Batch", back_populates="growth_logs")

    def __repr__(self) -> str:
        return (
            f"<GrowthLog id={self.id!s} "
            f"recorded_at={self.recorded_at} "
            f"avg_weight={self.estimated_avg_weight_g}g>"
        )
