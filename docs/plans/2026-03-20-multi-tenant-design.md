# Multi-Tenant via Cloudflare Access — Design (v2)

> Revised to address codex review findings: safe migration, JWT verification,
> same-origin architecture, device claim flow, complete route inventory.

## Goal

Turn the single-tenant wine cellar into a shared instance where multiple users each see only their own data. Cloudflare Access handles authentication. No API keys, no passwords, no registration UI.

## Architecture

**Same-origin deployment.** The dashboard and API are served from the same domain to avoid CORS preflight issues with Cloudflare Access cookies. Two options:

- **Option A (recommended):** Deploy dashboard as Cloudflare Pages, mount the API Worker as a Pages Function under `/api/*`. Single domain, zero CORS.
- **Option B:** Use a Cloudflare Worker route to proxy `/api/*` to the API Worker from the Pages domain.

Cloudflare Access protects the single domain. Unauthenticated requests get redirected to the Access login page. Every authenticated request carries a `Cf-Access-Jwt-Assertion` JWT. The API middleware **verifies the JWT signature** against Cloudflare's JWKS, extracts the email, upserts a `users` row, and sets the user on the Hono context. Every data query filters by `user_id`.

The dashboard drops its Setup page, localStorage key storage, and `X-API-Key` header. API calls become relative paths (`/api/v1/batches`) — no CORS, no `credentials: "include"` needed.

## Schema

### New table

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Modified tables

Add `user_id TEXT NOT NULL REFERENCES users(id)` to:
- `batches`
- `activities`
- `devices` (nullable — see Device Claim Flow)

`readings` gets `user_id TEXT NOT NULL REFERENCES users(id)` directly. This is necessary because:
- `readings.device_id` has no FK to `devices.id` in the current schema
- Manual readings use synthetic `"manual"` device IDs
- Relying on app-enforced ancestry is insufficient for tenant isolation

### Indexes

```sql
CREATE INDEX idx_batches_user ON batches(user_id);
CREATE INDEX idx_activities_user ON activities(user_id);
CREATE INDEX idx_devices_user ON devices(user_id);
CREATE INDEX idx_readings_user ON readings(user_id, source_timestamp DESC);
```

## Auth middleware

Replace `apiKeyAuth` with Cloudflare Access JWT verification:

