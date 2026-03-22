# Timeline Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the batch timeline show winemaking-relevant context: highlight the current phase with an elapsed/remaining counter, show future milestones as relative time ("in 6 days"), and display aging stages with elapsed duration.

**Architecture:** Add a `currentPhase` object to the batch detail API response, computed server-side from the batch stage and stage-change activity timestamps. Add `date-fns` to the dashboard for relative time formatting. Rework `BatchTimeline` to show current phase prominently and milestones with relative dates. Also replace the hand-rolled `relativeTime` helper in Settings.tsx.

**Tech Stack:** date-fns, Hono, D1, React 19, shadcn/ui Card

---

### Task 1: API — compute currentPhase and add to batch detail

**Files:**
- Modify: `api/src/lib/winemaking/timeline.ts` (add `computeCurrentPhase` function and types)
- Modify: `api/src/lib/winemaking/index.ts` (re-export)
- Modify: `api/src/lib/winemaking/queries.ts` (add `fetchStageEnteredAt` query)
- Modify: `api/src/routes/batches.ts` (add `currentPhase` to detail response)
- Test: `api/test/winemaking-timeline.test.ts`

**Step 1: Write failing tests for computeCurrentPhase**

Add to `api/test/winemaking-timeline.test.ts`:

```typescript
import {
  projectTimeline,
  addDays,
  isPastStage,
  computeCurrentPhase,
  type TimelineContext,
  type CurrentPhaseContext,
} from "../src/lib/winemaking/timeline";

describe("computeCurrentPhase", () => {
  it("returns primary fermentation with estimated total days for red", () => {
    const result = computeCurrentPhase({
      stage: "primary_fermentation",
      wineType: "red",
      sourceMaterial: "fresh_grapes",
      stageEnteredAt: "2026-03-17",
      now: "2026-03-22",
    });
    expect(result.label).toBe("Primary Fermentation");
    expect(result.stage).toBe("primary_fermentation");
    expect(result.daysElapsed).toBe(5);
    expect(result.estimatedTotalDays).toBe(7);
  });

  it("returns 14-day estimate for white primary", () => {
    const result = computeCurrentPhase({
      stage: "primary_fermentation",
      wineType: "white",
      sourceMaterial: "fresh_grapes",
      stageEnteredAt: "2026-03-10",
      now: "2026-03-22",
    });
    expect(result.daysElapsed).toBe(12);
    expect(result.estimatedTotalDays).toBe(14);
  });

  it("returns 7-day estimate for kit primary", () => {
    const result = computeCurrentPhase({
      stage: "primary_fermentation",
      wineType: "white",
      sourceMaterial: "kit",
      stageEnteredAt: "2026-03-20",
      now: "2026-03-22",
    });
    expect(result.estimatedTotalDays).toBe(7);
  });

  it("returns null estimatedTotalDays for stabilization (open-ended)", () => {
    const result = computeCurrentPhase({
      stage: "stabilization",
      wineType: "red",
      sourceMaterial: "fresh_grapes",
      stageEnteredAt: "2026-01-01",
      now: "2026-03-22",
    });
    expect(result.label).toBe("Stabilization & Aging");
    expect(result.daysElapsed).toBe(80);
    expect(result.estimatedTotalDays).toBeNull();
  });

  it("returns secondary fermentation with null estimate", () => {
    const result = computeCurrentPhase({
      stage: "secondary_fermentation",
      wineType: "red",
      sourceMaterial: "fresh_grapes",
      stageEnteredAt: "2026-03-10",
      now: "2026-03-22",
    });
    expect(result.label).toBe("Secondary Fermentation");
    expect(result.daysElapsed).toBe(12);
    expect(result.estimatedTotalDays).toBeNull();
  });

  it("falls back to batch started_at when stageEnteredAt is null", () => {
    const result = computeCurrentPhase({
      stage: "must_prep",
      wineType: "red",
      sourceMaterial: "fresh_grapes",
      stageEnteredAt: null,
      now: "2026-03-22",
      batchStartedAt: "2026-03-20",
    });
    expect(result.daysElapsed).toBe(2);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run test/winemaking-timeline.test.ts -t "computeCurrentPhase"`
Expected: FAIL — `computeCurrentPhase` not exported

**Step 3: Implement computeCurrentPhase**

In `api/src/lib/winemaking/timeline.ts`, add the types and function:

