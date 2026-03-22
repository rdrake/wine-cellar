# Domain model reference

> Definitive reference for how the code models the winemaking domain.
>
> Source of truth files:
> - `api/src/schema.ts`: enums, stages, waypoints
> - `api/src/models.ts`: Zod validation schemas
> - `dashboard/src/types.ts`: TypeScript interfaces and display labels
> - `api/src/routes/batches.ts`: lifecycle state machine
> - `api/src/routes/activities.ts`: activity creation with stage validation
> - `api/src/routes/devices.ts`: device assignment
> - `api/src/routes/webhook.ts`: RAPT Hydrometer webhook ingestion
> - `api/src/lib/alerts.ts`: alert evaluation engine (reading-based)
> - `api/src/lib/winemaking/alerts.ts`: timeline-based alert evaluation
> - `api/src/lib/winemaking/timeline.ts`: current phase and milestone projections
> - `api/migrations/`: database schema (D1/SQLite)

---

## 1. Entities

### User

Represents a person who owns batches, devices, and data. Added in migration `0004_multi_tenant`. All data-bearing tables carry a `user_id` foreign key for tenant isolation.

| Column       | Type    | Notes                          |
|-------------|---------|--------------------------------|
| `id`        | TEXT PK | UUID                           |
| `email`     | TEXT    | UNIQUE, NOT NULL               |
| `name`      | TEXT    | Nullable display name          |
| `avatar_url`| TEXT    | Nullable profile image URL     |
| `onboarded` | INTEGER | Boolean (0/1), NOT NULL, default 0. Set to 1 after the user completes initial setup. |
| `created_at`| TEXT    | ISO 8601 timestamp             |

Users authenticate through passkeys (WebAuthn) or OAuth providers. New users start with `onboarded = 0` and the system sets the flag to 1 after initial setup.

### Batch

The central entity. A **batch** is a single vessel of wine progressing from must preparation through bottling. Every batch belongs to one user.

| Column                | Type   | Notes                                                |
|-----------------------|--------|------------------------------------------------------|
| `id`                  | TEXT PK | UUID                                                |
| `user_id`             | TEXT   | FK to `users`, NOT NULL                              |
| `name`                | TEXT   | Human-readable name, NOT NULL, min 1 char            |
| `wine_type`           | TEXT   | One of the `WineType` enum values                    |
| `source_material`     | TEXT   | One of the `SourceMaterial` enum values               |
| `stage`               | TEXT   | Current waypoint; one of `BatchStage` values          |
| `status`              | TEXT   | Lifecycle status; one of `BatchStatus` values         |
| `volume_liters`       | REAL   | Current volume in liters, nullable                   |
| `target_volume_liters`| REAL   | Target final volume, nullable                        |
| `target_gravity`      | REAL   | Target final specific gravity, nullable              |
| `started_at`          | TEXT   | When the batch physically started (user-provided)    |
| `completed_at`        | TEXT   | Set when status transitions to `completed`, cleared on reopen |
| `yeast_strain`        | TEXT   | Yeast strain used, nullable                          |
| `oak_type`            | TEXT   | One of `OakType` values (`none`, `american`, `french`, `hungarian`), nullable |
| `oak_format`          | TEXT   | One of `OakFormat` values (`barrel`, `chips`, `cubes`, `staves`, `spiral`), nullable |
| `oak_duration_days`   | INTEGER| Duration of oak contact in days, nullable            |
| `mlf_status`          | TEXT   | One of `MlfStatus` values (`not_planned`, `pending`, `in_progress`, `complete`), nullable |
| `bottled_at`          | TEXT   | Bottling date (ISO 8601), nullable                   |
| `notes`               | TEXT   | Free-form notes, nullable                            |
| `created_at`          | TEXT   | Record creation timestamp                            |
| `updated_at`          | TEXT   | Last modification timestamp                          |

**Defaults on creation:** `stage = 'must_prep'`, `status = 'active'`.

### Activity

A log entry recording something that happened to a batch. Activities are the winemaker's journal: additions, rackings, measurements, tastings, notes, and adjustments.

| Column        | Type   | Notes                                               |
|--------------|--------|-----------------------------------------------------|
| `id`         | TEXT PK | UUID                                               |
| `user_id`    | TEXT   | FK to `users`, NOT NULL                             |
| `batch_id`   | TEXT   | FK to `batches`, NOT NULL, CASCADE on delete         |
| `stage`      | TEXT   | The fine-grained `AllStage` when this occurred       |
| `type`       | TEXT   | One of the `ActivityType` enum values                |
| `title`      | TEXT   | Short human-readable summary, NOT NULL, min 1 char   |
| `details`    | TEXT   | JSON object stored as TEXT, nullable                 |
| `reading_id` | TEXT   | FK to `readings`, nullable. Links SG measurements to their auto-created reading |
| `recorded_at`| TEXT   | When the activity happened (user-provided timestamp) |
| `created_at` | TEXT   | Record creation timestamp                            |
| `updated_at` | TEXT   | Last modification timestamp                          |

