import sqlite3

import pytest

from src.db import Database
from src.schema import get_migration_sql


@pytest.fixture
def db():
    database = Database()
    database.execute_script(get_migration_sql())
    return database


@pytest.mark.asyncio
async def test_execute_returns_rows(db):
    await db.execute(
        "INSERT INTO batches (id, name, wine_type, source_material, stage, status,"
        " started_at, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "b1", "Test", "red", "kit", "must_prep", "active",
            "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z",
        ),
    )
    rows = await db.query("SELECT * FROM batches WHERE id = ?", ("b1",))
    assert len(rows) == 1
    assert rows[0]["name"] == "Test"


@pytest.mark.asyncio
async def test_query_one_returns_dict(db):
    await db.execute(
        "INSERT INTO batches (id, name, wine_type, source_material, stage, status,"
        " started_at, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "b1", "Test", "red", "kit", "must_prep", "active",
            "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z",
        ),
    )
    row = await db.query_one("SELECT * FROM batches WHERE id = ?", ("b1",))
    assert row is not None
    assert row["id"] == "b1"


@pytest.mark.asyncio
async def test_query_one_returns_none_when_missing(db):
    row = await db.query_one("SELECT * FROM batches WHERE id = ?", ("missing",))
    assert row is None


@pytest.mark.asyncio
async def test_foreign_keys_enforced(db):
    with pytest.raises(sqlite3.IntegrityError):
        await db.execute(
            "INSERT INTO activities (id, batch_id, stage, type, title,"
            " recorded_at, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "a1", "nonexistent", "must_prep", "note", "Test",
                "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z",
            ),
        )


@pytest.mark.asyncio
async def test_execute_or_ignore_dedup(db):
    await db.execute(
        "INSERT INTO batches (id, name, wine_type, source_material, stage, status,"
        " started_at, created_at, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "b1", "Test", "red", "kit", "must_prep", "active",
            "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z",
        ),
    )
    await db.execute(
        "INSERT INTO devices (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        ("d1", "Pill", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    )
    ok = await db.execute_or_ignore(
        "INSERT INTO readings (id, batch_id, device_id, gravity, temperature, battery, rssi,"
        " source_timestamp, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "r1", "b1", "d1", 1.05, 22.0, 95.0, -60.0,
            "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z",
        ),
    )
    assert ok is True
    dupe = await db.execute_or_ignore(
        "INSERT INTO readings (id, batch_id, device_id, gravity, temperature, battery, rssi,"
        " source_timestamp, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            "r2", "b1", "d1", 1.05, 22.0, 95.0, -60.0,
            "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z",
        ),
    )
    assert dupe is False
