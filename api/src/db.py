"""Database abstraction layer.

Production: wraps D1 binding via Pyodide FFI (async).
Tests: wraps sqlite3 in-memory database (sync, wrapped as async).

IMPORTANT: sqlite3 is only imported here, never in route modules —
it is unavailable on the Pyodide runtime.
"""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime

from fastapi import Request


def now_utc() -> str:
    """ISO 8601 UTC timestamp for use across all routes."""
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def get_db(request: Request) -> Database:
    """FastAPI dependency: get Database from app state."""
    return request.app.state.db


class Database:
    """Uniform async interface over D1 (production) or sqlite3 (tests)."""

    def __init__(self, d1_binding=None):
        if d1_binding is not None:
            self._d1 = d1_binding
            self._conn = None
        else:
            self._d1 = None
            self._conn = sqlite3.connect(":memory:")
            self._conn.row_factory = sqlite3.Row
            self._conn.execute("PRAGMA foreign_keys = ON")

    def execute_script(self, sql: str) -> None:
        """Execute raw SQL script (migrations). SQLite-only."""
        if self._conn is None:
            msg = "execute_script is only available in SQLite mode"
            raise RuntimeError(msg)
        self._conn.executescript(sql)
        self._conn.execute("PRAGMA foreign_keys = ON")

    async def execute(self, sql: str, params: tuple = ()) -> None:
        """Execute a write query (INSERT, UPDATE, DELETE)."""
        if self._d1 is not None:
            stmt = self._d1.prepare(sql)
            if params:
                stmt = stmt.bind(*params)
            await stmt.run()
        else:
            self._conn.execute(sql, params)
            self._conn.commit()

    async def execute_or_ignore(self, sql: str, params: tuple = ()) -> bool:
        """Execute INSERT, return False on UNIQUE constraint violation.

        Handles dedup without importing sqlite3 in calling code.
        """
        if self._d1 is not None:
            try:
                stmt = self._d1.prepare(sql)
                if params:
                    stmt = stmt.bind(*params)
                await stmt.run()
            except Exception as e:
                if "UNIQUE" in str(e).upper():
                    return False
                raise
            else:
                return True
        else:
            try:
                self._conn.execute(sql, params)
                self._conn.commit()
            except sqlite3.IntegrityError as e:
                if "UNIQUE" in str(e).upper():
                    return False
                raise
            else:
                return True

    async def query(self, sql: str, params: tuple = ()) -> list[dict]:
        """Execute a read query, return list of dicts."""
        if self._d1 is not None:
            stmt = self._d1.prepare(sql)
            if params:
                stmt = stmt.bind(*params)
            result = await stmt.all()
            return [dict(row) for row in result.results.to_py()]
        else:
            cursor = self._conn.execute(sql, params)
            return [dict(row) for row in cursor.fetchall()]

    async def query_one(self, sql: str, params: tuple = ()) -> dict | None:
        """Execute a read query, return first row or None."""
        rows = await self.query(sql, params)
        return rows[0] if rows else None
