ALTER TABLE pbe_access_audit_events
  ADD COLUMN target_type TEXT NOT NULL DEFAULT '';

ALTER TABLE pbe_access_audit_events
  ADD COLUMN target_id TEXT NOT NULL DEFAULT '';

ALTER TABLE pbe_access_audit_events
  ADD COLUMN action TEXT NOT NULL DEFAULT '';

ALTER TABLE pbe_access_audit_events
  ADD COLUMN summary TEXT NOT NULL DEFAULT '';

ALTER TABLE pbe_access_audit_events
  ADD COLUMN reversible INTEGER NOT NULL DEFAULT 0;

ALTER TABLE pbe_access_audit_events
  ADD COLUMN reverted_at TEXT;

ALTER TABLE pbe_access_audit_events
  ADD COLUMN reverted_by TEXT NOT NULL DEFAULT '';

ALTER TABLE pbe_access_audit_events
  ADD COLUMN reverted_event_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_pbe_access_audit_events_target
  ON pbe_access_audit_events(target_type, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pbe_access_audit_events_reversible
  ON pbe_access_audit_events(reversible, reverted_at, created_at DESC);
