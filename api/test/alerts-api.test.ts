import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations, fetchJson, createBatch, seedUser, seedSession, sessionHeaders } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

describe("alerts API", () => {
  it("dismiss marks alert as dismissed", async () => {
    const batchId = await createBatch();
    const { token, userId } = await seedSession();
    const headers = sessionHeaders(token);
    const alertId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO alert_state (id, user_id, batch_id, alert_type, fired_at) VALUES (?, ?, ?, 'temp_high', datetime('now'))"
    ).bind(alertId, userId, batchId).run();

    const { status } = await fetchJson(`/api/v1/alerts/${alertId}/dismiss`, {
      method: "POST", headers,
    });
    expect(status).toBe(200);

    const row = await env.DB.prepare("SELECT dismissed_at FROM alert_state WHERE id = ?").bind(alertId).first<any>();
    expect(row.dismissed_at).not.toBeNull();
  });

  it("dismiss rejects other user's alert", async () => {
    const batchId = await createBatch();
    const alertId = crypto.randomUUID();
    const otherUserId = await seedUser({ email: "other@test.com" });
    await env.DB.prepare(
      "INSERT INTO alert_state (id, user_id, batch_id, alert_type, fired_at) VALUES (?, ?, ?, 'temp_high', datetime('now'))"
    ).bind(alertId, otherUserId, batchId).run();

    const { status } = await fetchJson(`/api/v1/alerts/${alertId}/dismiss`, {
      method: "POST", headers: sessionHeaders((await seedSession()).token),
    });
    expect(status).toBe(404);
  });

  it("dashboard includes active alerts", async () => {
    const batchId = await createBatch();
    const { token, userId } = await seedSession();
    const headers = sessionHeaders(token);
    await env.DB.prepare(
      "INSERT INTO alert_state (id, user_id, batch_id, alert_type, context, fired_at) VALUES (?, ?, ?, 'stall', '{\"gravity\":1.050}', datetime('now'))"
    ).bind(crypto.randomUUID(), userId, batchId).run();

    const { json } = await fetchJson("/api/v1/dashboard", { headers });
    expect(json.alerts).toBeDefined();
    expect(json.alerts.length).toBe(1);
    expect(json.alerts[0].alert_type).toBe("stall");
  });
});
