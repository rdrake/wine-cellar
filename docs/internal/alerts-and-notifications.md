# Alerts and notifications system

Internal documentation for the wine-cellar alert evaluation, state management, and Web Push notification pipeline.

---

## 1. System overview

The alert system monitors all active batches for dangerous or noteworthy conditions and delivers push notifications to the user's browser. The pipeline has four stages:

```
Trigger (cron / webhook)
  -> Evaluate (pure functions, no DB)
    -> Manage state (dedup, insert, resolve in D1)
      -> Push (RFC 8291 encrypted notification to browser)
```

**Two trigger paths** feed into the same evaluation pipeline:

1. **Cron job** (`scheduled` handler) -- runs every 15 minutes, evaluates all active batches.
2. **Webhook** (`POST /webhook/rapt`) -- evaluates a single batch immediately after a new reading arrives from a RAPT Pill device.

Both paths call the same three functions in sequence:

```
evaluateAlerts(ctx)       -> AlertCandidate[]
processAlerts(db, ...)    -> FiredAlert[]   (newly inserted)
resolveCleared(db, ...)   -> void           (auto-resolve stale alerts)
sendAlertPushes(db, ...)  -> void           (push for newly fired only)
```

### Key files

| File | Role |
|------|------|
| `api/src/cron.ts` | Cron entry point -- iterates active batches |
| `api/src/lib/alerts.ts` | Pure evaluation engine (no DB, no side effects) |
| `api/src/lib/alert-manager.ts` | State persistence, dedup, resolve, push dispatch |
| `api/src/lib/web-push.ts` | RFC 8291 payload encryption + VAPID auth |
| `api/src/routes/push.ts` | CRUD endpoints for push subscriptions |
| `api/src/routes/alerts.ts` | Close endpoint |
| `api/src/routes/webhook.ts` | RAPT Pill webhook (also triggers alert evaluation) |
| `api/src/routes/dashboard.ts` | Returns active alerts to the dashboard UI |
| `api/src/index.ts` | Cloudflare Worker entry -- binds `scheduled` handler |
| `dashboard/public/sw.js` | Service worker -- receives and displays push notifications |
| `dashboard/src/pages/Settings.tsx` | Push subscription management UI |
| `dashboard/src/pages/Dashboard.tsx` | Alert display and close UI |

### Database tables

| Table | Purpose |
|-------|---------|
| `alert_state` | One row per fired alert; tracks lifecycle (fired/dismissed/resolved) |
| `push_subscriptions` | One row per browser push subscription per user |

---

## 2. Cron job

### Schedule

Configured in `api/wrangler.toml`:

```toml
[triggers]
crons = ["*/15 * * * *"]
```

Runs every 15 minutes through Cloudflare Workers Cron Triggers.

### Entry point

`api/src/index.ts` exports a `scheduled` handler that calls `evaluateAllBatches()`:

```ts
async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
  ctx.waitUntil(evaluateAllBatches(env.DB, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY));
}
```

### What it does (`api/src/cron.ts`)

1. Queries all batches with `status = 'active'`.
2. For each batch:
   - Checks if the batch has an assigned device.
   - Loads up to 200 readings ordered by `source_timestamp ASC`.
   - Builds a `BatchAlertContext` and calls `evaluateAlerts(ctx)`.
   - Calls `processAlerts()` to insert new alerts (with dedup).
   - Calls `resolveCleared()` to auto-resolve alerts whose conditions no longer hold.
   - If the pipeline fired any new alerts, calls `sendAlertPushes()` to deliver push notifications.

### Webhook trigger path

The same pipeline runs in `POST /webhook/rapt` after the webhook handler inserts a reading. The difference: the handler evaluates only the single affected batch, and `hasAssignedDevice` is always `true` (the reading came from a device). This means alerts can fire within seconds of a problematic reading, not just at the 15-minute cron boundary.

---

## 3. Alert types

`api/src/lib/alerts.ts` defines all types as a union type:

```ts
type AlertType = "stall" | "no_readings" | "temp_high" | "temp_low" | "stage_suggestion";
```

### `temp_high` -- High temperature

| Property | Value |
|----------|-------|
| Threshold | Latest reading temperature >= 30 C |
| Required readings | 1 |
| Message | `Temperature is {temp} C -- above safe threshold (30 C)` |
| Context | `{ temperature }` |

### `temp_low` -- Low temperature

