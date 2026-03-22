import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations, fetchJson, authHeaders, createBatch } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

describe("alerts API", () => {
  it("dismiss marks alert as dismissed", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = 'test@example.com'").first<{ id: string }>();
    const alertId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO alert_state (id, user_id, batch_id, alert_type, fired_at) VALUES (?, ?, ?, 'temp_high', datetime('now'))"
    ).bind(alertId, user!.id, batchId).run();

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
    // Create a fake user for this alert
    await env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES ('other-user', 'other@test.com', datetime('now'))").run();
    await env.DB.prepare(
      "INSERT INTO alert_state (id, user_id, batch_id, alert_type, fired_at) VALUES (?, 'other-user', ?, 'temp_high', datetime('now'))"
    ).bind(alertId, batchId).run();

    const { status } = await fetchJson(`/api/v1/alerts/${alertId}/dismiss`, {
      method: "POST", headers: await authHeaders(),
    });
    expect(status).toBe(404);
  });

  it("dashboard includes active alerts", async () => {
    const batchId = await createBatch();
    const headers = await authHeaders();
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = 'test@example.com'").first<{ id: string }>();
    await env.DB.prepare(
      "INSERT INTO alert_state (id, user_id, batch_id, alert_type, context, fired_at) VALUES (?, ?, ?, 'stall', '{\"gravity\":1.050}', datetime('now'))"
    ).bind(crypto.randomUUID(), user!.id, batchId).run();

    const { json } = await fetchJson("/api/v1/dashboard", { headers });
    expect(json.alerts).toBeDefined();
    expect(json.alerts.length).toBe(1);
    expect(json.alerts[0].alert_type).toBe("stall");
  });
});
