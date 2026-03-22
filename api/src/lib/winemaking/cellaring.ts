export interface CellaringContext {
  wineType: string;
  sourceMaterial: string;
  bottledAt: string;
  oakType: string | null;
  oakDurationDays: number | null;
  mlfStatus: string | null;
  totalSo2Ppm: number | null;
  finalPh: number | null;
  finalGravity: number | null;
}

export interface DrinkWindow {
  readyDate: string;
  peakStart: string;
  peakEnd: string;
  pastPeakDate: string;
  storageNote: string;
  adjustmentNote: string | null;
}

export function addMonths(date: string, months: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

interface BaseWindow {
  ready: number;
  peakStart: number;
  peakEnd: number;
  pastPeak: number;
}

function isOaked(ctx: CellaringContext): boolean {
  return (
    ctx.oakType !== null &&
    ctx.oakType !== "none" &&
    ctx.oakDurationDays !== null &&
    ctx.oakDurationDays > 0
  );
}

function isWhiteOrRose(wineType: string): boolean {
  return wineType === "white" || wineType === "rosé";
}

function getBaseWindow(ctx: CellaringContext): BaseWindow {
  const { wineType, sourceMaterial } = ctx;
  const oaked = isOaked(ctx);

  if (sourceMaterial === "kit") {
    if (isWhiteOrRose(wineType)) {
      return { ready: 1, peakStart: 3, peakEnd: 6, pastPeak: 12 };
    }
    // Kit red (and other kit types default to red profile)
    return { ready: 3, peakStart: 6, peakEnd: 12, pastPeak: 24 };
  }

  if (sourceMaterial === "juice_bucket") {
    if (isWhiteOrRose(wineType)) {
      return { ready: 2, peakStart: 6, peakEnd: 12, pastPeak: 18 };
    }
    return { ready: 3, peakStart: 6, peakEnd: 18, pastPeak: 36 };
  }

  // Fresh grapes (and anything else)
  if (isWhiteOrRose(wineType)) {
    if (oaked) {
      return { ready: 6, peakStart: 12, peakEnd: 24, pastPeak: 36 };
    }
    return { ready: 3, peakStart: 6, peakEnd: 12, pastPeak: 24 };
  }

  // Red (and other types default to red profile)
  if (oaked) {
    return { ready: 12, peakStart: 24, peakEnd: 60, pastPeak: 120 };
  }
  return { ready: 6, peakStart: 12, peakEnd: 36, pastPeak: 60 };
}

interface Adjustment {
  factor: number;
  description: string;
}

function getAdjustments(ctx: CellaringContext): Adjustment[] {
  const adjustments: Adjustment[] = [];

  // Low SO2 (< 30 ppm): multiply by 0.75
  if (ctx.totalSo2Ppm !== null && ctx.totalSo2Ppm < 30) {
    adjustments.push({
      factor: 0.75,
      description: `low SO\u2082 (${ctx.totalSo2Ppm} ppm at bottling)`,
    });
  }

  // High pH (> 3.6): multiply by 0.80
  if (ctx.finalPh !== null && ctx.finalPh > 3.6) {
    adjustments.push({
      factor: 0.80,
      description: `pH was ${ctx.finalPh} at bottling`,
    });
  }

  // Long oak (> 180 days): multiply by 1.20
  if (ctx.oakDurationDays !== null && ctx.oakDurationDays > 180) {
    adjustments.push({
      factor: 1.20,
      description: `${Math.round(ctx.oakDurationDays / 30)} months of oak aging`,
    });
  }

  // MLF complete (reds only): multiply by 1.15
  if (ctx.mlfStatus === "complete" && !isWhiteOrRose(ctx.wineType)) {
    adjustments.push({
      factor: 1.15,
      description: "malolactic fermentation completed",
    });
  }

  // Low final gravity (< 0.996): multiply by 1.05
  if (ctx.finalGravity !== null && ctx.finalGravity < 0.996) {
    adjustments.push({
      factor: 1.05,
      description: `dry finish (FG ${ctx.finalGravity})`,
    });
  }

  return adjustments;
}

function buildAdjustmentNote(adjustments: Adjustment[]): string | null {
  if (adjustments.length === 0) return null;

  // Find the biggest adjustment (furthest from 1.0)
  let biggest = adjustments[0];
  for (const adj of adjustments) {
    if (Math.abs(adj.factor - 1.0) > Math.abs(biggest.factor - 1.0)) {
      biggest = adj;
    }
  }

  const direction = biggest.factor < 1.0 ? "Shortened" : "Extended";
  return `${direction} slightly \u2014 ${biggest.description}`;
}

const STORAGE_NOTE =
  "Store bottles on their side at 12-16\u00B0C in a dark, vibration-free location.";

export function calculateDrinkWindow(ctx: CellaringContext): DrinkWindow {
  const base = getBaseWindow(ctx);
  const adjustments = getAdjustments(ctx);

  // Apply multiplicative adjustments
  let combinedFactor = 1.0;
  for (const adj of adjustments) {
    combinedFactor *= adj.factor;
  }

  const adjustedReady = Math.round(base.ready * combinedFactor);
  const adjustedPeakStart = Math.round(base.peakStart * combinedFactor);
  const adjustedPeakEnd = Math.round(base.peakEnd * combinedFactor);
  const adjustedPastPeak = Math.round(base.pastPeak * combinedFactor);

  return {
    readyDate: addMonths(ctx.bottledAt, adjustedReady),
    peakStart: addMonths(ctx.bottledAt, adjustedPeakStart),
    peakEnd: addMonths(ctx.bottledAt, adjustedPeakEnd),
    pastPeakDate: addMonths(ctx.bottledAt, adjustedPastPeak),
    storageNote: STORAGE_NOTE,
    adjustmentNote: buildAdjustmentNote(adjustments),
  };
}
