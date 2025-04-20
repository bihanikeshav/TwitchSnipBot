"""PyTorch Dataset for highlight detection training data."""

from __future__ import annotations

from typing import Any, Sequence

import numpy as np
import torch
from torch.utils.data import Dataset


class HighlightDataset(Dataset):
    """Dataset that pairs window-feature sequences with highlight labels.

    Each sample is a fixed-length sequence of window feature vectors together
    with a binary detection label and a multi-class classification label.

    Parameters
    ----------
    sequences:
        List of feature sequences.  Each sequence is itself a list of objects
        that expose a ``.to_vector()`` method returning a 1-D numpy array of
        length *feature_dim* (e.g. ``WindowFeatures``).  Raw numpy arrays or
        lists of floats are also accepted for convenience.
    detection_labels:
        Binary labels — ``1`` for highlight, ``0`` for background.
    classification_labels:
        Integer class indices (0-3) corresponding to
        funny / exciting / surprising / other.
    sequence_length:
        Every sequence is padded (with zeros) or truncated to this length.
    feature_dim:
        Expected dimensionality of each window feature vector.  Used only
        when padding is required.
    """

    def __init__(
        self,
        sequences: Sequence[Any],
        detection_labels: Sequence[int],
        classification_labels: Sequence[int],
        sequence_length: int = 12,
        feature_dim: int = 12,
    ) -> None:
        if not (len(sequences) == len(detection_labels) == len(classification_labels)):
            raise ValueError(
                "sequences, detection_labels, and classification_labels must "
                "have the same length."
            )

        self.sequence_length = sequence_length
        self.feature_dim = feature_dim

        self.features: list[torch.Tensor] = []
        for seq in sequences:
            tensor = self._to_tensor(seq)
            tensor = self._pad_or_truncate(tensor)
            self.features.append(tensor)

        self.detection_labels = torch.tensor(
            detection_labels, dtype=torch.float32
        )
        self.classification_labels = torch.tensor(
            classification_labels, dtype=torch.long
        )

    # ------------------------------------------------------------------
    # Dataset interface
    # ------------------------------------------------------------------

    def __len__(self) -> int:
        return len(self.features)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """Return (features, detection_label, classification_label)."""
        return (
            self.features[idx],
            self.detection_labels[idx],
            self.classification_labels[idx],
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _to_tensor(self, seq: Any) -> torch.Tensor:
        """Convert a single sequence to a float tensor of shape (L, D)."""
        vectors: list[np.ndarray] = []
        for item in seq:
            if hasattr(item, "to_vector"):
                vectors.append(np.asarray(item.to_vector(), dtype=np.float32))
            elif isinstance(item, np.ndarray):
                vectors.append(item.astype(np.float32))
            else:
                vectors.append(np.asarray(item, dtype=np.float32))

        if len(vectors) == 0:
            return torch.zeros(0, self.feature_dim, dtype=torch.float32)

        return torch.tensor(np.stack(vectors), dtype=torch.float32)

    def _pad_or_truncate(self, tensor: torch.Tensor) -> torch.Tensor:
        """Ensure the tensor has exactly *sequence_length* time steps."""
        length = tensor.shape[0]

        if length == self.sequence_length:
            return tensor

        if length > self.sequence_length:
            return tensor[: self.sequence_length]

        # Pad with zeros at the beginning (pre-padding) so the most recent
        # windows are at the end of the sequence.
        pad_size = self.sequence_length - length
        padding = torch.zeros(pad_size, self.feature_dim, dtype=torch.float32)
        return torch.cat([padding, tensor], dim=0)