```typescript
import { createMiddleware } from "hono/factory";

export const accessAuth = createMiddleware<{ Bindings: Bindings; Variables: { user: User } }>(
  async (c, next) => {
    const path = new URL(c.req.url).pathname;

    // Skip auth for health and webhooks
    if (path === "/health" || path.startsWith("/webhook")) {
      return next();
    }

    const jwt = c.req.header("Cf-Access-Jwt-Assertion");
    if (!jwt) return c.json({ error: "unauthorized" }, 401);

    // Verify JWT signature against Cloudflare JWKS
    const payload = await verifyAccessJwt(jwt, c.env.CF_ACCESS_AUD);
    if (!payload) return c.json({ error: "unauthorized" }, 401);

    // Upsert user
    const db = c.env.DB;
    const user = await db.prepare(
      `INSERT INTO users (id, email, created_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(email) DO UPDATE SET email = email
       RETURNING *`
    ).bind(crypto.randomUUID(), payload.email).first();

    c.set("user", user);
    await next();
  }
);
```

### JWT verification

```typescript
async function verifyAccessJwt(token: string, aud: string): Promise<{ email: string } | null> {
  // Decode header to get kid
  const [headerB64] = token.split(".");
  const header = JSON.parse(atob(headerB64));

  // Fetch JWKS from Cloudflare (cache in practice)
  const certsUrl = `https://${TEAM_DOMAIN}.cloudflareaccess.com/cdn-cgi/access/certs`;
  const resp = await fetch(certsUrl);
  const { keys } = await resp.json();
  const jwk = keys.find((k: any) => k.kid === header.kid);
  if (!jwk) return null;

  // Import key and verify
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const [hdr, payload, sig] = token.split(".");
  const data = new TextEncoder().encode(`${hdr}.${payload}`);
  const signature = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
  if (!valid) return null;

  // Check claims
  const claims = JSON.parse(atob(payload));
  if (claims.aud?.includes(aud) === false) return null;
  if (claims.exp < Date.now() / 1000) return null;

  return { email: claims.email };
}
```

### New env vars

Add to `Bindings`:
- `CF_ACCESS_AUD` — the Access Application Audience tag (from Access dashboard)
- `CF_ACCESS_TEAM` — your Cloudflare Access team domain (e.g., `myteam`)

Remove:
- `API_KEY` — no longer used

Keep:
- `WEBHOOK_TOKEN` — still used for RAPT Pill webhooks

## Device claim flow

**Problem:** Webhooks auto-register unknown devices, but with `user_id NOT NULL` there's no user context during a webhook call.

**Solution:** Two-phase device ownership.

1. **Webhook auto-registers device with `user_id = NULL`** (unclaimed state). The device and its readings exist but belong to no user.

2. **User claims a device** via a new dashboard flow: Settings shows unclaimed devices (those with `user_id IS NULL`). User enters their device's hardware ID or selects from unclaimed list. Claiming sets `user_id` on the device and backfills `user_id` on all its existing readings.

3. **Schema:** `devices.user_id` is **nullable**. Unclaimed devices are invisible to normal queries (all device queries filter `WHERE user_id = ?`). A dedicated `/api/v1/devices/claim` endpoint handles the claim.

```typescript
// POST /api/v1/devices/claim { device_id: "pill-abc-123" }
app.post("/claim", async (c) => {
  const user = c.get("user");
  const { device_id } = await c.req.json();

  // Check device exists and is unclaimed
  const device = await db.prepare("SELECT * FROM devices WHERE id = ? AND user_id IS NULL").bind(device_id).first();
  if (!device) return c.json({ error: "Device not found or already claimed" }, 404);

  // Claim device + backfill readings
  await db.batch([
    db.prepare("UPDATE devices SET user_id = ?, updated_at = ? WHERE id = ?").bind(user.id, now, device_id),
    db.prepare("UPDATE readings SET user_id = ? WHERE device_id = ? AND user_id IS NULL").bind(user.id, device_id),
  ]);

  return c.json({ status: "claimed" });
});
```

## Data isolation — complete route inventory

Every query in every route file needs `user_id` scoping. Full list:

### `batches.ts` (13 queries)
- `GET /` list — add `WHERE user_id = ?`
- `GET /:id` — add `AND user_id = ?`
- `POST /` create — set `user_id` on insert
- `PATCH /:id` update — add `AND user_id = ?`
- `DELETE /:id` — add `AND user_id = ?`
- `POST /:id/advance` — ownership check before stage change
- `POST /:id/complete` — ownership check
- `POST /:id/abandon` — ownership check
- `POST /:id/archive` — ownership check
- `POST /:id/unarchive` — ownership check
- Device unassign helper — verify batch ownership

### `activities.ts` (13 queries)
- `GET /` list — verify batch ownership via join
- `POST /` create — verify batch ownership, set `user_id` on activity
- `PATCH /:activityId` — verify activity + batch ownership
- `DELETE /:activityId` — verify activity + batch ownership
- Linked reading insert/update/delete — set `user_id` on reading

### `readings.ts` (4 queries)
- `GET /api/v1/batches/:batchId/readings` — verify batch ownership
- `GET /api/v1/devices/:deviceId/readings` — verify device ownership

### `devices.ts` (11 queries)
- `GET /` list — add `WHERE user_id = ?`
- `POST /` register — set `user_id`
- `POST /:id/assign` — verify device AND batch ownership
- `POST /:id/unassign` — verify device ownership
- `POST /claim` — new endpoint (see above)

### `dashboard.ts` (4 queries)
- Active batches query — add `WHERE user_id = ? AND status = 'active'`
- Readings per batch — already scoped through batch ownership
- Velocity subquery — already scoped through batch
- Recent activities — add `AND b.user_id = ?` to the join

### `webhook.ts` (3 queries)
- Device lookup — unchanged (no user filter, webhook is global)
- Device auto-register — insert with `user_id = NULL`
- Reading insert — set `user_id` from `device.user_id` (NULL if unclaimed)

## Migration

Uses the proper SQLite migration pattern: create new table with full DDL, copy data, drop old, rename. Preserves all constraints, indexes, and foreign keys.

```sql
-- 0004_multi_tenant.sql

-- 1. Create users table
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Seed owner account (replace with your actual email)
INSERT INTO users (id, email, name)
VALUES ('owner-uuid-here', 'you@example.com', 'Richard');

-- 3. Migrate batches — full DDL rebuild
CREATE TABLE batches_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
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
INSERT INTO batches_new SELECT 'owner-uuid-here', id, name, wine_type, source_material, stage, status, volume_liters, target_volume_liters, started_at, completed_at, notes, created_at, updated_at FROM batches;

-- Wait — INSERT column order must match. Use explicit columns:
-- Actually, the above is wrong. Let me fix:
DROP TABLE batches_new;

CREATE TABLE batches_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
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

INSERT INTO batches_new (id, user_id, name, wine_type, source_material, stage, status, volume_liters, target_volume_liters, started_at, completed_at, notes, created_at, updated_at)
  SELECT id, 'owner-uuid-here', name, wine_type, source_material, stage, status, volume_liters, target_volume_liters, started_at, completed_at, notes, created_at, updated_at
  FROM batches;

DROP TABLE batches;
ALTER TABLE batches_new RENAME TO batches;
CREATE INDEX idx_batches_user ON batches(user_id);

-- 4. Migrate activities — full DDL rebuild
CREATE TABLE activities_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
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
  details TEXT,
  reading_id TEXT REFERENCES readings(id) ON DELETE SET NULL,
  recorded_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO activities_new (id, user_id, batch_id, stage, type, title, details, reading_id, recorded_at, created_at, updated_at)
  SELECT id, 'owner-uuid-here', batch_id, stage, type, title, details, reading_id, recorded_at, created_at, updated_at
  FROM activities;

