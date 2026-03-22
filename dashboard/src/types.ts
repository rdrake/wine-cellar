export type WineType = "red" | "white" | "rosé" | "orange" | "sparkling" | "dessert";
export type SourceMaterial = "kit" | "juice_bucket" | "fresh_grapes";

export type BatchStage =
  | "must_prep"
  | "primary_fermentation"
  | "secondary_fermentation"
  | "stabilization"
  | "bottling";

export type BatchStatus = "active" | "completed" | "archived" | "abandoned";

export type AllStage =
  | "receiving" | "crushing" | "must_prep"
  | "primary_fermentation" | "pressing"
  | "secondary_fermentation" | "malolactic"
  | "stabilization" | "fining" | "bulk_aging" | "cold_stabilization" | "filtering"
  | "bottling" | "bottle_aging";

export type ActivityType = "addition" | "racking" | "measurement" | "tasting" | "note" | "adjustment";

export interface Batch {
  id: string;
  name: string;
  wine_type: WineType;
  source_material: SourceMaterial;
  stage: BatchStage;
  status: BatchStatus;
  volume_liters: number | null;
  target_volume_liters: number | null;
  target_gravity: number | null;
  yeast_strain: string | null;
  oak_type: string | null;
  oak_format: string | null;
  oak_duration_days: number | null;
  mlf_status: string | null;
  bottled_at: string | null;
  started_at: string;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  nudges?: Nudge[];
  timeline?: Milestone[];
}

export interface Activity {
  id: string;
  batch_id: string;
  stage: AllStage;
  type: ActivityType;
  title: string;
  details: Record<string, unknown> | null;
  recorded_at: string;
  created_at: string;
  updated_at: string;
}

export interface Reading {
  id: string;
  batch_id: string | null;
  device_id: string;
  gravity: number;
  temperature: number | null;
  battery: number | null;
  rssi: number | null;
  source_timestamp: string;
  source: "device" | "manual";
  created_at: string;
}

export interface Device {
  id: string;
  name: string;
  batch_id: string | null;
  assigned_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListResponse<T> {
  items: T[];
}

export interface PaginatedResponse<T> {
  items: T[];
  next_cursor: string | null;
}

export interface BatchSummary extends Batch {
  first_reading: {
    gravity: number;
    temperature: number | null;
    source_timestamp: string;
  } | null;
  latest_reading: {
    gravity: number;
    temperature: number | null;
    source_timestamp: string;
  } | null;
  velocity: number | null;
  days_fermenting: number;
  sparkline: { g: number; temp: number | null; t: string }[];
}

export interface DashboardResponse {
  active_batches: BatchSummary[];
  recent_activities: (Activity & { batch_name: string })[];
  alerts: Alert[];
}

export interface Alert {
  id: string;
  batch_id: string;
  batch_name: string;
  alert_type: string;
  context: string | null;
  fired_at: string;
}

export interface Nudge {
  id: string;
  priority: "info" | "warning" | "action";
  message: string;
  detail?: string;
  stage: string;
}

export interface Milestone {
  label: string;
  estimated_date: string;
  basis: string;
  confidence: "firm" | "estimated" | "rough";
  completed?: boolean;
}

export interface BatchCreate {
  name: string;
  wine_type: WineType;
  source_material: SourceMaterial;
  started_at: string;
  volume_liters?: number | null;
  target_volume_liters?: number | null;
  target_gravity?: number | null;
  yeast_strain?: string | null;
  oak_type?: string | null;
  oak_format?: string | null;
  oak_duration_days?: number | null;
  mlf_status?: string | null;
  notes?: string | null;
}

export interface BatchUpdate {
  name?: string;
  notes?: string | null;
  volume_liters?: number | null;
  target_volume_liters?: number | null;
  target_gravity?: number | null;
  yeast_strain?: string | null;
  oak_type?: string | null;
  oak_format?: string | null;
  oak_duration_days?: number | null;
  mlf_status?: string | null;
  status?: BatchStatus;
}

export interface ActivityCreate {
  stage: AllStage;
  type: ActivityType;
  title: string;
  details?: Record<string, unknown> | null;
  recorded_at: string;
}

export interface ActivityUpdate {
  title?: string;
  details?: Record<string, unknown> | null;
  recorded_at?: string;
}

// Allowed activity stages per batch waypoint
export const WAYPOINT_ALLOWED_STAGES: Record<BatchStage, AllStage[]> = {
  must_prep: ["receiving", "crushing", "must_prep"],
  primary_fermentation: ["primary_fermentation", "pressing"],
  secondary_fermentation: ["secondary_fermentation", "malolactic"],
  stabilization: ["stabilization", "fining", "bulk_aging", "cold_stabilization", "filtering"],
  bottling: ["bottling", "bottle_aging"],
};

// Display labels
export const STAGE_LABELS: Record<AllStage, string> = {
  receiving: "Receiving & Inspection",
  crushing: "Crushing & Destemming",
  must_prep: "Must Preparation",
  primary_fermentation: "Primary Fermentation",
  pressing: "Pressing",
  secondary_fermentation: "Secondary Fermentation",
  malolactic: "Malolactic Fermentation",
  stabilization: "Stabilization & Degassing",
  fining: "Fining & Clarification",
  bulk_aging: "Bulk Aging",
  cold_stabilization: "Cold Stabilization",
  filtering: "Filtering",
  bottling: "Bottling",
  bottle_aging: "Bottle Aging",
};

export const WINE_TYPE_LABELS: Record<WineType, string> = {
  red: "Red",
  white: "White",
  "rosé": "Rosé",
  orange: "Orange",
  sparkling: "Sparkling",
  dessert: "Dessert",
};

export const SOURCE_MATERIAL_LABELS: Record<SourceMaterial, string> = {
  kit: "Kit",
  juice_bucket: "Juice Bucket",
  fresh_grapes: "Fresh Grapes",
};

export const STATUS_LABELS: Record<BatchStatus, string> = {
  active: "Active",
  completed: "Completed",
  archived: "Archived",
  abandoned: "Abandoned",
};

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  addition: "Addition",
  racking: "Racking",
  measurement: "Measurement",
  tasting: "Tasting",
  note: "Note",
  adjustment: "Adjustment",
};

export const OAK_TYPE_LABELS: Record<string, string> = {
  none: "None",
  american: "American",
  french: "French",
  hungarian: "Hungarian",
};

export const OAK_FORMAT_LABELS: Record<string, string> = {
  barrel: "Barrel",
  chips: "Chips",
  cubes: "Cubes",
  staves: "Staves",
  spiral: "Spiral",
};

export const MLF_STATUS_LABELS: Record<string, string> = {
  not_planned: "Not Planned",
  pending: "Pending",
  in_progress: "In Progress",
  complete: "Complete",
};
