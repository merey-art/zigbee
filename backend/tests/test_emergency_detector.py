from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import asyncio
import pytest

from app.emergency_detector import DetectionResult, DevicePair, EmergencyDetector, EmergencyState, parse_device_pairs


BASE = datetime(2026, 7, 16, 6, 0, tzinfo=timezone.utc)


def test_parse_device_pairs_accepts_explicit_pairs_only():
    pairs = parse_device_pairs("zone-a:temp-1:co2-1,zone-b:temp-2:co2-2")
    assert [(p.zone_id, p.temp_device_id, p.co2_device_id) for p in pairs] == [
        ("zone-a", "temp-1", "co2-1"),
        ("zone-b", "temp-2", "co2-2"),
    ]


def test_parse_device_pairs_ignores_invalid_entries():
    pairs = parse_device_pairs("bad-entry,zone-a:temp-1:co2-1,missing:parts")
    assert [(p.zone_id, p.temp_device_id, p.co2_device_id) for p in pairs] == [
        ("zone-a", "temp-1", "co2-1"),
    ]


def test_per_device_fires_after_sustained_simultaneous_rise():
    detector = EmergencyDetector(
        temp_rate=2.0,
        co2_rate=200.0,
        temp_absolute=35.0,
        sustained_readings=2,
        device_pairs=[],
    )

    first = detector.evaluate_device_payload(
        "ts0601",
        {"temperature": 33.0, "co2": 441.0},
        BASE,
    )
    second = detector.evaluate_device_payload(
        "ts0601",
        {"temperature": 35.1, "co2": 650.0},
        BASE + timedelta(minutes=1),
    )
    third = detector.evaluate_device_payload(
        "ts0601",
        {"temperature": 37.3, "co2": 870.0},
        BASE + timedelta(minutes=2),
    )

    assert first is None
    assert second is None
    assert third is not None
    assert third.status == "active"
    assert third.key == "device:ts0601"
    assert third.consecutive_readings == 2


def test_single_metric_rise_does_not_fire():
    detector = EmergencyDetector(2.0, 200.0, 35.0, 2, [])
    detector.evaluate_device_payload("ts0601", {"temperature": 33.0, "co2": 441.0}, BASE)
    detector.evaluate_device_payload("ts0601", {"temperature": 36.0, "co2": 450.0}, BASE + timedelta(minutes=1))
    result = detector.evaluate_device_payload("ts0601", {"temperature": 39.0, "co2": 455.0}, BASE + timedelta(minutes=2))
    assert result is None


def test_absolute_temperature_floor_blocks_fire():
    detector = EmergencyDetector(2.0, 200.0, 35.0, 2, [])
    detector.evaluate_device_payload("ts0601", {"temperature": 25.0, "co2": 400.0}, BASE)
    detector.evaluate_device_payload("ts0601", {"temperature": 27.5, "co2": 650.0}, BASE + timedelta(minutes=1))
    result = detector.evaluate_device_payload("ts0601", {"temperature": 30.0, "co2": 900.0}, BASE + timedelta(minutes=2))
    assert result is None


def test_condition_clear_resets_for_fresh_alarm():
    detector = EmergencyDetector(2.0, 200.0, 35.0, 2, [])
    detector.evaluate_device_payload("ts0601", {"temperature": 33.0, "co2": 441.0}, BASE)
    detector.evaluate_device_payload("ts0601", {"temperature": 35.1, "co2": 650.0}, BASE + timedelta(minutes=1))
    active = detector.evaluate_device_payload("ts0601", {"temperature": 37.3, "co2": 870.0}, BASE + timedelta(minutes=2))
    clear = detector.evaluate_device_payload("ts0601", {"temperature": 37.4, "co2": 875.0}, BASE + timedelta(minutes=3))
    detector.acknowledge("device:ts0601")
    fresh = detector.evaluate_device_payload("ts0601", {"temperature": 40.0, "co2": 1100.0}, BASE + timedelta(minutes=4))

    assert active is not None and active.status == "active"
    assert clear is not None and clear.status == "cleared"
    assert fresh is None


