# Wine Cellar Improvements Round — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close remaining gaps — commit loose files, fill E2E test coverage, surface battery/RSSI data on batch detail, add batch cloning, and add API key docs.

**Architecture:** Independent work streams. E2E tests follow existing Playwright patterns (global auth via API key, seed data idempotency, role-based selectors). Battery/RSSI adds to the BatchSnapshot component using existing helpers. Batch clone is a new API endpoint + dashboard button. Docs follow existing MkDocs Material user guide style.

**Tech Stack:** Playwright, Hono, React 19, Recharts, Tailwind v4, shadcn/ui, MkDocs Material

**Reviewed by:** Claude code-reviewer agent + OpenAI Codex (gpt-5.4). All critical issues resolved.

---

### Task 1: Commit Untracked Files

**Files:**
- Stage: `dashboard/e2e/run-seed.ts`

**Step 1: Stage and commit the seed runner**

```bash
git add dashboard/e2e/run-seed.ts
git commit -m "chore: track standalone E2E seed runner (used by make demo)"
```

**Step 2: Verify**

Run: `git status`
Expected: Only untracked plan docs remain.

---

### Task 2: E2E Test — Tools Page Calculators

**Files:**
- Create: `dashboard/e2e/specs/tools.spec.ts`

**Key facts from code review:**
- Card titles are `"ABV"`, `"Chaptalization"`, `"Sulfite Addition"`, `"Hydrometer Correction"`, `"Calibration Solution"` — **not** `"... Calculator"` (`Tools.tsx:92,116,152,201,240`)
- ABV uses `.toFixed(1)` → `"5.3"` not `"5.25"`. Attenuation uses `.toFixed(0)` → `"80"` not `"80.0"` (`Tools.tsx:97-98`)
- `Result` component renders value and unit as separate spans inside a flex div (`Tools.tsx:23-32`)
- ABV card is `defaultOpen`. Other cards need clicking to expand.
- Input fields use `SliderField` with `<Input id="..." type="number">` — use `page.locator("#id")` selectors

**Step 1: Write the test**

```typescript
import { test, expect } from "@playwright/test";

test.describe("Tools — Winemaking Calculators", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/tools");
  });

  test("page renders with heading", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Winemaking Calculators" })
    ).toBeVisible();
  });

  test("ABV calculator computes correctly", async ({ page }) => {
    // ABV card is defaultOpen — no click needed
    await page.locator("#abv-og").fill("1.050");
    await page.locator("#abv-fg").fill("1.010");

    // ABV = (1.050 - 1.010) * 131.25 = 5.25, displayed as "5.3" via .toFixed(1)
    await expect(page.getByText("5.3")).toBeVisible();
    // Attenuation = 80, displayed as "80" via .toFixed(0)
    await expect(page.getByText("Apparent Attenuation")).toBeVisible();
  });

  test("chaptalization calculator computes sugar needed", async ({ page }) => {
    // Click the Chaptalization card header to expand it
    await page.getByText("Chaptalization").click();

    await page.locator("#chap-vol").fill("23");
    await page.locator("#chap-cur").fill("1.050");
    await page.locator("#chap-tgt").fill("1.060");

    // pts = 10, sugar = 23 * 10 * 2.65 = 610g
    await expect(page.getByText("610")).toBeVisible();
  });

  test("sulfite calculator computes KMS addition", async ({ page }) => {
    await page.getByText("Sulfite Addition").click();

    await page.locator("#so2-vol").fill("23");
    await page.locator("#so2-ph").fill("3.4");
    await page.locator("#so2-tgt").fill("50");
    await page.locator("#so2-cur").fill("20");

    // KMS = (50-20) * 23 / 576 ≈ 1.20g
    await expect(page.getByText("KMS to Add")).toBeVisible();
    await expect(page.getByText("1.20")).toBeVisible();
  });

  test("hydrometer correction adjusts for temperature", async ({ page }) => {
    await page.getByText("Hydrometer Correction").click();

    await page.locator("#tc-sg").fill("1.050");
    await page.locator("#tc-temp").fill("30");
    await page.locator("#tc-cal").fill("20");

    // At 30°C, correction is +0.0025, so corrected = 1.0525 → "1.053"
    await expect(page.getByText("Corrected SG")).toBeVisible();
  });

  test("calibration solution calculator shows sugar needed", async ({
    page,
  }) => {
    await page.getByText("Calibration Solution").click();

    await page.locator("#cal-vol").fill("1");
    await page.locator("#cal-sg").fill("1.050");

    await expect(page.getByText("Sugar Needed")).toBeVisible();
  });
});
```

