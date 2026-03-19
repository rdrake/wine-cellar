# Wine Cellar MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a functional REST API for winemaking batch management with RAPT Pill telemetry integration, deployed on Cloudflare Workers.

**Architecture:** Python FastAPI on Cloudflare Workers (paid plan) with D1 (managed SQLite) storage. API key auth for user endpoints, separate webhook token for RAPT Pill. Database abstraction layer enables local SQLite testing without Cloudflare runtime.

**Tech Stack:** Python 3.12+, FastAPI, Pydantic v2, Cloudflare Workers (Pyodide), D1, uv, ruff, ty, pytest

**Design doc:** `docs/plans/2026-03-19-mvp-design.md`

---

## Testing Strategy

Routes are tested via `httpx.AsyncClient` with ASGI transport against the FastAPI app. A `Database` class abstracts D1 vs local SQLite — production uses D1 via Pyodide FFI (async), tests use `sqlite3` in-memory (sync wrapped in async interface). Since D1 IS SQLite, query behavior is identical.

The Cloudflare `workers` module is only imported at the entrypoint level with a try/except guard, so tests never need the Cloudflare runtime.

**Important Cloudflare/Pyodide constraints observed throughout:**
- D1 operations return JS promises via FFI — all Database methods are `async`
- Secrets are accessed via `env.API_KEY` / `env.WEBHOOK_TOKEN`, not `os.environ`
- `sqlite3` module is not available on Pyodide — never import it outside `db.py`
- `PRAGMA foreign_keys` is per-connection and has no effect in D1 migrations
- Auth comparisons use `hmac.compare_digest()` (constant-time)

---

## Task 1: Project Scaffolding

**Files:**
- Create: `api/wrangler.toml`
- Create: `api/pyproject.toml`
- Create: `api/src/__init__.py`
- Create: `api/src/app.py`
- Create: `api/src/routes/__init__.py`
- Create: `api/tests/__init__.py`
- Create: `api/tests/conftest.py`

**Step 1: Create `api/wrangler.toml`**

```toml
#:schema node_modules/wrangler/config-schema.json
name = "wine-cellar-api"
main = "src/app.py"
compatibility_date = "2025-12-08"
compatibility_flags = ["python_workers"]

[placement]
mode = "smart"

[[d1_databases]]
binding = "DB"
database_name = "wine-cellar"
database_id = "placeholder-replace-after-d1-create"
```

**Step 2: Create `api/pyproject.toml`**

```toml
[project]
name = "wine-cellar-api"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.24",
    "httpx",
    "ruff",
    "ty",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"

[tool.ruff]
target-version = "py312"
line-length = 99

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "SIM", "RUF"]
```

**Step 3: Create `api/src/app.py`**

```python
from fastapi import FastAPI

app = FastAPI(
    title="Wine Cellar API",
    version="0.1.0",
    docs_url="/api/v1/docs",
    openapi_url="/api/v1/openapi.json",
)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


# Cloudflare Worker entrypoint
try:
    from workers import WorkerEntrypoint  # type: ignore[import-untyped]
    import asgi  # type: ignore[import-untyped]

    class Default(WorkerEntrypoint):
        async def fetch(self, request):
            return await asgi.fetch(app, request.js_object, self.env)

except ImportError:
    pass
```

**Step 4: Create empty `__init__.py` files**

Create empty files: `api/src/__init__.py`, `api/src/routes/__init__.py`, `api/tests/__init__.py`.

**Step 5: Create `api/tests/conftest.py`**

```python
import pytest
from httpx import ASGITransport, AsyncClient

from src.app import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
```

**Step 6: Install dependencies and verify**

Run: `cd api && uv sync --all-extras`
Expected: Dependencies installed successfully.

Run: `cd api && uv run ruff check src/ tests/`
Expected: No lint errors.

**Step 7: Write and run initial test**

Create `api/tests/test_health.py`:

