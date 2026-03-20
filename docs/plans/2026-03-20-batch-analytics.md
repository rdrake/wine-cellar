# Batch Analytics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add batch comparison charts, stall detection badges, CSV export, and ABV/fermentation stats to the wine cellar dashboard.

**Architecture:** All four features are frontend-only — no new API endpoints needed. Readings, batches, and activities are already queryable. We extract a shared `fermentation.ts` utility for ABV/attenuation/velocity/stall calculations, then build the features on top.

**Tech Stack:** React + TypeScript, Recharts, existing shadcn/ui components, existing `useFetch` hook, existing API client.

---

### Task 1: Extract Fermentation Math Utility

**Files:**
- Create: `dashboard/src/lib/fermentation.ts`
- Modify: `dashboard/src/pages/Dashboard.tsx` (remove inline `apparentAttenuation`)
- Modify: `dashboard/src/pages/BatchDetail.tsx` (remove inline attenuation calc)

**Step 1: Create the utility module**

```typescript
// dashboard/src/lib/fermentation.ts
import type { Reading } from "@/types";

/** ABV estimate from OG and current SG. Standard formula. */
export function abv(og: number, sg: number): number {
  return (og - sg) * 131.25;
}

/** Apparent attenuation %, capped at 100. */
export function attenuation(og: number, sg: number): number {
  if (og <= 1) return 0;
  return Math.min(100, ((og - sg) / (og - 1)) * 100);
}

/** SG velocity: points dropped per day over the given window (negative = dropping). */
export function velocity(readings: Reading[], windowHours = 48): number | null {
  if (readings.length < 2) return null;
  const latest = readings[readings.length - 1];
  const cutoff = new Date(new Date(latest.source_timestamp).getTime() - windowHours * 3600000);
  const oldest = readings.find((r) => new Date(r.source_timestamp) >= cutoff);
  if (!oldest || oldest === latest) return null;
  const days =
    (new Date(latest.source_timestamp).getTime() - new Date(oldest.source_timestamp).getTime()) /
    86400000;
  if (days <= 0) return null;
  return (latest.gravity - oldest.gravity) / days;
}

/** Stall detection. Returns null if not enough data, a reason string if stalled. */
export function detectStall(readings: Reading[]): string | null {
  if (readings.length < 10) return null;
  const v48 = velocity(readings, 48);
  const v7d = velocity(readings, 168);
  if (v48 === null || v7d === null) return null;
  const latest = readings[readings.length - 1];
  // If gravity is already very low, fermentation is likely done
  if (latest.gravity < 0.998) return null;
  // Near-zero movement over 48h while still above FG
  if (Math.abs(v48) < 0.0005 && latest.gravity > 1.005) {
    return "Gravity unchanged for 48+ hours";
  }
  // Significant slowdown: current velocity < 20% of weekly average
  if (v7d !== 0 && Math.abs(v48) < Math.abs(v7d) * 0.2 && latest.gravity > 1.005) {
    return "Velocity dropped to <20% of 7-day average";
  }
  return null;
}

/** Temperature stats from readings. */
export function tempStats(readings: Reading[]): { min: number; max: number; avg: number } | null {
  const temps = readings.map((r) => r.temperature).filter((t): t is number => t != null);
  if (temps.length === 0) return null;
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const avg = temps.reduce((a, b) => a + b, 0) / temps.length;
  return { min, max, avg };
}

/** Days since a given ISO timestamp. */
export function daysSince(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000);
}

/** Projected days to reach target gravity based on current velocity. */
export function projectedDaysToTarget(currentSG: number, targetSG: number, velocityPerDay: number): number | null {
  if (velocityPerDay >= 0) return null; // not dropping
  const remaining = currentSG - targetSG;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / Math.abs(velocityPerDay));
}
```

**Step 2: Update Dashboard.tsx to use utility**

Replace the inline `apparentAttenuation` function at line 8-10 with:
```typescript
import { attenuation } from "@/lib/fermentation";
```
Then replace `apparentAttenuation(og, sg)` call at line 15 with `attenuation(og, sg)`.

**Step 3: Update BatchDetail.tsx to use utility**

