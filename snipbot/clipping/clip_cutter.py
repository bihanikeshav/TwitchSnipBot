"""Extract clips from a downloaded VOD using ffmpeg.

All cutting is done with stream-copy (``-c copy``) by default for speed.
If the caller passes a format that requires re-encoding, ffmpeg-python
will handle it transparently.
"""

from __future__ import annotations

import logging
from pathlib import Path

import ffmpeg  # ffmpeg-python

logger = logging.getLogger(__name__)


def cut_clip(
    input_path: str,
    output_path: str,
    start_time: float,
    duration: float,
    format: str = "mp4",
) -> Path:
    """Extract a single clip from *input_path*.

    Parameters
    ----------
    input_path:
        Path to the source video file.
    output_path:
        Destination path for the extracted clip.
    start_time:
        Start position in the source video (seconds).
    duration:
        Length of the clip to extract (seconds).
    format:
        Output container format (default ``"mp4"``).

    Returns
    -------
    Path:
        The resolved *output_path* on success.

    Raises
    ------
    ffmpeg.Error:
        If ffmpeg fails to process the file.
    FileNotFoundError:
        If *input_path* does not exist.
    """
    src = Path(input_path)
    if not src.exists():
        raise FileNotFoundError(f"Source video not found: {src}")

    dest = Path(output_path)
    dest.parent.mkdir(parents=True, exist_ok=True)

    logger.info(
        "Cutting clip: %s  start=%.2fs  duration=%.2fs -> %s",
        src.name,
        start_time,
        duration,
        dest,
    )

    (
        ffmpeg
        .input(str(src), ss=start_time, t=duration)
        .output(str(dest), c="copy", f=format)
        .overwrite_output()
        .run(quiet=True)
    )

    return dest.resolve()


def cut_clips(
    input_path: str,
    output_dir: str,
    moments: list[tuple[float, float]],
    format: str = "mp4",
) -> list[str]:
    """Extract multiple clips from a single source video.

    Parameters
    ----------
    input_path:
        Path to the source video file.
    output_dir:
        Directory where clips will be saved.  Created if it does not
        exist.
    moments:
        List of ``(start_seconds, end_seconds)`` tuples.  Each pair
        defines one clip to extract.
    format:
        Output container format (default ``"mp4"``).

    Returns
    -------
    list[str]:
        Absolute paths of the generated clip files, in the same order
        as *moments*.
    """
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    output_paths: list[str] = []

    for idx, (start, end) in enumerate(moments):
        duration = end - start
        if duration <= 0:
            logger.warning(
                "Skipping moment %d: end (%.2f) <= start (%.2f)",
                idx,
                end,
                start,
            )
            continue

        clip_name = f"clip_{idx:04d}.{format}"
        clip_path = out_dir / clip_name

        result = cut_clip(
            input_path=input_path,
            output_path=str(clip_path),
            start_time=start,
            duration=duration,
            format=format,
        )
        output_paths.append(str(result))

    logger.info(
        "Cut %d clip(s) from %s into %s",
        len(output_paths),
        input_path,
        output_dir,
    )
    return output_paths
