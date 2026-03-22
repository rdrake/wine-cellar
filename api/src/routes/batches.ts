import { Hono } from "hono";
import type { AppEnv } from "../app";
import { BatchCreateSchema, BatchUpdateSchema, StageSetSchema } from "../models";
import { notFound, conflict, validationError } from "../lib/errors";
import { nowUtc } from "../lib/time";
import { WAYPOINT_ORDER } from "../schema";
import { generateNudges, projectTimeline, calculateDrinkWindow, fetchWinemakingActivityContext, computeVelocityPerDay } from "../lib/winemaking";

const batches = new Hono<AppEnv>();

async function getOwnedBatch(db: D1Database, batchId: string, userId: string) {
  return db.prepare("SELECT * FROM batches WHERE id = ? AND user_id = ?")
    .bind(batchId, userId).first<any>();
}

batches.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = BatchCreateSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.issues);

  const db = c.env.DB;
  const user = c.get("user");
  const id = crypto.randomUUID();
  const now = nowUtc();
  const b = parsed.data;

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
      b.yeast_strain ?? null, b.oak_type ?? null, b.oak_format ?? null, b.oak_duration_days ?? null, b.mlf_status ?? null,
      b.started_at, b.notes ?? null, now, now)
    .run();

  const row = await db.prepare("SELECT * FROM batches WHERE id = ?").bind(id).first();
  return c.json(row, 201);
});

batches.get("/", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const status = c.req.query("status");
  const stage = c.req.query("stage");
  const wineType = c.req.query("wine_type");
  const sourceMaterial = c.req.query("source_material");

  let sql = "SELECT * FROM batches WHERE user_id = ?";
  const params: unknown[] = [user.id];

  if (status) {
    sql += " AND status = ?";
    params.push(status);
  } else {
    sql += " AND status != ?";
    params.push("archived");
  }
  if (stage) { sql += " AND stage = ?"; params.push(stage); }
  if (wineType) { sql += " AND wine_type = ?"; params.push(wineType); }
  if (sourceMaterial) { sql += " AND source_material = ?"; params.push(sourceMaterial); }
  sql += " ORDER BY created_at DESC";

  const result = await db.prepare(sql).bind(...params).all();
  return c.json({ items: result.results });
});

batches.get("/:batchId", async (c) => {
  const db = c.env.DB;
  const batchId = c.req.param("batchId");
  const userId = c.get("user").id;
  const row = await getOwnedBatch(db, batchId, userId);
  if (!row) return notFound("Batch");

  // Non-active batches get empty nudges/timeline, plus cellaring if bottled
  if (row.status !== "active") {
    let cellaring = null;
    if (row.bottled_at) {
      const [phRow, gravityRow] = await Promise.all([
        db.prepare(
          `SELECT json_extract(details, '$.value') as value FROM activities
           WHERE batch_id = ? AND user_id = ? AND type = 'measurement'
           AND json_extract(details, '$.metric') = 'pH'
           ORDER BY recorded_at DESC LIMIT 1`
        ).bind(batchId, userId).first<any>(),
        db.prepare(
          "SELECT gravity FROM readings WHERE batch_id = ? ORDER BY source_timestamp DESC LIMIT 1"
        ).bind(batchId).first<any>(),
      ]);

      cellaring = calculateDrinkWindow({
        wineType: row.wine_type,
        sourceMaterial: row.source_material,
        bottledAt: typeof row.bottled_at === "string" ? row.bottled_at.slice(0, 10) : row.bottled_at,
        oakType: row.oak_type ?? null,
        oakDurationDays: row.oak_duration_days ?? null,
        mlfStatus: row.mlf_status ?? null,
        totalSo2Ppm: null,
        finalPh: phRow?.value != null ? Number(phRow.value) : null,
        finalGravity: gravityRow?.gravity ?? null,
      });
    }
    return c.json({ ...row, nudges: [], timeline: [], cellaring });
  }

  // Gather context data for nudges and timeline
  const [activityCtx, recentReadings] = await Promise.all([
    fetchWinemakingActivityContext(db, batchId, userId),
    db.prepare("SELECT gravity, temperature, source_timestamp FROM readings WHERE batch_id = ? ORDER BY source_timestamp DESC LIMIT 10")
      .bind(batchId).all<any>(),
  ]);

  const readings = recentReadings.results;
  const latestReading = readings[0] ?? null;
  const velocityPerDay = computeVelocityPerDay([...readings].reverse());

  const nudges = generateNudges({
    stage: row.stage,
    wineType: row.wine_type,
    sourceMaterial: row.source_material,
    volumeLiters: row.volume_liters,
    mlfStatus: row.mlf_status,
    latestGravity: latestReading?.gravity ?? null,
    latestTemp: latestReading?.temperature ?? null,
    totalSo2Additions: activityCtx.so2Count,
  });

  // addDays expects YYYY-MM-DD; DB timestamps may include time portion
  const startedDate = typeof row.started_at === "string" ? row.started_at.slice(0, 10) : row.started_at;

  const timeline = projectTimeline({
    stage: row.stage,
    wineType: row.wine_type,
    sourceMaterial: row.source_material,
    mlfStatus: row.mlf_status,
    startedAt: startedDate,
    velocityPerDay,
    latestGravity: latestReading?.gravity ?? null,
    targetGravity: row.target_gravity,
    rackingCount: activityCtx.rackingCount,
    lastRackingAt: activityCtx.lastRackingAt,
    mlfInoculatedAt: activityCtx.mlfInoculatedAt,
  });

  return c.json({ ...row, nudges, timeline });
});

