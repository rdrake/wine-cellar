import { describe, it, expect, beforeEach } from "vitest";
import { applyMigrations, fetchJson, authHeaders, createBatch, WEBHOOK_HEADERS } from "./helpers";

const ALICE = "alice@example.com";
const BOB = "bob@example.com";

beforeEach(async () => {
  await applyMigrations();
});

describe("tenant isolation", () => {
  it("user cannot list another user's batches", async () => {
    await createBatch({ name: "Alice's Wine" }, ALICE);
    await createBatch({ name: "Bob's Wine" }, BOB);

    const { json } = await fetchJson("/api/v1/batches", { headers: authHeaders(ALICE) });
    expect(json.items).toHaveLength(1);
    expect(json.items[0].name).toBe("Alice's Wine");
  });

  it("user cannot read another user's batch", async () => {
    const bobBatch = await createBatch({ name: "Bob's Wine" }, BOB);
    const { status } = await fetchJson(`/api/v1/batches/${bobBatch}`, { headers: authHeaders(ALICE) });
    expect(status).toBe(404);
  });

  it("user cannot update another user's batch", async () => {
    const bobBatch = await createBatch({ name: "Bob's Wine" }, BOB);
    const { status } = await fetchJson(`/api/v1/batches/${bobBatch}`, {
      method: "PATCH",
      headers: authHeaders(ALICE),
      body: { name: "Stolen Wine" },
    });
    expect(status).toBe(404);
  });

  it("user cannot delete another user's batch", async () => {
    const bobBatch = await createBatch({ name: "Bob's Wine" }, BOB);
    // Abandon first (as Bob) to allow deletion
    await fetchJson(`/api/v1/batches/${bobBatch}/abandon`, { method: "POST", headers: authHeaders(BOB) });
    const { status } = await fetchJson(`/api/v1/batches/${bobBatch}`, {
      method: "DELETE",
      headers: authHeaders(ALICE),
    });
    expect(status).toBe(404);
  });

  it("user cannot see another user's activities", async () => {
    const bobBatch = await createBatch({ name: "Bob's Wine" }, BOB);
    // Bob logs an activity
    await fetchJson(`/api/v1/batches/${bobBatch}/activities`, {
      method: "POST",
      headers: authHeaders(BOB),
      body: { stage: "must_prep", type: "note", title: "Secret note", recorded_at: "2026-03-20T10:00:00Z" },
    });

    // Alice tries to list activities on Bob's batch
    const { status } = await fetchJson(`/api/v1/batches/${bobBatch}/activities`, {
      headers: authHeaders(ALICE),
    });
    expect(status).toBe(404); // Batch not found for Alice
  });

  it("user cannot see another user's devices", async () => {
    // Alice registers a device
    await fetchJson("/api/v1/devices", {
      method: "POST",
      headers: authHeaders(ALICE),
      body: { id: "alice-pill", name: "Alice's Pill" },
    });

    // Bob's device list shouldn't include it
    const { json } = await fetchJson("/api/v1/devices", { headers: authHeaders(BOB) });
    expect(json.items.find((d: any) => d.id === "alice-pill")).toBeUndefined();
  });

  it("dashboard only shows user's own data", async () => {
    await createBatch({ name: "Alice's Wine" }, ALICE);
    await createBatch({ name: "Bob's Wine" }, BOB);

    const { json } = await fetchJson("/api/v1/dashboard", { headers: authHeaders(ALICE) });
    expect(json.active_batches).toHaveLength(1);
    expect(json.active_batches[0].name).toBe("Alice's Wine");
  });

  it("claiming a device gives ownership of its readings", async () => {
    // Webhook creates unclaimed device + reading
    await fetchJson("/webhook/rapt", {
      method: "POST",
      headers: WEBHOOK_HEADERS,
      body: { device_id: "orphan-pill", device_name: "Orphan", temperature: 22, gravity: 1.050, battery: 90, rssi: -50, created_date: "2026-03-20T10:00:00Z" },
    });

    // Alice claims it
    await fetchJson("/api/v1/devices/claim", {
      method: "POST",
      headers: authHeaders(ALICE),
      body: { device_id: "orphan-pill" },
    });

    // Alice can see the device
    const { json: devices } = await fetchJson("/api/v1/devices", { headers: authHeaders(ALICE) });
    expect(devices.items.find((d: any) => d.id === "orphan-pill")).toBeDefined();

    // Bob cannot
    const { json: bobDevices } = await fetchJson("/api/v1/devices", { headers: authHeaders(BOB) });
    expect(bobDevices.items.find((d: any) => d.id === "orphan-pill")).toBeUndefined();
  });
});
