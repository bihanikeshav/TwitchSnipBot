"""Feature vector container for a single analysis window."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(slots=True)
class WindowFeatures:
    """Aggregated feature vector computed over a sliding window of chat.

    Attributes:
        start_time:    Unix epoch of the window's left edge.
        end_time:      Unix epoch of the window's right edge.
        features:      1-D numpy array of 12 floats (see
                       :mod:`snipbot.features.extractors` for ordering).
        message_count: Number of messages that fell within the window.
    """

    start_time: float
    end_time: float
    features: np.ndarray  # shape (12,), dtype float64
    message_count: int

    # ------------------------------------------------------------------
    # Convenience
    # ------------------------------------------------------------------

    @property
    def duration(self) -> float:
        """Window duration in seconds."""
        return self.end_time - self.start_time

    # Aliases so callers can use either name.
    @property
    def window_start(self) -> float:
        return self.start_time

    @property
    def window_end(self) -> float:
        return self.end_time

    # ------------------------------------------------------------------
    # Individual feature accessors (indices match extractors.py layout)
    # ------------------------------------------------------------------

    @property
    def message_rate(self) -> float:
        return float(self.features[0])

    @property
    def unique_users(self) -> float:
        return float(self.features[1])

    @property
    def user_ratio(self) -> float:
        return float(self.features[2])

    @property
    def emote_density(self) -> float:
        return float(self.features[3])

    @property
    def caps_ratio(self) -> float:
        return float(self.features[4])

    @property
    def avg_msg_len(self) -> float:
        return float(self.features[5])

    @property
    def msg_len_variance(self) -> float:
        return float(self.features[6])

    @property
    def keyword_score(self) -> float:
        return float(self.features[7])

    @property
    def repetition_score(self) -> float:
        return float(self.features[8])

    @property
    def question_ratio(self) -> float:
        return float(self.features[9])

    @property
    def exclamation_ratio(self) -> float:
        return float(self.features[10])

    @property
    def entropy(self) -> float:
        return float(self.features[11])

    # ------------------------------------------------------------------
    # Serialisation
    # ------------------------------------------------------------------

    def to_vector(self) -> np.ndarray:
        """Return the raw feature array."""
        return self.features

    def __repr__(self) -> str:
        feat_str = np.array2string(self.features, precision=3, separator=", ")
        return (
            f"WindowFeatures(start={self.start_time:.1f}, "
            f"end={self.end_time:.1f}, "
            f"msgs={self.message_count}, "
            f"features={feat_str})"
        )
