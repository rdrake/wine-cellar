# Wine Cellar operations runbook

Internal reference for diagnosing issues, performing maintenance, and operating the wine-cellar production environment.

**Infrastructure summary:**

| Component | Name | Platform |
|-----------|------|----------|
| API Worker | `wine-cellar-api` | Cloudflare Workers |
| Dashboard | `wine-cellar-dashboard` | Cloudflare Pages |
| Database | `wine-cellar-api` (D1) | Cloudflare D1 |
| Database ID | `08d5d178-c4f1-4be2-9906-5acea05682ae` | |
| Cron schedule | `*/15 * * * *` (every 15 min) | Workers Cron Triggers |
| Auth | Cloudflare Access (team: `rdrake`) | |

---

## 1. Health checks

### GET /health (API worker direct)

```
curl https://wine-cellar-api.rdrake.workers.dev/health
```

**Expected response:** `{"status":"ok"}` with HTTP 200.

This endpoint skips authentication (exempted in `accessAuth` middleware). It confirms the Worker has deployed and is responding. A failure here means:
- The Worker is not deployed or has an unrecoverable startup error.
- Cloudflare Workers platform is experiencing an outage.

### GET /health (through Dashboard proxy)

```
curl https://<dashboard-domain>/health
```

This routes through the Pages Function proxy (`dashboard/functions/health.ts`) to the API Worker at `wine-cellar-api.rdrake.workers.dev`. A failure here with a working direct `/health` means something broke the Pages Function proxy or the Pages deployment is down.

### GET /api/v1/me (authenticated)

This endpoint requires a valid Cloudflare Access JWT. It returns the authenticated user's `id`, `email`, and `name`. Use it to verify the full auth chain:
- Cloudflare Access is issuing JWTs.
- JWKS key fetch is working.
- `CF_ACCESS_AUD` matches.
- User upsert into D1 is functioning.

A `401` response with `{"error":"unauthorized","message":"Missing access token"}` means no JWT was sent. A `401` with `"Invalid access token"` means JWT verification failed (see Authentication failures following).

---

## 2. Common issues and diagnosis

### 2.1 Push notifications not arriving

**Checklist:**

1. **Does the user have a push subscription in the DB?**
   ```bash
   wrangler d1 execute wine-cellar-api --command \
     "SELECT id, endpoint, created_at FROM push_subscriptions WHERE user_id = '<USER_ID>';"
   ```
   If empty, the user never subscribed or the system cleaned up their subscription.

2. **Is the service worker registered?**
   In the browser: DevTools > Application > Service Workers. Look for `sw.js` with status "activated and is running". The service worker handles the `push` event and calls `showNotification`.

3. **Are browser notification permissions granted?**
   DevTools > Application > Notifications, or check `Notification.permission` in the console. Must be `"granted"`.

4. **Are VAPID keys correct?**
   The `VAPID_PUBLIC_KEY` served at `GET /api/v1/push/vapid-key` must match the key the browser subscribed with. If someone rotated the VAPID keys, all existing subscriptions are invalid. The push service (e.g., FCM, Mozilla) returns `401` or `403`, and `web-push.ts` auto-deletes the subscription:
   ```
   // 404/410 = expired, 401/403 = VAPID mismatch -> DELETE
   ```

5. **Is the push endpoint still valid?**
   Push services return `404` or `410` for expired endpoints. These are automatically cleaned up (subscription deleted from `push_subscriptions`). Check if the subscription was recently deleted:
   ```bash
   wrangler d1 execute wine-cellar-api --command \
     "SELECT COUNT(*) FROM push_subscriptions WHERE user_id = '<USER_ID>';"
   ```
   If count dropped to 0, the system cleaned up the subscriptions. The user needs to re-enable notifications.

6. **Test push manually:**
   Use the "Send Test Notification" button in Settings (calls `POST /api/v1/push/test`). If this works but alert pushes do not, the issue is in alert evaluation, not push delivery.

### 2.2 Alerts not firing

**Checklist:**

