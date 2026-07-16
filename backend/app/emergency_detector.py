from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.bridge_devices_store import display_label_for_canonical
from app.config import settings
from app.database import AsyncSessionLocal
from app.models import EmergencyEvent, User
from app.telegram_service import send_telegram_message
from app.websocket import manager

logger = logging.getLogger(__name__)

ACTIVE_STATUSES = {"active", "acknowledged"}


class EmergencyEventNotFound(Exception):
    pass


@dataclass(frozen=True)
class DevicePair:
    zone_id: str
    temp_device_id: str
    co2_device_id: str


@dataclass
class ReadingPoint:
    temperature: float | None = None
    co2: float | None = None
    recorded_at: datetime | None = None
    temp_recorded_at: datetime | None = None
    co2_recorded_at: datetime | None = None


@dataclass
class EmergencyState:
    status: str = "normal"
    consecutive_readings: int = 0
    event_id: int | None = None
    last_cleared_at: datetime | None = None


@dataclass(frozen=True)
class DetectionResult:
    key: str
    status: str
    device_id: str | None
    temp_device_id: str | None
    co2_device_id: str | None
    zone_id: str | None
    temperature: float
    co2: float
    temperature_rate: float
    co2_rate: float
    consecutive_readings: int
    recorded_at: datetime


def parse_device_pairs(raw: str) -> list[DevicePair]:
    pairs: list[DevicePair] = []
    for chunk in (raw or "").split(","):
        text = chunk.strip()
        if not text:
            continue
        parts = [part.strip() for part in text.split(":")]
        if len(parts) != 3 or not all(parts):
            logger.warning("Ignoring invalid EMERGENCY_DEVICE_PAIRS entry: %s", text)
            continue
        pairs.append(DevicePair(zone_id=parts[0], temp_device_id=parts[1], co2_device_id=parts[2]))
    return pairs


def _rate_per_min(previous_value: float, current_value: float, previous_at: datetime, current_at: datetime) -> float:
    seconds = (current_at - previous_at).total_seconds()
    if seconds <= 0:
        return 0.0
    return (current_value - previous_value) / (seconds / 60.0)


