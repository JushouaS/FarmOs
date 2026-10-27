"""
app/api/websockets.py
──────────────────────
WebSocket endpoint: /ws/batches/{batch_id}/live

Protocol
────────
1.  Client connects and sends an optional JSON dict:
        {"api_key": "<key>"}
    The server validates the key.  If invalid, it sends an ErrorMessage
    and closes the connection with code 1008 (Policy Violation).

2.  On successful authentication the server sends a ConnectionAckMessage.

3.  After that the server pushes messages proactively:
      • LiveFrameMessage  – broadcast from the telemetry ingest endpoint
      • LiveAlertMessage  – broadcast from alert_rules when an alert is raised

4.  The server silently ignores any further text/bytes from the client
    (it is a push-only feed).

5.  On disconnect (network error or client close) the connection is
    removed from the manager.

Note on alert broadcasting
──────────────────────────
Alert broadcasting from the rule engine is wired in the telemetry router
which calls `ws_manager.broadcast_json(batch_id, LiveAlertMessage(...))`.
This file only needs to manage the connection lifecycle.
"""
from __future__ import annotations

import asyncio
import json
import logging
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from app.config import get_settings
from app.schemas.websocket import ConnectionAckMessage, ErrorMessage
from app.services.connection_manager import manager as ws_manager

log = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter()


@router.websocket("/ws/batches/{batch_id}/live")
async def ws_batch_live(
    websocket: WebSocket,
    batch_id: UUID,
) -> None:
    """
    Real-time live feed for a batch.
    Clients connect here to receive LiveFrameMessage and LiveAlertMessage pushes.
    """
    # ── 1. Authenticate ───────────────────────────────────────────────────────
    # Accept first so we can send a close frame with a reason.
    await websocket.accept()

    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
        data = json.loads(raw)
        api_key: str = data.get("api_key", "")
    except Exception:
        api_key = ""

    if api_key not in settings.api_key_set:
        await websocket.send_text(
            ErrorMessage(detail="Invalid or missing api_key.").model_dump_json()
        )
        await websocket.close(code=1008)
        log.warning("WS rejected – bad api_key batch=%s", batch_id)
        return

    # ── 2. Register connection ────────────────────────────────────────────────
    # We already called accept() manually above, so we bypass
    # manager.connect() (which calls accept() again) and add directly.
    ws_manager._connections[batch_id].add(websocket)
    log.info("WS authenticated batch=%s", batch_id)

    await websocket.send_text(
        ConnectionAckMessage(batch_id=batch_id).model_dump_json()
    )

    # ── 3. Keep-alive receive loop ────────────────────────────────────────────
    # We don't process inbound messages but we must keep the coroutine alive
    # so the connection stays open.  Any incoming data is silently dropped.
    try:
        while True:
            # receive_text() will raise WebSocketDisconnect when the client
            # disconnects, which exits the loop cleanly.
            await websocket.receive_text()
    except WebSocketDisconnect:
        log.info("WS disconnected batch=%s", batch_id)
    except Exception as exc:                   # noqa: BLE001
        log.warning("WS error batch=%s: %s", batch_id, exc)
    finally:
        ws_manager.disconnect(batch_id, websocket)
