"""AI-powered Telegram recommendations (Gemini) on threshold/trend triggers.

Separate from emergency detection: has its own 30-min per device+metric
cooldown and never touches the emergency path. If Gemini is unavailable the
plain threshold alert text is sent instead — users are always notified.
"""

from __future__ import annotations

import html
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.ai.gemini_client import generate
from app.bridge_devices_store import aliases_for_readings, display_label_for_canonical
from app.config import settings
from app.database import AsyncSessionLocal
from app.forecast import ForecastResult, compute_forecast, default_threshold
from app.models import SensorReading, User
from app.telegram_service import send_telegram_message

logger = logging.getLogger(__name__)

AI_METRICS = ("co2", "temperature", "humidity")
COOLDOWN_SECONDS = 30 * 60  # max 1 AI recommendation per device+metric per 30 min
TREND_WINDOW_MIN = 15
TREND_CHANGE_PCT = 0.15
READINGS_LIMIT = 20
FORECAST_HORIZON_MIN = 30

METRIC_RU = {"co2": "CO₂", "temperature": "температура", "humidity": "влажность"}
METRIC_UNIT = {"co2": "ppm", "temperature": "°C", "humidity": "%"}

SYSTEM_PROMPT = (
    "Ты ассистент системы мониторинга воздуха в офисном здании (датчики Zigbee). "
    "Отвечай только на русском языке, кратко (не более 4 строк), простым текстом "
    "без Markdown и HTML. Используй только приведённые в запросе числа — "
    "не выдумывай пороги, значения и прогнозы."
)

_last_sent: dict[tuple[str, str], datetime] = {}


@dataclass
class RecommendationContext:
    device_label: str
    metric: str
    value: float
    threshold: float | None
    readings: list[tuple[datetime, float]]  # chronological
    forecast: ForecastResult | None
    threshold_exceeded: bool
    sharp_trend_pct: float | None  # signed %, set when trend trigger fired


# ── Triggers ───────────────────────────────────────────────────────────────────


def _cooldown_elapsed(device_id: str, metric: str, now: datetime) -> bool:
    last = _last_sent.get((device_id, metric))
    return last is None or (now - last).total_seconds() >= COOLDOWN_SECONDS


def _mark_sent(device_id: str, metric: str, now: datetime) -> None:
    _last_sent[(device_id, metric)] = now


def sharp_trend_pct(
    readings: list[tuple[datetime, float]],
    current_value: float,
    now: datetime,
) -> float | None:
    """Signed % change vs the oldest reading in the last 15 min; None if not sharp."""
    window_start = now - timedelta(minutes=TREND_WINDOW_MIN)
    in_window = [(ts, v) for ts, v in readings if ts >= window_start]
    if len(in_window) < 2:
        return None
    baseline = in_window[0][1]
    if baseline == 0:
        return None
    change = (current_value - baseline) / abs(baseline)
    if abs(change) <= TREND_CHANGE_PCT:
        return None
    return change * 100.0


# ── Message composition ────────────────────────────────────────────────────────


def _build_prompt(ctx: RecommendationContext) -> str:
    unit = METRIC_UNIT.get(ctx.metric, "")
    name_ru = METRIC_RU.get(ctx.metric, ctx.metric)
    series = ", ".join(
        f"{ts.strftime('%H:%M')}={v:g}" for ts, v in ctx.readings[-READINGS_LIMIT:]
    )

    lines = [
        f"Датчик: {ctx.device_label}",
        f"Метрика: {name_ru} ({ctx.metric}), текущее значение: {ctx.value:g} {unit}",
    ]
    if ctx.threshold is not None:
        lines.append(f"Порог: {ctx.threshold:g} {unit}")
    if ctx.threshold_exceeded:
        lines.append("Порог превышен.")
    if ctx.sharp_trend_pct is not None:
        lines.append(
            f"Резкое изменение: {ctx.sharp_trend_pct:+.0f}% за последние {TREND_WINDOW_MIN} мин."
        )
    if ctx.forecast is not None:
        lines.append(f"Скорость изменения: {ctx.forecast.slope_per_min:+g} {unit}/мин.")
        if ctx.forecast.time_to_threshold_min is not None:
            lines.append(
                f"По прогнозу порог будет достигнут через ~{ctx.forecast.time_to_threshold_min:g} мин."
            )
    lines.append(f"Последние показания: {series}")
    lines.append(
        "Составь короткое уведомление для Telegram:\n"
        "1) в начале эмодзи серьёзности: 🔴 если порог уже превышен, иначе ⚠️;\n"
        "2) что происходит: тренд и скорость изменения;\n"
        "3) прогноз достижения порога — только если он явно указан в данных выше, "
        "иначе полностью пропусти этот пункт;\n"
        "4) одна конкретная рекомендация (какое помещение, что сделать)."
    )
    return "\n".join(lines)


