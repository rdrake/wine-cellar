import { Hono } from "hono";
import type { AppEnv } from "../app";
import { notFound } from "../lib/errors";
import { encodeCursor, decodeCursor } from "../lib/cursor";
import type { ReadingRow } from "../db-types";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

async function paginatedQuery(
  db: D1Database,
  baseSql: string,
  params: unknown[],
  limit: number,
  cursor: string | null,
  startTime: string | null,
  endTime: string | null,
  userId: string | null,
) {
  let sql = baseSql;
  if (userId) { sql += " AND user_id = ?"; params.push(userId); }
  if (startTime) { sql += " AND source_timestamp >= ?"; params.push(startTime); }
  if (endTime) { sql += " AND source_timestamp <= ?"; params.push(endTime); }
  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (decoded) {
      const [ts, rid] = decoded;
      sql += " AND (source_timestamp < ? OR (source_timestamp = ? AND id < ?))";
      params.push(ts, ts, rid);
    }
  }
  sql += " ORDER BY source_timestamp DESC, id DESC LIMIT ?";
  params.push(limit + 1);

  const result = await db.prepare(sql).bind(...params).all<ReadingRow>();
  const rows = result.results;
  const hasNext = rows.length > limit;
  const items = rows.slice(0, limit);
  let nextCursor: string | null = null;
  if (hasNext && items.length > 0) {
    const last = items[items.length - 1];
    nextCursor = encodeCursor(last.source_timestamp, last.id);
  }
  return { items, next_cursor: nextCursor };
}

export const batchReadings = new Hono<AppEnv>();

batchReadings.get("/", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const batchId = c.req.param("batchId");
  const batch = await db.prepare("SELECT id FROM batches WHERE id = ? AND user_id = ?").bind(batchId, user.id).first();
  if (!batch) return notFound("Batch");

  const limit = Math.max(1, Math.min(Number(c.req.query("limit") ?? DEFAULT_LIMIT), MAX_LIMIT));
  const cursor = c.req.query("cursor") ?? null;
  const startTime = c.req.query("start_time") ?? null;
  const endTime = c.req.query("end_time") ?? null;

  const result = await paginatedQuery(db, "SELECT * FROM readings WHERE batch_id = ?", [batchId], limit, cursor, startTime, endTime, user.id);
  return c.json(result);
});

export const deviceReadings = new Hono<AppEnv>();

deviceReadings.get("/", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const deviceId = c.req.param("deviceId");
  const device = await db.prepare("SELECT id FROM devices WHERE id = ? AND user_id = ?").bind(deviceId, user.id).first();
  if (!device) return notFound("Device");

  const limit = Math.max(1, Math.min(Number(c.req.query("limit") ?? DEFAULT_LIMIT), MAX_LIMIT));
  const cursor = c.req.query("cursor") ?? null;
  const startTime = c.req.query("start_time") ?? null;
  const endTime = c.req.query("end_time") ?? null;

  const result = await paginatedQuery(db, "SELECT * FROM readings WHERE device_id = ?", [deviceId], limit, cursor, startTime, endTime, user.id);
  return c.json(result);
});
