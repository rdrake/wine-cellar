import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations } from "./helpers";
import { processAlerts, resolveCleared, getActiveAlerts } from "../src/lib/alert-manager";

const USER_ID = "test-user-id";
const BATCH_ID = "test-batch-id";

beforeEach(async () => {
  await applyMigrations();
  await env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, datetime('now'))")
    .bind(USER_ID, "test@example.com").run();
  await env.DB.prepare(
    `INSERT INTO batches (id, user_id, name, wine_type, source_material, stage, status, started_at, created_at, updated_at)
     VALUES (?, ?, 'Test Batch', 'red', 'kit', 'primary_fermentation', 'active', datetime('now'), datetime('now'), datetime('now'))`
  ).bind(BATCH_ID, USER_ID).run();
});

describe("alert-manager", () => {
  it("inserts new alert and returns it", async () => {
    const fired = await processAlerts(env.DB, USER_ID, BATCH_ID, [
      { type: "temp_high", message: "30.5°C — high", context: { temperature: 30.5 } },
    ]);
    expect(fired.length).toBe(1);
    expect(fired[0].alert_type).toBe("temp_high");
  });

  it("deduplicates — second call returns nothing", async () => {
    const candidate = { type: "temp_high" as const, message: "30.5°C", context: { temperature: 30.5 } };
    await processAlerts(env.DB, USER_ID, BATCH_ID, [candidate]);
    const second = await processAlerts(env.DB, USER_ID, BATCH_ID, [candidate]);
    expect(second.length).toBe(0);
  });

  it("resolveCleared marks missing alerts as resolved", async () => {
    await processAlerts(env.DB, USER_ID, BATCH_ID, [
      { type: "temp_high", message: "hot", context: {} },
    ]);
    await resolveCleared(env.DB, USER_ID, BATCH_ID, []);
    const active = await getActiveAlerts(env.DB, USER_ID);
    expect(active.length).toBe(0);
  });

  it("re-fires after resolved", async () => {
    const candidate = { type: "temp_high" as const, message: "hot", context: {} };
    await processAlerts(env.DB, USER_ID, BATCH_ID, [candidate]);
    await resolveCleared(env.DB, USER_ID, BATCH_ID, []);
    const refired = await processAlerts(env.DB, USER_ID, BATCH_ID, [candidate]);
    expect(refired.length).toBe(1);
  });

  it("dismissed alert does not re-fire until resolved", async () => {
    const candidate = { type: "stall" as const, message: "stuck", context: {} };
    const [alert] = await processAlerts(env.DB, USER_ID, BATCH_ID, [candidate]);
    await env.DB.prepare("UPDATE alert_state SET dismissed_at = datetime('now') WHERE id = ?").bind(alert.id).run();
    const refired = await processAlerts(env.DB, USER_ID, BATCH_ID, [candidate]);
    expect(refired.length).toBe(0);
  });

  it("getActiveAlerts returns only unresolved undismissed", async () => {
    await processAlerts(env.DB, USER_ID, BATCH_ID, [
      { type: "temp_high", message: "hot", context: {} },
      { type: "stall", message: "stuck", context: {} },
    ]);
    const all = await getActiveAlerts(env.DB, USER_ID);
    expect(all.length).toBe(2);
    await env.DB.prepare("UPDATE alert_state SET dismissed_at = datetime('now') WHERE alert_type = 'stall'").run();
    const active = await getActiveAlerts(env.DB, USER_ID);
    expect(active.length).toBe(1);
    expect(active[0].alert_type).toBe("temp_high");
  });
});
