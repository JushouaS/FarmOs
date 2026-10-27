"""app/schemas/growth.py — GrowthLog and growth-trend time-series schemas."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import ORMBase


class GrowthLogCreate(BaseModel):
    batch_id: UUID
    estimated_avg_weight_g: Optional[float] = Field(None, ge=0)
    flock_density_pct: Optional[float] = Field(None, ge=0.0, le=1.0)
    daily_mortality_count: int = Field(default=0, ge=0)


class GrowthLogResponse(ORMBase):
    id: UUID
    batch_id: UUID
    recorded_at: datetime
    estimated_avg_weight_g: Optional[float]
    flock_density_pct: Optional[float]
    daily_mortality_count: int


class GrowthTrendPoint(BaseModel):
    recorded_at: datetime
    age_days: int
    avg_weight_g: Optional[float]
    flock_density_pct: Optional[float]
    daily_mortality_count: int


class GrowthTrendResponse(BaseModel):
    batch_id: UUID
    start_date: str
    current_age_days: int
    series: List[GrowthTrendPoint]
