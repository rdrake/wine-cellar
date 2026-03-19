import { env, SELF } from "cloudflare:test";

export const API_HEADERS = { "X-API-Key": "test-api-key" };
export const WEBHOOK_HEADERS = { "X-Webhook-Token": "test-webhook-token" };

export const VALID_BATCH = {
  name: "2026 Merlot",
  wine_type: "red",
  source_material: "fresh_grapes",
  started_at: "2026-03-19T10:00:00Z",
  volume_liters: 23.0,
  target_volume_liters: 20.0,
  notes: "First attempt",
};

export async function applyMigrations() {
  const sql = (env as any).MIGRATION_SQL as string;
  // Strip comment-only lines, split on semicolons, run each statement
  const cleaned = sql
    .split("\n")
    .filter((line: string) => {
      const trimmed = line.trim();
      return !trimmed.startsWith("--");
    })
    .join("\n");
  const statements = cleaned
    .split(";")
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);
  for (const stmt of statements) {
    await env.DB.prepare(stmt).run();
  }
}

export async function fetchJson(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
) {
  const { method = "GET", headers = {}, body } = options;
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await SELF.fetch(`http://localhost${path}`, init);
  const status = res.status;
  let json: unknown = null;
  if (status !== 204) {
    try {
      json = await res.json();
    } catch {
      // No JSON body
    }
  }
  return { status, json: json as any };
}

export async function createBatch(overrides: Record<string, unknown> = {}) {
  const { json } = await fetchJson("/api/v1/batches", {
    method: "POST",
    headers: API_HEADERS,
    body: { ...VALID_BATCH, ...overrides },
  });
  return json.id as string;
}
