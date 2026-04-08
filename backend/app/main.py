"""
FastAPI application entry-point.

Startup sequence:
  1. Create DB tables (DDL).
  2. Promote sensor_readings to a TimescaleDB hypertable.
  3. Launch the MQTT listener as a background asyncio task.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api import router as api_router
from app.config import settings
from app.database import Base, engine
from app.models import HYPERTABLE_SQL
from app.mqtt_listener import run_mqtt_listener
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
    # 1. Create tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 2. Create TimescaleDB hypertable (idempotent)
    try:
        async with engine.begin() as conn:
            await conn.execute(text(HYPERTABLE_SQL))
        logger.info("TimescaleDB hypertable ensured.")
    except Exception as exc:
        # TimescaleDB extension may not be available in plain PG dev setups
        logger.warning("Could not create hypertable (TimescaleDB unavailable?): %s", exc)

    # 3. Start MQTT listener
    asyncio.create_task(run_mqtt_listener())
    logger.info("MQTT listener task started.")


@app.on_event("shutdown")
async def shutdown() -> None:
    await engine.dispose()


# ── REST routes ────────────────────────────────────────────────────────────────

app.include_router(api_router)


# ── WebSocket endpoint ─────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await manager.connect(ws)
    try:
        # Keep the connection alive; the client can send pings if desired.
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(ws)
