"""Feature 2: natural-language questions over sensor data (Telegram chat).

Light intent parsing → compact aggregates from TimescaleDB → Gemini answer
grounded ONLY in the provided data. Reuses the shared gemini_client.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.ai.gemini_client import generate
from app.bridge_devices_store import canonical_device_id, display_label_for_canonical
from app.database import AsyncSessionLocal
from app.models import Company, DeviceCompany, SensorReading

logger = logging.getLogger(__name__)

CHAT_METRICS = ("co2", "temperature", "humidity")
DEFAULT_WINDOW_HOURS = 24.0
MAX_CONTEXT_LINES = 30

METRIC_RU = {"co2": "CO₂", "temperature": "температура", "humidity": "влажность"}
METRIC_UNIT = {"co2": "ppm", "temperature": "°C", "humidity": "%"}

NO_DATA_MSG = (
    "По вашему запросу данных нет — за выбранный период показаний "
    "с подходящих датчиков не найдено."
)
GEMINI_FAIL_MSG = "Не удалось обработать запрос, попробуйте позже."

SYSTEM_PROMPT = (
    "Ты ассистент системы мониторинга воздуха в офисном здании (датчики Zigbee). "
    "Отвечай на русском, кратко (не более 5 строк), простым текстом без Markdown и HTML. "
    "Отвечай ТОЛЬКО по данным, приведённым в запросе. Если в данных нет ответа "
    "на вопрос (нет нужного этажа, датчика или периода) — прямо скажи, что данных нет. "
    "Никогда не выдумывай показания, тренды или прогнозы."
)

_METRIC_KEYWORDS = {
    "co2": ("co2", "co₂", "со2", "углекисл", "душно", "воздух"),
    "temperature": ("температур", "тепло", "жарко", "холодно", "градус"),
    "humidity": ("влажн", "сухо"),
}


@dataclass
class ChatIntent:
    metrics: list[str] = field(default_factory=lambda: list(CHAT_METRICS))
    window_hours: float = DEFAULT_WINDOW_HOURS
    floor: int | None = None
    company_query: str = ""  # lowercased full question, for company-name matching


def parse_intent(question: str) -> ChatIntent:
    q = question.lower()
    intent = ChatIntent(company_query=q)

    metrics = [m for m, kws in _METRIC_KEYWORDS.items() if any(k in q for k in kws)]
    if metrics:
        intent.metrics = metrics

    if m := re.search(r"(\d+)\s*этаж", q):
        intent.floor = int(m.group(1))

    if m := re.search(r"(\d+)\s*(?:час|ч\b)", q):
        intent.window_hours = max(1.0, float(m.group(1)))
    elif re.search(r"\bчас", q):  # "час назад", "за последний час" (не "сейчас")
        intent.window_hours = 2.0
    elif m := re.search(r"(\d+)\s*(?:день|дня|дней|сут)", q):
        intent.window_hours = float(m.group(1)) * 24
    elif "вчера" in q:
        intent.window_hours = 48.0
    elif "недел" in q:
        intent.window_hours = 168.0

    return intent


def _norm_assignment_key(canon: str) -> str:
    return canon.strip().lower().replace(" ", "")


async def _company_lookup() -> dict[str, tuple[str, int | None]]:
    """normalized device key → (company name, floor_id)."""
    async with AsyncSessionLocal() as session:
        stmt = (
            select(DeviceCompany.device_ieee, Company.name, Company.floor_id)
            .join(Company, DeviceCompany.company_id == Company.id)
        )
        rows = (await session.execute(stmt)).all()
    return {_norm_assignment_key(ieee): (name, floor) for ieee, name, floor in rows}


async def build_data_context(intent: ChatIntent) -> list[str]:
    """Compact per-device aggregates (min/max/avg + latest), never raw dumps."""
    since = datetime.now(timezone.utc) - timedelta(hours=intent.window_hours)

    async with AsyncSessionLocal() as session:
        agg_stmt = (
            select(
                SensorReading.device_id,
                SensorReading.metric,
                func.min(SensorReading.value),
                func.max(SensorReading.value),
                func.avg(SensorReading.value),
            )
            .where(
                SensorReading.metric.in_(intent.metrics),
                SensorReading.recorded_at >= since,
            )
            .group_by(SensorReading.device_id, SensorReading.metric)
        )
        agg_rows = (await session.execute(agg_stmt)).all()

        ranked = (
            select(
                SensorReading.device_id,
                SensorReading.metric,
                SensorReading.value,
                SensorReading.recorded_at,
                func.row_number()
                .over(
                    partition_by=(SensorReading.device_id, SensorReading.metric),
                    order_by=SensorReading.recorded_at.desc(),
                )
                .label("rn"),
            )
            .where(
                SensorReading.metric.in_(intent.metrics),
                SensorReading.recorded_at >= since,
            )
        ).subquery()
        latest_stmt = select(
            ranked.c.device_id, ranked.c.metric, ranked.c.value, ranked.c.recorded_at
        ).where(ranked.c.rn == 1)
        latest_rows = (await session.execute(latest_stmt)).all()

    latest = {(d, m): (float(v), ts) for d, m, v, ts in latest_rows}
    companies = await _company_lookup()

    # Merge raw topic aliases into one canonical device
    lines: list[str] = []
    seen: set[tuple[str, str]] = set()
    for device_id, metric, vmin, vmax, vavg in agg_rows:
        canon = await canonical_device_id(device_id.split("/")[0].strip())
        if (canon, metric) in seen:
            continue
        seen.add((canon, metric))

        hit = companies.get(_norm_assignment_key(canon))
        company_name, floor = hit if hit else (None, None)

        if intent.floor is not None and floor != intent.floor:
            continue

        label = await display_label_for_canonical(canon) or canon
        unit = METRIC_UNIT.get(metric, "")
        lv = latest.get((device_id, metric))
        latest_part = f", сейчас {lv[0]:g} ({lv[1].strftime('%H:%M')})" if lv else ""
        place = ""
        if company_name:
            place = f" [{company_name}" + (f", этаж {floor}]" if floor is not None else "]")
        lines.append(
            f"{label}{place} — {METRIC_RU.get(metric, metric)}: "
            f"мин {float(vmin):g} / макс {float(vmax):g} / средн {float(vavg):.1f} {unit}"
            f"{latest_part}"
        )

    # If the question mentions a known company by name, keep only its devices
    mentioned = {
        name for name, _ in companies.values()
        if name and name.lower() in intent.company_query
    }
    if mentioned:
        lines = [l for l in lines if any(f"[{n}" in l for n in mentioned)]

    return lines[:MAX_CONTEXT_LINES]


async def answer_question(question: str) -> str:
    """Answer a free-text question; always returns Russian text, never raises."""
    try:
        intent = parse_intent(question)
        lines = await build_data_context(intent)
        if not lines:
            return NO_DATA_MSG

        prompt = (
            f"Вопрос пользователя: {question}\n\n"
            f"Данные датчиков за последние {intent.window_hours:g} ч "
            f"(агрегаты по каждому датчику):\n" + "\n".join(lines) + "\n\n"
            "Ответь на вопрос только по этим данным."
        )
        text = await generate(prompt, system=SYSTEM_PROMPT)
        answered = text is not None
        logger.info("Chat question answered=%s: %.120s", answered, question)
        return text or GEMINI_FAIL_MSG
    except Exception:
        logger.exception("Chat question failed: %.120s", question)
        return GEMINI_FAIL_MSG
