"""Publish JSON payloads to Zigbee2MQTT bridge MQTT topics."""

from __future__ import annotations

import json
import logging

import aiomqtt

from app.config import settings

logger = logging.getLogger(__name__)


async def mqtt_publish_json(subpath_after_base: str, payload: dict) -> None:
    """
    Publish to `{mqtt_base_topic}/{subpath_after_base}`.

    Example subpath: `bridge/request/permit_join`
    """
    topic = f"{settings.mqtt_base_topic}/{subpath_after_base}"
    payload_bytes = json.dumps(payload).encode("utf-8")
    try:
        async with aiomqtt.Client(
            hostname=settings.mqtt_host,
            port=settings.mqtt_port,
            identifier="zigbee-dashboard-publish",
        ) as client:
            await client.publish(topic, payload_bytes)
        logger.info("MQTT publish %s", topic)
    except aiomqtt.MqttError as exc:
        logger.warning("MQTT publish failed %s: %s", topic, exc)
        raise