def test_pair_fires_after_split_sensor_sustained_rise():
    pairs = [DevicePair("zone-a", "temp-1", "co2-1")]
    detector = EmergencyDetector(2.0, 200.0, 35.0, 2, pairs)

    assert detector.evaluate_pairs("temp-1", {"temperature": 33.0}, BASE) == []
    assert detector.evaluate_pairs("co2-1", {"co2": 441.0}, BASE) == []
    assert detector.evaluate_pairs("temp-1", {"temperature": 35.1}, BASE + timedelta(minutes=1)) == []
    assert detector.evaluate_pairs("co2-1", {"co2": 650.0}, BASE + timedelta(minutes=1)) == []
    assert detector.evaluate_pairs("temp-1", {"temperature": 37.3}, BASE + timedelta(minutes=2)) == []
    results = detector.evaluate_pairs("co2-1", {"co2": 870.0}, BASE + timedelta(minutes=2))

    assert len(results) == 1
    assert results[0].status == "active"
    assert results[0].key == "pair:zone-a:temp-1:co2-1"
    assert results[0].consecutive_readings == 2


def test_pair_retriggers_after_cleared_and_sustained_readings():
    pairs = [DevicePair("zone-a", "temp-1", "co2-1")]
    detector = EmergencyDetector(2.0, 200.0, 35.0, 2, pairs)

    detector.evaluate_pairs("temp-1", {"temperature": 33.0}, BASE)
    detector.evaluate_pairs("co2-1", {"co2": 441.0}, BASE)
    detector.evaluate_pairs("temp-1", {"temperature": 35.1}, BASE + timedelta(minutes=1))
    active = detector.evaluate_pairs("co2-1", {"co2": 650.0}, BASE + timedelta(minutes=1))
    detector.evaluate_pairs("temp-1", {"temperature": 37.3}, BASE + timedelta(minutes=2))
    active = detector.evaluate_pairs("co2-1", {"co2": 870.0}, BASE + timedelta(minutes=2))
    assert len(active) == 1 and active[0].status == "active"

    detector.evaluate_pairs("temp-1", {"temperature": 37.4}, BASE + timedelta(minutes=3))
    cleared = detector.evaluate_pairs("co2-1", {"co2": 875.0}, BASE + timedelta(minutes=3))
    assert len(cleared) == 1 and cleared[0].status == "cleared"
    detector.acknowledge("pair:zone-a:temp-1:co2-1")

    detector.evaluate_pairs("temp-1", {"temperature": 39.5}, BASE + timedelta(minutes=4))
    assert detector.evaluate_pairs("co2-1", {"co2": 1095.0}, BASE + timedelta(minutes=4)) == []
    detector.evaluate_pairs("temp-1", {"temperature": 41.7}, BASE + timedelta(minutes=5))
    refired = detector.evaluate_pairs("co2-1", {"co2": 1320.0}, BASE + timedelta(minutes=5))

    assert len(refired) == 1
    assert refired[0].status == "active"
    assert refired[0].consecutive_readings == 2


def test_explicit_pair_fires_only_for_configured_devices():
    pairs = [DevicePair("zone-a", "temp-1", "co2-1")]
    detector = EmergencyDetector(2.0, 200.0, 35.0, 2, pairs)

    assert detector.evaluate_pairs("temp-2", {"temperature": 40.0}, BASE) == []
    assert detector.evaluate_pairs("co2-2", {"co2": 900.0}, BASE) == []
    assert detector.evaluate_pairs("temp-2", {"temperature": 43.0}, BASE + timedelta(minutes=1)) == []
    assert detector.evaluate_pairs("co2-2", {"co2": 1200.0}, BASE + timedelta(minutes=1)) == []

    detector.evaluate_pairs("temp-1", {"temperature": 33.0}, BASE)
    detector.evaluate_pairs("co2-1", {"co2": 441.0}, BASE)
    detector.evaluate_pairs("temp-1", {"temperature": 35.1}, BASE + timedelta(minutes=1))
    assert detector.evaluate_pairs("co2-1", {"co2": 650.0}, BASE + timedelta(minutes=1)) == []
    detector.evaluate_pairs("temp-1", {"temperature": 37.3}, BASE + timedelta(minutes=2))
    results = detector.evaluate_pairs("co2-1", {"co2": 870.0}, BASE + timedelta(minutes=2))

    assert len(results) == 1
    assert results[0].key == "pair:zone-a:temp-1:co2-1"


