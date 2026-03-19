# Wine Cellar MVP Design

## Overview

API-first winemaking batch management system built on Cloudflare Workers
(Python/FastAPI) with D1 storage. Manual activity logging with RAPT Pill
telemetry integration via webhook.

## Architecture

- **Runtime:** Python FastAPI on Cloudflare Workers (paid plan, $5/month).
  Requires `python_workers` compatibility flag in `wrangler.toml`. Python
  Workers are still in open beta (not GA). Only async HTTP libraries work
  for outbound requests (httpx, not requests). Expect ~1s cold starts on
  most webhook invocations due to 30-minute intervals.
- **Storage:** D1 (managed SQLite) for all persistent data
- **Auth:** Two separate secrets, both stored via `wrangler secret put`:
  - API key via `X-API-Key` header for user-facing endpoints
  - Webhook token via custom header for RAPT Pill endpoint (configured in
    RAPT Portal, distinct from the API key)
- **Units:** Temperature in Celsius, gravity in standard SG (e.g. 1.050)
- **Future:** Durable Objects as write-path layer, SPA dashboard on Cloudflare
  Pages, MCP server for LLM agent integration, OAuth (Apple/Google) for web
  users

### Migration path to Durable Objects

D1 remains the persistent query store. When DOs are introduced, they become
the write path: webhook hits DO, DO validates/processes, DO persists to D1.
The D1 schema does not change. DOs are an additive layer, not a replacement.

## Core Entities

### Batch

A wine batch tracked from preparation through bottling.

| Column               | Type     | Notes                                              |
| -------------------- | -------- | -------------------------------------------------- |
| `id`                 | UUID     | Primary key                                        |
| `name`               | text     | e.g. "2026 Merlot"                                 |
| `wine_type`          | enum     | red, white, rosé, orange, sparkling, dessert       |
| `source_material`    | enum     | kit, juice_bucket, fresh_grapes                    |
| `stage`              | enum     | One of 5 MVP waypoints (see Stage Model)           |
| `status`             | enum     | active, completed, archived, abandoned             |
| `volume_liters`      | real     |                                                    |
| `target_volume_liters` | real   |                                                    |
| `started_at`         | datetime |                                                    |
| `completed_at`       | datetime | Nullable                                           |
| `notes`              | text     | Freeform                                           |
| `created_at`         | datetime |                                                    |
| `updated_at`         | datetime |                                                    |

### Activity

Manual log entries against a batch.

| Column        | Type     | Notes                                                    |
| ------------- | -------- | -------------------------------------------------------- |
| `id`          | UUID     | Primary key                                              |
| `batch_id`    | UUID     | FK → batches                                             |
| `stage`       | enum     | Which stage this occurred during                         |
| `type`        | enum     | addition, racking, measurement, tasting, note, adjustment |
| `title`       | text     | Short description                                        |
| `details`     | JSON     | Flexible per type, e.g. `{"chemical": "K-meta", "amount": 0.25, "unit": "tsp"}` |
| `recorded_at` | datetime | When it actually happened                                |
| `created_at`  | datetime |                                                          |
| `updated_at`  | datetime |                                                          |

**Activity details schemas by type:**

| Type          | Required fields                                              |
| ------------- | ------------------------------------------------------------ |
| `addition`    | `chemical` (str), `amount` (num), `unit` (str)               |
| `measurement` | `metric` (str, e.g. "pH", "TA", "SO2"), `value` (num), `unit` (str) |
| `racking`     | `from_vessel` (str), `to_vessel` (str)                       |
| `tasting`     | `aroma` (str), `flavor` (str), `appearance` (str)            |
| `adjustment`  | `parameter` (str), `from_value` (num), `to_value` (num), `unit` (str) |
| `note`        | No required fields — freeform text in `title`                |

All types may include optional `notes` (str) in `details`. Validated by
Pydantic discriminated unions keyed on `type`.

