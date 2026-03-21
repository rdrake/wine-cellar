# Multi-Tenant Implementation Plan (v2)

> Revised to address codex review findings: FK-safe migration ordering, readings
> query scoping, webhook Access bypass, rollout sequencing, test gap coverage.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the single-tenant wine cellar into a shared multi-tenant instance using Cloudflare Access for auth, with user_id scoping on all data queries.

**Architecture:** Cloudflare Access JWT → middleware extracts email → upserts user → sets on Hono context → every query filters by user_id. Dashboard drops API key auth, uses relative URLs. Same-origin deployment via Pages Functions proxy.

**Tech Stack:** Hono, Cloudflare D1, Cloudflare Access JWT (RSASSA-PKCS1-v1_5), Vitest + Workers pool, React + Vite

---

## Phase 1: API Backend

### Task 1: Database Migration

**Files:**
- Create: `api/migrations/0004_multi_tenant.sql`

**Step 1: Write the migration SQL**

**CRITICAL: FK-safe ordering.** D1 enforces foreign keys. `DROP TABLE batches` would
cascade-delete activities and readings via `ON DELETE CASCADE`. We must rebuild
children FIRST (while the old `batches` table still exists as parent), then rebuild
`batches` last. We also wrap the entire migration in `PRAGMA defer_foreign_keys = ON`
so intermediate states don't trigger constraint violations.

```sql
-- 0004_multi_tenant.sql
-- Multi-tenant: add users table, user_id to all data tables
--
-- FK-SAFE ORDER: children rebuilt first (while old parent exists),
-- parent (batches) rebuilt last. defer_foreign_keys prevents
-- intermediate constraint violations during the swap.

PRAGMA defer_foreign_keys = ON;

-- 1. Create users table
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Seed owner account (existing single-tenant data becomes this user's)
INSERT INTO users (id, email, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'rdrake@pobox.com', 'Richard');

-- 3. Add user_id to devices FIRST (ALTER, nullable for unclaimed)
ALTER TABLE devices ADD COLUMN user_id TEXT REFERENCES users(id);
UPDATE devices SET user_id = '00000000-0000-0000-0000-000000000001';
CREATE INDEX idx_devices_user ON devices(user_id);

-- 4. Add user_id to readings (ALTER, nullable for unclaimed)
ALTER TABLE readings ADD COLUMN user_id TEXT REFERENCES users(id);
UPDATE readings SET user_id = '00000000-0000-0000-0000-000000000001';
CREATE INDEX idx_readings_user ON readings(user_id, source_timestamp DESC);

-- 5. Rebuild activities with user_id NOT NULL
-- (old batches table still exists as parent, readings still exists for reading_id FK)
CREATE TABLE activities_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  batch_id TEXT NOT NULL,
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
  SELECT id, '00000000-0000-0000-0000-000000000001', batch_id, stage, type, title, details, reading_id, recorded_at, created_at, updated_at
  FROM activities;

DROP TABLE activities;
ALTER TABLE activities_new RENAME TO activities;
CREATE INDEX idx_activities_batch_recorded ON activities(batch_id, recorded_at);
CREATE INDEX idx_activities_user ON activities(user_id);

-- 6. Rebuild batches LAST (children are already rebuilt/altered, safe to drop)
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
  SELECT id, '00000000-0000-0000-0000-000000000001', name, wine_type, source_material, stage, status, volume_liters, target_volume_liters, started_at, completed_at, notes, created_at, updated_at
  FROM batches;

DROP TABLE batches;
ALTER TABLE batches_new RENAME TO batches;
CREATE INDEX idx_batches_user ON batches(user_id);

-- 7. Re-add FK from activities to batches now that batches is rebuilt
-- (SQLite doesn't support ALTER TABLE ADD CONSTRAINT, but the deferred
--  FK check at transaction commit will validate the data. The FK from
--  activities_new.batch_id was intentionally omitted during rebuild;
--  we add it properly by one more rebuild cycle.)
CREATE TABLE activities_final (
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

INSERT INTO activities_final SELECT * FROM activities;
DROP TABLE activities;
ALTER TABLE activities_final RENAME TO activities;
CREATE INDEX idx_activities_batch_recorded ON activities(batch_id, recorded_at);
CREATE INDEX idx_activities_user ON activities(user_id);
```

**Step 2: Verify migration runs locally**

Run: `cd api && npx wrangler d1 migrations apply wine-cellar-api --local`
Expected: Migration applies without errors

**Step 3: Commit**

```bash
git add api/migrations/0004_multi_tenant.sql
git commit -m "feat: add multi-tenant migration with users table and user_id columns"
```

---

### Task 2: JWT Verification Library

**Files:**
- Create: `api/src/lib/access-jwt.ts`
- Create: `api/test/access-jwt.test.ts`

**Step 1: Write the failing test**

```typescript
// api/test/access-jwt.test.ts
import { describe, it, expect } from "vitest";
import { verifyAccessJwt, base64UrlEncode } from "../src/lib/access-jwt";

// Generate a test RSA key pair (done once, hardcoded for deterministic tests)
// In the actual test we'll use crypto.subtle to generate + sign

describe("verifyAccessJwt", () => {
  it("returns null for malformed tokens", async () => {
    const result = await verifyAccessJwt("not.a.jwt", "test-aud", "test-team");
    expect(result).toBeNull();
  });

  it("returns null for expired tokens", async () => {
    // Create a properly signed but expired JWT
    // (implementation detail — use test key pair)
  });

  it("returns email for valid token", async () => {
    // Create a properly signed, non-expired JWT with correct aud
    // Verify it returns { email: "test@example.com" }
  });

  it("returns null when aud does not match", async () => {
    // Create valid JWT but with wrong audience
  });
});
```

The test file will use `crypto.subtle` to generate an RSA key pair, sign test JWTs, and mock the JWKS fetch. Full test implementation below.

**Step 2: Write the JWT verification module**

```typescript
// api/src/lib/access-jwt.ts

// Cache JWKS keys in module scope (Workers have per-isolate module caching)
let cachedKeys: Map<string, CryptoKey> = new Map();
let cacheExpiry = 0;

export function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  const binary = atob(base64 + pad);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function base64UrlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function fetchJwks(team: string): Promise<Map<string, CryptoKey>> {
  const now = Date.now();
  if (cachedKeys.size > 0 && now < cacheExpiry) return cachedKeys;

  const url = `https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`JWKS fetch failed: ${resp.status}`);

  const { keys } = (await resp.json()) as { keys: JsonWebKey[] };
  const keyMap = new Map<string, CryptoKey>();

  for (const jwk of keys) {
    if (!jwk.kid || jwk.kty !== "RSA") continue;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    keyMap.set(jwk.kid as string, key);
  }

  cachedKeys = keyMap;
  cacheExpiry = now + 5 * 60 * 1000; // 5 min cache
  return keyMap;
}

