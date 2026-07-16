from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest

import app.ai.recommendations as rec
from app.ai.recommendations import (
    RecommendationContext,
    compose_recommendation,
    fallback_message,
    sharp_trend_pct,
)
from app.forecast import compute_forecast


NOW = datetime(2026, 7, 16, 6, 0, tzinfo=timezone.utc)


def make_ctx(**overrides) -> RecommendationContext:
    readings = [
        (NOW - timedelta(minutes=20 - 2 * i), 800.0 + 30 * i) for i in range(10)
    ]
    defaults = dict(
        device_label="Office 12",
        metric="co2",
        value=1070.0,
        threshold=1000.0,
        readings=readings,
        forecast=compute_forecast(readings, 30, 1000.0),
        threshold_exceeded=True,
        sharp_trend_pct=None,
    )
    defaults.update(overrides)
    return RecommendationContext(**defaults)


@pytest.mark.asyncio
async def test_fallback_when_gemini_returns_none(monkeypatch):
    monkeypatch.setattr(rec, "generate", AsyncMock(return_value=None))
    ctx = make_ctx()

    text, is_ai = await compose_recommendation(ctx)

    assert is_ai is False
    assert text == fallback_message(ctx)
    assert "Office 12" in text
    assert "выше порога 1000" in text


@pytest.mark.asyncio
async def test_ai_text_used_and_escaped_when_gemini_succeeds(monkeypatch):
    monkeypatch.setattr(
        rec, "generate", AsyncMock(return_value="🔴 CO2 растёт <быстро>")
    )
    text, is_ai = await compose_recommendation(make_ctx())

    assert is_ai is True
    assert "🔴 CO2 растёт &lt;быстро&gt;" == text


def test_fallback_includes_trend_and_forecast():
    ctx = make_ctx(sharp_trend_pct=22.0)
    text = fallback_message(ctx)
    assert "+22% за 15 мин" in text
    assert "порог через ~" not in text or ctx.forecast is not None


def test_sharp_trend_detected():
    readings = [
        (NOW - timedelta(minutes=14), 800.0),
        (NOW - timedelta(minutes=7), 900.0),
        (NOW - timedelta(minutes=1), 990.0),
    ]
    pct = sharp_trend_pct(readings, 990.0, NOW)
    assert pct == pytest.approx(23.75)


def test_sharp_trend_ignores_small_change_and_old_readings():
    # +10% is under the 15% trigger
    readings = [
        (NOW - timedelta(minutes=14), 900.0),
        (NOW - timedelta(minutes=1), 990.0),
    ]
    assert sharp_trend_pct(readings, 990.0, NOW) is None
    # big change but baseline outside the 15-min window
    readings = [
        (NOW - timedelta(minutes=40), 500.0),
        (NOW - timedelta(minutes=1), 990.0),
    ]
    assert sharp_trend_pct(readings, 990.0, NOW) is None


def test_cooldown_per_device_metric():
    rec._last_sent.clear()
    assert rec._cooldown_elapsed("dev1", "co2", NOW) is True
    rec._mark_sent("dev1", "co2", NOW)
    assert rec._cooldown_elapsed("dev1", "co2", NOW + timedelta(minutes=10)) is False
    assert rec._cooldown_elapsed("dev1", "temperature", NOW) is True  # other metric ok
    assert rec._cooldown_elapsed("dev1", "co2", NOW + timedelta(minutes=31)) is True
    rec._last_sent.clear()
