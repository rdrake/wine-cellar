# E2E Testing Overhaul — Design

> **Goal:** Replace the minimal E2E seed (one user, one API key, no data) with a rich, realistic test environment that exercises every dashboard view. Fresh database per run. Works locally and in CI.

---

## Architecture

Three layers:

1. **Clean slate** — `reset-e2e-db.sh` wipes the local D1 state directory, applies migrations, and bootstraps the E2E user + API key. Runs as part of Playwright's `webServer` command, before wrangler starts.
2. **Seed orchestrator** — `global-setup.ts` authenticates, then calls the seed function which creates batches and activities via API calls and bulk-inserts readings via SQL.
3. **Test conventions** — Read-only specs assert against seed data. Mutation specs create their own throwaway batches.

---

## File Structure

```
api/
  scripts/
    reset-e2e-db.sh        ← replaces seed-e2e.sh (wipe + migrate + bootstrap user)

dashboard/e2e/
  global-setup.ts           ← auth + seed orchestration
  fixtures/
    generators.ts           ← fermentation curve math, reading generation
    scenarios.ts            ← declarative batch definitions (11 batches)
    seed.ts                 ← orchestrator: API calls + SQL inserts
  specs/
    dashboard.spec.ts       ← read-only: seed data populates dashboard
    batch-detail.spec.ts    ← read-only: charts, snapshot, activities
    batch-list.spec.ts      ← read-only: status tabs, compare button
    comparison.spec.ts      ← read-only: Syrah control vs oak chips
    alerts.spec.ts          ← read-only: stalled Zinfandel alerts
    completed-batch.spec.ts ← read-only: Merlot lifecycle + cellaring
    batch-lifecycle.spec.ts ← mutation: creates own batch
    batch-edit.spec.ts      ← mutation: creates own batch
    stage-progression.spec.ts ← mutation: creates own batch
    activities.spec.ts      ← mutation: creates own batch
    settings-api-keys.spec.ts ← mutation: creates own API key
```

---

## Reset Script — `api/scripts/reset-e2e-db.sh`

Replaces `seed-e2e.sh`. Runs before wrangler starts.

1. `rm -rf .wrangler/state/v3/d1/` — guarantees clean SQLite
2. Apply all migrations via `wrangler d1 execute --local --file` for each `.sql` file
3. Insert E2E user and API key (same deterministic values as today)

The Playwright `webServer` command becomes:

```
cd ../api && bash scripts/reset-e2e-db.sh && npm run dev
```

---

## Global Setup — `e2e/global-setup.ts`

Runs after servers are up. Three steps:

1. **Authenticate** — `POST /api/v1/auth/login/api-key` with the deterministic key. Save `storageState` to `e2e/.auth/session.json`.
2. **Seed via API** — Call `seed()` from `fixtures/seed.ts`, passing the authenticated Playwright request context.
3. **Seed via SQL** — Bulk-insert readings and alert rows.

No teardown needed — the wipe at the start of the next run handles cleanup.

### Idempotency Guard

When `reuseExistingServer` is true (local dev with servers already running), the reset script does not run — the developer's existing DB is preserved. However, `globalSetup` always runs. To avoid polluting a developer's database on repeat runs, the seed function checks for a sentinel batch (e.g., queries for a batch named "Argentia Ridge Cab Sauv" owned by the E2E user) and skips seeding if found.

---

## Generator — `e2e/fixtures/generators.ts`

Exports `generateFermentationCurve()` which produces realistic reading arrays.

### Interface

```ts
generateFermentationCurve({
  og: 1.092,
  currentSg: 1.040,
  days: 5,
  tempTarget: 27,
  tempVariance: 1.5,
  readingsPerDay: 24,
  style: "red" | "white",
  stallAtSg?: 1.030,           // optional: flatten curve at this SG
  velocityMultiplier?: 0.95,   // optional: slow/speed the fermentation rate
})
// → Array<{ gravity: number, temperature: number, timestamp: string }>
```

### Curve Shape (Based on Real Fermentation Kinetics)

**Lag phase** (first 12-24h): Gravity barely moves. Temperature rises slightly as yeast acclimatize.

**Exponential phase** (hours 24-96): Steepest gravity drop. Reds at 27C lose ~0.010-0.015 SG/day; whites at 16C lose ~0.005-0.008 SG/day. Peak CO2 production warms the must 1-2C above ambient.

**Deceleration phase**: Gravity drop slows as sugar depletes. Follows a decaying exponential toward terminal SG.

**Stationary/complete**: Gravity flat at terminal SG. Temperature returns to ambient.

### Realism Details

