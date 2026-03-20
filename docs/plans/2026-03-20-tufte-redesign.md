# Tufte Data-Ink Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply Edward Tufte's data visualization principles across the entire dashboard — maximize data-ink ratio, eliminate chartjunk, integrate text and graphics, strip unnecessary chrome.

**Architecture:** Pure frontend changes across 7 files. Each task is an independent file edit that can run as a parallel subagent. No API changes. No new dependencies. The build (`npm run build` in `dashboard/`) must pass after each task.

**Tech Stack:** React, Tailwind CSS, Recharts, shadcn/ui components

**Tufte Principles Applied:**
1. **Data-ink ratio** — Every pixel should present data. Remove borders, backgrounds, and decorative elements that don't encode information.
2. **No chartjunk** — Remove CartesianGrid, separate legends, rotated axis labels. Direct-label data instead.
3. **Integration of text and graphics** — Sparklines inline with numbers. Labels at data endpoints, not in separate legend blocks.
4. **Information density** — Show more data per pixel. Collapse verbose layouts into dense text flows.
5. **Typography as hierarchy** — Use font weight and size for structure, not borders and boxes.

---

### Task 1: Layout — Strip Global Chrome

**Files:**
- Modify: `dashboard/src/components/Layout.tsx:17-26`

**What to change:**
The global header has a redundant "Disconnect" button (already exists in Settings page). Remove it — the header should be minimal: just the app name and theme toggle. Tufte: remove non-data ink.

**Step 1: Edit Layout.tsx**

Remove the Disconnect button, its handler, and unused imports. The header becomes just the app title + theme toggle.

```tsx
import { Outlet } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import BottomNav from "./BottomNav";
import ThemeToggle from "./ThemeToggle";

export default function Layout() {
  return (
    <div className="min-h-screen bg-background" style={{ paddingBottom: "calc(5rem + env(safe-area-inset-bottom))" }}>
      <header className="flex items-center justify-between px-4 py-3 max-w-lg lg:max-w-3xl mx-auto" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <h1 className="font-heading text-lg tracking-tight text-primary">Wine Cellar</h1>
        <ThemeToggle />
      </header>
      <Outlet />
      <BottomNav />
      <Toaster position="top-center" style={{ top: "env(safe-area-inset-top, 0px)" }} />
    </div>
  );
}
```

**Step 2: Verify build**

Run: `cd dashboard && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add dashboard/src/components/Layout.tsx
git commit -m "tufte: strip redundant Disconnect from global header"
```

---

### Task 2: Dashboard — Dense Summary + Clean Alerts + Tighter Rows

**Files:**
- Modify: `dashboard/src/pages/Dashboard.tsx` (full file)

**What to change:**

1. **SummaryStats** (lines 105-136): Replace the 4-column counter grid with a single dense inline text. "3 batches · 45 L · Day 3–14" conveys the same information in one line instead of a 4-column layout with big numbers and labels beneath.

2. **ALERT_ICONS** (lines 96-101): Remove emoji icons entirely. The color-coded text already encodes the alert type. Emoji is chartjunk — decorative ink that doesn't add information.

3. **AlertsSection** (lines 140-165): Remove the `<span className="text-sm">{ALERT_ICONS[a.type]}</span>` element. Keep the colored batch name + message text.

4. **Section headers** (lines 331, 349): Replace `text-xs font-medium uppercase tracking-wider text-muted-foreground` with `text-sm font-semibold text-foreground`. Uppercase tracking-wider is visual shouting — Tufte would use quiet hierarchy via weight.

5. **BatchRow context line** (lines 234-253): Remove the duplicate velocity text description ("dropping X pts/day" / "rising" / "stable") — this duplicates the "X pts/d" number already shown on line 209. The number IS the information. Also remove the redundant OG → SG text — it's already visible in the sparkline shape.

6. **Activity feed** (lines 357-385): Remove the colored activity-type dots (line 368). The text label on line 378 already identifies the type. The dot is redundant non-data ink.

7. **Stalled badge** (lines 212-216): Replace the `<Badge variant="destructive">` with plain colored text. Badges add a background box, border-radius, and padding around a single word — too much chrome for inline data.

