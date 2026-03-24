# E2E Testing Overhaul — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the minimal E2E seed with a rich, realistic test environment using fresh-per-run databases, fermentation curve generators, and 11 seed scenarios.

**Architecture:** A reset shell script wipes and bootstraps the D1 database before wrangler starts. Playwright global-setup authenticates, then seeds batches/activities via API calls and bulk-inserts ~9,000 readings via a single SQL file. Read-only specs assert against seed data; mutation specs remain self-contained.

**Tech Stack:** Playwright, Hono/Cloudflare Workers (wrangler dev), D1/SQLite, TypeScript

**Design doc:** `docs/plans/2026-03-23-e2e-testing-overhaul.md`

---

### Task 1: Create reset-e2e-db.sh

**Files:**
- Create: `api/scripts/reset-e2e-db.sh`
- Delete: `api/scripts/seed-e2e.sh`

**Step 1: Write the reset script**

```bash
#!/usr/bin/env bash
# Reset local D1 database for E2E tests.
# Wipes all state, applies migrations, seeds test user + API key.
set -euo pipefail

cd "$(dirname "$0")/.."

DB="wine-cellar-api"

echo "Wiping D1 state..."
rm -rf .wrangler/state/v3/d1/

echo "Applying migrations..."
for f in migrations/*.sql; do
  npx wrangler d1 execute "$DB" --local --file "$f" 2>/dev/null
done

# Deterministic API key for E2E tests (not secret — local/CI only)
E2E_KEY="wc-e2etest0000000000000000000000000000000000000000000000000000000000"
HASH=$(printf '%s' "$E2E_KEY" | shasum -a 256 | cut -d' ' -f1)

echo "Seeding E2E test user and API key..."
npx wrangler d1 execute "$DB" --local --command "
  INSERT OR IGNORE INTO users (id, email, name, onboarded)
  VALUES ('00000000-e2e0-test-0000-000000000000', 'e2e@test.local', 'E2E Test User', 1);

  INSERT OR REPLACE INTO api_keys (id, user_id, name, prefix)
  VALUES ('${HASH}', '00000000-e2e0-test-0000-000000000000', 'E2E Testing', 'wc-e2ete');
" 2>/dev/null

echo "Done. E2E_API_KEY=${E2E_KEY}"
```

**Step 2: Make it executable and verify it runs**

Run: `chmod +x api/scripts/reset-e2e-db.sh && cd api && bash scripts/reset-e2e-db.sh`
Expected: "Done. E2E_API_KEY=wc-e2etest..." with no errors

**Step 3: Delete the old seed script**

Run: `rm api/scripts/seed-e2e.sh`

**Step 4: Commit**

```bash
git add api/scripts/reset-e2e-db.sh
git rm api/scripts/seed-e2e.sh
git commit -m "chore: replace seed-e2e.sh with reset-e2e-db.sh (full DB wipe + migrate)"
```

---

### Task 2: Write the fermentation curve generator

**Files:**
- Create: `dashboard/e2e/fixtures/generators.ts`

**Step 1: Write the generator**

This file exports `generateFermentationCurve()`. The curve models real fermentation kinetics:
- Lag phase (0-24h): gravity barely moves, temp rises 0.5C
- Exponential phase (24-96h): steepest drop, reds ~0.012 SG/day at 27C, whites ~0.006 SG/day at 16C
- Deceleration: exponential decay toward terminal SG
- Stall support: flatten at `stallAtSg`
- Velocity multiplier: scale fermentation rate

```ts
import { randomUUID } from "crypto";

export interface CurveParams {
  og: number;
  currentSg: number;
  days: number;
  tempTarget: number;
  tempVariance: number;
  readingsPerDay: number;
  style: "red" | "white";
  stallAtSg?: number;
  velocityMultiplier?: number;
}

export interface ReadingRow {
  id: string;
  gravity: number;
  temperature: number;
  timestamp: string; // ISO 8601
}

// Deterministic seeded PRNG (mulberry32) — no Math.random() so runs are reproducible
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller for Gaussian noise
function gaussian(rng: () => number, mean: number, stddev: number): number {
  const u1 = rng();
  const u2 = rng();
  return mean + stddev * Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
}

export function generateFermentationCurve(params: CurveParams): ReadingRow[] {
  const {
    og,
    currentSg,
    days,
    tempTarget,
    tempVariance,
    readingsPerDay,
    style,
    stallAtSg,
    velocityMultiplier = 1.0,
  } = params;

  const totalReadings = days * readingsPerDay;
  const readings: ReadingRow[] = [];
  const rng = mulberry32(Math.round(og * 10000) + days);

  // Fermentation rate constant (per hour)
  // Reds at 27C: ~0.012 SG/day = 0.0005/hr; whites at 16C: ~0.006 SG/day = 0.00025/hr
  const baseRate = style === "red" ? 0.0005 : 0.00025;
  const rate = baseRate * velocityMultiplier;

  // Total SG drop needed
  const totalDrop = og - currentSg;

  // Time parameters
  const lagHours = style === "red" ? 18 : 24;
  const peakHours = style === "red" ? 72 : 96;

  // Anchor timestamp: "now" minus `days` days
  const now = new Date();
  const startTime = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  for (let i = 0; i < totalReadings; i++) {
    const hoursElapsed = (i / readingsPerDay) * 24;

    // Gravity curve
    let progress: number;
    if (hoursElapsed < lagHours) {
      // Lag phase: very slow start
      progress = 0.02 * (hoursElapsed / lagHours);
    } else if (hoursElapsed < peakHours) {
      // Exponential phase: rapid fermentation
      const phaseProgress = (hoursElapsed - lagHours) / (peakHours - lagHours);
      progress = 0.02 + 0.5 * phaseProgress;
    } else {
      // Deceleration phase: exponential decay toward target
      const hoursAfterPeak = hoursElapsed - peakHours;
      const decayRate = rate * 2;
      progress = 0.52 + (1 - 0.52) * (1 - Math.exp(-decayRate * hoursAfterPeak));
    }

    let gravity = og - totalDrop * Math.min(progress, 1);

    // Stall: flatten at stallAtSg
    if (stallAtSg !== undefined && gravity <= stallAtSg) {
      gravity = stallAtSg + gaussian(rng, 0, 0.0002);
    }

    // Clamp
    gravity = Math.max(gravity, currentSg);

    // Temperature: ambient + fermentation heat + noise
    let temp = tempTarget;
    if (hoursElapsed >= lagHours && hoursElapsed < peakHours * 1.5) {
      // Fermentation exotherm: +1-2C during active phase
      const heatFraction = Math.sin(
        (Math.PI * (hoursElapsed - lagHours)) / (peakHours * 1.5 - lagHours)
      );
      temp += heatFraction * (style === "red" ? 2.0 : 1.0);
    }
    // If stalled, temp drifts toward a cooler ambient
    if (stallAtSg !== undefined && gravity <= stallAtSg + 0.002) {
      temp = tempTarget - 2;
    }
    temp = gaussian(rng, temp, tempVariance * 0.3);

    const timestamp = new Date(startTime.getTime() + hoursElapsed * 60 * 60 * 1000);

    readings.push({
      id: randomUUID(),
      gravity: Math.round(gravity * 10000) / 10000,
      temperature: Math.round(temp * 100) / 100,
      timestamp: timestamp.toISOString(),
    });
  }

  return readings;
}
```