class EmergencyDetector:
    def __init__(
        self,
        temp_rate: float,
        co2_rate: float,
        temp_absolute: float,
        sustained_readings: int,
        device_pairs: list[DevicePair],
    ) -> None:
        self.temp_rate = temp_rate
        self.co2_rate = co2_rate
        self.temp_absolute = temp_absolute
        self.sustained_readings = max(1, sustained_readings)
        self.device_pairs = device_pairs
        self._last_by_device: dict[str, ReadingPoint] = {}
        self._pair_values: dict[str, ReadingPoint] = {}
        self._states: dict[str, EmergencyState] = {}

    @classmethod
    def from_settings(cls) -> "EmergencyDetector":
        return cls(
            temp_rate=settings.emergency_temp_rate,
            co2_rate=settings.emergency_co2_rate,
            temp_absolute=settings.emergency_temp_absolute,
            sustained_readings=settings.emergency_sustained_readings,
            device_pairs=parse_device_pairs(settings.emergency_device_pairs),
        )

    def get_key_state(self, key: str) -> EmergencyState:
        return self._states.get(key, EmergencyState())

    def acknowledge(self, key: str, event_id: int | None = None) -> None:
        state = self._states.setdefault(key, EmergencyState())
        if event_id is not None:
            state.event_id = event_id
        if state.status in ACTIVE_STATUSES:
            state.status = "acknowledged"

    def hydrate_key_state(self, key: str, *, status: str, event_id: int) -> None:
        state = self._states.setdefault(key, EmergencyState())
        state.status = status
        state.event_id = event_id
        if status in ACTIVE_STATUSES:
            state.consecutive_readings = self.sustained_readings

    def hydrate_reading_baseline(
        self,
        *,
        key: str,
        device_id: str | None,
        temperature: float,
        co2: float,
        recorded_at: datetime,
    ) -> None:
        point = ReadingPoint(
            temperature=temperature,
            co2=co2,
            recorded_at=recorded_at,
            temp_recorded_at=recorded_at,
            co2_recorded_at=recorded_at,
        )
        if key.startswith("device:") and device_id:
            self._last_by_device[device_id] = point
            return
        if key.startswith("pair:"):
            self._last_by_device[key] = ReadingPoint(
                temperature=temperature,
                co2=co2,
                temp_recorded_at=recorded_at,
                co2_recorded_at=recorded_at,
                recorded_at=recorded_at,
            )
            self._pair_values[key] = ReadingPoint(
                temperature=temperature,
                co2=co2,
                temp_recorded_at=recorded_at,
                co2_recorded_at=recorded_at,
                recorded_at=recorded_at,
            )

    def evaluate_device_payload(
        self,
        device_id: str,
        values: dict[str, float],
        recorded_at: datetime | None = None,
    ) -> DetectionResult | None:
        if "temperature" not in values or "co2" not in values:
            return None
        now = recorded_at or datetime.now(timezone.utc)
        current = ReadingPoint(temperature=float(values["temperature"]), co2=float(values["co2"]), recorded_at=now)
        previous = self._last_by_device.get(device_id)
        self._last_by_device[device_id] = current
        if previous is None or previous.temperature is None or previous.co2 is None or previous.recorded_at is None:
            return None
        return self._evaluate(
            key=f"device:{device_id}",
            device_id=device_id,
            temp_device_id=None,
            co2_device_id=None,
            zone_id=None,
            previous=previous,
            current=current,
        )

    def _pair_key(self, pair: DevicePair) -> str:
        return f"pair:{pair.zone_id}:{pair.temp_device_id}:{pair.co2_device_id}"

    def _pair_snapshot(self, point: ReadingPoint) -> ReadingPoint | None:
        if (
            point.temperature is None
            or point.co2 is None
            or point.temp_recorded_at is None
            or point.co2_recorded_at is None
        ):
            return None
        return ReadingPoint(
            temperature=point.temperature,
            co2=point.co2,
            temp_recorded_at=point.temp_recorded_at,
            co2_recorded_at=point.co2_recorded_at,
            recorded_at=max(point.temp_recorded_at, point.co2_recorded_at),
        )

    def evaluate_pairs(
        self,
        device_id: str,
        values: dict[str, float],
        recorded_at: datetime | None = None,
    ) -> list[DetectionResult]:
        now = recorded_at or datetime.now(timezone.utc)
        for pair in self.device_pairs:
            key = self._pair_key(pair)
            if device_id == pair.temp_device_id and "temperature" in values:
                point = self._pair_values.setdefault(key, ReadingPoint())
                point.temperature = float(values["temperature"])
                point.temp_recorded_at = now
            if device_id == pair.co2_device_id and "co2" in values:
                point = self._pair_values.setdefault(key, ReadingPoint())
                point.co2 = float(values["co2"])
                point.co2_recorded_at = now

        results: list[DetectionResult] = []
        for pair in self.device_pairs:
            key = self._pair_key(pair)
            current = self._pair_snapshot(self._pair_values.get(key, ReadingPoint()))
            if current is None:
                continue
            previous = self._last_by_device.get(key)
            if previous is None:
                self._last_by_device[key] = ReadingPoint(
                    temperature=current.temperature,
                    co2=current.co2,
                    temp_recorded_at=current.temp_recorded_at,
                    co2_recorded_at=current.co2_recorded_at,
                    recorded_at=current.recorded_at,
                )
                continue
            if previous.temperature == current.temperature and previous.co2 == current.co2:
                continue
            if previous.temperature == current.temperature or previous.co2 == current.co2:
                continue
            result = self._evaluate(
                key=key,
                device_id=None,
                temp_device_id=pair.temp_device_id,
                co2_device_id=pair.co2_device_id,
                zone_id=pair.zone_id,
                previous=previous,
                current=current,
            )
            self._last_by_device[key] = ReadingPoint(
                temperature=current.temperature,
                co2=current.co2,
                temp_recorded_at=current.temp_recorded_at,
                co2_recorded_at=current.co2_recorded_at,
                recorded_at=current.recorded_at,
            )
            if result is not None:
                results.append(result)
        return results

    def _evaluate(
        self,
        *,
        key: str,
        device_id: str | None,
        temp_device_id: str | None,
        co2_device_id: str | None,
        zone_id: str | None,
        previous: ReadingPoint,
        current: ReadingPoint,
    ) -> DetectionResult | None:
        assert previous.temperature is not None and previous.co2 is not None and previous.recorded_at is not None
        assert current.temperature is not None and current.co2 is not None and current.recorded_at is not None

        prev_temp_at = previous.temp_recorded_at or previous.recorded_at
        curr_temp_at = current.temp_recorded_at or current.recorded_at
        prev_co2_at = previous.co2_recorded_at or previous.recorded_at
        curr_co2_at = current.co2_recorded_at or current.recorded_at
        assert prev_temp_at is not None and curr_temp_at is not None
        assert prev_co2_at is not None and curr_co2_at is not None
        temp_rate = _rate_per_min(previous.temperature, current.temperature, prev_temp_at, curr_temp_at)
        co2_rate = _rate_per_min(previous.co2, current.co2, prev_co2_at, curr_co2_at)
        condition = (
            temp_rate >= self.temp_rate
            and co2_rate >= self.co2_rate
            and current.temperature >= self.temp_absolute
        )
        state = self._states.setdefault(key, EmergencyState())
        if not condition:
            state.consecutive_readings = 0
            if state.status in ACTIVE_STATUSES:
                state.status = "cleared"
                state.last_cleared_at = current.recorded_at
                return DetectionResult(key, "cleared", device_id, temp_device_id, co2_device_id, zone_id, current.temperature, current.co2, temp_rate, co2_rate, 0, current.recorded_at)
            return None

        state.consecutive_readings += 1
        if state.consecutive_readings < self.sustained_readings:
            return None
        if state.status in ACTIVE_STATUSES:
            return DetectionResult(key, "update", device_id, temp_device_id, co2_device_id, zone_id, current.temperature, current.co2, temp_rate, co2_rate, state.consecutive_readings, current.recorded_at)

        state.status = "active"
        return DetectionResult(key, "active", device_id, temp_device_id, co2_device_id, zone_id, current.temperature, current.co2, temp_rate, co2_rate, state.consecutive_readings, current.recorded_at)


