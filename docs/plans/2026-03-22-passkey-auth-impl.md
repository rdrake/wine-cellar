# Passkey Authentication Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Face ID / Touch ID passkey authentication, replacing Cloudflare Access as the primary auth mechanism.

**Architecture:** WebAuthn passkeys via `@simplewebauthn/server` (API) and `@simplewebauthn/browser` (dashboard). `__Host-session` cookies replace CF Access JWTs for ongoing auth. CF Access JWT remains as recovery-only fallback. New `AuthGate` component wraps the dashboard, presenting Setup/Login pages based on auth state from `GET /api/v1/auth/status`.

**Tech Stack:** `@simplewebauthn/server` v13+, `@simplewebauthn/browser` v13+, Hono cookie helpers, Web Crypto API (SHA-256 session hashing, HMAC constant-time comparison).

**Design doc:** `docs/plans/2026-03-22-passkey-auth-design.md` — read this for full rationale on every design decision.

---

### Task 1: Foundation — Migration, Dependencies, Bindings

**Files:**
- Create: `api/migrations/0008_passkey_auth.sql`
- Modify: `api/src/app.ts:12-20` (Bindings type)
- Modify: `api/src/lib/errors.ts` (add `forbidden` helper)
- Modify: `api/vitest.config.ts:17-23` (test bindings)
- Modify: `api/wrangler.toml` (add vars)

**Step 1: Create the migration**

```sql
-- api/migrations/0008_passkey_auth.sql

-- Passkey credentials
CREATE TABLE passkey_credentials (
  id TEXT PRIMARY KEY,                  -- Credential ID (base64url)
  user_id TEXT NOT NULL REFERENCES users(id),
  public_key BLOB NOT NULL,            -- COSE public key bytes
  webauthn_user_id TEXT NOT NULL,       -- Random 64-byte handle (base64url), same for all creds of one user
  sign_count INTEGER DEFAULT 0,        -- Replay detection
  transports TEXT,                     -- JSON array, e.g. '["internal","hybrid"]'
  device_type TEXT,                    -- "singleDevice" or "multiDevice"
  backed_up INTEGER DEFAULT 0,         -- Whether synced (iCloud Keychain, etc.)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE INDEX idx_passkey_credentials_user ON passkey_credentials(user_id);

-- Auth challenges (single-use, 5-minute TTL)
CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,             -- Base64url challenge value
  type TEXT NOT NULL CHECK (type IN ('bootstrap', 'login', 'register')),
  user_id TEXT,                        -- Set for 'register', null for 'login'/'bootstrap'
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Auth sessions (hashed tokens)
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,                 -- SHA-256 hash of raw token (hex)
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_expires ON auth_sessions(expires_at);
CREATE INDEX idx_auth_challenges_expires ON auth_challenges(expires_at);
```

**Step 2: Install dependencies**

Run: `cd api && npm install @simplewebauthn/server`
Run: `cd dashboard && npm install @simplewebauthn/browser`

**Step 3: Add `forbidden` error helper**

Add to `api/src/lib/errors.ts`:

```typescript
export function forbidden(message: string) {
  return Response.json(
    { error: "forbidden", message },
    { status: 403 },
  );
}
```

**Step 4: Update Bindings type**

In `api/src/app.ts`, update the `Bindings` type:

```typescript
export type Bindings = {
  DB: D1Database;
  CF_ACCESS_AUD?: string;   // Recovery-only: set when CF Access is temporarily re-enabled
  CF_ACCESS_TEAM: string;
  WEBHOOK_TOKEN: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  SETUP_TOKEN?: string;     // Bootstrap: Wrangler secret for first-time setup
  RP_ID: string;            // WebAuthn relying party ID (e.g. "localhost" or "wine-cellar-dashboard.pages.dev")
  RP_ORIGIN: string;        // WebAuthn expected origin (e.g. "http://localhost:5173" or "https://wine-cellar-dashboard.pages.dev")
};
```

Note: `CF_ACCESS_AUD` becomes optional — the middleware will skip JWT verification when it's unset. The legacy `API_KEY?: string` field is intentionally removed — it was unused in any source code (only in the type).

Also update `AccessBindings` in `api/src/middleware/access.ts` to match (or remove it and import `Bindings` from app.ts).

**Important:** When CF Access is disabled in production and `CF_ACCESS_AUD` is unset, the JWT fallback path is skipped entirely. This does NOT affect service token access because the webhook endpoint (the only service-token consumer for RAPT Pill data ingestion) bypasses auth middleware entirely via the `/webhook` exempt path.

**Step 5: Update vitest config**

In `api/vitest.config.ts`, add bindings:

```typescript
bindings: {
  CF_ACCESS_AUD: "test-aud",
  CF_ACCESS_TEAM: "test",
  WEBHOOK_TOKEN: "test-webhook-token",
  VAPID_PUBLIC_KEY: "test-vapid-public-key",
  VAPID_PRIVATE_KEY: "test-vapid-private-key",
  SETUP_TOKEN: "test-setup-token",
  RP_ID: "localhost",
  RP_ORIGIN: "http://localhost",  // Matches SELF.fetch test origin
  MIGRATION_SQL: migrationSql,
},
```

