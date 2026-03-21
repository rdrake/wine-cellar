// api/src/lib/alerts.ts — Pure alert evaluation engine (no DB, no side effects)

export type AlertType = "stall" | "no_readings" | "temp_high" | "temp_low" | "stage_suggestion";

export interface AlertCandidate {
  type: AlertType;
  message: string;
  context: Record<string, unknown>;
}

export interface BatchAlertContext {
  batchId: string;
  userId: string;
  stage: string;
  targetGravity: number | null;
  hasAssignedDevice: boolean;
  readings: { gravity: number; temperature: number | null; source_timestamp: string }[];
}

// ── Velocity helper ───────────────────────────────────────────────────

/**
 * Compute gravity velocity (change per day) over a given window ending at
 * the latest reading. Returns null if insufficient data.
 *
 * Negative velocity = gravity dropping (normal fermentation).
 */
function velocity(
  readings: BatchAlertContext["readings"],
  windowHours: number,
): number | null {
  if (readings.length < 2) return null;
  const latest = readings[readings.length - 1];
  const cutoff = new Date(new Date(latest.source_timestamp).getTime() - windowHours * 3600_000);
  const oldest = readings.find((r) => new Date(r.source_timestamp) >= cutoff);
  if (!oldest || oldest === latest) return null;
  const days =
    (new Date(latest.source_timestamp).getTime() - new Date(oldest.source_timestamp).getTime()) /
    86400_000;
  if (days <= 0) return null;
  return (latest.gravity - oldest.gravity) / days;
}

// ── Evaluator ─────────────────────────────────────────────────────────

export function evaluateAlerts(ctx: BatchAlertContext): AlertCandidate[] {
  const alerts: AlertCandidate[] = [];
  const { readings } = ctx;

  if (readings.length === 0) return alerts;

  const latest = readings[readings.length - 1];

  // ── Temperature alerts (need latest reading with a temperature) ────
  if (latest.temperature !== null) {
    if (latest.temperature >= 30) {
      alerts.push({
        type: "temp_high",
        message: `Temperature is ${latest.temperature}°C — above safe threshold (30°C)`,
        context: { temperature: latest.temperature },
      });
    }
    if (latest.temperature <= 8) {
      alerts.push({
        type: "temp_low",
        message: `Temperature is ${latest.temperature}°C — below safe threshold (8°C)`,
        context: { temperature: latest.temperature },
      });
    }
  }

  // ── No readings (stale device) ─────────────────────────────────────
  if (ctx.hasAssignedDevice) {
    const ageMs = Date.now() - new Date(latest.source_timestamp).getTime();
    const ageHours = ageMs / 3600_000;
    if (ageHours > 48) {
      alerts.push({
        type: "no_readings",
        message: `No readings received for ${Math.round(ageHours)} hours`,
        context: { lastReadingAt: latest.source_timestamp, hoursAgo: Math.round(ageHours) },
      });
    }
  }

  // ── Stall & stage suggestions require >= 10 readings ──────────────
  if (readings.length >= 10) {
    const v48 = velocity(readings, 48);
    const v7d = velocity(readings, 168);

    // ── Stall detection ──────────────────────────────────────────────
    if (v48 !== null && v7d !== null && latest.gravity >= 0.998 && latest.gravity > 1.005) {
      const isFlat = Math.abs(v48) < 0.0005;
      const isSlowing = v7d !== 0 && Math.abs(v48) < Math.abs(v7d) * 0.2;
      if (isFlat || isSlowing) {
        const reason = isFlat
          ? "Gravity unchanged for 48+ hours"
          : "Velocity dropped to <20% of 7-day average";
        alerts.push({
          type: "stall",
          message: `Possible fermentation stall at ${latest.gravity.toFixed(3)} — ${reason}`,
          context: {
            gravity: latest.gravity,
            velocity48h: v48,
            velocity7d: v7d,
            reason,
          },
        });
      }
    }

    // ── Stage suggestions ────────────────────────────────────────────
    if (ctx.stage === "primary_fermentation") {
      if (v48 !== null && v7d !== null && v7d !== 0) {
        if (latest.gravity < 1.02 && Math.abs(v48) < Math.abs(v7d) * 0.5) {
          alerts.push({
            type: "stage_suggestion",
            message: "Fermentation is slowing — consider moving to secondary",
            context: {
              suggestedStage: "secondary_fermentation",
              gravity: latest.gravity,
              velocity48h: v48,
              velocity7d: v7d,
            },
          });
        }
      }
    } else if (ctx.stage === "secondary_fermentation") {
      // 72h gravity range < 0.001 AND (gravity < 1.000 OR within 0.002 of target)
      const cutoff72 = new Date(
        new Date(latest.source_timestamp).getTime() - 72 * 3600_000,
      );
      const recent72 = readings.filter((r) => new Date(r.source_timestamp) >= cutoff72);
      if (recent72.length >= 2) {
        const gravities = recent72.map((r) => r.gravity);
        const range72 = Math.max(...gravities) - Math.min(...gravities);
        const nearTarget =
          ctx.targetGravity !== null && Math.abs(latest.gravity - ctx.targetGravity) <= 0.002;
        if (range72 < 0.001 && (latest.gravity < 1.0 || nearTarget)) {
          alerts.push({
            type: "stage_suggestion",
            message: "Gravity has stabilized — consider moving to stabilization",
            context: {
              suggestedStage: "stabilization",
              gravity: latest.gravity,
              gravityRange72h: range72,
            },
          });
        }
      }
    }
    // No suggestions for must_prep, stabilization, or bottling
  }

  return alerts;
}
