"""Auto-generate YouTube upload metadata from detected moments.

Builds title, description, and tags based on detected highlight
moments, the source channel, and optional plugin context (e.g. game
name, tournament info).
"""

from __future__ import annotations

import datetime
from typing import Any


def _format_timestamp(seconds: float) -> str:
    """Convert seconds to ``MM:SS`` or ``H:MM:SS`` format."""
    total = int(seconds)
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours > 0:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def _pluralise(word: str, count: int) -> str:
    return word if count == 1 else word + "s"


def _build_title(
    channel: str,
    categories: list[str],
    game: str | None,
    date_str: str,
) -> str:
    """Build a concise video title."""
    parts: list[str] = []

    if game:
        parts.append(game)

    # Summarise categories.
    unique_cats = list(dict.fromkeys(categories))  # preserve order, dedupe
    if unique_cats:
        label = " & ".join(unique_cats[:3])
        parts.append(f"{label} highlights")
    else:
        parts.append("highlights")

    parts.append(f"- {channel}")
    parts.append(f"({date_str})")

    title = " ".join(parts)
    # YouTube enforces 100-character max.
    if len(title) > 100:
        title = title[:97] + "..."
    return title


def _build_description(
    moments: list[Any],
    channel: str,
    game: str | None,
) -> str:
    """Build a description with chapter timestamps."""
    lines: list[str] = []

    lines.append(f"Highlights from {channel}'s stream.")
    if game:
        lines.append(f"Game: {game}")
    lines.append("")

    # Timestamp chapter markers (YouTube auto-chapters require starting
    # at 0:00, so we include that).
    lines.append("Timestamps:")
    for i, moment in enumerate(moments, 1):
        ts = moment.get("vod_position", moment.get("timestamp", 0))
        cat = moment.get("category", "highlight")
        score = moment.get("score")
        label = f"#{i} {cat.capitalize()}"
        if score is not None:
            label += f" (score {score:.0%})"
        lines.append(f"  {_format_timestamp(ts)} — {label}")

    lines.append("")
    lines.append(
        "Detected and clipped automatically by TwitchSnipBot "
        "(github.com/TwitchSnipBot)"
    )
    return "\n".join(lines)


def _build_tags(
    channel: str,
    categories: list[str],
    game: str | None,
    extra: list[str] | None = None,
) -> list[str]:
    """Build a list of keyword tags for the upload."""
    tags: list[str] = [
        "Twitch",
        "highlights",
        channel,
    ]

    if game:
        tags.append(game)

    for cat in dict.fromkeys(categories):
        tags.append(cat)

    # Common general tags.
    tags.extend(["stream highlights", "best moments", "auto clip"])

    if extra:
        tags.extend(extra)

    # Deduplicate while preserving order.
    seen: set[str] = set()
    unique: list[str] = []
    for tag in tags:
        normalised = tag.strip().lower()
        if normalised and normalised not in seen:
            seen.add(normalised)
            unique.append(tag.strip())

    # YouTube allows up to 500 characters total in tags.
    result: list[str] = []
    char_count = 0
    for tag in unique:
        if char_count + len(tag) + 1 > 500:
            break
        result.append(tag)
        char_count += len(tag) + 1  # +1 for comma separator

    return result


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def generate_metadata(
    moments: list,
    channel: str,
    plugin_context: dict | None = None,
) -> dict[str, Any]:
    """Generate upload metadata from a list of detected moments.

    Parameters
    ----------
    moments:
        List of detected moments.  Each item may be a dict or any
        object exposing ``category``, ``detection_score``,
        ``timestamp``, and ``metadata`` attributes (e.g. a
        :class:`~snipbot.pipeline.moment.DetectedMoment`).
    channel:
        The Twitch channel name.
    plugin_context:
        Optional dict with extra context from a game plugin.  May
        contain ``"game"``, ``"tournament"``, ``"extra_tags"``, etc.

    Returns
    -------
    dict:
        Keys: ``"title"``, ``"description"``, ``"tags"``.
    """
    ctx = plugin_context or {}
    game: str | None = ctx.get("game")

    # Normalise moments into dicts.
    normalised: list[dict] = []
    for m in moments:
        if isinstance(m, dict):
            normalised.append(m)
        else:
            normalised.append({
                "category": getattr(m, "category", "other"),
                "score": getattr(m, "detection_score", 0.0),
                "timestamp": getattr(m, "timestamp", 0.0),
                "vod_position": getattr(m, "metadata", {}).get(
                    "vod_position",
                    getattr(m, "timestamp", 0.0),
                ),
            })

    categories = [d.get("category", "other") for d in normalised]
    date_str = datetime.date.today().isoformat()

    title = _build_title(channel, categories, game, date_str)
    description = _build_description(normalised, channel, game)
    tags = _build_tags(
        channel,
        categories,
        game,
        extra=ctx.get("extra_tags"),
    )

    return {
        "title": title,
        "description": description,
        "tags": tags,
    }