**Step 1: Apply all edits to Dashboard.tsx**

Replace `SummaryStats` component:
```tsx
function SummaryStats({ batches }: { batches: BatchSummary[] }) {
  if (batches.length === 0) return null;

  const totalLiters = batches.reduce((sum, b) => sum + (b.volume_liters ?? 0), 0);
  const minDay = Math.min(...batches.map((b) => b.days_fermenting));
  const maxDay = Math.max(...batches.map((b) => b.days_fermenting));
  const dayRange = minDay === maxDay ? `day ${minDay}` : `day ${minDay}–${maxDay}`;

  return (
    <p className="text-sm tabular-nums py-2 mb-1">
      <span className="font-semibold">{batches.length}</span> {batches.length === 1 ? "batch" : "batches"}
      {totalLiters > 0 && <> · <span className="font-semibold">{totalLiters}</span> L</>}
      {" · "}{dayRange}
    </p>
  );
}
```

Delete the `ALERT_ICONS` constant entirely.

Replace `AlertsSection` — remove icon span:
```tsx
function AlertsSection({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null;

  return (
    <section className="mb-3">
      <h2 className="text-sm font-semibold mb-1">Needs attention</h2>
      <div className="space-y-0.5">
        {alerts.map((a, i) => (
          <Link
            key={`${a.batchId}-${a.type}-${i}`}
            to={`/batches/${a.batchId}`}
            className="flex items-baseline gap-1.5 py-1 -mx-4 px-4 active:bg-accent/50 transition-colors"
          >
            <span className={cn("text-sm font-medium", ALERT_STYLES[a.type])}>
              {a.batchName}
            </span>
            <span className="text-sm text-muted-foreground">{a.message}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
```

Replace section headers from uppercase to quiet weight:
```tsx
<h2 className="text-sm font-semibold mb-1">Active batches</h2>
```
```tsx
<h2 className="text-sm font-semibold mb-1">Recent activity</h2>
```

In `BatchRow`, replace the stalled Badge with plain text:
```tsx
{batch._stalled && (
  <span className="text-xs font-semibold text-destructive">stalled</span>
)}
```

In `BatchRow`, simplify the context line — remove velocity text and OG→SG text:
```tsx
{batch.latest_reading && (
  <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">
    Day {batch.days_fermenting}
    {" · "}
    <span>{relativeTime(batch.latest_reading.source_timestamp)}</span>
  </div>
)}
```

In the activity feed, remove the colored dot:
```tsx
<span className="flex items-baseline gap-1.5 truncate">
  <span className="font-medium">{activity.title}</span>
  <span className="text-muted-foreground">· {activity.batch_name}</span>
</span>
```

Remove unused imports: `Badge`, `ACTIVITY_TYPE_COLORS` constant.

Also reduce section spacing from `mt-8` to `mt-5`:
```tsx
<section className="mt-5">
```

**Step 2: Verify build**

Run: `cd dashboard && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add dashboard/src/pages/Dashboard.tsx
git commit -m "tufte: dense summary, strip emoji/badges/dots, quiet section headers"
```

---

### Task 3: ReadingsChart — Kill Chartjunk, Direct-Label

**Files:**
- Modify: `dashboard/src/components/ReadingsChart.tsx` (lines 105-272)

**What to change:**

1. **CartesianGrid** (line 146): Remove entirely. The data lines are the reference. Grid lines are the #1 example of chartjunk in Tufte's Visual Display of Quantitative Information.

2. **Y-axis labels** (lines 161, 169): Remove the rotated `label={{ value: "SG" }}` and `label={{ value: "°C" }}` props. The tick values (e.g. 1.050, 1.000) make the unit obvious. Rotated text is hard to read and adds visual noise.

3. **X-axis label** — already absent, good.

4. **Section header** (line 108): Change from `font-semibold` to `text-sm font-semibold` for consistency.

5. **Legend block** (lines 244-267): Remove the entire separate legend div. Instead, the data source distinction (device vs manual) is already clear from the line style (solid vs dashed with dots). Temperature is a different color. Tufte: "the data graphic should be self-describing."

6. **Range filter buttons**: Replace `Button` components with lighter `<button>` elements. The full shadcn Button has too much chrome (background, border, padding, hover effects) for a simple toggle.