**Step 2: Verify the generator produces valid output**

Run: `cd dashboard && npx vitest run --config vitest.config.ts --passWithNoTests` (just verify no TS compilation errors in the fixtures directory for now — the generator will be exercised for real during seeding in Task 6)

Alternatively, verify the file compiles: `cd dashboard && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add dashboard/e2e/fixtures/generators.ts
git commit -m "feat: add fermentation curve generator for E2E seed data"
```

---

### Task 3: Write the scenario definitions

**Files:**
- Create: `dashboard/e2e/fixtures/scenarios.ts`

**Step 1: Write the scenarios**

Each scenario is a declarative object defining batch fields, generator params, activities to seed, and lifecycle actions. Key API constraints to observe:

- Batch `wine_type` must use `rosé` (with accent), not `rose`
- Activity `stage` must be in `WAYPOINT_ALLOWED_STAGES[batch.stage]` — so lifecycle batches (#6, #7) interleave stage advancements with activity logging
- `bottled_at` is auto-set when completing at `bottling` stage — no PATCH needed
- Cellaring data is computed on read from batch fields set at creation time
- Each batch gets a unique `deviceId` for readings to avoid the dedup index on `(device_id, source_timestamp)`

```ts
import type { CurveParams } from "./generators";

export interface ActivityDef {
  stage: string;
  type: string;
  title: string;
  details?: Record<string, unknown> | null;
  dayOffset: number; // days after batch started_at
}

export interface StageDef {
  stage: string;
  activitiesBefore: ActivityDef[]; // log these BEFORE advancing to this stage
}

export interface ScenarioDef {
  name: string;
  wine_type: string;
  source_material: string;
  volume_liters: number | null;
  target_volume_liters: number | null;
  target_gravity: number | null;
  yeast_strain: string | null;
  oak_type: string | null;
  oak_format: string | null;
  oak_duration_days: number | null;
  mlf_status: string | null;
  notes: string | null;
  daysAgo: number; // how many days ago started_at should be
  deviceId: string; // unique per batch for readings dedup
  curve: CurveParams;
  /** Simple batches: just advance to this stage and log activities */
  targetStage?: string;
  activities?: ActivityDef[];
  /** Lifecycle batches: walk through stages in order, interleaving activities */
  lifecycle?: StageDef[];
  /** Post-seed actions */
  abandon?: boolean;
  complete?: boolean;
  archive?: boolean;
  /** Register and assign a real device */
  assignDevice?: { id: string; name: string };
}

// ─── Scenarios ───────────────────────────────────────────────────

export const scenarios: ScenarioDef[] = [
  // #1 — Argentia Ridge Cab Sauv (healthy mid-primary kit)
  {
    name: "Argentia Ridge Cab Sauv",
    wine_type: "red",
    source_material: "kit",
    volume_liters: 23,
    target_volume_liters: 21,
    target_gravity: 0.996,
    yeast_strain: "Lalvin EC-1118",
    oak_type: null,
    oak_format: null,
    oak_duration_days: null,
    mlf_status: "not_planned",
    notes: null,
    daysAgo: 5,
    deviceId: "e2e-device-01",
    curve: {
      og: 1.088,
      currentSg: 1.042,
      days: 5,
      tempTarget: 24,
      tempVariance: 1.5,
      readingsPerDay: 24,
      style: "red",
    },
    targetStage: "primary_fermentation",
    activities: [
      {
        stage: "primary_fermentation",
        type: "addition",
        title: "Pitched yeast",
        details: { chemical: "Lalvin EC-1118", amount: 5, unit: "g" },
        dayOffset: 0,
      },
      {
        stage: "primary_fermentation",
        type: "measurement",
        title: "SG reading",
        details: { metric: "SG", value: 1.065, unit: "" },
        dayOffset: 3,
      },
      {
        stage: "primary_fermentation",
        type: "measurement",
        title: "SG reading",
        details: { metric: "SG", value: 1.042, unit: "" },
        dayOffset: 5,
      },
    ],
    assignDevice: { id: "e2e-rapt-pill-01", name: "Rapt Pill #1" },
  },

  // #2 — Magnotta Chardonnay (secondary with MLF)
  {
    name: "Magnotta Chardonnay",
    wine_type: "white",
    source_material: "juice_bucket",
    volume_liters: 23,
    target_volume_liters: 20,
    target_gravity: 0.995,
    yeast_strain: "Lalvin 71B",
    oak_type: null,
    oak_format: null,
    oak_duration_days: null,
    mlf_status: "in_progress",
    notes: null,
    daysAgo: 21,
    deviceId: "e2e-device-02",
    curve: {
      og: 1.082,
      currentSg: 1.002,
      days: 21,
      tempTarget: 16,
      tempVariance: 1.0,
      readingsPerDay: 24,
      style: "white",
    },
    targetStage: "secondary_fermentation",
    activities: [
      {
        stage: "secondary_fermentation",
        type: "addition",
        title: "Inoculated MLF",
        details: { chemical: "VP41", amount: 1, unit: "packet" },
        dayOffset: 14,
      },
      {
        stage: "secondary_fermentation",
        type: "racking",
        title: "Racked off primary lees",
        details: { from_vessel: "Primary bucket", to_vessel: "Carboy" },
        dayOffset: 12,
      },
    ],
  },

  // #3 — Argentia Ridge Pinot Noir Rosé (early primary, premium kit with skins)
  {
    name: "Argentia Ridge Pinot Noir Rosé",
    wine_type: "rosé",
    source_material: "kit",
    volume_liters: 23,
    target_volume_liters: 21,
    target_gravity: 0.996,
    yeast_strain: "Lalvin RC212",
    oak_type: null,
    oak_format: null,
    oak_duration_days: null,
    mlf_status: "not_planned",
    notes: "Premium kit with grape skin pack included.",
    daysAgo: 2,
    deviceId: "e2e-device-03",
    curve: {
      og: 1.076,
      currentSg: 1.063,
      days: 2,
      tempTarget: 20,
      tempVariance: 1.0,
      readingsPerDay: 24,
      style: "white", // rosé ferments at white temps
    },
    targetStage: "primary_fermentation",
    activities: [
      {
        stage: "primary_fermentation",
        type: "addition",
        title: "Pitched yeast",
        details: { chemical: "Lalvin RC212", amount: 5, unit: "g" },
        dayOffset: 0,
      },
      {
        stage: "primary_fermentation",
        type: "addition",
        title: "Added grape skin pack",
        details: { chemical: "Grape skins (Pinot Noir)", amount: 1, unit: "pack" },
        dayOffset: 0,
      },
    ],
  },

  // #4 — Magnotta Riesling (cold stabilization)
  {
    name: "Magnotta Riesling",
    wine_type: "white",
    source_material: "juice_bucket",
    volume_liters: 23,
    target_volume_liters: 20,
    target_gravity: 0.996,
    yeast_strain: "Lalvin QA23",
    oak_type: null,
    oak_format: null,
    oak_duration_days: null,
    mlf_status: "not_planned",
    notes: null,
    daysAgo: 45,
    deviceId: "e2e-device-04",
    curve: {
      og: 1.084,
      currentSg: 0.996,
      days: 45,
      tempTarget: 12,
      tempVariance: 0.5,
      readingsPerDay: 24,
      style: "white",
    },
    targetStage: "stabilization",
    activities: [
      {
        stage: "stabilization",
        type: "racking",
        title: "Racked to clean carboy",
        details: { from_vessel: "Carboy 1", to_vessel: "Carboy 2" },
        dayOffset: 30,
      },
      {
        stage: "stabilization",
        type: "addition",
        title: "Added K2S2O5",
        details: { chemical: "K2S2O5", amount: 0.5, unit: "g" },
        dayOffset: 30,
      },
      {
        stage: "stabilization",
        type: "note",
        title: "Cold stabilization started",
        details: { body: "Moved to cold room at 12°C for tartrate precipitation." },
        dayOffset: 35,
      },
    ],
  },

  // #5 — Argentia Ridge Zinfandel (stalled fermentation)
  {
    name: "Argentia Ridge Zinfandel",
    wine_type: "red",
    source_material: "kit",
    volume_liters: 23,
    target_volume_liters: 21,
    target_gravity: 0.996,
    yeast_strain: "Lalvin EC-1118",
    oak_type: null,
    oak_format: null,
    oak_duration_days: null,
    mlf_status: "not_planned",
    notes: "Premium kit with grape skin pack. Fermentation stalled — needs attention.",
    daysAgo: 12,
    deviceId: "e2e-device-05",
    curve: {
      og: 1.092,
      currentSg: 1.030,
      days: 12,
      tempTarget: 22,
      tempVariance: 1.0,
      readingsPerDay: 24,
      style: "red",
      stallAtSg: 1.030,
    },
    targetStage: "primary_fermentation",
    activities: [
      {
        stage: "primary_fermentation",
        type: "addition",
        title: "Pitched yeast",
        details: { chemical: "Lalvin EC-1118", amount: 5, unit: "g" },
        dayOffset: 0,
      },
      {
        stage: "primary_fermentation",
        type: "note",
        title: "Checked fermentation — no activity",
        details: { body: "No bubbling visible in airlock for 2 days. SG stuck at 1.030. Room temp may be too low." },
        dayOffset: 10,
      },
    ],
  },

  // #6 — 2024 Merlot (completed, fresh grapes, full lifecycle)
  {
    name: "2024 Merlot",
    wine_type: "red",
    source_material: "fresh_grapes",
    volume_liters: 60,
    target_volume_liters: 55,
    target_gravity: 0.996,
    yeast_strain: "Lalvin BM45",
    oak_type: "french",
    oak_format: "chips",
    oak_duration_days: 90,
    mlf_status: "complete",
    notes: "Backyard Merlot from 2024 harvest. Full lifecycle test batch.",
    daysAgo: 180,
    deviceId: "e2e-device-06",
    curve: {
      og: 1.090,
      currentSg: 0.994,
      days: 180,
      tempTarget: 24,
      tempVariance: 2.0,
      readingsPerDay: 4, // 4/day over 180 days = 720 readings (manageable)
      style: "red",
    },
    complete: true,
    lifecycle: [
      {
        stage: "must_prep",
        activitiesBefore: [
          { stage: "receiving", type: "note", title: "Grapes received", details: { body: "80 lbs Merlot grapes from local vineyard." }, dayOffset: 0 },
          { stage: "crushing", type: "note", title: "Crushed and destemmed", details: { body: "Hand-crushed into primary fermenter." }, dayOffset: 0 },
          { stage: "must_prep", type: "addition", title: "Added SO2", details: { chemical: "K2S2O5", amount: 1.5, unit: "g" }, dayOffset: 0 },
        ],
      },
      {
        stage: "primary_fermentation",
        activitiesBefore: [
          { stage: "primary_fermentation", type: "addition", title: "Pitched yeast", details: { chemical: "Lalvin BM45", amount: 10, unit: "g" }, dayOffset: 1 },
          { stage: "primary_fermentation", type: "measurement", title: "OG reading", details: { metric: "SG", value: 1.090, unit: "" }, dayOffset: 1 },
          { stage: "pressing", type: "note", title: "Pressed", details: { body: "Basket press, kept free-run separate." }, dayOffset: 10 },
        ],
      },
      {
        stage: "secondary_fermentation",
        activitiesBefore: [
          { stage: "secondary_fermentation", type: "racking", title: "Racked to carboy", details: { from_vessel: "Primary bucket", to_vessel: "Carboy 1" }, dayOffset: 12 },
          { stage: "malolactic", type: "addition", title: "Inoculated MLF", details: { chemical: "VP41", amount: 1, unit: "packet" }, dayOffset: 14 },
        ],
      },
      {
        stage: "stabilization",
        activitiesBefore: [
          { stage: "stabilization", type: "racking", title: "Second racking", details: { from_vessel: "Carboy 1", to_vessel: "Carboy 2" }, dayOffset: 60 },
          { stage: "stabilization", type: "addition", title: "Added oak chips", details: { chemical: "French oak chips (medium toast)", amount: 30, unit: "g" }, dayOffset: 60 },
          { stage: "stabilization", type: "addition", title: "Added SO2", details: { chemical: "K2S2O5", amount: 1, unit: "g" }, dayOffset: 90 },
          { stage: "stabilization", type: "racking", title: "Third racking", details: { from_vessel: "Carboy 2", to_vessel: "Carboy 3" }, dayOffset: 120 },
          { stage: "stabilization", type: "tasting", title: "Pre-bottling tasting", details: { color: "Deep garnet", aroma: "Dark cherry, vanilla from oak", palate: "Medium body, soft tannins, good acidity", notes: "Ready for bottling." }, dayOffset: 160 },
        ],
      },
      {
        stage: "bottling",
        activitiesBefore: [
          { stage: "bottling", type: "note", title: "Bottled", details: { body: "25 bottles (750ml). Natural cork." }, dayOffset: 175 },
        ],
      },
    ],
  },

  // #7 — Magnotta Sauvignon Blanc (archived)
  {
    name: "Magnotta Sauvignon Blanc",
    wine_type: "white",
    source_material: "juice_bucket",
    volume_liters: 23,
    target_volume_liters: 20,
    target_gravity: 0.995,
    yeast_strain: "Lalvin QA23",
    oak_type: null,
    oak_format: null,
    oak_duration_days: null,
    mlf_status: "not_planned",
    notes: null,
    daysAgo: 120,
    deviceId: "e2e-device-07",
    curve: {
      og: 1.080,
      currentSg: 0.995,
      days: 120,
      tempTarget: 15,
      tempVariance: 0.5,
      readingsPerDay: 4,
      style: "white",
    },
    complete: true,
    archive: true,
    lifecycle: [
      {
        stage: "must_prep",
        activitiesBefore: [],
      },
      {
        stage: "primary_fermentation",
        activitiesBefore: [
          { stage: "primary_fermentation", type: "addition", title: "Pitched yeast", details: { chemical: "Lalvin QA23", amount: 5, unit: "g" }, dayOffset: 0 },
        ],
      },
      {
        stage: "secondary_fermentation",
        activitiesBefore: [
          { stage: "secondary_fermentation", type: "racking", title: "Racked to carboy", details: { from_vessel: "Bucket", to_vessel: "Carboy" }, dayOffset: 14 },
        ],
      },
      {
        stage: "stabilization",
        activitiesBefore: [
          { stage: "stabilization", type: "racking", title: "Second racking", details: { from_vessel: "Carboy 1", to_vessel: "Carboy 2" }, dayOffset: 60 },
        ],
      },
      {
        stage: "bottling",
        activitiesBefore: [
          { stage: "bottling", type: "note", title: "Bottled", details: { body: "22 bottles." }, dayOffset: 110 },
        ],
      },
    ],
  },

  // #8 — 2025 Blanc de Blancs (sparkling, fresh grapes)
  {
    name: "2025 Blanc de Blancs",
    wine_type: "sparkling",
    source_material: "fresh_grapes",
    volume_liters: 23,
    target_volume_liters: 20,
    target_gravity: 1.000,
    yeast_strain: "Lalvin EC-1118",
    oak_type: null,
    oak_format: null,
    oak_duration_days: null,
    mlf_status: "not_planned",
    notes: "Méthode traditionnelle from Chardonnay grapes.",
    daysAgo: 14,
    deviceId: "e2e-device-08",
    curve: {
      og: 1.084,
      currentSg: 1.010,
      days: 14,
      tempTarget: 14,
      tempVariance: 0.5,
      readingsPerDay: 24,
      style: "white",
    },
    targetStage: "secondary_fermentation",
    activities: [
      {
        stage: "secondary_fermentation",
        type: "addition",
        title: "Pitched yeast",
        details: { chemical: "Lalvin EC-1118", amount: 5, unit: "g" },
        dayOffset: 0,
      },
      {
        stage: "secondary_fermentation",
        type: "note",
        title: "Pressing complete",
        details: { body: "Whole-cluster pressed Chardonnay. Very gentle." },
        dayOffset: 0,
      },
    ],
  },

  // #9 — 2025 Syrah "Control" (split trial)
  {
    name: '2025 Syrah "Control"',
    wine_type: "red",
    source_material: "fresh_grapes",
    volume_liters: 30,
    target_volume_liters: 27,
    target_gravity: 0.996,
    yeast_strain: "Lalvin ICV-D254",
    oak_type: null,
    oak_format: null,
    oak_duration_days: null,
    mlf_status: "pending",
    notes: "Split trial — control batch, no oak.",
    daysAgo: 8,
    deviceId: "e2e-device-09",
    curve: {
      og: 1.090,
      currentSg: 1.025,
      days: 8,
      tempTarget: 28,
      tempVariance: 1.5,
      readingsPerDay: 24,
      style: "red",
    },
    targetStage: "primary_fermentation",
    activities: [
      {
        stage: "primary_fermentation",
        type: "addition",
        title: "Pitched yeast",
        details: { chemical: "Lalvin ICV-D254", amount: 10, unit: "g" },
        dayOffset: 0,
      },
      {
        stage: "primary_fermentation",
        type: "note",
        title: "Punch-down",
        details: { body: "Morning and evening punch-downs. Cap reforming quickly." },
        dayOffset: 3,
      },
    ],
  },

  // #10 — 2025 Syrah "Oak Chips" (split trial variant)
  {
    name: '2025 Syrah "Oak Chips"',
    wine_type: "red",
    source_material: "fresh_grapes",
    volume_liters: 30,
    target_volume_liters: 27,
    target_gravity: 0.996,
    yeast_strain: "Lalvin ICV-D254",
    oak_type: "french",
    oak_format: "chips",
    oak_duration_days: null,
    mlf_status: "pending",
    notes: "Split trial — oak chips added day 3.",
    daysAgo: 8,
    deviceId: "e2e-device-10",
    curve: {
      og: 1.090,
      currentSg: 1.027,
      days: 8,
      tempTarget: 28,
      tempVariance: 1.5,
      readingsPerDay: 24,
      style: "red",
      velocityMultiplier: 0.95,
    },
    targetStage: "primary_fermentation",
    activities: [
      {
        stage: "primary_fermentation",
        type: "addition",
        title: "Pitched yeast",
        details: { chemical: "Lalvin ICV-D254", amount: 10, unit: "g" },
        dayOffset: 0,
      },
      {
        stage: "primary_fermentation",
        type: "addition",
        title: "Added oak chips",
        details: { chemical: "French oak chips (medium toast)", amount: 25, unit: "g" },
        dayOffset: 3,
      },
      {
        stage: "primary_fermentation",
        type: "note",
        title: "Punch-down",
        details: { body: "Morning and evening punch-downs. Oak chips integrating well." },
        dayOffset: 3,
      },
    ],
  },

  // #11 — Magnotta Malbec (abandoned)
  {
    name: "Magnotta Malbec",
    wine_type: "red",
    source_material: "juice_bucket",
    volume_liters: 23,
    target_volume_liters: 21,
    target_gravity: 0.996,
    yeast_strain: "Lalvin EC-1118",
    oak_type: null,
    oak_format: null,
    oak_duration_days: null,
    mlf_status: "not_planned",
    notes: "Abandoned due to contamination.",
    daysAgo: 30, // started 30 days ago but abandoned after 4 days
    deviceId: "e2e-device-11",
    curve: {
      og: 1.086,
      currentSg: 1.050,
      days: 4, // only 4 days of readings before abandonment
      tempTarget: 24,
      tempVariance: 1.0,
      readingsPerDay: 24,
      style: "red",
    },
    targetStage: "primary_fermentation",
    activities: [
      {
        stage: "primary_fermentation",
        type: "addition",
        title: "Pitched yeast",
        details: { chemical: "Lalvin EC-1118", amount: 5, unit: "g" },
        dayOffset: 0,
      },
      {
        stage: "primary_fermentation",
        type: "note",
        title: "Visible mold on surface — dumping batch",
        details: { body: "White/green mold spotted on must surface. Decided to abandon." },
        dayOffset: 4,
      },
    ],
    abandon: true,
  },
];
```

**Step 2: Verify it compiles**

Run: `cd dashboard && npx tsc --noEmit --esModuleInterop --module nodenext --moduleResolution nodenext e2e/fixtures/scenarios.ts`
Expected: No errors (or minimal — may need a tsconfig adjustment; verify it at least parses)

**Step 3: Commit**

```bash
git add dashboard/e2e/fixtures/scenarios.ts
git commit -m "feat: add 11 E2E seed scenarios with winemaking-accurate parameters"
```

---

### Task 4: Write the seed orchestrator

**Files:**
- Create: `dashboard/e2e/fixtures/seed.ts`

**Step 1: Write the orchestrator**

The seed function takes a Playwright API request context and executes in phases:
1. Create device and assign it
2. Create simple batches, advance stages, log activities
3. Create lifecycle batches (Merlot #6, Sauvignon Blanc #7) with interleaved stage/activity seeding
4. Execute lifecycle actions (abandon/complete/archive)
5. Generate all readings and alerts, write to a single SQL file, execute via wrangler

```ts
import { execSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import type { APIRequestContext } from "@playwright/test";
import { scenarios, type ScenarioDef, type ActivityDef } from "./scenarios";
import { generateFermentationCurve } from "./generators";

const API_BASE = "http://localhost:5173";
const E2E_USER_ID = "00000000-e2e0-test-0000-000000000000";
const SENTINEL_BATCH_NAME = "Argentia Ridge Cab Sauv";

interface SeededBatch {
  id: string;
  scenario: ScenarioDef;
}

// ── Helpers ──────────────────────────────────────────────────────

function startedAtISO(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

function activityTimestamp(batchStarted: string, dayOffset: number): string {
  const base = new Date(batchStarted).getTime();
  return new Date(base + dayOffset * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString();
}

async function apiPost(ctx: APIRequestContext, path: string, data?: unknown) {
  const opts: { headers?: Record<string, string>; data?: unknown } = {};
  if (data !== undefined) opts.data = data;
  const res = await ctx.post(`${API_BASE}${path}`, opts);
  if (res.status() >= 400) {
    throw new Error(`POST ${path} failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

async function apiPatch(ctx: APIRequestContext, path: string, data: unknown) {
  const res = await ctx.patch(`${API_BASE}${path}`, { data });
  if (res.status() >= 400) {
    throw new Error(`PATCH ${path} failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

async function logActivity(
  ctx: APIRequestContext,
  batchId: string,
  activity: ActivityDef,
  batchStarted: string,
) {
  await apiPost(ctx, `/api/v1/batches/${batchId}/activities`, {
    stage: activity.stage,
    type: activity.type,
    title: activity.title,
    details: activity.details ?? null,
    recorded_at: activityTimestamp(batchStarted, activity.dayOffset),
  });
}

// ── Idempotency guard ────────────────────────────────────────────

async function isSeedDataPresent(ctx: APIRequestContext): Promise<boolean> {
  const res = await ctx.get(`${API_BASE}/api/v1/batches`);
  if (res.status() !== 200) return false;
  const data = await res.json();
  return data.items?.some((b: { name: string }) => b.name === SENTINEL_BATCH_NAME) ?? false;
}

// ── Waypoint stage order ─────────────────────────────────────────

const WAYPOINT_ORDER = [
  "must_prep",
  "primary_fermentation",
  "secondary_fermentation",
  "stabilization",
  "bottling",
];

// ── Main seed function ───────────────────────────────────────────

export async function seed(ctx: APIRequestContext): Promise<void> {
  // Skip if already seeded (idempotency for reuseExistingServer)
  if (await isSeedDataPresent(ctx)) {
    console.log("Seed data already present, skipping.");
    return;
  }

  console.log("Seeding E2E data...");
  const seeded: SeededBatch[] = [];

  // ── Phase 1: Simple batches (#1-5, #8-11) ───────────────────

  for (const scenario of scenarios) {
    if (scenario.lifecycle) continue; // handled in Phase 2

    const started_at = startedAtISO(scenario.daysAgo);
    const batchData = {
      name: scenario.name,
      wine_type: scenario.wine_type,
      source_material: scenario.source_material,
      started_at,
      volume_liters: scenario.volume_liters,
      target_volume_liters: scenario.target_volume_liters,
      target_gravity: scenario.target_gravity,
      yeast_strain: scenario.yeast_strain,
      oak_type: scenario.oak_type,
      oak_format: scenario.oak_format,
      oak_duration_days: scenario.oak_duration_days,
      mlf_status: scenario.mlf_status,
      notes: scenario.notes,
    };

    const batch = await apiPost(ctx, "/api/v1/batches", batchData);
    const batchId = batch.id;

    // Advance to target stage (batches start at must_prep)
    if (scenario.targetStage && scenario.targetStage !== "must_prep") {
      const targetIdx = WAYPOINT_ORDER.indexOf(scenario.targetStage);
      for (let i = 1; i <= targetIdx; i++) {
        await apiPost(ctx, `/api/v1/batches/${batchId}/stage`, {
          stage: WAYPOINT_ORDER[i],
        });
      }
    }

    // Log activities
    if (scenario.activities) {
      for (const activity of scenario.activities) {
        await logActivity(ctx, batchId, activity, started_at);
      }
    }

    // Create and assign device if specified
    if (scenario.assignDevice) {
      await apiPost(ctx, "/api/v1/devices", {
        id: scenario.assignDevice.id,
        name: scenario.assignDevice.name,
      });
      await apiPost(ctx, `/api/v1/devices/${scenario.assignDevice.id}/assign`, {
        batch_id: batchId,
      });
    }

    // Lifecycle actions
    if (scenario.abandon) {
      await apiPost(ctx, `/api/v1/batches/${batchId}/abandon`);
    }

    seeded.push({ id: batchId, scenario });
  }

  // ── Phase 2: Lifecycle batches (#6, #7) ──────────────────────

  for (const scenario of scenarios) {
    if (!scenario.lifecycle) continue;

    const started_at = startedAtISO(scenario.daysAgo);
    const batchData = {
      name: scenario.name,
      wine_type: scenario.wine_type,
      source_material: scenario.source_material,
      started_at,
      volume_liters: scenario.volume_liters,
      target_volume_liters: scenario.target_volume_liters,
      target_gravity: scenario.target_gravity,
      yeast_strain: scenario.yeast_strain,
      oak_type: scenario.oak_type,
      oak_format: scenario.oak_format,
      oak_duration_days: scenario.oak_duration_days,
      mlf_status: scenario.mlf_status,
      notes: scenario.notes,
    };

    const batch = await apiPost(ctx, "/api/v1/batches", batchData);
    const batchId = batch.id;

    // Walk through lifecycle stages: advance FIRST, then log activities at the new stage.
    // i=0 is must_prep (the default stage at creation) — no advancement needed.
    for (let i = 0; i < scenario.lifecycle.length; i++) {
      const stageDef = scenario.lifecycle[i];

      // Advance to this stage (skip for i=0 since batch starts at must_prep)
      if (i > 0) {
        await apiPost(ctx, `/api/v1/batches/${batchId}/stage`, {
          stage: stageDef.stage,
        });
      }

      // Log activities allowed at the now-current stage
      for (const activity of stageDef.activitiesBefore) {
        await logActivity(ctx, batchId, activity, started_at);
      }
    }

    // Post-lifecycle actions
    if (scenario.complete) {
      await apiPost(ctx, `/api/v1/batches/${batchId}/complete`);
    }
    if (scenario.archive) {
      await apiPost(ctx, `/api/v1/batches/${batchId}/archive`);
    }

    seeded.push({ id: batchId, scenario });
  }

  // ── Phase 3: Bulk readings + alerts via SQL ──────────────────

  const sqlStatements: string[] = [];

  for (const { id: batchId, scenario } of seeded) {
    const readings = generateFermentationCurve(scenario.curve);
    const deviceId = scenario.assignDevice?.id ?? scenario.deviceId;

    for (let i = 0; i < readings.length; i += 500) {
      const chunk = readings.slice(i, i + 500);
      const esc = (s: string) => s.replace(/'/g, "''");
      const values = chunk
        .map(
          (r) =>
            `('${esc(r.id)}', '${esc(batchId)}', '${esc(deviceId)}', '${esc(E2E_USER_ID)}', ${r.gravity}, ${r.temperature}, 'device', '${esc(r.timestamp)}', '${esc(r.timestamp)}')`,
        )
        .join(",\n");
      sqlStatements.push(
        `INSERT INTO readings (id, batch_id, device_id, user_id, gravity, temperature, source, source_timestamp, created_at) VALUES\n${values};`,
      );
    }
  }

  // Alerts for Zinfandel (#5)
  const zinfandelBatch = seeded.find((s) => s.scenario.name === "Argentia Ridge Zinfandel");
  if (zinfandelBatch) {
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    sqlStatements.push(
      `INSERT INTO alert_state (id, user_id, batch_id, alert_type, context, fired_at) VALUES
       ('${randomUUID()}', '${E2E_USER_ID}', '${zinfandelBatch.id}', 'stall', '{"message":"Gravity unchanged at 1.030 for 4 days"}', '${fourDaysAgo}'),
       ('${randomUUID()}', '${E2E_USER_ID}', '${zinfandelBatch.id}', 'temp_low', '{"message":"Temperature 22°C is below recommended range for red fermentation"}', '${fourDaysAgo}');`,
    );
  }

  // Write to temp SQL file and execute
  const sqlPath = join("/tmp", "e2e-seed-readings.sql");
  writeFileSync(sqlPath, sqlStatements.join("\n\n"));

  console.log(`Inserting ${seeded.reduce((sum, s) => sum + s.scenario.curve.days * s.scenario.curve.readingsPerDay, 0)} readings via SQL...`);
  execSync(
    `npx wrangler d1 execute wine-cellar-api --local --file "${sqlPath}"`,
    { cwd: join(process.cwd(), "../api"), stdio: "pipe" },
  );

  // Clean up temp file
  try { unlinkSync(sqlPath); } catch { /* ignore */ }

  console.log("E2E seed complete.");
}
```

**Step 2: Verify it compiles**

Run: `cd dashboard && npx tsc --noEmit --esModuleInterop --module nodenext --moduleResolution nodenext e2e/fixtures/seed.ts 2>&1 || echo "Check for type issues"`
Expected: Clean compile or minor issues to address (the file will be exercised for real in Task 6)

**Step 3: Commit**

```bash
git add dashboard/e2e/fixtures/seed.ts
git commit -m "feat: add E2E seed orchestrator (API calls + bulk SQL)"
```

---

### Task 5: Update Playwright config and global-setup

**Files:**
- Modify: `dashboard/playwright.config.ts`
- Modify: `dashboard/e2e/global-setup.ts`

**Step 1: Update playwright.config.ts**

Changes:
- `testDir` → `./e2e/specs`
- API `webServer.command` prepends `reset-e2e-db.sh`
- API `webServer.timeout` → 60_000

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/specs",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
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
      command: "cd ../api && bash scripts/reset-e2e-db.sh && npm run dev",
      port: 8787,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
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

**Step 2: Update global-setup.ts**

Add seed call after authentication:

```ts
import { request } from "@playwright/test";
import { seed } from "./fixtures/seed";

const API_BASE = "http://localhost:5173";
const STORAGE_STATE_PATH = "e2e/.auth/session.json";

async function globalSetup() {
  const apiKey = process.env.E2E_API_KEY;
  if (!apiKey) {
    throw new Error(
      "E2E_API_KEY env var is required. Create a user and API key in the dev API, then set E2E_API_KEY=wc-..."
    );
  }

  const ctx = await request.newContext({ baseURL: API_BASE });

  // Authenticate
  const res = await ctx.post("/api/v1/auth/login/api-key", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.status() !== 200) {
    throw new Error(`API key login failed: ${res.status()} ${await res.text()}`);
  }

  // Save auth state
  await ctx.storageState({ path: STORAGE_STATE_PATH });

  // Seed test data (idempotent — skips if already seeded)
  await seed(ctx);

  await ctx.dispose();
}

export default globalSetup;
```

**Step 3: Commit**

```bash
git add dashboard/playwright.config.ts dashboard/e2e/global-setup.ts
git commit -m "feat: update Playwright config and global-setup with seed orchestration"
```

---

### Task 6: Move existing specs and verify seeding works

**Files:**
- Move: `dashboard/e2e/*.spec.ts` → `dashboard/e2e/specs/`

**Step 1: Create the specs directory and move files**

```bash
mkdir -p dashboard/e2e/specs
mv dashboard/e2e/dashboard.spec.ts dashboard/e2e/specs/
mv dashboard/e2e/batch-lifecycle.spec.ts dashboard/e2e/specs/
mv dashboard/e2e/batch-edit.spec.ts dashboard/e2e/specs/
mv dashboard/e2e/stage-progression.spec.ts dashboard/e2e/specs/
mv dashboard/e2e/activities.spec.ts dashboard/e2e/specs/
mv dashboard/e2e/settings-api-keys.spec.ts dashboard/e2e/specs/
```

**Step 2: Run the full E2E suite to verify seeding works**

Run: `cd dashboard && E2E_API_KEY=wc-e2etest0000000000000000000000000000000000000000000000000000000000 npx playwright test`
Expected: All existing tests pass. The seed runs in global-setup (check console output for "Seeding E2E data..." and "E2E seed complete."). The reset script runs first (check for "Wiping D1 state..." and "Done.").

**Step 3: If tests fail, debug and fix**

Common issues to check:
- `wrangler d1 execute` path in `seed.ts` — the `cwd` must point to the api directory
- Timeout — if seeding takes too long, increase `globalSetup` timeout or reduce `readingsPerDay` for long-duration batches
- Stage advancement order — lifecycle batches must follow the exact waypoint order

**Step 4: Commit**

```bash
git add dashboard/e2e/specs/
git rm dashboard/e2e/dashboard.spec.ts dashboard/e2e/batch-lifecycle.spec.ts dashboard/e2e/batch-edit.spec.ts dashboard/e2e/stage-progression.spec.ts dashboard/e2e/activities.spec.ts dashboard/e2e/settings-api-keys.spec.ts
git commit -m "chore: move E2E specs to e2e/specs/ directory"
```

---

### Task 7: Rewrite dashboard.spec.ts to assert seed data

**Files:**
- Modify: `dashboard/e2e/specs/dashboard.spec.ts`

**Step 1: Rewrite the spec**

```ts
// Requires: seed data — yes
import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("shows summary stats with active batch count", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Active batches" })).toBeVisible();

    // Summary stats line: should show at least 8 batches (seed has 8 active)
    const statsLine = page.locator("p.tabular-nums");
    await expect(statsLine).toBeVisible();
    const statsText = await statsLine.textContent();
    const batchCount = parseInt(statsText?.match(/(\d+)\s+batch/)?.[1] ?? "0");
    expect(batchCount).toBeGreaterThanOrEqual(8);
  });

  test("lists seed batches by name", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Active batches" })).toBeVisible();

    // Verify key seed batches appear
    await expect(page.getByText("Argentia Ridge Cab Sauv")).toBeVisible();
    await expect(page.getByText("Magnotta Chardonnay")).toBeVisible();
    await expect(page.getByText("Argentia Ridge Zinfandel")).toBeVisible();
    await expect(page.getByText('2025 Syrah "Control"')).toBeVisible();
  });

  test("shows sparkline charts for batches with readings", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Active batches" })).toBeVisible();

    // Sparklines render as SVG elements
    const svgs = page.locator("svg");
    await expect(svgs.first()).toBeVisible();
    // Should have multiple sparklines (2 per batch with temp data: gravity + temp)
    expect(await svgs.count()).toBeGreaterThanOrEqual(4);
  });

  test("shows Zinfandel in needs attention alerts", async ({ page }) => {
    await page.goto("/");

    // The "Needs attention" section should appear
    await expect(page.getByText("Needs attention")).toBeVisible();

    // Zinfandel should appear as an alert
    await expect(page.getByText("Argentia Ridge Zinfandel")).toBeVisible();
  });

  test("shows recent activities from seed data", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();

    // Should show at least one activity title from seed data
    const activitySection = page.locator("section", { has: page.getByRole("heading", { name: "Recent activity" }) });
    const activityLinks = activitySection.locator("a");
    expect(await activityLinks.count()).toBeGreaterThanOrEqual(1);
  });

  test("can navigate to new batch form", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Active batches" })).toBeVisible();
    await page.locator('a[href="/batches/new"]').click({ force: true });
    await expect(page).toHaveURL(/\/batches\/new$/);
    await expect(page.getByRole("heading", { name: "New Batch" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Batch" })).toBeVisible();
  });
});
```

**Step 2: Run the dashboard spec**

Run: `cd dashboard && E2E_API_KEY=wc-e2etest0000000000000000000000000000000000000000000000000000000000 npx playwright test e2e/specs/dashboard.spec.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add dashboard/e2e/specs/dashboard.spec.ts
git commit -m "test: rewrite dashboard E2E spec to assert against seed data"
```

---

### Task 8: Add batch-detail.spec.ts

**Files:**
- Create: `dashboard/e2e/specs/batch-detail.spec.ts`

**Step 1: Write the spec**

```ts
// Requires: seed data — yes
import { test, expect } from "@playwright/test";

test.describe("Batch detail (seed data)", () => {
  test("shows snapshot card with fermentation data for Cab Sauv", async ({ page }) => {
    // Navigate to dashboard first, then click through to the Cab Sauv
    await page.goto("/");
    await expect(page.getByText("Argentia Ridge Cab Sauv")).toBeVisible();
    await page.getByText("Argentia Ridge Cab Sauv").first().click();

    // Should be on batch detail page
    await expect(page.getByRole("heading", { name: "Argentia Ridge Cab Sauv" })).toBeVisible();

    // Should show current SG somewhere on the page
    await expect(page.getByText("SG")).toBeVisible();

    // Stage should be Primary Fermentation
    await expect(page.getByText("Primary Fermentation")).toBeVisible();

    // Should show wine type
    await expect(page.getByText("Red")).toBeVisible();
  });

  test("renders gravity chart with data points", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Argentia Ridge Cab Sauv").first().click();
    await expect(page.getByRole("heading", { name: "Argentia Ridge Cab Sauv" })).toBeVisible();

    // Recharts renders as SVG with class .recharts-wrapper
    const chart = page.locator(".recharts-wrapper");
    await expect(chart.first()).toBeVisible({ timeout: 10_000 });
  });

  test("shows seeded activities in timeline", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Argentia Ridge Cab Sauv").first().click();
    await expect(page.getByRole("heading", { name: "Argentia Ridge Cab Sauv" })).toBeVisible();

    // Should show the "Pitched yeast" activity from seed
    await expect(page.getByText("Pitched yeast")).toBeVisible();
  });

  test("shows device assignment", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Argentia Ridge Cab Sauv").first().click();
    await expect(page.getByRole("heading", { name: "Argentia Ridge Cab Sauv" })).toBeVisible();

    // Should show the assigned device name
    await expect(page.getByText("Rapt Pill #1")).toBeVisible();
  });
});
```

**Step 2: Run the spec**

Run: `cd dashboard && E2E_API_KEY=wc-e2etest0000000000000000000000000000000000000000000000000000000000 npx playwright test e2e/specs/batch-detail.spec.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add dashboard/e2e/specs/batch-detail.spec.ts
git commit -m "test: add E2E spec for batch detail page with seed data"
```

---

### Task 9: Add batch-list.spec.ts

**Files:**
- Create: `dashboard/e2e/specs/batch-list.spec.ts`

**Step 1: Write the spec**

```ts
// Requires: seed data — yes
import { test, expect } from "@playwright/test";

test.describe("Batch list (seed data)", () => {
  test("active tab shows seed batches", async ({ page }) => {
    await page.goto("/batches");
    await expect(page.getByRole("heading", { name: "Batches" })).toBeVisible();

    // Active tab is default — should show seed batches
    await expect(page.getByText("Argentia Ridge Cab Sauv")).toBeVisible();
    await expect(page.getByText("Magnotta Chardonnay")).toBeVisible();
  });

  test("completed tab shows the Merlot", async ({ page }) => {
    await page.goto("/batches");
    await page.getByRole("tab", { name: "Completed" }).click();

    await expect(page.getByText("2024 Merlot")).toBeVisible({ timeout: 10_000 });
  });

  test("archived tab shows the Sauvignon Blanc", async ({ page }) => {
    await page.goto("/batches");
    await page.getByRole("tab", { name: "Archived" }).click();

    await expect(page.getByText("Magnotta Sauvignon Blanc")).toBeVisible({ timeout: 10_000 });
  });

  test("abandoned tab shows the Malbec", async ({ page }) => {
    await page.goto("/batches");
    await page.getByRole("tab", { name: "Abandoned" }).click();

    await expect(page.getByText("Magnotta Malbec")).toBeVisible({ timeout: 10_000 });
  });

  test("compare button navigates to comparison page", async ({ page }) => {
    await page.goto("/batches");
    await page.getByRole("button", { name: "Compare" }).click();

    await expect(page).toHaveURL(/\/compare$/);
  });
});
```

**Step 2: Run the spec**

Run: `cd dashboard && E2E_API_KEY=wc-e2etest0000000000000000000000000000000000000000000000000000000000 npx playwright test e2e/specs/batch-list.spec.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add dashboard/e2e/specs/batch-list.spec.ts
git commit -m "test: add E2E spec for batch list status tabs"
```

---

### Task 10: Add alerts.spec.ts

**Files:**
- Create: `dashboard/e2e/specs/alerts.spec.ts`

**Step 1: Write the spec**

```ts
// Requires: seed data — yes
import { test, expect } from "@playwright/test";

test.describe("Alerts (seed data)", () => {
  test("Zinfandel stall alert is visible on dashboard", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("Needs attention")).toBeVisible();

    // Find the Zinfandel alert row
    const zinfandelAlert = page.locator("a", { hasText: "Argentia Ridge Zinfandel" });
    await expect(zinfandelAlert.first()).toBeVisible();
  });

  test("can dismiss an alert", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Needs attention")).toBeVisible();

    // Scope to the alerts section only (not the active batches list which also has links)
    const alertsSection = page.locator("section", { has: page.getByText("Needs attention") });

    // Count Zinfandel alerts before dismiss
    const beforeCount = await alertsSection.locator("a", { hasText: "Argentia Ridge Zinfandel" }).count();
    expect(beforeCount).toBeGreaterThanOrEqual(1);

    // Find and click the first dismiss button for Zinfandel
    const dismissButton = page.getByRole("button", { name: /Dismiss alert for Argentia Ridge Zinfandel/ });
    await dismissButton.first().click();

    // Wait for refetch
    await page.waitForTimeout(1000);

    // Count should be one fewer in the alerts section
    const afterCount = await alertsSection.locator("a", { hasText: "Argentia Ridge Zinfandel" }).count();
    expect(afterCount).toBeLessThan(beforeCount);
  });
});
```

**Step 2: Run the spec**

Run: `cd dashboard && E2E_API_KEY=wc-e2etest0000000000000000000000000000000000000000000000000000000000 npx playwright test e2e/specs/alerts.spec.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add dashboard/e2e/specs/alerts.spec.ts
git commit -m "test: add E2E spec for alert display and dismissal"
```

---

### Task 11: Add comparison.spec.ts

**Files:**
- Create: `dashboard/e2e/specs/comparison.spec.ts`

**Step 1: Write the spec**

```ts
// Requires: seed data — yes
import { test, expect } from "@playwright/test";

test.describe("Batch comparison (seed data)", () => {
  test("can select both Syrah batches and see overlaid charts", async ({ page }) => {
    await page.goto("/compare");

    // The comparison page should load
    await expect(page.getByText("Compare")).toBeVisible();

    // Find and select the Control Syrah (rendered as <button> with <Badge>)
    const controlButton = page.getByRole("button", { name: /2025 Syrah.*Control/ });
    await expect(controlButton).toBeVisible({ timeout: 10_000 });
    await controlButton.click();

    // Find and select the Oak Chips Syrah
    const oakButton = page.getByRole("button", { name: /2025 Syrah.*Oak Chips/ });
    await expect(oakButton).toBeVisible();
    await oakButton.click();

    // Chart should render with data
    const chart = page.locator(".recharts-wrapper");
    await expect(chart.first()).toBeVisible({ timeout: 10_000 });

    // Should have multiple lines (one per selected batch)
    const lines = chart.locator(".recharts-line");
    expect(await lines.count()).toBeGreaterThanOrEqual(2);
  });
});
```

**Step 2: Run the spec**

Run: `cd dashboard && E2E_API_KEY=wc-e2etest0000000000000000000000000000000000000000000000000000000000 npx playwright test e2e/specs/comparison.spec.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add dashboard/e2e/specs/comparison.spec.ts
git commit -m "test: add E2E spec for batch comparison with Syrah split trial"
```

---

### Task 12: Add completed-batch.spec.ts

**Files:**
- Create: `dashboard/e2e/specs/completed-batch.spec.ts`

**Step 1: Write the spec**

```ts
// Requires: seed data — yes
import { test, expect } from "@playwright/test";

test.describe("Completed batch (seed data)", () => {
  test("Merlot shows completed status and cellaring info", async ({ page }) => {
    // Navigate to batch list, completed tab
    await page.goto("/batches");
    await page.getByRole("tab", { name: "Completed" }).click();
    await expect(page.getByText("2024 Merlot")).toBeVisible({ timeout: 10_000 });
    await page.getByText("2024 Merlot").click();

    // Should be on batch detail
    await expect(page.getByRole("heading", { name: "2024 Merlot" })).toBeVisible();

    // Status should show Completed
    await expect(page.getByText("Completed")).toBeVisible();

    // Wine type
    await expect(page.getByText("Red")).toBeVisible();
  });

  test("Merlot shows cellaring card", async ({ page }) => {
    await page.goto("/batches");
    await page.getByRole("tab", { name: "Completed" }).click();
    await page.getByText("2024 Merlot").click();
    await expect(page.getByRole("heading", { name: "2024 Merlot" })).toBeVisible();

    // Cellaring section should be visible (it's rendered when bottled_at is set)
    await expect(page.getByText(/Cellaring|Ready|Peak/i)).toBeVisible({ timeout: 10_000 });
  });

  test("Merlot shows full activity history", async ({ page }) => {
    await page.goto("/batches");
    await page.getByRole("tab", { name: "Completed" }).click();
    await page.getByText("2024 Merlot").click();
    await expect(page.getByRole("heading", { name: "2024 Merlot" })).toBeVisible();

    // Should show activities from the full lifecycle
    await expect(page.getByText("Grapes received")).toBeVisible();
    await expect(page.getByText("Pitched yeast")).toBeVisible();
    await expect(page.getByText("Bottled")).toBeVisible();
  });

  test("Merlot has no stage selector", async ({ page }) => {
    await page.goto("/batches");
    await page.getByRole("tab", { name: "Completed" }).click();
    await page.getByText("2024 Merlot").click();
    await expect(page.getByRole("heading", { name: "2024 Merlot" })).toBeVisible();

    // Stage combobox should not be present for completed batches
    await expect(page.getByRole("button", { name: "Set Stage" })).not.toBeVisible();
  });
});
```

**Step 2: Run the spec**

Run: `cd dashboard && E2E_API_KEY=wc-e2etest0000000000000000000000000000000000000000000000000000000000 npx playwright test e2e/specs/completed-batch.spec.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add dashboard/e2e/specs/completed-batch.spec.ts
git commit -m "test: add E2E spec for completed batch with cellaring data"
```

---

### Task 13: Update CI workflow

**Files:**
- Modify: `.github/workflows/ci.yml`

**Step 1: Remove the seed-e2e.sh step**

In the `e2e-test` job, remove line 88 (`- run: bash api/scripts/seed-e2e.sh`). The reset script now runs automatically as part of the Playwright `webServer` command.

The `.dev.vars` creation step and `E2E_API_KEY` env var remain unchanged.

**Step 2: Verify the workflow looks correct**

The `e2e-test` job should now look like:

```yaml
e2e-test:
  name: E2E tests
  runs-on: ubuntu-latest
  env:
    E2E_API_KEY: wc-e2etest0000000000000000000000000000000000000000000000000000000000
  steps:
    - uses: actions/checkout@v6
    - uses: actions/setup-node@v6
      with:
        node-version: lts/*
        cache: npm
        cache-dependency-path: |
          api/package-lock.json
          dashboard/package-lock.json
    - run: npm ci
      working-directory: api
    - run: npm ci
      working-directory: dashboard
    - run: npx playwright install chromium --with-deps
      working-directory: dashboard
    - name: Create API dev vars for local testing
      run: |
        printf '%s\n' \
          'RP_ORIGIN=http://localhost:5173' \
          'RP_ID=localhost' \
          'WEBHOOK_TOKEN=ci-test-token' \
          'GITHUB_CLIENT_SECRET=unused-in-e2e' \
          > api/.dev.vars
    - run: npx playwright test
      working-directory: dashboard
    - uses: actions/upload-artifact@v4
      if: ${{ !cancelled() }}
      with:
        name: playwright-report
        path: |
          dashboard/test-results/
          dashboard/playwright-report/
        retention-days: 7
```

**Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: remove seed-e2e.sh step (now handled by Playwright webServer)"
```

---

### Task 14: Run full E2E suite and verify everything passes

**Step 1: Run locally**

Run: `cd dashboard && E2E_API_KEY=wc-e2etest0000000000000000000000000000000000000000000000000000000000 npx playwright test`
Expected: All specs pass — both read-only (dashboard, batch-detail, batch-list, alerts, comparison, completed-batch) and mutation (batch-lifecycle, batch-edit, stage-progression, activities, settings-api-keys).

**Step 2: If any test fails, debug and fix**

Use: `npx playwright test --headed specs/failing-spec.spec.ts` to watch the browser, or check `playwright-report/` for screenshots and traces.

**Step 3: Verify idempotency**

Run the suite again without restarting servers:
Run: `cd dashboard && E2E_API_KEY=wc-e2etest0000000000000000000000000000000000000000000000000000000000 npx playwright test`
Expected: "Seed data already present, skipping." in console output. All tests still pass.

**Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: E2E test adjustments after full suite validation"
```
