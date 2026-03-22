import { z } from "zod";
import {
  WINE_TYPES,
  SOURCE_MATERIALS,
  BATCH_STATUSES,
  ALL_STAGES,
  BATCH_STAGES,
  ACTIVITY_TYPES,
  OAK_TYPES,
  OAK_FORMATS,
  MLF_STATUSES,
} from "./schema";

// --- Request Schemas ---

export const BatchCreateSchema = z.object({
  name: z.string().min(1).max(200),
  wine_type: z.enum(WINE_TYPES),
  source_material: z.enum(SOURCE_MATERIALS),
  started_at: z.string().max(100),
  volume_liters: z.number().min(0).max(100000).nullable().optional(),
  target_volume_liters: z.number().min(0).max(100000).nullable().optional(),
  target_gravity: z.number().min(0.900).max(1.200).nullable().optional(),
  yeast_strain: z.string().max(200).nullable().optional(),
  oak_type: z.enum(OAK_TYPES).nullable().optional(),
  oak_format: z.enum(OAK_FORMATS).nullable().optional(),
  oak_duration_days: z.number().int().min(0).max(3650).nullable().optional(),
  mlf_status: z.enum(MLF_STATUSES).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
});
export type BatchCreate = z.infer<typeof BatchCreateSchema>;

export const BatchUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  notes: z.string().max(5000).nullable().optional(),
  volume_liters: z.number().min(0).max(100000).nullable().optional(),
  target_volume_liters: z.number().min(0).max(100000).nullable().optional(),
  target_gravity: z.number().min(0.900).max(1.200).nullable().optional(),
  yeast_strain: z.string().max(200).nullable().optional(),
  oak_type: z.enum(OAK_TYPES).nullable().optional(),
  oak_format: z.enum(OAK_FORMATS).nullable().optional(),
  oak_duration_days: z.number().int().min(0).max(3650).nullable().optional(),
  mlf_status: z.enum(MLF_STATUSES).nullable().optional(),
  status: z.enum(BATCH_STATUSES).optional(),
});
export type BatchUpdate = z.infer<typeof BatchUpdateSchema>;

export const ActivityCreateSchema = z.object({
  stage: z.enum(ALL_STAGES),
  type: z.enum(ACTIVITY_TYPES),
  title: z.string().min(1).max(200),
  details: z.record(z.string(), z.unknown()).nullable().default(null),
  recorded_at: z.string().max(100),
});
export type ActivityCreate = z.infer<typeof ActivityCreateSchema>;

export const ActivityUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  details: z.record(z.string(), z.unknown()).nullable().optional(),
  recorded_at: z.string().max(100).optional(),
});
export type ActivityUpdate = z.infer<typeof ActivityUpdateSchema>;

export const StageSetSchema = z.object({
  stage: z.enum(BATCH_STAGES),
});

export const DeviceCreateSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
});
export type DeviceCreate = z.infer<typeof DeviceCreateSchema>;

export const DeviceAssignSchema = z.object({
  batch_id: z.string().min(1).max(100),
});
export type DeviceAssign = z.infer<typeof DeviceAssignSchema>;

export const RaptWebhookSchema = z.object({
  device_id: z.string().max(100),
  device_name: z.string().max(200),
  temperature: z.number().min(-20).max(60),
  gravity: z.number().min(0.900).max(1.200),
  battery: z.number().min(0).max(100),
  rssi: z.number().min(-200).max(0),
  created_date: z.string().max(100),
});
export type RaptWebhookPayload = z.infer<typeof RaptWebhookSchema>;
