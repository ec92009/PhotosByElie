-- Dedicated ACCESS_DB lifecycle deny plane. Sidecar is intentionally not used.
CREATE TABLE pbe_lifecycle_control (
  control_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('ready', 'blocked')),
  fencing_epoch INTEGER NOT NULL DEFAULT 0 CHECK (fencing_epoch >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE pbe_lifecycle_operations (
  operation_id TEXT PRIMARY KEY,
  operation_digest TEXT NOT NULL UNIQUE,
  operation TEXT NOT NULL CHECK (operation IN ('x', 'empty', 'restore', 'tombstone-restore')),
  intended_denied INTEGER NOT NULL CHECK (intended_denied IN (0, 1)),
  revision INTEGER NOT NULL UNIQUE CHECK (revision > 0),
  member_count INTEGER NOT NULL CHECK (member_count > 0),
  state TEXT NOT NULL CHECK (state IN ('planned', 'armed', 'locally_committed', 'deployed_applied', 'locally_acked', 'conflict', 'aborted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE pbe_lifecycle_activations (
  activation_id TEXT PRIMARY KEY,
  activation_digest TEXT NOT NULL UNIQUE,
  digest_algorithm TEXT NOT NULL CHECK (digest_algorithm = 'sha256-chain-v1'),
  expected_media_count INTEGER NOT NULL CHECK (expected_media_count > 0),
  expected_binding_count INTEGER NOT NULL CHECK (expected_binding_count >= expected_media_count),
  expected_row_count INTEGER NOT NULL CHECK (expected_row_count = expected_media_count + expected_binding_count),
  activated_at TEXT NOT NULL
);

CREATE TABLE pbe_lifecycle_seed_batches (
  seed_id TEXT PRIMARY KEY,
  seed_digest TEXT NOT NULL CHECK (length(seed_digest) = 64),
  member_count INTEGER NOT NULL CHECK (member_count > 0),
  created_at TEXT NOT NULL
);

CREATE TABLE pbe_lifecycle_abort_proofs (
  operation_id TEXT PRIMARY KEY,
  operation_digest TEXT NOT NULL,
  proof_kind TEXT NOT NULL,
  proof_digest TEXT NOT NULL,
  proof_json TEXT NOT NULL,
  aborted_at TEXT NOT NULL
);

CREATE TABLE pbe_lifecycle_media_identity (
  canonical_media_id TEXT PRIMARY KEY,
  canonical_asset_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE pbe_lifecycle_media_bindings (
  bucket TEXT NOT NULL,
  object_key TEXT NOT NULL,
  canonical_media_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (bucket, object_key),
  FOREIGN KEY (canonical_media_id) REFERENCES pbe_lifecycle_media_identity(canonical_media_id)
);

CREATE TABLE pbe_lifecycle_projection (
  canonical_media_id TEXT PRIMARY KEY,
  canonical_asset_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  denied INTEGER NOT NULL CHECK (denied IN (0, 1)),
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('visible', 'recoverable', 'tombstoned', 'restored')),
  operation_id TEXT NOT NULL,
  operation_digest TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE pbe_lifecycle_barriers (
  operation_id TEXT NOT NULL,
  operation_digest TEXT NOT NULL,
  canonical_media_id TEXT NOT NULL,
  canonical_asset_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  intended_denied INTEGER NOT NULL CHECK (intended_denied IN (0, 1)),
  armed_at TEXT NOT NULL,
  PRIMARY KEY (operation_id, canonical_media_id),
  UNIQUE (canonical_media_id, revision)
);

CREATE TABLE pbe_lifecycle_receipts (
  receipt_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  operation_digest TEXT NOT NULL,
  canonical_media_id TEXT NOT NULL,
  canonical_asset_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  denied INTEGER NOT NULL CHECK (denied IN (0, 1)),
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('recoverable', 'tombstoned', 'restored')),
  outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'duplicate', 'stale')),
  applied_at TEXT NOT NULL,
  UNIQUE (operation_id, canonical_media_id),
  UNIQUE (canonical_media_id, revision)
);

-- ACCESS_DB is the authoritative paid-fulfillment settlement plane. The KV
-- order remains a delivery projection, while this row supplies the serial
-- ordering point shared with lifecycle barriers.
CREATE TABLE pbe_lifecycle_fulfillment_intents (
  order_id TEXT PRIMARY KEY,
  fence_digest TEXT NOT NULL CHECK (length(fence_digest) = 64),
  member_count INTEGER NOT NULL CHECK (member_count > 0),
  created_at TEXT NOT NULL
);

CREATE TABLE pbe_lifecycle_fulfillment_intent_media (
  order_id TEXT NOT NULL,
  canonical_media_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  receipt_id TEXT NOT NULL,
  PRIMARY KEY (order_id, canonical_media_id),
  FOREIGN KEY (order_id) REFERENCES pbe_lifecycle_fulfillment_intents(order_id),
  FOREIGN KEY (canonical_media_id) REFERENCES pbe_lifecycle_media_identity(canonical_media_id)
);

CREATE TABLE pbe_lifecycle_fulfillments (
  order_id TEXT PRIMARY KEY,
  fence_digest TEXT NOT NULL CHECK (length(fence_digest) = 64),
  state TEXT NOT NULL CHECK (state IN ('ready', 'blocked_pending_lifecycle', 'manual_refund_review')),
  lifecycle_operation_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE pbe_lifecycle_fulfillment_media (
  order_id TEXT NOT NULL,
  canonical_media_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  receipt_id TEXT NOT NULL,
  PRIMARY KEY (order_id, canonical_media_id),
  FOREIGN KEY (order_id) REFERENCES pbe_lifecycle_fulfillments(order_id),
  FOREIGN KEY (canonical_media_id) REFERENCES pbe_lifecycle_media_identity(canonical_media_id)
);

CREATE TABLE pbe_lifecycle_download_capabilities (
  token_digest TEXT PRIMARY KEY CHECK (length(token_digest) = 64),
  order_id TEXT NOT NULL,
  fence_digest TEXT NOT NULL CHECK (length(fence_digest) = 64),
  created_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES pbe_lifecycle_fulfillments(order_id)
);

CREATE TABLE pbe_lifecycle_email_dispatches (
  dispatch_digest TEXT PRIMARY KEY CHECK (length(dispatch_digest) = 64),
  order_id TEXT NOT NULL,
  fence_digest TEXT NOT NULL CHECK (length(fence_digest) = 64),
  state TEXT NOT NULL CHECK (state IN ('claimed', 'sent', 'failed')),
  provider_message_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES pbe_lifecycle_fulfillments(order_id)
);

CREATE INDEX idx_pbe_lifecycle_projection_denied
  ON pbe_lifecycle_projection(denied, canonical_media_id);
CREATE INDEX idx_pbe_lifecycle_barriers_media
  ON pbe_lifecycle_barriers(canonical_media_id, revision);
CREATE INDEX idx_pbe_lifecycle_fulfillment_media
  ON pbe_lifecycle_fulfillment_media(canonical_media_id, order_id);
CREATE INDEX idx_pbe_lifecycle_fulfillment_intent_media
  ON pbe_lifecycle_fulfillment_intent_media(order_id, canonical_media_id);
CREATE INDEX idx_pbe_lifecycle_download_order
  ON pbe_lifecycle_download_capabilities(order_id, token_digest);

INSERT INTO pbe_lifecycle_control
  (control_id, schema_version, state, fencing_epoch, updated_at)
VALUES ('global', 4, 'blocked', 0, datetime('now'));