// Exported for test overriding
export let _fetchJwks = fetchJwks;
export function __setFetchJwks(fn: typeof fetchJwks) {
  _fetchJwks = fn;
}

export async function verifyAccessJwt(
  token: string,
  aud: string,
  team: string,
): Promise<{ email: string } | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    // Decode header
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
    if (!header.kid) return null;

    // Fetch + find key
    const keys = await _fetchJwks(team);
    const key = keys.get(header.kid);
    if (!key) return null;

    // Verify signature
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = base64UrlDecode(parts[2]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
    if (!valid) return null;

    // Check claims
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
    if (!payload.aud || !payload.aud.includes(aud)) return null;
    if (!payload.exp || payload.exp < Date.now() / 1000) return null;
    if (!payload.email) return null;

    return { email: payload.email };
  } catch {
    return null;
  }
}
```

**Step 3: Write full test with RSA key generation**

The test generates an RSA key pair using `crypto.subtle`, creates JWTs, and overrides `_fetchJwks` to return the test public key. Tests cover: valid token, expired, wrong audience, wrong kid, malformed.

**Step 4: Run tests**

Run: `cd api && npx vitest run test/access-jwt.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add api/src/lib/access-jwt.ts api/test/access-jwt.test.ts
git commit -m "feat: add Cloudflare Access JWT verification library"
```

---

### Task 3: Auth Middleware — Replace apiKeyAuth with accessAuth

**Files:**
- Create: `api/src/middleware/access.ts`
- Modify: `api/src/app.ts`
- Modify: `api/src/middleware/auth.ts` → delete after
- Create: `api/test/access-auth.test.ts`

**Step 1: Write the failing test**

```typescript
// api/test/access-auth.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { applyMigrations, fetchJson } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

describe("access auth", () => {
  it("returns 401 without JWT header", async () => {
    const { status } = await fetchJson("/api/v1/batches");
    expect(status).toBe(401);
  });

  it("allows health without auth", async () => {
    const { status } = await fetchJson("/health");
    expect(status).toBe(200);
  });

  it("allows webhook with X-Webhook-Token", async () => {
    const { status } = await fetchJson("/webhook/rapt", {
      method: "POST",
      headers: { "X-Webhook-Token": "test-webhook-token" },
      body: { device_id: "pill-1", device_name: "Test", temperature: 22.0, gravity: 1.050, battery: 90, rssi: -50, created_date: "2026-03-20T10:00:00Z" },
    });
    // Should not be 401 (may be 200 or other, but not auth-blocked)
    expect(status).not.toBe(401);
  });

  it("authenticates with valid test JWT and returns user data", async () => {
    const { status, json } = await fetchJson("/api/v1/batches", {
      headers: { "Cf-Access-Jwt-Assertion": "test-jwt-for:test@example.com" },
    });
    expect(status).toBe(200);
    expect(json.items).toBeDefined();
  });
});
```

**Step 2: Write the access auth middleware**

The middleware supports **dual-auth** for zero-downtime rollout: it accepts BOTH
the old `X-API-Key` header (if `API_KEY` binding exists) AND the new
`Cf-Access-Jwt-Assertion` JWT. This lets us deploy the new API before migrating
the database or deploying the new dashboard. Once the migration is complete and
the new dashboard is live, we remove the `API_KEY` secret and the legacy path
becomes a no-op.

```typescript
// api/src/middleware/access.ts
import { createMiddleware } from "hono/factory";
import { verifyAccessJwt } from "../lib/access-jwt";
import { timingSafeEqual } from "../lib/crypto";
import { unauthorized } from "../lib/errors";

type User = { id: string; email: string; name: string | null };

type AccessBindings = {
  DB: D1Database;
  CF_ACCESS_AUD: string;
  CF_ACCESS_TEAM: string;
  WEBHOOK_TOKEN: string;
  API_KEY?: string;  // Legacy — kept during rollout, removed after
};

export const accessAuth = createMiddleware<{
  Bindings: AccessBindings;
  Variables: { user: User };
}>(async (c, next) => {
  const path = new URL(c.req.url).pathname;

  // Skip auth for health and webhooks (webhooks use their own token auth)
  if (path === "/health" || path.startsWith("/webhook")) {
    return next();
  }

  // --- Path 1: Cloudflare Access JWT (preferred) ---
  const jwt = c.req.header("Cf-Access-Jwt-Assertion");
  if (jwt) {
    const payload = await verifyAccessJwt(jwt, c.env.CF_ACCESS_AUD, c.env.CF_ACCESS_TEAM);
    if (!payload) return unauthorized("Invalid access token");

    // Upsert user
    const db = c.env.DB;
    const user = await db
      .prepare(
        `INSERT INTO users (id, email, created_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(email) DO UPDATE SET email = email
         RETURNING *`,
      )
      .bind(crypto.randomUUID(), payload.email)
      .first<User>();

    if (!user) return unauthorized("User creation failed");
    c.set("user", user);
    return next();
  }

  // --- Path 2: Legacy API key (transitional, removed after rollout) ---
  const apiKey = c.req.header("X-API-Key");
  const expectedKey = c.env.API_KEY;
  if (apiKey && expectedKey && timingSafeEqual(apiKey, expectedKey)) {
    // Legacy path: no user context available (pre-migration, single-tenant).
    // Route handlers must tolerate c.get("user") being undefined during
    // the brief window where old dashboard talks to new API before migration.
    // After migration + new dashboard deploy, this path is never hit.
    return next();
  }

  return unauthorized("Missing access token");
});
```

**Step 3: Update app.ts — new Bindings, swap middleware, remove CORS**

```typescript
// api/src/app.ts
import { Hono } from "hono";
import { accessAuth } from "./middleware/access";
import batches from "./routes/batches";
import activities from "./routes/activities";
import devices from "./routes/devices";
import webhook from "./routes/webhook";
import dashboard from "./routes/dashboard";
import { batchReadings, deviceReadings } from "./routes/readings";

export type Bindings = {
  DB: D1Database;
  CF_ACCESS_AUD: string;
  CF_ACCESS_TEAM: string;
  WEBHOOK_TOKEN: string;
  API_KEY?: string;  // Legacy — kept during rollout, removed after
};

export type User = { id: string; email: string; name: string | null };

export type AppEnv = { Bindings: Bindings; Variables: { user: User } };

const app = new Hono<AppEnv>();

// No CORS needed — same origin
app.use("*", accessAuth);

app.get("/health", (c) => c.json({ status: "ok" }));
app.route("/api/v1/batches", batches);
app.route("/api/v1/batches/:batchId/activities", activities);
app.route("/api/v1/devices", devices);
app.route("/api/v1/batches/:batchId/readings", batchReadings);
app.route("/api/v1/devices/:deviceId/readings", deviceReadings);
app.route("/api/v1/dashboard", dashboard);
app.route("/webhook", webhook);

