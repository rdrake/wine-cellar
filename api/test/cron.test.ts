import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations, seedUser, seedBatchDirect, seedDevice } from "./helpers";
import { evaluateAllBatches } from "../src/cron";

beforeEach(async () => {
  await applyMigrations();
});

describe("cron evaluateAllBatches", () => {
  it("creates no_readings alert for batch with stale device", async () => {
    const userId = await seedUser({ email: "cron@test.com" });
    const batchId = await seedBatchDirect(userId);
    await seedDevice("cron-pill", "Pill", { userId, batchId, assignedAt: new Date().toISOString() });

    const oldDate = new Date(Date.now() - 72 * 3600000).toISOString();
    await env.DB.prepare(
      "INSERT INTO readings (id, batch_id, device_id, gravity, temperature, source_timestamp, source, created_at, user_id) VALUES (?, ?, 'cron-pill', 1.050, 22, ?, 'device', ?, ?)"
    ).bind(crypto.randomUUID(), batchId, oldDate, oldDate, userId).run();

    await evaluateAllBatches(env.DB, "", "");

    const alert = await env.DB.prepare(
      "SELECT * FROM alert_state WHERE batch_id = ? AND alert_type = 'no_readings'"
    ).bind(batchId).first<any>();
    expect(alert).not.toBeNull();
  });

  it("skips inactive batches", async () => {
    const userId = await seedUser({ email: "cron2@test.com" });
    const batchId = await seedBatchDirect(userId, { stage: "bottling", status: "completed" });

    await evaluateAllBatches(env.DB, "", "");

    const alerts = await env.DB.prepare("SELECT * FROM alert_state WHERE batch_id = ?").bind(batchId).all();
    expect(alerts.results.length).toBe(0);
  });
});