- Temperature readings get Gaussian noise (+-0.3C) for realistic sparklines
- Stalled fermentation: curve flattens at `stallAtSg`, temperature drifts toward ambient
- Velocity multiplier: scales the fermentation rate (used for the Syrah oak chips variant)
- Readings timestamped hourly, anchored to the batch `started_at` date

---

## Scenarios — `e2e/fixtures/scenarios.ts`

Declarative array of 11 batch configurations. Each entry defines batch fields, generator parameters, and activities to create.

### Batch Lineup

| # | Name | Type | Source | Stage | Status | OG | ~SG | Days | Temp C |
|---|------|------|--------|-------|--------|-----|-----|------|--------|
| 1 | Argentia Ridge Cab Sauv | red | kit | primary_fermentation | active | 1.088 | 1.042 | 5 | 24 |
| 2 | Magnotta Chardonnay | white | juice_bucket | secondary_fermentation | active | 1.082 | 1.002 | 21 | 16 |
| 3 | Argentia Ridge Pinot Noir Rosé | rosé | kit | primary_fermentation | active | 1.076 | 1.063 | 2 | 20 |
| 4 | Magnotta Riesling | white | juice_bucket | stabilization | active | 1.084 | 0.996 | 45 | 12 |
| 5 | Argentia Ridge Zinfandel | red | kit | primary_fermentation | active | 1.092 | 1.030 | 12 | 22 |
| 6 | 2024 Merlot | red | fresh_grapes | bottling | completed | 1.090 | 0.994 | 180 | — |
| 7 | Magnotta Sauvignon Blanc | white | juice_bucket | bottling | archived | 1.080 | 0.995 | 120 | — |
| 8 | 2025 Blanc de Blancs | sparkling | fresh_grapes | secondary_fermentation | active | 1.084 | 1.010 | 14 | 14 |
| 9 | 2025 Syrah "Control" | red | fresh_grapes | primary_fermentation | active | 1.090 | 1.025 | 8 | 28 |
| 10 | 2025 Syrah "Oak Chips" | red | fresh_grapes | primary_fermentation | active | 1.090 | 1.027 | 8 | 28 |
| 11 | Magnotta Malbec | red | juice_bucket | primary_fermentation | abandoned | 1.086 | 1.050 | 4 | 24 |

### Scenario Details

**#1 — Argentia Ridge Cab Sauv** (healthy mid-primary kit)
- Standard Costco kit, no grape skins
- Fermentation temp 24C (room temp, typical for kit wines)
- Activities: pitched yeast (addition), 2 manual SG measurements
- The "everything is fine" baseline batch
- Device "Rapt Pill #1" assigned — exercises device section on batch detail

**#2 — Magnotta Chardonnay** (secondary with MLF)
- Juice bucket, completed primary, now in secondary
- MLF inoculated — addition activity for Leuconostoc bacteria
- One racking activity (off primary lees)
- Cooler fermentation curve (16C) with slower initial drop

**#3 — Argentia Ridge Pinot Noir Rosé** (early primary, premium kit)
- Kit with grape skins included — exercises skin-in-primary workflow
- Only 2 days of readings (~48 data points), just getting started
- Activities: pitched yeast, added grape skin pack

**#4 — Magnotta Riesling** (cold stabilization)
- Juice bucket, 45 days in, gravity fully dry at 0.996
- In stabilization stage at 12C
- Flat gravity curve with minimal temperature variance
- Activities: several rackings, K2S2O5 addition, cold stab note

**#5 — Argentia Ridge Zinfandel** (stalled fermentation)
- Premium kit with grape skins
- Stalled at 1.030 for 4 days — gravity flat since day 8
- Room temp 22C, too cool for this red's yeast strain
- Triggers `stall` and `temp_low` alert_state rows (inserted via SQL)
- Activities: pitched yeast, note "Checked fermentation — no activity"

**#6 — 2024 Merlot** (completed, fresh grapes)
- Full lifecycle from crush to bottle over 180 days
- `completed` status; `bottled_at` auto-set by completing at the `bottling` stage
- Cellaring data (ready date, peak window) is computed on read from `bottled_at`, `wine_type`, `source_material`, `oak_type`, `oak_duration_days`, `mlf_status` — these fields are set at batch creation time
- Activities interleaved with stage advancements (see Seed Orchestrator section)
- Longest reading series — full fermentation curve from 1.090 to 0.994
- Exercises fresh-grape-only features (pressing activity, skin contact)

**#7 — Magnotta Sauvignon Blanc** (archived)
- Juice bucket, 120 days, `archived` status
- All activities logged while batch is still active, before completing and archiving
- Minimal activity history (yeast pitch, 2 rackings, bottling)
- Shorter reading series — exercises the archived batch view