def _emergency_payload(event: EmergencyEvent) -> dict[str, object]:
    return {
        "type": "emergency",
        "status": event.status,
        "event_id": event.id,
        "key": event.key,
        "device_id": event.device_id,
        "temp_device_id": event.temp_device_id,
        "co2_device_id": event.co2_device_id,
        "zone_id": event.zone_id,
        "temperature": event.temperature,
        "co2": event.co2,
        "temperature_rate": event.temperature_rate,
        "co2_rate": event.co2_rate,
        "consecutive_readings": event.consecutive_readings,
        "started_at": event.started_at.isoformat(),
        "last_seen_at": event.last_seen_at.isoformat(),
        "acknowledged_at": event.acknowledged_at.isoformat() if event.acknowledged_at else None,
        "cleared_at": event.cleared_at.isoformat() if event.cleared_at else None,
    }


def _event_message(result: DetectionResult, label: str) -> str:
    return (
        "🚨 <b>СРОЧНО: возможный пожар</b>\n"
        f"Датчик: {label}\n"
        f"Температура: <b>{result.temperature:g}°C</b> (+{result.temperature_rate:g}°C/мин)\n"
        f"CO2: <b>{result.co2:g} ppm</b> (+{result.co2_rate:g} ppm/мин)"
    )


_key_locks: dict[str, asyncio.Lock] = {}


def _lock_for_key(key: str) -> asyncio.Lock:
    lock = _key_locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _key_locks[key] = lock
    return lock


def _is_stale_active_result(result: DetectionResult) -> bool:
    state = detector.get_key_state(result.key)
    if state.status != "cleared":
        return False
    if state.last_cleared_at is None:
        return True
    return result.recorded_at <= state.last_cleared_at


async def handle_detection_result(result: DetectionResult) -> None:
    telegram_payload: tuple[EmergencyEvent, DetectionResult] | None = None

    async with _lock_for_key(result.key):
        if result.status == "active":
            if _is_stale_active_result(result):
                logger.info("Skipping stale active emergency for %s", result.key)
                return
            event, created = await _create_or_update_active_event(result, create_if_missing=True)
            await manager.broadcast(_emergency_payload(event))
            if created:
                telegram_payload = (event, result)
        elif result.status == "update":
            event, _ = await _create_or_update_active_event(result, create_if_missing=False)
            if event is not None:
                await manager.broadcast(_emergency_payload(event))
        elif result.status == "cleared":
            event = await _clear_active_event(result)
            if event is not None:
                await manager.broadcast(_emergency_payload(event))

    if telegram_payload is not None:
        event, detection = telegram_payload
        try:
            await _send_emergency_telegram(event, detection)
        except Exception:
            logger.exception("Emergency %s Telegram failed; WS already broadcast", event.id)


async def _find_active_event(session, key: str) -> EmergencyEvent | None:
    stmt = (
        select(EmergencyEvent)
        .where(EmergencyEvent.key == key)
        .where(EmergencyEvent.status.in_(["active", "acknowledged"]))
        .order_by(EmergencyEvent.started_at.desc())
        .limit(1)
    )
    return (await session.execute(stmt)).scalar_one_or_none()


def _apply_reading_to_event(event: EmergencyEvent, result: DetectionResult) -> None:
    event.temperature = result.temperature
    event.co2 = result.co2
    event.temperature_rate = result.temperature_rate
    event.co2_rate = result.co2_rate
    event.consecutive_readings = result.consecutive_readings
    event.last_seen_at = result.recorded_at