**Step 2: Run test to verify it passes**

Run: `cd dashboard && E2E_API_KEY=wc-e2etest0000000000000000000000000000000000000000000000000000000000 npx playwright test tools`
Expected: All 6 tests pass. If assertions fail on exact values, adjust to match actual rendered output — read the `Result` component at `Tools.tsx:23-32`.

**Step 3: Commit**

```bash
git add dashboard/e2e/specs/tools.spec.ts
git commit -m "test: add E2E tests for winemaking calculators (Tools page)"
```

---

### Task 3: E2E Test — Device Management on Settings Page

**Files:**
- Create: `dashboard/e2e/specs/devices.spec.ts`

**Key facts from code review:**
- There is **no `/devices` route** in `App.tsx`. The `Devices.tsx` page component is orphaned.
- Device management is on **`/settings`** inside a Card with `CardTitle "Devices"` (`Settings.tsx:47-81`)
- `DeviceCard` shows `"Assigned"` (line 35) or `"Idle"` (line 42), **not** `"Unassigned"`
- Batch name shown as `"Monitoring: {name}"` (line 51-54), **not** `"Batch: {name}"`
- Assign uses shadcn `Select` (not combobox) with `SelectItem` per batch (`AssignDialog.tsx:50-56`)
- Toast messages: `"Device unassigned"` (Settings.tsx:37), `"Device assigned"` (AssignDialog.tsx:35)
- Playwright suite is `fullyParallel: true` — mutation tests must be self-healing

**Seed data context:** Batch #1 "Argentia Ridge Cab Sauv" has device "Rapt Pill #1" (ID: `e2e-rapt-pill-01`) assigned.

**Step 1: Write the test**

```typescript
import { test, expect } from "@playwright/test";

test.describe("Device management (Settings page)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
  });

  test("shows Devices section", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Devices" })).toBeVisible();
  });

  test("shows the seeded RAPT Pill device", async ({ page }) => {
    await expect(page.getByText("Rapt Pill #1")).toBeVisible();
  });

  test("device shows assigned status and batch name", async ({ page }) => {
    await expect(page.getByText("Assigned").first()).toBeVisible();
    await expect(page.getByText("Argentia Ridge Cab Sauv").first()).toBeVisible();
  });

  test("unassign and reassign device", async ({ page }) => {
    // Unassign
    await page.getByRole("button", { name: "Unassign" }).click();
    await expect(page.getByText("Device unassigned")).toBeVisible();
    await expect(page.getByText("Idle")).toBeVisible();

    // Reassign — click the "Assign" button on the device card
    await page.getByRole("button", { name: "Assign" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // AssignDialog uses shadcn Select (not combobox)
    await page.getByRole("combobox").click();
    await page
      .getByRole("option", { name: /Argentia Ridge Cab Sauv/ })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Assign" })
      .click();

    await expect(page.getByText("Device assigned")).toBeVisible();
  });
});
```

**Step 2: Run test**

Run: `cd dashboard && E2E_API_KEY=wc-e2etest0000000000000000000000000000000000000000000000000000000000 npx playwright test devices`
Expected: All 4 tests pass. The unassign/reassign test is self-healing (restores original state).

**Step 3: Commit**

```bash
git add dashboard/e2e/specs/devices.spec.ts
git commit -m "test: add E2E tests for device management (Settings page)"
```

---

### Task 4: E2E Test — Login Page

**Files:**
- Create: `dashboard/e2e/specs/login.spec.ts`

**Key facts from code review:**
- Login is rendered by `AuthGate` when auth fails (`AuthGate.tsx:56`) — **no router redirect occurs**
- Navigating to `/` unauthenticated renders `<Login />` but URL **stays at `/`**, not `/login`
- Error messages (`Login.tsx:17-19`): `"Registrations are currently closed."`, `"GitHub sign-in failed. Please try again."`
- `window.history.replaceState` clears error params after reading them — assertions still work because state is set first

**Step 1: Write the test**

