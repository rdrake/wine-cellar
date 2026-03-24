# API Key Login & Playwright E2E Setup

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `POST /api/v1/auth/login/api-key` endpoint that exchanges a valid API key for a session cookie, then set up Playwright for end-to-end testing using that endpoint to authenticate.

**Architecture:** The new endpoint validates the bearer API key (reusing `validateApiKey`), creates a session (reusing `createSession`), and sets the session cookie — same flow as passkey/GitHub login, just with a different credential type. Playwright tests run against the dashboard dev server (Vite, port 5173) proxying to the API dev server (wrangler, port 8787). A `globalSetup` script seeds a test user + API key, calls the login endpoint, and saves the cookie to a `storageState` file that all tests reuse.

**Tech Stack:** Hono (API route), Playwright (E2E), Vite + Wrangler (dev servers)

---

### Task 1: Add API key login endpoint — failing test

**Files:**
- Test: `api/test/auth.test.ts`

**Step 1: Write the failing test**

Add a new `describe` block at the end of `auth.test.ts`:

```typescript
describe("API key login", () => {
  it("exchanges valid API key for session cookie", async () => {
    const { userId } = await seedSession();
    const { createApiKey } = await import("../src/lib/api-keys");
    const { key } = await createApiKey(env.DB, userId, "E2E");

    const res = await SELF.fetch("https://localhost/api/v1/auth/login/api-key", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { status: string };
    expect(json.status).toBe("ok");

    // Should set a session cookie
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie).toMatch(/session=/);

    // Cookie should work for authenticated requests
    const cookie = setCookie!.split(";")[0];
    const { status, json: batchJson } = await fetchJson("/api/v1/batches", {
      headers: { Cookie: cookie },
    });
    expect(status).toBe(200);
    expect(batchJson.items).toBeDefined();
  });

  it("returns 401 for invalid API key", async () => {
    const res = await SELF.fetch("https://localhost/api/v1/auth/login/api-key", {
      method: "POST",
      headers: { Authorization: "Bearer wc-0000000000000000000000000000000000000000000000000000000000000000" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 without Authorization header", async () => {
    const res = await SELF.fetch("https://localhost/api/v1/auth/login/api-key", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run test/auth.test.ts`
Expected: FAIL — 404 on `/api/v1/auth/login/api-key` (route doesn't exist yet)

---

### Task 2: Implement API key login endpoint

**Files:**
- Modify: `api/src/routes/auth.ts` (add route before the logout handler, ~line 550)
- Modify: `api/src/middleware/access.ts` (add exempt prefix)

**Step 1: Add the exempt prefix in access.ts**

Add `"/api/v1/auth/login"` already covers `/api/v1/auth/login/api-key` since `isExempt` checks `path.startsWith(prefix + "/")`. Verify this is the case — the existing entry on line 10 (`/api/v1/auth/login`) covers it. **No change needed in access.ts.**

**Step 2: Add the login route in auth.ts**

Add after the passkey login handler (after line 345), before the register handlers:

```typescript
// POST /login/api-key — exchange a valid API key for a session cookie
auth.post("/login/api-key", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer wc-")) {
    return unauthorized("Missing or invalid Authorization header");
  }
  const key = authHeader.slice(7);
  const userId = await validateApiKey(c.env.DB, key);
  if (!userId) {
    return unauthorized("Invalid API key");
  }

  const secure = c.env.RP_ORIGIN.startsWith("https://");
  const { token } = await createSession(c.env.DB, userId);
  setSessionCookie(c, token, secure);

  return c.json({ status: "ok" });
});
```

Add the import for `validateApiKey` at the top of `auth.ts`:

```typescript
import { createApiKey, listApiKeys, deleteApiKey, validateApiKey } from "../lib/api-keys";
```

**Step 3: Run test to verify it passes**

Run: `cd api && npx vitest run test/auth.test.ts`
Expected: All tests PASS

**Step 4: Run full API test suite**

Run: `cd api && npm run test`
Expected: All 320+ tests PASS

**Step 5: Commit**

```bash
git add api/src/routes/auth.ts api/test/auth.test.ts
git commit -m "feat: add POST /auth/login/api-key endpoint for session exchange"
```

---

### Task 3: Install Playwright in dashboard

**Files:**
- Modify: `dashboard/package.json`
- Create: `dashboard/playwright.config.ts`

**Step 1: Install Playwright**

```bash
cd dashboard && npm install -D @playwright/test
```

**Step 2: Install browsers**

```bash
cd dashboard && npx playwright install chromium
```

**Step 3: Create playwright.config.ts**

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "cd ../api && npm run dev",
      port: 8787,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "npm run dev",
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
  ],
});
```

**Step 4: Add npm scripts to package.json**

Add to `dashboard/package.json` scripts:

```json
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui"
```

**Step 5: Commit**

```bash
git add dashboard/package.json dashboard/package-lock.json dashboard/playwright.config.ts
git commit -m "chore: install Playwright and add config"
```

---

### Task 4: Create global setup for authenticated Playwright tests

**Files:**
- Create: `dashboard/e2e/global-setup.ts`
- Modify: `dashboard/playwright.config.ts` (add globalSetup + storageState)

**Step 1: Create global-setup.ts**

This script runs once before all tests: creates a user + API key via the API, logs in via the new endpoint, and saves the session cookie.

```typescript
import { request, type FullConfig } from "@playwright/test";