| Property | Value |
|----------|-------|
| Threshold | Latest reading temperature <= 8 C |
| Required readings | 1 |
| Message | `Temperature is {temp} C -- below safe threshold (8 C)` |
| Context | `{ temperature }` |

### `no_readings` -- No readings (stale device)

| Property | Value |
|----------|-------|
| Condition | Batch has an assigned device AND latest reading is older than 48 hours |
| Required readings | 1 |
| Message | `No readings received for {hours} hours` |
| Context | `{ lastReadingAt, hoursAgo }` |

Note: This alert only fires when `hasAssignedDevice` is true. If the device is unassigned, the system does not raise an alert.

### `stall` -- Fermentation stall

| Property | Value |
|----------|-------|
| Required readings | 10 |
| Extra condition | Latest gravity > 1.005 AND >= 0.998 |
| Detection method | Computes 48-hour velocity (`v48`) and 7-day velocity (`v7d`). Triggers if EITHER: (a) `v48` absolute value < 0.0005 (gravity unchanged for 48h), or (b) `v48` < 20% of `v7d` (sharp velocity decline). |
| Message | `Possible fermentation stall at {gravity} -- {reason}` |
| Context | `{ gravity, velocity48h, velocity7d, reason }` |

The gravity guard (`> 1.005`) prevents false stall alerts after fermentation completes naturally (gravity near 0.998 or lower is normal at terminal).

### `stage_suggestion` -- Stage change suggestion

This alert has two sub-conditions depending on the current batch stage:

#### Primary -> secondary

| Property | Value |
|----------|-------|
| Stage | `primary_fermentation` |
| Required readings | 10 |
| Condition | Gravity < 1.020 AND 48h velocity < 50% of 7-day velocity (fermentation is slowing) |
| Message | `Fermentation is slowing -- consider moving to secondary` |
| Context | `{ suggestedStage: "secondary_fermentation", gravity, velocity48h, velocity7d }` |

#### Secondary -> stabilization

| Property | Value |
|----------|-------|
| Stage | `secondary_fermentation` |
| Required readings | 10 |
| Condition | 72-hour gravity range < 0.001 AND (gravity < 1.000 OR within 0.002 of `target_gravity`) |
| Message | `Gravity has stabilized -- consider moving to stabilization` |
| Context | `{ suggestedStage: "stabilization", gravity, gravityRange72h }` |

The evaluator does not generate stage suggestions for `must_prep`, `stabilization`, or `bottling` stages.

### Velocity helper

The `velocity()` function computes gravity change per day over a sliding window. It finds the oldest reading within the window and divides the gravity delta by the time delta in days. A negative velocity means gravity is dropping (normal fermentation). Returns `null` if fewer than 2 readings exist or the window has no qualifying data.

---

## 4. Alert lifecycle

### States

Each alert row in `alert_state` has three timestamp columns that decide its state:

| State | `fired_at` | `dismissed_at` | `resolved_at` |
|-------|-----------|----------------|---------------|
| **Active** | set | NULL | NULL |
| **Dismissed** | set | set | NULL |
| **Resolved** | set | NULL or set | set |

- **Active**: The condition is present and the user has not dismissed it. Visible in the dashboard.
- **Dismissed**: The user acknowledged it, but the underlying condition still exists. Hidden from the dashboard, but the alert row remains unresolved.
- **Resolved**: The condition no longer exists. The row is terminal -- it will not change further.

### State transitions

```
         [condition detected]
                |
                v
            +--------+
            | Active |
            +--------+
           /          \
  [user dismisses]   [condition clears]
         |                    |
         v                    v
   +-----------+        +----------+
   | Dismissed |        | Resolved |
   +-----------+        +----------+
         |
  [condition clears]
         |
         v
   +----------+
   | Resolved |
   +----------+
```

Key points:
- A dismissed alert transitions to resolved when the condition clears (`resolveCleared()` sets resolved_at).
- A dismissed alert does NOT re-fire while it remains unresolved. This prevents notification spam after a user acknowledges an alert.
- Only after an alert is resolved (condition clears) can the same type fire again for that user+batch.

### Deduplication rules

**One active or dismissed alert per (user_id, batch_id, alert_type).**

The system enforces this at two levels:

1. **Application-level check** in `processAlerts()`: Before inserting, queries for any existing row where `resolved_at IS NULL` (regardless of `dismissed_at`). If found, skips the insert.

