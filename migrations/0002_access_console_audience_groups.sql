CREATE TABLE IF NOT EXISTS pbe_access_audience_groups (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('family', 'event', 'real_estate', 'public', 'custom')),
  gallery_kind TEXT NOT NULL DEFAULT 'event',
  gallery_key TEXT NOT NULL DEFAULT '',
  access_policy TEXT NOT NULL DEFAULT '',
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  fixture INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_pbe_access_audience_groups_kind
  ON pbe_access_audience_groups(kind, label);

CREATE INDEX IF NOT EXISTS idx_pbe_access_audience_groups_gallery
  ON pbe_access_audience_groups(gallery_kind, gallery_key);

CREATE TABLE IF NOT EXISTS pbe_access_group_memberships (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  group_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'revoked')),
  granted_at TEXT NOT NULL,
  granted_by TEXT NOT NULL DEFAULT '',
  revoked_at TEXT,
  revoked_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  UNIQUE(email, group_id)
);

CREATE INDEX IF NOT EXISTS idx_pbe_access_group_memberships_email_state
  ON pbe_access_group_memberships(email, state);

CREATE INDEX IF NOT EXISTS idx_pbe_access_group_memberships_group_state
  ON pbe_access_group_memberships(group_id, state);