Note: `RP_ORIGIN` is set to `"http://localhost"` because `SELF.fetch()` in the test pool sends requests to `http://localhost`. This value is only used by `verifyRegistrationResponse`/`verifyAuthenticationResponse` for origin checking — since the plan's API tests don't exercise full WebAuthn verification (the browser-side credential creation can't be simulated in Workers), this binding is used mainly to verify the options endpoints return the correct `rpId`.

**Step 6: Add env vars to wrangler.toml**

Add under `[vars]`:

```toml
RP_ID = "wine-cellar-dashboard.pages.dev"
RP_ORIGIN = "https://wine-cellar-dashboard.pages.dev"
```

`SETUP_TOKEN` is a Wrangler secret (not a toml var) — set via `wrangler secret put SETUP_TOKEN`.

**Step 7: Verify and commit**

Run: `cd api && npm run lint`
Run: `cd api && npm run test`

Expected: All existing tests pass (migration adds tables, doesn't break anything).

```bash
git add api/migrations/0008_passkey_auth.sql api/src/app.ts api/src/lib/errors.ts api/vitest.config.ts api/wrangler.toml api/package.json api/package-lock.json dashboard/package.json dashboard/package-lock.json
git commit -m "feat: add passkey auth foundation — migration, dependencies, bindings"
```

---

### Task 2: Session & Challenge Helpers

**Files:**
- Create: `api/src/lib/auth-session.ts`
- Create: `api/src/lib/auth-challenge.ts`
- Create: `api/test/auth-helpers.test.ts`

**Context:** These are pure helper modules (no routes). They handle session token generation/hashing/validation and challenge storage/consumption against D1. All crypto uses the Web Crypto API (available in Workers).

**Step 1: Write failing tests for session helpers**

Create `api/test/auth-helpers.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations, TEST_USER_EMAIL, authHeaders, fetchJson } from "./helpers";
import { createSession, validateSession, deleteSession, cleanupExpiredSessions, hashToken } from "../src/lib/auth-session";
import { storeChallenge, consumeChallenge, cleanupExpiredChallenges } from "../src/lib/auth-challenge";

describe("auth session helpers", () => {
  let userId: string;

  beforeEach(async () => {
    await applyMigrations();
    // Create a user via the existing auth flow
    await fetchJson("/api/v1/me", { headers: authHeaders() });
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(TEST_USER_EMAIL).first<{ id: string }>();
    userId = user!.id;
  });

  it("creates and validates a session", async () => {
    const { token } = await createSession(env.DB, userId);
    expect(token).toHaveLength(64); // 32 bytes hex
    const result = await validateSession(env.DB, token);
    expect(result).toBe(userId);
  });

  it("returns null for invalid token", async () => {
    const result = await validateSession(env.DB, "nonexistent");
    expect(result).toBeNull();
  });

  it("deletes a session", async () => {
    const { token } = await createSession(env.DB, userId);
    await deleteSession(env.DB, token);
    const result = await validateSession(env.DB, token);
    expect(result).toBeNull();
  });

  it("does not validate expired sessions", async () => {
    const { token, hash } = await createSession(env.DB, userId);
    // Manually expire the session
    await env.DB.prepare("UPDATE auth_sessions SET expires_at = datetime('now', '-1 hour') WHERE id = ?")
      .bind(hash).run();
    const result = await validateSession(env.DB, token);
    expect(result).toBeNull();
  });

  it("cleans up expired sessions", async () => {
    const { hash } = await createSession(env.DB, userId);
    await env.DB.prepare("UPDATE auth_sessions SET expires_at = datetime('now', '-1 hour') WHERE id = ?")
      .bind(hash).run();
    await cleanupExpiredSessions(env.DB);
    const row = await env.DB.prepare("SELECT COUNT(*) as count FROM auth_sessions").first<{ count: number }>();
    expect(row!.count).toBe(0);
  });
});

describe("auth challenge helpers", () => {
  beforeEach(async () => {
    await applyMigrations();
  });

  it("stores and consumes a challenge", async () => {
    const challengeId = await storeChallenge(env.DB, "test-challenge-value", "login");
    const result = await consumeChallenge(env.DB, challengeId, "login");
    expect(result).not.toBeNull();
    expect(result!.challenge).toBe("test-challenge-value");
    expect(result!.userId).toBeNull();
  });

  it("stores challenge with user_id for register type", async () => {
    const challengeId = await storeChallenge(env.DB, "test-challenge", "register", "user-123");
    const result = await consumeChallenge(env.DB, challengeId, "register");
    expect(result!.userId).toBe("user-123");
  });

  it("returns null for wrong type", async () => {
    const challengeId = await storeChallenge(env.DB, "test-challenge", "login");
    const result = await consumeChallenge(env.DB, challengeId, "bootstrap");
    expect(result).toBeNull();
  });

  it("challenge is single-use", async () => {
    const challengeId = await storeChallenge(env.DB, "test-challenge", "login");
    await consumeChallenge(env.DB, challengeId, "login");
    const second = await consumeChallenge(env.DB, challengeId, "login");
    expect(second).toBeNull();
  });

  it("does not consume expired challenge", async () => {
    const challengeId = await storeChallenge(env.DB, "test-challenge", "login");
    await env.DB.prepare("UPDATE auth_challenges SET expires_at = datetime('now', '-1 minute') WHERE id = ?")
      .bind(challengeId).run();
    const result = await consumeChallenge(env.DB, challengeId, "login");
    expect(result).toBeNull();
  });

  it("cleans up expired challenges", async () => {
    await storeChallenge(env.DB, "c1", "login");
    const activeId = await storeChallenge(env.DB, "c2", "login");
    // Expire the first one
    await env.DB.prepare("UPDATE auth_challenges SET expires_at = datetime('now', '-1 minute') WHERE challenge = 'c1'").run();
    await cleanupExpiredChallenges(env.DB);
    const count = await env.DB.prepare("SELECT COUNT(*) as count FROM auth_challenges").first<{ count: number }>();
    expect(count!.count).toBe(1);
    // The active one should still work
    const result = await consumeChallenge(env.DB, activeId, "login");
    expect(result).not.toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run test/auth-helpers.test.ts`
Expected: FAIL — modules don't exist yet.

**Step 3: Implement session helpers**

Create `api/src/lib/auth-session.ts`:

```typescript
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context } from "hono";

const SESSION_DURATION_SECONDS = 86400; // 24 hours

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(
  db: D1Database,
  userId: string,
): Promise<{ token: string; hash: string }> {
  const token = generateToken();
  const hash = await hashToken(token);
  await db
    .prepare("INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))")
    .bind(hash, userId)
    .run();
  return { token, hash };
}

export async function validateSession(db: D1Database, token: string): Promise<string | null> {
  const hash = await hashToken(token);
  const row = await db
    .prepare("SELECT user_id FROM auth_sessions WHERE id = ? AND expires_at > datetime('now')")
    .bind(hash)
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  const hash = await hashToken(token);
  await db.prepare("DELETE FROM auth_sessions WHERE id = ?").bind(hash).run();
}

export async function cleanupExpiredSessions(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM auth_sessions WHERE expires_at <= datetime('now')").run();
}

export function getSessionToken(c: Context): string | null {
  // Check both names: __Host-session (prod HTTPS) and session (dev HTTP)
  return getCookie(c, "__Host-session") ?? getCookie(c, "session") ?? null;
}

export function setSessionCookie(c: Context, token: string, secure: boolean): void {
  const name = secure ? "__Host-session" : "session";
  setCookie(c, name, token, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export function clearSessionCookie(c: Context, secure: boolean): void {
  const name = secure ? "__Host-session" : "session";
  deleteCookie(c, name, { path: "/" });
}
```

**Step 4: Implement challenge helpers**

Create `api/src/lib/auth-challenge.ts`:

```typescript
export type ChallengeType = "bootstrap" | "login" | "register";

export async function storeChallenge(
  db: D1Database,
  challenge: string,
  type: ChallengeType,
  userId?: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO auth_challenges (id, challenge, type, user_id, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+5 minutes'))",
    )
    .bind(id, challenge, type, userId ?? null)
    .run();
  return id;
}

export async function consumeChallenge(
  db: D1Database,
  challengeId: string,
  expectedType: ChallengeType,
): Promise<{ challenge: string; userId: string | null } | null> {
  const row = await db
    .prepare(
      "DELETE FROM auth_challenges WHERE id = ? AND type = ? AND expires_at > datetime('now') RETURNING challenge, user_id",
    )
    .bind(challengeId, expectedType)
    .first<{ challenge: string; user_id: string | null }>();
  if (!row) return null;
  return { challenge: row.challenge, userId: row.user_id };
}

export async function cleanupExpiredChallenges(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM auth_challenges WHERE expires_at <= datetime('now')").run();
}
```

**Step 5: Run tests to verify they pass**

Run: `cd api && npx vitest run test/auth-helpers.test.ts`
Expected: All PASS.

Run: `cd api && npm run test`
Expected: All existing tests still pass.

**Step 6: Commit**

```bash
git add api/src/lib/auth-session.ts api/src/lib/auth-challenge.ts api/test/auth-helpers.test.ts
git commit -m "feat: add auth session and challenge helpers with tests"
```

---

### Task 3: Auth Middleware Rewrite

**Files:**
- Modify: `api/src/middleware/access.ts`

**Context:** Rewrite the auth middleware to support dual auth: session cookies (primary, passkey path) and CF Access JWT (recovery fallback). The middleware must remain backward-compatible — existing tests use `authHeaders()` which sends `Cf-Access-Jwt-Assertion`, and `CF_ACCESS_AUD` is set in the test env, so those tests go through the JWT fallback path unchanged.

**Exempt routes** (skip auth entirely):
- `/health`
- `/webhook/*`
- `/api/v1/auth/status`
- `/api/v1/auth/login/*` (login/options and login)
- `/api/v1/auth/bootstrap/*` (bootstrap/options and bootstrap)

**Step 1: Write test for new middleware behavior**

Add a new test file `api/test/auth-middleware.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations, authHeaders, fetchJson, TEST_USER_EMAIL } from "./helpers";
import { createSession } from "../src/lib/auth-session";

describe("auth middleware", () => {
  let userId: string;

  beforeEach(async () => {
    await applyMigrations();
    // Seed a user via CF Access JWT path
    await fetchJson("/api/v1/me", { headers: authHeaders() });
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(TEST_USER_EMAIL).first<{ id: string }>();
    userId = user!.id;
  });

  it("allows exempt route /api/v1/auth/status without auth", async () => {
    const { status } = await fetchJson("/api/v1/auth/status");
    expect(status).toBe(200);
  });

  it("allows exempt route /api/v1/auth/login/options without auth", async () => {
    // POST with empty body — may fail validation but should not 401
    const { status } = await fetchJson("/api/v1/auth/login/options", { method: "POST" });
    expect(status).not.toBe(401);
  });

  it("returns 401 for protected route without auth", async () => {
    const { status } = await fetchJson("/api/v1/batches");
    expect(status).toBe(401);
  });

  it("authenticates via session cookie", async () => {
    const { token } = await createSession(env.DB, userId);
    const { status, json } = await fetchJson("/api/v1/me", {
      headers: { Cookie: `session=${token}` },
    });
    expect(status).toBe(200);
    expect(json.email).toBe(TEST_USER_EMAIL);
  });

  it("authenticates via CF Access JWT (backward compat)", async () => {
    const { status, json } = await fetchJson("/api/v1/me", {
      headers: authHeaders(),
    });
    expect(status).toBe(200);
    expect(json.email).toBe(TEST_USER_EMAIL);
  });

  it("returns 401 for expired session cookie", async () => {
    const { token, hash } = await createSession(env.DB, userId);
    await env.DB.prepare("UPDATE auth_sessions SET expires_at = datetime('now', '-1 hour') WHERE id = ?")
      .bind(hash).run();
    const { status } = await fetchJson("/api/v1/batches", {
      headers: { Cookie: `session=${token}` },
    });
    expect(status).toBe(401);
  });

  it("prefers session cookie over JWT when both present", async () => {
    const { token } = await createSession(env.DB, userId);
    const { status, json } = await fetchJson("/api/v1/me", {
      headers: {
        Cookie: `session=${token}`,
        "Cf-Access-Jwt-Assertion": authHeaders()["Cf-Access-Jwt-Assertion"],
      },
    });
    expect(status).toBe(200);
    expect(json.id).toBe(userId);
  });
});
```


**Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run test/auth-middleware.test.ts`
Expected: FAIL — exempt routes not configured, session cookie auth not implemented.

**Step 3: Rewrite the middleware**

Replace `api/src/middleware/access.ts`:

```typescript
import { createMiddleware } from "hono/factory";
import { verifyAccessJwt } from "../lib/access-jwt";
import { validateSession, getSessionToken } from "../lib/auth-session";
import { unauthorized } from "../lib/errors";

type User = { id: string; email: string; name: string | null };

export const accessAuth = createMiddleware<{
  Bindings: {
    DB: D1Database;
    CF_ACCESS_AUD?: string;
    CF_ACCESS_TEAM: string;
  };
  Variables: { user: User };
}>(async (c, next) => {
  const path = new URL(c.req.url).pathname;

  // Exempt routes — no auth required
  if (
    path === "/health" ||
    path.startsWith("/webhook") ||
    path === "/api/v1/auth/status" ||
    path.startsWith("/api/v1/auth/login") ||
    path.startsWith("/api/v1/auth/bootstrap")
  ) {
    return next();
  }

  const db = c.env.DB;

  // 1. Session cookie (primary path)
  const sessionToken = getSessionToken(c);
  if (sessionToken) {
    const userId = await validateSession(db, sessionToken);
    if (userId) {
      const user = await db
        .prepare("SELECT id, email, name FROM users WHERE id = ?")
        .bind(userId)
        .first<User>();
      if (user) {
        c.set("user", user);
        return next();
      }
    }
  }

  // 2. CF Access JWT (recovery fallback — only when CF_ACCESS_AUD is set)
  const jwt = c.req.header("Cf-Access-Jwt-Assertion");
  if (jwt && c.env.CF_ACCESS_AUD) {
    const result = await verifyAccessJwt(jwt, c.env.CF_ACCESS_AUD, c.env.CF_ACCESS_TEAM);
    if (result) {
      if (result.kind === "user") {
        const user = await db
          .prepare(
            `INSERT INTO users (id, email, created_at)
             VALUES (?, ?, datetime('now'))
             ON CONFLICT(email) DO UPDATE SET email = email
             RETURNING *`,
          )
          .bind(crypto.randomUUID(), result.email)
          .first<User>();
        if (user) {
          c.set("user", user);
          return next();
        }
      } else {
        // Service token JWT
        const mapping = await db
          .prepare("SELECT user_id FROM service_tokens WHERE client_id = ?")
          .bind(result.clientId)
          .first<{ user_id: string }>();
        if (mapping) {
          const user = await db
            .prepare("SELECT id, email, name FROM users WHERE id = ?")
            .bind(mapping.user_id)
            .first<User>();
          if (user) {
            c.set("user", user);
            return next();
          }
        }
      }
    }
  }

  return unauthorized("Authentication required");
});
```

**Step 4: Run all tests**

Run: `cd api && npm run test`
Expected: All existing tests pass (backward compat via JWT fallback) + new middleware tests pass.

**Step 5: Commit**

```bash
git add api/src/middleware/access.ts api/test/auth-middleware.test.ts
git commit -m "feat: rewrite auth middleware for dual session/JWT auth"
```

---

### Task 4: Auth Status & Bootstrap Routes

**Files:**
- Create: `api/src/routes/auth.ts`
- Modify: `api/src/app.ts` (mount auth routes)
- Create: `api/test/auth.test.ts`
- Modify: `api/test/helpers.ts` (add session/credential helpers)

**Context:** Implement three endpoints: `GET /auth/status` (unauthenticated, returns `{registered, authenticated}`), `POST /auth/bootstrap/options` (validates setup token + email, returns WebAuthn registration options), and `POST /auth/bootstrap` (verifies WebAuthn response, stores credential, issues session).

The `/auth/status` endpoint drives all three AuthGate states:
- `{ registered: false, authenticated: false }` → Setup page
- `{ registered: true, authenticated: false }` → Login page
- `{ registered: true, authenticated: true }` → Dashboard

**Step 1: Add test helpers**

Add to `api/test/helpers.ts`:

```typescript
import { createSession, hashToken } from "../src/lib/auth-session";

export function sessionHeaders(token: string): Record<string, string> {
  return { Cookie: `session=${token}` };
}

export async function seedSession(email: string = TEST_USER_EMAIL): Promise<{ token: string; userId: string }> {
  // Ensure user exists
  await fetchJson("/api/v1/me", { headers: authHeaders(email) });
  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email).first<{ id: string }>();
  const { token } = await createSession(env.DB, user!.id);
  return { token, userId: user!.id };
}

export async function seedCredential(userId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO passkey_credentials (id, user_id, public_key, webauthn_user_id, sign_count, transports, device_type, backed_up)
     VALUES (?, ?, X'00', ?, 0, '["internal"]', 'multiDevice', 1)`,
  ).bind("test-credential-id", userId, "test-webauthn-user-id").run();
}
```

Export `hashToken` from `auth-session.ts` and `createSession` (already exported).

**Step 2: Write failing tests**

Create `api/test/auth.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  applyMigrations, authHeaders, fetchJson, sessionHeaders,
  seedSession, seedCredential, TEST_USER_EMAIL,
} from "./helpers";

describe("GET /api/v1/auth/status", () => {
  beforeEach(async () => { await applyMigrations(); });

  it("returns registered=false when no credentials exist", async () => {
    const { status, json } = await fetchJson("/api/v1/auth/status");
    expect(status).toBe(200);
    expect(json.registered).toBe(false);
    expect(json.authenticated).toBe(false);
  });

  it("returns registered=true when credentials exist", async () => {
    // Seed user and credential
    await fetchJson("/api/v1/me", { headers: authHeaders() });
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(TEST_USER_EMAIL).first<{ id: string }>();
    await seedCredential(user!.id);

    const { json } = await fetchJson("/api/v1/auth/status");
    expect(json.registered).toBe(true);
    expect(json.authenticated).toBe(false);
  });

  it("returns authenticated=true with valid session cookie", async () => {
    const { token, userId } = await seedSession();
    await seedCredential(userId);

    const { json } = await fetchJson("/api/v1/auth/status", {
      headers: sessionHeaders(token),
    });
    expect(json.registered).toBe(true);
    expect(json.authenticated).toBe(true);
  });

  it("returns authenticated=true with CF Access JWT (recovery)", async () => {
    await fetchJson("/api/v1/me", { headers: authHeaders() });
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(TEST_USER_EMAIL).first<{ id: string }>();
    await seedCredential(user!.id);

    const { json } = await fetchJson("/api/v1/auth/status", {
      headers: authHeaders(),
    });
    expect(json.registered).toBe(true);
    expect(json.authenticated).toBe(true);
  });
});

describe("POST /api/v1/auth/bootstrap/options", () => {
  beforeEach(async () => { await applyMigrations(); });

  it("returns 403 with wrong setup token", async () => {
    const { status } = await fetchJson("/api/v1/auth/bootstrap/options", {
      method: "POST",
      body: { setupToken: "wrong-token", email: TEST_USER_EMAIL },
    });
    expect(status).toBe(403);
  });

  it("returns 404 when email not found", async () => {
    const { status } = await fetchJson("/api/v1/auth/bootstrap/options", {
      method: "POST",
      body: { setupToken: "test-setup-token", email: "nobody@example.com" },
    });
    expect(status).toBe(404);
  });

  it("returns 403 when credentials already exist", async () => {
    await fetchJson("/api/v1/me", { headers: authHeaders() });
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(TEST_USER_EMAIL).first<{ id: string }>();
    await seedCredential(user!.id);

    const { status } = await fetchJson("/api/v1/auth/bootstrap/options", {
      method: "POST",
      body: { setupToken: "test-setup-token", email: TEST_USER_EMAIL },
    });
    expect(status).toBe(403);
  });

  it("returns registration options for valid request", async () => {
    // Seed user first
    await fetchJson("/api/v1/me", { headers: authHeaders() });

    const { status, json } = await fetchJson("/api/v1/auth/bootstrap/options", {
      method: "POST",
      body: { setupToken: "test-setup-token", email: TEST_USER_EMAIL },
    });
    expect(status).toBe(200);
    expect(json.challengeId).toBeDefined();
    expect(json.options).toBeDefined();
    expect(json.options.rp.id).toBe("localhost");
    expect(json.options.user.name).toBe(TEST_USER_EMAIL);
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `cd api && npx vitest run test/auth.test.ts`
Expected: FAIL — routes don't exist yet.

**Step 4: Implement auth routes**

Create `api/src/routes/auth.ts` as a `Hono<AppEnv>` instance. The file contains all auth routes (status, bootstrap, login, register, logout will be added in later tasks).

**Constant-time comparison helper** (put at top of file):

```typescript
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", crypto.getRandomValues(new Uint8Array(32)),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const [sigA, sigB] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(a)),
    crypto.subtle.sign("HMAC", key, enc.encode(b)),
  ]);
  const a8 = new Uint8Array(sigA);
  const b8 = new Uint8Array(sigB);
  let diff = 0;
  for (let i = 0; i < a8.length; i++) diff |= a8[i] ^ b8[i];
  return diff === 0;
}
```

**`GET /status` implementation** — this is an unauthenticated route (exempt from middleware), so `c.get("user")` is NOT available. It must check auth state independently:

```typescript
auth.get("/status", async (c) => {
  const db = c.env.DB;

  // Check if any credentials are registered
  const credCount = await db
    .prepare("SELECT COUNT(*) as count FROM passkey_credentials")
    .first<{ count: number }>();
  const registered = (credCount?.count ?? 0) > 0;

  // Check if caller is authenticated (session cookie or CF Access JWT)
  let authenticated = false;

  const sessionToken = getSessionToken(c);
  if (sessionToken) {
    const userId = await validateSession(db, sessionToken);
    authenticated = !!userId;
  }

  // CF Access JWT fallback (recovery path)
  if (!authenticated) {
    const jwt = c.req.header("Cf-Access-Jwt-Assertion");
    if (jwt && c.env.CF_ACCESS_AUD) {
      const result = await verifyAccessJwt(jwt, c.env.CF_ACCESS_AUD, c.env.CF_ACCESS_TEAM);
      authenticated = !!result;
    }
  }

  return c.json({ registered, authenticated });
});
```

**`POST /bootstrap/options`** — validates setup token (constant-time), checks no credentials exist, looks up user by email, generates registration options, stores challenge. Returns `{ challengeId, options }`.

**`POST /bootstrap`** — validates setup token again, checks no credentials exist, looks up user, consumes challenge, calls `verifyRegistrationResponse`, stores credential, creates session, sets cookie. Returns `{ status: "ok" }`.

Key details:
- Import `generateRegistrationOptions`, `verifyRegistrationResponse` from `@simplewebauthn/server`.
- For `verifyRegistrationResponse`, the credential's `publicKey` is a `Uint8Array` that maps to BLOB in D1. The credential's `id` is already a base64url string.
- The `webauthn_user_id` is generated in `/bootstrap/options` as `crypto.getRandomValues(new Uint8Array(64))`, returned to the client as base64url, and round-tripped back in the `/bootstrap` request body. Store it in `passkey_credentials.webauthn_user_id`.
- After successful bootstrap, verify the response sets a session cookie by checking the `Set-Cookie` header contains `session=`.

**Step 5: Mount auth routes in app.ts**

In `api/src/app.ts`, add:

```typescript
import auth from "./routes/auth";
// ...
app.route("/api/v1/auth", auth);
```

Add this BEFORE the wildcard middleware (`app.use("*", accessAuth)`) — actually, the middleware already handles exempt routes, so order doesn't matter. Place the route registration with the other routes.

**Step 6: Run tests**

Run: `cd api && npx vitest run test/auth.test.ts`
Expected: All PASS.

Run: `cd api && npm run test`
Expected: All tests pass.

**Step 7: Commit**

```bash
git add api/src/routes/auth.ts api/src/app.ts api/test/auth.test.ts api/test/helpers.ts
git commit -m "feat: add auth status and bootstrap endpoints"
```

---

### Task 5: Login Routes

**Files:**
- Modify: `api/src/routes/auth.ts` (add login routes)
- Modify: `api/test/auth.test.ts` (add login tests)

**Context:** Implement `POST /auth/login/options` (generate authentication challenge, return options) and `POST /auth/login` (verify WebAuthn assertion, issue session cookie). These are unauthenticated endpoints — the user has a registered passkey but no active session.

**Step 1: Write failing tests**

Add to `api/test/auth.test.ts`:

```typescript
describe("POST /api/v1/auth/login/options", () => {
  beforeEach(async () => { await applyMigrations(); });

  it("returns authentication options", async () => {
    const { status, json } = await fetchJson("/api/v1/auth/login/options", {
      method: "POST",
    });
    expect(status).toBe(200);
    expect(json.challengeId).toBeDefined();
    expect(json.options).toBeDefined();
    expect(json.options.rpId).toBe("localhost");
    // allowCredentials should be empty (discoverable credentials)
    expect(json.options.allowCredentials).toEqual([]);
  });
});
```

Note: We can't easily test the full login flow (POST /auth/login) without a valid WebAuthn authenticator response. Test the error cases:

```typescript
describe("POST /api/v1/auth/login", () => {
  beforeEach(async () => { await applyMigrations(); });

  it("returns 401 for invalid challenge", async () => {
    const { status } = await fetchJson("/api/v1/auth/login", {
      method: "POST",
      body: { challengeId: "nonexistent", credential: {} },
    });
    expect(status).toBe(401);
  });
});
```

**Step 2: Implement login routes**

Add to `api/src/routes/auth.ts`:

- `POST /login/options`: call `generateAuthenticationOptions` with `rpID`, `userVerification: "required"`, empty `allowCredentials`. Store challenge. Return `{ challengeId, options }`.

- `POST /login`: consume challenge, extract `credential.response.userHandle` to find the user, look up the passkey credential by ID from `passkey_credentials`, call `verifyAuthenticationResponse` with the stored credential data. On success:
  - Update `sign_count` (with the sign-count check from the design doc)
  - Update `last_used_at`
  - Create session, set cookie
  - Return `{ status: "ok" }`

Key detail for sign count update:
```sql
UPDATE passkey_credentials
SET sign_count = ?, last_used_at = datetime('now')
WHERE id = ? AND (sign_count = 0 OR sign_count < ?)
```

If the UPDATE affects 0 rows AND the stored sign_count > 0, the counter went backward (possible cloned authenticator) — return 401.

When looking up the credential for verification, convert the stored BLOB `public_key` back to `Uint8Array`. D1 returns BLOBs as `ArrayBuffer`, so wrap with `new Uint8Array(row.public_key)`.

**Step 3: Run tests**

Run: `cd api && npx vitest run test/auth.test.ts`
Expected: All PASS.

**Step 4: Commit**

```bash
git add api/src/routes/auth.ts api/test/auth.test.ts
git commit -m "feat: add login endpoints for passkey authentication"
```

---

### Task 6: Register, Logout & Cron Cleanup

**Files:**
- Modify: `api/src/routes/auth.ts` (add register + logout routes)
- Modify: `api/src/cron.ts` (add auth cleanup)
- Modify: `api/test/auth.test.ts` (add register + logout tests)
- Modify: `api/test/cron.test.ts` (add cleanup test if exists, or add inline)

**Context:** `POST /auth/register/options` and `POST /auth/register` require an active session (authenticated user). They add additional passkeys to the user's account. `POST /auth/logout` deletes the session and clears the cookie. The cron job (already runs every 15 min) should clean up expired sessions and challenges.

**Step 1: Write failing tests**

```typescript
describe("POST /api/v1/auth/register/options", () => {
  beforeEach(async () => { await applyMigrations(); });

  it("returns 401 without session", async () => {
    const { status } = await fetchJson("/api/v1/auth/register/options", { method: "POST" });
    expect(status).toBe(401);
  });

  it("returns registration options with valid session", async () => {
    const { token, userId } = await seedSession();
    await seedCredential(userId);

    const { status, json } = await fetchJson("/api/v1/auth/register/options", {
      method: "POST",
      headers: sessionHeaders(token),
    });
    expect(status).toBe(200);
    expect(json.challengeId).toBeDefined();
    expect(json.options).toBeDefined();
    // Should exclude existing credentials
    expect(json.options.excludeCredentials).toHaveLength(1);
    expect(json.options.excludeCredentials[0].id).toBe("test-credential-id");
  });
});