1. **Is the cron running?**
   Check Cloudflare dashboard: Workers and Pages > `wine-cellar-api` > Triggers > Cron Triggers. Should show `*/15 * * * *` with recent invocations. Or tail logs:
   ```bash
   wrangler tail wine-cellar-api --format pretty
   ```

2. **Is the batch active?**
   The cron only evaluates batches with `status = 'active'`:
   ```bash
   wrangler d1 execute wine-cellar-api --command \
     "SELECT id, name, status, stage FROM batches WHERE id = '<BATCH_ID>';"
   ```

3. **Is a device assigned to the batch?**
   `no_readings` alerts require `hasAssignedDevice = true`. The cron checks for a device row:
   ```bash
   wrangler d1 execute wine-cellar-api --command \
     "SELECT id, batch_id FROM devices WHERE batch_id = '<BATCH_ID>';"
   ```

4. **Are there enough readings?**
   Stall detection and stage suggestions require at least 10 readings. Temperature alerts need at least 1 reading with a non-null temperature:
   ```bash
   wrangler d1 execute wine-cellar-api --command \
     "SELECT COUNT(*) as count, MIN(source_timestamp) as first, MAX(source_timestamp) as last FROM readings WHERE batch_id = '<BATCH_ID>';"
   ```

5. **Is the alert already active (dedup)?**
   An alert will not re-fire if an unresolved row (active or dismissed) already exists:
   ```bash
   wrangler d1 execute wine-cellar-api --command \
     "SELECT id, alert_type, fired_at, dismissed_at, resolved_at FROM alert_state WHERE batch_id = '<BATCH_ID>' AND resolved_at IS NULL;"
   ```

6. **Do the readings actually meet alert thresholds?**
   - `temp_high`: latest temperature >= 30
   - `temp_low`: latest temperature <= 8
   - `no_readings`: latest reading older than 48 hours AND device assigned
   - `stall`: >= 10 readings, gravity > 1.005, 48h velocity < 0.0005 or < 20% of 7-day velocity
   - `stage_suggestion`: depends on current stage (see `alerts.ts`)

### 2.3 Stale or stuck alerts

Alerts can get stuck in an active (unresolved) state if:
- The batch is no longer active (status changed) so the cron skips it, and `resolveCleared` never runs.
- The condition keeps evaluating as true indefinitely (e.g., a device goes offline and `no_readings` persists).
- A dismissed alert (`dismissed_at IS NOT NULL`, `resolved_at IS NULL`) blocks re-fire but the condition never clears.

**To find stuck alerts:**
```bash
wrangler d1 execute wine-cellar-api --command \
  "SELECT a.id, a.alert_type, a.fired_at, a.dismissed_at, b.name, b.status
   FROM alert_state a JOIN batches b ON b.id = a.batch_id
   WHERE a.resolved_at IS NULL
   ORDER BY a.fired_at ASC;"
```

**To manually resolve a stuck alert:**
```bash
wrangler d1 execute wine-cellar-api --command \
  "UPDATE alert_state SET resolved_at = datetime('now') WHERE id = '<ALERT_ID>';"
```

**To resolve all alerts for an inactive batch:**
```bash
wrangler d1 execute wine-cellar-api --command \
  "UPDATE alert_state SET resolved_at = datetime('now')
   WHERE batch_id = '<BATCH_ID>' AND resolved_at IS NULL;"
```

### 2.4 Webhook data not appearing

The webhook endpoint is `POST /webhook/rapt`. It uses token auth, not Cloudflare Access.

**Checklist:**

1. **Is the auth token correct?**
   The webhook checks `X-Webhook-Token` against the `WEBHOOK_TOKEN` secret using timing-safe comparison. A mismatch returns `401 {"error":"unauthorized","message":"Invalid webhook token"}`.

2. **Is the device claimed by a user?**
   Unknown devices are auto-registered with `user_id = NULL`. Readings for unclaimed devices have `user_id = NULL` and `batch_id = NULL`:
   ```bash
   wrangler d1 execute wine-cellar-api --command \
     "SELECT id, name, user_id, batch_id FROM devices WHERE id = '<DEVICE_ID>';"
   ```