**Step 1: Apply all edits to ReadingsChart.tsx**

Remove `CartesianGrid` from import and JSX.

Remove `label` prop from both `YAxis` elements:
```tsx
<YAxis
  yAxisId="gravity"
  domain={[0.990, 1.125]}
  tick={tickStyle}
  tickFormatter={(v: number) => v.toFixed(3)}
/>
```
```tsx
<YAxis
  yAxisId="temperature"
  orientation="right"
  domain={["auto", "auto"]}
  tick={tickStyle}
/>
```

Remove the `Button` import and the entire legend div (lines 244-267).

Replace range filter buttons:
```tsx
{readings.length > 0 && (
  <div className="flex gap-1 text-xs">
    {(["7d", "14d", "all"] as const).map((r) => (
      <button
        key={r}
        className={cn(
          "px-2 py-0.5 rounded transition-colors",
          range === r ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
        )}
        onClick={() => setRange(r)}
      >
        {r === "all" ? "All" : r.toUpperCase()}
      </button>
    ))}
  </div>
)}
```

Add `cn` import: `import { cn } from "@/lib/utils";`

**Step 2: Verify build**

Run: `cd dashboard && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add dashboard/src/components/ReadingsChart.tsx
git commit -m "tufte: remove grid, axis labels, legend; lighter range toggles"
```

---

### Task 4: BatchCard — Strip Card Chrome, Inline Metadata

**Files:**
- Modify: `dashboard/src/components/BatchCard.tsx` (full file)

**What to change:**

1. **Card wrapper** (lines 63-94): Remove the `Card`/`CardContent` components. A card with border + padding + background creates a box around each item. In a list, dividers between items provide the same grouping with far less ink. Use a simple div with bottom border.

2. **Badge components** (lines 80-88): Replace the two badge components (status + stage) with plain text. Badges add background color, padding, border-radius — all chrome. Plain text with muted foreground conveys the same information.

3. **Margin hack** (line 79): Remove the `style={{ marginBottom: 12 }}` div wrapper that spaces the two badges.

**Step 1: Rewrite BatchCard.tsx**

```tsx
import { Link } from "react-router-dom";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import { GravitySparkline, TemperatureSparkline } from "@/components/Sparkline";
import { cn } from "@/lib/utils";
import type { Batch } from "@/types";
import { STAGE_LABELS, WINE_TYPE_LABELS, STATUS_LABELS } from "@/types";

const WINE_TYPE_COLORS: Record<string, string> = {
  red: "bg-red-800",
  white: "bg-amber-300",
  "rosé": "bg-pink-400",
  orange: "bg-orange-400",
  sparkling: "bg-yellow-200",
  dessert: "bg-amber-700",
};

function BatchSparkline({ batchId }: { batchId: string }) {
  const { data } = useFetch(
    () => api.readings.listByBatch(batchId, { limit: 100 }),
    [batchId],
  );

  const readings = data?.items.slice().reverse() ?? [];
  if (readings.length === 0) return null;

  if (readings.length === 1) {
    return (
      <p className="text-xs text-muted-foreground mt-1.5 tabular-nums">
        SG {readings[0].gravity.toFixed(3)}
      </p>
    );
  }

  const temps = readings.map((r) => r.temperature).filter((t): t is number => t != null);
  const lastReading = readings[readings.length - 1];

  return (
    <div className="mt-1.5 space-y-0.5">
      <div className="flex items-center gap-2">
        <GravitySparkline values={readings.map((r) => r.gravity)} width={160} height={24} />
        <span className="text-xs tabular-nums text-muted-foreground">
          {lastReading.gravity.toFixed(3)}
        </span>
      </div>
      {temps.length >= 2 && (
        <div className="flex items-center gap-2">
          <TemperatureSparkline values={temps} width={160} height={20} />
          <span className="text-xs tabular-nums text-muted-foreground">
            {temps[temps.length - 1].toFixed(1)}{"\u00B0C"}
          </span>
        </div>
      )}
    </div>
  );
}

export default function BatchCard({ batch }: { batch: Batch }) {
  return (
    <Link to={`/batches/${batch.id}`} className="block py-3 active:bg-accent/50 transition-colors">
      <div className="flex justify-between items-baseline">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className={cn("w-2 h-2 rounded-full shrink-0 translate-y-[-1px]", WINE_TYPE_COLORS[batch.wine_type])} />
          <span className="font-semibold truncate">{batch.name}</span>
        </div>
        <span className="text-xs text-muted-foreground ml-2 shrink-0">
          {STATUS_LABELS[batch.status]} · {STAGE_LABELS[batch.stage]}
        </span>
      </div>
      <p className="text-xs text-muted-foreground tabular-nums mt-0.5">
        {WINE_TYPE_LABELS[batch.wine_type]}
        {batch.volume_liters && <> · {batch.volume_liters} L</>}
        {batch.started_at && <> · Day {Math.floor((Date.now() - new Date(batch.started_at).getTime()) / 86400000)}</>}
      </p>
      <BatchSparkline batchId={batch.id} />
    </Link>
  );
}
```

