CREATE TABLE IF NOT EXISTS pbe_access_real_estate_credentials (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  gallery_key TEXT NOT NULL,
  login_name TEXT NOT NULL,
  normalized_login TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL DEFAULT 210000,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  revoked_at TEXT,
  revoked_by TEXT NOT NULL DEFAULT '',
  UNIQUE(email, gallery_key),
  UNIQUE(normalized_login, gallery_key)
);

CREATE INDEX IF NOT EXISTS idx_pbe_access_re_credentials_lookup
  ON pbe_access_real_estate_credentials(gallery_key, normalized_login, state);

CREATE INDEX IF NOT EXISTS idx_pbe_access_re_credentials_email
  ON pbe_access_real_estate_credentials(email, state);
