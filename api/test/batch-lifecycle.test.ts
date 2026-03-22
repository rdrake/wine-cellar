import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations, fetchJson, createBatch, authHeaders } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

describe("batch lifecycle", () => {
  it("advances stage", async () => {
    const batchId = await createBatch();
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}/advance`, {
      method: "POST", headers: await authHeaders(),
    });
    expect(status).toBe(200);
    expect(json.stage).toBe("primary_fermentation");
  });

  it("advances through all waypoints", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    const expected = ["primary_fermentation", "secondary_fermentation", "stabilization", "bottling"];
    for (const stage of expected) {
      const { json } = await fetchJson(`/api/v1/batches/${batchId}/advance`, {
        method: "POST", headers,
      });
      expect(json.stage).toBe(stage);
    }
  });

  it("advance past bottling fails", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    for (let i = 0; i < 4; i++) {
      await fetchJson(`/api/v1/batches/${batchId}/advance`, {
        method: "POST", headers,
      });
    }
    const { status } = await fetchJson(`/api/v1/batches/${batchId}/advance`, {
      method: "POST", headers,
    });
    expect(status).toBe(409);
  });

  it("completes batch", async () => {
    const batchId = await createBatch();
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}/complete`, {
      method: "POST", headers: await authHeaders(),
    });
    expect(status).toBe(200);
    expect(json.status).toBe("completed");
    expect(json.completed_at).not.toBeNull();
  });

  it("complete non-active fails", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    await fetchJson(`/api/v1/batches/${batchId}/complete`, { method: "POST", headers });
    const { status } = await fetchJson(`/api/v1/batches/${batchId}/complete`, {
      method: "POST", headers,
    });
    expect(status).toBe(409);
  });

  it("abandons batch", async () => {
    const batchId = await createBatch();
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}/abandon`, {
      method: "POST", headers: await authHeaders(),
    });
    expect(status).toBe(200);
    expect(json.status).toBe("abandoned");
  });

  it("advance abandoned fails", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    await fetchJson(`/api/v1/batches/${batchId}/abandon`, { method: "POST", headers });
    const { status } = await fetchJson(`/api/v1/batches/${batchId}/advance`, {
      method: "POST", headers,
    });
    expect(status).toBe(409);
  });

  it("archives completed batch", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    await fetchJson(`/api/v1/batches/${batchId}/complete`, { method: "POST", headers });
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}/archive`, {
      method: "POST", headers,
    });
    expect(status).toBe(200);
    expect(json.status).toBe("archived");
  });

  it("archive active fails", async () => {
    const batchId = await createBatch();
    const { status } = await fetchJson(`/api/v1/batches/${batchId}/archive`, {
      method: "POST", headers: await authHeaders(),
    });
    expect(status).toBe(409);
  });

  it("unarchives batch", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    await fetchJson(`/api/v1/batches/${batchId}/complete`, { method: "POST", headers });
    await fetchJson(`/api/v1/batches/${batchId}/archive`, { method: "POST", headers });
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}/unarchive`, {
      method: "POST", headers,
    });
    expect(status).toBe(200);
    expect(json.status).toBe("completed");
  });

  it("PATCH status reopens completed batch", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    await fetchJson(`/api/v1/batches/${batchId}/complete`, { method: "POST", headers });
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}`, {
      method: "PATCH", headers, body: { status: "active" },
    });
    expect(status).toBe(200);
    expect(json.status).toBe("active");
    expect(json.completed_at).toBeNull();
  });

  it("PATCH status reopens abandoned batch", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    await fetchJson(`/api/v1/batches/${batchId}/abandon`, { method: "POST", headers });
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}`, {
      method: "PATCH", headers, body: { status: "active" },
    });
    expect(status).toBe(200);
    expect(json.status).toBe("active");
  });

  it("PATCH rejects invalid status transition", async () => {
    const batchId = await createBatch();
    const { status } = await fetchJson(`/api/v1/batches/${batchId}`, {
      method: "PATCH", headers: await authHeaders(), body: { status: "archived" },
    });
    expect(status).toBe(409);
  });

  it("sets stage to any waypoint", async () => {
    const batchId = await createBatch();
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}/stage`, {
      method: "POST", headers: await authHeaders(), body: { stage: "stabilization" },
    });
    expect(status).toBe(200);
    expect(json.stage).toBe("stabilization");
  });

  it("moves stage backward", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    await fetchJson(`/api/v1/batches/${batchId}/stage`, {
      method: "POST", headers, body: { stage: "secondary_fermentation" },
    });
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}/stage`, {
      method: "POST", headers, body: { stage: "must_prep" },
    });
    expect(status).toBe(200);
    expect(json.stage).toBe("must_prep");
  });

  it("stage change logs activity", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    await fetchJson(`/api/v1/batches/${batchId}/stage`, {
      method: "POST", headers, body: { stage: "primary_fermentation" },
    });
    const { json: activities } = await fetchJson(`/api/v1/batches/${batchId}/activities`, { headers });
    expect(activities.items.length).toBe(1);
    expect(activities.items[0].title).toContain("must_prep");
    expect(activities.items[0].title).toContain("primary_fermentation");
  });

  it("rejects invalid stage name", async () => {
    const batchId = await createBatch();
    const { status } = await fetchJson(`/api/v1/batches/${batchId}/stage`, {
      method: "POST", headers: await authHeaders(), body: { stage: "invalid_stage" },
    });
    expect(status).toBe(422);
  });

  it("rejects stage change on non-active batch", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    await fetchJson(`/api/v1/batches/${batchId}/complete`, { method: "POST", headers });
    const { status } = await fetchJson(`/api/v1/batches/${batchId}/stage`, {
      method: "POST", headers, body: { stage: "bottling" },
    });
    expect(status).toBe(409);
  });

  it("no-ops when setting same stage", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}/stage`, {
      method: "POST", headers, body: { stage: "must_prep" },
    });
    expect(status).toBe(200);
    expect(json.stage).toBe("must_prep");
    const { json: activities } = await fetchJson(`/api/v1/batches/${batchId}/activities`, { headers });
    expect(activities.items.length).toBe(0);
  });

  it("complete unassigns device", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    await env.DB.prepare(
      "INSERT INTO devices (id, name, batch_id, assigned_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind("pill-1", "My Pill", batchId, "2026-03-19T10:00:00Z", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z").run();

    await fetchJson(`/api/v1/batches/${batchId}/complete`, { method: "POST", headers });
    const device = await env.DB.prepare("SELECT * FROM devices WHERE id = 'pill-1'").first<any>();
    expect(device.batch_id).toBeNull();
  });
});