**Step 2: Update BatchList to use dividers instead of gap**

In `dashboard/src/pages/BatchList.tsx`, change the batch list container from `flex flex-col gap-4` to `divide-y divide-border`:

```tsx
<div className="mt-4 divide-y divide-border">
```

**Step 3: Verify build**

Run: `cd dashboard && npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add dashboard/src/components/BatchCard.tsx dashboard/src/pages/BatchList.tsx
git commit -m "tufte: strip Card chrome from batch list, plain text metadata"
```

---

### Task 5: BatchDetail — Unwrap Snapshot Card, Tighten Spacing

**Files:**
- Modify: `dashboard/src/pages/BatchDetail.tsx:54-143, 280, 292-312`

**What to change:**

1. **BatchSnapshot Card wrapper** (lines 74, 140-141): Remove `<Card>` and `<CardContent>` wrapping. The stat rows stand on their own — the card border is a box that separates data from context. Replace with a simple div.

2. **Header badges** (lines 300-303): Replace Badge components with plain text. Stage and status as lightweight text with middot separator.

3. **Page spacing** (line 280): Reduce `space-y-6` to `space-y-4` — tighter vertical rhythm.

4. **Internal dividers** in snapshot (lines 113, 133): Change thick `border-t` dividers to more subtle spacing.

**Step 1: Apply edits**

In `BatchSnapshot`, replace Card/CardContent with plain div:
```tsx
return (
  <div className="space-y-1">
```
Close with `</div>` instead of `</CardContent></Card>`.

Replace internal border dividers with simple spacing:
```tsx
{/* Batch metadata */}
<div className="pt-1 mt-1" />
```

In the header, replace Badge components:
```tsx
<div className="flex gap-1.5 items-baseline text-sm">
  <span className="text-muted-foreground">{STAGE_LABELS[batch.stage]}</span>
  <span className="text-muted-foreground">·</span>
  <span className="font-medium">{STATUS_LABELS[batch.status]}</span>
</div>
```

Change page container spacing:
```tsx
<div className="p-4 max-w-lg lg:max-w-3xl mx-auto space-y-4">
```

