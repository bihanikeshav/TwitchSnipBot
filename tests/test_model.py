"""Tests for the LSTM model."""

import pytest

try:
    import torch
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False

from snipbot.model.lstm import HighlightLSTM


@pytest.mark.skipif(not HAS_TORCH, reason="PyTorch not installed")
class TestHighlightLSTM:
    def test_forward_pass(self):
        model = HighlightLSTM(input_size=12, hidden_size=64, num_layers=1)
        x = torch.randn(4, 12, 12)  # batch=4, seq=12, features=12
        out = model(x)

        assert "detection" in out
        assert "classification" in out
        assert out["detection"].shape == (4, 1)
        assert out["classification"].shape == (4, 4)

    def test_bidirectional(self):
        model = HighlightLSTM(input_size=12, hidden_size=64, num_layers=1, bidirectional=True)
        x = torch.randn(2, 12, 12)
        out = model(x)

        assert out["detection"].shape == (2, 1)
        assert out["classification"].shape == (2, 4)

    def test_single_sample(self):
        model = HighlightLSTM(input_size=12, hidden_size=32, num_layers=1)
        x = torch.randn(1, 12, 12)
        out = model(x)

        assert out["detection"].shape == (1, 1)
