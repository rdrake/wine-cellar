# Wine cellar testing guide

Internal documentation covering the test infrastructure, patterns, and conventions used across the wine-cellar project.

---

## Table of contents

1. [Overview](#overview)
2. [API test infrastructure](#api-test-infrastructure)
3. [API test helpers](#api-test-helpers)
4. [API test patterns](#api-test-patterns)
5. [Dashboard test infrastructure](#dashboard-test-infrastructure)
6. [How to write new tests](#how-to-write-new-tests)
7. [Running tests](#running-tests)

---

## Overview

The project has two testable workspaces:

| Workspace   | Framework | Environment | Config |
|-------------|-----------|-------------|--------|
| `api/`      | Vitest + `@cloudflare/vitest-pool-workers` | Miniflare (Workers runtime) | `api/vitest.config.ts` |
| `dashboard/`| Vitest + jsdom + Testing Library | jsdom | `dashboard/vitest.config.ts` |

API tests run inside a real Workers runtime through Miniflare, meaning D1 SQL, bindings, and `fetch` all behave identically to production. Dashboard tests run in a jsdom browser environment with React Testing Library.

---

## API test infrastructure

### How `@cloudflare/vitest-pool-workers` works

The API uses Cloudflare's official Vitest integration, which runs each test inside a Miniflare Workers environment. This means tests run in the same V8 isolate runtime as production, with real D1 database access, real `fetch` handling through the Worker, and access to all configured bindings.

The config lives in `api/vitest.config.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

const migrationSql = readdirSync("./migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(`./migrations/${f}`, "utf-8"))
  .join("\n");

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          d1Databases: { DB: "wine-cellar-test" },
          bindings: {
            CF_ACCESS_AUD: "test-aud",
            CF_ACCESS_TEAM: "test",
            WEBHOOK_TOKEN: "test-webhook-token",
            VAPID_PUBLIC_KEY: "test-vapid-public-key",
            VAPID_PRIVATE_KEY: "test-vapid-private-key",
            MIGRATION_SQL: migrationSql,
          },
        },
      },
    },
  },
});
```

Key points:

- **`defineWorkersConfig`** wraps the standard Vitest config to set up the Miniflare pool.
- **`wrangler.configPath`** tells Miniflare to read the Worker's `wrangler.toml` for route definitions and module resolution.
- **`d1Databases`** creates an in-memory D1 database bound to `DB`. Each test gets a fresh, isolated database (see migrations below).
- **`bindings`** injects environment variables into the Worker runtime. `CF_ACCESS_TEAM` is set to `"test"`, which activates test-mode JWT verification (see [fake auth](#authheadersemail--how-fake-auth-works-in-tests)).

### How Vitest loads and applies migrations

Migrations follow a two-phase approach:

1. **Config time (Node.js)**: The config reads all `.sql` files from `api/migrations/` from disk, sorts them alphabetically, concatenates them, and injects the result as the `MIGRATION_SQL` string binding. This happens once when Vitest starts.

2. **Per-test (Workers runtime)**: Each test file calls `applyMigrations()` in its `beforeEach` hook. This function runs inside the Workers runtime, reads the `MIGRATION_SQL` binding, strips SQL comments, splits on `;`, and executes each statement against the D1 database.

Because D1 in Miniflare is reset between tests, `applyMigrations()` effectively creates a clean schema for every test case. The migration files create all tables from scratch by using `CREATE TABLE IF NOT EXISTS` and `DROP TABLE IF EXISTS` patterns.

### The `SELF` and `env` Imports

Tests import two key objects from `cloudflare:test`:

```ts
import { env, SELF } from "cloudflare:test";
```

- **`SELF`**: A service binding that points to the Worker under test. Calling `SELF.fetch(url, init)` sends an HTTP request through the Worker's `fetch` handler, exactly as the Worker would process a real request. This is how all API endpoint tests work.

- **`env`**: The Worker's environment bindings. Provides direct access to `env.DB` (D1 database), `env.WEBHOOK_TOKEN`, and so on. Tests use `env.DB` for setup (inserting test data directly) and for verification (querying rows after an API call).

### Test bindings

| Binding | Value | Purpose |
|---------|-------|---------|
| `DB` | In-memory D1 (`"wine-cellar-test"`) | The application database |
| `CF_ACCESS_AUD` | `"test-aud"` | Cloudflare Access audience tag for JWT verification |
| `CF_ACCESS_TEAM` | `"test"` | Set to `"test"` to enable fake JWT mode |
| `WEBHOOK_TOKEN` | `"test-webhook-token"` | Shared secret for webhook authentication |
| `VAPID_PUBLIC_KEY` | `"test-vapid-public-key"` | Web Push VAPID public key |
| `VAPID_PRIVATE_KEY` | `"test-vapid-private-key"` | Web Push VAPID private key |
| `MIGRATION_SQL` | Concatenated SQL from `migrations/` | Schema DDL for `applyMigrations()` |

---

## API test helpers

All helpers live in `api/test/helpers.ts`. Every test file imports from this module.

### `authHeaders(email)` -- How fake auth works in tests

```ts
export function authHeaders(email: string = TEST_USER_EMAIL): Record<string, string> {
  return { "Cf-Access-Jwt-Assertion": `test-jwt-for:${email}` };
}
```

When `CF_ACCESS_TEAM` is `"test"`, the JWT verification function (`verifyAccessJwt`) enters test mode. Instead of cryptographically verifying a real JWT, it parses the `test-jwt-for:` prefix:

- `test-jwt-for:alice@example.com` resolves to `{ kind: "user", email: "alice@example.com" }`
- `test-jwt-for:st:my-client-id` resolves to `{ kind: "service-token", clientId: "my-client-id" }`

This means any test can authenticate as any user by passing `authHeaders("whoever@example.com")`. The helpers module predefines two default emails:

```ts
export const TEST_USER_EMAIL = "test@example.com";
export const TEST_USER_B_EMAIL = "other@example.com";
```

The `API_HEADERS` constant is a convenience alias for `authHeaders()` (default user).

### `serviceTokenHeaders(clientId)` and `linkServiceToken()`

For testing service token authentication (machine-to-machine API access):

```ts
export function serviceTokenHeaders(clientId: string): Record<string, string> {
  return { "Cf-Access-Jwt-Assertion": `test-jwt-for:st:${clientId}` };
}

export async function linkServiceToken(clientId: string, userId: string) {
  await env.DB.prepare(
    "INSERT INTO service_tokens (client_id, user_id, label) VALUES (?, ?, ?)"
  ).bind(clientId, userId, "test-token").run();
}
```

You must link a service token to a user before it can authenticate. The typical pattern is:

1. Create a user via `authHeaders()` (triggers user upsert in auth middleware)
2. Get the user's ID via `/api/v1/me`
3. Call `linkServiceToken("my-tool", userId)` to insert the mapping
4. Use `serviceTokenHeaders("my-tool")` for later requests

An unlinked service token returns a 401 with `"not linked"` in the message.

### `fetchJson(path, options)` -- The test HTTP client

```ts
export async function fetchJson(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
) {
  const { method = "GET", headers = {}, body } = options;
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await SELF.fetch(`http://localhost${path}`, init);
  const status = res.status;
  let json: unknown = null;
  if (status !== 204) {
    try {
      json = await res.json();
    } catch {
      // No JSON body
    }
  }
  return { status, json: json as any };
}
```

Key behaviors:
- Sends requests through `SELF.fetch`, which routes through the actual Worker.
- Automatically sets `Content-Type: application/json` and stringifies `body` when provided.
- Returns `{ status, json }` -- automatically parses JSON from the response (except for 204 No Content).
- The Workers runtime requires the base URL `http://localhost` but ignores the hostname.

### `createBatch(overrides, email)` -- Factory helper

```ts
export async function createBatch(overrides: Record<string, unknown> = {}, email?: string) {
  const { json } = await fetchJson("/api/v1/batches", {
    method: "POST",
    headers: authHeaders(email),
    body: { ...VALID_BATCH, ...overrides },
  });
  return json.id as string;
}
```

Creates a batch through the API and returns its ID. Uses `VALID_BATCH` as defaults, with optional overrides and a custom email for multitenant tests. This also triggers user creation through the auth middleware, so calling `createBatch()` ensures the default test user exists.

### Constants

```ts
export const VALID_BATCH = {
  name: "2026 Merlot",
  wine_type: "red",
  source_material: "fresh_grapes",
  started_at: "2026-03-19T10:00:00Z",
  volume_liters: 23.0,
  target_volume_liters: 20.0,
  notes: "First attempt",
};

export const WEBHOOK_HEADERS = { "X-Webhook-Token": "test-webhook-token" };
```

- `VALID_BATCH`: A complete, valid batch payload. Tests spread overrides onto it: `{ ...VALID_BATCH, wine_type: "white" }`.
- `WEBHOOK_HEADERS`: The authentication header for webhook endpoints, matching the `WEBHOOK_TOKEN` binding.

---

## API test patterns

### Test file structure

Every API test file follows the same structure:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { applyMigrations, fetchJson, /* other helpers */ } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

describe("feature name", () => {
  it("does something", async () => {
    // arrange, act, assert
  });
});
```

The `beforeEach` with `applyMigrations()` is mandatory. It resets the database schema before each test, ensuring complete isolation.

### Testing authenticated compared to unauthenticated requests

**Authenticated request** -- pass `API_HEADERS` or `authHeaders(email)`:

```ts
it("returns current user", async () => {
  const { status, json } = await fetchJson("/api/v1/me", {
    headers: authHeaders(),
  });
  expect(status).toBe(200);
  expect(json.email).toBe(TEST_USER_EMAIL);
});
```

**Unauthenticated request** -- omit headers entirely:

```ts
it("returns 401 without auth", async () => {
  const { status } = await fetchJson("/api/v1/me");
  expect(status).toBe(401);
});
```

**Public endpoints** (health, webhook) -- no auth needed, but verify they are not blocked:

```ts
it("allows health without auth", async () => {
  const { status } = await fetchJson("/health");
  expect(status).toBe(200);
});
```

### Testing multitenant isolation

Create resources as different users by using the `email` parameter, then verify cross-user access fails. The `tenant-isolation.test.ts` file is the canonical reference:

```ts
const ALICE = "alice@example.com";
const BOB = "bob@example.com";

it("user cannot list another user's batches", async () => {
  await createBatch({ name: "Alice's Wine" }, ALICE);
  await createBatch({ name: "Bob's Wine" }, BOB);

  const { json } = await fetchJson("/api/v1/batches", {
    headers: authHeaders(ALICE),
  });
  expect(json.items).toHaveLength(1);
  expect(json.items[0].name).toBe("Alice's Wine");
});

it("user cannot read another user's batch", async () => {
  const bobBatch = await createBatch({ name: "Bob's Wine" }, BOB);
  const { status } = await fetchJson(`/api/v1/batches/${bobBatch}`, {
    headers: authHeaders(ALICE),
  });
  expect(status).toBe(404); // NOT 403 -- we don't leak existence
});
```

Important: cross-tenant access returns 404 (not 403) to avoid leaking resource existence.

### Testing webhook endpoints

Webhooks use `WEBHOOK_HEADERS` (the `X-Webhook-Token` header) instead of JWT auth:

```ts
it("creates reading", async () => {
  // Pre-insert the device into DB (or let auto-registration handle it)
  await env.DB.prepare("INSERT INTO devices (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .bind("pill-abc-123", "My Pill", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z").run();

  const { status } = await fetchJson("/webhook/rapt", {
    method: "POST",
    headers: WEBHOOK_HEADERS,
    body: {
      device_id: "pill-abc-123",
      device_name: "My RAPT Pill",
      temperature: 22.5,
      gravity: 1.045,
      battery: 92.3,
      rssi: -58.0,
      created_date: "2026-03-19T14:30:00Z",
    },
  });
  expect(status).toBe(200);

  // Verify side effect by querying DB directly
  const reading = await env.DB.prepare(
    "SELECT * FROM readings WHERE device_id = 'pill-abc-123'"
  ).first<any>();
  expect(reading).not.toBeNull();
  expect(reading.gravity).toBe(1.045);
});
```

Webhook auth tests verify:
- Invalid token returns 401
- Missing token returns 401
- Auth check runs before body validation (invalid body + no token = 401, not 422)

### Testing cron or alert evaluation

Cron and alert tests differ from endpoint tests because they call internal functions directly rather than going through HTTP:

**Pure alert evaluation** (`alerts.test.ts`) -- unit-tests the `evaluateAlerts()` function with fabricated context objects. No database or HTTP involved:

```ts
import { evaluateAlerts, type BatchAlertContext } from "../src/lib/alerts";

function ctx(overrides: Partial<BatchAlertContext> = {}): BatchAlertContext {
  return {
    batchId: "batch-1",
    userId: "user-1",
    stage: "primary_fermentation",
    targetGravity: null,
    hasAssignedDevice: true,
    readings: [],
    ...overrides,
  };
}

it("fires temp_high when latest temperature >= 30", () => {
  const readings = [
    { gravity: 1.05, temperature: 31, source_timestamp: hoursAgo(1) },
  ];
  const result = evaluateAlerts(ctx({ readings }));
  expect(result.some((a) => a.type === "temp_high")).toBe(true);
});
```

**Alert manager** (`alert-manager.test.ts`) -- tests the DB persistence layer for alerts (`processAlerts`, `resolveCleared`, `getActiveAlerts`). These insert test data directly into the database through `env.DB` in `beforeEach`, then call the alert-manager functions:

```ts
beforeEach(async () => {
  await applyMigrations();
  await env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, datetime('now'))")
    .bind(USER_ID, "test@example.com").run();
  await env.DB.prepare(
    `INSERT INTO batches (id, user_id, name, ...) VALUES (?, ?, 'Test Batch', ...)`
  ).bind(BATCH_ID, USER_ID).run();
});

it("deduplicates -- second call returns nothing", async () => {
  const candidate = { type: "temp_high" as const, message: "30.5C", context: { temperature: 30.5 } };
  await processAlerts(env.DB, USER_ID, BATCH_ID, [candidate]);
  const second = await processAlerts(env.DB, USER_ID, BATCH_ID, [candidate]);
  expect(second.length).toBe(0);
});
```

**Cron evaluation** (`cron.test.ts`) -- tests the `evaluateAllBatches()` function that runs on a schedule. Sets up full DB state (users, batches, devices, readings) manually, then calls the function and checks for expected alert rows:

```ts
import { evaluateAllBatches } from "../src/cron";

it("creates no_readings alert for batch with stale device", async () => {
  // Insert user, batch, device, and an old reading directly via env.DB
  // ...
  await evaluateAllBatches(env.DB);

  const alert = await env.DB.prepare(
    "SELECT * FROM alert_state WHERE batch_id = ? AND alert_type = 'no_readings'"
  ).bind(batchId).first<any>();
  expect(alert).not.toBeNull();
});
```

### Common assertion patterns

**Status code + JSON body:**
```ts
const { status, json } = await fetchJson("/api/v1/batches", { headers: API_HEADERS });
expect(status).toBe(200);
expect(json.items).toHaveLength(0);
```

**Created resource (201):**
```ts
const { status, json } = await fetchJson("/api/v1/batches", {
  method: "POST", headers: API_HEADERS, body: VALID_BATCH,
});
expect(status).toBe(201);
expect(json.id).toBeDefined();
expect(json.name).toBe("2026 Merlot");
```

**No content (204):**
```ts
const { status } = await fetchJson(`/api/v1/batches/${batchId}`, {
  method: "DELETE", headers: API_HEADERS,
});
expect(status).toBe(204);
```

**Conflict / business rule violation (409):**
```ts
const { status } = await fetchJson(`/api/v1/batches/${batchId}/advance`, {
  method: "POST", headers: API_HEADERS,
});
expect(status).toBe(409);
```

**Validation error (422):**
```ts
const { status, json } = await fetchJson("/api/v1/batches", {
  method: "POST", headers: API_HEADERS,
  body: { ...VALID_BATCH, wine_type: "beer" },
});
expect(status).toBe(422);
```

**Direct DB verification** (for side effects not visible in the API response):
```ts
const row = await env.DB.prepare("SELECT * FROM alert_state WHERE batch_id = ?")
  .bind(batchId).first<any>();
expect(row).not.toBeNull();
expect(row.alert_type).toBe("temp_high");
```

**List ordering:**
```ts
expect(json.items[0].source_timestamp > json.items[4].source_timestamp).toBe(true);
```

**Pagination:**
```ts
const { json: page1 } = await fetchJson(`/path?limit=2`, { headers: API_HEADERS });
expect(page1.items).toHaveLength(2);
expect(page1.next_cursor).not.toBeNull();

const { json: page2 } = await fetchJson(`/path?limit=2&cursor=${page1.next_cursor}`, { headers: API_HEADERS });
expect(page2.items).toHaveLength(2);

// Verify no overlap
const ids1 = new Set(page1.items.map((i: any) => i.id));
for (const item of page2.items) expect(ids1.has(item.id)).toBe(false);
```

---

## Dashboard test infrastructure

### Configuration

The dashboard uses a standard Vitest setup with jsdom, configured in `dashboard/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
```

Key points:
- **jsdom environment**: Tests run in a simulated browser DOM, not a real browser.
- **`globals: true`**: Vitest globals (`describe`, `it`, `expect`) are available without imports.
- **`@` alias**: Mirrors the production path alias so imports such as `@/components/Foo` resolve correctly in tests.
- **React plugin**: Enables JSX transform for component tests.

### Setup file

`dashboard/src/test-setup.ts` imports jest-dom matchers:

```ts
import "@testing-library/jest-dom/vitest";
```

This adds DOM-specific matchers to Vitest's `expect`:
- `toBeInTheDocument()`
- `toHaveTextContent()`
- `toBeVisible()`
- `toHaveAttribute()`
- `toBeDisabled()`
- and so on.

### How component tests work

The dashboard uses `@testing-library/react`. Component tests would follow this pattern:

```tsx
import { render, screen } from "@testing-library/react";
import { MyComponent } from "@/components/MyComponent";

it("renders the title", () => {
  render(<MyComponent title="Hello" />);
  expect(screen.getByText("Hello")).toBeInTheDocument();
});
```

Note: As of now, there are no dashboard test files. The infrastructure is in place and ready for you to add component tests.

---

## How to write new tests

### Adding an API endpoint test

**Step 1**: Create a test file in `api/test/`, e.g. `api/test/my-feature.test.ts`.

**Step 2**: Use the standard boilerplate:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { applyMigrations, fetchJson, createBatch, API_HEADERS, authHeaders } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

describe("my feature", () => {
  // tests go here
});
```

**Step 3**: Write tests using `fetchJson` for HTTP calls:

```ts
it("creates a widget", async () => {
  const batchId = await createBatch();
  const { status, json } = await fetchJson(`/api/v1/batches/${batchId}/widgets`, {
    method: "POST",
    headers: API_HEADERS,
    body: { name: "My Widget" },
  });
  expect(status).toBe(201);
  expect(json.name).toBe("My Widget");
});
```

**Step 4**: If you need direct DB access (for setup or verification), import `env`:

```ts
import { env } from "cloudflare:test";

it("stores data correctly", async () => {
  // ... make API call ...
  const row = await env.DB.prepare("SELECT * FROM widgets WHERE id = ?")
    .bind(widgetId).first<any>();
  expect(row.name).toBe("My Widget");
});
```

**Step 5**: For multitenant tests, use different emails:

```ts
it("users cannot see each other's widgets", async () => {
  const batchA = await createBatch({ name: "A" }, "a@test.com");
  const batchB = await createBatch({ name: "B" }, "b@test.com");

  // Create widget as user A
  await fetchJson(`/api/v1/batches/${batchA}/widgets`, {
    method: "POST",
    headers: authHeaders("a@test.com"),
    body: { name: "A's widget" },
  });

  // User B should not see it
  const { status } = await fetchJson(`/api/v1/batches/${batchA}/widgets`, {
    headers: authHeaders("b@test.com"),
  });
  expect(status).toBe(404);
});
```

**Step 6**: For webhook endpoint tests, use `WEBHOOK_HEADERS`:

```ts
import { WEBHOOK_HEADERS } from "./helpers";

it("processes incoming data", async () => {
  const { status } = await fetchJson("/webhook/my-endpoint", {
    method: "POST",
    headers: WEBHOOK_HEADERS,
    body: { /* payload */ },
  });
  expect(status).toBe(200);
});
```

### Adding a pure logic unit test

For functions that do not need HTTP or database access (such as `evaluateAlerts`), import the function directly and test with fabricated inputs:

```ts
import { describe, it, expect } from "vitest";
import { myFunction } from "../src/lib/my-module";

describe("myFunction", () => {
  it("returns expected result", () => {
    const result = myFunction({ input: "value" });
    expect(result).toEqual({ output: "expected" });
  });
});
```

You do not need `beforeEach` with `applyMigrations()` if the function has no database dependency.

### Adding a dashboard component test

**Step 1**: Create a test file next to the component, e.g. `dashboard/src/components/MyComponent.test.tsx`.

**Step 2**: Write the test:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { MyComponent } from "./MyComponent";

describe("MyComponent", () => {
  it("renders with the given title", () => {
    render(<MyComponent title="Test Title" />);
    expect(screen.getByText("Test Title")).toBeInTheDocument();
  });

  it("calls onClick when button is pressed", () => {
    const handleClick = vi.fn();
    render(<MyComponent title="Test" onClick={handleClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(handleClick).toHaveBeenCalledOnce();
  });
});
```

Because `globals: true` is set in the Vitest config, `describe`, `it`, `expect`, and `vi` are available without imports.

For components that depend on routing, API hooks, or context providers, you will need to wrap the rendered component in the appropriate providers.

---

## Running tests

### API tests

```bash
# Run all API tests once
cd api && npm test

# Run in watch mode (re-runs on file changes)
cd api && npm run test:watch

# Run a single test file
cd api && npx vitest run test/batches.test.ts

# Run tests matching a name pattern
cd api && npx vitest run -t "creates a batch"
```

### Dashboard tests

```bash
# Run all dashboard tests once
cd dashboard && npm test

# Run in watch mode
cd dashboard && npm run test:watch

# Run a single test file
cd dashboard && npx vitest run src/components/MyComponent.test.tsx
```

### Both workspaces

There is no root-level test script. Run each workspace independently from its directory.

### Debugging tips

- **Test isolation failures**: If a test passes alone but fails when run with others, check that `beforeEach` includes `applyMigrations()`. Tests within a file share the D1 database, and `applyMigrations()` uses `DROP TABLE IF EXISTS` / `CREATE TABLE IF NOT EXISTS` to reset state.

- **Inspecting DB state**: Add `env.DB.prepare("SELECT * FROM table").all()` calls in your test to see what the database has at any point. Import `env` from `cloudflare:test`.

- **Seeing full request/response**: The `fetchJson` helper returns both `status` and `json`. Log them with `console.log({ status, json })` during development.

- **Timeout issues**: Miniflare startup can be slow on first run. If tests time out, try running them again -- the second run is usually faster. You can also increase the Vitest timeout in the config.
