#!/usr/bin/env npx tsx
/**
 * Standalone seed runner — no Playwright dependency.
 * Authenticates via API key, then calls the seed orchestrator using a
 * fetch-based adapter that mimics Playwright's APIRequestContext.
 */
import { seed } from "./fixtures/seed";

const API_BASE = process.env.API_BASE ?? "http://localhost:5173";
const API_KEY =
  process.env.E2E_API_KEY ??
  "wc-e2etest0000000000000000000000000000000000000000000000000000000000";

// ── Minimal APIRequestContext adapter using fetch ─────────────────

interface PwResponse {
  status(): number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

function wrapResponse(res: Response, body: string): PwResponse {
  return {
    status: () => res.status,
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

function createFetchContext(cookie: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Cookie: cookie,
  };

  return {
    async post(url: string, opts?: { data?: unknown; headers?: Record<string, string> }) {
      const res = await fetch(url, {
        method: "POST",
        headers: { ...headers, ...opts?.headers },
        body: opts?.data !== undefined ? JSON.stringify(opts.data) : undefined,
      });
      return wrapResponse(res, await res.text());
    },
    async get(url: string) {
      const res = await fetch(url, { headers });
      return wrapResponse(res, await res.text());
    },
    async patch(url: string, opts?: { data?: unknown }) {
      const res = await fetch(url, {
        method: "PATCH",
        headers,
        body: opts?.data !== undefined ? JSON.stringify(opts.data) : undefined,
      });
      return wrapResponse(res, await res.text());
    },
  };
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  // Authenticate
  console.log("Authenticating...");
  const authRes = await fetch(`${API_BASE}/api/v1/auth/login/api-key`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!authRes.ok) {
    throw new Error(`Auth failed: ${authRes.status} ${await authRes.text()}`);
  }

  // Extract session cookie
  const setCookie = authRes.headers.getSetCookie?.() ?? [];
  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  if (!cookie) {
    throw new Error("No session cookie returned from auth endpoint");
  }

  // Create adapter and seed
  // Cast to 'any' — the adapter implements the subset of APIRequestContext that seed() uses
  const ctx = createFetchContext(cookie);
  await seed(ctx as any);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
