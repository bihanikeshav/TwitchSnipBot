"""LSTM model for highlight detection and classification."""

from __future__ import annotations

import torch
import torch.nn as nn


class HighlightLSTM(nn.Module):
    """Two-headed LSTM for stream highlight analysis.

    Takes sequences of window feature vectors and produces:
      - A binary detection score (highlight vs background).
      - A 4-class classification (funny / exciting / surprising / other).

    Parameters
    ----------
    input_size:
        Dimensionality of each window feature vector.
    hidden_size:
        Number of LSTM hidden units per direction.
    num_layers:
        Number of stacked LSTM layers.
    dropout:
        Dropout probability applied between LSTM layers (ignored when
        *num_layers* is 1).
    num_classes:
        Number of classification categories.
    bidirectional:
        If ``True`` the LSTM reads the sequence in both directions and
        the effective hidden size doubles for the output heads.
    """

    def __init__(
        self,
        input_size: int = 12,
        hidden_size: int = 128,
        num_layers: int = 2,
        dropout: float = 0.3,
        num_classes: int = 4,
        bidirectional: bool = False,
    ) -> None:
        super().__init__()

        self.input_size = input_size
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.num_classes = num_classes
        self.bidirectional = bidirectional

        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            dropout=dropout if num_layers > 1 else 0.0,
            batch_first=True,
            bidirectional=bidirectional,
        )

        head_input_size = hidden_size * (2 if bidirectional else 1)

        # Binary detection head — raw logit; apply sigmoid at inference.
        self.detection_head = nn.Linear(head_input_size, 1)

        # Multi-class classification head — raw logits; apply softmax at
        # inference or rely on CrossEntropyLoss during training.
        self.classification_head = nn.Linear(head_input_size, num_classes)

    # ------------------------------------------------------------------
    # Forward
    # ------------------------------------------------------------------

    def forward(self, x: torch.Tensor) -> dict[str, torch.Tensor]:
        """Run a forward pass.

        Parameters
        ----------
        x:
            Input tensor of shape ``(batch, seq_len, input_size)``.

        Returns
        -------
        dict:
            ``'detection'``  — ``(batch, 1)`` raw logits.
            ``'classification'`` — ``(batch, num_classes)`` raw logits.

            Activations (sigmoid / softmax) are applied at inference time
            or handled by the loss functions during training.
        """
        # lstm_out: (batch, seq_len, hidden_size * num_directions)
        lstm_out, _ = self.lstm(x)

        # Use the output at the last time-step.
        last_hidden = lstm_out[:, -1, :]  # (batch, head_input_size)

        detection_logits = self.detection_head(last_hidden)       # (batch, 1)
        classification_logits = self.classification_head(last_hidden)  # (batch, num_classes)

        return {
            "detection": detection_logits,
            "classification": classification_logits,
        }