**#8 — 2025 Blanc de Blancs** (sparkling, fresh grapes)
- Methode traditionnelle from fresh Chardonnay grapes
- In secondary at 14C, SG still at 1.010 (will referment in bottle)
- Exercises the `sparkling` wine type display
- Activities: crushing, pressing, yeast pitch (Prise de Mousse)

**#9 — 2025 Syrah "Control"** (split trial)
- Fresh grapes, Pasteur Red yeast, 28C
- Standard fermentation curve at full velocity
- Activities: pitched yeast, punch-down notes

**#10 — 2025 Syrah "Oak Chips"** (split trial variant)
- Identical start date and OG as #9
- Oak chips added at day 3 (addition activity)
- `velocityMultiplier: 0.95` — 5% slower rate producing subtle visible divergence
- Activities: pitched yeast, added oak chips (day 3), punch-down notes

**#11 — Magnotta Malbec** (abandoned)
- Juice bucket, abandoned after 4 days due to contamination
- Exercises the `abandoned` status and the "Abandoned" tab in BatchList
- Activities: pitched yeast, note "Visible mold on surface — dumping batch"
- Abandoned via `POST .../abandon`

### Source Material Balance

- **3 kits** (Argentia Ridge): #1 standard, #3 premium with skins, #5 premium with skins
- **4 juice buckets** (Magnotta): #2, #4, #7, #11 across secondary/stabilization/archived/abandoned
- **3 fresh grapes**: #6 (completed lifecycle), #8 (sparkling), #9/#10 (comparison pair)

---

## Seed Orchestrator — `e2e/fixtures/seed.ts`

Exports `async function seed(apiContext, sqlExec)`.

The `sqlExec` function is implemented by writing all SQL statements to a temporary `.sql` file and executing it with a single `wrangler d1 execute --local --file /tmp/e2e-seed.sql` call via `child_process.execSync()`. This avoids spawning a wrangler process per INSERT batch and keeps bulk seeding fast.

### Lifecycle Batches (Merlot #6, Sauvignon Blanc #7)

These batches need activities interleaved with stage advancements because the API enforces that activity stages must be allowed by the batch's current waypoint (`WAYPOINT_ALLOWED_STAGES[batch.stage]`). The seed orchestrates them as:

1. `POST /batches` — creates at `must_prep` (default stage)
2. Log `receiving`/`crushing`/`must_prep` activities
3. `POST /batches/:id/stage` → `primary_fermentation`
4. Log `primary_fermentation`/`pressing` activities
5. `POST /batches/:id/stage` → `secondary_fermentation`
6. Log `secondary_fermentation`/`malolactic` activities
7. Continue advancing and logging through remaining stages
8. After all activities are logged: `POST /batches/:id/complete` (auto-sets `bottled_at` when at `bottling` stage)
9. For Sauvignon Blanc: `POST /batches/:id/archive`

All other batches (simple scenarios) are seeded with: create → advance to target stage → log activities at that stage.

### Phase 1 — Devices (API)

Create one device and assign it to batch #1 (Cab Sauv):
1. `POST /api/v1/devices` with a deterministic device ID and name "Rapt Pill #1"
2. `POST /api/v1/devices/:id/assign` to batch #1

### Phase 2 — Simple Batches & Activities (API)

For batches #1-5, #8-11 (non-lifecycle batches):
1. `POST /api/v1/batches` with batch fields — capture returned `id`
2. If the scenario's target stage is beyond `primary_fermentation`, call `POST /api/v1/batches/:id/stage` to advance through each waypoint
3. `POST /api/v1/batches/:id/activities` for each activity
4. For batch #11 (Malbec): `POST /api/v1/batches/:id/abandon`

### Phase 3 — Lifecycle Batches (API)

For batches #6 and #7, use the interleaved approach described above.

### Phase 4 — Bulk Readings (SQL)

For each scenario:
1. Call `generateFermentationCurve()` with the scenario's parameters
2. Build INSERT statements using a **unique `device_id` per batch** (e.g., `e2e-device-01` through `e2e-device-11`) to avoid the dedup index constraint on `(device_id, source_timestamp)`
3. For batch #1, use the real device ID from Phase 1 so the device assignment is consistent
4. Write all INSERT statements to a single temp `.sql` file
5. Execute with one `wrangler d1 execute --local --file` call
6. `source` is `"device"` to simulate Rapt Pill data

### Phase 5 — Alerts (SQL)

Appended to the same `.sql` file as Phase 4. Insert `alert_state` rows for the Zinfandel:
- `stall` alert: `fired_at` = 4 days ago, no `dismissed_at` or `resolved_at`
- `temp_low` alert: `fired_at` = 4 days ago, no `dismissed_at` or `resolved_at`

