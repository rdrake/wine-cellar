import { createMiddleware } from "hono/factory";
import { verifyAccessJwt } from "../lib/access-jwt";
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

  // Skip auth for health and webhooks (webhooks use their own token auth)
  if (path === "/health" || path.startsWith("/webhook")) {
    return next();
  }

  // Cloudflare Access JWT (browser or service token)
  const jwt = c.req.header("Cf-Access-Jwt-Assertion");
  if (!jwt) return unauthorized("Missing access token");
  if (!c.env.CF_ACCESS_AUD) return unauthorized("Access auth not configured");

  const result = await verifyAccessJwt(jwt, c.env.CF_ACCESS_AUD, c.env.CF_ACCESS_TEAM);
  if (!result) return unauthorized("Invalid access token");

  const db = c.env.DB;

  if (result.kind === "user") {
    // Browser JWT — upsert user by email
    const user = await db
      .prepare(
        `INSERT INTO users (id, email, created_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(email) DO UPDATE SET email = email
         RETURNING *`,
      )
      .bind(crypto.randomUUID(), result.email)
      .first<User>();

    if (!user) return unauthorized("User creation failed");
    c.set("user", user);
    return next();
  }

  // Service token JWT — look up mapped user
  const mapping = await db
    .prepare("SELECT user_id FROM service_tokens WHERE client_id = ?")
    .bind(result.clientId)
    .first<{ user_id: string }>();

  if (!mapping) return unauthorized("Service token not linked to a user");

  const user = await db
    .prepare("SELECT * FROM users WHERE id = ?")
    .bind(mapping.user_id)
    .first<User>();

  if (!user) return unauthorized("Mapped user not found");
  c.set("user", user);
  return next();
});
