"""HLTV match-data fetcher for the CS:GO plugin.

Provides helpers that pull upcoming / live match information from HLTV
and parse locally stored HLTV JSON log files into ``GameEvent`` objects.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

import httpx

from ..base import GameEvent

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

HLTV_BASE_URL = "https://www.hltv.org"
_DEFAULT_TIMEOUT = 15.0
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)
_HEADERS = {
    "User-Agent": _USER_AGENT,
    "Accept": "application/json, text/html",
    "Referer": HLTV_BASE_URL,
}


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


def _get_client() -> httpx.Client:
    """Return a pre-configured ``httpx.Client``."""
    return httpx.Client(
        base_url=HLTV_BASE_URL,
        headers=_HEADERS,
        timeout=_DEFAULT_TIMEOUT,
        follow_redirects=True,
    )


def _safe_get(client: httpx.Client, url: str) -> dict | list | None:
    """Perform a GET and return parsed JSON, or ``None`` on failure."""
    try:
        resp = client.get(url)
        resp.raise_for_status()
        return resp.json()
    except (httpx.HTTPStatusError, httpx.RequestError, json.JSONDecodeError) as exc:
        logger.warning("HLTV request failed (%s): %s", url, exc)
        return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def fetch_upcoming_matches() -> list[dict[str, Any]]:
    """Fetch upcoming CS matches from HLTV.

    .. warning::
        HLTV does not provide a public JSON API.  These endpoints are
        best-effort and may return empty results or fail with 403.

    Returns a list of dicts, each containing:
    - ``teams``: list of two team-name strings
    - ``event``: tournament / event name
    - ``start_time``: UNIX timestamp (float)
    - ``match_url``: full URL to the match page
    - ``id``: HLTV match id (int or str)
    """
    logger.warning(
        "HLTV has no public API — fetch_upcoming_matches may return empty "
        "results.  Use local HLTV JSON logs via parse_hltv_log() instead."
    )
    with _get_client() as client:
        raw = _safe_get(client, "/api/matches")
        if not raw:
            logger.info("No upcoming-match data returned from HLTV")
            return []

    matches: list[dict[str, Any]] = []
    items = raw if isinstance(raw, list) else raw.get("matches", raw.get("data", []))
    for item in items:
        try:
            match = _normalise_match(item)
            if match:
                matches.append(match)
        except Exception:
            logger.debug("Skipping malformed match entry", exc_info=True)
    return matches


def fetch_live_matches() -> list[dict[str, Any]]:
    """Fetch currently live CS matches from HLTV.

    .. warning::
        HLTV does not provide a public JSON API.  These endpoints are
        best-effort and may return empty results or fail with 403.

    Return format matches ``fetch_upcoming_matches`` with the addition of
    a ``live: True`` flag.
    """
    logger.warning(
        "HLTV has no public API — fetch_live_matches may return empty "
        "results.  Use local HLTV JSON logs via parse_hltv_log() instead."
    )
    with _get_client() as client:
        raw = _safe_get(client, "/api/livematches")
        if not raw:
            logger.info("No live-match data returned from HLTV")
            return []

    matches: list[dict[str, Any]] = []
    items = raw if isinstance(raw, list) else raw.get("matches", raw.get("data", []))
    for item in items:
        try:
            match = _normalise_match(item)
            if match:
                match["live"] = True
                matches.append(match)
        except Exception:
            logger.debug("Skipping malformed live-match entry", exc_info=True)
    return matches


def fetch_match_events(match_id: int | str) -> list[GameEvent]:
    """Fetch round-by-round events for a specific HLTV match.

    .. warning::
        HLTV does not provide a public JSON API.  This endpoint is
        best-effort and may fail.

    Returns a list of ``GameEvent`` objects derived from the HLTV match
    detail / log endpoint.
    """
    logger.warning(
        "HLTV has no public API — fetch_match_events may fail.  "
        "Use local HLTV JSON logs via parse_hltv_log() instead."
    )
    with _get_client() as client:
        raw = _safe_get(client, f"/api/matches/{match_id}/events")
        if not raw:
            return []

    items = raw if isinstance(raw, list) else raw.get("events", raw.get("data", []))
    return _parse_event_list(items)


def parse_hltv_log(filepath: str | Path) -> list[GameEvent]:
    """Parse a local HLTV JSON log file into ``GameEvent`` objects.

    The expected format is an array of objects where each object has
    exactly one key indicating the event type (``Kill``, ``RoundStart``,
    ``RoundEnd``, ``BombPlanted``, etc.) and the value is a dict of
    event data.

    Example::

        [
          {"RoundStart": {}},
          {"Kill": {"killerName": "s1mple", ...}},
          {"RoundEnd": {"winner": "CT", ...}}
        ]
    """
    path = Path(filepath)
    if not path.exists():
        raise FileNotFoundError(f"HLTV log file not found: {path}")

    with open(path, "r", encoding="utf-8") as fh:
        raw: list[dict] = json.load(fh)

    if not isinstance(raw, list):
        raise ValueError("Expected a JSON array at the top level")

    return _parse_event_list(raw)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

# Event-type key normalisation map  (HLTV key -> canonical event_type).
_EVENT_TYPE_MAP: dict[str, str] = {
    "Kill": "kill",
    "kill": "kill",
    "RoundStart": "round_start",
    "roundStart": "round_start",
    "round_start": "round_start",
    "RoundEnd": "round_end",
    "roundEnd": "round_end",
    "round_end": "round_end",
    "BombPlanted": "bomb_planted",
    "bombPlanted": "bomb_planted",
    "bomb_planted": "bomb_planted",
    "BombDefused": "bomb_defused",
    "bombDefused": "bomb_defused",
    "bomb_defused": "bomb_defused",
    "PlayerDeath": "kill",
}


def _parse_event_list(items: list[dict]) -> list[GameEvent]:
    """Convert a list of raw event dicts to ``GameEvent`` objects.

    Each *item* is expected to be either:
    1. A single-key dict like ``{"Kill": {<data>}}``  (HLTV log style), or
    2. A flat dict with an ``event_type`` / ``type`` field  (API style).

    Events are assigned incrementing pseudo-timestamps based on their
    position so that ordering is preserved even when real timestamps are
    absent.
    """
    events: list[GameEvent] = []
    base_ts = time.time()

    for idx, item in enumerate(items):
        if not isinstance(item, dict):
            continue

        event_type: str | None = None
        data: dict = {}

        # Style 1: single-key wrapper  ({"Kill": {...}})
        if len(item) == 1:
            raw_key = next(iter(item))
            canonical = _EVENT_TYPE_MAP.get(raw_key, raw_key.lower())
            event_type = canonical
            value = item[raw_key]
            data = value if isinstance(value, dict) else {}
        else:
            # Style 2: flat dict with a type discriminator
            raw_type = item.get("event_type") or item.get("type")
            if raw_type:
                event_type = _EVENT_TYPE_MAP.get(raw_type, str(raw_type).lower())
                data = {k: v for k, v in item.items() if k not in ("event_type", "type")}
            else:
                # Try single-key heuristic for dicts that also carry extra
                # metadata keys.
                for key in item:
                    if key in _EVENT_TYPE_MAP:
                        event_type = _EVENT_TYPE_MAP[key]
                        value = item[key]
                        data = value if isinstance(value, dict) else {}
                        break

        if event_type is None:
            logger.debug("Unrecognised event entry: %s", item)
            continue

        # Use ``eventId`` as a pseudo-timestamp when available (higher =
        # earlier in HLTV logs), otherwise fall back to index order.
        timestamp = float(data.get("eventId", base_ts + idx))

        events.append(GameEvent(event_type=event_type, timestamp=timestamp, data=data))

    return events


def _normalise_match(item: dict) -> dict[str, Any] | None:
    """Normalise a raw HLTV match dict into a standard shape."""
    # Try several common key layouts.
    match_id = item.get("id") or item.get("matchId") or item.get("match_id")

    teams_raw = item.get("teams") or item.get("team1", item.get("team2"))
    if isinstance(teams_raw, list):
        teams = [
            t.get("name", t.get("teamName", str(t))) if isinstance(t, dict) else str(t)
            for t in teams_raw[:2]
        ]
    elif "team1" in item and "team2" in item:
        t1 = item["team1"]
        t2 = item["team2"]
        teams = [
            t1.get("name", str(t1)) if isinstance(t1, dict) else str(t1),
            t2.get("name", str(t2)) if isinstance(t2, dict) else str(t2),
        ]
    else:
        teams = []

    if not teams or len(teams) < 2:
        return None

    event_name = ""
    event_raw = item.get("event") or item.get("tournament")
    if isinstance(event_raw, dict):
        event_name = event_raw.get("name", "")
    elif isinstance(event_raw, str):
        event_name = event_raw

    start_time = item.get("start_time") or item.get("startTime") or item.get("date", 0)
    if isinstance(start_time, str):
        try:
            start_time = float(start_time)
        except ValueError:
            start_time = 0.0

    match_url_path = item.get("matchUrl") or item.get("url") or ""
    if match_url_path and not match_url_path.startswith("http"):
        match_url = f"{HLTV_BASE_URL}{match_url_path}"
    else:
        match_url = match_url_path

    return {
        "id": match_id,
        "teams": teams,
        "event": event_name,
        "start_time": float(start_time),
        "match_url": match_url,
    }
