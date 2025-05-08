"""SQLite database manager for TwitchSnipBot."""

import json
import sqlite3
import threading
from typing import Any, Optional


class Database:
    """Lightweight SQLite wrapper for persisting recordings, highlights, clips,
    schedules, and plugin state.

    Thread-safe: each thread gets its own connection via thread-local storage.
    The schema is auto-created on first initialisation.
    """

    def __init__(self, db_path: str = "snipbot.db") -> None:
        self._db_path = db_path
        self._local = threading.local()
        self._init_schema()

    # ------------------------------------------------------------------
    # Connection helpers
    # ------------------------------------------------------------------

    def _get_conn(self) -> sqlite3.Connection:
        """Return a per-thread SQLite connection."""
        conn: Optional[sqlite3.Connection] = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self._db_path, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            self._local.conn = conn
        return conn

    def _init_schema(self) -> None:
        """Create tables if they don't already exist."""
        conn = self._get_conn()
        conn.executescript(_SCHEMA_SQL)
        conn.commit()

    # ------------------------------------------------------------------
    # Recordings
    # ------------------------------------------------------------------

    def save_recording(
        self,
        channel: str,
        start_time: str,
        end_time: Optional[str] = None,
        status: str = "scheduled",
    ) -> int:
        conn = self._get_conn()
        cursor = conn.execute(
            "INSERT INTO recordings (channel, start_time, end_time, status) VALUES (?, ?, ?, ?)",
            (channel, start_time, end_time, status),
        )
        conn.commit()
        return cursor.lastrowid  # type: ignore[return-value]

    def get_recordings(self) -> list[dict[str, Any]]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT * FROM recordings ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    def get_recording(self, recording_id: int) -> Optional[dict[str, Any]]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM recordings WHERE id = ?", (recording_id,)
        ).fetchone()
        return dict(row) if row else None

    def update_recording(self, recording_id: int, **kwargs: Any) -> None:
        if not kwargs:
            return
        set_clause = ", ".join(f"{k} = ?" for k in kwargs)
        values = list(kwargs.values()) + [recording_id]
        conn = self._get_conn()
        conn.execute(
            f"UPDATE recordings SET {set_clause} WHERE id = ?", values
        )
        conn.commit()

    def delete_recording(self, recording_id: int) -> None:
        conn = self._get_conn()
        conn.execute("DELETE FROM recordings WHERE id = ?", (recording_id,))
        conn.commit()

    # ------------------------------------------------------------------
    # Highlights
    # ------------------------------------------------------------------

    def save_highlight(
        self,
        recording_id: int,
        timestamp: float,
        duration: float,
        category: str,
        confidence: float,
        metadata: Optional[dict[str, Any]] = None,
    ) -> int:
        conn = self._get_conn()
        cursor = conn.execute(
            "INSERT INTO highlights (recording_id, timestamp, duration, category, confidence, metadata)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (recording_id, timestamp, duration, category, confidence, json.dumps(metadata or {})),
        )
        conn.commit()
        return cursor.lastrowid  # type: ignore[return-value]

    def get_highlights(
        self,
        limit: int = 20,
        offset: int = 0,
        **filters: Any,
    ) -> list[dict[str, Any]]:
        conn = self._get_conn()
        where, params = _build_where(filters)
        sql = f"SELECT * FROM highlights{where} ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = conn.execute(sql, params).fetchall()
        return [_deserialize_highlight(r) for r in rows]

    def get_highlight(self, highlight_id: int) -> Optional[dict[str, Any]]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM highlights WHERE id = ?", (highlight_id,)
        ).fetchone()
        return _deserialize_highlight(row) if row else None

    def count_highlights(self, **filters: Any) -> int:
        conn = self._get_conn()
        where, params = _build_where(filters)
        row = conn.execute(f"SELECT COUNT(*) as cnt FROM highlights{where}", params).fetchone()
        return row["cnt"] if row else 0

    # ------------------------------------------------------------------
    # Clips
    # ------------------------------------------------------------------

    def save_clip(
        self,
        recording_id: int,
        file_path: str,
        start_time: float,
        end_time: float,
        category: str = "",
        metadata: Optional[dict[str, Any]] = None,
    ) -> int:
        conn = self._get_conn()
        cursor = conn.execute(
            "INSERT INTO clips (recording_id, file_path, start_time, end_time, category, metadata)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (recording_id, file_path, start_time, end_time, category, json.dumps(metadata or {})),
        )
        conn.commit()
        return cursor.lastrowid  # type: ignore[return-value]

    def get_clips(
        self,
        limit: int = 20,
        offset: int = 0,
        **filters: Any,
    ) -> list[dict[str, Any]]:
        conn = self._get_conn()
        where, params = _build_where(filters)
        sql = f"SELECT * FROM clips{where} ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = conn.execute(sql, params).fetchall()
        return [_deserialize_clip(r) for r in rows]

    def get_clip(self, clip_id: int) -> Optional[dict[str, Any]]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM clips WHERE id = ?", (clip_id,)
        ).fetchone()
        return _deserialize_clip(row) if row else None

    def count_clips(self, **filters: Any) -> int:
        conn = self._get_conn()
        where, params = _build_where(filters)
        row = conn.execute(f"SELECT COUNT(*) as cnt FROM clips{where}", params).fetchone()
        return row["cnt"] if row else 0

    # ------------------------------------------------------------------
    # Schedules
    # ------------------------------------------------------------------

    def save_schedule(
        self,
        job_id: str,
        job_type: str,
        run_at: str,
        payload: Optional[dict[str, Any]] = None,
    ) -> int:
        conn = self._get_conn()
        cursor = conn.execute(
            "INSERT INTO schedules (job_id, job_type, run_at, payload) VALUES (?, ?, ?, ?)",
            (job_id, job_type, run_at, json.dumps(payload or {})),
        )
        conn.commit()
        return cursor.lastrowid  # type: ignore[return-value]

    def get_schedules(self) -> list[dict[str, Any]]:
        conn = self._get_conn()
        rows = conn.execute("SELECT * FROM schedules ORDER BY run_at ASC").fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["payload"] = json.loads(d["payload"]) if d.get("payload") else {}
            result.append(d)
        return result

    def delete_schedule(self, schedule_id: int) -> None:
        conn = self._get_conn()
        conn.execute("DELETE FROM schedules WHERE id = ?", (schedule_id,))
        conn.commit()

    # ------------------------------------------------------------------
    # Plugin state
    # ------------------------------------------------------------------

    def save_plugin_state(
        self,
        name: str,
        version: str = "0.0.0",
        enabled: bool = True,
        config: Optional[dict[str, Any]] = None,
    ) -> int:
        conn = self._get_conn()
        config_json = json.dumps(config or {})
        cursor = conn.execute(
            "INSERT OR REPLACE INTO plugin_state (name, version, enabled, config) VALUES (?, ?, ?, ?)",
            (name, version, int(enabled), config_json),
        )
        conn.commit()
        return cursor.lastrowid  # type: ignore[return-value]

    def get_plugin_states(self) -> list[dict[str, Any]]:
        conn = self._get_conn()
        rows = conn.execute("SELECT * FROM plugin_state ORDER BY name ASC").fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["config"] = json.loads(d["config"]) if isinstance(d.get("config"), str) else d.get("config", {})
            result.append(d)
        return result

    def get_plugin_state(self, name: str) -> Optional[dict[str, Any]]:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT * FROM plugin_state WHERE name = ?", (name,)
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        d["config"] = json.loads(d["config"]) if isinstance(d.get("config"), str) else d.get("config", {})
        return d

    def update_plugin_state(self, name: str, **kwargs: Any) -> None:
        if not kwargs:
            return
        set_clause = ", ".join(f"{k} = ?" for k in kwargs)
        values = list(kwargs.values()) + [name]
        conn = self._get_conn()
        conn.execute(
            f"UPDATE plugin_state SET {set_clause} WHERE name = ?", values
        )
        conn.commit()