describe("POST /api/v1/auth/logout", () => {
  beforeEach(async () => { await applyMigrations(); });

  it("returns 401 without session", async () => {
    const { status } = await fetchJson("/api/v1/auth/logout", { method: "POST" });
    expect(status).toBe(401);
  });

  it("deletes session and clears cookie", async () => {
    const { token } = await seedSession();

    const { status } = await fetchJson("/api/v1/auth/logout", {
      method: "POST",
      headers: sessionHeaders(token),
    });
    expect(status).toBe(200);

    // Session should be invalid now
    const { status: meStatus } = await fetchJson("/api/v1/me", {
      headers: sessionHeaders(token),
    });
    expect(meStatus).toBe(401);
  });
});
```

**Step 2: Implement register routes**

- `POST /register/options`: user is authenticated (middleware sets `c.get("user")`). Look up existing `webauthn_user_id` from `passkey_credentials` for this user. Look up existing credential IDs for `excludeCredentials`. Call `generateRegistrationOptions`. Store challenge with `user_id`. Return `{ challengeId, options }`.

- `POST /register`: user is authenticated. Consume challenge (must match type `"register"` and user_id must match session user). Call `verifyRegistrationResponse`. Store new credential. Return `{ status: "ok" }`.

**Step 3: Implement logout route**

- `POST /logout`: user is authenticated. Get session token from cookie, delete session from DB, clear cookie. Return `{ status: "ok" }`.

```typescript
// In auth.ts
auth.post("/logout", async (c) => {
  const token = getSessionToken(c);
  if (token) {
    await deleteSession(c.env.DB, token);
  }
  const secure = c.env.RP_ORIGIN.startsWith("https://");
  clearSessionCookie(c, secure);
  return c.json({ status: "ok" });
});
```

**Step 4: Add cron cleanup**

In `api/src/cron.ts`, add auth cleanup at the start of `evaluateAllBatches` (or create a separate exported function):

```typescript
import { cleanupExpiredSessions } from "./lib/auth-session";
import { cleanupExpiredChallenges } from "./lib/auth-challenge";

