"""Interactive CLI tool for manually annotating stream highlights."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


# Category mapping shown to the user.
CATEGORIES = {
    "1": ("funny", 0),
    "2": ("exciting", 1),
    "3": ("surprising", 2),
    "4": ("other", 3),
}


def run_annotation(
    windows: list[Any],
    messages: list[Any],
    label_store: Any = None,
    save_path: str | Path = "annotations.json",
    context_messages: int = 5,
) -> dict[int, dict]:
    """Launch an interactive CLI session for labelling highlight windows.

    Parameters
    ----------
    windows:
        List of ``WindowFeatures`` objects.  Each should expose at minimum
        ``window_start``, ``window_end``, ``message_rate``,
        ``emote_density``, and ``caps_ratio``.
    messages:
        List of ``ChatMessage`` objects used to show surrounding context.
        Each must have a ``timestamp`` and ``text`` attribute.
    label_store:
        A ``LabelStore`` instance for persisting labels.  If ``None``,
        labels are only saved to *save_path* as JSON.
    save_path:
        Path where progress is persisted (JSON) after each annotation.
    context_messages:
        Number of chat messages to display around each window.

    Returns
    -------
    dict:
        Labels keyed by window index::

            {
                0: {"is_highlight": True, "category": 1, "category_name": "exciting"},
                ...
            }
    """
    save_path = Path(save_path)
    labels: dict[int, dict] = {}

    # Pre-sort messages by timestamp for efficient look-ups.
    sorted_messages = sorted(messages, key=lambda m: m.timestamp)

    print(f"\n{'='*60}")
    print("  TwitchSnipBot — Highlight Annotation Tool")
    print(f"  {len(windows)} windows to review  |  {len(labels)} already labelled")
    print(f"{'='*60}\n")
    print("Commands:  y/n = highlight?   1-4 = category   s = skip   q = quit\n")

    for idx, window in enumerate(windows):
        # Show existing label status
        status = ""
        if idx in labels:
            lbl = labels[idx]
            hl = "HIGHLIGHT" if lbl.get("is_highlight") else "background"
            cat = lbl.get("category_name", "?")
            status = f"  [previously: {hl} / {cat}]"

        # Window header
        w_start = getattr(window, "window_start", "?")
        w_end = getattr(window, "window_end", "?")
        msg_rate = getattr(window, "message_rate", 0)
        emote_density = getattr(window, "emote_density", 0)
        caps_ratio = getattr(window, "caps_ratio", 0)

        print(f"--- Window {idx + 1}/{len(windows)} ---{status}")
        print(f"  Time:          {w_start} – {w_end}")
        print(f"  Message rate:  {msg_rate:.2f}")
        print(f"  Emote density: {emote_density:.3f}")
        print(f"  Caps ratio:    {caps_ratio:.3f}")

        # Show nearby messages
        _show_nearby_messages(sorted_messages, w_start, w_end, context_messages)

        # ---- Ask: is this a highlight? ----
        is_highlight = _ask_highlight()
        if is_highlight is None:  # quit
            _save(labels, save_path)
            print("\nProgress saved. Exiting.")
            return labels
        if is_highlight == "skip":
            print()
            continue

        # ---- Ask: category ----
        category_idx: int = 3  # default = other
        category_name: str = "other"
        if is_highlight:
            result = _ask_category()
            if result is None:  # quit
                _save(labels, save_path)
                print("\nProgress saved. Exiting.")
                return labels
            category_name, category_idx = result

        labels[idx] = {
            "is_highlight": is_highlight,
            "category": category_idx,
            "category_name": category_name,
        }

        # Persist to LabelStore if available.
        if label_store is not None:
            label_store.save_label(
                window.window_start, window.window_end,
                is_highlight, category=category_idx,
                source="manual", features=window,
            )

        _save(labels, save_path)
        print(f"  -> Saved: {'HIGHLIGHT' if is_highlight else 'background'}"
              f"{f' ({category_name})' if is_highlight else ''}\n")

    print(f"\nAll {len(windows)} windows reviewed. Labels saved to {save_path}.")
    return labels


# ------------------------------------------------------------------
# Internal helpers
# ------------------------------------------------------------------

def _show_nearby_messages(
    sorted_messages: list[Any],
    w_start: Any,
    w_end: Any,
    count: int,
) -> None:
    """Print chat messages that fall within or near the window."""
    try:
        start = float(w_start)
        end = float(w_end)
    except (TypeError, ValueError):
        return

    nearby = [
        m for m in sorted_messages if start - 5 <= m.timestamp <= end + 5
    ]
    if not nearby:
        print("  (no messages in range)")
        return

    displayed = nearby[:count * 2]  # show up to 2x context on each side
    print(f"  Messages ({len(displayed)} shown):")
    for m in displayed:
        prefix = ">>" if start <= m.timestamp <= end else "  "
        username = getattr(m, "username", "?")
        print(f"    {prefix} [{username}]: {m.text[:120]}")


def _ask_highlight() -> bool | str | None:
    """Prompt user for highlight decision. Returns bool, 'skip', or None."""
    while True:
        try:
            answer = input("  Highlight? (y/n/s=skip/q=quit): ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            return None
        if answer in ("y", "yes"):
            return True
        if answer in ("n", "no"):
            return False
        if answer in ("s", "skip"):
            return "skip"
        if answer in ("q", "quit"):
            return None
        print("    Please enter y, n, s, or q.")


def _ask_category() -> tuple[str, int] | None:
    """Prompt user for category selection."""
    print("  Category:  1=funny  2=exciting  3=surprising  4=other")
    while True:
        try:
            answer = input("  Category (1-4/q=quit): ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            return None
        if answer in ("q", "quit"):
            return None
        if answer in CATEGORIES:
            return CATEGORIES[answer]
        print("    Please enter 1, 2, 3, 4, or q.")


def _save(labels: dict[int, dict], path: Path) -> None:
    """Persist labels to a JSON file."""
    # Convert integer keys to strings for JSON compatibility.
    serialisable = {str(k): v for k, v in labels.items()}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(serialisable, indent=2), encoding="utf-8")
