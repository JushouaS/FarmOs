"""app/schemas/farm.py — Farm and House request/response schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.common import ORMBase


class FarmCreate(BaseModel):
    name: str = Field(..., max_length=255, examples=["Data Cruz Poultry Farm"])
    location: Optional[str] = Field(None, examples=["Agora de Oro City"])


class FarmUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    location: Optional[str] = None


class FarmResponse(ORMBase):
    id: UUID
    name: str
    location: Optional[str]
    created_at: datetime
    updated_at: datetime


class HouseCreate(BaseModel):
    house_name: str = Field(..., max_length=255, examples=["Pen 1"])
    camera_ip: Optional[str] = Field(None, max_length=45, examples=["192.168.1.50"])


class HouseUpdate(BaseModel):
    house_name: Optional[str] = Field(None, max_length=255)
    camera_ip: Optional[str] = Field(None, max_length=45)


class HouseResponse(ORMBase):
    id: UUID
    farm_id: UUID
    house_name: str
    camera_ip: Optional[str]
    created_at: datetime
    updated_at: datetime
