-- Batches table
CREATE TABLE batches (
    id TEXT PRIMARY KEY,
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

-- Activities table
CREATE TABLE activities (
    id TEXT PRIMARY KEY,
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
    details TEXT,  -- JSON stored as TEXT
    recorded_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_activities_batch_recorded ON activities(batch_id, recorded_at);

-- Readings table
CREATE TABLE readings (
    id TEXT PRIMARY KEY,
    batch_id TEXT REFERENCES batches(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    gravity REAL NOT NULL,
    temperature REAL NOT NULL,
    battery REAL NOT NULL,
    rssi REAL NOT NULL,
    source_timestamp TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_readings_dedupe ON readings(device_id, source_timestamp);
CREATE INDEX idx_readings_batch_pagination ON readings(batch_id, source_timestamp DESC, id DESC);

-- Devices table
CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    batch_id TEXT REFERENCES batches(id) ON DELETE SET NULL,
    assigned_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_devices_batch ON devices(batch_id);

-- Note: PRAGMA foreign_keys = ON is per-connection and has no effect in D1.
-- It is set in the Database class for local SQLite testing only.
