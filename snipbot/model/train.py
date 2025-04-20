"""Training loop for the HighlightLSTM model."""

from __future__ import annotations

import copy
import logging
from pathlib import Path
from typing import Any

import torch
import torch.nn as nn
from torch.utils.data import DataLoader

logger = logging.getLogger(__name__)


def train_model(
    model: nn.Module,
    train_loader: DataLoader,
    val_loader: DataLoader,
    epochs: int = 50,
    lr: float = 1e-3,
    device: str = "cpu",
    detection_weight: float = 1.0,
    classification_weight: float = 0.5,
    patience: int = 5,
    checkpoint_path: str | Path = "best_model.pt",
) -> dict[str, Any]:
    """Train the highlight detection / classification model.

    Parameters
    ----------
    model:
        A ``HighlightLSTM`` (or compatible) model instance.
    train_loader:
        DataLoader yielding ``(features, detection_label, class_label)``
        batches.
    val_loader:
        Validation DataLoader with the same batch format.
    epochs:
        Maximum number of training epochs.
    lr:
        Learning rate for the Adam optimiser.
    device:
        Torch device string (``'cpu'``, ``'cuda'``, etc.).
    detection_weight:
        Scalar weight applied to the detection (binary) loss.
    classification_weight:
        Scalar weight applied to the classification loss.
    patience:
        Number of epochs with no validation loss improvement before
        early stopping is triggered.
    checkpoint_path:
        File path where the best model state dict is saved.

    Returns
    -------
    dict:
        Training history containing per-epoch losses and metrics::

            {
                "train_loss": [float, ...],
                "val_loss": [float, ...],
                "train_det_loss": [float, ...],
                "train_cls_loss": [float, ...],
                "val_det_loss": [float, ...],
                "val_cls_loss": [float, ...],
                "val_det_accuracy": [float, ...],
                "val_cls_accuracy": [float, ...],
                "best_epoch": int,
            }
    """
    model = model.to(device)
    optimiser = torch.optim.Adam(model.parameters(), lr=lr)

    # Model now returns raw logits — use matching loss functions.
    detection_criterion = nn.BCEWithLogitsLoss()
    classification_criterion = nn.CrossEntropyLoss()

    history: dict[str, list[float]] = {
        "train_loss": [],
        "val_loss": [],
        "train_det_loss": [],
        "train_cls_loss": [],
        "val_det_loss": [],
        "val_cls_loss": [],
        "val_det_accuracy": [],
        "val_cls_accuracy": [],
    }

    best_val_loss = float("inf")
    best_epoch = 0
    best_state: dict[str, Any] | None = None
    epochs_without_improvement = 0

    for epoch in range(1, epochs + 1):
        # ----------------------------------------------------------
        # Training phase
        # ----------------------------------------------------------
        model.train()
        running_loss = 0.0
        running_det_loss = 0.0
        running_cls_loss = 0.0
        n_train_batches = 0

        for features, det_labels, cls_labels in train_loader:
            features = features.to(device)
            det_labels = det_labels.to(device).unsqueeze(1)  # (B, 1)
            cls_labels = cls_labels.to(device)

            optimiser.zero_grad()
            outputs = model(features)

            det_loss = detection_criterion(outputs["detection"], det_labels)
            cls_loss = classification_criterion(
                outputs["classification"], cls_labels
            )
            loss = detection_weight * det_loss + classification_weight * cls_loss

            loss.backward()
            optimiser.step()

            running_loss += loss.item()
            running_det_loss += det_loss.item()
            running_cls_loss += cls_loss.item()
            n_train_batches += 1

        avg_train_loss = running_loss / max(n_train_batches, 1)
        avg_train_det = running_det_loss / max(n_train_batches, 1)
        avg_train_cls = running_cls_loss / max(n_train_batches, 1)

        history["train_loss"].append(avg_train_loss)
        history["train_det_loss"].append(avg_train_det)
        history["train_cls_loss"].append(avg_train_cls)

        # ----------------------------------------------------------
        # Validation phase
        # ----------------------------------------------------------
        model.eval()
        running_val_loss = 0.0
        running_val_det = 0.0
        running_val_cls = 0.0
        correct_det = 0
        correct_cls = 0
        total_samples = 0

        with torch.no_grad():
            for features, det_labels, cls_labels in val_loader:
                features = features.to(device)
                det_labels = det_labels.to(device).unsqueeze(1)
                cls_labels = cls_labels.to(device)

                outputs = model(features)

                det_loss = detection_criterion(outputs["detection"], det_labels)
                cls_loss = classification_criterion(
                    outputs["classification"], cls_labels
                )
                loss = (
                    detection_weight * det_loss
                    + classification_weight * cls_loss
                )

                running_val_loss += loss.item()
                running_val_det += det_loss.item()
                running_val_cls += cls_loss.item()

                # Accuracy metrics (logits: >0 means predicted positive)
                det_preds = (outputs["detection"] >= 0.0).float()
                correct_det += (det_preds == det_labels).sum().item()

                cls_preds = outputs["classification"].argmax(dim=-1)
                correct_cls += (cls_preds == cls_labels).sum().item()

                total_samples += det_labels.size(0)

        n_val_batches = max(len(val_loader), 1)
        avg_val_loss = running_val_loss / n_val_batches
        avg_val_det = running_val_det / n_val_batches
        avg_val_cls = running_val_cls / n_val_batches
        det_acc = correct_det / max(total_samples, 1)
        cls_acc = correct_cls / max(total_samples, 1)

        history["val_loss"].append(avg_val_loss)
        history["val_det_loss"].append(avg_val_det)
        history["val_cls_loss"].append(avg_val_cls)
        history["val_det_accuracy"].append(det_acc)
        history["val_cls_accuracy"].append(cls_acc)

        logger.info(
            "Epoch %d/%d — train_loss=%.4f  val_loss=%.4f  "
            "det_acc=%.3f  cls_acc=%.3f",
            epoch,
            epochs,
            avg_train_loss,
            avg_val_loss,
            det_acc,
            cls_acc,
        )

        # ----------------------------------------------------------
        # Early stopping / checkpoint
        # ----------------------------------------------------------
        if avg_val_loss < best_val_loss:
            best_val_loss = avg_val_loss
            best_epoch = epoch
            best_state = copy.deepcopy(model.state_dict())
            epochs_without_improvement = 0
        else:
            epochs_without_improvement += 1

        if epochs_without_improvement >= patience:
            logger.info(
                "Early stopping triggered at epoch %d (patience=%d).",
                epoch,
                patience,
            )
            break

    # Save best checkpoint
    if best_state is not None:
        checkpoint_path = Path(checkpoint_path)
        checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
        torch.save(best_state, checkpoint_path)
        logger.info("Best model (epoch %d) saved to %s.", best_epoch, checkpoint_path)

    history["best_epoch"] = best_epoch  # type: ignore[assignment]
    return history
