-- Audited, extend-only repair of an already activated lifecycle manifest.
-- The repair route verifies the previous activation and the complete resulting
-- digest before changing the durable manifest. Existing identities/bindings
-- are never rewritten or removed.
CREATE TABLE pbe_lifecycle_manifest_reconciliations (
  repair_id TEXT PRIMARY KEY CHECK (trim(repair_id) <> ''),
  repair_digest TEXT NOT NULL UNIQUE CHECK (length(repair_digest) = 64),
  actor_id TEXT NOT NULL CHECK (trim(actor_id) <> ''),
  previous_fencing_epoch INTEGER NOT NULL CHECK (previous_fencing_epoch >= 0),
  new_fencing_epoch INTEGER NOT NULL CHECK (new_fencing_epoch > previous_fencing_epoch),
  previous_activation_id TEXT NOT NULL CHECK (trim(previous_activation_id) <> ''),
  previous_activation_digest TEXT NOT NULL CHECK (length(previous_activation_digest) = 64),
  previous_media_count INTEGER NOT NULL CHECK (previous_media_count > 0),
  previous_binding_count INTEGER NOT NULL CHECK (previous_binding_count >= previous_media_count),
  activation_id TEXT NOT NULL UNIQUE CHECK (trim(activation_id) <> ''),
  activation_digest TEXT NOT NULL UNIQUE CHECK (length(activation_digest) = 64),
  media_count INTEGER NOT NULL CHECK (media_count > 0),
  binding_count INTEGER NOT NULL CHECK (binding_count >= media_count),
  added_media_count INTEGER NOT NULL CHECK (added_media_count > 0),
  added_binding_count INTEGER NOT NULL CHECK (added_binding_count >= added_media_count),
  seed_id TEXT NOT NULL UNIQUE CHECK (trim(seed_id) <> ''),
  seed_digest TEXT NOT NULL CHECK (length(seed_digest) = 64),
  state TEXT NOT NULL CHECK (state = 'applied'),
  created_at TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE INDEX idx_pbe_lifecycle_manifest_reconciliations_activation
  ON pbe_lifecycle_manifest_reconciliations(activation_id, activation_digest);
