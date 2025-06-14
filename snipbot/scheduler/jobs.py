"""Job definitions for the SnipBot scheduler.

Each function here is designed to be called by APScheduler. They coordinate
with the pipeline, storage, and upload modules to carry out the actual work.
"""

import logging
import os
from typing import Any, Optional

logger = logging.getLogger(__name__)


async def record_job(
    channel: str,
    duration: Optional[float] = None,
    config: Optional[dict[str, Any]] = None,
) -> None:
    """Start recording a Twitch channel.

    Connects the live ingestion pipeline, records chat + video, and writes
    data to disk. If ``duration`` is given (in seconds), recording stops
    automatically after that time; otherwise it continues until the stream
    ends or the job is cancelled.

    Args:
        channel: Twitch channel name to record.
        duration: Maximum recording duration in seconds. ``None`` means
            record until the stream ends or manual cancellation.
        config: Optional configuration overrides (e.g., output directory,
            quality settings).
    """
    from snipbot.storage.database import Database

    cfg = config or {}
    output_dir = cfg.get("output_dir", os.path.join("data", "recordings", channel))
    os.makedirs(output_dir, exist_ok=True)

    db = Database(cfg.get("db_path", "snipbot.db"))
    recording_id = db.save_recording(
        channel=channel,
        start_time=_now_iso(),
        end_time=None,
        status="recording",
    )

    logger.info(
        "Recording started: channel=%s recording_id=%d duration=%s output=%s",
        channel,
        recording_id,
        duration,
        output_dir,
    )

    try:
        # -----------------------------------------------------------------
        # In a full implementation this section would:
        # 1. Instantiate the live pipeline (ingestion -> features -> labeling)
        # 2. Connect to the Twitch IRC / EventSub for chat
        # 3. Optionally capture video via streamlink
        # 4. Run until duration expires or stream goes offline
        # -----------------------------------------------------------------
        import asyncio

        if duration:
            logger.info("Recording for %.0f seconds…", duration)
            await asyncio.sleep(duration)
        else:
            # Without a duration we'd normally watch for stream-offline.
            # Placeholder: wait indefinitely (cancelled externally).
            logger.info("Recording indefinitely until cancelled or stream ends.")
            while True:
                await asyncio.sleep(60)

    except asyncio.CancelledError:
        logger.info("Recording cancelled: recording_id=%d", recording_id)
    except Exception:
        logger.exception("Error during recording: recording_id=%d", recording_id)
        db.update_recording(recording_id, status="error")
        raise
    finally:
        db.update_recording(recording_id, status="completed", end_time=_now_iso())
        logger.info("Recording finished: recording_id=%d", recording_id)


async def process_job(
    recording_id: int,
    config: Optional[dict[str, Any]] = None,
) -> None:
    """Process a completed recording through the batch pipeline.

    Runs feature extraction, highlight detection, and clip generation on
    the recorded data.

    Args:
        recording_id: Database ID of the recording to process.
        config: Optional configuration overrides.
    """
    from snipbot.storage.database import Database

    cfg = config or {}
    db = Database(cfg.get("db_path", "snipbot.db"))

    recording = db.get_recording(recording_id)
    if not recording:
        logger.error("Recording %d not found, skipping processing.", recording_id)
        return

    logger.info("Processing started: recording_id=%d", recording_id)
    db.update_recording(recording_id, status="processing")

    try:
        # -----------------------------------------------------------------
        # In a full implementation this section would:
        # 1. Load recorded chat / video data from disk
        # 2. Run the batch pipeline (features -> model -> labeling -> clipping)
        # 3. Save detected highlights and generated clips to the database
        # -----------------------------------------------------------------
        import asyncio

        # Placeholder processing delay
        await asyncio.sleep(1)

        logger.info("Processing completed: recording_id=%d", recording_id)
        db.update_recording(recording_id, status="processed")

    except Exception:
        logger.exception("Error during processing: recording_id=%d", recording_id)
        db.update_recording(recording_id, status="error")
        raise


async def upload_job(
    clip_path: str,
    metadata: dict[str, Any],
    config: Optional[dict[str, Any]] = None,
) -> Optional[str]:
    """Upload a clip or highlight reel to YouTube.

    Args:
        clip_path: Path to the video file to upload.
        metadata: Upload metadata containing at minimum:
            - title: Video title
            - description: Video description
            - tags: List of tags
            - category_id: YouTube category ID (default "20" for Gaming)
        config: Optional configuration overrides (e.g., OAuth credentials path).

    Returns:
        The YouTube video ID on success, or ``None`` on failure.
    """
    if not os.path.isfile(clip_path):
        logger.error("Clip file does not exist: %s", clip_path)
        return None

    cfg = config or {}
    title = metadata.get("title", "TwitchSnipBot Highlight")
    description = metadata.get("description", "")
    tags = metadata.get("tags", [])
    category_id = metadata.get("category_id", "20")

    logger.info(
        "Upload started: path=%s title=%s tags=%s",
        clip_path,
        title,
        tags,
    )

    try:
        # -----------------------------------------------------------------
        # In a full implementation this section would:
        # 1. Authenticate with the YouTube Data API v3
        # 2. Create a MediaFileUpload
        # 3. Execute the insert request with resumable upload
        # 4. Return the resulting video ID
        # -----------------------------------------------------------------
        import asyncio

        # Placeholder upload delay
        await asyncio.sleep(1)

        # Simulated video ID
        video_id = f"simulated_{os.path.basename(clip_path)}"
        logger.info("Upload completed: video_id=%s", video_id)
        return video_id

    except Exception:
        logger.exception("Error during upload: %s", clip_path)
        return None


def _now_iso() -> str:
    """Return the current UTC time as an ISO 8601 string."""
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
