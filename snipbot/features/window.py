"""Sliding-window management for chat message streams.

Supports both **batch** processing (all messages available upfront) and
**real-time** processing (messages arriving one at a time).
"""

from __future__ import annotations

from collections import deque
from typing import Iterator

from snipbot.ingestion.message import ChatMessage


# Type alias for a window tuple: (start_time, end_time, messages)
WindowTuple = tuple[float, float, list[ChatMessage]]


class SlidingWindowManager:
    """Produces fixed-length, overlapping time windows of chat messages.

    Parameters:
        window_size: Duration of each window in seconds (default 10).
        stride:      Step size between consecutive windows in seconds
                     (default 5).  When ``stride < window_size`` windows
                     overlap.
    """

    def __init__(
        self,
        window_size: float = 10.0,
        stride: float = 5.0,
    ) -> None:
        if window_size <= 0:
            raise ValueError("window_size must be positive")
        if stride <= 0:
            raise ValueError("stride must be positive")

        self.window_size = window_size
        self.stride = stride

        # Internal state for real-time mode.
        self._buffer: deque[ChatMessage] = deque()
        self._next_window_start: float | None = None

    # ------------------------------------------------------------------
    # Batch mode
    # ------------------------------------------------------------------

    def create_windows(
        self,
        messages: list[ChatMessage],
    ) -> list[WindowTuple]:
        """Partition *messages* into overlapping time windows.

        Messages are assumed to be roughly sorted by timestamp.  They
        are explicitly sorted here to guarantee correctness.

        Returns:
            A list of ``(start_time, end_time, messages_in_window)``
            tuples.
        """
        if not messages:
            return []

        sorted_msgs = sorted(messages, key=lambda m: m.timestamp)
        first_ts = sorted_msgs[0].timestamp
        last_ts = sorted_msgs[-1].timestamp

        windows: list[WindowTuple] = []
        start = first_ts

        while start <= last_ts:
            end = start + self.window_size
            window_msgs = [
                m for m in sorted_msgs if start <= m.timestamp < end
            ]
            windows.append((start, end, window_msgs))
            start += self.stride

        return windows

    # ------------------------------------------------------------------
    # Real-time mode
    # ------------------------------------------------------------------

    def update(self, message: ChatMessage) -> Iterator[WindowTuple]:
        """Ingest a single message and yield any completed windows.

        A window is considered *complete* when the incoming message's
        timestamp equals or exceeds the window's ``end_time``.  All
        completed windows are yielded in chronological order.

        This method maintains an internal message buffer and
        automatically evicts messages that can no longer contribute to
        any future window.

        Parameters:
            message: The newly arrived :class:`ChatMessage`.

        Yields:
            ``(start_time, end_time, messages_in_window)`` tuples for
            each window that has just completed.
        """
        self._buffer.append(message)

        # Bootstrap the first window boundary.
        if self._next_window_start is None:
            self._next_window_start = message.timestamp

        # Emit every window whose end_time is now in the past (or
        # exactly equal to the current message timestamp).
        while True:
            window_end = self._next_window_start + self.window_size
            if message.timestamp < window_end:
                break  # Window not yet complete.

            window_start = self._next_window_start
            window_msgs = [
                m
                for m in self._buffer
                if window_start <= m.timestamp < window_end
            ]
            yield (window_start, window_end, window_msgs)

            self._next_window_start += self.stride

            # Evict messages that are too old to appear in any future
            # window.  The earliest possible future window starts at
            # ``self._next_window_start``.
            while (
                self._buffer
                and self._buffer[0].timestamp < self._next_window_start
            ):
                self._buffer.popleft()

    def reset(self) -> None:
        """Clear internal state for real-time mode."""
        self._buffer.clear()
        self._next_window_start = None
