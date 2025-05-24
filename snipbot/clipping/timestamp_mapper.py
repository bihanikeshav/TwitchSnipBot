"""Map between chat Unix timestamps and VOD playback positions.

Twitch chat messages carry Unix epoch timestamps while VOD clips are
addressed by an offset from the beginning of the recording.  This
module provides a lightweight bidirectional mapper.
"""

from __future__ import annotations


class TimestampMapper:
    """Bidirectional mapper between chat timestamps and VOD positions.

    Parameters
    ----------
    vod_start_time:
        The Unix epoch timestamp (seconds) at which the VOD recording
        began.  This is typically derived from the ``created_at`` field
        returned by the Twitch Helix ``/videos`` endpoint.
    """

    def __init__(self, vod_start_time: float) -> None:
        if vod_start_time < 0:
            raise ValueError(
                f"vod_start_time must be non-negative, got {vod_start_time}"
            )
        self._vod_start = vod_start_time

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def vod_start_time(self) -> float:
        """The Unix epoch timestamp marking the start of the VOD."""
        return self._vod_start

    # ------------------------------------------------------------------
    # Conversion
    # ------------------------------------------------------------------

    def chat_to_vod(self, chat_timestamp: float) -> float:
        """Convert a chat message Unix timestamp to a VOD position.

        Parameters
        ----------
        chat_timestamp:
            Unix epoch timestamp of the chat message (seconds).

        Returns
        -------
        float:
            Position in the VOD (seconds from the start).  May be
            negative if the chat message precedes the VOD start.
        """
        return chat_timestamp - self._vod_start

    def vod_to_chat(self, vod_position: float) -> float:
        """Convert a VOD position to the corresponding Unix timestamp.

        Parameters
        ----------
        vod_position:
            Offset from the beginning of the VOD (seconds).

        Returns
        -------
        float:
            Unix epoch timestamp corresponding to the given VOD
            position.
        """
        return self._vod_start + vod_position

    # ------------------------------------------------------------------
    # Dunder helpers
    # ------------------------------------------------------------------

    def __repr__(self) -> str:
        return f"TimestampMapper(vod_start_time={self._vod_start!r})"
