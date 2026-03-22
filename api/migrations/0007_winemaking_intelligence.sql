-- 0007_winemaking_intelligence.sql
-- Add winemaking metadata to batches for intelligence features

ALTER TABLE batches ADD COLUMN yeast_strain TEXT;
ALTER TABLE batches ADD COLUMN oak_type TEXT;
ALTER TABLE batches ADD COLUMN oak_format TEXT;
ALTER TABLE batches ADD COLUMN oak_duration_days INTEGER;
ALTER TABLE batches ADD COLUMN mlf_status TEXT;
ALTER TABLE batches ADD COLUMN bottled_at TEXT;

-- Recreate alert_state without the restrictive CHECK constraint on alert_type.
-- D1 SQLite doesn't support ALTER TABLE DROP CONSTRAINT, so we rebuild.
CREATE TABLE alert_state_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  batch_id TEXT NOT NULL REFERENCES batches(id),
  alert_type TEXT NOT NULL,
  context TEXT,
  fired_at TEXT NOT NULL DEFAULT (datetime('now')),
  dismissed_at TEXT,
  resolved_at TEXT
);

INSERT INTO alert_state_new SELECT * FROM alert_state;
DROP TABLE alert_state;
ALTER TABLE alert_state_new RENAME TO alert_state;

CREATE UNIQUE INDEX idx_alert_one_active ON alert_state (user_id, batch_id, alert_type) WHERE resolved_at IS NULL AND dismissed_at IS NULL;
