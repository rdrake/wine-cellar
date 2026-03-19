import { describe, it, expect, beforeEach } from "vitest";
import { applyMigrations, fetchJson, createBatch, API_HEADERS, VALID_BATCH } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

describe("batches CRUD", () => {
  it("creates a batch", async () => {
    const { status, json } = await fetchJson("/api/v1/batches", {
      method: "POST",
      headers: API_HEADERS,
      body: VALID_BATCH,
    });
    expect(status).toBe(201);
    expect(json.name).toBe("2026 Merlot");
    expect(json.stage).toBe("must_prep");
    expect(json.status).toBe("active");
    expect(json.id).toBeDefined();
  });

  it("rejects invalid wine type", async () => {
    const { status } = await fetchJson("/api/v1/batches", {
      method: "POST",
      headers: API_HEADERS,
      body: { ...VALID_BATCH, wine_type: "beer" },
    });
    expect(status).toBe(422);
  });

  it("gets a batch", async () => {
    const batchId = await createBatch();
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}`, {
      headers: API_HEADERS,
    });
    expect(status).toBe(200);
    expect(json.id).toBe(batchId);
  });

  it("returns 404 for missing batch", async () => {
    const { status } = await fetchJson("/api/v1/batches/nonexistent", {
      headers: API_HEADERS,
    });
    expect(status).toBe(404);
  });

  it("lists batches empty", async () => {
    const { status, json } = await fetchJson("/api/v1/batches", {
      headers: API_HEADERS,
    });
    expect(status).toBe(200);
    expect(json.items).toEqual([]);
  });

  it("lists batches with filter", async () => {
    await createBatch();
    await createBatch({ name: "Chardonnay", wine_type: "white" });
    const { json } = await fetchJson("/api/v1/batches?wine_type=red", {
      headers: API_HEADERS,
    });
    expect(json.items).toHaveLength(1);
    expect(json.items[0].wine_type).toBe("red");
  });

  it("patches batch metadata", async () => {
    const batchId = await createBatch();
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}`, {
      method: "PATCH",
      headers: API_HEADERS,
      body: { name: "Updated Name", notes: "New notes" },
    });
    expect(status).toBe(200);
    expect(json.name).toBe("Updated Name");
  });

  it("deletes batch with no data", async () => {
    const batchId = await createBatch();
    const { status } = await fetchJson(`/api/v1/batches/${batchId}`, {
      method: "DELETE",
      headers: API_HEADERS,
    });
    expect(status).toBe(204);
  });

  it("returns 404 deleting missing batch", async () => {
    const { status } = await fetchJson("/api/v1/batches/nonexistent", {
      method: "DELETE",
      headers: API_HEADERS,
    });
    expect(status).toBe(404);
  });
});
