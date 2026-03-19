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

export const WAYPOINT_ALLOWED_STAGES: Record<BatchStage, readonly AllStage[]> = {
  must_prep: ["receiving", "crushing", "must_prep"],
  primary_fermentation: ["primary_fermentation", "pressing"],
  secondary_fermentation: ["secondary_fermentation", "malolactic"],
  stabilization: ["stabilization", "fining", "bulk_aging", "cold_stabilization", "filtering"],
  bottling: ["bottling", "bottle_aging"],
};

export const WAYPOINT_ORDER: readonly BatchStage[] = BATCH_STAGES;
