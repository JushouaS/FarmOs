"""
app/models/farm.py
──────────────────
Farm and House ORM models.

Hierarchy:  Farm  ──< House ──< Batch
"""
from __future__ import annotations

import uuid
from typing import List, Optional

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.base import TimestampMixin, UUIDPrimaryKeyMixin


class Farm(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A physical poultry farm that owns one or more houses."""

    __tablename__ = "farms"

    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    location: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # ── Relationships ────────────────────────────────────────
    houses: Mapped[List["House"]] = relationship(
        "House", back_populates="farm", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Farm id={self.id!s} name={self.name!r}>"


class House(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """
    A single poultry house (pen) inside a farm.
    Each house has its own camera and IP address.
    """

    __tablename__ = "houses"

    farm_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("farms.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    house_name: Mapped[str] = mapped_column(String(255), nullable=False)
    camera_ip: Mapped[Optional[str]] = mapped_column(String(45), nullable=True)

    # ── Relationships ────────────────────────────────────────
    farm: Mapped["Farm"] = relationship("Farm", back_populates="houses")
    batches: Mapped[List["Batch"]] = relationship(
        "Batch", back_populates="house", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<House id={self.id!s} name={self.house_name!r}>"
