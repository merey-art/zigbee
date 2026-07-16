"""Reusable async Google Gemini client.

Shared by all AI features (recommendations, chat, reports). Never raises into
the caller: missing key, rate limits, or API errors all yield ``None`` so AI
stays an enhancement, not a point of failure.
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
from datetime import date, datetime, timezone
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

GEMINI_MODEL = "gemini-2.5-flash"
API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent"
)
MAX_RETRIES = 3
REQUEST_TIMEOUT = 30

# Free-tier guard: rough daily request budget with an early warning.
FREE_TIER_DAILY_LIMIT = 250
WARN_THRESHOLD = int(FREE_TIER_DAILY_LIMIT * 0.8)

_requests_today = 0
_counter_day: date | None = None


def _api_key() -> str:
    return (settings.gemini_api_key or os.environ.get("GEMINI_API_KEY", "")).strip()


def _bump_request_counter() -> int:
    """Per-day in-memory counter; warns as we approach the free-tier limit."""
    global _requests_today, _counter_day
    today = datetime.now(timezone.utc).date()
    if _counter_day != today:
        _counter_day = today
        _requests_today = 0
    _requests_today += 1
    if _requests_today == WARN_THRESHOLD or _requests_today >= FREE_TIER_DAILY_LIMIT:
        logger.warning(
            "Gemini request count today: %d (free-tier limit ~%d)",
            _requests_today,
            FREE_TIER_DAILY_LIMIT,
        )
    return _requests_today


def _extract_text(data: dict[str, Any]) -> str | None:
    try:
        parts = data["candidates"][0]["content"]["parts"]
        text = "".join(p.get("text", "") for p in parts).strip()
        return text or None
    except (KeyError, IndexError, TypeError):
        return None


async def generate(prompt: str, system: str | None = None) -> str | None:
    """One-shot text generation. Returns None on any failure (never raises)."""
    key = _api_key()
    if not key:
        logger.debug("GEMINI_API_KEY not set — skipping Gemini call")
        return None

    body: dict[str, Any] = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
    }
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}

    delay = 1.0
    for attempt in range(MAX_RETRIES + 1):
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
                r = await client.post(
                    API_URL,
                    params={"key": key},
                    json=body,
                )
        except Exception as exc:
            logger.warning("Gemini request failed (attempt %d): %s", attempt + 1, exc)
            if attempt >= MAX_RETRIES:
                return None
            await asyncio.sleep(delay + random.uniform(0, delay))
            delay *= 2
            continue

        if r.status_code == 429:
            logger.warning("Gemini rate-limited (429), attempt %d", attempt + 1)
            if attempt >= MAX_RETRIES:
                return None
            # Exponential backoff with jitter
            await asyncio.sleep(delay + random.uniform(0, delay))
            delay *= 2
            continue

        if r.status_code != 200:
            logger.warning("Gemini API error %s: %s", r.status_code, r.text[:300])
            return None

        _bump_request_counter()
        text = _extract_text(r.json())
        if text is None:
            logger.warning("Gemini returned no text (blocked or empty candidate)")
        return text

    return None
