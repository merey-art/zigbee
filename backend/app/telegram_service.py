"""Send messages via Telegram Bot API."""

from __future__ import annotations

import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


async def send_telegram_message(
    chat_id: str,
    text: str,
    *,
    parse_mode: str = "HTML",
    disable_notification: bool | None = None,
) -> None:
    token = (settings.telegram_bot_token or "").strip()
    if not token:
        raise RuntimeError("Telegram bot is not configured (set TELEGRAM_BOT_TOKEN)")

    cid = chat_id.strip()
    body: dict[str, object] = {"chat_id": cid, "text": text, "parse_mode": parse_mode}
    if disable_notification is not None:
        body["disable_notification"] = disable_notification

    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json=body,
        )
        if r.status_code != 200:
            logger.warning("Telegram sendMessage failed: %s %s", r.status_code, r.text[:400])
            raise RuntimeError(f"Telegram API error: {r.text[:200]}")
