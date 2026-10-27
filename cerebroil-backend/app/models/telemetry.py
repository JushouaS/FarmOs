"""
app/models/telemetry.py
────────────────────────
TrackingEvent – high-volume table written by the Raspberry Pi 4 / ROS 2 bridge.

Design choices:
  • BigInteger auto-increment PK instead of UUID – cheaper for bulk inserts and
    sequential range scans on timestamp.
  • JSONB columns for bbox_data and spatial_centroid – flexible structure that
    can be indexed with a GIN index if range queries are needed later.
  • `timestamp` column is indexed (BTREE) for efficient time-range queries.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Index, Integer, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class TrackingEvent(Base):
    """
    One detection record for a single tracked bird in a single video frame.

    track_id        – ByteTrack persistent track identifier
    bbox_data       – [x, y, w, h, confidence] from YOLOv8
    depth_z         – median depth estimate from the depth sensor (metres)
    spatial_centroid – {"x": float, "y": float} in normalised image coords
    """

    __tablename__ = "tracking_events"

    # BigInteger PK for high-throughput inserts (avoids UUID generation overhead)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("batches.id", ondelete="CASCADE"),
        nullable=False,
    )
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    track_id: Mapped[int] = mapped_column(Integer, nullable=False)
    bbox_data: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        comment='{"x": float, "y": float, "w": float, "h": float, "conf": float}',
    )
    depth_z: Mapped[float | None] = mapped_column(Float, nullable=True)
    spatial_centroid: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
        comment='{"x": float, "y": float}',
    )
    # Ambient temperature at frame capture — piggybacked from the Pi's sensor.
    # Used by the heat_stress alert rule.  Nullable: older frames lack this.
    temperature_c: Mapped[float | None] = mapped_column(
        Float, nullable=True,
        comment="Ambient temperature °C from Pi sensor at frame capture",
    )

    # ── Relationships ────────────────────────────────────────
    batch: Mapped["Batch"] = relationship("Batch", back_populates="tracking_events")

    # ── Indexes ──────────────────────────────────────────────
    __table_args__ = (
        Index("ix_tracking_events_batch_timestamp", "batch_id", "timestamp"),
        Index("ix_tracking_events_timestamp", "timestamp"),
    )

    def __repr__(self) -> str:
        return f"<TrackingEvent id={self.id} track_id={self.track_id}>"