2. **Database partial unique index** as a race-safe fallback:
   ```sql
   CREATE UNIQUE INDEX idx_alert_one_active
     ON alert_state (user_id, batch_id, alert_type)
     WHERE resolved_at IS NULL AND dismissed_at IS NULL;
   ```
   This catches concurrent inserts. The code handles `UNIQUE constraint failed` / `SQLITE_CONSTRAINT` errors by silently skipping.

Note: The partial index only covers `resolved_at IS NULL AND dismissed_at IS NULL` (active alerts). The application-level check is broader -- it also prevents re-firing when `dismissed_at IS NOT NULL` (dismissed but unresolved). This means the index alone is insufficient; the application query is the primary dedup mechanism.

---

## 5. Alert manager

`api/src/lib/alert-manager.ts` has three core functions:

### `processAlerts(db, userId, batchId, candidates) -> FiredAlert[]`

For each `AlertCandidate`:
1. Checks for an existing unresolved row (`resolved_at IS NULL`) for this user + batch + alert_type.
2. If found, skips (dedup).
3. If not found, generates a UUID, inserts a new `alert_state` row with `fired_at = now`.
4. Catches UNIQUE constraint violations as a race-safe fallback.
5. Returns only newly inserted alerts (the caller uses these for push notification).

### `resolveCleared(db, userId, batchId, currentCandidates) -> void`

1. Fetches all unresolved rows (`resolved_at IS NULL`) for this user + batch.
2. Builds a set of alert types from the current candidates.
3. For each existing unresolved row whose `alert_type` is NOT in the current candidates set, sets `resolved_at = now`.

This means: if the evaluator no longer produces a `temp_high` candidate, any existing `temp_high` alert (active or dismissed) gets resolved. Once resolved, the same alert type can fire again if the condition returns.

### `getActiveAlerts(db, userId) -> Alert[]`

Returns all alerts where `resolved_at IS NULL AND dismissed_at IS NULL`, joined with `batches` to include `batch_name`. Ordered by `fired_at DESC`. Used by the dashboard endpoint.

### `sendAlertPushes(db, userId, batchName, firedAlerts, ...) -> void`

For each newly fired alert:
1. Parses the alert's context JSON.
2. Builds a `PushPayload` with:
   - `title`: `"{batchName} -- {alertLabel}"` (e.g., "Merlot 2025 -- High Temperature")
   - `body`: The context message or a fallback label.
   - `url`: `/batches/{batchId}` (deep link to the batch).
   - `type`: The alert type string.
   - `alertId`: The alert's UUID.
3. For `stage_suggestion` alerts with a `next_stage` in context, adds `batchId` and `nextStage` fields and rewrites the URL to include `?action=advance&stage=...`.
4. Calls `sendPushToUser()` to encrypt and deliver the notification.

Alert display labels:
| Type | Label |
|------|-------|
| `stall` | Fermentation Stall |
| `no_readings` | No Readings |
| `temp_high` | High Temperature |
| `temp_low` | Low Temperature |
| `stage_suggestion` | Stage Suggestion |

---

## 6. Web Push encryption

`api/src/lib/web-push.ts` implements RFC 8291 (Message Encryption for Web Push) using only `crypto.subtle` -- no npm dependencies. This is necessary because Cloudflare Workers do not support Node.js crypto APIs.

### High-level flow

```
1. Generate ephemeral ECDH key pair (server-side, per-message)
2. ECDH key agreement with subscriber's public key -> shared secret
3. HKDF extract+expand (RFC 5869) to derive:
   a. IKM from auth_secret + shared_secret  (RFC 8291 Section 3.4)
   b. Content encryption key (CEK) from salt + IKM  (RFC 8188)
   c. Nonce from salt + IKM  (RFC 8188)
4. AES-128-GCM encrypt the padded plaintext
5. Build aes128gcm content-coding body (header + ciphertext)
6. Create VAPID JWT (ES256 signed) for authorization
7. POST to push service endpoint with encrypted body
```

### VAPID authentication

VAPID (Voluntary Application Server Identification) uses ES256 (ECDSA on P-256 with SHA-256):

1. The server has a static ECDH key pair stored as environment variables:
   - `VAPID_PUBLIC_KEY`: base64url-encoded raw 65-byte uncompressed EC public key.
   - `VAPID_PRIVATE_KEY`: base64url-encoded 32-byte private scalar (d).

