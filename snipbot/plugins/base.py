from abc import ABC, abstractmethod
from typing import Optional
from dataclasses import dataclass, field


@dataclass
class GameEvent:
    event_type: str
    timestamp: float
    data: dict


@dataclass
class ScheduledRecording:
    channel: str
    start_time: float
    end_time: float | None
    title: str
    metadata: dict


class Plugin(ABC):
    @abstractmethod
    def name(self) -> str: ...

    def version(self) -> str:
        return "0.1.0"

    def extract_features(self, messages, window_start, window_end) -> dict:
        """Add custom features to the feature vector."""
        return {}

    def get_model(self):
        """Provide a custom model (replaces or supplements LSTM)."""
        return None

    def get_events_in_range(self, start: float, end: float) -> list[GameEvent]:
        """Supply external event data."""
        return []

    def enrich_moment(self, moment) -> None:
        """Enrich detected moments with game context. Modifies in-place."""
        pass

    def generate_metadata(self, moment) -> dict:
        """Custom metadata for clips."""
        return {}

    def get_upcoming_recordings(self) -> list[ScheduledRecording]:
        """Schedule recordings (e.g., from HLTV match calendar)."""
        return []
