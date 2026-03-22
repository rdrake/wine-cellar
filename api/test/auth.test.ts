import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import {
  applyMigrations,
  fetchJson,
  authHeaders,
  serviceTokenHeaders,
  linkServiceToken,
  WEBHOOK_HEADERS,
  sessionHeaders,
  seedSession,
  seedCredential,
  TEST_USER_EMAIL,
} from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

describe("access auth", () => {
  it("returns 401 without JWT header", async () => {
    const { status, json } = await fetchJson("/api/v1/batches");
    expect(status).toBe(401);
    expect(json.error).toBe("unauthorized");
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

  it("authenticates with valid test JWT and returns user data", async () => {
    const { status, json } = await fetchJson("/api/v1/batches", {
      headers: authHeaders(),
    });
    expect(status).toBe(200);
    expect(json.items).toBeDefined();
  });

  it("rejects unlinked service token", async () => {
    const { status, json } = await fetchJson("/api/v1/batches", {
      headers: serviceTokenHeaders("unknown-client"),
    });
    expect(status).toBe(401);
    expect(json.message).toBeTruthy();
  });

  it("authenticates linked service token as mapped user", async () => {
    // Create a user first via normal auth
    const { json: meJson } = await fetchJson("/api/v1/me", { headers: authHeaders() });
    const userId = meJson.id;

    // Link service token to that user
    await linkServiceToken("my-tool", userId);

    // Service token should now see same identity
    const { status, json } = await fetchJson("/api/v1/me", {
      headers: serviceTokenHeaders("my-tool"),
    });
    expect(status).toBe(200);
    expect(json.id).toBe(userId);
    expect(json.email).toBe("test@example.com");
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
    await fetchJson("/api/v1/me", { headers: authHeaders() });
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(TEST_USER_EMAIL)
      .first<{ id: string }>();
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
      .bind(TEST_USER_EMAIL)
      .first<{ id: string }>();
    await seedCredential(user!.id);
    const { json } = await fetchJson("/api/v1/auth/status", {
      headers: authHeaders(),
    });
    expect(json.registered).toBe(true);
    expect(json.authenticated).toBe(true);
  });
});

describe("POST /api/v1/auth/bootstrap/options", () => {
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
      .bind(TEST_USER_EMAIL)
      .first<{ id: string }>();
    await seedCredential(user!.id);
    const { status } = await fetchJson("/api/v1/auth/bootstrap/options", {
      method: "POST",
      body: { setupToken: "test-setup-token", email: TEST_USER_EMAIL },
    });
    expect(status).toBe(403);
  });

  it("returns registration options for valid request", async () => {
    await fetchJson("/api/v1/me", { headers: authHeaders() });
    const { status, json } = await fetchJson(
      "/api/v1/auth/bootstrap/options",
      {
        method: "POST",
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