**The API only allows activity creation on active batches.** The `stage` field on the activity must be one of the stages allowed by the batch's current waypoint (see WAYPOINT_ALLOWED_STAGES in the following section).

**SG Measurement auto-linking:** When the API creates an activity of `type: "measurement"` with `details.metric === "SG"` and a numeric `details.value`, the system automatically inserts a manual reading into the `readings` table and links it by using `reading_id`. Updates to the activity sync back to the linked reading. Deleting the activity deletes the linked reading.

### Reading

A gravity or temperature data point, either from a physical device or entered manually.

| Column             | Type   | Notes                                              |
|-------------------|--------|----------------------------------------------------|
| `id`              | TEXT PK | UUID                                              |
| `batch_id`        | TEXT   | FK to `batches`, nullable (unassigned device readings) |
| `device_id`       | TEXT   | Device identifier string; `'manual'` for manual entries |
| `user_id`         | TEXT   | FK to `users`, nullable (unclaimed device readings) |
| `gravity`         | REAL   | Specific gravity, NOT NULL                         |
| `temperature`     | REAL   | Temperature in Celsius, nullable                   |
| `battery`         | REAL   | Battery percentage, nullable                       |
| `rssi`            | REAL   | Wi-Fi signal strength, nullable                    |
| `source_timestamp`| TEXT   | When the reading was taken (device clock or user-provided) |
| `source`          | TEXT   | `'device'` or `'manual'`; defaults to `'device'`   |
| `created_at`      | TEXT   | Record creation timestamp                          |

**Deduplication:** A UNIQUE index on `(device_id, source_timestamp, COALESCE(batch_id, ''))` prevents duplicate readings from the same device at the same time.

**Manual readings** have `device_id = 'manual'`, `source = 'manual'`, and null `temperature`, `battery`, `rssi` fields.

### Device

A physical monitoring device. Currently the only supported hardware is the **RAPT Hydrometer** (a floating pill that transmits gravity, temperature, battery, and RSSI by using a webhook).

| Column        | Type   | Notes                                              |
|--------------|--------|----------------------------------------------------|
| `id`         | TEXT PK | Device identifier (from the hardware)              |
| `name`       | TEXT   | Display name, NOT NULL                             |
| `user_id`    | TEXT   | FK to `users`, nullable (unclaimed devices)         |
| `batch_id`   | TEXT   | FK to `batches`, nullable (unassigned devices)      |
| `assigned_at`| TEXT   | When the device was assigned to its current batch   |
| `created_at` | TEXT   | Record creation timestamp                          |
| `updated_at` | TEXT   | Last modification timestamp                        |

**Key constraint:** The system assigns a device to at most one batch at a time. A batch might switch devices mid-batch but never has two devices simultaneously.

### Alert (alert_state)

A derived entity representing a monitoring condition that the alert engine detected on a batch.

| Column         | Type   | Notes                                              |
|---------------|--------|----------------------------------------------------|
| `id`          | TEXT PK | UUID                                              |
| `user_id`     | TEXT   | FK to `users`, NOT NULL                            |
| `batch_id`    | TEXT   | FK to `batches`, NOT NULL                          |
| `alert_type`  | TEXT   | One of the `AlertType` values (see section 8) |
| `context`     | TEXT   | JSON context data, nullable                        |
| `fired_at`    | TEXT   | When the alert was created                         |
| `dismissed_at`| TEXT   | When the user dismissed it, nullable               |
| `resolved_at` | TEXT   | When the condition cleared automatically, nullable  |

**Lifecycle:** An alert is **active** when both `dismissed_at` and `resolved_at` are NULL. A partial UNIQUE index on `(user_id, batch_id, alert_type) WHERE resolved_at IS NULL AND dismissed_at IS NULL` ensures only one active alert of each type per batch. The user can close alerts, or the system auto-resolves them when the condition clears.

### Passkey credential

A WebAuthn passkey registered to a user for passwordless authentication. Added in migration `0008_passkey_auth`, with a `name` column added in `0011_passkey_name`.

| Column           | Type    | Notes                                              |
|-----------------|---------|----------------------------------------------------|
| `id`            | TEXT PK | Credential ID from the WebAuthn ceremony           |
| `user_id`       | TEXT    | FK to `users`, NOT NULL                            |
| `public_key`    | BLOB    | COSE public key, NOT NULL                          |
| `webauthn_user_id`| TEXT  | WebAuthn user handle, NOT NULL                     |
| `sign_count`    | INTEGER | Signature counter for cloning detection, default 0 |
| `transports`    | TEXT    | JSON array of transport hints (e.g., `["internal","hybrid"]`), nullable |
| `device_type`   | TEXT    | `singleDevice` or `multiDevice`, nullable          |
| `backed_up`     | INTEGER | Boolean (0/1), default 0                           |
| `name`          | TEXT    | User-provided label for the passkey, nullable      |
| `created_at`    | TEXT    | Record creation timestamp                          |
| `last_used_at`  | TEXT    | Updated on each successful authentication, nullable |

