ALTER TABLE pbe_access_audience_groups
  ADD COLUMN state TEXT NOT NULL DEFAULT 'active';

ALTER TABLE pbe_access_audience_groups
  ADD COLUMN archived_at TEXT;

ALTER TABLE pbe_access_audience_groups
  ADD COLUMN archived_by TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_pbe_access_audience_groups_state_kind
  ON pbe_access_audience_groups(state, kind, label);
