export const WINE_TYPES = ["red", "white", "rosé", "orange", "sparkling", "dessert"] as const;
export type WineType = (typeof WINE_TYPES)[number];

export const SOURCE_MATERIALS = ["kit", "juice_bucket", "fresh_grapes"] as const;
export type SourceMaterial = (typeof SOURCE_MATERIALS)[number];

export const BATCH_STAGES = [
  "must_prep",
  "primary_fermentation",
  "secondary_fermentation",
  "stabilization",
  "bottling",
] as const;
export type BatchStage = (typeof BATCH_STAGES)[number];

export const ALL_STAGES = [
  "receiving", "crushing", "must_prep",
  "primary_fermentation", "pressing",
  "secondary_fermentation", "malolactic",
  "stabilization", "fining", "bulk_aging", "cold_stabilization", "filtering",
  "bottling", "bottle_aging",
] as const;
export type AllStage = (typeof ALL_STAGES)[number];

export const BATCH_STATUSES = ["active", "completed", "archived", "abandoned"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const ACTIVITY_TYPES = ["addition", "racking", "measurement", "tasting", "note", "adjustment"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const OAK_TYPES = ["none", "american", "french", "hungarian"] as const;
export type OakType = (typeof OAK_TYPES)[number];

export const OAK_FORMATS = ["barrel", "chips", "cubes", "staves", "spiral"] as const;
export type OakFormat = (typeof OAK_FORMATS)[number];

export const MLF_STATUSES = ["not_planned", "pending", "in_progress", "complete"] as const;
export type MlfStatus = (typeof MLF_STATUSES)[number];

export const WAYPOINT_ALLOWED_STAGES: Record<BatchStage, readonly AllStage[]> = {
  must_prep: ["receiving", "crushing", "must_prep"],
  primary_fermentation: ["primary_fermentation", "pressing"],
  secondary_fermentation: ["secondary_fermentation", "malolactic"],
  stabilization: ["stabilization", "fining", "bulk_aging", "cold_stabilization", "filtering"],
  bottling: ["bottling", "bottle_aging"],
};

export const SO2_CHEMICALS = ["K2S2O5", "SO2", "Campden", "K-meta", "Potassium metabisulfite"] as const;
export const MLF_CULTURES = ["MLB", "Leuconostoc", "CH16", "VP41", "malolactic"] as const;

export const WAYPOINT_ORDER: readonly BatchStage[] = BATCH_STAGES;
