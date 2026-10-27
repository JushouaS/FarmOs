"""app/schemas/common.py — Shared base models and types."""
from __future__ import annotations

from typing import Generic, List, TypeVar

from pydantic import BaseModel, ConfigDict


T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    total: int
    limit: int
    offset: int
    items: List[T]


class ORMBase(BaseModel):
    """Base for all response schemas — enables ORM mode."""
    model_config = ConfigDict(from_attributes=True)


class ErrorDetail(BaseModel):
    detail: str