def test_active_repeated_readings_return_update_not_new_active():
    detector = EmergencyDetector(2.0, 200.0, 35.0, 2, [])
    detector.evaluate_device_payload("ts0601", {"temperature": 33.0, "co2": 441.0}, BASE)
    detector.evaluate_device_payload("ts0601", {"temperature": 35.1, "co2": 650.0}, BASE + timedelta(minutes=1))
    active = detector.evaluate_device_payload("ts0601", {"temperature": 37.3, "co2": 870.0}, BASE + timedelta(minutes=2))
    update = detector.evaluate_device_payload("ts0601", {"temperature": 39.5, "co2": 1100.0}, BASE + timedelta(minutes=3))

    assert active is not None and active.status == "active"
    assert update is not None and update.status == "update"


def test_hydrated_active_state_clears_on_false_reading():
    detector = EmergencyDetector(2.0, 200.0, 35.0, 2, [])
    detector.evaluate_device_payload("ts0601", {"temperature": 33.0, "co2": 441.0}, BASE)
    detector.evaluate_device_payload("ts0601", {"temperature": 35.1, "co2": 650.0}, BASE + timedelta(minutes=1))
    detector.hydrate_key_state("device:ts0601", status="active", event_id=42)

    result = detector.evaluate_device_payload(
        "ts0601",
        {"temperature": 25.0, "co2": 400.0},
        BASE + timedelta(minutes=2),
    )

    assert result is not None
    assert result.status == "cleared"


def test_hydrated_acknowledged_state_clears_on_false_reading():
    detector = EmergencyDetector(2.0, 200.0, 35.0, 2, [])
    detector.evaluate_device_payload("ts0601", {"temperature": 33.0, "co2": 441.0}, BASE)
    detector.evaluate_device_payload("ts0601", {"temperature": 35.1, "co2": 650.0}, BASE + timedelta(minutes=1))
    detector.hydrate_key_state("device:ts0601", status="acknowledged", event_id=42)

    result = detector.evaluate_device_payload(
        "ts0601",
        {"temperature": 25.0, "co2": 400.0},
        BASE + timedelta(minutes=2),
    )

    assert result is not None
    assert result.status == "cleared"


def test_hydrated_active_with_baseline_clears_on_first_false_after_restart():
    detector = EmergencyDetector(2.0, 200.0, 35.0, 2, [])
    recorded_at = BASE + timedelta(minutes=2)
    detector.hydrate_key_state("device:ts0601", status="active", event_id=42)
    detector.hydrate_reading_baseline(
        key="device:ts0601",
        device_id="ts0601",
        temperature=37.3,
        co2=870.0,
        recorded_at=recorded_at,
    )

    result = detector.evaluate_device_payload(
        "ts0601",
        {"temperature": 25.0, "co2": 400.0},
        BASE + timedelta(minutes=3),
    )

    assert result is not None
    assert result.status == "cleared"


def test_hydrated_pair_with_baseline_clears_on_first_false_after_restart():
    pairs = [DevicePair("zone-a", "temp-1", "co2-1")]
    detector = EmergencyDetector(2.0, 200.0, 35.0, 2, pairs)
    key = "pair:zone-a:temp-1:co2-1"
    recorded_at = BASE + timedelta(minutes=2)
    detector.hydrate_key_state(key, status="active", event_id=7)
    detector.hydrate_reading_baseline(
        key=key,
        device_id=None,
        temperature=37.3,
        co2=870.0,
        recorded_at=recorded_at,
    )

    detector.evaluate_pairs("temp-1", {"temperature": 25.0}, BASE + timedelta(minutes=3))
    results = detector.evaluate_pairs("co2-1", {"co2": 400.0}, BASE + timedelta(minutes=3))

    assert len(results) == 1
    assert results[0].status == "cleared"


def test_acknowledged_repeated_readings_return_update_not_new_active():
    detector = EmergencyDetector(2.0, 200.0, 35.0, 2, [])
    detector.evaluate_device_payload("ts0601", {"temperature": 33.0, "co2": 441.0}, BASE)
    detector.evaluate_device_payload("ts0601", {"temperature": 35.1, "co2": 650.0}, BASE + timedelta(minutes=1))
    active = detector.evaluate_device_payload("ts0601", {"temperature": 37.3, "co2": 870.0}, BASE + timedelta(minutes=2))
    assert active is not None

    detector.acknowledge("device:ts0601", event_id=10)
    update = detector.evaluate_device_payload("ts0601", {"temperature": 39.5, "co2": 1100.0}, BASE + timedelta(minutes=3))

    assert update is not None
    assert update.status == "update"


