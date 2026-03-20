import { Hono } from "hono";
import type { Bindings } from "../app";

const dashboard = new Hono<{ Bindings: Bindings }>();

dashboard.get("/", async (c) => {
  const db = c.env.DB;

  // Active batches
  const batches = await db
    .prepare("SELECT * FROM batches WHERE status = 'active' ORDER BY created_at DESC")
    .all<any>();

  const batchSummaries = await Promise.all(
    batches.results.map(async (batch: any) => {
      // All readings for sparkline (chronological, capped at 200)
      const readings = await db
        .prepare("SELECT gravity, temperature, source_timestamp FROM readings WHERE batch_id = ? ORDER BY source_timestamp ASC LIMIT 200")
        .bind(batch.id)
        .all<any>();

      const points = readings.results;
      const first = points.length > 0 ? points[0] : null;
      const latest = points.length > 0 ? points[points.length - 1] : null;

      // Velocity: SG drop per day over last 48h
      let velocity: number | null = null;
      if (latest) {
        const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const oldest48h = await db
          .prepare("SELECT gravity, source_timestamp FROM readings WHERE batch_id = ? AND source_timestamp >= ? ORDER BY source_timestamp ASC LIMIT 1")
          .bind(batch.id, cutoff)
          .first<any>();

        if (oldest48h && oldest48h.source_timestamp !== latest.source_timestamp) {
          const dt = (new Date(latest.source_timestamp).getTime() - new Date(oldest48h.source_timestamp).getTime()) / (1000 * 60 * 60 * 24);
          if (dt > 0) {
            velocity = (latest.gravity - oldest48h.gravity) / dt;
          }
        }
      }

      // Days fermenting
      const daysFermenting = Math.floor(
        (Date.now() - new Date(batch.started_at).getTime()) / (1000 * 60 * 60 * 24)
      );

      return {
        ...batch,
        first_reading: first,
        latest_reading: latest,
        velocity,
        days_fermenting: daysFermenting,
        sparkline: points.map((p: any) => ({ g: p.gravity, temp: p.temperature, t: p.source_timestamp })),
      };
    }),
  );

  // Recent activities across all batches
  const activities = await db
    .prepare(
      `SELECT a.*, b.name as batch_name FROM activities a
       JOIN batches b ON b.id = a.batch_id
       ORDER BY a.recorded_at DESC LIMIT 8`
    )
    .all<any>();

  const recentActivities = activities.results.map((row: any) => ({
    ...row,
    details: row.details ? JSON.parse(row.details) : null,
  }));

  return c.json({
    active_batches: batchSummaries,
    recent_activities: recentActivities,
  });
});

export default dashboard;
