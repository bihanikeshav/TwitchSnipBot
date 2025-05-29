"""CS:GO / CS2 plugin for TwitchSnipBot.

Integrates HLTV match data, game-event detection, and automatic
recording scheduling into the SnipBot pipeline.
"""

from __future__ import annotations

import logging
from typing import Any

from ..base import GameEvent, Plugin, ScheduledRecording
from .events import classify_highlight, detect_csgo_events
from .hltv import fetch_live_matches, fetch_match_events, fetch_upcoming_matches
from .scheduler import CSGOScheduler

logger = logging.getLogger(__name__)


class CSGOPlugin(Plugin):
    """Full-featured CS:GO / CS2 plugin."""

    def __init__(self, config: dict | None = None) -> None:
        self._config = config or {}
        self._scheduler = CSGOScheduler(
            channels=self._config.get("channels"),
        )
        # Cache of events keyed by (start, end) window for deduplication.
        self._event_cache: dict[tuple[float, float], list[GameEvent]] = {}

    # ------------------------------------------------------------------
    # Plugin ABC
    # ------------------------------------------------------------------

    def name(self) -> str:
        return "csgo"

    def version(self) -> str:
        return "0.2.0"

    def extract_features(
        self, messages: list, window_start: float, window_end: float
    ) -> dict:
        """Add CS:GO-specific features to the feature vector.

        Features added:
        - ``csgo_event_count``: number of game events in the window
        - ``csgo_kill_count``: kills detected in the window
        - ``csgo_round_end``: whether a round ended in the window
        - ``csgo_highlight_class``: highlight classification label
        """
        events = self.get_events_in_range(window_start, window_end)

        kill_count = sum(1 for e in events if e.event_type == "kill")
        round_end = any(e.event_type == "round_end" for e in events)
        highlight = classify_highlight(events) if events else "none"

        return {
            "csgo_event_count": len(events),
            "csgo_kill_count": kill_count,
            "csgo_round_end": int(round_end),
            "csgo_highlight_class": highlight,
        }

    def get_events_in_range(
        self, start: float, end: float
    ) -> list[GameEvent]:
        """Return game events in the given time range.

        Attempts to pull events from live HLTV matches when available,
        falling back to cached data.
        """
        cache_key = (start, end)
        if cache_key in self._event_cache:
            return self._event_cache[cache_key]

        events: list[GameEvent] = []
        try:
            live = fetch_live_matches()
            for match in live:
                match_id = match.get("id")
                if match_id is None:
                    continue
                match_events = fetch_match_events(match_id)
                events.extend(
                    e for e in match_events if start <= e.timestamp <= end
                )
        except Exception:
            logger.debug(
                "Could not fetch live HLTV events", exc_info=True
            )

        self._event_cache[cache_key] = events
        return events

    def enrich_moment(self, moment: Any) -> None:
        """Attach CS:GO context to a detected moment."""
        start = getattr(moment, "start", None)
        end = getattr(moment, "end", None)
        if start is None or end is None:
            return

        events = self.get_events_in_range(start, end)
        if not events:
            return

        kills = [e for e in events if e.event_type == "kill"]
        rounds = [e for e in events if e.event_type in ("round_start", "round_end")]
        detected = detect_csgo_events(kills, rounds)

        if not hasattr(moment, "metadata"):
            moment.metadata = {}

        moment.metadata["csgo_events"] = [
            {"type": e.event_type, "timestamp": e.timestamp, "data": e.data}
            for e in detected
        ]
        moment.metadata["csgo_highlight"] = classify_highlight(detected)

    def generate_metadata(self, moment: Any) -> dict:
        """Produce clip metadata from a moment's CS:GO context."""
        meta: dict = {}
        csgo_meta = getattr(moment, "metadata", {})

        if "csgo_highlight" in csgo_meta:
            meta["highlight_type"] = csgo_meta["csgo_highlight"]

        csgo_events = csgo_meta.get("csgo_events", [])
        if csgo_events:
            meta["event_types"] = list({e["type"] for e in csgo_events})
            meta["event_count"] = len(csgo_events)

        return meta

    def get_upcoming_recordings(self) -> list[ScheduledRecording]:
        """Delegate to the HLTV-backed scheduler."""
        return self._scheduler.get_upcoming_recordings()
