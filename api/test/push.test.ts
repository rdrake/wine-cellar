import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations, fetchJson, API_HEADERS } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

const VALID_SUBSCRIPTION = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  keys: {
    p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8p8REfXRI",
    auth: "tBHItJI5svbpC7v8",
  },
};

describe("push subscription endpoints", () => {
  it("GET /push/vapid-key returns public key", async () => {
    const { status, json } = await fetchJson("/api/v1/push/vapid-key", {
      headers: API_HEADERS,
    });
    expect(status).toBe(200);
    expect(json.key).toBe("test-vapid-public-key");
  });

  it("POST /push/subscribe stores subscription", async () => {
    const { status, json } = await fetchJson("/api/v1/push/subscribe", {
      method: "POST",
      headers: API_HEADERS,
      body: VALID_SUBSCRIPTION,
    });
    expect(status).toBe(201);
    expect(json.endpoint).toBe(VALID_SUBSCRIPTION.endpoint);

    // Verify it's in the DB
    const row = await env.DB.prepare(
      "SELECT * FROM push_subscriptions WHERE endpoint = ?"
    ).bind(VALID_SUBSCRIPTION.endpoint).first<any>();
    expect(row).not.toBeNull();
    expect(row.keys_p256dh).toBe(VALID_SUBSCRIPTION.keys.p256dh);
    expect(row.keys_auth).toBe(VALID_SUBSCRIPTION.keys.auth);
  });

  it("POST /push/subscribe upserts on same endpoint", async () => {
    // First subscribe
    await fetchJson("/api/v1/push/subscribe", {
      method: "POST",
      headers: API_HEADERS,
      body: VALID_SUBSCRIPTION,
    });

    // Upsert with new keys
    const updatedKeys = {
      ...VALID_SUBSCRIPTION,
      keys: { p256dh: "updated-p256dh-key", auth: "updated-auth" },
    };
    const { status, json } = await fetchJson("/api/v1/push/subscribe", {
      method: "POST",
      headers: API_HEADERS,
      body: updatedKeys,
    });
    expect(status).toBe(201);
    expect(json.endpoint).toBe(VALID_SUBSCRIPTION.endpoint);

    // Verify only one row exists, with updated keys
    const rows = await env.DB.prepare(
      "SELECT * FROM push_subscriptions WHERE endpoint = ?"
    ).bind(VALID_SUBSCRIPTION.endpoint).all<any>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].keys_p256dh).toBe("updated-p256dh-key");
    expect(rows.results[0].keys_auth).toBe("updated-auth");
  });

  it("POST /push/subscribe rejects invalid body", async () => {
    const { status, json } = await fetchJson("/api/v1/push/subscribe", {
      method: "POST",
      headers: API_HEADERS,
      body: { endpoint: "not-a-url" },
    });
    expect(status).toBe(422);
    expect(json.error).toBe("validation_error");
  });

  it("DELETE /push/subscribe removes subscription", async () => {
    // First subscribe
    await fetchJson("/api/v1/push/subscribe", {
      method: "POST",
      headers: API_HEADERS,
      body: VALID_SUBSCRIPTION,
    });

    // Delete
    const { status } = await fetchJson("/api/v1/push/subscribe", {
      method: "DELETE",
      headers: API_HEADERS,
      body: { endpoint: VALID_SUBSCRIPTION.endpoint },
    });
    expect(status).toBe(204);

    // Verify it's gone
    const row = await env.DB.prepare(
      "SELECT * FROM push_subscriptions WHERE endpoint = ?"
    ).bind(VALID_SUBSCRIPTION.endpoint).first<any>();
    expect(row).toBeNull();
  });

  it("DELETE /push/subscribe rejects invalid body", async () => {
    const { status, json } = await fetchJson("/api/v1/push/subscribe", {
      method: "DELETE",
      headers: API_HEADERS,
      body: { endpoint: "not-a-url" },
    });
    expect(status).toBe(422);
    expect(json.error).toBe("validation_error");
  });
});