// Add to the beginning of evaluateAllBatches, or add a new function
export async function cleanupAuthTables(db: D1Database): Promise<void> {
  await Promise.all([
    cleanupExpiredSessions(db),
    cleanupExpiredChallenges(db),
  ]);
}
```

Call `cleanupAuthTables` from the `scheduled` handler in `api/src/index.ts`:

```typescript
async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
  ctx.waitUntil(Promise.all([
    cleanupAuthTables(env.DB),
    evaluateAllBatches(env.DB, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY),
  ]));
},
```

**Step 5: Write cron cleanup test**

Add to `api/test/auth.test.ts`:

```typescript
describe("auth cron cleanup", () => {
  beforeEach(async () => { await applyMigrations(); });

  it("removes expired sessions and challenges", async () => {
    const { token, userId } = await seedSession();

    // Expire the session
    const hash = await hashToken(token);
    await env.DB.prepare("UPDATE auth_sessions SET expires_at = datetime('now', '-1 hour') WHERE id = ?")
      .bind(hash).run();

    // Create an expired challenge
    await env.DB.prepare(
      "INSERT INTO auth_challenges (id, challenge, type, expires_at) VALUES ('c1', 'ch', 'login', datetime('now', '-1 hour'))"
    ).run();

    // Import and run cleanup
    const { cleanupAuthTables } = await import("../src/cron");
    await cleanupAuthTables(env.DB);

    const sessions = await env.DB.prepare("SELECT COUNT(*) as count FROM auth_sessions").first<{ count: number }>();
    const challenges = await env.DB.prepare("SELECT COUNT(*) as count FROM auth_challenges").first<{ count: number }>();
    expect(sessions!.count).toBe(0);
    expect(challenges!.count).toBe(0);
  });
});
```

Import `hashToken` from `../src/lib/auth-session` in the test file (or re-export via helpers).

**Step 6: Run tests**

Run: `cd api && npm run test`
Expected: All PASS.

**Step 7: Commit**

```bash
git add api/src/routes/auth.ts api/src/cron.ts api/src/index.ts api/test/auth.test.ts
git commit -m "feat: add register, logout endpoints and auth cron cleanup"
```

---

### Task 7: Dashboard — AuthGate, Setup & Login Pages

**Files:**
- Modify: `dashboard/src/api.ts` (add auth methods, change 401 handling)
- Create: `dashboard/src/components/AuthGate.tsx`
- Create: `dashboard/src/pages/Setup.tsx`
- Create: `dashboard/src/pages/Login.tsx`
- Modify: `dashboard/src/App.tsx` (wrap with AuthGate, move Toaster up)
- Modify: `dashboard/src/components/Layout.tsx` (remove Toaster)

**Context:** The AuthGate component wraps the entire app. On mount, it calls `GET /api/v1/auth/status` and renders one of three states: Setup (first-time), Login (returning user), or the full app (authenticated). The Setup page collects email + setup token and triggers WebAuthn registration. The Login page triggers WebAuthn authentication.

**Step 1: Add auth methods to api.ts**

Add a `setOnUnauthorized` callback system and auth API methods:

```typescript
// At module scope in api.ts
let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(cb: () => void) {
  onUnauthorized = cb;
}

