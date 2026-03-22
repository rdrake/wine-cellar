-- 0012_alert_type_check.sql
-- Add CHECK constraint on alert_type to match all types used in code.
-- Migration 0007 removed the original restrictive CHECK; this re-adds it
-- with the full set of 11 alert types.

CREATE TABLE alert_state_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  batch_id TEXT NOT NULL REFERENCES batches(id),
  alert_type TEXT NOT NULL CHECK (alert_type IN (
    'stall', 'no_readings', 'temp_high', 'temp_low', 'stage_suggestion',
    'racking_due_1', 'racking_due_2', 'racking_due_3',
    'mlf_check', 'bottling_ready', 'so2_due'
  )),
  context TEXT,
  fired_at TEXT NOT NULL DEFAULT (datetime('now')),
  dismissed_at TEXT,
  resolved_at TEXT
);

INSERT INTO alert_state_new SELECT * FROM alert_state;
DROP TABLE alert_state;
ALTER TABLE alert_state_new RENAME TO alert_state;

CREATE UNIQUE INDEX idx_alert_one_active
  ON alert_state (user_id, batch_id, alert_type)
  WHERE resolved_at IS NULL AND dismissed_at IS NULL;