Replace the inline attenuation calc at ~line 40:
```typescript
const att = og !== sg ? Math.min(100, ((og - sg) / (og - 1)) * 100) : 0;
```
with:
```typescript
import { attenuation } from "@/lib/fermentation";
// ...
const att = og !== sg ? attenuation(og, sg) : 0;
```

**Step 4: Verify build**

Run: `cd dashboard && npx tsc --noEmit && npm run build`
Expected: Clean build, no errors.

**Step 5: Commit**

```bash
git add dashboard/src/lib/fermentation.ts dashboard/src/pages/Dashboard.tsx dashboard/src/pages/BatchDetail.tsx
git commit -m "refactor: extract fermentation math to shared utility"
```

---

### Task 2: ABV & Fermentation Stats on Batch Detail

**Files:**
- Create: `dashboard/src/components/BatchStats.tsx`
- Modify: `dashboard/src/pages/BatchDetail.tsx` (add BatchStats between SparklineSummary and info Card)

**Step 1: Create BatchStats component**

```typescript
// dashboard/src/components/BatchStats.tsx
import { Card, CardContent } from "@/components/ui/card";
import { abv, attenuation, velocity, tempStats, daysSince, projectedDaysToTarget } from "@/lib/fermentation";
import type { Batch, Reading } from "@/types";

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">
        {value}
        {unit && <span className="text-xs font-normal text-muted-foreground ml-0.5">{unit}</span>}
      </span>
    </div>
  );
}

export default function BatchStats({ batch, readings }: { batch: Batch; readings: Reading[] }) {
  if (readings.length < 2) return null;

  const sorted = [...readings].sort(
    (a, b) => new Date(a.source_timestamp).getTime() - new Date(b.source_timestamp).getTime(),
  );
  const og = sorted[0].gravity;
  const sg = sorted[sorted.length - 1].gravity;
  const currentAbv = abv(og, sg);
  const att = attenuation(og, sg);
  const vel = velocity(sorted);
  const temps = tempStats(sorted);
  const days = daysSince(batch.started_at);
  const proj = vel !== null ? projectedDaysToTarget(sg, 0.996, vel) : null;

  return (
    <Card>
      <CardContent className="p-3 space-y-1">
        <Stat label="Est. ABV" value={currentAbv.toFixed(1)} unit="%" />
        <Stat label="Attenuation" value={att.toFixed(0)} unit="%" />
        <Stat label="OG → SG" value={`${og.toFixed(3)} → ${sg.toFixed(3)}`} />
        {vel !== null && (
          <Stat
            label="Velocity (48h)"
            value={`${vel > 0 ? "+" : ""}${(vel * 1000).toFixed(1)}`}
            unit="pts/day"
          />
        )}
        {proj !== null && proj > 0 && (
          <Stat label="Est. days to 0.996" value={String(proj)} unit="d" />
        )}
        <Stat label="Days fermenting" value={String(days)} />
        {temps && (
          <Stat
            label="Temp range"
            value={`${temps.min.toFixed(1)}–${temps.max.toFixed(1)}`}
            unit="°C"
          />
        )}
        <Stat label="Readings" value={`${sorted.length}`} />
      </CardContent>
    </Card>
  );
}
```

**Step 2: Add BatchStats to BatchDetail page**

In `BatchDetail.tsx`, after the `SparklineSummary` component, add a readings fetch and stats panel. The `SparklineSummary` already fetches readings — refactor to share data.

Modify `BatchDetail.tsx`:

1. Add import: `import BatchStats from "@/components/BatchStats";`
2. Inside the `{batch && ( ... )}` block, after `<SparklineSummary batchId={id!} />` (line 205), add:
```tsx
<BatchStatsSection batch={batch} batchId={id!} />
```
3. Create `BatchStatsSection` inline in the file:
```typescript
function BatchStatsSection({ batch, batchId }: { batch: Batch; batchId: string }) {
  const { data } = useFetch(
    () => api.readings.listByBatch(batchId, { limit: 500 }),
    [batchId],
  );
  const readings = data?.items ?? [];
  return <BatchStats batch={batch} readings={readings} />;
}
```

**Step 3: Verify build**

