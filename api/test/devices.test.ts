import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations, fetchJson, createBatch, authHeaders, WEBHOOK_HEADERS } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

describe("devices", () => {
  it("registers device", async () => {
    const { status, json } = await fetchJson("/api/v1/devices", {
      method: "POST", headers: await authHeaders(),
      body: { id: "pill-1", name: "My Pill" },
    });
    expect(status).toBe(201);
    expect(json.id).toBe("pill-1");
    expect(json.batch_id).toBeNull();
  });

  it("rejects duplicate device", async () => {
    const headers = await authHeaders();
    await fetchJson("/api/v1/devices", { method: "POST", headers, body: { id: "pill-1", name: "My Pill" } });
    const { status } = await fetchJson("/api/v1/devices", { method: "POST", headers, body: { id: "pill-1", name: "Dupe" } });
    expect(status).toBe(409);
  });

  it("lists devices", async () => {
    const headers = await authHeaders();
    await fetchJson("/api/v1/devices", { method: "POST", headers, body: { id: "pill-1", name: "Pill 1" } });
    await fetchJson("/api/v1/devices", { method: "POST", headers, body: { id: "pill-2", name: "Pill 2" } });
    const { json } = await fetchJson("/api/v1/devices", { headers });
    expect(json.items).toHaveLength(2);
  });

  it("assigns device", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    await fetchJson("/api/v1/devices", { method: "POST", headers, body: { id: "pill-1", name: "My Pill" } });
    const { status, json } = await fetchJson("/api/v1/devices/pill-1/assign", {
      method: "POST", headers, body: { batch_id: batchId },
    });
    expect(status).toBe(200);
    expect(json.batch_id).toBe(batchId);
  });

  it("assign to non-active batch fails", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    await fetchJson(`/api/v1/batches/${batchId}/complete`, { method: "POST", headers });
    await fetchJson("/api/v1/devices", { method: "POST", headers, body: { id: "pill-1", name: "My Pill" } });
    const { status } = await fetchJson("/api/v1/devices/pill-1/assign", {
      method: "POST", headers, body: { batch_id: batchId },
    });
    expect(status).toBe(409);
  });

  it("unassigns device", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    await fetchJson("/api/v1/devices", { method: "POST", headers, body: { id: "pill-1", name: "My Pill" } });
    await fetchJson("/api/v1/devices/pill-1/assign", { method: "POST", headers, body: { batch_id: batchId } });
    const { status, json } = await fetchJson("/api/v1/devices/pill-1/unassign", {
      method: "POST", headers,
    });
    expect(status).toBe(200);
    expect(json.batch_id).toBeNull();
  });

  it("claims an unclaimed device and backfills readings", async () => {
    // Setup: webhook creates unclaimed device + readings
    await fetchJson("/webhook/rapt", {
      method: "POST",
      headers: WEBHOOK_HEADERS,
      body: { device_id: "pill-claim-1", device_name: "Claim Test", temperature: 22, gravity: 1.050, battery: 90, rssi: -50, created_date: "2026-03-20T10:00:00Z" },
    });

    // Claim it
    const headers = await authHeaders();
    const { status, json } = await fetchJson("/api/v1/devices/claim", {
      method: "POST",
      headers,
      body: { device_id: "pill-claim-1" },
    });
    expect(status).toBe(200);
    expect(json.user_id).toBeDefined();

    // Verify device now appears in user's list
    const { json: list } = await fetchJson("/api/v1/devices", { headers });
    expect(list.items.some((d: any) => d.id === "pill-claim-1")).toBe(true);
  });

  it("assign backfills readings", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    await fetchJson("/api/v1/devices", { method: "POST", headers, body: { id: "pill-1", name: "My Pill" } });

    // Insert unassigned readings — one before batch start, one after
    await env.DB.prepare(
      "INSERT INTO readings (id, batch_id, device_id, gravity, temperature, battery, rssi, source_timestamp, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("r1", null, "pill-1", 1.090, 22.0, 95.0, -60.0, "2026-03-18T10:00:00Z", "2026-03-18T10:00:00Z").run();
    await env.DB.prepare(
      "INSERT INTO readings (id, batch_id, device_id, gravity, temperature, battery, rssi, source_timestamp, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("r2", null, "pill-1", 1.088, 22.5, 94.0, -62.0, "2026-03-19T12:00:00Z", "2026-03-19T12:00:00Z").run();

    await fetchJson("/api/v1/devices/pill-1/assign", { method: "POST", headers, body: { batch_id: batchId } });

    const r1 = await env.DB.prepare("SELECT batch_id FROM readings WHERE id = 'r1'").first<any>();
    expect(r1.batch_id).toBeNull();
    const r2 = await env.DB.prepare("SELECT batch_id FROM readings WHERE id = 'r2'").first<any>();
    expect(r2.batch_id).toBe(batchId);
  });
});
