# Wine Cellar Improvements Round 3 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix dark mode for BatterySparkline, add RSSI sparkline, add DeviceCard unit tests, add loading skeleton, and add E2E smoke tests for new device features.

**Architecture:** Independent tasks except Task 3 (unit tests) should run after Tasks 1-2 so it tests the final state. Task 4 (loading skeleton) is independent. Task 5 (E2E) runs last.

**Tech Stack:** React 19, Tailwind v4, vitest + testing-library, Playwright

---

### Task 1: Fix BatterySparkline Dark Mode

**Files:**
- Modify: `dashboard/src/components/Sparkline.tsx`

**Context:** `BatterySparkline` uses `text-green-600` which doesn't adapt to dark mode. The adjacent `helpers.ts` already uses `text-green-600 dark:text-green-400` for battery indicators. `GravitySparkline` and `TemperatureSparkline` use theme CSS variables (`text-chart-1`, `text-chart-2`) which have both light and dark definitions in `index.css`, so they don't have this problem.

**Step 1: Fix the dark variant**

In `dashboard/src/components/Sparkline.tsx` line 79, change:

```typescript
return <Sparkline values={values} domain={[0, 100]} className={`text-green-600 ${className ?? ""}`} {...props} />;
```

to:

```typescript
return <Sparkline values={values} domain={[0, 100]} className={`text-green-600 dark:text-green-400 ${className ?? ""}`} {...props} />;
```

**Step 2: Run dashboard tests**

Run: `cd dashboard && npm test`
Expected: All 135 tests pass

**Step 3: Commit**

```bash
git add dashboard/src/components/Sparkline.tsx
git commit -m "fix: add dark mode variant to BatterySparkline"
```

---

### Task 2: Add RSSI Sparkline to DeviceCard

**Files:**
- Modify: `dashboard/src/components/Sparkline.tsx`
- Modify: `dashboard/src/components/settings/DeviceCard.tsx`

**Context:** DeviceCard shows a battery sparkline but not RSSI. RSSI values range from -100 (weak) to -20 (excellent) dBm. A sparkline shows signal stability over time. Use the same pattern as BatterySparkline.

**Step 1: Add RssiSparkline to Sparkline.tsx**

After `BatterySparkline` (line 80), add:

```typescript
/** Convenience: RSSI sparkline with fixed -100 to -20 domain, blue color */
export function RssiSparkline({ values, className, ...props }: Omit<SparklineProps, "domain" | "color"> & { values: number[] }) {
  return <Sparkline values={values} domain={[-100, -20]} className={`text-blue-600 dark:text-blue-400 ${className ?? ""}`} {...props} />;
}
```

**Step 2: Add RSSI sparkline to DeviceCard**

In `dashboard/src/components/settings/DeviceCard.tsx`:

1. Update the Sparkline import (line 4):

```typescript
import { GravitySparkline, BatterySparkline, RssiSparkline } from "@/components/Sparkline";
```

2. After the battery sparkline block (after line 101 `)}`) and before the Export CSV `<Button>` (line 102), add:

```tsx
{readings.some((r) => r.rssi != null) && (
  <div className="flex items-center gap-2 mt-1">
    <span className="text-[10px] text-muted-foreground w-6">Sig</span>
    <RssiSparkline
      values={readings.filter((r) => r.rssi != null).map((r) => r.rssi!)}
      width={160}
      height={16}
    />
  </div>
)}
```

**Step 3: Run dashboard tests**

Run: `cd dashboard && npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add dashboard/src/components/Sparkline.tsx dashboard/src/components/settings/DeviceCard.tsx
git commit -m "feat: add RSSI signal sparkline to device card"
```

---

### Task 3: DeviceCard Unit Tests

**Files:**
- Create: `dashboard/src/components/settings/DeviceCard.test.tsx`

**Context:** DeviceCard has no unit tests. It renders device info, readings with battery/RSSI, sparklines, and a CSV export button. It calls `api.readings.listByDevice(device.id, { limit: 50 })` internally via `useFetch`.

Follow the existing test pattern from `Settings.test.tsx`: use vitest + testing-library, import `render`/`screen` from `@/test-utils`, use `mockApiModule()` for `@/api`, create a `makeDevice()` factory, and a `makeReading()` factory.

DeviceCard needs mocking of:
- `@/api` → via `mockApiModule()` from `@/test-utils` (override `api.readings.listByDevice` per-test)
- `@/components/Sparkline` → stub SVG sparklines (they make rendering complex)
- `sonner` → `toast`
- `@/lib/csv` → `deviceReadingsToCSV`, `downloadCSV`

