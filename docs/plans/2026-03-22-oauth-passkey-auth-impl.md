# OAuth + Passkey Auth Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace single-user passkey-bootstrap auth with multi-user GitHub OAuth, keeping passkeys as optional. Remove Cloudflare Access entirely.

**Architecture:** GitHub OAuth via `arctic` library handles signup/login. Session cookies (existing) remain the API auth mechanism. Passkey registration/login stays as-is. New `oauth_accounts` table links GitHub identities to users. `settings` table stores `registrations_open` toggle.

**Tech Stack:** Hono v4, arctic (OAuth), @simplewebauthn/server v13+, D1/SQLite, React 19, @simplewebauthn/browser v13+

**Design doc:** `docs/plans/2026-03-22-oauth-passkey-auth-design.md` (v2.1)

---

### Task 1: Foundation — Encoding Utilities, Migration, Challenge Update

**Goal:** Extract shared base64url utilities, create the database migration, and update challenge types/TTL.

**Files:**
- Create: `api/src/lib/encoding.ts`
- Create: `api/migrations/0009_oauth_auth.sql`
- Modify: `api/src/lib/auth-challenge.ts`
- Modify: `api/src/lib/web-push.ts`
- Test: `api/test/auth-helpers.test.ts` (existing challenge tests cover type changes)

**Step 1: Create `api/src/lib/encoding.ts`**

Extract from `api/src/lib/access-jwt.ts` (lines 5-17):

```typescript
export function base64UrlDecode(s: string): Uint8Array {
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/");
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
```

**Step 2: Update `api/src/lib/web-push.ts` to import from encoding.ts**

Replace the inline `b64url`/`unb64url` functions (lines 23-35) with imports:

```typescript
import { base64UrlDecode, base64UrlEncode } from "./encoding";
```

Then replace all `unb64url(...)` calls with `base64UrlDecode(...)` and `b64url(...)` with `base64UrlEncode(...)` throughout the file. The functions are the same implementation, just different names.

**Step 3: Create migration `api/migrations/0009_oauth_auth.sql`**

```sql
-- New tables
CREATE TABLE oauth_accounts (
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  email TEXT,
  name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX idx_oauth_accounts_user ON oauth_accounts(user_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO settings (key, value) VALUES ('registrations_open', 'true');

-- Add columns to users
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN onboarded INTEGER NOT NULL DEFAULT 0;

-- Update existing user as onboarded (they were already using the app)
UPDATE users SET onboarded = 1;

-- Rebuild auth_challenges with updated CHECK constraint
DELETE FROM auth_challenges;
DROP TABLE auth_challenges;
CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('oauth', 'login', 'register')),
  user_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_auth_challenges_expires ON auth_challenges(expires_at);

-- Remove CF Access service tokens (dead after CF Access removal)
DROP TABLE IF EXISTS service_tokens;
```

**Step 4: Update `api/src/lib/auth-challenge.ts`**

Change `ChallengeType` and add `ttlMinutes` parameter:

```typescript
export type ChallengeType = "oauth" | "login" | "register";

export async function storeChallenge(
  db: D1Database,
  challenge: string,
  type: ChallengeType,
  userId?: string,
  ttlMinutes: number = 5,
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO auth_challenges (id, challenge, type, user_id, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' minutes'))"
    )
    .bind(id, challenge, type, userId ?? null, ttlMinutes)
    .run();
  return id;
}
```

`consumeChallenge` and `cleanupExpiredChallenges` are unchanged.

**Step 5: Run tests to verify challenge and encoding changes**

Run: `cd api && npm run test`
Expected: All existing tests pass. Challenge tests still work because `storeChallenge` default TTL is still 5 minutes.

**Step 6: Commit**

```bash
git add api/src/lib/encoding.ts api/src/lib/web-push.ts api/src/lib/auth-challenge.ts api/migrations/0009_oauth_auth.sql
git commit -m "feat: encoding utilities, OAuth migration, challenge TTL param"
```

---

### Task 2: API Types, Config, and Install arctic

**Goal:** Update Bindings type, wrangler config, vitest config, install `arctic`.

**Files:**
- Modify: `api/src/app.ts`
- Modify: `api/wrangler.toml`
- Modify: `api/vitest.config.ts`
- Modify: `api/package.json` (via npm install)

**Step 1: Install arctic**

Run: `cd api && npm install arctic`

**Step 2: Update `api/src/app.ts` Bindings and User types**

Update the `Bindings` type (lines 13-23):

```typescript
export type Bindings = {
  DB: D1Database;
  WEBHOOK_TOKEN: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  RP_ID: string;
  RP_ORIGIN: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
};
```

Update the `User` type (line 25):

```typescript
export type User = { id: string; email: string; name: string | null; avatar_url: string | null };
```