3. **Is the device assigned to a batch?**
   If `batch_id IS NULL` on the device, readings arrive with `batch_id = NULL`:
   ```bash
   wrangler d1 execute wine-cellar-api --command \
     "SELECT id, batch_id, user_id FROM readings WHERE device_id = '<DEVICE_ID>' ORDER BY source_timestamp DESC LIMIT 5;"
   ```

4. **Is the reading a duplicate?**
   The `idx_readings_dedupe` unique index on `(device_id, source_timestamp, COALESCE(batch_id, ''))` prevents duplicates. A duplicate returns `{"status":"duplicate","message":"Reading already exists"}`.

5. **Were readings received before device assignment?**
   There is no backfill. Readings that arrived before you assigned the device to a batch will have `batch_id = NULL` permanently unless manually fixed. See Database Operations for the fix.

### 2.5 Authentication failures

**Symptoms:** All authenticated endpoints return `401`.

1. **JWKS fetch failing?**
   The Worker fetches keys from `https://rdrake.cloudflareaccess.com/cdn-cgi/access/certs`. If this fails, the Worker cannot verify any JWT. The Worker caches keys for 5 minutes in isolate memory. A fresh Worker with a JWKS outage will fail immediately.

2. **`CF_ACCESS_AUD` mismatch?**
   The JWT's `aud` claim must contain the value of `CF_ACCESS_AUD`. If someone recreated the Cloudflare Access application, the AUD tag changes. Verify:
   - Cloudflare Zero Trust dashboard > Access > Applications > find the app > copy the Application Audience (AUD) Tag.
   - Compare to the secret stored in the Worker:
     ```bash
     # There's no way to read a secret, but you can re-set it:
     wrangler secret put CF_ACCESS_AUD
     ```

3. **Token expired?**
   Access JWTs have an `exp` claim. If the user's session expired and Cloudflare Access did not redirect them to re-authenticate, they will send a stale token.

4. **Service token not linked?**
   Service tokens require a row in the `service_tokens` table mapping `client_id` to a `user_id`. Without it: `401 "Service token not linked to a user"`.
   ```bash
   wrangler d1 execute wine-cellar-api --command \
     "SELECT client_id, user_id, label FROM service_tokens;"
   ```

### 2.6 Dashboard proxy errors

The dashboard (`wine-cellar-dashboard` on Cloudflare Pages) proxies API requests through two Pages Functions:
- `functions/api/[[path]].ts`, which proxies `/api/*` to `wine-cellar-api.rdrake.workers.dev`
- `functions/health.ts`, which proxies `/health` to the same

**Checklist:**

1. **Pages Function failing?** Check the Pages deployment in the Cloudflare dashboard for function compilation errors.

2. **API Worker down?** The proxy does a plain `fetch()` to `wine-cellar-api.rdrake.workers.dev`. If the Worker is down, the proxy returns whatever error the Worker returns (likely 502/503).

3. **Wrong hostname in proxy?** Both proxy functions hard code `wine-cellar-api.rdrake.workers.dev`. If the Worker name changes, the proxy breaks. Verify the Worker is reachable at that hostname.

4. **Service worker caching issues?** The service worker (`sw.js`) uses network-first for `/api/*` and `/webhook` paths, so stale cache is not an issue for API calls. For navigation requests, it falls back to cache on network failure. Force a cache clear: DevTools > Application > Cache Storage > delete `wine-cellar-v4`.

### 2.7 Missing readings on a batch

If you assigned a device to a batch after the webhook had already received readings, those earlier readings will have `batch_id = NULL` because the webhook sets `batch_id` based on the device's current `batch_id` at the time the reading arrives.

**There is no automatic backfill.** See section 3 for how to manually fix this.

To identify orphaned readings:
```bash
wrangler d1 execute wine-cellar-api --command \
  "SELECT id, device_id, gravity, source_timestamp FROM readings
   WHERE device_id = '<DEVICE_ID>' AND batch_id IS NULL
   ORDER BY source_timestamp DESC LIMIT 20;"
```

---

## 3. Database operations

### Querying production D1