2. `createVapidJwt()` builds an ES256 JWT:
   - Header: `{"typ":"JWT","alg":"ES256"}`
   - Payload: `{"aud":"<push-service-origin>","exp":<now+86400>,"sub":"mailto:noreply@drake.zone"}`
   - Signs with ECDSA using the VAPID private key.
   - Handles DER-to-raw signature conversion (crypto.subtle might return DER-encoded ECDSA signatures; the JWT needs raw `r||s` format, 64 bytes).

3. The HTTP request includes:
   - `Authorization: vapid t=<jwt>, k=<base64url-public-key>`

### Key exchange and encryption

1. **Ephemeral key pair**: The server generates a new ECDH P-256 key pair for each message. The encrypted payload header includes the ephemeral public key so the subscriber can derive the same shared secret.

2. **ECDH shared secret**: Derived from the ephemeral server private key and the subscriber's P-256 public key (from `keys_p256dh` in the subscription).

3. **IKM derivation** (RFC 8291 Section 3.4):
   ```
   info = "WebPush: info" || 0x00 || subscriber_public_key || server_public_key
   IKM = HKDF(salt=auth_secret, ikm=shared_secret, info=info, length=32)
   ```
   The HKDF step uses the subscriber's `auth` secret (16 bytes, from `keys_auth`) as the salt.

4. **CEK derivation** (RFC 8188 Section 2.2):
   ```
   CEK = HKDF(salt=random_salt, ikm=IKM, info="Content-Encoding: aes128gcm\0", length=16)
   ```

5. **Nonce derivation** (RFC 8188 Section 2.3):
   ```
   Nonce = HKDF(salt=random_salt, ikm=IKM, info="Content-Encoding: nonce\0", length=12)
   ```

6. **Encryption**: The encryption step pads the plain text JSON payload with a `0x02` delimiter byte (indicating last record in aes128gcm content coding), then encrypts it with AES-128-GCM.

7. **Body format** (aes128gcm content coding):
   ```
   salt (16 bytes) || record_size (4 bytes, uint32 BE) || idlen (1 byte) || keyid (65 bytes, server public key) || ciphertext
   ```

### HKDF implementation

Implements RFC 5869 HMAC-based KDF using `crypto.subtle`:
- **Extract**: `PRK = HMAC-SHA256(salt, IKM)`
- **Expand**: `OKM = HMAC-SHA256(PRK, info || 0x01)` (single iteration, enough for <= 32 bytes)

### Sending

`sendPush()` POSTs the encrypted body to the push service endpoint with headers:
- `Authorization`: VAPID token
- `Content-Encoding: aes128gcm`
- `Content-Type: application/octet-stream`
- `TTL: 86400` (24 hours)

Returns `{ ok, status, gone }`. A `201` response means success. `404`/`410` means the subscription expired.

### Subscription cleanup

`sendPushToUser()` iterates all push subscriptions for a user. After each send:
- If the push service returns 404, 410, 401, or 403, the function deletes the subscription from `push_subscriptions`. This handles expired subscriptions and VAPID key rotation scenarios.

---

## 7. Push Subscription Management

### Database schema