// Change the 401 handling in apiFetch:
if (res.status === 401) {
  onUnauthorized?.();
  throw new ApiError(401, { error: "unauthorized", message: "Session expired" });
}

// Add auth namespace:
export const api = {
  // ... existing methods ...
  auth: {
    status: () =>
      apiFetch<{ registered: boolean; authenticated: boolean }>("/api/v1/auth/status"),
    bootstrapOptions: (data: { setupToken: string; email: string }) =>
      apiFetch<{ challengeId: string; options: any }>("/api/v1/auth/bootstrap/options", { method: "POST", body: data }),
    bootstrap: (data: { challengeId: string; credential: any; setupToken: string; email: string }) =>
      apiFetch<{ status: string }>("/api/v1/auth/bootstrap", { method: "POST", body: data }),
    loginOptions: () =>
      apiFetch<{ challengeId: string; options: any }>("/api/v1/auth/login/options", { method: "POST" }),
    login: (data: { challengeId: string; credential: any }) =>
      apiFetch<{ status: string }>("/api/v1/auth/login", { method: "POST", body: data }),
    registerOptions: () =>
      apiFetch<{ challengeId: string; options: any }>("/api/v1/auth/register/options", { method: "POST" }),
    register: (data: { challengeId: string; credential: any }) =>
      apiFetch<{ status: string }>("/api/v1/auth/register", { method: "POST", body: data }),
    logout: () =>
      apiFetch<{ status: string }>("/api/v1/auth/logout", { method: "POST" }),
  },
};
```

Use proper types from `@simplewebauthn/browser` for the `options` and `credential` params (e.g., `PublicKeyCredentialCreationOptionsJSON`, `RegistrationResponseJSON`, `AuthenticationResponseJSON`). If TypeScript types aren't directly available, use `any` and cast.

**Step 2: Create AuthGate component**

Create `dashboard/src/components/AuthGate.tsx`:

```tsx
import { useState, useEffect, useCallback } from "react";
import { api, setOnUnauthorized } from "@/api";
import Setup from "@/pages/Setup";
import Login from "@/pages/Login";