All queries use the `wrangler d1 execute` command with the database name `wine-cellar-api`:

```bash
wrangler d1 execute wine-cellar-api --command "<SQL>"
```

For multi-line or complex queries, use a file:
```bash
wrangler d1 execute wine-cellar-api --file query.sql
```

> **Warning:** `wrangler d1 execute` runs against production by default. There is no undo for writes. Always test queries with SELECT first.

### Diagnostic queries

**Active alerts per user:**
```sql
SELECT u.email, a.batch_id, b.name AS batch_name, a.alert_type, a.fired_at, a.dismissed_at
FROM alert_state a
JOIN users u ON u.id = a.user_id
JOIN batches b ON b.id = a.batch_id
WHERE a.resolved_at IS NULL
ORDER BY u.email, a.fired_at DESC;
```

**Recent readings for a device:**
```sql
SELECT id, batch_id, gravity, temperature, battery, source_timestamp
FROM readings
WHERE device_id = '<DEVICE_ID>'
ORDER BY source_timestamp DESC
LIMIT 20;
```

**Push subscriptions for a user:**
```sql
SELECT id, endpoint, keys_p256dh, created_at
FROM push_subscriptions
WHERE user_id = '<USER_ID>';
```

**Orphaned readings (no batch_id):**
```sql
SELECT r.id, r.device_id, r.gravity, r.temperature, r.source_timestamp, d.name AS device_name
FROM readings r
LEFT JOIN devices d ON d.id = r.device_id
WHERE r.batch_id IS NULL
ORDER BY r.source_timestamp DESC
LIMIT 50;
```

**Batches with no recent readings (active batches with assigned devices):**
```sql
SELECT b.id, b.name, b.stage, d.id AS device_id,
       MAX(r.source_timestamp) AS last_reading,
       ROUND((julianday('now') - julianday(MAX(r.source_timestamp))) * 24, 1) AS hours_ago
FROM batches b
JOIN devices d ON d.batch_id = b.id
LEFT JOIN readings r ON r.batch_id = b.id
WHERE b.status = 'active'
GROUP BY b.id
ORDER BY last_reading ASC;
```

**All users and their batch counts:**
```sql
SELECT u.id, u.email, u.name,
       COUNT(CASE WHEN b.status = 'active' THEN 1 END) AS active_batches,
       COUNT(b.id) AS total_batches
FROM users u
LEFT JOIN batches b ON b.user_id = u.id
GROUP BY u.id;
```

### Manually close or resolve alerts

**Close a specific alert** (stops showing in UI, but will not re-fire until condition clears and re-triggers):
```bash
wrangler d1 execute wine-cellar-api --command \
  "UPDATE alert_state SET dismissed_at = datetime('now') WHERE id = '<ALERT_ID>';"
```

**Resolve a specific alert** (fully clears it; if the condition still holds, it will re-fire on the next cron run):
```bash
wrangler d1 execute wine-cellar-api --command \
  "UPDATE alert_state SET resolved_at = datetime('now') WHERE id = '<ALERT_ID>';"
```

**Resolve all alerts for a batch:**
```bash
wrangler d1 execute wine-cellar-api --command \
  "UPDATE alert_state SET resolved_at = datetime('now')
   WHERE batch_id = '<BATCH_ID>' AND resolved_at IS NULL;"
```

### Manually fix data issues

**Backfill batch_id on orphaned readings** (when you assigned a device after readings arrived):
```bash
wrangler d1 execute wine-cellar-api --command \
  "UPDATE readings
   SET batch_id = '<BATCH_ID>', user_id = '<USER_ID>'
   WHERE device_id = '<DEVICE_ID>'
     AND batch_id IS NULL
     AND source_timestamp >= '<START_TIMESTAMP>'
     AND source_timestamp <= '<END_TIMESTAMP>';"
```

> Always scope the UPDATE with a timestamp range to avoid assigning readings from a different batch period.

**Reassign a device to a different batch:**
```bash
wrangler d1 execute wine-cellar-api --command \
  "UPDATE devices SET batch_id = '<NEW_BATCH_ID>', assigned_at = datetime('now'), updated_at = datetime('now')
   WHERE id = '<DEVICE_ID>';"
```

