-- New tables
CREATE TABLE oauth_accounts (
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  email TEXT,
  name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, provider_user_id)
);
CREATE INDEX idx_oauth_accounts_user ON oauth_accounts(user_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO settings (key, value) VALUES ('registrations_open', 'true');

-- Add columns to users
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN onboarded INTEGER NOT NULL DEFAULT 0;

-- Update existing user as onboarded (they were already using the app)
UPDATE users SET onboarded = 1;

-- Rebuild auth_challenges with updated CHECK constraint
DELETE FROM auth_challenges;
DROP TABLE auth_challenges;
CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('oauth', 'login', 'register')),
  user_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_auth_challenges_expires ON auth_challenges(expires_at);

-- Remove CF Access service tokens (dead after CF Access removal)
DROP TABLE IF EXISTS service_tokens;
