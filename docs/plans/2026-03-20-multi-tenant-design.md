# Multi-Tenant via Cloudflare Access — Design

## Goal

Turn the single-tenant wine cellar into a shared instance where multiple users each see only their own data. Cloudflare Access handles authentication. No API keys, no passwords, no registration UI.

## Architecture

Cloudflare Access sits in front of both the API Worker and the Pages dashboard. Unauthenticated requests never reach the app. Every authenticated request carries a signed JWT with the user's email. The API middleware extracts the email, upserts a `users` row, and sets the user on the Hono context. Every data query filters by `user_id`.

The dashboard drops its Setup page, localStorage key storage, and `X-API-Key` header injection. It just calls the API with `credentials: "include"` — Access handles auth via cookies.

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
- `devices`

`readings` inherits isolation through `batch_id` and `device_id` — no `user_id` column needed.

## Auth middleware

Replace `apiKeyAuth` with Cloudflare Access JWT handling:

```typescript
async function accessAuth(c, next) {
  const jwt = c.req.header("Cf-Access-Jwt-Assertion");
  if (!jwt) return c.json({ error: "Unauthorized" }, 401);

  const payload = decodeJwt(jwt);
  const email = payload.email;

  // Upsert user — first visit auto-creates account
  const user = await db.prepare(
    `INSERT INTO users (id, email, created_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(email) DO UPDATE SET email = email
     RETURNING *`
  ).bind(crypto.randomUUID(), email).first();

  c.set("user", user);
  await next();
}
```

**Exceptions:**
- `/webhook/rapt` — keeps `X-Webhook-Token` auth (devices don't go through Access)
- `/health` — unauthenticated
- No need to verify JWT signature — Cloudflare Access already validated it at the edge; requests can't reach the Worker without passing Access

## Data isolation

Every route handler gets the user from context and scopes queries:

```typescript
// List batches
db.prepare("SELECT * FROM batches WHERE user_id = ? ORDER BY ...").bind(user.id)

// Get single batch — returns 404 (not 403) if not yours
db.prepare("SELECT * FROM batches WHERE id = ? AND user_id = ?").bind(id, user.id)

// Create batch — auto-set user_id
db.prepare("INSERT INTO batches (id, user_id, ...) VALUES (?, ?, ...)").bind(newId, user.id, ...)

// Readings by batch — verify batch ownership
db.prepare(`
  SELECT r.* FROM readings r
  JOIN batches b ON r.batch_id = b.id
  WHERE r.batch_id = ? AND b.user_id = ?
`).bind(batchId, user.id)
```

Devices: scoped by `user_id`. Webhook writes look up device by hardware ID, device has `user_id`, reading gets associated correctly.

## Migration

Single migration file:

```sql
-- 1. Create users table
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Seed owner account
INSERT INTO users (id, email, name)
VALUES ('owner-uuid', 'richard@example.com', 'Richard');

-- 3. Add user_id to existing tables, backfill, rebuild as NOT NULL
ALTER TABLE batches ADD COLUMN user_id TEXT REFERENCES users(id);
UPDATE batches SET user_id = 'owner-uuid';
-- Rebuild with NOT NULL (SQLite limitation)
CREATE TABLE batches_new AS SELECT * FROM batches;
DROP TABLE batches;
ALTER TABLE batches_new RENAME TO batches;
-- Repeat for activities, devices
```

All existing data becomes Richard's. New users start fresh.

## Dashboard changes

**Remove:**
- `pages/Setup.tsx` — no more API key entry
- `localStorage` key storage (`STORAGE_KEY_URL`, `STORAGE_KEY_KEY`)
- `X-API-Key` header injection in `api.ts`
- `AuthGuard` component (Access handles this)
- "Disconnect" button in Settings

**Modify:**
- `api.ts` — simplify `apiFetch()` to just `fetch(url, { credentials: "include" })`. The API URL becomes a build-time env var or relative path (both dashboard and API behind the same Access domain).
- `App.tsx` — remove Setup route and AuthGuard wrapper

**Add:**
- User display in header or settings (show email from a `/me` endpoint)

## Cloudflare Access setup

Script using Cloudflare API (run once):

```bash
# Get account ID and zone ID
CF_API_TOKEN="your-token"
CF_ACCOUNT_ID="your-account-id"

# Create Access application for the API
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/access/apps" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Wine Cellar",
    "domain": "wine-cellar-api.rdrake.workers.dev",
    "type": "self_hosted",
    "session_duration": "720h",
    "allowed_idps": [],
    "auto_redirect_to_identity": false
  }'

# Create Access policy — allow specific emails or any email
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/access/apps/{app-id}/policies" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Allow users",
    "decision": "allow",
    "include": [{ "email_domain": { "domain": "gmail.com" } }]
  }'
```

Policy can be narrowed to specific emails or opened to any email domain.

## Webhook handling

RAPT Pill webhooks bypass Cloudflare Access (they come from device firmware, not a browser). The webhook route keeps its existing `X-Webhook-Token` auth. The webhook handler looks up the device by hardware ID, the device has a `user_id`, so readings get associated to the correct user.

Access must be configured to exclude the `/webhook/*` path from authentication.

## What stays the same

- All fermentation logic, calculators, batch lifecycle
- ReadingsChart, Sparkline, all UI components
- Device management within Settings
- Export functionality
- The Tufte design we just shipped