export default app;
```

**Step 4: Delete old auth middleware**

Delete `api/src/middleware/auth.ts`.

**Step 5: Run tests**

Run: `cd api && npx vitest run`
Expected: Many tests will fail because helpers.ts still uses `API_HEADERS`. That's expected — we fix this in Task 5.

**Step 6: Commit**

```bash
git add api/src/middleware/access.ts api/src/app.ts
git rm api/src/middleware/auth.ts
git commit -m "feat: replace API key auth with Cloudflare Access JWT middleware"
```

---

### Task 4: Test Infrastructure Update

**Files:**
- Modify: `api/vitest.config.ts`
- Modify: `api/test/helpers.ts`
- Modify: `api/test/env.d.ts`

This task makes the entire test suite work with the new auth. The approach: in test mode, we bypass real JWT verification. The test helper generates a simple token `"test-jwt-for:{email}"` and the test middleware recognizes this pattern when `CF_ACCESS_TEAM` is set to `"test"`.

**Step 1: Update vitest.config.ts bindings**

Replace `API_KEY: "test-api-key"` with `CF_ACCESS_AUD: "test-aud"` and `CF_ACCESS_TEAM: "test"`. Keep `WEBHOOK_TOKEN`.

```typescript
// vitest.config.ts changes
miniflare: {
  d1Databases: { DB: "wine-cellar-test" },
  bindings: {
    CF_ACCESS_AUD: "test-aud",
    CF_ACCESS_TEAM: "test",
    WEBHOOK_TOKEN: "test-webhook-token",
    MIGRATION_SQL: migrationSql,
  },
},
```

**Step 2: Update the JWT verification to support test mode**

In `access-jwt.ts`, when team is `"test"`, accept tokens of format `"test-jwt-for:{email}"` without cryptographic verification. This keeps tests fast and deterministic.

Add to `verifyAccessJwt()` at the top:
```typescript
// Test mode: accept simple tokens for unit tests
if (team === "test" && token.startsWith("test-jwt-for:")) {
  const email = token.slice("test-jwt-for:".length);
  if (!email) return null;
  return { email };
}
```

**Step 3: Update helpers.ts**

```typescript
// api/test/helpers.ts
import { env, SELF } from "cloudflare:test";

export const TEST_USER_EMAIL = "test@example.com";
export const TEST_USER_B_EMAIL = "other@example.com";

export function authHeaders(email: string = TEST_USER_EMAIL): Record<string, string> {
  return { "Cf-Access-Jwt-Assertion": `test-jwt-for:${email}` };
}

export const API_HEADERS = authHeaders(); // backward compat alias
export const WEBHOOK_HEADERS = { "X-Webhook-Token": "test-webhook-token" };

export const VALID_BATCH = {
  name: "2026 Merlot",
  wine_type: "red",
  source_material: "fresh_grapes",
  started_at: "2026-03-19T10:00:00Z",
  volume_liters: 23.0,
  target_volume_liters: 20.0,
  notes: "First attempt",
};

export async function applyMigrations() {
  const sql = (env as any).MIGRATION_SQL as string;
  const cleaned = sql
    .split("\n")
    .filter((line: string) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("--");
    })
    .join("\n");
  const statements = cleaned
    .split(";")
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);
  for (const stmt of statements) {
    await env.DB.prepare(stmt).run();
  }
}

export async function fetchJson(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
) {
  const { method = "GET", headers = {}, body } = options;
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await SELF.fetch(`http://localhost${path}`, init);
  const status = res.status;
  let json: unknown = null;
  if (status !== 204) {
    try {
      json = await res.json();
    } catch {
      // No JSON body
    }
  }
  return { status, json: json as any };
}

export async function createBatch(overrides: Record<string, unknown> = {}, email?: string) {
  const { json } = await fetchJson("/api/v1/batches", {
    method: "POST",
    headers: authHeaders(email),
    body: { ...VALID_BATCH, ...overrides },
  });
  return json.id as string;
}
```

**Step 4: Delete cors.test.ts (CORS removed in Task 3)**

CORS middleware was removed — the cors test file is now dead. Delete it:
```bash
rm api/test/cors.test.ts
```

**Step 5: Update auth.test.ts for new auth model**

Replace API key auth tests with Access JWT tests (missing header → 401,
valid JWT → passes, health/webhook bypass still works).

**Step 6: Run tests to verify existing tests pass with new auth headers**

Run: `cd api && npx vitest run`
Expected: Many tests still fail because route handlers don't use `user_id` yet. But auth tests and health tests should pass. The goal here is that auth works — route scoping comes in subsequent tasks.

**Step 7: Commit**

```bash
git add api/vitest.config.ts api/test/helpers.ts api/src/lib/access-jwt.ts
git rm api/test/cors.test.ts
git add api/test/auth.test.ts
git commit -m "feat: update test infrastructure for Cloudflare Access auth"
```

---

### Task 5: Add `/api/v1/me` Endpoint

**Files:**
- Modify: `api/src/app.ts` (add route)
- Create: `api/test/me.test.ts`

**Step 1: Write the failing test**

```typescript
// api/test/me.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { applyMigrations, fetchJson, authHeaders, TEST_USER_EMAIL } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

