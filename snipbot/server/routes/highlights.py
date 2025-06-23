"""FastAPI router for highlight browsing."""

from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request

router = APIRouter(prefix="/api/highlights", tags=["highlights"])


@router.get("")
async def list_highlights(
    request: Request,
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(20, ge=1, le=100, description="Items per page"),
    category: Optional[str] = Query(None, description="Filter by highlight category"),
    recording_id: Optional[int] = Query(None, description="Filter by recording ID"),
) -> dict:
    """List detected highlights with pagination and optional category filter."""
    db = request.app.state.db

    filters: dict = {}
    if category:
        filters["category"] = category
    if recording_id is not None:
        filters["recording_id"] = recording_id

    offset = (page - 1) * per_page
    highlights = db.get_highlights(limit=per_page, offset=offset, **filters)
    total = db.count_highlights(**filters)

    return {
        "items": highlights,
        "page": page,
        "per_page": per_page,
        "total": total,
        "pages": (total + per_page - 1) // per_page if total > 0 else 0,
    }


@router.get("/{highlight_id}")
async def get_highlight(highlight_id: int, request: Request) -> dict:
    """Get detail for a specific highlight."""
    db = request.app.state.db
    highlight = db.get_highlight(highlight_id)
    if not highlight:
        raise HTTPException(status_code=404, detail="Highlight not found")
    return highlight
