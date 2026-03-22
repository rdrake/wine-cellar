import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations, authHeaders, fetchJson, TEST_USER_EMAIL } from "./helpers";
import { createSession } from "../src/lib/auth-session";

describe("auth middleware", () => {
  let userId: string;

  beforeEach(async () => {
    await applyMigrations();
    await fetchJson("/api/v1/me", { headers: authHeaders() });
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(TEST_USER_EMAIL).first<{ id: string }>();
    userId = user!.id;
  });

  it("allows exempt route /api/v1/auth/status without auth", async () => {
    const { status } = await fetchJson("/api/v1/auth/status");
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
});