def _active_detection_result() -> DetectionResult:
    return DetectionResult(
        key="device:ts0601",
        status="active",
        device_id="ts0601",
        temp_device_id=None,
        co2_device_id=None,
        zone_id=None,
        temperature=37.3,
        co2=870.0,
        temperature_rate=2.2,
        co2_rate=219.0,
        consecutive_readings=2,
        recorded_at=BASE + timedelta(minutes=2),
    )


def _sample_emergency_event(**overrides):
    from app.models import EmergencyEvent

    defaults = {
        "id": 42,
        "key": "device:ts0601",
        "status": "active",
        "device_id": "ts0601",
        "temp_device_id": None,
        "co2_device_id": None,
        "zone_id": None,
        "temperature": 37.3,
        "co2": 870.0,
        "temperature_rate": 2.2,
        "co2_rate": 219.0,
        "threshold_temp_rate": 2.0,
        "threshold_co2_rate": 200.0,
        "threshold_temp_absolute": 35.0,
        "threshold_sustained_readings": 2,
        "consecutive_readings": 2,
        "started_at": BASE + timedelta(minutes=2),
        "last_seen_at": BASE + timedelta(minutes=2),
    }
    defaults.update(overrides)
    return EmergencyEvent(**defaults)


@pytest.mark.asyncio
async def test_handle_detection_active_existing_broadcasts_without_telegram(monkeypatch):
    import app.emergency_detector as ed

    existing = _sample_emergency_event()
    broadcast_calls: list[dict[str, object]] = []
    telegram_mock = AsyncMock()

    async def fake_create(result, *, create_if_missing):
        assert create_if_missing is True
        return existing, False

    async def fake_broadcast(payload):
        broadcast_calls.append(payload)

    monkeypatch.setattr(ed, "_create_or_update_active_event", fake_create)
    monkeypatch.setattr(ed, "_send_emergency_telegram", telegram_mock)
    monkeypatch.setattr(ed.manager, "broadcast", fake_broadcast)

    await ed.handle_detection_result(_active_detection_result())

    telegram_mock.assert_not_called()
    assert len(broadcast_calls) == 1
    assert broadcast_calls[0]["event_id"] == 42
    assert broadcast_calls[0]["status"] == "active"


@pytest.mark.asyncio
async def test_handle_detection_active_created_sends_telegram_and_broadcast(monkeypatch):
    import app.emergency_detector as ed

    existing = _sample_emergency_event()
    broadcast_calls: list[dict[str, object]] = []
    telegram_calls: list[tuple[object, DetectionResult]] = []

    async def fake_create(result, *, create_if_missing):
        assert create_if_missing is True
        return existing, True

    async def fake_telegram(event, result):
        telegram_calls.append((event, result))

    async def fake_broadcast(payload):
        broadcast_calls.append(payload)

    monkeypatch.setattr(ed, "_create_or_update_active_event", fake_create)
    monkeypatch.setattr(ed, "_send_emergency_telegram", fake_telegram)
    monkeypatch.setattr(ed.manager, "broadcast", fake_broadcast)

    detection = _active_detection_result()
    await ed.handle_detection_result(detection)

    assert len(telegram_calls) == 1
    assert telegram_calls[0][0] is existing
    assert telegram_calls[0][1] is detection
    assert len(broadcast_calls) == 1
    assert broadcast_calls[0]["event_id"] == 42
    assert broadcast_calls[0]["status"] == "active"


@pytest.mark.asyncio
async def test_handle_detection_created_broadcasts_even_if_telegram_fails(monkeypatch):
    import app.emergency_detector as ed

    existing = _sample_emergency_event()
    broadcast_calls: list[dict[str, object]] = []

    async def fake_create(result, *, create_if_missing):
        return existing, True

    async def failing_telegram(event, result):
        raise RuntimeError("telegram down")

    async def fake_broadcast(payload):
        broadcast_calls.append(payload)

    monkeypatch.setattr(ed, "_create_or_update_active_event", fake_create)
    monkeypatch.setattr(ed, "_send_emergency_telegram", failing_telegram)
    monkeypatch.setattr(ed.manager, "broadcast", fake_broadcast)

    await ed.handle_detection_result(_active_detection_result())

    assert len(broadcast_calls) == 1
    assert broadcast_calls[0]["event_id"] == 42


