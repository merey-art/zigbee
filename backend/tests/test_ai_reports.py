from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

import app.ai.reports as reports
from app.ai.reports import MetricAggregate, generate_report


def _aggs():
    return [
        MetricAggregate(
            device_id="dev1", device_label="Офис 12", metric="co2", unit="ppm",
            min=400.0, max=1600.0, avg=850.0, latest=900.0, count=120,
            worst_hours=[{"hour": "16.07 10:00", "avg": 1500.0}],
        )
    ]


@pytest.fixture(autouse=True)
def _clear_cache():
    reports._cache.clear()
    yield
    reports._cache.clear()


@pytest.mark.asyncio
async def test_partial_coverage_note_on_thin_data(monkeypatch):
    # Week requested but only ~2 days of data exist
    now = datetime.now(timezone.utc)
    earliest = now.replace() - reports.timedelta(days=2)
    monkeypatch.setattr(
        reports, "_collect_aggregates",
        AsyncMock(return_value=(_aggs(), 240, earliest)),
    )
    monkeypatch.setattr(reports, "generate", AsyncMock(return_value="Сводка за неделю."))

    result = await generate_report("week")

    assert result.days_requested == 7
    assert result.days_covered == 2
    assert result.coverage_note == "Данные за 2 дн. из 7"
    assert result.text_available is True
    # coverage instruction reached the prompt
    prompt = reports.generate.await_args.args[0]
    assert "2 дн. из 7" in prompt


@pytest.mark.asyncio
async def test_fallback_returns_aggregates_when_gemini_none(monkeypatch):
    now = datetime.now(timezone.utc)
    earliest = now - reports.timedelta(days=1)
    monkeypatch.setattr(
        reports, "_collect_aggregates",
        AsyncMock(return_value=(_aggs(), 120, earliest)),
    )
    monkeypatch.setattr(reports, "generate", AsyncMock(return_value=None))

    result = await generate_report("day")

    assert result.text_available is False
    assert result.summary_text == reports.TEXT_UNAVAILABLE
    assert len(result.aggregates) == 1  # numbers still available for the UI
    assert result.aggregates[0].max == 1600.0


@pytest.mark.asyncio
async def test_no_data_is_honest_and_skips_gemini(monkeypatch):
    monkeypatch.setattr(
        reports, "_collect_aggregates", AsyncMock(return_value=([], 0, None))
    )
    gen = AsyncMock(return_value="выдуманный текст")
    monkeypatch.setattr(reports, "generate", gen)

    result = await generate_report("week")

    assert result.aggregates == []
    assert result.days_covered == 0
    assert "недостаточно" in result.summary_text
    gen.assert_not_awaited()  # no data → no Gemini call


@pytest.mark.asyncio
async def test_cache_prevents_second_gemini_call(monkeypatch):
    now = datetime.now(timezone.utc)
    earliest = now - reports.timedelta(days=1)
    monkeypatch.setattr(
        reports, "_collect_aggregates",
        AsyncMock(return_value=(_aggs(), 120, earliest)),
    )
    gen = AsyncMock(return_value="Сводка.")
    monkeypatch.setattr(reports, "generate", gen)

    await generate_report("day")
    await generate_report("day")

    assert gen.await_count == 1  # second call served from cache
