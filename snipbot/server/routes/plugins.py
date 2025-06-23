"""FastAPI router for plugin management."""

import json
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/plugins", tags=["plugins"])


class PluginUpdate(BaseModel):
    """Schema for enabling/disabling a plugin or updating its config."""

    enabled: Optional[bool] = Field(None, description="Enable or disable the plugin")
    config: Optional[dict] = Field(None, description="Plugin configuration overrides")


@router.get("")
async def list_plugins(request: Request) -> list[dict]:
    """List all registered plugins with name, version, and enabled status."""
    db = request.app.state.db
    plugin_states = db.get_plugin_states()

    return [
        {
            "name": ps["name"],
            "version": ps["version"],
            "enabled": bool(ps["enabled"]),
            "config": json.loads(ps["config"]) if isinstance(ps["config"], str) else ps["config"],
        }
        for ps in plugin_states
    ]


@router.put("/{plugin_name}")
async def update_plugin(plugin_name: str, update: PluginUpdate, request: Request) -> dict:
    """Enable/disable a plugin or update its configuration."""
    db = request.app.state.db
    plugin = db.get_plugin_state(plugin_name)
    if not plugin:
        raise HTTPException(status_code=404, detail=f"Plugin '{plugin_name}' not found")

    updates: dict = {}
    if update.enabled is not None:
        updates["enabled"] = int(update.enabled)
    if update.config is not None:
        updates["config"] = json.dumps(update.config)

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    db.update_plugin_state(plugin_name, **updates)

    # Update in-memory registry
    registry = request.app.state.plugin_registry
    if plugin_name in registry:
        if update.enabled is not None:
            registry[plugin_name]["enabled"] = update.enabled
        if update.config is not None:
            registry[plugin_name]["config"] = update.config

    updated = db.get_plugin_state(plugin_name)
    return {
        "name": updated["name"],
        "version": updated["version"],
        "enabled": bool(updated["enabled"]),
        "config": json.loads(updated["config"]) if isinstance(updated["config"], str) else updated["config"],
    }
