"""FastAPI router for HLTV match tracking and recording scheduling."""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/matches", tags=["matches"])

# ---------------------------------------------------------------------------
# In a production setup these would come from an HLTV scraper or API client.
# Here we define placeholder data structures and stubs that the rest of the
# codebase can call into.
# ---------------------------------------------------------------------------


class MatchInfo(BaseModel):
    """Represents an HLTV match."""

    match_id: int
    team1: str
    team2: str
    event: str
    start_time: str
    stream_channel: Optional[str] = None
    status: str = "upcoming"  # upcoming | live | finished


class RecordMatchRequest(BaseModel):
    """Request body for scheduling a recording tied to a match."""

    channel: Optional[str] = Field(
        None,
        description="Override Twitch channel. If omitted, uses match stream_channel.",
    )
    pre_buffer_minutes: int = Field(
        5,
        ge=0,
        le=60,
        description="Minutes before match start to begin recording",
    )
    post_buffer_minutes: int = Field(
        15,
        ge=0,
        le=120,
        description="Minutes after expected end to keep recording",
    )


# ---------------------------------------------------------------------------
# Stub match data source — replace with real HLTV integration.
# ---------------------------------------------------------------------------
_STUB_MATCHES: list[dict] = []


def _get_matches(status: str) -> list[dict]:
    """Return matches filtered by status.

    In production this would query an HLTV scraper service.
    """
    return [m for m in _STUB_MATCHES if m.get("status") == status]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/upcoming")
async def list_upcoming_matches(
    request: Request,
    limit: int = Query(20, ge=1, le=100),
) -> list[dict]:
    """List upcoming HLTV matches."""
    matches = _get_matches("upcoming")
    return matches[:limit]


@router.get("/live")
async def list_live_matches(request: Request) -> list[dict]:
    """List currently live HLTV matches."""
    return _get_matches("live")


@router.post("/{match_id}/record", status_code=201)
async def schedule_recording_for_match(
    match_id: int,
    body: RecordMatchRequest,
    request: Request,
) -> dict:
    """Schedule a recording for an HLTV match.

    Resolves the Twitch stream channel from the match metadata (or uses the
    override provided in the request body) and creates a recording schedule
    entry with appropriate pre/post buffers.
    """
    # Look up match
    match = next((m for m in _STUB_MATCHES if m.get("match_id") == match_id), None)

    if match is None:
        raise HTTPException(status_code=404, detail=f"Match {match_id} not found")

    channel = body.channel or match.get("stream_channel")
    if not channel:
        raise HTTPException(
            status_code=400,
            detail="No stream channel associated with this match and none provided.",
        )

    # Calculate start/end with buffers
    match_start = datetime.fromisoformat(match["start_time"])
    from datetime import timedelta

    recording_start = match_start - timedelta(minutes=body.pre_buffer_minutes)

    # Estimate match duration (CS matches ~90 min on average)
    estimated_duration_minutes = 90
    recording_end = match_start + timedelta(
        minutes=estimated_duration_minutes + body.post_buffer_minutes
    )

    db = request.app.state.db
    recording_id = db.save_recording(
        channel=channel,
        start_time=recording_start.isoformat(),
        end_time=recording_end.isoformat(),
        status="scheduled",
    )

    # Broadcast via WebSocket
    ws_manager = request.app.state.ws_manager
    await ws_manager.broadcast("match_recording_scheduled", {
        "recording_id": recording_id,
        "match_id": match_id,
        "channel": channel,
        "team1": match.get("team1"),
        "team2": match.get("team2"),
        "recording_start": recording_start.isoformat(),
        "recording_end": recording_end.isoformat(),
    })

    return {
        "recording_id": recording_id,
        "match_id": match_id,
        "channel": channel,
        "recording_start": recording_start.isoformat(),
        "recording_end": recording_end.isoformat(),
        "status": "scheduled",
    }
