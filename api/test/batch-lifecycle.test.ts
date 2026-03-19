import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations, fetchJson, createBatch, API_HEADERS } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

describe("batch lifecycle", () => {
  it("advances stage", async () => {
    const batchId = await createBatch();
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}/advance`, {
      method: "POST", headers: API_HEADERS,
    });
    expect(status).toBe(200);
    expect(json.stage).toBe("primary_fermentation");
  });

  it("advances through all waypoints", async () => {
    const batchId = await createBatch();
    const expected = ["primary_fermentation", "secondary_fermentation", "stabilization", "bottling"];
    for (const stage of expected) {
      const { json } = await fetchJson(`/api/v1/batches/${batchId}/advance`, {
        method: "POST", headers: API_HEADERS,
      });
      expect(json.stage).toBe(stage);
    }
  });

  it("advance past bottling fails", async () => {
    const batchId = await createBatch();
    for (let i = 0; i < 4; i++) {
      await fetchJson(`/api/v1/batches/${batchId}/advance`, {
        method: "POST", headers: API_HEADERS,
      });
    }
    const { status } = await fetchJson(`/api/v1/batches/${batchId}/advance`, {
      method: "POST", headers: API_HEADERS,
    });
    expect(status).toBe(409);
  });

  it("completes batch", async () => {
    const batchId = await createBatch();
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}/complete`, {
      method: "POST", headers: API_HEADERS,
    });
    expect(status).toBe(200);
    expect(json.status).toBe("completed");
    expect(json.completed_at).not.toBeNull();
  });

  it("complete non-active fails", async () => {
    const batchId = await createBatch();
    await fetchJson(`/api/v1/batches/${batchId}/complete`, { method: "POST", headers: API_HEADERS });
    const { status } = await fetchJson(`/api/v1/batches/${batchId}/complete`, {
      method: "POST", headers: API_HEADERS,
    });
    expect(status).toBe(409);
  });

  it("abandons batch", async () => {
    const batchId = await createBatch();
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}/abandon`, {
      method: "POST", headers: API_HEADERS,
    });
    expect(status).toBe(200);
    expect(json.status).toBe("abandoned");
  });

  it("advance abandoned fails", async () => {
    const batchId = await createBatch();
    await fetchJson(`/api/v1/batches/${batchId}/abandon`, { method: "POST", headers: API_HEADERS });
    const { status } = await fetchJson(`/api/v1/batches/${batchId}/advance`, {
      method: "POST", headers: API_HEADERS,
    });
    expect(status).toBe(409);
  });

  it("archives completed batch", async () => {
    const batchId = await createBatch();
    await fetchJson(`/api/v1/batches/${batchId}/complete`, { method: "POST", headers: API_HEADERS });
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}/archive`, {
      method: "POST", headers: API_HEADERS,
    });
    expect(status).toBe(200);
    expect(json.status).toBe("archived");
  });

  it("archive active fails", async () => {
    const batchId = await createBatch();
    const { status } = await fetchJson(`/api/v1/batches/${batchId}/archive`, {
      method: "POST", headers: API_HEADERS,
    });
    expect(status).toBe(409);
  });

  it("unarchives batch", async () => {
    const batchId = await createBatch();
    await fetchJson(`/api/v1/batches/${batchId}/complete`, { method: "POST", headers: API_HEADERS });
    await fetchJson(`/api/v1/batches/${batchId}/archive`, { method: "POST", headers: API_HEADERS });
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}/unarchive`, {
      method: "POST", headers: API_HEADERS,
    });
    expect(status).toBe(200);
    expect(json.status).toBe("completed");
  });

  it("complete unassigns device", async () => {
    const batchId = await createBatch();
    await env.DB.prepare(
      "INSERT INTO devices (id, name, batch_id, assigned_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind("pill-1", "My Pill", batchId, "2026-03-19T10:00:00Z", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z").run();

    await fetchJson(`/api/v1/batches/${batchId}/complete`, { method: "POST", headers: API_HEADERS });
    const device = await env.DB.prepare("SELECT * FROM devices WHERE id = 'pill-1'").first<any>();
    expect(device.batch_id).toBeNull();
  });
});