> **Design note:** The research recommends additions as first-class entities
> with dedicated columns for chemical, amount, unit, and target measurement.
> The MVP intentionally folds additions into Activity with a JSON `details`
> column to keep the schema simple. Trade-off: cross-batch queries like "all
> K-meta additions" require SQLite JSON extraction. Migration path: extract an
> `additions` table from Activity rows where `type = 'addition'` when the query
> pattern demands it.

### Reading

Telemetry data from a RAPT Pill hydrometer. ~48 readings/day per device at
30-minute intervals.

| Column             | Type     | Notes                                |
| ------------------ | -------- | ------------------------------------ |
| `id`               | UUID     | Primary key                          |
| `batch_id`         | UUID     | FK → batches, nullable (unassigned)  |
| `device_id`        | text     | From RAPT Pill payload               |
| `gravity`          | real     | Standard SG (e.g. 1.050)             |
| `temperature`      | real     | Celsius                              |
| `battery`          | real     | Percentage                           |
| `rssi`             | real     | dBm                                  |
| `source_timestamp` | datetime | From the device                      |
| `created_at`       | datetime | When received                        |

Deduplicated on `device_id` + `source_timestamp`.

### Device

A RAPT Pill hydrometer, assignable to one batch at a time.

| Column        | Type     | Notes                            |
| ------------- | -------- | -------------------------------- |
| `id`          | text     | device_id from RAPT Pill         |
| `name`        | text     | Friendly name                    |
| `batch_id`    | UUID     | FK → batches, nullable           |
| `assigned_at` | datetime | Nullable                         |
| `created_at`  | datetime |                                  |
| `updated_at`  | datetime |                                  |

## Stage Model

All 14 stages defined in the schema:

| #  | Key                      | Name                      |
| -- | ------------------------ | ------------------------- |
| 1  | `receiving`              | Receiving & Inspection    |
| 2  | `crushing`               | Crushing & Destemming     |
| 3  | `must_prep`              | Must Preparation          |
| 4  | `primary_fermentation`   | Primary Fermentation      |
| 5  | `pressing`               | Pressing                  |
| 6  | `secondary_fermentation` | Secondary Fermentation    |
| 7  | `malolactic`             | Malolactic Fermentation   |
| 8  | `stabilization`          | Stabilization & Degassing |
| 9  | `fining`                 | Fining & Clarification    |
| 10 | `bulk_aging`             | Bulk Aging                |
| 11 | `cold_stabilization`     | Cold Stabilization        |
| 12 | `filtering`              | Filtering                 |
| 13 | `bottling`               | Bottling                  |
| 14 | `bottle_aging`           | Bottle Aging              |

### MVP core stages

The `batch.stage` column stores one of the 5 MVP waypoints only:

| MVP Waypoint             | Covers                                    |
| ------------------------ | ----------------------------------------- |
| `must_prep`              | Receiving, crushing, must preparation     |
| `primary_fermentation`   | Primary fermentation                      |
| `secondary_fermentation` | Secondary fermentation + MLF              |
| `stabilization`          | Stabilization, fining, aging              |
| `bottling`               | Bottling + bottle aging                   |

`/advance` moves from one waypoint to the next (forward-only). The full
14-stage enum is used only on `activity.stage` to preserve granularity — e.g.
an activity recorded during `malolactic` while the batch is at
`secondary_fermentation`. This avoids ambiguity: every batch stage has an
unambiguous "next" state.

**Allowed activity stages per batch waypoint:**

| Batch waypoint           | Allowed activity stages                              |
| ------------------------ | ---------------------------------------------------- |
| `must_prep`              | `receiving`, `crushing`, `must_prep`                 |
| `primary_fermentation`   | `primary_fermentation`, `pressing`                   |
| `secondary_fermentation` | `secondary_fermentation`, `malolactic`               |
| `stabilization`          | `stabilization`, `fining`, `bulk_aging`, `cold_stabilization`, `filtering` |
| `bottling`               | `bottling`, `bottle_aging`                           |

**Migration to full 14-stage model:** The 5 waypoints are a subset of the
14 stages, so the CHECK constraint expands without data loss. However,
batches in collapsed waypoints (e.g. `stabilization` covering 5 stages) will
need manual review or a default mapping to determine their precise stage.
Activity stages already use the full 14 values and need no migration.

