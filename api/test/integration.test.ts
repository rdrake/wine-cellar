import { describe, it, expect, beforeEach } from "vitest";
import { applyMigrations, fetchJson, API_HEADERS, WEBHOOK_HEADERS } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

describe("full batch workflow", () => {
  it("end-to-end: create batch, assign device, receive telemetry, log activities, complete", async () => {
    // 1. Create batch
    const { status: s1, json: batch } = await fetchJson("/api/v1/batches", {
      method: "POST",
      headers: API_HEADERS,
      body: { name: "2026 Cab Sauv", wine_type: "red", source_material: "fresh_grapes", started_at: "2026-09-15T08:00:00Z", volume_liters: 23.0 },
    });
    expect(s1).toBe(201);

    // 2. Register and assign device
    await fetchJson("/api/v1/devices", { method: "POST", headers: API_HEADERS, body: { id: "pill-001", name: "Fermentation Pill" } });
    const { json: assigned } = await fetchJson("/api/v1/devices/pill-001/assign", {
      method: "POST", headers: API_HEADERS, body: { batch_id: batch.id },
    });
    expect(assigned.batch_id).toBe(batch.id);

    // 3. Receive webhook telemetry
    const { status: s3 } = await fetchJson("/webhook/rapt", {
      method: "POST",
      headers: WEBHOOK_HEADERS,
      body: { device_id: "pill-001", device_name: "Fermentation Pill", temperature: 24.0, gravity: 1.090, battery: 98.0, rssi: -55.0, created_date: "2026-09-15T10:00:00Z" },
    });
    expect(s3).toBe(200);

    // 4. Log activity
    const { status: s4 } = await fetchJson(`/api/v1/batches/${batch.id}/activities`, {
      method: "POST",
      headers: API_HEADERS,
      body: { stage: "must_prep", type: "addition", title: "Added pectic enzyme", details: { chemical: "pectic enzyme", amount: 1.0, unit: "tsp" }, recorded_at: "2026-09-15T09:00:00Z" },
    });
    expect(s4).toBe(201);

    // 5. Advance through stages
    for (let i = 0; i < 4; i++) {
      await fetchJson(`/api/v1/batches/${batch.id}/advance`, { method: "POST", headers: API_HEADERS });
    }
    const { json: advanced } = await fetchJson(`/api/v1/batches/${batch.id}`, { headers: API_HEADERS });
    expect(advanced.stage).toBe("bottling");

    // 6. Check readings
    const { json: readings } = await fetchJson(`/api/v1/batches/${batch.id}/readings`, { headers: API_HEADERS });
    expect(readings.items).toHaveLength(1);

    // 7. Complete batch
    const { json: completed } = await fetchJson(`/api/v1/batches/${batch.id}/complete`, { method: "POST", headers: API_HEADERS });
    expect(completed.status).toBe("completed");

    // 8. Device unassigned
    const { json: devs } = await fetchJson("/api/v1/devices", { headers: API_HEADERS });
    expect(devs.items[0].batch_id).toBeNull();

    // 9. Archive
    const { json: archived } = await fetchJson(`/api/v1/batches/${batch.id}/archive`, { method: "POST", headers: API_HEADERS });
    expect(archived.status).toBe("archived");
  });
});
