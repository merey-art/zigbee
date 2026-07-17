"""Telegram bot: receives incoming messages via long polling (getUpdates).

Commands:
  /start — returns the chat_id for dashboard registration
Free text from a registered user (matched by telegram_chat_id) goes to the
AI "chat with data" feature. Runs as a background asyncio task; message
handling is spawned per-update so polling never blocks sensor ingestion.
"""

from __future__ import annotations

import asyncio
import html
import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy import select

from app.ai.chat import answer_question
from app.config import settings
from app.database import AsyncSessionLocal
from app.models import User
from app.telegram_service import send_telegram_message

logger = logging.getLogger(__name__)

POLL_TIMEOUT = 30  # long-poll seconds
RATE_LIMIT_SECONDS = 5.0  # min interval between questions per chat

UNKNOWN_USER_MSG = (
    "Вы не зарегистрированы в системе. Отправьте /start, скопируйте свой "
    "chat_id и укажите его в профиле дашборда — после этого я смогу отвечать "
    "на вопросы о датчиках."
)
RATE_LIMIT_MSG = "Слишком много запросов — подождите несколько секунд и повторите."
START_MSG = (
    "👋 Это бот мониторинга Zigbee.\n"
    "Ваш chat_id: <b>{chat_id}</b>\n"
    "Укажите его в профиле дашборда, чтобы получать уведомления и "
    "задавать вопросы о датчиках (например: «Как воздух на 3 этаже?»)."
)
UNKNOWN_COMMAND_MSG = (
    "Доступна команда /start. Зарегистрированные пользователи могут просто "
    "написать вопрос о датчиках свободным текстом."
)

_last_question_at: dict[str, datetime] = {}


async def _find_user_by_chat(chat_id: str) -> User | None:
    async with AsyncSessionLocal() as session:
        return await session.scalar(
            select(User).where(User.telegram_chat_id == chat_id)
        )


def _rate_limited(chat_id: str, now: datetime) -> bool:
    last = _last_question_at.get(chat_id)
    if last is not None and (now - last).total_seconds() < RATE_LIMIT_SECONDS:
        return True
    _last_question_at[chat_id] = now
    return False


async def handle_text_message(chat_id: str, text: str) -> str:
    """Route one incoming message; returns the reply text (no Telegram I/O)."""
    text = text.strip()

    if text.startswith("/"):
        if text.split()[0].split("@")[0] == "/start":
            return START_MSG.format(chat_id=html.escape(chat_id))
        return UNKNOWN_COMMAND_MSG

    user = await _find_user_by_chat(chat_id)
    if user is None:
        return UNKNOWN_USER_MSG

    if _rate_limited(chat_id, datetime.now(timezone.utc)):
        return RATE_LIMIT_MSG

    logger.info("Chat question from user %s (%s): %.120s", user.id, chat_id, text)
    answer = await answer_question(text)
    return html.escape(answer)


async def _handle_update(update: dict) -> None:
    try:
        msg = update.get("message") or {}
        chat_id = str((msg.get("chat") or {}).get("id") or "").strip()
        text = msg.get("text") or ""
        if not chat_id or not text:
            return
        reply = await handle_text_message(chat_id, text)
        await send_telegram_message(chat_id, reply)
    except Exception:
        logger.exception("Telegram update handling failed: %s", update.get("update_id"))


async def run_telegram_bot() -> None:
    """Runs forever; long-polls getUpdates and spawns a task per message."""
    token = (settings.telegram_bot_token or "").strip()
    if not token:
        logger.info("TELEGRAM_BOT_TOKEN not set — Telegram bot polling disabled.")
        return

    url = f"https://api.telegram.org/bot{token}/getUpdates"
    offset = 0
    error_delay = 5
    logger.info("Telegram bot polling started.")

    while True:
        try:
            async with httpx.AsyncClient(timeout=POLL_TIMEOUT + 10) as client:
                r = await client.get(
                    url,
                    params={
                        "timeout": POLL_TIMEOUT,
                        "offset": offset,
                        "allowed_updates": '["message"]',
                    },
                )
            if r.status_code != 200:
                logger.warning("getUpdates error %s: %s", r.status_code, r.text[:200])
                await asyncio.sleep(error_delay)
                error_delay = min(error_delay * 2, 60)
                continue
            error_delay = 5

            for update in r.json().get("result", []):
                offset = max(offset, int(update.get("update_id", 0)) + 1)
                asyncio.create_task(_handle_update(update))

        except asyncio.CancelledError:
            logger.info("Telegram bot polling cancelled.")
            break
        except Exception as exc:
            logger.warning("Telegram polling error: %s. Retrying in %ds…", exc, error_delay)
            await asyncio.sleep(error_delay)
            error_delay = min(error_delay * 2, 60)