batches.patch("/:batchId", async (c) => {
  const db = c.env.DB;
  const batchId = c.req.param("batchId");
  const row = await getOwnedBatch(db, batchId, c.get("user").id);
  if (!row) return notFound("Batch");

  const body = await c.req.json().catch(() => null);
  const parsed = BatchUpdateSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.issues);

  // Validate status transition if requested
  const ALLOWED_TRANSITIONS: Record<string, string[]> = {
    active: ["completed", "abandoned"],
    completed: ["active", "archived"],
    abandoned: ["active"],
    archived: ["completed"],
  };

  if (parsed.data.status !== undefined) {
    const from = row.status as string;
    const to = parsed.data.status;
    if (from === to) {
      // no-op, ignore
    } else if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
      return conflict(`Cannot change status from ${from} to ${to}`);
    }
  }

  const allowedCols = ["name", "notes", "volume_liters", "target_volume_liters", "target_gravity",
    "yeast_strain", "oak_type", "oak_format", "oak_duration_days", "mlf_status", "status"] as const;
  const updates: Record<string, unknown> = {};
  for (const col of allowedCols) {
    if (parsed.data[col] !== undefined) {
      updates[col] = parsed.data[col];
    }
  }

  // If transitioning away from active, unassign devices and set completed_at
  if (parsed.data.status && parsed.data.status !== "active" && row.status === "active") {
    const now = nowUtc();
    await unassignDevices(db, batchId, now);
    if (parsed.data.status === "completed") {
      updates.completed_at = now;
      if (row.stage === "bottling") {
        updates.bottled_at = now;
      }
    }
  }
  // If reopening, clear completed_at
  if (parsed.data.status === "active" && row.status !== "active") {
    updates.completed_at = null;
  }

  if (Object.keys(updates).length === 0) return c.json(row);

  updates.updated_at = nowUtc();
  const setCols = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
  await db.prepare(`UPDATE batches SET ${setCols} WHERE id = ? AND user_id = ?`).bind(...Object.values(updates), batchId, c.get("user").id).run();

  const updated = await getOwnedBatch(db, batchId, c.get("user").id);
  return c.json(updated);
});

batches.delete("/:batchId", async (c) => {
  const db = c.env.DB;
  const batchId = c.req.param("batchId");
  const row = await getOwnedBatch(db, batchId, c.get("user").id);
  if (!row) return notFound("Batch");

  if (row.status !== "abandoned") {
    const check = await db
      .prepare(
        "SELECT EXISTS(SELECT 1 FROM activities WHERE batch_id = ?) AS has_activities, " +
        "EXISTS(SELECT 1 FROM readings WHERE batch_id = ?) AS has_readings"
      )
      .bind(batchId, batchId)
      .first<any>();
    if (check.has_activities || check.has_readings) {
      return conflict("Batch has activities or readings. Abandon first.");
    }
  }

  await db.prepare("DELETE FROM batches WHERE id = ? AND user_id = ?").bind(batchId, c.get("user").id).run();
  return new Response(null, { status: 204 });
});

// --- Lifecycle Endpoints ---

