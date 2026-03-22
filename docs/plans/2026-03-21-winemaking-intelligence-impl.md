# Winemaking Intelligence Layer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add stage-aware nudges, a smart timeline, timeline-driven alerts, and cellaring intelligence to the wine cellar app.

**Architecture:** All winemaking domain knowledge lives in pure functions under `api/src/lib/winemaking/`. The API computes nudges and timeline projections on the fly when returning batch data. New batch fields and smarter activity details provide the data foundation. The cron job fires timeline-driven alerts. Cellaring intelligence activates when `bottled_at` is set.

**Tech Stack:** Hono (API), D1/SQLite (DB), Zod (validation), React 19 + Tailwind v4 + shadcn/ui (dashboard), vitest (testing).

**Design doc:** `docs/plans/2026-03-21-winemaking-intelligence-design.md`

---

## Phase 1: Data Foundation

### Task 1: Migration — new batch columns

**Files:**
- Create: `api/migrations/0007_winemaking_intelligence.sql`

**Step 1: Write the migration**

```sql
-- 0007_winemaking_intelligence.sql
-- Add winemaking metadata to batches for intelligence features

ALTER TABLE batches ADD COLUMN yeast_strain TEXT;
ALTER TABLE batches ADD COLUMN oak_type TEXT;
ALTER TABLE batches ADD COLUMN oak_format TEXT;
ALTER TABLE batches ADD COLUMN oak_duration_days INTEGER;
ALTER TABLE batches ADD COLUMN mlf_status TEXT;
ALTER TABLE batches ADD COLUMN bottled_at TEXT;
```

**Step 2: Verify migration loads in test config**

Run: `cd api && npm run test -- --run test/batches.test.ts 2>&1 | head -20`
Expected: tests still pass (migrations auto-apply via `applyMigrations()` which reads all `.sql` files)

**Step 3: Commit**

```bash
git add api/migrations/0007_winemaking_intelligence.sql
git commit -m "feat: add winemaking metadata columns to batches table"
```

---

### Task 2: Schema constants for new fields

**Files:**
- Modify: `api/src/schema.ts`

**Step 1: Write test for new constants**

Create `api/test/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { OAK_TYPES, OAK_FORMATS, MLF_STATUSES } from "../src/schema";

describe("schema constants", () => {
  it("exports OAK_TYPES", () => {
    expect(OAK_TYPES).toContain("none");
    expect(OAK_TYPES).toContain("french");
    expect(OAK_TYPES).toContain("american");
    expect(OAK_TYPES).toContain("hungarian");
  });

  it("exports OAK_FORMATS", () => {
    expect(OAK_FORMATS).toContain("barrel");
    expect(OAK_FORMATS).toContain("chips");
    expect(OAK_FORMATS).toContain("cubes");
    expect(OAK_FORMATS).toContain("staves");
    expect(OAK_FORMATS).toContain("spiral");
  });

  it("exports MLF_STATUSES", () => {
    expect(MLF_STATUSES).toContain("not_planned");
    expect(MLF_STATUSES).toContain("pending");
    expect(MLF_STATUSES).toContain("in_progress");
    expect(MLF_STATUSES).toContain("complete");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run test/schema.test.ts`
Expected: FAIL — `OAK_TYPES` not exported

**Step 3: Add constants to schema.ts**

Add after the `ACTIVITY_TYPES` block (line 29) in `api/src/schema.ts`:

```ts
export const OAK_TYPES = ["none", "american", "french", "hungarian"] as const;
export type OakType = (typeof OAK_TYPES)[number];

export const OAK_FORMATS = ["barrel", "chips", "cubes", "staves", "spiral"] as const;
export type OakFormat = (typeof OAK_FORMATS)[number];

export const MLF_STATUSES = ["not_planned", "pending", "in_progress", "complete"] as const;
export type MlfStatus = (typeof MLF_STATUSES)[number];
```

**Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run test/schema.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add api/src/schema.ts api/test/schema.test.ts
git commit -m "feat: add oak, MLF schema constants"
```

---

### Task 3: API — accept new batch fields on create and update

**Files:**
- Modify: `api/src/models.ts` (BatchCreateSchema, BatchUpdateSchema)
- Modify: `api/src/routes/batches.ts` (INSERT and PATCH SQL)

**Step 1: Write tests for new batch fields**

Add to `api/test/batches.test.ts`:

```ts
describe("winemaking metadata", () => {
  it("creates batch with winemaking fields", async () => {
    const { status, json } = await fetchJson("/api/v1/batches", {
      method: "POST",
      headers: API_HEADERS,
      body: JSON.stringify({
        ...VALID_BATCH,
        yeast_strain: "RC212",
        oak_type: "french",
        oak_format: "barrel",
        oak_duration_days: 180,
        mlf_status: "pending",
      }),
    });
    expect(status).toBe(201);
    expect(json.yeast_strain).toBe("RC212");
    expect(json.oak_type).toBe("french");
    expect(json.oak_format).toBe("barrel");
    expect(json.oak_duration_days).toBe(180);
    expect(json.mlf_status).toBe("pending");
    expect(json.bottled_at).toBeNull();
  });

  it("updates winemaking fields via PATCH", async () => {
    const id = await createBatch();
    const { status, json } = await fetchJson(`/api/v1/batches/${id}`, {
      method: "PATCH",
      headers: API_HEADERS,
      body: JSON.stringify({
        yeast_strain: "EC-1118",
        mlf_status: "in_progress",
      }),
    });
    expect(status).toBe(200);
    expect(json.yeast_strain).toBe("EC-1118");
    expect(json.mlf_status).toBe("in_progress");
  });

  it("rejects invalid oak_type", async () => {
    const { status } = await fetchJson("/api/v1/batches", {
      method: "POST",
      headers: API_HEADERS,
      body: JSON.stringify({ ...VALID_BATCH, oak_type: "bamboo" }),
    });
    expect(status).toBe(422);
  });

  it("rejects invalid mlf_status", async () => {
    const id = await createBatch();
    const { status } = await fetchJson(`/api/v1/batches/${id}`, {
      method: "PATCH",
      headers: API_HEADERS,
      body: JSON.stringify({ mlf_status: "unknown" }),
    });
    expect(status).toBe(422);
  });

  it("sets bottled_at when completing from bottling stage", async () => {
    const id = await createBatch();
    // Advance to bottling
    for (const _ of ["primary_fermentation", "secondary_fermentation", "stabilization", "bottling"]) {
      await fetchJson(`/api/v1/batches/${id}/advance`, { method: "POST", headers: API_HEADERS });
    }
    const { json } = await fetchJson(`/api/v1/batches/${id}/complete`, { method: "POST", headers: API_HEADERS });
    expect(json.bottled_at).toBeTruthy();
    expect(json.status).toBe("completed");
  });

  it("does NOT set bottled_at when completing from non-bottling stage", async () => {
    const id = await createBatch();
    // Complete from must_prep (no advance)
    const { json } = await fetchJson(`/api/v1/batches/${id}/complete`, { method: "POST", headers: API_HEADERS });
    expect(json.bottled_at).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run test/batches.test.ts`
Expected: FAIL — validation rejects unknown fields

**Step 3: Update models.ts**

In `api/src/models.ts`, add imports and fields:

Add to imports (line 2-9):
```ts
import {
  WINE_TYPES,
  SOURCE_MATERIALS,
  BATCH_STATUSES,
  ALL_STAGES,
  BATCH_STAGES,
  ACTIVITY_TYPES,
  OAK_TYPES,
  OAK_FORMATS,
  MLF_STATUSES,
} from "./schema";
```

Add to `BatchCreateSchema` (after `target_gravity` line 20):
```ts
  yeast_strain: z.string().nullable().optional(),
  oak_type: z.enum(OAK_TYPES).nullable().optional(),
  oak_format: z.enum(OAK_FORMATS).nullable().optional(),
  oak_duration_days: z.number().int().nullable().optional(),
  mlf_status: z.enum(MLF_STATUSES).nullable().optional(),
```

Add to `BatchUpdateSchema` (after `target_gravity` line 30):
```ts
  yeast_strain: z.string().nullable().optional(),
  oak_type: z.enum(OAK_TYPES).nullable().optional(),
  oak_format: z.enum(OAK_FORMATS).nullable().optional(),
  oak_duration_days: z.number().int().nullable().optional(),
  mlf_status: z.enum(MLF_STATUSES).nullable().optional(),
```

**Step 4: Update batches.ts — INSERT**

In `api/src/routes/batches.ts`, update the INSERT (lines 26-35):

```ts
  await db
    .prepare(
      `INSERT INTO batches (id, user_id, name, wine_type, source_material, stage, status,
       volume_liters, target_volume_liters, target_gravity,
       yeast_strain, oak_type, oak_format, oak_duration_days, mlf_status,
       started_at, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'must_prep', 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, user.id, b.name, b.wine_type, b.source_material,
      b.volume_liters ?? null, b.target_volume_liters ?? null, b.target_gravity ?? null,
      b.yeast_strain ?? null, b.oak_type ?? null, b.oak_format ?? null,
      b.oak_duration_days ?? null, b.mlf_status ?? null,
      b.started_at, b.notes ?? null, now, now)
    .run();
```

**Step 5: Update batches.ts — PATCH allowedCols**

In `api/src/routes/batches.ts`, update `allowedCols` (line 102):

```ts
  const allowedCols = ["name", "notes", "volume_liters", "target_volume_liters", "target_gravity",
    "yeast_strain", "oak_type", "oak_format", "oak_duration_days", "mlf_status", "status"] as const;
```

**Step 6: Update batches.ts — set bottled_at on complete from bottling stage**

In `api/src/routes/batches.ts`, update the `/complete` endpoint (lines 225-237). Add `bottled_at` logic:

```ts
batches.post("/:batchId/complete", async (c) => {
  const db = c.env.DB;
  const batchId = c.req.param("batchId");
  const row = await getOwnedBatch(db, batchId, c.get("user").id);
  if (!row) return notFound("Batch");
  if (row.status !== "active") return conflict("Only active batches can be completed");

  const now = nowUtc();
  const bottledAt = row.stage === "bottling" ? now : null;
  await db.prepare(
    "UPDATE batches SET status = 'completed', completed_at = ?, bottled_at = COALESCE(?, bottled_at), updated_at = ? WHERE id = ? AND user_id = ?"
  ).bind(now, bottledAt, now, batchId, c.get("user").id).run();
  await unassignDevices(db, batchId, now);
  return c.json(await getOwnedBatch(db, batchId, c.get("user").id));
});
```

Also handle `bottled_at` in the PATCH handler's completion path (lines 111-117). After `updates.completed_at = now;` add:

```ts
    if (row.stage === "bottling") {
      updates.bottled_at = now;
    }
```

**Step 7: Run tests to verify they pass**

Run: `cd api && npx vitest run test/batches.test.ts`
Expected: ALL PASS

**Step 8: Commit**

```bash
git add api/src/models.ts api/src/routes/batches.ts api/test/batches.test.ts
git commit -m "feat: accept winemaking metadata on batch create/update, set bottled_at on complete"
```

---

### Task 4: Dashboard — update types and batch edit form

**Files:**
- Modify: `dashboard/src/types.ts`
- Modify: `dashboard/src/components/BatchForm.tsx`

**Step 1: Update dashboard types**

In `dashboard/src/types.ts`, add to `Batch` interface (after line 31 `target_gravity`):

```ts
  yeast_strain: string | null;
  oak_type: string | null;
  oak_format: string | null;
  oak_duration_days: number | null;
  mlf_status: string | null;
  bottled_at: string | null;
```

Update `Alert` type (line 108) to include new alert types:

```ts
export interface Alert {
  id: string;
  batch_id: string;
  batch_name: string;
  alert_type: string;
  context: string | null;
  fired_at: string;
}
```

Add to `BatchCreate` interface (after `target_gravity` line 120):

```ts
  yeast_strain?: string | null;
  oak_type?: string | null;
  oak_format?: string | null;
  oak_duration_days?: number | null;
  mlf_status?: string | null;
```

Add to `BatchUpdate` interface (after `target_gravity` line 130):

```ts
  yeast_strain?: string | null;
  oak_type?: string | null;
  oak_format?: string | null;
  oak_duration_days?: number | null;
  mlf_status?: string | null;
```

Add label maps after `ACTIVITY_TYPE_LABELS`:

```ts
export const OAK_TYPE_LABELS: Record<string, string> = {
  none: "None",
  american: "American",
  french: "French",
  hungarian: "Hungarian",
};

export const OAK_FORMAT_LABELS: Record<string, string> = {
  barrel: "Barrel",
  chips: "Chips",
  cubes: "Cubes",
  staves: "Staves",
  spiral: "Spiral",
};

export const MLF_STATUS_LABELS: Record<string, string> = {
  not_planned: "Not Planned",
  pending: "Pending",
  in_progress: "In Progress",
  complete: "Complete",
};
```

**Step 2: Update BatchForm to include winemaking fields**

In `dashboard/src/components/BatchForm.tsx`:

Add to `BatchFormData` interface:
```ts
  yeast_strain: string;
  oak_type: string;
  oak_format: string;
  oak_duration_days: string;
  mlf_status: string;
```

Add to initial state defaults (empty strings for new fields).

Add a "Winemaking Details" section in the form — collapsible, after the volume fields. Show only in `editMode` or as an optional expandable section on create:

```tsx
{/* Winemaking Details */}
<details className="space-y-4">
  <summary className="text-sm font-medium cursor-pointer">Winemaking Details (optional)</summary>
  <div className="space-y-4 pt-2">
    <div className="space-y-2">
      <Label>Yeast Strain</Label>
      <Input value={form.yeast_strain} onChange={(e) => setField("yeast_strain", e.target.value)} placeholder="e.g. RC212, EC-1118, 71B" />
    </div>
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label>Oak Type</Label>
        <Select value={form.oak_type || undefined} onValueChange={(v) => setField("oak_type", v)}>
          <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
          <SelectContent>
            {Object.entries(OAK_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Oak Format</Label>
        <Select value={form.oak_format || undefined} onValueChange={(v) => setField("oak_format", v)}>
          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent>
            {Object.entries(OAK_FORMAT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label>Oak Duration (days)</Label>
        <Input type="number" value={form.oak_duration_days} onChange={(e) => setField("oak_duration_days", e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>MLF Status</Label>
        <Select value={form.mlf_status || undefined} onValueChange={(v) => setField("mlf_status", v)}>
          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
          <SelectContent>
            {Object.entries(MLF_STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  </div>
</details>
```

Import `OAK_TYPE_LABELS`, `OAK_FORMAT_LABELS`, `MLF_STATUS_LABELS` from `@/types`.

Update the `handleSubmit` to include the new fields in the API payload.

**Step 3: Update BatchEdit to pass/receive new fields**

In `dashboard/src/pages/BatchEdit.tsx`, update the `handleSubmit` to include new fields and set `initial` prop with batch data for the new fields.

**Step 4: Run dashboard tests**

Run: `cd dashboard && npm run test -- --run`
Expected: PASS (or fix any snapshot/assertion issues)

**Step 5: Run lint**

Run: `cd dashboard && npm run lint`
Expected: no errors

**Step 6: Commit**

```bash
git add dashboard/src/types.ts dashboard/src/components/BatchForm.tsx dashboard/src/pages/BatchEdit.tsx
git commit -m "feat: add winemaking metadata fields to dashboard types and batch form"
```

---

### Task 5: Tasting activity — add structured sensory fields

**Files:**
- Modify: `dashboard/src/components/DetailFields.tsx`
- Modify: `dashboard/src/components/ActivityItem.tsx`

**Step 1: Update DetailFields tasting case**

In `dashboard/src/components/DetailFields.tsx`, replace the `case "tasting"` block (lines 84-100) with:

```tsx
    case "tasting":
      return (
        <>
          <div className="space-y-2">
            <Label>Appearance</Label>
            <Input value={details.appearance ?? ""} onChange={(e) => set("appearance", e.target.value)} placeholder="Clarity, color, viscosity" />
          </div>
          <div className="space-y-2">
            <Label>Aroma</Label>
            <Input value={details.aroma ?? ""} onChange={(e) => set("aroma", e.target.value)} placeholder="Nose characteristics" />
          </div>
          <div className="space-y-2">
            <Label>Palate</Label>
            <Input value={details.palate ?? ""} onChange={(e) => set("palate", e.target.value)} placeholder="Taste, body, tannin, acidity" />
          </div>
          <div className="space-y-2">
            <Label>Finish</Label>
            <Input value={details.finish ?? ""} onChange={(e) => set("finish", e.target.value)} placeholder="Aftertaste length and character" />
          </div>
          <div className="space-y-2">
            <Label>Flavor</Label>
            <Input value={details.flavor ?? ""} onChange={(e) => set("flavor", e.target.value)} placeholder="Overall flavor notes" />
          </div>
          <div className="space-y-2">
            <Label>Overall Score (1-5)</Label>
            <Select value={details.overall_score ?? ""} onValueChange={(v) => v && set("overall_score", v)}>
              <SelectTrigger><SelectValue placeholder="Rate" /></SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </>
      );
```

**Step 2: Update ActivityItem tasting rendering**

In `dashboard/src/components/ActivityItem.tsx`, update the tasting detail rendering to display the new fields (palate, finish, overall_score) alongside existing fields. Render `overall_score` as filled/empty stars or "3/5". Handle both old data (only aroma/flavor/appearance) and new data (all fields) gracefully.

**Step 3: Run dashboard tests and lint**

Run: `cd dashboard && npm run test -- --run && npm run lint`
Expected: PASS

**Step 4: Commit**

```bash
git add dashboard/src/components/DetailFields.tsx dashboard/src/components/ActivityItem.tsx
git commit -m "feat: add structured sensory fields to tasting activities"
```

---

## Phase 2: Nudge Engine & Smart Timeline

### Task 6: Nudge engine — pure functions

**Files:**
- Create: `api/src/lib/winemaking/nudges.ts`
- Create: `api/test/winemaking-nudges.test.ts`

**Step 1: Write tests**

Create `api/test/winemaking-nudges.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateNudges, type NudgeContext } from "../src/lib/winemaking/nudges";

function ctx(overrides: Partial<NudgeContext> = {}): NudgeContext {
  return {
    stage: "must_prep",
    wineType: "red",
    sourceMaterial: "fresh_grapes",
    volumeLiters: 23,
    mlfStatus: null,
    latestGravity: null,
    latestTemp: null,
    totalSo2Additions: 0,
    lastSo2AddedAt: null,
    hasRackingActivity: false,
    ...overrides,
  };
}

describe("nudge engine", () => {
  it("returns SO2 nudge at must_prep", () => {
    const nudges = generateNudges(ctx());
    const so2 = nudges.find((n) => n.id.includes("so2-crushing"));
    expect(so2).toBeTruthy();
    expect(so2!.priority).toBe("action");
    expect(so2!.message).toContain("SO2");
  });

  it("returns measurement reminder at must_prep", () => {
    const nudges = generateNudges(ctx());
    const measure = nudges.find((n) => n.id.includes("initial-measurements"));
    expect(measure).toBeTruthy();
  });

  it("returns punch-down reminder for red in primary", () => {
    const nudges = generateNudges(ctx({ stage: "primary_fermentation" }));
    const punch = nudges.find((n) => n.id.includes("punch-down"));
    expect(punch).toBeTruthy();
  });

  it("does NOT return punch-down for white in primary", () => {
    const nudges = generateNudges(ctx({ stage: "primary_fermentation", wineType: "white" }));
    const punch = nudges.find((n) => n.id.includes("punch-down"));
    expect(punch).toBeUndefined();
  });

  it("returns temp warning when temp exceeds 29C", () => {
    const nudges = generateNudges(ctx({ stage: "primary_fermentation", latestTemp: 31 }));
    const temp = nudges.find((n) => n.id.includes("temp-high"));
    expect(temp).toBeTruthy();
    expect(temp!.priority).toBe("warning");
  });

  it("returns pressing nudge when SG approaches 1.010", () => {
    const nudges = generateNudges(ctx({ stage: "primary_fermentation", latestGravity: 1.012, wineType: "red" }));
    const press = nudges.find((n) => n.id.includes("consider-pressing"));
    expect(press).toBeTruthy();
  });

  it("returns MLF suggestion in secondary when not started", () => {
    const nudges = generateNudges(ctx({ stage: "secondary_fermentation", wineType: "red", mlfStatus: null }));
    const mlf = nudges.find((n) => n.id.includes("mlf-suggestion"));
    expect(mlf).toBeTruthy();
  });

  it("does NOT return MLF suggestion when MLF is in progress", () => {
    const nudges = generateNudges(ctx({ stage: "secondary_fermentation", wineType: "red", mlfStatus: "in_progress" }));
    const mlf = nudges.find((n) => n.id.includes("mlf-suggestion"));
    expect(mlf).toBeUndefined();
  });

  it("returns SO2 reminder at stabilization", () => {
    const nudges = generateNudges(ctx({ stage: "stabilization" }));
    const so2 = nudges.find((n) => n.id.includes("so2-racking"));
    expect(so2).toBeTruthy();
  });

  it("returns bottling checklist at bottling stage", () => {
    const nudges = generateNudges(ctx({ stage: "bottling" }));
    const checklist = nudges.find((n) => n.id.includes("bottling-checklist"));
    expect(checklist).toBeTruthy();
  });

  it("returns no nudges for kits at must_prep (no SO2 at crushing for kits)", () => {
    const nudges = generateNudges(ctx({ sourceMaterial: "kit" }));
    const so2 = nudges.find((n) => n.id.includes("so2-crushing"));
    expect(so2).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run test/winemaking-nudges.test.ts`
Expected: FAIL — module not found

**Step 3: Implement nudge engine**

Create `api/src/lib/winemaking/nudges.ts`:

```ts
export interface Nudge {
  id: string;
  priority: "info" | "warning" | "action";
  message: string;
  detail?: string;
  stage: string;
}

export interface NudgeContext {
  stage: string;
  wineType: string;
  sourceMaterial: string;
  volumeLiters: number | null;
  mlfStatus: string | null;
  latestGravity: number | null;
  latestTemp: number | null;
  totalSo2Additions: number;
  lastSo2AddedAt: string | null;
  hasRackingActivity: boolean;
}

type NudgeEvaluator = (ctx: NudgeContext) => Nudge | null;

// SO2 dose: ~50 ppm = 1/4 tsp per 5 gal = ~1.4g per 5 gal ≈ 0.074g/L
function so2DoseMg(volumeLiters: number | null): string {
  if (!volumeLiters) return "appropriate";
  const grams = volumeLiters * 0.074;
  return `${grams.toFixed(1)}g K-meta`;
}

const evaluators: NudgeEvaluator[] = [
  // Must prep: SO2 at crushing (fresh grapes only)
  (ctx) => {
    if (ctx.stage !== "must_prep" || ctx.sourceMaterial !== "fresh_grapes") return null;
    if (ctx.totalSo2Additions > 0) return null;
    return {
      id: "so2-crushing",
      priority: "action",
      message: `Add SO2 at crushing — ${so2DoseMg(ctx.volumeLiters)} for your ${ctx.volumeLiters ?? "?"}L batch`,
      detail: "Prevents oxidation and inhibits wild yeast. Wait 24 hours before pitching yeast.",
      stage: ctx.stage,
    };
  },

  // Must prep: initial measurements
  (ctx) => {
    if (ctx.stage !== "must_prep") return null;
    return {
      id: "initial-measurements",
      priority: "info",
      message: "Take Brix, TA, and pH readings before pitching yeast",
      detail: "Target: 22-24 Brix for reds, 20-22 for whites. TA: 0.60-0.80 for reds. pH: ~3.4.",
      stage: ctx.stage,
    };
  },

  // Primary: punch down (reds only)
  (ctx) => {
    if (ctx.stage !== "primary_fermentation") return null;
    if (ctx.wineType !== "red" && ctx.wineType !== "rosé") return null;
    return {
      id: "punch-down",
      priority: "info",
      message: "Punch down the cap at least twice daily",
      detail: "Morning and evening. Extracts color and tannin from skins, prevents spoilage on cap surface.",
      stage: ctx.stage,
    };
  },

  // Primary: temp warning
  (ctx) => {
    if (ctx.stage !== "primary_fermentation" || ctx.latestTemp === null) return null;
    if (ctx.latestTemp < 29) return null;
    return {
      id: "temp-high-primary",
      priority: "warning",
      message: `Temperature is ${ctx.latestTemp.toFixed(1)}°C — stay under 29°C to avoid stressing yeast`,
      detail: "Exceeding 30°C risks killing yeast and producing off-flavors. Cool the must with ice bottles or move to a cooler location.",
      stage: ctx.stage,
    };
  },

  // Primary: consider pressing (reds, SG approaching 1.010)
  (ctx) => {
    if (ctx.stage !== "primary_fermentation" || ctx.wineType !== "red") return null;
    if (ctx.latestGravity === null || ctx.latestGravity > 1.020) return null;
    return {
      id: "consider-pressing",
      priority: "action",
      message: "Consider pressing — SG is approaching 1.010",
      detail: "Press when approximately 2/3 of sugar is converted (SG ~1.010-1.020). First free-run juice is highest quality.",
      stage: ctx.stage,
    };
  },

  // Secondary: MLF suggestion (reds, not started)
  (ctx) => {
    if (ctx.stage !== "secondary_fermentation") return null;
    if (ctx.wineType !== "red" && ctx.wineType !== "orange") return null;
    if (ctx.mlfStatus && ctx.mlfStatus !== "pending" && ctx.mlfStatus !== "not_planned") return null;
    // Only suggest if not explicitly declined
    if (ctx.mlfStatus === "not_planned") return null;
    return {
      id: "mlf-suggestion",
      priority: "info",
      message: "MLF not started — consider inoculating if you want softer acidity",
      detail: "Add Leuconostoc bacteria. Do NOT add SO2 until MLF is complete. Keep wine at 18-24°C.",
      stage: ctx.stage,
    };
  },

  // Stabilization: SO2 before racking
  (ctx) => {
    if (ctx.stage !== "stabilization") return null;
    return {
      id: "so2-racking",
      priority: "action",
      message: `Add SO2 before racking — ${so2DoseMg(ctx.volumeLiters)} for your batch`,
      detail: "Add at each racking to prevent oxidation. 1/4 tsp K-meta per 5 gallons (~50 ppm).",
      stage: ctx.stage,
    };
  },

  // Bottling: final checks
  (ctx) => {
    if (ctx.stage !== "bottling") return null;
    return {
      id: "bottling-checklist",
      priority: "action",
      message: "Final checks: SG below 0.998, free SO2 at 25-35 ppm, taste is clean",
      detail: "Verify fermentation is complete (no residual sugar). Add final SO2 dose. Sanitize all bottles and corks.",
      stage: ctx.stage,
    };
  },
];

export function generateNudges(ctx: NudgeContext): Nudge[] {
  const nudges: Nudge[] = [];
  for (const evaluate of evaluators) {
    const nudge = evaluate(ctx);
    if (nudge) nudges.push(nudge);
  }
  return nudges;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run test/winemaking-nudges.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add api/src/lib/winemaking/nudges.ts api/test/winemaking-nudges.test.ts
git commit -m "feat: implement nudge engine with stage-aware winemaking guidance"
```

---

### Task 7: Timeline projection engine — pure functions

**Files:**
- Create: `api/src/lib/winemaking/timeline.ts`
- Create: `api/test/winemaking-timeline.test.ts`

**Step 1: Write tests**

Create `api/test/winemaking-timeline.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { projectTimeline, type TimelineContext } from "../src/lib/winemaking/timeline";

function ctx(overrides: Partial<TimelineContext> = {}): TimelineContext {
  return {
    stage: "primary_fermentation",
    wineType: "red",
    sourceMaterial: "fresh_grapes",
    mlfStatus: null,
    startedAt: "2026-09-25T00:00:00Z",
    velocityPerDay: null,
    latestGravity: null,
    targetGravity: null,
    rackingCount: 0,
    lastRackingAt: null,
    mlfInoculatedAt: null,
    ...overrides,
  };
}

describe("timeline projections", () => {
  it("projects end of primary from velocity", () => {
    const milestones = projectTimeline(ctx({
      latestGravity: 1.050,
      targetGravity: 0.995,
      velocityPerDay: -0.008,
    }));
    const primary = milestones.find((m) => m.label === "End of primary");
    expect(primary).toBeTruthy();
    expect(primary!.confidence).toBe("estimated");
  });

  it("uses typical duration when no velocity data", () => {
    const milestones = projectTimeline(ctx());
    const primary = milestones.find((m) => m.label === "End of primary");
    expect(primary).toBeTruthy();
    expect(primary!.confidence).toBe("rough");
  });

  it("projects racking schedule for reds", () => {
    const milestones = projectTimeline(ctx({ stage: "secondary_fermentation" }));
    const rackings = milestones.filter((m) => m.label.includes("racking"));
    expect(rackings.length).toBeGreaterThanOrEqual(2);
  });

  it("projects MLF completion when in progress", () => {
    const milestones = projectTimeline(ctx({
      stage: "secondary_fermentation",
      mlfStatus: "in_progress",
      mlfInoculatedAt: "2026-10-10T00:00:00Z",
    }));
    const mlf = milestones.find((m) => m.label === "MLF completion");
    expect(mlf).toBeTruthy();
  });

  it("skips MLF when not planned", () => {
    const milestones = projectTimeline(ctx({
      stage: "secondary_fermentation",
      mlfStatus: "not_planned",
    }));
    const mlf = milestones.find((m) => m.label === "MLF completion");
    expect(mlf).toBeUndefined();
  });

  it("marks completed rackings", () => {
    const milestones = projectTimeline(ctx({
      stage: "stabilization",
      rackingCount: 1,
      lastRackingAt: "2026-11-15T00:00:00Z",
    }));
    const first = milestones.find((m) => m.label === "First racking");
    expect(first?.completed).toBe(true);
  });

  it("projects earliest bottling for kit white", () => {
    const milestones = projectTimeline(ctx({
      stage: "stabilization",
      wineType: "white",
      sourceMaterial: "kit",
      rackingCount: 3,
      lastRackingAt: "2026-12-01T00:00:00Z",
    }));
    const bottling = milestones.find((m) => m.label === "Earliest bottling");
    expect(bottling).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run test/winemaking-timeline.test.ts`
Expected: FAIL — module not found

**Step 3: Implement timeline projection engine**

Create `api/src/lib/winemaking/timeline.ts`:

```ts
export interface Milestone {
  label: string;
  estimated_date: string;
  basis: string;
  confidence: "firm" | "estimated" | "rough";
  completed?: boolean;
}

export interface TimelineContext {
  stage: string;
  wineType: string;
  sourceMaterial: string;
  mlfStatus: string | null;
  startedAt: string;
  velocityPerDay: number | null; // SG change per day (negative = dropping)
  latestGravity: number | null;
  targetGravity: number | null;
  rackingCount: number;
  lastRackingAt: string | null;
  mlfInoculatedAt: string | null;
}

const STAGE_ORDER = ["must_prep", "primary_fermentation", "secondary_fermentation", "stabilization", "bottling"];

function addDays(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function isPastStage(current: string, target: string): boolean {
  return STAGE_ORDER.indexOf(current) > STAGE_ORDER.indexOf(target);
}

// Typical primary duration in days
function typicalPrimaryDays(wineType: string, sourceMaterial: string): number {
  if (sourceMaterial === "kit") return 7;
  if (wineType === "white") return 14; // cooler, slower
  return 7; // reds
}

// Months between rackings by racking number
function rackingIntervalDays(rackingNumber: number): number {
  if (rackingNumber === 1) return 0; // immediately after secondary
  if (rackingNumber === 2) return 75; // ~2.5 months
  return 90; // 3 months
}

// Minimum aging after last racking before bottling (days)
function minAgingDays(wineType: string, sourceMaterial: string): number {
  if (sourceMaterial === "kit") return 30;
  if (wineType === "white" || wineType === "rosé") return 90;
  return 180; // full reds
}

export function projectTimeline(ctx: TimelineContext): Milestone[] {
  const milestones: Milestone[] = [];
  const now = new Date().toISOString();

  // -- End of primary --
  let estimatedPrimaryEnd: string;
  let primaryConfidence: "estimated" | "rough" = "rough";

  if (ctx.velocityPerDay && ctx.latestGravity && ctx.velocityPerDay < 0) {
    // Extrapolate from velocity
    const target = ctx.targetGravity ?? 0.995;
    const remaining = ctx.latestGravity - target;
    const daysLeft = Math.max(1, Math.ceil(remaining / Math.abs(ctx.velocityPerDay)));
    estimatedPrimaryEnd = addDays(now, daysLeft);
    primaryConfidence = "estimated";
  } else {
    const days = typicalPrimaryDays(ctx.wineType, ctx.sourceMaterial);
    estimatedPrimaryEnd = addDays(ctx.startedAt, days);
    primaryConfidence = "rough";
  }

  if (!isPastStage(ctx.stage, "primary_fermentation")) {
    milestones.push({
      label: "End of primary",
      estimated_date: estimatedPrimaryEnd,
      basis: primaryConfidence === "estimated"
        ? "Extrapolated from current gravity velocity"
        : `Typical ${typicalPrimaryDays(ctx.wineType, ctx.sourceMaterial)}-day primary for ${ctx.wineType}`,
      confidence: primaryConfidence,
      completed: isPastStage(ctx.stage, "primary_fermentation"),
    });
  }

  // -- MLF completion --
  if (ctx.mlfStatus === "in_progress" && ctx.mlfInoculatedAt) {
    milestones.push({
      label: "MLF completion",
      estimated_date: addDays(ctx.mlfInoculatedAt, 42), // ~6 weeks
      basis: "~6 weeks after inoculation (typical)",
      confidence: "rough",
      completed: ctx.mlfStatus === "complete",
    });
  }

  // -- Racking schedule --
  // Anchor: first racking after secondary completes
  let firstRackingDate = addDays(estimatedPrimaryEnd, 14); // ~2 weeks after primary
  if (ctx.rackingCount >= 1 && ctx.lastRackingAt) {
    firstRackingDate = ctx.lastRackingAt;
  }

  const rackingLabels = ["First racking", "Second racking", "Third racking"];
  let lastRackingDate = firstRackingDate;

  for (let i = 0; i < 3; i++) {
    const rackingDate = i === 0
      ? firstRackingDate
      : addDays(lastRackingDate, rackingIntervalDays(i + 1));
    lastRackingDate = rackingDate;

    milestones.push({
      label: rackingLabels[i],
      estimated_date: rackingDate,
      basis: i === 0
        ? "~2 weeks after primary ends"
        : `${Math.round(rackingIntervalDays(i + 1) / 30)} months after previous racking`,
      confidence: i === 0 && ctx.rackingCount >= 1 ? "firm" : "rough",
      completed: ctx.rackingCount > i,
    });
  }

  // -- Earliest bottling --
  const bottlingDate = addDays(lastRackingDate, minAgingDays(ctx.wineType, ctx.sourceMaterial));
  milestones.push({
    label: "Earliest bottling",
    estimated_date: bottlingDate,
    basis: `${Math.round(minAgingDays(ctx.wineType, ctx.sourceMaterial) / 30)} months after last racking`,
    confidence: "rough",
  });

  return milestones;
}
```

**Step 4: Run tests**

Run: `cd api && npx vitest run test/winemaking-timeline.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add api/src/lib/winemaking/timeline.ts api/test/winemaking-timeline.test.ts
git commit -m "feat: implement timeline projection engine"
```

---

### Task 8: Wire nudges and timeline into batch detail API

**Files:**
- Modify: `api/src/routes/batches.ts` (GET /:batchId)
- Create: `api/src/lib/winemaking/index.ts` (barrel export)

**Step 1: Write test**

Add to `api/test/batches.test.ts`:

```ts
describe("winemaking intelligence on batch detail", () => {
  it("returns nudges array on active batch", async () => {
    const id = await createBatch();
    const { json } = await fetchJson(`/api/v1/batches/${id}`, { headers: API_HEADERS });
    expect(json.nudges).toBeDefined();
    expect(Array.isArray(json.nudges)).toBe(true);
    expect(json.nudges.length).toBeGreaterThan(0);
    // must_prep stage should have measurement nudge
    const measure = json.nudges.find((n: any) => n.id.includes("initial-measurements"));
    expect(measure).toBeTruthy();
  });

  it("returns timeline array on active batch", async () => {
    const id = await createBatch();
    const { json } = await fetchJson(`/api/v1/batches/${id}`, { headers: API_HEADERS });
    expect(json.timeline).toBeDefined();
    expect(Array.isArray(json.timeline)).toBe(true);
  });

  it("does NOT return nudges/timeline on completed batch", async () => {
    const id = await createBatch();
    await fetchJson(`/api/v1/batches/${id}/complete`, { method: "POST", headers: API_HEADERS });
    const { json } = await fetchJson(`/api/v1/batches/${id}`, { headers: API_HEADERS });
    expect(json.nudges).toEqual([]);
    expect(json.timeline).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run test/batches.test.ts`
Expected: FAIL — `json.nudges` undefined

**Step 3: Create barrel export**

Create `api/src/lib/winemaking/index.ts`:

```ts
export { generateNudges, type Nudge, type NudgeContext } from "./nudges";
export { projectTimeline, type Milestone, type TimelineContext } from "./timeline";
```

**Step 4: Update batch detail endpoint**

In `api/src/routes/batches.ts`, modify the GET `/:batchId` handler (lines 68-72). After fetching the batch row, query for activity and reading data needed for the nudge and timeline context, then compute and attach `nudges` and `timeline`:

```ts
batches.get("/:batchId", async (c) => {
  const db = c.env.DB;
  const userId = c.get("user").id;
  const row = await getOwnedBatch(db, c.req.param("batchId"), userId);
  if (!row) return notFound("Batch");

  if (row.status !== "active") {
    return c.json({ ...row, nudges: [], timeline: [] });
  }

  // Gather context for intelligence
  const batchId = row.id as string;

  // Latest reading
  const latestReading = await db.prepare(
    "SELECT gravity, temperature FROM readings WHERE batch_id = ? ORDER BY source_timestamp DESC LIMIT 1"
  ).bind(batchId).first<any>();

  // Count SO2 additions
  const so2Row = await db.prepare(
    `SELECT COUNT(*) as count, MAX(recorded_at) as last_at FROM activities
     WHERE batch_id = ? AND user_id = ? AND type = 'addition'
     AND json_extract(details, '$.chemical') IN ('K2S2O5', 'SO2', 'Campden', 'K-meta', 'Potassium metabisulfite')`
  ).bind(batchId, userId).first<any>();

  // Count rackings
  const rackingRow = await db.prepare(
    `SELECT COUNT(*) as count, MAX(recorded_at) as last_at FROM activities
     WHERE batch_id = ? AND user_id = ? AND type = 'racking'`
  ).bind(batchId, userId).first<any>();

  // MLF inoculation date
  const mlfRow = await db.prepare(
    `SELECT recorded_at FROM activities
     WHERE batch_id = ? AND user_id = ? AND type = 'addition'
     AND json_extract(details, '$.chemical') IN ('MLB', 'Leuconostoc', 'CH16', 'VP41', 'malolactic')
     ORDER BY recorded_at ASC LIMIT 1`
  ).bind(batchId, userId).first<any>();

  // Velocity (reuse existing logic from dashboard route)
  const recentReadings = await db.prepare(
    "SELECT gravity, source_timestamp FROM readings WHERE batch_id = ? ORDER BY source_timestamp DESC LIMIT 10"
  ).bind(batchId).all<any>();

  let velocityPerDay: number | null = null;
  if (recentReadings.results.length >= 2) {
    const newest = recentReadings.results[0];
    const oldest = recentReadings.results[recentReadings.results.length - 1];
    const hoursDiff = (new Date(newest.source_timestamp).getTime() - new Date(oldest.source_timestamp).getTime()) / 3600_000;
    if (hoursDiff > 0) {
      velocityPerDay = ((newest.gravity - oldest.gravity) / hoursDiff) * 24;
    }
  }

  const nudges = generateNudges({
    stage: row.stage as string,
    wineType: row.wine_type as string,
    sourceMaterial: row.source_material as string,
    volumeLiters: row.volume_liters as number | null,
    mlfStatus: row.mlf_status as string | null,
    latestGravity: latestReading?.gravity ?? null,
    latestTemp: latestReading?.temperature ?? null,
    totalSo2Additions: so2Row?.count ?? 0,
    lastSo2AddedAt: so2Row?.last_at ?? null,
    hasRackingActivity: (rackingRow?.count ?? 0) > 0,
  });

  const timeline = projectTimeline({
    stage: row.stage as string,
    wineType: row.wine_type as string,
    sourceMaterial: row.source_material as string,
    mlfStatus: row.mlf_status as string | null,
    startedAt: row.started_at as string,
    velocityPerDay,
    latestGravity: latestReading?.gravity ?? null,
    targetGravity: row.target_gravity as number | null,
    rackingCount: rackingRow?.count ?? 0,
    lastRackingAt: rackingRow?.last_at ?? null,
    mlfInoculatedAt: mlfRow?.recorded_at ?? null,
  });

  return c.json({ ...row, nudges, timeline });
});
```

Add import at top of `api/src/routes/batches.ts`:

```ts
import { generateNudges, projectTimeline } from "../lib/winemaking";
```

**Step 5: Run tests**

Run: `cd api && npx vitest run test/batches.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add api/src/lib/winemaking/index.ts api/src/routes/batches.ts api/test/batches.test.ts
git commit -m "feat: wire nudges and timeline into batch detail API response"
```

---

### Task 9: Dashboard — render nudges on batch detail

**Files:**
- Create: `dashboard/src/components/NudgeBar.tsx`
- Modify: `dashboard/src/pages/BatchDetail.tsx`
- Modify: `dashboard/src/types.ts`

**Step 1: Add Nudge type**

In `dashboard/src/types.ts`, add:

```ts
export interface Nudge {
  id: string;
  priority: "info" | "warning" | "action";
  message: string;
  detail?: string;
  stage: string;
}

export interface Milestone {
  label: string;
  estimated_date: string;
  basis: string;
  confidence: "firm" | "estimated" | "rough";
  completed?: boolean;
}
```

Add to `Batch` interface:
```ts
  nudges?: Nudge[];
  timeline?: Milestone[];
```

**Step 2: Create NudgeBar component**

Create `dashboard/src/components/NudgeBar.tsx`:

```tsx
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Nudge } from "@/types";

const PRIORITY_STYLES = {
  action: "border-l-4 border-l-blue-500 bg-blue-50 dark:bg-blue-950/30",
  warning: "border-l-4 border-l-yellow-500 bg-yellow-50 dark:bg-yellow-950/30",
  info: "border-l-4 border-l-muted-foreground/30",
};

const DISMISSED_KEY = "dismissed-nudges";

function getDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]"));
  } catch { return new Set(); }
}

function dismiss(id: string) {
  const dismissed = getDismissed();
  dismissed.add(id);
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed]));
}

export default function NudgeBar({ nudges }: { nudges: Nudge[] }) {
  const [dismissed, setDismissed] = useState(getDismissed);
  const visible = nudges.filter((n) => !dismissed.has(n.id));
  if (visible.length === 0) return null;

  function handleDismiss(id: string) {
    dismiss(id);
    setDismissed(new Set(dismissed).add(id));
  }

  return (
    <div className="flex flex-col gap-2">
      {visible.map((nudge) => (
        <Card key={nudge.id} className={PRIORITY_STYLES[nudge.priority]}>
          <CardContent className="flex items-start justify-between gap-2 py-3 px-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{nudge.message}</p>
              {nudge.detail && <p className="text-xs text-muted-foreground mt-1">{nudge.detail}</p>}
            </div>
            <Button variant="ghost" size="sm" className="shrink-0 text-xs" onClick={() => handleDismiss(nudge.id)}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

**Step 3: Add NudgeBar to BatchDetail**

In `dashboard/src/pages/BatchDetail.tsx`, import `NudgeBar` and render it above the readings chart when the batch is active and has nudges:

```tsx
{batch.status === "active" && batch.nudges && batch.nudges.length > 0 && (
  <NudgeBar nudges={batch.nudges} />
)}
```

**Step 4: Run tests and lint**

Run: `cd dashboard && npm run test -- --run && npm run lint`
Expected: PASS

**Step 5: Commit**

```bash
git add dashboard/src/components/NudgeBar.tsx dashboard/src/pages/BatchDetail.tsx dashboard/src/types.ts
git commit -m "feat: render stage-aware nudges on batch detail page"
```

---

### Task 10: Dashboard — render timeline on batch detail

**Files:**
- Create: `dashboard/src/components/Timeline.tsx`
- Modify: `dashboard/src/pages/BatchDetail.tsx`

**Step 1: Create Timeline component**

Create `dashboard/src/components/Timeline.tsx`:

```tsx
import type { Milestone } from "@/types";

const CONFIDENCE_LABELS = {
  firm: "",
  estimated: "~",
  rough: "~",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function BatchTimeline({ milestones }: { milestones: Milestone[] }) {
  if (milestones.length === 0) return null;

  return (
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
                {m.completed && "✓ "}{m.label}
              </p>
              <p className="text-xs text-muted-foreground">
                {CONFIDENCE_LABELS[m.confidence]}{formatDate(m.estimated_date)}
                {" · "}{m.basis}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Add to BatchDetail page**

In `dashboard/src/pages/BatchDetail.tsx`, import `BatchTimeline` and render below the readings chart when the batch is active:

```tsx
{batch.status === "active" && batch.timeline && batch.timeline.length > 0 && (
  <Card>
    <CardContent className="py-4">
      <h3 className="text-sm font-semibold mb-4">Projected Timeline</h3>
      <BatchTimeline milestones={batch.timeline} />
    </CardContent>
  </Card>
)}
```

**Step 3: Run tests and lint**

Run: `cd dashboard && npm run test -- --run && npm run lint`
Expected: PASS

**Step 4: Commit**

```bash
git add dashboard/src/components/Timeline.tsx dashboard/src/pages/BatchDetail.tsx
git commit -m "feat: render projected timeline on batch detail page"
```

---

## Phase 3: Timeline-Driven Alerts

### Task 11: Expand alert types in schema and cron

**Files:**
- Modify: `api/migrations/0007_winemaking_intelligence.sql` (add CHECK constraint update)
- Modify: `api/src/lib/alerts.ts` (AlertType union)
- Modify: `api/src/lib/alert-manager.ts` (sendAlertPushes labels)
- Create: `api/src/lib/winemaking/alerts.ts` (timeline alert evaluator)
- Create: `api/test/winemaking-alerts.test.ts`
- Modify: `api/src/cron.ts`

**Step 1: Update migration to drop and recreate CHECK constraint**

D1/SQLite doesn't support altering CHECK constraints directly. Since the constraint is on `alert_type`, and the table was created in migration 0006, add to `0007_winemaking_intelligence.sql`:

```sql
-- Recreate alert_state without the restrictive CHECK constraint on alert_type.
-- D1 SQLite doesn't support ALTER TABLE DROP CONSTRAINT, so we rebuild.
CREATE TABLE alert_state_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  batch_id TEXT NOT NULL REFERENCES batches(id),
  alert_type TEXT NOT NULL,
  context TEXT,
  fired_at TEXT NOT NULL DEFAULT (datetime('now')),
  dismissed_at TEXT,
  resolved_at TEXT
);

INSERT INTO alert_state_new SELECT * FROM alert_state;
DROP TABLE alert_state;
ALTER TABLE alert_state_new RENAME TO alert_state;

CREATE UNIQUE INDEX idx_alert_one_active ON alert_state (user_id, batch_id, alert_type) WHERE resolved_at IS NULL AND dismissed_at IS NULL;
```

**Step 2: Update AlertType**

In `api/src/lib/alerts.ts`, expand the type:

```ts
export type AlertType =
  | "stall" | "no_readings" | "temp_high" | "temp_low" | "stage_suggestion"
  | "racking_due_1" | "racking_due_2" | "racking_due_3"
  | "mlf_check" | "bottling_ready" | "so2_due";
```

**Step 3: Write timeline alert evaluator tests**

Create `api/test/winemaking-alerts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { evaluateTimelineAlerts, type TimelineAlertContext } from "../src/lib/winemaking/alerts";

function ctx(overrides: Partial<TimelineAlertContext> = {}): TimelineAlertContext {
  return {
    batchId: "batch-1",
    batchName: "2026 Merlot",
    rackingCount: 0,
    lastRackingAt: null,
    daysSinceLastSo2: null,
    daysSinceLastRacking: null,
    mlfStatus: null,
    mlfInoculatedAt: null,
    stage: "stabilization",
    estimatedRackingDates: [],
    estimatedBottlingDate: null,
    ...overrides,
  };
}

describe("timeline alert evaluator", () => {
  it("fires racking_due_1 when first racking date has passed", () => {
    const alerts = evaluateTimelineAlerts(ctx({
      rackingCount: 0,
      estimatedRackingDates: ["2026-03-01"],
    }));
    expect(alerts.find((a) => a.type === "racking_due_1")).toBeTruthy();
  });

  it("does NOT fire racking_due_1 when already racked once", () => {
    const alerts = evaluateTimelineAlerts(ctx({
      rackingCount: 1,
      estimatedRackingDates: ["2026-03-01"],
    }));
    expect(alerts.find((a) => a.type === "racking_due_1")).toBeUndefined();
  });

  it("fires so2_due when 42+ days since last SO2", () => {
    const alerts = evaluateTimelineAlerts(ctx({ daysSinceLastSo2: 45 }));
    expect(alerts.find((a) => a.type === "so2_due")).toBeTruthy();
  });

  it("fires mlf_check 28 days after inoculation", () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    const alerts = evaluateTimelineAlerts(ctx({
      mlfStatus: "in_progress",
      mlfInoculatedAt: thirtyDaysAgo,
    }));
    expect(alerts.find((a) => a.type === "mlf_check")).toBeTruthy();
  });

  it("fires bottling_ready when estimated date has passed", () => {
    const alerts = evaluateTimelineAlerts(ctx({
      estimatedBottlingDate: "2026-01-01",
      rackingCount: 3,
    }));
    expect(alerts.find((a) => a.type === "bottling_ready")).toBeTruthy();
  });
});
```

**Step 4: Implement timeline alert evaluator**

Create `api/src/lib/winemaking/alerts.ts`:

```ts
import type { AlertCandidate } from "../alerts";

export interface TimelineAlertContext {
  batchId: string;
  batchName: string;
  rackingCount: number;
  lastRackingAt: string | null;
  daysSinceLastSo2: number | null;
  daysSinceLastRacking: number | null;
  mlfStatus: string | null;
  mlfInoculatedAt: string | null;
  stage: string;
  estimatedRackingDates: string[]; // up to 3 dates
  estimatedBottlingDate: string | null;
}

function isPast(dateStr: string): boolean {
  return new Date(dateStr) <= new Date();
}

function daysSince(dateStr: string): number {
  return (Date.now() - new Date(dateStr).getTime()) / (24 * 3600_000);
}

export function evaluateTimelineAlerts(ctx: TimelineAlertContext): AlertCandidate[] {
  const alerts: AlertCandidate[] = [];

  // Racking due alerts
  const rackingLabels = ["First", "Second", "Third"];
  const rackingTypes = ["racking_due_1", "racking_due_2", "racking_due_3"] as const;
  for (let i = 0; i < ctx.estimatedRackingDates.length && i < 3; i++) {
    if (ctx.rackingCount > i) continue; // already done
    if (!isPast(ctx.estimatedRackingDates[i])) continue;
    alerts.push({
      type: rackingTypes[i],
      message: `${rackingLabels[i]} racking is due for ${ctx.batchName}`,
      context: { message: `${rackingLabels[i]} racking is due for ${ctx.batchName}` },
    });
  }

  // SO2 due (6 weeks = 42 days since last addition)
  if (ctx.daysSinceLastSo2 !== null && ctx.daysSinceLastSo2 >= 42) {
    alerts.push({
      type: "so2_due",
      message: `Consider an SO2 addition for ${ctx.batchName}`,
      context: { message: `Consider an SO2 addition for ${ctx.batchName}`, daysSince: Math.round(ctx.daysSinceLastSo2) },
    });
  }
  // Also fire if racked recently without SO2
  if (ctx.daysSinceLastRacking !== null && ctx.daysSinceLastRacking <= 3 && ctx.daysSinceLastSo2 !== null && ctx.daysSinceLastSo2 > ctx.daysSinceLastRacking) {
    alerts.push({
      type: "so2_due",
      message: `Add SO2 after racking ${ctx.batchName}`,
      context: { message: `Add SO2 after racking ${ctx.batchName}` },
    });
  }

  // MLF check (28 days after inoculation)
  if (ctx.mlfStatus === "in_progress" && ctx.mlfInoculatedAt && daysSince(ctx.mlfInoculatedAt) >= 28) {
    alerts.push({
      type: "mlf_check",
      message: `Check MLF progress on ${ctx.batchName} — test for malic acid`,
      context: { message: `Check MLF progress on ${ctx.batchName} — test for malic acid` },
    });
  }

  // Bottling ready
  if (ctx.estimatedBottlingDate && isPast(ctx.estimatedBottlingDate) && ctx.rackingCount >= 3) {
    alerts.push({
      type: "bottling_ready",
      message: `${ctx.batchName} has reached its earliest bottling window`,
      context: { message: `${ctx.batchName} has reached its earliest bottling window` },
    });
  }

  return alerts;
}
```

**Step 5: Run tests**

Run: `cd api && npx vitest run test/winemaking-alerts.test.ts`
Expected: PASS

**Step 6: Wire into cron**

In `api/src/cron.ts`, import the timeline alert evaluator and the timeline projection engine. After the existing `evaluateAlerts()` call, compute the timeline context and call `evaluateTimelineAlerts()`, then merge the candidates before passing to `processAlerts()`.

Add to `api/src/lib/winemaking/index.ts`:
```ts
export { evaluateTimelineAlerts, type TimelineAlertContext } from "./alerts";
```

**Step 7: Update alert-manager sendAlertPushes**

In `api/src/lib/alert-manager.ts`, update the label map in `sendAlertPushes` to include the new alert types. Use `context.message` as the body if present.

**Step 8: Update dashboard alert rendering**

In `dashboard/src/pages/Dashboard.tsx`, update the `ALERT_LABELS` and `ALERT_COLORS` maps to include the new types, or fall back to `context.message` for unknown types.

**Step 9: Run all API tests**

Run: `cd api && npm run test`
Expected: ALL PASS

**Step 10: Commit**

```bash
git add api/migrations/0007_winemaking_intelligence.sql api/src/lib/alerts.ts api/src/lib/alert-manager.ts api/src/lib/winemaking/alerts.ts api/src/lib/winemaking/index.ts api/src/cron.ts api/test/winemaking-alerts.test.ts dashboard/src/pages/Dashboard.tsx
git commit -m "feat: add timeline-driven alerts (racking, SO2, MLF, bottling)"
```

---

## Phase 4: Cellaring Intelligence

### Task 12: Cellaring engine — pure functions

**Files:**
- Create: `api/src/lib/winemaking/cellaring.ts`
- Create: `api/test/winemaking-cellaring.test.ts`

**Step 1: Write tests**

Create `api/test/winemaking-cellaring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { calculateDrinkWindow, type CellaringContext } from "../src/lib/winemaking/cellaring";

function ctx(overrides: Partial<CellaringContext> = {}): CellaringContext {
  return {
    wineType: "red",
    sourceMaterial: "fresh_grapes",
    bottledAt: "2026-10-01",
    oakType: "french",
    oakDurationDays: 180,
    mlfStatus: "complete",
    totalSo2Ppm: 50,
    finalPh: 3.4,
    finalGravity: 0.994,
    ...overrides,
  };
}

describe("cellaring intelligence", () => {
  it("returns drink window for full red, oaked, MLF complete", () => {
    const result = calculateDrinkWindow(ctx());
    expect(result.readyDate).toBeTruthy();
    expect(result.peakStart).toBeTruthy();
    expect(result.peakEnd).toBeTruthy();
    expect(result.pastPeakDate).toBeTruthy();
    // Full red oaked should have long window
    expect(new Date(result.pastPeakDate).getFullYear()).toBeGreaterThanOrEqual(2033);
  });

  it("shortens window for high pH", () => {
    const normal = calculateDrinkWindow(ctx({ finalPh: 3.4 }));
    const highPh = calculateDrinkWindow(ctx({ finalPh: 3.8 }));
    expect(new Date(highPh.pastPeakDate) < new Date(normal.pastPeakDate)).toBe(true);
  });

  it("shortens window for low SO2", () => {
    const normal = calculateDrinkWindow(ctx({ totalSo2Ppm: 50 }));
    const lowSo2 = calculateDrinkWindow(ctx({ totalSo2Ppm: 20 }));
    expect(new Date(lowSo2.pastPeakDate) < new Date(normal.pastPeakDate)).toBe(true);
  });

  it("extends window for long oak aging", () => {
    const noOak = calculateDrinkWindow(ctx({ oakType: "none", oakDurationDays: 0 }));
    const longOak = calculateDrinkWindow(ctx({ oakDurationDays: 365 }));
    expect(new Date(longOak.pastPeakDate) > new Date(noOak.pastPeakDate)).toBe(true);
  });

  it("gives short window for kit white", () => {
    const result = calculateDrinkWindow(ctx({
      wineType: "white",
      sourceMaterial: "kit",
      oakType: "none",
      oakDurationDays: 0,
      mlfStatus: "not_planned",
    }));
    // Kit white past peak in about 12 months
    const monthsToExpiry = (new Date(result.pastPeakDate).getTime() - new Date("2026-10-01").getTime()) / (30 * 24 * 3600_000);
    expect(monthsToExpiry).toBeLessThan(18);
  });

  it("returns adjustment explanation", () => {
    const result = calculateDrinkWindow(ctx({ finalPh: 3.8 }));
    expect(result.adjustmentNote).toContain("pH");
  });

  it("returns storage note", () => {
    const result = calculateDrinkWindow(ctx());
    expect(result.storageNote).toContain("12");
  });
});
```

**Step 2: Implement cellaring engine**

Create `api/src/lib/winemaking/cellaring.ts`:

```ts
export interface CellaringContext {
  wineType: string;
  sourceMaterial: string;
  bottledAt: string;
  oakType: string | null;
  oakDurationDays: number | null;
  mlfStatus: string | null;
  totalSo2Ppm: number | null;
  finalPh: number | null;
  finalGravity: number | null;
}

export interface DrinkWindow {
  readyDate: string;
  peakStart: string;
  peakEnd: string;
  pastPeakDate: string;
  storageNote: string;
  adjustmentNote: string | null;
}

interface BaseWindow {
  readyMonths: number;
  peakStartMonths: number;
  peakEndMonths: number;
  pastPeakMonths: number;
}

function addMonths(date: string, months: number): string {
  const d = new Date(date);
  d.setMonth(d.getMonth() + Math.round(months));
  return d.toISOString().split("T")[0];
}

function getBaseWindow(wineType: string, sourceMaterial: string, hasOak: boolean): BaseWindow {
  if (sourceMaterial === "kit") {
    if (wineType === "red") return { readyMonths: 3, peakStartMonths: 6, peakEndMonths: 12, pastPeakMonths: 24 };
    return { readyMonths: 1, peakStartMonths: 3, peakEndMonths: 6, pastPeakMonths: 12 };
  }
  if (sourceMaterial === "juice_bucket") {
    if (wineType === "red") return { readyMonths: 3, peakStartMonths: 6, peakEndMonths: 18, pastPeakMonths: 36 };
    return { readyMonths: 2, peakStartMonths: 6, peakEndMonths: 12, pastPeakMonths: 18 };
  }
  // fresh_grapes
  if (wineType === "white" || wineType === "rosé") {
    if (hasOak) return { readyMonths: 6, peakStartMonths: 12, peakEndMonths: 24, pastPeakMonths: 36 };
    return { readyMonths: 3, peakStartMonths: 6, peakEndMonths: 12, pastPeakMonths: 24 };
  }
  // red / orange
  if (hasOak) return { readyMonths: 12, peakStartMonths: 24, peakEndMonths: 60, pastPeakMonths: 120 };
  return { readyMonths: 6, peakStartMonths: 12, peakEndMonths: 36, pastPeakMonths: 60 };
}

export function calculateDrinkWindow(ctx: CellaringContext): DrinkWindow {
  const hasOak = !!ctx.oakType && ctx.oakType !== "none" && (ctx.oakDurationDays ?? 0) > 0;
  const base = getBaseWindow(ctx.wineType, ctx.sourceMaterial, hasOak);

  let multiplier = 1.0;
  let biggestFactor: { factor: string; direction: "shortened" | "extended" } | null = null;
  let biggestMagnitude = 0;

  // Low SO2 — shorten by 25%
  if (ctx.totalSo2Ppm !== null && ctx.totalSo2Ppm < 30) {
    multiplier *= 0.75;
    if (0.25 > biggestMagnitude) {
      biggestMagnitude = 0.25;
      biggestFactor = { factor: `total SO2 was only ${ctx.totalSo2Ppm} ppm at bottling`, direction: "shortened" };
    }
  }

  // High pH — shorten by 20%
  if (ctx.finalPh !== null && ctx.finalPh > 3.6) {
    multiplier *= 0.80;
    if (0.20 > biggestMagnitude) {
      biggestMagnitude = 0.20;
      biggestFactor = { factor: `pH was ${ctx.finalPh} at bottling`, direction: "shortened" };
    }
  }

  // Long oak (> 6 months) — extend by 20%
  if (hasOak && (ctx.oakDurationDays ?? 0) > 180) {
    multiplier *= 1.20;
    if (0.20 > biggestMagnitude) {
      biggestMagnitude = 0.20;
      biggestFactor = { factor: `${Math.round((ctx.oakDurationDays ?? 0) / 30)} months of oak aging`, direction: "extended" };
    }
  }

  // MLF complete — extend by 15% (reds only)
  if (ctx.mlfStatus === "complete" && (ctx.wineType === "red" || ctx.wineType === "orange")) {
    multiplier *= 1.15;
    if (0.15 > biggestMagnitude) {
      biggestMagnitude = 0.15;
      biggestFactor = { factor: "MLF completed", direction: "extended" };
    }
  }

  // Low final gravity — extend slightly (5%)
  if (ctx.finalGravity !== null && ctx.finalGravity < 0.996) {
    multiplier *= 1.05;
  }

  const adjusted = {
    readyMonths: base.readyMonths * multiplier,
    peakStartMonths: base.peakStartMonths * multiplier,
    peakEndMonths: base.peakEndMonths * multiplier,
    pastPeakMonths: base.pastPeakMonths * multiplier,
  };

  const adjustmentNote = biggestFactor
    ? `${biggestFactor.direction === "shortened" ? "Shortened" : "Extended"} slightly — ${biggestFactor.factor}`
    : null;

  return {
    readyDate: addMonths(ctx.bottledAt, adjusted.readyMonths),
    peakStart: addMonths(ctx.bottledAt, adjusted.peakStartMonths),
    peakEnd: addMonths(ctx.bottledAt, adjusted.peakEndMonths),
    pastPeakDate: addMonths(ctx.bottledAt, adjusted.pastPeakMonths),
    storageNote: "Store bottles on their side at 12-16°C in a dark, vibration-free location.",
    adjustmentNote,
  };
}
```

**Step 3: Run tests**

Run: `cd api && npx vitest run test/winemaking-cellaring.test.ts`
Expected: PASS

**Step 4: Export from barrel**

Add to `api/src/lib/winemaking/index.ts`:
```ts
export { calculateDrinkWindow, type DrinkWindow, type CellaringContext } from "./cellaring";
```

**Step 5: Commit**

```bash
git add api/src/lib/winemaking/cellaring.ts api/src/lib/winemaking/index.ts api/test/winemaking-cellaring.test.ts
git commit -m "feat: implement cellaring intelligence engine with drink window calculation"
```

---

### Task 13: Wire cellaring into batch detail API

**Files:**
- Modify: `api/src/routes/batches.ts`

**Step 1: Write test**

Add to `api/test/batches.test.ts`:

```ts
describe("cellaring intelligence", () => {
  it("returns cellaring data for bottled batch", async () => {
    const id = await createBatch({ wine_type: "red", source_material: "fresh_grapes" });
    // Advance to bottling and complete
    for (const _ of [1, 2, 3, 4]) {
      await fetchJson(`/api/v1/batches/${id}/advance`, { method: "POST", headers: API_HEADERS });
    }
    await fetchJson(`/api/v1/batches/${id}/complete`, { method: "POST", headers: API_HEADERS });
    const { json } = await fetchJson(`/api/v1/batches/${id}`, { headers: API_HEADERS });
    expect(json.bottled_at).toBeTruthy();
    expect(json.cellaring).toBeTruthy();
    expect(json.cellaring.readyDate).toBeTruthy();
    expect(json.cellaring.peakStart).toBeTruthy();
    expect(json.cellaring.storageNote).toBeTruthy();
  });

  it("does NOT return cellaring for completed batch without bottled_at", async () => {
    const id = await createBatch();
    await fetchJson(`/api/v1/batches/${id}/complete`, { method: "POST", headers: API_HEADERS });
    const { json } = await fetchJson(`/api/v1/batches/${id}`, { headers: API_HEADERS });
    expect(json.bottled_at).toBeNull();
    expect(json.cellaring).toBeNull();
  });
});
```

**Step 2: Update batch detail endpoint**

In the GET `/:batchId` handler in `api/src/routes/batches.ts`, after the active-batch intelligence block, add cellaring for bottled batches:

```ts
  if (row.status !== "active" && row.bottled_at) {
    // Gather cellaring context
    const lastSo2 = await db.prepare(
      `SELECT json_extract(details, '$.amount') as amount, json_extract(details, '$.unit') as unit
       FROM activities WHERE batch_id = ? AND user_id = ? AND type = 'addition'
       AND json_extract(details, '$.chemical') IN ('K2S2O5', 'SO2', 'Campden', 'K-meta', 'Potassium metabisulfite')
       ORDER BY recorded_at DESC LIMIT 1`
    ).bind(batchId, userId).first<any>();

    const lastPhMeasurement = await db.prepare(
      `SELECT json_extract(details, '$.value') as value FROM activities
       WHERE batch_id = ? AND user_id = ? AND type = 'measurement'
       AND json_extract(details, '$.metric') = 'pH'
       ORDER BY recorded_at DESC LIMIT 1`
    ).bind(batchId, userId).first<any>();

    const lastReading = await db.prepare(
      "SELECT gravity FROM readings WHERE batch_id = ? ORDER BY source_timestamp DESC LIMIT 1"
    ).bind(batchId).first<any>();

    const cellaring = calculateDrinkWindow({
      wineType: row.wine_type as string,
      sourceMaterial: row.source_material as string,
      bottledAt: row.bottled_at as string,
      oakType: row.oak_type as string | null,
      oakDurationDays: row.oak_duration_days as number | null,
      mlfStatus: row.mlf_status as string | null,
      totalSo2Ppm: null, // approximate from additions if needed
      finalPh: lastPhMeasurement?.value ? parseFloat(lastPhMeasurement.value) : null,
      finalGravity: lastReading?.gravity ?? null,
    });

    return c.json({ ...row, nudges: [], timeline: [], cellaring });
  }

  if (row.status !== "active") {
    return c.json({ ...row, nudges: [], timeline: [], cellaring: null });
  }
```

Import `calculateDrinkWindow` from `"../lib/winemaking"`.

**Step 3: Run tests**

Run: `cd api && npx vitest run test/batches.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add api/src/routes/batches.ts api/test/batches.test.ts
git commit -m "feat: wire cellaring intelligence into batch detail API"
```

---

### Task 14: Dashboard — cellaring card

**Files:**
- Create: `dashboard/src/components/CellaringCard.tsx`
- Modify: `dashboard/src/pages/BatchDetail.tsx`
- Modify: `dashboard/src/types.ts`

**Step 1: Add types**

In `dashboard/src/types.ts`:

```ts
export interface DrinkWindow {
  readyDate: string;
  peakStart: string;
  peakEnd: string;
  pastPeakDate: string;
  storageNote: string;
  adjustmentNote: string | null;
}
```

Add to `Batch` interface:
```ts
  cellaring?: DrinkWindow | null;
```

**Step 2: Create CellaringCard**

Create `dashboard/src/components/CellaringCard.tsx`:

```tsx
import { Card, CardContent } from "@/components/ui/card";
import type { DrinkWindow } from "@/types";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function cellaringStatus(window: DrinkWindow): string {
  const now = new Date();
  const ready = new Date(window.readyDate);
  const peakStart = new Date(window.peakStart);
  const peakEnd = new Date(window.peakEnd);
  const pastPeak = new Date(window.pastPeakDate);

  if (now < ready) {
    const months = Math.ceil((ready.getTime() - now.getTime()) / (30 * 24 * 3600_000));
    return `Aging — will be ready to drink in ~${months} month${months === 1 ? "" : "s"}`;
  }
  if (now < peakStart) return "Ready to drink — approaching peak";
  if (now < peakEnd) return "In peak drinking window";
  if (now < pastPeak) return "Past peak — drink soon";
  return "Past recommended drinking window";
}

export default function CellaringCard({ cellaring }: { cellaring: DrinkWindow }) {
  const status = cellaringStatus(cellaring);

  return (
    <Card>
      <CardContent className="py-4 flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Cellaring</h3>

        <div className="flex flex-col gap-1">
          <p className="text-lg font-medium">
            {formatDate(cellaring.peakStart)} – {formatDate(cellaring.peakEnd)}
          </p>
          <p className="text-sm text-muted-foreground">{status}</p>
        </div>

        <p className="text-xs text-muted-foreground">{cellaring.storageNote}</p>

        {cellaring.adjustmentNote && (
          <p className="text-xs text-muted-foreground italic">{cellaring.adjustmentNote}</p>
        )}
      </CardContent>
    </Card>
  );
}
```

**Step 3: Add to BatchDetail**

In `dashboard/src/pages/BatchDetail.tsx`, render `CellaringCard` when `batch.cellaring` is present (completed/bottled batches), in place of where the readings chart would normally go:

```tsx
{batch.cellaring && <CellaringCard cellaring={batch.cellaring} />}
```

**Step 4: Run tests and lint**

Run: `cd dashboard && npm run test -- --run && npm run lint`
Expected: PASS

**Step 5: Run full API test suite**

Run: `cd api && npm run test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add dashboard/src/components/CellaringCard.tsx dashboard/src/pages/BatchDetail.tsx dashboard/src/types.ts
git commit -m "feat: add cellaring card with drink window to batch detail"
```

---

## Final Verification

### Task 15: End-to-end smoke test

**Step 1: Run full API test suite**

Run: `cd api && npm run test`
Expected: ALL PASS

**Step 2: Run full dashboard test suite**

Run: `cd dashboard && npm run test -- --run`
Expected: ALL PASS

**Step 3: Run dashboard build**

Run: `cd dashboard && npm run build`
Expected: successful build, no type errors

**Step 4: Run API lint**

Run: `cd api && npm run lint`
Expected: no type errors

**Step 5: Manual smoke test (if dev servers available)**

Start both dev servers and verify:
- Create a new batch with winemaking fields (yeast, oak, MLF)
- See nudges appear on batch detail
- See timeline appear on batch detail
- Advance batch through stages, check nudges change
- Complete batch from bottling stage, see cellaring card