describe("GET /api/v1/me", () => {
  it("returns current user", async () => {
    const { status, json } = await fetchJson("/api/v1/me", {
      headers: authHeaders(),
    });
    expect(status).toBe(200);
    expect(json.email).toBe(TEST_USER_EMAIL);
    expect(json.id).toBeDefined();
  });

  it("returns 401 without auth", async () => {
    const { status } = await fetchJson("/api/v1/me");
    expect(status).toBe(401);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run test/me.test.ts`
Expected: FAIL — route doesn't exist

**Step 3: Add the route in app.ts**

Add after the health endpoint:
```typescript
app.get("/api/v1/me", (c) => {
  const user = c.get("user");
  return c.json({ id: user.id, email: user.email, name: user.name });
});
```

**Step 4: Run test**

Run: `cd api && npx vitest run test/me.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add api/src/app.ts api/test/me.test.ts
git commit -m "feat: add /api/v1/me endpoint for current user info"
```

---

### Task 6: Scope Batch Routes by user_id

**Files:**
- Modify: `api/src/routes/batches.ts`
- Modify: `api/test/batches.test.ts`

Every query in batches.ts needs the authenticated user's ID. The user is on the Hono context: `c.get("user")`.

**Step 1: Update the route type**

Change the Hono type from `Hono<{ Bindings: Bindings }>` to import `AppEnv` from app.ts:

```typescript
import type { AppEnv } from "../app";
const batches = new Hono<AppEnv>();
```

**Step 2: Scope each query**

Summary of changes (each query gets `user_id`):

- **POST `/`** — add `user_id` column to INSERT, bind `c.get("user").id`
- **GET `/`** — add `AND user_id = ?` to WHERE, bind user ID
- **GET `/:batchId`** — change to `WHERE id = ? AND user_id = ?`
- **PATCH `/:batchId`** — ownership check: `WHERE id = ? AND user_id = ?`
- **DELETE `/:batchId`** — ownership check: `WHERE id = ? AND user_id = ?`
- **POST `/:batchId/advance`** — ownership check
- **POST `/:batchId/complete`** — ownership check
- **POST `/:batchId/abandon`** — ownership check
- **POST `/:batchId/archive`** — ownership check
- **POST `/:batchId/unarchive`** — ownership check

Extract a helper to DRY the ownership check:
```typescript
async function getOwnedBatch(db: D1Database, batchId: string, userId: string) {
  return db.prepare("SELECT * FROM batches WHERE id = ? AND user_id = ?")
    .bind(batchId, userId).first<any>();
}
```

**Step 3: Update INSERT to include user_id**

The batch INSERT SQL changes from:
```sql
INSERT INTO batches (id, name, wine_type, source_material, stage, status,
  volume_liters, target_volume_liters, started_at, notes, created_at, updated_at)
VALUES (?, ?, ?, ?, 'must_prep', 'active', ?, ?, ?, ?, ?, ?)
```
to:
```sql
INSERT INTO batches (id, user_id, name, wine_type, source_material, stage, status,
  volume_liters, target_volume_liters, started_at, notes, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, 'must_prep', 'active', ?, ?, ?, ?, ?, ?)
```

**Step 4: Run existing batch tests**

Run: `cd api && npx vitest run test/batches.test.ts`
Expected: PASS (tests use API_HEADERS which now sends JWT, middleware upserts user, routes use user_id)

**Step 5: Add tenant isolation test**

Add to `batches.test.ts`:
```typescript
it("user A cannot see user B's batches", async () => {
  const idA = await createBatch({ name: "User A Batch" }, "a@example.com");
  const idB = await createBatch({ name: "User B Batch" }, "b@example.com");

  const { json: listA } = await fetchJson("/api/v1/batches", { headers: authHeaders("a@example.com") });
  expect(listA.items).toHaveLength(1);
  expect(listA.items[0].name).toBe("User A Batch");

  const { status } = await fetchJson(`/api/v1/batches/${idB}`, { headers: authHeaders("a@example.com") });
  expect(status).toBe(404);
});
```

**Step 6: Run tests**

Run: `cd api && npx vitest run test/batches.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add api/src/routes/batches.ts api/test/batches.test.ts
git commit -m "feat: scope batch routes by user_id for tenant isolation"
```

---

### Task 7: Scope Activity Routes by user_id

**Files:**
- Modify: `api/src/routes/activities.ts`
- Modify: `api/test/activities.test.ts`

**Step 1: Update route type to AppEnv**

**Step 2: Scope each query**

- **POST `/`** — verify batch ownership (`AND user_id = ?`), set `user_id` on activity INSERT and linked reading INSERT
- **GET `/`** — verify batch ownership
- **PATCH `/:activityId`** — verify activity ownership via `AND user_id = ?` (simpler than joining batch)
- **DELETE `/:activityId`** — verify activity ownership via `AND user_id = ?`

For the batch ownership check at the top of POST and GET:
```typescript
const batch = await db.prepare("SELECT * FROM batches WHERE id = ? AND user_id = ?")
  .bind(batchId, user.id).first<any>();
```

For the activity ownership in PATCH/DELETE:
```typescript
const row = await db.prepare("SELECT * FROM activities WHERE id = ? AND batch_id = ? AND user_id = ?")
  .bind(activityId, batchId, user.id).first<any>();
```

For reading INSERT (manual SG measurement):
```sql
INSERT INTO readings (id, batch_id, device_id, gravity, temperature, battery, rssi, source_timestamp, created_at, source, user_id)
VALUES (?, ?, 'manual', ?, NULL, NULL, NULL, ?, ?, 'manual', ?)
```

**Step 3: Run tests**

Run: `cd api && npx vitest run test/activities.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add api/src/routes/activities.ts api/test/activities.test.ts
git commit -m "feat: scope activity routes by user_id"
```

---

### Task 8: Scope Reading Routes by user_id

**Files:**
- Modify: `api/src/routes/readings.ts`
- Modify: `api/test/readings.test.ts`

**Step 1: Update route type to AppEnv**

**Step 2: Scope queries**

- **Batch readings GET** — verify batch ownership AND add `user_id` to readings query:
  ```typescript
  const batch = await db.prepare("SELECT id FROM batches WHERE id = ? AND user_id = ?")
    .bind(batchId, user.id).first();
  ```
  Pass user_id to `paginatedQuery` as an additional filter.

- **Device readings GET** — verify device ownership AND add `user_id` to readings query:
  ```typescript
  const device = await db.prepare("SELECT id FROM devices WHERE id = ? AND user_id = ?")
    .bind(deviceId, user.id).first();
  ```
  Pass user_id to `paginatedQuery` as an additional filter.

**Step 3: Add user_id filter to paginatedQuery**

The `paginatedQuery` function MUST also filter by `user_id` as a defense-in-depth measure. A misattributed or backfill-corrupted row could otherwise leak through the parent ownership check. Add a `userId` parameter:

```typescript
async function paginatedQuery(
  db: D1Database,
  baseSql: string,
  params: unknown[],
  limit: number,
  cursor: string | null,
  startTime: string | null,
  endTime: string | null,
  userId: string | null,  // NEW — null for webhook/unauthenticated contexts
) {
  let sql = baseSql;
  if (userId) { sql += " AND user_id = ?"; params.push(userId); }
  // ... rest unchanged
}
```

Call sites pass `user.id`:
```typescript
// Batch readings
const result = await paginatedQuery(db, "SELECT * FROM readings WHERE batch_id = ?",
  [batchId], limit, cursor, startTime, endTime, user.id);

// Device readings
const result = await paginatedQuery(db, "SELECT * FROM readings WHERE device_id = ?",
  [deviceId], limit, cursor, startTime, endTime, user.id);
```

**Step 3: Run tests**

Run: `cd api && npx vitest run test/readings.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add api/src/routes/readings.ts api/test/readings.test.ts
git commit -m "feat: scope reading routes by user_id on parent + query level"
```

---

### Task 9: Scope Device Routes + Add Claim Endpoint

**Files:**
- Modify: `api/src/routes/devices.ts`
- Modify: `api/test/devices.test.ts`

**Step 1: Update route type to AppEnv**

**Step 2: Scope existing queries**

- **POST `/`** (register device) — add `user_id` to INSERT
- **GET `/`** (list devices) — add `WHERE user_id = ?`
- **POST `/:deviceId/assign`** — verify device AND batch ownership
- **POST `/:deviceId/unassign`** — verify device ownership

**Step 3: Add claim endpoint**

```typescript
devices.post("/claim", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);
  if (!body?.device_id) return validationError([{ message: "device_id required" }]);

  // Check device exists and is unclaimed
  const device = await db.prepare("SELECT * FROM devices WHERE id = ? AND user_id IS NULL")
    .bind(body.device_id).first();
  if (!device) return notFound("Device not found or already claimed");

  const now = nowUtc();
  await db.batch([
    db.prepare("UPDATE devices SET user_id = ?, updated_at = ? WHERE id = ?")
      .bind(user.id, now, body.device_id),
    db.prepare("UPDATE readings SET user_id = ? WHERE device_id = ? AND user_id IS NULL")
      .bind(user.id, body.device_id),
  ]);

  const updated = await db.prepare("SELECT * FROM devices WHERE id = ?").bind(body.device_id).first();
  return c.json(updated);
});
```

**Important:** The `/claim` route must be registered BEFORE `/:deviceId/assign` to avoid route parameter collision. Hono matches routes in order, so `/claim` must come before `/:deviceId`.

**Step 4: Write claim test**

```typescript
it("claims an unclaimed device and backfills readings", async () => {
  // Setup: webhook creates unclaimed device + readings
  await fetchJson("/webhook/rapt", {
    method: "POST",
    headers: WEBHOOK_HEADERS,
    body: { device_id: "pill-claim-1", device_name: "Claim Test", temperature: 22, gravity: 1.050, battery: 90, rssi: -50, created_date: "2026-03-20T10:00:00Z" },
  });

  // Claim it
  const { status, json } = await fetchJson("/api/v1/devices/claim", {
    method: "POST",
    headers: authHeaders(),
    body: { device_id: "pill-claim-1" },
  });
  expect(status).toBe(200);
  expect(json.user_id).toBeDefined();

  // Verify device now appears in user's list
  const { json: list } = await fetchJson("/api/v1/devices", { headers: authHeaders() });
  expect(list.items.some((d: any) => d.id === "pill-claim-1")).toBe(true);
});
```

**Step 5: Run tests**

Run: `cd api && npx vitest run test/devices.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add api/src/routes/devices.ts api/test/devices.test.ts
git commit -m "feat: scope device routes by user_id, add device claim endpoint"
```

---

### Task 10: Scope Dashboard Route by user_id

**Files:**
- Modify: `api/src/routes/dashboard.ts`
- Modify: `api/test/integration.test.ts` (dashboard tests are here or in a dedicated file)

**Step 1: Update route type to AppEnv**

**Step 2: Scope queries**

- **Active batches** — `WHERE status = 'active' AND user_id = ?`
- **Recent activities** — `AND b.user_id = ?` on the JOIN
- **Sparkline readings** — add `AND user_id = ?` to readings queries within `batchSummaries` map (defense-in-depth, not just batch_id)
- **Velocity subquery** — add `AND user_id = ?` to the 48h velocity readings query

```typescript
const batches = await db
  .prepare("SELECT * FROM batches WHERE status = 'active' AND user_id = ? ORDER BY created_at DESC")
  .bind(user.id)
  .all<any>();

// ...

const activities = await db
  .prepare(
    `SELECT a.*, b.name as batch_name FROM activities a
     JOIN batches b ON b.id = a.batch_id
     WHERE b.user_id = ?
     ORDER BY a.recorded_at DESC LIMIT 8`
  )
  .bind(user.id)
  .all<any>();
```

**Step 3: Run tests**

Run: `cd api && npx vitest run`
Expected: PASS

**Step 4: Commit**

```bash
git add api/src/routes/dashboard.ts
git commit -m "feat: scope dashboard route by user_id"
```

---

### Task 11: Update Webhook for Unclaimed Devices

**Files:**
- Modify: `api/src/routes/webhook.ts`
- Modify: `api/test/webhook.test.ts`

**Step 1: Update webhook to set user_id from device**

The webhook already has no user context (bypasses auth). Changes:

- When auto-registering a new device: `user_id = NULL` (unclaimed)
- When inserting a reading: set `user_id` from the device's `user_id` (may be NULL)
- Add `user_id` to the readings INSERT

```typescript
// Fetch device including user_id
const device = await db.prepare("SELECT batch_id, user_id FROM devices WHERE id = ?")
  .bind(body.device_id).first<any>();

let batchId: string | null;
let userId: string | null;
if (!device) {
  await db.prepare("INSERT INTO devices (id, name, user_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)")
    .bind(body.device_id, body.device_name, now, now).run();
  batchId = null;
  userId = null;
} else {
  batchId = device.batch_id;
  userId = device.user_id;
}

// Insert reading with user_id
await db.prepare(
  `INSERT INTO readings (id, batch_id, device_id, gravity, temperature, battery, rssi, source_timestamp, created_at, user_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
).bind(readingId, batchId, body.device_id, body.gravity, body.temperature,
  body.battery, body.rssi, body.created_date, now, userId).run();
```

**Step 2: Run tests**

Run: `cd api && npx vitest run test/webhook.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add api/src/routes/webhook.ts api/test/webhook.test.ts
git commit -m "feat: webhook inserts user_id from device, NULL for unclaimed"
```

---

### Task 12: Tenant Isolation Integration Test

**Files:**
- Create: `api/test/tenant-isolation.test.ts`

**Step 1: Write comprehensive cross-tenant isolation tests**

```typescript
// api/test/tenant-isolation.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { applyMigrations, fetchJson, authHeaders, createBatch, WEBHOOK_HEADERS } from "./helpers";

const ALICE = "alice@example.com";
const BOB = "bob@example.com";

beforeEach(async () => {
  await applyMigrations();
});

describe("tenant isolation", () => {
  it("user cannot list another user's batches", async () => {
    await createBatch({ name: "Alice's Wine" }, ALICE);
    await createBatch({ name: "Bob's Wine" }, BOB);

    const { json } = await fetchJson("/api/v1/batches", { headers: authHeaders(ALICE) });
    expect(json.items).toHaveLength(1);
    expect(json.items[0].name).toBe("Alice's Wine");
  });

  it("user cannot read another user's batch", async () => {
    const bobBatch = await createBatch({ name: "Bob's Wine" }, BOB);
    const { status } = await fetchJson(`/api/v1/batches/${bobBatch}`, { headers: authHeaders(ALICE) });
    expect(status).toBe(404);
  });

  it("user cannot update another user's batch", async () => {
    const bobBatch = await createBatch({ name: "Bob's Wine" }, BOB);
    const { status } = await fetchJson(`/api/v1/batches/${bobBatch}`, {
      method: "PATCH",
      headers: authHeaders(ALICE),
      body: { name: "Stolen Wine" },
    });
    expect(status).toBe(404);
  });

  it("user cannot delete another user's batch", async () => {
    const bobBatch = await createBatch({ name: "Bob's Wine" }, BOB);
    // Abandon first (as Bob) to allow deletion
    await fetchJson(`/api/v1/batches/${bobBatch}/abandon`, { method: "POST", headers: authHeaders(BOB) });
    const { status } = await fetchJson(`/api/v1/batches/${bobBatch}`, {
      method: "DELETE",
      headers: authHeaders(ALICE),
    });
    expect(status).toBe(404);
  });

  it("user cannot see another user's activities", async () => {
    const bobBatch = await createBatch({ name: "Bob's Wine" }, BOB);
    // Bob logs an activity
    await fetchJson(`/api/v1/batches/${bobBatch}/activities`, {
      method: "POST",
      headers: authHeaders(BOB),
      body: { stage: "must_prep", type: "note", title: "Secret note", recorded_at: "2026-03-20T10:00:00Z" },
    });

    // Alice tries to list activities on Bob's batch
    const { status } = await fetchJson(`/api/v1/batches/${bobBatch}/activities`, {
      headers: authHeaders(ALICE),
    });
    expect(status).toBe(404); // Batch not found for Alice
  });

  it("user cannot see another user's devices", async () => {
    // Alice registers a device
    await fetchJson("/api/v1/devices", {
      method: "POST",
      headers: authHeaders(ALICE),
      body: { id: "alice-pill", name: "Alice's Pill" },
    });

    // Bob's device list shouldn't include it
    const { json } = await fetchJson("/api/v1/devices", { headers: authHeaders(BOB) });
    expect(json.items.find((d: any) => d.id === "alice-pill")).toBeUndefined();
  });

  it("dashboard only shows user's own data", async () => {
    await createBatch({ name: "Alice's Wine" }, ALICE);
    await createBatch({ name: "Bob's Wine" }, BOB);

    const { json } = await fetchJson("/api/v1/dashboard", { headers: authHeaders(ALICE) });
    expect(json.active_batches).toHaveLength(1);
    expect(json.active_batches[0].name).toBe("Alice's Wine");
  });

  it("claiming a device gives ownership of its readings", async () => {
    // Webhook creates unclaimed device + reading
    await fetchJson("/webhook/rapt", {
      method: "POST",
      headers: WEBHOOK_HEADERS,
      body: { device_id: "orphan-pill", device_name: "Orphan", temperature: 22, gravity: 1.050, battery: 90, rssi: -50, created_date: "2026-03-20T10:00:00Z" },
    });

    // Alice claims it
    await fetchJson("/api/v1/devices/claim", {
      method: "POST",
      headers: authHeaders(ALICE),
      body: { device_id: "orphan-pill" },
    });

    // Alice can see the device
    const { json: devices } = await fetchJson("/api/v1/devices", { headers: authHeaders(ALICE) });
    expect(devices.items.find((d: any) => d.id === "orphan-pill")).toBeDefined();

    // Bob cannot
    const { json: bobDevices } = await fetchJson("/api/v1/devices", { headers: authHeaders(BOB) });
    expect(bobDevices.items.find((d: any) => d.id === "orphan-pill")).toBeUndefined();
  });
});
```

**Step 2: Run tests**

Run: `cd api && npx vitest run test/tenant-isolation.test.ts`
Expected: PASS

**Step 3: Run full test suite**

Run: `cd api && npx vitest run`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add api/test/tenant-isolation.test.ts
git commit -m "test: add comprehensive tenant isolation tests"
```

---

## Phase 2: Dashboard Frontend

### Task 13: Simplify api.ts — Remove API Key Auth

**Files:**
- Modify: `dashboard/src/api.ts`

**Step 1: Remove localStorage config functions**

Delete: `STORAGE_KEY_URL`, `STORAGE_KEY_KEY`, `getApiConfig`, `setApiConfig`, `clearApiConfig`, `isConfigured`

**Step 2: Simplify apiFetch**

```typescript
async function apiFetch<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const { method = "GET", body } = options;
  const headers = new Headers();
  if (body !== undefined) headers.set("Content-Type", "application/json");

  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // 401 means Access session expired — reload triggers Access login
  if (res.status === 401) {
    window.location.reload();
    throw new ApiError(401, { error: "unauthorized", message: "Session expired" });
  }

  if (res.status === 204) return undefined as T;

  const json = await res.json();
  if (!res.ok) throw new ApiError(res.status, json);
  return json as T;
}
```

**Step 3: Add claim and me endpoints**

```typescript
export const api = {
  // ... existing endpoints unchanged ...
  devices: {
    // ... existing ...
    claim: (deviceId: string) =>
      apiFetch<Device>("/api/v1/devices/claim", { method: "POST", body: { device_id: deviceId } }),
  },
  me: () => apiFetch<{ id: string; email: string; name: string | null }>("/api/v1/me"),
  // ... rest unchanged
};
```

**Step 4: Delete dashboard/src/api.test.ts**

The existing test file tests localStorage config functions (`getApiConfig`, `setApiConfig`,
`clearApiConfig`, `isConfigured`) and API key header injection — all removed. Delete it:
```bash
rm dashboard/src/api.test.ts
```

Replacement tests are not needed: the API client is now just `fetch(path)` with no
auth logic to test. Integration testing via Playwright covers the real flow.

**Step 5: Bump service worker cache version**

In `dashboard/public/sw.js`, change `wine-cellar-v2` to `wine-cellar-v3`. This forces
stale clients to evict cached assets on the next visit, which is critical for the
deployment rollout (Finding 2: old clients must not keep running after migration).

**Step 6: Commit**

```bash
git add dashboard/src/api.ts dashboard/public/sw.js
git rm dashboard/src/api.test.ts
git commit -m "feat: simplify API client for same-origin Cloudflare Access auth"
```

---

### Task 14: Remove Setup Page, AuthGuard, Update App.tsx

**Files:**
- Delete: `dashboard/src/pages/Setup.tsx`
- Delete: `dashboard/src/components/AuthGuard.tsx`
- Modify: `dashboard/src/App.tsx`

**Step 1: Update App.tsx — remove Setup route and AuthGuard wrapper**

```typescript
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import Layout from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import BatchList from "@/pages/BatchList";
import BatchDetail from "@/pages/BatchDetail";
import BatchNew from "@/pages/BatchNew";
import BatchEdit from "@/pages/BatchEdit";
import ActivityNew from "@/pages/ActivityNew";
import Tools from "@/pages/Tools";
import Settings from "@/pages/Settings";
import BatchComparison from "@/pages/BatchComparison";

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/batches" element={<BatchList />} />
            <Route path="/batches/new" element={<BatchNew />} />
            <Route path="/batches/:id" element={<BatchDetail />} />
            <Route path="/batches/:id/edit" element={<BatchEdit />} />
            <Route path="/batches/:id/activities/new" element={<ActivityNew />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/tools" element={<Tools />} />
            <Route path="/compare" element={<BatchComparison />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
```

**Step 2: Delete Setup.tsx and AuthGuard.tsx**

```bash
rm dashboard/src/pages/Setup.tsx
rm dashboard/src/components/AuthGuard.tsx
```

**Step 3: Commit**

```bash
git add dashboard/src/App.tsx
git rm dashboard/src/pages/Setup.tsx dashboard/src/components/AuthGuard.tsx
git commit -m "feat: remove Setup page and AuthGuard, Cloudflare Access handles auth"
```

---

### Task 15: Update Settings — Remove Connection, Add Device Claim

**Files:**
- Modify: `dashboard/src/pages/Settings.tsx`

**Step 1: Remove ConnectionSection**

Delete the entire `ConnectionSection` function and its usage in the JSX. Remove imports: `useNavigate`, `getApiConfig`, `clearApiConfig`.

**Step 2: Add device claim UI**

Add an "Unclaimed Devices" section that shows devices available to claim. This calls a new API endpoint to list unclaimed devices, or simpler: add a text input where the user enters a device ID and clicks "Claim."

```typescript
function ClaimSection({ onClaimed }: { onClaimed: () => void }) {
  const [deviceId, setDeviceId] = useState("");
  const [claiming, setClaiming] = useState(false);

  async function handleClaim() {
    if (!deviceId.trim()) return;
    setClaiming(true);
    try {
      await api.devices.claim(deviceId.trim());
      toast.success("Device claimed");
      setDeviceId("");
      onClaimed();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't claim device");
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Enter a device ID to claim an unregistered RAPT Pill.
        The device must have sent at least one reading.
      </p>
      <div className="flex gap-2">
        <input
          className="flex-1 px-2 py-1 text-sm border rounded bg-background"
          placeholder="e.g. pill-abc-123"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
        />
        <Button size="sm" disabled={!deviceId.trim() || claiming} onClick={handleClaim}>
          {claiming ? "Claiming..." : "Claim"}
        </Button>
      </div>
    </div>
  );
}
```

Add to the Settings page JSX, after the Sensors section:
```tsx
<section>
  <h2 className="text-sm font-semibold mb-2">Claim Device</h2>
  <ClaimSection onClaimed={refetch} />
</section>
```

**Step 3: Commit**

```bash
git add dashboard/src/pages/Settings.tsx
git commit -m "feat: replace connection config with device claim UI in Settings"
```

---

### Task 16: Show User Email in Layout Header

**Files:**
- Modify: `dashboard/src/components/Layout.tsx`

**Step 1: Fetch and display user email**

```typescript
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";

// Inside Layout component:
const { data: me } = useFetch(() => api.me(), []);

// In the header JSX, next to ThemeToggle:
{me && <span className="text-xs text-muted-foreground">{me.email}</span>}
```

**Step 2: Commit**

```bash
git add dashboard/src/components/Layout.tsx
git commit -m "feat: display user email in header via /api/v1/me"
```

---

## Phase 3: Deployment & Wiring

### Task 17: Wrangler Config for Same-Origin

**Files:**
- Modify: `api/wrangler.toml` (add CF_ACCESS_AUD, CF_ACCESS_TEAM vars)
- Potentially create: `dashboard/functions/api/[[path]].ts` (Pages Function proxy)

**Same-origin via Pages Functions proxy.** The dashboard and API MUST share a domain
so Cloudflare Access cookies are sent automatically. Cross-origin is NOT a viable
fallback because Task 3 removes CORS and Task 13 switches to relative URLs.

Create Pages Function catch-all proxies:

```typescript
// dashboard/functions/api/[[path]].ts — proxy /api/* to the API Worker
export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  url.hostname = "wine-cellar-api.rdrake.workers.dev";
  return fetch(new Request(url.toString(), context.request));
};
```

```typescript
// dashboard/functions/webhook/[[path]].ts — proxy /webhook/* to the API Worker
export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  url.hostname = "wine-cellar-api.rdrake.workers.dev";
  return fetch(new Request(url.toString(), context.request));
};
```

```typescript
// dashboard/functions/health.ts — proxy /health to the API Worker
export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  url.hostname = "wine-cellar-api.rdrake.workers.dev";
  return fetch(new Request(url.toString(), context.request));
};
```

**Step 1: Add env vars to wrangler.toml**

```toml
[vars]
CF_ACCESS_TEAM = "wine-cellar"
```

(CF_ACCESS_AUD is a secret — set via `wrangler secret put CF_ACCESS_AUD`)

**Zero-downtime rollout via dual-auth.** The middleware accepts BOTH `X-API-Key`
(old dashboard) and `Cf-Access-Jwt-Assertion` (new dashboard). This eliminates
any incompatibility window. Sequence:

1. Deploy new API first — dual-auth means old dashboard (API key) keeps working
2. Apply migration — new API handles user_id, old dashboard still works via legacy path
3. Deploy new dashboard — switches to JWT auth, Pages Functions proxy
4. Clean up — delete API_KEY secret, remove legacy auth path

**Step 2: Set new secrets (BEFORE deploying new code)**

```bash
cd api && npx wrangler secret put CF_ACCESS_AUD
# Paste the audience tag from Cloudflare Access dashboard
# Keep API_KEY alive — old dashboard still needs it until step 5
```

**Step 3: Deploy new API Worker (dual-auth, backward-compatible)**

The new API accepts both auth methods. Old dashboard keeps working via `X-API-Key`.

```bash
cd api && npx wrangler deploy
```

**Step 4: Apply migration on production D1**

Now safe because the new API code handles `user_id` in all queries.

```bash
cd api && npx wrangler d1 migrations apply wine-cellar-api --remote
```

**Step 5: Deploy new dashboard (switches to JWT auth)**

Bump SW cache to `wine-cellar-v3`, deploy with Pages Functions proxy.

```bash
cd dashboard && npm run build && npx wrangler pages deploy dist --project-name wine-cellar-dashboard
```

**Step 6: Verify everything works end-to-end**

```bash
# Health check
curl -s https://wine-cellar-dashboard.pages.dev/health

# Verify migration applied
cd api && npx wrangler d1 execute wine-cellar-api --remote --command "SELECT count(*) FROM users"
```

**Step 7: Clean up legacy auth**

Once confirmed working, remove the API_KEY secret. The dual-auth legacy path
in the middleware becomes a no-op (no `API_KEY` binding = never matches).

```bash
cd api && npx wrangler secret delete API_KEY
```

Optionally, in a follow-up commit, remove the legacy `X-API-Key` path from
`middleware/access.ts` and the `API_KEY?: string` from `Bindings`.

**Step 8: Commit config changes**

```bash
git add api/wrangler.toml
git commit -m "feat: add Cloudflare Access env vars to wrangler config"
```

---

### Task 18: Cloudflare Access Setup

**Files:**
- Create: `scripts/setup-access.sh`

This is a one-time setup script. It creates Cloudflare Access applications and policies.

**CRITICAL: Webhook bypass.** The RAPT Pill sends `X-Webhook-Token`, NOT Cloudflare
service token headers. An `any_valid_service_token` bypass policy would block RAPT
webhooks because Access runs BEFORE the request reaches the Worker. Solution: create
a SEPARATE Access application for the `/webhook/*` path with a `bypass` decision for
`everyone`, so the path is completely unprotected by Access. The webhook route still
validates `X-Webhook-Token` in its own code.

```bash
#!/bin/bash
# scripts/setup-access.sh — One-time Cloudflare Access setup
# Requires: CF_API_TOKEN and CF_ACCOUNT_ID env vars

set -euo pipefail

DOMAIN="${1:-wine-cellar-dashboard.pages.dev}"

# --- 1. Create the main Access app (protects everything except webhook) ---
echo "Creating main Access app for $DOMAIN..."
APP_RESPONSE=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/access/apps" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Wine Cellar",
    "domain": "'$DOMAIN'",
    "type": "self_hosted",
    "session_duration": "720h",
    "auto_redirect_to_identity": false
  }')

APP_ID=$(echo "$APP_RESPONSE" | jq -r '.result.id')
AUD=$(echo "$APP_RESPONSE" | jq -r '.result.aud')
echo "App ID: $APP_ID"
echo "Audience tag: $AUD"
echo ">>> Set this as CF_ACCESS_AUD: wrangler secret put CF_ACCESS_AUD <<< '$AUD'"

# Allow policy for authenticated users
echo "Creating allow-all policy on main app..."
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/access/apps/$APP_ID/policies" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Allow users",
    "decision": "allow",
    "include": [{"everyone": true}],
    "precedence": 1
  }' | jq '.result.id'

# --- 2. Create a SEPARATE bypass app for /webhook/* ---
# This ensures RAPT Pill requests (which carry X-Webhook-Token, not CF service
# tokens) are not blocked by Access before reaching the Worker.
echo "Creating webhook bypass app for $DOMAIN/webhook..."
WEBHOOK_RESPONSE=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/access/apps" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Wine Cellar Webhooks",
    "domain": "'$DOMAIN'/webhook",
    "type": "self_hosted",
    "session_duration": "24h"
  }')

WEBHOOK_APP_ID=$(echo "$WEBHOOK_RESPONSE" | jq -r '.result.id')
echo "Webhook App ID: $WEBHOOK_APP_ID"

# Bypass for everyone on the webhook path
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/access/apps/$WEBHOOK_APP_ID/policies" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Bypass webhooks",
    "decision": "bypass",
    "include": [{"everyone": true}],
    "precedence": 1
  }' | jq '.result.id'

# --- 3. Also bypass /health for uptime monitoring ---
echo "Creating health bypass app..."
HEALTH_RESPONSE=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/access/apps" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Wine Cellar Health",
    "domain": "'$DOMAIN'/health",
    "type": "self_hosted",
    "session_duration": "24h"
  }')

HEALTH_APP_ID=$(echo "$HEALTH_RESPONSE" | jq -r '.result.id')

curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/access/apps/$HEALTH_APP_ID/policies" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Bypass health",
    "decision": "bypass",
    "include": [{"everyone": true}],
    "precedence": 1
  }' | jq '.result.id'

echo "Done. Configure identity providers in the Cloudflare dashboard."
echo "More specific path apps (/webhook, /health) override the domain-wide app."
```

**Step 1: Make executable and commit**

```bash
chmod +x scripts/setup-access.sh
git add scripts/setup-access.sh
git commit -m "feat: add Cloudflare Access setup script"
```

---

## Dependency Graph

```
Task 1 (migration)
  └─→ Task 2 (JWT lib)
       └─→ Task 3 (auth middleware + app.ts)
            └─→ Task 4 (test infra)
                 └─→ Task 5 (/me endpoint)
                 ├─→ Task 6 (batch scoping)     ─┐
                 ├─→ Task 7 (activity scoping)    │
                 ├─→ Task 8 (reading scoping)     ├─→ Task 12 (isolation tests)
                 ├─→ Task 9 (device + claim)      │
                 ├─→ Task 10 (dashboard scoping)  │
                 └─→ Task 11 (webhook update)    ─┘
                                                   │
                                                   └─→ Phase 2 (frontend)
                                                        ├─→ Task 13 (api.ts)
                                                        ├─→ Task 14 (remove Setup/AuthGuard)
                                                        ├─→ Task 15 (Settings claim UI)
                                                        └─→ Task 16 (Layout email)
                                                             └─→ Phase 3
                                                                  ├─→ Task 17 (wrangler config)
                                                                  └─→ Task 18 (Access setup)
```

**Parallelizable tasks:** 6, 7, 8, 9, 10, 11 (all route scoping) can run in parallel after Task 4 completes. Tasks 13, 14, 15, 16 can run in parallel after all route scoping is done.

---

## Verification Checklist

Before marking implementation complete:

- [ ] `cd api && npx vitest run` — all tests pass (including tenant isolation)
- [ ] Tenant isolation test passes (user A can't see user B's data)
- [ ] Readings queries include `AND user_id = ?` (not just parent ownership)
- [ ] Device claim flow works (webhook → unclaimed → claim → owned)
- [ ] Dashboard loads with no localStorage/API key references
- [ ] `dashboard/src/api.test.ts` deleted (old localStorage tests)
- [ ] `api/test/cors.test.ts` deleted (CORS removed)
- [ ] `/api/v1/me` returns correct user email
- [ ] Migration applies cleanly on fresh DB and on existing DB with data
- [ ] Migration FK ordering verified: children rebuilt before parent dropped
- [ ] `wrangler deploy` succeeds for API
- [ ] Dashboard builds with no TypeScript errors (`npm run build`)
- [ ] Pages Functions proxy files exist (`functions/api/`, `functions/webhook/`, `functions/health.ts`)
- [ ] Service worker bumped to `wine-cellar-v3`
- [ ] Cloudflare Access blocks unauthenticated requests to dashboard + API
- [ ] Webhooks still work — Access bypass app on `/webhook` path (not service token)
- [ ] `/health` accessible without Access auth
