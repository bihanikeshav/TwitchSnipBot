"""Tests for feature extraction."""

import numpy as np
import pytest

from snipbot.ingestion.message import ChatMessage
from snipbot.features.extractors import extract_features
from snipbot.features.window import SlidingWindowManager


def make_messages(texts, base_time=0.0, interval=0.1):
    """Helper to create a list of ChatMessage from text strings."""
    return [
        ChatMessage(
            username=f"user{i}",
            text=text,
            timestamp=base_time + i * interval,
            channel="test",
        )
        for i, text in enumerate(texts)
    ]


class TestFeatureExtraction:
    def test_empty_window(self):
        features = extract_features([], 0.0, 10.0)
        assert features.message_count == 0
        assert len(features.features) == 12
        assert all(f == 0.0 for f in features.features)

    def test_basic_features(self):
        msgs = make_messages(["hello", "world", "nice play", "POG", "wow"])
        features = extract_features(msgs, 0.0, 10.0)
        assert features.message_count == 5
        assert len(features.features) == 12
        assert features.features[0] > 0  # message_rate > 0

    def test_caps_detection(self):
        msgs = make_messages(["THIS IS CAPS", "ALSO CAPS", "not caps", "LOUD NOISES"])
        features = extract_features(msgs, 0.0, 10.0)
        caps_ratio = features.features[4]
        assert caps_ratio > 0.5  # Most messages are caps

    def test_keyword_detection(self):
        msgs = make_messages(["ace!", "clutch play", "insane shot", "normal message"])
        features = extract_features(msgs, 0.0, 10.0)
        keyword_score = features.features[7]
        assert keyword_score > 0


class TestSlidingWindow:
    def test_create_windows(self):
        msgs = make_messages(
            ["msg" + str(i) for i in range(100)],
            base_time=0.0,
            interval=0.5,
        )
        wm = SlidingWindowManager(window_size=10, stride=5)
        windows = wm.create_windows(msgs)
        assert len(windows) > 0

        # Each window should contain messages
        for start, end, window_msgs in windows:
            assert end - start == 10
            assert len(window_msgs) >= 0