```python
import pytest


@pytest.mark.asyncio
async def test_health(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

Run: `cd api && uv run pytest tests/test_health.py -v`
Expected: PASS

**Step 8: Commit**

```bash
git add api/
git commit -m "feat: scaffold project with FastAPI, wrangler config, and test infrastructure"
```

---

## Task 2: D1 Schema & Migration

**Files:**
- Create: `api/migrations/0001_initial.sql`
- Create: `api/src/schema.py`

**Step 1: Create SQL migration**

Create `api/migrations/0001_initial.sql`:

```sql
-- Batches table
CREATE TABLE batches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    wine_type TEXT NOT NULL CHECK (wine_type IN ('red', 'white', 'rosé', 'orange', 'sparkling', 'dessert')),
    source_material TEXT NOT NULL CHECK (source_material IN ('kit', 'juice_bucket', 'fresh_grapes')),
    stage TEXT NOT NULL DEFAULT 'must_prep' CHECK (stage IN ('must_prep', 'primary_fermentation', 'secondary_fermentation', 'stabilization', 'bottling')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived', 'abandoned')),
    volume_liters REAL,
    target_volume_liters REAL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Activities table
CREATE TABLE activities (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    stage TEXT NOT NULL CHECK (stage IN (
        'receiving', 'crushing', 'must_prep',
        'primary_fermentation', 'pressing',
        'secondary_fermentation', 'malolactic',
        'stabilization', 'fining', 'bulk_aging', 'cold_stabilization', 'filtering',
        'bottling', 'bottle_aging'
    )),
    type TEXT NOT NULL CHECK (type IN ('addition', 'racking', 'measurement', 'tasting', 'note', 'adjustment')),
    title TEXT NOT NULL,
    details TEXT,  -- JSON stored as TEXT
    recorded_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_activities_batch_recorded ON activities(batch_id, recorded_at);

-- Readings table
CREATE TABLE readings (
    id TEXT PRIMARY KEY,
    batch_id TEXT REFERENCES batches(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    gravity REAL NOT NULL,
    temperature REAL NOT NULL,
    battery REAL NOT NULL,
    rssi REAL NOT NULL,
    source_timestamp TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_readings_dedupe ON readings(device_id, source_timestamp);
CREATE INDEX idx_readings_batch_pagination ON readings(batch_id, source_timestamp DESC, id DESC);

-- Devices table
CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    batch_id TEXT REFERENCES batches(id) ON DELETE SET NULL,
    assigned_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_devices_batch ON devices(batch_id);

-- Note: PRAGMA foreign_keys = ON is per-connection and has no effect in D1.
-- It is set in the Database class for local SQLite testing only.
```

**Step 2: Create `api/src/schema.py`**

```python
"""D1/SQLite schema reference. The SQL migration files are the source of truth.
This module provides the schema SQL for use in tests."""

from pathlib import Path

MIGRATIONS_DIR = Path(__file__).parent.parent / "migrations"

BATCH_STAGES = ("must_prep", "primary_fermentation", "secondary_fermentation", "stabilization", "bottling")

ALL_STAGES = (
    "receiving", "crushing", "must_prep",
    "primary_fermentation", "pressing",
    "secondary_fermentation", "malolactic",
    "stabilization", "fining", "bulk_aging", "cold_stabilization", "filtering",
    "bottling", "bottle_aging",
)

WINE_TYPES = ("red", "white", "rosé", "orange", "sparkling", "dessert")

SOURCE_MATERIALS = ("kit", "juice_bucket", "fresh_grapes")

BATCH_STATUSES = ("active", "completed", "archived", "abandoned")

ACTIVITY_TYPES = ("addition", "racking", "measurement", "tasting", "note", "adjustment")

# Map batch waypoints to allowed activity stages
WAYPOINT_ALLOWED_STAGES: dict[str, tuple[str, ...]] = {
    "must_prep": ("receiving", "crushing", "must_prep"),
    "primary_fermentation": ("primary_fermentation", "pressing"),
    "secondary_fermentation": ("secondary_fermentation", "malolactic"),
    "stabilization": ("stabilization", "fining", "bulk_aging", "cold_stabilization", "filtering"),
    "bottling": ("bottling", "bottle_aging"),
}

# Ordered waypoints for /advance
WAYPOINT_ORDER = list(BATCH_STAGES)


def get_migration_sql() -> str:
    """Read the initial migration SQL for use in tests."""
    migration_file = MIGRATIONS_DIR / "0001_initial.sql"
    return migration_file.read_text()
```

**Step 3: Write schema test**

Create `api/tests/test_schema.py`:

```python
import sqlite3

import pytest

from src.schema import (
    ALL_STAGES,
    BATCH_STAGES,
    WAYPOINT_ALLOWED_STAGES,
    WAYPOINT_ORDER,
    get_migration_sql,
)


def test_migration_creates_all_tables():
    conn = sqlite3.connect(":memory:")
    conn.executescript(get_migration_sql())
    tables = {row[0] for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()}
    assert tables >= {"batches", "activities", "readings", "devices"}
    conn.close()


def test_waypoint_stages_are_subset_of_all_stages():
    for waypoint, stages in WAYPOINT_ALLOWED_STAGES.items():
        for stage in stages:
            assert stage in ALL_STAGES, f"{stage} not in ALL_STAGES"


def test_all_stages_covered_by_waypoints():
    covered = set()
    for stages in WAYPOINT_ALLOWED_STAGES.values():
        covered.update(stages)
    assert covered == set(ALL_STAGES)


def test_waypoint_order_matches_batch_stages():
    assert WAYPOINT_ORDER == list(BATCH_STAGES)
```

**Step 4: Run tests**

Run: `cd api && uv run pytest tests/test_schema.py -v`
Expected: All PASS

**Step 5: Commit**

```bash
git add api/migrations/ api/src/schema.py api/tests/test_schema.py
git commit -m "feat: add D1 schema migration and stage model constants"
```

---

## Task 3: Pydantic Models

**Files:**
- Create: `api/src/models.py`
- Create: `api/tests/test_models.py`

**Step 1: Write model tests**

Create `api/tests/test_models.py`:

```python
import pytest
from pydantic import ValidationError

from src.models import (
    ActivityCreate,
    AdditionDetails,
    BatchCreate,
    MeasurementDetails,
    NoteDetails,
    RackingDetails,
    WineType,
)


def test_batch_create_valid():
    batch = BatchCreate(
        name="2026 Merlot",
        wine_type=WineType.RED,
        source_material="fresh_grapes",
        started_at="2026-03-19T10:00:00Z",
    )
    assert batch.name == "2026 Merlot"


def test_batch_create_invalid_wine_type():
    with pytest.raises(ValidationError):
        BatchCreate(
            name="Bad", wine_type="beer", source_material="kit",
            started_at="2026-03-19T10:00:00Z",
        )


def test_activity_create_addition():
    activity = ActivityCreate(
        stage="must_prep",
        type="addition",
        title="Added K-meta",
        details=AdditionDetails(chemical="K-meta", amount=0.25, unit="tsp"),
        recorded_at="2026-03-19T10:00:00Z",
    )
    assert activity.details.chemical == "K-meta"


def test_activity_create_measurement():
    activity = ActivityCreate(
        stage="must_prep",
        type="measurement",
        title="pH reading",
        details=MeasurementDetails(metric="pH", value=3.4, unit="pH"),
        recorded_at="2026-03-19T10:00:00Z",
    )
    assert activity.details.value == 3.4


def test_activity_create_racking():
    activity = ActivityCreate(
        stage="secondary_fermentation",
        type="racking",
        title="Racked to carboy",
        details=RackingDetails(from_vessel="primary bucket", to_vessel="glass carboy"),
        recorded_at="2026-03-19T10:00:00Z",
    )
    assert activity.details.to_vessel == "glass carboy"


def test_activity_create_note_no_details():
    activity = ActivityCreate(
        stage="must_prep",
        type="note",
        title="Smells good",
        details=NoteDetails(),
        recorded_at="2026-03-19T10:00:00Z",
    )
    assert activity.details is not None


def test_activity_create_type_details_mismatch():
    with pytest.raises(ValidationError):
        ActivityCreate(
            stage="must_prep",
            type="addition",
            title="Wrong details type",
            details=NoteDetails(),
            recorded_at="2026-03-19T10:00:00Z",
        )


def test_activity_create_invalid_stage():
    with pytest.raises(ValidationError):
        ActivityCreate(
            stage="invalid_stage",
            type="note",
            title="Bad",
            details=NoteDetails(),
            recorded_at="2026-03-19T10:00:00Z",
        )
```

**Step 2: Run tests to verify they fail**

Run: `cd api && uv run pytest tests/test_models.py -v`
Expected: FAIL (ImportError — models.py doesn't exist yet)

**Step 3: Write models**

Create `api/src/models.py`:

```python
from __future__ import annotations

from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, Field, model_validator


# --- Enums ---

class WineType(StrEnum):
    RED = "red"
    WHITE = "white"
    ROSE = "rosé"
    ORANGE = "orange"
    SPARKLING = "sparkling"
    DESSERT = "dessert"


class SourceMaterial(StrEnum):
    KIT = "kit"
    JUICE_BUCKET = "juice_bucket"
    FRESH_GRAPES = "fresh_grapes"


class BatchStage(StrEnum):
    MUST_PREP = "must_prep"
    PRIMARY_FERMENTATION = "primary_fermentation"
    SECONDARY_FERMENTATION = "secondary_fermentation"
    STABILIZATION = "stabilization"
    BOTTLING = "bottling"


class AllStage(StrEnum):
    RECEIVING = "receiving"
    CRUSHING = "crushing"
    MUST_PREP = "must_prep"
    PRIMARY_FERMENTATION = "primary_fermentation"
    PRESSING = "pressing"
    SECONDARY_FERMENTATION = "secondary_fermentation"
    MALOLACTIC = "malolactic"
    STABILIZATION = "stabilization"
    FINING = "fining"
    BULK_AGING = "bulk_aging"
    COLD_STABILIZATION = "cold_stabilization"
    FILTERING = "filtering"
    BOTTLING = "bottling"
    BOTTLE_AGING = "bottle_aging"


class BatchStatus(StrEnum):
    ACTIVE = "active"
    COMPLETED = "completed"
    ARCHIVED = "archived"
    ABANDONED = "abandoned"


class ActivityType(StrEnum):
    ADDITION = "addition"
    RACKING = "racking"
    MEASUREMENT = "measurement"
    TASTING = "tasting"
    NOTE = "note"
    ADJUSTMENT = "adjustment"


# --- Activity Detail Schemas ---

class AdditionDetails(BaseModel):
    chemical: str
    amount: float
    unit: str
    notes: str | None = None


class MeasurementDetails(BaseModel):
    metric: str
    value: float
    unit: str
    notes: str | None = None


class RackingDetails(BaseModel):
    from_vessel: str
    to_vessel: str
    notes: str | None = None


class TastingDetails(BaseModel):
    aroma: str
    flavor: str
    appearance: str
    notes: str | None = None


class AdjustmentDetails(BaseModel):
    parameter: str
    from_value: float
    to_value: float
    unit: str
    notes: str | None = None


class NoteDetails(BaseModel):
    notes: str | None = None


ActivityDetails = Annotated[
    AdditionDetails | MeasurementDetails | RackingDetails | TastingDetails | AdjustmentDetails | NoteDetails,
    Field(discriminator=None),
]


# --- Request Models ---

class BatchCreate(BaseModel):
    name: str
    wine_type: WineType
    source_material: SourceMaterial
    started_at: str
    volume_liters: float | None = None
    target_volume_liters: float | None = None
    notes: str | None = None


class BatchUpdate(BaseModel):
    name: str | None = None
    notes: str | None = None
    volume_liters: float | None = None
    target_volume_liters: float | None = None


_TYPE_TO_DETAILS: dict[ActivityType, type] = {
    ActivityType.ADDITION: AdditionDetails,
    ActivityType.MEASUREMENT: MeasurementDetails,
    ActivityType.RACKING: RackingDetails,
    ActivityType.TASTING: TastingDetails,
    ActivityType.ADJUSTMENT: AdjustmentDetails,
    ActivityType.NOTE: NoteDetails,
}


class ActivityCreate(BaseModel):
    stage: AllStage
    type: ActivityType
    title: str
    details: ActivityDetails
    recorded_at: str

    @model_validator(mode="after")
    def validate_type_matches_details(self):
        expected = _TYPE_TO_DETAILS.get(self.type)
        if expected and not isinstance(self.details, expected):
            msg = f"details must be {expected.__name__} for type '{self.type}'"
            raise ValueError(msg)
        return self


class ActivityUpdate(BaseModel):
    title: str | None = None
    details: ActivityDetails | None = None
    recorded_at: str | None = None


class DeviceCreate(BaseModel):
    id: str
    name: str


class DeviceAssign(BaseModel):
    batch_id: str


# --- Response Models ---

class BatchResponse(BaseModel):
    id: str
    name: str
    wine_type: WineType
    source_material: SourceMaterial
    stage: BatchStage
    status: BatchStatus
    volume_liters: float | None
    target_volume_liters: float | None
    started_at: str
    completed_at: str | None
    notes: str | None
    created_at: str
    updated_at: str


class ActivityResponse(BaseModel):
    id: str
    batch_id: str
    stage: AllStage
    type: ActivityType
    title: str
    details: dict | None
    recorded_at: str
    created_at: str
    updated_at: str


class ReadingResponse(BaseModel):
    id: str
    batch_id: str | None
    device_id: str
    gravity: float
    temperature: float
    battery: float
    rssi: float
    source_timestamp: str
    created_at: str


class DeviceResponse(BaseModel):
    id: str
    name: str
    batch_id: str | None
    assigned_at: str | None
    created_at: str
    updated_at: str


class PaginatedReadings(BaseModel):
    items: list[ReadingResponse]
    next_cursor: str | None


class ErrorResponse(BaseModel):
    error: str
    message: str


# --- Webhook ---

class RaptWebhookPayload(BaseModel):
    device_id: str
    device_name: str
    temperature: float
    gravity: float
    battery: float
    rssi: float
    created_date: str
```

**Step 4: Run tests**

Run: `cd api && uv run pytest tests/test_models.py -v`
Expected: All PASS

**Step 5: Lint and type check**

Run: `cd api && uv run ruff check src/models.py tests/test_models.py`
Expected: No errors

**Step 6: Commit**

```bash
git add api/src/models.py api/tests/test_models.py
git commit -m "feat: add Pydantic models for all entities, requests, and responses"
```

---

## Task 4: Database Helper & Test Infrastructure

**Files:**
- Create: `api/src/db.py`
- Create: `api/tests/test_db.py`
- Modify: `api/tests/conftest.py`

**Step 1: Write db tests**

Create `api/tests/test_db.py`:

```python
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
        "INSERT INTO batches (id, name, wine_type, source_material, stage, status, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("b1", "Test", "red", "kit", "must_prep", "active", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    )
    rows = await db.query("SELECT * FROM batches WHERE id = ?", ("b1",))
    assert len(rows) == 1
    assert rows[0]["name"] == "Test"


@pytest.mark.asyncio
async def test_query_one_returns_dict(db):
    await db.execute(
        "INSERT INTO batches (id, name, wine_type, source_material, stage, status, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("b1", "Test", "red", "kit", "must_prep", "active", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
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
    with pytest.raises(Exception):
        await db.execute(
            "INSERT INTO activities (id, batch_id, stage, type, title, recorded_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ("a1", "nonexistent", "must_prep", "note", "Test", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
        )


@pytest.mark.asyncio
async def test_execute_or_ignore_dedup(db):
    await db.execute(
        "INSERT INTO batches (id, name, wine_type, source_material, stage, status, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("b1", "Test", "red", "kit", "must_prep", "active", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    )
    await db.execute(
        "INSERT INTO devices (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        ("d1", "Pill", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    )
    ok = await db.execute_or_ignore(
        "INSERT INTO readings (id, batch_id, device_id, gravity, temperature, battery, rssi, source_timestamp, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("r1", "b1", "d1", 1.05, 22.0, 95.0, -60.0, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    )
    assert ok is True
    dupe = await db.execute_or_ignore(
        "INSERT INTO readings (id, batch_id, device_id, gravity, temperature, battery, rssi, source_timestamp, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("r2", "b1", "d1", 1.05, 22.0, 95.0, -60.0, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    )
    assert dupe is False
```

**Step 2: Run tests to verify they fail**

Run: `cd api && uv run pytest tests/test_db.py -v`
Expected: FAIL (ImportError — db.py doesn't exist yet)

**Step 3: Write `api/src/db.py`**

```python
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
        Handles dedup without importing sqlite3 in calling code."""
        if self._d1 is not None:
            try:
                stmt = self._d1.prepare(sql)
                if params:
                    stmt = stmt.bind(*params)
                await stmt.run()
                return True
            except Exception as e:
                if "UNIQUE" in str(e).upper():
                    return False
                raise
        else:
            try:
                self._conn.execute(sql, params)
                self._conn.commit()
                return True
            except sqlite3.IntegrityError as e:
                if "UNIQUE" in str(e).upper():
                    return False
                raise

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
```

**Step 4: Update `api/tests/conftest.py`**

```python
import pytest
from httpx import ASGITransport, AsyncClient

from src.app import app
from src.db import Database
from src.schema import get_migration_sql


@pytest.fixture
def db():
    """Fresh in-memory database with schema applied."""
    database = Database()
    database.execute_script(get_migration_sql())
    return database


@pytest.fixture
async def client(db):
    """Async HTTP client with test database and secrets injected."""
    app.state.db = db
    app.state.api_key = "test-api-key"
    app.state.webhook_token = "test-webhook-token"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
```

**Step 5: Run tests**

Run: `cd api && uv run pytest tests/test_db.py tests/test_health.py -v`
Expected: All PASS

**Step 6: Commit**

```bash
git add api/src/db.py api/tests/test_db.py api/tests/conftest.py
git commit -m "feat: add database abstraction layer with sqlite3 test adapter"
```

---

## Task 5: Auth Middleware

**Files:**
- Create: `api/src/config.py`
- Create: `api/tests/test_auth.py`
- Modify: `api/src/app.py`

**Step 1: Write auth tests**

Create `api/tests/test_auth.py`:

```python
import pytest


@pytest.mark.asyncio
async def test_health_no_auth_required(client):
    response = await client.get("/health")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_api_requires_auth(client):
    response = await client.get("/api/v1/batches")
    assert response.status_code == 401
    assert response.json()["error"] == "unauthorized"


@pytest.mark.asyncio
async def test_api_valid_auth(client):
    response = await client.get(
        "/api/v1/batches",
        headers={"X-API-Key": "test-api-key"},
    )
    # Should not be 401 (might be 200 with empty list or 404)
    assert response.status_code != 401


@pytest.mark.asyncio
async def test_api_invalid_auth(client):
    response = await client.get(
        "/api/v1/batches",
        headers={"X-API-Key": "wrong-key"},
    )
    assert response.status_code == 401
```

**Step 2: Run tests to verify they fail**

Run: `cd api && uv run pytest tests/test_auth.py -v`
Expected: FAIL (no /api/v1/batches route yet, and no auth middleware)

**Step 3: Create `api/src/config.py`**

```python
"""Configuration and secret access.

On Cloudflare Workers, secrets are accessed via env bindings (set with
`wrangler secret put`), not os.environ. The app reads secrets from
app.state which is populated by middleware from the ASGI scope env.

For tests, app.state.api_key and app.state.webhook_token are set directly
in conftest.py.
"""

from __future__ import annotations

import hmac


def check_api_key(provided: str | None, expected: str) -> bool:
    """Constant-time comparison to prevent timing attacks."""
    if not provided or not expected:
        return False
    return hmac.compare_digest(provided.encode(), expected.encode())
```

**Step 4: Add auth middleware and batch list stub to `api/src/app.py`**

Update `app.py` to add env wiring middleware, auth middleware, and a stub batches route so auth tests can pass:

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from src.config import check_api_key
from src.db import Database

app = FastAPI(
    title="Wine Cellar API",
    version="0.1.0",
    docs_url="/api/v1/docs",
    openapi_url="/api/v1/openapi.json",
)


@app.middleware("http")
async def env_middleware(request: Request, call_next):
    """Wire Cloudflare env bindings (D1, secrets) into app.state on each request."""
    env = request.scope.get("env")
    if env:
        if not hasattr(app.state, "db") or app.state.db is None:
            app.state.db = Database(d1_binding=env.DB)
        app.state.api_key = str(env.API_KEY)
        app.state.webhook_token = str(env.WEBHOOK_TOKEN)
    return await call_next(request)


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if path in ("/health", "/api/v1/docs", "/api/v1/openapi.json") or path.startswith("/webhook"):
        return await call_next(request)
    if path.startswith("/api/v1/"):
        api_key = request.headers.get("X-API-Key")
        expected = getattr(app.state, "api_key", "")
        if not check_api_key(api_key, expected):
            return JSONResponse(
                status_code=401,
                content={"error": "unauthorized", "message": "Invalid or missing API key"},
            )
    return await call_next(request)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


# Stub: will be replaced by router in Task 6
@app.get("/api/v1/batches")
async def list_batches_stub() -> dict:
    return {"items": []}


# Cloudflare Worker entrypoint
try:
    from workers import WorkerEntrypoint  # type: ignore[import-untyped]
    import asgi  # type: ignore[import-untyped]

    class Default(WorkerEntrypoint):
        async def fetch(self, request):
            return await asgi.fetch(app, request.js_object, self.env)

except ImportError:
    pass
```

**Step 5: Run tests**

Run: `cd api && uv run pytest tests/test_auth.py tests/test_health.py -v`
Expected: All PASS

**Step 6: Commit**

```bash
git add api/src/config.py api/src/app.py api/tests/test_auth.py
git commit -m "feat: add API key auth middleware"
```

---

## Task 6: Batches — Create, Get, List

**Files:**
- Create: `api/src/routes/batches.py`
- Create: `api/tests/test_batches.py`
- Modify: `api/src/app.py` (replace stub with router)

**Step 1: Write batch CRUD tests**

Create `api/tests/test_batches.py`:

```python
import pytest

HEADERS = {"X-API-Key": "test-api-key"}

VALID_BATCH = {
    "name": "2026 Merlot",
    "wine_type": "red",
    "source_material": "fresh_grapes",
    "started_at": "2026-03-19T10:00:00Z",
    "volume_liters": 23.0,
    "target_volume_liters": 20.0,
    "notes": "First attempt",
}


@pytest.mark.asyncio
async def test_create_batch(client):
    response = await client.post("/api/v1/batches", json=VALID_BATCH, headers=HEADERS)
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "2026 Merlot"
    assert data["stage"] == "must_prep"
    assert data["status"] == "active"
    assert "id" in data


@pytest.mark.asyncio
async def test_create_batch_invalid_wine_type(client):
    bad = {**VALID_BATCH, "wine_type": "beer"}
    response = await client.post("/api/v1/batches", json=bad, headers=HEADERS)
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_get_batch(client):
    create = await client.post("/api/v1/batches", json=VALID_BATCH, headers=HEADERS)
    batch_id = create.json()["id"]
    response = await client.get(f"/api/v1/batches/{batch_id}", headers=HEADERS)
    assert response.status_code == 200
    assert response.json()["id"] == batch_id


@pytest.mark.asyncio
async def test_get_batch_not_found(client):
    response = await client.get("/api/v1/batches/nonexistent", headers=HEADERS)
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_list_batches_empty(client):
    response = await client.get("/api/v1/batches", headers=HEADERS)
    assert response.status_code == 200
    assert response.json()["items"] == []


@pytest.mark.asyncio
async def test_list_batches_with_filter(client):
    await client.post("/api/v1/batches", json=VALID_BATCH, headers=HEADERS)
    white_batch = {**VALID_BATCH, "name": "Chardonnay", "wine_type": "white"}
    await client.post("/api/v1/batches", json=white_batch, headers=HEADERS)

    response = await client.get("/api/v1/batches?wine_type=red", headers=HEADERS)
    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["wine_type"] == "red"


@pytest.mark.asyncio
async def test_patch_batch_metadata(client):
    create = await client.post("/api/v1/batches", json=VALID_BATCH, headers=HEADERS)
    batch_id = create.json()["id"]
    response = await client.patch(
        f"/api/v1/batches/{batch_id}",
        json={"name": "Updated Name", "notes": "New notes"},
        headers=HEADERS,
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Updated Name"


@pytest.mark.asyncio
async def test_delete_batch_no_data(client):
    create = await client.post("/api/v1/batches", json=VALID_BATCH, headers=HEADERS)
    batch_id = create.json()["id"]
    # Must abandon first (or have zero activities/readings)
    response = await client.delete(f"/api/v1/batches/{batch_id}", headers=HEADERS)
    assert response.status_code == 204


@pytest.mark.asyncio
async def test_delete_batch_not_found(client):
    response = await client.delete("/api/v1/batches/nonexistent", headers=HEADERS)
    assert response.status_code == 404
```

**Step 2: Run tests to verify they fail**

Run: `cd api && uv run pytest tests/test_batches.py -v`
Expected: FAIL

**Step 3: Implement batches router**

Create `api/src/routes/batches.py`:

```python
from __future__ import annotations

import uuid

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from src.db import get_db, now_utc
from src.models import BatchCreate, BatchResponse, BatchUpdate

router = APIRouter(prefix="/api/v1/batches", tags=["batches"])


@router.post("", status_code=201, response_model=BatchResponse)
async def create_batch(body: BatchCreate, request: Request):
    db = get_db(request)
    batch_id = str(uuid.uuid4())
    now = now_utc()
    await db.execute(
        """INSERT INTO batches (id, name, wine_type, source_material, stage, status,
           volume_liters, target_volume_liters, started_at, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'must_prep', 'active', ?, ?, ?, ?, ?, ?)""",
        (batch_id, body.name, body.wine_type, body.source_material,
         body.volume_liters, body.target_volume_liters, body.started_at,
         body.notes, now, now),
    )
    row = await db.query_one("SELECT * FROM batches WHERE id = ?", (batch_id,))
    return row


@router.get("", response_model=dict)
async def list_batches(
    request: Request,
    status: str | None = None,
    stage: str | None = None,
    wine_type: str | None = None,
    source_material: str | None = None,
):
    db = get_db(request)
    sql = "SELECT * FROM batches WHERE 1=1"
    params: list = []
    if status:
        sql += " AND status = ?"
        params.append(status)
    else:
        # Hide archived batches from default listing
        sql += " AND status != 'archived'"
    if stage:
        sql += " AND stage = ?"
        params.append(stage)
    if wine_type:
        sql += " AND wine_type = ?"
        params.append(wine_type)
    if source_material:
        sql += " AND source_material = ?"
        params.append(source_material)
    sql += " ORDER BY created_at DESC"
    rows = await db.query(sql, tuple(params))
    return {"items": rows}


@router.get("/{batch_id}", response_model=BatchResponse)
async def get_batch(batch_id: str, request: Request):
    db = get_db(request)
    row = await db.query_one("SELECT * FROM batches WHERE id = ?", (batch_id,))
    if not row:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Batch not found"})
    return row


@router.patch("/{batch_id}", response_model=BatchResponse)
async def update_batch(batch_id: str, body: BatchUpdate, request: Request):
    db = get_db(request)
    row = await db.query_one("SELECT * FROM batches WHERE id = ?", (batch_id,))
    if not row:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Batch not found"})
    ALLOWED_COLS = {"name", "notes", "volume_liters", "target_volume_liters"}
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k in ALLOWED_COLS}
    if not updates:
        return row
    updates["updated_at"] = now_utc()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [batch_id]
    await db.execute(f"UPDATE batches SET {set_clause} WHERE id = ?", tuple(values))
    return await db.query_one("SELECT * FROM batches WHERE id = ?", (batch_id,))


@router.delete("/{batch_id}", status_code=204)
async def delete_batch(batch_id: str, request: Request):
    db = get_db(request)
    row = await db.query_one("SELECT * FROM batches WHERE id = ?", (batch_id,))
    if not row:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Batch not found"})
    # Check guard: must be abandoned OR have zero activities and readings
    if row["status"] != "abandoned":
        activity_row = await db.query_one(
            "SELECT COUNT(*) as cnt FROM activities WHERE batch_id = ?", (batch_id,)
        )
        reading_row = await db.query_one(
            "SELECT COUNT(*) as cnt FROM readings WHERE batch_id = ?", (batch_id,)
        )
        activity_count = activity_row["cnt"]
        reading_count = reading_row["cnt"]
        if activity_count > 0 or reading_count > 0:
            return JSONResponse(
                status_code=409,
                content={"error": "conflict", "message": "Batch has activities or readings. Abandon first."},
            )
    await db.execute("DELETE FROM batches WHERE id = ?", (batch_id,))
    return None
```

**Step 4: Update `api/src/app.py` — replace stub with router**

Replace the stub `list_batches_stub` with the router import. The middleware from Task 5 remains unchanged — just add the router:

```python
from src.config import check_api_key
from src.db import Database
from src.routes.batches import router as batches_router
# ... (keep existing FastAPI app, env_middleware, auth_middleware from Task 5)


app.include_router(batches_router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


# Cloudflare Worker entrypoint
try:
    from workers import WorkerEntrypoint  # type: ignore[import-untyped]
    import asgi  # type: ignore[import-untyped]

    class Default(WorkerEntrypoint):
        async def fetch(self, request):
            return await asgi.fetch(app, request.js_object, self.env)

except ImportError:
    pass
```

**Step 5: Run tests**

Run: `cd api && uv run pytest tests/ -v`
Expected: All PASS

**Step 6: Commit**

```bash
git add api/src/routes/batches.py api/src/app.py api/tests/test_batches.py
git commit -m "feat: add batch CRUD endpoints (create, get, list, patch, delete)"
```

---

## Task 7: Batch Lifecycle

**Files:**
- Create: `api/tests/test_batch_lifecycle.py`
- Modify: `api/src/routes/batches.py`

**Step 1: Write lifecycle tests**

Create `api/tests/test_batch_lifecycle.py`:

```python
import pytest

HEADERS = {"X-API-Key": "test-api-key"}
BATCH = {
    "name": "2026 Merlot",
    "wine_type": "red",
    "source_material": "fresh_grapes",
    "started_at": "2026-03-19T10:00:00Z",
}


async def _create_batch(client):
    r = await client.post("/api/v1/batches", json=BATCH, headers=HEADERS)
    return r.json()["id"]


@pytest.mark.asyncio
async def test_advance_stage(client):
    batch_id = await _create_batch(client)
    r = await client.post(f"/api/v1/batches/{batch_id}/advance", headers=HEADERS)
    assert r.status_code == 200
    assert r.json()["stage"] == "primary_fermentation"


@pytest.mark.asyncio
async def test_advance_through_all_waypoints(client):
    batch_id = await _create_batch(client)
    expected = ["primary_fermentation", "secondary_fermentation", "stabilization", "bottling"]
    for stage in expected:
        r = await client.post(f"/api/v1/batches/{batch_id}/advance", headers=HEADERS)
        assert r.json()["stage"] == stage


@pytest.mark.asyncio
async def test_advance_past_bottling_fails(client):
    batch_id = await _create_batch(client)
    for _ in range(4):
        await client.post(f"/api/v1/batches/{batch_id}/advance", headers=HEADERS)
    r = await client.post(f"/api/v1/batches/{batch_id}/advance", headers=HEADERS)
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_complete_batch(client):
    batch_id = await _create_batch(client)
    r = await client.post(f"/api/v1/batches/{batch_id}/complete", headers=HEADERS)
    assert r.status_code == 200
    assert r.json()["status"] == "completed"
    assert r.json()["completed_at"] is not None


@pytest.mark.asyncio
async def test_complete_non_active_fails(client):
    batch_id = await _create_batch(client)
    await client.post(f"/api/v1/batches/{batch_id}/complete", headers=HEADERS)
    r = await client.post(f"/api/v1/batches/{batch_id}/complete", headers=HEADERS)
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_abandon_batch(client):
    batch_id = await _create_batch(client)
    r = await client.post(f"/api/v1/batches/{batch_id}/abandon", headers=HEADERS)
    assert r.status_code == 200
    assert r.json()["status"] == "abandoned"


@pytest.mark.asyncio
async def test_advance_abandoned_fails(client):
    batch_id = await _create_batch(client)
    await client.post(f"/api/v1/batches/{batch_id}/abandon", headers=HEADERS)
    r = await client.post(f"/api/v1/batches/{batch_id}/advance", headers=HEADERS)
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_archive_completed_batch(client):
    batch_id = await _create_batch(client)
    await client.post(f"/api/v1/batches/{batch_id}/complete", headers=HEADERS)
    r = await client.post(f"/api/v1/batches/{batch_id}/archive", headers=HEADERS)
    assert r.status_code == 200
    assert r.json()["status"] == "archived"


@pytest.mark.asyncio
async def test_archive_active_fails(client):
    batch_id = await _create_batch(client)
    r = await client.post(f"/api/v1/batches/{batch_id}/archive", headers=HEADERS)
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_unarchive_batch(client):
    batch_id = await _create_batch(client)
    await client.post(f"/api/v1/batches/{batch_id}/complete", headers=HEADERS)
    await client.post(f"/api/v1/batches/{batch_id}/archive", headers=HEADERS)
    r = await client.post(f"/api/v1/batches/{batch_id}/unarchive", headers=HEADERS)
    assert r.status_code == 200
    assert r.json()["status"] == "completed"


@pytest.mark.asyncio
async def test_complete_unassigns_device(client, db):
    batch_id = await _create_batch(client)
    # Register and assign device via direct DB (device routes not available until Task 9)
    await db.execute(
        "INSERT INTO devices (id, name, batch_id, assigned_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ("pill-1", "My Pill", batch_id, "2026-03-19T10:00:00Z", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    )
    await client.post(f"/api/v1/batches/{batch_id}/complete", headers=HEADERS)
    device = await db.query_one("SELECT * FROM devices WHERE id = 'pill-1'")
    assert device["batch_id"] is None
```

**Step 2: Run tests to verify they fail**

Run: `cd api && uv run pytest tests/test_batch_lifecycle.py -v`
Expected: FAIL

**Step 3: Add lifecycle endpoints to batches router**

Append to `api/src/routes/batches.py`:

```python
from src.schema import WAYPOINT_ORDER


@router.post("/{batch_id}/advance", response_model=BatchResponse)
async def advance_batch(batch_id: str, request: Request):
    db = get_db(request)
    row = await db.query_one("SELECT * FROM batches WHERE id = ?", (batch_id,))
    if not row:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Batch not found"})
    if row["status"] != "active":
        return JSONResponse(status_code=409, content={"error": "conflict", "message": "Only active batches can advance"})
    current_idx = WAYPOINT_ORDER.index(row["stage"])
    if current_idx >= len(WAYPOINT_ORDER) - 1:
        return JSONResponse(status_code=409, content={"error": "conflict", "message": "Batch is at final stage"})
    next_stage = WAYPOINT_ORDER[current_idx + 1]
    now = now_utc()
    await db.execute("UPDATE batches SET stage = ?, updated_at = ? WHERE id = ?", (next_stage, now, batch_id))
    return db.query_one("SELECT * FROM batches WHERE id = ?", (batch_id,))


@router.post("/{batch_id}/complete", response_model=BatchResponse)
async def complete_batch(batch_id: str, request: Request):
    db = get_db(request)
    row = await db.query_one("SELECT * FROM batches WHERE id = ?", (batch_id,))
    if not row:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Batch not found"})
    if row["status"] != "active":
        return JSONResponse(status_code=409, content={"error": "conflict", "message": "Only active batches can be completed"})
    now = now_utc()
    await db.execute(
        "UPDATE batches SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?",
        (now, now, batch_id),
    )
    # Auto-unassign devices
    await db.execute("UPDATE devices SET batch_id = NULL, assigned_at = NULL, updated_at = ? WHERE batch_id = ?", (now, batch_id))
    return db.query_one("SELECT * FROM batches WHERE id = ?", (batch_id,))


@router.post("/{batch_id}/abandon", response_model=BatchResponse)
async def abandon_batch(batch_id: str, request: Request):
    db = get_db(request)
    row = await db.query_one("SELECT * FROM batches WHERE id = ?", (batch_id,))
    if not row:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Batch not found"})
    if row["status"] != "active":
        return JSONResponse(status_code=409, content={"error": "conflict", "message": "Only active batches can be abandoned"})
    now = now_utc()
    await db.execute("UPDATE batches SET status = 'abandoned', updated_at = ? WHERE id = ?", (now, batch_id))
    await db.execute("UPDATE devices SET batch_id = NULL, assigned_at = NULL, updated_at = ? WHERE batch_id = ?", (now, batch_id))
    return db.query_one("SELECT * FROM batches WHERE id = ?", (batch_id,))


@router.post("/{batch_id}/archive", response_model=BatchResponse)
async def archive_batch(batch_id: str, request: Request):
    db = get_db(request)
    row = await db.query_one("SELECT * FROM batches WHERE id = ?", (batch_id,))
    if not row:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Batch not found"})
    if row["status"] != "completed":
        return JSONResponse(status_code=409, content={"error": "conflict", "message": "Only completed batches can be archived"})
    now = now_utc()
    await db.execute("UPDATE batches SET status = 'archived', updated_at = ? WHERE id = ?", (now, batch_id))
    return db.query_one("SELECT * FROM batches WHERE id = ?", (batch_id,))


@router.post("/{batch_id}/unarchive", response_model=BatchResponse)
async def unarchive_batch(batch_id: str, request: Request):
    db = get_db(request)
    row = await db.query_one("SELECT * FROM batches WHERE id = ?", (batch_id,))
    if not row:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Batch not found"})
    if row["status"] != "archived":
        return JSONResponse(status_code=409, content={"error": "conflict", "message": "Only archived batches can be unarchived"})
    now = now_utc()
    await db.execute("UPDATE batches SET status = 'completed', updated_at = ? WHERE id = ?", (now, batch_id))
    return db.query_one("SELECT * FROM batches WHERE id = ?", (batch_id,))
```

**Step 4: Run tests**

Run: `cd api && uv run pytest tests/ -v`
Expected: All PASS

**Step 5: Commit**

```bash
git add api/src/routes/batches.py api/tests/test_batch_lifecycle.py
git commit -m "feat: add batch lifecycle endpoints (advance, complete, abandon, archive)"
```

---

## Task 8: Activities CRUD

**Files:**
- Create: `api/src/routes/activities.py`
- Create: `api/tests/test_activities.py`
- Modify: `api/src/app.py` (add router)

**Step 1: Write activity tests**

Create `api/tests/test_activities.py`:

```python
import pytest

HEADERS = {"X-API-Key": "test-api-key"}
BATCH = {
    "name": "2026 Merlot",
    "wine_type": "red",
    "source_material": "fresh_grapes",
    "started_at": "2026-03-19T10:00:00Z",
}


async def _create_batch(client):
    r = await client.post("/api/v1/batches", json=BATCH, headers=HEADERS)
    return r.json()["id"]


@pytest.mark.asyncio
async def test_create_activity_addition(client):
    batch_id = await _create_batch(client)
    activity = {
        "stage": "must_prep",
        "type": "addition",
        "title": "Added K-meta",
        "details": {"chemical": "K-meta", "amount": 0.25, "unit": "tsp"},
        "recorded_at": "2026-03-19T10:00:00Z",
    }
    r = await client.post(f"/api/v1/batches/{batch_id}/activities", json=activity, headers=HEADERS)
    assert r.status_code == 201
    assert r.json()["title"] == "Added K-meta"
    assert r.json()["details"]["chemical"] == "K-meta"


@pytest.mark.asyncio
async def test_create_activity_invalid_stage_for_waypoint(client):
    batch_id = await _create_batch(client)
    # Batch is at must_prep, but trying to log a bottling activity
    activity = {
        "stage": "bottling",
        "type": "note",
        "title": "Too early",
        "details": {},
        "recorded_at": "2026-03-19T10:00:00Z",
    }
    r = await client.post(f"/api/v1/batches/{batch_id}/activities", json=activity, headers=HEADERS)
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_list_activities(client):
    batch_id = await _create_batch(client)
    for i in range(3):
        activity = {
            "stage": "must_prep",
            "type": "note",
            "title": f"Note {i}",
            "details": {},
            "recorded_at": f"2026-03-19T1{i}:00:00Z",
        }
        await client.post(f"/api/v1/batches/{batch_id}/activities", json=activity, headers=HEADERS)
    r = await client.get(f"/api/v1/batches/{batch_id}/activities", headers=HEADERS)
    assert r.status_code == 200
    assert len(r.json()["items"]) == 3


@pytest.mark.asyncio
async def test_list_activities_filter_by_type(client):
    batch_id = await _create_batch(client)
    note = {"stage": "must_prep", "type": "note", "title": "A note", "details": {}, "recorded_at": "2026-03-19T10:00:00Z"}
    addition = {"stage": "must_prep", "type": "addition", "title": "K-meta", "details": {"chemical": "K-meta", "amount": 1, "unit": "tsp"}, "recorded_at": "2026-03-19T11:00:00Z"}
    await client.post(f"/api/v1/batches/{batch_id}/activities", json=note, headers=HEADERS)
    await client.post(f"/api/v1/batches/{batch_id}/activities", json=addition, headers=HEADERS)
    r = await client.get(f"/api/v1/batches/{batch_id}/activities?type=addition", headers=HEADERS)
    assert len(r.json()["items"]) == 1


@pytest.mark.asyncio
async def test_update_activity(client):
    batch_id = await _create_batch(client)
    activity = {"stage": "must_prep", "type": "note", "title": "Original", "details": {}, "recorded_at": "2026-03-19T10:00:00Z"}
    r = await client.post(f"/api/v1/batches/{batch_id}/activities", json=activity, headers=HEADERS)
    activity_id = r.json()["id"]
    r = await client.patch(
        f"/api/v1/batches/{batch_id}/activities/{activity_id}",
        json={"title": "Updated"},
        headers=HEADERS,
    )
    assert r.status_code == 200
    assert r.json()["title"] == "Updated"


@pytest.mark.asyncio
async def test_delete_activity(client):
    batch_id = await _create_batch(client)
    activity = {"stage": "must_prep", "type": "note", "title": "Delete me", "details": {}, "recorded_at": "2026-03-19T10:00:00Z"}
    r = await client.post(f"/api/v1/batches/{batch_id}/activities", json=activity, headers=HEADERS)
    activity_id = r.json()["id"]
    r = await client.delete(f"/api/v1/batches/{batch_id}/activities/{activity_id}", headers=HEADERS)
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_cannot_log_activity_on_completed_batch(client):
    batch_id = await _create_batch(client)
    await client.post(f"/api/v1/batches/{batch_id}/complete", headers=HEADERS)
    activity = {"stage": "must_prep", "type": "note", "title": "Too late", "details": {}, "recorded_at": "2026-03-19T10:00:00Z"}
    r = await client.post(f"/api/v1/batches/{batch_id}/activities", json=activity, headers=HEADERS)
    assert r.status_code == 409
```

**Step 2: Run tests to verify they fail**

Run: `cd api && uv run pytest tests/test_activities.py -v`
Expected: FAIL

**Step 3: Implement activities router**

Create `api/src/routes/activities.py`:

```python
from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from src.db import get_db, now_utc
from src.models import ActivityCreate, ActivityResponse, ActivityUpdate
from src.schema import WAYPOINT_ALLOWED_STAGES

router = APIRouter(prefix="/api/v1/batches/{batch_id}/activities", tags=["activities"])


@router.post("", status_code=201, response_model=ActivityResponse)
async def create_activity(batch_id: str, body: ActivityCreate, request: Request):
    db = get_db(request)
    batch = db.query_one("SELECT * FROM batches WHERE id = ?", (batch_id,))
    if not batch:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Batch not found"})
    if batch["status"] != "active":
        return JSONResponse(status_code=409, content={"error": "conflict", "message": "Only active batches can log activities"})
    # Validate stage is allowed for current waypoint
    allowed = WAYPOINT_ALLOWED_STAGES.get(batch["stage"], ())
    if body.stage not in allowed:
        return JSONResponse(
            status_code=409,
            content={"error": "conflict", "message": f"Stage '{body.stage}' not allowed when batch is at '{batch['stage']}'"},
        )
    activity_id = str(uuid.uuid4())
    now = now_utc()
    details_json = json.dumps(body.details.model_dump()) if body.details else None
    await db.execute(
        """INSERT INTO activities (id, batch_id, stage, type, title, details, recorded_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (activity_id, batch_id, body.stage, body.type, body.title, details_json, body.recorded_at, now, now),
    )
    row = await db.query_one("SELECT * FROM activities WHERE id = ?", (activity_id,))
    row["details"] = json.loads(row["details"]) if row["details"] else None
    return row


@router.get("", response_model=dict)
async def list_activities(
    batch_id: str,
    request: Request,
    type: str | None = None,
    stage: str | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
):
    db = get_db(request)
    batch = await db.query_one("SELECT id FROM batches WHERE id = ?", (batch_id,))
    if not batch:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Batch not found"})
    sql = "SELECT * FROM activities WHERE batch_id = ?"
    params: list = [batch_id]
    if type:
        sql += " AND type = ?"
        params.append(type)
    if stage:
        sql += " AND stage = ?"
        params.append(stage)
    if start_time:
        sql += " AND recorded_at >= ?"
        params.append(start_time)
    if end_time:
        sql += " AND recorded_at <= ?"
        params.append(end_time)
    sql += " ORDER BY recorded_at DESC"
    rows = await db.query(sql, tuple(params))
    for row in rows:
        row["details"] = json.loads(row["details"]) if row["details"] else None
    return {"items": rows}


@router.patch("/{activity_id}", response_model=ActivityResponse)
async def update_activity(batch_id: str, activity_id: str, body: ActivityUpdate, request: Request):
    db = get_db(request)
    row = await db.query_one("SELECT * FROM activities WHERE id = ? AND batch_id = ?", (activity_id, batch_id))
    if not row:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Activity not found"})
    updates = body.model_dump(exclude_unset=True)
    if "details" in updates and updates["details"] is not None:
        updates["details"] = json.dumps(updates["details"].model_dump() if hasattr(updates["details"], "model_dump") else updates["details"])
    if not updates:
        row["details"] = json.loads(row["details"]) if row["details"] else None
        return row
    updates["updated_at"] = now_utc()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [activity_id]
    await db.execute(f"UPDATE activities SET {set_clause} WHERE id = ?", tuple(values))
    row = await db.query_one("SELECT * FROM activities WHERE id = ?", (activity_id,))
    row["details"] = json.loads(row["details"]) if row["details"] else None
    return row


@router.delete("/{activity_id}", status_code=204)
async def delete_activity(batch_id: str, activity_id: str, request: Request):
    db = get_db(request)
    row = await db.query_one("SELECT * FROM activities WHERE id = ? AND batch_id = ?", (activity_id, batch_id))
    if not row:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Activity not found"})
    await db.execute("DELETE FROM activities WHERE id = ?", (activity_id,))
    return None
```

**Step 4: Add router to `api/src/app.py`**

Add import and `app.include_router(activities_router)` alongside the batches router.

```python
from src.routes.activities import router as activities_router
# ...
app.include_router(activities_router)
```

**Step 5: Run tests**

Run: `cd api && uv run pytest tests/ -v`
Expected: All PASS

**Step 6: Commit**

```bash
git add api/src/routes/activities.py api/src/app.py api/tests/test_activities.py
git commit -m "feat: add activities CRUD with stage validation per waypoint"
```

---

## Task 9: Devices — Register, List, Assign, Unassign

**Files:**
- Create: `api/src/routes/devices.py`
- Create: `api/tests/test_devices.py`
- Modify: `api/src/app.py` (add router)

**Step 1: Write device tests**

Create `api/tests/test_devices.py`:

```python
import pytest

HEADERS = {"X-API-Key": "test-api-key"}
BATCH = {
    "name": "2026 Merlot",
    "wine_type": "red",
    "source_material": "fresh_grapes",
    "started_at": "2026-03-19T10:00:00Z",
}


async def _create_batch(client):
    r = await client.post("/api/v1/batches", json=BATCH, headers=HEADERS)
    return r.json()["id"]


@pytest.mark.asyncio
async def test_register_device(client):
    r = await client.post("/api/v1/devices", json={"id": "pill-1", "name": "My Pill"}, headers=HEADERS)
    assert r.status_code == 201
    assert r.json()["id"] == "pill-1"
    assert r.json()["batch_id"] is None


@pytest.mark.asyncio
async def test_register_duplicate_device(client):
    await client.post("/api/v1/devices", json={"id": "pill-1", "name": "My Pill"}, headers=HEADERS)
    r = await client.post("/api/v1/devices", json={"id": "pill-1", "name": "Dupe"}, headers=HEADERS)
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_list_devices(client):
    await client.post("/api/v1/devices", json={"id": "pill-1", "name": "Pill 1"}, headers=HEADERS)
    await client.post("/api/v1/devices", json={"id": "pill-2", "name": "Pill 2"}, headers=HEADERS)
    r = await client.get("/api/v1/devices", headers=HEADERS)
    assert len(r.json()["items"]) == 2


@pytest.mark.asyncio
async def test_assign_device(client):
    batch_id = await _create_batch(client)
    await client.post("/api/v1/devices", json={"id": "pill-1", "name": "My Pill"}, headers=HEADERS)
    r = await client.post(
        "/api/v1/devices/pill-1/assign",
        json={"batch_id": batch_id},
        headers=HEADERS,
    )
    assert r.status_code == 200
    assert r.json()["batch_id"] == batch_id


@pytest.mark.asyncio
async def test_assign_to_non_active_batch_fails(client):
    batch_id = await _create_batch(client)
    await client.post(f"/api/v1/batches/{batch_id}/complete", headers=HEADERS)
    await client.post("/api/v1/devices", json={"id": "pill-1", "name": "My Pill"}, headers=HEADERS)
    r = await client.post(
        "/api/v1/devices/pill-1/assign",
        json={"batch_id": batch_id},
        headers=HEADERS,
    )
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_unassign_device(client):
    batch_id = await _create_batch(client)
    await client.post("/api/v1/devices", json={"id": "pill-1", "name": "My Pill"}, headers=HEADERS)
    await client.post("/api/v1/devices/pill-1/assign", json={"batch_id": batch_id}, headers=HEADERS)
    r = await client.post("/api/v1/devices/pill-1/unassign", headers=HEADERS)
    assert r.status_code == 200
    assert r.json()["batch_id"] is None


@pytest.mark.asyncio
async def test_assign_backfills_readings(client, db):
    batch_id = await _create_batch(client)
    await client.post("/api/v1/devices", json={"id": "pill-1", "name": "My Pill"}, headers=HEADERS)
    # Insert unassigned readings — one before batch start, one after
    await db.execute(
        "INSERT INTO readings (id, batch_id, device_id, gravity, temperature, battery, rssi, source_timestamp, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("r1", None, "pill-1", 1.090, 22.0, 95.0, -60.0, "2026-03-18T10:00:00Z", "2026-03-18T10:00:00Z"),
    )
    await db.execute(
        "INSERT INTO readings (id, batch_id, device_id, gravity, temperature, battery, rssi, source_timestamp, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("r2", None, "pill-1", 1.088, 22.5, 94.0, -62.0, "2026-03-19T12:00:00Z", "2026-03-19T12:00:00Z"),
    )
    await client.post("/api/v1/devices/pill-1/assign", json={"batch_id": batch_id}, headers=HEADERS)
    # r1 is before started_at, should remain unassigned
    r1 = db.query_one("SELECT batch_id FROM readings WHERE id = 'r1'")
    assert r1["batch_id"] is None
    # r2 is after started_at, should be backfilled
    r2 = db.query_one("SELECT batch_id FROM readings WHERE id = 'r2'")
    assert r2["batch_id"] == batch_id
```

**Step 2: Run tests to verify they fail**

Run: `cd api && uv run pytest tests/test_devices.py -v`
Expected: FAIL

**Step 3: Implement devices router**

Create `api/src/routes/devices.py`:

```python
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from src.db import get_db, now_utc
from src.models import DeviceAssign, DeviceCreate, DeviceResponse

router = APIRouter(prefix="/api/v1/devices", tags=["devices"])


@router.post("", status_code=201, response_model=DeviceResponse)
async def register_device(body: DeviceCreate, request: Request):
    db = get_db(request)
    existing = db.query_one("SELECT id FROM devices WHERE id = ?", (body.id,))
    if existing:
        return JSONResponse(status_code=409, content={"error": "conflict", "message": "Device already registered"})
    now = now_utc()
    await db.execute(
        "INSERT INTO devices (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        (body.id, body.name, now, now),
    )
    return db.query_one("SELECT * FROM devices WHERE id = ?", (body.id,))


@router.get("", response_model=dict)
async def list_devices(request: Request):
    db = get_db(request)
    rows = await db.query("SELECT * FROM devices ORDER BY created_at DESC")
    return {"items": rows}


@router.post("/{device_id}/assign", response_model=DeviceResponse)
async def assign_device(device_id: str, body: DeviceAssign, request: Request):
    db = get_db(request)
    device = db.query_one("SELECT * FROM devices WHERE id = ?", (device_id,))
    if not device:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Device not found"})
    batch = db.query_one("SELECT * FROM batches WHERE id = ?", (body.batch_id,))
    if not batch:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Batch not found"})
    if batch["status"] != "active":
        return JSONResponse(status_code=409, content={"error": "conflict", "message": "Can only assign to active batches"})
    now = now_utc()
    await db.execute(
        "UPDATE devices SET batch_id = ?, assigned_at = ?, updated_at = ? WHERE id = ?",
        (body.batch_id, now, now, device_id),
    )
    # Backfill unassigned readings from this device after batch start
    await db.execute(
        "UPDATE readings SET batch_id = ? WHERE device_id = ? AND batch_id IS NULL AND source_timestamp >= ?",
        (body.batch_id, device_id, batch["started_at"]),
    )
    return db.query_one("SELECT * FROM devices WHERE id = ?", (device_id,))


@router.post("/{device_id}/unassign", response_model=DeviceResponse)
async def unassign_device(device_id: str, request: Request):
    db = get_db(request)
    device = db.query_one("SELECT * FROM devices WHERE id = ?", (device_id,))
    if not device:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Device not found"})
    now = now_utc()
    await db.execute(
        "UPDATE devices SET batch_id = NULL, assigned_at = NULL, updated_at = ? WHERE id = ?",
        (now, device_id),
    )
    return db.query_one("SELECT * FROM devices WHERE id = ?", (device_id,))
```

**Step 4: Add router to `api/src/app.py`**

```python
from src.routes.devices import router as devices_router
# ...
app.include_router(devices_router)
```

**Step 5: Run tests**

Run: `cd api && uv run pytest tests/ -v`
Expected: All PASS

**Step 6: Commit**

```bash
git add api/src/routes/devices.py api/src/app.py api/tests/test_devices.py
git commit -m "feat: add device registration, assignment with reading backfill"
```

---

## Task 10: Readings — List by Batch & Device with Cursor Pagination

**Files:**
- Create: `api/src/routes/readings.py`
- Create: `api/tests/test_readings.py`
- Modify: `api/src/app.py` (add router)

**Step 1: Write reading tests**

Create `api/tests/test_readings.py`:

```python
import pytest

HEADERS = {"X-API-Key": "test-api-key"}
BATCH = {
    "name": "2026 Merlot",
    "wine_type": "red",
    "source_material": "fresh_grapes",
    "started_at": "2026-03-19T10:00:00Z",
}


def _insert_readings(db, batch_id, device_id, count):
    for i in range(count):
        await db.execute(
            "INSERT INTO readings (id, batch_id, device_id, gravity, temperature, battery, rssi, source_timestamp, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (f"r{i}", batch_id, device_id, 1.090 - i * 0.001, 22.0, 95.0, -60.0,
             f"2026-03-19T{10 + i:02d}:00:00Z", f"2026-03-19T{10 + i:02d}:00:05Z"),
        )


@pytest.mark.asyncio
async def test_list_readings_by_batch(client, db):
    r = await client.post("/api/v1/batches", json=BATCH, headers=HEADERS)
    batch_id = r.json()["id"]
    _insert_readings(db, batch_id, "pill-1", 5)
    r = await client.get(f"/api/v1/batches/{batch_id}/readings", headers=HEADERS)
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 5
    # Newest first
    assert items[0]["source_timestamp"] > items[-1]["source_timestamp"]


@pytest.mark.asyncio
async def test_list_readings_by_device(client, db):
    await db.execute(
        "INSERT INTO devices (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        ("pill-1", "My Pill", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    )
    _insert_readings(db, None, "pill-1", 3)
    r = await client.get("/api/v1/devices/pill-1/readings", headers=HEADERS)
    assert r.status_code == 200
    assert len(r.json()["items"]) == 3


@pytest.mark.asyncio
async def test_readings_pagination(client, db):
    r = await client.post("/api/v1/batches", json=BATCH, headers=HEADERS)
    batch_id = r.json()["id"]
    _insert_readings(db, batch_id, "pill-1", 5)
    # First page: limit 2
    r = await client.get(f"/api/v1/batches/{batch_id}/readings?limit=2", headers=HEADERS)
    data = r.json()
    assert len(data["items"]) == 2
    assert data["next_cursor"] is not None
    # Second page
    r = await client.get(
        f"/api/v1/batches/{batch_id}/readings?limit=2&cursor={data['next_cursor']}",
        headers=HEADERS,
    )
    data2 = r.json()
    assert len(data2["items"]) == 2
    # No overlap
    ids_page1 = {item["id"] for item in data["items"]}
    ids_page2 = {item["id"] for item in data2["items"]}
    assert ids_page1.isdisjoint(ids_page2)
```

**Step 2: Run tests to verify they fail**

Run: `cd api && uv run pytest tests/test_readings.py -v`
Expected: FAIL

**Step 3: Implement readings router**

Create `api/src/routes/readings.py`:

```python
from __future__ import annotations

import base64
import json

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from src.db import get_db
from src.models import PaginatedReadings

batch_router = APIRouter(prefix="/api/v1/batches/{batch_id}/readings", tags=["readings"])
device_router = APIRouter(prefix="/api/v1/devices/{device_id}/readings", tags=["readings"])

DEFAULT_LIMIT = 100
MAX_LIMIT = 500


def _encode_cursor(source_timestamp: str, row_id: str) -> str:
    return base64.urlsafe_b64encode(json.dumps([source_timestamp, row_id]).encode()).decode()


def _decode_cursor(cursor: str) -> tuple[str, str] | None:
    try:
        data = json.loads(base64.urlsafe_b64decode(cursor))
        return data[0], data[1]
    except (ValueError, IndexError, KeyError):
        return None


async def _paginated_query(
    db, base_sql: str, params: list, limit: int, cursor: str | None,
    start_time: str | None = None, end_time: str | None = None,
):
    sql = base_sql
    if start_time:
        sql += " AND source_timestamp >= ?"
        params.append(start_time)
    if end_time:
        sql += " AND source_timestamp <= ?"
        params.append(end_time)
    if cursor:
        decoded = _decode_cursor(cursor)
        if decoded:
            ts, rid = decoded
            sql += " AND (source_timestamp < ? OR (source_timestamp = ? AND id < ?))"
            params.extend([ts, ts, rid])
    sql += " ORDER BY source_timestamp DESC, id DESC LIMIT ?"
    params.append(limit + 1)  # fetch one extra to detect next page
    rows = await db.query(sql, tuple(params))
    has_next = len(rows) > limit
    items = rows[:limit]
    next_cursor = None
    if has_next and items:
        last = items[-1]
        next_cursor = _encode_cursor(last["source_timestamp"], last["id"])
    return {"items": items, "next_cursor": next_cursor}


@batch_router.get("", response_model=PaginatedReadings)
async def list_readings_by_batch(
    batch_id: str,
    request: Request,
    limit: int = DEFAULT_LIMIT,
    cursor: str | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
):
    db = get_db(request)
    batch = await db.query_one("SELECT id FROM batches WHERE id = ?", (batch_id,))
    if not batch:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Batch not found"})
    limit = max(1, min(limit, MAX_LIMIT))
    return await _paginated_query(db, "SELECT * FROM readings WHERE batch_id = ?", [batch_id], limit, cursor, start_time, end_time)


@device_router.get("", response_model=PaginatedReadings)
async def list_readings_by_device(
    device_id: str,
    request: Request,
    limit: int = DEFAULT_LIMIT,
    cursor: str | None = None,
    start_time: str | None = None,
    end_time: str | None = None,
):
    db = get_db(request)
    device = await db.query_one("SELECT id FROM devices WHERE id = ?", (device_id,))
    if not device:
        return JSONResponse(status_code=404, content={"error": "not_found", "message": "Device not found"})
    limit = max(1, min(limit, MAX_LIMIT))
    return await _paginated_query(db, "SELECT * FROM readings WHERE device_id = ?", [device_id], limit, cursor, start_time, end_time)
```

**Step 4: Add routers to `api/src/app.py`**

```python
from src.routes.readings import batch_router as batch_readings_router
from src.routes.readings import device_router as device_readings_router
# ...
app.include_router(batch_readings_router)
app.include_router(device_readings_router)
```

**Step 5: Run tests**

Run: `cd api && uv run pytest tests/ -v`
Expected: All PASS

**Step 6: Commit**

```bash
git add api/src/routes/readings.py api/src/app.py api/tests/test_readings.py
git commit -m "feat: add readings endpoints with cursor-based pagination"
```

---

## Task 11: Webhook Receiver

**Files:**
- Create: `api/src/routes/webhook.py`
- Create: `api/tests/test_webhook.py`
- Modify: `api/src/app.py` (add router)

**Step 1: Write webhook tests**

Create `api/tests/test_webhook.py`:

```python
import pytest

WEBHOOK_HEADERS = {"X-Webhook-Token": "test-webhook-token"}

VALID_PAYLOAD = {
    "device_id": "pill-abc-123",
    "device_name": "My RAPT Pill",
    "temperature": 22.5,
    "gravity": 1.045,
    "battery": 92.3,
    "rssi": -58.0,
    "created_date": "2026-03-19T14:30:00Z",
}


@pytest.mark.asyncio
async def test_webhook_creates_reading(client, db):
    # Register device first
    await db.execute(
        "INSERT INTO devices (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        ("pill-abc-123", "My Pill", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    )
    r = await client.post("/webhook/rapt", json=VALID_PAYLOAD, headers=WEBHOOK_HEADERS)
    assert r.status_code == 200
    reading = db.query_one("SELECT * FROM readings WHERE device_id = 'pill-abc-123'")
    assert reading is not None
    assert reading["gravity"] == 1.045
    assert reading["temperature"] == 22.5
    assert reading["source_timestamp"] == "2026-03-19T14:30:00Z"


@pytest.mark.asyncio
async def test_webhook_auto_registers_unknown_device(client, db):
    r = await client.post("/webhook/rapt", json=VALID_PAYLOAD, headers=WEBHOOK_HEADERS)
    assert r.status_code == 200
    device = db.query_one("SELECT * FROM devices WHERE id = 'pill-abc-123'")
    assert device is not None
    assert device["name"] == "My RAPT Pill"


@pytest.mark.asyncio
async def test_webhook_resolves_batch_from_device(client, db):
    # Create batch and assign device
    headers = {"X-API-Key": "test-api-key"}
    r = await client.post("/api/v1/batches", json={
        "name": "Test", "wine_type": "red", "source_material": "kit",
        "started_at": "2026-03-19T10:00:00Z",
    }, headers=headers)
    batch_id = r.json()["id"]
    await db.execute(
        "INSERT INTO devices (id, name, batch_id, assigned_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ("pill-abc-123", "My Pill", batch_id, "2026-03-19T10:00:00Z", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    )
    r = await client.post("/webhook/rapt", json=VALID_PAYLOAD, headers=WEBHOOK_HEADERS)
    assert r.status_code == 200
    reading = db.query_one("SELECT batch_id FROM readings WHERE device_id = 'pill-abc-123'")
    assert reading["batch_id"] == batch_id


@pytest.mark.asyncio
async def test_webhook_unassigned_device_null_batch(client):
    r = await client.post("/webhook/rapt", json=VALID_PAYLOAD, headers=WEBHOOK_HEADERS)
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_webhook_deduplicate(client):
    r1 = await client.post("/webhook/rapt", json=VALID_PAYLOAD, headers=WEBHOOK_HEADERS)
    assert r1.status_code == 200
    r2 = await client.post("/webhook/rapt", json=VALID_PAYLOAD, headers=WEBHOOK_HEADERS)
    assert r2.status_code == 200  # Returns 200 on conflict, not error


@pytest.mark.asyncio
async def test_webhook_invalid_token(client):
    r = await client.post("/webhook/rapt", json=VALID_PAYLOAD, headers={"X-Webhook-Token": "wrong"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_webhook_missing_token(client):
    r = await client.post("/webhook/rapt", json=VALID_PAYLOAD)
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_webhook_invalid_payload(client):
    r = await client.post("/webhook/rapt", json={"bad": "data"}, headers=WEBHOOK_HEADERS)
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_webhook_missing_token_with_invalid_payload(client):
    """Auth must be checked before body validation — should get 401 not 422."""
    r = await client.post("/webhook/rapt", json={"bad": "data"})
    assert r.status_code == 401
```

**Step 2: Run tests to verify they fail**

Run: `cd api && uv run pytest tests/test_webhook.py -v`
Expected: FAIL

**Step 3: Implement webhook router**

Create `api/src/routes/webhook.py`:

```python
from __future__ import annotations

import uuid

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from src.config import check_api_key
from src.db import get_db, now_utc
from src.models import RaptWebhookPayload

router = APIRouter(prefix="/webhook", tags=["webhook"])


@router.post("/rapt")
async def rapt_webhook(request: Request):
    # Auth BEFORE body parsing to avoid leaking schema to unauthenticated callers
    token = request.headers.get("X-Webhook-Token")
    expected = getattr(request.app.state, "webhook_token", "")
    if not check_api_key(token, expected):
        return JSONResponse(status_code=401, content={"error": "unauthorized", "message": "Invalid webhook token"})

    # Parse body after auth
    body_json = await request.json()
    body = RaptWebhookPayload(**body_json)

    db = get_db(request)
    now = now_utc()

    # Auto-register unknown device
    device = await db.query_one("SELECT * FROM devices WHERE id = ?", (body.device_id,))
    if not device:
        await db.execute(
            "INSERT INTO devices (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (body.device_id, body.device_name, now, now),
        )
        device = await db.query_one("SELECT * FROM devices WHERE id = ?", (body.device_id,))

    # Resolve batch_id from device assignment
    batch_id = device["batch_id"]  # May be None

    # Insert reading, deduplicate via Database.execute_or_ignore
    reading_id = str(uuid.uuid4())
    inserted = await db.execute_or_ignore(
        """INSERT INTO readings (id, batch_id, device_id, gravity, temperature, battery, rssi, source_timestamp, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (reading_id, batch_id, body.device_id, body.gravity, body.temperature,
         body.battery, body.rssi, body.created_date, now),
    )

    if not inserted:
        return {"status": "duplicate", "message": "Reading already exists"}
    return {"status": "ok", "reading_id": reading_id}
```

**Step 4: Add router to `api/src/app.py`**

```python
from src.routes.webhook import router as webhook_router
# ...
app.include_router(webhook_router)
```

**Step 5: Run tests**

Run: `cd api && uv run pytest tests/ -v`
Expected: All PASS

**Step 6: Lint and type check everything**

Run: `cd api && uv run ruff check src/ tests/ && uv run ruff format --check src/ tests/`
Expected: No errors. Fix any that appear.

**Step 7: Commit**

```bash
git add api/src/routes/webhook.py api/src/app.py api/tests/test_webhook.py
git commit -m "feat: add RAPT Pill webhook receiver with auto-registration and dedup"
```

---

## Task 12: Final Integration & Cleanup

**Files:**
- Modify: `api/src/app.py` (final state)
- Create: `api/tests/test_integration.py`

**Step 1: Write integration test**

Create `api/tests/test_integration.py` — full workflow test:

```python
import pytest

API = {"X-API-Key": "test-api-key"}
WEBHOOK = {"X-Webhook-Token": "test-webhook-token"}


@pytest.mark.asyncio
async def test_full_batch_workflow(client):
    """End-to-end: create batch, assign device, receive telemetry, log activities, complete."""

    # 1. Create batch
    r = await client.post("/api/v1/batches", json={
        "name": "2026 Cab Sauv",
        "wine_type": "red",
        "source_material": "fresh_grapes",
        "started_at": "2026-09-15T08:00:00Z",
        "volume_liters": 23.0,
    }, headers=API)
    assert r.status_code == 201
    batch_id = r.json()["id"]

    # 2. Register and assign device
    await client.post("/api/v1/devices", json={"id": "pill-001", "name": "Fermentation Pill"}, headers=API)
    r = await client.post("/api/v1/devices/pill-001/assign", json={"batch_id": batch_id}, headers=API)
    assert r.json()["batch_id"] == batch_id

    # 3. Receive webhook telemetry
    r = await client.post("/webhook/rapt", json={
        "device_id": "pill-001",
        "device_name": "Fermentation Pill",
        "temperature": 24.0,
        "gravity": 1.090,
        "battery": 98.0,
        "rssi": -55.0,
        "created_date": "2026-09-15T10:00:00Z",
    }, headers=WEBHOOK)
    assert r.status_code == 200

    # 4. Log activity
    r = await client.post(f"/api/v1/batches/{batch_id}/activities", json={
        "stage": "must_prep",
        "type": "addition",
        "title": "Added pectic enzyme",
        "details": {"chemical": "pectic enzyme", "amount": 1.0, "unit": "tsp"},
        "recorded_at": "2026-09-15T09:00:00Z",
    }, headers=API)
    assert r.status_code == 201

    # 5. Advance through stages
    for _ in range(4):
        await client.post(f"/api/v1/batches/{batch_id}/advance", headers=API)

    r = await client.get(f"/api/v1/batches/{batch_id}", headers=API)
    assert r.json()["stage"] == "bottling"

    # 6. Check readings
    r = await client.get(f"/api/v1/batches/{batch_id}/readings", headers=API)
    assert len(r.json()["items"]) == 1

    # 7. Complete batch (auto-unassigns device)
    r = await client.post(f"/api/v1/batches/{batch_id}/complete", headers=API)
    assert r.json()["status"] == "completed"

    # 8. Device should be unassigned
    r = await client.get("/api/v1/devices", headers=API)
    assert r.json()["items"][0]["batch_id"] is None

    # 9. Archive
    r = await client.post(f"/api/v1/batches/{batch_id}/archive", headers=API)
    assert r.json()["status"] == "archived"
```

**Step 2: Run full test suite**

Run: `cd api && uv run pytest tests/ -v`
Expected: All PASS

**Step 3: Run linting, formatting, and type checking**

Run: `cd api && uv run ruff check src/ tests/ --fix && uv run ruff format src/ tests/`
Expected: Clean

Run: `cd api && uv run ty check src/`
Expected: No errors (or only minor issues from Cloudflare-specific imports)

**Step 4: Verify final `api/src/app.py` has all routers**

Ensure it includes: batches, activities, devices, batch_readings, device_readings, webhook.

**Step 5: Commit**

```bash
git add api/
git commit -m "feat: add integration test covering full batch lifecycle"
```

**Step 6: Run full suite one final time**

Run: `cd api && uv run pytest tests/ -v --tb=short`
Expected: All PASS, 0 failures

---

## Review Checkpoint

After Task 12, run the code-reviewer agent and codex exec against the full implementation to verify:
- All design doc requirements are implemented
- Test coverage is adequate
- No security issues (SQL injection, auth bypass)
- Code quality and consistency

---

## Deployment (Post-Review)

After review passes:

1. Create D1 database: `wrangler d1 create wine-cellar`
2. Update `database_id` in `wrangler.toml`
3. Apply migration: `wrangler d1 migrations apply --local` (test locally first)
4. Set secrets: `wrangler secret put API_KEY` and `wrangler secret put WEBHOOK_TOKEN`
5. Deploy: `wrangler deploy`
6. Smoke test: `curl https://wine-cellar-api.<your-subdomain>.workers.dev/health`
