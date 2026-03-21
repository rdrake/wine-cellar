# Push Alerts & Stage Transitions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add server-side alert evaluation with push notifications for fermentation events, and make batch stage transitions flexible (forward and backward).

**Architecture:** Server-side alert evaluation triggered on webhook insert and via 15-min cron. Web Push API for OS-native notifications. Alert state persisted in D1 with partial unique index for race-safe dedup. Stage transitions relaxed to allow any waypoint, with advance kept as compat wrapper.

**Tech Stack:** Hono (API), Cloudflare Workers (cron), D1 (SQLite), Web Push protocol via crypto.subtle, React (dashboard), Service Worker (push handler)

---

## Phase 1: Database & Stage Transitions

### Task 1: Migration — target_gravity and alert tables

**Files:**
- Create: `api/migrations/0006_alerts_and_stages.sql`

**Step 1: Write the migration**

```sql
-- 0006_alerts_and_stages.sql
-- Add target_gravity to batches, push subscriptions, and alert state tables

ALTER TABLE batches ADD COLUMN target_gravity REAL;

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE alert_state (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  batch_id TEXT NOT NULL REFERENCES batches(id),
  alert_type TEXT NOT NULL CHECK (alert_type IN ('stall', 'no_readings', 'temp_high', 'temp_low', 'stage_suggestion')),
  context TEXT,
  fired_at TEXT NOT NULL,
  dismissed_at TEXT,
  resolved_at TEXT
);

CREATE UNIQUE INDEX idx_alert_one_active
  ON alert_state (user_id, batch_id, alert_type)
  WHERE resolved_at IS NULL AND dismissed_at IS NULL;
```

**Step 2: Verify migration loads in tests**

Run: `cd api && npx vitest run test/health.test.ts`
Expected: PASS (migration is auto-loaded by vitest.config.ts)

**Step 3: Commit**

```bash
git add api/migrations/0006_alerts_and_stages.sql
git commit -m "feat: migration for target_gravity, push_subscriptions, alert_state"
```

---

### Task 2: Flexible stage endpoint + advance wrapper

**Files:**
- Modify: `api/src/routes/batches.ts:158-173`
- Modify: `api/src/schema.ts` (import BATCH_STAGES)
- Test: `api/test/batch-lifecycle.test.ts`

**Step 1: Write the failing tests**

Add to `api/test/batch-lifecycle.test.ts`:

```typescript
it("sets stage to any waypoint", async () => {
  const batchId = await createBatch();
  const { status, json } = await fetchJson(`/api/v1/batches/${batchId}/stage`, {
    method: "POST", headers: API_HEADERS, body: { stage: "stabilization" },
  });
  expect(status).toBe(200);
  expect(json.stage).toBe("stabilization");
});

it("moves stage backward", async () => {
  const batchId = await createBatch();
  // Advance to secondary first
  await fetchJson(`/api/v1/batches/${batchId}/stage`, {
    method: "POST", headers: API_HEADERS, body: { stage: "secondary_fermentation" },
  });
  // Go back to must_prep
  const { status, json } = await fetchJson(`/api/v1/batches/${batchId}/stage`, {
    method: "POST", headers: API_HEADERS, body: { stage: "must_prep" },
  });
  expect(status).toBe(200);
  expect(json.stage).toBe("must_prep");
});

it("stage change logs activity", async () => {
  const batchId = await createBatch();
  await fetchJson(`/api/v1/batches/${batchId}/stage`, {
    method: "POST", headers: API_HEADERS, body: { stage: "primary_fermentation" },
  });
  const { json: activities } = await fetchJson(`/api/v1/batches/${batchId}/activities`, {
    headers: API_HEADERS,
  });
  expect(activities.items.length).toBe(1);
  expect(activities.items[0].title).toContain("must_prep");
  expect(activities.items[0].title).toContain("primary_fermentation");
});

it("rejects invalid stage name", async () => {
  const batchId = await createBatch();
  const { status } = await fetchJson(`/api/v1/batches/${batchId}/stage`, {
    method: "POST", headers: API_HEADERS, body: { stage: "invalid_stage" },
  });
  expect(status).toBe(422);
});

it("rejects stage change on non-active batch", async () => {
  const batchId = await createBatch();
  await fetchJson(`/api/v1/batches/${batchId}/complete`, { method: "POST", headers: API_HEADERS });
  const { status } = await fetchJson(`/api/v1/batches/${batchId}/stage`, {
    method: "POST", headers: API_HEADERS, body: { stage: "bottling" },
  });
  expect(status).toBe(409);
});

it("no-ops when setting same stage", async () => {
  const batchId = await createBatch();
  const { status, json } = await fetchJson(`/api/v1/batches/${batchId}/stage`, {
    method: "POST", headers: API_HEADERS, body: { stage: "must_prep" },
  });
  expect(status).toBe(200);
  expect(json.stage).toBe("must_prep");
  // No activity logged for no-op
  const { json: activities } = await fetchJson(`/api/v1/batches/${batchId}/activities`, {
    headers: API_HEADERS,
  });
  expect(activities.items.length).toBe(0);
});
```

**Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run test/batch-lifecycle.test.ts`
Expected: FAIL — "stage" route not found (404)

**Step 3: Implement the stage endpoint**

In `api/src/routes/batches.ts`, add a `StageSetSchema` import and replace the advance endpoint. Add the new `POST /:batchId/stage` before the existing advance, and rewrite advance as a wrapper:

Add to `api/src/models.ts`:

```typescript
export const StageSetSchema = z.object({
  stage: z.enum(BATCH_STAGES),
});
```

(Add `BATCH_STAGES` to the import from `./schema`.)

In `api/src/routes/batches.ts`, replace the advance endpoint (lines 158-173) with:

```typescript
// --- Flexible stage transition ---
batches.post("/:batchId/stage", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const batchId = c.req.param("batchId");
  const row = await getOwnedBatch(db, batchId, user.id);
  if (!row) return notFound("Batch");
  if (row.status !== "active") return conflict("Only active batches can change stage");

  const body = await c.req.json().catch(() => null);
  const parsed = StageSetSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.issues);

  const newStage = parsed.data.stage;
  if (newStage === row.stage) {
    return c.json(row); // no-op
  }

  const now = nowUtc();
  await db.prepare("UPDATE batches SET stage = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(newStage, now, batchId, user.id).run();

  // Log stage change activity
  await db.prepare(
    `INSERT INTO activities (id, user_id, batch_id, stage, type, title, recorded_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'note', ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), user.id, batchId, newStage, `Stage changed from ${row.stage} to ${newStage}`, now, now, now).run();

  return c.json(await getOwnedBatch(db, batchId, user.id));
});

// --- Advance (compat wrapper) ---
batches.post("/:batchId/advance", async (c) => {
  const db = c.env.DB;
  const batchId = c.req.param("batchId");
  const row = await getOwnedBatch(db, batchId, c.get("user").id);
  if (!row) return notFound("Batch");
  if (row.status !== "active") return conflict("Only active batches can advance");

  const currentIdx = WAYPOINT_ORDER.indexOf(row.stage);
  if (currentIdx >= WAYPOINT_ORDER.length - 1) return conflict("Batch is at final stage");

  const nextStage = WAYPOINT_ORDER[currentIdx + 1];
  // Forward to stage endpoint logic
  const now = nowUtc();
  await db.prepare("UPDATE batches SET stage = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(nextStage, now, batchId, c.get("user").id).run();

  await db.prepare(
    `INSERT INTO activities (id, user_id, batch_id, stage, type, title, recorded_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'note', ?, ?, ?, ?)`
  ).bind(crypto.randomUUID(), c.get("user").id, batchId, nextStage, `Stage changed from ${row.stage} to ${nextStage}`, now, now, now).run();

  return c.json(await getOwnedBatch(db, batchId, c.get("user").id));
});
```

Add `StageSetSchema` to the import from `../models`.

**Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run test/batch-lifecycle.test.ts`
Expected: ALL PASS

**Step 5: Run full test suite**

Run: `cd api && npx vitest run`
Expected: ALL PASS (existing advance tests should still work)

**Step 6: Commit**

```bash
git add api/src/routes/batches.ts api/src/models.ts api/test/batch-lifecycle.test.ts
git commit -m "feat: flexible stage transitions with activity logging"
```

---

### Task 3: target_gravity in batch create/update

**Files:**
- Modify: `api/src/models.ts:12-20` (BatchCreateSchema)
- Modify: `api/src/models.ts:23-29` (BatchUpdateSchema)
- Modify: `api/src/routes/batches.ts:15-38` (INSERT)
- Modify: `api/src/routes/batches.ts:102` (allowedCols)
- Test: `api/test/batches.test.ts`

**Step 1: Write the failing test**

Add to `api/test/batches.test.ts`:

```typescript
it("creates batch with target_gravity", async () => {
  const { status, json } = await fetchJson("/api/v1/batches", {
    method: "POST", headers: API_HEADERS,
    body: { ...VALID_BATCH, target_gravity: 0.996 },
  });
  expect(status).toBe(201);
  expect(json.target_gravity).toBe(0.996);
});

it("updates target_gravity", async () => {
  const batchId = await createBatch();
  const { status, json } = await fetchJson(`/api/v1/batches/${batchId}`, {
    method: "PATCH", headers: API_HEADERS, body: { target_gravity: 1.000 },
  });
  expect(status).toBe(200);
  expect(json.target_gravity).toBe(1.0);
});
```

**Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run test/batches.test.ts`
Expected: FAIL — target_gravity not in schema / not returned

**Step 3: Implement**

In `api/src/models.ts`, add `target_gravity` to both schemas:

```typescript
// In BatchCreateSchema, after target_volume_liters:
target_gravity: z.number().nullable().optional(),

// In BatchUpdateSchema, after target_volume_liters:
target_gravity: z.number().nullable().optional(),
```

In `api/src/routes/batches.ts`, update the INSERT in the POST handler to include `target_gravity`:

Update the INSERT SQL to add `target_gravity` column and bind `b.target_gravity ?? null`.

Update `allowedCols` (line 102) to include `"target_gravity"`.

**Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run test/batches.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add api/src/models.ts api/src/routes/batches.ts api/test/batches.test.ts
git commit -m "feat: add target_gravity to batch create and update"
```

---

## Phase 2: Alert Evaluation Engine

### Task 4: Server-side alert evaluation logic

**Files:**
- Create: `api/src/lib/alerts.ts`
- Test: `api/test/alerts.test.ts`

**Step 1: Write the failing tests**

Create `api/test/alerts.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { evaluateAlerts, type BatchAlertContext } from "../src/lib/alerts";

function makeContext(overrides: Partial<BatchAlertContext> = {}): BatchAlertContext {
  return {
    batchId: "batch-1",
    userId: "user-1",
    stage: "primary_fermentation",
    targetGravity: null,
    hasAssignedDevice: true,
    readings: [],
    ...overrides,
  };
}

function makeReadings(gravities: number[], intervalHours = 1, startTemp = 22): BatchAlertContext["readings"] {
  const now = Date.now();
  return gravities.map((g, i) => ({
    gravity: g,
    temperature: startTemp,
    source_timestamp: new Date(now - (gravities.length - 1 - i) * intervalHours * 3600000).toISOString(),
  }));
}

describe("evaluateAlerts", () => {
  it("returns empty for batch with no readings", () => {
    const alerts = evaluateAlerts(makeContext({ readings: [] }));
    expect(alerts).toEqual([]);
  });

  it("detects stall when gravity stuck above 1.005", () => {
    // 20 readings all at 1.050 over 72 hours
    const readings = makeReadings(Array(20).fill(1.050), 4);
    const alerts = evaluateAlerts(makeContext({ readings }));
    expect(alerts.some((a) => a.type === "stall")).toBe(true);
  });

  it("does not stall when gravity below 0.998", () => {
    const readings = makeReadings(Array(20).fill(0.995), 4);
    const alerts = evaluateAlerts(makeContext({ readings }));
    expect(alerts.some((a) => a.type === "stall")).toBe(false);
  });

  it("detects temp_high", () => {
    const readings = makeReadings([1.050], 1, 31);
    const alerts = evaluateAlerts(makeContext({ readings }));
    expect(alerts.some((a) => a.type === "temp_high")).toBe(true);
  });

  it("detects temp_low", () => {
    const readings = makeReadings([1.050], 1, 7);
    const alerts = evaluateAlerts(makeContext({ readings }));
    expect(alerts.some((a) => a.type === "temp_low")).toBe(true);
  });

  it("detects no_readings when device assigned but last reading old", () => {
    const old = new Date(Date.now() - 49 * 3600000).toISOString();
    const alerts = evaluateAlerts(makeContext({
      hasAssignedDevice: true,
      readings: [{ gravity: 1.050, temperature: 22, source_timestamp: old }],
    }));
    expect(alerts.some((a) => a.type === "no_readings")).toBe(true);
  });

  it("no no_readings when no device assigned", () => {
    const old = new Date(Date.now() - 49 * 3600000).toISOString();
    const alerts = evaluateAlerts(makeContext({
      hasAssignedDevice: false,
      readings: [{ gravity: 1.050, temperature: 22, source_timestamp: old }],
    }));
    expect(alerts.some((a) => a.type === "no_readings")).toBe(false);
  });

  it("suggests primary→secondary when gravity < 1.020 and velocity slowing", () => {
    // Simulate: 7 days of readings dropping fast, then 2 days slowing
    const fast = Array.from({ length: 12 }, (_, i) => 1.080 - i * 0.005); // 1.080 → 1.025
    const slow = [1.019, 1.018]; // barely moving
    const readings = makeReadings([...fast, ...slow], 12);
    const alerts = evaluateAlerts(makeContext({ stage: "primary_fermentation", readings }));
    expect(alerts.some((a) => a.type === "stage_suggestion")).toBe(true);
  });

  it("suggests secondary→stabilization when gravity stable and low", () => {
    // 15 readings all at 0.998 over 4 days
    const readings = makeReadings(Array(15).fill(0.998), 6);
    const alerts = evaluateAlerts(makeContext({ stage: "secondary_fermentation", readings }));
    expect(alerts.some((a) => a.type === "stage_suggestion")).toBe(true);
  });

  it("no stage suggestion for must_prep or stabilization", () => {
    const readings = makeReadings(Array(15).fill(0.998), 6);
    expect(evaluateAlerts(makeContext({ stage: "must_prep", readings })).some((a) => a.type === "stage_suggestion")).toBe(false);
    expect(evaluateAlerts(makeContext({ stage: "stabilization", readings })).some((a) => a.type === "stage_suggestion")).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run test/alerts.test.ts`
Expected: FAIL — module not found

**Step 3: Implement `api/src/lib/alerts.ts`**

```typescript
export type AlertType = "stall" | "no_readings" | "temp_high" | "temp_low" | "stage_suggestion";

export interface AlertCandidate {
  type: AlertType;
  message: string;
  context: Record<string, unknown>;
}

export interface BatchAlertContext {
  batchId: string;
  userId: string;
  stage: string;
  targetGravity: number | null;
  hasAssignedDevice: boolean;
  readings: { gravity: number; temperature: number | null; source_timestamp: string }[];
}

function velocity(readings: BatchAlertContext["readings"], windowHours: number): number | null {
  if (readings.length < 2) return null;
  const latest = readings[readings.length - 1];
  const cutoff = new Date(new Date(latest.source_timestamp).getTime() - windowHours * 3600000);
  const oldest = readings.find((r) => new Date(r.source_timestamp) >= cutoff);
  if (!oldest || oldest === latest) return null;
  const days = (new Date(latest.source_timestamp).getTime() - new Date(oldest.source_timestamp).getTime()) / 86400000;
  if (days <= 0) return null;
  return (latest.gravity - oldest.gravity) / days;
}

export function evaluateAlerts(ctx: BatchAlertContext): AlertCandidate[] {
  const alerts: AlertCandidate[] = [];
  const { readings, stage, hasAssignedDevice, targetGravity } = ctx;

  if (readings.length === 0) return alerts;

  const latest = readings[readings.length - 1];

  // --- Temperature alerts (even with 1 reading) ---
  if (latest.temperature != null && latest.temperature >= 30) {
    alerts.push({
      type: "temp_high",
      message: `${latest.temperature.toFixed(1)}°C — high temperature`,
      context: { temperature: latest.temperature },
    });
  }
  if (latest.temperature != null && latest.temperature <= 8) {
    alerts.push({
      type: "temp_low",
      message: `${latest.temperature.toFixed(1)}°C — low temperature`,
      context: { temperature: latest.temperature },
    });
  }

  // --- No readings alert ---
  if (hasAssignedDevice) {
    const hoursSinceLatest = (Date.now() - new Date(latest.source_timestamp).getTime()) / 3600000;
    if (hoursSinceLatest >= 48) {
      alerts.push({
        type: "no_readings",
        message: `No reading in ${Math.floor(hoursSinceLatest)}h`,
        context: { hours_since: Math.floor(hoursSinceLatest) },
      });
    }
  }

  // --- Stall detection (need >= 10 readings) ---
  if (readings.length >= 10) {
    const v48 = velocity(readings, 48);
    const v7d = velocity(readings, 168);
    if (v48 !== null && latest.gravity > 1.005 && latest.gravity >= 0.998) {
      if (Math.abs(v48) < 0.0005) {
        alerts.push({
          type: "stall",
          message: "Gravity unchanged for 48+ hours",
          context: { gravity: latest.gravity, velocity_48h: v48 },
        });
      } else if (v7d !== null && v7d !== 0 && Math.abs(v48) < Math.abs(v7d) * 0.2) {
        alerts.push({
          type: "stall",
          message: "Velocity dropped to <20% of 7-day average",
          context: { gravity: latest.gravity, velocity_48h: v48, velocity_7d: v7d },
        });
      }
    }
  }

  // --- Stage suggestions (need >= 10 readings) ---
  if (readings.length >= 10) {
    if (stage === "primary_fermentation") {
      const v48 = velocity(readings, 48);
      const v7d = velocity(readings, 168);
      if (v48 !== null && v7d !== null && latest.gravity < 1.020 && v7d !== 0) {
        if (Math.abs(v48) < Math.abs(v7d) * 0.5) {
          alerts.push({
            type: "stage_suggestion",
            message: `Gravity at ${latest.gravity.toFixed(3)}, velocity slowing. Consider racking to secondary.`,
            context: { gravity: latest.gravity, velocity_48h: v48, velocity_7d: v7d, next_stage: "secondary_fermentation" },
          });
        }
      }
    }

    if (stage === "secondary_fermentation") {
      // Check 72h stability: < 0.001 SG change
      const cutoff72h = new Date(Date.now() - 72 * 3600000);
      const recent72h = readings.filter((r) => new Date(r.source_timestamp) >= cutoff72h);
      if (recent72h.length >= 3) {
        const gravities = recent72h.map((r) => r.gravity);
        const range = Math.max(...gravities) - Math.min(...gravities);
        const belowTarget = targetGravity
          ? latest.gravity <= targetGravity + 0.002
          : latest.gravity < 1.000;
        if (range < 0.001 && belowTarget) {
          alerts.push({
            type: "stage_suggestion",
            message: `Gravity stable at ${latest.gravity.toFixed(3)} for 72h. Consider stabilization.`,
            context: { gravity: latest.gravity, range_72h: range, next_stage: "stabilization" },
          });
        }
      }
    }
  }

  return alerts;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run test/alerts.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add api/src/lib/alerts.ts api/test/alerts.test.ts
git commit -m "feat: server-side alert evaluation engine"
```

---

### Task 5: Alert state persistence and dedup

**Files:**
- Create: `api/src/lib/alert-manager.ts`
- Test: `api/test/alert-manager.test.ts`

**Step 1: Write the failing tests**

Create `api/test/alert-manager.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations, authHeaders, fetchJson } from "./helpers";
import { processAlerts, resolveCleared, getActiveAlerts } from "../src/lib/alert-manager";

const USER_ID = "test-user-id";
const BATCH_ID = "test-batch-id";

beforeEach(async () => {
  await applyMigrations();
  // Create user and batch for FK constraints
  await env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, datetime('now'))")
    .bind(USER_ID, "test@example.com").run();
  await env.DB.prepare(
    `INSERT INTO batches (id, user_id, name, wine_type, source_material, stage, status, started_at, created_at, updated_at)
     VALUES (?, ?, 'Test Batch', 'red', 'kit', 'primary_fermentation', 'active', datetime('now'), datetime('now'), datetime('now'))`
  ).bind(BATCH_ID, USER_ID).run();
});

describe("alert-manager", () => {
  it("inserts new alert and returns it", async () => {
    const fired = await processAlerts(env.DB, USER_ID, BATCH_ID, [
      { type: "temp_high", message: "30.5°C — high", context: { temperature: 30.5 } },
    ]);
    expect(fired.length).toBe(1);
    expect(fired[0].alert_type).toBe("temp_high");
  });

  it("deduplicates — second call returns nothing", async () => {
    const candidate = { type: "temp_high" as const, message: "30.5°C", context: { temperature: 30.5 } };
    await processAlerts(env.DB, USER_ID, BATCH_ID, [candidate]);
    const second = await processAlerts(env.DB, USER_ID, BATCH_ID, [candidate]);
    expect(second.length).toBe(0);
  });

  it("resolveCleared marks missing alerts as resolved", async () => {
    await processAlerts(env.DB, USER_ID, BATCH_ID, [
      { type: "temp_high", message: "hot", context: {} },
    ]);
    // Now temp is fine — pass empty candidates
    await resolveCleared(env.DB, USER_ID, BATCH_ID, []);
    const active = await getActiveAlerts(env.DB, USER_ID);
    expect(active.length).toBe(0);
  });

  it("re-fires after resolved", async () => {
    const candidate = { type: "temp_high" as const, message: "hot", context: {} };
    await processAlerts(env.DB, USER_ID, BATCH_ID, [candidate]);
    await resolveCleared(env.DB, USER_ID, BATCH_ID, []);
    const refired = await processAlerts(env.DB, USER_ID, BATCH_ID, [candidate]);
    expect(refired.length).toBe(1);
  });

  it("dismissed alert does not re-fire until resolved", async () => {
    const candidate = { type: "stall" as const, message: "stuck", context: {} };
    const [alert] = await processAlerts(env.DB, USER_ID, BATCH_ID, [candidate]);
    // Dismiss it
    await env.DB.prepare("UPDATE alert_state SET dismissed_at = datetime('now') WHERE id = ?").bind(alert.id).run();
    // Same condition — should not fire
    const refired = await processAlerts(env.DB, USER_ID, BATCH_ID, [candidate]);
    expect(refired.length).toBe(0);
  });

  it("getActiveAlerts returns only unresolved undismissed", async () => {
    await processAlerts(env.DB, USER_ID, BATCH_ID, [
      { type: "temp_high", message: "hot", context: {} },
      { type: "stall", message: "stuck", context: {} },
    ]);
    // Dismiss stall
    const all = await getActiveAlerts(env.DB, USER_ID);
    expect(all.length).toBe(2);
    await env.DB.prepare("UPDATE alert_state SET dismissed_at = datetime('now') WHERE alert_type = 'stall'").run();
    const active = await getActiveAlerts(env.DB, USER_ID);
    expect(active.length).toBe(1);
    expect(active[0].alert_type).toBe("temp_high");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run test/alert-manager.test.ts`
Expected: FAIL — module not found

**Step 3: Implement `api/src/lib/alert-manager.ts`**

```typescript
import type { AlertCandidate, AlertType } from "./alerts";
import { nowUtc } from "./time";

export interface FiredAlert {
  id: string;
  user_id: string;
  batch_id: string;
  alert_type: AlertType;
  context: string | null;
  fired_at: string;
}

/**
 * Process alert candidates for a batch. Inserts new alerts (deduped by partial unique index).
 * Returns only newly fired alerts (for push notification).
 */
export async function processAlerts(
  db: D1Database,
  userId: string,
  batchId: string,
  candidates: AlertCandidate[],
): Promise<FiredAlert[]> {
  const fired: FiredAlert[] = [];
  const now = nowUtc();

  for (const candidate of candidates) {
    const id = crypto.randomUUID();
    try {
      await db.prepare(
        `INSERT INTO alert_state (id, user_id, batch_id, alert_type, context, fired_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(id, userId, batchId, candidate.type, JSON.stringify(candidate.context), now).run();

      fired.push({
        id,
        user_id: userId,
        batch_id: batchId,
        alert_type: candidate.type,
        context: JSON.stringify(candidate.context),
        fired_at: now,
      });
    } catch (e: any) {
      // Unique index violation means alert already active or dismissed — skip
      if (String(e).includes("UNIQUE")) continue;
      throw e;
    }
  }

  return fired;
}

/**
 * Resolve alerts whose condition has cleared. Any active/dismissed alert
 * for this batch whose type is NOT in the current candidates gets resolved.
 */
export async function resolveCleared(
  db: D1Database,
  userId: string,
  batchId: string,
  currentCandidates: AlertCandidate[],
): Promise<void> {
  const activeTypes = new Set(currentCandidates.map((c) => c.type));

  const existing = await db.prepare(
    "SELECT id, alert_type FROM alert_state WHERE user_id = ? AND batch_id = ? AND resolved_at IS NULL"
  ).bind(userId, batchId).all<{ id: string; alert_type: string }>();

  for (const row of existing.results) {
    if (!activeTypes.has(row.alert_type as AlertType)) {
      await db.prepare("UPDATE alert_state SET resolved_at = ? WHERE id = ?")
        .bind(nowUtc(), row.id).run();
    }
  }
}

/**
 * Get all active (not resolved, not dismissed) alerts for a user.
 */
export async function getActiveAlerts(db: D1Database, userId: string) {
  const result = await db.prepare(
    `SELECT ast.*, b.name as batch_name
     FROM alert_state ast
     JOIN batches b ON b.id = ast.batch_id
     WHERE ast.user_id = ? AND ast.resolved_at IS NULL AND ast.dismissed_at IS NULL
     ORDER BY ast.fired_at DESC`
  ).bind(userId).all<any>();
  return result.results;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd api && npx vitest run test/alert-manager.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add api/src/lib/alert-manager.ts api/test/alert-manager.test.ts
git commit -m "feat: alert state persistence with dedup and resolve lifecycle"
```

---

### Task 6: Dismiss endpoint and dashboard alerts

**Files:**
- Create: `api/src/routes/alerts.ts`
- Modify: `api/src/app.ts:34-40` (mount alerts route)
- Modify: `api/src/routes/dashboard.ts:77-80` (add alerts to response)
- Test: `api/test/alerts-api.test.ts`

**Step 1: Write failing tests**

Create `api/test/alerts-api.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations, fetchJson, authHeaders, createBatch, API_HEADERS } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

describe("alerts API", () => {
  it("dismiss marks alert as dismissed", async () => {
    const batchId = await createBatch();
    // Get user ID
    const { json: me } = await fetchJson("/api/v1/me", { headers: API_HEADERS });
    // Insert an alert directly
    const alertId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO alert_state (id, user_id, batch_id, alert_type, fired_at) VALUES (?, ?, ?, 'temp_high', datetime('now'))"
    ).bind(alertId, me.id, batchId).run();

    const { status } = await fetchJson(`/api/v1/alerts/${alertId}/dismiss`, {
      method: "POST", headers: API_HEADERS,
    });
    expect(status).toBe(200);

    // Verify dismissed
    const row = await env.DB.prepare("SELECT dismissed_at FROM alert_state WHERE id = ?").bind(alertId).first<any>();
    expect(row.dismissed_at).not.toBeNull();
  });

  it("dismiss rejects other user's alert", async () => {
    const batchId = await createBatch();
    const alertId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO alert_state (id, user_id, batch_id, alert_type, fired_at) VALUES (?, 'other-user', ?, 'temp_high', datetime('now'))"
    ).bind(alertId, batchId).run();

    const { status } = await fetchJson(`/api/v1/alerts/${alertId}/dismiss`, {
      method: "POST", headers: API_HEADERS,
    });
    expect(status).toBe(404);
  });

  it("dashboard includes active alerts", async () => {
    const batchId = await createBatch();
    const { json: me } = await fetchJson("/api/v1/me", { headers: API_HEADERS });
    await env.DB.prepare(
      "INSERT INTO alert_state (id, user_id, batch_id, alert_type, context, fired_at) VALUES (?, ?, ?, 'stall', '{\"gravity\":1.050}', datetime('now'))"
    ).bind(crypto.randomUUID(), me.id, batchId).run();

    const { json } = await fetchJson("/api/v1/dashboard", { headers: API_HEADERS });
    expect(json.alerts).toBeDefined();
    expect(json.alerts.length).toBe(1);
    expect(json.alerts[0].alert_type).toBe("stall");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd api && npx vitest run test/alerts-api.test.ts`
Expected: FAIL

**Step 3: Implement**

Create `api/src/routes/alerts.ts`:

```typescript
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { notFound } from "../lib/errors";
import { nowUtc } from "../lib/time";

const alerts = new Hono<AppEnv>();

alerts.post("/:alertId/dismiss", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const alertId = c.req.param("alertId");

  const row = await db.prepare(
    "SELECT id FROM alert_state WHERE id = ? AND user_id = ? AND resolved_at IS NULL AND dismissed_at IS NULL"
  ).bind(alertId, user.id).first<any>();

  if (!row) return notFound("Alert");

  await db.prepare("UPDATE alert_state SET dismissed_at = ? WHERE id = ?")
    .bind(nowUtc(), alertId).run();

  return c.json({ status: "dismissed" });
});

export default alerts;
```

In `api/src/app.ts`, add the route:

```typescript
import alerts from "./routes/alerts";
// ... after dashboard route:
app.route("/api/v1/alerts", alerts);
```

In `api/src/routes/dashboard.ts`, add alerts to the response. After `recentActivities` (line 75), before the return:

```typescript
import { getActiveAlerts } from "../lib/alert-manager";

// In the handler, before the return:
const activeAlerts = await getActiveAlerts(db, user.id);

return c.json({
  active_batches: batchSummaries,
  recent_activities: recentActivities,
  alerts: activeAlerts,
});
```

**Step 4: Run tests**

Run: `cd api && npx vitest run`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add api/src/routes/alerts.ts api/src/app.ts api/src/routes/dashboard.ts api/test/alerts-api.test.ts
git commit -m "feat: dismiss endpoint and server-derived dashboard alerts"
```

---

### Task 7: Wire alert evaluation into webhook

**Files:**
- Modify: `api/src/routes/webhook.ts:44-58`
- Test: `api/test/webhook.test.ts`

**Step 1: Write failing test**

Add to `api/test/webhook.test.ts`:

```typescript
it("fires temp_high alert on hot reading", async () => {
  // Create user, device, batch, and assign device
  const batchId = await createBatch();
  const { json: me } = await fetchJson("/api/v1/me", { headers: API_HEADERS });
  await env.DB.prepare("INSERT INTO devices (id, name, user_id, batch_id, assigned_at, created_at, updated_at) VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))")
    .bind("hot-pill", "Hot Pill", me.id, batchId).run();

  await fetchJson("/webhook/rapt", {
    method: "POST",
    headers: WEBHOOK_HEADERS,
    body: { ...VALID_PAYLOAD, device_id: "hot-pill", temperature: 32.0 },
  });

  const alert = await env.DB.prepare(
    "SELECT * FROM alert_state WHERE batch_id = ? AND alert_type = 'temp_high'"
  ).bind(batchId).first<any>();
  expect(alert).not.toBeNull();
  expect(alert.alert_type).toBe("temp_high");
});
```

**Step 2: Run to verify failure**

Run: `cd api && npx vitest run test/webhook.test.ts`
Expected: FAIL — no alert row created

**Step 3: Implement**

In `api/src/routes/webhook.ts`, after the reading INSERT success (line 52, before the return), add alert evaluation:

```typescript
import { evaluateAlerts, type BatchAlertContext } from "../lib/alerts";
import { processAlerts, resolveCleared } from "../lib/alert-manager";

// After successful reading insert, if device has a batch and user:
if (batchId && userId) {
  // Fetch recent readings for this batch (up to 200, chronological)
  const recentReadings = await db.prepare(
    "SELECT gravity, temperature, source_timestamp FROM readings WHERE batch_id = ? ORDER BY source_timestamp ASC LIMIT 200"
  ).bind(batchId).all<any>();

  const batch = await db.prepare("SELECT stage, target_gravity FROM batches WHERE id = ? AND status = 'active'")
    .bind(batchId).first<any>();

  if (batch) {
    const ctx: BatchAlertContext = {
      batchId,
      userId,
      stage: batch.stage,
      targetGravity: batch.target_gravity,
      hasAssignedDevice: true,
      readings: recentReadings.results,
    };

    const candidates = evaluateAlerts(ctx);
    await processAlerts(db, userId, batchId, candidates);
    await resolveCleared(db, userId, batchId, candidates);
  }
}
```

**Step 4: Run tests**

Run: `cd api && npx vitest run test/webhook.test.ts`
Expected: ALL PASS

**Step 5: Run full suite**

Run: `cd api && npx vitest run`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add api/src/routes/webhook.ts api/test/webhook.test.ts
git commit -m "feat: evaluate alerts on webhook reading insert"
```

---

### Task 8: Cron handler for alert sweep

**Files:**
- Modify: `api/src/index.ts`
- Modify: `api/src/app.ts` (export Bindings for cron)
- Modify: `api/wrangler.toml` (add cron trigger)
- Create: `api/src/cron.ts`
- Test: `api/test/cron.test.ts`

**Step 1: Write failing test**

Create `api/test/cron.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations } from "./helpers";
import { evaluateAllBatches } from "../src/cron";

beforeEach(async () => {
  await applyMigrations();
});

describe("cron evaluateAllBatches", () => {
  it("creates no_readings alert for batch with stale device", async () => {
    // Setup: user, batch, device assigned, old reading
    const userId = "cron-user";
    const batchId = "cron-batch";
    await env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, 'cron@test.com', datetime('now'))").bind(userId).run();
    await env.DB.prepare(
      `INSERT INTO batches (id, user_id, name, wine_type, source_material, stage, status, started_at, created_at, updated_at)
       VALUES (?, ?, 'Cron Batch', 'red', 'kit', 'primary_fermentation', 'active', datetime('now'), datetime('now'), datetime('now'))`
    ).bind(batchId, userId).run();
    await env.DB.prepare(
      "INSERT INTO devices (id, name, user_id, batch_id, assigned_at, created_at, updated_at) VALUES ('cron-pill', 'Pill', ?, ?, datetime('now'), datetime('now'), datetime('now'))"
    ).bind(userId, batchId).run();

    // Insert an old reading (3 days ago)
    const oldDate = new Date(Date.now() - 72 * 3600000).toISOString();
    await env.DB.prepare(
      "INSERT INTO readings (id, batch_id, device_id, gravity, temperature, source_timestamp, source, created_at, user_id) VALUES (?, ?, 'cron-pill', 1.050, 22, ?, 'device', ?, ?)"
    ).bind(crypto.randomUUID(), batchId, oldDate, oldDate, userId).run();

    await evaluateAllBatches(env.DB);

    const alert = await env.DB.prepare(
      "SELECT * FROM alert_state WHERE batch_id = ? AND alert_type = 'no_readings'"
    ).bind(batchId).first<any>();
    expect(alert).not.toBeNull();
  });

  it("skips inactive batches", async () => {
    const userId = "cron-user-2";
    const batchId = "cron-batch-2";
    await env.DB.prepare("INSERT INTO users (id, email, created_at) VALUES (?, 'cron2@test.com', datetime('now'))").bind(userId).run();
    await env.DB.prepare(
      `INSERT INTO batches (id, user_id, name, wine_type, source_material, stage, status, started_at, created_at, updated_at)
       VALUES (?, ?, 'Completed', 'red', 'kit', 'bottling', 'completed', datetime('now'), datetime('now'), datetime('now'))`
    ).bind(batchId, userId).run();

    await evaluateAllBatches(env.DB);

    const alerts = await env.DB.prepare("SELECT * FROM alert_state WHERE batch_id = ?").bind(batchId).all();
    expect(alerts.results.length).toBe(0);
  });
});
```

**Step 2: Run to verify failure**

Run: `cd api && npx vitest run test/cron.test.ts`
Expected: FAIL — module not found

**Step 3: Implement `api/src/cron.ts`**

```typescript
import { evaluateAlerts, type BatchAlertContext } from "./lib/alerts";
import { processAlerts, resolveCleared } from "./lib/alert-manager";

export async function evaluateAllBatches(db: D1Database): Promise<void> {
  // Get all active batches
  const batches = await db.prepare(
    "SELECT b.id, b.user_id, b.stage, b.target_gravity FROM batches b WHERE b.status = 'active'"
  ).all<any>();

  for (const batch of batches.results) {
    // Check if batch has an assigned device
    const device = await db.prepare(
      "SELECT id FROM devices WHERE batch_id = ? AND user_id = ? LIMIT 1"
    ).bind(batch.id, batch.user_id).first<any>();

    // Get recent readings
    const readings = await db.prepare(
      "SELECT gravity, temperature, source_timestamp FROM readings WHERE batch_id = ? ORDER BY source_timestamp ASC LIMIT 200"
    ).bind(batch.id).all<any>();

    const ctx: BatchAlertContext = {
      batchId: batch.id,
      userId: batch.user_id,
      stage: batch.stage,
      targetGravity: batch.target_gravity,
      hasAssignedDevice: !!device,
      readings: readings.results,
    };

    const candidates = evaluateAlerts(ctx);
    await processAlerts(db, batch.user_id, batch.id, candidates);
    await resolveCleared(db, batch.user_id, batch.id, candidates);
  }
}
```

Update `api/src/index.ts` to export the scheduled handler:

```typescript
import app from "./app";
import { evaluateAllBatches } from "./cron";
import type { Bindings } from "./app";

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(evaluateAllBatches(env.DB));
  },
};
```

Add cron trigger to `api/wrangler.toml`:

```toml
[triggers]
crons = ["*/15 * * * *"]
```

**Step 4: Run tests**

Run: `cd api && npx vitest run test/cron.test.ts`
Expected: ALL PASS

**Step 5: Run full suite**

Run: `cd api && npx vitest run`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add api/src/cron.ts api/src/index.ts api/wrangler.toml api/test/cron.test.ts
git commit -m "feat: cron handler for 15-min alert sweep"
```

---

## Phase 3: Push Notifications

### Task 9: VAPID key generation and push subscription endpoints

**Files:**
- Create: `api/src/lib/web-push.ts`
- Create: `api/src/routes/push.ts`
- Modify: `api/src/app.ts` (mount push routes, add VAPID bindings)
- Test: `api/test/push.test.ts`

**Step 1: Write failing tests**

Create `api/test/push.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { applyMigrations, fetchJson, API_HEADERS } from "./helpers";

beforeEach(async () => {
  await applyMigrations();
});

describe("push subscription API", () => {
  it("GET /push/vapid-key returns public key", async () => {
    const { status, json } = await fetchJson("/api/v1/push/vapid-key", {
      headers: API_HEADERS,
    });
    expect(status).toBe(200);
    expect(json.key).toBe("test-vapid-public-key");
  });

  it("POST /push/subscribe stores subscription", async () => {
    const { status } = await fetchJson("/api/v1/push/subscribe", {
      method: "POST", headers: API_HEADERS,
      body: {
        endpoint: "https://push.example.com/sub/abc",
        keys: { p256dh: "pubkey123", auth: "authkey123" },
      },
    });
    expect(status).toBe(200);

    const row = await env.DB.prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?")
      .bind("https://push.example.com/sub/abc").first<any>();
    expect(row).not.toBeNull();
    expect(row.keys_p256dh).toBe("pubkey123");
  });

  it("POST /push/subscribe upserts on same endpoint", async () => {
    const sub = {
      endpoint: "https://push.example.com/sub/abc",
      keys: { p256dh: "key1", auth: "auth1" },
    };
    await fetchJson("/api/v1/push/subscribe", { method: "POST", headers: API_HEADERS, body: sub });
    sub.keys.p256dh = "key2";
    await fetchJson("/api/v1/push/subscribe", { method: "POST", headers: API_HEADERS, body: sub });

    const rows = await env.DB.prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?")
      .bind("https://push.example.com/sub/abc").all();
    expect(rows.results.length).toBe(1);
    expect(rows.results[0].keys_p256dh).toBe("key2");
  });

  it("DELETE /push/subscribe removes subscription", async () => {
    await fetchJson("/api/v1/push/subscribe", {
      method: "POST", headers: API_HEADERS,
      body: { endpoint: "https://push.example.com/sub/del", keys: { p256dh: "k", auth: "a" } },
    });
    const { status } = await fetchJson("/api/v1/push/subscribe", {
      method: "DELETE", headers: API_HEADERS,
      body: { endpoint: "https://push.example.com/sub/del" },
    });
    expect(status).toBe(200);

    const row = await env.DB.prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?")
      .bind("https://push.example.com/sub/del").first<any>();
    expect(row).toBeNull();
  });
});
```

**Step 2: Run to verify failure**

Run: `cd api && npx vitest run test/push.test.ts`
Expected: FAIL

**Step 3: Implement**

Create `api/src/routes/push.ts`:

```typescript
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app";
import { validationError } from "../lib/errors";
import { nowUtc } from "../lib/time";

const push = new Hono<AppEnv>();

const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const UnsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

push.get("/vapid-key", (c) => {
  return c.json({ key: c.env.VAPID_PUBLIC_KEY });
});

push.post("/subscribe", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = SubscribeSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.issues);

  const db = c.env.DB;
  const user = c.get("user");
  const { endpoint, keys } = parsed.data;

  await db.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, keys_p256dh, keys_auth, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET keys_p256dh = ?, keys_auth = ?, user_id = ?`
  ).bind(
    crypto.randomUUID(), user.id, endpoint, keys.p256dh, keys.auth, nowUtc(),
    keys.p256dh, keys.auth, user.id,
  ).run();

  return c.json({ status: "subscribed" });
});

push.delete("/subscribe", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = UnsubscribeSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.issues);

  await c.env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?")
    .bind(parsed.data.endpoint, c.get("user").id).run();

  return c.json({ status: "unsubscribed" });
});

export default push;
```

Update `api/src/app.ts` — add VAPID_PUBLIC_KEY to Bindings and mount route:

```typescript
// In Bindings type, add:
VAPID_PUBLIC_KEY: string;
VAPID_PRIVATE_KEY: string;

// Add import and route:
import push from "./routes/push";
app.route("/api/v1/push", push);
```

Update `api/vitest.config.ts` — add test VAPID bindings:

```typescript
// In miniflare.bindings, add:
VAPID_PUBLIC_KEY: "test-vapid-public-key",
VAPID_PRIVATE_KEY: "test-vapid-private-key",
```

**Step 4: Run tests**

Run: `cd api && npx vitest run test/push.test.ts`
Expected: ALL PASS

**Step 5: Run full suite**

Run: `cd api && npx vitest run`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add api/src/routes/push.ts api/src/app.ts api/vitest.config.ts api/test/push.test.ts
git commit -m "feat: push subscription CRUD endpoints with VAPID key"
```

---

### Task 10: Web Push delivery

**Files:**
- Create: `api/src/lib/web-push.ts`
- Modify: `api/src/lib/alert-manager.ts` (add sendPushForAlerts)
- Modify: `api/src/routes/webhook.ts` (call push after processAlerts)
- Modify: `api/src/cron.ts` (call push after processAlerts)

**Step 1: Implement `api/src/lib/web-push.ts`**

This implements the Web Push protocol using `crypto.subtle` (no npm dependency). It handles VAPID JWT signing and ECDH encryption.

```typescript
/**
 * Minimal Web Push implementation for Cloudflare Workers.
 * Uses crypto.subtle for VAPID signing and payload encryption.
 */

function base64UrlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  const binary = atob(base64 + pad);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function createVapidJwt(audience: string, subject: string, privateKeyBase64: string): Promise<string> {
  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({
    aud: audience,
    exp: now + 86400,
    sub: subject,
  })));

  const keyData = base64UrlDecode(privateKeyBase64);
  const key = await crypto.subtle.importKey("pkcs8", keyData, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const data = new TextEncoder().encode(`${header}.${payload}`);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, data);

  // Convert DER signature to raw r||s format if needed
  const sigBytes = new Uint8Array(sig);
  let rawSig: Uint8Array;
  if (sigBytes.length === 64) {
    rawSig = sigBytes;
  } else {
    // DER encoded — extract r and s
    const r = sigBytes.slice(4, 4 + sigBytes[3]);
    const sOffset = 4 + sigBytes[3] + 2;
    const s = sigBytes.slice(sOffset, sOffset + sigBytes[sOffset - 1]);
    rawSig = new Uint8Array(64);
    rawSig.set(r.length <= 32 ? r : r.slice(r.length - 32), 32 - Math.min(r.length, 32));
    rawSig.set(s.length <= 32 ? s : s.slice(s.length - 32), 64 - Math.min(s.length, 32));
  }

  return `${header}.${payload}.${base64UrlEncode(rawSig)}`;
}

export interface PushSubscription {
  endpoint: string;
  keys_p256dh: string;
  keys_auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  type: string;
  alertId: string;
  [key: string]: unknown;
}

/**
 * Send a push notification. Returns true if accepted (201), false otherwise.
 * On 404/410, the subscription is expired and should be removed.
 */
export async function sendPush(
  sub: PushSubscription,
  payload: PushPayload,
  vapidPublicKey: string,
  vapidPrivateKey: string,
  vapidSubject: string = "mailto:noreply@drake.zone",
): Promise<{ ok: boolean; status: number; gone: boolean }> {
  try {
    const url = new URL(sub.endpoint);
    const audience = `${url.protocol}//${url.host}`;
    const jwt = await createVapidJwt(audience, vapidSubject, vapidPrivateKey);

    const body = new TextEncoder().encode(JSON.stringify(payload));

    const resp = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        "Authorization": `vapid t=${jwt}, k=${vapidPublicKey}`,
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        "TTL": "86400",
      },
      body,
    });

    return {
      ok: resp.status === 201,
      status: resp.status,
      gone: resp.status === 404 || resp.status === 410,
    };
  } catch {
    return { ok: false, status: 0, gone: false };
  }
}

/**
 * Send push to all subscriptions for a user. Cleans up expired subscriptions.
 */
export async function sendPushToUser(
  db: D1Database,
  userId: string,
  payload: PushPayload,
  vapidPublicKey: string,
  vapidPrivateKey: string,
): Promise<void> {
  const subs = await db.prepare(
    "SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE user_id = ?"
  ).bind(userId).all<PushSubscription>();

  for (const sub of subs.results) {
    const result = await sendPush(sub, payload, vapidPublicKey, vapidPrivateKey);
    if (result.gone) {
      await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(sub.endpoint).run();
    }
  }
}
```

**Note:** The encryption part (aes128gcm content encoding) is complex. The above sends an unencrypted payload which works for testing but production push services require RFC 8291 encryption. This will need to be completed with proper ECDH encryption or by using a compatible library. For the initial implementation, we can test the plumbing and add encryption as a follow-up.

**Step 2: Wire push delivery into alert processing**

Update `api/src/lib/alert-manager.ts` to add a `sendAlertPushes` function:

```typescript
import { sendPushToUser, type PushPayload } from "./web-push";

export async function sendAlertPushes(
  db: D1Database,
  userId: string,
  batchName: string,
  firedAlerts: FiredAlert[],
  vapidPublicKey: string,
  vapidPrivateKey: string,
): Promise<void> {
  for (const alert of firedAlerts) {
    const context = alert.context ? JSON.parse(alert.context) : {};
    const payload: PushPayload = {
      title: `${batchName} — ${formatAlertType(alert.alert_type)}`,
      body: context.message ?? formatAlertType(alert.alert_type),
      url: `/batches/${alert.batch_id}`,
      type: alert.alert_type,
      alertId: alert.id,
    };

    if (alert.alert_type === "stage_suggestion" && context.next_stage) {
      payload.url = `/batches/${alert.batch_id}?action=advance&stage=${context.next_stage}`;
      payload.batchId = alert.batch_id;
      payload.nextStage = context.next_stage;
    }

    await sendPushToUser(db, userId, payload, vapidPublicKey, vapidPrivateKey);
  }
}

function formatAlertType(type: string): string {
  const labels: Record<string, string> = {
    stall: "Fermentation Stall",
    no_readings: "No Readings",
    temp_high: "High Temperature",
    temp_low: "Low Temperature",
    stage_suggestion: "Stage Suggestion",
  };
  return labels[type] ?? type;
}
```

Update webhook and cron to pass VAPID keys and call push. This involves passing `env` through to the alert processing functions.

**Step 3: Commit**

```bash
git add api/src/lib/web-push.ts api/src/lib/alert-manager.ts api/src/routes/webhook.ts api/src/cron.ts
git commit -m "feat: web push delivery for fired alerts"
```

---

## Phase 4: Frontend

### Task 11: Update dashboard types and API client

**Files:**
- Modify: `dashboard/src/types.ts` (add Alert type, update DashboardResponse, add target_gravity to Batch)
- Modify: `dashboard/src/api.ts` (add push, alerts, and stage methods)

**Step 1: Update types**

In `dashboard/src/types.ts`:

Add `target_gravity` to `Batch` interface (after `target_volume_liters`):
```typescript
target_gravity: number | null;
```

Add Alert interface:
```typescript
export interface Alert {
  id: string;
  batch_id: string;
  batch_name: string;
  alert_type: "stall" | "no_readings" | "temp_high" | "temp_low" | "stage_suggestion";
  context: string | null;
  fired_at: string;
}
```

Update `DashboardResponse`:
```typescript
export interface DashboardResponse {
  active_batches: BatchSummary[];
  recent_activities: (Activity & { batch_name: string })[];
  alerts: Alert[];
}
```

Add `target_gravity` to `BatchCreate` and `BatchUpdate`.

**Step 2: Update API client**

In `dashboard/src/api.ts`, add:

```typescript
// In batches object:
setStage: (id: string, stage: BatchStage) =>
  apiFetch<Batch>(`/api/v1/batches/${id}/stage`, { method: "POST", body: { stage } }),

// New objects:
alerts: {
  dismiss: (alertId: string) =>
    apiFetch<void>(`/api/v1/alerts/${alertId}/dismiss`, { method: "POST" }),
},
push: {
  vapidKey: () => apiFetch<{ key: string }>("/api/v1/push/vapid-key"),
  subscribe: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    apiFetch<void>("/api/v1/push/subscribe", { method: "POST", body: subscription }),
  unsubscribe: (endpoint: string) =>
    apiFetch<void>("/api/v1/push/subscribe", { method: "DELETE", body: { endpoint } }),
},
```

**Step 3: Commit**

```bash
git add dashboard/src/types.ts dashboard/src/api.ts
git commit -m "feat: frontend types and API client for alerts, push, stage"
```

---

### Task 12: Dashboard — server-derived alerts

**Files:**
- Modify: `dashboard/src/pages/Dashboard.tsx`

**Step 1: Replace client-side `deriveAlerts()` with server alerts**

Remove the `deriveAlerts` function and `Alert` interface. Use `data.alerts` from the server response directly. Update `AlertsSection` to use the server `Alert` type. Add dismiss button to each alert.

The sorting logic can use `data.alerts` to determine stalled/no-reading batches instead of the removed `deriveAlerts`.

**Step 2: Commit**

```bash
git add dashboard/src/pages/Dashboard.tsx
git commit -m "feat: dashboard uses server-derived alerts with dismiss"
```

---

### Task 13: BatchDetail — stage selector and query param actions

**Files:**
- Modify: `dashboard/src/pages/BatchDetail.tsx:170-187`

**Step 1: Replace "Advance Stage" button with stage selector**

Replace the single advance button with a dropdown of the 5 waypoints. Pre-select the next stage. Call `api.batches.setStage()`.

**Step 2: Add query param action handling**

On mount, check for `?action=advance&stage=X` or `?action=dismiss&alertId=X`. Execute the action and clear the query params.

**Step 3: Commit**

```bash
git add dashboard/src/pages/BatchDetail.tsx
git commit -m "feat: stage selector dropdown and push notification action handling"
```

---

### Task 14: Settings — push notification toggle

**Files:**
- Modify: `dashboard/src/pages/Settings.tsx`

**Step 1: Add push toggle section**

After the "Claim Device" section, add a "Notifications" section with a toggle. Uses `registration.pushManager.getSubscription()` for initial state. On enable: request permission → subscribe → POST to API. On disable: unsubscribe → DELETE from API.

**Step 2: Commit**

```bash
git add dashboard/src/pages/Settings.tsx
git commit -m "feat: push notification toggle in settings"
```

---

### Task 15: Service worker — push event handler

**Files:**
- Modify: `dashboard/public/sw.js`
- Modify: `dashboard/public/manifest.json`

**Step 1: Add push event listener to sw.js**

```javascript
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  const options = {
    body: data.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url },
    tag: `${data.type}-${data.alertId}`,
  };
  if (data.type === "stage_suggestion") {
    options.actions = [
      { action: "advance", title: "Advance Now" },
      { action: "dismiss", title: "Dismiss" },
    ];
  }
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(clients.openWindow(url));
});
```

**Step 2: Bump cache version**

Change `wine-cellar-v3` to `wine-cellar-v4`.

**Step 3: Commit**

```bash
git add dashboard/public/sw.js dashboard/public/manifest.json
git commit -m "feat: service worker push notification handler"
```

---

## Phase 5: Deploy

### Task 16: Generate VAPID keys and deploy

**Step 1: Generate VAPID key pair**

```bash
# Generate ECDSA P-256 key pair for VAPID
node -e "
const crypto = require('crypto');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pubRaw = publicKey.export({ type: 'spki', format: 'der' });
const privRaw = privateKey.export({ type: 'pkcs8', format: 'der' });
console.log('VAPID_PUBLIC_KEY=' + pubRaw.toString('base64url'));
console.log('VAPID_PRIVATE_KEY=' + privRaw.toString('base64url'));
"
```

**Step 2: Set secrets**

```bash
echo "<public-key>" | npx wrangler secret put VAPID_PUBLIC_KEY
echo "<private-key>" | npx wrangler secret put VAPID_PRIVATE_KEY
```

**Step 3: Apply migration**

```bash
npx wrangler d1 execute wine-cellar-api --remote --file migrations/0006_alerts_and_stages.sql
```

**Step 4: Deploy API**

```bash
cd api && npx wrangler deploy
```

**Step 5: Deploy dashboard**

```bash
cd ../dashboard && npm run build
npx wrangler pages deploy dist --project-name wine-cellar-dashboard
```

**Step 6: Verify**

- Visit cellar.drake.zone
- Check dashboard loads with alerts array
- Enable push notifications in Settings
- Verify stage selector works on a batch

---

## Parallelization Notes

- **Tasks 1-3** (Phase 1) are sequential — migration must come first, then stage endpoint, then target_gravity.
- **Tasks 4-5** (alert engine + persistence) are sequential.
- **Task 6** (dismiss + dashboard) depends on Tasks 4-5.
- **Tasks 7-8** (webhook + cron wiring) depend on Tasks 4-5, can be parallel with each other.
- **Task 9** (push subscription) is independent of Tasks 4-8, can run in parallel.
- **Task 10** (push delivery) depends on Task 9 and Tasks 4-5.
- **Tasks 11-15** (frontend) are mostly sequential but Task 11 (types) can start after Task 6.
- **Task 16** (deploy) is last.
