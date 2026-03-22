import { createMiddleware } from "hono/factory";
import type { AppEnv, User } from "../app";
import { validateSession, getSessionToken } from "../lib/auth-session";

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
      path === prefix ||
      path.startsWith(prefix + "/") ||
      path.startsWith(prefix + "?"),
  );
}

export const accessAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (isExempt(c.req.path)) {
    return next();
  }

  // Session cookie auth (sole auth path)
  const token = getSessionToken(c);
  if (token) {
    const userId = await validateSession(c.env.DB, token);
    if (userId) {
      const user = await c.env.DB.prepare(
        "SELECT id, email, name, avatar_url FROM users WHERE id = ?",
      )
        .bind(userId)
        .first<User>();
      if (user) {
        c.set("user", user);
        return next();
      }
    }
  }

  return c.json({ error: "Authentication required" }, 401);
});
