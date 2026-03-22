-- API keys for programmatic access (MCP servers, automation)
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,              -- SHA-256 hash of the full key
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,               -- User-provided label
  prefix TEXT NOT NULL,             -- First 8 chars for display (e.g. "wc-a1b2c")
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
