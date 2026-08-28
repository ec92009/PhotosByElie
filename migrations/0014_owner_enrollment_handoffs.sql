-- Short-lived, single-use native Backstage enrollment handoffs.
-- Long-lived device credentials remain in the existing device authority;
-- this table stores only a hash of the native claim secret.
CREATE TABLE pbe_owner_enrollment_handoffs (
  id TEXT PRIMARY KEY CHECK (trim(id) <> ''),
  binding TEXT NOT NULL CHECK (trim(binding) <> ''),
  name TEXT NOT NULL CHECK (trim(name) <> ''),
  platform TEXT NOT NULL CHECK (trim(platform) <> ''),
  state TEXT NOT NULL CHECK (state IN ('pending', 'authorized', 'claimed', 'cancelled')),
  email TEXT NOT NULL DEFAULT '',
  claim_hash TEXT NOT NULL CHECK (length(claim_hash) = 64),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  authorized_at TEXT NOT NULL DEFAULT '',
  claimed_at TEXT NOT NULL DEFAULT '',
  cancelled_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_pbe_owner_enrollment_handoffs_expiry
  ON pbe_owner_enrollment_handoffs(state, expires_at);
