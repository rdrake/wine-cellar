# API Keys Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users create, list, and revoke API keys for programmatic access via `Authorization: Bearer wc-...` header.

**Architecture:** API keys are random tokens stored as SHA-256 hashes (same pattern as sessions). The auth middleware gains a second path: after checking session cookies, it checks for a Bearer token. Three CRUD routes manage keys. The dashboard Settings page gets an API Keys section.

**Tech Stack:** Hono (API), D1 (database), React + shadcn (dashboard), Vitest with Cloudflare Workers pool (tests)

**Design doc:** `docs/plans/2026-03-22-api-keys-design.md`

---

### Task 1: Database Migration

**Files:**
- Create: `api/migrations/0010_api_keys.sql`

**Step 1: Write the migration**

```sql
-- API keys for programmatic access (MCP servers, automation)
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,              -- SHA-256 hash of the full key
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,               -- User-provided label
  prefix TEXT NOT NULL,             -- First 8 chars for display (e.g. "wc-a1b2c")
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
```

**Step 2: Verify migration loads in test harness**

Run: `cd api && npx vitest run test/auth.test.ts 2>&1 | tail -20`

Expected: All existing auth tests still pass (migration is auto-loaded via `MIGRATION_SQL` in `vitest.config.ts`).

**Step 3: Commit**

```bash
git add api/migrations/0010_api_keys.sql
git commit -m "feat: add api_keys migration"
```

---

### Task 2: API Key Helper Functions

**Files:**
- Create: `api/src/lib/api-keys.ts`
- Test: `api/test/api-keys.test.ts`

**Step 1: Write the failing tests**

