"""Tests for labeling utilities."""

import numpy as np
import pytest

from snipbot.features.feature_set import WindowFeatures
from snipbot.labeling.statistical import auto_label


class TestAutoLabeling:
    def _make_windows(self, rates):
        """Create windows with specified message rates."""
        windows = []
        for i, rate in enumerate(rates):
            features = np.zeros(12)
            features[0] = rate  # message_rate is index 0
            windows.append(WindowFeatures(
                start_time=float(i * 10),
                end_time=float((i + 1) * 10),
                features=features,
                message_count=int(rate * 10),
            ))
        return windows

    def test_detects_spikes(self):
        # Mostly low rate with one big spike
        rates = [1.0] * 20 + [10.0] + [1.0] * 20
        windows = self._make_windows(rates)
        labels = auto_label(windows, z_threshold=2.0)

        highlight_indices = [idx for idx, is_h in labels if is_h]
        assert 20 in highlight_indices  # The spike should be detected

    def test_no_highlights_in_flat(self):
        # All same rate — no spikes
        rates = [5.0] * 50
        windows = self._make_windows(rates)
        labels = auto_label(windows, z_threshold=2.5)

        highlight_count = sum(1 for _, is_h in labels if is_h)
        assert highlight_count == 0
