"""
app/api/v1/farms.py
────────────────────
Farm and House CRUD endpoints.

POST   /api/v1/farms                     – create a farm
GET    /api/v1/farms                     – list all farms
GET    /api/v1/farms/{farm_id}           – get a single farm
PATCH  /api/v1/farms/{farm_id}           – update farm name / location
DELETE /api/v1/farms/{farm_id}           – delete farm (cascades to houses → batches)

POST   /api/v1/farms/{farm_id}/houses    – add a house to a farm
GET    /api/v1/farms/{farm_id}/houses    – list houses in a farm
GET    /api/v1/houses/{house_id}         – get a single house
PATCH  /api/v1/houses/{house_id}         – update house name / camera_ip
DELETE /api/v1/houses/{house_id}         – delete house (cascades to batches)
"""
from __future__ import annotations

import logging
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.farm import Farm, House
from app.schemas.farm import (
    FarmCreate, FarmResponse, FarmUpdate,
    HouseCreate, HouseResponse, HouseUpdate,
)

log = logging.getLogger(__name__)
router = APIRouter()


# ── Farm helpers ──────────────────────────────────────────────────────────────

async def _farm_or_404(db: AsyncSession, farm_id: UUID) -> Farm:
    obj: Farm | None = await db.get(Farm, farm_id)
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Farm {farm_id} not found.")
    return obj


async def _house_or_404(db: AsyncSession, house_id: UUID) -> House:
    obj: House | None = await db.get(House, house_id)
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"House {house_id} not found.")
    return obj


# ── Farm CRUD ─────────────────────────────────────────────────────────────────

@router.post(
    "/farms",
    response_model=FarmResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new farm",
)
async def create_farm(
    body: FarmCreate,
    db: AsyncSession = Depends(get_db),
) -> FarmResponse:
    farm = Farm(name=body.name, location=body.location)
    db.add(farm)
    await db.commit()
    await db.refresh(farm)
    return FarmResponse.model_validate(farm)


@router.get(
    "/farms",
    response_model=List[FarmResponse],
    summary="List all farms",
)
async def list_farms(
    limit: int  = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> List[FarmResponse]:
    result = await db.execute(
        select(Farm).order_by(Farm.created_at.desc()).limit(limit).offset(offset)
    )
    return [FarmResponse.model_validate(f) for f in result.scalars().all()]


@router.get(
    "/farms/{farm_id}",
    response_model=FarmResponse,
    summary="Get a single farm",
)
async def get_farm(farm_id: UUID, db: AsyncSession = Depends(get_db)) -> FarmResponse:
    farm = await _farm_or_404(db, farm_id)
    return FarmResponse.model_validate(farm)


@router.patch(
    "/farms/{farm_id}",
    response_model=FarmResponse,
    summary="Update farm name or location",
)
async def update_farm(
    farm_id: UUID,
    body: FarmUpdate,
    db: AsyncSession = Depends(get_db),
) -> FarmResponse:
    farm = await _farm_or_404(db, farm_id)
    if body.name is not None:
        farm.name = body.name
    if body.location is not None:
        farm.location = body.location
    await db.commit()
    await db.refresh(farm)
    return FarmResponse.model_validate(farm)


@router.delete(
    "/farms/{farm_id}",
    status_code=status.HTTP_200_OK,
    response_model=dict,
    summary="Delete a farm (cascades to houses and batches)",
)
async def delete_farm(farm_id: UUID, db: AsyncSession = Depends(get_db)) -> dict:
    farm = await _farm_or_404(db, farm_id)
    await db.delete(farm)
    await db.commit()
    return {"deleted": str(farm_id)}


# ── House CRUD ────────────────────────────────────────────────────────────────
@router.post(
    "/farms/{farm_id}/houses",
    response_model=HouseResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a house to a farm",
)
async def create_house(
    farm_id: UUID,
    body: HouseCreate,
    db: AsyncSession = Depends(get_db),
) -> HouseResponse:
    await _farm_or_404(db, farm_id)   # 404 guard
    house = House(
        farm_id=farm_id,
        house_name=body.house_name,
        camera_ip=body.camera_ip,
    )
    db.add(house)
    await db.commit()
    await db.refresh(house)
    return HouseResponse.model_validate(house)


@router.get(
    "/farms/{farm_id}/houses",
    response_model=List[HouseResponse],
    summary="List houses in a farm",
)
async def list_houses(
    farm_id: UUID,
    db: AsyncSession = Depends(get_db),
) -> List[HouseResponse]:
    await _farm_or_404(db, farm_id)
    result = await db.execute(
        select(House)
        .where(House.farm_id == farm_id)
        .order_by(House.created_at.asc())
    )
    return [HouseResponse.model_validate(h) for h in result.scalars().all()]


@router.get(
    "/houses/{house_id}",
    response_model=HouseResponse,
    summary="Get a single house",
)
async def get_house(house_id: UUID, db: AsyncSession = Depends(get_db)) -> HouseResponse:
    house = await _house_or_404(db, house_id)
    return HouseResponse.model_validate(house)


@router.patch(
    "/houses/{house_id}",
    response_model=HouseResponse,
    summary="Update house name or camera IP",
)
async def update_house(
    house_id: UUID,
    body: HouseUpdate,
    db: AsyncSession = Depends(get_db),
) -> HouseResponse:
    house = await _house_or_404(db, house_id)
    if body.house_name is not None:
        house.house_name = body.house_name
    if body.camera_ip is not None:
        house.camera_ip = body.camera_ip
    await db.commit()
    await db.refresh(house)
    return HouseResponse.model_validate(house)


@router.delete(
    "/houses/{house_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete a house (cascades to batches)",
    response_model=dict,
)
async def delete_house(house_id: UUID, db: AsyncSession = Depends(get_db)) -> dict:
    house = await _house_or_404(db, house_id)
    await db.delete(house)
    await db.commit()
    return {"deleted": str(house_id)}