Run: `cd dashboard && npx tsc --noEmit && npm run build`

**Step 4: Commit**

```bash
git add dashboard/src/components/BatchStats.tsx dashboard/src/pages/BatchDetail.tsx
git commit -m "feat: add fermentation stats panel to batch detail"
```

---

### Task 3: Stall Detection on Dashboard

**Files:**
- Modify: `dashboard/src/pages/Dashboard.tsx` (add stall badge to BatchRow)
- Modify: `api/src/routes/dashboard.ts` (extend BatchSummary with readings array for stall calc)

**Step 1: Add stall detection to Dashboard BatchRow**

The dashboard already has `batch.sparkline` data with gravity values. Add stall detection using the utility.

In `Dashboard.tsx`, import and use:

```typescript
import { attenuation, detectStall } from "@/lib/fermentation";
import { Badge } from "@/components/ui/badge";
```

Inside `BatchRow`, after the velocity display, add stall detection:

```typescript
// Convert sparkline points to pseudo-readings for stall detection
const pseudoReadings = batch.sparkline.map((p) => ({
  gravity: p.g,
  temperature: p.temp,
  source_timestamp: p.t,
} as Reading));
const stallReason = detectStall(pseudoReadings);
```

Then in the JSX, after the velocity text, render:

```tsx
{stallReason && (
  <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
    Stall
  </Badge>
)}
```

**Step 2: Add velocity display to Dashboard BatchRow**

Currently the dashboard shows attenuation but not velocity. Add it:

```tsx
{batch.velocity !== null && batch.velocity !== 0 && (
  <span className="text-xs text-muted-foreground">
    {(batch.velocity * 1000).toFixed(1)} pts/d
  </span>
)}
```

Place this inline with the SG and attenuation % in the gravity sparkline row.

**Step 3: Verify build and deploy**

Run: `cd dashboard && npx tsc --noEmit && npm run build`

**Step 4: Commit**

```bash
git add dashboard/src/pages/Dashboard.tsx
git commit -m "feat: add stall detection badge and velocity to dashboard"
```

---

### Task 4: Batch Comparison Page

**Files:**
- Create: `dashboard/src/pages/BatchComparison.tsx`
- Modify: `dashboard/src/App.tsx` (add route)
- Modify: `dashboard/src/pages/BatchList.tsx` (add "Compare" link)

**Step 1: Create the comparison page**

