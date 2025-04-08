"""Historical log parsers for offline / batch analysis.

Supported formats
-----------------
1. **IRC format** (``chat.log``, ``map1.log``):
   ``2022-07-17_22:27:43 — :username!username@username.tmi.twitch.tv PRIVMSG #channel :message``

2. **BLAST format**:
   ``[H:MM:SS] username: message``

3. **HLTV JSON**:
   Array of event objects such as ``{"Kill": {...}}``, ``{"RoundStart": {}}``.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Union

from snipbot.ingestion.message import ChatMessage
from snipbot.plugins.base import GameEvent


# ---------------------------------------------------------------------------
# Known Twitch emotes (shared with irc_live for consistency)
# ---------------------------------------------------------------------------

_KNOWN_EMOTES = frozenset({
    "Kappa", "PogChamp", "LUL", "LULW", "OMEGALUL", "Kreygasm",
    "BibleThump", "ResidentSleeper", "Jebaited", "monkaS", "monkaW",
    "PepeHands", "FeelsBadMan", "FeelsGoodMan", "KEKW", "PogU",
    "Pog", "Sadge", "EZ", "COPIUM", "HOPIUM", "Clap", "catJAM",
    "pepeLaugh", "Pepega", "widepeepoHappy", "peepoClap",
    "HeyGuys", "VoHiYo", "SeemsGood", "NotLikeThis", "WutFace",
    "CoolStoryBob", "DansGame", "TriHard", "4Head", "cmonBruh",
})


def _detect_emotes(text: str) -> list[str]:
    """Return sorted list of known emotes found in *text*."""
    tokens = set(text.split())
    return sorted(tokens & _KNOWN_EMOTES)


# ---------------------------------------------------------------------------
# IRC log parser
# ---------------------------------------------------------------------------

# 2022-07-17_22:27:43 — :nick!nick@nick.tmi.twitch.tv PRIVMSG #channel :msg
_IRC_LINE_RE = re.compile(
    r"^(?P<ts>\d{4}-\d{2}-\d{2}_\d{2}:\d{2}:\d{2})\s+—\s+"
    r":(?P<nick>[^!]+)!\S+\s+"
    r"PRIVMSG\s+#(?P<channel>\S+)\s+"
    r":(?P<text>.*)$"
)


def parse_irc_log(filepath: Union[str, Path]) -> list[ChatMessage]:
    """Parse an IRC-format chat log into a list of ChatMessages.

    Parameters:
        filepath: Path to the log file.

    Returns:
        List of :class:`ChatMessage` sorted by timestamp.
    """
    filepath = Path(filepath)
    messages: list[ChatMessage] = []

    with filepath.open("r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue

            match = _IRC_LINE_RE.match(line)
            if match is None:
                continue

            ts_str = match.group("ts")  # 2022-07-17_22:27:43
            nick = match.group("nick")
            channel = match.group("channel")
            text = match.group("text")

            # Parse the timestamp into a Unix epoch (UTC assumed).
            dt = datetime.strptime(ts_str, "%Y-%m-%d_%H:%M:%S").replace(
                tzinfo=timezone.utc,
            )
            timestamp = dt.timestamp()

            # Detect /me action.
            is_action = False
            if text.startswith("\x01ACTION ") and text.endswith("\x01"):
                text = text[8:-1]
                is_action = True

            messages.append(
                ChatMessage(
                    username=nick,
                    text=text,
                    timestamp=timestamp,
                    channel=channel,
                    emotes=_detect_emotes(text),
                    is_action=is_action,
                )
            )

    return messages


# ---------------------------------------------------------------------------
# BLAST log parser
# ---------------------------------------------------------------------------

# [H:MM:SS] username: message
_BLAST_LINE_RE = re.compile(
    r"^\[(?P<time>\d{1,2}:\d{2}:\d{2})\]\s+(?P<nick>[^:]+):\s+(?P<text>.*)$"
)


def parse_blast_log(
    filepath: Union[str, Path],
    base_timestamp: float = 0.0,
) -> list[ChatMessage]:
    """Parse a BLAST-format chat log into a list of ChatMessages.

    BLAST logs use *relative* ``[H:MM:SS]`` timestamps.  The
    ``base_timestamp`` parameter is added to each relative offset to
    produce a Unix epoch value.

    Parameters:
        filepath:       Path to the log file.
        base_timestamp: Unix epoch seconds to add to each relative time.

    Returns:
        List of :class:`ChatMessage` sorted by computed timestamp.
    """
    filepath = Path(filepath)
    messages: list[ChatMessage] = []

    with filepath.open("r", encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue

            match = _BLAST_LINE_RE.match(line)
            if match is None:
                continue

            time_str = match.group("time")  # H:MM:SS
            nick = match.group("nick").strip()
            text = match.group("text")

            parts = time_str.split(":")
            hours, minutes, seconds = int(parts[0]), int(parts[1]), int(parts[2])
            relative_seconds = hours * 3600 + minutes * 60 + seconds
            timestamp = base_timestamp + relative_seconds

            messages.append(
                ChatMessage(
                    username=nick,
                    text=text,
                    timestamp=timestamp,
                    channel="",
                    emotes=_detect_emotes(text),
                    is_action=False,
                )
            )

    return messages


# ---------------------------------------------------------------------------
# HLTV JSON parser
# ---------------------------------------------------------------------------


def parse_hltv_json(filepath: Union[str, Path]) -> list[GameEvent]:
    """Parse an HLTV JSON event log into a list of GameEvents.

    Each element in the top-level JSON array is expected to be a
    single-key object like ``{"Kill": {...}}``.  The key becomes the
    :attr:`GameEvent.event_type` and the value becomes :attr:`GameEvent.data`.

    Parameters:
        filepath: Path to the JSON file.

    Returns:
        List of :class:`GameEvent` in file order, with sequential
        ``event_id`` values starting at 0.
    """
    filepath = Path(filepath)

    with filepath.open("r", encoding="utf-8") as fh:
        raw = json.load(fh)

    if not isinstance(raw, list):
        raise ValueError(
            f"Expected a JSON array at the top level, got {type(raw).__name__}"
        )

    events: list[GameEvent] = []
    for idx, entry in enumerate(raw):
        if isinstance(entry, dict) and len(entry) == 1:
            event_type = next(iter(entry))
            data = entry[event_type]
            if not isinstance(data, dict):
                data = {"value": data}
        elif isinstance(entry, dict):
            # Multiple keys — use the full dict as data, type = "Unknown".
            event_type = "Unknown"
            data = entry
        else:
            event_type = "Unknown"
            data = {"value": entry}

        events.append(GameEvent(event_type=event_type, timestamp=float(idx), data=data))

    return events
