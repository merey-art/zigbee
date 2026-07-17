"""Feature 5: AI-generated period reports (day / week).

Aggregates sensor data compactly from TimescaleDB, asks Gemini for a Russian
summary grounded ONLY in those aggregates, and returns both the aggregates
(for the UI) and the generated text. Degrades gracefully on thin data and on
Gemini failure. Reuses the shared gemini_client.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.ai.gemini_client import generate
from app.bridge_devices_store import canonical_device_id, display_label_for_canonical
from app.database import AsyncSessionLocal
from app.models import SensorReading

logger = logging.getLogger(__name__)

REPORT_METRICS = ("co2", "temperature", "humidity")
METRIC_RU = {"co2": "CO₂", "temperature": "температура", "humidity": "влажность"}
METRIC_UNIT = {"co2": "ppm", "temperature": "°C", "humidity": "%"}

PERIOD_DAYS = {"day": 1, "week": 7}
CACHE_TTL_SECONDS = 5 * 60
TOP_WORST_BUCKETS = 3

TEXT_UNAVAILABLE = "Текстовая сводка недоступна"

SYSTEM_PROMPT = (
    "Ты аналитик системы мониторинга воздуха в офисном здании (датчики Zigbee). "
    "Пиши на русском, человекочитаемо, структурировано, без Markdown и HTML. "
    "Используй ТОЛЬКО приведённые в запросе агрегаты. Не выдумывай числа, "
    "которых нет в данных. Возможные причины формулируй как гипотезы "
    "(«возможно, из-за...»), а не как факты. Если данных мало — честно скажи об этом."
)

# report_key -> (created_monotonic, payload)
_cache: dict[str, tuple[float, "ReportResult"]] = {}


@dataclass
class MetricAggregate:
    device_id: str
    device_label: str
    metric: str
    unit: str
    min: float
    max: float
    avg: float
    latest: float | None
    count: int
    worst_hours: list[dict] = field(default_factory=list)  # [{hour, avg}]


@dataclass
class ReportResult:
    period: str
    days_requested: int
    days_covered: int
    coverage_note: str | None
    total_readings: int
    aggregates: list[MetricAggregate]
    summary_text: str | None
    text_available: bool


def _round(x: float | None, n: int = 1) -> float | None:
    return None if x is None else round(float(x), n)


async def _collect_aggregates(
    start: datetime,
) -> tuple[list[MetricAggregate], int, datetime | None]:
    """Compact per-device/metric aggregates + worst hourly buckets. No raw dumps."""
    async with AsyncSessionLocal() as session:
        agg_stmt = (
            select(
                SensorReading.device_id,
                SensorReading.metric,
                func.min(SensorReading.value),
                func.max(SensorReading.value),
                func.avg(SensorReading.value),
                func.count(),
                func.min(SensorReading.recorded_at),
            )
            .where(
                SensorReading.metric.in_(REPORT_METRICS),
                SensorReading.recorded_at >= start,
            )
            .group_by(SensorReading.device_id, SensorReading.metric)
        )
        agg_rows = (await session.execute(agg_stmt)).all()

        # Latest value per device+metric
        ranked = (
            select(
                SensorReading.device_id,
                SensorReading.metric,
                SensorReading.value,
                func.row_number()
                .over(
                    partition_by=(SensorReading.device_id, SensorReading.metric),
                    order_by=SensorReading.recorded_at.desc(),
                )
                .label("rn"),
            ).where(
                SensorReading.metric.in_(REPORT_METRICS),
                SensorReading.recorded_at >= start,
            )
        ).subquery()
        latest_rows = (
            await session.execute(
                select(ranked.c.device_id, ranked.c.metric, ranked.c.value).where(
                    ranked.c.rn == 1
                )
            )
        ).all()

        # Worst hourly buckets (highest avg) per device+metric
        bucket = func.date_trunc("hour", SensorReading.recorded_at)
        hour_stmt = (
            select(
                SensorReading.device_id,
                SensorReading.metric,
                bucket.label("hour"),
                func.avg(SensorReading.value).label("avg"),
            )
            .where(
                SensorReading.metric.in_(REPORT_METRICS),
                SensorReading.recorded_at >= start,
            )
            .group_by(SensorReading.device_id, SensorReading.metric, bucket)
        )
        hour_rows = (await session.execute(hour_stmt)).all()

    latest = {(d, m): float(v) for d, m, v in latest_rows}

    # Worst hours: for co2/temperature the highest avg is "worst"
    worst: dict[tuple[str, str], list[dict]] = {}
    for d, m, hour, avg in hour_rows:
        worst.setdefault((d, m), []).append({"hour": hour, "avg": float(avg)})
    for key, buckets in worst.items():
        buckets.sort(key=lambda b: b["avg"], reverse=True)
        worst[key] = buckets[:TOP_WORST_BUCKETS]

    total = 0
    earliest: datetime | None = None
    merged: dict[tuple[str, str], MetricAggregate] = {}
    for device_id, metric, vmin, vmax, vavg, cnt, first_ts in agg_rows:
        total += int(cnt)
        if earliest is None or first_ts < earliest:
            earliest = first_ts
        canon = await canonical_device_id(device_id.split("/")[0].strip())
        label = await display_label_for_canonical(canon) or canon
        mkey = (canon, metric)
        if mkey in merged:
            # Multiple raw aliases → keep widest range (rare)
            a = merged[mkey]
            a.min = min(a.min, float(vmin))
            a.max = max(a.max, float(vmax))
            a.count += int(cnt)
            continue
        merged[mkey] = MetricAggregate(
            device_id=canon,
            device_label=label,
            metric=metric,
            unit=METRIC_UNIT.get(metric, ""),
            min=_round(vmin),
            max=_round(vmax),
            avg=_round(vavg),
            latest=_round(latest.get((device_id, metric))),
            count=int(cnt),
            worst_hours=[
                {"hour": b["hour"].strftime("%d.%m %H:%M"), "avg": _round(b["avg"])}
                for b in worst.get((device_id, metric), [])
            ],
        )

    aggregates = sorted(merged.values(), key=lambda a: (a.device_label, a.metric))
    return aggregates, total, earliest


def _build_prompt(result: ReportResult) -> str:
    lines = [
        f"Период отчёта: {'сутки' if result.period == 'day' else 'неделя'} "
        f"(запрошено дней: {result.days_requested}, покрыто данными: {result.days_covered}).",
        f"Всего показаний: {result.total_readings}.",
        "",
        "Агрегаты по датчикам:",
    ]
    for a in result.aggregates:
        latest = f", сейчас {a.latest:g}" if a.latest is not None else ""
        worst = ""
        if a.worst_hours:
            worst = " Худшие часы: " + "; ".join(
                f"{w['hour']}={w['avg']:g}" for w in a.worst_hours
            )
        lines.append(
            f"- {a.device_label} · {METRIC_RU.get(a.metric, a.metric)}: "
            f"мин {a.min:g} / макс {a.max:g} / средн {a.avg:g} {a.unit}"
            f"{latest} (замеров {a.count}).{worst}"
        )
    lines += [
        "",
        "Составь отчёт на русском со структурой:",
        "1) Общая оценка качества воздуха за период.",
        "2) Худшие периоды и места (по данным выше).",
        "3) Возможные причины, соотнесённые со временем суток "
        "(строго как гипотезы: «возможно, из-за...»).",
        "4) Короткие практические рекомендации.",
    ]
    if result.days_covered < result.days_requested:
        lines.append(
            "ВАЖНО: данных меньше, чем на полный период "
            f"({result.days_covered} дн. из {result.days_requested}) — "
            "укажи это и делай выводы только по имеющимся данным."
        )
    return "\n".join(lines)


async def generate_report(period: str) -> ReportResult:
    """Generate (or return cached) report for 'day' or 'week'."""
    period = period if period in PERIOD_DAYS else "day"
    now = time.monotonic()
    cached = _cache.get(period)
    if cached and (now - cached[0]) < CACHE_TTL_SECONDS:
        logger.info("Report '%s' served from cache", period)
        return cached[1]

    days = PERIOD_DAYS[period]
    start = datetime.now(timezone.utc) - timedelta(days=days)
    aggregates, total, earliest = await _collect_aggregates(start)

    if earliest is not None:
        span_days = (datetime.now(timezone.utc) - earliest).total_seconds() / 86400
        days_covered = max(1, min(days, round(span_days)))
    else:
        days_covered = 0

    coverage_note = None
    if days_covered < days:
        coverage_note = f"Данные за {days_covered} дн. из {days}"

    result = ReportResult(
        period=period,
        days_requested=days,
        days_covered=days_covered,
        coverage_note=coverage_note,
        total_readings=total,
        aggregates=aggregates,
        summary_text=None,
        text_available=False,
    )

    if not aggregates:
        result.summary_text = (
            f"За выбранный период данных недостаточно для отчёта "
            f"({days_covered} дн. из {days}). Показаний с датчиков не найдено."
        )
        result.text_available = True
        _cache[period] = (now, result)
        return result

    text = await generate(_build_prompt(result), system=SYSTEM_PROMPT)
    if text:
        result.summary_text = text
        result.text_available = True
    else:
        result.summary_text = TEXT_UNAVAILABLE
        result.text_available = False

    logger.info(
        "Report '%s' generated: readings=%d text=%s", period, total, result.text_available
    )
    _cache[period] = (now, result)
    return result