```typescript
// dashboard/src/pages/BatchComparison.tsx
import { useState, useMemo, useCallback } from "react";
import { api } from "@/api";
import { useFetch } from "@/hooks/useFetch";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { abv, attenuation, velocity } from "@/lib/fermentation";
import type { Batch, Reading } from "@/types";

const COLORS = ["#722F37", "#C5923A", "#2D6A4F", "#5E548E", "#9B2226"];

function useBatchReadings(batchId: string | null) {
  return useFetch(
    useCallback(
      () => (batchId ? api.readings.listByBatch(batchId, { limit: 500 }) : Promise.resolve({ items: [] })),
      [batchId],
    ),
    [batchId],
  );
}

/** Normalize readings to "hours since first reading" for overlay comparison. */
function normalize(readings: Reading[]): { hours: number; gravity: number; temperature: number | null }[] {
  if (readings.length === 0) return [];
  const sorted = [...readings].sort(
    (a, b) => new Date(a.source_timestamp).getTime() - new Date(b.source_timestamp).getTime(),
  );
  const t0 = new Date(sorted[0].source_timestamp).getTime();
  return sorted.map((r) => ({
    hours: (new Date(r.source_timestamp).getTime() - t0) / 3600000,
    gravity: r.gravity,
    temperature: r.temperature,
  }));
}

function ComparisonStats({ batch, readings }: { batch: Batch; readings: Reading[] }) {
  if (readings.length < 2) return null;
  const sorted = [...readings].sort(
    (a, b) => new Date(a.source_timestamp).getTime() - new Date(b.source_timestamp).getTime(),
  );
  const og = sorted[0].gravity;
  const sg = sorted[sorted.length - 1].gravity;
  return (
    <div className="text-xs tabular-nums space-y-0.5">
      <p className="font-medium truncate">{batch.name}</p>
      <p className="text-muted-foreground">
        {og.toFixed(3)} → {sg.toFixed(3)} · {abv(og, sg).toFixed(1)}% · {attenuation(og, sg).toFixed(0)}% att
      </p>
    </div>
  );
}

export default function BatchComparison() {
  const { data: batchesData } = useFetch(() => api.batches.list(), []);
  const batches = batchesData?.items ?? [];

  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  function toggle(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 5 ? [...prev, id] : prev,
    );
  }

  // Fetch readings for each selected batch
  const r0 = useBatchReadings(selectedIds[0] ?? null);
  const r1 = useBatchReadings(selectedIds[1] ?? null);
  const r2 = useBatchReadings(selectedIds[2] ?? null);
  const r3 = useBatchReadings(selectedIds[3] ?? null);
  const r4 = useBatchReadings(selectedIds[4] ?? null);
  const allReadings = [r0, r1, r2, r3, r4];

  // Build normalized data series
  const series = useMemo(() => {
    return selectedIds.map((id, i) => {
      const readings = allReadings[i]?.data?.items ?? [];
      return {
        batch: batches.find((b) => b.id === id)!,
        readings,
        normalized: normalize(readings),
        color: COLORS[i % COLORS.length],
      };
    }).filter((s) => s.batch);
  }, [selectedIds, batches, r0.data, r1.data, r2.data, r3.data, r4.data]);

  // Merge all normalized points into one dataset for Recharts
  const merged = useMemo(() => {
    const map = new Map<number, Record<string, number>>();
    for (const s of series) {
      for (const pt of s.normalized) {
        const key = Math.round(pt.hours * 10) / 10; // round to 0.1h
        const existing = map.get(key) ?? { hours: key };
        existing[s.batch.id] = pt.gravity;
        map.set(key, existing);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.hours - b.hours);
  }, [series]);

  return (
    <div className="p-4 max-w-lg mx-auto space-y-4">
      <h1 className="font-heading text-xl font-bold">Compare Batches</h1>

      {/* Batch selector */}
      <div className="flex flex-wrap gap-1.5">
        {batches.map((b) => {
          const idx = selectedIds.indexOf(b.id);
          const selected = idx >= 0;
          return (
            <Badge
              key={b.id}
              variant={selected ? "default" : "outline"}
              className="cursor-pointer text-xs"
              style={selected ? { backgroundColor: COLORS[idx % COLORS.length] } : undefined}
              onClick={() => toggle(b.id)}
            >
              {b.name}
            </Badge>
          );
        })}
      </div>

      {/* Overlay chart */}
      {merged.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={merged} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="hours"
                    type="number"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v: number) => v < 48 ? `${v.toFixed(0)}h` : `${(v / 24).toFixed(0)}d`}
                    label={{ value: "Time since first reading", position: "insideBottom", offset: -2, style: { fontSize: 10 } }}
                  />
                  <YAxis
                    domain={[0.990, 1.125]}
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v: number) => v.toFixed(3)}
                  />
                  <Tooltip
                    labelFormatter={(v) => {
                      const h = Number(v);
                      return h < 48 ? `${h.toFixed(1)} hours` : `${(h / 24).toFixed(1)} days`;
                    }}
                    formatter={(value: number, name: string) => {
                      const batch = batches.find((b) => b.id === name);
                      return [value.toFixed(4), batch?.name ?? name];
                    }}
                  />
                  {series.map((s) => (
                    <Line
                      key={s.batch.id}
                      dataKey={s.batch.id}
                      stroke={s.color}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ))}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-batch stats */}
      {series.length > 0 && (
        <Card>
          <CardContent className="p-3 space-y-2">
            {series.map((s) => (
              <div key={s.batch.id} className="flex items-start gap-2">
                <span className="w-3 h-3 rounded-full shrink-0 mt-1" style={{ backgroundColor: s.color }} />
                <ComparisonStats batch={s.batch} readings={s.readings} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {selectedIds.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">
          Tap batches above to compare their fermentation curves.
        </p>
      )}
    </div>
  );
}
```

**Step 2: Add route to App.tsx**

