"""Cookie-based JWT authentication."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth_deps import create_access_token, get_current_user, verify_password
from app.config import settings
from app.database import get_db
from app.models import User

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    email: str

    model_config = {"from_attributes": True}


@router.post("/login")
async def login(
    body: LoginBody,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserOut:
    result = await db.execute(select(User).where(User.email == body.email.strip().lower()))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    token = create_access_token(user.id)
    response.set_cookie(
        key=settings.jwt_cookie_name,
        value=token,
        httponly=True,
        samesite="lax",
        path="/",
        max_age=60 * settings.jwt_expire_minutes,
    )
    return UserOut.model_validate(user)


@router.post("/logout")
async def logout(response: Response) -> dict[str, str]:
    response.delete_cookie(key=settings.jwt_cookie_name, path="/")
    return {"status": "ok"}


@router.get("/me", response_model=UserOut)
async def me(current: Annotated[User, Depends(get_current_user)]) -> UserOut:
    return UserOut.model_validate(current)