```sql
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

The `endpoint` column has a UNIQUE constraint. This means one browser subscription can only belong to one user at a time. Re-subscribing from the same browser updates the existing row through `ON CONFLICT(endpoint) DO UPDATE`.

### API endpoints (`api/src/routes/push.ts`)

The router mounts all endpoints at `/api/v1/push`; they require authentication (Cloudflare Access).

#### `GET /api/v1/push/vapid-key`

Returns the VAPID public key so the browser can create a push subscription with the correct `applicationServerKey`.

```json
{ "key": "<base64url-encoded-65-byte-public-key>" }
```

#### `POST /api/v1/push/subscribe`

Creates or updates a push subscription. The body must match:

```json
{
  "endpoint": "https://fcm.googleapis.com/...",
  "keys": {
    "p256dh": "<base64url>",
    "auth": "<base64url>"
  }
}
```

Uses `INSERT ... ON CONFLICT(endpoint) DO UPDATE` to handle re-subscriptions from the same browser. This upsert updates `keys_p256dh`, `keys_auth`, and `user_id` on conflict. Returns 201.

#### `DELETE /api/v1/push/subscribe`

Removes a push subscription by endpoint. Body:

```json
{ "endpoint": "https://fcm.googleapis.com/..." }
```

Deletes only if the endpoint belongs to the authenticated user. Returns 204.

#### `POST /api/v1/push/test`

Sends a test notification to the authenticated user's subscriptions:

```json
{
  "title": "Test Notification",
  "body": "Push notifications are working!",
  "url": "/settings",
  "type": "test",
  "alertId": "test"
}
```

### Dashboard subscription flow (`dashboard/src/pages/Settings.tsx`)

The `NotificationsSection` component:

1. On mount, checks if `serviceWorker` and `PushManager` are available.
2. Checks the current subscription state via `reg.pushManager.getSubscription()`.
3. **Enable flow**:
   - Requests `Notification.requestPermission()`.
   - Fetches the VAPID public key from `GET /api/v1/push/vapid-key`.
   - Decodes the base64url key to `Uint8Array`.
   - Calls `reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes })`.
   - Extracts `endpoint`, `keys.p256dh`, and `keys.auth` from the subscription JSON.
   - Sends them to `POST /api/v1/push/subscribe`.
4. **Disable flow**:
   - Gets the current subscription.
   - Calls `DELETE /api/v1/push/subscribe` with the endpoint.
   - Calls `sub.unsubscribe()` on the browser subscription.
5. **Test button** (visible when enabled): Calls `POST /api/v1/push/test`.

---

## 8. Service worker

`dashboard/public/sw.js` handles two push-related events.

### `push` event

1. Parses the decrypted payload as JSON.
2. Builds notification options:
   - `body`: from `data.body`
   - `icon` / `badge`: `/icon-192.png`
   - `tag`: `"{type}-{alertId}"` (e.g., `"temp_high-abc123"`) -- this deduplicates notifications of the same type+alert in the browser's notification tray.
   - `data.url`: The deep-link URL from the payload.
3. **Stage suggestion special handling**: If `type === "stage_suggestion"` and `nextStage` is present, the notification includes two action buttons:
   - "Advance Now" -- links to `/batches/{batchId}?action=advance&stage={nextStage}`
   - "Close" -- links to `/batches/{batchId}?action=dismiss&alertId={alertId}`
4. Calls `self.registration.showNotification(title, options)`.

### `notificationclick` event

1. Closes the notification.
2. Determines the target URL based on which action the user clicked:
   - Default click: `data.url` (usually `/batches/{batchId}`)
   - "Advance Now": `data.advanceUrl`
   - "Close": `data.dismissUrl`
3. Tries to focus an existing window and navigate it. If no window is open, opens a new one.

---

## 9. Push notification payload

The JSON payload sent to the push service (after encryption) has this structure:

```ts
interface PushPayload {
  title: string;       // "{batchName} -- {alertLabel}"
  body: string;        // Human-readable alert message
  url: string;         // Deep-link path, e.g. "/batches/{id}"
  type: string;        // Alert type: "stall", "temp_high", etc.
  alertId: string;     // UUID of the alert_state row