**Unassign a device (remove from batch):**
```bash
wrangler d1 execute wine-cellar-api --command \
  "UPDATE devices SET batch_id = NULL, assigned_at = NULL, updated_at = datetime('now')
   WHERE id = '<DEVICE_ID>';"
```

### Applying new migrations

Migrations live in `api/migrations/`, numbered sequentially (`0001_initial.sql`, `0002_readings_source.sql`, and so on).

**List applied migrations:**
```bash
wrangler d1 migrations list wine-cellar-api
```

**Apply pending migrations to production:**
```bash
wrangler d1 migrations apply wine-cellar-api
```

**Apply to local dev database:**
```bash
wrangler d1 migrations apply wine-cellar-api --local
```

---

## 4. Deployment issues

### Worker deploy failing

```bash
cd api && wrangler deploy
```

**Common causes:**
- **TypeScript compilation errors:** Fix the build error shown in output.
- **Invalid wrangler.toml:** Check for syntax errors, invalid binding names.
- **Secret not set:** If code references a binding that is a secret (e.g., `WEBHOOK_TOKEN`) and the secret was never set by using `wrangler secret put`, the Worker will still deploy but will fail at runtime when accessing the secret.
- **D1 binding mismatch:** If the `database_id` in wrangler.toml does not match an existing D1 database, deploy might succeed but queries will fail.

### Pages deploy failing

The dashboard deploys to `wine-cellar-dashboard` on Cloudflare Pages. Pushes to the repo trigger deploys.

**Common causes:**
- **Build errors:** Check the Pages build log in the Cloudflare dashboard.
- **Function compilation errors:** Cloudflare compiles Pages Functions (in `dashboard/functions/`) during deploy. TypeScript errors in these files will fail the build.
- **Missing dependencies:** `npm install` failures during the build step.

### Post-deploy verification steps

After deploying either component:

1. **Verify health:**
   ```bash
   curl https://wine-cellar-api.rdrake.workers.dev/health
   ```

2. **Verify dashboard proxy:**
   ```bash
   curl https://<dashboard-domain>/health
   ```

3. **Tail logs for errors:**
   ```bash
   wrangler tail wine-cellar-api --format pretty
   ```

4. **Check the cron is still scheduled:**
   Cloudflare dashboard > Workers and Pages > `wine-cellar-api` > Triggers. Confirm `*/15 * * * *` is present.

5. **Test an authenticated request** by loading the dashboard and confirming data loads.

---

## 5. Cron job

The cron trigger runs every 15 minutes (`*/15 * * * *`), configured in `wrangler.toml` under `[triggers]`.

### What it does

1. Queries all batches with `status = 'active'`.
2. For each batch, fetches the assigned device and up to 200 readings.
3. Evaluates alert conditions (temperature, stall, no_readings, stage_suggestion).
4. Inserts new alerts into `alert_state` (with dedup).
5. Resolves alerts whose conditions no longer hold.
6. Sends push notifications for newly fired alerts.

### Verifying the cron is running

- **Cloudflare dashboard:** Workers and Pages > `wine-cellar-api` > Triggers > Cron Triggers. Shows last invocation time and status.
- **Tail logs:**
  ```bash
  wrangler tail wine-cellar-api --format pretty
  ```
  Wait up to 15 minutes for the next invocation. Cron events appear as `scheduled` event type.

### What happens if the cron fails

- **No data loss.** Readings continue to arrive via webhooks regardless of cron status.
- **Alerts will not fire or resolve** until the cron runs successfully again.
- **Alert evaluation also happens inline** on every webhook POST (for the specific batch receiving the reading), so temperature/stall alerts for active batches with assigned devices still fire on each reading, even if the cron is down.

### Manually triggering alert evaluation

There is no HTTP endpoint to trigger the cron. Options:

1. **Use `wrangler` to call the scheduled handler** (not directly supported). Instead, send a webhook POST for the device to trigger inline evaluation for that batch.

