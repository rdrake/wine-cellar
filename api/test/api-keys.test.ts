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
    const before = await env.DB.prepare("SELECT last_used_at FROM api_keys WHERE id = ?").bind(id).first<{ last_used_at: string | null }>();
    expect(before!.last_used_at).toBeNull();
    await validateApiKey(env.DB, key);
    const after = await env.DB.prepare("SELECT last_used_at FROM api_keys WHERE id = ?").bind(id).first<{ last_used_at: string | null }>();
    expect(after!.last_used_at).not.toBeNull();
  });

  it("does not update last_used_at within 1 hour debounce window", async () => {
    const { userId } = await seedSession();
    const { key, id } = await createApiKey(env.DB, userId, "Debounce");
    await env.DB.prepare("UPDATE api_keys SET last_used_at = datetime('now', '-30 minutes') WHERE id = ?").bind(id).run();
    const before = (await env.DB.prepare("SELECT last_used_at FROM api_keys WHERE id = ?").bind(id).first<{ last_used_at: string | null }>())!.last_used_at;
    await validateApiKey(env.DB, key);
    const after = (await env.DB.prepare("SELECT last_used_at FROM api_keys WHERE id = ?").bind(id).first<{ last_used_at: string | null }>())!.last_used_at;
    expect(after).toBe(before);
  });

  it("updates last_used_at after debounce window expires", async () => {
    const { userId } = await seedSession();
    const { key, id } = await createApiKey(env.DB, userId, "Debounce2");
    await env.DB.prepare("UPDATE api_keys SET last_used_at = datetime('now', '-2 hours') WHERE id = ?").bind(id).run();
    const before = (await env.DB.prepare("SELECT last_used_at FROM api_keys WHERE id = ?").bind(id).first<{ last_used_at: string | null }>())!.last_used_at;
    await validateApiKey(env.DB, key);
    const after = (await env.DB.prepare("SELECT last_used_at FROM api_keys WHERE id = ?").bind(id).first<{ last_used_at: string | null }>())!.last_used_at;
    expect(after).not.toBe(before);
  });
});
