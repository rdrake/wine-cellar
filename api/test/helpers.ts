import { env, SELF } from "cloudflare:test";
import { createSession, hashToken } from "../src/lib/auth-session";

export { hashToken };

export const TEST_USER_EMAIL = "test@example.com";
export const TEST_USER_B_EMAIL = "other@example.com";

export async function authHeaders(email: string = TEST_USER_EMAIL): Promise<Record<string, string>> {
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    userId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users (id, email, name, onboarded) VALUES (?, ?, ?, 1)"
    ).bind(userId, email, email.split("@")[0]).run();
  }
  const { token } = await createSession(env.DB, userId);
  return { Cookie: `session=${token}` };
}

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

let schemaApplied = false;

export async function applyMigrations() {
  // D1 persists across tests in vitest-pool-workers 0.13+.
  // Run migrations once per worker, then just clear data between tests.
  if (!schemaApplied) {
    const sql = (env as any).MIGRATION_SQL as string;
    const cleaned = sql
      .split("\n")
      .filter((line: string) => !line.trim().startsWith("--"))
      .join("\n");
    const statements = cleaned
      .split(";")
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);
    for (const stmt of statements) {
      await env.DB.prepare(stmt).run();
    }
    schemaApplied = true;
  }

  // Clear all data — FK-safe order (children before parents)
  const tables = [
    "alert_state", "push_subscriptions", "api_keys",
    "auth_sessions", "auth_challenges", "oauth_accounts", "passkey_credentials",
    "activities", "readings", "devices",
    "batches", "users", "settings",
  ];
  await env.DB.batch(tables.map((t) => env.DB.prepare(`DELETE FROM "${t}"`)));

  // Re-seed default settings row (migration 0009 inserts it, but DELETE clears it)
  await env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES ('registrations_open', 'true')",
  ).run();
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
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    userId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO users (id, email, name, onboarded) VALUES (?, ?, ?, 1)"
    ).bind(userId, email, email.split("@")[0]).run();
  }
  const { token } = await createSession(env.DB, userId);
  return { token, userId };
}

// A valid base64url-encoded webauthn user ID for testing
const TEST_WEBAUTHN_USER_ID = "dGVzdC13ZWJhdXRobi11c2VyLWlk"; // base64url of "test-webauthn-user-id"

export async function seedCredential(userId: string, opts?: { id?: string; name?: string }): Promise<void> {
  const credId = opts?.id ?? "test-credential-id";
  const name = opts?.name ?? null;
  await env.DB.prepare(
    `INSERT INTO passkey_credentials (id, user_id, public_key, webauthn_user_id, sign_count, transports, device_type, backed_up, name)
     VALUES (?, ?, X'00', ?, 0, '["internal"]', 'multiDevice', 1, ?)`,
  ).bind(credId, userId, TEST_WEBAUTHN_USER_ID, name).run();
}

export async function createBatch(overrides: Record<string, unknown> = {}, email?: string) {
  const headers = await authHeaders(email);
  const { json } = await fetchJson("/api/v1/batches", {
    method: "POST",
    headers,
    body: { ...VALID_BATCH, ...overrides },
  });
  return json.id as string;
}

/**
 * Insert a user directly into the DB (for unit tests that don't go through the API).
 * Returns the user ID.
 *
 * NOTE: email is required to avoid accidental collision with authHeaders()/seedSession()
 * which default to TEST_USER_EMAIL.
 */
export async function seedUser(
  opts: { id?: string; email: string },
): Promise<string> {
  const id = opts.id ?? crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, datetime('now'))",
  ).bind(id, opts.email, opts.email.split("@")[0]).run();
  return id;
}

/**
 * Insert a device directly into the DB.
 */
export async function seedDevice(
  id: string,
  name: string,
  opts: { userId?: string; batchId?: string; assignedAt?: string } = {},
): Promise<void> {
  const now = "2026-01-01T00:00:00Z";
  await env.DB.prepare(
    "INSERT INTO devices (id, name, user_id, batch_id, assigned_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(id, name, opts.userId ?? null, opts.batchId ?? null, opts.assignedAt ?? null, now, now).run();
}

interface SeedBatchOpts {
  id?: string;
  name?: string;
  wine_type?: string;
  source_material?: string;
  stage?: string;
  status?: string;
  started_at?: string;
}

/**
 * Insert a batch directly into the DB (for unit tests that don't need the full API flow).
 * Returns the batch ID. Only accepts fields that are actually persisted.
 */
export async function seedBatchDirect(
  userId: string,
  overrides: SeedBatchOpts = {},
): Promise<string> {
  const id = overrides.id ?? crypto.randomUUID();
  const b = {
    name: "Test Batch",
    wine_type: "red",
    source_material: "kit",
    stage: "primary_fermentation",
    status: "active",
    started_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
  await env.DB.prepare(
    `INSERT INTO batches (id, user_id, name, wine_type, source_material, stage, status, started_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  ).bind(id, userId, b.name, b.wine_type, b.source_material, b.stage, b.status, b.started_at).run();
  return id;
}
