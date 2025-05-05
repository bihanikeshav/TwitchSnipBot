"""DetectedMoment dataclass — core data structure for highlight events.

A ``DetectedMoment`` captures everything the pipeline knows about a
single detected highlight: when it happened, how confident the model
was, what category it belongs to, and optional debugging / plugin data.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class DetectedMoment:
    """A single highlight moment detected by the analysis pipeline.

    Attributes
    ----------
    timestamp:
        Unix epoch timestamp (seconds) marking the centre of the
        detected highlight window.
    duration:
        Estimated duration of the highlight in seconds (typically the
        window size used during detection).
    detection_score:
        Confidence that this window is a highlight, in the range
        ``[0, 1]``.
    category:
        Predicted highlight category — one of ``"funny"``,
        ``"exciting"``, ``"surprising"``, or ``"other"``.
    category_scores:
        Per-category confidence scores as produced by the
        classification head, e.g.
        ``{"funny": 0.1, "exciting": 0.8, ...}``.
    window_features:
        Raw feature vector(s) for the detection window.  Kept for
        debugging / offline analysis.
    game_events:
        Game-specific events injected by a plugin (e.g. a kill-feed
        parser for CS:GO).
    metadata:
        Arbitrary extra context — VOD position, clip path, channel
        name, etc.
    clip_path:
        Filesystem path to the extracted clip file, or ``None`` if no
        clip has been cut yet.
    """

    timestamp: float
    duration: float
    detection_score: float
    category: str = "other"
    category_scores: dict[str, float] = field(default_factory=dict)
    window_features: list = field(default_factory=list)
    game_events: list = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
    clip_path: str | None = None

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @property
    def start_time(self) -> float:
        """Unix timestamp of the highlight start."""
        return self.timestamp - self.duration / 2

    @property
    def end_time(self) -> float:
        """Unix timestamp of the highlight end."""
        return self.timestamp + self.duration / 2

    @property
    def top_category(self) -> str:
        """Return the category with the highest score, or *category*."""
        if not self.category_scores:
            return self.category
        return max(self.category_scores, key=self.category_scores.get)  # type: ignore[arg-type]

    def __repr__(self) -> str:
        return (
            f"DetectedMoment(ts={self.timestamp:.1f}, "
            f"dur={self.duration:.1f}s, "
            f"score={self.detection_score:.2f}, "
            f"cat={self.category!r})"
        )
