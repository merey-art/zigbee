"""Scalar sensor fields persisted from Zigbee2MQTT payloads."""

TRACKED_METRICS: frozenset[str] = frozenset(
    {
        "temperature",
        "humidity",
        "co2",
        "linkquality",
        "battery",
        "voltage",
        "pressure",
    }
)
