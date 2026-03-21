import { Hono } from "hono";
import type { AppEnv } from "../app";
import { DeviceCreateSchema, DeviceAssignSchema } from "../models";
import { notFound, conflict, validationError } from "../lib/errors";
import { nowUtc } from "../lib/time";

const devices = new Hono<AppEnv>();

devices.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = DeviceCreateSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.issues);

  const db = c.env.DB;
  const user = c.get("user");
  const now = nowUtc();
  try {
    await db
      .prepare("INSERT INTO devices (id, name, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(parsed.data.id, parsed.data.name, user.id, now, now)
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
  const user = c.get("user");
  const result = await c.env.DB.prepare("SELECT * FROM devices WHERE user_id = ? ORDER BY created_at DESC").bind(user.id).all();
  return c.json({ items: result.results });
});

devices.post("/claim", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);
  if (!body?.device_id) return validationError([{ message: "device_id required" }]);

  // Check device exists and is unclaimed
  const device = await db.prepare("SELECT * FROM devices WHERE id = ? AND user_id IS NULL")
    .bind(body.device_id).first();
  if (!device) return notFound("Device not found or already claimed");

  const now = nowUtc();
  await db.batch([
    db.prepare("UPDATE devices SET user_id = ?, updated_at = ? WHERE id = ?")
      .bind(user.id, now, body.device_id),
    db.prepare("UPDATE readings SET user_id = ? WHERE device_id = ? AND user_id IS NULL")
      .bind(user.id, body.device_id),
  ]);

  const updated = await db.prepare("SELECT * FROM devices WHERE id = ?").bind(body.device_id).first();
  return c.json(updated);
});

devices.post("/:deviceId/assign", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const deviceId = c.req.param("deviceId");
  const device = await db.prepare("SELECT * FROM devices WHERE id = ? AND user_id = ?").bind(deviceId, user.id).first();
  if (!device) return notFound("Device");

  const body = await c.req.json().catch(() => null);
  const parsed = DeviceAssignSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error.issues);

  const batch = await db.prepare("SELECT * FROM batches WHERE id = ? AND user_id = ?").bind(parsed.data.batch_id, user.id).first<any>();
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
  const user = c.get("user");
  const deviceId = c.req.param("deviceId");
  const device = await db.prepare("SELECT * FROM devices WHERE id = ? AND user_id = ?").bind(deviceId, user.id).first();
  if (!device) return notFound("Device");

  const now = nowUtc();
  await db.prepare("UPDATE devices SET batch_id = NULL, assigned_at = NULL, updated_at = ? WHERE id = ?")
    .bind(now, deviceId).run();
  return c.json(await db.prepare("SELECT * FROM devices WHERE id = ?").bind(deviceId).first());
});

export default devices;
