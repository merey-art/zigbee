from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_deps import get_current_user
from app.database import get_db
from app.emergency_detector import EmergencyEventNotFound, acknowledge_emergency_event
from app.models import EmergencyEvent, User

router = APIRouter(prefix="/emergencies", tags=["emergencies"])


class EmergencyEventRow(BaseModel):
    id: int
    key: str
    status: str
    device_id: str | None
    temp_device_id: str | None
    co2_device_id: str | None
    zone_id: str | None
    temperature: float
    co2: float
    temperature_rate: float
    co2_rate: float
    telegram_sent: bool
    acknowledged_by: int | None
    started_at: datetime
    last_seen_at: datetime
    acknowledged_at: datetime | None
    cleared_at: datetime | None

    model_config = {"from_attributes": True}


@router.get("", response_model=list[EmergencyEventRow])
async def list_emergencies(
    db: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
    limit: int = 500,
    status: str | None = None,
) -> list[EmergencyEvent]:
    stmt = select(EmergencyEvent).order_by(EmergencyEvent.started_at.desc()).limit(min(max(limit, 1), 2000))
    if status is not None:
        stmt = stmt.where(EmergencyEvent.status == status)
    return list((await db.execute(stmt)).scalars().all())


@router.post("/{event_id}/ack", response_model=EmergencyEventRow)
async def ack_emergency(
    event_id: int,
    current: Annotated[User, Depends(get_current_user)],
) -> EmergencyEvent:
    try:
        return await acknowledge_emergency_event(event_id, current.id)
    except EmergencyEventNotFound:
        raise HTTPException(status_code=404, detail="Emergency event not found")
