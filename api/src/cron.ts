import { evaluateAlerts, type BatchAlertContext } from "./lib/alerts";
import { processAlerts, resolveCleared, sendAlertPushes } from "./lib/alert-manager";
import { projectTimeline, evaluateTimelineAlerts, fetchWinemakingActivityContext, computeVelocityPerDay } from "./lib/winemaking";
import { cleanupExpiredSessions } from "./lib/auth-session";
import { cleanupExpiredChallenges } from "./lib/auth-challenge";
import type { CronBatchRow, DeviceIdRow, ReadingSummaryRow } from "./db-types";

export async function cleanupAuthTables(db: D1Database): Promise<void> {
  await Promise.all([
    cleanupExpiredSessions(db),
    cleanupExpiredChallenges(db),
  ]);
}

export async function evaluateAllBatches(
  db: D1Database,
  vapidPublicKey: string,
  vapidPrivateKey: string,
): Promise<void> {
  const batches = await db.prepare(
    "SELECT b.id, b.user_id, b.name, b.stage, b.target_gravity, b.started_at, b.wine_type, b.source_material, b.mlf_status FROM batches b WHERE b.status = 'active'"
  ).all<CronBatchRow>();

  for (const batch of batches.results) {
    const [device, readings, activityCtx] = await Promise.all([
      db.prepare(
        "SELECT id FROM devices WHERE batch_id = ? AND user_id = ? LIMIT 1"
      ).bind(batch.id, batch.user_id).first<DeviceIdRow>(),

      db.prepare(
        "SELECT gravity, temperature, source_timestamp FROM readings WHERE batch_id = ? ORDER BY source_timestamp ASC LIMIT 200"
      ).bind(batch.id).all<ReadingSummaryRow>(),

      fetchWinemakingActivityContext(db, batch.id, batch.user_id),
    ]);

    const ctx: BatchAlertContext = {
      batchId: batch.id,
      userId: batch.user_id,
      stage: batch.stage,
      wineType: batch.wine_type ?? "red",
      targetGravity: batch.target_gravity,
      hasAssignedDevice: !!device,
      readings: readings.results,
    };

    const candidates = evaluateAlerts(ctx);

    // ── Timeline-driven alerts ──────────────────────────────────────
    const { rackingCount, lastRackingAt, lastSo2At, mlfInoculatedAt } = activityCtx;

    const now = Date.now();
    const daysSinceLastSo2 = lastSo2At
      ? Math.floor((now - new Date(lastSo2At + "T00:00:00Z").getTime()) / 86400_000)
      : null;
    const daysSinceLastRacking = lastRackingAt
      ? Math.floor((now - new Date(lastRackingAt + "T00:00:00Z").getTime()) / 86400_000)
      : null;

    const velocityPerDay = computeVelocityPerDay(readings.results);

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
      .filter((m) => /racking/i.test(m.label))
      .map((m) => m.estimated_date);
    const bottlingMilestone = milestones.find((m) => /bottling/i.test(m.label));
    const estimatedBottlingDate = bottlingMilestone?.estimated_date ?? null;

    const timelineCandidates = evaluateTimelineAlerts({
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