### Estimated Data Volume

~11 batches, ~50 activities, ~9,000 readings, 1 device, 2 alerts. Seed time under 5 seconds (API calls ~2-3s, single SQL file execution ~1-2s).

---

## Test Specs

### Parallel Execution Strategy

The Playwright config uses `fullyParallel: true`. Mutation specs create their own batches, which increases the active batch count. To prevent this from breaking read-only assertions, read-only specs use **"at least N"** assertions rather than exact counts (e.g., "at least 8 active batches" instead of "exactly 8"). Specific seed batches are asserted by name, which is stable regardless of what mutation specs create concurrently.

### Read-Only Specs (Assert Against Seed Data)

**`dashboard.spec.ts`** — Dashboard populated correctly
- Summary stats show at least 8 active batches
- Active batches section lists seed batches by name
- Sparkline charts render (SVG elements present) for batches with readings
- Zinfandel appears in "Needs attention" alerts
- Recent activities section shows activities from seed data

**`batch-detail.spec.ts`** — Batch detail views work with real data
- Navigate to the Cabernet (healthy mid-primary)
- Snapshot card shows OG, current SG, ABV, attenuation, temperature
- Gravity chart renders with data points
- Activity timeline shows seeded activities
- Stage displays as "Primary Fermentation"
- Device section shows "Rapt Pill #1" assigned

**`batch-list.spec.ts`** — BatchList page with status tabs
- Active tab shows at least 8 batches
- Completed tab shows the Merlot
- Archived tab shows the Sauvignon Blanc
- Abandoned tab shows the Malbec
- Compare button navigates to comparison view

**`alerts.spec.ts`** — Alert display and interaction
- Zinfandel stall alert visible on dashboard
- Can dismiss an alert
- Alert disappears after dismissal

**`comparison.spec.ts`** — Comparison feature with Syrah pair
- Both Syrah batches selectable
- Charts render overlaid curves
- Visible divergence between control and oak chips

**`completed-batch.spec.ts`** — Completed batch lifecycle
- Navigate to the Merlot
- Status shows "Completed"
- Cellaring card visible with ready date, peak window
- Full activity history from crush to bottle
- No stage selector (batch is done)

### Mutation Specs (Self-Contained, Unchanged)

These create their own data and do not depend on seed state. Moved to `e2e/specs/` but logic unchanged:

- `batch-lifecycle.spec.ts` — create and view a batch
- `batch-edit.spec.ts` — create and edit a batch
- `stage-progression.spec.ts` — create batch, change stage
- `activities.spec.ts` — create batch, log SG measurement + note
- `settings-api-keys.spec.ts` — create and revoke an API key

All mutation specs use `// Requires: seed data — no` comment header.
All read-only specs use `// Requires: seed data — yes` comment header.

---

## CI Workflow Changes

The `e2e-test` job in `.github/workflows/ci.yml` removes the `bash api/scripts/seed-e2e.sh` step. The reset script now runs automatically as part of Playwright's `webServer` command. The `.dev.vars` creation step and `E2E_API_KEY` env var remain unchanged — both are still required.

```yaml
# REMOVED:
# - run: bash api/scripts/seed-e2e.sh

# webServer command now handles it:
# "cd ../api && bash scripts/reset-e2e-db.sh && npm run dev"
```

---

## Playwright Config Changes

```ts
// dashboard/playwright.config.ts
export default defineConfig({
  testDir: "./e2e/specs",  // changed from ./e2e
  globalSetup: "./e2e/global-setup.ts",
  // ... rest unchanged
  webServer: [
    {
      command: "cd ../api && bash scripts/reset-e2e-db.sh && npm run dev",
      port: 8787,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,  // increased from 30s to accommodate migrations
    },
    // vite server unchanged
  ],
});
```

When `reuseExistingServer: true` (local dev with servers already running), the entire `command` is skipped — the reset script does not run and the developer's existing DB is preserved. The `globalSetup` still runs but the idempotency guard (see Global Setup section) skips seeding if seed data already exists.

---

## Migration Path

1. Delete `api/scripts/seed-e2e.sh` — replaced by `reset-e2e-db.sh`
2. Move existing spec files from `e2e/*.spec.ts` to `e2e/specs/*.spec.ts`
3. Rewrite `dashboard.spec.ts` to assert seed data
4. Add new spec files (batch-detail, batch-list, alerts, comparison, completed-batch)
5. Update `playwright.config.ts` testDir, webServer command, and timeout
6. Update CI workflow (remove seed step)
7. Update `.gitignore` if needed
