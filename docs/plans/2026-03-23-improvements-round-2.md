# Wine Cellar Improvements Round 2 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Clean up orphaned code, strengthen E2E coverage, add batch clone E2E, device CSV export, and battery/RSSI sparklines.

**Architecture:** Independent tasks. Battery/RSSI seed data must land before sparklines (Task 2 before Task 6). Device export reuses the existing CSV library pattern. Clone E2E uses seed batch #6 "2024 Merlot" which has the most populated fields.

**Tech Stack:** Playwright, React 19, Recharts, Tailwind v4, shadcn/ui

---

### Task 1: Delete Orphaned Devices.tsx

**Files:**
- Delete: `dashboard/src/pages/Devices.tsx`

**Context:** `Devices.tsx` is not routed in `App.tsx` (no `/devices` route). Device management lives on the Settings page via `DeviceCard` from `@/components/settings`. The orphaned file duplicates functionality with a different layout (Cards + Badge vs inline DeviceCard) and its own inline `AssignDialog`. Keeping it causes confusion.

**Step 1: Verify it's not imported anywhere**

Run: `cd dashboard && grep -r "Devices" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | grep -v "Devices.tsx"`

Expected: No imports of `Devices` page component. (The `Device` type and `DeviceCard` component are different things.)

**Step 2: Delete the file**

```bash
rm dashboard/src/pages/Devices.tsx
```

**Step 3: Run tests to confirm nothing breaks**

Run: `cd dashboard && npm test`
Expected: All 143 tests pass

**Step 4: Commit**

```bash
git add dashboard/src/pages/Devices.tsx
git commit -m "chore: remove orphaned Devices page (device management is on Settings)"
```

---

### Task 2: Add Battery/RSSI to Seed Data Generator

**Files:**
- Modify: `dashboard/e2e/fixtures/generators.ts`

**Context:** `generateFermentationCurve()` produces readings with gravity and temperature but not battery or RSSI. The seed data inserts readings via SQL with explicit columns — battery/rssi are omitted. Adding them to the generator makes battery/RSSI visible in the demo and testable in E2E.

Battery drains slowly (~0.1%/day from 100%). RSSI varies around -60 dBm with noise.

**Step 1: Add battery and rssi to the ReadingRow interface**

In `dashboard/e2e/fixtures/generators.ts`, add to the `ReadingRow` interface (line 15-20):

```typescript
export interface ReadingRow {
  id: string;
  gravity: number;
  temperature: number;
  battery: number;
  rssi: number;
  timestamp: string;
}
```

**Step 2: Generate battery and rssi values in the loop**

In the `generateFermentationCurve` function, after the temperature calculation (around line 115), add:

```typescript
// Battery: starts at 100%, drains ~0.1%/day
const batteryDrain = (hoursElapsed / 24) * 0.1;
const battery = Math.max(10, 100 - batteryDrain + gaussian(rng, 0, 0.2));

// RSSI: WiFi signal around -60 dBm with variance
const rssi = gaussian(rng, -60, 5);
```

Update the `readings.push()` call to include `battery` and `rssi`:

```typescript
readings.push({
  id: randomUUID(),
  gravity: Math.round(gravity * 10000) / 10000,
  temperature: Math.round(temp * 100) / 100,
  battery: Math.round(Math.min(100, Math.max(0, battery)) * 10) / 10,
  rssi: Math.round(Math.max(-100, Math.min(-20, rssi))),
  timestamp: timestamp.toISOString(),
});
```

**Step 3: Update seed.ts SQL to include battery and rssi**

In `dashboard/e2e/fixtures/seed.ts`, find the SQL INSERT for readings (around line 213). Update the column list and values to include `battery` and `rssi`:

Change the column list from:
```
INSERT INTO readings (id, batch_id, device_id, user_id, gravity, temperature, source, source_timestamp, created_at) VALUES
```
to:
```
INSERT INTO readings (id, batch_id, device_id, user_id, gravity, temperature, battery, rssi, source, source_timestamp, created_at) VALUES
```

And update the values template to include `r.battery` and `r.rssi`:
```typescript
`('${esc(r.id)}', '${esc(batchId)}', '${esc(deviceId)}', '${esc(E2E_USER_ID)}', ${r.gravity}, ${r.temperature}, ${r.battery}, ${r.rssi}, 'device', '${esc(r.timestamp)}', '${esc(r.timestamp)}')`
```

**Step 4: Verify demo still works**

Run: `make demo` (in background), verify it seeds without errors, then stop it.

