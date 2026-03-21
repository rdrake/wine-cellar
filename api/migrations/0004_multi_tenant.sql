-- 0004_multi_tenant.sql
-- Multi-tenant: add users table, user_id to all data tables
--
-- FK-SAFE ORDER: children rebuilt first (while old parent exists),
-- parent (batches) rebuilt last. defer_foreign_keys prevents
-- intermediate constraint violations during the swap.

PRAGMA defer_foreign_keys = ON;

-- 1. Create users table
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Seed owner account (existing single-tenant data becomes this user's)
INSERT INTO users (id, email, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'rdrake@pobox.com', 'Richard');

-- 3. Add user_id to devices FIRST (ALTER, nullable for unclaimed)
ALTER TABLE devices ADD COLUMN user_id TEXT REFERENCES users(id);
UPDATE devices SET user_id = '00000000-0000-0000-0000-000000000001';
CREATE INDEX idx_devices_user ON devices(user_id);

-- 4. Add user_id to readings (ALTER, nullable for unclaimed)
ALTER TABLE readings ADD COLUMN user_id TEXT REFERENCES users(id);
UPDATE readings SET user_id = '00000000-0000-0000-0000-000000000001';
CREATE INDEX idx_readings_user ON readings(user_id, source_timestamp DESC);

-- 5. Rebuild activities with user_id NOT NULL
-- (old batches table still exists as parent, readings still exists for reading_id FK)
CREATE TABLE activities_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  batch_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN (
    'receiving', 'crushing', 'must_prep',
    'primary_fermentation', 'pressing',
    'secondary_fermentation', 'malolactic',
    'stabilization', 'fining', 'bulk_aging', 'cold_stabilization', 'filtering',
    'bottling', 'bottle_aging'
  )),
  type TEXT NOT NULL CHECK (type IN ('addition', 'racking', 'measurement', 'tasting', 'note', 'adjustment')),
  title TEXT NOT NULL,
  details TEXT,
  reading_id TEXT REFERENCES readings(id) ON DELETE SET NULL,
  recorded_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO activities_new (id, user_id, batch_id, stage, type, title, details, reading_id, recorded_at, created_at, updated_at)
  SELECT id, '00000000-0000-0000-0000-000000000001', batch_id, stage, type, title, details, reading_id, recorded_at, created_at, updated_at
  FROM activities;

DROP TABLE activities;
ALTER TABLE activities_new RENAME TO activities;
CREATE INDEX idx_activities_batch_recorded ON activities(batch_id, recorded_at);
CREATE INDEX idx_activities_user ON activities(user_id);

-- 6. Rebuild batches LAST (children are already rebuilt/altered, safe to drop)
CREATE TABLE batches_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  wine_type TEXT NOT NULL CHECK (wine_type IN ('red', 'white', 'rosé', 'orange', 'sparkling', 'dessert')),
  source_material TEXT NOT NULL CHECK (source_material IN ('kit', 'juice_bucket', 'fresh_grapes')),
  stage TEXT NOT NULL DEFAULT 'must_prep' CHECK (stage IN ('must_prep', 'primary_fermentation', 'secondary_fermentation', 'stabilization', 'bottling')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived', 'abandoned')),
  volume_liters REAL,
  target_volume_liters REAL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO batches_new (id, user_id, name, wine_type, source_material, stage, status, volume_liters, target_volume_liters, started_at, completed_at, notes, created_at, updated_at)
  SELECT id, '00000000-0000-0000-0000-000000000001', name, wine_type, source_material, stage, status, volume_liters, target_volume_liters, started_at, completed_at, notes, created_at, updated_at
  FROM batches;

DROP TABLE batches;
ALTER TABLE batches_new RENAME TO batches;
CREATE INDEX idx_batches_user ON batches(user_id);

-- 7. Re-add FK from activities to batches now that batches is rebuilt
-- (SQLite doesn't support ALTER TABLE ADD CONSTRAINT, so we rebuild activities
--  one more time with the proper FK to the new batches table.)
CREATE TABLE activities_final (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN (
    'receiving', 'crushing', 'must_prep',
    'primary_fermentation', 'pressing',
    'secondary_fermentation', 'malolactic',
    'stabilization', 'fining', 'bulk_aging', 'cold_stabilization', 'filtering',
    'bottling', 'bottle_aging'
  )),
  type TEXT NOT NULL CHECK (type IN ('addition', 'racking', 'measurement', 'tasting', 'note', 'adjustment')),
  title TEXT NOT NULL,
  details TEXT,
  reading_id TEXT REFERENCES readings(id) ON DELETE SET NULL,
  recorded_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO activities_final SELECT * FROM activities;
DROP TABLE activities;
ALTER TABLE activities_final RENAME TO activities;
CREATE INDEX idx_activities_batch_recorded ON activities(batch_id, recorded_at);
CREATE INDEX idx_activities_user ON activities(user_id);