```typescript
import { test, expect } from "@playwright/test";

// Override storageState to be unauthenticated for login tests
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Login page", () => {
  test("shows Wine Cellar heading when unauthenticated", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Wine Cellar" })
    ).toBeVisible();
  });

  test("shows GitHub sign-in link", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: /Sign in with GitHub/i })
    ).toBeVisible();
  });

  test("shows passkey sign-in button", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: /Sign in with Passkey/i })
    ).toBeVisible();
  });

  test("shows error for closed registrations", async ({ page }) => {
    await page.goto("/?error=registrations_closed");
    await expect(
      page.getByText("Registrations are currently closed.")
    ).toBeVisible();
  });

  test("shows error for GitHub failure", async ({ page }) => {
    await page.goto("/?error=github_error");
    await expect(
      page.getByText("GitHub sign-in failed. Please try again.")
    ).toBeVisible();
  });
});
```

**Step 2: Run test**

Run: `cd dashboard && E2E_API_KEY=wc-e2etest0000000000000000000000000000000000000000000000000000000000 npx playwright test login`
Expected: All 5 tests pass.

**Step 3: Commit**

```bash
git add dashboard/e2e/specs/login.spec.ts
git commit -m "test: add E2E tests for Login page"
```

---

### Task 5: Battery/RSSI Display in Batch Detail

**Files:**
- Modify: `dashboard/src/pages/BatchDetail.tsx`
- Modify: `dashboard/src/pages/BatchDetail.test.tsx`

**Key facts from code review:**
- `Reading` type already includes `battery: number | null` and `rssi: number | null` (`types.ts`)
- `batteryColor()` and `signalLabel()` already exported from `@/components/settings/helpers` (`helpers.ts:3,9`)
- DeviceCard renders battery as `"{n}% bat"` and signal as `signalLabel(rssi).text` (`DeviceCard.tsx:69-78`)
- Test fixture `makeReading()` already includes `battery: 90` and `rssi: -55` (`BatchDetail.test.tsx:106-107`)
- `BatchSnapshot` component receives readings and has access to the latest reading

**Step 1: Read BatchSnapshot to find where to add battery/RSSI**

Read `dashboard/src/pages/BatchDetail.tsx` — find the `BatchSnapshot` component definition. Look for where latest temperature is displayed.

**Step 2: Add battery/RSSI to snapshot**

Import helpers at the top of `BatchDetail.tsx`:
```typescript
import { batteryColor, signalLabel } from "@/components/settings/helpers";
```

In the `BatchSnapshot` component, after the temperature display, add:
```tsx
{latest?.battery != null && (
  <div className="flex items-center gap-3 text-xs">
    <span className={batteryColor(latest.battery)}>
      {latest.battery.toFixed(0)}% bat
    </span>
    {latest.rssi != null && (
      <span className={signalLabel(latest.rssi).color}>
        {signalLabel(latest.rssi).text}
      </span>
    )}
  </div>
)}
```

Use the same format as `DeviceCard.tsx:69-78` for consistency.

**Step 3: Add a unit test**

In `BatchDetail.test.tsx`, add a test verifying battery/signal text appears:

```typescript
it("shows device battery and signal strength", async () => {
  // makeReading() already includes battery: 90, rssi: -55
  renderBatchDetail();
  await waitForBatchLoad();
  expect(screen.getByText("90% bat")).toBeInTheDocument();
  expect(screen.getByText("Good")).toBeInTheDocument(); // rssi -55 → "Good"
});
```

**Step 4: Run tests**

Run: `cd dashboard && npx vitest run src/pages/BatchDetail.test.tsx`
Expected: All tests pass

**Step 5: Run full dashboard test suite**

Run: `cd dashboard && npm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add dashboard/src/pages/BatchDetail.tsx dashboard/src/pages/BatchDetail.test.tsx
git commit -m "feat: show device battery and signal strength on batch detail"
```

---

### Task 6: Batch Clone — API Endpoint

**Files:**
- Modify: `api/src/routes/batches.ts`
- Modify: `api/test/batches.test.ts`

**Key facts from code review:**
- Use `nowUtc()` from `../lib/time` (imported at `batches.ts:5`), **not** `new Date().toISOString()`
- Use `getOwnedBatch()` helper (`batches.ts:12-14`) for ownership check
- Use `notFound("Batch")` from `../lib/errors` (`batches.ts:4`) for 404 response
- Name field has max 200 chars (`models.ts:17`) — truncate before appending ` (Copy)`
- Test should verify reset fields: `started_at`, `completed_at`, `bottled_at` are reset

