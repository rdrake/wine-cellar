import type { CurveParams } from "./generators";

export interface ActivityDef {
  stage: string;
  type: string;
  title: string;
  details?: Record<string, unknown> | null;
  dayOffset: number; // days after batch started_at
}

export interface StageDef {
  stage: string;
  activitiesBefore: ActivityDef[]; // log these BEFORE advancing to this stage
}

export interface ScenarioDef {
  name: string;
  wine_type: string;
  source_material: string;
  volume_liters: number | null;
  target_volume_liters: number | null;
  target_gravity: number | null;
  yeast_strain: string | null;
  oak_type: string | null;
  oak_format: string | null;
  oak_duration_days: number | null;
  mlf_status: string | null;
  notes: string | null;
  daysAgo: number; // how many days ago started_at should be
  deviceId: string; // unique per batch for readings dedup
  curve: CurveParams;
  /** Simple batches: just advance to this stage and log activities */
  targetStage?: string;
  activities?: ActivityDef[];
  /** Lifecycle batches: walk through stages in order, interleaving activities */
  lifecycle?: StageDef[];
  /** Post-seed actions */
  abandon?: boolean;
  complete?: boolean;
  archive?: boolean;
  /** Register and assign a real device */
  assignDevice?: { id: string; name: string };
}

// ─── Scenarios ───────────────────────────────────────────────────

