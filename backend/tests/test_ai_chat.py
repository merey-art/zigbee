from unittest.mock import AsyncMock

import pytest

import app.ai.chat as chat
import app.telegram_bot as bot
from app.ai.chat import ChatIntent, answer_question, parse_intent
from app.telegram_bot import handle_text_message


# ── Intent parsing ─────────────────────────────────────────────────────────────


def test_parse_intent_floor_metric_and_window():
    intent = parse_intent("Как воздух на 3 этаже?")
    assert intent.floor == 3
    assert intent.metrics == ["co2"]
    assert intent.window_hours == 24.0

    intent = parse_intent("Что было с CO2 час назад?")
    assert intent.metrics == ["co2"]
    assert intent.window_hours == 2.0

    intent = parse_intent("температура за 3 часа")
    assert intent.metrics == ["temperature"]
    assert intent.window_hours == 3.0


def test_parse_intent_defaults():
    intent = parse_intent("что происходит?")
    assert intent.metrics == ["co2", "temperature", "humidity"]
    assert intent.window_hours == 24.0
    assert intent.floor is None


# ── Grounding: no data → honest answer, no Gemini call ─────────────────────────


@pytest.mark.asyncio
async def test_no_data_gives_honest_answer_without_fabrication(monkeypatch):
    gen = AsyncMock(return_value="выдуманный ответ с числами")
    monkeypatch.setattr(chat, "generate", gen)
    monkeypatch.setattr(chat, "build_data_context", AsyncMock(return_value=[]))

    answer = await answer_question("Как воздух на 99 этаже?")

    assert answer == chat.NO_DATA_MSG
    gen.assert_not_awaited()  # no data → Gemini not even called


@pytest.mark.asyncio
async def test_gemini_none_gives_polite_fallback(monkeypatch):
    monkeypatch.setattr(chat, "generate", AsyncMock(return_value=None))
    monkeypatch.setattr(
        chat, "build_data_context",
        AsyncMock(return_value=["Офис 12 — CO₂: мин 400 / макс 900 / средн 600 ppm"]),
    )

    answer = await answer_question("Как воздух?")

    assert answer == chat.GEMINI_FAIL_MSG


@pytest.mark.asyncio
async def test_answer_uses_gemini_when_data_present(monkeypatch):
    gen = AsyncMock(return_value="Воздух в норме: средний CO₂ 600 ppm.")
    monkeypatch.setattr(chat, "generate", gen)
    monkeypatch.setattr(
        chat, "build_data_context",
        AsyncMock(return_value=["Офис 12 — CO₂: мин 400 / макс 900 / средн 600 ppm"]),
    )

    answer = await answer_question("Как воздух?")

    assert answer == "Воздух в норме: средний CO₂ 600 ppm."
    prompt = gen.await_args.args[0]
    assert "Офис 12" in prompt  # data context reached the prompt


# ── Bot routing ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_unknown_chat_id_is_rejected(monkeypatch):
    monkeypatch.setattr(bot, "_find_user_by_chat", AsyncMock(return_value=None))
    ask = AsyncMock()
    monkeypatch.setattr(bot, "answer_question", ask)

    reply = await handle_text_message("999999", "Как воздух?")

    assert reply == bot.UNKNOWN_USER_MSG
    ask.assert_not_awaited()  # no data access for unknown users


@pytest.mark.asyncio
async def test_start_returns_chat_id_without_registration():
    reply = await handle_text_message("12345", "/start")
    assert "12345" in reply


@pytest.mark.asyncio
async def test_rate_limit_per_chat(monkeypatch):
    from types import SimpleNamespace

    bot._last_question_at.clear()
    user = SimpleNamespace(id=1)
    monkeypatch.setattr(bot, "_find_user_by_chat", AsyncMock(return_value=user))
    monkeypatch.setattr(bot, "answer_question", AsyncMock(return_value="ответ"))

    first = await handle_text_message("42", "Как воздух?")
    second = await handle_text_message("42", "А сейчас?")

    assert first == "ответ"
    assert second == bot.RATE_LIMIT_MSG
    bot._last_question_at.clear()
