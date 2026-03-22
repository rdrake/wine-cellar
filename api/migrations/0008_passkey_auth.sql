-- Passkey credentials
CREATE TABLE passkey_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  public_key BLOB NOT NULL,
  webauthn_user_id TEXT NOT NULL,
  sign_count INTEGER DEFAULT 0,
  transports TEXT,
  device_type TEXT,
  backed_up INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE INDEX idx_passkey_credentials_user ON passkey_credentials(user_id);

-- Auth challenges (single-use, 5-minute TTL)
CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('bootstrap', 'login', 'register')),
  user_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Auth sessions (hashed tokens)
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_expires ON auth_sessions(expires_at);
CREATE INDEX idx_auth_challenges_expires ON auth_challenges(expires_at);
