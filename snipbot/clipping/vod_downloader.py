"""VOD download and metadata retrieval for Twitch streams.

Uses streamlink for downloading VOD segments and the Twitch Helix API
(via httpx) for fetching VOD metadata such as title, duration, and
creation time.
"""

from __future__ import annotations

import logging
import re
import subprocess
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Twitch Helix helpers
# ---------------------------------------------------------------------------

_TWITCH_AUTH_URL = "https://id.twitch.tv/oauth2/token"
_TWITCH_HELIX_URL = "https://api.twitch.tv/helix"

# ISO-8601 duration pattern returned by the Helix API (e.g. "1h23m45s").
_DURATION_RE = re.compile(
    r"(?:(?P<hours>\d+)h)?"
    r"(?:(?P<minutes>\d+)m)?"
    r"(?:(?P<seconds>\d+)s)?",
)


def _parse_duration(duration_str: str) -> float:
    """Convert a Twitch-style duration string (``1h23m45s``) to seconds."""
    match = _DURATION_RE.match(duration_str)
    if match is None:
        return 0.0
    parts = match.groupdict(default="0")
    return (
        int(parts["hours"]) * 3600
        + int(parts["minutes"]) * 60
        + int(parts["seconds"])
    )


def _obtain_app_token(client_id: str, client_secret: str) -> str:
    """Obtain an OAuth2 app-access token from Twitch."""
    with httpx.Client(timeout=15) as client:
        resp = client.post(
            _TWITCH_AUTH_URL,
            params={
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "client_credentials",
            },
        )
        resp.raise_for_status()
        return resp.json()["access_token"]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_vod_info(
    vod_id: str,
    client_id: str,
    client_secret: str,
) -> dict:
    """Fetch VOD metadata from the Twitch Helix API.

    Parameters
    ----------
    vod_id:
        Numeric Twitch VOD ID (e.g. ``"1234567890"``).
    client_id:
        Twitch application client-ID.
    client_secret:
        Twitch application client-secret.

    Returns
    -------
    dict:
        Keys: ``title``, ``duration`` (seconds as float), ``created_at``
        (ISO-8601 string), and the raw ``data`` payload from the API.

    Raises
    ------
    ValueError:
        If the VOD is not found.
    httpx.HTTPStatusError:
        On any non-2xx response from the Twitch API.
    """
    token = _obtain_app_token(client_id, client_secret)

    with httpx.Client(timeout=15) as client:
        resp = client.get(
            f"{_TWITCH_HELIX_URL}/videos",
            params={"id": vod_id},
            headers={
                "Client-ID": client_id,
                "Authorization": f"Bearer {token}",
            },
        )
        resp.raise_for_status()
        payload = resp.json()

    videos = payload.get("data", [])
    if not videos:
        raise ValueError(f"VOD {vod_id!r} not found on Twitch")

    video = videos[0]
    return {
        "title": video["title"],
        "duration": _parse_duration(video["duration"]),
        "created_at": video["created_at"],
        "data": video,
    }


def download_vod(
    vod_url: str,
    output_path: str,
    quality: str = "best",
) -> Path:
    """Download a Twitch VOD using streamlink.

    Parameters
    ----------
    vod_url:
        Full Twitch VOD URL, e.g.
        ``"https://www.twitch.tv/videos/1234567890"``.
    output_path:
        Filesystem path for the downloaded video file.
    quality:
        Stream quality selector accepted by streamlink (e.g.
        ``"best"``, ``"720p60"``, ``"480p"``).

    Returns
    -------
    Path:
        The resolved output path on success.

    Raises
    ------
    RuntimeError:
        If streamlink exits with a non-zero return code.
    FileNotFoundError:
        If streamlink is not installed / not on ``PATH``.
    """
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        "streamlink",
        "--force",                 # overwrite existing file
        "-o", str(output),
        vod_url,
        quality,
    ]

    logger.info("Downloading VOD: %s (quality=%s)", vod_url, quality)
    logger.debug("Running: %s", " ".join(cmd))

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        logger.error("streamlink stderr:\n%s", result.stderr)
        raise RuntimeError(
            f"streamlink exited with code {result.returncode}: {result.stderr}"
        )

    logger.info("VOD downloaded to %s", output)
    return output.resolve()
