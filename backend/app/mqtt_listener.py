"""
MQTT listener — subscribes to `{mqtt_base_topic}/#` and persists sensor readings.

Known scalar metrics extracted from Zigbee2MQTT payloads:
  temperature, humidity, co2, linkquality, battery, voltage, pressure
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone

import aiomqtt

from app.bridge_devices_store import set_devices_from_bridge
from app.config import settings
from app.database import AsyncSessionLocal
from app.models import SensorReading
from app.websocket import manager

logger = logging.getLogger(__name__)

# Metrics we care about (all others are silently ignored)
TRACKED_METRICS: set[str] = {
    "temperature",
    "humidity",
    "co2",
    "linkquality",
    "battery",
    "voltage",
    "pressure",
}

# Topic suffixes that are not sensor scalar updates (per-device configuration channels).
SKIP_SUFFIXES: tuple[str, ...] = (
    "/availability",
    "/get",
    "/set",
)


def _topic_rest(topic: str, base: str) -> str:
    """Return portion after `{base}/` (matches legacy behaviour)."""
    prefix = f"{base}/"
    if topic.startswith(prefix):
        return topic[len(prefix) :]
    return topic


async def _persist_readings(device_id: str, payload: dict) -> None:
    readings: list[SensorReading] = []
    now = datetime.now(timezone.utc)
    for metric, raw_value in payload.items():
        if metric not in TRACKED_METRICS:
            continue
        try:
            value = float(raw_value)
        except (TypeError, ValueError):
            continue
        readings.append(
            SensorReading(
                device_id=device_id,
                metric=metric,
                value=value,
                recorded_at=now,
            )
        )
    if not readings:
        return
    async with AsyncSessionLocal() as session:
        session.add_all(readings)
        await session.commit()


async def run_mqtt_listener() -> None:
    """Runs forever; reconnects automatically on disconnect."""
    reconnect_delay = 5  # seconds
    base = settings.mqtt_base_topic
    while True:
        try:
            async with aiomqtt.Client(
                hostname=settings.mqtt_host,
                port=settings.mqtt_port,
                identifier="zigbee-dashboard-backend",
            ) as client:
                logger.info(
                    "Connected to MQTT broker %s:%d (topic prefix %s)",
                    settings.mqtt_host,
                    settings.mqtt_port,
                    base,
                )
                reconnect_delay = 5  # reset on successful connect
                await client.subscribe(f"{base}/#")
                async for message in client.messages:
                    topic = str(message.topic)

                    try:
                        payload = json.loads(message.payload)
                    except (json.JSONDecodeError, TypeError):
                        continue

                    if topic == f"{base}/bridge/devices":
                        if isinstance(payload, list):
                            await set_devices_from_bridge(payload)
                        continue

                    if topic == f"{base}/bridge/event":
                        asyncio.create_task(
                            manager.broadcast(
                                {
                                    "type": "bridge_event",
                                    "payload": payload,
                                    "timestamp": datetime.now(timezone.utc).isoformat(),
                                }
                            )
                        )
                        continue

                    if topic.startswith(f"{base}/bridge"):
                        continue

                    if any(topic.endswith(s) for s in SKIP_SUFFIXES):
                        continue

                    if not isinstance(payload, dict):
                        continue

                    device_id = _topic_rest(topic, base)
                    logger.debug("MQTT %s → %s", topic, payload)

                    asyncio.create_task(_persist_readings(device_id, payload))

                    ws_payload = {
                        "device_id": device_id,
                        "topic": topic,
                        "data": {
                            k: v
                            for k, v in payload.items()
                            if k in TRACKED_METRICS
                        },
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    }
                    asyncio.create_task(manager.broadcast(ws_payload))

        except aiomqtt.MqttError as exc:
            logger.warning(
                "MQTT connection error: %s. Reconnecting in %ds…", exc, reconnect_delay
            )
            await asyncio.sleep(reconnect_delay)
            reconnect_delay = min(reconnect_delay * 2, 60)
        except asyncio.CancelledError:
            logger.info("MQTT listener cancelled.")
            break