### Auth challenge

A single-use, short-lived challenge for WebAuthn and OAuth ceremonies. Challenges expire after five minutes. Added in migration `0008_passkey_auth`, rebuilt in `0009_oauth_auth`.

| Column       | Type   | Notes                                              |
|-------------|--------|----------------------------------------------------|
| `id`        | TEXT PK | UUID                                              |
| `challenge` | TEXT   | Random challenge string, NOT NULL                  |
| `type`      | TEXT   | One of `oauth`, `login`, `register`                |
| `user_id`   | TEXT   | FK to `users`, nullable (login/register might not yet have a user) |
| `expires_at`| TEXT   | ISO 8601 expiry timestamp, NOT NULL                |
| `created_at`| TEXT   | Record creation timestamp                          |

### Auth session

A bearer-token session created after a successful passkey or OAuth login. The `id` column stores a SHA-256 hash of the full token. Added in migration `0008_passkey_auth`.

| Column       | Type   | Notes                                              |
|-------------|--------|----------------------------------------------------|
| `id`        | TEXT PK | SHA-256 hash of the session token                 |
| `user_id`   | TEXT   | FK to `users`, NOT NULL                            |
| `expires_at`| TEXT   | ISO 8601 expiry timestamp, NOT NULL                |
| `created_at`| TEXT   | Record creation timestamp                          |

### OAuth account

Links an external OAuth provider identity to a local user. Added in migration `0009_oauth_auth`.

| Column             | Type   | Notes                                              |
|-------------------|--------|----------------------------------------------------|
| `provider`        | TEXT   | Provider name (e.g., `google`), part of composite PK |
| `provider_user_id`| TEXT   | User ID from the provider, part of composite PK    |
| `user_id`         | TEXT   | FK to `users`, NOT NULL                            |
| `email`           | TEXT   | Email from the provider, nullable                  |
| `name`            | TEXT   | Display name from the provider, nullable           |
| `avatar_url`      | TEXT   | Profile image URL from the provider, nullable      |
| `created_at`      | TEXT   | Record creation timestamp                          |

### Settings

A key-value store for application-wide configuration. Added in migration `0009_oauth_auth`.

| Column       | Type   | Notes                                              |
|-------------|--------|----------------------------------------------------|
| `key`       | TEXT PK | Setting name                                      |
| `value`     | TEXT   | Setting value, NOT NULL                            |
| `updated_at`| TEXT   | Last modification timestamp                        |

Current settings: `registrations_open` (default `'true'`).

### API key

A hashed API key for programmatic access (MCP servers, automation). The API displays the full key once at creation time; it stores only the SHA-256 hash. Added in migration `0010_api_keys`.

| Column        | Type   | Notes                                              |
|--------------|--------|----------------------------------------------------|
| `id`         | TEXT PK | SHA-256 hash of the full key                      |
| `user_id`    | TEXT   | FK to `users`, NOT NULL                            |
| `name`       | TEXT   | User-provided label, NOT NULL                      |
| `prefix`     | TEXT   | First 8 characters for display (e.g., `wc-a1b2c`), NOT NULL |
| `created_at` | TEXT   | Record creation timestamp                          |
| `last_used_at`| TEXT  | Updated on each use, nullable                      |

---

## 2. Batch lifecycle (status state machine)

A batch's `status` field controls which operations the API permits. New batches start as `active`.

### Status values

| Status      | Meaning                                                   |
|------------|-----------------------------------------------------------|
| `active`   | Batch is in progress. Stage changes, activities, device assignment, and readings are allowed. |
| `completed`| Batch has finished successfully. `completed_at` timestamp is set. Devices are unassigned. |
| `abandoned`| Batch was discarded/failed. Devices are unassigned.        |
| `archived` | Completed batch moved to long-term storage. Hidden from default list queries. |

### State machine diagram

```
                    +-----------+
            +------>| completed |<------+
            |       +-----------+       |
            |         |       ^         |
            |  archive|       |unarchive|
            |         v       |         |
            |       +-----------+       |
   complete |       | archived  |       | reopen (PATCH status=active)
            |       +-----------+       |
            |                           |
          +-----------+                 |
  (new)-->|  active   |-----------------+
          +-----------+
            |       ^
            |       | reopen (PATCH status=active)
   abandon  |       |
            v       |
          +-----------+
          | abandoned |
          +-----------+
```

### Allowed transitions

| From        | To          | How                                        | Side Effects                                |
|------------|-------------|--------------------------------------------|---------------------------------------------|
| `active`   | `completed` | `POST /:batchId/complete` or `PATCH status` | Sets `completed_at`, unassigns all devices  |
| `active`   | `abandoned` | `POST /:batchId/abandon` or `PATCH status`  | Unassigns all devices                       |
| `completed`| `archived`  | `POST /:batchId/archive` or `PATCH status`  | None                                        |
| `completed`| `active`    | `PATCH status=active`                       | Clears `completed_at`                       |
| `archived` | `completed` | `POST /:batchId/unarchive` or `PATCH status`| None                                        |
| `abandoned`| `active`    | `PATCH status=active`                       | Clears `completed_at`                       |

