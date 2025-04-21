"""Export a trained HighlightLSTM model to ONNX format."""

from __future__ import annotations

import logging
from pathlib import Path

import torch
import torch.nn as nn

logger = logging.getLogger(__name__)


def export_to_onnx(
    model: nn.Module,
    output_path: str | Path,
    sequence_length: int = 12,
    input_size: int = 12,
    opset_version: int = 14,
) -> Path:
    """Export a PyTorch model to ONNX for browser / cross-platform inference.

    Parameters
    ----------
    model:
        A trained ``HighlightLSTM`` (or compatible) model.  Must accept
        input of shape ``(batch, sequence_length, input_size)`` and return
        a dict with ``'detection'`` and ``'classification'`` tensors.
    output_path:
        Destination file path (e.g. ``"model.onnx"``).
    sequence_length:
        Number of time-steps the model expects.
    input_size:
        Dimensionality of each time-step feature vector.
    opset_version:
        ONNX opset version.  14+ is recommended for full LSTM support.

    Returns
    -------
    Path:
        Resolved path to the written ``.onnx`` file.
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    model.eval()

    # Create a dummy input matching the expected shape.
    dummy_input = torch.randn(1, sequence_length, input_size)

    # The model's forward() returns a dict.  ONNX export needs explicit
    # output names, so we wrap the model to return a tuple instead.
    class _OnnxWrapper(nn.Module):
        def __init__(self, inner: nn.Module) -> None:
            super().__init__()
            self.inner = inner

        def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
            out = self.inner(x)
            # Apply activations so the exported model outputs probabilities
            # (the web app consumes these directly).
            detection = torch.sigmoid(out["detection"])
            classification = torch.softmax(out["classification"], dim=-1)
            return detection, classification

    wrapper = _OnnxWrapper(model)
    wrapper.eval()

    torch.onnx.export(
        wrapper,
        (dummy_input,),
        str(output_path),
        input_names=["input"],
        output_names=["detection", "classification"],
        dynamic_axes={
            "input": {0: "batch_size"},
            "detection": {0: "batch_size"},
            "classification": {0: "batch_size"},
        },
        opset_version=opset_version,
    )

    logger.info("Model exported to ONNX: %s", output_path.resolve())
    return output_path.resolve()
