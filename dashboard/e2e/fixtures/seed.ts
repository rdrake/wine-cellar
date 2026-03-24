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

    for (let i = 0; i < readings.length; i += 50) {
      const chunk = readings.slice(i, i + 50);
      const esc = (s: string) => s.replace(/'/g, "''");
      const values = chunk
        .map(
          (r) =>
            `('${esc(r.id)}', '${esc(batchId)}', '${esc(deviceId)}', '${esc(E2E_USER_ID)}', ${r.gravity}, ${r.temperature}, ${r.battery}, ${r.rssi}, 'device', '${esc(r.timestamp)}', '${esc(r.timestamp)}')`,
        )
        .join(",\n");
      sqlStatements.push(
        `INSERT INTO readings (id, batch_id, device_id, user_id, gravity, temperature, battery, rssi, source, source_timestamp, created_at) VALUES\n${values};`,
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

  // Write SQL in chunks to avoid SQLITE_TOOBIG errors
  const apiDir = join(process.cwd(), "../api");
  const totalReadings = seeded.reduce((sum, s) => sum + s.scenario.curve.days * s.scenario.curve.readingsPerDay, 0);
  console.log(`Inserting ${totalReadings} readings via SQL...`);

  const CHUNK_SIZE = 20; // statements per file
  for (let i = 0; i < sqlStatements.length; i += CHUNK_SIZE) {
    const chunk = sqlStatements.slice(i, i + CHUNK_SIZE);
    const sqlPath = join("/tmp", `e2e-seed-${i}.sql`);
    writeFileSync(sqlPath, chunk.join("\n\n"));
    execSync(
      `npx wrangler d1 execute wine-cellar-api --local --file "${sqlPath}"`,
      { cwd: apiDir, stdio: "pipe" },
    );
    try { unlinkSync(sqlPath); } catch { /* ignore */ }
  }

  console.log("E2E seed complete.");
}
