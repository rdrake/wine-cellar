import { Hono } from "hono";
import type { Bindings } from "../app";
import { BatchCreateSchema, BatchUpdateSchema } from "../models";
import { notFound, conflict, validationError } from "../lib/errors";
import { nowUtc } from "../lib/time";

const batches = new Hono<{ Bindings: Bindings }>();

batches.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = BatchCreateSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.issues);

  const db = c.env.DB;
  const id = crypto.randomUUID();
  const now = nowUtc();
  const b = parsed.data;

  await db
    .prepare(
      `INSERT INTO batches (id, name, wine_type, source_material, stage, status,
       volume_liters, target_volume_liters, started_at, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'must_prep', 'active', ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, b.name, b.wine_type, b.source_material,
      b.volume_liters ?? null, b.target_volume_liters ?? null,
      b.started_at, b.notes ?? null, now, now)
    .run();

  const row = await db.prepare("SELECT * FROM batches WHERE id = ?").bind(id).first();
  return c.json(row, 201);
});

batches.get("/", async (c) => {
  const db = c.env.DB;
  const status = c.req.query("status");
  const stage = c.req.query("stage");
  const wineType = c.req.query("wine_type");
  const sourceMaterial = c.req.query("source_material");

  let sql = "SELECT * FROM batches WHERE 1=1";
  const params: unknown[] = [];

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
  const row = await c.env.DB.prepare("SELECT * FROM batches WHERE id = ?")
    .bind(c.req.param("batchId")).first();
  if (!row) return notFound("Batch");
  return c.json(row);
});

batches.patch("/:batchId", async (c) => {
  const db = c.env.DB;
  const batchId = c.req.param("batchId");
  const row = await db.prepare("SELECT * FROM batches WHERE id = ?").bind(batchId).first();
  if (!row) return notFound("Batch");

  const body = await c.req.json().catch(() => null);
  const parsed = BatchUpdateSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.issues);

  const allowedCols = ["name", "notes", "volume_liters", "target_volume_liters"] as const;
  const updates: Record<string, unknown> = {};
  for (const col of allowedCols) {
    if (parsed.data[col] !== undefined) {
      updates[col] = parsed.data[col];
    }
  }
  if (Object.keys(updates).length === 0) return c.json(row);

  updates.updated_at = nowUtc();
  const setCols = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
  const values = [...Object.values(updates), batchId];
  await db.prepare(`UPDATE batches SET ${setCols} WHERE id = ?`).bind(...values).run();

  const updated = await db.prepare("SELECT * FROM batches WHERE id = ?").bind(batchId).first();
  return c.json(updated);
});

batches.delete("/:batchId", async (c) => {
  const db = c.env.DB;
  const batchId = c.req.param("batchId");
  const row = await db.prepare("SELECT * FROM batches WHERE id = ?").bind(batchId).first<any>();
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

  await db.prepare("DELETE FROM batches WHERE id = ?").bind(batchId).run();
  return new Response(null, { status: 204 });
});

export default batches;
