"""CRUD for companies (sensor grouping / tenants in one building)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_deps import get_current_user
from app.database import get_db
from app.models import Company, User

router = APIRouter(prefix="/companies", tags=["companies"])


class CompanyRow(BaseModel):
    id: int
    name: str
    created_at: datetime

    model_config = {"from_attributes": True}


class CompanyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class CompanyPatch(BaseModel):
    name: str = Field(min_length=1, max_length=255)


@router.get("", response_model=list[CompanyRow])
async def list_companies(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
) -> list[CompanyRow]:
    result = await db.execute(select(Company).order_by(Company.name))
    rows = result.scalars().all()
    return [CompanyRow.model_validate(r) for r in rows]


@router.post("", response_model=CompanyRow, status_code=status.HTTP_201_CREATED)
async def create_company(
    body: CompanyCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
) -> CompanyRow:
    name = body.name.strip()
    dup = await db.execute(select(Company).where(Company.name == name))
    if dup.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Company name already exists")
    row = Company(name=name)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return CompanyRow.model_validate(row)


@router.patch("/{company_id}", response_model=CompanyRow)
async def patch_company(
    company_id: int,
    body: CompanyPatch,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
) -> CompanyRow:
    result = await db.execute(select(Company).where(Company.id == company_id))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    name = body.name.strip()
    dup = await db.execute(select(Company).where(Company.name == name, Company.id != company_id))
    if dup.scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Company name already exists")
    row.name = name
    await db.commit()
    await db.refresh(row)
    return CompanyRow.model_validate(row)


@router.delete("/{company_id}", status_code=status.HTTP_200_OK)
async def delete_company(
    company_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
) -> dict[str, str]:
    result = await db.execute(select(Company).where(Company.id == company_id))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    await db.execute(delete(Company).where(Company.id == company_id))
    await db.commit()
    return {"status": "ok"}