async def _create_or_update_active_event(
    result: DetectionResult, *, create_if_missing: bool
) -> tuple[EmergencyEvent | None, bool]:
    async with AsyncSessionLocal() as session:
        event = await _find_active_event(session, result.key)
        created = False
        if event is None:
            if not create_if_missing:
                return None, False
            event = EmergencyEvent(
                key=result.key,
                status="active",
                device_id=result.device_id,
                temp_device_id=result.temp_device_id,
                co2_device_id=result.co2_device_id,
                zone_id=result.zone_id,
                temperature=result.temperature,
                co2=result.co2,
                temperature_rate=result.temperature_rate,
                co2_rate=result.co2_rate,
                threshold_temp_rate=settings.emergency_temp_rate,
                threshold_co2_rate=settings.emergency_co2_rate,
                threshold_temp_absolute=settings.emergency_temp_absolute,
                threshold_sustained_readings=settings.emergency_sustained_readings,
                consecutive_readings=result.consecutive_readings,
                started_at=result.recorded_at,
                last_seen_at=result.recorded_at,
            )
            session.add(event)
            created = True
        else:
            _apply_reading_to_event(event, result)
        try:
            await session.commit()
            await session.refresh(event)
        except IntegrityError:
            await session.rollback()
            if not created:
                raise
            event = await _find_active_event(session, result.key)
            if event is None:
                raise
            _apply_reading_to_event(event, result)
            await session.commit()
            await session.refresh(event)
            created = False
        if event.status == "acknowledged":
            detector.acknowledge(result.key, event.id)
        return event, created


async def _clear_active_event(result: DetectionResult) -> EmergencyEvent | None:
    async with AsyncSessionLocal() as session:
        stmt = (
            select(EmergencyEvent)
            .where(EmergencyEvent.key == result.key)
            .where(EmergencyEvent.status.in_(["active", "acknowledged"]))
            .order_by(EmergencyEvent.started_at.desc())
            .limit(1)
        )
        event = (await session.execute(stmt)).scalar_one_or_none()
        if event is None:
            return None
        event.status = "cleared"
        event.cleared_at = result.recorded_at
        event.last_seen_at = result.recorded_at
        event.temperature = result.temperature
        event.co2 = result.co2
        event.temperature_rate = result.temperature_rate
        event.co2_rate = result.co2_rate
        await session.commit()
        await session.refresh(event)
        return event


async def _send_emergency_telegram(event: EmergencyEvent, result: DetectionResult) -> None:
    token = (settings.telegram_bot_token or "").strip()
    if not token:
        return
    label = await display_label_for_canonical(result.device_id or result.key)
    label = label or result.device_id or result.key
    msg = _event_message(result, label)
    sent = False
    error: str | None = None
    async with AsyncSessionLocal() as session:
        users = (await session.execute(select(User).where(User.telegram_chat_id.is_not(None)))).scalars().all()
    for user in users:
        chat = (user.telegram_chat_id or "").strip()
        if not chat:
            continue
        try:
            await send_telegram_message(chat, msg, disable_notification=False)
            sent = True
        except Exception as exc:
            logger.warning("Emergency %s Telegram failed for user %s: %s", event.id, user.id, exc)
            error = str(exc)[:1000]
    async with AsyncSessionLocal() as session:
        stored = await session.get(EmergencyEvent, event.id)
        if stored is not None:
            stored.telegram_sent = sent
            stored.telegram_error = error
            await session.commit()


async def acknowledge_emergency_event(event_id: int, user_id: int) -> EmergencyEvent:
    async with AsyncSessionLocal() as session:
        initial = await session.get(EmergencyEvent, event_id)
        if initial is None:
            raise EmergencyEventNotFound(event_id)
        key = initial.key

    async with _lock_for_key(key):
        async with AsyncSessionLocal() as session:
            event = await session.get(EmergencyEvent, event_id)
            if event is None:
                raise EmergencyEventNotFound(event_id)
            if event.status in ("cleared", "acknowledged"):
                return event
            event.status = "acknowledged"
            event.acknowledged_by = user_id
            event.acknowledged_at = datetime.now(timezone.utc)
            await session.commit()
            await session.refresh(event)
        detector.acknowledge(key, event.id)
        await manager.broadcast(_emergency_payload(event))
        return event


async def hydrate_detector_state_from_db() -> None:
    async with AsyncSessionLocal() as session:
        stmt = select(EmergencyEvent).where(EmergencyEvent.status.in_(["active", "acknowledged"]))
        events = (await session.execute(stmt)).scalars().all()
    for event in events:
        recorded_at = event.last_seen_at or event.started_at
        detector.hydrate_key_state(event.key, status=event.status, event_id=event.id)
        detector.hydrate_reading_baseline(
            key=event.key,
            device_id=event.device_id,
            temperature=event.temperature,
            co2=event.co2,
            recorded_at=recorded_at,
        )
    if events:
        logger.info("Hydrated emergency detector state for %d active events", len(events))


detector = EmergencyDetector.from_settings()