def fallback_message(ctx: RecommendationContext) -> str:
    """Plain threshold alert text — same style as existing alert notifier."""
    unit = METRIC_UNIT.get(ctx.metric, "")
    label = html.escape(ctx.device_label)
    parts = [
        "⚠️ <b>Zigbee</b>",
        f"Устройство: {label}",
    ]
    if ctx.threshold_exceeded and ctx.threshold is not None:
        parts.append(
            f"{ctx.metric}: <b>{ctx.value:g}</b> {unit} (выше порога {ctx.threshold:g})"
        )
    else:
        parts.append(f"{ctx.metric}: <b>{ctx.value:g}</b> {unit}")
    if ctx.sharp_trend_pct is not None:
        parts.append(
            f"Резкое изменение: {ctx.sharp_trend_pct:+.0f}% за {TREND_WINDOW_MIN} мин"
        )
    if ctx.forecast is not None and ctx.forecast.time_to_threshold_min is not None:
        parts.append(
            f"При текущем темпе порог через ~{ctx.forecast.time_to_threshold_min:g} мин"
        )
    return "\n".join(parts)


async def compose_recommendation(ctx: RecommendationContext) -> tuple[str, bool]:
    """Return (telegram_html_text, is_ai). Falls back to plain text on any AI failure."""
    text = await generate(_build_prompt(ctx), system=SYSTEM_PROMPT)
    if text:
        return html.escape(text), True
    return fallback_message(ctx), False


# ── Data access + sending ──────────────────────────────────────────────────────


async def _fetch_recent_readings(
    device_id: str, metric: str
) -> list[tuple[datetime, float]]:
    aliases = await aliases_for_readings(device_id)
    async with AsyncSessionLocal() as session:
        stmt = (
            select(SensorReading.recorded_at, SensorReading.value)
            .where(
                SensorReading.device_id.in_(aliases),
                SensorReading.metric == metric,
            )
            .order_by(SensorReading.recorded_at.desc())
            .limit(READINGS_LIMIT)
        )
        rows = (await session.execute(stmt)).all()
    return [(ts, float(v)) for ts, v in reversed(rows)]


async def _send_to_all_users(text: str) -> bool:
    """Send to every user with a Telegram chat_id; True if at least one succeeded."""
    async with AsyncSessionLocal() as session:
        chat_ids = (
            await session.scalars(
                select(User.telegram_chat_id).where(
                    User.telegram_chat_id.is_not(None), User.telegram_chat_id != ""
                )
            )
        ).all()

    sent_any = False
    for chat in chat_ids:
        try:
            await send_telegram_message(chat.strip(), text)
            sent_any = True
        except Exception as exc:
            logger.warning("AI recommendation Telegram send failed (%s): %s", chat, exc)
    return sent_any


# ── Entry point (called per stored reading from the MQTT listener) ─────────────


async def maybe_send_ai_recommendation(device_id: str, metric: str, value: float) -> None:
    """Fire-and-forget task; must never raise into the MQTT listener."""
    try:
        await _maybe_send(device_id, metric, value)
    except Exception:
        logger.exception("AI recommendation failed for %s/%s", device_id, metric)


async def _maybe_send(device_id: str, metric: str, value: float) -> None:
    if metric not in AI_METRICS:
        return
    if not (settings.telegram_bot_token or "").strip():
        return

    now = datetime.now(timezone.utc)
    if not _cooldown_elapsed(device_id, metric, now):
        return

    threshold = default_threshold(metric)
    threshold_exceeded = threshold is not None and value > threshold

    readings = await _fetch_recent_readings(device_id, metric)
    trend_pct = sharp_trend_pct(readings, value, now)

    if not threshold_exceeded and trend_pct is None:
        return  # no trigger — no Gemini call

    label = await display_label_for_canonical(device_id)
    ctx = RecommendationContext(
        device_label=label or device_id,
        metric=metric,
        value=value,
        threshold=threshold,
        readings=readings,
        forecast=compute_forecast(readings, FORECAST_HORIZON_MIN, threshold),
        threshold_exceeded=threshold_exceeded,
        sharp_trend_pct=trend_pct,
    )

    text, is_ai = await compose_recommendation(ctx)
    if await _send_to_all_users(text):
        _mark_sent(device_id, metric, now)
        logger.info(
            "AI recommendation sent for %s/%s (ai=%s)", device_id, metric, is_ai
        )
