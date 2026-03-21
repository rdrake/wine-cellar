// api/src/lib/alert-manager.ts — Alert state persistence with dedup and resolve lifecycle

import type { AlertCandidate, AlertType } from "./alerts";
import { nowUtc } from "./time";

export interface FiredAlert {
  id: string;
  user_id: string;
  batch_id: string;
  alert_type: AlertType;
  context: string | null;
  fired_at: string;
}

/**
 * For each AlertCandidate, try to INSERT into alert_state.
 * Uses the partial unique index for dedup — catches UNIQUE constraint violations and skips.
 * Returns only newly inserted alerts (for push notification).
 */
export async function processAlerts(
  db: D1Database,
  userId: string,
  batchId: string,
  candidates: AlertCandidate[],
): Promise<FiredAlert[]> {
  const fired: FiredAlert[] = [];
  const now = nowUtc();

  for (const candidate of candidates) {
    const id = crypto.randomUUID();
    const contextJson = candidate.context ? JSON.stringify(candidate.context) : null;

    // Check for any unresolved row (active OR dismissed) — dismissed alerts
    // should not re-fire until the condition resolves and clears them first.
    const existing = await db
      .prepare(
        `SELECT id FROM alert_state
         WHERE user_id = ? AND batch_id = ? AND alert_type = ? AND resolved_at IS NULL
         LIMIT 1`,
      )
      .bind(userId, batchId, candidate.type)
      .first();

    if (existing) continue;

    try {
      await db
        .prepare(
          `INSERT INTO alert_state (id, user_id, batch_id, alert_type, context, fired_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, userId, batchId, candidate.type, contextJson, now)
        .run();

      fired.push({
        id,
        user_id: userId,
        batch_id: batchId,
        alert_type: candidate.type,
        context: contextJson,
        fired_at: now,
      });
    } catch (e: unknown) {
      // UNIQUE constraint violation from partial index — race-safe fallback
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE constraint failed") || msg.includes("SQLITE_CONSTRAINT")) {
        continue;
      }
      throw e;
    }
  }

  return fired;
}

/**
 * Get all unresolved rows for this user+batch from alert_state.
 * For each row whose alert_type is NOT in current candidates, set resolved_at = now.
 * This clears both active and dismissed alerts when the condition resolves.
 */
export async function resolveCleared(
  db: D1Database,
  userId: string,
  batchId: string,
  currentCandidates: AlertCandidate[],
): Promise<void> {
  const now = nowUtc();
  const activeTypes = new Set(currentCandidates.map((c) => c.type));

  const { results } = await db
    .prepare(
      `SELECT id, alert_type FROM alert_state
       WHERE user_id = ? AND batch_id = ? AND resolved_at IS NULL`,
    )
    .bind(userId, batchId)
    .all();

  for (const row of results) {
    if (!activeTypes.has(row.alert_type as AlertType)) {
      await db
        .prepare(`UPDATE alert_state SET resolved_at = ? WHERE id = ?`)
        .bind(now, row.id as string)
        .run();
    }
  }
}

/**
 * SELECT from alert_state JOIN batches WHERE resolved_at IS NULL AND dismissed_at IS NULL.
 * Includes batch_name from the join. ORDER BY fired_at DESC.
 */
export async function getActiveAlerts(
  db: D1Database,
  userId: string,
): Promise<any[]> {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.user_id, a.batch_id, a.alert_type, a.context, a.fired_at,
              b.name AS batch_name
       FROM alert_state a
       JOIN batches b ON b.id = a.batch_id
       WHERE a.user_id = ? AND a.resolved_at IS NULL AND a.dismissed_at IS NULL
       ORDER BY a.fired_at DESC`,
    )
    .bind(userId)
    .all();

  return results;
}
