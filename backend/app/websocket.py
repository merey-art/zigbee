"""
WebSocket connection manager.

Clients connect to /ws and receive JSON payloads whenever a new MQTT message
arrives.  The mqtt_listener calls `broadcast()` directly.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._active: list[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._active.append(ws)
        logger.info("WebSocket client connected. Total: %d", len(self._active))

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            self._active = [c for c in self._active if c is not ws]
        logger.info("WebSocket client disconnected. Total: %d", len(self._active))

    async def broadcast(self, payload: dict[str, Any]) -> None:
        """Send `payload` as JSON to every connected client."""
        if not self._active:
            return
        message = json.dumps(payload)
        dead: list[WebSocket] = []
        async with self._lock:
            clients = list(self._active)
        for ws in clients:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        # Clean up stale connections
        if dead:
            async with self._lock:
                self._active = [c for c in self._active if c not in dead]


manager = ConnectionManager()
