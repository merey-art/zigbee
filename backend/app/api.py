"""
REST API endpoints:

  GET  /devices
  GET  /devices/{device_id}/history?metric=co2&from=...&to=...
  GET  /health
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import SensorReading

router = APIRouter()


# ── Response schemas ───────────────────────────────────────────────────────────

class DeviceInfo(BaseModel):
    device_id: str
    metrics: list[str]
    last_seen: datetime


class ReadingPoint(BaseModel):
    recorded_at: datetime
    value: float


class HistoryResponse(BaseModel):
    device_id: str
    metric: str
    readings: list[ReadingPoint]


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@router.get("/devices", response_model=list[DeviceInfo])
async def list_devices(db: Annotated[AsyncSession, Depends(get_db)]) -> list[DeviceInfo]:
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

    # Aggregate metrics per device
    devices: dict[str, DeviceInfo] = {}
    for device_id, metric, last_seen in rows:
        if device_id not in devices:
            devices[device_id] = DeviceInfo(
                device_id=device_id, metrics=[], last_seen=last_seen
            )
        devices[device_id].metrics.append(metric)
        if last_seen > devices[device_id].last_seen:
            devices[device_id].last_seen = last_seen

    return list(devices.values())


@router.get("/devices/{device_id}/history", response_model=HistoryResponse)
async def get_history(
    device_id: str,
    db: Annotated[AsyncSession, Depends(get_db)],
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
    stmt = (
        select(SensorReading.recorded_at, SensorReading.value)
        .where(
            SensorReading.device_id == device_id,
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
    return HistoryResponse(device_id=device_id, metric=metric, readings=readings)
