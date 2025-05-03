"""SQLite persistence layer for highlight labels."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

import numpy as np

# Category name -> int mapping.
_CATEGORY_MAP: dict[str, int] = {
    "funny": 0,
    "exciting": 1,
    "surprising": 2,
    "other": 3,
}


class LabelStore:
    """Persistent storage for highlight annotations backed by SQLite.

    Parameters
    ----------
    db_path:
        Path to the SQLite database file.  Created automatically if it
        does not exist.
    """

    def __init__(self, db_path: str | Path = "labels.db") -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.db_path))
        self._conn.row_factory = sqlite3.Row
        self._create_table()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def save_label(
        self,
        window_start: float,
        window_end: float,
        is_highlight: bool,
        category: int | str = 3,
        source: str = "auto",
        features: Any = None,
    ) -> None:
        """Insert or update a label for a specific window.

        If a label already exists for the ``(window_start, window_end)``
        pair it is replaced (upsert).

        Parameters
        ----------
        window_start:
            Start timestamp (Unix epoch seconds) of the window.
        window_end:
            End timestamp of the window.
        is_highlight:
            ``True`` if the window is a highlight.
        category:
            Integer class index (0-3) or string name (``'funny'``,
            ``'exciting'``, ``'surprising'``, ``'other'``).
        source:
            ``'auto'`` for statistical labelling or ``'manual'`` for
            human annotation.
        features:
            Optional feature vector (list, numpy array, or
            ``WindowFeatures``).  Stored for training data export.
        """
        # Map string category to int.
        if isinstance(category, str):
            category = _CATEGORY_MAP.get(category, 3)

        # Serialise features.
        feat_json: str | None = None
        if features is not None:
            if hasattr(features, "to_vector"):
                feat_json = json.dumps(features.to_vector().tolist())
            elif isinstance(features, np.ndarray):
                feat_json = json.dumps(features.tolist())
            elif isinstance(features, (list, tuple)):
                feat_json = json.dumps(list(features))

        self._conn.execute(
            """
            INSERT INTO labels (window_start, window_end, is_highlight, category, source, features)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(window_start, window_end)
            DO UPDATE SET
                is_highlight = excluded.is_highlight,
                category     = excluded.category,
                source       = excluded.source,
                features     = excluded.features
            """,
            (window_start, window_end, int(is_highlight), category, source, feat_json),
        )
        self._conn.commit()

    def get_labels(self) -> list[dict[str, Any]]:
        """Return all stored labels as a list of dicts.

        Each dict contains: ``window_start``, ``window_end``,
        ``is_highlight``, ``category``, ``source``.
        """
        cursor = self._conn.execute(
            "SELECT window_start, window_end, is_highlight, category, source "
            "FROM labels ORDER BY window_start"
        )
        return [self._row_to_dict(row) for row in cursor.fetchall()]

    def _get_labels_with_features(self) -> list[dict[str, Any]]:
        """Return all labels including parsed feature vectors."""
        cursor = self._conn.execute(
            "SELECT window_start, window_end, is_highlight, category, source, features "
            "FROM labels ORDER BY window_start"
        )
        results: list[dict[str, Any]] = []
        for row in cursor.fetchall():
            d = self._row_to_dict(row)
            feat_raw = row["features"] if "features" in row.keys() else None
            if feat_raw:
                d["features"] = json.loads(feat_raw)
            else:
                d["features"] = None
            results.append(d)
        return results

    def get_label(
        self, window_start: float, window_end: float
    ) -> dict[str, Any] | None:
        """Retrieve a single label by its window boundaries.

        Returns ``None`` if no matching label exists.
        """
        cursor = self._conn.execute(
            "SELECT window_start, window_end, is_highlight, category, source "
            "FROM labels WHERE window_start = ? AND window_end = ?",
            (window_start, window_end),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return self._row_to_dict(row)

    def export_dataset(
        self,
        sequence_length: int = 12,
    ) -> tuple[list[list[list[float]]], list[int], list[int]]:
        """Export labels as training-ready sequences.

        Groups consecutive labelled windows into overlapping sequences
        of length *sequence_length*.  Each sequence's label is taken from
        its last window (the prediction target).

        Parameters
        ----------
        sequence_length:
            Number of consecutive windows per training sequence.

        Returns
        -------
        tuple:
            ``(sequences, detection_labels, classification_labels)``

            * ``sequences`` — list of feature sequences, each a list of
              ``sequence_length`` feature vectors (list of floats).
            * ``detection_labels`` — list of ints (0 or 1), one per
              sequence.
            * ``classification_labels`` — list of ints (0-3), one per
              sequence.
        """
        rows = self._get_labels_with_features()

        # Filter to rows that have stored features.
        valid = [
            (r["features"], int(r["is_highlight"]), int(r["category"]))
            for r in rows
            if r.get("features") is not None
        ]

        if len(valid) < sequence_length:
            return [], [], []

        all_features = [v[0] for v in valid]
        all_det = [v[1] for v in valid]
        all_cls = [v[2] for v in valid]

        sequences: list[list[list[float]]] = []
        det_labels: list[int] = []
        cls_labels: list[int] = []

        for i in range(len(valid) - sequence_length + 1):
            seq = all_features[i : i + sequence_length]
            sequences.append(seq)
            det_labels.append(all_det[i + sequence_length - 1])
            cls_labels.append(all_cls[i + sequence_length - 1])

        return sequences, det_labels, cls_labels

    def close(self) -> None:
        """Close the underlying database connection."""
        self._conn.close()

    # ------------------------------------------------------------------
    # Context-manager support
    # ------------------------------------------------------------------

    def __enter__(self) -> "LabelStore":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _create_table(self) -> None:
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS labels (
                window_start REAL    NOT NULL,
                window_end   REAL    NOT NULL,
                is_highlight INTEGER NOT NULL,
                category     INTEGER NOT NULL,
                source       TEXT    NOT NULL DEFAULT 'auto',
                features     TEXT,
                PRIMARY KEY (window_start, window_end)
            )
            """
        )
        self._conn.commit()
        # Add features column to existing databases that lack it.
        try:
            self._conn.execute("ALTER TABLE labels ADD COLUMN features TEXT")
            self._conn.commit()
        except sqlite3.OperationalError:
            pass  # Column already exists.

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "window_start": row["window_start"],
            "window_end": row["window_end"],
            "is_highlight": bool(row["is_highlight"]),
            "category": row["category"],
            "source": row["source"],
        }