**Step 5: Commit**

```bash
git add dashboard/e2e/fixtures/generators.ts dashboard/e2e/fixtures/seed.ts
git commit -m "feat: include battery and RSSI in seeded reading data"
```

---

### Task 3: Strengthen Tools E2E Assertions

**Files:**
- Modify: `dashboard/e2e/specs/tools.spec.ts`

**Context:** The hydrometer correction and calibration solution tests only assert labels ("Corrected SG", "Sugar Needed") without checking computed values. The review flagged this as weak compared to the other calculator tests.

**Computed values for test inputs:**
- Hydrometer: SG=1.050, temp=30°C, cal=20°C → `tempCorrection(30)=0.0025`, `tempCorrection(20)=0.0` → corrected = `1.0525`, displayed as `"1.0525"` via `.toFixed(4)` (`Tools.tsx:206`)
- Calibration: vol=1L, SG=1.050 → brix≈12.4, sugar = 1050 * 0.124 ≈ 130.2g, displayed as `"130.2"` via `.toFixed(1)` (`Tools.tsx:246`)

**Step 1: Update hydrometer test**

Replace the hydrometer test assertion (the `await expect(page.getByText("Corrected SG")).toBeVisible()` line) with:

```typescript
// corrected = 1.050 + 0.0025 - 0.0 = 1.0525
await expect(page.getByText("1.0525")).toBeVisible();
```

**Step 2: Update calibration test**

Replace the calibration test assertion with:

```typescript
// sugar = 1050 * (brix/100) ≈ 130.2g
await expect(page.getByText("130.2")).toBeVisible();
```

**Step 3: Run E2E tests**

Run: `cd dashboard && E2E_API_KEY=wc-e2etest0000000000000000000000000000000000000000000000000000000000 npx playwright test tools`
Expected: All 6 tests pass. If the exact values differ, read the actual page output and adjust.

**Step 4: Commit**

```bash
git add dashboard/e2e/specs/tools.spec.ts
git commit -m "test: strengthen calculator E2E assertions with computed values"
```

---

### Task 4: Batch Clone E2E Test

**Files:**
- Create: `dashboard/e2e/specs/batch-clone.spec.ts`

**Context:** Seed batch #6 "2024 Merlot" has the most populated fields: wine_type=red, source_material=fresh_grapes, yeast=Lalvin BM45, oak=french/chips/90d, mlf=complete, notes populated, status=completed. Cloning it tests that all recipe fields are copied and status is reset.

The Clone button is at `BatchDetail.tsx:393-408`, rendered as `<Button variant="ghost" size="sm">Clone</Button>`. On success it shows `toast.success(\`Batch cloned: ${cloned.name}\`)` and navigates to the new batch.

**Step 1: Write the test**

```typescript
import { test, expect } from "@playwright/test";

test.describe("Batch cloning", () => {
  test("clones a completed batch with full recipe data", async ({ page }) => {
    // Navigate to batch list, find 2024 Merlot (completed)
    await page.goto("/batches");
    await page.getByRole("tab", { name: "Completed" }).click();
    await page.getByText("2024 Merlot").click();
    await expect(page).toHaveURL(/\/batches\/[a-zA-Z0-9-]+$/);

    // Capture original batch URL
    const originalUrl = page.url();

    // Click Clone
    await page.getByRole("button", { name: "Clone" }).click();

    // Verify success toast
    await expect(page.getByText(/Batch cloned/)).toBeVisible();

    // Verify navigation to NEW batch (different URL)
    await expect(page).toHaveURL(/\/batches\/[a-zA-Z0-9-]+$/);
    expect(page.url()).not.toBe(originalUrl);

    // Verify cloned batch has correct data
    // Name gets " (Copy)" appended by the API
    await expect(page.getByText("2024 Merlot (Copy)").first()).toBeVisible();

    // Cloned batch should be active (not completed)
    await expect(page.getByText("Active").first()).toBeVisible();

    // Verify recipe data carried over (shown in snapshot section)
    await expect(page.getByText("Red").first()).toBeVisible();
    await expect(page.getByText("Fresh Grapes").first()).toBeVisible();
  });
});
```

**Step 2: Run E2E test**

Run: `cd dashboard && E2E_API_KEY=wc-e2etest0000000000000000000000000000000000000000000000000000000000 npx playwright test batch-clone`
Expected: Test passes. If selectors need adjustment, read the actual BatchDetail page structure.

**Step 3: Commit**

