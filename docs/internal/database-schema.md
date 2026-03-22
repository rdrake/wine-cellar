# Database schema reference

> Internal documentation -- complete schema state after all migrations (0001 through 0006).
>
> Database engine: SQLite (Cloudflare D1 in production, local SQLite for testing).
> All IDs are application-generated TEXT (UUIDs). All timestamps are ISO 8601 TEXT.

---

## Table of contents

1. [ER diagram](#er-diagram)
2. [Tables](#tables)
   - [Users](#users)
   - [Batches](#batches)
   - [Activities](#activities)
   - [Readings](#readings)
   - [Devices](#devices)
   - [Service_tokens](#service_tokens)
   - [Push_subscriptions](#push_subscriptions)
   - [Alert_state](#alert_state)
3. [Enum values](#enum-values)
4. [Indexes](#indexes)
5. [Multitenancy model](#multitenancy-model)
6. [Migration history](#migration-history)

---

## ER diagram

```
┌──────────────────┐
│      users       │
│──────────────────│
│ id (PK)          │
│ email (UNIQUE)   │
│ name             │
│ created_at       │
└──────┬───────────┘
       │
       │ 1
       │
       ├──────────────────────────────────────────────────────────────┐
       │                          │              │                   │
       │ *                        │ *            │ *                 │ *
┌──────┴───────────┐  ┌──────────┴────────┐  ┌──┴──────────────┐  ┌┴─────────────────┐
│     batches      │  │  service_tokens   │  │push_subscriptions│  │   alert_state    │
│──────────────────│  │───────────────────│  │─────────────────│  │──────────────────│
│ id (PK)          │  │ client_id (PK)    │  │ id (PK)         │  │ id (PK)          │
│ user_id (FK)     │  │ user_id (FK)      │  │ user_id (FK)    │  │ user_id (FK)     │
│ name             │  │ label             │  │ endpoint (UNQ)  │  │ batch_id (FK)    │
│ wine_type        │  │ created_at        │  │ keys_p256dh     │  │ alert_type       │
│ source_material  │  └───────────────────┘  │ keys_auth       │  │ context          │
│ stage            │                         │ created_at      │  │ fired_at         │
│ status           │                         └─────────────────┘  │ dismissed_at     │
│ volume_liters    │                                              │ resolved_at      │
│ target_vol_liters│                                              └──────────────────┘
│ target_gravity   │                                                     │
│ started_at       │                                                     │
│ completed_at     │                                                     │
│ notes            │                                                     │
│ created_at       │◄────────────────────────────────────────────────────┘
│ updated_at       │         (alert_state.batch_id -> batches.id)
└──────┬───────────┘
       │
       │ 1
       │
       ├────────────────────┬────────────────────┐
       │ *                  │ *                   │ 0..1
┌──────┴───────────┐ ┌─────┴──────────┐  ┌──────┴───────────┐
│   activities     │ │   readings     │  │    devices       │
│──────────────────│ │────────────────│  │──────────────────│
│ id (PK)          │ │ id (PK)        │  │ id (PK)          │
│ user_id (FK)     │ │ user_id (FK)   │  │ user_id (FK)     │
│ batch_id (FK)    │ │ batch_id (FK)  │  │ name             │
│ stage            │ │ device_id      │  │ batch_id (FK)    │
│ type             │ │ gravity        │  │ assigned_at      │
│ title            │ │ temperature    │  │ created_at       │
│ details          │ │ battery        │  │ updated_at       │
│ reading_id (FK) ─┼─┤ rssi           │  └──────────────────┘
│ recorded_at      │ │ source         │
│ created_at       │ │ source_timestamp│
│ updated_at       │ │ created_at     │
└──────────────────┘ └────────────────┘

Legend:
  PK  = Primary Key
  FK  = Foreign Key
  UNQ = Unique constraint
  1   = one side of relationship
  *   = many side of relationship
  0..1 = zero or one (nullable FK)
  ──► = FK direction (child points to parent)
```

### Relationship summary

| Relationship | Type | FK Column | On Delete |
|---|---|---|---|
| users 1--* batches | one-to-many | `batches.user_id` | (no cascade) |
| users 1--* activities | one-to-many | `activities.user_id` | (no cascade) |
| users 1--* readings | one-to-many | `readings.user_id` | (no cascade) |
| users 1--* devices | one-to-many | `devices.user_id` | (no cascade) |
| users 1--* service_tokens | one-to-many | `service_tokens.user_id` | (no cascade) |
| users 1--* push_subscriptions | one-to-many | `push_subscriptions.user_id` | (no cascade) |
| users 1--* alert_state | one-to-many | `alert_state.user_id` | (no cascade) |
| batches 1--* activities | one-to-many | `activities.batch_id` | CASCADE |
| batches 1--* readings | one-to-many | `readings.batch_id` | CASCADE |
| batches 1--0..1 devices | one-to-zero-or-one | `devices.batch_id` | SET NULL |
| batches 1--* alert_state | one-to-many | `alert_state.batch_id` | (no cascade) |
| readings 1--0..1 activities | one-to-zero-or-one | `activities.reading_id` | SET NULL |

---

## Tables

### Users

Owner accounts. Created during multitenant migration (0004).

| Column | Type | Nullable | Default | Constraints |
|---|---|---|---|---|
| `id` | TEXT | NOT NULL | -- | **PRIMARY KEY** |
| `email` | TEXT | NOT NULL | -- | **UNIQUE** |
| `name` | TEXT | nullable | -- | -- |
| `created_at` | TEXT | NOT NULL | `datetime('now')` | -- |

**Notes:** The seed migration inserts a single owner record (`00000000-0000-0000-0000-000000000001`, `rdrake@pobox.com`). The system creates new users on first authentication.

---

### Batches

A wine batch from start to finish. Central entity of the data model.

| Column | Type | Nullable | Default | Constraints |
|---|---|---|---|---|
| `id` | TEXT | NOT NULL | -- | **PRIMARY KEY** |
| `user_id` | TEXT | NOT NULL | -- | **FK -> users(id)** |
| `name` | TEXT | NOT NULL | -- | -- |
| `wine_type` | TEXT | NOT NULL | -- | CHECK: `red`, `white`, `rosé`, `orange`, `sparkling`, `dessert` |
| `source_material` | TEXT | NOT NULL | -- | CHECK: `kit`, `juice_bucket`, `fresh_grapes` |
| `stage` | TEXT | NOT NULL | `'must_prep'` | CHECK: `must_prep`, `primary_fermentation`, `secondary_fermentation`, `stabilization`, `bottling` |
| `status` | TEXT | NOT NULL | `'active'` | CHECK: `active`, `completed`, `archived`, `abandoned` |
| `volume_liters` | REAL | nullable | -- | -- |
| `target_volume_liters` | REAL | nullable | -- | -- |
| `target_gravity` | REAL | nullable | -- | -- |
| `started_at` | TEXT | NOT NULL | -- | ISO 8601 datetime |
| `completed_at` | TEXT | nullable | -- | ISO 8601 datetime |
| `notes` | TEXT | nullable | -- | Free-form text |
| `created_at` | TEXT | NOT NULL | -- | ISO 8601 datetime |
| `updated_at` | TEXT | NOT NULL | -- | ISO 8601 datetime |

**Notes:**
- `stage` tracks the current high-level winemaking phase (5 stages -- the "batch stages" or "waypoints").
- Migration 0006 added `target_gravity` for fermentation-complete alerting.

---

### Activities

Discrete actions and events recorded against a batch (additions, measurements, tastings, and so on).

| Column | Type | Nullable | Default | Constraints |
|---|---|---|---|---|
| `id` | TEXT | NOT NULL | -- | **PRIMARY KEY** |
| `user_id` | TEXT | NOT NULL | -- | **FK -> users(id)** |
| `batch_id` | TEXT | NOT NULL | -- | **FK -> batches(id) ON DELETE CASCADE** |
| `stage` | TEXT | NOT NULL | -- | CHECK: see [All Stages](#all-stages-activity-stages) below |
| `type` | TEXT | NOT NULL | -- | CHECK: `addition`, `racking`, `measurement`, `tasting`, `note`, `adjustment` |
| `title` | TEXT | NOT NULL | -- | -- |
| `details` | TEXT | nullable | -- | JSON stored as TEXT |
| `reading_id` | TEXT | nullable | -- | **FK -> readings(id) ON DELETE SET NULL** |
| `recorded_at` | TEXT | NOT NULL | -- | ISO 8601 datetime |
| `created_at` | TEXT | NOT NULL | -- | ISO 8601 datetime |
| `updated_at` | TEXT | NOT NULL | -- | ISO 8601 datetime |

**Notes:**
- `stage` uses the fine-grained 14-value "all stages" list (not the 5-value batch stage list).
- `reading_id` links a `measurement`-type activity to its autogenerated reading row. When the system updates or deletes the activity, it can reliably find the linked reading. ON DELETE SET NULL prevents orphan issues if something deletes the reading first.
- `details` is schemaless JSON. Structure varies by `type`.
- Deleting a batch cascades to all its activities.

---

### Readings

Gravity and temperature data points from IoT hydrometers or manual entry.

| Column | Type | Nullable | Default | Constraints |
|---|---|---|---|---|
| `id` | TEXT | NOT NULL | -- | **PRIMARY KEY** |
| `user_id` | TEXT | nullable | -- | **FK -> users(id)** |
| `batch_id` | TEXT | nullable | -- | **FK -> batches(id) ON DELETE CASCADE** |
| `device_id` | TEXT | NOT NULL | -- | -- |
| `gravity` | REAL | NOT NULL | -- | Specific gravity value |
| `temperature` | REAL | nullable | -- | Celsius (null for manual readings) |
| `battery` | REAL | nullable | -- | Battery percentage (null for manual) |
| `rssi` | REAL | nullable | -- | Signal strength (null for manual) |
| `source` | TEXT | NOT NULL | `'device'` | Distinguishes `device` compared to `manual` readings |
| `source_timestamp` | TEXT | NOT NULL | -- | ISO 8601 datetime from device/user |
| `created_at` | TEXT | NOT NULL | -- | ISO 8601 datetime |

**Notes:**
- `batch_id` is nullable -- readings can arrive before the user assigns them to a batch (e.g., from an unassigned device).
- `user_id` is nullable -- legacy readings from before multitenancy were backfilled, but the column allows NULL for unclaimed device readings.
- `temperature`, `battery`, `rssi` are typically non-null for `source='device'` and null for `source='manual'`.
- `device_id` for manual readings uses a synthetic value (e.g., `manual`).
- Deleting a batch cascades to all its readings.

---

### Devices

IoT hydrometers (e.g., Tilt, iSpindel) tracked by the system.

| Column | Type | Nullable | Default | Constraints |
|---|---|---|---|---|
| `id` | TEXT | NOT NULL | -- | **PRIMARY KEY** |
| `user_id` | TEXT | nullable | -- | **FK -> users(id)** |
| `name` | TEXT | NOT NULL | -- | -- |
| `batch_id` | TEXT | nullable | -- | **FK -> batches(id) ON DELETE SET NULL** |
| `assigned_at` | TEXT | nullable | -- | ISO 8601 datetime |
| `created_at` | TEXT | NOT NULL | -- | ISO 8601 datetime |
| `updated_at` | TEXT | NOT NULL | -- | ISO 8601 datetime |

**Notes:**
- A user can assign a device to at most one batch at a time (`batch_id`). The design explicitly does not support many devices per batch.
- When the user deletes a batch, D1 sets the device's `batch_id` to NULL (the device becomes "unassigned" rather than deleted).
- `user_id` is nullable to support unclaimed devices.

---

### Service_tokens

Maps Cloudflare Access service-token client IDs to user accounts. Used for machine-to-machine API access (e.g., IoT gateway pushing readings).

| Column | Type | Nullable | Default | Constraints |
|---|---|---|---|---|
| `client_id` | TEXT | NOT NULL | -- | **PRIMARY KEY** |
| `user_id` | TEXT | NOT NULL | -- | **FK -> users(id)** |
| `label` | TEXT | nullable | -- | Human-readable description |
| `created_at` | TEXT | NOT NULL | `datetime('now')` | -- |

**Notes:**
- The primary key is the Cloudflare Access service token's `CF-Access-Client-Id` header value.
- Allows the API to resolve an incoming service-token-authenticated request to a `user_id` for multitenant scoping.

---

### Push_subscriptions

Web Push API subscription records for sending browser push notifications.

| Column | Type | Nullable | Default | Constraints |
|---|---|---|---|---|
| `id` | TEXT | NOT NULL | -- | **PRIMARY KEY** |
| `user_id` | TEXT | NOT NULL | -- | **FK -> users(id)** |
| `endpoint` | TEXT | NOT NULL | -- | **UNIQUE** -- the push service URL |
| `keys_p256dh` | TEXT | NOT NULL | -- | P-256 DH public key (base64url) |
| `keys_auth` | TEXT | NOT NULL | -- | Auth secret (base64url) |
| `created_at` | TEXT | NOT NULL | `datetime('now')` | -- |

**Notes:**
- One user can have many subscriptions (one per browser or device).
- The `endpoint` UNIQUE constraint prevents duplicate registrations for the same browser.

---

### Alert_state

Tracks fired alerts so the system can avoid duplicate notifications and allow users to close or resolve them.

| Column | Type | Nullable | Default | Constraints |
|---|---|---|---|---|
| `id` | TEXT | NOT NULL | -- | **PRIMARY KEY** |
| `user_id` | TEXT | NOT NULL | -- | **FK -> users(id)** |
| `batch_id` | TEXT | NOT NULL | -- | **FK -> batches(id)** |
| `alert_type` | TEXT | NOT NULL | -- | CHECK: `stall`, `no_readings`, `temp_high`, `temp_low`, `stage_suggestion` |
| `context` | TEXT | nullable | -- | Extra context (JSON or free text) |
| `fired_at` | TEXT | NOT NULL | -- | ISO 8601 datetime when alert was created |
| `dismissed_at` | TEXT | nullable | -- | ISO 8601 datetime when user dismissed |
| `resolved_at` | TEXT | nullable | -- | ISO 8601 datetime when condition cleared |

**Notes:**
- The partial unique index `idx_alert_one_active` ensures at most one active (non-dismissed, non-resolved) alert per `(user_id, batch_id, alert_type)` combination. This prevents duplicate notifications for the same ongoing condition.
- An alert lifecycle: fired -> (dismissed | resolved). Both `dismissed_at` and `resolved_at` can be set (user dismissed, then condition also resolved).

---

## Enum values

All constrained string columns with their valid values, as defined in both SQL CHECK constraints and `api/src/schema.ts`.

### Wine_type (batches)

| Value | Description |
|---|---|
| `red` | Red wine |
| `white` | White wine |
| `rosé` | Rosé wine |
| `orange` | Orange wine (skin-contact white) |
| `sparkling` | Sparkling wine |
| `dessert` | Dessert wine |

### Source_material (batches)

| Value | Description |
|---|---|
| `kit` | Wine kit |
| `juice_bucket` | Pre-pressed juice bucket |
| `fresh_grapes` | Fresh grapes |

### Batch stages (batches.stage) -- "Waypoints"

The 5 high-level phases a batch progresses through sequentially:

| Value | Order | Description |
|---|---|---|
| `must_prep` | 1 | Must preparation (default starting stage) |
| `primary_fermentation` | 2 | Primary (alcoholic) fermentation |
| `secondary_fermentation` | 3 | Secondary fermentation / aging |
| `stabilization` | 4 | Stabilization and clarification |
| `bottling` | 5 | Bottling and bottle aging |

### All stages (activities.stage) -- fine-grained

The 14 detailed stages used on activities. Each maps to a parent batch stage (waypoint):

| Batch Stage (Waypoint) | Activity Stages |
|---|---|
| `must_prep` | `receiving`, `crushing`, `must_prep` |
| `primary_fermentation` | `primary_fermentation`, `pressing` |
| `secondary_fermentation` | `secondary_fermentation`, `malolactic` |
| `stabilization` | `stabilization`, `fining`, `bulk_aging`, `cold_stabilization`, `filtering` |
| `bottling` | `bottling`, `bottle_aging` |

### Status (batches)

| Value | Description |
|---|---|
| `active` | In progress (default) |
| `completed` | Finished successfully |
| `archived` | Moved to archive |
| `abandoned` | Abandoned / discarded |

### Activity_type (activities.type)

| Value | Description |
|---|---|
| `addition` | Chemical or ingredient addition |
| `racking` | Transfer between vessels |
| `measurement` | Gravity/temperature/other reading |
| `tasting` | Tasting note |
| `note` | General note |
| `adjustment` | Process change (e.g., temperature change) |

### Source (readings)

| Value | Description |
|---|---|
| `device` | Automated reading from IoT hydrometer (default) |
| `manual` | Manually entered by user |

### Alert_type (alert_state)

| Value | Description |
|---|---|
| `stall` | Fermentation stall detected (gravity not dropping) |
| `no_readings` | No readings received for an extended period |
| `temp_high` | Temperature above acceptable range |
| `temp_low` | Temperature below acceptable range |
| `stage_suggestion` | System suggests advancing to next batch stage |

---

## Indexes

### Primary key indexes (implicit)

Every table has a TEXT PRIMARY KEY that SQLite automatically indexes.

### Explicit indexes

| Index Name | Table | Columns | Type | Purpose |
|---|---|---|---|---|
| `idx_activities_batch_recorded` | activities | `(batch_id, recorded_at)` | B-tree | Fetch activities for a batch ordered by time. Covers the main activity-list query. |
| `idx_activities_user` | activities | `(user_id)` | B-tree | Filter activities by owner for multitenant isolation. |
| `idx_readings_dedupe` | readings | `(device_id, source_timestamp, COALESCE(batch_id, ''))` | **UNIQUE** | Deduplication -- prevents the same device from recording the same timestamp twice for the same batch. The COALESCE handles nullable `batch_id`. |
| `idx_readings_batch_pagination` | readings | `(batch_id, source_timestamp DESC, id DESC)` | B-tree | Cursor-based pagination of readings within a batch, newest first. |
| `idx_readings_user` | readings | `(user_id, source_timestamp DESC)` | B-tree | Filter readings by owner, ordered newest-first. Used for multitenant queries and cross-batch reading views. |
| `idx_devices_batch` | devices | `(batch_id)` | B-tree | Look up which device is assigned to a batch. |
| `idx_devices_user` | devices | `(user_id)` | B-tree | Filter devices by owner for multitenant isolation. |
| `idx_batches_user` | batches | `(user_id)` | B-tree | Filter batches by owner. Primary multitenant access pattern. |
| `idx_alert_one_active` | alert_state | `(user_id, batch_id, alert_type)` | **UNIQUE, partial** (`WHERE resolved_at IS NULL AND dismissed_at IS NULL`) | Ensures only one active alert per type per batch per user. Prevents duplicate notifications. |
| *(implicit UNIQUE on `users.email`)* | users | `(email)` | UNIQUE | Lookup user by email during authentication. |
| *(implicit UNIQUE on `push_subscriptions.endpoint`)* | push_subscriptions | `(endpoint)` | UNIQUE | Prevent duplicate push subscription registrations. |

---

## Multitenancy model

Migration 0004 added multitenancy. The model is **row-level isolation through `user_id`**.

### Which tables have `user_id`

| Table | `user_id` Column | Nullable | NOT NULL | Notes |
|---|---|---|---|---|
| `batches` | Yes | No | **NOT NULL** | Every batch belongs to exactly one user. |
| `activities` | Yes | No | **NOT NULL** | Every activity belongs to exactly one user. |
| `readings` | Yes | Yes | nullable | Can be NULL for unclaimed device readings. |
| `devices` | Yes | Yes | nullable | Can be NULL for unclaimed devices. |
| `service_tokens` | Yes | No | **NOT NULL** | Maps machine credentials to a user. |
| `push_subscriptions` | Yes | No | **NOT NULL** | Subscription belongs to a user. |
| `alert_state` | Yes | No | **NOT NULL** | Alert scoped to a user. |

### Isolation rules

1. **All queries must filter by `user_id`** -- the API layer injects the authenticated user's ID into every query.
2. **Readings and devices allow NULL `user_id`** -- this supports a flow where an IoT device pushes data before a user claims it. Once the user claims the device, the system sets `user_id`.
3. **Service tokens resolve machine auth to `user_id`** -- when a request arrives with a `CF-Access-Client-Id` header, the `service_tokens` table maps it to a user, and the API scopes all later data access to that user.
4. **No cross-user foreign keys** -- while the schema does not enforce that a reading's `user_id` matches its batch's `user_id`, the application layer maintains this invariant.

### Tenant-scoping indexes

These indexes are specifically designed to support filtered queries:

- `idx_batches_user` -- `WHERE user_id = ?`
- `idx_activities_user` -- `WHERE user_id = ?`
- `idx_readings_user` -- `WHERE user_id = ? ORDER BY source_timestamp DESC`
- `idx_devices_user` -- `WHERE user_id = ?`

---

## Migration history

### 0001_initial.sql -- initial schema

**What it created:**
- `batches` -- core wine batch tracking table with wine type, source material, stage, status, volume fields.
- `activities` -- activity log entries linked to batches with stage, type, title, details.
- `readings` -- IoT hydrometer data (gravity, temperature, battery, RSSI) linked to batches by device.
- `devices` -- IoT device registry with optional batch assignment.

**Key design decisions:**
- All IDs are TEXT (UUIDs generated by the application).
- All timestamps are TEXT (ISO 8601) -- D1/SQLite has no native datetime type.
- Readings deduplicated by `(device_id, source_timestamp, batch_id)` unique index.
- Readings support cursor-based pagination via composite index on `(batch_id, source_timestamp DESC, id DESC)`.
- Activities indexed by `(batch_id, recorded_at)` for chronological listing.
- Device-to-batch is a nullable FK with ON DELETE SET NULL (unassign on batch delete).

### 0002_readings_source.sql -- manual readings support

**What it added:**
- `readings.source` column (TEXT NOT NULL DEFAULT `'device'`).

**Why:**
- Needed to distinguish between automated device readings and manually entered readings.
- Manual readings have NULL for `temperature`, `battery`, and `rssi` since those are device-specific telemetry.

### 0003_activity_reading_link.sql -- activity-reading link

**What it added:**
- `activities.reading_id` column (TEXT, nullable FK to `readings(id)` ON DELETE SET NULL).

**Why:**
- When a user creates a `measurement`-type activity, the system auto-generates a corresponding reading row.
- This FK provides a reliable way to find/update/delete the linked reading when a user modifies the activity.
- ON DELETE SET NULL ensures that if a reading is independently deleted, the activity survives.

### 0004_multi_tenant.sql -- multitenancy

**What it created or changed:**
- Created `users` table with `id`, `email` (unique), `name`, `created_at`.
- Seeded the initial owner user (`rdrake@pobox.com`).
- Added `user_id` to `devices` and `readings` (via ALTER TABLE, nullable).
- Rebuilt `activities` table twice (once to add `user_id`, once to re-add the FK to the rebuilt `batches` table).
- Rebuilt `batches` table to add `user_id` NOT NULL.
- Backfilled all existing data with the seed user's ID.
- Added tenant-scoping indexes on all data tables.

**Why:**
- Transitioned from single-tenant to multitenant to support many users.
- SQLite's limited ALTER TABLE support required table rebuilds for adding NOT NULL FK columns.
- The careful rebuild order (children first, then parent) with `PRAGMA defer_foreign_keys = ON` prevented constraint violations during migration.

### 0005_service_tokens.sql -- service token auth

**What it created:**
- `service_tokens` table mapping Cloudflare Access service token client IDs to user IDs.

**Why:**
- IoT devices authenticate via Cloudflare Access service tokens (not user sessions).
- This table maps the `CF-Access-Client-Id` header to a `user_id` so the API scopes device-pushed readings to the correct tenant.

### 0006_alerts_and_stages.sql -- alerts and target gravity

**What it created or changed:**
- Added `batches.target_gravity` (REAL, nullable) for fermentation-target alerting.
- Created `push_subscriptions` table for Web Push API subscription storage.
- Created `alert_state` table for tracking fired alerts with close or resolve lifecycle.
- Added partial unique index `idx_alert_one_active` to prevent duplicate active alerts.

**Why:**
- Enabled proactive monitoring: the system can detect stalls, missing readings, temperature anomalies, and suggest stage changes.
- `target_gravity` lets the system know when to expect fermentation to finish for stage-suggestion alerts.
- Push subscriptions support browser notifications via RFC 8291 Web Push encryption.
- The alert-state table with its partial unique index implements an "at most one active alert per type" pattern, preventing notification spam.
