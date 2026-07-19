ALTER TABLE pbe_access_fixture_events
  ADD COLUMN parent_id TEXT NOT NULL DEFAULT '';

ALTER TABLE pbe_access_fixture_events
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'inherit';

ALTER TABLE pbe_access_fixture_events
  ADD COLUMN gallery_key TEXT NOT NULL DEFAULT '';

ALTER TABLE pbe_access_fixture_events
  ADD COLUMN group_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_pbe_access_fixture_events_parent
  ON pbe_access_fixture_events(parent_id, label);