interface AuthState {
  registered: boolean;
  authenticated: boolean;
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [loading, setLoading] = useState(true);

  const checkStatus = useCallback(async () => {
    try {
      const status = await api.auth.status();
      setAuthState(status);
    } catch {
      // If status check fails, assume not authenticated
      setAuthState({ registered: false, authenticated: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // When any API call returns 401, go back to login
  useEffect(() => {
    setOnUnauthorized(() => {
      setAuthState((prev) => prev ? { ...prev, authenticated: false } : null);
    });
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!authState?.registered) {
    return (
      <Setup
        onComplete={() => setAuthState({ registered: true, authenticated: true })}
      />
    );
  }

  if (!authState.authenticated) {
    return (
      <Login
        onComplete={() => setAuthState({ registered: true, authenticated: true })}
      />
    );
  }

  return <>{children}</>;
}
```

**Step 3: Create Setup page**

Create `dashboard/src/pages/Setup.tsx`:

```tsx
import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function Setup({ onComplete }: { onComplete: () => void }) {
  const [email, setEmail] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSetup() {
    if (!email.trim() || !setupToken.trim()) return;
    setLoading(true);
    try {
      // 1. Get registration options
      const { challengeId, options } = await api.auth.bootstrapOptions({
        setupToken: setupToken.trim(),
        email: email.trim(),
      });

      // 2. Create credential (triggers Face ID / Touch ID)
      const credential = await startRegistration({ optionsJSON: options });

      // 3. Verify and store
      await api.auth.bootstrap({
        challengeId,
        credential,
        setupToken: setupToken.trim(),
        email: email.trim(),
      });

      toast.success("Passkey created successfully");
      onComplete();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Setup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="font-heading text-2xl tracking-tight text-primary">Wine Cellar</h1>
          <p className="text-sm text-muted-foreground mt-1">Set up your account</p>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="setupToken">Setup Token</Label>
            <Input
              id="setupToken"
              type="password"
              placeholder="From your server config"
              value={setupToken}
              onChange={(e) => setSetupToken(e.target.value)}
            />
          </div>
          <Button
            className="w-full"
            disabled={!email.trim() || !setupToken.trim() || loading}
            onClick={handleSetup}
          >
            {loading ? "Creating Passkey..." : "Create Passkey"}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

**Step 4: Create Login page**

Create `dashboard/src/pages/Login.tsx`:

```tsx
import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function Login({ onComplete }: { onComplete: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setLoading(true);
    setError(null);
    try {
      // 1. Get authentication options
      const { challengeId, options } = await api.auth.loginOptions();

      // 2. Authenticate (triggers Face ID / Touch ID)
      const credential = await startAuthentication({ optionsJSON: options });

      // 3. Verify
      await api.auth.login({ challengeId, credential });

      onComplete();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Sign in failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="font-heading text-2xl tracking-tight text-primary">Wine Cellar</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to continue</p>
        </div>
        <Button className="w-full" disabled={loading} onClick={handleLogin}>
          {loading ? "Signing in..." : "Sign in with Passkey"}
        </Button>
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
      </div>
    </div>
  );
}
```

**Step 5: Wire AuthGate into App.tsx**

Update `dashboard/src/App.tsx`:

```tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import AuthGate from "@/components/AuthGate";
import Layout from "@/components/Layout";
// ... existing imports ...

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <AuthGate>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              {/* ... existing routes unchanged ... */}
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthGate>
      <Toaster position="top-center" style={{ top: "env(safe-area-inset-top, 0px)" }} />
    </ThemeProvider>
  );
}
```

Remove the `<Toaster>` from `dashboard/src/components/Layout.tsx` (it's now in App.tsx, above AuthGate, so toasts work on Setup/Login pages too).

**Step 6: Run tests and build**

Run: `cd dashboard && npm run lint`
Run: `cd dashboard && npm run build`
Run: `cd dashboard && npm run test`

Expected: All pass. Build succeeds.

**Step 7: Commit**

```bash
git add dashboard/src/api.ts dashboard/src/components/AuthGate.tsx dashboard/src/pages/Setup.tsx dashboard/src/pages/Login.tsx dashboard/src/App.tsx dashboard/src/components/Layout.tsx
git commit -m "feat: add AuthGate, Setup and Login pages for passkey auth"
```

---

### Task 8: Dashboard — Settings Updates

**Files:**
- Modify: `dashboard/src/pages/Settings.tsx` (add passkey registration + logout)

**Context:** Add two new sections to the Settings page: "Register Another Passkey" (for additional devices) and "Log Out". The register flow calls the authenticated `/auth/register/options` and `/auth/register` endpoints. Logout calls `/auth/logout`.

**Step 1: Add account section to Settings**

Add to the bottom of the Settings page (after the Notifications section):

```tsx
import { startRegistration } from "@simplewebauthn/browser";

// New component inside Settings.tsx
function AccountSection() {
  const [registering, setRegistering] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleRegisterPasskey() {
    setRegistering(true);
    try {
      const { challengeId, options } = await api.auth.registerOptions();
      const credential = await startRegistration({ optionsJSON: options });
      await api.auth.register({ challengeId, credential });
      toast.success("Passkey registered");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't register passkey");
    } finally {
      setRegistering(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await api.auth.logout();
      // Reload to trigger AuthGate → Login page
      window.location.reload();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't log out");
      setLoggingOut(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm">Passkeys</p>
          <p className="text-xs text-muted-foreground">Add a passkey for another device.</p>
        </div>
        <Button size="sm" variant="outline" disabled={registering} onClick={handleRegisterPasskey}>
          {registering ? "Registering..." : "Add Passkey"}
        </Button>
      </div>
      <div className="pt-2 border-t">
        <Button size="sm" variant="ghost" className="text-destructive" disabled={loggingOut} onClick={handleLogout}>
          {loggingOut ? "Logging out..." : "Log Out"}
        </Button>
      </div>
    </div>
  );
}
```

Add this section to the Settings page JSX:

```tsx
{/* Account */}
<section>
  <h2 className="text-sm font-semibold mb-2">Account</h2>
  <AccountSection />
</section>
```

**Step 2: Run tests and build**

Run: `cd dashboard && npm run build`
Run: `cd dashboard && npm run test`

Expected: All pass.

**Step 3: Commit**

```bash
git add dashboard/src/pages/Settings.tsx
git commit -m "feat: add passkey registration and logout to settings page"
```

---

## Verification Checklist

After all tasks are complete, verify:

1. `cd api && npm run test` — all tests pass
2. `cd api && npm run lint` — no type errors
3. `cd dashboard && npm run build` — builds cleanly
4. `cd dashboard && npm run test` — all tests pass
5. Manual test with local dev proxy:
   - The dashboard Vite dev server needs a proxy to forward `/api/*` to the API Worker on port 8787. Add to `dashboard/vite.config.ts` if not already present:
     ```typescript
     server: {
       proxy: {
         "/api": "http://localhost:8787",
         "/webhook": "http://localhost:8787",
         "/health": "http://localhost:8787",
       },
     },
     ```
   - Run `cd api && npm run dev` and `cd dashboard && npm run dev`, then:
     - App loads at http://localhost:5173 → shows Setup page
     - Enter email + setup token → biometric prompt → lands on dashboard
     - Close tab, reopen → shows Login page → biometric → dashboard
     - Settings → Add Passkey → registers second passkey
     - Settings → Log Out → returns to Login page
   - Verify that the `Set-Cookie` header from login/bootstrap responses is correctly received by the browser (check DevTools → Application → Cookies)

**Note on Pages Functions proxy:** In production, all API requests go through `dashboard/functions/api/[[path]].ts`, which creates a new `Request` and forwards it to the API Worker. `Set-Cookie` response headers pass through this proxy unchanged since it returns the raw `fetch()` response.
