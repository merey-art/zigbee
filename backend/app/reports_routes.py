"""CSV / XLSX exports of sensor readings for management reporting."""

from __future__ import annotations

import csv
import html
import io
import re
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Annotated, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.reports import ReportResult, generate_report
from app.auth_deps import get_current_user
from app.bridge_devices_store import display_label_for_canonical
from app.config import settings
from app.database import get_db
from app.models import DeviceCompany, SensorReading, User
from app.telegram_service import send_telegram_message

router = APIRouter(prefix="/reports", tags=["reports"])


class ReportPeriod(str, Enum):
    day = "day"
    week = "week"


class MetricAggregateOut(BaseModel):
    device_id: str
    device_label: str
    metric: str
    unit: str
    min: float
    max: float
    avg: float
    latest: float | None
    count: int
    worst_hours: list[dict]


class ReportOut(BaseModel):
    period: str
    days_requested: int
    days_covered: int
    coverage_note: str | None
    total_readings: int
    aggregates: list[MetricAggregateOut]
    summary_text: str | None
    text_available: bool


def _to_out(r: ReportResult) -> ReportOut:
    return ReportOut(
        period=r.period,
        days_requested=r.days_requested,
        days_covered=r.days_covered,
        coverage_note=r.coverage_note,
        total_readings=r.total_readings,
        aggregates=[MetricAggregateOut(**vars(a)) for a in r.aggregates],
        summary_text=r.summary_text,
        text_available=r.text_available,
    )


@router.post("/generate", response_model=ReportOut)
async def generate_ai_report(
    _: Annotated[User, Depends(get_current_user)],
    period: Annotated[ReportPeriod, Query(description="day or week")] = ReportPeriod.day,
) -> ReportOut:
    """AI text report + compact aggregates for the period. Never errors on thin data."""
    result = await generate_report(period.value)
    return _to_out(result)


@router.post("/send-telegram", status_code=200)
async def send_report_telegram(
    current: Annotated[User, Depends(get_current_user)],
    period: Annotated[ReportPeriod, Query(description="day or week")] = ReportPeriod.day,
) -> dict[str, str]:
    """Send the (cached or freshly generated) report text to the user's Telegram."""
    if not (settings.telegram_bot_token or "").strip():
        raise HTTPException(status_code=400, detail="Telegram bot is not configured")
    chat = (current.telegram_chat_id or "").strip()
    if not chat:
        raise HTTPException(status_code=400, detail="No Telegram chat_id on your profile")

    result = await generate_report(period.value)
    title = "📊 Отчёт за сутки" if period == ReportPeriod.day else "📊 Отчёт за неделю"
    body = html.escape(result.summary_text or "Текстовая сводка недоступна.")
    note = f"\n\n({html.escape(result.coverage_note)})" if result.coverage_note else ""
    await send_telegram_message(chat, f"<b>{title}</b>\n\n{body}{note}")
    return {"status": "ok"}


class ExportPeriod(str, Enum):
    d1 = "1d"
    d7 = "7d"
    d30 = "30d"


def _norm_ieee(raw: str) -> str:
    return re.sub(r"\s+", "", raw.lower())


def _period_start(period: ExportPeriod) -> datetime:
    now = datetime.now(timezone.utc)
    if period == ExportPeriod.d1:
        return now - timedelta(days=1)
    if period == ExportPeriod.d7:
        return now - timedelta(days=7)
    return now - timedelta(days=30)


@router.get("/readings.csv")
async def export_readings_csv(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    period: Annotated[ExportPeriod, Query(description="1d, 7d, or 30d")],
    company_id: Annotated[int | None, Query(description="Optional office filter")] = None,
) -> StreamingResponse:
    start = _period_start(period)
    iees: list[str] | None = None
    if company_id is not None:
        r = await db.execute(select(DeviceCompany.device_ieee).where(DeviceCompany.company_id == company_id))
        iees = [_norm_ieee(row[0]) for row in r.all() if row[0]]
        if not iees:
            raise HTTPException(status_code=404, detail="No devices assigned to this company")

    async def gen() -> AsyncIterator[bytes]:
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["recorded_at_utc", "device_id", "device_label", "metric", "value"])
        yield buf.getvalue().encode("utf-8-sig")
        buf.seek(0)
        buf.truncate(0)

        labels: dict[str, str] = {}
        last_id = 0
        batch_size = 4000
        while True:
            q = select(SensorReading).where(
                SensorReading.recorded_at >= start,
                SensorReading.id > last_id,
            )
            if iees is not None:
                q = q.where(SensorReading.device_id.in_(iees))
            q = q.order_by(SensorReading.id.asc()).limit(batch_size)
            result = await db.execute(q)
            rows = list(result.scalars().all())
            if not rows:
                break
            for row in rows:
                did = row.device_id
                if did not in labels:
                    labels[did] = (
                        await display_label_for_canonical(did.split("/")[0].strip())
                    ) or ""
                lbl = labels[did] or did
                w.writerow(
                    [
                        row.recorded_at.isoformat(),
                        did,
                        lbl,
                        row.metric,
                        row.value,
                    ]
                )
            last_id = rows[-1].id
            chunk = buf.getvalue()
            if len(chunk) > 24_000:
                yield chunk.encode("utf-8")
                buf.seek(0)
                buf.truncate(0)
        rest = buf.getvalue()
        if rest:
            yield rest.encode("utf-8")

    fname = f"sensor_readings_{period.value}.csv"
    return StreamingResponse(
        gen(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/readings.xlsx")
async def export_readings_xlsx(
    db: Annotated[AsyncSession, Depends(get_db)],
    _: Annotated[User, Depends(get_current_user)],
    period: Annotated[ExportPeriod, Query(description="1d, 7d, or 30d")],
    company_id: Annotated[int | None, Query()] = None,
) -> StreamingResponse:
    from openpyxl import Workbook

    start = _period_start(period)
    stmt = select(SensorReading).where(SensorReading.recorded_at >= start).order_by(SensorReading.id.asc())
    if company_id is not None:
        r = await db.execute(select(DeviceCompany.device_ieee).where(DeviceCompany.company_id == company_id))
        iees = [_norm_ieee(row[0]) for row in r.all() if row[0]]
        if not iees:
            raise HTTPException(status_code=404, detail="No devices assigned to this company")
        stmt = stmt.where(SensorReading.device_id.in_(iees))
    stmt = stmt.limit(200_000)

    result = await db.execute(stmt)
    rows = list(result.scalars().all())

    labels: dict[str, str] = {}
    wb = Workbook(write_only=True)
    ws = wb.create_sheet("Readings")
    ws.append(["recorded_at_utc", "device_id", "device_label", "metric", "value"])
    for row in rows:
        did = row.device_id
        if did not in labels:
            labels[did] = (await display_label_for_canonical(did.split("/")[0].strip())) or ""
        lbl = labels[did] or did
        ws.append([row.recorded_at.isoformat(), did, lbl, row.metric, row.value])

    bio = io.BytesIO()
    wb.save(bio)
    bio.seek(0)
    fname = f"sensor_readings_{period.value}.xlsx"
    return StreamingResponse(
        iter([bio.read()]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