Note: DeviceCard does not import `useAuth`, so no `mockAuthModule()` is needed.

**Step 1: Write the test file**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, render } from "@/test-utils";
import { mockApiModule } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { DeviceCard } from "./DeviceCard";
import type { Device, Reading } from "@/types";

// ── Mocks ────────────────────────────────────────────────────────

vi.mock("@/api", () => mockApiModule());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/components/Sparkline", () => ({
  GravitySparkline: () => <div data-testid="gravity-sparkline" />,
  BatterySparkline: () => <div data-testid="battery-sparkline" />,
  RssiSparkline: () => <div data-testid="rssi-sparkline" />,
}));

const mockDownloadCSV = vi.fn();
const mockDeviceReadingsToCSV = vi.fn().mockReturnValue("csv-content");
vi.mock("@/lib/csv", () => ({
  downloadCSV: (...args: unknown[]) => mockDownloadCSV(...args),
  deviceReadingsToCSV: (...args: unknown[]) => mockDeviceReadingsToCSV(...args),
}));

import { api } from "@/api";

// ── Factories ────────────────────────────────────────────────────

function makeDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: "dev-1",
    name: "RAPT Pill #1",
    batch_id: null,
    assigned_at: null,
    created_at: "2026-03-10T00:00:00Z",
    updated_at: "2026-03-10T00:00:00Z",
    ...overrides,
  };
}

function makeReading(overrides: Partial<Reading> = {}): Reading {
  return {
    id: "r-1",
    batch_id: "b-1",
    device_id: "dev-1",
    gravity: 1.045,
    temperature: 22.5,
    battery: 95,
    rssi: -55,
    source: "device",
    source_timestamp: "2026-03-20T12:00:00Z",
    created_at: "2026-03-20T12:00:00Z",
    ...overrides,
  };
}

// ── Setup ────────────────────────────────────────────────────────

const defaultProps = {
  device: makeDevice(),
  batchName: null,
  onAssign: vi.fn(),
  onUnassign: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.readings.listByDevice).mockResolvedValue({ items: [], next_cursor: null });
});

// ── Tests ────────────────────────────────────────────────────────

