import { Hono } from "hono";
import type { Bindings } from "../app";
import { RaptWebhookSchema } from "../models";
import { unauthorized, validationError } from "../lib/errors";
import { nowUtc } from "../lib/time";
import { timingSafeEqual } from "../lib/crypto";
import { evaluateAlerts, type BatchAlertContext } from "../lib/alerts";
import { processAlerts, resolveCleared, sendAlertPushes } from "../lib/alert-manager";

const webhook = new Hono<{ Bindings: Bindings }>();

webhook.post("/rapt", async (c) => {
  // Auth BEFORE body parsing
  const token = c.req.header("X-Webhook-Token");
  const expected = c.env.WEBHOOK_TOKEN;
  if (!token || !expected || !timingSafeEqual(token, expected)) {
    return unauthorized("Invalid webhook token");
  }

  // Parse body after auth — RAPT sends null bytes in payloads, strip before parsing
  const rawText = await c.req.text();
  const rawBody = JSON.parse(rawText.replace(/\0/g, "").trim()) as unknown;
  const parsed = RaptWebhookSchema.safeParse(rawBody);
  if (!parsed.success) return validationError(parsed.error.issues);

  const db = c.env.DB;
  const now = nowUtc();
  const body = parsed.data;

  // Auto-register unknown device; resolve batch_id and user_id
  const device = await db.prepare("SELECT batch_id, user_id FROM devices WHERE id = ?").bind(body.device_id).first<any>();
  let batchId: string | null;
  let userId: string | null;
  if (!device) {
    await db.prepare("INSERT INTO devices (id, name, user_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)")
      .bind(body.device_id, body.device_name, now, now).run();
    batchId = null;
    userId = null;
  } else {
    batchId = device.batch_id;
    userId = device.user_id;
  }

  // Insert reading, deduplicate via UNIQUE index
  const readingId = crypto.randomUUID();
  try {
    await db
      .prepare(
        `INSERT INTO readings (id, batch_id, device_id, gravity, temperature, battery, rssi, source_timestamp, created_at, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(readingId, batchId, body.device_id, body.gravity, body.temperature,
        body.battery, body.rssi, body.created_date, now, userId)
      .run();
  } catch (e: any) {
    if (String(e).includes("UNIQUE")) {
      return c.json({ status: "duplicate", message: "Reading already exists" });
    }
    throw e;
  }

  // Evaluate alerts if device has a batch and user
  if (batchId && userId) {
    const recentReadings = await db.prepare(
      "SELECT gravity, temperature, source_timestamp FROM readings WHERE batch_id = ? ORDER BY source_timestamp ASC LIMIT 200"
    ).bind(batchId).all<any>();

    const batch = await db.prepare("SELECT stage, target_gravity, wine_type FROM batches WHERE id = ? AND status = 'active'")
      .bind(batchId).first<any>();

    if (batch) {
      const ctx: BatchAlertContext = {
        batchId,
        userId,
        stage: batch.stage,
        wineType: batch.wine_type ?? "red",
        targetGravity: batch.target_gravity,
        hasAssignedDevice: true,
        readings: recentReadings.results,
      };

      const candidates = evaluateAlerts(ctx);
      const fired = await processAlerts(db, userId, batchId, candidates);
      await resolveCleared(db, userId, batchId, candidates);

      if (fired.length > 0) {
        const batchRow = await db.prepare("SELECT name FROM batches WHERE id = ?").bind(batchId).first<any>();
        if (batchRow) {
          await sendAlertPushes(db, userId, batchRow.name, fired, c.env.VAPID_PUBLIC_KEY, c.env.VAPID_PRIVATE_KEY);
        }
      }
    }
  }

  return c.json({ status: "ok", reading_id: readingId });
});

export default webhook;