batches.post("/:batchId/stage", async (c) => {
  const db = c.env.DB;
  const batchId = c.req.param("batchId");
  const userId = c.get("user").id;
  const row = await getOwnedBatch(db, batchId, userId);
  if (!row) return notFound("Batch");
  if (row.status !== "active") return conflict("Only active batches can change stage");

  const body = await c.req.json().catch(() => null);
  const parsed = StageSetSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.issues);

  const newStage = parsed.data.stage;
  const oldStage = row.stage as string;

  // No-op if same stage
  if (newStage === oldStage) {
    return c.json(row);
  }

  const now = nowUtc();
  await db.prepare("UPDATE batches SET stage = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(newStage, now, batchId, userId).run();

  // Log activity
  const activityId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO activities (id, batch_id, user_id, stage, type, title, details, recorded_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'note', ?, NULL, ?, ?, ?)`
  ).bind(activityId, batchId, userId, newStage, `Stage changed from ${oldStage} to ${newStage}`, now, now, now).run();

  return c.json(await getOwnedBatch(db, batchId, userId));
});

batches.post("/:batchId/advance", async (c) => {
  const db = c.env.DB;
  const batchId = c.req.param("batchId");
  const userId = c.get("user").id;
  const row = await getOwnedBatch(db, batchId, userId);
  if (!row) return notFound("Batch");
  if (row.status !== "active") return conflict("Only active batches can advance");

  const currentIdx = WAYPOINT_ORDER.indexOf(row.stage);
  if (currentIdx >= WAYPOINT_ORDER.length - 1) return conflict("Batch is at final stage");

  const oldStage = row.stage as string;
  const nextStage = WAYPOINT_ORDER[currentIdx + 1];
  const now = nowUtc();
  await db.prepare("UPDATE batches SET stage = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(nextStage, now, batchId, userId).run();

  // Log activity
  const activityId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO activities (id, batch_id, user_id, stage, type, title, details, recorded_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'note', ?, NULL, ?, ?, ?)`
  ).bind(activityId, batchId, userId, nextStage, `Stage changed from ${oldStage} to ${nextStage}`, now, now, now).run();

  return c.json(await getOwnedBatch(db, batchId, userId));
});

async function unassignDevices(db: D1Database, batchId: string, now: string) {
  await db
    .prepare("UPDATE devices SET batch_id = NULL, assigned_at = NULL, updated_at = ? WHERE batch_id = ?")
    .bind(now, batchId).run();
}

batches.post("/:batchId/complete", async (c) => {
  const db = c.env.DB;
  const batchId = c.req.param("batchId");
  const row = await getOwnedBatch(db, batchId, c.get("user").id);
  if (!row) return notFound("Batch");
  if (row.status !== "active") return conflict("Only active batches can be completed");

  const now = nowUtc();
  const bottledAt = row.stage === "bottling" ? now : null;
  await db.prepare("UPDATE batches SET status = 'completed', completed_at = ?, bottled_at = COALESCE(?, bottled_at), updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(now, bottledAt, now, batchId, c.get("user").id).run();
  await unassignDevices(db, batchId, now);
  return c.json(await getOwnedBatch(db, batchId, c.get("user").id));
});

batches.post("/:batchId/abandon", async (c) => {
  const db = c.env.DB;
  const batchId = c.req.param("batchId");
  const row = await getOwnedBatch(db, batchId, c.get("user").id);
  if (!row) return notFound("Batch");
  if (row.status !== "active") return conflict("Only active batches can be abandoned");

  const now = nowUtc();
  await db.prepare("UPDATE batches SET status = 'abandoned', updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(now, batchId, c.get("user").id).run();
  await unassignDevices(db, batchId, now);
  return c.json(await getOwnedBatch(db, batchId, c.get("user").id));
});

batches.post("/:batchId/archive", async (c) => {
  const db = c.env.DB;
  const batchId = c.req.param("batchId");
  const row = await getOwnedBatch(db, batchId, c.get("user").id);
  if (!row) return notFound("Batch");
  if (row.status !== "completed") return conflict("Only completed batches can be archived");

  const now = nowUtc();
  await db.prepare("UPDATE batches SET status = 'archived', updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(now, batchId, c.get("user").id).run();
  return c.json(await getOwnedBatch(db, batchId, c.get("user").id));
});

batches.post("/:batchId/unarchive", async (c) => {
  const db = c.env.DB;
  const batchId = c.req.param("batchId");
  const row = await getOwnedBatch(db, batchId, c.get("user").id);
  if (!row) return notFound("Batch");
  if (row.status !== "archived") return conflict("Only archived batches can be unarchived");

  const now = nowUtc();
  await db.prepare("UPDATE batches SET status = 'completed', updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(now, batchId, c.get("user").id).run();
  return c.json(await getOwnedBatch(db, batchId, c.get("user").id));
});

export default batches;
