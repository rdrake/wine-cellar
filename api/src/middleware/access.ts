import { createMiddleware } from "hono/factory";
import type { AppEnv, User } from "../app";
import { validateSession, getSessionToken } from "../lib/auth-session";
import { validateApiKey } from "../lib/api-keys";

const EXEMPT_PREFIXES = [
  "/health",
  "/webhook",
  "/api/v1/auth/status",
  "/api/v1/auth/login",
  "/api/v1/auth/github",
  "/api/v1/auth/settings",
];

function isExempt(path: string): boolean {
  return EXEMPT_PREFIXES.some(
    (prefix) =>
      path === prefix || path.startsWith(prefix + "/"),
  );
}

async function resolveUser(db: D1Database, userId: string): Promise<User | null> {
  return db.prepare(
    "SELECT id, email, name, avatar_url FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<User>();
}

export const accessAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (isExempt(c.req.path)) {
    return next();
  }

  // 1. Session cookie auth (primary — dashboard)
  const token = getSessionToken(c);
  if (token) {
    const userId = await validateSession(c.env.DB, token);
    if (userId) {
      const user = await resolveUser(c.env.DB, userId);
      if (user) {
        c.set("user", user);
        return next();
      }
    }
  }

  // 2. API key auth (secondary — MCP servers, automation)
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer wc-")) {
    const key = authHeader.slice(7); // "Bearer ".length === 7
    const userId = await validateApiKey(c.env.DB, key);
    if (userId) {
      const user = await resolveUser(c.env.DB, userId);
      if (user) {
        c.set("user", user);
        return next();
      }
    }
  }

  return c.json({ error: "Authentication required" }, 401);
});