Remove the `GET /api/v1/me` route (lines 36-39) — will be replaced by `/users/me` in the auth routes.

**Step 3: Update `api/wrangler.toml`**

Remove `CF_ACCESS_TEAM`. Add `GITHUB_CLIENT_ID` placeholder:

```toml
[vars]
RP_ID = "wine-cellar-dashboard.pages.dev"
RP_ORIGIN = "https://wine-cellar-dashboard.pages.dev"
GITHUB_CLIENT_ID = ""
```

**Step 4: Update `api/vitest.config.ts`**

Update test bindings — remove CF Access bindings, add GitHub OAuth test bindings:

```typescript
bindings: {
  WEBHOOK_TOKEN: "test-webhook-token",
  SETUP_TOKEN: "test-setup-token", // Keep temporarily for migration transition
  RP_ID: "localhost",
  RP_ORIGIN: "http://localhost",
  GITHUB_CLIENT_ID: "test-github-client-id",
  GITHUB_CLIENT_SECRET: "test-github-client-secret",
},
```

Remove `CF_ACCESS_AUD` and `CF_ACCESS_TEAM` bindings.

**Step 5: Run type check**

Run: `cd api && npm run lint`
Expected: Type errors likely from middleware/auth routes still referencing old bindings. These will be fixed in subsequent tasks.

**Step 6: Commit**

```bash
git add api/src/app.ts api/wrangler.toml api/vitest.config.ts api/package.json api/package-lock.json
git commit -m "feat: update bindings for OAuth, install arctic, remove CF Access config"
```

---

### Task 3: Middleware Rewrite

**Goal:** Remove CF Access JWT verification, update exempt routes, simplify to session-only auth.

**Files:**
- Modify: `api/src/middleware/access.ts`
- Test: `api/test/auth-middleware.test.ts`

**Step 1: Write the failing tests for new middleware behavior**

Rewrite `api/test/auth-middleware.test.ts`:

```typescript
import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { applyMigrations, sessionHeaders, seedSession } from "./helpers";

describe("auth middleware", () => {
  beforeEach(async () => {
    await applyMigrations();
  });

  it("allows exempt auth routes without session", async () => {
    const routes = [
      "/api/v1/auth/status",
      "/api/v1/auth/login/options",
      "/api/v1/auth/settings",
      "/api/v1/auth/github",
    ];
    for (const route of routes) {
      const res = await SELF.fetch(`https://localhost${route}`);
      expect(res.status, `${route} should not be 401`).not.toBe(401);
    }
  });

  it("requires auth for protected routes", async () => {
    const res = await SELF.fetch("https://localhost/api/v1/batches");
    expect(res.status).toBe(401);
  });

  it("requires auth for passkey register and logout routes", async () => {
    const registerRes = await SELF.fetch("https://localhost/api/v1/auth/register/options", {
      method: "POST",
    });
    expect(registerRes.status).toBe(401);

    const logoutRes = await SELF.fetch("https://localhost/api/v1/auth/logout", {
      method: "POST",
    });
    expect(logoutRes.status).toBe(401);
  });

  it("authenticates via session cookie", async () => {
    const { token } = await seedSession("test@example.com");
    const res = await SELF.fetch("https://localhost/api/v1/batches", {
      headers: sessionHeaders(token),
    });
    expect(res.status).toBe(200);
  });

  it("rejects expired sessions", async () => {
    const { token, userId } = await seedSession("test@example.com");
    // Expire the session manually
    const { hashToken } = await import("../src/lib/auth-session");
    const hash = await hashToken(token);
    await env.DB.prepare(
      "UPDATE auth_sessions SET expires_at = datetime('now', '-1 hour') WHERE id = ?"
    ).bind(hash).run();

    const res = await SELF.fetch("https://localhost/api/v1/batches", {
      headers: sessionHeaders(token),
    });
    expect(res.status).toBe(401);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run test/auth-middleware.test.ts`
Expected: Tests fail because middleware still has CF Access logic and old exempt routes.

**Step 3: Rewrite `api/src/middleware/access.ts`**

Note: `validateSession` returns `string | null` (the userId directly), not an object. Use the return value directly as userId.

```typescript
import type { Context, Next } from "hono";
import type { AppEnv, User } from "../app";
import { validateSession, getSessionToken } from "../lib/auth-session";

const EXEMPT_PREFIXES = [
  "/health",
  "/webhook",
  "/api/v1/auth/status",
  "/api/v1/auth/login",
  "/api/v1/auth/github",
  "/api/v1/auth/settings",
];

function isExempt(path: string): boolean {
  return EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + "/") || path.startsWith(prefix + "?"));
}

