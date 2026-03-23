import { request } from "@playwright/test";
import { seed } from "./fixtures/seed";

const API_BASE = "http://localhost:5173";
const STORAGE_STATE_PATH = "e2e/.auth/session.json";

async function globalSetup() {
  const apiKey = process.env.E2E_API_KEY;
  if (!apiKey) {
    throw new Error(
      "E2E_API_KEY env var is required. Create a user and API key in the dev API, then set E2E_API_KEY=wc-..."
    );
  }

  const ctx = await request.newContext({ baseURL: API_BASE });

  // Authenticate
  const res = await ctx.post("/api/v1/auth/login/api-key", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.status() !== 200) {
    throw new Error(`API key login failed: ${res.status()} ${await res.text()}`);
  }

  // Save auth state
  await ctx.storageState({ path: STORAGE_STATE_PATH });

  // Seed test data (idempotent — skips if already seeded)
  await seed(ctx);

  await ctx.dispose();
}

export default globalSetup;
