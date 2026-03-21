import { Hono } from "hono";
import type { AppEnv } from "../app";
import { ActivityCreateSchema, ActivityUpdateSchema } from "../models";
import { WAYPOINT_ALLOWED_STAGES, type BatchStage } from "../schema";
import { notFound, conflict, validationError } from "../lib/errors";
import { nowUtc } from "../lib/time";

const activities = new Hono<AppEnv>();

function isSgMeasurement(type: string, details: Record<string, unknown> | null | undefined): details is Record<string, unknown> {
  return type === "measurement" && !!details && details.metric === "SG" && typeof details.value === "number";
}

activities.post("/", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const batchId = c.req.param("batchId");
  const batch = await db.prepare("SELECT * FROM batches WHERE id = ? AND user_id = ?").bind(batchId, user.id).first<any>();
  if (!batch) return notFound("Batch");
  if (batch.status !== "active") return conflict("Only active batches can log activities");

  const body = await c.req.json().catch(() => null);
  const parsed = ActivityCreateSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.issues);

  const allowed = WAYPOINT_ALLOWED_STAGES[batch.stage as BatchStage] ?? [];
  if (!allowed.includes(parsed.data.stage as any)) {
    return conflict(`Stage '${parsed.data.stage}' not allowed when batch is at '${batch.stage}'`);
  }

  const id = crypto.randomUUID();
  const now = nowUtc();
  const detailsJson = parsed.data.details ? JSON.stringify(parsed.data.details) : null;

  // If this is an SG measurement, also insert a manual reading and link it
  let readingId: string | null = null;
  if (isSgMeasurement(parsed.data.type, parsed.data.details)) {
    readingId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO readings (id, batch_id, device_id, gravity, temperature, battery, rssi, source_timestamp, created_at, source, user_id)
         VALUES (?, ?, 'manual', ?, NULL, NULL, NULL, ?, ?, 'manual', ?)`
      )
      .bind(readingId, batchId, parsed.data.details!.value, parsed.data.recorded_at, now, user.id)
      .run();
  }

  await db
    .prepare(
      `INSERT INTO activities (id, user_id, batch_id, stage, type, title, details, recorded_at, created_at, updated_at, reading_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, user.id, batchId, parsed.data.stage, parsed.data.type, parsed.data.title,
      detailsJson, parsed.data.recorded_at, now, now, readingId)
    .run();

  const row = await db.prepare("SELECT * FROM activities WHERE id = ?").bind(id).first<any>();
  row.details = row.details ? JSON.parse(row.details) : null;
  return c.json(row, 201);
});

activities.get("/", async (c) => {
  const db = c.env.DB;
  const batchId = c.req.param("batchId");
  const batch = await db.prepare("SELECT id FROM batches WHERE id = ? AND user_id = ?").bind(batchId, c.get("user").id).first();
  if (!batch) return notFound("Batch");

  let sql = "SELECT * FROM activities WHERE batch_id = ?";
  const params: unknown[] = [batchId];
  const type = c.req.query("type");
  const stage = c.req.query("stage");
  const startTime = c.req.query("start_time");
  const endTime = c.req.query("end_time");

  if (type) { sql += " AND type = ?"; params.push(type); }
  if (stage) { sql += " AND stage = ?"; params.push(stage); }
  if (startTime) { sql += " AND recorded_at >= ?"; params.push(startTime); }
  if (endTime) { sql += " AND recorded_at <= ?"; params.push(endTime); }
  sql += " ORDER BY recorded_at DESC";

  const result = await db.prepare(sql).bind(...params).all<any>();
  const items = result.results.map((row: any) => ({
    ...row,
    details: row.details ? JSON.parse(row.details) : null,
  }));
  return c.json({ items });
});

activities.patch("/:activityId", async (c) => {
  const db = c.env.DB;
  const batchId = c.req.param("batchId");
  const activityId = c.req.param("activityId");

  const row = await db.prepare("SELECT * FROM activities WHERE id = ? AND batch_id = ? AND user_id = ?")
    .bind(activityId, batchId, c.get("user").id).first<any>();
  if (!row) return notFound("Activity");

  const body = await c.req.json().catch(() => null);
  const parsed = ActivityUpdateSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.issues);

  const updates: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.recorded_at !== undefined) updates.recorded_at = parsed.data.recorded_at;
  if (parsed.data.details !== undefined) {
    updates.details = parsed.data.details ? JSON.stringify(parsed.data.details) : null;
  }

  if (Object.keys(updates).length === 0) {
    row.details = row.details ? JSON.parse(row.details) : null;
    return c.json(row);
  }

  updates.updated_at = nowUtc();
  const setCols = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
  const values = [...Object.values(updates), activityId];
  await db.prepare(`UPDATE activities SET ${setCols} WHERE id = ?`).bind(...values).run();

  // Sync linked reading if SG value or timestamp changed
  if (row.reading_id) {
    const newDetails = parsed.data.details !== undefined
      ? parsed.data.details
      : (row.details ? JSON.parse(row.details) : null);
    if (isSgMeasurement(row.type, newDetails)) {
      const newTimestamp = parsed.data.recorded_at ?? row.recorded_at;
      await db
        .prepare("UPDATE readings SET gravity = ?, source_timestamp = ? WHERE id = ?")
        .bind(newDetails.value, newTimestamp, row.reading_id)
        .run();
    }
  }

  const updated = await db.prepare("SELECT * FROM activities WHERE id = ?").bind(activityId).first<any>();
  updated.details = updated.details ? JSON.parse(updated.details) : null;
  return c.json(updated);
});

activities.delete("/:activityId", async (c) => {
  const db = c.env.DB;
  const batchId = c.req.param("batchId");
  const activityId = c.req.param("activityId");
  const row = await db.prepare("SELECT * FROM activities WHERE id = ? AND batch_id = ? AND user_id = ?")
    .bind(activityId, batchId, c.get("user").id).first<any>();
  if (!row) return notFound("Activity");

  // Delete the linked manual reading if present
  if (row.reading_id) {
    await db.prepare("DELETE FROM readings WHERE id = ?").bind(row.reading_id).run();
  }

  await db.prepare("DELETE FROM activities WHERE id = ?").bind(activityId).run();
  return new Response(null, { status: 204 });
});

export default activities;