```typescript
export interface CurrentPhaseContext {
  stage: string;
  wineType: string;
  sourceMaterial: string;
  stageEnteredAt: string | null; // ISO date (YYYY-MM-DD)
  now?: string; // ISO date for testing, defaults to today
  batchStartedAt?: string; // fallback if stageEnteredAt is null
}

export interface CurrentPhase {
  label: string;
  stage: string;
  daysElapsed: number;
  estimatedTotalDays: number | null;
}

const STAGE_LABELS: Record<string, string> = {
  must_prep: "Must Preparation",
  primary_fermentation: "Primary Fermentation",
  secondary_fermentation: "Secondary Fermentation",
  stabilization: "Stabilization & Aging",
  bottling: "Bottling",
};

export function computeCurrentPhase(ctx: CurrentPhaseContext): CurrentPhase {
  const now = ctx.now ?? new Date().toISOString().slice(0, 10);
  const enteredAt = ctx.stageEnteredAt ?? ctx.batchStartedAt ?? now;

  const nowMs = new Date(now + "T00:00:00Z").getTime();
  const enteredMs = new Date(enteredAt + "T00:00:00Z").getTime();
  const daysElapsed = Math.floor((nowMs - enteredMs) / 86_400_000);

  let estimatedTotalDays: number | null = null;
  if (ctx.stage === "primary_fermentation") {
    estimatedTotalDays = typicalPrimaryDays(ctx.wineType, ctx.sourceMaterial);
  }

  return {
    label: STAGE_LABELS[ctx.stage] ?? ctx.stage,
    stage: ctx.stage,
    daysElapsed,
    estimatedTotalDays,
  };
}
```

Note: `typicalPrimaryDays` is already defined in the file but is not exported. It can stay private — `computeCurrentPhase` calls it internally.

**Step 4: Export from index.ts**

In `api/src/lib/winemaking/index.ts`, update the timeline export:

```typescript
export { projectTimeline, computeCurrentPhase, addDays, isPastStage, type Milestone, type TimelineContext, type CurrentPhase, type CurrentPhaseContext } from "./timeline";
```

**Step 5: Run tests to verify they pass**

Run: `cd api && npx vitest run test/winemaking-timeline.test.ts`
Expected: All PASS

**Step 6: Add fetchStageEnteredAt query**

In `api/src/lib/winemaking/queries.ts`, add:

```typescript
/** Find when the batch most recently entered its current stage, by looking for stage-change activities. */
export async function fetchStageEnteredAt(
  db: D1Database,
  batchId: string,
  userId: string,
  currentStage: string,
): Promise<string | null> {
  const row = await db.prepare(
    `SELECT recorded_at FROM activities
     WHERE batch_id = ? AND user_id = ? AND type = 'note'
     AND title LIKE '%to ${currentStage}'
     ORDER BY recorded_at DESC LIMIT 1`
  ).bind(batchId, userId).first<{ recorded_at: string }>();
  return row ? row.recorded_at.slice(0, 10) : null;
}
```

Export from `queries.ts` and re-export from `index.ts`.

**Step 7: Wire into batch detail route**

In `api/src/routes/batches.ts`, import `computeCurrentPhase` and `fetchStageEnteredAt`. In the active-batch detail handler (around line 135), after computing `timeline`, add:

```typescript
const stageEnteredAt = await fetchStageEnteredAt(db, batchId, userId, row.stage);

const currentPhase = computeCurrentPhase({
  stage: row.stage,
  wineType: row.wine_type,
  sourceMaterial: row.source_material,
  stageEnteredAt,
  batchStartedAt: startedDate,
});

return c.json({ ...row, nudges, timeline, currentPhase });
```

Also add `currentPhase: null` to the non-active batch response (around line 107):

```typescript
return c.json({ ...row, nudges: [], timeline: [], currentPhase: null, cellaring });
```

**Step 8: Run all API tests**

Run: `cd api && npm run test`
Expected: All PASS (310+ tests)

**Step 9: Commit**

```bash
git add api/src/lib/winemaking/timeline.ts api/src/lib/winemaking/index.ts api/src/lib/winemaking/queries.ts api/src/routes/batches.ts api/test/winemaking-timeline.test.ts
git commit -m "feat: add currentPhase to batch detail for timeline redesign"
```

---

### Task 2: Dashboard — add date-fns and replace hand-rolled relativeTime

**Files:**
- Modify: `dashboard/package.json` (add date-fns)
- Create: `dashboard/src/lib/dates.ts` (shared date formatting helpers)
- Modify: `dashboard/src/pages/Settings.tsx` (replace `relativeTime` with date-fns)

**Step 1: Install date-fns**

Run: `cd dashboard && npm install date-fns`

**Step 2: Create shared date helpers**

Create `dashboard/src/lib/dates.ts`:

```typescript
import { formatDistanceToNow, differenceInDays, parseISO } from "date-fns";

/**
 * Parse a date string that may or may not have a timezone suffix.
 * SQLite datetime('now') returns "2026-03-22 13:41:01" without Z — treat as UTC.
 */
function parseUtc(dateStr: string): Date {
  if (dateStr.endsWith("Z") || dateStr.includes("+")) return parseISO(dateStr);
  return parseISO(dateStr + "Z");
}

/** "3 days ago", "just now", "2 months ago" */
export function timeAgo(dateStr: string): string {
  return formatDistanceToNow(parseUtc(dateStr), { addSuffix: true });
}

/** "in 6 days", "in about 2 months" */
export function timeUntil(dateStr: string): string {
  return formatDistanceToNow(parseUtc(dateStr), { addSuffix: true });
}

/** Number of days between two date strings */
export function daysBetween(from: string, to: string): number {
  return differenceInDays(parseUtc(to), parseUtc(from));
}
```

**Step 3: Replace relativeTime in Settings.tsx**

In `dashboard/src/pages/Settings.tsx`:

