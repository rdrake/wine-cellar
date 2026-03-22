import { hashToken } from "./auth-session";

const API_KEY_PREFIX = "wc-";

function generateApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return API_KEY_PREFIX + hex;
}

export interface ApiKeyCreated {
  id: string;
  name: string;
  prefix: string;
  key: string;
  createdAt: string;
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export async function createApiKey(
  db: D1Database,
  userId: string,
  name: string,
): Promise<ApiKeyCreated> {
  const key = generateApiKey();
  const id = await hashToken(key);
  const prefix = key.slice(0, 8);

  await db
    .prepare(
      "INSERT INTO api_keys (id, user_id, name, prefix) VALUES (?, ?, ?, ?)",
    )
    .bind(id, userId, name, prefix)
    .run();

  const row = await db
    .prepare("SELECT created_at FROM api_keys WHERE id = ?")
    .bind(id)
    .first<{ created_at: string }>();

  return { id, name, prefix, key, createdAt: row!.created_at };
}

export async function listApiKeys(
  db: D1Database,
  userId: string,
): Promise<ApiKeyInfo[]> {
  const { results } = await db
    .prepare(
      "SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC",
    )
    .bind(userId)
    .all<{
      id: string;
      name: string;
      prefix: string;
      created_at: string;
      last_used_at: string | null;
    }>();

  return results.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));
}

export async function deleteApiKey(
  db: D1Database,
  id: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM api_keys WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function validateApiKey(
  db: D1Database,
  key: string,
): Promise<string | null> {
  if (!key.startsWith(API_KEY_PREFIX)) return null;

  const id = await hashToken(key);
  const row = await db
    .prepare("SELECT user_id, last_used_at FROM api_keys WHERE id = ?")
    .bind(id)
    .first<{ user_id: string; last_used_at: string | null }>();

  if (!row) return null;

  // Debounce last_used_at: only update if null or older than 1 hour
  if (!row.last_used_at) {
    await db
      .prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?")
      .bind(id)
      .run();
  } else {
    await db
      .prepare(
        "UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ? AND last_used_at < datetime('now', '-1 hour')",
      )
      .bind(id)
      .run();
  }

  return row.user_id;
}
