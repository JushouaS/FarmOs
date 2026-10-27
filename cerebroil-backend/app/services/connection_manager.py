"""
app/services/connection_manager.py
────────────────────────────────────
In-process WebSocket connection registry.

Each batch_id maps to a set of active WebSocket connections.
Broadcast helpers serialise outbound messages to JSON using Pydantic v2
`.model_dump_json()` and fan them out to all connected clients for that batch.

Thread-safety note
──────────────────
FastAPI with uvicorn runs in a single asyncio event loop (single process)
unless you use `--workers N`.  For a multi-worker production setup, replace
this in-process dict with a Redis Pub/Sub backend so workers can exchange
messages.  The interface is kept intentionally narrow so that swap is easy.
"""
from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from typing import DefaultDict, Set
from uuid import UUID

from fastapi import WebSocket
from pydantic import BaseModel

log = logging.getLogger(__name__)


class ConnectionManager:
    """Manages per-batch WebSocket subscriptions and broadcasts."""

    def __init__(self) -> None:
        # batch_id → {websocket, ...}
        self._connections: DefaultDict[UUID, Set[WebSocket]] = defaultdict(set)

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def connect(self, batch_id: UUID, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[batch_id].add(websocket)
        log.info("WS connected  batch=%s  total=%d", batch_id, len(self._connections[batch_id]))

    def disconnect(self, batch_id: UUID, websocket: WebSocket) -> None:
        self._connections[batch_id].discard(websocket)
        if not self._connections[batch_id]:
            del self._connections[batch_id]
        log.info("WS disconnected batch=%s", batch_id)

    # ── Broadcast helpers ─────────────────────────────────────────────────────

    async def broadcast_json(self, batch_id: UUID, message: BaseModel) -> None:
        """Serialise `message` to JSON and send to all clients for `batch_id`."""
        payload = message.model_dump_json()
        dead: list[WebSocket] = []

        for ws in list(self._connections.get(batch_id, set())):
            try:
                await ws.send_text(payload)
            except Exception as exc:           # noqa: BLE001
                log.warning("WS send error (will drop): %s", exc)
                dead.append(ws)

        for ws in dead:
            self.disconnect(batch_id, ws)

    async def broadcast_text(self, batch_id: UUID, text: str) -> None:
        dead: list[WebSocket] = []
        for ws in list(self._connections.get(batch_id, set())):
            try:
                await ws.send_text(text)
            except Exception as exc:           # noqa: BLE001
                log.warning("WS send error (will drop): %s", exc)
                dead.append(ws)
        for ws in dead:
            self.disconnect(batch_id, ws)

    @property
    def subscriber_count(self) -> int:
        return sum(len(s) for s in self._connections.values())


# ── Module-level singleton shared by both routers ─────────────────────────────
manager = ConnectionManager()
