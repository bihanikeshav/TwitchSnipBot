"""Automatic recording scheduler backed by HLTV match data.

Maps upcoming HLTV CS:GO / CS2 matches to Twitch broadcast channels
so that SnipBot can start recording before a match begins.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from ..base import ScheduledRecording
from .hltv import fetch_upcoming_matches

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Known tournament-organiser -> Twitch channel mappings
# ---------------------------------------------------------------------------

_DEFAULT_CHANNEL_MAP: dict[str, str] = {
    # BLAST
    "BLAST": "blasttv",
    "BLAST Premier": "blasttv",
    "BLAST Premier Spring": "blasttv",
    "BLAST Premier Fall": "blasttv",
    "BLAST Premier World Final": "blasttv",
    "BLAST.tv": "blasttv",
    # ESL
    "ESL": "esl_csgo",
    "ESL Pro League": "esl_csgo",
    "ESL One": "esl_csgo",
    "IEM": "esl_csgo",
    "Intel Extreme Masters": "esl_csgo",
    "ESL Challenger": "esl_csgo",
    # PGL
    "PGL": "paborern",
    "PGL Major": "pgl",
    # FACEIT
    "FACEIT": "faborern",
    "FPL": "faceitdota",
    "ECS": "faceitdota",
    # WePlay
    "WePlay": "weplayesport_en",
    # Flashpoint
    "Flashpoint": "flashpoint",
    # ESEA
    "ESEA": "esabornen",
    # StarLadder
    "StarLadder": "starladder_cs_en",
    "StarSeries": "starladder_cs_en",
    # DreamHack
    "DreamHack": "dreamhackcs",
    # BetBoom
    "BetBoom": "betboom_en",
    # CCT
    "CCT": "cabornen",
    # Roobet
    "Roobet Cup": "roobetcup",
    # Perfect World
    "Perfect World": "pwabornen",
    # Valve Major
    "Major": "pgl",
}

# Pre-match buffer (seconds) — start recording this long before the
# scheduled start so we don't miss the opening.
_PRE_MATCH_BUFFER = 5 * 60  # 5 minutes

# Post-match buffer — keep recording after expected end.
_POST_MATCH_BUFFER = 30 * 60  # 30 minutes

# Estimated match duration when no end time is available.
_ESTIMATED_MATCH_DURATION = 2 * 60 * 60  # 2 hours (BO3 average)


class CSGOScheduler:
    """Converts HLTV upcoming matches into ``ScheduledRecording`` items."""

    def __init__(
        self,
        channel_map: dict[str, str] | None = None,
        channels: list[str] | None = None,
        pre_buffer: float = _PRE_MATCH_BUFFER,
        post_buffer: float = _POST_MATCH_BUFFER,
    ) -> None:
        self._channel_map = {**_DEFAULT_CHANNEL_MAP, **(channel_map or {})}
        self._allowed_channels = set(channels) if channels else None
        self._pre_buffer = pre_buffer
        self._post_buffer = post_buffer

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def get_upcoming_recordings(
        self, channels: list[str] | None = None,
    ) -> list[ScheduledRecording]:
        """Fetch upcoming HLTV matches and convert to scheduled recordings.

        Parameters
        ----------
        channels:
            Optional whitelist of Twitch channel names.  When provided,
            only matches that map to one of these channels are returned.
            Falls back to the instance-level whitelist if not given.
        """
        allowed = set(channels) if channels else self._allowed_channels

        try:
            matches = fetch_upcoming_matches()
        except Exception:
            logger.error("Failed to fetch upcoming HLTV matches", exc_info=True)
            return []

        recordings: list[ScheduledRecording] = []
        now = time.time()

        for match in matches:
            channel = self._resolve_channel(match)
            if channel is None:
                logger.debug(
                    "No channel mapping for event '%s'", match.get("event", "?")
                )
                continue

            if allowed and channel not in allowed:
                continue

            start_time = match.get("start_time", 0.0)
            if start_time <= 0:
                continue

            # Skip matches that are already well past their expected end.
            estimated_end = start_time + _ESTIMATED_MATCH_DURATION
            if estimated_end + self._post_buffer < now:
                continue

            teams = match.get("teams", [])
            title = " vs ".join(teams[:2]) if len(teams) >= 2 else "Unknown match"
            event_name = match.get("event", "")
            if event_name:
                title = f"{title} | {event_name}"

            rec_start = start_time - self._pre_buffer
            rec_end = estimated_end + self._post_buffer

            recordings.append(
                ScheduledRecording(
                    channel=channel,
                    start_time=rec_start,
                    end_time=rec_end,
                    title=title,
                    metadata={
                        "match_id": match.get("id"),
                        "teams": teams,
                        "event": event_name,
                        "match_url": match.get("match_url", ""),
                        "hltv_start": start_time,
                    },
                )
            )

        # Sort by start time so the caller can iterate chronologically.
        recordings.sort(key=lambda r: r.start_time)
        return recordings

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _resolve_channel(self, match: dict[str, Any]) -> str | None:
        """Map an HLTV match to a Twitch channel name.

        Tries exact match first, then prefix / substring matching against
        the channel map keys.
        """
        event_name: str = match.get("event", "")
        if not event_name:
            return None

        # Exact match
        if event_name in self._channel_map:
            return self._channel_map[event_name]

        # Case-insensitive exact match
        event_lower = event_name.lower()
        for key, channel in self._channel_map.items():
            if key.lower() == event_lower:
                return channel

        # Prefix / substring match (longest key wins to prefer specificity).
        best_match: str | None = None
        best_len = 0
        for key, channel in self._channel_map.items():
            key_lower = key.lower()
            if key_lower in event_lower and len(key_lower) > best_len:
                best_match = channel
                best_len = len(key_lower)

        return best_match
