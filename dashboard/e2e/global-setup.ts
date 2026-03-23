import { request } from "@playwright/test";

const API_BASE = "http://localhost:8787";
const STORAGE_STATE_PATH = "e2e/.auth/session.json";

async function globalSetup() {
  const apiKey = process.env.E2E_API_KEY;
  if (!apiKey) {
    throw new Error(
      "E2E_API_KEY env var is required. Create a user and API key in the dev API, then set E2E_API_KEY=wc-..."
    );
  }

  const ctx = await request.newContext({ baseURL: API_BASE });

  const res = await ctx.post("/api/v1/auth/login/api-key", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.status() !== 200) {
    throw new Error(`API key login failed: ${res.status()} ${await res.text()}`);
  }

  await ctx.storageState({ path: STORAGE_STATE_PATH });
  await ctx.dispose();
}

export default globalSetup;
