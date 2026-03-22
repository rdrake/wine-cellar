# RAPT hydrometer integration

Internal documentation covering the complete data flow for RAPT Pill digital hydrometer integration in the wine-cellar system.

---

## 1. Overview

The **RAPT Pill** (by KegLand) is a wireless floating digital hydrometer that sits inside a fermenter. It periodically measures specific gravity and temperature, then transmits readings through Bluetooth to the RAPT Portal cloud service. The user configures the RAPT Portal with a custom webhook that pushes each reading to our API in real time.

Key characteristics:
- Readings arrive every ~15 minutes (configurable in the RAPT Portal).
- Each device has a unique string ID assigned by the RAPT Portal (e.g., `pill-abc-123`).
- The device also reports battery level and Wi-Fi signal strength (RSSI).
- A single device is never assigned to many batches simultaneously. The user might move a device between batches over time, but it only monitors one at a time.

The integration path is entirely push-based: **RAPT Cloud --> webhook --> wine-cellar API**. We never poll the RAPT API.

---

## 2. Webhook endpoint

### URL

```
POST /webhook/rapt
```

The Hono app mounts this route at the top level (not under `/api/v1/`), so this route is **not** behind Cloudflare Access authentication. It uses its own token-based authentication.

**Source:** `api/src/routes/webhook.ts`

### Authentication

The webhook authenticates by using a shared secret in the `X-Webhook-Token` HTTP header:

1. The handler reads `c.req.header("X-Webhook-Token")`.
2. It compares against the `WEBHOOK_TOKEN` environment variable (stored as a Cloudflare Worker secret).
3. Comparison uses a constant-time `timingSafeEqual` to prevent timing attacks (`api/src/lib/crypto.ts`).
4. The handler checks auth **before** body parsing -- an invalid/missing token returns `401 Unauthorized` without reading the request body.

### Payload format

The RAPT Portal sends a JSON body with the following shape, validated by `RaptWebhookSchema` (Zod):

| Field          | Type     | Description                                   |
|----------------|----------|-----------------------------------------------|
| `device_id`    | `string` | Unique identifier for the RAPT Pill           |
| `device_name`  | `string` | Human-readable name set in RAPT Portal        |
| `temperature`  | `number` | Temperature in degrees Celsius                |
| `gravity`      | `number` | Specific gravity (e.g., `1.045`)              |
| `battery`      | `number` | Battery percentage (e.g., `92.3`)             |
| `rssi`         | `number` | Wi-Fi signal strength in dBm (e.g., `-58.0`)  |
| `created_date` | `string` | ISO 8601 timestamp of when reading was taken  |

**Schema definition:** `api/src/models.ts`, lines 66-75.

### Null byte handling

RAPT Portal payloads sometimes contain stray null bytes (`\0`). The handler reads the body as raw text and strips null bytes before JSON parsing:

```ts
const rawText = await c.req.text();
const rawBody = JSON.parse(rawText.replace(/\0/g, "").trim());
```

### Validation failure

If Zod validation fails, the endpoint returns `422 Unprocessable Entity` with the Zod issue array.

### Success response

```json
{ "status": "ok", "reading_id": "<uuid>" }
```

### Duplicate response

```json
{ "status": "duplicate", "message": "Reading already exists" }
```

---

## 3. Device auto-registration

When a webhook arrives for a `device_id` that does not exist in the `devices` table, the handler creates it automatically:

```sql
INSERT INTO devices (id, name, user_id, created_at, updated_at)
VALUES (?, ?, NULL, ?, ?)
```

