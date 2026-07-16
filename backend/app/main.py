"""
FastAPI application entry-point.

Startup sequence:
  1. Create DB tables (DDL).
  2. Seed admin user if `users` is empty.
  3. Promote sensor_readings to a TimescaleDB hypertable.
  4. Launch the MQTT listener as a background asyncio task.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select, text

from app.alert_events_routes import router as alert_events_router
from app.alert_routes import router as alert_router
from app.api import router as api_router
from app.auth_deps import hash_password, ws_user_from_cookies
from app.auth_routes import router as auth_router
from app.bridge_routes import router as bridge_router
from app.companies_routes import router as companies_router
from app.emergency_routes import router as emergency_router
from app.profile_routes import router as profile_router
from app.reports_routes import router as reports_router
from app.config import settings
from app.database import AsyncSessionLocal, Base, engine
from app.emergency_detector import hydrate_detector_state_from_db
from app.models import HYPERTABLE_SQL, User
from app.mqtt_listener import run_mqtt_listener
from app.users_routes import router as users_router
from app.websocket import manager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Zigbee Sensor Dashboard", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Lifecycle ──────────────────────────────────────────────────────────────────


@app.on_event("startup")
async def startup() -> None:
    # 1. Create tables + additive column for existing DBs
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id VARCHAR(32);")
        )
        await conn.execute(
            text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS co2_device_id VARCHAR(128);")
        )
        await conn.execute(
            text("ALTER TABLE companies ADD COLUMN IF NOT EXISTS temp_device_id VARCHAR(128);")
        )
        await conn.execute(
            text("CREATE UNIQUE INDEX IF NOT EXISTS ix_emergency_events_active_key ON emergency_events (key) WHERE status IN ('active', 'acknowledged');")
        )

    # 2. Seed admin if no users
    async with AsyncSessionLocal() as session:
        n = await session.scalar(select(func.count()).select_from(User))
        if n == 0:
            session.add(
                User(
                    email=settings.admin_email.strip().lower(),
                    hashed_password=hash_password(settings.admin_password),
                )
            )
            await session.commit()
            logger.info("Seeded initial admin user %s", settings.admin_email)

    # 3. Create TimescaleDB hypertable (idempotent)
    try:
        async with engine.begin() as conn:
            await conn.execute(text(HYPERTABLE_SQL))
        logger.info("TimescaleDB hypertable ensured.")
    except Exception as exc:
        # TimescaleDB extension may not be available in plain PG dev setups
        logger.warning("Could not create hypertable (TimescaleDB unavailable?): %s", exc)

    # 4. Hydrate emergency detector from active DB rows
    await hydrate_detector_state_from_db()

    # 5. Start MQTT listener
    asyncio.create_task(run_mqtt_listener())
    logger.info("MQTT listener task started.")


@app.on_event("shutdown")
async def shutdown() -> None:
    await engine.dispose()


# ── REST routes ────────────────────────────────────────────────────────────────

app.include_router(companies_router)
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(profile_router)
app.include_router(alert_router)
app.include_router(alert_events_router)
app.include_router(emergency_router)
app.include_router(reports_router)
app.include_router(bridge_router)
app.include_router(api_router)


# ── WebSocket endpoint ─────────────────────────────────────────────────────────


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    async with AsyncSessionLocal() as session:
        user = await ws_user_from_cookies(dict(ws.cookies), session)
    if user is None:
        await ws.close(code=1008)
        return

    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(ws)
