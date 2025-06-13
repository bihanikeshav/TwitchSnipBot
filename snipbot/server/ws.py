"""WebSocket handler for live status updates."""

import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages connected WebSocket clients and broadcasts events."""

    def __init__(self) -> None:
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        """Accept a new WebSocket connection and register it."""
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(
            "WebSocket client connected. Total connections: %d",
            len(self.active_connections),
        )

    def disconnect(self, websocket: WebSocket) -> None:
        """Unregister a WebSocket connection."""
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info(
            "WebSocket client disconnected. Total connections: %d",
            len(self.active_connections),
        )

    async def send_personal(self, websocket: WebSocket, event_type: str, data: Any) -> None:
        """Send a message to a single client."""
        message = _build_message(event_type, data)
        await websocket.send_text(json.dumps(message))

    async def broadcast(self, event_type: str, data: Any) -> None:
        """Broadcast an event to all connected clients.

        Supported event types include (but are not limited to):
          - recording_status: recording started / stopped / error
          - highlight_detected: a new highlight was detected in the live stream
          - pipeline_progress: progress update from the processing pipeline
          - compilation_started: a clip compilation job was queued
          - match_recording_scheduled: a match recording was scheduled
        """
        message = _build_message(event_type, data)
        payload = json.dumps(message)

        stale: list[WebSocket] = []
        for connection in self.active_connections:
            try:
                await connection.send_text(payload)
            except Exception:
                logger.warning("Failed to send to a WebSocket client; marking stale.")
                stale.append(connection)

        # Clean up broken connections
        for conn in stale:
            self.disconnect(conn)


def _build_message(event_type: str, data: Any) -> dict:
    """Build a standardised WebSocket message envelope."""
    return {
        "event": event_type,
        "data": data,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# Module-level singleton so the rest of the application can import and use it.
manager = ConnectionManager()


async def websocket_endpoint(websocket: WebSocket) -> None:
    """WebSocket endpoint handler mounted on the FastAPI app.

    Keeps the connection alive and listens for optional client messages
    (e.g., pings, subscription filters). Server-to-client communication
    happens primarily through ``manager.broadcast``.
    """
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive — process any incoming client messages.
            data = await websocket.receive_text()
            try:
                message = json.loads(data)
            except json.JSONDecodeError:
                await manager.send_personal(
                    websocket, "error", {"detail": "Invalid JSON"}
                )
                continue

            # Handle client-side pings
            if message.get("event") == "ping":
                await manager.send_personal(websocket, "pong", {})
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        logger.exception("Unexpected error in WebSocket handler")
        manager.disconnect(websocket)