DROP TABLE activities;
ALTER TABLE activities_new RENAME TO activities;
CREATE INDEX idx_activities_batch_recorded ON activities(batch_id, recorded_at);
CREATE INDEX idx_activities_user ON activities(user_id);

-- 5. Migrate devices — user_id NULLABLE for unclaimed devices
ALTER TABLE devices ADD COLUMN user_id TEXT REFERENCES users(id);
UPDATE devices SET user_id = 'owner-uuid-here';
CREATE INDEX idx_devices_user ON devices(user_id);

-- 6. Migrate readings — add user_id
ALTER TABLE readings ADD COLUMN user_id TEXT REFERENCES users(id);
UPDATE readings SET user_id = 'owner-uuid-here';
CREATE INDEX idx_readings_user ON readings(user_id, source_timestamp DESC);
```

Note: `devices.user_id` and `readings.user_id` are nullable at the schema level to support unclaimed devices and their readings. Application code enforces non-null for user-scoped queries.

## Dashboard changes

**Remove:**
- `pages/Setup.tsx` — no more API key entry
- `components/AuthGuard.tsx` — Access handles gate
- `localStorage` key storage in `api.ts` (`STORAGE_KEY_URL`, `STORAGE_KEY_KEY`, `getApiConfig`, `setApiConfig`, `clearApiConfig`, `isConfigured`)
- `X-API-Key` header injection in `apiFetch()`
- `window.location.replace("/setup")` redirect on 401
- `api.test.ts` — localStorage/API-key tests (rewrite for new auth)
- `ConnectionSection` in Settings (no API URL config needed)
- "Disconnect" button removed in prior commit

**Modify:**
- `api.ts` — `apiFetch()` simplifies to `fetch("/api/v1/..." + path)`. Relative URLs, no headers needed. On 401, redirect to Access login (or just let Access handle it).
- `App.tsx` — remove Setup route (`/setup`), remove `AuthGuard` wrapper, remove `Setup` import
- `Settings.tsx` — remove ConnectionSection, add device claim UI

**Add:**
- Device claim flow in Settings — input for device hardware ID, "Claim" button
- User email display in Layout header (from `/api/v1/me` endpoint)

## API changes

**Remove:**
- `middleware/auth.ts` — replaced by `middleware/access.ts`
- `API_KEY` from `Bindings` type in `app.ts`
- `X-API-Key` from CORS `allowHeaders`
- CORS middleware entirely (same-origin, not needed)

**Modify:**
- `app.ts` — new `Bindings` type with `CF_ACCESS_AUD`, `CF_ACCESS_TEAM`. Use `accessAuth` middleware.
- Every route file — add `user_id` scoping per the inventory above

**Add:**
- `middleware/access.ts` — JWT verification middleware
- `GET /api/v1/me` — returns current user email/name
- `POST /api/v1/devices/claim` — device claim endpoint

**Test changes:**
- `helpers.ts` — replace `API_HEADERS` with mock `Cf-Access-Jwt-Assertion` header
- `vitest.config.ts` — replace `API_KEY` env with `CF_ACCESS_AUD`, `CF_ACCESS_TEAM`
- All test files using `API_HEADERS` — update to new auth header
- Add user seeding to `applyMigrations()` test helper
- Add tenant isolation tests (user A can't see user B's data)

## Cloudflare Access setup

Script using Cloudflare API (run once):

```bash
CF_API_TOKEN="your-token"
CF_ACCOUNT_ID="your-account-id"
DOMAIN="wine-cellar-dashboard.pages.dev"  # single domain for both

# Create Access application
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/access/apps" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Wine Cellar",
    "domain": "'$DOMAIN'",
    "type": "self_hosted",
    "session_duration": "720h",
    "auto_redirect_to_identity": false,
    "path_cookie_attribute": true
  }'

# Create bypass policy for webhooks (must come FIRST — policies evaluated in order)
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/access/apps/{app-id}/policies" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Bypass webhooks",
    "decision": "bypass",
    "include": [{ "any_valid_service_token": {} }],
    "precedence": 1
  }'

# Create allow policy for users
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/access/apps/{app-id}/policies" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Allow users",
    "decision": "allow",
    "include": [{ "everyone": true }],
    "precedence": 2
  }'
```

The webhook bypass ensures `/webhook/rapt` is reachable without Access cookies. The "everyone" allow policy lets any email log in — narrow to specific domains/emails if desired.

## Webhook handling

RAPT Pill webhooks bypass Cloudflare Access. The webhook route keeps `X-Webhook-Token` auth.

Updated flow:
1. Webhook receives reading from RAPT Pill
2. Look up device by hardware ID
3. **If device unknown:** auto-register with `user_id = NULL` (unclaimed)
4. **If device known:** get `user_id` from device (may be NULL if unclaimed)
5. Insert reading with `user_id` from device (NULL if unclaimed)
6. User later claims device via dashboard — backfills `user_id` on device + readings

## What stays the same

- All fermentation logic, calculators, batch lifecycle
- ReadingsChart, Sparkline, all UI components
- Device assign/unassign within batches
- Export functionality
- The Tufte design we just shipped
