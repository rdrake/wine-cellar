import { BATCH_STAGES, type BatchStage } from "../../schema";

export interface Milestone {
  label: string;
  estimated_date: string; // ISO date string (YYYY-MM-DD)
  basis: string; // human explanation
  confidence: "firm" | "estimated" | "rough";
  completed?: boolean;
}

export interface TimelineContext {
  stage: string;
  wineType: string;
  sourceMaterial: string;
  mlfStatus: string | null;
  startedAt: string;
  velocityPerDay: number | null; // SG change per day (negative = dropping)
  latestGravity: number | null;
  targetGravity: number | null;
  rackingCount: number;
  lastRackingAt: string | null;
  mlfInoculatedAt: string | null;
}

/** Add `days` to an ISO date string and return a new ISO date string. */
export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Check whether `current` stage is past `target` in the waypoint order. */
export function isPastStage(current: string, target: string): boolean {
  const currentIdx = BATCH_STAGES.indexOf(current as BatchStage);
  const targetIdx = BATCH_STAGES.indexOf(target as BatchStage);
  // If either stage is not a waypoint, fall back to not-past
  if (currentIdx === -1 || targetIdx === -1) return false;
  return currentIdx > targetIdx;
}

/**
 * Typical primary fermentation duration in days, by wine type / source.
 * Kits and reds: ~7 days. Whites and everything else: ~14 days.
 */
function typicalPrimaryDays(wineType: string, sourceMaterial: string): number {
  if (sourceMaterial === "kit") return 7;
  if (wineType === "red") return 7;
  return 14;
}

/**
 * Minimum aging after last racking before bottling, in days.
 * Kits: 30 days. Whites/rosé: 90 days. Reds (and everything else): 180 days.
 */
function agingDaysBeforeBottling(
  wineType: string,
  sourceMaterial: string,
): number {
  if (sourceMaterial === "kit") return 30;
  if (wineType === "white" || wineType === "rosé") return 90;
  return 180;
}

/**
 * Project a timeline of upcoming milestones for a batch.
 *
 * Pure function — no DB or network access.
 */
export function projectTimeline(ctx: TimelineContext): Milestone[] {
  const milestones: Milestone[] = [];

  // ── 1. End of primary fermentation ────────────────────────────────
  let estimatedPrimaryEnd: string | null = null;

  if (!isPastStage(ctx.stage, "primary_fermentation")) {
    if (
      ctx.velocityPerDay !== null &&
      ctx.velocityPerDay < 0 &&
      ctx.latestGravity !== null &&
      ctx.targetGravity !== null
    ) {
      // Extrapolate: remaining SG / |velocity| = days until target gravity.
      // Anchored from startedAt since we don't have a separate "today" input.
      const remaining = ctx.latestGravity - ctx.targetGravity;
      const daysLeft = Math.ceil(remaining / Math.abs(ctx.velocityPerDay));

      estimatedPrimaryEnd = addDays(ctx.startedAt, daysLeft);
      milestones.push({
        label: "End of primary fermentation",
        estimated_date: estimatedPrimaryEnd,
        basis: `Extrapolated from velocity of ${ctx.velocityPerDay.toFixed(3)} SG/day`,
        confidence: "estimated",
      });
    } else {
      // Fall back to typical duration
      const days = typicalPrimaryDays(ctx.wineType, ctx.sourceMaterial);
      estimatedPrimaryEnd = addDays(ctx.startedAt, days);
      milestones.push({
        label: "End of primary fermentation",
        estimated_date: estimatedPrimaryEnd,
        basis: `Typical ${days}-day primary for ${ctx.sourceMaterial === "kit" ? "kit" : ctx.wineType} wines`,
        confidence: "rough",
      });
    }
  }

  // ── 2. MLF completion ─────────────────────────────────────────────
  if (ctx.mlfStatus === "in_progress" && ctx.mlfInoculatedAt) {
    milestones.push({
      label: "MLF completion",
      estimated_date: addDays(ctx.mlfInoculatedAt, 42),
      basis: "~6 weeks after MLF inoculation",
      confidence: "rough",
    });
  }

  // ── 3. Racking schedule ───────────────────────────────────────────
  const rackingLabels = ["First racking", "Second racking", "Third racking"];
  const rackingOffsets = [14, 75, 90]; // days after previous anchor

  // Anchor for the first racking: either lastRackingAt (if at least one
  // racking done) or estimatedPrimaryEnd or startedAt + typical.
  let firstRackingDate: string;
  if (ctx.rackingCount >= 1 && ctx.lastRackingAt) {
    // Use actual first racking date as anchor
    firstRackingDate = ctx.lastRackingAt;
  } else {
    // First racking is ~2 weeks after primary ends
    const primaryEnd =
      estimatedPrimaryEnd ??
      addDays(
        ctx.startedAt,
        typicalPrimaryDays(ctx.wineType, ctx.sourceMaterial),
      );
    firstRackingDate = addDays(primaryEnd, rackingOffsets[0]);
  }

  let anchor = firstRackingDate;
  for (let i = 0; i < 3; i++) {
    let date: string;
    if (i === 0) {
      date = firstRackingDate;
    } else {
      date = addDays(anchor, rackingOffsets[i]);
    }
    const completed = ctx.rackingCount > i;
    milestones.push({
      label: rackingLabels[i],
      estimated_date: date,
      basis:
        i === 0
          ? "~2 weeks after primary ends"
          : `~${rackingOffsets[i]} days after previous racking`,
      confidence: completed ? "firm" : "estimated",
      ...(completed ? { completed: true } : {}),
    });
    anchor = date;
  }

  // ── 4. Earliest bottling ──────────────────────────────────────────
  const lastRackingDate = anchor; // the third racking date
  const agingDays = agingDaysBeforeBottling(ctx.wineType, ctx.sourceMaterial);
  milestones.push({
    label: "Earliest bottling",
    estimated_date: addDays(lastRackingDate, agingDays),
    basis: `${agingDays} days aging after final racking`,
    confidence: "rough",
  });

  return milestones;
}
