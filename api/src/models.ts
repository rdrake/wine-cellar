import { z } from "zod";
import {
  WINE_TYPES,
  SOURCE_MATERIALS,
  BATCH_STATUSES,
  ALL_STAGES,
  BATCH_STAGES,
  ACTIVITY_TYPES,
} from "./schema";

// --- Request Schemas ---

export const BatchCreateSchema = z.object({
  name: z.string().min(1),
  wine_type: z.enum(WINE_TYPES),
  source_material: z.enum(SOURCE_MATERIALS),
  started_at: z.string(),
  volume_liters: z.number().nullable().optional(),
  target_volume_liters: z.number().nullable().optional(),
  target_gravity: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type BatchCreate = z.infer<typeof BatchCreateSchema>;

export const BatchUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  volume_liters: z.number().nullable().optional(),
  target_volume_liters: z.number().nullable().optional(),
  target_gravity: z.number().nullable().optional(),
  status: z.enum(BATCH_STATUSES).optional(),
});
export type BatchUpdate = z.infer<typeof BatchUpdateSchema>;

export const ActivityCreateSchema = z.object({
  stage: z.enum(ALL_STAGES),
  type: z.enum(ACTIVITY_TYPES),
  title: z.string().min(1),
  details: z.record(z.unknown()).nullable().default(null),
  recorded_at: z.string(),
});
export type ActivityCreate = z.infer<typeof ActivityCreateSchema>;

export const ActivityUpdateSchema = z.object({
  title: z.string().min(1).optional(),
  details: z.record(z.unknown()).nullable().optional(),
  recorded_at: z.string().optional(),
});
export type ActivityUpdate = z.infer<typeof ActivityUpdateSchema>;

export const StageSetSchema = z.object({
  stage: z.enum(BATCH_STAGES),
});

export const DeviceCreateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type DeviceCreate = z.infer<typeof DeviceCreateSchema>;

export const DeviceAssignSchema = z.object({
  batch_id: z.string().min(1),
});
export type DeviceAssign = z.infer<typeof DeviceAssignSchema>;

export const RaptWebhookSchema = z.object({
  device_id: z.string(),
  device_name: z.string(),
  temperature: z.number(),
  gravity: z.number(),
  battery: z.number(),
  rssi: z.number(),
  created_date: z.string(),
});
export type RaptWebhookPayload = z.infer<typeof RaptWebhookSchema>;
