"""Offline batch pipeline for highlight detection.

Reads a chat log, creates sliding windows, extracts features, runs
detection (model or statistical), and optionally cuts clips from a
downloaded VOD.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import numpy as np

from snipbot.features.extractors import extract_features
from snipbot.features.window import SlidingWindowManager
from snipbot.ingestion.log_parser import parse_irc_log, parse_blast_log
from snipbot.ingestion.message import ChatMessage
from snipbot.pipeline.moment import DetectedMoment

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Chat log parsing — delegates to canonical parsers
# ---------------------------------------------------------------------------


def _auto_parse_log(log_path: str) -> list[ChatMessage]:
    """Auto-detect log format (IRC vs BLAST) and parse into ChatMessages."""
    path = Path(log_path)
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        first_line = fh.readline().strip()

    if first_line.startswith("["):
        messages = parse_blast_log(log_path)
    else:
        messages = parse_irc_log(log_path)

    logger.info("Parsed %d messages from %s", len(messages), path.name)
    return messages


# ---------------------------------------------------------------------------
# Statistical detection (fallback when no trained model is available)
# ---------------------------------------------------------------------------

_CATEGORIES = ["exciting", "funny", "surprising", "other"]


def _statistical_detect(
    feature_matrix: np.ndarray,
    z_threshold: float = 2.5,
) -> list[tuple[float, dict[str, float]]]:
    """Z-score-based anomaly detection on message rate & emote features.

    Returns a list of ``(detection_score, category_scores)`` per window.
    """
    # Canonical feature indices: 0=msg_rate, 3=emote_density, 4=caps_ratio
    msg_counts = feature_matrix[:, 0]
    emote_ratios = feature_matrix[:, 3]
    caps_ratios = feature_matrix[:, 4]

    def _z_scores(arr: np.ndarray) -> np.ndarray:
        mu = arr.mean()
        sigma = arr.std()
        if sigma == 0:
            return np.zeros_like(arr)
        return (arr - mu) / sigma

    z_msg = _z_scores(msg_counts)
    z_emote = _z_scores(emote_ratios)
    z_caps = _z_scores(caps_ratios)

    results: list[tuple[float, dict[str, float]]] = []
    for i in range(len(feature_matrix)):
        # Composite score: weighted sum of z-scores, clamped to [0, 1].
        raw = 0.5 * z_msg[i] + 0.3 * z_emote[i] + 0.2 * z_caps[i]
        score = float(np.clip(raw / z_threshold, 0.0, 1.0))

        # Heuristic category assignment based on feature dominance.
        cat_scores = {
            "exciting": float(np.clip(z_msg[i] / max(z_threshold, 1), 0, 1)),
            "funny": float(np.clip(z_emote[i] / max(z_threshold, 1), 0, 1)),
            "surprising": float(np.clip(z_caps[i] / max(z_threshold, 1), 0, 1)),
            "other": 0.1,
        }

        results.append((score, cat_scores))

    return results


# ---------------------------------------------------------------------------
# Model-based detection (when a checkpoint is available)
# ---------------------------------------------------------------------------


def _model_detect(
    feature_matrix: np.ndarray,
    config: dict,
) -> list[tuple[float, dict[str, float]]]:
    """Run the LSTM model for detection and classification.

    Falls back to statistical detection if the checkpoint is not found.
    """
    import torch

    from snipbot.model.lstm import HighlightLSTM

    checkpoint_path = config.get("checkpoint", "models/best.pt")
    if not Path(checkpoint_path).exists():
        logger.warning(
            "Model checkpoint not found at %s — falling back to statistical detection",
            checkpoint_path,
        )
        return _statistical_detect(feature_matrix, config.get("z_score_threshold", 2.5))

    model = HighlightLSTM(
        input_size=config.get("input_size", 12),
        hidden_size=config.get("hidden_size", 128),
        num_layers=config.get("num_layers", 2),
        dropout=0.0,  # inference mode
        num_classes=config.get("num_classes", 4),
    )
    model.load_state_dict(torch.load(checkpoint_path, map_location="cpu"))
    model.eval()

    seq_len = config.get("sequence_length", 12)
    results: list[tuple[float, dict[str, float]]] = []

    with torch.no_grad():
        for i in range(len(feature_matrix)):
            # Build a sequence ending at window i.
            start = max(0, i - seq_len + 1)
            seq = feature_matrix[start : i + 1]

            # Pad if needed.
            if len(seq) < seq_len:
                pad = np.zeros((seq_len - len(seq), seq.shape[1]))
                seq = np.vstack([pad, seq])

            tensor = torch.tensor(seq, dtype=torch.float32).unsqueeze(0)
            output = model(tensor)

            # Model returns logits — apply activations.
            det_score = float(torch.sigmoid(output["detection"]).squeeze())
            cls_probs = torch.softmax(output["classification"], dim=-1).squeeze().tolist()

            cat_scores = dict(zip(_CATEGORIES, cls_probs))
            results.append((det_score, cat_scores))

    return results


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def run_batch_pipeline(
    log_path: str,
    vod_path: str | None = None,
    config: dict | None = None,
    plugins: list | None = None,
) -> list[DetectedMoment]:
    """Run the full offline batch pipeline.

    Parameters
    ----------
    log_path:
        Path to the chat log file (text or JSONL).
    vod_path:
        Optional path to the downloaded VOD.  If provided, clips will
        be cut at each detected highlight.
    config:
        Configuration dict (keys mirror :class:`config.Config`
        dataclass fields).  ``None`` uses sensible defaults.
    plugins:
        Optional list of plugin instances with a
        ``process(messages, moment)`` method.

    Returns
    -------
    list[DetectedMoment]:
        All detected moments, sorted chronologically.
    """
    cfg = config or {}
    det_cfg = cfg.get("detection", {})
    clip_cfg = cfg.get("clipping", {})
    comp_cfg = cfg.get("compilation", {})
    model_cfg = cfg.get("model", {})

    window_size = det_cfg.get("window_size", 10)
    stride = det_cfg.get("stride", 5)
    sensitivity = det_cfg.get("sensitivity", 0.7)
    pre_highlight = clip_cfg.get("pre_highlight", 15)
    post_highlight = clip_cfg.get("post_highlight", 10)
    clip_format = clip_cfg.get("format", "mp4")

    # Step 1 — Parse chat log.
    messages = _auto_parse_log(log_path)
    if not messages:
        logger.warning("No messages parsed from %s", log_path)
        return []

    # Sort chronologically.
    messages.sort(key=lambda m: m.timestamp)

    # Step 2 — Create sliding windows using canonical SlidingWindowManager.
    wm = SlidingWindowManager(window_size=window_size, stride=stride)
    windows_raw = wm.create_windows(messages)
    logger.info("Created %d windows (size=%.0fs, stride=%.0fs)", len(windows_raw), window_size, stride)

    if not windows_raw:
        return []

    # Step 3 — Extract features using canonical extractor.
    window_features = [
        extract_features(msgs, start, end)
        for start, end, msgs in windows_raw
    ]
    feature_matrix = np.array([wf.features for wf in window_features])

    # Step 4 — Run detection.
    use_model = model_cfg.get("type") and model_cfg.get("checkpoint")
    if use_model:
        predictions = _model_detect(feature_matrix, model_cfg)
    else:
        z_thresh = det_cfg.get("z_score_threshold", 2.5)
        predictions = _statistical_detect(feature_matrix, z_thresh)

    # Step 5 — Create DetectedMoment objects for windows above threshold.
    moments: list[DetectedMoment] = []
    for idx, (score, cat_scores) in enumerate(predictions):
        if score < sensitivity:
            continue

        # Centre timestamp of the window.
        _, _, window_msgs = windows_raw[idx]
        if window_msgs:
            centre_ts = (window_msgs[0].timestamp + window_msgs[-1].timestamp) / 2
        else:
            # Estimate from window index.
            centre_ts = messages[0].timestamp + idx * stride + window_size / 2

        top_cat = max(cat_scores, key=cat_scores.get)  # type: ignore[arg-type]

        moment = DetectedMoment(
            timestamp=centre_ts,
            duration=float(window_size),
            detection_score=score,
            category=top_cat,
            category_scores=cat_scores,
            window_features=feature_matrix[idx].tolist(),
        )

        # Run plugins.
        for plugin in (plugins or []):
            try:
                plugin.process(window_msgs, moment)
            except Exception:
                logger.exception("Plugin %s failed on moment at %.1f", plugin, centre_ts)

        moments.append(moment)

    # Merge overlapping moments (within one window size of each other).
    moments = _merge_nearby(moments, min_gap=float(window_size))

    logger.info("Detected %d highlight moment(s)", len(moments))

    # Step 6 — Cut clips (if VOD provided).
    if vod_path and moments:
        from snipbot.clipping.clip_cutter import cut_clips
        from snipbot.clipping.timestamp_mapper import TimestampMapper

        vod_start = messages[0].timestamp  # approximate
        mapper = TimestampMapper(vod_start)

        clip_moments: list[tuple[float, float]] = []
        for m in moments:
            vod_pos = mapper.chat_to_vod(m.timestamp)
            start = max(0.0, vod_pos - pre_highlight)
            end = vod_pos + post_highlight
            clip_moments.append((start, end))

        output_dir = str(Path(vod_path).parent / "clips")
        clip_paths = cut_clips(vod_path, output_dir, clip_moments, format=clip_format)

        for m, cp in zip(moments, clip_paths):
            m.clip_path = cp
            m.metadata["vod_position"] = mapper.chat_to_vod(m.timestamp)

    # Step 7 — Compile highlight reel (optional).
    clip_paths_available = [m.clip_path for m in moments if m.clip_path]
    if clip_paths_available and comp_cfg.get("enabled", False):
        from snipbot.clipping.compiler import compile_highlights

        reel_path = str(Path(clip_paths_available[0]).parent / f"highlights.{clip_format}")
        compile_highlights(
            clip_paths=clip_paths_available,
            output_path=reel_path,
            transition=comp_cfg.get("transition", "crossfade"),
            transition_duration=comp_cfg.get("transition_duration", 0.5),
        )
        logger.info("Compiled highlight reel: %s", reel_path)

    return moments


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _merge_nearby(
    moments: list[DetectedMoment],
    min_gap: float,
) -> list[DetectedMoment]:
    """Merge moments that are closer than *min_gap* seconds.

    Keeps the moment with the highest detection score from each cluster.
    """
    if not moments:
        return []

    sorted_moments = sorted(moments, key=lambda m: m.timestamp)
    merged: list[DetectedMoment] = [sorted_moments[0]]

    for m in sorted_moments[1:]:
        if m.timestamp - merged[-1].timestamp < min_gap:
            # Keep the one with higher score.
            if m.detection_score > merged[-1].detection_score:
                merged[-1] = m
        else:
            merged.append(m)

    return merged