  // Only for stage_suggestion alerts with next_stage:
  batchId?: string;
  nextStage?: string;
}
```

### Examples

**High temperature alert:**
```json
{
  "title": "Merlot 2025 -- High Temperature",
  "body": "High Temperature",
  "url": "/batches/abc-123",
  "type": "temp_high",
  "alertId": "def-456"
}
```

**Stage suggestion alert:**
```json
{
  "title": "Merlot 2025 -- Stage Suggestion",
  "body": "Stage Suggestion",
  "url": "/batches/abc-123?action=advance&stage=secondary_fermentation",
  "type": "stage_suggestion",
  "alertId": "def-456",
  "batchId": "abc-123",
  "nextStage": "secondary_fermentation"
}
```

**Test notification:**
```json
{
  "title": "Test Notification",
  "body": "Push notifications are working!",
  "url": "/settings",
  "type": "test",
  "alertId": "test"
}
```

---

## 10. Close and resolve flow

### User close

**Endpoint**: `POST /api/v1/alerts/:alertId/dismiss`

1. Looks up the alert by ID, confirming it belongs to the authenticated user and is both unresolved and undismissed (`resolved_at IS NULL AND dismissed_at IS NULL`).
2. If not found, returns 404.
3. Sets `dismissed_at = now()`.

**Effect**: The alert disappears from the dashboard (since `getActiveAlerts` filters on `dismissed_at IS NULL`), but the `alert_state` row remains unresolved. This means:
- The same alert type will NOT re-fire for this batch (because `processAlerts` checks `resolved_at IS NULL`, which still matches dismissed alerts).
- The alert is "suppressed" until the condition resolves.

**Dashboard UI**: The `AlertsSection` component in `Dashboard.tsx` renders a close button (X) for each alert. Clicking it calls `api.alerts.dismiss(alertId)` and refetches the dashboard data.

### Auto-resolve

`resolveCleared()` runs on every evaluation cycle (cron and webhook). For each unresolved alert (active or dismissed) whose alert type is NOT in the current set of candidates:
- Sets `resolved_at = now()`.

This means when the temperature drops under 30 C, the `temp_high` alert resolves -- whether the user closed it. After resolution, if the temperature rises over 30 C again, a new `temp_high` alert can fire and the system will send a new push notification.

### Re-fire behavior summary

| Scenario | Can re-fire? |
|----------|-------------|
| Alert is active, same condition still present | No (dedup) |
| Alert was dismissed, condition still present | No (dismissed row is still unresolved) |
| Alert was resolved (condition cleared), condition returns | Yes (new row inserted, new push sent) |
| Alert was dismissed, then condition cleared, then condition returns | Yes (close -> resolve -> new fire) |

### Full lifecycle example

1. Temperature rises to 31 C.
2. Cron evaluates -> `temp_high` candidate produced.
3. `processAlerts` inserts new `alert_state` row (state: active). Push notification sent.
4. Next cron cycle (15 min later) -> `temp_high` candidate still produced. `processAlerts` finds existing unresolved row, skips. No new push.
5. User dismisses the alert in the dashboard. Row now has `dismissed_at` set.
6. Next cron cycle -> `temp_high` candidate still produced. `processAlerts` finds unresolved (dismissed) row, skips. `resolveCleared` sees `temp_high` is still in candidates, does not resolve.
7. Temperature drops to 25 C.
8. Next cron cycle -> no `temp_high` candidate. `resolveCleared` resolves the dismissed row (sets `resolved_at`).
9. Temperature rises to 32 C.
10. Next cron cycle -> `temp_high` candidate produced. `processAlerts` finds no unresolved row, inserts new one. New push notification sent.

---

## Appendix: database schema

### `alert_state` table

```sql
CREATE TABLE alert_state (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  batch_id TEXT NOT NULL REFERENCES batches(id),
  alert_type TEXT NOT NULL CHECK (alert_type IN ('stall', 'no_readings', 'temp_high', 'temp_low', 'stage_suggestion')),
  context TEXT,           -- JSON blob with alert-specific data
  fired_at TEXT NOT NULL,
  dismissed_at TEXT,      -- set when user dismisses
  resolved_at TEXT        -- set when condition clears
);

CREATE UNIQUE INDEX idx_alert_one_active
  ON alert_state (user_id, batch_id, alert_type)
  WHERE resolved_at IS NULL AND dismissed_at IS NULL;
```

The partial unique index prevents duplicate active (undismissed, unresolved) alerts. The application also checks for dismissed-but-unresolved alerts before inserting (a broader check than the index enforces).

### `push_subscriptions` table

```sql
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,  -- base64url, subscriber's ECDH public key (65 bytes raw)
  keys_auth TEXT NOT NULL,    -- base64url, subscriber's auth secret (16 bytes)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Migration `0006_alerts_and_stages.sql` creates both tables.

---

## Appendix: environment variables

| Variable | Description |
|----------|-------------|
| `VAPID_PUBLIC_KEY` | base64url-encoded 65-byte raw uncompressed P-256 public key |
| `VAPID_PRIVATE_KEY` | base64url-encoded 32-byte private scalar (d value) |
| `WEBHOOK_TOKEN` | Shared secret for authenticating RAPT Pill webhook requests |

---

## Appendix: test coverage

- `api/test/alert-manager.test.ts` -- Tests for `processAlerts`, `resolveCleared`, and `getActiveAlerts`:
  - Inserting a new alert returns it.
  - Deduplication: second call for the same type returns nothing.
  - `resolveCleared` marks alerts as resolved when the condition clears.
  - Re-fire after resolution works.
  - Dismissed alerts do not re-fire until resolved.
  - `getActiveAlerts` returns only unresolved + undismissed alerts.

- `api/test/cron.test.ts` -- Integration tests for `evaluateAllBatches`:
  - Creates a `no_readings` alert for a batch with a stale device (72h old reading).
  - Skips inactive (completed) batches.