export function accessAuth() {
  return async (c: Context<AppEnv>, next: Next) => {
    if (isExempt(c.req.path)) {
      return next();
    }

    // Session cookie auth (sole auth path)
    const token = getSessionToken(c);
    if (token) {
      const userId = await validateSession(c.env.DB, token);
      if (userId) {
        const user = await c.env.DB.prepare(
          "SELECT id, email, name, avatar_url FROM users WHERE id = ?"
        ).bind(userId).first<User>();
        if (user) {
          c.set("user", user);
          return next();
        }
      }
    }

    return c.json({ error: "Authentication required" }, 401);
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run test/auth-middleware.test.ts`
Expected: All pass.

**Step 5: Commit**

```bash
git add api/src/middleware/access.ts api/test/auth-middleware.test.ts
git commit -m "feat: rewrite middleware to session-only auth, remove CF Access"
```

---

### Task 4: Test Infrastructure

**Goal:** Rewrite test auth helpers to use session cookies instead of CF Access JWTs. Update all test files that use `authHeaders()`.

**Files:**
- Modify: `api/test/helpers.ts`
- Modify: `api/test/auth-helpers.test.ts`
- Modify: all test files using `authHeaders()`

**Step 1: Identify all test files using `authHeaders` or `API_HEADERS`**

Many test files use the eagerly-evaluated `API_HEADERS = authHeaders()` constant instead of calling `authHeaders()` directly. Since `authHeaders` is now async, `API_HEADERS` cannot be a module-level constant. Remove it and replace all usages with `await authHeaders()`.

Files using `authHeaders()` directly:
- `api/test/helpers.ts` — definition
- `api/test/tenant-isolation.test.ts`
- `api/test/batches.test.ts`
- `api/test/readings.test.ts`
- `api/test/alerts-api.test.ts`
- `api/test/devices.test.ts`
- `api/test/me.test.ts`
- `api/test/auth.test.ts`
- `api/test/auth-helpers.test.ts`
- `api/test/auth-middleware.test.ts`

Files using `API_HEADERS` constant:
- `api/test/batch-lifecycle.test.ts`
- `api/test/push.test.ts`
- `api/test/batches.test.ts`
- `api/test/readings.test.ts`
- `api/test/alerts-api.test.ts`
- `api/test/activities.test.ts`
- `api/test/webhook.test.ts`
- `api/test/integration.test.ts`
- `api/test/devices.test.ts`

**Step 2: Rewrite `api/test/helpers.ts`**

Replace `authHeaders(email)` to create a real session instead of a fake JWT. The key change: `authHeaders` becomes async and returns a Cookie header.

```typescript
import { env, SELF } from "cloudflare:test";
import { hashToken, createSession } from "../src/lib/auth-session";

export const TEST_USER_EMAIL = "test@example.com";
export const TEST_WEBAUTHN_USER_ID = "dGVzdC13ZWJhdXRobi11c2VyLWlk";

// Re-export for tests that need direct access
export { hashToken };

/**
 * Ensure a user exists and return a session Cookie header.
 * Replaces the old CF Access JWT-based authHeaders.
 */
export async function authHeaders(email: string = TEST_USER_EMAIL): Promise<Record<string, string>> {
  // Ensure user exists
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    userId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users (id, email, name, onboarded) VALUES (?, ?, ?, 1)"
    ).bind(userId, email, email.split("@")[0], 1).run();
  }

  // Create session
  const { token } = await createSession(env.DB, userId);
  return { Cookie: `session=${token}` };
}

export function sessionHeaders(token: string): Record<string, string> {
  return { Cookie: `session=${token}` };
}

export async function seedSession(email: string = TEST_USER_EMAIL): Promise<{ token: string; userId: string }> {
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    userId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users (id, email, name, onboarded) VALUES (?, ?, ?, 1)"
    ).bind(userId, email, email.split("@")[0], 1).run();
  }
  const { token } = await createSession(env.DB, userId);
  return { token, userId };
}