@pytest.mark.asyncio
async def test_handle_detection_skips_stale_active_after_clear(monkeypatch):
    import app.emergency_detector as ed

    create_mock = AsyncMock()
    broadcast_mock = AsyncMock()
    telegram_mock = AsyncMock()

    monkeypatch.setattr(ed, "_create_or_update_active_event", create_mock)
    monkeypatch.setattr(ed.manager, "broadcast", broadcast_mock)
    monkeypatch.setattr(ed, "_send_emergency_telegram", telegram_mock)

    ed.detector._states["device:ts0601"] = EmergencyState(
        status="cleared",
        last_cleared_at=BASE + timedelta(minutes=3),
    )

    await ed.handle_detection_result(_active_detection_result())

    create_mock.assert_not_called()
    broadcast_mock.assert_not_called()
    telegram_mock.assert_not_called()


@pytest.mark.asyncio
async def test_handle_detection_clear_then_stale_active_under_lock(monkeypatch):
    import app.emergency_detector as ed

    cleared_event = _sample_emergency_event(status="cleared", cleared_at=BASE + timedelta(minutes=3))
    create_calls: list[bool] = []
    broadcast_statuses: list[str] = []

    async def fake_create(result, *, create_if_missing):
        create_calls.append(create_if_missing)
        if create_if_missing:
            return _sample_emergency_event(), True
        return None, False

    async def fake_clear(result):
        ed.detector._states[result.key] = EmergencyState(
            status="cleared",
            last_cleared_at=result.recorded_at,
        )
        return cleared_event

    async def fake_broadcast(payload):
        broadcast_statuses.append(str(payload["status"]))

    monkeypatch.setattr(ed, "_create_or_update_active_event", fake_create)
    monkeypatch.setattr(ed, "_clear_active_event", fake_clear)
    monkeypatch.setattr(ed, "_send_emergency_telegram", AsyncMock())
    monkeypatch.setattr(ed.manager, "broadcast", fake_broadcast)

    clear_result = DetectionResult(
        key="device:ts0601",
        status="cleared",
        device_id="ts0601",
        temp_device_id=None,
        co2_device_id=None,
        zone_id=None,
        temperature=37.4,
        co2=875.0,
        temperature_rate=0.1,
        co2_rate=5.0,
        consecutive_readings=0,
        recorded_at=BASE + timedelta(minutes=3),
    )
    active_result = _active_detection_result()

    await asyncio.gather(
        ed.handle_detection_result(active_result),
        ed.handle_detection_result(clear_result),
    )

    assert create_calls == []
    assert broadcast_statuses == ["cleared"]


@pytest.mark.asyncio
async def test_handle_detection_clear_not_blocked_by_slow_telegram(monkeypatch):
    import app.emergency_detector as ed

    ed.detector._states.pop("device:ts0601", None)
    telegram_started = asyncio.Event()
    telegram_gate = asyncio.Event()
    clear_done = asyncio.Event()

    async def slow_telegram(event, result):
        telegram_started.set()
        await telegram_gate.wait()

    async def fake_create(result, *, create_if_missing):
        return _sample_emergency_event(), True

    async def fake_clear(result):
        clear_done.set()
        return _sample_emergency_event(status="cleared", cleared_at=result.recorded_at)

    broadcast_statuses: list[str] = []

    async def fake_broadcast(payload):
        broadcast_statuses.append(str(payload["status"]))

    monkeypatch.setattr(ed, "_create_or_update_active_event", fake_create)
    monkeypatch.setattr(ed, "_clear_active_event", fake_clear)
    monkeypatch.setattr(ed, "_send_emergency_telegram", slow_telegram)
    monkeypatch.setattr(ed.manager, "broadcast", fake_broadcast)

    clear_result = DetectionResult(
        key="device:ts0601",
        status="cleared",
        device_id="ts0601",
        temp_device_id=None,
        co2_device_id=None,
        zone_id=None,
        temperature=37.4,
        co2=875.0,
        temperature_rate=0.1,
        co2_rate=5.0,
        consecutive_readings=0,
        recorded_at=BASE + timedelta(minutes=3),
    )

    active_task = asyncio.create_task(ed.handle_detection_result(_active_detection_result()))
    await asyncio.wait_for(telegram_started.wait(), timeout=1.0)

    clear_task = asyncio.create_task(ed.handle_detection_result(clear_result))
    await asyncio.wait_for(clear_done.wait(), timeout=1.0)

    telegram_gate.set()
    await active_task
    await clear_task

    assert broadcast_statuses == ["active", "cleared"]


