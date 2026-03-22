# Winemaking Quality Gaps Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the 4 highest-impact gaps between the winemaking reference knowledge and the dashboard's alerts/nudges to improve wine quality outcomes.

**Architecture:** All changes are in the API's pure-function winemaking modules (`api/src/lib/alerts.ts`, `api/src/lib/winemaking/nudges.ts`) and the cron glue (`api/src/cron.ts`). No database migrations needed. Each feature is independent — add `wineType` to alert context, then three new/enhanced nudges.

**Tech Stack:** TypeScript, Vitest, Hono (Cloudflare Workers)

---

## Task 1: Wine-Type-Aware Temperature Alerts

Temperature alerts currently use a single 30°C high / 8°C low threshold for all wines. White wines fermenting at 25°C lose aromatic quality but get no alert. Reds at 10°C risk stuck fermentation with no warning.

**Thresholds (from Jeff Cox's *From Vines to Wines*):**
- **Reds/orange**: high ≥ 30°C (current), low ≤ 10°C
- **Whites/rosé**: high ≥ 22°C (above 18°C optimal range + buffer), low ≤ 8°C (current)
- **Sparkling/dessert/unknown**: high ≥ 30°C, low ≤ 8°C (safe defaults)

**Files:**
- Modify: `api/src/lib/alerts.ts` (interface + evaluator)
- Modify: `api/src/cron.ts:27-34` (pass wineType)
- Modify: `api/test/alerts.test.ts` (new + updated tests)

### Step 1: Write failing tests for wine-type-aware temp_high

Add these tests after the existing `temp_high` tests (line ~72) in `api/test/alerts.test.ts`:

```typescript
it("fires temp_high for white wine at 22°C", () => {
  const readings = [
    { gravity: 1.05, temperature: 22, source_timestamp: hoursAgo(1) },
  ];
  const result = evaluateAlerts(ctx({ wineType: "white", readings }));
  expect(result.some((a) => a.type === "temp_high")).toBe(true);
});

it("does not fire temp_high for white wine at 21°C", () => {
  const readings = [
    { gravity: 1.05, temperature: 21, source_timestamp: hoursAgo(1) },
  ];
  const result = evaluateAlerts(ctx({ wineType: "white", readings }));
  expect(result.some((a) => a.type === "temp_high")).toBe(false);
});

it("fires temp_high for rosé at 22°C", () => {
  const readings = [
    { gravity: 1.05, temperature: 22, source_timestamp: hoursAgo(1) },
  ];
  const result = evaluateAlerts(ctx({ wineType: "rosé", readings }));
  expect(result.some((a) => a.type === "temp_high")).toBe(true);
});

it("does not fire temp_high for red wine at 29°C", () => {
  const readings = [
    { gravity: 1.05, temperature: 29, source_timestamp: hoursAgo(1) },
  ];
  const result = evaluateAlerts(ctx({ wineType: "red", readings }));
  expect(result.some((a) => a.type === "temp_high")).toBe(false);
});

it("uses 30°C default for unknown wine type", () => {
  const readings = [
    { gravity: 1.05, temperature: 25, source_timestamp: hoursAgo(1) },
  ];
  const result = evaluateAlerts(ctx({ wineType: "sparkling", readings }));
  expect(result.some((a) => a.type === "temp_high")).toBe(false);
});
```

Also add wine-type-aware `temp_low` tests after existing `temp_low` tests (line ~97):

```typescript
it("fires temp_low for red wine at 10°C", () => {
  const readings = [
    { gravity: 1.05, temperature: 10, source_timestamp: hoursAgo(1) },
  ];
  const result = evaluateAlerts(ctx({ wineType: "red", readings }));
  expect(result.some((a) => a.type === "temp_low")).toBe(true);
});

it("does not fire temp_low for red wine at 11°C", () => {
  const readings = [
    { gravity: 1.05, temperature: 11, source_timestamp: hoursAgo(1) },
  ];
  const result = evaluateAlerts(ctx({ wineType: "red", readings }));
  expect(result.some((a) => a.type === "temp_low")).toBe(false);
});

it("does not fire temp_low for white wine at 10°C", () => {
  const readings = [
    { gravity: 1.05, temperature: 10, source_timestamp: hoursAgo(1) },
  ];
  const result = evaluateAlerts(ctx({ wineType: "white", readings }));
  expect(result.some((a) => a.type === "temp_low")).toBe(false);
});
```

Update the `ctx()` helper to include `wineType`:

```typescript
function ctx(overrides: Partial<BatchAlertContext> = {}): BatchAlertContext {
  return {
    batchId: "batch-1",
    userId: "user-1",
    stage: "primary_fermentation",
    wineType: "red",
    targetGravity: null,
    hasAssignedDevice: true,
    readings: [],
    ...overrides,
  };
}
```

### Step 2: Run tests to verify they fail

Run: `cd api && npx vitest run test/alerts.test.ts`

Expected: TypeScript compilation errors — `wineType` does not exist on `BatchAlertContext`.

### Step 3: Add wineType to BatchAlertContext and implement wine-type-aware thresholds

In `api/src/lib/alerts.ts`, add `wineType` to the interface:

```typescript
export interface BatchAlertContext {
  batchId: string;
  userId: string;
  stage: string;
  wineType: string;
  targetGravity: number | null;
  hasAssignedDevice: boolean;
  readings: { gravity: number; temperature: number | null; source_timestamp: string }[];
}
```

Add threshold helper functions before `evaluateAlerts`:

```typescript
function tempHighThreshold(wineType: string): number {
  if (wineType === "white" || wineType === "rosé") return 22;
  return 30;
}

function tempLowThreshold(wineType: string): number {
  if (wineType === "red" || wineType === "orange") return 10;
  return 8;
}
```

Replace the hardcoded temperature checks in `evaluateAlerts`:

```typescript
if (latest.temperature !== null) {
  const highThreshold = tempHighThreshold(ctx.wineType);
  if (latest.temperature >= highThreshold) {
    const reason = highThreshold < 30
      ? `above optimal for ${ctx.wineType} wine (${highThreshold}°C) — risks losing aromatic quality`
      : `above safe threshold (${highThreshold}°C)`;
    alerts.push({
      type: "temp_high",
      message: `Temperature is ${latest.temperature}°C — ${reason}`,
      context: { temperature: latest.temperature },
    });
  }
  const lowThreshold = tempLowThreshold(ctx.wineType);
  if (latest.temperature <= lowThreshold) {
    const reason = lowThreshold > 8
      ? `below safe threshold for ${ctx.wineType} wine (${lowThreshold}°C) — risks stuck fermentation`
      : `below safe threshold (${lowThreshold}°C)`;
    alerts.push({
      type: "temp_low",
      message: `Temperature is ${latest.temperature}°C — ${reason}`,
      context: { temperature: latest.temperature },
    });
  }
}
```

### Step 4: Pass wineType from cron.ts

In `api/src/cron.ts`, update the `BatchAlertContext` construction (line 27-34):

```typescript
const ctx: BatchAlertContext = {
  batchId: batch.id,
  userId: batch.user_id,
  stage: batch.stage,
  wineType: batch.wine_type ?? "red",
  targetGravity: batch.target_gravity,
  hasAssignedDevice: !!device,
  readings: readings.results,
};
```

### Step 5: Update existing tests that broke

The existing `ctx()` helper was updated in Step 1 with `wineType: "red"` default, so existing red-threshold tests (30°C high, 8°C low) remain correct.

The "can produce both temp_high and stall" test (line 302-317) uses temperature 32 which is above 30°C for any wine type — still passes.

The "does not fire temp_high when temperature is 29" test (line 58-64) passes because the default `wineType: "red"` has a 30°C threshold.

### Step 6: Run all tests

Run: `cd api && npm run test`

Expected: All tests pass, including the new wine-type-aware temperature tests.

### Step 7: Commit

```bash
cd api
git add src/lib/alerts.ts src/cron.ts test/alerts.test.ts
git commit -m "feat: wine-type-aware temperature alerts

White/rosé wines alert at 22°C (above aromatic preservation range).
Red/orange wines alert temp_low at 10°C (stuck fermentation risk).
Thresholds from Jeff Cox's From Vines to Wines."
```

---

## Task 2: SO2/MLF Conflict Warning Nudge

Adding SO2 during active MLF kills malolactic bacteria. The dashboard has no guard against this. Add a warning nudge that fires whenever `mlfStatus === "in_progress"`, regardless of stage.

**Files:**
- Modify: `api/src/lib/winemaking/nudges.ts` (new evaluator)
- Modify: `api/test/winemaking-nudges.test.ts` (new tests)

### Step 1: Write failing tests

Add a new `describe` block in `api/test/winemaking-nudges.test.ts` after the `mlf-suggestion` block (after line 192):

```typescript
describe("so2-mlf-warning", () => {
  it("warns when MLF is in progress during secondary fermentation", () => {
    const nudges = generateNudges(
      makeContext({ stage: "secondary_fermentation", wineType: "red", mlfStatus: "in_progress" })
    );
    const nudge = findNudge(nudges, "so2-mlf-warning");
    expect(nudge).not.toBeNull();
    expect(nudge!.priority).toBe("warning");
    expect(nudge!.message).toContain("SO2");
    expect(nudge!.message).toContain("MLF");
  });

  it("warns when MLF is in progress during stabilization", () => {
    const nudges = generateNudges(
      makeContext({ stage: "stabilization", wineType: "red", mlfStatus: "in_progress" })
    );
    expect(findNudge(nudges, "so2-mlf-warning")).not.toBeNull();
  });

  it("does not warn when MLF is complete", () => {
    const nudges = generateNudges(
      makeContext({ stage: "secondary_fermentation", wineType: "red", mlfStatus: "complete" })
    );
    expect(findNudge(nudges, "so2-mlf-warning")).toBeNull();
  });

  it("does not warn when MLF is not planned", () => {
    const nudges = generateNudges(
      makeContext({ stage: "secondary_fermentation", wineType: "red", mlfStatus: "not_planned" })
    );
    expect(findNudge(nudges, "so2-mlf-warning")).toBeNull();
  });

  it("does not warn when mlfStatus is null", () => {
    const nudges = generateNudges(
      makeContext({ stage: "secondary_fermentation", wineType: "red", mlfStatus: null })
    );
    expect(findNudge(nudges, "so2-mlf-warning")).toBeNull();
  });
});
```

### Step 2: Run tests to verify they fail

Run: `cd api && npx vitest run test/winemaking-nudges.test.ts`

Expected: FAIL — `so2-mlf-warning` nudge not found (returns null).

### Step 3: Implement the SO2/MLF warning nudge

In `api/src/lib/winemaking/nudges.ts`, add the new evaluator function after `mlfSuggestion` (after line 109):

```typescript
function so2MlfWarning(ctx: NudgeContext): Nudge | null {
  if (ctx.mlfStatus !== "in_progress") return null;

  return {
    id: "so2-mlf-warning",
    priority: "warning",
    message: "Do not add SO2 while MLF is in progress — it will kill the malolactic bacteria",
    stage: ctx.stage,
  };
}
```

Add `so2MlfWarning` to the `evaluators` array:

```typescript
const evaluators: Evaluator[] = [
  so2Crushing,
  initialMeasurements,
  punchDown,
  tempHighPrimary,
  considerPressing,
  mlfSuggestion,
  so2MlfWarning,
  so2Racking,
  bottlingChecklist,
];
```

### Step 4: Run tests

Run: `cd api && npx vitest run test/winemaking-nudges.test.ts`

Expected: All tests pass.

### Step 5: Verify stage isolation test still passes

The `so2MlfWarning` nudge uses `ctx.stage` for its `stage` field, so the "stage isolation" test (line 219-228) which checks that all nudges at bottling stage have `stage === "bottling"` will still pass — `so2MlfWarning` only fires when `mlfStatus === "in_progress"`, which won't be the case at bottling.

### Step 6: Commit

```bash
cd api
git add src/lib/winemaking/nudges.ts test/winemaking-nudges.test.ts
git commit -m "feat: warn against SO2 additions during active MLF

New nudge fires when mlfStatus is 'in_progress' to prevent
killing malolactic bacteria with sulfite additions."
```

---

## Task 3: Enhanced Pressing Nudge with Skin Contact Guidance

The existing `considerPressing` nudge fires for reds at SG < 1.02 but gives no skin contact timing guidance. Enhance it with a `detail` field, and add a rosé-specific pressing nudge (rosé presses by color/time, not gravity).

**Thresholds (from Jeff Cox):**
- Red light/fruity: 3–5 days skin contact
- Red full-bodied: 7–10 days
- Rosé: 6–24 hours skin contact

**Files:**
- Modify: `api/src/lib/winemaking/nudges.ts` (enhance existing + add rosé)
- Modify: `api/test/winemaking-nudges.test.ts` (new tests)

### Step 1: Write failing tests

Add detail test to the existing `consider-pressing` describe block in `api/test/winemaking-nudges.test.ts` (after line 144):

```typescript
it("includes skin contact guidance in detail for red", () => {
  const nudges = generateNudges(
    makeContext({ stage: "primary_fermentation", wineType: "red", latestGravity: 1.015 })
  );
  const nudge = findNudge(nudges, "consider-pressing");
  expect(nudge).not.toBeNull();
  expect(nudge!.detail).toBeDefined();
  expect(nudge!.detail).toContain("skin contact");
});
```

Add a new `describe` block for rosé pressing after the `consider-pressing` block:

```typescript
describe("consider-pressing-rose", () => {
  it("suggests pressing for rosé during primary fermentation", () => {
    const nudges = generateNudges(
      makeContext({ stage: "primary_fermentation", wineType: "rosé" })
    );
    const nudge = findNudge(nudges, "consider-pressing-rose");
    expect(nudge).not.toBeNull();
    expect(nudge!.priority).toBe("info");
    expect(nudge!.message).toContain("6–24 hours");
  });

  it("does not show rosé pressing nudge for red wine", () => {
    const nudges = generateNudges(
      makeContext({ stage: "primary_fermentation", wineType: "red" })
    );
    expect(findNudge(nudges, "consider-pressing-rose")).toBeNull();
  });

  it("does not show rosé pressing nudge outside primary fermentation", () => {
    const nudges = generateNudges(
      makeContext({ stage: "secondary_fermentation", wineType: "rosé" })
    );
    expect(findNudge(nudges, "consider-pressing-rose")).toBeNull();
  });
});
```

### Step 2: Run tests to verify they fail

Run: `cd api && npx vitest run test/winemaking-nudges.test.ts`

Expected: FAIL — `detail` is undefined on `consider-pressing`, `consider-pressing-rose` not found.

### Step 3: Implement

In `api/src/lib/winemaking/nudges.ts`, update `considerPressing` to include a `detail`:

```typescript
function considerPressing(ctx: NudgeContext): Nudge | null {
  if (ctx.stage !== "primary_fermentation") return null;
  if (ctx.wineType !== "red") return null;
  if (ctx.latestGravity == null || ctx.latestGravity > 1.02) return null;

  return {
    id: "consider-pressing",
    priority: "action",
    message: "Consider pressing — SG is approaching 1.010",
    detail: "Typical skin contact: 5–7 days for a balanced red, 3–5 days for light/fruity, 7–10 days for full-bodied.",
    stage: ctx.stage,
  };
}
```

Add a new rosé pressing evaluator after `considerPressing`:

```typescript
function considerPressingRose(ctx: NudgeContext): Nudge | null {
  if (ctx.stage !== "primary_fermentation") return null;
  if (ctx.wineType !== "rosé") return null;

  return {
    id: "consider-pressing-rose",
    priority: "info",
    message: "Press after 6–24 hours of skin contact, depending on desired color depth",
    stage: ctx.stage,
  };
}
```

Add `considerPressingRose` to the `evaluators` array after `considerPressing`:

```typescript
const evaluators: Evaluator[] = [
  so2Crushing,
  initialMeasurements,
  punchDown,
  tempHighPrimary,
  considerPressing,
  considerPressingRose,
  mlfSuggestion,
  so2MlfWarning,
  so2Racking,
  bottlingChecklist,
];
```

### Step 4: Run tests

Run: `cd api && npx vitest run test/winemaking-nudges.test.ts`

Expected: All tests pass.

### Step 5: Commit

```bash
cd api
git add src/lib/winemaking/nudges.ts test/winemaking-nudges.test.ts
git commit -m "feat: skin contact guidance for pressing nudges

Red pressing nudge now includes duration guidance (3-10 days by style).
New rosé pressing nudge advises 6-24 hours based on color depth."
```

---

## Task 4: Enhanced Pre-Bottling Checklist with pH/TA Validation

The bottling checklist nudge currently checks SG, free SO2, and taste. Missing: pH target range (3.2–3.6, above 3.6 = spoilage risk) and TA ranges (wine-type-specific). Add these to the checklist message with wine-type-aware TA guidance.

**Thresholds (from Jeff Cox):**
- pH: 3.2–3.6 (above 3.6 increases spoilage risk)
- TA for reds: 0.60–0.80 g/100mL
- TA for whites: 0.65–0.85 g/100mL

**Files:**
- Modify: `api/src/lib/winemaking/nudges.ts` (enhance bottling checklist)
- Modify: `api/test/winemaking-nudges.test.ts` (update existing + new tests)

### Step 1: Write failing tests

Update the existing `bottling-checklist` test and add new ones in `api/test/winemaking-nudges.test.ts` (around line 206-217):

```typescript
describe("bottling-checklist", () => {
  it("shows bottling checklist at bottling stage", () => {
    const nudges = generateNudges(
      makeContext({ stage: "bottling" })
    );
    const nudge = findNudge(nudges, "bottling-checklist");
    expect(nudge).not.toBeNull();
    expect(nudge!.priority).toBe("action");
    expect(nudge!.message).toContain("SG below 0.998");
    expect(nudge!.message).toContain("SO2");
    expect(nudge!.message).toContain("pH");
  });

  it("includes red TA range for red wine", () => {
    const nudges = generateNudges(
      makeContext({ stage: "bottling", wineType: "red" })
    );
    const nudge = findNudge(nudges, "bottling-checklist");
    expect(nudge).not.toBeNull();
    expect(nudge!.detail).toContain("0.60");
    expect(nudge!.detail).toContain("0.80");
  });

  it("includes white TA range for white wine", () => {
    const nudges = generateNudges(
      makeContext({ stage: "bottling", wineType: "white" })
    );
    const nudge = findNudge(nudges, "bottling-checklist");
    expect(nudge).not.toBeNull();
    expect(nudge!.detail).toContain("0.65");
    expect(nudge!.detail).toContain("0.85");
  });
});
```

### Step 2: Run tests to verify they fail

Run: `cd api && npx vitest run test/winemaking-nudges.test.ts`

Expected: FAIL — `bottling-checklist` message does not contain "pH", no `detail` field.

### Step 3: Implement

In `api/src/lib/winemaking/nudges.ts`, update `bottlingChecklist`:

```typescript
function bottlingChecklist(ctx: NudgeContext): Nudge | null {
  if (ctx.stage !== "bottling") return null;

  const taRange = ctx.wineType === "white" || ctx.wineType === "rosé"
    ? "0.65–0.85"
    : "0.60–0.80";

  return {
    id: "bottling-checklist",
    priority: "action",
    message:
      "Final checks: SG below 0.998, free SO2 at 25–35 ppm, pH 3.2–3.6, taste is clean",
    detail: `Target TA: ${taRange} g/100mL. pH above 3.6 increases spoilage risk.`,
    stage: ctx.stage,
  };
}
```

### Step 4: Run tests

Run: `cd api && npx vitest run test/winemaking-nudges.test.ts`

Expected: All tests pass.

### Step 5: Run full test suite

Run: `cd api && npm run test`

Expected: All tests pass across all test files.

### Step 6: Commit

```bash
cd api
git add src/lib/winemaking/nudges.ts test/winemaking-nudges.test.ts
git commit -m "feat: add pH/TA validation to bottling checklist

Bottling nudge now includes pH target (3.2-3.6) and wine-type-aware
TA ranges. Warns that pH above 3.6 increases spoilage risk."
```

---

## Task 5: Update temp-high-primary nudge for white wines

The alert system (Task 1) now uses wine-type-aware thresholds, but the `tempHighPrimary` nudge still uses a hardcoded 29°C for all wines. Whites should warn at a lower temperature since their optimal range is 13–18°C.

**Files:**
- Modify: `api/src/lib/winemaking/nudges.ts` (update threshold logic)
- Modify: `api/test/winemaking-nudges.test.ts` (new tests)

### Step 1: Write failing tests

Add new tests in the `temp-high-primary` describe block in `api/test/winemaking-nudges.test.ts` (after line 118):

```typescript
it("warns for white wine at 20°C", () => {
  const nudges = generateNudges(
    makeContext({ stage: "primary_fermentation", wineType: "white", latestTemp: 20 })
  );
  const nudge = findNudge(nudges, "temp-high-primary");
  expect(nudge).not.toBeNull();
  expect(nudge!.message).toContain("20");
});

it("does not warn for white wine at 17°C", () => {
  const nudges = generateNudges(
    makeContext({ stage: "primary_fermentation", wineType: "white", latestTemp: 17 })
  );
  expect(findNudge(nudges, "temp-high-primary")).toBeNull();
});

it("warns for rosé at 20°C", () => {
  const nudges = generateNudges(
    makeContext({ stage: "primary_fermentation", wineType: "rosé", latestTemp: 20 })
  );
  expect(findNudge(nudges, "temp-high-primary")).not.toBeNull();
});

it("does not warn for red wine at 20°C", () => {
  const nudges = generateNudges(
    makeContext({ stage: "primary_fermentation", wineType: "red", latestTemp: 20 })
  );
  expect(findNudge(nudges, "temp-high-primary")).toBeNull();
});
```

### Step 2: Run tests to verify they fail

Run: `cd api && npx vitest run test/winemaking-nudges.test.ts`

Expected: FAIL — white wine at 20°C does not trigger nudge (current threshold is 29°C for all).

### Step 3: Implement

In `api/src/lib/winemaking/nudges.ts`, update `tempHighPrimary`:

```typescript
function tempHighPrimary(ctx: NudgeContext): Nudge | null {
  if (ctx.stage !== "primary_fermentation") return null;
  if (ctx.latestTemp == null) return null;

  const threshold = (ctx.wineType === "white" || ctx.wineType === "rosé") ? 20 : 29;
  if (ctx.latestTemp < threshold) return null;

  const guidance = threshold < 29
    ? `stay under ${threshold}°C to preserve aromatics`
    : `stay under ${threshold}°C`;

  return {
    id: "temp-high-primary",
    priority: "warning",
    message: `Temperature is ${ctx.latestTemp}°C — ${guidance}`,
    stage: ctx.stage,
  };
}
```

### Step 4: Run all tests

Run: `cd api && npm run test`

Expected: All tests pass.

### Step 5: Commit

```bash
cd api
git add src/lib/winemaking/nudges.ts test/winemaking-nudges.test.ts
git commit -m "feat: wine-type-aware temp nudge for primary fermentation

White/rosé nudge at 20°C (preserving aromatics), reds at 29°C.
Aligns with Jeff Cox's optimal fermentation temperature ranges."
```

---

## Verification

After all tasks are complete:

1. Run full API test suite: `cd api && npm run test`
2. Run type-check: `cd api && npm run lint`
3. Verify no unintended changes: `git diff --stat`

All 4 improvements should be covered by 20+ new tests across 2 test files, with no database migrations or dashboard changes needed.
