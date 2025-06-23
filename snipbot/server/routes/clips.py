"""FastAPI router for clip management and compilation."""

import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/clips", tags=["clips"])


class CompileRequest(BaseModel):
    """Schema for compiling clips into a highlight reel."""

    clip_ids: list[int] = Field(..., min_length=1, description="IDs of clips to compile")
    title: Optional[str] = Field("highlight_reel", description="Output file title")
    format: Optional[str] = Field("mp4", description="Output format (mp4, webm)")
    transition: Optional[str] = Field(None, description="Transition effect between clips")


@router.get("")
async def list_clips(
    request: Request,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    recording_id: Optional[int] = Query(None, description="Filter by recording ID"),
) -> dict:
    """List all clips with pagination."""
    db = request.app.state.db

    offset = (page - 1) * per_page
    filters: dict = {}
    if recording_id is not None:
        filters["recording_id"] = recording_id

    clips = db.get_clips(limit=per_page, offset=offset, **filters)
    total = db.count_clips(**filters)

    return {
        "items": clips,
        "page": page,
        "per_page": per_page,
        "total": total,
        "pages": (total + per_page - 1) // per_page if total > 0 else 0,
    }


@router.post("/compile", status_code=202)
async def compile_clips(compile_req: CompileRequest, request: Request) -> dict:
    """Compile selected clips into a highlight reel.

    Returns immediately with a job ID; the compilation runs asynchronously.
    """
    db = request.app.state.db

    # Validate that all clip IDs exist
    missing = []
    clip_records = []
    for clip_id in compile_req.clip_ids:
        clip = db.get_clip(clip_id)
        if not clip:
            missing.append(clip_id)
        else:
            clip_records.append(clip)

    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Clips not found: {missing}",
        )

    # Verify all clip files exist on disk
    for clip in clip_records:
        if not os.path.isfile(clip["file_path"]):
            raise HTTPException(
                status_code=410,
                detail=f"Clip file missing from disk: clip_id={clip['id']}",
            )

    # Create a compilation record
    compilation_id = db.save_clip(
        recording_id=clip_records[0]["recording_id"],
        file_path="",  # Will be set once compilation completes
        start_time=0.0,
        end_time=0.0,
        category="compilation",
        metadata={
            "source_clip_ids": compile_req.clip_ids,
            "title": compile_req.title,
            "format": compile_req.format,
            "transition": compile_req.transition,
            "status": "pending",
        },
    )

    # In a real implementation, this would dispatch to a background worker
    # via the scheduler or a task queue.
    ws_manager = request.app.state.ws_manager
    await ws_manager.broadcast("compilation_started", {
        "compilation_id": compilation_id,
        "clip_count": len(compile_req.clip_ids),
        "title": compile_req.title,
    })

    return {
        "compilation_id": compilation_id,
        "status": "pending",
        "clip_count": len(compile_req.clip_ids),
        "message": "Compilation job queued.",
    }


@router.get("/{clip_id}/download")
async def download_clip(clip_id: int, request: Request) -> FileResponse:
    """Download a clip file."""
    db = request.app.state.db
    clip = db.get_clip(clip_id)
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    file_path = clip["file_path"]
    if not file_path or not os.path.isfile(file_path):
        raise HTTPException(status_code=410, detail="Clip file not available on disk")

    filename = os.path.basename(file_path)
    return FileResponse(
        path=file_path,
        filename=filename,
        media_type="application/octet-stream",
    )
