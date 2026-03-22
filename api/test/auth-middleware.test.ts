import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { applyMigrations, sessionHeaders } from "./helpers";
import { createSession, hashToken } from "../src/lib/auth-session";

async function seedUserWithSession(email: string = "test@example.com") {
  const userId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO users (id, email, created_at) VALUES (?, ?, datetime('now'))",
  )
    .bind(userId, email)
    .run();
  const { token } = await createSession(env.DB, userId);
  return { userId, token };
}

describe("auth middleware", () => {
  beforeEach(async () => {
    await applyMigrations();
  });

  it("allows exempt auth routes without session", async () => {
    const routes = ["/api/v1/auth/status", "/api/v1/auth/settings"];
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
    const registerRes = await SELF.fetch(
      "https://localhost/api/v1/auth/register/options",
      {
        method: "POST",
      },
    );
    expect(registerRes.status).toBe(401);

    const logoutRes = await SELF.fetch(
      "https://localhost/api/v1/auth/logout",
      {
        method: "POST",
      },
    );
    expect(logoutRes.status).toBe(401);
  });

  it("authenticates via session cookie", async () => {
    const { token } = await seedUserWithSession("test@example.com");
    const res = await SELF.fetch("https://localhost/api/v1/batches", {
      headers: sessionHeaders(token),
    });
    expect(res.status).toBe(200);
  });

  it("rejects expired sessions", async () => {
    const { token } = await seedUserWithSession("test@example.com");
    const hash = await hashToken(token);
    await env.DB.prepare(
      "UPDATE auth_sessions SET expires_at = datetime('now', '-1 hour') WHERE id = ?",
    )
      .bind(hash)
      .run();

    const res = await SELF.fetch("https://localhost/api/v1/batches", {
      headers: sessionHeaders(token),
    });
    expect(res.status).toBe(401);
  });
});