**Invalid transitions** (e.g., `active` -> `archived`, `abandoned` -> `completed`) return `409 Conflict`.

### Deletion rules

- The API always allows deleting **abandoned batches**.
- The API only allows deleting **non-abandoned batches** if they have zero activities AND zero readings. Otherwise the API returns `409 Conflict` with the message "Batch has activities or readings. Abandon first."

### Operations restricted to active batches

- Stage changes (`POST /:batchId/stage`, `POST /:batchId/advance`)
- Activity creation
- Device assignment

---

## 3. Stage System

Stages model where a batch is in the winemaking process. The system uses a **two-tier model**: coarse-grained **waypoint stages** that the batch tracks, and fine-grained **activity stages** used to categorize individual log entries.

### Waypoint stages (BATCH_STAGES)

The 5 major phases a batch moves through, in order:

| Index | Waypoint                    | Display Label              | Winemaking Meaning                          |
|------:|----------------------------|----------------------------|---------------------------------------------|
| 0     | `must_prep`                | Must Preparation           | Preparing the must: receiving fruit, crushing, adding nutrients/enzymes |
| 1     | `primary_fermentation`     | Primary Fermentation       | Vigorous fermentation with yeast, CO2 production |
| 2     | `secondary_fermentation`   | Secondary Fermentation     | Slower fermentation, clarification begins    |
| 3     | `stabilization`            | Stabilization and Degassing | Post-fermentation processing: fining, aging, cold stabilization |
| 4     | `bottling`                 | Bottling                   | Final packaging and bottle conditioning      |

A batch's `stage` field is always one of these 5 values. It defaults to `must_prep` on creation.

### Activity stages (ALL_STAGES)

The 14 fine-grained stages used on individual activity log entries:

| Activity Stage         | Display Label               |
|-----------------------|-----------------------------|
| `receiving`           | Receiving and Inspection     |
| `crushing`            | Crushing and Destemming      |
| `must_prep`           | Must Preparation             |
| `primary_fermentation`| Primary Fermentation         |
| `pressing`            | Pressing                     |
| `secondary_fermentation`| Secondary Fermentation     |
| `malolactic`          | Malolactic Fermentation      |
| `stabilization`       | Stabilization and Degassing  |
| `fining`              | Fining and Clarification     |
| `bulk_aging`          | Bulk Aging                   |
| `cold_stabilization`  | Cold Stabilization           |
| `filtering`           | Filtering                    |
| `bottling`            | Bottling                     |
| `bottle_aging`        | Bottle Aging                 |

### WAYPOINT_ALLOWED_STAGES mapping

Each waypoint defines the activity stages that are valid when a batch is at that waypoint. The API validates an activity's `stage` against this mapping at creation time. If the activity stage is not in the allowed set for the batch's current waypoint, the API returns `409 Conflict`.

```
WAYPOINT                    ALLOWED ACTIVITY STAGES
-------                     -----------------------

must_prep                   receiving
                            crushing
                            must_prep

primary_fermentation        primary_fermentation
                            pressing

secondary_fermentation      secondary_fermentation
                            malolactic

stabilization               stabilization
                            fining
                            bulk_aging
                            cold_stabilization
                            filtering

bottling                    bottling
                            bottle_aging
```

### Visual: two-tier stage system

```
Waypoint (batch.stage)     Activity stages (activity.stage)
=====================      ================================

must_prep ................. receiving
                            crushing
                            must_prep
                                |
primary_fermentation ...... primary_fermentation
                            pressing
                                |
secondary_fermentation .... secondary_fermentation
                            malolactic
                                |
stabilization ............. stabilization
                            fining
                            bulk_aging
                            cold_stabilization
                            filtering
                                |
bottling .................. bottling
                            bottle_aging
```

### Stage advancement

Two mechanisms exist for changing a batch's waypoint stage:

**1. Advance (`POST /:batchId/advance`)**
- Moves the batch forward by one position in the `WAYPOINT_ORDER` array.
- Only works on active batches.
- Fails with `409 Conflict` if the batch is already at the final stage (`bottling`).
- Automatically logs a `note` activity recording the change (e.g., "Stage changed from must_prep to primary_fermentation").

**2. Set Stage (`POST /:batchId/stage`)**
- Jumps the batch to any waypoint, forward or backward.
- Only works on active batches.
- Accepts any valid `BatchStage` value (validated by Zod).
- No-operations silently if the target stage equals the current stage (the API logs no activity).
- When the stage actually changes, logs a `note` activity recording the change.

Both mechanisms use `WAYPOINT_ORDER`, which is the same as `BATCH_STAGES`, for ordering.

