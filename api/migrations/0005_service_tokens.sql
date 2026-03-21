-- 0005_service_tokens.sql
-- Maps Cloudflare Access service token client IDs to existing users

CREATE TABLE service_tokens (
  client_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
