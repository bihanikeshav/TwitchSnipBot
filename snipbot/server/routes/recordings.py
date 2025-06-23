"""FastAPI router for recording schedule CRUD operations."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/recordings", tags=["recordings"])


class RecordingCreate(BaseModel):
    """Schema for creating a new recording."""

    channel: str = Field(..., min_length=1, description="Twitch channel name")
    start_time: datetime = Field(..., description="Scheduled start time (ISO 8601)")
    end_time: Optional[datetime] = Field(None, description="Optional scheduled end time")


class RecordingUpdate(BaseModel):
    """Schema for updating an existing recording."""

    channel: Optional[str] = Field(None, min_length=1)
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None


class RecordingResponse(BaseModel):
    """Schema for recording response."""

    id: int
    channel: str
    start_time: str
    end_time: Optional[str]
    status: str
    created_at: str


@router.get("")
async def list_recordings(request: Request) -> list[dict]:
    """List all scheduled recordings."""
    db = request.app.state.db
    recordings = db.get_recordings()
    return recordings


@router.post("", status_code=201)
async def create_recording(recording: RecordingCreate, request: Request) -> dict:
    """Create a new scheduled recording."""
    db = request.app.state.db

    if recording.end_time and recording.end_time <= recording.start_time:
        raise HTTPException(
            status_code=400,
            detail="end_time must be after start_time",
        )

    recording_id = db.save_recording(
        channel=recording.channel,
        start_time=recording.start_time.isoformat(),
        end_time=recording.end_time.isoformat() if recording.end_time else None,
        status="scheduled",
    )

    return {
        "id": recording_id,
        "channel": recording.channel,
        "start_time": recording.start_time.isoformat(),
        "end_time": recording.end_time.isoformat() if recording.end_time else None,
        "status": "scheduled",
    }


@router.delete("/{recording_id}")
async def delete_recording(recording_id: int, request: Request) -> dict:
    """Delete a recording by ID."""
    db = request.app.state.db
    recording = db.get_recording(recording_id)
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    if recording["status"] == "recording":
        raise HTTPException(
            status_code=409,
            detail="Cannot delete an active recording. Stop it first.",
        )

    db.delete_recording(recording_id)
    return {"detail": "Recording deleted", "id": recording_id}


@router.put("/{recording_id}")
async def update_recording(
    recording_id: int, update: RecordingUpdate, request: Request
) -> dict:
    """Update an existing recording."""
    db = request.app.state.db
    recording = db.get_recording(recording_id)
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    if recording["status"] == "recording":
        raise HTTPException(
            status_code=409,
            detail="Cannot update an active recording.",
        )

    updates: dict = {}
    if update.channel is not None:
        updates["channel"] = update.channel
    if update.start_time is not None:
        updates["start_time"] = update.start_time.isoformat()
    if update.end_time is not None:
        updates["end_time"] = update.end_time.isoformat()

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    # Validate time ordering if both times are resolved
    new_start = updates.get("start_time", recording["start_time"])
    new_end = updates.get("end_time", recording.get("end_time"))
    if new_end and new_start and new_end <= new_start:
        raise HTTPException(
            status_code=400,
            detail="end_time must be after start_time",
        )

    db.update_recording(recording_id, **updates)
    updated = db.get_recording(recording_id)
    return updated


@router.get("/{recording_id}/status")
async def get_recording_status(recording_id: int, request: Request) -> dict:
    """Get the status of a specific recording."""
    db = request.app.state.db
    recording = db.get_recording(recording_id)
    if not recording:
        raise HTTPException(status_code=404, detail="Recording not found")

    return {
        "id": recording["id"],
        "channel": recording["channel"],
        "status": recording["status"],
        "start_time": recording["start_time"],
        "end_time": recording.get("end_time"),
    }