## API Endpoints

Base path: `/api/v1`

### Batches

| Method | Path                      | Description                    |
| ------ | ------------------------- | ------------------------------ |
| POST   | `/batches`                | Create a batch                 |
| GET    | `/batches`                | List batches (filter by status, stage, wine_type, source_material) |
| GET    | `/batches/{id}`           | Get batch detail               |
| PATCH  | `/batches/{id}`           | Update metadata only: `name`, `notes`, `volume_liters`, `target_volume_liters` |
| POST   | `/batches/{id}/advance`   | Advance to next stage (active batches only) |
| POST   | `/batches/{id}/complete`  | Set status to `completed`, set `completed_at` |
| POST   | `/batches/{id}/abandon`   | Set status to `abandoned`      |
| POST   | `/batches/{id}/archive`   | Archive a completed batch      |
| POST   | `/batches/{id}/unarchive` | Unarchive back to completed    |
| DELETE | `/batches/{id}`           | Delete batch (see lifecycle invariants) |

### Activities

| Method | Path                          | Description                           |
| ------ | ----------------------------- | ------------------------------------- |
| POST   | `/batches/{id}/activities`    | Log an activity                       |
| GET    | `/batches/{id}/activities`    | List activities (filter by type, stage, time range) |
| PATCH  | `/batches/{id}/activities/{activity_id}` | Update an activity |
| DELETE | `/batches/{id}/activities/{activity_id}` | Delete an activity |

### Readings

| Method | Path                       | Description                              |
| ------ | -------------------------- | ---------------------------------------- |
| GET    | `/batches/{id}/readings`   | Get telemetry (filter by time range, cursor-paginated) |

| GET    | `/devices/{id}/readings`   | Get readings by device (includes unassigned) |

Readings pagination: cursor-based on compound key
`(source_timestamp DESC, id DESC)` to avoid skipping/duplicating rows when
timestamps collide. Default 100 per page, max 500.

### Devices

| Method | Path                       | Description                 |
| ------ | -------------------------- | --------------------------- |
| POST   | `/devices`                 | Register a device           |
| GET    | `/devices`                 | List devices                |
| POST   | `/devices/{id}/assign`     | Assign device to an active batch (backfills unassigned readings) |
| POST   | `/devices/{id}/unassign`   | Unassign from current batch |

When assigning a device to a batch, any unassigned readings
(`batch_id IS NULL`) from that device where
`source_timestamp >= batch.started_at` are automatically claimed by setting
their `batch_id`. This handles the common case of forgetting to assign a
device before dropping it into the fermenter.

### Webhook

| Method | Path             | Description                                      |
| ------ | ---------------- | ------------------------------------------------ |
| POST   | `/webhook/rapt`  | RAPT Pill telemetry (auth via custom header token) |

### Utility

| Method | Path      | Description  |
| ------ | --------- | ------------ |
| GET    | `/health` | Health check |

## Batch Lifecycle Invariants

- Only `active` batches can advance stages or log activities
- `completed` and `abandoned` are terminal — no further stage changes
- `/complete` sets `status = completed` and `completed_at = now()`;
  batch must be `active`. Auto-unassigns any device currently assigned to
  this batch.
- `/abandon` sets `status = abandoned`; batch must be `active`.
  Auto-unassigns any device currently assigned to this batch.
- `/archive` sets `status = archived`; batch must be `completed`
- `/unarchive` sets `status = completed`; batch must be `archived`
- `PATCH` only modifies metadata fields, never `stage` or `status`
- Deleting a batch requires status `abandoned` or zero activities and zero
  readings. Deletion unassigns any device pointing to it (`ON DELETE SET NULL`
  on `devices.batch_id`) and cascades to delete associated readings and
  activities (`ON DELETE CASCADE`)
- An `archived` batch is a completed batch hidden from default listing

## Error Handling

Consistent JSON error shape:

```json
{"error": "not_found", "message": "Batch not found"}
```

Standard HTTP codes: 400 (validation), 401 (auth), 404 (not found),
409 (conflict, e.g. invalid stage transition), 422 (unprocessable).

