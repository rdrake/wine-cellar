# Push Alerts and Stage Transitions Design

## Overview

Add server-side fermentation alert evaluation with OS-native push notifications via the Web Push API. Add stage suggestion alerts that nudge the user to advance when conditions indicate readiness. Relax stage transitions to allow backward movement.

## Data Model

### New tables

**`push_subscriptions`** — one row per browser/device per user.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| user_id | TEXT FK → users | |
| endpoint | TEXT UNIQUE | Web Push endpoint URL |
| keys_p256dh | TEXT | Browser public key |
| keys_auth | TEXT | Auth secret |
| created_at | TEXT | ISO 8601 |

**`alert_state`** — tracks fired alerts with three-state lifecycle: active → dismissed/resolved.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| user_id | TEXT FK → users | |
| batch_id | TEXT FK → batches | |
| alert_type | TEXT | stall, no_readings, temp_high, temp_low, stage_suggestion |
| context | TEXT NULL | JSON — observed values, next_stage for suggestions |
| fired_at | TEXT | When alert was pushed |
| dismissed_at | TEXT NULL | Set when user dismisses (suppresses re-fire) |
| resolved_at | TEXT NULL | Set when condition clears naturally |

Partial unique index enforced by the database:
```sql
CREATE UNIQUE INDEX idx_alert_one_active
  ON alert_state (user_id, batch_id, alert_type)
  WHERE resolved_at IS NULL AND dismissed_at IS NULL;
```

This prevents webhook/cron race conditions from double-inserting alerts.

### Schema changes to existing tables

Add `target_gravity` to batches (needed for secondary→stabilization suggestion rule):

```sql
ALTER TABLE batches ADD COLUMN target_gravity REAL;
```

### Alert lifecycle

