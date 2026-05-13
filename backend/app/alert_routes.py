"""Per-user sensor threshold rules for Telegram alerts."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_deps import get_current_user
from app.database import get_db
from app.models import AlertRule, User
from app.tracked_metrics import TRACKED_METRICS

router = APIRouter(prefix="/alert-rules", tags=["alerts"])

Direction = Literal["above", "below"]


class AlertRuleRow(BaseModel):
    id: int
    user_id: int
    device_id: str | None
    metric: str
    direction: str
    threshold: float
    cooldown_seconds: int
    enabled: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class AlertRuleCreate(BaseModel):
    device_id: str | None = Field(
        default=None,
        description="Canonical device id from /devices; omit for all devices",
    )
    metric: str
    direction: Direction
    threshold: float
    cooldown_seconds: int = Field(default=900, ge=60, le=86_400)
    enabled: bool = True

    @field_validator("metric")
    @classmethod
    def metric_must_be_tracked(cls, v: str) -> str:
        if v not in TRACKED_METRICS:
            raise ValueError(f"metric must be one of: {sorted(TRACKED_METRICS)}")
        return v


class AlertRulePatch(BaseModel):
    device_id: str | None = None
    metric: str | None = None
    direction: Direction | None = None
    threshold: float | None = None
    cooldown_seconds: int | None = Field(default=None, ge=60, le=86_400)
    enabled: bool | None = None


@router.get("", response_model=list[AlertRuleRow])
async def list_rules(
    db: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> list[AlertRule]:
    result = await db.execute(
        select(AlertRule).where(AlertRule.user_id == current.id).order_by(AlertRule.id)
    )
    return list(result.scalars().all())


@router.post("", response_model=AlertRuleRow, status_code=status.HTTP_201_CREATED)
async def create_rule(
    body: AlertRuleCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> AlertRule:
    dev = body.device_id.strip() if body.device_id else None
    if dev == "":
        dev = None
    rule = AlertRule(
        user_id=current.id,
        device_id=dev,
        metric=body.metric,
        direction=body.direction,
        threshold=body.threshold,
        cooldown_seconds=body.cooldown_seconds,
        enabled=body.enabled,
    )
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


@router.patch("/{rule_id}", response_model=AlertRuleRow)
async def patch_rule(
    rule_id: int,
    body: AlertRulePatch,
    db: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> AlertRule:
    result = await db.execute(
        select(AlertRule).where(AlertRule.id == rule_id, AlertRule.user_id == current.id)
    )
    rule = result.scalar_one_or_none()
    if rule is None:
        raise HTTPException(status_code=404, detail="Rule not found")
    patch = body.model_dump(exclude_unset=True)
    if "device_id" in patch:
        v = patch["device_id"]
        rule.device_id = v.strip() if isinstance(v, str) and v.strip() else None
    if "metric" in patch:
        m = patch["metric"]
        if m not in TRACKED_METRICS:
            raise HTTPException(status_code=400, detail=f"Unknown metric: {m}")
        rule.metric = m
    if "direction" in patch:
        rule.direction = patch["direction"]
    if "threshold" in patch:
        rule.threshold = patch["threshold"]
    if "cooldown_seconds" in patch:
        rule.cooldown_seconds = patch["cooldown_seconds"]
    if "enabled" in patch:
        rule.enabled = patch["enabled"]
    await db.commit()
    await db.refresh(rule)
    return rule


@router.delete("/{rule_id}", status_code=status.HTTP_200_OK)
async def delete_rule(
    rule_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> dict[str, str]:
    result = await db.execute(
        delete(AlertRule).where(AlertRule.id == rule_id, AlertRule.user_id == current.id)
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Rule not found")
    await db.commit()
    return {"status": "ok"}
