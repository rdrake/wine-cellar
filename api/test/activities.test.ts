import { describe, it, expect, beforeEach } from "vitest";
import { applyMigrations, fetchJson, createBatch, authHeaders } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

describe("activities CRUD", () => {
  it("creates addition activity", async () => {
    const batchId = await createBatch();
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}/activities`, {
      method: "POST",
      headers: await authHeaders(),
      body: {
        stage: "must_prep", type: "addition", title: "Added K-meta",
        details: { chemical: "K-meta", amount: 0.25, unit: "tsp" },
        recorded_at: "2026-03-19T10:00:00Z",
      },
    });
    expect(status).toBe(201);
    expect(json.title).toBe("Added K-meta");
    expect(json.details.chemical).toBe("K-meta");
  });

  it("rejects invalid stage for waypoint", async () => {
    const batchId = await createBatch();
    const { status } = await fetchJson(`/api/v1/batches/${batchId}/activities`, {
      method: "POST",
      headers: await authHeaders(),
      body: { stage: "bottling", type: "note", title: "Too early", details: {}, recorded_at: "2026-03-19T10:00:00Z" },
    });
    expect(status).toBe(409);
  });

  it("lists activities", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    for (let i = 0; i < 3; i++) {
      await fetchJson(`/api/v1/batches/${batchId}/activities`, {
        method: "POST",
        headers,
        body: { stage: "must_prep", type: "note", title: `Note ${i}`, details: {}, recorded_at: `2026-03-19T1${i}:00:00Z` },
      });
    }
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}/activities`, { headers });
    expect(status).toBe(200);
    expect(json.items).toHaveLength(3);
  });

  it("filters by type", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    await fetchJson(`/api/v1/batches/${batchId}/activities`, {
      method: "POST", headers,
      body: { stage: "must_prep", type: "note", title: "A note", details: {}, recorded_at: "2026-03-19T10:00:00Z" },
    });
    await fetchJson(`/api/v1/batches/${batchId}/activities`, {
      method: "POST", headers,
      body: { stage: "must_prep", type: "addition", title: "K-meta", details: { chemical: "K-meta", amount: 1, unit: "tsp" }, recorded_at: "2026-03-19T11:00:00Z" },
    });
    const { json } = await fetchJson(`/api/v1/batches/${batchId}/activities?type=addition`, { headers });
    expect(json.items).toHaveLength(1);
  });

  it("updates activity", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    const { json: created } = await fetchJson(`/api/v1/batches/${batchId}/activities`, {
      method: "POST", headers,
      body: { stage: "must_prep", type: "note", title: "Original", details: {}, recorded_at: "2026-03-19T10:00:00Z" },
    });
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}/activities/${created.id}`, {
      method: "PATCH", headers,
      body: { title: "Updated" },
    });
    expect(status).toBe(200);
    expect(json.title).toBe("Updated");
  });

  it("deletes activity", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    const { json: created } = await fetchJson(`/api/v1/batches/${batchId}/activities`, {
      method: "POST", headers,
      body: { stage: "must_prep", type: "note", title: "Delete me", details: {}, recorded_at: "2026-03-19T10:00:00Z" },
    });
    const { status } = await fetchJson(`/api/v1/batches/${batchId}/activities/${created.id}`, {
      method: "DELETE", headers,
    });
    expect(status).toBe(204);
  });

  it("cannot log on completed batch", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    await fetchJson(`/api/v1/batches/${batchId}/complete`, { method: "POST", headers });
    const { status } = await fetchJson(`/api/v1/batches/${batchId}/activities`, {
      method: "POST", headers,
      body: { stage: "must_prep", type: "note", title: "Too late", details: {}, recorded_at: "2026-03-19T10:00:00Z" },
    });
    expect(status).toBe(409);
  });
});
