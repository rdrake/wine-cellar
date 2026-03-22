import type { AlertCandidate, AlertType } from "../alerts";

export interface TimelineAlertContext {
  batchName: string;
  rackingCount: number;
  lastRackingAt: string | null;
  daysSinceLastSo2: number | null;
  daysSinceLastRacking: number | null;
  mlfStatus: string | null;
  mlfInoculatedAt: string | null;
  stage: string;
  estimatedRackingDates: string[]; // up to 3 dates
  estimatedBottlingDate: string | null;
}

const RACKING_LABELS = ["First", "Second", "Third"] as const;

export function evaluateTimelineAlerts(ctx: TimelineAlertContext): AlertCandidate[] {
  const alerts: AlertCandidate[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // ── Racking due alerts ──────────────────────────────────────────────
  for (let i = 0; i < ctx.estimatedRackingDates.length; i++) {
    if (ctx.rackingCount > i) continue; // already racked this one
    const date = ctx.estimatedRackingDates[i];
    if (date <= today) {
      const label = RACKING_LABELS[i] ?? `Racking ${i + 1}`;
      const type = `racking_due_${i + 1}` as AlertType;
      const message = `${label} racking is due for ${ctx.batchName}`;
      alerts.push({ type, message, context: { message } });
    }
  }

  // ── SO2 due ─────────────────────────────────────────────────────────
  if (ctx.daysSinceLastSo2 !== null && ctx.daysSinceLastSo2 >= 42) {
    const message = `Consider an SO2 addition for ${ctx.batchName}`;
    alerts.push({ type: "so2_due", message, context: { message } });
  } else if (
    ctx.daysSinceLastRacking !== null &&
    ctx.daysSinceLastRacking <= 3 &&
    (ctx.daysSinceLastSo2 === null || ctx.daysSinceLastSo2 > ctx.daysSinceLastRacking)
  ) {
    // Racked recently without an SO2 addition after
    const message = `Consider an SO2 addition for ${ctx.batchName}`;
    alerts.push({ type: "so2_due", message, context: { message } });
  }

  // ── MLF check ───────────────────────────────────────────────────────
  if (ctx.mlfStatus === "in_progress" && ctx.mlfInoculatedAt) {
    const inoculatedDate = new Date(ctx.mlfInoculatedAt + "T00:00:00Z");
    const todayDate = new Date(today + "T00:00:00Z");
    const daysSinceInoculation = Math.floor(
      (todayDate.getTime() - inoculatedDate.getTime()) / 86400_000,
    );
    if (daysSinceInoculation >= 28) {
      const message = `Check MLF progress on ${ctx.batchName} — test for malic acid`;
      alerts.push({ type: "mlf_check", message, context: { message } });
    }
  }

  // ── Bottling ready ──────────────────────────────────────────────────
  if (
    ctx.estimatedBottlingDate &&
    ctx.estimatedBottlingDate <= today &&
    ctx.rackingCount >= 3
  ) {
    const message = `${ctx.batchName} has reached its earliest bottling window`;
    alerts.push({ type: "bottling_ready", message, context: { message } });
  }

  return alerts;
}
