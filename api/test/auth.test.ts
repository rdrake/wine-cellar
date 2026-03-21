import { describe, it, expect, beforeEach } from "vitest";
import { applyMigrations, fetchJson, authHeaders, WEBHOOK_HEADERS } from "./helpers";

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
});
