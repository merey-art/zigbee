"""Alert firing history (threshold crossings)."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_deps import get_current_user
from app.database import get_db
from app.models import AlertEvent, User

router = APIRouter(prefix="/alert-events", tags=["alert-events"])


class AlertEventRow(BaseModel):
    id: int
    user_id: int
    rule_id: int | None
    device_id: str
    device_label: str | None
    metric: str
    value: float
    threshold: float
    direction: str
    telegram_sent: bool
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("", response_model=list[AlertEventRow])
async def list_alert_events(
    db: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
    limit: Annotated[int, Query(ge=1, le=2000)] = 500,
) -> list[AlertEvent]:
    stmt = (
        select(AlertEvent)
        .where(AlertEvent.user_id == current.id)
        .order_by(AlertEvent.created_at.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())