Remove `Card`, `CardContent`, `Badge` imports if no longer used (check LifecycleActions — it doesn't use them, so safe to remove).

**Step 2: Verify build**

Run: `cd dashboard && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add dashboard/src/pages/BatchDetail.tsx
git commit -m "tufte: unwrap snapshot card, plain text badges, tighter spacing"
```

---

### Task 6: BatchComparison — Strip Chart Chrome + Table Card

**Files:**
- Modify: `dashboard/src/pages/BatchComparison.tsx` (lines 120-330)

**What to change:**

1. **CartesianGrid** (line 168): Remove entirely. Same rationale as Task 3.

2. **Y-axis label** (lines 185-190): Remove the rotated "SG" label. Tick values speak for themselves.

3. **X-axis label** (lines 174-179): Remove the "Hours since first reading" label. The tick format `Xh` makes this obvious.

4. **Legend block** (lines 220-236): Remove. The chart lines are already color-coded and the stats table below maps colors to batch names.

5. **Stats table Card wrapper** (lines 248-249, 317-319): Remove `<Card>` and `<CardContent>`. The table's own borders provide structure. A card wrapper is a box around a box.

6. **Page spacing**: Reduce `space-y-6` to `space-y-4`.

**Step 1: Apply all edits**

Remove `CartesianGrid` from import and JSX.

Remove `label` prop from both axes:
```tsx
<XAxis
  dataKey="hours"
  type="number"
  tick={{ fontSize: 10, fill: colors.mutedForeground }}
  tickFormatter={(v: number) => `${Math.round(v)}h`}
/>
<YAxis
  domain={[0.99, 1.125]}
  tick={{ fontSize: 10, fill: colors.mutedForeground }}
  tickFormatter={(v: number) => v.toFixed(3)}
/>
```

Delete the legend div entirely.

Unwrap the stats table — replace `<Card><CardContent className="p-0">` with just `<div>` and close accordingly.

Remove `Card`, `CardContent` imports.

Change page container:
```tsx
<div className="p-4 max-w-lg lg:max-w-3xl mx-auto space-y-4">
```

**Step 2: Verify build**

Run: `cd dashboard && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add dashboard/src/pages/BatchComparison.tsx
git commit -m "tufte: strip chart chrome and card wrapper from comparison page"
```

---

### Task 7: Settings — Strip Card Chrome, Quiet Headers

**Files:**
- Modify: `dashboard/src/pages/Settings.tsx:64-137, 219-239, 268-317`

**What to change:**

1. **DeviceCard Card wrapper** (lines 65-66, 135-136): Remove `<Card>` and `<CardContent>`. Use a simple div with bottom border for list separation.

2. **DeviceCard badges** (lines 75, 82): Replace "Assigned" and "Idle" Badge components with plain colored text.

3. **ConnectionSection Card wrapper** (lines 220-221, 237-238): Remove card chrome. The connection info stands alone.

4. **Section headers** (lines 272, 302): Change from uppercase tracking-wider to quiet `text-sm font-semibold`.

5. **Page spacing**: Reduce `space-y-6` to `space-y-4`.

**Step 1: Apply edits**

In `DeviceCard`, replace Card/CardContent with div:
```tsx
return (
  <div className="py-3">
```

Replace badges with plain text:
```tsx
{device.batch_id ? (
  <>
    <span className="text-xs font-medium text-foreground">Assigned</span>
    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onUnassign(device.id)}>
      Unassign
    </Button>
  </>
) : (
  <>
    <span className="text-xs text-muted-foreground">Idle</span>
    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onAssign(device)}>
      Assign
    </Button>
  </>
)}
```

In `ConnectionSection`, replace Card/CardContent with div:
```tsx
return (
  <div className="space-y-2">
```

Change section headers:
```tsx
<h2 className="text-sm font-semibold mb-2">Sensors</h2>
```
```tsx
<h2 className="text-sm font-semibold mb-2">Connection</h2>
```

Change device list container from `space-y-2` to `divide-y divide-border`.

Change page container:
```tsx
<div className="p-4 max-w-lg lg:max-w-3xl mx-auto space-y-4">
```

Remove `Card`, `CardContent`, `Badge` from imports.

**Step 2: Verify build**

Run: `cd dashboard && npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add dashboard/src/pages/Settings.tsx
git commit -m "tufte: strip card chrome, quiet headers on settings page"
```

---

### Task 8: Final Build Verification

**Step 1: Full build**

Run: `cd dashboard && npm run build`
Expected: exit 0, no errors

**Step 2: Squash commits (optional)**

If the user wants a single commit, squash the 7 task commits into one:

```bash
git rebase -i HEAD~7
# squash all into first, message: "tufte: maximize data-ink ratio across dashboard"
```

---

## Task Dependency Graph

```
Task 1 (Layout)          ─┐
Task 2 (Dashboard)       ─┤
Task 3 (ReadingsChart)   ─┤── all independent, can run in parallel
Task 4 (BatchCard+List)  ─┤
Task 5 (BatchDetail)     ─┤
Task 6 (BatchComparison) ─┤
Task 7 (Settings)        ─┘
                          │
                    Task 8 (verify)
```

Tasks 1–7 touch separate files (no overlap) and can be dispatched as parallel subagents. Task 8 runs after all complete.
