import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations, fetchJson, authHeaders, createBatch, API_HEADERS } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

describe("alerts API", () => {
  it("dismiss marks alert as dismissed", async () => {
    const batchId = await createBatch();
    const { json: me } = await fetchJson("/api/v1/me", { headers: API_HEADERS });
    const alertId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO alert_state (id, user_id, batch_id, alert_type, fired_at) VALUES (?, ?, ?, 'temp_high', datetime('now'))"
    ).bind(alertId, me.id, batchId).run();

    const { status } = await fetchJson(`/api/v1/alerts/${alertId}/dismiss`, {
      method: "POST", headers: API_HEADERS,
    });
    expect(status).toBe(200);

    const row = await env.DB.prepare("SELECT dismissed_at FROM alert_state WHERE id = ?").bind(alertId).first<any>();
    expect(row.dismissed_at).not.toBeNull();
  });

  it("dismiss rejects other user's alert", async () => {
    const batchId = await createBatch();
    const alertId = crypto.randomUUID();
    // Create a fake user for this alert
    await env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES ('other-user', 'other@test.com', datetime('now'))").run();
    await env.DB.prepare(
      "INSERT INTO alert_state (id, user_id, batch_id, alert_type, fired_at) VALUES (?, 'other-user', ?, 'temp_high', datetime('now'))"
    ).bind(alertId, batchId).run();

    const { status } = await fetchJson(`/api/v1/alerts/${alertId}/dismiss`, {
      method: "POST", headers: API_HEADERS,
    });
    expect(status).toBe(404);
  });

  it("dashboard includes active alerts", async () => {
    const batchId = await createBatch();
    const { json: me } = await fetchJson("/api/v1/me", { headers: API_HEADERS });
    await env.DB.prepare(
      "INSERT INTO alert_state (id, user_id, batch_id, alert_type, context, fired_at) VALUES (?, ?, ?, 'stall', '{\"gravity\":1.050}', datetime('now'))"
    ).bind(crypto.randomUUID(), me.id, batchId).run();

    const { json } = await fetchJson("/api/v1/dashboard", { headers: API_HEADERS });
    expect(json.alerts).toBeDefined();
    expect(json.alerts.length).toBe(1);
    expect(json.alerts[0].alert_type).toBe("stall");
  });
});
