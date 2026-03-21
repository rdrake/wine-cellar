import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations, fetchJson, createBatch, API_HEADERS, authHeaders, TEST_USER_EMAIL } from "./helpers";

/** Resolve the test user's ID (upserted by auth middleware on first request) */
async function getTestUserId(): Promise<string> {
  const row = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(TEST_USER_EMAIL).first<any>();
  return row.id;
}

async function insertReadings(batchId: string | null, deviceId: string, count: number, userId: string | null = null) {
  for (let i = 0; i < count; i++) {
    await env.DB.prepare(
      "INSERT INTO readings (id, batch_id, device_id, gravity, temperature, battery, rssi, source_timestamp, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(`r${i}`, batchId, deviceId, 1.090 - i * 0.001, 22.0, 95.0, -60.0,
      `2026-03-19T${String(10 + i).padStart(2, "0")}:00:00Z`,
      `2026-03-19T${String(10 + i).padStart(2, "0")}:00:05Z`, userId).run();
  }
}

beforeEach(async () => {
  await applyMigrations();
});

describe("readings", () => {
  it("lists readings by batch", async () => {
    const batchId = await createBatch();
    const userId = await getTestUserId();
    await insertReadings(batchId, "pill-1", 5, userId);
    const { status, json } = await fetchJson(`/api/v1/batches/${batchId}/readings`, { headers: API_HEADERS });
    expect(status).toBe(200);
    expect(json.items).toHaveLength(5);
    expect(json.items[0].source_timestamp > json.items[4].source_timestamp).toBe(true);
  });

  it("lists readings by device", async () => {
    // createBatch triggers auth middleware which upserts the test user
    await createBatch();
    const userId = await getTestUserId();
    await env.DB.prepare("INSERT INTO devices (id, name, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind("pill-1", "My Pill", userId, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z").run();
    await insertReadings(null, "pill-1", 3, userId);
    const { status, json } = await fetchJson("/api/v1/devices/pill-1/readings", { headers: API_HEADERS });
    expect(status).toBe(200);
    expect(json.items).toHaveLength(3);
  });

  it("paginates readings", async () => {
    const batchId = await createBatch();
    const userId = await getTestUserId();
    await insertReadings(batchId, "pill-1", 5, userId);

    const { json: page1 } = await fetchJson(`/api/v1/batches/${batchId}/readings?limit=2`, { headers: API_HEADERS });
    expect(page1.items).toHaveLength(2);
    expect(page1.next_cursor).not.toBeNull();

    const { json: page2 } = await fetchJson(`/api/v1/batches/${batchId}/readings?limit=2&cursor=${page1.next_cursor}`, { headers: API_HEADERS });
    expect(page2.items).toHaveLength(2);

    const ids1 = new Set(page1.items.map((i: any) => i.id));
    const ids2 = new Set(page2.items.map((i: any) => i.id));
    for (const id of ids2) expect(ids1.has(id)).toBe(false);
  });
});
