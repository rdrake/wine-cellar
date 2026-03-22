// db-types.ts — Typed interfaces for D1 query result rows.
// Keep in sync with migrations in api/migrations/.

import type { BatchStage, BatchStatus, WineType, SourceMaterial, AllStage, ActivityType, MlfStatus, OakType, OakFormat } from "./schema";

/** Full batches table row */
export interface BatchRow {
  id: string;
  user_id: string;
  name: string;
  wine_type: WineType;
  source_material: SourceMaterial;
  stage: BatchStage;
  status: BatchStatus;
  volume_liters: number | null;
  target_volume_liters: number | null;
  target_gravity: number | null;
  yeast_strain: string | null;
  oak_type: OakType | null;
  oak_format: OakFormat | null;
  oak_duration_days: number | null;
  mlf_status: MlfStatus | null;
  started_at: string;
  completed_at: string | null;
  bottled_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Full activities table row */
export interface ActivityRow {
  id: string;
  user_id: string;
  batch_id: string;
  stage: AllStage;
  type: ActivityType;
  title: string;
  details: string | null; // JSON string in DB, parsed to object in API responses
  recorded_at: string;
  created_at: string;
  updated_at: string;
  reading_id: string | null;
}

/** Full readings table row */
export interface ReadingRow {
  id: string;
  batch_id: string | null;
  device_id: string;
  gravity: number;
  temperature: number | null;
  battery: number | null;
  rssi: number | null;
  source_timestamp: string;
  created_at: string;
  source: string | null;
  user_id: string | null;
}

/** Subset of reading columns used for alert evaluation */
export interface ReadingSummaryRow {
  gravity: number;
  temperature: number | null;
  source_timestamp: string;
}

/** Full devices table row */
export interface DeviceRow {
  id: string;
  name: string;
  user_id: string | null;
  batch_id: string | null;
  assigned_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Partial device row for batch assignment check */
export interface DeviceBatchRow {
  batch_id: string | null;
  user_id: string | null;
}

/** Partial device row for existence check */
export interface DeviceIdRow {
  id: string;
}

/** Alert state row (id only, for existence checks) */
export interface AlertIdRow {
  id: string;
}

/** Active alert row from alert_state JOIN batches */
export interface ActiveAlertRow {
  id: string;
  user_id: string;
  batch_id: string;
  alert_type: string;
  context: string | null;
  fired_at: string;
  batch_name: string;
}

/** Batch name row (partial) */
export interface BatchNameRow {
  name: string;
}

/** Batch row for alert context (partial) */
export interface BatchAlertRow {
  stage: string;
  target_gravity: number | null;
  wine_type: string | null;
}

/** Cron batch row — fields needed for evaluateAllBatches */
export interface CronBatchRow {
  id: string;
  user_id: string;
  name: string;
  stage: string;
  target_gravity: number | null;
  started_at: string;
  wine_type: string | null;
  source_material: string | null;
  mlf_status: string | null;
}

/** Aggregate count + last_at row from activity queries */
export interface CountLastAtRow {
  count: number;
  last_at: string | null;
}

/** Single recorded_at row */
export interface RecordedAtRow {
  recorded_at: string;
}

/** Batch existence check row (has_activities, has_readings) */
export interface BatchDependencyCheckRow {
  has_activities: number;
  has_readings: number;
}

/** pH measurement value from activities JSON */
export interface PhValueRow {
  value: string | null;
}

/** Gravity-only reading row */
export interface GravityRow {
  gravity: number;
}
