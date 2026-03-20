-- Add source column to readings to distinguish device vs manual entries
ALTER TABLE readings ADD COLUMN source TEXT NOT NULL DEFAULT 'device';

-- Manual readings have nullable temperature/battery/rssi
-- D1 doesn't enforce NOT NULL on existing columns retroactively,
-- but new manual inserts will pass NULL for these fields.
