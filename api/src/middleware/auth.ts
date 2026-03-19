import { createMiddleware } from "hono/factory";
import type { Bindings } from "../app";
import { unauthorized } from "../lib/errors";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i] ^ bufB[i];
  }
  return result === 0;
}

export const apiKeyAuth = createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
  const path = new URL(c.req.url).pathname;

  // Skip auth for health, docs, and webhook paths
  if (
    path === "/health" ||
    path === "/api/v1/docs" ||
    path === "/api/v1/openapi.json" ||
    path.startsWith("/webhook")
  ) {
    return next();
  }

  if (path.startsWith("/api/v1/")) {
    const apiKey = c.req.header("X-API-Key");
    const expected = c.env.API_KEY;
    if (!apiKey || !expected || !timingSafeEqual(apiKey, expected)) {
      return unauthorized("Invalid or missing API key");
    }
  }

  return next();
});
