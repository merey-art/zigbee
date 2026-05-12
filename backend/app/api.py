"""
REST API endpoints:

  GET  /devices
  GET  /devices/{device_id}/history?metric=co2&from=...&to=...
  GET  /health
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_deps import get_current_user
from app.bridge_devices_store import aliases_for_readings, canonical_device_id, display_label_for_canonical
from app.database import get_db
from app.models import Company, DeviceCompany, SensorReading, User

router = APIRouter()


# ── Response schemas ───────────────────────────────────────────────────────────

class DeviceInfo(BaseModel):
    device_id: str
    friendly_name: str | None = None
    company_id: int | None = None
    company_name: str | None = None
    metrics: list[str]
    last_seen: datetime


class ReadingPoint(BaseModel):
    recorded_at: datetime
    value: float


class HistoryResponse(BaseModel):
    device_id: str
    metric: str
    readings: list[ReadingPoint]


class AssignCompanyBody(BaseModel):
    company_id: int | None = None


def _norm_assignment_key(canon: str) -> str:
    return canon.strip().lower().replace(" ", "")


async def _device_company_lookup(db: AsyncSession) -> dict[str, tuple[int, str]]:
    stmt = (
        select(DeviceCompany.device_ieee, Company.id, Company.name)
        .join(Company, DeviceCompany.company_id == Company.id)
    )
    rows = (await db.execute(stmt)).all()
    return {_norm_assignment_key(ieee): (cid, cname) for ieee, cid, cname in rows}

@router.get("/health")
async def health(_: Annotated[User, Depends(get_current_user)]) -> dict:
    return {"status": "ok"}


@router.get("/devices", response_model=list[DeviceInfo])
async def list_devices(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
) -> list[DeviceInfo]:
    """Return all known devices with their available metrics and last-seen time."""
    stmt = (
        select(
            SensorReading.device_id,
            SensorReading.metric,
            func.max(SensorReading.recorded_at).label("last_seen"),
        )
        .group_by(SensorReading.device_id, SensorReading.metric)
        .order_by(SensorReading.device_id)
    )
    rows = (await db.execute(stmt)).all()

    devices_merged: dict[str, DeviceInfo] = {}
    for raw_device_id, metric, last_seen in rows:
        first_seg = raw_device_id.split("/")[0].strip()
        canon = await canonical_device_id(first_seg)
        label = await display_label_for_canonical(canon)
        if canon not in devices_merged:
            devices_merged[canon] = DeviceInfo(
                device_id=canon,
                friendly_name=label,
                metrics=[],
                last_seen=last_seen,
            )
        devices_merged[canon].metrics.append(metric)
        if last_seen > devices_merged[canon].last_seen:
            devices_merged[canon].last_seen = last_seen

    result = list(devices_merged.values())
    for d in result:
        d.metrics = sorted(set(d.metrics))

    lookup = await _device_company_lookup(db)
    for d in result:
        hit = lookup.get(_norm_assignment_key(d.device_id))
        if hit:
            d.company_id, d.company_name = hit

    return result


@router.put("/devices/{device_id}/company", status_code=status.HTTP_200_OK)
async def assign_device_company(
    device_id: str,
    body: AssignCompanyBody,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
) -> dict[str, str]:
    canon = await canonical_device_id(device_id.split("/")[0].strip())
    key = _norm_assignment_key(canon)

    if body.company_id is None:
        await db.execute(delete(DeviceCompany).where(DeviceCompany.device_ieee == key))
        await db.commit()
        return {"status": "ok"}

    result_co = await db.execute(select(Company).where(Company.id == body.company_id))
    if result_co.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Company not found")

    existing = await db.scalar(select(DeviceCompany).where(DeviceCompany.device_ieee == key))
    if existing is None:
        db.add(DeviceCompany(device_ieee=key, company_id=body.company_id))
    else:
        existing.company_id = body.company_id
    await db.commit()
    return {"status": "ok"}
async def get_history(
    device_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    metric: Annotated[str, Query(description="Metric name, e.g. co2, temperature")] = "temperature",
    from_: Annotated[
        datetime | None,
        Query(alias="from", description="ISO-8601 start time (UTC)"),
    ] = None,
    to: Annotated[
        datetime | None,
        Query(description="ISO-8601 end time (UTC)"),
    ] = None,
    limit: Annotated[int, Query(ge=1, le=10_000)] = 1_000,
) -> HistoryResponse:
    """Return time-series readings for a specific device + metric."""
    aliases = await aliases_for_readings(device_id)
    canon = await canonical_device_id(device_id.split("/")[0].strip())

    stmt = (
        select(SensorReading.recorded_at, SensorReading.value)
        .where(
            SensorReading.device_id.in_(aliases),
            SensorReading.metric == metric,
        )
        .order_by(SensorReading.recorded_at.desc())
        .limit(limit)
    )

    if from_:
        from_utc = from_.replace(tzinfo=timezone.utc) if from_.tzinfo is None else from_
        stmt = stmt.where(SensorReading.recorded_at >= from_utc)
    if to:
        to_utc = to.replace(tzinfo=timezone.utc) if to.tzinfo is None else to
        stmt = stmt.where(SensorReading.recorded_at <= to_utc)

    rows = (await db.execute(stmt)).all()
    if not rows:
        raise HTTPException(
            status_code=404,
            detail=f"No readings found for device '{device_id}' metric '{metric}'",
        )

    # Return chronological order to the client
    readings = [
        ReadingPoint(recorded_at=recorded_at, value=value)
        for recorded_at, value in reversed(rows)
    ]
    return HistoryResponse(device_id=canon, metric=metric, readings=readings)