---

## 4. Wine types and source materials

### Wine types (`WineType`)

| Value       | Label     | Description                                        |
|------------|-----------|---------------------------------------------------|
| `red`      | Red       | Red wine made from dark-skinned grapes             |
| `white`    | White     | White wine, typically from light-skinned grapes      |
| `rosé`     | Rosé      | Pink wine from limited skin contact                |
| `orange`   | Orange    | White grapes fermented with extended skin contact   |
| `sparkling`| Sparkling | Carbonated wine (methode traditionnelle, and so on) |
| `dessert`  | Dessert   | Sweet wine (ice wine, late harvest, port-style)     |

### Source materials (`SourceMaterial`)

What the winemaker started from:

| Value          | Label        | Description                                        |
|---------------|-------------|---------------------------------------------------|
| `kit`         | Kit          | Commercial wine kit with pre-processed juice/concentrate and instructions |
| `juice_bucket`| Juice Bucket | Pre-crushed and pressed juice, purchased ready to ferment |
| `fresh_grapes`| Fresh Grapes | Raw grapes that need crushing, pressing, and full processing |

These values are set at batch creation and are immutable afterward (not included in `BatchUpdateSchema`).

---

## 5. Activities

### Activity types (`ActivityType`)

| Type          | Label       | Typical Usage                                      |
|--------------|-------------|---------------------------------------------------|
| `addition`   | Addition    | Adding a substance: yeast, nutrients, sulfites, finings, sugar, and so on |
| `racking`    | Racking     | Transferring wine off sediment to a new vessel      |
| `measurement`| Measurement | Recording a measured value (SG, pH, TA, SO2, and so on) |
| `tasting`    | Tasting     | Tasting notes and sensory evaluation                |
| `note`       | Note        | General-purpose log entry; also auto-created for stage changes |
| `adjustment` | Change      | Corrective action: acid change, sweetening, blending |

### The `details` JSON structure

The `details` field is a schemaless JSON object (`Record<string, unknown> | null`). Its contents depend on the activity type. The system enforces structure only for **SG measurements**:

**SG Measurement detection** (`isSgMeasurement` in `activities.ts`):
- `type` must be `"measurement"`
- `details.metric` must be `"SG"`
- `details.value` must be a `number`

When the activity meets these conditions, the API auto-creates a manual reading. Example `details` payload:

```json
{
  "metric": "SG",
  "value": 1.045
}
```

All other `details` shapes are application-convention only and not validated by the API.

### Stage validation

When creating an activity, the `stage` field must be one of the activity stages allowed by the batch's current waypoint (per `WAYPOINT_ALLOWED_STAGES`). Example: if the batch is at waypoint `stabilization`, the activity can use stages `stabilization`, `fining`, `bulk_aging`, `cold_stabilization`, or `filtering` -- but NOT `bottling` or `primary_fermentation`.

This validation only applies at creation time. Activities are not retroactively invalidated if the batch's waypoint changes.

### Autogenerated activities

Stage changes (through `/advance` or `/stage`) automatically insert a `note` activity with:
- `stage` = the new waypoint stage
- `type` = `'note'`
- `title` = `"Stage changed from {old} to {new}"`
- `details` = NULL

---

## 6. Readings

### Sources

Readings come from two sources:

| Source    | `device_id`  | `source` | Origin                                   |
|----------|-------------|----------|------------------------------------------|
| Device   | Hardware ID  | `device` | Webhook from RAPT Hydrometer             |
| Manual   | `'manual'`   | `manual` | Auto-created when an SG measurement activity is logged |

### Fields by source

| Field              | Device readings  | Manual readings |
|-------------------|-----------------|-----------------|
| `gravity`         | From device      | From `details.value` |
| `temperature`     | From device      | NULL            |
| `battery`         | From device      | NULL            |
| `rssi`            | From device      | NULL            |
| `source_timestamp`| Device clock     | Activity's `recorded_at` |
| `batch_id`        | From device's current assignment | From the activity's batch |

### Linking to batches

The webhook handler links device readings to a batch based on the device's `batch_id` at the time the webhook fires. If no batch is assigned to the device, `batch_id` is NULL and the reading is "orphaned" until the user assigns the device (see backfill in the following section).

Manual readings are always linked to a batch (they originate from an activity on that batch).

### Pagination

The API paginates readings using cursor-based pagination (keyset pagination on `(source_timestamp DESC, id DESC)`). Default page size is 100, up to 500. Supports `start_time` and `end_time` filters.

---

## 7. Devices (RAPT hydrometer)

### Registration

Devices can enter the system in two ways:

1. **Manual registration** (`POST /api/v1/devices`): User provides an `id` and `name`. The device is immediately owned by the user.
2. **Auto-registration through webhook**: When a webhook arrives for an unknown `device_id`, the webhook handler creates the device with `user_id = NULL` (unclaimed). The user must later claim it by using `POST /api/v1/devices/claim`.

### Claiming

