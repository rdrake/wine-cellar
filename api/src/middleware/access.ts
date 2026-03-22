import { createMiddleware } from "hono/factory";
import { verifyAccessJwt } from "../lib/access-jwt";
import { validateSession, getSessionToken } from "../lib/auth-session";
import { unauthorized } from "../lib/errors";

type User = { id: string; email: string; name: string | null };

type AccessBindings = {
  DB: D1Database;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_TEAM: string;
  WEBHOOK_TOKEN: string;
};

export const accessAuth = createMiddleware<{
  Bindings: AccessBindings;
  Variables: { user: User };
}>(async (c, next) => {
  const path = new URL(c.req.url).pathname;

  // Exempt routes — no auth required
  if (
    path === "/health" ||
    path.startsWith("/webhook") ||
    path === "/api/v1/auth/status" ||
    path.startsWith("/api/v1/auth/login") ||
    path.startsWith("/api/v1/auth/bootstrap")
  ) {
    return next();
  }

  const db = c.env.DB;

  // 1. Session cookie (primary path)
  const sessionToken = getSessionToken(c);
  if (sessionToken) {
    const userId = await validateSession(db, sessionToken);
    if (userId) {
      const user = await db
        .prepare("SELECT id, email, name FROM users WHERE id = ?")
        .bind(userId)
        .first<User>();
      if (user) {
        c.set("user", user);
        return next();
      }
    }
  }

  // 2. CF Access JWT (recovery fallback — only when CF_ACCESS_AUD is set)
  const jwt = c.req.header("Cf-Access-Jwt-Assertion");
  if (jwt && c.env.CF_ACCESS_AUD) {
    const result = await verifyAccessJwt(jwt, c.env.CF_ACCESS_AUD, c.env.CF_ACCESS_TEAM);
    if (result) {
      if (result.kind === "user") {
        const user = await db
          .prepare(
            `INSERT INTO users (id, email, created_at)
             VALUES (?, ?, datetime('now'))
             ON CONFLICT(email) DO UPDATE SET email = email
             RETURNING *`,
          )
          .bind(crypto.randomUUID(), result.email)
          .first<User>();
        if (user) {
          c.set("user", user);
          return next();
        }
      } else {
        // Service token JWT
        const mapping = await db
          .prepare("SELECT user_id FROM service_tokens WHERE client_id = ?")
          .bind(result.clientId)
          .first<{ user_id: string }>();
        if (mapping) {
          const user = await db
            .prepare("SELECT id, email, name FROM users WHERE id = ?")
            .bind(mapping.user_id)
            .first<User>();
          if (user) {
            c.set("user", user);
            return next();
          }
        }
      }
    }
  }

  return unauthorized("Authentication required");
});