@pytest.mark.asyncio
async def test_acknowledge_emergency_event_already_cleared_is_noop(monkeypatch):
    import app.emergency_detector as ed

    cleared_at = BASE + timedelta(minutes=3)
    event = _sample_emergency_event(status="cleared", cleared_at=cleared_at)

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, model, event_id):
            assert event_id == 42
            return event

        async def commit(self):
            raise AssertionError("commit should not run for already cleared")

        async def refresh(self, obj):
            raise AssertionError("refresh should not run for already cleared")

    monkeypatch.setattr(ed, "AsyncSessionLocal", lambda: FakeSession())
    broadcast_mock = AsyncMock()
    monkeypatch.setattr(ed.manager, "broadcast", broadcast_mock)
    ack_mock = MagicMock()
    monkeypatch.setattr(ed.detector, "acknowledge", ack_mock)

    returned = await ed.acknowledge_emergency_event(42, user_id=99)

    assert returned.status == "cleared"
    assert returned.cleared_at == cleared_at
    broadcast_mock.assert_not_called()
    ack_mock.assert_not_called()


@pytest.mark.asyncio
async def test_ack_already_acknowledged_is_noop(monkeypatch):
    from app.emergency_routes import ack_emergency
    from app.models import User

    acknowledged_at = datetime(2026, 7, 16, 10, 0, tzinfo=timezone.utc)
    event = _sample_emergency_event(
        status="acknowledged",
        acknowledged_by=5,
        acknowledged_at=acknowledged_at,
    )

    async def fake_ack(event_id, user_id):
        assert event_id == 1
        assert user_id == 99
        return event

    monkeypatch.setattr("app.emergency_routes.acknowledge_emergency_event", fake_ack)

    user = User(id=99, email="u@test", hashed_password="x")
    returned = await ack_emergency(1, user)

    assert returned is event
    assert returned.acknowledged_at == acknowledged_at
    assert returned.acknowledged_by == 5


@pytest.mark.asyncio
async def test_evaluate_emergency_results_wires_detector_and_schedules_handlers(monkeypatch):
    import app.mqtt_listener as ml

    direct = _active_detection_result()
    pair_result = DetectionResult(
        key="pair:zone-a:temp-1:co2-1",
        status="active",
        device_id=None,
        temp_device_id="temp-1",
        co2_device_id="co2-1",
        zone_id="zone-a",
        temperature=37.3,
        co2=870.0,
        temperature_rate=2.2,
        co2_rate=219.0,
        consecutive_readings=2,
        recorded_at=BASE + timedelta(minutes=2),
    )

    evaluate_device = MagicMock(return_value=direct)
    evaluate_pairs = MagicMock(return_value=[pair_result])
    monkeypatch.setattr(ml.detector, "evaluate_device_payload", evaluate_device)
    monkeypatch.setattr(ml.detector, "evaluate_pairs", evaluate_pairs)

    handled: list[DetectionResult] = []

    async def fake_handle(result):
        handled.append(result)

    monkeypatch.setattr(ml, "handle_detection_result", fake_handle)

    scheduled_coros: list = []

    def fake_create_task(coro):
        scheduled_coros.append(coro)
        return MagicMock()

    monkeypatch.setattr(ml.asyncio, "create_task", fake_create_task)

    values = {"temperature": 37.3, "co2": 870.0}
    now = BASE + timedelta(minutes=2)
    results = ml._evaluate_emergency_results("ts0601", values, now)

    evaluate_device.assert_called_once_with("ts0601", values, now)
    evaluate_pairs.assert_called_once_with("ts0601", values, now)
    assert results == [direct, pair_result]
    assert len(scheduled_coros) == 2
    for coro in scheduled_coros:
        await coro
    assert handled == [direct, pair_result]


@pytest.mark.asyncio
async def test_evaluate_emergency_results_skips_scheduling_when_no_hits(monkeypatch):
    import app.mqtt_listener as ml

    evaluate_device = MagicMock(return_value=None)
    evaluate_pairs = MagicMock(return_value=[])
    monkeypatch.setattr(ml.detector, "evaluate_device_payload", evaluate_device)
    monkeypatch.setattr(ml.detector, "evaluate_pairs", evaluate_pairs)

    scheduled_coros: list = []

    def fake_create_task(coro):
        scheduled_coros.append(coro)
        return MagicMock()

    monkeypatch.setattr(ml.asyncio, "create_task", fake_create_task)

    values = {"temperature": 25.0, "co2": 400.0}
    results = ml._evaluate_emergency_results("ts0601", values, BASE)

    assert results == []
    assert scheduled_coros == []
