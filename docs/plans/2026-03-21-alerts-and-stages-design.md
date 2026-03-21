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

**`alert_state`** — tracks fired alerts for "fire once until resolved" dedup.

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| user_id | TEXT FK → users | |
| batch_id | TEXT FK → batches | |
| alert_type | TEXT | stall, no_readings, temp_high, temp_low, stage_suggestion |
| fired_at | TEXT | When alert was pushed |
| resolved_at | TEXT NULL | Set when condition clears |

Unique constraint on `(user_id, batch_id, alert_type)` where `resolved_at IS NULL` — enforced by application logic (SQLite lacks partial unique indexes).

### No changes to existing tables

Stage flexibility is a validation change, not a schema change.

## Alert Types

| Type | Trigger | Condition |
|------|---------|-----------|
| `stall` | webhook + cron | Gravity > 1.005 AND 48h velocity < 0.0005 SG/day |
| `no_readings` | cron only | No reading in 48h for batch with assigned device |
| `temp_high` | webhook + cron | Latest temperature >= 30°C |
| `temp_low` | webhook + cron | Latest temperature <= 8°C |
| `stage_suggestion` | webhook + cron | Stage-specific rules (see below) |

### Alert lifecycle

1. Condition detected → check `alert_state` for unresolved row with same `(user_id, batch_id, alert_type)`.
2. If none exists → insert row, send push notification.
3. If one exists → skip (already notified).
4. On subsequent evaluation, if condition has cleared → set `resolved_at`. Alert can fire again if condition recurs.

## Stage Suggestion Rules

Conservative — only two transitions get auto-suggestions. Both require ≥10 readings.

**Primary Fermentation → Secondary Fermentation:**
- Gravity below 1.020
- Velocity slowed to < 50% of 7-day average

**Secondary Fermentation → Stabilization:**
- Gravity stable (< 0.001 SG change over 72 hours)
- Gravity below 1.000, or within 0.002 of batch target gravity if set

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

Generate a VAPID key pair. Public key served via `GET /api/v1/push/vapid-key`. Private key stored as wrangler secret `VAPID_PRIVATE_KEY`.

### Subscription management

- `POST /api/v1/push/subscribe` — store subscription (endpoint + keys). Upsert on endpoint.
- `DELETE /api/v1/push/subscribe` — remove subscription (opt out).
- `GET /api/v1/push/status` — returns `{ enabled: true/false }` based on whether user has any subscriptions.

### Notification payloads

Sent via Web Push protocol from the worker. No third-party push service needed.

**Informational alerts** (stall, no_readings, temp_high, temp_low):
```json
{
  "title": "Merlot Enhanced — Temperature High",
  "body": "30.5°C at 2:15 PM. Consider cooling.",
  "url": "/batches/abc123",
  "type": "temp_high"
}
```

**Stage suggestions:**
```json
{
  "title": "Merlot Enhanced — Ready for Secondary?",
  "body": "Gravity at 1.012, velocity slowing. Consider racking.",
  "url": "/batches/abc123",
  "type": "stage_suggestion",
  "actions": [
    { "action": "advance", "title": "Advance Now" },
    { "action": "dismiss", "title": "Dismiss" }
  ]
}
```

### Service worker handling

`sw.js` receives push events, displays OS-native notification. Action button clicks:
- "Advance Now" → `POST /api/v1/batches/:id/stage` with next stage, then open batch detail.
- "Dismiss" → `POST /api/v1/alerts/:id/dismiss` to resolve the alert_state row.
- Default tap → open batch detail page.

## Stage Transitions

### Replace advance with flexible stage endpoint

Remove `POST /:batchId/advance`. Add `POST /:batchId/stage`:

```json
{ "stage": "secondary_fermentation" }
```

- Accepts any valid stage (forward or backward).
- Only works on `active` batches.
- Auto-logs an activity: type `note`, title "Stage changed from X to Y".
- Resolves any `stage_suggestion` alert for that batch.

### UI changes

The "Advance Stage" button in BatchDetail becomes a dropdown/selector showing all stages with the next stage pre-selected. Backward movement available but not prominent.

## Settings UI

Push notifications toggle on the Settings page:
1. User taps toggle → browser permission prompt.
2. If granted → subscribe to push via Push API → `POST /api/v1/push/subscribe`.
3. Toggle reflects subscription state via `GET /api/v1/push/status`.
4. Toggle off → `DELETE /api/v1/push/subscribe`.

Single on/off for now. Per-type toggles can be added later by extending `push_subscriptions` with a `disabled_types` JSON column.

## API Endpoints Summary

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/v1/push/vapid-key | Public VAPID key for subscription |
| POST | /api/v1/push/subscribe | Register push subscription |
| DELETE | /api/v1/push/subscribe | Remove push subscription |
| GET | /api/v1/push/status | Check if user has push enabled |
| POST | /api/v1/batches/:id/stage | Set batch stage (any direction) |
| POST | /api/v1/alerts/:id/dismiss | Manually dismiss an alert |

## Dependencies

- `web-push` npm package (or raw Web Push protocol implementation — the crypto is straightforward in Workers)
- VAPID key pair (generated once, stored as secrets)
- Cron Trigger (wrangler.toml config)

## Testing

- Unit tests for alert evaluation logic (stall detection, temp thresholds, stage suggestion rules)
- Integration tests for alert lifecycle (fire → dedup → resolve → re-fire)
- Integration tests for push subscription CRUD
- Integration tests for stage transition (forward, backward, activity logging)
- Cron handler test with mocked push delivery
- Service worker push event handling (manual verification)