# ======================================================================
# Schema
# ======================================================================

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS recordings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    channel     TEXT    NOT NULL,
    start_time  TEXT    NOT NULL,
    end_time    TEXT,
    status      TEXT    NOT NULL DEFAULT 'scheduled',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS highlights (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    recording_id INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    timestamp    REAL    NOT NULL,
    duration     REAL    NOT NULL DEFAULT 0,
    category     TEXT    NOT NULL DEFAULT '',
    confidence   REAL    NOT NULL DEFAULT 0,
    metadata     TEXT    NOT NULL DEFAULT '{}',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clips (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    recording_id INTEGER NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    file_path    TEXT    NOT NULL DEFAULT '',
    start_time   REAL    NOT NULL DEFAULT 0,
    end_time     REAL    NOT NULL DEFAULT 0,
    category     TEXT    NOT NULL DEFAULT '',
    metadata     TEXT    NOT NULL DEFAULT '{}',
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS schedules (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id   TEXT    NOT NULL,
    job_type TEXT    NOT NULL,
    run_at   TEXT    NOT NULL,
    payload  TEXT    NOT NULL DEFAULT '{}',
    created_at TEXT  NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plugin_state (
    name    TEXT PRIMARY KEY,
    version TEXT NOT NULL DEFAULT '0.0.0',
    enabled INTEGER NOT NULL DEFAULT 1,
    config  TEXT    NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_highlights_recording ON highlights(recording_id);
CREATE INDEX IF NOT EXISTS idx_highlights_category  ON highlights(category);
CREATE INDEX IF NOT EXISTS idx_clips_recording      ON clips(recording_id);
CREATE INDEX IF NOT EXISTS idx_schedules_job_id     ON schedules(job_id);
"""


# ======================================================================
# Helpers
# ======================================================================


def _build_where(filters: dict[str, Any]) -> tuple[str, list[Any]]:
    """Build a WHERE clause from a dict of column=value filters."""
    if not filters:
        return "", []
    clauses = [f" {k} = ?" for k in filters]
    return " WHERE" + " AND".join(clauses), list(filters.values())


def _deserialize_highlight(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["metadata"] = json.loads(d["metadata"]) if isinstance(d.get("metadata"), str) else d.get("metadata", {})
    return d


def _deserialize_clip(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    d["metadata"] = json.loads(d["metadata"]) if isinstance(d.get("metadata"), str) else d.get("metadata", {})
    return d
