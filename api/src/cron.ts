import { evaluateAlerts, type BatchAlertContext } from "./lib/alerts";
import { processAlerts, resolveCleared, sendAlertPushes } from "./lib/alert-manager";
import { projectTimeline, evaluateTimelineAlerts } from "./lib/winemaking";

export async function evaluateAllBatches(
  db: D1Database,
  vapidPublicKey: string,
  vapidPrivateKey: string,
): Promise<void> {
  const batches = await db.prepare(
    "SELECT b.id, b.user_id, b.name, b.stage, b.target_gravity, b.started_at, b.wine_type, b.source_material, b.mlf_status FROM batches b WHERE b.status = 'active'"
  ).all<any>();

  for (const batch of batches.results) {
    const device = await db.prepare(
      "SELECT id FROM devices WHERE batch_id = ? AND user_id = ? LIMIT 1"
    ).bind(batch.id, batch.user_id).first<any>();

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

    // ── Timeline-driven alerts ──────────────────────────────────────
    const [so2Data, rackingData, mlfInoculation] = await Promise.all([
      db.prepare(
        `SELECT COUNT(*) as count, MAX(recorded_at) as last_at FROM activities
         WHERE batch_id = ? AND user_id = ? AND type = 'addition'
         AND json_extract(details, '$.chemical') IN ('K2S2O5', 'SO2', 'Campden', 'K-meta', 'Potassium metabisulfite')`,
      ).bind(batch.id, batch.user_id).first<any>(),

      db.prepare(
        `SELECT COUNT(*) as count, MAX(recorded_at) as last_at FROM activities
         WHERE batch_id = ? AND user_id = ? AND type = 'racking'`,
      ).bind(batch.id, batch.user_id).first<any>(),

      db.prepare(
        `SELECT recorded_at FROM activities
         WHERE batch_id = ? AND user_id = ? AND type = 'addition'
         AND json_extract(details, '$.chemical') IN ('MLB', 'Leuconostoc', 'CH16', 'VP41', 'malolactic')
         ORDER BY recorded_at ASC LIMIT 1`,
      ).bind(batch.id, batch.user_id).first<any>(),
    ]);

    const rackingCount: number = rackingData?.count ?? 0;
    const lastRackingAt = rackingData?.last_at ? String(rackingData.last_at).slice(0, 10) : null;
    const lastSo2At = so2Data?.last_at ? String(so2Data.last_at).slice(0, 10) : null;
    const mlfInoculatedAt = mlfInoculation?.recorded_at
      ? String(mlfInoculation.recorded_at).slice(0, 10)
      : null;

    const now = Date.now();
    const daysSinceLastSo2 = lastSo2At
      ? Math.floor((now - new Date(lastSo2At + "T00:00:00Z").getTime()) / 86400_000)
      : null;
    const daysSinceLastRacking = lastRackingAt
      ? Math.floor((now - new Date(lastRackingAt + "T00:00:00Z").getTime()) / 86400_000)
      : null;

    // Compute velocity for timeline projection
    let velocityPerDay: number | null = null;
    if (readings.results.length >= 2) {
      const sorted = [...readings.results].sort(
        (a: any, b: any) =>
          new Date(a.source_timestamp).getTime() - new Date(b.source_timestamp).getTime(),
      );
      const oldest = sorted[0];
      const newest = sorted[sorted.length - 1];
      const timeDiffDays =
        (new Date(newest.source_timestamp).getTime() -
          new Date(oldest.source_timestamp).getTime()) /
        86400_000;
      if (timeDiffDays > 0) {
        velocityPerDay = (newest.gravity - oldest.gravity) / timeDiffDays;
      }
    }

    const startedDate = typeof batch.started_at === "string"
      ? batch.started_at.slice(0, 10)
      : batch.started_at;

    const milestones = projectTimeline({
      stage: batch.stage,
      wineType: batch.wine_type ?? "red",
      sourceMaterial: batch.source_material ?? "fresh_grapes",
      mlfStatus: batch.mlf_status ?? null,
      startedAt: startedDate,
      velocityPerDay,
      latestGravity: readings.results.length > 0
        ? readings.results[readings.results.length - 1].gravity
        : null,
      targetGravity: batch.target_gravity,
      rackingCount,
      lastRackingAt,
      mlfInoculatedAt,
    });

    const estimatedRackingDates = milestones
      .filter((m) => /racking/i.test(m.label) && !m.completed)
      .map((m) => m.estimated_date);
    const bottlingMilestone = milestones.find((m) => /bottling/i.test(m.label));
    const estimatedBottlingDate = bottlingMilestone?.estimated_date ?? null;

    const timelineCandidates = evaluateTimelineAlerts({
      batchId: batch.id,
      batchName: batch.name,
      rackingCount,
      lastRackingAt,
      daysSinceLastSo2,
      daysSinceLastRacking,
      mlfStatus: batch.mlf_status ?? null,
      mlfInoculatedAt,
      stage: batch.stage,
      estimatedRackingDates,
      estimatedBottlingDate,
    });

    const allCandidates = [...candidates, ...timelineCandidates];
    const fired = await processAlerts(db, batch.user_id, batch.id, allCandidates);
    await resolveCleared(db, batch.user_id, batch.id, allCandidates);

    if (fired.length > 0) {
      await sendAlertPushes(db, batch.user_id, batch.name, fired, vapidPublicKey, vapidPrivateKey);
    }
  }
}
