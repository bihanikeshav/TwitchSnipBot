"""Live real-time highlight detection pipeline.

Connects to Twitch IRC via :class:`~snipbot.ingestion.irc_live.TwitchIRCClient`,
processes messages through sliding windows, and emits
:class:`~snipbot.pipeline.moment.DetectedMoment` events via registered
callbacks when a highlight is detected.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from pathlib import Path
from typing import Any, Callable, Awaitable

import numpy as np

from snipbot.features.extractors import extract_features as _canonical_extract
from snipbot.ingestion.irc_live import TwitchIRCClient
from snipbot.ingestion.message import ChatMessage
from snipbot.pipeline.moment import DetectedMoment

logger = logging.getLogger(__name__)

_CATEGORIES = ["exciting", "funny", "surprising", "other"]

# Type for highlight callbacks — sync or async callables.
HighlightCallback = Callable[[DetectedMoment], Any]


class RollingPredictor:
    """Maintains a rolling buffer of feature windows for inference.

    When enough windows have accumulated (``sequence_length``), the
    predictor can run the LSTM model or fall back to a statistical
    z-score detector.

    Parameters
    ----------
    config:
        Configuration dict (mirrors ``config.ModelConfig`` /
        ``config.DetectionConfig`` fields).
    """

    def __init__(self, config: dict | None = None) -> None:
        cfg = config or {}
        self._seq_len: int = cfg.get("sequence_length", 12)
        self._z_threshold: float = cfg.get("z_score_threshold", 2.5)
        self._buffer: deque[list[float]] = deque(maxlen=self._seq_len)

        # Running statistics for z-score fallback.
        self._msg_counts: deque[float] = deque(maxlen=500)
        self._emote_ratios: deque[float] = deque(maxlen=500)
        self._caps_ratios: deque[float] = deque(maxlen=500)

        # Try loading the model once.
        self._model = self._try_load_model(cfg)

    # ------------------------------------------------------------------

    def _try_load_model(self, cfg: dict) -> Any:
        """Attempt to load a trained LSTM model; return None on failure."""
        checkpoint = cfg.get("checkpoint", "models/best.pt")
        if not Path(checkpoint).exists():
            logger.info("No model checkpoint at %s — using statistical fallback", checkpoint)
            return None

        try:
            import torch
            from snipbot.model.lstm import HighlightLSTM

            model = HighlightLSTM(
                input_size=cfg.get("input_size", 12),
                hidden_size=cfg.get("hidden_size", 128),
                num_layers=cfg.get("num_layers", 2),
                dropout=0.0,
                num_classes=cfg.get("num_classes", 4),
            )
            model.load_state_dict(torch.load(checkpoint, map_location="cpu"))
            model.eval()
            logger.info("Loaded model from %s", checkpoint)
            return model
        except Exception:
            logger.warning("Failed to load model — using statistical fallback", exc_info=True)
            return None

    # ------------------------------------------------------------------

    def predict(self, features: list[float]) -> tuple[float, dict[str, float]]:
        """Add a feature vector and return (detection_score, category_scores).

        Parameters
        ----------
        features:
            12-dimensional feature vector for the current window.

        Returns
        -------
        tuple:
            ``(score, category_scores)`` where score is in ``[0, 1]``.
        """
        self._buffer.append(features)

        # Update running stats (canonical indices: 0=msg_rate, 3=emote_density, 4=caps_ratio).
        self._msg_counts.append(features[0])
        self._emote_ratios.append(features[3])
        self._caps_ratios.append(features[4])

        if self._model is not None:
            return self._predict_model(features)
        return self._predict_statistical(features)

    def _predict_model(self, features: list[float]) -> tuple[float, dict[str, float]]:
        """Run inference through the LSTM model."""
        import torch

        seq = list(self._buffer)
        if len(seq) < self._seq_len:
            padding = [[0.0] * len(features)] * (self._seq_len - len(seq))
            seq = padding + seq

        tensor = torch.tensor([seq], dtype=torch.float32)
        with torch.no_grad():
            output = self._model(tensor)

        # Model returns logits — apply activations.
        det_score = float(torch.sigmoid(output["detection"]).squeeze())
        cls_probs = torch.softmax(output["classification"], dim=-1).squeeze().tolist()
        cat_scores = dict(zip(_CATEGORIES, cls_probs))
        return det_score, cat_scores

    def _predict_statistical(self, features: list[float]) -> tuple[float, dict[str, float]]:
        """Z-score-based anomaly detection (model-free fallback)."""
        if len(self._msg_counts) < 10:
            return 0.0, {c: 0.0 for c in _CATEGORIES}

        def _z(val: float, history: deque) -> float:
            arr = np.array(history)
            mu, sigma = arr.mean(), arr.std()
            if sigma == 0:
                return 0.0
            return (val - mu) / sigma

        z_msg = _z(features[0], self._msg_counts)
        z_emote = _z(features[4], self._emote_ratios)
        z_caps = _z(features[3], self._caps_ratios)

        raw = 0.5 * z_msg + 0.3 * z_emote + 0.2 * z_caps
        score = float(np.clip(raw / self._z_threshold, 0.0, 1.0))

        cat_scores = {
            "exciting": float(np.clip(z_msg / max(self._z_threshold, 1), 0, 1)),
            "funny": float(np.clip(z_emote / max(self._z_threshold, 1), 0, 1)),
            "surprising": float(np.clip(z_caps / max(self._z_threshold, 1), 0, 1)),
            "other": 0.1,
        }
        return score, cat_scores


def _extract_features(messages: list[ChatMessage], window_start: float, window_end: float) -> list[float]:
    """Compute a 12-d feature vector using the canonical extractor."""
    wf = _canonical_extract(messages, window_start, window_end)
    return wf.features.tolist()


# ---------------------------------------------------------------------------
# LivePipeline
# ---------------------------------------------------------------------------


class LivePipeline:
    """Real-time highlight detection pipeline.

    Connects to Twitch IRC, accumulates messages in a sliding window,
    and fires registered callbacks when a highlight is detected.

    Parameters
    ----------
    channel:
        Twitch channel name (without ``#``).
    config:
        Configuration dict.  Relevant keys: ``detection``, ``model``.
    plugins:
        Optional list of plugin instances with a
        ``process(messages, moment)`` method.
    """

    def __init__(
        self,
        channel: str,
        config: dict | None = None,
        plugins: list | None = None,
    ) -> None:
        self.channel = channel
        self._cfg = config or {}
        self._plugins = plugins or []
        self._callbacks: list[HighlightCallback] = []

        det_cfg = self._cfg.get("detection", {})
        self._window_size: float = det_cfg.get("window_size", 10)
        self._stride: float = det_cfg.get("stride", 5)
        self._sensitivity: float = det_cfg.get("sensitivity", 0.7)
        self._cooldown: float = det_cfg.get("cooldown", 30)

        model_cfg = self._cfg.get("model", {})
        self._predictor = RollingPredictor(model_cfg)

        # Message buffer (sliding window).
        self._message_buffer: deque[ChatMessage] = deque()
        self._last_highlight_time: float = 0.0

    # ------------------------------------------------------------------
    # Callback registration
    # ------------------------------------------------------------------

    def on_highlight(self, callback: HighlightCallback) -> None:
        """Register a callback invoked when a highlight is detected.

        The callback receives a single :class:`DetectedMoment` argument.
        It may be a regular function or an ``async`` coroutine.
        """
        self._callbacks.append(callback)

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------

    async def run(self) -> None:
        """Connect to Twitch IRC and process messages indefinitely.

        This coroutine runs until cancelled or the connection drops
        without reconnecting.
        """
        client = TwitchIRCClient(self.channel)
        logger.info("Starting live pipeline for #%s", self.channel)

        last_window_time = 0.0

        async for msg in client.messages():
            self._message_buffer.append(msg)

            # Evict messages older than 2x window size.
            cutoff = msg.timestamp - self._window_size * 2
            while self._message_buffer and self._message_buffer[0].timestamp < cutoff:
                self._message_buffer.popleft()

            # Only evaluate every *stride* seconds.
            if msg.timestamp - last_window_time < self._stride:
                continue
            last_window_time = msg.timestamp

            # Build current window.
            window_start = msg.timestamp - self._window_size
            window_msgs = [
                m for m in self._message_buffer if m.timestamp >= window_start
            ]

            if not window_msgs:
                continue

            # Extract features and predict.
            features = _extract_features(window_msgs, window_start, msg.timestamp)
            score, cat_scores = self._predictor.predict(features)

            if score < self._sensitivity:
                continue

            # Cooldown: don't fire highlights too close together.
            if msg.timestamp - self._last_highlight_time < self._cooldown:
                logger.debug(
                    "Highlight suppressed (cooldown): score=%.2f at %.1f",
                    score,
                    msg.timestamp,
                )
                continue

            self._last_highlight_time = msg.timestamp

            top_cat = max(cat_scores, key=cat_scores.get)  # type: ignore[arg-type]
            moment = DetectedMoment(
                timestamp=msg.timestamp,
                duration=self._window_size,
                detection_score=score,
                category=top_cat,
                category_scores=cat_scores,
                window_features=features,
                metadata={"channel": self.channel},
            )

            # Run plugins.
            for plugin in self._plugins:
                try:
                    plugin.process(window_msgs, moment)
                except Exception:
                    logger.exception("Plugin %s failed", plugin)

            logger.info(
                "Highlight detected: score=%.2f cat=%s at %.1f",
                score,
                top_cat,
                msg.timestamp,
            )

            # Fire callbacks.
            await self._emit(moment)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    async def _emit(self, moment: DetectedMoment) -> None:
        """Invoke all registered callbacks with the detected moment."""
        for cb in self._callbacks:
            try:
                result = cb(moment)
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                logger.exception("Highlight callback %s raised an error", cb)
