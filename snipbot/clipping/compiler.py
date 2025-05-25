"""Compile individual highlight clips into a single highlight reel.

Uses ffmpeg-python to concatenate clips with optional crossfade
transitions and optional intro/outro segments.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Literal

import ffmpeg  # ffmpeg-python

logger = logging.getLogger(__name__)

# Category priority used for ``order_by='category'`` sorting.
_CATEGORY_PRIORITY: dict[str, int] = {
    "exciting": 0,
    "funny": 1,
    "surprising": 2,
    "other": 3,
}


# ---------------------------------------------------------------------------
# Clip ordering
# ---------------------------------------------------------------------------


def order_clips(
    clips: list[dict],
    order_by: str = "category",
) -> list[dict]:
    """Sort a list of clip metadata dicts.

    Parameters
    ----------
    clips:
        Each dict should contain at minimum ``"path"`` and optionally
        ``"category"``, ``"timestamp"``, ``"score"``.
    order_by:
        Sorting strategy — one of ``"category"``, ``"chronological"``,
        or ``"score"``.

    Returns
    -------
    list[dict]:
        A new sorted list (the original is not mutated).
    """
    if order_by == "category":
        return sorted(
            clips,
            key=lambda c: (
                _CATEGORY_PRIORITY.get(c.get("category", "other"), 99),
                c.get("timestamp", 0),
            ),
        )

    if order_by == "chronological":
        return sorted(clips, key=lambda c: c.get("timestamp", 0))

    if order_by == "score":
        return sorted(
            clips,
            key=lambda c: c.get("score", 0),
            reverse=True,
        )

    logger.warning("Unknown order_by=%r, falling back to chronological", order_by)
    return sorted(clips, key=lambda c: c.get("timestamp", 0))


# ---------------------------------------------------------------------------
# Compilation
# ---------------------------------------------------------------------------


def _probe_duration(path: str) -> float:
    """Return the duration of a media file in seconds."""
    try:
        info = ffmpeg.probe(path)
        return float(info["format"]["duration"])
    except Exception:
        logger.warning("Could not probe duration for %s, assuming 10s", path)
        return 10.0


def compile_highlights(
    clip_paths: list[str],
    output_path: str,
    transition: str = "crossfade",
    transition_duration: float = 0.5,
    intro_path: str | None = None,
    outro_path: str | None = None,
) -> Path:
    """Concatenate clips into a highlight reel with transitions.

    Parameters
    ----------
    clip_paths:
        Ordered list of clip file paths to include.
    output_path:
        Destination path for the compiled highlight video.
    transition:
        Transition type between clips.  Currently supports
        ``"crossfade"`` and ``"none"`` (hard cut).
    transition_duration:
        Duration of each transition in seconds (ignored when
        *transition* is ``"none"``).
    intro_path:
        Optional path to an intro video prepended before the first clip.
    outro_path:
        Optional path to an outro video appended after the last clip.

    Returns
    -------
    Path:
        The resolved *output_path* on success.

    Raises
    ------
    ValueError:
        If *clip_paths* is empty.
    ffmpeg.Error:
        If ffmpeg fails during compilation.
    """
    if not clip_paths:
        raise ValueError("clip_paths must contain at least one clip")

    dest = Path(output_path)
    dest.parent.mkdir(parents=True, exist_ok=True)

    # Build full segment list: intro + clips + outro.
    all_paths: list[str] = []
    if intro_path is not None:
        all_paths.append(intro_path)
    all_paths.extend(clip_paths)
    if outro_path is not None:
        all_paths.append(outro_path)

    if len(all_paths) == 1 or transition == "none":
        # Simple concatenation (no transitions).
        return _concat_simple(all_paths, str(dest))

    return _concat_with_crossfade(all_paths, str(dest), transition_duration)


def _concat_simple(paths: list[str], output_path: str) -> Path:
    """Concatenate clips with hard cuts using the concat demuxer."""
    import tempfile

    dest = Path(output_path)

    # Write a temporary concat list file.
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".txt", delete=False
    ) as tmp:
        for p in paths:
            # Escape single quotes for the ffmpeg concat demuxer.
            safe = Path(p).resolve().as_posix().replace("'", "'\\''")
            tmp.write(f"file '{safe}'\n")
        list_file = tmp.name

    try:
        (
            ffmpeg
            .input(list_file, f="concat", safe=0)
            .output(str(dest), c="copy")
            .overwrite_output()
            .run(quiet=True)
        )
    finally:
        Path(list_file).unlink(missing_ok=True)

    logger.info("Compiled %d segment(s) (hard cut) -> %s", len(paths), dest)
    return dest.resolve()


def _concat_with_crossfade(
    paths: list[str],
    output_path: str,
    duration: float,
) -> Path:
    """Concatenate clips with crossfade transitions via filter_complex.

    This re-encodes the video to apply crossfade filters between every
    pair of adjacent segments.
    """
    dest = Path(output_path)

    if len(paths) == 1:
        return _concat_simple(paths, output_path)

    # Build filter graph iteratively.
    inputs = [ffmpeg.input(p) for p in paths]

    # Start by crossfading the first two clips.
    clip_durations = [_probe_duration(p) for p in paths]

    # Offset for the crossfade = duration of first clip minus transition.
    current_video = inputs[0].video
    current_audio = inputs[0].audio

    for i in range(1, len(inputs)):
        next_video = inputs[i].video
        next_audio = inputs[i].audio

        offset = clip_durations[i - 1] - duration
        if offset < 0:
            offset = 0.0

        current_video = ffmpeg.filter(
            [current_video, next_video],
            "xfade",
            transition="fade",
            duration=duration,
            offset=offset,
        )

        current_audio = ffmpeg.filter(
            [current_audio, next_audio],
            "acrossfade",
            d=duration,
        )

        # Update effective duration for next iteration: the merged clip
        # is shorter by the transition overlap.
        clip_durations[i] = (
            clip_durations[i - 1] + clip_durations[i] - duration
        )

    (
        ffmpeg
        .output(current_video, current_audio, str(dest))
        .overwrite_output()
        .run(quiet=True)
    )

    logger.info(
        "Compiled %d segment(s) (crossfade %.1fs) -> %s",
        len(paths),
        duration,
        dest,
    )
    return dest.resolve()