`POST /api/v1/devices/claim` with `{ device_id }` sets the device's `user_id` to the authenticated user. Only works if the device is currently unclaimed. Also backfills `user_id` on any existing readings from that device.

### Assignment to batches

`POST /api/v1/devices/:deviceId/assign` with `{ batch_id }`:
- The device must belong to the user.
- The target batch must be active.
- Sets `device.batch_id` and `device.assigned_at`.
- **Backfill:** Updates all existing readings from this device where `batch_id IS NULL AND source_timestamp >= batch.started_at` to link them to the batch. This handles the case where the device was sending data before being formally assigned.

`POST /api/v1/devices/:deviceId/unassign`:
- Clears `batch_id` and `assigned_at`.
- Does NOT un-link already-assigned readings.

### Automatic unassignment

The API automatically unassigns devices from a batch when:
- The user **completes** the batch (through `/complete` or PATCH)
- The user **abandons** the batch (through `/abandon` or PATCH)

The `unassignDevices` helper sets `batch_id = NULL` and `assigned_at = NULL` on all devices assigned to the batch.

### Webhook processing (`POST /api/v1/webhook/rapt`)

1. Authenticates by using the `X-Webhook-Token` header (timing-safe comparison).
2. Strips null bytes from the raw body (RAPT firmware quirk).
3. Validates against `RaptWebhookSchema`.
4. Auto-registers unknown devices (unclaimed).
5. Inserts reading with the device's current `batch_id` and `user_id`.
6. Deduplicates by using a UNIQUE index (returns `{ status: "duplicate" }` on collision).
7. If the device belongs to an active batch, evaluates alerts and sends push notifications for any newly fired alerts.

### Webhook payload schema (`RaptWebhookSchema`)

| Field          | Type   | Description                          |
|---------------|--------|--------------------------------------|
| `device_id`   | string | Hardware identifier                  |
| `device_name` | string | Device display name                  |
| `temperature` | number | Temperature in Celsius               |
| `gravity`     | number | Specific gravity                     |
| `battery`     | number | Battery percentage                   |
| `rssi`        | number | Wi-Fi signal strength (dBm)          |
| `created_date`| string | Timestamp from the device            |

---

## 8. Alerts

The alert engine derives alerts from reading data and evaluates them on every incoming device webhook for batches with assigned devices.

### Alert types

Alerts fall into two categories: **reading-based** (evaluated on every incoming device webhook) and **timeline-based** (evaluated by the cron job by using projected milestones).

#### Reading-based alerts

| Type               | Trigger condition                                            | Resolves when                |
|-------------------|-------------------------------------------------------------|------------------------------|
| `temp_high`       | Latest temperature >= 30 C                                   | Temperature drops below 30 C |
| `temp_low`        | Latest temperature <= 8 C                                    | Temperature rises above 8 C  |
| `no_readings`     | Device assigned but latest reading is > 48 hours old          | A new reading arrives         |
| `stall`           | Gravity > 1.005, 48h velocity < 0.0005 SG/day OR < 20% of 7-day velocity (requires >= 10 readings) | Fermentation resumes         |
| `stage_suggestion`| During `primary_fermentation`: gravity < 1.020 and 48h velocity < 50% of 7-day velocity. During `secondary_fermentation`: 72h gravity range < 0.001 and (gravity < 1.000 or within 0.002 of target). | Condition no longer met       |

#### Timeline-based alerts

The cron job derives these alerts from projected milestones (see section 12) and batch activity history, evaluating them every 15 minutes.

| Type               | Trigger condition                                            | Resolves when                |
|-------------------|-------------------------------------------------------------|------------------------------|
| `racking_due_1`   | First projected racking date has passed and the user has not yet logged a racking | User logs a racking          |
| `racking_due_2`   | Second projected racking date has passed and fewer than 2 rackings logged | User logs a racking          |
| `racking_due_3`   | Third projected racking date has passed and fewer than 3 rackings logged | User logs a racking          |
| `so2_due`         | Last SO2 addition >= 42 days ago, OR a racking occurred in the last 3 days without a follow-up SO2 addition | User logs an SO2 addition    |
| `mlf_check`       | MLF status is `in_progress` and >= 28 days have passed since MLF inoculation | Condition no longer met      |
| `bottling_ready`   | Estimated bottling date has passed and at least 3 rackings exist | Condition no longer met      |

### Alert lifecycle

```
  [condition detected]
          |
          v
      +--------+     user dismisses     +-----------+
      | active |----------------------->| dismissed  |
      +--------+                        +-----------+
          |                                   |
          | condition clears                  | condition clears
          v                                   v
      +----------+                       +----------+
      | resolved |                       | resolved |
      +----------+                       +----------+
```

- **Active:** `dismissed_at IS NULL AND resolved_at IS NULL`. Shown to the user on the dashboard.
- **Dismissed:** `dismissed_at IS NOT NULL AND resolved_at IS NULL`. Hidden from view but still tracked. Will NOT re-fire until the condition resolves first.
- **Resolved:** `resolved_at IS NOT NULL`. Terminal state. A new alert of the same type can now fire.

