import { evaluateAlerts, type BatchAlertContext } from "./lib/alerts";
import { processAlerts, resolveCleared, sendAlertPushes } from "./lib/alert-manager";

export async function evaluateAllBatches(
  db: D1Database,
  vapidPublicKey: string,
  vapidPrivateKey: string,
): Promise<void> {
  const batches = await db.prepare(
    "SELECT b.id, b.user_id, b.name, b.stage, b.target_gravity FROM batches b WHERE b.status = 'active'"
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
    const fired = await processAlerts(db, batch.user_id, batch.id, candidates);
    await resolveCleared(db, batch.user_id, batch.id, candidates);

    if (fired.length > 0) {
      await sendAlertPushes(db, batch.user_id, batch.name, fired, vapidPublicKey, vapidPrivateKey);
    }
  }
}
