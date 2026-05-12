"""
Zigbee2MQTT bridge integration.

The official frontend exposes WebSocket at `/api`; writes use the same MQTT topics
that WS wraps (`bridge/request/...`). Device list comes from retained `bridge/devices`.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.auth_deps import get_current_user
from app.bridge_devices_store import friendly_name_for_ieee, snapshot_devices
from app.models import User
from app.mqtt_publish import mqtt_publish_json

router = APIRouter(prefix="/bridge", tags=["bridge"])


class PermitJoinBody(BaseModel):
    time: int = Field(default=254, ge=0, le=254)


class RenameBody(BaseModel):
    friendly_name: str = Field(min_length=1, max_length=128)


def _extract_battery(dev: dict[str, Any]) -> float | None:
    """Best-effort battery % from a bridge/devices element."""
    v = dev.get("battery")
    if isinstance(v, (int, float)):
        return float(v)
    definition = dev.get("definition")
    if isinstance(definition, dict):
        exp = definition.get("exposes")
        if isinstance(exp, list):
            for item in exp:
                if isinstance(item, dict) and item.get("name") == "battery":
                    # sometimes nested features
                    props = item.get("property") or item.get("value")
                    if isinstance(props, (int, float)):
                        return float(props)
    return None


def _summarize(dev: dict[str, Any]) -> dict[str, Any]:
    ieee = dev.get("ieee_address") or dev.get("ieee")
    name = dev.get("friendly_name") or ieee
    last_seen = dev.get("last_seen")
    if hasattr(last_seen, "isoformat"):
        last_seen = last_seen.isoformat()
    return {
        "friendly_name": name,
        "ieee_address": ieee,
        "last_seen": last_seen,
        "battery": _extract_battery(dev),
    }


@router.get("/devices")
async def list_bridge_devices(
    _: Annotated[User, Depends(get_current_user)],
) -> list[dict[str, Any]]:
    devices = await snapshot_devices()
    return [_summarize(d) for d in devices if isinstance(d, dict)]


@router.post("/permit_join", status_code=status.HTTP_200_OK)
async def permit_join(
    body: PermitJoinBody,
    _: Annotated[User, Depends(get_current_user)],
) -> dict[str, str]:
    await mqtt_publish_json("bridge/request/permit_join", {"time": body.time})
    return {"status": "ok"}


@router.patch("/device/{ieee}", status_code=status.HTTP_200_OK)
async def rename_device(
    ieee: str,
    body: RenameBody,
    _: Annotated[User, Depends(get_current_user)],
) -> dict[str, str]:
    old = await friendly_name_for_ieee(ieee)
    if old is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Unknown IEEE address (wait for bridge/devices or check pairing)",
        )
    await mqtt_publish_json(
        "bridge/request/device/rename",
        {"from": old, "to": body.friendly_name.strip()},
    )
    return {"status": "ok"}


@router.delete("/device/{ieee}", status_code=status.HTTP_200_OK)
async def remove_device(
    ieee: str,
    _: Annotated[User, Depends(get_current_user)],
) -> dict[str, str]:
    await mqtt_publish_json(
        "bridge/request/device/remove",
        {"id": ieee, "force": False},
    )
    return {"status": "ok"}