## Webhook Design

### Expected payload

Configure this JSON template in the RAPT Portal:

```json
{
  "device_id": "@device_id",
  "device_name": "@device_name",
  "temperature": @temperature,
  "gravity": @gravity,
  "battery": @battery,
  "rssi": @rssi,
  "created_date": "@created_date"
}
```

Temperature is Celsius, gravity is standard SG. The `@device_type` variable
is intentionally omitted (all devices are RAPT Pills for now).

### Processing

- Validate webhook token from custom header (separate secret from API key).
  RAPT webhooks are unsigned — consider Cloudflare Rate Limiting and/or IP
  allowlisting as additional hardening for non-personal deployments
- Parse and validate payload against expected schema
- Look up device by `device_id` — auto-register if unknown (set `name` to
  `device_name` from payload)
- Resolve `batch_id` from device assignment (null if unassigned; don't lose data)
- Map `created_date` from payload to `source_timestamp` in Reading
- Deduplicate on `device_id` + `source_timestamp` (UNIQUE constraint, return
  200 on conflict)
- Write reading to D1 synchronously — no background processing needed at
  this volume
- Return 200 immediately

## Project Structure

```
wine-cellar/
├── docs/
│   ├── research/            # Existing research
│   └── plans/               # Design docs
├── api/
│   ├── src/
│   │   ├── app.py           # FastAPI app, middleware, lifespan
│   │   ├── config.py        # Settings, API key validation
│   │   ├── models.py        # Pydantic request/response models
│   │   ├── schema.py        # D1 SQL schema definitions
│   │   ├── routes/
│   │   │   ├── batches.py
│   │   │   ├── activities.py
│   │   │   ├── devices.py
│   │   │   ├── readings.py
│   │   │   └── webhook.py
│   │   └── db.py            # D1 query helpers (wraps Pyodide FFI to env.DB)
│   ├── tests/
│   ├── wrangler.toml        # Cloudflare Worker config
│   └── pyproject.toml       # uv, ruff, ty config
└── dashboard/               # Future SPA (empty for now)
```

## Data Access

D1 is accessed through Pyodide's FFI via `env.DB`. The `db.py` module wraps
this with Pythonic helpers that handle:

- Parameterized queries via `env.DB.prepare(sql).bind(*params)`
- Mapping result rows to dicts/Pydantic models
- Error handling across the FFI boundary

### D1/SQLite Storage Types

The entity tables above use logical types. Actual D1/SQLite mappings:

| Logical type | SQLite type | Representation                          |
| ------------ | ----------- | --------------------------------------- |
| UUID         | TEXT        | Lowercase hex with hyphens, e.g. `550e8400-...` |
| enum         | TEXT        | CHECK constraint with allowed values    |
| datetime     | TEXT        | ISO 8601 UTC, e.g. `2026-03-19T14:30:00Z` |
| JSON         | TEXT        | Serialized JSON string                  |
| real         | REAL        | Native SQLite float                     |

**Key indexes:**
- `readings(device_id, source_timestamp)` — UNIQUE, dedupe + lookup
- `readings(batch_id, source_timestamp, id)` — pagination
- `activities(batch_id, recorded_at)` — list by batch
- `devices(batch_id)` — device-to-batch lookup

### Schema Migrations

SQL migration files are the single source of truth. `wrangler d1 migrations`
manages the migration lifecycle. `schema.py` is a Python representation of
the current schema used for reference and validation, not for generating
migrations.

## Tooling

- **uv** — Package management
- **ruff** — Linting and formatting
- **ty** — Type checking

## Future Work

- Durable Objects as batch state machines (write-path layer over D1)
- Cloudflare Pages SPA dashboard
- OAuth (Apple/Google) for web users
- MCP server for LLM agent integration (suggestions, autopilot)
- Full 14-stage transition validation with source-material-aware skipping
- Additions as first-class entities (extracted from Activity JSON)
- Multi-hydrometer support (iSpindel: nullable angle, interval columns)
- Batch summary/statistics endpoint (latest readings, fermentation velocity)