describe("DeviceCard", () => {
  it("renders device name and ID", async () => {
    render(<DeviceCard {...defaultProps} />);
    expect(screen.getByText("RAPT Pill #1")).toBeInTheDocument();
    expect(screen.getByText("dev-1")).toBeInTheDocument();
  });

  it("shows Idle status when no batch assigned", async () => {
    render(<DeviceCard {...defaultProps} />);
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assign" })).toBeInTheDocument();
  });

  it("shows Assigned status when batch is assigned", async () => {
    render(
      <DeviceCard
        {...defaultProps}
        device={makeDevice({ batch_id: "b-1", assigned_at: "2026-03-15T00:00:00Z" })}
        batchName="My Batch"
      />,
    );
    expect(screen.getByText("Assigned")).toBeInTheDocument();
    expect(screen.getByText("My Batch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unassign" })).toBeInTheDocument();
  });

  it("shows 'No readings received yet' when no data", async () => {
    render(<DeviceCard {...defaultProps} />);
    expect(await screen.findByText("No readings received yet")).toBeInTheDocument();
  });

  it("displays latest reading values", async () => {
    vi.mocked(api.readings.listByDevice).mockResolvedValue({
      items: [makeReading(), makeReading({ id: "r-2", source_timestamp: "2026-03-20T13:00:00Z" })],
      next_cursor: null,
    });
    render(<DeviceCard {...defaultProps} />);
    expect(await screen.findByText("1.045")).toBeInTheDocument();
    expect(screen.getByText("22.5")).toBeInTheDocument();
    expect(screen.getByText("95% bat")).toBeInTheDocument();
  });

  it("renders sparklines when 2+ readings", async () => {
    vi.mocked(api.readings.listByDevice).mockResolvedValue({
      items: [makeReading(), makeReading({ id: "r-2", source_timestamp: "2026-03-20T13:00:00Z" })],
      next_cursor: null,
    });
    render(<DeviceCard {...defaultProps} />);
    expect(await screen.findByTestId("gravity-sparkline")).toBeInTheDocument();
    expect(screen.getByTestId("battery-sparkline")).toBeInTheDocument();
    expect(screen.getByTestId("rssi-sparkline")).toBeInTheDocument();
  });

  it("shows Export CSV button and calls download on click", async () => {
    vi.mocked(api.readings.listByDevice).mockResolvedValue({
      items: [makeReading(), makeReading({ id: "r-2", source_timestamp: "2026-03-20T13:00:00Z" })],
      next_cursor: null,
    });
    render(<DeviceCard {...defaultProps} />);
    const btn = await screen.findByRole("button", { name: "Export CSV" });
    await userEvent.click(btn);
    expect(mockDeviceReadingsToCSV).toHaveBeenCalled();
    expect(mockDownloadCSV).toHaveBeenCalledWith("csv-content", "rapt-pill-1-readings.csv");
  });

  it("calls onAssign when Assign is clicked", async () => {
    render(<DeviceCard {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: "Assign" }));
    expect(defaultProps.onAssign).toHaveBeenCalledWith(defaultProps.device);
  });

  it("calls onUnassign when Unassign is clicked", async () => {
    const device = makeDevice({ batch_id: "b-1", assigned_at: "2026-03-15T00:00:00Z" });
    render(<DeviceCard {...defaultProps} device={device} batchName="Batch" />);
    await userEvent.click(screen.getByRole("button", { name: "Unassign" }));
    expect(defaultProps.onUnassign).toHaveBeenCalledWith("dev-1");
  });

  it("hides battery sparkline when no battery data", async () => {
    vi.mocked(api.readings.listByDevice).mockResolvedValue({
      items: [
        makeReading({ battery: null, rssi: null }),
        makeReading({ id: "r-2", battery: null, rssi: null, source_timestamp: "2026-03-20T13:00:00Z" }),
      ],
      next_cursor: null,
    });
    render(<DeviceCard {...defaultProps} />);
    await screen.findByTestId("gravity-sparkline");
    expect(screen.queryByTestId("battery-sparkline")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rssi-sparkline")).not.toBeInTheDocument();
  });
});
```

**Step 2: Run the new test**

Run: `cd dashboard && npx vitest run src/components/settings/DeviceCard.test.tsx`
Expected: All tests pass. If any test fails, read the DeviceCard component to understand the actual rendering and adjust selectors. Common issues:
- `useFetch` may resolve asynchronously — use `findByText` for data-dependent assertions
- The `Reading` type may have additional required fields — check `dashboard/src/types.ts` and add them to `makeReading()`
- The mock structure for `api.readings.listByDevice` must match what `useFetch` expects

**Step 3: Run all dashboard tests**

Run: `cd dashboard && npm test`
Expected: All tests pass (previous 135 + new ~10)

**Step 4: Commit**

```bash
git add dashboard/src/components/settings/DeviceCard.test.tsx
git commit -m "test: add unit tests for DeviceCard component"
```

---

### Task 4: Loading Skeleton for DeviceCard Readings

**Files:**
- Modify: `dashboard/src/components/settings/DeviceCard.tsx`

**Context:** When DeviceCard fetches readings via `useFetch`, no loading indicator shows. The `useFetch` hook returns `{ data, loading, error }`. DeviceCard currently only uses `data`. Add a subtle loading skeleton while readings load.

shadcn/ui has a Skeleton component. Check if it exists at `dashboard/src/components/ui/skeleton.tsx`.

**Step 1: Check for existing Skeleton component**

Run: `ls dashboard/src/components/ui/skeleton.tsx 2>/dev/null || echo "NOT FOUND"`

If NOT FOUND, create it using the standard shadcn pattern:

```typescript
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

