import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations } from "./helpers";
import { evaluateAllBatches } from "../src/cron";

beforeEach(async () => {
  await applyMigrations();
});

describe("cron evaluateAllBatches", () => {
  it("creates no_readings alert for batch with stale device", async () => {
    const userId = "cron-user";
    const batchId = "cron-batch";
    await env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, 'cron@test.com', datetime('now'))").bind(userId).run();
    await env.DB.prepare(
      `INSERT INTO batches (id, user_id, name, wine_type, source_material, stage, status, started_at, created_at, updated_at)
       VALUES (?, ?, 'Cron Batch', 'red', 'kit', 'primary_fermentation', 'active', datetime('now'), datetime('now'), datetime('now'))`
    ).bind(batchId, userId).run();
    await env.DB.prepare(
      "INSERT INTO devices (id, name, user_id, batch_id, assigned_at, created_at, updated_at) VALUES ('cron-pill', 'Pill', ?, ?, datetime('now'), datetime('now'), datetime('now'))"
    ).bind(userId, batchId).run();

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
    const userId = "cron-user-2";
    const batchId = "cron-batch-2";
    await env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, 'cron2@test.com', datetime('now'))").bind(userId).run();
    await env.DB.prepare(
      `INSERT INTO batches (id, user_id, name, wine_type, source_material, stage, status, started_at, created_at, updated_at)
       VALUES (?, ?, 'Completed', 'red', 'kit', 'bottling', 'completed', datetime('now'), datetime('now'), datetime('now'))`
    ).bind(batchId, userId).run();

    await evaluateAllBatches(env.DB, "", "");

    const alerts = await env.DB.prepare("SELECT * FROM alert_state WHERE batch_id = ?").bind(batchId).all();
    expect(alerts.results.length).toBe(0);
  });
});