```bash
git add dashboard/e2e/specs/batch-clone.spec.ts
git commit -m "test: add E2E test for batch cloning"
```

---

### Task 5: Device CSV Export

**Files:**
- Modify: `dashboard/src/lib/csv.ts`
- Modify: `dashboard/src/components/settings/DeviceCard.tsx`

**Context:** The ExportButton on BatchDetail downloads readings and activities as CSV using frontend-only generation (`dashboard/src/lib/csv.ts`). Device readings have the same shape but also include battery/rssi. We add a `deviceReadingsToCSV` function and an export button to DeviceCard.

The `DeviceCard` already fetches 50 readings via `api.readings.listByDevice(device.id, { limit: 50 })` (line 17-19).

**Step 1: Add deviceReadingsToCSV to csv.ts**

In `dashboard/src/lib/csv.ts`, add after `readingsToCSV`:

```typescript
export function deviceReadingsToCSV(
  readings: { source_timestamp: string; gravity: number; temperature: number | null; battery: number | null; rssi: number | null; source: string }[],
): string {
  const sorted = [...readings].sort(
    (a, b) => new Date(a.source_timestamp).getTime() - new Date(b.source_timestamp).getTime(),
  );
  return toCSV(
    ["Timestamp", "Gravity", "Temperature_C", "Battery_Pct", "RSSI_dBm", "Source"],
    sorted.map((r) => [r.source_timestamp, r.gravity, r.temperature, r.battery, r.rssi, r.source]),
  );
}
```

**Step 2: Add export button to DeviceCard**

In `dashboard/src/components/settings/DeviceCard.tsx`:

1. Add imports:
```typescript
import { deviceReadingsToCSV, downloadCSV } from "@/lib/csv";
import { toast } from "sonner";
```

2. After the sparkline section (around line 91), inside the `{readings.length >= 2 && (` block, add an export button:

```tsx
<Button
  size="sm"
  variant="ghost"
  className="h-6 text-xs"
  onClick={() => {
    const slug = device.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    downloadCSV(deviceReadingsToCSV(readings), `${slug}-readings.csv`);
    toast.success(`Downloaded ${readings.length} readings`);
  }}
>
  Export CSV
</Button>
```

**Step 3: Run dashboard tests**

Run: `cd dashboard && npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add dashboard/src/lib/csv.ts dashboard/src/components/settings/DeviceCard.tsx
git commit -m "feat: add CSV export for device readings on Settings page"
```

---

### Task 6: Battery Sparkline on DeviceCard

**Files:**
- Modify: `dashboard/src/components/settings/DeviceCard.tsx`
- Modify: `dashboard/src/components/Sparkline.tsx` (if needed — check if a BatterySparkline exists or if we need one)

**Context:** DeviceCard already shows a `GravitySparkline` for the last 50 readings. Battery trend is useful for monitoring device health. We add a small battery sparkline next to the existing one, only when battery data is present.

**Step 1: Check if Sparkline component supports generic values**

Read `dashboard/src/components/Sparkline.tsx`. The `GravitySparkline` accepts `values: number[]` and renders a simple SVG line. If it's generic enough, we can reuse it. If it has gravity-specific formatting, we may need a `BatterySparkline` variant.

**Step 2: Add battery sparkline to DeviceCard**

After the existing gravity sparkline block, add a battery trend:

```tsx
{readings.some((r) => r.battery != null) && (
  <div className="flex items-center gap-2 mt-1">
    <span className="text-[10px] text-muted-foreground w-6">Bat</span>
    <GravitySparkline
      values={readings.filter((r) => r.battery != null).map((r) => r.battery!)}
      width={160}
      height={16}
    />
  </div>
)}
```

If `GravitySparkline` doesn't work for battery values (range 0-100 vs 0.99-1.10), create a generic `Sparkline` component that auto-scales, or adjust the existing one.

**Step 3: Run dashboard tests**

Run: `cd dashboard && npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add dashboard/src/components/settings/DeviceCard.tsx dashboard/src/components/Sparkline.tsx
git commit -m "feat: add battery trend sparkline to device card"
```

---

### Task 7: Final Verification and Push

**Step 1: Run API tests**

Run: `cd api && npm test`
Expected: All pass

**Step 2: Run dashboard unit tests**

Run: `cd dashboard && npm test`
Expected: All pass

**Step 3: Run E2E tests**

Run: `cd dashboard && E2E_API_KEY=wc-e2etest0000000000000000000000000000000000000000000000000000000000 npx playwright test`
Expected: All pass

**Step 4: Push**

```bash
git push
```
