import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations, fetchJson, createBatch, authHeaders, WEBHOOK_HEADERS } from "./helpers";

const VALID_PAYLOAD = {
  device_id: "pill-abc-123",
  device_name: "My RAPT Pill",
  temperature: 22.5,
  gravity: 1.045,
  battery: 92.3,
  rssi: -58.0,
  created_date: "2026-03-19T14:30:00Z",
};

beforeEach(async () => {
  await applyMigrations();
});

describe("webhook", () => {
  it("creates reading", async () => {
    await env.DB.prepare("INSERT INTO devices (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .bind("pill-abc-123", "My Pill", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z").run();
    const { status } = await fetchJson("/webhook/rapt", { method: "POST", headers: WEBHOOK_HEADERS, body: VALID_PAYLOAD });
    expect(status).toBe(200);
    const reading = await env.DB.prepare("SELECT * FROM readings WHERE device_id = 'pill-abc-123'").first<any>();
    expect(reading).not.toBeNull();
    expect(reading.gravity).toBe(1.045);
    expect(reading.source_timestamp).toBe("2026-03-19T14:30:00Z");
  });

  it("auto-registers unknown device", async () => {
    const { status } = await fetchJson("/webhook/rapt", { method: "POST", headers: WEBHOOK_HEADERS, body: VALID_PAYLOAD });
    expect(status).toBe(200);
    const device = await env.DB.prepare("SELECT * FROM devices WHERE id = 'pill-abc-123'").first<any>();
    expect(device).not.toBeNull();
    expect(device.name).toBe("My RAPT Pill");
  });

  it("resolves batch from device", async () => {
    const headers = await authHeaders();
    const { json: batch } = await fetchJson("/api/v1/batches", {
      method: "POST", headers,
      body: { name: "Test", wine_type: "red", source_material: "kit", started_at: "2026-03-19T10:00:00Z" },
    });
    await env.DB.prepare(
      "INSERT INTO devices (id, name, batch_id, assigned_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind("pill-abc-123", "My Pill", batch.id, "2026-03-19T10:00:00Z", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z").run();
    await fetchJson("/webhook/rapt", { method: "POST", headers: WEBHOOK_HEADERS, body: VALID_PAYLOAD });
    const reading = await env.DB.prepare("SELECT batch_id FROM readings WHERE device_id = 'pill-abc-123'").first<any>();
    expect(reading.batch_id).toBe(batch.id);
  });

  it("unassigned device null batch", async () => {
    const { status } = await fetchJson("/webhook/rapt", { method: "POST", headers: WEBHOOK_HEADERS, body: VALID_PAYLOAD });
    expect(status).toBe(200);
  });

  it("deduplicates", async () => {
    const { status: s1 } = await fetchJson("/webhook/rapt", { method: "POST", headers: WEBHOOK_HEADERS, body: VALID_PAYLOAD });
    expect(s1).toBe(200);
    const { status: s2 } = await fetchJson("/webhook/rapt", { method: "POST", headers: WEBHOOK_HEADERS, body: VALID_PAYLOAD });
    expect(s2).toBe(200);
  });

  it("rejects invalid token", async () => {
    const { status } = await fetchJson("/webhook/rapt", {
      method: "POST", headers: { "X-Webhook-Token": "wrong" }, body: VALID_PAYLOAD,
    });
    expect(status).toBe(401);
  });

  it("rejects missing token", async () => {
    const { status } = await fetchJson("/webhook/rapt", { method: "POST", body: VALID_PAYLOAD });
    expect(status).toBe(401);
  });

  it("rejects invalid payload", async () => {
    const { status } = await fetchJson("/webhook/rapt", {
      method: "POST", headers: WEBHOOK_HEADERS, body: { bad: "data" },
    });
    expect(status).toBe(422);
  });

  it("auth before body validation", async () => {
    const { status } = await fetchJson("/webhook/rapt", {
      method: "POST", body: { bad: "data" },
    });
    expect(status).toBe(401);
  });

  it("fires temp_high alert on hot reading", async () => {
    const batchId = await createBatch();
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = 'test@example.com'").first<{ id: string }>();
    await env.DB.prepare("INSERT INTO devices (id, name, user_id, batch_id, assigned_at, created_at, updated_at) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))")
      .bind("hot-pill", "Hot Pill", user!.id, batchId).run();

    await fetchJson("/webhook/rapt", {
      method: "POST",
      headers: WEBHOOK_HEADERS,
      body: { ...VALID_PAYLOAD, device_id: "hot-pill", temperature: 32.0 },
    });

    const alert = await env.DB.prepare(
      "SELECT * FROM alert_state WHERE batch_id = ? AND alert_type = 'temp_high'"
    ).bind(batchId).first<any>();
    expect(alert).not.toBeNull();
    expect(alert.alert_type).toBe("temp_high");
  });
});
