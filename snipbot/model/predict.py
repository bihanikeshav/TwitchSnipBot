"""Inference utilities for the HighlightLSTM model."""

from __future__ import annotations

from collections import deque
from typing import Any, Sequence

import numpy as np
import torch
import torch.nn as nn


# ------------------------------------------------------------------
# Batch prediction
# ------------------------------------------------------------------

def predict_batch(
    model: nn.Module,
    sequences: Sequence[Any],
    device: str = "cpu",
    sequence_length: int = 12,
    feature_dim: int = 12,
) -> list[tuple[float, int, list[float]]]:
    """Run inference on a batch of feature sequences.

    Parameters
    ----------
    model:
        A trained ``HighlightLSTM`` (or compatible) model.
    sequences:
        Iterable of sequences.  Each sequence is a list of objects with a
        ``.to_vector()`` method, raw numpy arrays, or nested lists/floats.
    device:
        Torch device string.
    sequence_length:
        Fixed sequence length the model expects.
    feature_dim:
        Dimensionality of each feature vector.

    Returns
    -------
    list of (detection_prob, classification_label, classification_probs):
        One tuple per input sequence.

        * ``detection_prob`` — float in [0, 1].
        * ``classification_label`` — int argmax of the class probabilities.
        * ``classification_probs`` — list of per-class probabilities.
    """
    tensors: list[torch.Tensor] = []
    for seq in sequences:
        tensor = _sequence_to_tensor(seq, sequence_length, feature_dim)
        tensors.append(tensor)

    batch = torch.stack(tensors).to(device)  # (B, seq_len, feature_dim)

    model.eval()
    with torch.no_grad():
        outputs = model(batch)

    # Model returns raw logits — apply activations for inference.
    detection_probs = torch.sigmoid(outputs["detection"]).cpu().squeeze(-1)    # (B,)
    classification_probs = torch.softmax(outputs["classification"], dim=-1).cpu()  # (B, C)

    results: list[tuple[float, int, list[float]]] = []
    for i in range(len(sequences)):
        det_p = float(detection_probs[i])
        cls_probs = classification_probs[i].tolist()
        cls_label = int(classification_probs[i].argmax())
        results.append((det_p, cls_label, cls_probs))

    return results


# ------------------------------------------------------------------
# Rolling (real-time) predictor
# ------------------------------------------------------------------

class RollingPredictor:
    """Maintains a sliding window buffer for real-time prediction.

    Feed individual ``WindowFeatures`` objects (or raw feature vectors) one
    at a time via :meth:`update`.  Once the buffer reaches
    *sequence_length* windows a prediction is returned.

    Parameters
    ----------
    model:
        A trained ``HighlightLSTM`` model.
    sequence_length:
        Number of windows required before a prediction is emitted.
    feature_dim:
        Dimensionality of each window feature vector.
    device:
        Torch device string.
    """

    def __init__(
        self,
        model: nn.Module,
        sequence_length: int = 12,
        feature_dim: int = 12,
        device: str = "cpu",
    ) -> None:
        self.model = model
        self.sequence_length = sequence_length
        self.feature_dim = feature_dim
        self.device = device

        self._buffer: deque[np.ndarray] = deque(maxlen=sequence_length)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def update(
        self, window_features: Any
    ) -> tuple[float, int, list[float]] | None:
        """Append a window and return a prediction when ready.

        Parameters
        ----------
        window_features:
            A single ``WindowFeatures`` instance (must expose
            ``.to_vector()``), a numpy array, or a list of floats.

        Returns
        -------
        tuple or None:
            ``(detection_prob, classification_label, classification_probs)``
            if the buffer has reached *sequence_length*, otherwise ``None``.
        """
        vec = _to_vector(window_features, self.feature_dim)
        self._buffer.append(vec)

        if len(self._buffer) < self.sequence_length:
            return None

        result = predict_batch(
            self.model,
            [list(self._buffer)],
            device=self.device,
            sequence_length=self.sequence_length,
            feature_dim=self.feature_dim,
        )
        return result[0]

    def reset(self) -> None:
        """Clear the internal buffer."""
        self._buffer.clear()

    @property
    def buffered(self) -> int:
        """Number of windows currently in the buffer."""
        return len(self._buffer)


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _to_vector(item: Any, feature_dim: int) -> np.ndarray:
    """Convert a single window representation to a 1-D float32 array."""
    if hasattr(item, "to_vector"):
        return np.asarray(item.to_vector(), dtype=np.float32)
    if isinstance(item, np.ndarray):
        return item.astype(np.float32)
    return np.asarray(item, dtype=np.float32)


def _sequence_to_tensor(
    seq: Any, sequence_length: int, feature_dim: int
) -> torch.Tensor:
    """Convert a variable-length sequence to a fixed-size float tensor."""
    vectors = [_to_vector(item, feature_dim) for item in seq]

    if len(vectors) == 0:
        return torch.zeros(sequence_length, feature_dim, dtype=torch.float32)

    arr = np.stack(vectors)  # (L, D)

    # Truncate
    if arr.shape[0] > sequence_length:
        arr = arr[:sequence_length]

    # Pre-pad with zeros
    if arr.shape[0] < sequence_length:
        pad = np.zeros(
            (sequence_length - arr.shape[0], feature_dim), dtype=np.float32
        )
        arr = np.concatenate([pad, arr], axis=0)

    return torch.tensor(arr, dtype=torch.float32)
