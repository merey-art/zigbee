"""Current-user profile (Telegram link)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_deps import get_current_user
from app.database import get_db
from app.models import User
from app.telegram_service import send_telegram_message

router = APIRouter(prefix="/me", tags=["me"])


class MeProfile(BaseModel):
    email: str
    telegram_chat_id: str | None

    model_config = {"from_attributes": True}


class MeTelegramPatch(BaseModel):
    """Set to empty string or null to unlink Telegram."""

    telegram_chat_id: str | None = None


@router.get("", response_model=MeProfile)
async def get_me(current: Annotated[User, Depends(get_current_user)]) -> MeProfile:
    return MeProfile.model_validate(current)


@router.patch("", response_model=MeProfile)
async def patch_me(
    body: MeTelegramPatch,
    db: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[User, Depends(get_current_user)],
) -> MeProfile:
    if body.telegram_chat_id is not None:
        v = body.telegram_chat_id.strip()
        current.telegram_chat_id = v if v else None
    await db.commit()
    await db.refresh(current)
    return MeProfile.model_validate(current)


@router.post("/telegram/test", status_code=status.HTTP_200_OK)
async def telegram_test(current: Annotated[User, Depends(get_current_user)]) -> dict[str, str]:
    chat = (current.telegram_chat_id or "").strip()
    if not chat:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Сначала сохраните Telegram chat ID в профиле",
        )
    try:
        await send_telegram_message(
            chat,
            "✅ <b>Zigbee dashboard</b>\nТестовое сообщение. Уведомления настроены.",
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    return {"status": "ok"}
