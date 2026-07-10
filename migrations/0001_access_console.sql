CREATE TABLE IF NOT EXISTS pbe_access_people (
  email TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  fixture INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  disabled_at TEXT,
  disabled_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS pbe_access_role_grants (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner', 're_client')),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'revoked')),
  granted_at TEXT NOT NULL,
  granted_by TEXT NOT NULL DEFAULT '',
  revoked_at TEXT,
  revoked_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  UNIQUE(email, role)
);

CREATE INDEX IF NOT EXISTS idx_pbe_access_role_grants_email_state
  ON pbe_access_role_grants(email, state);

CREATE TABLE IF NOT EXISTS pbe_access_gallery_grants (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  gallery_kind TEXT NOT NULL DEFAULT 'real_estate',
  gallery_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'revoked')),
  granted_at TEXT NOT NULL,
  granted_by TEXT NOT NULL DEFAULT '',
  revoked_at TEXT,
  revoked_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  UNIQUE(email, gallery_kind, gallery_key)
);

CREATE INDEX IF NOT EXISTS idx_pbe_access_gallery_grants_email_kind_state
  ON pbe_access_gallery_grants(email, gallery_kind, state);

CREATE TABLE IF NOT EXISTS pbe_access_fixture_events (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  access_policy TEXT NOT NULL DEFAULT '',
  fixture INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS pbe_access_audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor_email TEXT NOT NULL DEFAULT '',
  target_email TEXT NOT NULL DEFAULT '',
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pbe_access_audit_events_created_at
  ON pbe_access_audit_events(created_at DESC);