Add the import and route:
```typescript
import BatchComparison from "@/pages/BatchComparison";
// Inside routes, after the batches routes:
<Route path="compare" element={<BatchComparison />} />
```

**Step 3: Add Compare link to BatchList or BottomNav**

In `BatchList.tsx`, add a link button at the top:
```tsx
import { Link } from "react-router-dom";
// After the h1 heading:
<Link to="/compare">
  <Button size="sm" variant="outline">Compare</Button>
</Link>
```

**Step 4: Verify build**

Run: `cd dashboard && npx tsc --noEmit && npm run build`

**Step 5: Commit**

```bash
git add dashboard/src/pages/BatchComparison.tsx dashboard/src/App.tsx dashboard/src/pages/BatchList.tsx
git commit -m "feat: add batch comparison page with overlay charts"
```

---

### Task 5: CSV Export

**Files:**
- Create: `dashboard/src/lib/csv.ts`
- Create: `dashboard/src/components/ExportButton.tsx`
- Modify: `dashboard/src/pages/BatchDetail.tsx` (add export button)

**Step 1: Create CSV utility**

```typescript
// dashboard/src/lib/csv.ts

function escapeCSV(value: unknown): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCSV(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCSV).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCSV).join(","));
  }
  return lines.join("\n");
}

export function readingsToCSV(
  readings: { source_timestamp: string; gravity: number; temperature: number | null; source: string }[],
): string {
  return toCSV(
    ["Timestamp", "Gravity", "Temperature_C", "Source"],
    readings.map((r) => [r.source_timestamp, r.gravity, r.temperature, r.source]),
  );
}

export function activitiesToCSV(
  activities: { recorded_at: string; stage: string; type: string; title: string; details: unknown }[],
): string {
  return toCSV(
    ["Timestamp", "Stage", "Type", "Title", "Details"],
    activities.map((a) => [a.recorded_at, a.stage, a.type, a.title, a.details ? JSON.stringify(a.details) : ""]),
  );
}

export function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

**Step 2: Create ExportButton component**

```typescript
// dashboard/src/components/ExportButton.tsx
import { useState } from "react";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { readingsToCSV, activitiesToCSV, downloadCSV } from "@/lib/csv";
import { toast } from "sonner";
import type { Batch } from "@/types";

export default function ExportButton({ batch }: { batch: Batch }) {
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const [readings, activities] = await Promise.all([
        api.readings.listByBatch(batch.id, { limit: 5000 }),
        api.activities.list(batch.id),
      ]);

      const slug = batch.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

      if (readings.items.length > 0) {
        downloadCSV(readingsToCSV(readings.items), `${slug}-readings.csv`);
      }
      if (activities.items.length > 0) {
        downloadCSV(activitiesToCSV(activities.items), `${slug}-activities.csv`);
      }

      toast.success(`Exported ${readings.items.length} readings, ${activities.items.length} activities`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Button size="sm" variant="outline" disabled={exporting} onClick={handleExport}>
      {exporting ? "Exporting..." : "Export CSV"}
    </Button>
  );
}
```

**Step 3: Add ExportButton to BatchDetail**

In `BatchDetail.tsx`, import `ExportButton` and add it in the header area near the Edit button:

```typescript
import ExportButton from "@/components/ExportButton";
```

In the JSX, after the Edit link button (around line 200-201), add:
```tsx
<ExportButton batch={batch} />
```

**Step 4: Verify build**

Run: `cd dashboard && npx tsc --noEmit && npm run build`

**Step 5: Commit**

```bash
git add dashboard/src/lib/csv.ts dashboard/src/components/ExportButton.tsx dashboard/src/pages/BatchDetail.tsx
git commit -m "feat: add CSV export for batch readings and activities"
```

---

### Task 6: Final Integration & Deploy

**Step 1: Full type-check and build**

Run: `cd dashboard && npx tsc --noEmit && npm run build`

**Step 2: Deploy dashboard**

Run: `npx wrangler pages deploy dist --project-name wine-cellar-dashboard`

**Step 3: Final commit with any fixups**

```bash
git add -A
git commit -m "chore: final cleanup for batch analytics features"
```