1. Add import: `import { timeAgo } from "@/lib/dates";`
2. Delete the entire `relativeTime` function (lines 23-33)
3. Replace all `relativeTime(` calls with `timeAgo(` (should be ~4 occurrences in ApiKeysSection and PasskeysSection)

**Step 4: Verify build**

Run: `cd dashboard && npm run build 2>&1 | tail -5`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add dashboard/package.json dashboard/package-lock.json dashboard/src/lib/dates.ts dashboard/src/pages/Settings.tsx
git commit -m "feat: add date-fns and replace hand-rolled relativeTime"
```

---

### Task 3: Dashboard — add CurrentPhase type

**Files:**
- Modify: `dashboard/src/types.ts` (add CurrentPhase interface, add to Batch)

**Step 1: Add type**

In `dashboard/src/types.ts`, add after the `Milestone` interface:

```typescript
export interface CurrentPhase {
  label: string;
  stage: string;
  daysElapsed: number;
  estimatedTotalDays: number | null;
}
```

Add `currentPhase` to the `Batch` interface:

```typescript
currentPhase?: CurrentPhase | null;
```

**Step 2: Verify types**

Run: `cd dashboard && npx tsc --noEmit`
Expected: Clean

**Step 3: Commit**

```bash
git add dashboard/src/types.ts
git commit -m "feat: add CurrentPhase type to batch interface"
```

---

### Task 4: Dashboard — rework BatchTimeline component

**Files:**
- Modify: `dashboard/src/components/BatchTimeline.tsx`
- Modify: `dashboard/src/pages/BatchDetail.tsx` (pass currentPhase prop)

**Step 1: Rewrite BatchTimeline**

Replace `dashboard/src/components/BatchTimeline.tsx` with:

```typescript
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { timeAgo, timeUntil } from "@/lib/dates";
import type { Milestone, CurrentPhase } from "@/types";

function formatDate(iso: string): string {
  const normalized = iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z";
  return new Date(normalized).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function phaseCounter(phase: CurrentPhase): string {
  if (phase.estimatedTotalDays != null) {
    return `Day ${phase.daysElapsed} of ~${phase.estimatedTotalDays}`;
  }
  if (phase.daysElapsed < 30) {
    return `${phase.daysElapsed} days`;
  }
  const months = Math.floor(phase.daysElapsed / 30);
  return months === 1 ? "1 month" : `${months} months`;
}

export default function BatchTimeline({ milestones, currentPhase }: { milestones: Milestone[]; currentPhase?: CurrentPhase | null }) {
  if (milestones.length === 0 && !currentPhase) return null;

  return (
    <Card>
      <CardContent className="py-4">
        <h3 className="text-sm font-semibold mb-4">Timeline</h3>

        {/* Current phase indicator */}
        {currentPhase && (
          <div className="mb-4 rounded-lg bg-primary/10 px-3 py-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{currentPhase.label}</p>
              <Badge variant="secondary">{phaseCounter(currentPhase)}</Badge>
            </div>
            {currentPhase.estimatedTotalDays != null && (
              <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, (currentPhase.daysElapsed / currentPhase.estimatedTotalDays) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Milestones */}
        <div className="relative pl-6">
          {/* Vertical line */}
          <div className="absolute left-2 top-2 bottom-2 w-px bg-border" />

          <div className="flex flex-col gap-4">
            {milestones.map((m, i) => (
              <div key={i} className="relative">
                {/* Dot */}
                <div className={`absolute -left-4 top-1 h-3 w-3 rounded-full border-2 ${
                  m.completed
                    ? "bg-primary border-primary"
                    : "bg-background border-muted-foreground/40"
                }`} />

                <div className={m.completed ? "opacity-60" : ""}>
                  <p className="text-sm font-medium">
                    {m.completed && "\u2713 "}{m.label}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {m.completed
                      ? formatDate(m.estimated_date)
                      : timeUntil(m.estimated_date + "T00:00:00Z")}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

**Step 2: Update BatchDetail to pass currentPhase**

In `dashboard/src/pages/BatchDetail.tsx`, change:

```typescript
<BatchTimeline milestones={batch.timeline} />
```

to:

```typescript
<BatchTimeline milestones={batch.timeline} currentPhase={batch.currentPhase} />
```

**Step 3: Verify build**

Run: `cd dashboard && npm run build 2>&1 | tail -5`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add dashboard/src/components/BatchTimeline.tsx dashboard/src/pages/BatchDetail.tsx
git commit -m "feat: rework BatchTimeline with current phase and relative dates"
```

---

### Task 5: Full test suite and deploy

**Step 1: Run API tests**

Run: `cd api && npm run test`
Expected: All PASS

**Step 2: Run dashboard tests**

Run: `cd dashboard && npm run test`
Expected: All PASS

**Step 3: Run dashboard build**

Run: `cd dashboard && npm run build`
Expected: Build succeeds

**Step 4: Deploy API**

Run: `cd api && npm run deploy`

**Step 5: Deploy dashboard**

Run: `cd dashboard && npm run build && npx wrangler pages deploy dist --project-name wine-cellar-dashboard`
