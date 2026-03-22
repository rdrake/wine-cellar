import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  applyMigrations,
  fetchJson,
  authHeaders,
  WEBHOOK_HEADERS,
  sessionHeaders,
  seedSession,
  seedCredential,
  hashToken,
  TEST_USER_EMAIL,
} from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

describe("session auth", () => {
  it("returns 401 without session cookie", async () => {
    const { status, json } = await fetchJson("/api/v1/batches");
    expect(status).toBe(401);
    expect(json.error).toBe("Authentication required");
  });

  it("allows health without auth", async () => {
    const { status } = await fetchJson("/health");
    expect(status).toBe(200);
  });

  it("allows webhook with X-Webhook-Token", async () => {
    const { status } = await fetchJson("/webhook/rapt", {
      method: "POST",
      headers: WEBHOOK_HEADERS,
      body: {
        device_id: "pill-1",
        device_name: "Test",
        temperature: 22.0,
        gravity: 1.05,
        battery: 90,
        rssi: -50,
        created_date: "2026-03-20T10:00:00Z",
      },
    });
    // Should not be 401 (may be 200 or other, but not auth-blocked)
    expect(status).not.toBe(401);
  });

  it("authenticates with valid session cookie and returns user data", async () => {
    const { status, json } = await fetchJson("/api/v1/batches", {
      headers: await authHeaders(),
    });
    expect(status).toBe(200);
    expect(json.items).toBeDefined();
  });
});

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

describe("GET /api/v1/auth/status", () => {
  it("returns authenticated=false when no session", async () => {
    const { status, json } = await fetchJson("/api/v1/auth/status");
    expect(status).toBe(200);
    expect(json.authenticated).toBe(false);
  });

  it("returns authenticated=true with user info when session valid", async () => {
    const { token, userId } = await seedSession();
    const { status, json } = await fetchJson("/api/v1/auth/status", {
      headers: sessionHeaders(token),
    });
    expect(status).toBe(200);
    expect(json.authenticated).toBe(true);
    expect(json.isNewUser).toBe(false);
    expect(json.user).toBeDefined();
    expect(json.user.id).toBe(userId);
    expect(json.user.email).toBe(TEST_USER_EMAIL);
  });

  it("returns isNewUser=true for un-onboarded user", async () => {
    // Create un-onboarded user
    const userId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users (id, email, name, onboarded) VALUES (?, ?, ?, 0)",
    )
      .bind(userId, "new@example.com", "new")
      .run();
    const { createSession } = await import("../src/lib/auth-session");
    const { token } = await createSession(env.DB, userId);
    const { json } = await fetchJson("/api/v1/auth/status", {
      headers: sessionHeaders(token),
    });
    expect(json.authenticated).toBe(true);
    expect(json.isNewUser).toBe(true);
  });
});

describe("GET /api/v1/auth/settings", () => {
  it("returns registrationsOpen from settings table", async () => {
    const { status, json } = await fetchJson("/api/v1/auth/settings");
    expect(status).toBe(200);
    expect(json.registrationsOpen).toBe(true);
  });

  it("reflects updates to registrations_open setting", async () => {
    await env.DB.prepare(
      "UPDATE settings SET value = 'false' WHERE key = 'registrations_open'",
    ).run();
    const { json } = await fetchJson("/api/v1/auth/settings");
    expect(json.registrationsOpen).toBe(false);
  });
});