export async function seedCredential(userId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO passkey_credentials (id, user_id, public_key, webauthn_user_id, sign_count, created_at)
     VALUES (?, ?, X'00', ?, 0, datetime('now'))`
  ).bind("test-cred-id", userId, TEST_WEBAUTHN_USER_ID).run();
}

// ... keep applyMigrations, fetchJson, createBatch as-is
```

Remove `linkServiceToken`, `serviceTokenHeaders`, `API_HEADERS` — dead code with CF Access removal.

Also update `createBatch` — it calls `authHeaders()` which is now async, so `createBatch` must also `await authHeaders()`.

**Important:** Since `authHeaders` is now async:
1. Every `headers: authHeaders(email)` becomes `headers: await authHeaders(email)`
2. Every `API_HEADERS` usage becomes `await authHeaders()` (inline in the test)
3. `createBatch` must `await authHeaders(email)` internally

**Step 3: Update all test files**

For files using `authHeaders()` directly — make the call async:
```typescript
// Before
headers: authHeaders("test@example.com")
// After
headers: await authHeaders("test@example.com")
```

For files using `API_HEADERS` constant — replace with inline async call:
```typescript
// Before
const res = await fetchJson("/api/v1/batches", { headers: API_HEADERS });
// After
const res = await fetchJson("/api/v1/batches", { headers: await authHeaders() });
```

This is a mechanical change across all test files. The test functions should already be `async` since they use `await` elsewhere.

**Step 4: Update `api/test/auth-helpers.test.ts`**

Update challenge tests to use new type `"oauth"` instead of `"bootstrap"`:

```typescript
it("stores and consumes a challenge", async () => {
  const id = await storeChallenge(env.DB, "test-challenge", "login");
  const result = await consumeChallenge(env.DB, id, "login");
  expect(result).not.toBeNull();
  expect(result!.challenge).toBe("test-challenge");
});

it("rejects wrong type", async () => {
  const id = await storeChallenge(env.DB, "test-challenge", "oauth");
  const result = await consumeChallenge(env.DB, id, "login");
  expect(result).toBeNull();
});

it("supports configurable TTL", async () => {
  const id = await storeChallenge(env.DB, "test-challenge", "oauth", undefined, 10);
  const result = await consumeChallenge(env.DB, id, "oauth");
  expect(result).not.toBeNull();
});
```

**Step 5: Run all tests**

Run: `cd api && npm run test`
Expected: All tests pass with session-based auth.

**Step 6: Commit**

```bash
git add api/test/
git commit -m "feat: rewrite test auth to use session cookies, remove CF Access test helpers"
```

---

### Task 5: Auth Routes Rewrite

**Goal:** Remove bootstrap routes, add GitHub OAuth routes, update status/settings/users/me endpoints. Delete CF Access code.

**Files:**
- Modify: `api/src/routes/auth.ts` (major rewrite)
- Modify: `api/src/app.ts` (mount users routes, remove old /me)
- Delete: `api/src/lib/access-jwt.ts`
- Delete: `api/test/access-jwt.test.ts` (tests CF Access JWT verification, being removed)
- Delete: `api/test/me.test.ts` (tests GET /api/v1/me, being replaced by /users/me)
- Test: `api/test/auth.test.ts` (rewrite)

**Step 1: Write tests for new auth routes**

Rewrite `api/test/auth.test.ts` to cover the new routes:

```typescript
import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { applyMigrations, authHeaders, seedSession, seedCredential, sessionHeaders, fetchJson } from "./helpers";

describe("GET /api/v1/auth/status", () => {
  beforeEach(async () => { await applyMigrations(); });

  it("returns authenticated: false when no session", async () => {
    const { json } = await fetchJson("/api/v1/auth/status");
    expect(json.authenticated).toBe(false);
  });

  it("returns authenticated: true with valid session", async () => {
    const { token } = await seedSession("test@example.com");
    const { json } = await fetchJson("/api/v1/auth/status", {
      headers: sessionHeaders(token),
    });
    expect(json.authenticated).toBe(true);
    expect(json.user.email).toBe("test@example.com");
    expect(json.isNewUser).toBe(false); // seedSession sets onboarded=1
  });

  it("returns isNewUser: true when not onboarded", async () => {
    const userId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users (id, email, name, onboarded) VALUES (?, ?, ?, 0)"
    ).bind(userId, "new@example.com", "New User", 0).run();
    const { token } = await seedSession("new@example.com");
    const { json } = await fetchJson("/api/v1/auth/status", {
      headers: sessionHeaders(token),
    });
    expect(json.authenticated).toBe(true);
    expect(json.isNewUser).toBe(true);
  });
});

describe("GET /api/v1/auth/settings", () => {
  beforeEach(async () => { await applyMigrations(); });

  it("returns registrationsOpen from settings table", async () => {
    const { json } = await fetchJson("/api/v1/auth/settings");
    expect(json.registrationsOpen).toBe(true);
  });

  it("reflects updated setting", async () => {
    await env.DB.prepare(
      "UPDATE settings SET value = 'false' WHERE key = 'registrations_open'"
    ).run();
    const { json } = await fetchJson("/api/v1/auth/settings");
    expect(json.registrationsOpen).toBe(false);
  });
});

describe("GET /api/v1/auth/github", () => {
  beforeEach(async () => { await applyMigrations(); });

  it("redirects to GitHub authorization URL", async () => {
    const res = await SELF.fetch("https://localhost/api/v1/auth/github", {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("Location")!;
    expect(location).toContain("github.com");
    expect(location).toContain("client_id=test-github-client-id");
  });

  it("stores OAuth challenge in auth_challenges", async () => {
    await SELF.fetch("https://localhost/api/v1/auth/github", {
      redirect: "manual",
    });
    const row = await env.DB.prepare(
      "SELECT type FROM auth_challenges LIMIT 1"
    ).first<{ type: string }>();
    expect(row?.type).toBe("oauth");
  });
});

describe("passkey login", () => {
  beforeEach(async () => { await applyMigrations(); });

  it("POST /login/options returns challenge", async () => {
    const { json, status } = await fetchJson("/api/v1/auth/login/options", {
      method: "POST",
    });
    expect(status).toBe(200);
    expect(json.challengeId).toBeDefined();
    expect(json.options).toBeDefined();
  });
});

describe("passkey register (authenticated)", () => {
  beforeEach(async () => { await applyMigrations(); });

  it("POST /register/options requires session", async () => {
    const res = await SELF.fetch("https://localhost/api/v1/auth/register/options", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("POST /register/options returns options with session", async () => {
    const headers = await authHeaders("test@example.com");
    const { json, status } = await fetchJson("/api/v1/auth/register/options", {
      method: "POST",
      headers,
    });
    expect(status).toBe(200);
    expect(json.challengeId).toBeDefined();
    expect(json.options).toBeDefined();
  });
});

describe("POST /api/v1/auth/logout", () => {
  beforeEach(async () => { await applyMigrations(); });

  it("clears session", async () => {
    const { token } = await seedSession("test@example.com");
    const res = await SELF.fetch("https://localhost/api/v1/auth/logout", {
      method: "POST",
      headers: sessionHeaders(token),
    });
    expect(res.status).toBe(200);

    // Session should be invalid now
    const { json } = await fetchJson("/api/v1/auth/status", {
      headers: sessionHeaders(token),
    });
    expect(json.authenticated).toBe(false);
  });
});

describe("GET /api/v1/users/me", () => {
  beforeEach(async () => { await applyMigrations(); });

  it("requires auth", async () => {
    const res = await SELF.fetch("https://localhost/api/v1/users/me");
    expect(res.status).toBe(401);
  });

  it("returns user profile", async () => {
    const headers = await authHeaders("test@example.com");
    const { json } = await fetchJson("/api/v1/users/me", { headers });
    expect(json.email).toBe("test@example.com");
  });
});

describe("PATCH /api/v1/users/me", () => {
  beforeEach(async () => { await applyMigrations(); });

  it("updates name", async () => {
    const headers = await authHeaders("test@example.com");
    const { json } = await fetchJson("/api/v1/users/me", {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated Name" }),
    });
    expect(json.name).toBe("Updated Name");
  });

  it("marks onboarded", async () => {
    // Create un-onboarded user
    const userId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users (id, email, name, onboarded) VALUES (?, ?, ?, 0)"
    ).bind(userId, "new@example.com", "New", 0).run();
    const { token } = await seedSession("new@example.com");

    const { json } = await fetchJson("/api/v1/users/me", {
      method: "PATCH",
      headers: { ...sessionHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ onboarded: true }),
    });
    expect(json.onboarded).toBe(true);
  });

  it("rejects name over 100 chars", async () => {
    const headers = await authHeaders("test@example.com");
    const { status } = await fetchJson("/api/v1/users/me", {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x".repeat(101) }),
    });
    expect(status).toBe(400);
  });
});

describe("auth cron cleanup", () => {
  beforeEach(async () => { await applyMigrations(); });

  it("removes expired sessions and challenges", async () => {
    // Insert expired rows
    await env.DB.prepare(
      "INSERT INTO auth_sessions (id, user_id, expires_at) VALUES ('expired-hash', 'user1', datetime('now', '-1 hour'))"
    ).run();
    await env.DB.prepare(
      "INSERT INTO auth_challenges (id, challenge, type, expires_at) VALUES ('expired-id', 'ch', 'login', datetime('now', '-1 hour'))"
    ).run();

    const { cleanupAuthTables } = await import("../src/cron");
    await cleanupAuthTables(env.DB);

    const session = await env.DB.prepare("SELECT id FROM auth_sessions WHERE id = 'expired-hash'").first();
    const challenge = await env.DB.prepare("SELECT id FROM auth_challenges WHERE id = 'expired-id'").first();
    expect(session).toBeNull();
    expect(challenge).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run test/auth.test.ts`
Expected: Tests fail because routes don't exist yet.

**Step 3: Rewrite `api/src/routes/auth.ts`**

Remove bootstrap routes, `constantTimeEqual`, CF Access status check. Add GitHub OAuth routes, settings, users/me. Update imports from `access-jwt` to `encoding`.

The key new routes:

- `GET /github` — create `GitHub` instance from `arctic`, generate authorization URL with state stored in `auth_challenges` (type `"oauth"`, TTL 10 min), redirect.
- `GET /github/callback` — validate state, exchange code for token, fetch GitHub profile + emails, find or create user, create session, redirect.
- `GET /settings` — read `registrations_open` from `settings` table.
- `GET /status` — simplified: check session, return `{ authenticated, isNewUser?, user? }`.
- `GET /users/me` — return authenticated user profile.
- `PATCH /users/me` — update name, mark onboarded.

Keep passkey login/register/logout routes largely unchanged, just update imports.

Key implementation details for the GitHub callback:
- Use `arctic`'s `GitHub` class: `new GitHub(clientId, clientSecret, null)` — null redirectUri means it must be set per-call or already configured in GitHub
- `github.createAuthorizationURL(state, scopes)` returns a URL
- `github.validateAuthorizationCode(code)` returns tokens
- Fetch profile: `GET https://api.github.com/user` with `Authorization: Bearer <token>`
- If email is null, fetch `GET https://api.github.com/user/emails` and find primary verified
- Look up `oauth_accounts` by `(provider, provider_user_id)`
- If not found, check users by email (existing user migration path)
- If no user, check `registrations_open`, create user + oauth_account

**Step 4: Delete dead files**

- Delete `api/src/lib/access-jwt.ts` — all consumers updated (`auth.ts` imports from `encoding.ts`, middleware no longer calls `verifyAccessJwt`)
- Delete `api/test/access-jwt.test.ts` — tests CF Access JWT verification which is removed
- Delete `api/test/me.test.ts` — tests `GET /api/v1/me` which is replaced by `GET /api/v1/users/me` (tested in `auth.test.ts`)

**Step 5: Mount users routes in `api/src/app.ts`**

The users/me routes are defined in `auth.ts` and mounted on the auth router. No separate users router needed — they share the session auth context.

Actually, since `/api/v1/users/me` is at a different path than `/api/v1/auth/*`, we should create a small users router or mount it directly in `app.ts`. The simplest approach: export a `usersRouter` from `routes/auth.ts` or a new `routes/users.ts` file.

**Step 6: Run tests**

Run: `cd api && npm run test`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add api/src/routes/auth.ts api/src/app.ts api/test/auth.test.ts
git rm api/src/lib/access-jwt.ts api/test/access-jwt.test.ts api/test/me.test.ts
git commit -m "feat: GitHub OAuth routes, remove bootstrap, delete CF Access JWT verification"
```

---

### Task 6: Dashboard — API Client and Auth Types

**Goal:** Update dashboard API client, remove bootstrap methods, add OAuth and user profile methods.

**Files:**
- Modify: `dashboard/src/api.ts`
- Modify: `dashboard/src/types.ts` (add auth types if needed)

**Step 1: Update `dashboard/src/api.ts`**

Remove `bootstrapOptions` and `bootstrap` methods. Update `status` return type. Add `getSettings`, `getMe`, `updateMe`.

Note: `apiFetch` accepts `{ method?, body? }` — it auto-sets `Content-Type: application/json` and calls `JSON.stringify` when `body` is provided. Do NOT pass `headers` or pre-stringify body.

```typescript
// Auth namespace updates
auth: {
  status: () => apiFetch<{
    authenticated: boolean;
    isNewUser?: boolean;
    user?: { id: string; email: string; name: string | null; avatarUrl: string | null };
  }>("/api/v1/auth/status"),

  settings: () => apiFetch<{ registrationsOpen: boolean }>("/api/v1/auth/settings"),

  loginOptions: () => apiFetch<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>("/api/v1/auth/login/options", { method: "POST" }),
  login: (body: { challengeId: string; credential: AuthenticationResponseJSON }) =>
    apiFetch("/api/v1/auth/login", { method: "POST", body }),

  registerOptions: () => apiFetch<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>("/api/v1/auth/register/options", { method: "POST" }),
  register: (body: { challengeId: string; credential: RegistrationResponseJSON }) =>
    apiFetch("/api/v1/auth/register", { method: "POST", body }),

  logout: () => apiFetch("/api/v1/auth/logout", { method: "POST" }),
},

users: {
  me: () => apiFetch<{ id: string; email: string; name: string | null; avatarUrl: string | null; onboarded: boolean }>("/api/v1/users/me"),
  updateMe: (body: { name?: string; onboarded?: true }) =>
    apiFetch<{ id: string; email: string; name: string | null; avatarUrl: string | null; onboarded: boolean }>("/api/v1/users/me", {
      method: "PATCH",
      body,
    }),
},
```

Remove the old `me` method.

**Step 2: Run dashboard type check**

Run: `cd dashboard && npm run lint`
Expected: Type errors from components still using old `bootstrapOptions`/`bootstrap` methods. These will be fixed in subsequent tasks.

**Step 3: Commit**

```bash
git add dashboard/src/api.ts
git commit -m "feat: update dashboard API client for OAuth auth"
```

---

### Task 7: Dashboard — AuthGate and Login Page

**Goal:** Simplify AuthGate to two states. Redesign Login page with GitHub button + passkey link.

**Files:**
- Modify: `dashboard/src/components/AuthGate.tsx`
- Modify: `dashboard/src/pages/Login.tsx`
- Delete: `dashboard/src/pages/Setup.tsx`

**Step 1: Rewrite `dashboard/src/components/AuthGate.tsx`**

Simplify to two states with React context so App.tsx can check `isNewUser` for welcome routing:

```tsx
import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { api, setOnUnauthorized } from "@/api";
import { Login } from "@/pages/Login";

interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

interface AuthContextValue {
  user: AuthUser;
  isNewUser: boolean;
  refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthGate");
  return ctx;
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ authenticated: boolean; isNewUser?: boolean; user?: AuthUser } | null>(null);

  const refreshAuth = async () => {
    try {
      const s = await api.auth.status();
      setState(s);
    } catch {
      setState({ authenticated: false });
    }
  };

  useEffect(() => {
    setOnUnauthorized(() => setState({ authenticated: false }));
    refreshAuth();
  }, []);

  if (state === null) {
    return <div className="flex min-h-screen items-center justify-center"><div className="animate-pulse text-muted-foreground">Loading…</div></div>;
  }

  if (!state.authenticated || !state.user) {
    return <Login />;
  }

  return (
    <AuthContext.Provider value={{ user: state.user, isNewUser: state.isNewUser ?? false, refreshAuth }}>
      {children}
    </AuthContext.Provider>
  );
}
```

**Step 2: Redesign `dashboard/src/pages/Login.tsx`**

Note: `Login` uses `useSearchParams` from react-router-dom. In the current code, `AuthGate` wraps `BrowserRouter`, so `Login` renders outside the router. Task 8 restructures `App.tsx` to put `AuthGate` inside `BrowserRouter`. If implementing tasks sequentially, `useSearchParams` won't work until Task 8. As a workaround, use `new URLSearchParams(window.location.search)` or implement Task 8 first.

```tsx
import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { startAuthentication } from "@simplewebauthn/browser";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function Login() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [registrationsOpen, setRegistrationsOpen] = useState(true);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  useEffect(() => {
    const errorParam = searchParams.get("error");
    if (errorParam === "registrations_closed") {
      setError("Registrations are currently closed.");
    } else if (errorParam === "github_error") {
      setError("GitHub sign-in failed. Please try again.");
    } else if (errorParam === "email_required") {
      setError("A verified email address is required.");
    }
    api.auth.settings().then((s) => setRegistrationsOpen(s.registrationsOpen)).catch(() => {});
  }, [searchParams]);

  const handlePasskeyLogin = async () => {
    setPasskeyLoading(true);
    setError(null);
    try {
      const { challengeId, options } = await api.auth.loginOptions();
      const credential = await startAuthentication({ optionsJSON: options });
      await api.auth.login({ challengeId, credential });
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Passkey login failed");
    } finally {
      setPasskeyLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Wine Cellar</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button asChild size="lg" className="w-full">
            <a href="/api/v1/auth/github">Sign in with GitHub</a>
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
            <div className="relative flex justify-center text-xs uppercase"><span className="bg-background px-2 text-muted-foreground">or</span></div>
          </div>

          <Button variant="outline" size="lg" className="w-full" onClick={handlePasskeyLogin} disabled={passkeyLoading}>
            {passkeyLoading ? "Waiting for passkey…" : "Sign in with Passkey"}
          </Button>

          {!registrationsOpen && (
            <p className="text-center text-sm text-muted-foreground">New signups are currently closed</p>
          )}

          {error && (
            <p className="text-center text-sm text-destructive">{error}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 3: Delete `dashboard/src/pages/Setup.tsx`**

Remove the file.

**Step 4: Run dashboard build**

Run: `cd dashboard && npm run build`
Expected: Build succeeds (or only warns about unused imports that will be cleaned up in later tasks).

**Step 5: Commit**

```bash
git add dashboard/src/components/AuthGate.tsx dashboard/src/pages/Login.tsx
git rm dashboard/src/pages/Setup.tsx
git commit -m "feat: simplified AuthGate, GitHub + passkey Login page"
```

---

### Task 8: Dashboard — Welcome Page, App Routing, Settings Update

**Goal:** Create Welcome page (outside Layout), update App.tsx routing, update Settings with GitHub account info.

**Files:**
- Create: `dashboard/src/pages/Welcome.tsx`
- Modify: `dashboard/src/App.tsx`
- Modify: `dashboard/src/pages/Settings.tsx`

**Step 1: Create `dashboard/src/pages/Welcome.tsx`**

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { startRegistration } from "@simplewebauthn/browser";
import { api } from "@/api";
import { useAuth } from "@/components/AuthGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function Welcome() {
  const { user, refreshAuth } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(user.name ?? "");
  const [saving, setSaving] = useState(false);
  const [passkeyAdded, setPasskeyAdded] = useState(false);

  const handleAddPasskey = async () => {
    try {
      const { challengeId, options } = await api.auth.registerOptions();
      const credential = await startRegistration({ optionsJSON: options });
      await api.auth.register({ challengeId, credential });
      setPasskeyAdded(true);
      toast.success("Passkey added!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add passkey");
    }
  };

  const handleContinue = async () => {
    setSaving(true);
    try {
      await api.users.updateMe({ name: name.trim() || undefined, onboarded: true });
      await refreshAuth();
      navigate("/", { replace: true });
    } catch (e) {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Welcome to Wine Cellar</CardTitle>
          <CardDescription>Set up your account</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Display name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              Add a passkey for quick access with Face ID or Touch ID. You can also do this later from Settings.
            </p>
            <Button variant="outline" onClick={handleAddPasskey} disabled={passkeyAdded}>
              {passkeyAdded ? "Passkey added" : "Set up Face ID / Touch ID"}
            </Button>
          </div>

          <Button size="lg" onClick={handleContinue} disabled={saving}>
            {saving ? "Saving…" : "Continue to dashboard"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 2: Update `dashboard/src/App.tsx` routing**

Add Welcome route outside Layout, add redirect logic for `isNewUser`:

```tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthGate, useAuth } from "@/components/AuthGate";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster } from "@/components/ui/sonner";
import { Layout } from "@/components/Layout";
import { Welcome } from "@/pages/Welcome";
// ... other page imports

function AuthenticatedRoutes() {
  const { isNewUser } = useAuth();

  if (isNewUser) {
    return (
      <Routes>
        <Route path="/welcome" element={<Welcome />} />
        <Route path="*" element={<Navigate to="/welcome" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="batches" element={<Batches />} />
        {/* ... existing routes */}
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthGate>
          <AuthenticatedRoutes />
        </AuthGate>
      </BrowserRouter>
      <Toaster />
    </ThemeProvider>
  );
}
```

**Step 3: Update `dashboard/src/pages/Settings.tsx`**

Update the `AccountSection` to show GitHub account info and remove bootstrap references:

```tsx
function AccountSection() {
  const { user } = useAuth();
  // ... existing passkey state

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* GitHub account info */}
        <div className="flex items-center gap-3">
          {user.avatarUrl && (
            <img src={user.avatarUrl} alt="" className="h-10 w-10 rounded-full" />
          )}
          <div>
            <p className="font-medium">{user.name ?? user.email}</p>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
        </div>

        <div className="border-t pt-4">
          {/* Existing passkey registration button */}
          <Button variant="outline" onClick={handleAddPasskey} disabled={addingPasskey}>
            {addingPasskey ? "Waiting for passkey…" : "Add Passkey"}
          </Button>
        </div>

        <div className="border-t pt-4">
          <Button variant="destructive" onClick={handleLogout}>Log Out</Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

Import `useAuth` from `AuthGate` in Settings.

**Step 4: Run dashboard build and tests**

Run: `cd dashboard && npm run build && npm run test`
Expected: Build succeeds, tests pass.

**Step 5: Commit**

```bash
git add dashboard/src/pages/Welcome.tsx dashboard/src/App.tsx dashboard/src/pages/Settings.tsx
git commit -m "feat: Welcome page, updated routing and Settings with GitHub account info"
```

---

### Post-Implementation Checklist

- [ ] All API tests pass (`cd api && npm run test`)
- [ ] All dashboard tests pass (`cd dashboard && npm run test`)
- [ ] Dashboard builds (`cd dashboard && npm run build`)
- [ ] API type checks (`cd api && npm run lint`)
- [ ] Dashboard lints (`cd dashboard && npm run lint`)
- [ ] No references to CF Access remain in code (grep for `CF_ACCESS`, `access-jwt`, `verifyAccessJwt`, `service_token`)
- [ ] No references to bootstrap remain (grep for `bootstrap`, `SETUP_TOKEN`, `setup_token`, `setupToken`)
- [ ] No references to `API_HEADERS` remain in tests
- [ ] `api/src/lib/access-jwt.ts` is deleted
- [ ] `api/test/access-jwt.test.ts` is deleted
- [ ] `api/test/me.test.ts` is deleted
- [ ] `dashboard/src/pages/Setup.tsx` is deleted
- [ ] Migration file `0009_oauth_auth.sql` is correct and complete
- [ ] `authHeaders()` is async everywhere, no module-level `API_HEADERS` constant
