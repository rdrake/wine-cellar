import { env, SELF } from "cloudflare:test";
import { createSession, hashToken } from "../src/lib/auth-session";

export { hashToken };

export const TEST_USER_EMAIL = "test@example.com";
export const TEST_USER_B_EMAIL = "other@example.com";

export function authHeaders(email: string = TEST_USER_EMAIL): Record<string, string> {
  return { "Cf-Access-Jwt-Assertion": `test-jwt-for:${email}` };
}

export function serviceTokenHeaders(clientId: string): Record<string, string> {
  return { "Cf-Access-Jwt-Assertion": `test-jwt-for:st:${clientId}` };
}

export async function linkServiceToken(clientId: string, userId: string) {
  await env.DB.prepare("INSERT INTO service_tokens (client_id, user_id, label) VALUES (?, ?, ?)")
    .bind(clientId, userId, "test-token")
    .run();
}

export const API_HEADERS = authHeaders(); // backward compat alias
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

export function sessionHeaders(token: string): Record<string, string> {
  return { Cookie: `session=${token}` };
}

export async function seedSession(email: string = TEST_USER_EMAIL): Promise<{ token: string; userId: string }> {
  await fetchJson("/api/v1/me", { headers: authHeaders(email) });
  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
    .bind(email).first<{ id: string }>();
  const { token } = await createSession(env.DB, user!.id);
  return { token, userId: user!.id };
}

export async function seedCredential(userId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO passkey_credentials (id, user_id, public_key, webauthn_user_id, sign_count, transports, device_type, backed_up)
     VALUES (?, ?, X'00', ?, 0, '["internal"]', 'multiDevice', 1)`,
  ).bind("test-credential-id", userId, "test-webauthn-user-id").run();
}

export async function createBatch(overrides: Record<string, unknown> = {}, email?: string) {
  const { json } = await fetchJson("/api/v1/batches", {
    method: "POST",
    headers: authHeaders(email),
    body: { ...VALID_BATCH, ...overrides },
  });
  return json.id as string;
}
