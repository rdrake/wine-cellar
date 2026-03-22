-- 0013_add_missing_indexes.sql
-- Add missing indexes for common query patterns

-- For device readings queries (webhook ingestion, device readings list)
CREATE INDEX IF NOT EXISTS idx_readings_device_id ON readings(device_id);

-- For filtered batch listing by stage
CREATE INDEX IF NOT EXISTS idx_batches_user_stage ON batches(user_id, stage);

-- For status-filtered batch listing (e.g. dashboard active batches)
CREATE INDEX IF NOT EXISTS idx_batches_user_status ON batches(user_id, status);

-- For wine type filtering
CREATE INDEX IF NOT EXISTS idx_batches_user_wine_type ON batches(user_id, wine_type);
