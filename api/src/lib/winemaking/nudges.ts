export interface Nudge {
  id: string;
  priority: "info" | "warning" | "action";
  message: string;
  detail?: string;
  stage: string;
}

export interface NudgeContext {
  stage: string;
  wineType: string;
  sourceMaterial: string;
  volumeLiters: number | null;
  mlfStatus: string | null;
  latestGravity: number | null;
  latestTemp: number | null;
  totalSo2Additions: number;
}

type Evaluator = (ctx: NudgeContext) => Nudge | null;

const SO2_DOSE_G_PER_L = 0.074;

function so2Crushing(ctx: NudgeContext): Nudge | null {
  if (ctx.stage !== "must_prep") return null;
  if (ctx.sourceMaterial !== "fresh_grapes") return null;
  if (ctx.totalSo2Additions > 0) return null;

  const dose =
    ctx.volumeLiters != null
      ? `${(ctx.volumeLiters * SO2_DOSE_G_PER_L).toFixed(1)}g`
      : "~0.074g/L";
  const volume = ctx.volumeLiters != null ? `${ctx.volumeLiters}L` : "your";

  return {
    id: "so2-crushing",
    priority: "action",
    message: `Add SO2 at crushing \u2014 ${dose} of potassium metabisulfite for your ${volume} batch`,
    detail: "Wait at least 24 hours after adding SO2 before pitching yeast.",
    stage: ctx.stage,
  };
}

function initialMeasurements(ctx: NudgeContext): Nudge | null {
  if (ctx.stage !== "must_prep") return null;

  return {
    id: "initial-measurements",
    priority: "info",
    message: "Take Brix, TA, and pH readings before pitching yeast",
    stage: ctx.stage,
  };
}

function punchDown(ctx: NudgeContext): Nudge | null {
  if (ctx.stage !== "primary_fermentation") return null;
  if (ctx.wineType !== "red" && ctx.wineType !== "ros\u00e9") return null;

  return {
    id: "punch-down",
    priority: "info",
    message: "Punch down the cap at least twice daily",
    stage: ctx.stage,
  };
}

function tempHighPrimary(ctx: NudgeContext): Nudge | null {
  if (ctx.stage !== "primary_fermentation") return null;
  if (ctx.latestTemp == null || ctx.latestTemp < 29) return null;

  return {
    id: "temp-high-primary",
    priority: "warning",
    message: `Temperature is ${ctx.latestTemp}\u00b0C \u2014 stay under 29\u00b0C`,
    stage: ctx.stage,
  };
}

function considerPressing(ctx: NudgeContext): Nudge | null {
  if (ctx.stage !== "primary_fermentation") return null;
  if (ctx.wineType !== "red") return null;
  if (ctx.latestGravity == null || ctx.latestGravity > 1.02) return null;

  return {
    id: "consider-pressing",
    priority: "action",
    message: "Consider pressing \u2014 SG is approaching 1.010",
    detail: "Typical skin contact: 5\u20137 days for a balanced red, 3\u20135 days for light/fruity, 7\u201310 days for full-bodied.",
    stage: ctx.stage,
  };
}

function considerPressingRose(ctx: NudgeContext): Nudge | null {
  if (ctx.stage !== "primary_fermentation") return null;
  if (ctx.wineType !== "ros\u00e9") return null;

  return {
    id: "consider-pressing-rose",
    priority: "info",
    message: "Press after 6\u201324 hours of skin contact, depending on desired color depth",
    stage: ctx.stage,
  };
}

function mlfSuggestion(ctx: NudgeContext): Nudge | null {
  if (ctx.stage !== "secondary_fermentation") return null;
  if (ctx.wineType !== "red" && ctx.wineType !== "orange") return null;
  if (
    ctx.mlfStatus === "not_planned" ||
    ctx.mlfStatus === "in_progress" ||
    ctx.mlfStatus === "complete"
  ) {
    return null;
  }

  return {
    id: "mlf-suggestion",
    priority: "info",
    message: "MLF not started \u2014 consider inoculating",
    stage: ctx.stage,
  };
}

function so2MlfWarning(ctx: NudgeContext): Nudge | null {
  if (ctx.mlfStatus !== "in_progress") return null;

  return {
    id: "so2-mlf-warning",
    priority: "warning",
    message: "Do not add SO2 while MLF is in progress — it will kill the malolactic bacteria",
    stage: ctx.stage,
  };
}

function so2Racking(ctx: NudgeContext): Nudge | null {
  if (ctx.stage !== "stabilization") return null;

  return {
    id: "so2-racking",
    priority: "action",
    message: "Add SO2 before racking",
    stage: ctx.stage,
  };
}

function bottlingChecklist(ctx: NudgeContext): Nudge | null {
  if (ctx.stage !== "bottling") return null;

  const taRange =
    ctx.wineType === "white" || ctx.wineType === "rosé"
      ? "0.65–0.85"
      : "0.60–0.80";

  return {
    id: "bottling-checklist",
    priority: "action",
    message:
      "Final checks: SG below 0.998, free SO2 at 25–35 ppm, pH 3.2–3.6, taste is clean",
    detail: `Target TA: ${taRange} g/100mL. pH above 3.6 increases spoilage risk.`,
    stage: ctx.stage,
  };
}

const evaluators: Evaluator[] = [
  so2Crushing,
  initialMeasurements,
  punchDown,
  tempHighPrimary,
  considerPressing,
  considerPressingRose,
  mlfSuggestion,
  so2MlfWarning,
  so2Racking,
  bottlingChecklist,
];

export function generateNudges(ctx: NudgeContext): Nudge[] {
  const nudges: Nudge[] = [];
  for (const evaluate of evaluators) {
    const nudge = evaluate(ctx);
    if (nudge) nudges.push(nudge);
  }
  return nudges;
}