The system sends push notifications (through Web Push and VAPID) only when an alert first fires, not on later webhook evaluations while it remains active.

---

## 9. Validation rules (Zod schemas)

### `BatchCreateSchema`

| Field                  | Validation                              |
|-----------------------|----------------------------------------|
| `name`               | `string`, min length 1                  |
| `wine_type`          | Enum: `red`, `white`, `rosé`, `orange`, `sparkling`, `dessert` |
| `source_material`    | Enum: `kit`, `juice_bucket`, `fresh_grapes` |
| `started_at`         | `string` (ISO 8601 timestamp)           |
| `volume_liters`      | `number`, nullable, optional            |
| `target_volume_liters`| `number`, nullable, optional           |
| `target_gravity`     | `number`, nullable, optional            |
| `notes`              | `string`, nullable, optional            |

### `BatchUpdateSchema`

| Field                  | Validation                              |
|-----------------------|----------------------------------------|
| `name`               | `string`, min length 1, optional        |
| `notes`              | `string`, nullable, optional            |
| `volume_liters`      | `number`, nullable, optional            |
| `target_volume_liters`| `number`, nullable, optional           |
| `target_gravity`     | `number`, nullable, optional            |
| `status`             | Enum of `BatchStatus`, optional (change validated separately) |

Note: `wine_type`, `source_material`, `stage`, and `started_at` are NOT updatable by using PATCH. Stage changes go through dedicated endpoints.

### `ActivityCreateSchema`

| Field         | Validation                              |
|--------------|----------------------------------------|
| `stage`      | Enum of all 14 `AllStage` values        |
| `type`       | Enum of `ActivityType`                  |
| `title`      | `string`, min length 1                  |
| `details`    | `record(unknown)`, nullable, defaults to null |
| `recorded_at`| `string` (ISO 8601 timestamp)           |

### `ActivityUpdateSchema`

| Field         | Validation                              |
|--------------|----------------------------------------|
| `title`      | `string`, min length 1, optional        |
| `details`    | `record(unknown)`, nullable, optional   |
| `recorded_at`| `string`, optional                      |

Note: `stage` and `type` are NOT updatable after creation.

### `StageSetSchema`

| Field   | Validation                                |
|--------|------------------------------------------|
| `stage` | Enum of 5 `BatchStage` (waypoint) values |

### DeviceCreateSchema

| Field  | Validation             |
|-------|------------------------|
| `id`  | `string`, min length 1 |
| `name`| `string`, min length 1 |

### DeviceAssignSchema

| Field      | Validation             |
|-----------|------------------------|
| `batch_id`| `string`, min length 1 |

### `RaptWebhookSchema`

| Field          | Validation |
|---------------|------------|
| `device_id`   | `string`   |
| `device_name` | `string`   |
| `temperature` | `number`   |
| `gravity`     | `number`   |
| `battery`     | `number`   |
| `rssi`        | `number`   |
| `created_date`| `string`   |

---

## 10. Entity relationship diagram

```
+----------+       +----------+       +------------+
|  users   |<------| batches  |<------| activities |
|          |  1:N  |          |  1:N  |            |
+----------+       +----------+       +-----+------+
  ^  ^  ^               ^  ^                |
  |  |  |               |  |          reading_id (0..1)
  |  |  |          1:N  |  | 0..1          |
  |  |  |     +---------+  +------+   +----v-----+
  |  |  |     | readings |        |   | readings |
  |  |  |     +----------+        |   +----------+
  |  |  |          ^              |
  |  |  |          | N:1          |
  |  |  |     +----+-----+       |
  |  |  +-----| devices  |-------+
  |  |   1:N  +----------+  assigned (0..1)
  |  |
  |  +--------+---------------------+
  |           | push_subscriptions  |
  |           +---------------------+
  |           | alert_state         |
  |           +---------------------+
  |           | oauth_accounts      |
  |           +---------------------+
  |
  +--------+---------------------+
           | passkey_credentials |
           +---------------------+
           | auth_sessions       |
           +---------------------+
           | api_keys            |
           +---------------------+

+-----------------+     +---------------------+
| auth_challenges |     | settings            |
| (standalone)    |     | (standalone k/v)    |
+-----------------+     +---------------------+
```

### Key relationships

