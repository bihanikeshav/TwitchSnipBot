"""YouTube Data API v3 upload client.

Handles OAuth2 authentication (with credential persistence) and
resumable video uploads via the Google API Python client.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload
from google_auth_oauthlib.flow import InstalledAppFlow
from google.oauth2.credentials import Credentials

logger = logging.getLogger(__name__)

_SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]
_API_SERVICE = "youtube"
_API_VERSION = "v3"
_TOKEN_FILE = "youtube_token.json"

# Retry configuration for resumable uploads.
_MAX_RETRIES = 5


class YouTubeUploader:
    """Upload videos to YouTube via the Data API v3.

    Parameters
    ----------
    client_secrets_file:
        Path to the Google OAuth2 client-secrets JSON file downloaded
        from the Google Cloud Console.
    token_dir:
        Directory where the persisted OAuth2 token will be stored.
        Defaults to the same directory as the client-secrets file.
    """

    def __init__(
        self,
        client_secrets_file: str,
        token_dir: str | None = None,
    ) -> None:
        self._secrets_file = Path(client_secrets_file)
        if not self._secrets_file.exists():
            raise FileNotFoundError(
                f"Client secrets file not found: {self._secrets_file}"
            )

        self._token_dir = Path(token_dir) if token_dir else self._secrets_file.parent
        self._token_path = self._token_dir / _TOKEN_FILE
        self._credentials: Credentials | None = None
        self._service: Any = None

    # ------------------------------------------------------------------
    # Authentication
    # ------------------------------------------------------------------

    def authenticate(self) -> None:
        """Run the OAuth2 flow (or load cached credentials).

        Saved credentials are reused automatically on subsequent calls.
        If the stored token has expired but carries a refresh token, it
        will be refreshed transparently.
        """
        creds: Credentials | None = None

        # Try loading existing token.
        if self._token_path.exists():
            try:
                creds = Credentials.from_authorized_user_file(
                    str(self._token_path), _SCOPES
                )
            except Exception:
                logger.warning(
                    "Failed to load cached token from %s — re-authenticating",
                    self._token_path,
                )
                creds = None

        # Refresh or re-acquire.
        if creds is None or not creds.valid:
            if creds is not None and creds.expired and creds.refresh_token:
                from google.auth.transport.requests import Request

                creds.refresh(Request())
                logger.info("Refreshed YouTube OAuth2 token")
            else:
                flow = InstalledAppFlow.from_client_secrets_file(
                    str(self._secrets_file), _SCOPES
                )
                creds = flow.run_local_server(port=0)
                logger.info("Completed YouTube OAuth2 flow")

            # Persist for next time.
            self._token_dir.mkdir(parents=True, exist_ok=True)
            self._token_path.write_text(creds.to_json())
            logger.debug("Saved YouTube token to %s", self._token_path)

        self._credentials = creds
        self._service = build(
            _API_SERVICE,
            _API_VERSION,
            credentials=self._credentials,
        )

    # ------------------------------------------------------------------
    # Upload
    # ------------------------------------------------------------------

    def upload(
        self,
        video_path: str,
        title: str,
        description: str = "",
        tags: list[str] | None = None,
        category: str = "20",
        privacy: str = "unlisted",
    ) -> str:
        """Upload a video to YouTube.

        Parameters
        ----------
        video_path:
            Path to the video file to upload.
        title:
            Video title (max 100 characters enforced by YouTube).
        description:
            Video description text.
        tags:
            Optional list of keyword tags.
        category:
            YouTube category ID.  ``"20"`` = Gaming.
        privacy:
            Privacy status — ``"public"``, ``"unlisted"``, or
            ``"private"``.

        Returns
        -------
        str:
            The YouTube video ID of the uploaded video.

        Raises
        ------
        RuntimeError:
            If not authenticated or the upload fails after retries.
        FileNotFoundError:
            If *video_path* does not exist.
        """
        if self._service is None:
            self.authenticate()

        vpath = Path(video_path)
        if not vpath.exists():
            raise FileNotFoundError(f"Video file not found: {vpath}")

        body: dict[str, Any] = {
            "snippet": {
                "title": title[:100],
                "description": description,
                "tags": tags or [],
                "categoryId": category,
            },
            "status": {
                "privacyStatus": privacy,
                "selfDeclaredMadeForKids": False,
            },
        }

        media = MediaFileUpload(
            str(vpath),
            chunksize=10 * 1024 * 1024,  # 10 MiB chunks
            resumable=True,
        )

        request = self._service.videos().insert(
            part="snippet,status",
            body=body,
            media_body=media,
        )

        logger.info("Uploading %s to YouTube ...", vpath.name)

        response = None
        retries = 0
        while response is None:
            try:
                status, response = request.next_chunk()
                if status:
                    pct = int(status.progress() * 100)
                    logger.debug("Upload progress: %d%%", pct)
            except HttpError as exc:
                if exc.resp.status in (500, 502, 503, 504) and retries < _MAX_RETRIES:
                    retries += 1
                    logger.warning(
                        "Retryable HTTP %d error (attempt %d/%d)",
                        exc.resp.status,
                        retries,
                        _MAX_RETRIES,
                    )
                    continue
                raise RuntimeError(
                    f"YouTube upload failed: {exc}"
                ) from exc

        video_id: str = response["id"]
        logger.info(
            "Upload complete: https://youtu.be/%s (id=%s)",
            video_id,
            video_id,
        )
        return video_id