Key details:
- `id` = `body.device_id` (the RAPT Pill's unique ID)
- `name` = `body.device_name` (from the RAPT Portal)
- `user_id` = `NULL` -- the device is **unclaimed** until a user explicitly claims it
- `batch_id` = not set (defaults to `NULL`) -- the device is unassigned
- `assigned_at` = not set (defaults to `NULL`)

This means devices appear in the system the moment they send their first reading, even before any user has claimed or assigned them. The Settings page tells users: *"Devices appear automatically when your RAPT Pill sends its first reading."*

If the device already exists, the handler reads its current `batch_id` and `user_id` to use when inserting the reading.

---

## 4. Reading ingestion

### Field mapping

| RAPT Payload Field | readings Column    | Notes                                          |
|--------------------|--------------------|-------------------------------------------------|
| (generated)        | `id`               | `crypto.randomUUID()`                          |
| (from device row)  | `batch_id`         | Current `batch_id` from `devices` table, or `NULL` |
| `device_id`        | `device_id`        | Direct mapping                                 |
| `gravity`          | `gravity`          | Direct mapping                                 |
| `temperature`      | `temperature`      | Direct mapping                                 |
| `battery`          | `battery`          | Direct mapping                                 |
| `rssi`             | `rssi`             | Direct mapping                                 |
| `created_date`     | `source_timestamp` | The RAPT-reported time of measurement          |
| (generated)        | `created_at`       | Server-side `nowUtc()` -- when we received it  |
| (from device row)  | `user_id`          | Current `user_id` from `devices` table, or `NULL` |

The `source` column (added in migration `0002_readings_source.sql`) defaults to `'device'`. Webhook-inserted readings get this default. Manual readings inserted through the API would set `source = 'manual'`.

### Insert statement

```sql
INSERT INTO readings (id, batch_id, device_id, gravity, temperature, battery, rssi, source_timestamp, created_at, user_id)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

### Deduplication

A UNIQUE index prevents duplicate readings from the same device at the same timestamp:

```sql
CREATE UNIQUE INDEX idx_readings_dedupe
  ON readings(device_id, source_timestamp, COALESCE(batch_id, ''));
```

If the handler detects a duplicate (UNIQUE constraint violation), it catches the error and returns:

```json
{ "status": "duplicate", "message": "Reading already exists" }
```

This is a normal, non-error response (HTTP 200). It handles the case where the RAPT Portal retries a webhook delivery.

### Batch linking at insert time

The webhook handler resolves the reading's `batch_id` **at insert time** by looking up the device's current assignment:

```ts
const device = await db.prepare("SELECT batch_id, user_id FROM devices WHERE id = ?")
  .bind(body.device_id).first();
```

- If the device is assigned to a batch: `batch_id` = that batch's ID.
- If the device is unassigned or newly auto-registered: `batch_id` = `NULL`.

This means readings that arrive before the user assigns a device to a batch will have `batch_id = NULL`. The assignment endpoint backfills them later (see section 6).

---

## 5. Device-to-batch assignment

### Endpoint

```
POST /api/v1/devices/:deviceId/assign
```

**Auth:** Cloudflare Access (standard user auth). The device must belong to the authenticated user.

**Request body (DeviceAssignSchema):**
```json
{ "batch_id": "<batch-uuid>" }
```

### Validation rules

1. Device must exist and `user_id` must match the authenticated user.
2. Batch must exist and `user_id` must match the authenticated user.
3. Batch must have `status = 'active'`. Assigning to completed/abandoned/archived batches returns `409 Conflict`.

### What happens on assignment

```sql
UPDATE devices SET batch_id = ?, assigned_at = ?, updated_at = ? WHERE id = ?
```

- `batch_id` is set to the target batch.
- `assigned_at` is set to the current UTC timestamp. This records when the assignment began.

After updating the device, the endpoint also performs **reading backfill** (see section 6).

### How assignment affects incoming readings

Once the user assigns a device, the webhook handler automatically stamps all later readings for that device with the batch's ID (resolved from the `devices` table at insert time). No extra configuration is necessary.

---

## 6. Reading backfill

When the user assigns a device to a batch, the assignment endpoint retroactively associates unlinked readings from that device with the batch:

```sql
UPDATE readings
SET batch_id = ?
WHERE device_id = ?
  AND batch_id IS NULL
  AND source_timestamp >= ?
```

The third bind parameter is `batch.started_at` -- the batch's start date.

### What gets backfilled

- Readings from this device that have `batch_id IS NULL` (never assigned to any batch).
- Only readings whose `source_timestamp` is **on or after** the batch's `started_at`.

### What does NOT get backfilled

- Readings that already belong to another batch (`batch_id IS NOT NULL`).
- Readings from before the batch started (the device was monitoring something else).

### Example

A device sends readings starting March 18. The user created a batch with `started_at = 2026-03-19T10:00:00Z`. When the user assigns the device to the batch:

- Reading from `2026-03-18T10:00:00Z` -- **not backfilled** (before batch start).
- Reading from `2026-03-19T12:00:00Z` -- **backfilled** (after batch start, `batch_id` was NULL).

The test case `"assign backfills readings"` in `api/test/devices.test.ts` verifies this behavior.

---

## 7. Device claiming

Devices created by the webhook have `user_id = NULL` (unclaimed). A user must explicitly claim a device to own it.

### Endpoint

```
POST /api/v1/devices/claim
```

**Request body:**
```json
{ "device_id": "pill-abc-123" }
```

### Flow

1. Look up the device: `SELECT * FROM devices WHERE id = ? AND user_id IS NULL`.
2. If not found or already claimed: `404 Not Found`.
3. In a batch:
   - Set `user_id` on the device.
   - Backfill `user_id` on all existing readings from this device that have `user_id IS NULL`.

```sql
UPDATE devices SET user_id = ?, updated_at = ? WHERE id = ?
UPDATE readings SET user_id = ? WHERE device_id = ? AND user_id IS NULL
```

### Why claiming matters

- Device list queries filter by `user_id`: `SELECT * FROM devices WHERE user_id = ?`. Unclaimed devices do not appear in any user's device list.
- Reading queries also filter by `user_id`. Without claiming, a user cannot see the device's readings through the API.
- The webhook endpoint does not require user auth, so it creates readings with `user_id = NULL` for unclaimed devices. Claiming retroactively associates those readings with the user.

### Dashboard UI

The Settings page (`dashboard/src/pages/Settings.tsx`) has a "Claim Device" section where the user enters a device ID and clicks "Claim". The helper text reads: *"Enter a device ID to claim an unregistered RAPT Pill. The device must have sent at least one reading."*

---

## 8. Unassignment

### Manual unassignment

```
POST /api/v1/devices/:deviceId/unassign
```

Clears the device's batch association:

```sql
UPDATE devices SET batch_id = NULL, assigned_at = NULL, updated_at = ? WHERE id = ?
```

Existing readings that were already linked to the batch **remain linked** -- unassignment only affects future readings. After unassignment, new webhook readings for this device will have `batch_id = NULL`.

### Automatic unassignment on batch lifecycle events

When a batch transitions away from `active` status, the `unassignDevices` helper in `api/src/routes/batches.ts` automatically unassigns all devices from it:

```sql
UPDATE devices SET batch_id = NULL, assigned_at = NULL, updated_at = ? WHERE batch_id = ?
```

The following batch operations call this helper:

| Endpoint                        | Change                  | Unassigns Devices? |
|---------------------------------|-------------------------|--------------------|
| `POST /:batchId/complete`       | active -> completed     | Yes                |
| `POST /:batchId/abandon`        | active -> abandoned     | Yes                |
| `PATCH /:batchId` (status change) | active -> completed or abandoned | Yes          |

Reopening a batch (completed or abandoned -> active) does **not** automatically re-assign devices. The user must manually re-assign.

---

## 9. Alert evaluation after webhook

The webhook endpoint triggers **inline alert evaluation** immediately after inserting a reading, without waiting for the 15-minute cron job. This provides near-real-time alerting.

### Trigger condition

Alert evaluation only runs when the device has both a `batchId` and a `userId` (i.e., the device is claimed and assigned to a batch).

### Flow

1. **Fetch readings:** Query the last 200 readings for the batch, ordered by `source_timestamp ASC`.
2. **Fetch batch metadata:** Get `stage` and `target_gravity` for the batch. Only proceed if the batch is `active`.
3. **Build context:** Construct a `BatchAlertContext` with batch/user IDs, stage, target gravity, device assignment flag, and readings.
4. **Check:** `evaluateAlerts(ctx)` runs pure evaluation logic (no DB, no side effects) and returns alert candidates.
5. **Process:** `processAlerts(db, userId, batchId, candidates)` attempts to insert each candidate into `alert_state`. Deduplication prevents the same alert type from firing twice for the same batch (by using a partial unique index on unresolved alerts).
6. **Resolve cleared:** `resolveCleared(db, userId, batchId, candidates)` marks any earlier alerts as resolved if the condition is no longer present.
7. **Push notifications:** If any new alerts fired, look up the batch name and call `sendAlertPushes` to deliver Web Push notifications to the user's subscribed browsers.

### Alert types

| Type               | Trigger Condition                                                  |
|--------------------|--------------------------------------------------------------------|
| `temp_high`        | Latest temperature >= 30 C                                         |
| `temp_low`         | Latest temperature <= 8 C                                          |
| `no_readings`      | Last reading is > 48 hours old (requires assigned device)          |
| `stall`            | Gravity > 1.005, 48h velocity < 0.0005 or < 20% of 7-day velocity |
| `stage_suggestion` | Fermentation slowing (primary) or gravity stabilized (secondary)   |

**Source:** `api/src/lib/alerts.ts`

### Alert deduplication

The `alert_state` table has a partial unique index:

```sql
CREATE UNIQUE INDEX idx_alert_one_active
  ON alert_state (user_id, batch_id, alert_type)
  WHERE resolved_at IS NULL AND dismissed_at IS NULL;
```

The `processAlerts` function also checks for any unresolved row (active or dismissed) before inserting. This means:
- An alert type fires at most once per batch until the condition resolves.
- Dismissed alerts do not re-fire until the condition clears and a new occurrence begins.

### Cron fallback

A Cloudflare Worker cron trigger runs every 15 minutes (`*/15 * * * *` in `wrangler.toml`) and evaluates alerts for **all active batches** through `evaluateAllBatches` in `api/src/cron.ts`. This catches cases where the webhook-inline evaluation missed something (e.g., `no_readings` alerts for devices that stopped sending data). The cron uses the same `evaluateAlerts` / `processAlerts` / `resolveCleared` / `sendAlertPushes` pipeline.

---

## 10. Dashboard device UI

### Settings page (`/settings`)

**Source:** `dashboard/src/pages/Settings.tsx`

The Settings page has three device-related sections:

1. **Sensors** -- Lists all devices owned by the user. The page renders each device as a `DeviceCard` showing:
   - Device name and ID (monospace)
   - Assignment status: "Assigned" with an Unassign button, or "Idle" with an Assign button
   - If assigned, the batch name the device monitors
   - Latest sensor readings: gravity (SG), temperature, battery percentage, signal strength (Excellent/Good/Fair/Weak), and relative time since last reading
   - A gravity sparkline (last 50 readings) if at least 2 readings exist
   - If the device has no readings: *"No readings received yet"*
   - If no devices exist: *"No sensors registered. Devices appear automatically when your RAPT Pill sends its first reading."*

2. **Claim Device** -- Text input for a device ID + Claim button. Used for claiming auto-registered (unclaimed) devices.

3. **Notifications** -- Push notification toggle (enable/disable) and test button.

### Assign dialog

When the user clicks "Assign" on an idle device, a dialog is displayed with a dropdown of all active batches. Selecting a batch and confirming calls `POST /api/v1/devices/:deviceId/assign`.

### Batch detail page

**Source:** `dashboard/src/components/DeviceSection.tsx`

The batch detail page includes a `DeviceSection` component that shows:
- All devices assigned to the current batch
- Each device's name and ID, with an Unassign button (only shown for active batches)
- If the batch has no device: a prompt to assign one, linking to `/settings`

---

## 11. Data flow diagram

```
RAPT Pill (hardware)
    |
    | Bluetooth
    v
RAPT Portal (cloud)
    |
    | HTTP POST /webhook/rapt
    | Header: X-Webhook-Token
    | Body: { device_id, device_name, temperature, gravity, battery, rssi, created_date }
    v
+-----------------------------------------------------------+
| Webhook Handler (api/src/routes/webhook.ts)               |
|                                                           |
|  1. Auth: validate X-Webhook-Token (timing-safe compare)  |
|     |                                                     |
|     v                                                     |
|  2. Parse: strip null bytes, JSON.parse, Zod validate     |
|     |                                                     |
|     v                                                     |
|  3. Device lookup: SELECT batch_id, user_id FROM devices  |
|     |                                                     |
|     +-- Device not found? --> INSERT new device            |
|     |                         (user_id = NULL, unclaimed)  |
|     v                                                     |
|  4. Insert reading:                                       |
|     INSERT INTO readings (batch_id from device, ...)      |
|     |                                                     |
|     +-- UNIQUE violation? --> Return "duplicate"           |
|     |                                                     |
|     v                                                     |
|  5. Alert evaluation (if batchId AND userId present):     |
|     a. Fetch last 200 readings for batch                  |
|     b. Fetch batch stage + target_gravity                 |
|     c. evaluateAlerts() --> candidates                    |
|     d. processAlerts()  --> newly fired alerts            |
|     e. resolveCleared() --> mark resolved alerts          |
|     f. sendAlertPushes()--> Web Push to user              |
|     |                                                     |
|     v                                                     |
|  6. Return { status: "ok", reading_id }                   |
+-----------------------------------------------------------+

Parallel path (every 15 minutes):
+-----------------------------------------------------------+
| Cron: evaluateAllBatches (api/src/cron.ts)                |
|   For each active batch:                                  |
|     - Check if device assigned                            |
|     - Fetch readings, evaluate, process, push             |
+-----------------------------------------------------------+

User-initiated flows:
+-----------------------------------------------------------+
| Claim:  POST /api/v1/devices/claim                        |
|   - Sets user_id on device                                |
|   - Backfills user_id on orphaned readings                |
|                                                           |
| Assign: POST /api/v1/devices/:id/assign                   |
|   - Sets batch_id + assigned_at on device                 |
|   - Backfills batch_id on unlinked readings               |
|     (where source_timestamp >= batch.started_at)          |
|                                                           |
| Unassign: POST /api/v1/devices/:id/unassign               |
|   - Clears batch_id + assigned_at on device               |
|   - Existing readings stay linked to the batch            |
+-----------------------------------------------------------+
```

---

## 12. Troubleshooting

### Device not appearing in Settings

**Symptom:** User has a RAPT Pill but it does not show up in the Sensors list.

**Causes:**
- The device has not yet sent any data through the webhook. The webhook handler auto-registers devices on first delivery. Check that you configured the RAPT Portal webhook correctly.
- The device has sent data but no user has claimed it. Auto-registered devices have `user_id = NULL` and will not appear in any user's device list until claimed via the "Claim Device" section.

### Readings not linked to a batch

**Symptom:** Device is sending readings but they do not appear in the batch's reading list.

**Causes:**
- The device is not assigned to the batch. Check the device's `batch_id` in Settings. Assign it to the correct batch.
- The user assigned the device after the readings arrived. The webhook handler inserted those readings while the device had no batch, so they have `batch_id = NULL`. Assignment backfills only readings with `source_timestamp >= batch.started_at`. The system will never link readings from before the batch start date.

### Stale readings after late assignment

**Symptom:** Device was running for days before the user assigned it to a batch. Some early readings are missing from the batch.

**Explanation:** The backfill query uses `source_timestamp >= batch.started_at` as a filter. Readings from before the batch's start date are intentionally excluded -- they represent data from before the batch existed.

**Resolution:** If the batch start date is wrong, update it before assigning the device. There is no mechanism to retroactively re-run the backfill after the fact (you would need a manual SQL update).

### Webhook returning 401

**Symptom:** RAPT Portal reports webhook delivery failures with 401 status.

**Causes:**
- The `X-Webhook-Token` header value in the RAPT Portal configuration does not match the `WEBHOOK_TOKEN` secret in the Cloudflare Worker environment.
- The header is missing entirely. Ensure the RAPT Portal is sending `X-Webhook-Token` (not `Authorization` or some other header).
- Token comparison is byte-exact and constant-time. Trailing whitespace or encoding differences will cause failure.

### Webhook returning 422

**Symptom:** RAPT Portal reports 422 responses.

**Causes:**
- The payload is missing required fields or has wrong types. All seven fields (`device_id`, `device_name`, `temperature`, `gravity`, `battery`, `rssi`, `created_date`) are required.
- Check if the RAPT Portal firmware has changed its payload format.

### Duplicate readings

**Symptom:** The webhook returns `{ "status": "duplicate" }`.

**Explanation:** This is normal and expected when the RAPT Portal retries a delivery. The UNIQUE index on `(device_id, source_timestamp, COALESCE(batch_id, ''))` prevents D1 from storing the same reading twice. No action needed.

### Alerts not firing

**Symptom:** Temperature is high / gravity stalled but no alert notification received.

**Causes:**
- No user has claimed the device (`user_id = NULL`). The webhook handler skips alert evaluation if the device has no user.
- The device is not assigned to a batch (`batch_id = NULL`). Alert evaluation requires both `batchId` and `userId`.
- The batch is not active. Alerts are only evaluated for batches with `status = 'active'`.
- The alert already fired and the system has not yet resolved it. Check `alert_state` for an existing unresolved row of that type for the batch.
- Push notifications are not enabled. The user must have subscribed via the Settings page.
- Stall and stage_suggestion alerts require at least 10 readings in the batch.

### Device still showing as assigned after batch completed

**Symptom:** The user completed the batch but the device still shows "Assigned".

**Explanation:** This should not happen. Both the `/complete` and `/abandon` endpoints call `unassignDevices`, which clears `batch_id` and `assigned_at` on all devices assigned to the batch. If it persists, check whether the batch status change actually succeeded.

---

## Key source files

| File | Purpose |
|------|---------|
| `api/src/routes/webhook.ts` | Webhook endpoint -- main ingestion path |
| `api/src/routes/devices.ts` | Device CRUD, assignment, claiming |
| `api/src/models.ts` | `RaptWebhookSchema` and device-related Zod schemas |
| `api/src/routes/readings.ts` | Reading queries with cursor pagination |
| `api/src/routes/batches.ts` | Batch lifecycle, auto-unassign on completion/abandon |
| `api/src/lib/alerts.ts` | Pure alert evaluation engine |
| `api/src/lib/alert-manager.ts` | Alert persistence, dedup, resolve, push dispatch |
| `api/src/cron.ts` | Scheduled alert evaluation for all active batches |
| `api/src/schema.ts` | Reading source types, stage/status enums |
| `api/src/lib/crypto.ts` | Timing-safe string comparison for webhook auth |
| `api/src/index.ts` | Worker entry point with cron handler |
| `api/wrangler.toml` | Cron schedule (`*/15 * * * *`) |
| `api/migrations/0001_initial.sql` | Schema: devices, readings tables, dedupe index |
| `api/migrations/0002_readings_source.sql` | Adds `source` column to readings |
| `api/migrations/0004_multi_tenant.sql` | Adds `user_id` to devices and readings |
| `api/migrations/0006_alerts_and_stages.sql` | Alert state table and partial unique index |
| `dashboard/src/pages/Settings.tsx` | Device management UI (list, assign, claim, unassign) |
| `dashboard/src/components/DeviceSection.tsx` | Device section in batch detail page |
| `api/test/webhook.test.ts` | Webhook endpoint tests |
| `api/test/devices.test.ts` | Device CRUD and backfill tests |
