"""FastAPI application for TwitchSnipBot."""

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from snipbot.server.routes.recordings import router as recordings_router
from snipbot.server.routes.highlights import router as highlights_router
from snipbot.server.routes.clips import router as clips_router
from snipbot.server.routes.plugins import router as plugins_router
from snipbot.server.routes.matches import router as matches_router
from snipbot.server.ws import manager, websocket_endpoint
from snipbot.storage.database import Database


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan: initialize resources on startup, clean up on shutdown."""
    # Startup
    db = Database()
    app.state.db = db

    # Initialize plugin registry from database state
    plugin_states = db.get_plugin_states()
    app.state.plugin_registry = {
        ps["name"]: {
            "name": ps["name"],
            "version": ps["version"],
            "enabled": bool(ps["enabled"]),
            "config": ps["config"],
        }
        for ps in plugin_states
    }

    app.state.ws_manager = manager

    yield

    # Shutdown
    for connection in list(manager.active_connections):
        await connection.close()
    manager.active_connections.clear()


app = FastAPI(
    title="TwitchSnipBot",
    description="Automated Twitch stream recording, highlight detection, and clip compilation.",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware — allow all origins for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include route routers
app.include_router(recordings_router)
app.include_router(highlights_router)
app.include_router(clips_router)
app.include_router(plugins_router)
app.include_router(matches_router)

# Mount WebSocket endpoint
app.websocket("/ws")(websocket_endpoint)


@app.get("/api/health")
async def health_check() -> dict:
    """Basic health check endpoint."""
    return {"status": "ok"}
