import { createMiddleware } from "hono/factory";
import { verifyAccessJwt } from "../lib/access-jwt";
import { timingSafeEqual } from "../lib/crypto";
import { unauthorized } from "../lib/errors";

type User = { id: string; email: string; name: string | null };

type AccessBindings = {
  DB: D1Database;
  CF_ACCESS_AUD: string;
  CF_ACCESS_TEAM: string;
  WEBHOOK_TOKEN: string;
  API_KEY?: string; // Legacy — kept during rollout, removed after
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

  // --- Path 1: Cloudflare Access JWT (preferred) ---
  const jwt = c.req.header("Cf-Access-Jwt-Assertion");
  if (jwt) {
    const payload = await verifyAccessJwt(jwt, c.env.CF_ACCESS_AUD, c.env.CF_ACCESS_TEAM);
    if (!payload) return unauthorized("Invalid access token");

    // Upsert user
    const db = c.env.DB;
    const user = await db
      .prepare(
        `INSERT INTO users (id, email, created_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(email) DO UPDATE SET email = email
         RETURNING *`,
      )
      .bind(crypto.randomUUID(), payload.email)
      .first<User>();

    if (!user) return unauthorized("User creation failed");
    c.set("user", user);
    return next();
  }

  // --- Path 2: Legacy API key (transitional, removed after rollout) ---
  const apiKey = c.req.header("X-API-Key");
  const expectedKey = c.env.API_KEY;
  if (apiKey && expectedKey && timingSafeEqual(apiKey, expectedKey)) {
    return next();
  }

  return unauthorized("Missing access token");
});