export const scenarios: ScenarioDef[] = [
  // #1 — Argentia Ridge Cab Sauv (healthy mid-primary kit)
  {
    name: "Argentia Ridge Cab Sauv",
    wine_type: "red",
    source_material: "kit",
    volume_liters: 23,
    target_volume_liters: 21,
    target_gravity: 0.996,
    yeast_strain: "Lalvin EC-1118",
    oak_type: null,
    oak_format: null,
    oak_duration_days: null,
    mlf_status: "not_planned",
    notes: null,
    daysAgo: 5,
    deviceId: "e2e-device-01",
    curve: {
      og: 1.088,
      currentSg: 1.042,
      days: 5,
      tempTarget: 24,
      tempVariance: 1.5,
      readingsPerDay: 24,
      style: "red",
    },
    targetStage: "primary_fermentation",
    activities: [
      {
        stage: "primary_fermentation",
        type: "addition",
        title: "Pitched yeast",
        details: { chemical: "Lalvin EC-1118", amount: 5, unit: "g" },
        dayOffset: 0,
      },
      {
        stage: "primary_fermentation",
        type: "measurement",
        title: "SG reading",
        details: { metric: "SG", value: 1.065, unit: "" },
        dayOffset: 3,
      },
      {
        stage: "primary_fermentation",
        type: "measurement",
        title: "SG reading",
        details: { metric: "SG", value: 1.042, unit: "" },
        dayOffset: 5,
      },
    ],
    assignDevice: { id: "e2e-rapt-pill-01", name: "Rapt Pill #1" },
  },

  // #2 — Magnotta Chardonnay (secondary with MLF)
  {
    name: "Magnotta Chardonnay",
    wine_type: "white",
    source_material: "juice_bucket",
    volume_liters: 23,
    target_volume_liters: 20,
    target_gravity: 0.995,
    yeast_strain: "Lalvin 71B",
    oak_type: null,
    oak_format: null,
    oak_duration_days: null,
    mlf_status: "in_progress",
    notes: null,
    daysAgo: 21,
    deviceId: "e2e-device-02",
    curve: {
      og: 1.082,
      currentSg: 1.002,
      days: 21,
      tempTarget: 16,
      tempVariance: 1.0,
      readingsPerDay: 24,
      style: "white",
    },
    targetStage: "secondary_fermentation",
    activities: [
      {
        stage: "secondary_fermentation",
        type: "addition",
        title: "Inoculated MLF",
        details: { chemical: "VP41", amount: 1, unit: "packet" },
        dayOffset: 14,
      },
      {
        stage: "secondary_fermentation",
        type: "racking",
        title: "Racked off primary lees",
        details: { from_vessel: "Primary bucket", to_vessel: "Carboy" },
        dayOffset: 12,
      },
    ],
  },

  // #3 — Argentia Ridge Pinot Noir Rosé (early primary, premium kit with skins)
  {
    name: "Argentia Ridge Pinot Noir Rosé",
    wine_type: "rosé",
    source_material: "kit",
    volume_liters: 23,
    target_volume_liters: 21,
    target_gravity: 0.996,
    yeast_strain: "Lalvin RC212",
    oak_type: null,
    oak_format: null,
    oak_duration_days: null,
    mlf_status: "not_planned",
    notes: "Premium kit with grape skin pack included.",
    daysAgo: 2,
    deviceId: "e2e-device-03",
    curve: {
      og: 1.076,
      currentSg: 1.063,
      days: 2,
      tempTarget: 20,
      tempVariance: 1.0,
      readingsPerDay: 24,
      style: "white", // rosé ferments at white temps
    },
    targetStage: "primary_fermentation",
    activities: [
      {
        stage: "primary_fermentation",
        type: "addition",
        title: "Pitched yeast",
        details: { chemical: "Lalvin RC212", amount: 5, unit: "g" },
        dayOffset: 0,
      },
      {
        stage: "primary_fermentation",
        type: "addition",
        title: "Added grape skin pack",
        details: { chemical: "Grape skins (Pinot Noir)", amount: 1, unit: "pack" },
        dayOffset: 0,
      },
    ],
  },

  // #4 — Magnotta Riesling (cold stabilization)
  {
    name: "Magnotta Riesling",
    wine_type: "white",
    source_material: "juice_bucket",
    volume_liters: 23,
    target_volume_liters: 20,
    target_gravity: 0.996,
    yeast_strain: "Lalvin QA23",
    oak_type: null,
    oak_format: null,
    oak_duration_days: null,
    mlf_status: "not_planned",
    notes: null,
    daysAgo: 45,
    deviceId: "e2e-device-04",
    curve: {
      og: 1.084,
      currentSg: 0.996,
      days: 45,
      tempTarget: 12,
      tempVariance: 0.5,
      readingsPerDay: 24,
      style: "white",
    },
    targetStage: "stabilization",
    activities: [
      {
        stage: "stabilization",
        type: "racking",
        title: "Racked to clean carboy",
        details: { from_vessel: "Carboy 1", to_vessel: "Carboy 2" },
        dayOffset: 30,
      },
      {
        stage: "stabilization",
        type: "addition",
        title: "Added K2S2O5",
        details: { chemical: "K2S2O5", amount: 0.5, unit: "g" },
        dayOffset: 30,
      },
      {
        stage: "stabilization",
        type: "note",
        title: "Cold stabilization started",
        details: { body: "Moved to cold room at 12°C for tartrate precipitation." },
        dayOffset: 35,
      },
    ],
  },

  // #5 — Argentia Ridge Zinfandel (stalled fermentation)
  {
    name: "Argentia Ridge Zinfandel",
    wine_type: "red",
    source_material: "kit",
    volume_liters: 23,
    target_volume_liters: 21,
    target_gravity: 0.996,
    yeast_strain: "Lalvin EC-1118",
    oak_type: null,
    oak_format: null,
    oak_duration_days: null,
    mlf_status: "not_planned",
    notes: "Premium kit with grape skin pack. Fermentation stalled — needs attention.",
    daysAgo: 12,
    deviceId: "e2e-device-05",
    curve: {
      og: 1.092,
      currentSg: 1.030,
      days: 12,
      tempTarget: 22,
      tempVariance: 1.0,
      readingsPerDay: 24,
      style: "red",
      stallAtSg: 1.030,
    },
    targetStage: "primary_fermentation",
    activities: [
      {
        stage: "primary_fermentation",
        type: "addition",
        title: "Pitched yeast",
        details: { chemical: "Lalvin EC-1118", amount: 5, unit: "g" },
        dayOffset: 0,
      },
      {
        stage: "primary_fermentation",
        type: "note",
        title: "Checked fermentation — no activity",
        details: { body: "No bubbling visible in airlock for 2 days. SG stuck at 1.030. Room temp may be too low." },
        dayOffset: 10,
      },
    ],
  },

  // #6 — 2024 Merlot (completed, fresh grapes, full lifecycle)
  {
    name: "2024 Merlot",
    wine_type: "red",
    source_material: "fresh_grapes",
    volume_liters: 60,
    target_volume_liters: 55,
    target_gravity: 0.996,
    yeast_strain: "Lalvin BM45",
    oak_type: "french",
    oak_format: "chips",
    oak_duration_days: 90,
    mlf_status: "complete",
    notes: "Backyard Merlot from 2024 harvest. Full lifecycle test batch.",
    daysAgo: 180,
    deviceId: "e2e-device-06",
    curve: {
      og: 1.090,
      currentSg: 0.994,
      days: 180,
      tempTarget: 24,
      tempVariance: 2.0,
      readingsPerDay: 4, // 4/day over 180 days = 720 readings (manageable)
      style: "red",
    },
    complete: true,
    lifecycle: [
      {
        stage: "must_prep",
        activitiesBefore: [
          { stage: "receiving", type: "note", title: "Grapes received", details: { body: "80 lbs Merlot grapes from local vineyard." }, dayOffset: 0 },
          { stage: "crushing", type: "note", title: "Crushed and destemmed", details: { body: "Hand-crushed into primary fermenter." }, dayOffset: 0 },
          { stage: "must_prep", type: "addition", title: "Added SO2", details: { chemical: "K2S2O5", amount: 1.5, unit: "g" }, dayOffset: 0 },
        ],
      },
      {
        stage: "primary_fermentation",
        activitiesBefore: [
          { stage: "primary_fermentation", type: "addition", title: "Pitched yeast", details: { chemical: "Lalvin BM45", amount: 10, unit: "g" }, dayOffset: 1 },
          { stage: "primary_fermentation", type: "measurement", title: "OG reading", details: { metric: "SG", value: 1.090, unit: "" }, dayOffset: 1 },
          { stage: "pressing", type: "note", title: "Pressed", details: { body: "Basket press, kept free-run separate." }, dayOffset: 10 },
        ],
      },
      {
        stage: "secondary_fermentation",
        activitiesBefore: [
          { stage: "secondary_fermentation", type: "racking", title: "Racked to carboy", details: { from_vessel: "Primary bucket", to_vessel: "Carboy 1" }, dayOffset: 12 },
          { stage: "malolactic", type: "addition", title: "Inoculated MLF", details: { chemical: "VP41", amount: 1, unit: "packet" }, dayOffset: 14 },
        ],
      },
      {
        stage: "stabilization",
        activitiesBefore: [
          { stage: "stabilization", type: "racking", title: "Second racking", details: { from_vessel: "Carboy 1", to_vessel: "Carboy 2" }, dayOffset: 60 },
          { stage: "stabilization", type: "addition", title: "Added oak chips", details: { chemical: "French oak chips (medium toast)", amount: 30, unit: "g" }, dayOffset: 60 },
          { stage: "stabilization", type: "addition", title: "Added SO2", details: { chemical: "K2S2O5", amount: 1, unit: "g" }, dayOffset: 90 },
          { stage: "stabilization", type: "racking", title: "Third racking", details: { from_vessel: "Carboy 2", to_vessel: "Carboy 3" }, dayOffset: 120 },
          { stage: "stabilization", type: "tasting", title: "Pre-bottling tasting", details: { color: "Deep garnet", aroma: "Dark cherry, vanilla from oak", palate: "Medium body, soft tannins, good acidity", notes: "Ready for bottling." }, dayOffset: 160 },
        ],
      },
      {
        stage: "bottling",
        activitiesBefore: [
          { stage: "bottling", type: "note", title: "Bottled", details: { body: "25 bottles (750ml). Natural cork." }, dayOffset: 175 },
        ],
      },
    ],
  },

  // #7 — Magnotta Sauvignon Blanc (archived)
  {
    name: "Magnotta Sauvignon Blanc",
    wine_type: "white",
    source_material: "juice_bucket",
    volume_liters: 23,
    target_volume_liters: 20,
    target_gravity: 0.995,
    yeast_strain: "Lalvin QA23",
    oak_type: null,
    oak_format: null,
    oak_duration_days: null,
    mlf_status: "not_planned",
    notes: null,
    daysAgo: 120,
    deviceId: "e2e-device-07",
    curve: {
      og: 1.080,
      currentSg: 0.995,
      days: 120,
      tempTarget: 15,
      tempVariance: 0.5,
      readingsPerDay: 4,
      style: "white",
    },
    complete: true,
    archive: true,
    lifecycle: [
      {
        stage: "must_prep",
        activitiesBefore: [],
      },
      {
        stage: "primary_fermentation",
        activitiesBefore: [
          { stage: "primary_fermentation", type: "addition", title: "Pitched yeast", details: { chemical: "Lalvin QA23", amount: 5, unit: "g" }, dayOffset: 0 },
        ],
      },
      {
        stage: "secondary_fermentation",
        activitiesBefore: [
          { stage: "secondary_fermentation", type: "racking", title: "Racked to carboy", details: { from_vessel: "Bucket", to_vessel: "Carboy" }, dayOffset: 14 },
        ],
      },
      {
        stage: "stabilization",
        activitiesBefore: [
          { stage: "stabilization", type: "racking", title: "Second racking", details: { from_vessel: "Carboy 1", to_vessel: "Carboy 2" }, dayOffset: 60 },
        ],
      },
      {
        stage: "bottling",
        activitiesBefore: [
          { stage: "bottling", type: "note", title: "Bottled", details: { body: "22 bottles." }, dayOffset: 110 },
        ],
      },
    ],
  },

  // #8 — 2025 Blanc de Blancs (sparkling, fresh grapes)
  {
    name: "2025 Blanc de Blancs",
    wine_type: "sparkling",
    source_material: "fresh_grapes",
    volume_liters: 23,
    target_volume_liters: 20,
    target_gravity: 1.000,
    yeast_strain: "Lalvin EC-1118",
    oak_type: null,
    oak_format: null,
    oak_duration_days: null,
    mlf_status: "not_planned",
    notes: "Méthode traditionnelle from Chardonnay grapes.",
    daysAgo: 14,
    deviceId: "e2e-device-08",
    curve: {
      og: 1.084,
      currentSg: 1.010,
      days: 14,
      tempTarget: 14,
      tempVariance: 0.5,
      readingsPerDay: 24,
      style: "white",
    },
    targetStage: "secondary_fermentation",
    activities: [
      {
        stage: "secondary_fermentation",
        type: "addition",
        title: "Pitched yeast",
        details: { chemical: "Lalvin EC-1118", amount: 5, unit: "g" },
        dayOffset: 0,
      },
      {
        stage: "secondary_fermentation",
        type: "note",
        title: "Pressing complete",
        details: { body: "Whole-cluster pressed Chardonnay. Very gentle." },
        dayOffset: 0,
      },
    ],
  },

  // #9 — 2025 Syrah "Control" (split trial)
  {
    name: '2025 Syrah "Control"',
    wine_type: "red",
    source_material: "fresh_grapes",
    volume_liters: 30,
    target_volume_liters: 27,
    target_gravity: 0.996,
    yeast_strain: "Lalvin ICV-D254",
    oak_type: null,
    oak_format: null,
    oak_duration_days: null,
    mlf_status: "pending",
    notes: "Split trial — control batch, no oak.",
    daysAgo: 8,
    deviceId: "e2e-device-09",
    curve: {
      og: 1.090,
      currentSg: 1.025,
      days: 8,
      tempTarget: 28,
      tempVariance: 1.5,
      readingsPerDay: 24,
      style: "red",
    },
    targetStage: "primary_fermentation",
    activities: [
      {
        stage: "primary_fermentation",
        type: "addition",
        title: "Pitched yeast",
        details: { chemical: "Lalvin ICV-D254", amount: 10, unit: "g" },
        dayOffset: 0,
      },
      {
        stage: "primary_fermentation",
        type: "note",
        title: "Punch-down",
        details: { body: "Morning and evening punch-downs. Cap reforming quickly." },
        dayOffset: 3,
      },
    ],
  },

  // #10 — 2025 Syrah "Oak Chips" (split trial variant)
  {
    name: '2025 Syrah "Oak Chips"',
    wine_type: "red",
    source_material: "fresh_grapes",
    volume_liters: 30,
    target_volume_liters: 27,
    target_gravity: 0.996,
    yeast_strain: "Lalvin ICV-D254",
    oak_type: "french",
    oak_format: "chips",
    oak_duration_days: null,
    mlf_status: "pending",
    notes: "Split trial — oak chips added day 3.",
    daysAgo: 8,
    deviceId: "e2e-device-10",
    curve: {
      og: 1.090,
      currentSg: 1.027,
      days: 8,
      tempTarget: 28,
      tempVariance: 1.5,
      readingsPerDay: 24,
      style: "red",
      velocityMultiplier: 0.95,
    },
    targetStage: "primary_fermentation",
    activities: [
      {
        stage: "primary_fermentation",
        type: "addition",
        title: "Pitched yeast",
        details: { chemical: "Lalvin ICV-D254", amount: 10, unit: "g" },
        dayOffset: 0,
      },
      {
        stage: "primary_fermentation",
        type: "addition",
        title: "Added oak chips",
        details: { chemical: "French oak chips (medium toast)", amount: 25, unit: "g" },
        dayOffset: 3,
      },
      {
        stage: "primary_fermentation",
        type: "note",
        title: "Punch-down",
        details: { body: "Morning and evening punch-downs. Oak chips integrating well." },
        dayOffset: 3,
      },
    ],
  },

  // #11 — Magnotta Malbec (abandoned)
  {
    name: "Magnotta Malbec",
    wine_type: "red",
    source_material: "juice_bucket",
    volume_liters: 23,
    target_volume_liters: 21,
    target_gravity: 0.996,
    yeast_strain: "Lalvin EC-1118",
    oak_type: null,
    oak_format: null,
    oak_duration_days: null,
    mlf_status: "not_planned",
    notes: "Abandoned due to contamination.",
    daysAgo: 30, // started 30 days ago but abandoned after 4 days
    deviceId: "e2e-device-11",
    curve: {
      og: 1.086,
      currentSg: 1.050,
      days: 4, // only 4 days of readings before abandonment
      tempTarget: 24,
      tempVariance: 1.0,
      readingsPerDay: 24,
      style: "red",
    },
    targetStage: "primary_fermentation",
    activities: [
      {
        stage: "primary_fermentation",
        type: "addition",
        title: "Pitched yeast",
        details: { chemical: "Lalvin EC-1118", amount: 5, unit: "g" },
        dayOffset: 0,
      },
      {
        stage: "primary_fermentation",
        type: "note",
        title: "Visible mold on surface — dumping batch",
        details: { body: "White/green mold spotted on must surface. Decided to abandon." },
        dayOffset: 4,
      },
    ],
    abandon: true,
  },
];
