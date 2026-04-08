"""
MQTT listener — subscribes to zigbee2mqtt/# and persists sensor readings.

Known scalar metrics extracted from Zigbee2MQTT payloads:
  temperature, humidity, co2, linkquality, battery, voltage, pressure
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone

import aiomqtt

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

# Topics published by Zigbee2MQTT that carry bridge/coordinator status,
# not sensor data — skip them.
SKIP_SUFFIXES: tuple[str, ...] = (
    "/availability",
    "/get",
    "/set",
    "zigbee2mqtt/bridge",
)


def _topic_to_device_id(topic: str) -> str:
    """Strip the base prefix and return the device friendly name."""
    # topic format:  zigbee2mqtt/<friendly_name>[/sub-topic]
    parts = topic.split("/", 1)
    return parts[1] if len(parts) > 1 else topic


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
    while True:
        try:
            async with aiomqtt.Client(
                hostname=settings.mqtt_host,
                port=settings.mqtt_port,
                identifier="zigbee-dashboard-backend",
            ) as client:
                logger.info(
                    "Connected to MQTT broker %s:%d",
                    settings.mqtt_host,
                    settings.mqtt_port,
                )
                reconnect_delay = 5  # reset on successful connect
                await client.subscribe("zigbee2mqtt/#")
                async for message in client.messages:
                    topic = str(message.topic)

                    # Skip non-sensor topics
                    if any(topic.startswith(s) or topic.endswith(s) for s in SKIP_SUFFIXES):
                        continue

                    try:
                        payload = json.loads(message.payload)
                    except (json.JSONDecodeError, TypeError):
                        continue

                    if not isinstance(payload, dict):
                        continue

                    device_id = _topic_to_device_id(topic)
                    logger.debug("MQTT %s → %s", topic, payload)

                    # Persist to DB (fire-and-forget, don't block the listener)
                    asyncio.create_task(_persist_readings(device_id, payload))

                    # Broadcast to all WebSocket clients
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
