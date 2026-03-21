-- 0006_alerts_and_stages.sql
-- Add target_gravity to batches, push subscriptions, and alert state tables

ALTER TABLE batches ADD COLUMN target_gravity REAL;

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE alert_state (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  batch_id TEXT NOT NULL REFERENCES batches(id),
  alert_type TEXT NOT NULL CHECK (alert_type IN ('stall', 'no_readings', 'temp_high', 'temp_low', 'stage_suggestion')),
  context TEXT,
  fired_at TEXT NOT NULL,
  dismissed_at TEXT,
  resolved_at TEXT
);

CREATE UNIQUE INDEX idx_alert_one_active
  ON alert_state (user_id, batch_id, alert_type)
  WHERE resolved_at IS NULL AND dismissed_at IS NULL;
