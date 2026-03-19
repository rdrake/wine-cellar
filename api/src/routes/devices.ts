import { Hono } from "hono";
import type { Bindings } from "../app";
import { DeviceCreateSchema, DeviceAssignSchema } from "../models";
import { notFound, conflict, validationError } from "../lib/errors";
import { nowUtc } from "../lib/time";

const devices = new Hono<{ Bindings: Bindings }>();

devices.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = DeviceCreateSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.issues);

  const db = c.env.DB;
  const now = nowUtc();
  try {
    await db
      .prepare("INSERT INTO devices (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .bind(parsed.data.id, parsed.data.name, now, now)
      .run();
  } catch (e: any) {
    if (String(e).includes("UNIQUE")) return conflict("Device already registered");
    throw e;
  }
  return c.json(
    await db.prepare("SELECT * FROM devices WHERE id = ?").bind(parsed.data.id).first(),
    201,
  );
});

devices.get("/", async (c) => {
  const result = await c.env.DB.prepare("SELECT * FROM devices ORDER BY created_at DESC").all();
  return c.json({ items: result.results });
});

devices.post("/:deviceId/assign", async (c) => {
  const db = c.env.DB;
  const deviceId = c.req.param("deviceId");
  const device = await db.prepare("SELECT * FROM devices WHERE id = ?").bind(deviceId).first();
  if (!device) return notFound("Device");

  const body = await c.req.json().catch(() => null);
  const parsed = DeviceAssignSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.issues);

  const batch = await db.prepare("SELECT * FROM batches WHERE id = ?").bind(parsed.data.batch_id).first<any>();
  if (!batch) return notFound("Batch");
  if (batch.status !== "active") return conflict("Can only assign to active batches");

  const now = nowUtc();
  await db.prepare("UPDATE devices SET batch_id = ?, assigned_at = ?, updated_at = ? WHERE id = ?")
    .bind(parsed.data.batch_id, now, now, deviceId).run();

  // Backfill unassigned readings from this device after batch start
  await db
    .prepare("UPDATE readings SET batch_id = ? WHERE device_id = ? AND batch_id IS NULL AND source_timestamp >= ?")
    .bind(parsed.data.batch_id, deviceId, batch.started_at).run();

  return c.json(await db.prepare("SELECT * FROM devices WHERE id = ?").bind(deviceId).first());
});

devices.post("/:deviceId/unassign", async (c) => {
  const db = c.env.DB;
  const deviceId = c.req.param("deviceId");
  const device = await db.prepare("SELECT * FROM devices WHERE id = ?").bind(deviceId).first();
  if (!device) return notFound("Device");

  const now = nowUtc();
  await db.prepare("UPDATE devices SET batch_id = NULL, assigned_at = NULL, updated_at = ? WHERE id = ?")
    .bind(now, deviceId).run();
  return c.json(await db.prepare("SELECT * FROM devices WHERE id = ?").bind(deviceId).first());
});

export default devices;