Create `api/test/api-keys.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations, seedSession } from "./helpers";
import { createApiKey, listApiKeys, deleteApiKey, validateApiKey } from "../src/lib/api-keys";

beforeEach(async () => {
  await applyMigrations();
});

describe("createApiKey", () => {
  it("returns key with wc- prefix and stores hash", async () => {
    const { userId } = await seedSession();
    const result = await createApiKey(env.DB, userId, "Test Key");
    expect(result.key).toMatch(/^wc-[0-9a-f]{64}$/);
    expect(result.name).toBe("Test Key");
    expect(result.prefix).toBe(result.key.slice(0, 8));
    expect(result.id).toBeDefined();
    expect(result.createdAt).toBeDefined();
  });

  it("stores different hashes for different keys", async () => {
    const { userId } = await seedSession();
    const k1 = await createApiKey(env.DB, userId, "Key 1");
    const k2 = await createApiKey(env.DB, userId, "Key 2");
    expect(k1.id).not.toBe(k2.id);
  });
});

describe("listApiKeys", () => {
  it("returns keys for a user without exposing full key", async () => {
    const { userId } = await seedSession();
    await createApiKey(env.DB, userId, "My Key");
    const keys = await listApiKeys(env.DB, userId);
    expect(keys).toHaveLength(1);
    expect(keys[0].name).toBe("My Key");
    expect(keys[0].prefix).toBeDefined();
    expect(keys[0].createdAt).toBeDefined();
    expect((keys[0] as any).key).toBeUndefined();
  });

  it("does not return keys from other users", async () => {
    const { userId: u1 } = await seedSession("user1@example.com");
    const { userId: u2 } = await seedSession("user2@example.com");
    await createApiKey(env.DB, u1, "U1 Key");
    await createApiKey(env.DB, u2, "U2 Key");
    const keys = await listApiKeys(env.DB, u1);
    expect(keys).toHaveLength(1);
    expect(keys[0].name).toBe("U1 Key");
  });
});

describe("deleteApiKey", () => {
  it("removes the key", async () => {
    const { userId } = await seedSession();
    const { id } = await createApiKey(env.DB, userId, "Doomed");
    const deleted = await deleteApiKey(env.DB, id, userId);
    expect(deleted).toBe(true);
    const keys = await listApiKeys(env.DB, userId);
    expect(keys).toHaveLength(0);
  });

  it("returns false for nonexistent key", async () => {
    const { userId } = await seedSession();
    const deleted = await deleteApiKey(env.DB, "nonexistent", userId);
    expect(deleted).toBe(false);
  });

  it("returns false when deleting another user's key", async () => {
    const { userId: u1 } = await seedSession("owner@example.com");
    const { userId: u2 } = await seedSession("attacker@example.com");
    const { id } = await createApiKey(env.DB, u1, "Owned Key");
    const deleted = await deleteApiKey(env.DB, id, u2);
    expect(deleted).toBe(false);
    // Key should still exist
    const keys = await listApiKeys(env.DB, u1);
    expect(keys).toHaveLength(1);
  });
});

describe("validateApiKey", () => {
  it("returns userId for valid key", async () => {
    const { userId } = await seedSession();
    const { key } = await createApiKey(env.DB, userId, "Valid");
    const result = await validateApiKey(env.DB, key);
    expect(result).toBe(userId);
  });

  it("returns null for invalid key", async () => {
    const result = await validateApiKey(env.DB, "wc-0000000000000000000000000000000000000000000000000000000000000000");
    expect(result).toBeNull();
  });

  it("returns null for non-prefixed token", async () => {
    const result = await validateApiKey(env.DB, "not-an-api-key");
    expect(result).toBeNull();
  });

  it("updates last_used_at on validation", async () => {
    const { userId } = await seedSession();
    const { key, id } = await createApiKey(env.DB, userId, "Track Usage");
    // Initially null
    const before = await env.DB.prepare("SELECT last_used_at FROM api_keys WHERE id = ?").bind(id).first<{ last_used_at: string | null }>();
    expect(before!.last_used_at).toBeNull();
    // Validate updates it
    await validateApiKey(env.DB, key);
    const after = await env.DB.prepare("SELECT last_used_at FROM api_keys WHERE id = ?").bind(id).first<{ last_used_at: string | null }>();
    expect(after!.last_used_at).not.toBeNull();
  });

  it("does not update last_used_at within 1 hour debounce window", async () => {
    const { userId } = await seedSession();
    const { key, id } = await createApiKey(env.DB, userId, "Debounce");
    // Set last_used_at to 30 minutes ago (within debounce window)
    await env.DB.prepare("UPDATE api_keys SET last_used_at = datetime('now', '-30 minutes') WHERE id = ?").bind(id).run();
    const before = (await env.DB.prepare("SELECT last_used_at FROM api_keys WHERE id = ?").bind(id).first<{ last_used_at: string | null }>())!.last_used_at;
    await validateApiKey(env.DB, key);
    const after = (await env.DB.prepare("SELECT last_used_at FROM api_keys WHERE id = ?").bind(id).first<{ last_used_at: string | null }>())!.last_used_at;
    // Should NOT have updated — still the 30-min-ago value
    expect(after).toBe(before);
  });

  it("updates last_used_at after debounce window expires", async () => {
    const { userId } = await seedSession();
    const { key, id } = await createApiKey(env.DB, userId, "Debounce2");
    // Set last_used_at to 2 hours ago (outside debounce window)
    await env.DB.prepare("UPDATE api_keys SET last_used_at = datetime('now', '-2 hours') WHERE id = ?").bind(id).run();
    const before = (await env.DB.prepare("SELECT last_used_at FROM api_keys WHERE id = ?").bind(id).first<{ last_used_at: string | null }>())!.last_used_at;
    await validateApiKey(env.DB, key);
    const after = (await env.DB.prepare("SELECT last_used_at FROM api_keys WHERE id = ?").bind(id).first<{ last_used_at: string | null }>())!.last_used_at;
    // Should have updated
    expect(after).not.toBe(before);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run test/api-keys.test.ts 2>&1 | tail -5`

Expected: FAIL — module `../src/lib/api-keys` not found.

**Step 3: Write the implementation**

Create `api/src/lib/api-keys.ts`:

```typescript
import { hashToken } from "./auth-session";

const API_KEY_PREFIX = "wc-";

function generateApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return API_KEY_PREFIX + hex;
}

export interface ApiKeyCreated {
  id: string;
  name: string;
  prefix: string;
  key: string;
  createdAt: string;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export async function createApiKey(
  db: D1Database,
  userId: string,
  name: string,
): Promise<ApiKeyCreated> {
  const key = generateApiKey();
  const id = await hashToken(key);
  const prefix = key.slice(0, 8);

  await db
    .prepare(
      "INSERT INTO api_keys (id, user_id, name, prefix) VALUES (?, ?, ?, ?)",
    )
    .bind(id, userId, name, prefix)
    .run();

  const row = await db
    .prepare("SELECT created_at FROM api_keys WHERE id = ?")
    .bind(id)
    .first<{ created_at: string }>();

  return { id, name, prefix, key, createdAt: row!.created_at };
}

export async function listApiKeys(
  db: D1Database,
  userId: string,
): Promise<ApiKeyInfo[]> {
  const { results } = await db
    .prepare(
      "SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC",
    )
    .bind(userId)
    .all<{
      id: string;
      name: string;
      prefix: string;
      created_at: string;
      last_used_at: string | null;
    }>();

  return results.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));
}

export async function deleteApiKey(
  db: D1Database,
  id: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM api_keys WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function validateApiKey(
  db: D1Database,
  key: string,
): Promise<string | null> {
  if (!key.startsWith(API_KEY_PREFIX)) return null;

  const id = await hashToken(key);
  const row = await db
    .prepare("SELECT user_id, last_used_at FROM api_keys WHERE id = ?")
    .bind(id)
    .first<{ user_id: string; last_used_at: string | null }>();

  if (!row) return null;

  // Debounce last_used_at: only update if null or older than 1 hour
  if (!row.last_used_at) {
    await db
      .prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?")
      .bind(id)
      .run();
  } else {
    await db
      .prepare(
        "UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ? AND last_used_at < datetime('now', '-1 hour')",
      )
      .bind(id)
      .run();
  }

  return row.user_id;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run test/api-keys.test.ts`

Expected: All tests PASS.

**Step 5: Commit**

```bash
git add api/src/lib/api-keys.ts api/test/api-keys.test.ts
git commit -m "feat: add API key helper functions with tests"
```

---

### Task 3: Auth Middleware — Bearer Token Support

**Files:**
- Modify: `api/src/middleware/access.ts`
- Test: `api/test/auth.test.ts` (add tests)

**Step 1: Write the failing tests**

Add to `api/test/auth.test.ts`, after the existing `describe("session auth", ...)` block:

```typescript
describe("API key auth", () => {
  it("authenticates with valid Bearer token", async () => {
    const { userId } = await seedSession();
    const { createApiKey } = await import("../src/lib/api-keys");
    const { key } = await createApiKey(env.DB, userId, "Test");
    const { status, json } = await fetchJson("/api/v1/batches", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(status).toBe(200);
    expect(json.items).toBeDefined();
  });

  it("returns 401 for invalid Bearer token", async () => {
    const { status } = await fetchJson("/api/v1/batches", {
      headers: { Authorization: "Bearer wc-0000000000000000000000000000000000000000000000000000000000000000" },
    });
    expect(status).toBe(401);
  });

  it("returns 401 for non-wc Bearer token", async () => {
    const { status } = await fetchJson("/api/v1/batches", {
      headers: { Authorization: "Bearer some-random-token" },
    });
    expect(status).toBe(401);
  });

  it("prefers session cookie over Bearer when both present", async () => {
    const headers = await authHeaders();
    // Add an invalid Bearer — should still work via cookie
    headers["Authorization"] = "Bearer wc-invalid";
    const { status } = await fetchJson("/api/v1/batches", { headers });
    expect(status).toBe(200);
  });

  it("falls back to Bearer when no session cookie present", async () => {
    const { userId } = await seedSession();
    const { createApiKey } = await import("../src/lib/api-keys");
    const { key } = await createApiKey(env.DB, userId, "Fallback");
    // No cookie, just Bearer
    const { status } = await fetchJson("/api/v1/batches", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(status).toBe(200);
  });
});
```

**Step 2: Run tests to verify the new tests fail**

Run: `cd api && npx vitest run test/auth.test.ts 2>&1 | grep -E "FAIL|✓|✗"`

Expected: The new "API key auth" tests fail (Bearer tokens not recognized yet).

**Step 3: Update the middleware**

Modify `api/src/middleware/access.ts`. The full updated file:

```typescript
import { createMiddleware } from "hono/factory";
import type { AppEnv, User } from "../app";
import { validateSession, getSessionToken } from "../lib/auth-session";
import { validateApiKey } from "../lib/api-keys";

const EXEMPT_PREFIXES = [
  "/health",
  "/webhook",
  "/api/v1/auth/status",
  "/api/v1/auth/login",
  "/api/v1/auth/github",
  "/api/v1/auth/settings",
];

function isExempt(path: string): boolean {
  return EXEMPT_PREFIXES.some(
    (prefix) =>
      path === prefix || path.startsWith(prefix + "/"),
  );
}

async function resolveUser(db: D1Database, userId: string): Promise<User | null> {
  return db.prepare(
    "SELECT id, email, name, avatar_url FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<User>();
}

export const accessAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (isExempt(c.req.path)) {
    return next();
  }

  // 1. Session cookie auth (primary — dashboard)
  const token = getSessionToken(c);
  if (token) {
    const userId = await validateSession(c.env.DB, token);
    if (userId) {
      const user = await resolveUser(c.env.DB, userId);
      if (user) {
        c.set("user", user);
        return next();
      }
    }
  }

  // 2. API key auth (secondary — MCP servers, automation)
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer wc-")) {
    const key = authHeader.slice(7); // "Bearer ".length === 7
    const userId = await validateApiKey(c.env.DB, key);
    if (userId) {
      const user = await resolveUser(c.env.DB, userId);
      if (user) {
        c.set("user", user);
        return next();
      }
    }
  }

  return c.json({ error: "Authentication required" }, 401);
});
```

**Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run test/auth.test.ts`

Expected: All tests PASS (existing + new).

**Step 5: Commit**

```bash
git add api/src/middleware/access.ts api/test/auth.test.ts
git commit -m "feat: add Bearer API key auth to middleware"
```

---

### Task 4: API Key CRUD Routes

**Files:**
- Modify: `api/src/routes/auth.ts` (add routes to the existing `auth` Hono instance)
- Test: `api/test/auth.test.ts` (add tests)

**Step 1: Write the failing tests**

Add to `api/test/auth.test.ts`:

```typescript
describe("POST /api/v1/auth/api-keys", () => {
  it("returns 401 without auth", async () => {
    const { status } = await fetchJson("/api/v1/auth/api-keys", {
      method: "POST",
      body: { name: "Test" },
    });
    expect(status).toBe(401);
  });

  it("creates an API key and returns it with full key", async () => {
    const { status, json } = await fetchJson("/api/v1/auth/api-keys", {
      method: "POST",
      headers: await authHeaders(),
      body: { name: "MCP Server" },
    });
    expect(status).toBe(201);
    expect(json.name).toBe("MCP Server");
    expect(json.key).toMatch(/^wc-[0-9a-f]{64}$/);
    expect(json.prefix).toBe(json.key.slice(0, 8));
    expect(json.id).toBeDefined();
    expect(json.createdAt).toBeDefined();
  });

  it("rejects empty name", async () => {
    const { status } = await fetchJson("/api/v1/auth/api-keys", {
      method: "POST",
      headers: await authHeaders(),
      body: { name: "" },
    });
    expect(status).toBe(400);
  });

  it("rejects missing name", async () => {
    const { status } = await fetchJson("/api/v1/auth/api-keys", {
      method: "POST",
      headers: await authHeaders(),
      body: {},
    });
    expect(status).toBe(400);
  });

  it("rejects name over 100 characters", async () => {
    const { status } = await fetchJson("/api/v1/auth/api-keys", {
      method: "POST",
      headers: await authHeaders(),
      body: { name: "x".repeat(101) },
    });
    expect(status).toBe(400);
  });
});

describe("GET /api/v1/auth/api-keys", () => {
  it("returns 401 without auth", async () => {
    const { status } = await fetchJson("/api/v1/auth/api-keys");
    expect(status).toBe(401);
  });

  it("returns empty list when no keys exist", async () => {
    const { status, json } = await fetchJson("/api/v1/auth/api-keys", {
      headers: await authHeaders(),
    });
    expect(status).toBe(200);
    expect(json.items).toEqual([]);
  });

  it("lists created keys without full key", async () => {
    const headers = await authHeaders();
    await fetchJson("/api/v1/auth/api-keys", {
      method: "POST",
      headers,
      body: { name: "Key 1" },
    });
    const { json } = await fetchJson("/api/v1/auth/api-keys", { headers });
    expect(json.items).toHaveLength(1);
    expect(json.items[0].name).toBe("Key 1");
    expect(json.items[0].key).toBeUndefined();
    expect(json.items[0].prefix).toBeDefined();
  });
});

