import { describe, it, expect, beforeEach } from "vitest";
import { applyMigrations, fetchJson, createBatch, authHeaders, API_HEADERS, VALID_BATCH } from "./helpers";

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

  it("creates batch with target_gravity", async () => {
    const { status, json } = await fetchJson("/api/v1/batches", {
      method: "POST", headers: API_HEADERS,
      body: { ...VALID_BATCH, target_gravity: 0.996 },
    });
    expect(status).toBe(201);
    expect(json.target_gravity).toBe(0.996);
  });

  it("updates target_gravity", async () => {
    const batchId = await createBatch();
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}`, {
      method: "PATCH", headers: API_HEADERS, body: { target_gravity: 1.000 },
    });
    expect(status).toBe(200);
    expect(json.target_gravity).toBe(1.0);
  });

  it("user A cannot see user B's batches", async () => {
    const idA = await createBatch({ name: "User A Batch" }, "a@example.com");
    const idB = await createBatch({ name: "User B Batch" }, "b@example.com");

    const { json: listA } = await fetchJson("/api/v1/batches", { headers: authHeaders("a@example.com") });
    expect(listA.items).toHaveLength(1);
    expect(listA.items[0].name).toBe("User A Batch");

    const { status } = await fetchJson(`/api/v1/batches/${idB}`, { headers: authHeaders("a@example.com") });
    expect(status).toBe(404);
  });
});

describe("winemaking metadata", () => {
  it("creates batch with winemaking fields", async () => {
    const { status, json } = await fetchJson("/api/v1/batches", {
      method: "POST",
      headers: API_HEADERS,
      body: {
        ...VALID_BATCH,
        yeast_strain: "EC-1118",
        oak_type: "french",
        oak_format: "barrel",
        oak_duration_days: 180,
        mlf_status: "pending",
      },
    });
    expect(status).toBe(201);
    expect(json.yeast_strain).toBe("EC-1118");
    expect(json.oak_type).toBe("french");
    expect(json.oak_format).toBe("barrel");
    expect(json.oak_duration_days).toBe(180);
    expect(json.mlf_status).toBe("pending");
  });

  it("updates winemaking fields via PATCH", async () => {
    const batchId = await createBatch();
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}`, {
      method: "PATCH",
      headers: API_HEADERS,
      body: {
        yeast_strain: "D47",
        oak_type: "american",
        oak_format: "chips",
        oak_duration_days: 30,
        mlf_status: "in_progress",
      },
    });
    expect(status).toBe(200);
    expect(json.yeast_strain).toBe("D47");
    expect(json.oak_type).toBe("american");
    expect(json.oak_format).toBe("chips");
    expect(json.oak_duration_days).toBe(30);
    expect(json.mlf_status).toBe("in_progress");
  });

  it("rejects invalid oak_type", async () => {
    const { status } = await fetchJson("/api/v1/batches", {
      method: "POST",
      headers: API_HEADERS,
      body: { ...VALID_BATCH, oak_type: "bamboo" },
    });
    expect(status).toBe(422);
  });

  it("rejects invalid mlf_status", async () => {
    const { status } = await fetchJson("/api/v1/batches", {
      method: "POST",
      headers: API_HEADERS,
      body: { ...VALID_BATCH, mlf_status: "unknown" },
    });
    expect(status).toBe(422);
  });

  it("sets bottled_at when completing from bottling stage", async () => {
    const batchId = await createBatch();
    // Advance through all stages to bottling
    await fetchJson(`/api/v1/batches/${batchId}/advance`, { method: "POST", headers: API_HEADERS });
    await fetchJson(`/api/v1/batches/${batchId}/advance`, { method: "POST", headers: API_HEADERS });
    await fetchJson(`/api/v1/batches/${batchId}/advance`, { method: "POST", headers: API_HEADERS });
    await fetchJson(`/api/v1/batches/${batchId}/advance`, { method: "POST", headers: API_HEADERS });

    // Verify we're at bottling
    const { json: batch } = await fetchJson(`/api/v1/batches/${batchId}`, { headers: API_HEADERS });
    expect(batch.stage).toBe("bottling");

    // Complete from bottling
    const { json: completed } = await fetchJson(`/api/v1/batches/${batchId}/complete`, {
      method: "POST",
      headers: API_HEADERS,
    });
    expect(completed.bottled_at).toBeTruthy();
  });

  it("does NOT set bottled_at when completing from non-bottling stage", async () => {
    const batchId = await createBatch();
    // Complete from must_prep (initial stage)
    const { json: completed } = await fetchJson(`/api/v1/batches/${batchId}/complete`, {
      method: "POST",
      headers: API_HEADERS,
    });
    expect(completed.bottled_at).toBeNull();
  });
});

describe("winemaking intelligence on batch detail", () => {
  it("returns nudges array on active batch", async () => {
    const id = await createBatch();
    const { json } = await fetchJson(`/api/v1/batches/${id}`, { headers: API_HEADERS });
    expect(json.nudges).toBeDefined();
    expect(Array.isArray(json.nudges)).toBe(true);
    expect(json.nudges.length).toBeGreaterThan(0);
    // must_prep stage should have measurement nudge
    const measure = json.nudges.find((n: any) => n.id.includes("initial-measurements"));
    expect(measure).toBeTruthy();
  });

  it("returns timeline array on active batch", async () => {
    const id = await createBatch();
    const { json } = await fetchJson(`/api/v1/batches/${id}`, { headers: API_HEADERS });
    expect(json.timeline).toBeDefined();
    expect(Array.isArray(json.timeline)).toBe(true);
  });

  it("does NOT return nudges/timeline on completed batch", async () => {
    const id = await createBatch();
    await fetchJson(`/api/v1/batches/${id}/complete`, { method: "POST", headers: API_HEADERS });
    const { json } = await fetchJson(`/api/v1/batches/${id}`, { headers: API_HEADERS });
    expect(json.nudges).toEqual([]);
    expect(json.timeline).toEqual([]);
  });
});

describe("cellaring intelligence", () => {
  it("returns cellaring data for bottled batch", async () => {
    const id = await createBatch({ wine_type: "red", source_material: "fresh_grapes" });
    // Advance to bottling and complete
    for (const _ of [1, 2, 3, 4]) {
      await fetchJson(`/api/v1/batches/${id}/advance`, { method: "POST", headers: API_HEADERS });
    }
    await fetchJson(`/api/v1/batches/${id}/complete`, { method: "POST", headers: API_HEADERS });
    const { json } = await fetchJson(`/api/v1/batches/${id}`, { headers: API_HEADERS });
    expect(json.bottled_at).toBeTruthy();
    expect(json.cellaring).toBeTruthy();
    expect(json.cellaring.readyDate).toBeTruthy();
    expect(json.cellaring.peakStart).toBeTruthy();
    expect(json.cellaring.storageNote).toBeTruthy();
  });

  it("does NOT return cellaring for completed batch without bottled_at", async () => {
    const id = await createBatch();
    await fetchJson(`/api/v1/batches/${id}/complete`, { method: "POST", headers: API_HEADERS });
    const { json } = await fetchJson(`/api/v1/batches/${id}`, { headers: API_HEADERS });
    expect(json.bottled_at).toBeNull();
    expect(json.cellaring).toBeNull();
  });
});
