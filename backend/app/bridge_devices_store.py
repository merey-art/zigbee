"""In-memory snapshot of Zigbee2MQTT `bridge/devices` retained payload."""

from __future__ import annotations

import asyncio
import re
from typing import Any

_lock = asyncio.Lock()
_devices: list[dict[str, Any]] = []
# friendly_name (exact Z2M string) -> lowercase ieee
_friendly_to_ieee: dict[str, str] = {}
# ieee -> preferred friendly_name for UI / MQTT aliasing
_ieee_to_friendly: dict[str, str] = {}

IEEE_ADDR_RE = re.compile(r"^0x[0-9a-f]+$", re.IGNORECASE)


def _norm_ieee(raw: str) -> str:
    return re.sub(r"\s+", "", raw.lower())


def _is_ieee_addr(s: str) -> bool:
    return bool(IEEE_ADDR_RE.match(re.sub(r"\s+", "", s)))


async def set_devices_from_bridge(payload: Any) -> None:
    """Replace cached devices when `zigbee2mqtt/bridge/devices` is received."""
    global _devices
    if not isinstance(payload, list):
        return
    async with _lock:
        _devices = list(payload)
        _friendly_to_ieee.clear()
        _ieee_to_friendly.clear()
        for dev in _devices:
            if not isinstance(dev, dict):
                continue
            ieee = dev.get("ieee_address") or dev.get("ieee")
            fn = dev.get("friendly_name")
            if ieee is None or fn is None:
                continue
            ie_s = _norm_ieee(str(ieee))
            fn_s = str(fn).strip()
            if not ie_s or not fn_s:
                continue
            _friendly_to_ieee[fn_s] = ie_s
            _ieee_to_friendly.setdefault(ie_s, fn_s)


async def snapshot_devices() -> list[dict[str, Any]]:
    async with _lock:
        return list(_devices)


async def canonical_device_id(topic_fragment: str) -> str:
    """
    One stable key per physical device.

    - MQTT topics often use friendly_name OR ieee — map friendly → ieee using bridge/devices.
    - Attribute/extra path segments (`Foo/bar`) should pass only the first segment (`Foo`).
    """
    seg = topic_fragment.split("/")[0].strip()
    if not seg:
        return topic_fragment
    compact = re.sub(r"\s+", "", seg)
    async with _lock:
        if _is_ieee_addr(compact):
            return _norm_ieee(compact)
        ieee = _friendly_to_ieee.get(seg) or _friendly_to_ieee.get(compact)
        if ieee:
            return ieee
        return seg


async def aliases_for_readings(device_key: str) -> list[str]:
    """All `sensor_readings.device_id` values that belong to the same device."""
    key = device_key.strip()
    first = key.split("/")[0].strip()
    canon = await canonical_device_id(first)
    async with _lock:
        aliases = {key, first, canon}
        fn = _ieee_to_friendly.get(canon)
        if fn:
            aliases.add(fn)
        for f_name, ie in _friendly_to_ieee.items():
            if ie == canon:
                aliases.add(f_name)
        return list(aliases)


async def friendly_name_for_ieee(ieee: str) -> str | None:
    """Friendly name for bridge rename/remove helpers."""
    ie_norm = _norm_ieee(ieee)
    async with _lock:
        hit = _ieee_to_friendly.get(ie_norm)
        if hit:
            return hit
        for dev in _devices:
            addr = str(dev.get("ieee_address") or dev.get("ieee") or "").strip()
            if not addr:
                continue
            if _norm_ieee(addr) != ie_norm:
                continue
            fn = dev.get("friendly_name")
            if isinstance(fn, str):
                return fn
        return None


async def display_label_for_canonical(canonical_id: str) -> str | None:
    """Human-readable title when ieee is used as canonical id."""
    if not _is_ieee_addr(canonical_id):
        return None
    async with _lock:
        return _ieee_to_friendly.get(_norm_ieee(canonical_id))