1. Condition detected → `INSERT OR IGNORE` into `alert_state` (partial unique index prevents duplicates). If inserted, send push notification.
2. If row already exists (active or dismissed) → skip.
3. On subsequent evaluation, if condition has cleared → set `resolved_at` on the row. Clears both active and dismissed rows, so the alert can fire again if the condition recurs.
4. User dismisses → set `dismissed_at`. Alert stays in the table (won't re-fire) until the condition clears and `resolved_at` is set.

## Alert Types

| Type | Trigger | Condition |
|------|---------|-----------|
| `stall` | webhook + cron | Gravity > 1.005 AND 48h velocity < 0.0005 SG/day |
| `no_readings` | cron only | No device reading (`source='device'`) in 48h for batch with assigned device |
| `temp_high` | webhook + cron | Latest temperature >= 30°C |
| `temp_low` | webhook + cron | Latest temperature <= 8°C |
| `stage_suggestion` | webhook + cron | Stage-specific rules (see below) |

Alert evaluation includes both device and manual SG readings for stall detection and stage suggestions. The `no_readings` alert only considers `source='device'` — manual entries don't prove the hydrometer is working.

## Stage Suggestion Rules

Conservative — only two transitions get auto-suggestions. Both require >= 10 readings.

**Primary Fermentation → Secondary Fermentation:**
- Gravity below 1.020
- Velocity slowed to < 50% of 7-day average

**Secondary Fermentation → Stabilization:**
- Gravity stable (< 0.001 SG change over 72 hours)
- Gravity below 1.000, or within 0.002 of batch `target_gravity` if set

**Not auto-suggested:** must_prep → primary (manual yeast pitch), stabilization → bottling (too variable — fining, cold crash, taste).

## Trigger Paths

### Webhook-triggered (on reading insert)

After the webhook inserts a reading and the device has a batch assigned, evaluate that batch for: stall, temp_high, temp_low, stage_suggestion. Runs inline — fast since data is already in hand.

### Cron-triggered (every 15 minutes)

Cloudflare Cron Trigger on the existing worker. Queries all active batches, evaluates all five alert types. Catches `no_readings` (no incoming data to trigger webhook) and serves as a sweep for anything the webhook path missed.

Configured in `wrangler.toml`:
```toml
[triggers]
crons = ["*/15 * * * *"]
```

## Push Notification Delivery

### VAPID keys

Generate a VAPID key pair. Public key served via `GET /api/v1/push/vapid-key`. Private key stored as wrangler secret `VAPID_PRIVATE_KEY`. Implement Web Push protocol directly using `crypto.subtle` (the `web-push` npm package requires Node.js APIs not available in Workers).

### Subscription management

- `POST /api/v1/push/subscribe` — store subscription (endpoint + keys). Upsert on endpoint.
- `DELETE /api/v1/push/subscribe` — remove subscription. Request body: `{ "endpoint": "https://..." }` to identify which browser/device.

Toggle state is determined client-side via `registration.pushManager.getSubscription()` — no server-side status endpoint needed. Each browser knows whether it is subscribed.

### Notification payloads

Sent via Web Push protocol from the worker. No third-party push service needed.

**Informational alerts** (stall, no_readings, temp_high, temp_low):
```json
{
  "title": "Merlot Enhanced — Temperature High",
  "body": "30.5°C at 2:15 PM. Consider cooling.",
  "url": "/batches/abc123",
  "type": "temp_high",
  "alertId": "uuid-of-alert-state-row"
}
```

**Stage suggestions:**
```json
{
  "title": "Merlot Enhanced — Ready for Secondary?",
  "body": "Gravity at 1.012, velocity slowing. Consider racking.",
  "url": "/batches/abc123?action=advance&stage=secondary_fermentation",
  "type": "stage_suggestion",
  "alertId": "uuid-of-alert-state-row",
  "batchId": "abc123",
  "nextStage": "secondary_fermentation",
  "actions": [
    { "action": "advance", "title": "Advance Now" },
    { "action": "dismiss", "title": "Dismiss" }
  ]
}
```

### Service worker handling

`sw.js` receives push events and displays OS-native notifications. Since the service worker cannot make authenticated API calls (no Cloudflare Access session), all actions open the app:

- **"Advance Now"** → opens `/batches/:id?action=advance&stage=secondary_fermentation`. The batch detail page detects the query params and triggers the stage transition.
- **"Dismiss"** → opens `/batches/:id?action=dismiss&alertId=xyz`. The batch detail page calls the dismiss endpoint.
- **Default tap** → opens batch detail page.

## Stage Transitions

### Replace advance with flexible stage endpoint

Remove `POST /:batchId/advance`. Add `POST /:batchId/stage`:

```json
{ "stage": "secondary_fermentation" }
```

- Accepts any of the 5 batch waypoints (must_prep, primary_fermentation, secondary_fermentation, stabilization, bottling) — forward or backward.
- Only works on `active` batches.
- Auto-logs an activity: type `note`, title "Stage changed from X to Y".
- Resolves any `stage_suggestion` alert for that batch.

Keep `POST /:batchId/advance` as a thin wrapper that computes the next stage and calls the same logic. Reduces frontend and test churn during migration.

### UI changes

The "Advance Stage" button in BatchDetail becomes a dropdown/selector showing all 5 waypoints with the next stage pre-selected. Backward movement available but not prominent.

## Dashboard changes

Replace client-side `deriveAlerts()` with server-derived alerts. The `/api/v1/dashboard` endpoint returns an `alerts` array from `alert_state` (where `resolved_at IS NULL AND dismissed_at IS NULL`). The dashboard renders these directly. Add a dismiss action on each alert card.

## Settings UI

Push notifications toggle on the Settings page:
1. User taps toggle → browser permission prompt.
2. If granted → subscribe via Push API → `POST /api/v1/push/subscribe`.
3. Toggle state from `registration.pushManager.getSubscription()` (device-local, not server).
4. Toggle off → unsubscribe via Push API → `DELETE /api/v1/push/subscribe` with endpoint in body.

Single on/off for now. Per-type toggles can be added later by extending `push_subscriptions` with a `disabled_types` JSON column.

## API Endpoints Summary

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/v1/push/vapid-key | Public VAPID key for subscription |
| POST | /api/v1/push/subscribe | Register push subscription |
| DELETE | /api/v1/push/subscribe | Remove push subscription (endpoint in body) |
| POST | /api/v1/batches/:id/stage | Set batch stage (any direction) |
| POST | /api/v1/batches/:id/advance | Thin wrapper — computes next stage, calls stage logic |
| POST | /api/v1/alerts/:id/dismiss | Manually dismiss an alert |

## Dependencies

- VAPID key pair (generated once, stored as secrets)
- Web Push protocol implemented directly with `crypto.subtle` (no npm dependency)
- Cron Trigger (wrangler.toml config)

## Testing

- Unit tests for alert evaluation logic (stall detection, temp thresholds, stage suggestion rules)
- Integration tests for alert lifecycle (fire → dedup → dismiss → resolve → re-fire)
- Integration tests for push subscription CRUD
- Integration tests for stage transition (forward, backward, activity logging)
- Integration tests for flexible stage endpoint + advance wrapper
- Cron handler test with mocked push delivery
- Service worker push event handling (manual verification)
