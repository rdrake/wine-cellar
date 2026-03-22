import { SO2_CHEMICALS, MLF_CULTURES } from "../../schema";

const SO2_IN_SQL = SO2_CHEMICALS.map(c => `'${c}'`).join(", ");
const MLF_IN_SQL = MLF_CULTURES.map(c => `'${c}'`).join(", ");

export interface WinemakingActivityContext {
  so2Count: number;
  lastSo2At: string | null;
  rackingCount: number;
  lastRackingAt: string | null;
  mlfInoculatedAt: string | null;
}

export async function fetchWinemakingActivityContext(
  db: D1Database,
  batchId: string,
  userId: string,
): Promise<WinemakingActivityContext> {
  const [so2Data, rackingData, mlfData] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) as count, MAX(recorded_at) as last_at FROM activities
       WHERE batch_id = ? AND user_id = ? AND type = 'addition'
       AND json_extract(details, '$.chemical') IN (${SO2_IN_SQL})`
    ).bind(batchId, userId).first<any>(),

    db.prepare(
      `SELECT COUNT(*) as count, MAX(recorded_at) as last_at FROM activities
       WHERE batch_id = ? AND user_id = ? AND type = 'racking'`
    ).bind(batchId, userId).first<any>(),

    db.prepare(
      `SELECT recorded_at FROM activities
       WHERE batch_id = ? AND user_id = ? AND type = 'addition'
       AND json_extract(details, '$.chemical') IN (${MLF_IN_SQL})
       ORDER BY recorded_at ASC LIMIT 1`
    ).bind(batchId, userId).first<any>(),
  ]);

  return {
    so2Count: so2Data?.count ?? 0,
    lastSo2At: so2Data?.last_at ? String(so2Data.last_at).slice(0, 10) : null,
    rackingCount: rackingData?.count ?? 0,
    lastRackingAt: rackingData?.last_at ? String(rackingData.last_at).slice(0, 10) : null,
    mlfInoculatedAt: mlfData?.recorded_at ? String(mlfData.recorded_at).slice(0, 10) : null,
  };
}

export async function fetchStageEnteredAt(
  db: D1Database,
  batchId: string,
  userId: string,
  currentStage: string,
): Promise<string | null> {
  const row = await db.prepare(
    `SELECT recorded_at FROM activities
     WHERE batch_id = ? AND user_id = ? AND type = 'note'
     AND title LIKE '%to ' || ?
     ORDER BY recorded_at DESC LIMIT 1`
  ).bind(batchId, userId, currentStage).first<{ recorded_at: string }>();
  return row ? row.recorded_at.slice(0, 10) : null;
}

/** Compute gravity velocity (SG change per day) from readings sorted by source_timestamp. */
export function computeVelocityPerDay(
  readings: { gravity: number; source_timestamp: string }[],
): number | null {
  if (readings.length < 2) return null;
  const first = readings[0];
  const last = readings[readings.length - 1];
  const timeDiffMs = new Date(last.source_timestamp).getTime() - new Date(first.source_timestamp).getTime();
  const timeDiffDays = timeDiffMs / 86_400_000;
  if (timeDiffDays <= 0) return null;
  return (last.gravity - first.gravity) / timeDiffDays;
}
