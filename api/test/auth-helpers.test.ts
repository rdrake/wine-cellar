import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations, TEST_USER_EMAIL, authHeaders, fetchJson } from "./helpers";
import { createSession, validateSession, deleteSession, cleanupExpiredSessions, hashToken } from "../src/lib/auth-session";
import { storeChallenge, consumeChallenge, cleanupExpiredChallenges } from "../src/lib/auth-challenge";

describe("auth session helpers", () => {
  let userId: string;

  beforeEach(async () => {
    await applyMigrations();
    await fetchJson("/api/v1/me", { headers: authHeaders() });
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(TEST_USER_EMAIL).first<{ id: string }>();
    userId = user!.id;
  });

  it("creates and validates a session", async () => {
    const { token } = await createSession(env.DB, userId);
    expect(token).toHaveLength(64);
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
    await env.DB.prepare("UPDATE auth_challenges SET expires_at = datetime('now', '-1 minute') WHERE challenge = 'c1'").run();
    await cleanupExpiredChallenges(env.DB);
    const count = await env.DB.prepare("SELECT COUNT(*) as count FROM auth_challenges").first<{ count: number }>();
    expect(count!.count).toBe(1);
    const result = await consumeChallenge(env.DB, activeId, "login");
    expect(result).not.toBeNull();
  });
});