export { Skeleton };
```

**Step 2: Modify DeviceCard to show loading skeleton**

In `dashboard/src/components/settings/DeviceCard.tsx`, make these changes:

1. Add import for Skeleton at the top:
```typescript
import { Skeleton } from "@/components/ui/skeleton";
```

2. Change `const { data } = useFetch(` to `const { data, loading } = useFetch(`

3. Replace the entire readings + sparkline section (everything from the `{latest ? (` block through the `{readings.length >= 2 && (` block) with this complete block:

```tsx
{loading && !data && (
  <div className="mt-2 flex flex-col gap-2">
    <Skeleton className="h-4 w-48" />
    <Skeleton className="h-6 w-[200px]" />
  </div>
)}

{data && (
  <>
    {latest ? (
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="tabular-nums">
          <span className="font-semibold">{latest.gravity.toFixed(3)}</span>
          <span className="text-muted-foreground"> SG</span>
        </span>
        {latest.temperature != null && (
          <span className="tabular-nums">
            <span className="font-semibold">{latest.temperature.toFixed(1)}</span>
            <span className="text-muted-foreground">{"\u00B0C"}</span>
          </span>
        )}
        {latest.battery != null && (
          <span className={batteryColor(latest.battery)}>
            {latest.battery.toFixed(0)}% bat
          </span>
        )}
        {latest.rssi != null && (
          <span className={signalLabel(latest.rssi).color}>
            {signalLabel(latest.rssi).text}
          </span>
        )}
        <span className="text-muted-foreground">
          {timeAgo(latest.source_timestamp)}
        </span>
      </div>
    ) : (
      <p className="text-xs text-muted-foreground mt-2">No readings received yet</p>
    )}

    {readings.length >= 2 && (
      <div className="mt-2">
        <GravitySparkline values={readings.map((r) => r.gravity)} width={200} height={24} />
        {readings.some((r) => r.battery != null) && (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-muted-foreground w-6">Bat</span>
            <BatterySparkline
              values={readings.filter((r) => r.battery != null).map((r) => r.battery!)}
              width={160}
              height={16}
            />
          </div>
        )}
        {readings.some((r) => r.rssi != null) && (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-muted-foreground w-6">Sig</span>
            <RssiSparkline
              values={readings.filter((r) => r.rssi != null).map((r) => r.rssi!)}
              width={160}
              height={16}
            />
          </div>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-xs mt-1"
          onClick={() => {
            const slug = device.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            downloadCSV(deviceReadingsToCSV(readings), `${slug}-readings.csv`);
            toast.success(`Downloaded ${readings.length} readings`);
          }}
        >
          Export CSV
        </Button>
      </div>
    )}
  </>
)}
```

This replaces lines from `{latest ? (` through the end of `{readings.length >= 2 && (...)}`. The skeleton shows during initial load; once `data` arrives (even if empty), it shows the real content.

**Step 3: Run dashboard tests**

Run: `cd dashboard && npm test`
Expected: All tests pass. The DeviceCard tests mock `useFetch` via mocked `api.readings.listByDevice` which resolves immediately, so the loading skeleton won't appear in tests.

**Step 4: Commit**

```bash
git add dashboard/src/components/settings/DeviceCard.tsx dashboard/src/components/ui/skeleton.tsx
git commit -m "feat: add loading skeleton to DeviceCard while readings fetch"
```

---

### Task 5: E2E Smoke Tests for Device Features

**Files:**
- Modify: `dashboard/e2e/specs/devices.spec.ts`

**Context:** The existing devices E2E spec tests assignment/unassignment but doesn't verify sparklines or the CSV export button. Add smoke tests that verify these elements render on the Settings page.

The seeded device ("Rapt Pill #1") is assigned to batch #1 and has readings with battery/RSSI data.

**Step 1: Add new tests to devices.spec.ts**

After the existing `unassign and reassign device` test, add:

```typescript
test("shows sparkline SVGs for device with readings", async ({ page }) => {
  // Sparklines render as <svg> elements — there should be at least one (gravity)
  // Wait for readings to load first
  await expect(page.getByText("SG").first()).toBeVisible();
  // Gravity sparkline renders as inline SVG
  await expect(page.locator("svg").first()).toBeVisible();
});

test("shows Export CSV button for device with readings", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
});

test("shows battery and signal sparkline labels", async ({ page }) => {
  // Use exact: true to avoid matching "95% bat" or "Assign"/"Assigned"
  await expect(page.getByText("Bat", { exact: true })).toBeVisible();
  await expect(page.getByText("Sig", { exact: true })).toBeVisible();
});
```

**Step 2: Run E2E tests**

Run: `cd dashboard && E2E_API_KEY=wc-e2etest0000000000000000000000000000000000000000000000000000000000 npx playwright test devices`
Expected: All tests pass (existing 4 + new 3 = 7). If selectors don't match, use Playwright's debugging to inspect the page and adjust.

**Step 3: Commit**

```bash
git add dashboard/e2e/specs/devices.spec.ts
git commit -m "test: add E2E smoke tests for device sparklines and CSV export"
```

---

### Task 6: Final Verification and Push

**Step 1: Run API tests**

Run: `cd api && npm test`
Expected: All 323 pass

**Step 2: Run dashboard unit tests**

Run: `cd dashboard && npm test`
Expected: All pass (135 + ~10 new DeviceCard tests)

**Step 3: Run E2E tests**

Run: `cd dashboard && E2E_API_KEY=wc-e2etest0000000000000000000000000000000000000000000000000000000000 npx playwright test`
Expected: All pass (43 + 3 new = 46)

**Step 4: Push**

```bash
git push
```
