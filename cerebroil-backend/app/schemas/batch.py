"""app/schemas/batch.py — Batch CRUD and dashboard summary schemas."""
from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from app.models.batch import BatchStatus
from app.schemas.alert import AlertResponse
from app.schemas.common import ORMBase


class BatchCreate(BaseModel):
    initial_bird_count: int = Field(..., gt=0, examples=[28])
    start_date: date
    target_harvest_date: Optional[date] = None

    @model_validator(mode="after")
    def harvest_after_start(self) -> "BatchCreate":
        if (
            self.target_harvest_date is not None
            and self.target_harvest_date <= self.start_date
        ):
            raise ValueError("target_harvest_date must be after start_date")
        return self


class BatchUpdate(BaseModel):
    status: Optional[BatchStatus] = None
    target_harvest_date: Optional[date] = None


class BatchResponse(ORMBase):
    id: UUID
    house_id: UUID
    initial_bird_count: int
    start_date: date
    target_harvest_date: Optional[date]
    status: str
    created_at: datetime
    updated_at: datetime


class BatchSummaryResponse(ORMBase):
    batch_id: UUID
    house_id: UUID
    status: str
    initial_bird_count: int
    start_date: date
    current_age_days: int
    latest_avg_weight_g: Optional[float]
    active_alert_count: int
    active_alerts: List[AlertResponse]