const API_BASE = "http://localhost:8787";
const STORAGE_STATE_PATH = "e2e/.auth/session.json";

async function globalSetup(config: FullConfig) {
  // 1. Seed a test user and get an API key via the webhook + direct API flow
  //    Use the API's own test helpers approach: create user via first available auth
  //    For local dev, we need a user + API key. We'll create them via the API.

  const ctx = await request.newContext({ baseURL: API_BASE });

  // Create a test user via GitHub OAuth mock or direct DB seeding isn't possible
  // from Playwright. Instead, rely on a pre-seeded API key passed via env var.
  const apiKey = process.env.E2E_API_KEY;
  if (!apiKey) {
    throw new Error(
      "E2E_API_KEY env var is required. Create a user and API key in the dev API, then set E2E_API_KEY=wc-..."
    );
  }

  // 2. Exchange the API key for a session cookie
  const res = await ctx.post("/api/v1/auth/login/api-key", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.status() !== 200) {
    throw new Error(`API key login failed: ${res.status()} ${await res.text()}`);
  }

  // 3. Save the authenticated state (cookies)
  await ctx.storageState({ path: STORAGE_STATE_PATH });
  await ctx.dispose();
}

export default globalSetup;
```

**Step 2: Update playwright.config.ts**

Add `globalSetup` and `storageState`:

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
    storageState: "e2e/.auth/session.json",
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "cd ../api && npm run dev",
      port: 8787,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "npm run dev",
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
  ],
});
```

**Step 3: Add .auth to .gitignore**

Append to `dashboard/.gitignore`:

```
e2e/.auth/
```

**Step 4: Commit**

```bash
git add dashboard/e2e/global-setup.ts dashboard/playwright.config.ts dashboard/.gitignore
git commit -m "feat: Playwright global setup with API key session auth"
```

---

### Task 5: Write first E2E smoke test — dashboard loads

**Files:**
- Create: `dashboard/e2e/dashboard.spec.ts`

**Step 1: Write the smoke test**

```typescript
import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("loads and shows batch list", async ({ page }) => {
    await page.goto("/");
    // Should see the dashboard, not the login page
    await expect(page.locator("text=batches")).toBeVisible({ timeout: 10_000 });
  });

  test("navigates to new batch form", async ({ page }) => {
    await page.goto("/");
    await page.click('a[href="/batches/new"]');
    await expect(page).toHaveURL(/\/batches\/new/);
    await expect(page.locator("text=New Batch")).toBeVisible();
  });
});
```

**Step 2: Run the E2E test**

Run: `cd dashboard && E2E_API_KEY=<your-key> npx playwright test`
Expected: PASS (dashboard loads with authenticated session, no login page shown)

**Step 3: Commit**

```bash
git add dashboard/e2e/dashboard.spec.ts
git commit -m "test: add first Playwright E2E smoke tests for dashboard"
```

---

### Task 6: Write E2E test — create and view a batch

**Files:**
- Create: `dashboard/e2e/batch-lifecycle.spec.ts`

**Step 1: Write the batch lifecycle test**

```typescript
import { test, expect } from "@playwright/test";

test.describe("Batch lifecycle", () => {
  const batchName = `E2E Test ${Date.now()}`;

  test("creates a new batch and views it", async ({ page }) => {
    // Navigate to new batch form
    await page.goto("/batches/new");
    await expect(page.locator("text=New Batch")).toBeVisible();

    // Fill in the form
    await page.fill('input[name="name"]', batchName);
    await page.click("text=Create Batch");

    // Should navigate to the batch detail page
    await expect(page.locator(`text=${batchName}`)).toBeVisible({ timeout: 10_000 });
  });

  test("batch appears on dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(`text=${batchName}`)).toBeVisible({ timeout: 10_000 });
  });
});
```

**Step 2: Run the test**

Run: `cd dashboard && E2E_API_KEY=<your-key> npx playwright test e2e/batch-lifecycle.spec.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add dashboard/e2e/batch-lifecycle.spec.ts
git commit -m "test: add E2E test for batch creation lifecycle"
```
