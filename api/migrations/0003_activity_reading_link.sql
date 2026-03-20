-- Link activities to their generated manual readings for reliable update/delete
ALTER TABLE activities ADD COLUMN reading_id TEXT REFERENCES readings(id) ON DELETE SET NULL;
