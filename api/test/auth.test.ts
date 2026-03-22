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

describe("GET /api/v1/auth/status", () => {
  it("returns registered=false when no credentials exist", async () => {
    const { status, json } = await fetchJson("/api/v1/auth/status");
    expect(status).toBe(200);
    expect(json.registered).toBe(false);
    expect(json.authenticated).toBe(false);
  });

  it("returns registered=true when credentials exist", async () => {
    const { token, userId } = await seedSession();
    await seedCredential(userId);
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

describe("POST /api/v1/auth/bootstrap/options", () => {
  it("returns 403 with wrong setup token", async () => {
    const { token } = await seedSession();
    const { status } = await fetchJson("/api/v1/auth/bootstrap/options", {
      method: "POST",
      headers: sessionHeaders(token),
      body: { setupToken: "wrong-token", email: TEST_USER_EMAIL },
    });
    expect(status).toBe(403);
  });

  it("returns 404 when email not found", async () => {
    const { token } = await seedSession();
    const { status } = await fetchJson("/api/v1/auth/bootstrap/options", {
      method: "POST",
      headers: sessionHeaders(token),
      body: { setupToken: "test-setup-token", email: "nobody@example.com" },
    });
    expect(status).toBe(404);
  });

  it("returns 403 when credentials already exist", async () => {
    const { token, userId } = await seedSession();
    await seedCredential(userId);
    const { status } = await fetchJson("/api/v1/auth/bootstrap/options", {
      method: "POST",
      headers: sessionHeaders(token),
      body: { setupToken: "test-setup-token", email: TEST_USER_EMAIL },
    });
    expect(status).toBe(403);
  });

  it("returns registration options for valid request", async () => {
    const { token } = await seedSession();
    const { status, json } = await fetchJson(
      "/api/v1/auth/bootstrap/options",
      {
        method: "POST",
        headers: sessionHeaders(token),
        body: { setupToken: "test-setup-token", email: TEST_USER_EMAIL },
      },
    );
    expect(status).toBe(200);
    expect(json.challengeId).toBeDefined();
    expect(json.options).toBeDefined();
    expect(json.options.rp.id).toBe("localhost");
    expect(json.options.user.name).toBe(TEST_USER_EMAIL);
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
