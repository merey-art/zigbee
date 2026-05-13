"""Evaluate alert rules when a new sensor reading is stored."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Dict, Tuple

from sqlalchemy import or_, select

from app.bridge_devices_store import display_label_for_canonical
from app.config import settings
from app.database import AsyncSessionLocal
from app.models import AlertRule, User
from app.telegram_service import send_telegram_message

logger = logging.getLogger(__name__)

_last_fired: Dict[Tuple[int, str], datetime] = {}


def _cooldown_elapsed(rule_id: int, device_id: str, cooldown_seconds: int) -> bool:
    key = (rule_id, device_id)
    last = _last_fired.get(key)
    if last is None:
        return True
    delta = (datetime.now(timezone.utc) - last).total_seconds()
    return delta >= cooldown_seconds


def _mark_fired(rule_id: int, device_id: str) -> None:
    _last_fired[(rule_id, device_id)] = datetime.now(timezone.utc)


async def notify_metric_alerts(device_id: str, metric: str, value: float) -> None:
    if not (settings.telegram_bot_token or "").strip():
        return

    async with AsyncSessionLocal() as session:
        stmt = (
            select(AlertRule, User)
            .join(User, AlertRule.user_id == User.id)
            .where(
                AlertRule.enabled.is_(True),
                AlertRule.metric == metric,
                User.telegram_chat_id.isnot(None),
                User.telegram_chat_id != "",
            )
            .where(or_(AlertRule.device_id.is_(None), AlertRule.device_id == device_id))
        )
        rows = (await session.execute(stmt)).all()

        label = await display_label_for_canonical(device_id)
        device_label = label if label else device_id

        for rule, user in rows:
            if rule.direction == "above":
                triggered = value > rule.threshold
            elif rule.direction == "below":
                triggered = value < rule.threshold
            else:
                continue
            if not triggered:
                continue
            if not _cooldown_elapsed(rule.id, device_id, rule.cooldown_seconds):
                continue
            chat = (user.telegram_chat_id or "").strip()
            if not chat:
                continue
            dir_word = "выше" if rule.direction == "above" else "ниже"
            msg = (
                f"⚠️ <b>Zigbee</b>\n"
                f"Устройство: {device_label}\n"
                f"{metric}: <b>{value:g}</b> ({dir_word} порога {rule.threshold:g})"
            )
            try:
                await send_telegram_message(chat, msg)
                _mark_fired(rule.id, device_id)
            except Exception as exc:
                logger.warning("Alert rule %s Telegram failed: %s", rule.id, exc)
