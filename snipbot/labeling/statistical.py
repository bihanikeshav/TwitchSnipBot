"""Z-score based automatic highlight labeling."""

from __future__ import annotations

from typing import Any

import numpy as np


def auto_label(
    windows: list[Any],
    z_threshold: float = 2.5,
    secondary_weight: float = 0.3,
) -> list[tuple[int, bool]]:
    """Automatically label windows as highlights using Z-scores.

    The primary signal is the message rate (messages per unit time) of each
    window.  Secondary signals — emote density and caps ratio — are
    incorporated with a configurable weight to produce a composite score.

    A window is labelled as a highlight when its composite Z-score exceeds
    *z_threshold*.

    Parameters
    ----------
    windows:
        List of ``WindowFeatures`` objects.  Each must expose at least the
        following attributes:

        * ``message_rate`` (float)
        * ``emote_density`` (float)
        * ``caps_ratio`` (float)
    z_threshold:
        Minimum composite Z-score for a window to be flagged as a highlight.
    secondary_weight:
        Relative weight given to each secondary signal when computing the
        composite Z-score.  The primary signal (message_rate) always has
        a weight of ``1.0``.

    Returns
    -------
    list of (window_index, is_highlight):
        One entry per window.
    """
    if len(windows) == 0:
        return []

    message_rates = np.array(
        [w.message_rate for w in windows], dtype=np.float64
    )
    emote_densities = np.array(
        [w.emote_density for w in windows], dtype=np.float64
    )
    caps_ratios = np.array(
        [w.caps_ratio for w in windows], dtype=np.float64
    )

    z_message = _z_scores(message_rates)
    z_emote = _z_scores(emote_densities)
    z_caps = _z_scores(caps_ratios)

    # Composite score: weighted sum normalised by total weight so the
    # threshold semantics stay intuitive.
    total_weight = 1.0 + 2 * secondary_weight
    composite = (
        z_message + secondary_weight * z_emote + secondary_weight * z_caps
    ) / total_weight

    results: list[tuple[int, bool]] = []
    for idx, z in enumerate(composite):
        results.append((idx, bool(z > z_threshold)))

    return results


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _z_scores(values: np.ndarray) -> np.ndarray:
    """Compute Z-scores; returns zeros when standard deviation is ~0."""
    mean = values.mean()
    std = values.std()
    if std < 1e-9:
        return np.zeros_like(values)
    return (values - mean) / std