**Step 1: Write failing tests**

Add to `api/test/batches.test.ts`:

```typescript
describe("POST /api/v1/batches/:batchId/clone", () => {
  it("clones a batch with recipe fields", async () => {
    const batchId = await createBatch({
      name: "Original Merlot",
      wine_type: "red",
      source_material: "fresh_grapes",
      volume_liters: 60,
      target_volume_liters: 55,
      target_gravity: 0.996,
      yeast_strain: "Lalvin BM45",
      oak_type: "french",
      oak_format: "chips",
      oak_duration_days: 90,
      mlf_status: "pending",
      notes: "Backyard grapes",
    });

    const { status, json } = await fetchJson(
      `/api/v1/batches/${batchId}/clone`,
      { method: "POST", headers: await authHeaders() }
    );

    expect(status).toBe(201);
    expect(json.id).not.toBe(batchId);
    expect(json.name).toBe("Original Merlot (Copy)");
    expect(json.wine_type).toBe("red");
    expect(json.source_material).toBe("fresh_grapes");
    expect(json.volume_liters).toBe(60);
    expect(json.target_volume_liters).toBe(55);
    expect(json.target_gravity).toBe(0.996);
    expect(json.yeast_strain).toBe("Lalvin BM45");
    expect(json.oak_type).toBe("french");
    expect(json.oak_format).toBe("chips");
    expect(json.oak_duration_days).toBe(90);
    expect(json.mlf_status).toBe("pending");
    expect(json.notes).toBe("Backyard grapes");
    // Reset fields
    expect(json.stage).toBe("must_prep");
    expect(json.status).toBe("active");
    expect(json.completed_at).toBeNull();
    expect(json.bottled_at).toBeNull();
  });

  it("returns 404 for nonexistent batch", async () => {
    const { status } = await fetchJson(
      "/api/v1/batches/nonexistent/clone",
      { method: "POST", headers: await authHeaders() }
    );
    expect(status).toBe(404);
  });

  it("rejects cloning another user's batch", async () => {
    const batchId = await createBatch({}, "owner@test.local");
    const { status } = await fetchJson(
      `/api/v1/batches/${batchId}/clone`,
      { method: "POST", headers: await authHeaders("other@test.local") }
    );
    expect(status).toBe(404);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run test/batches.test.ts`
Expected: FAIL — route not found

**Step 3: Implement the clone endpoint**

In `api/src/routes/batches.ts`, add before `export default batches`:

```typescript
batches.post("/:batchId/clone", async (c) => {
  const user = c.get("user");
  const { batchId } = c.req.param();

  const source = await getOwnedBatch(c.env.DB, batchId, user.id);
  if (!source) return notFound("Batch");

  const id = crypto.randomUUID();
  const now = nowUtc();
  const clonedName = `${source.name} (Copy)`.slice(0, 200);

  await c.env.DB.prepare(
    `INSERT INTO batches (id, user_id, name, wine_type, source_material,
       volume_liters, target_volume_liters, target_gravity, yeast_strain,
       oak_type, oak_format, oak_duration_days, mlf_status, notes,
       stage, status, started_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'must_prep', 'active', ?, ?, ?)`
  )
    .bind(
      id, user.id, clonedName,
      source.wine_type, source.source_material,
      source.volume_liters, source.target_volume_liters,
      source.target_gravity, source.yeast_strain,
      source.oak_type, source.oak_format,
      source.oak_duration_days, source.mlf_status,
      source.notes, now, now, now
    )
    .run();

  const batch = await c.env.DB.prepare(
    "SELECT * FROM batches WHERE id = ?"
  )
    .bind(id)
    .first();

  return c.json(batch, 201);
});
```

**Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run test/batches.test.ts`
Expected: All tests pass

**Step 5: Run full API test suite**

Run: `cd api && npm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add api/src/routes/batches.ts api/test/batches.test.ts
git commit -m "feat: add batch clone endpoint (POST /batches/:id/clone)"
```

---

### Task 7: Batch Clone — Dashboard UI

**Files:**
- Modify: `dashboard/src/api.ts`
- Modify: `dashboard/src/pages/BatchDetail.tsx`

**Key facts from code review:**
- Toast API is Sonner: `toast.success("message")` / `toast.error("message")` — **not** `toast({ title })` (`BatchDetail.tsx:171,307`)
- `useNavigate` and `id` from `useParams` are already in scope (`BatchDetail.tsx:285-286`)
- Clone button goes next to the Edit button at `BatchDetail.tsx:375-380`

**Step 1: Add clone to API client**

In `dashboard/src/api.ts`, add to the `batches` object alongside `archive`/`unarchive`:

```typescript
clone: (id: string) =>
  apiFetch<Batch>(`/api/v1/batches/${id}/clone`, { method: "POST" }),
```

**Step 2: Add Clone button to BatchDetail**

In `dashboard/src/pages/BatchDetail.tsx`, find the secondary actions div (`BatchDetail.tsx:375`). Add a Clone button after the ExportButton:

```tsx
<Button
  size="sm"
  variant="ghost"
  className="h-7 text-xs"
  onClick={async () => {
    try {
      const cloned = await api.batches.clone(id!);
      toast.success(`Batch cloned: ${cloned.name}`);
      navigate(`/batches/${cloned.id}`);
    } catch {
      toast.error("Couldn't clone batch");
    }
  }}
>
  Clone
</Button>
```

**Step 3: Run dashboard tests**

Run: `cd dashboard && npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add dashboard/src/api.ts dashboard/src/pages/BatchDetail.tsx
git commit -m "feat: add Clone button to batch detail page"
```

---

### Task 8: User Guide — API Keys Documentation

**Files:**
- Create: `docs/user-guide/api-keys.md`
- Modify: `mkdocs.yml` (add nav entry)

**Key facts from code review:**
- Auth middleware (`access.ts:48-60`) supports API keys as direct bearer auth on every endpoint, not just session bootstrap
- mkdocs.yml nav is at the top level under `nav:` → `User Guide:`
- Follow existing doc style: conversational, task-oriented, second person, bold UI elements

**Step 1: Write the doc**

Create `docs/user-guide/api-keys.md`:

```markdown
# API Keys

API keys let you access Wine Cellar from scripts, integrations, or tools like
MCP servers without signing in through the browser.

## Creating a key

1. Open **Settings** from the bottom navigation bar.
2. Scroll to the **Security** section.
3. Tap **Create API Key**.
4. Give the key a name you'll recognise later (e.g., "Home Assistant" or
   "MCP Server").
5. Copy the key immediately — it won't be shown again.

The key starts with `wc-` and is around 70 characters long. Store it somewhere
safe, like a password manager or an environment variable.

## Using a key

Pass the key in the `Authorization` header as a Bearer token:

    Authorization: Bearer wc-your-key-here

Every `/api/v1/*` endpoint accepts API key authentication directly — no
session exchange needed.

## Revoking a key

In **Settings → Security**, tap the delete button next to the key you want to
revoke. The key stops working immediately.

## When to use an API key

| Scenario | Use |
|----------|-----|
| Browser / phone | GitHub sign-in or passkey — no key needed |
| Script or cron job | API key |
| MCP server | API key |
| CI / E2E tests | API key |

API keys have the same permissions as your account. Anyone with your key can
read and modify your batches, so treat it like a password.
```

**Step 2: Add to mkdocs.yml nav**

Add under the User Guide section after the last entry:

```yaml
    - API Keys: user-guide/api-keys.md
```

**Step 3: Build docs to verify**

Run: `make docs`
Expected: Build succeeds with no warnings

**Step 4: Commit**

```bash
git add docs/user-guide/api-keys.md mkdocs.yml
git commit -m "docs: add API keys user guide page"
```

---

### Task 9: Final Verification and Push

**Step 1: Run API tests**

Run: `cd api && npm test`
Expected: All pass

**Step 2: Run dashboard unit tests**

Run: `cd dashboard && npm test`
Expected: All pass

**Step 3: Run E2E tests**

Run: `cd dashboard && E2E_API_KEY=wc-e2etest0000000000000000000000000000000000000000000000000000000000 npx playwright test`
Expected: All pass (including new specs)

**Step 4: Build docs**

Run: `make docs`
Expected: Build succeeds

**Step 5: Push**

```bash
git push
```