describe("GET /api/v1/auth/github", () => {
  it("redirects to GitHub with correct client_id and stores oauth challenge", async () => {
    const res = await SELF.fetch("http://localhost/api/v1/auth/github", {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("Location")!;
    expect(location).toContain("github.com");
    expect(location).toContain("client_id=test-github-client-id");
    expect(location).toContain("scope=read%3Auser+user%3Aemail");

    // Should have stored an oauth challenge
    const challenge = await env.DB.prepare(
      "SELECT * FROM auth_challenges WHERE type = 'oauth'",
    ).first();
    expect(challenge).toBeTruthy();
  });
});

// We can't easily test the full GitHub callback flow since it requires
// mocking external GitHub API calls, but we can test error cases
describe("GET /api/v1/auth/github/callback", () => {
  it("redirects to /login?error=invalid_state for missing state", async () => {
    const res = await SELF.fetch(
      "http://localhost/api/v1/auth/github/callback?code=abc",
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login?error=invalid_state");
  });

  it("redirects to /login?error=invalid_state for bad state", async () => {
    const res = await SELF.fetch(
      "http://localhost/api/v1/auth/github/callback?code=abc&state=bad-state",
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login?error=invalid_state");
  });
});

describe("POST /api/v1/auth/login/options", () => {
  it("returns authentication options", async () => {
    const { status, json } = await fetchJson("/api/v1/auth/login/options", {
      method: "POST",
    });
    expect(status).toBe(200);
    expect(json.challengeId).toBeDefined();
    expect(json.options).toBeDefined();
    expect(json.options.rpId).toBe("localhost");
  });
});

describe("POST /api/v1/auth/login", () => {
  it("returns 401 for invalid challenge", async () => {
    const { status } = await fetchJson("/api/v1/auth/login", {
      method: "POST",
      body: { challengeId: "nonexistent", credential: {} },
    });
    expect(status).toBe(401);
  });
});

describe("POST /api/v1/auth/register/options", () => {
  it("returns 401 without session", async () => {
    const { status } = await fetchJson("/api/v1/auth/register/options", {
      method: "POST",
    });
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
    expect(json.options.excludeCredentials.length).toBeGreaterThanOrEqual(1);
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("returns 401 without session", async () => {
    const { status } = await fetchJson("/api/v1/auth/logout", {
      method: "POST",
    });
    expect(status).toBe(401);
  });

  it("deletes session and invalidates token", async () => {
    const { token } = await seedSession();
    const { status } = await fetchJson("/api/v1/auth/logout", {
      method: "POST",
      headers: sessionHeaders(token),
    });
    expect(status).toBe(200);
    // Session should be invalid now
    const { status: afterStatus } = await fetchJson("/api/v1/batches", {
      headers: sessionHeaders(token),
    });
    expect(afterStatus).toBe(401);
  });
});

describe("GET /api/v1/users/me", () => {
  it("returns 401 without auth", async () => {
    const { status } = await fetchJson("/api/v1/users/me");
    expect(status).toBe(401);
  });

  it("returns user profile", async () => {
    const { token, userId } = await seedSession();
    const { status, json } = await fetchJson("/api/v1/users/me", {
      headers: sessionHeaders(token),
    });
    expect(status).toBe(200);
    expect(json.id).toBe(userId);
    expect(json.email).toBe(TEST_USER_EMAIL);
    expect(json.onboarded).toBe(true);
  });
});

describe("PATCH /api/v1/users/me", () => {
  it("returns 401 without auth", async () => {
    const { status } = await fetchJson("/api/v1/users/me", {
      method: "PATCH",
      body: { name: "New Name" },
    });
    expect(status).toBe(401);
  });

  it("updates name", async () => {
    const { token } = await seedSession();
    const { status, json } = await fetchJson("/api/v1/users/me", {
      method: "PATCH",
      headers: sessionHeaders(token),
      body: { name: "Updated Name" },
    });
    expect(status).toBe(200);
    expect(json.name).toBe("Updated Name");
  });

  it("marks user as onboarded", async () => {
    // Create un-onboarded user
    const userId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users (id, email, name, onboarded) VALUES (?, ?, ?, 0)",
    )
      .bind(userId, "onboard@example.com", "onboard")
      .run();
    const { createSession } = await import("../src/lib/auth-session");
    const { token } = await createSession(env.DB, userId);

    const { status, json } = await fetchJson("/api/v1/users/me", {
      method: "PATCH",
      headers: sessionHeaders(token),
      body: { onboarded: true },
    });
    expect(status).toBe(200);
    expect(json.onboarded).toBe(true);
  });

  it("rejects name over 100 chars", async () => {
    const { token } = await seedSession();
    const { status, json } = await fetchJson("/api/v1/users/me", {
      method: "PATCH",
      headers: sessionHeaders(token),
      body: { name: "x".repeat(101) },
    });
    expect(status).toBe(400);
    expect(json.error).toBeDefined();
  });

  it("rejects empty name", async () => {
    const { token } = await seedSession();
    const { status } = await fetchJson("/api/v1/users/me", {
      method: "PATCH",
      headers: sessionHeaders(token),
      body: { name: "" },
    });
    expect(status).toBe(400);
  });
});

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

describe("GET /api/v1/auth/passkeys", () => {
  it("returns 401 without auth", async () => {
    const { status } = await fetchJson("/api/v1/auth/passkeys");
    expect(status).toBe(401);
  });

  it("returns empty list when no passkeys", async () => {
    const { status, json } = await fetchJson("/api/v1/auth/passkeys", {
      headers: await authHeaders(),
    });
    expect(status).toBe(200);
    expect(json.items).toEqual([]);
  });

  it("lists passkeys for authenticated user", async () => {
    const { token, userId } = await seedSession();
    await seedCredential(userId, { name: "MacBook Pro" });
    const { status, json } = await fetchJson("/api/v1/auth/passkeys", {
      headers: sessionHeaders(token),
    });
    expect(status).toBe(200);
    expect(json.items).toHaveLength(1);
    expect(json.items[0].name).toBe("MacBook Pro");
    expect(json.items[0].deviceType).toBe("multiDevice");
    expect(json.items[0].backedUp).toBe(true);
    expect(json.items[0].createdAt).toBeDefined();
    // Should NOT expose public key
    expect(json.items[0].publicKey).toBeUndefined();
  });

  it("does not list other users passkeys", async () => {
    const { userId: otherUserId } = await seedSession("other@example.com");
    await seedCredential(otherUserId, { id: "other-cred", name: "Other" });
    const { json } = await fetchJson("/api/v1/auth/passkeys", {
      headers: await authHeaders("me@example.com"),
    });
    expect(json.items).toHaveLength(0);
  });
});

describe("DELETE /api/v1/auth/passkeys/:id", () => {
  it("returns 401 without auth", async () => {
    const { status } = await fetchJson("/api/v1/auth/passkeys/some-id", {
      method: "DELETE",
    });
    expect(status).toBe(401);
  });

  it("revokes an existing passkey", async () => {
    const { token, userId } = await seedSession();
    await seedCredential(userId, { id: "cred-to-delete", name: "Old Phone" });
    const { status } = await fetchJson("/api/v1/auth/passkeys/cred-to-delete", {
      method: "DELETE",
      headers: sessionHeaders(token),
    });
    expect(status).toBe(204);
    // Verify it's gone
    const { json } = await fetchJson("/api/v1/auth/passkeys", {
      headers: sessionHeaders(token),
    });
    expect(json.items).toHaveLength(0);
  });

  it("returns 404 for nonexistent passkey", async () => {
    const { status } = await fetchJson("/api/v1/auth/passkeys/nonexistent", {
      method: "DELETE",
      headers: await authHeaders(),
    });
    expect(status).toBe(404);
  });

  it("returns 404 when deleting another users passkey", async () => {
    const { userId: ownerId } = await seedSession("owner@example.com");
    await seedCredential(ownerId, { id: "owner-cred", name: "Owner" });
    const { status } = await fetchJson("/api/v1/auth/passkeys/owner-cred", {
      method: "DELETE",
      headers: await authHeaders("attacker@example.com"),
    });
    expect(status).toBe(404);
  });
});

describe("auth cron cleanup", () => {
  it("removes expired sessions and challenges", async () => {
    const { token } = await seedSession();
    const hash = await hashToken(token);
    // Expire the session
    await env.DB.prepare(
      "UPDATE auth_sessions SET expires_at = datetime('now', '-1 hour') WHERE id = ?",
    )
      .bind(hash)
      .run();
    // Create an expired challenge
    await env.DB.prepare(
      "INSERT INTO auth_challenges (id, challenge, type, expires_at) VALUES ('c1', 'ch', 'login', datetime('now', '-1 hour'))",
    ).run();
    // Run cleanup
    const { cleanupAuthTables } = await import("../src/cron");
    await cleanupAuthTables(env.DB);
    const sessions = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM auth_sessions",
    ).first<{ count: number }>();
    const challenges = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM auth_challenges",
    ).first<{ count: number }>();
    expect(sessions!.count).toBe(0);
    expect(challenges!.count).toBe(0);
  });
});

// Import SELF for redirect tests
import { SELF } from "cloudflare:test";