describe("DELETE /api/v1/auth/api-keys/:id", () => {
  it("returns 401 without auth", async () => {
    const { status } = await fetchJson("/api/v1/auth/api-keys/some-id", {
      method: "DELETE",
    });
    expect(status).toBe(401);
  });

  it("revokes an existing key", async () => {
    const headers = await authHeaders();
    const { json: created } = await fetchJson("/api/v1/auth/api-keys", {
      method: "POST",
      headers,
      body: { name: "To Revoke" },
    });
    const { status } = await fetchJson(`/api/v1/auth/api-keys/${created.id}`, {
      method: "DELETE",
      headers,
    });
    expect(status).toBe(204);
    // Verify it's gone
    const { json: list } = await fetchJson("/api/v1/auth/api-keys", { headers });
    expect(list.items).toHaveLength(0);
  });

  it("returns 404 for nonexistent key", async () => {
    const { status } = await fetchJson("/api/v1/auth/api-keys/nonexistent", {
      method: "DELETE",
      headers: await authHeaders(),
    });
    expect(status).toBe(404);
  });

  it("returns 404 when trying to delete another user's key", async () => {
    const ownerHeaders = await authHeaders("owner@example.com");
    const { json: created } = await fetchJson("/api/v1/auth/api-keys", {
      method: "POST",
      headers: ownerHeaders,
      body: { name: "Owner's Key" },
    });
    const attackerHeaders = await authHeaders("attacker@example.com");
    const { status } = await fetchJson(`/api/v1/auth/api-keys/${created.id}`, {
      method: "DELETE",
      headers: attackerHeaders,
    });
    expect(status).toBe(404);
  });

  it("revoked key can no longer authenticate", async () => {
    const headers = await authHeaders();
    const { json: created } = await fetchJson("/api/v1/auth/api-keys", {
      method: "POST",
      headers,
      body: { name: "Ephemeral" },
    });
    // Use the key
    const { status: before } = await fetchJson("/api/v1/batches", {
      headers: { Authorization: `Bearer ${created.key}` },
    });
    expect(before).toBe(200);
    // Revoke it
    await fetchJson(`/api/v1/auth/api-keys/${created.id}`, {
      method: "DELETE",
      headers,
    });
    // Try to use it again
    const { status: after } = await fetchJson("/api/v1/batches", {
      headers: { Authorization: `Bearer ${created.key}` },
    });
    expect(after).toBe(401);
  });
});
```

**Step 2: Run tests to verify the new tests fail**

Run: `cd api && npx vitest run test/auth.test.ts 2>&1 | tail -10`

Expected: New tests fail with 404 (routes don't exist yet).

**Step 3: Add routes to `api/src/routes/auth.ts`**

Add the following routes before the `export default auth` line at the bottom of the file. Import `createApiKey`, `listApiKeys`, `deleteApiKey` from `../lib/api-keys`. Also import `notFound` from `../lib/errors`.

Add these imports at the top:

```typescript
import { createApiKey, listApiKeys, deleteApiKey } from "../lib/api-keys";
import { forbidden, unauthorized, notFound } from "../lib/errors";
```

(Note: `forbidden` and `unauthorized` are already imported — just add `notFound` to the existing import, and add the new `api-keys` import.)

Add these routes before `// POST /logout`:

```typescript
// POST /api-keys — create a new API key (requires session)
auth.post("/api-keys", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ name?: string }>();

  if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
    return c.json({ error: "Name is required" }, 400);
  }
  if (body.name.length > 100) {
    return c.json({ error: "Name must be 100 characters or fewer" }, 400);
  }

  const result = await createApiKey(c.env.DB, user.id, body.name.trim());
  return c.json(result, 201);
});

// GET /api-keys — list API keys for the authenticated user (requires session)
auth.get("/api-keys", async (c) => {
  const user = c.get("user");
  const items = await listApiKeys(c.env.DB, user.id);
  return c.json({ items });
});

// DELETE /api-keys/:id — revoke an API key (requires session)
auth.delete("/api-keys/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const deleted = await deleteApiKey(c.env.DB, id, user.id);
  if (!deleted) {
    return notFound("API key");
  }
  return c.body(null, 204);
});
```

**Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run test/auth.test.ts`

Expected: All tests PASS.

**Step 5: Run full test suite**

Run: `cd api && npx vitest run`

Expected: All tests pass.

**Step 6: Commit**

```bash
git add api/src/routes/auth.ts api/test/auth.test.ts
git commit -m "feat: add API key CRUD routes"
```

---

### Task 5: Dashboard — API Client Methods

**Files:**
- Modify: `dashboard/src/api.ts`

**Step 1: Add API key methods to the `api` object**

In `dashboard/src/api.ts`, add an `apiKeys` namespace inside the `auth` object. Insert after the `logout` line (line 139) and before the closing brace of `auth` (line 140). Add a comma after the existing `logout` line:

```typescript
apiKeys: {
  list: () =>
    apiFetch<{ items: Array<{ id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null }> }>("/api/v1/auth/api-keys"),
  create: (name: string) =>
    apiFetch<{ id: string; name: string; prefix: string; key: string; createdAt: string }>("/api/v1/auth/api-keys", { method: "POST", body: { name } }),
  revoke: (id: string) =>
    apiFetch<void>(`/api/v1/auth/api-keys/${id}`, { method: "DELETE" }),
},
```

**Step 2: Commit**

```bash
git add dashboard/src/api.ts
git commit -m "feat: add API key client methods"
```

---

### Task 6: Dashboard — API Keys UI in Settings

**Files:**
- Modify: `dashboard/src/pages/Settings.tsx`

**Step 1: Add the ApiKeysSection component**

Add a new component `ApiKeysSection` in `Settings.tsx`, before the `AccountSection` component. This follows the same patterns as the existing sections (passkeys, notifications).

```tsx
function ApiKeysSection() {
  const [keys, setKeys] = useState<Array<{ id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      const { items } = await api.auth.apiKeys.list();
      setKeys(items);
    } catch {
      toast.error("Couldn't load API keys");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  async function handleCreate() {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const result = await api.auth.apiKeys.create(newKeyName.trim());
      setCreatedKey(result.key);
      setNewKeyName("");
      fetchKeys();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't create API key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    try {
      await api.auth.apiKeys.revoke(id);
      toast.success("API key revoked");
      setKeys((prev) => prev.filter((k) => k.id !== id));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't revoke API key");
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm">API Keys</p>
          <p className="text-xs text-muted-foreground">For MCP servers and automation.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
          Create
        </Button>
      </div>

      {keys.length === 0 && !showCreate && (
        <p className="text-xs text-muted-foreground">No API keys yet.</p>
      )}

      {keys.map((k) => (
        <div key={k.id} className="flex items-center justify-between py-1.5">
          <div>
            <p className="text-sm font-medium">{k.name}</p>
            <p className="text-xs text-muted-foreground font-mono">
              {k.prefix}{"..."} · created {relativeTime(k.createdAt)}
              {k.lastUsedAt ? ` · used ${relativeTime(k.lastUsedAt)}` : " · never used"}
            </p>
          </div>
          <Button size="sm" variant="ghost" className="text-destructive h-7 text-xs" onClick={() => handleRevoke(k.id)}>
            Revoke
          </Button>
        </div>
      ))}

      {/* Create dialog */}
      <Dialog open={showCreate && !createdKey} onOpenChange={(open) => { if (!open) { setShowCreate(false); setNewKeyName(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
          </DialogHeader>
          <input
            className="w-full px-3 py-2 text-sm border rounded bg-background"
            placeholder="Key name, e.g. MCP Server"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); setNewKeyName(""); }}>Cancel</Button>
            <Button disabled={!newKeyName.trim() || creating} onClick={handleCreate}>
              {creating ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show key dialog */}
      <Dialog open={!!createdKey} onOpenChange={(open) => { if (!open) { setCreatedKey(null); setShowCreate(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Copy this key now — you won't be able to see it again.</p>
            <div className="flex gap-2">
              <input
                readOnly
                value={createdKey ?? ""}
                className="flex-1 px-3 py-2 text-xs font-mono border rounded bg-muted select-all"
                onFocus={(e) => e.target.select()}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (createdKey) {
                    navigator.clipboard.writeText(createdKey);
                    toast.success("Copied to clipboard");
                  }
                }}
              >
                Copy
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => { setCreatedKey(null); setShowCreate(false); }}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

**Step 2: Add the section to the Settings page**

In the `Settings` component's JSX, add the API Keys section between Notifications and Account:

```tsx
{/* API Keys */}
<section>
  <h2 className="text-sm font-semibold mb-2">API Keys</h2>
  <ApiKeysSection />
</section>
```

**Step 3: Verify it builds**

Run: `cd dashboard && npx tsc --noEmit && npx vite build 2>&1 | tail -5`

Expected: No type errors, build succeeds.

**Step 4: Commit**

```bash
git add dashboard/src/pages/Settings.tsx
git commit -m "feat: add API keys management UI to Settings"
```

---

### Task 7: Final Verification

**Step 1: Run full API test suite**

Run: `cd api && npx vitest run`

Expected: All tests pass.

**Step 2: Run dashboard build**

Run: `cd dashboard && npx vite build 2>&1 | tail -5`

Expected: Build succeeds.

**Step 3: Run lint**

Run: `cd api && npx tsc --noEmit && cd ../dashboard && npx tsc --noEmit`

Expected: No type errors.