- **User -> Batches:** One-to-many. A user owns many batches.
- **User -> Devices:** One-to-many. A user owns many devices (nullable for unclaimed).
- **Batch -> Activities:** One-to-many (CASCADE delete). Deleting a batch deletes its activities.
- **Batch -> Readings:** One-to-many (CASCADE delete). Through `batch_id` on readings.
- **Device -> Readings:** One-to-many. A device produces many readings over time.
- **Device -> Batch:** Many-to-one (at most one batch at a time). `SET NULL` on batch delete.
- **Activity -> Reading:** One-to-one optional link. For SG measurement activities, `reading_id` points to the auto-created manual reading. `SET NULL` on reading delete.
- **User -> Alert State:** One-to-many. Alerts are per-user, per-batch.
- **User -> Push Subscriptions:** One-to-many. Web Push subscription endpoints.
- **User -> OAuth Accounts:** One-to-many. Links external provider identities to a user.
- **User -> Passkey Credentials:** One-to-many. WebAuthn passkeys for authentication.
- **User -> Auth Sessions:** One-to-many. Active bearer-token sessions.
- **User -> API Keys:** One-to-many. Hashed API keys for programmatic access.
- **Auth Challenges:** Standalone table. Can reference a user but also serves unauthenticated flows.
- **Settings:** Standalone key-value table. No foreign keys.

---

## 11. Dashboard computed fields

The dashboard endpoint (`GET /api/v1/dashboard`) returns `BatchSummary` objects that extend `Batch` with computed fields:

| Field             | Type               | Computation                                           |
|------------------|--------------------|-------------------------------------------------------|
| `first_reading`  | `{gravity, temperature, source_timestamp} | null` | First reading chronologically for this batch |
| `latest_reading` | `{gravity, temperature, source_timestamp} | null` | Most recent reading for this batch           |
| `velocity`       | `number | null`    | SG change per day over the last 48 hours              |
| `days_fermenting`| `number`           | Floor of `(now - started_at)` in days                 |
| `sparkline`      | `{g, temp, t}[]`   | Up to 200 readings chronologically for charting       |

The dashboard also returns:
- `recent_activities`: Last 8 activities across all batches (with `batch_name` joined).
- `alerts`: All active (non-dismissed, non-resolved) alerts with `batch_name` joined.

---

## 12. Batch detail computed fields

The batch detail endpoint (`GET /api/v1/batches/:batchId`) returns computed fields alongside the stored batch data. The API does not persist these values in the database; it derives them on every request.

### CurrentPhase

Computed by `computeCurrentPhase()` in `api/src/lib/winemaking/timeline.ts`. Tells the dashboard what stage the batch is in, how long it has been there, and (for primary fermentation) how long the stage typically takes.

```ts
interface CurrentPhase {
  label: string;             // Human-readable stage name (e.g., "Primary Fermentation")
  stage: string;             // The waypoint stage value (e.g., "primary_fermentation")
  daysElapsed: number;       // Days since the batch entered the current stage
  estimatedTotalDays: number | null; // Estimated duration for primary fermentation; null for other stages
}
```

**How `daysElapsed` works:** The API looks up the most recent stage-change activity for the batch to find when the batch entered the current stage. If no stage-change activity exists, it falls back to the batch's `started_at` date.

**How `estimatedTotalDays` works:** Only populated when `stage` is `primary_fermentation`. The estimate uses wine type and source material: kits and reds default to 7 days, whites and everything else default to 14 days.

Returns `null` for completed, abandoned, or archived batches.

### Timeline milestones

Computed by `projectTimeline()` in `api/src/lib/winemaking/timeline.ts`. Returns an array of projected milestones that estimate key upcoming dates for the batch.

```ts
interface Milestone {
  label: string;             // e.g., "End of primary fermentation", "Second racking"
  estimated_date: string;    // ISO date (YYYY-MM-DD)
  basis: string;             // Human explanation of how the date was derived
  confidence: "firm" | "estimated" | "rough";
  completed?: boolean;       // Present and true for milestones already passed
}
```

The function produces up to six milestones:

| Milestone                     | Basis                                                        |
|------------------------------|--------------------------------------------------------------|
| End of primary fermentation  | Extrapolated from current velocity if available, otherwise typical duration for the wine type |
| MLF completion               | ~6 weeks after MLF inoculation (only when MLF is in progress) |
| First racking                | ~2 weeks after primary ends                                   |
| Second racking               | ~75 days after first racking                                  |
| Third racking                | ~90 days after second racking                                 |
| Earliest bottling            | Aging period after final racking (30 days for kits, 90 days for whites/rosé, 180 days for reds) |

Milestones are a pure computation with no database access or side effects. The cron job also uses `projectTimeline()` to derive racking and bottling dates for timeline-based alerts (see section 8).

---

## 13. Filtering and querying

### Batch list filters

`GET /api/v1/batches` supports query parameters:
- `status`: filter by status. If omitted, defaults to excluding `archived` batches.
- `stage`: filter by current waypoint stage.
- `wine_type`: filter by wine type.
- `source_material`: filter by source material.

### Activity list filters

`GET /api/v1/batches/:batchId/activities` supports:
- `type`: filter by activity type.
- `stage`: filter by activity stage.
- `start_time` or `end_time`: filter by `recorded_at` range.

### Reading list filters

Both batch readings and device readings support:
- `start_time` or `end_time`: filter by `source_timestamp` range.
- `limit`: page size (1-500, default 100).
- `cursor`: cursor-based pagination token.