2. **Use the Cloudflare dashboard** to manually trigger the cron: Workers and Pages > `wine-cellar-api` > Triggers > click "Trigger" next to the cron schedule (if available in the UI).

3. **Send a test reading** through the webhook to trigger evaluation for a specific batch:
   ```bash
   curl -X POST https://wine-cellar-api.rdrake.workers.dev/webhook/rapt \
     -H "Content-Type: application/json" \
     -H "X-Webhook-Token: <WEBHOOK_TOKEN>" \
     -d '{"device_id":"<DEVICE_ID>","device_name":"test","gravity":1.050,"temperature":20,"battery":100,"rssi":-50,"created_date":"2026-03-21T00:00:00Z"}'
   ```
   > **Caution:** This inserts a real reading. Use a realistic timestamp and gravity so it does not skew data.

---

## 6. Secret rotation

### Rotating VAPID keys

**Impact:** All existing push subscriptions become invalid. Every user must re-subscribe to push notifications (toggle in settings). Push sends to old subscriptions will return `401` or `403` and the subscriptions will be auto-deleted.

**Steps:**

1. Generate a new VAPID key pair (P-256 ECDH).
2. Set the new keys:
   ```bash
   wrangler secret put VAPID_PUBLIC_KEY
   # Paste base64url-encoded 65-byte uncompressed public key

   wrangler secret put VAPID_PRIVATE_KEY
   # Paste base64url-encoded 32-byte private scalar (d)
   ```
3. Deploy the Worker (secrets take effect on next deploy or after a few minutes):
   ```bash
   cd api && wrangler deploy
   ```
4. Optionally, clean up all now-invalid subscriptions:
   ```bash
   wrangler d1 execute wine-cellar-api --command \
     "DELETE FROM push_subscriptions;"
   ```
5. Tell users to re-enable push notifications.

### Rotating WEBHOOK_TOKEN

**Impact:** You must update the RAPT cloud (or any webhook source) with the new token, or all webhook POSTs will return `401`.

**Steps:**

1. Generate a new random token.
2. Set it on the Worker:
   ```bash
   wrangler secret put WEBHOOK_TOKEN
   # Paste the new token
   ```
3. Update the RAPT cloud webhook configuration with the new token.
4. Deploy the Worker:
   ```bash
   cd api && wrangler deploy
   ```
5. Verify a webhook arrives successfully (check readings table or tail logs).

### Rotating CF_ACCESS_AUD

**Impact:** If the Cloudflare Access application audience tag changes (e.g., someone recreated the app), all JWT verification will fail until you update the Worker secret.

**Steps:**

1. Get the new AUD tag from Cloudflare Zero Trust dashboard > Access > Applications.
2. Set it on the Worker:
   ```bash
   wrangler secret put CF_ACCESS_AUD
   # Paste the new AUD tag
   ```
3. Deploy:
   ```bash
   cd api && wrangler deploy
   ```
4. Verify by loading the dashboard and confirming authenticated requests succeed.

---

## 7. Useful wrangler commands

Run all commands from the `api/` directory (or use `--config api/wrangler.toml`).

| Task | Command |
|------|---------|
| Deploy the API Worker | `wrangler deploy` |
| Tail live logs | `wrangler tail wine-cellar-api --format pretty` |
| Query production D1 | `wrangler d1 execute wine-cellar-api --command "<SQL>"` |
| Query local D1 | `wrangler d1 execute wine-cellar-api --local --command "<SQL>"` |
| Run SQL file against D1 | `wrangler d1 execute wine-cellar-api --file <path>.sql` |
| List applied migrations | `wrangler d1 migrations list wine-cellar-api` |
| Apply pending migrations | `wrangler d1 migrations apply wine-cellar-api` |
| Apply migrations locally | `wrangler d1 migrations apply wine-cellar-api --local` |
| Set a secret | `wrangler secret put <SECRET_NAME>` |
| List secrets | `wrangler secret list` |
| Start local dev server | `wrangler dev` |
| Check Worker status | Cloudflare dashboard > Workers and Pages > `wine-cellar-api` |
