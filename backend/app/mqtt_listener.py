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

from app.alert_notifier import notify_metric_alerts
from app.emergency_detector import detector, handle_detection_result
from app.bridge_devices_store import canonical_device_id, set_devices_from_bridge
from app.config import settings
from app.database import AsyncSessionLocal
from app.models import SensorReading
from app.tracked_metrics import TRACKED_METRICS
from app.websocket import manager

logger = logging.getLogger(__name__)

# Topic suffixes that are not sensor scalar updates (per-device configuration channels).
SKIP_SUFFIXES: tuple[str, ...] = (
    "/availability",
    "/get",
    "/set",
)


def _evaluate_emergency_results(
    device_id: str,
    values: dict[str, float],
    now: datetime,
) -> list:
    """Run emergency detector rules and schedule handle_detection_result tasks."""
    emergency_results = []
    direct = detector.evaluate_device_payload(device_id, values, now)
    if direct is not None:
        emergency_results.append(direct)
    emergency_results.extend(detector.evaluate_pairs(device_id, values, now))
    for result in emergency_results:
        asyncio.create_task(handle_detection_result(result))
    return emergency_results


def _topic_rest(topic: str, base: str) -> str:
    """Return portion after `{base}/` (matches legacy behaviour)."""
    prefix = f"{base}/"
    if topic.startswith(prefix):
        return topic[len(prefix) :]
    return topic


async def _persist_readings(device_id: str, payload: dict) -> None:
    readings: list[SensorReading] = []
    committed: list[tuple[str, float]] = []
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
        committed.append((metric, value))
    if not readings:
        return
    async with AsyncSessionLocal() as session:
        session.add_all(readings)
        await session.commit()
    for metric, value in committed:
        asyncio.create_task(notify_metric_alerts(device_id, metric, value))
    values = {metric: value for metric, value in committed}
    _evaluate_emergency_results(device_id, values, now)


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

                    first_seg = _topic_rest(topic, base).split("/")[0].strip()
                    device_id = await canonical_device_id(first_seg)
                    logger.debug("MQTT %s → canonical=%s %s", topic, device_id, payload)

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
