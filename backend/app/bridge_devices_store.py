"""In-memory snapshot of Zigbee2MQTT `bridge/devices` retained payload."""

from __future__ import annotations

import asyncio
from typing import Any

_lock = asyncio.Lock()
_devices: list[dict[str, Any]] = []


async def set_devices_from_bridge(payload: Any) -> None:
    """Replace cached devices when `zigbee2mqtt/bridge/devices` is received."""
    global _devices
    if not isinstance(payload, list):
        return
    async with _lock:
        _devices = list(payload)


async def snapshot_devices() -> list[dict[str, Any]]:
    async with _lock:
        return list(_devices)


async def friendly_name_for_ieee(ieee: str) -> str | None:
    ieee_norm = ieee.lower().replace(" ", "")
    async with _lock:
        for dev in _devices:
            addr = str(dev.get("ieee_address") or dev.get("ieee") or "").lower()
            if addr == ieee_norm:
                fn = dev.get("friendly_name")
                if isinstance(fn, str):
                    return fn
        return None
