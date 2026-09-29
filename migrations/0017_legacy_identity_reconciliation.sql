-- Audited correction of legacy self-ID mappings only. No media/key reassignment.
CREATE TABLE pbe_lifecycle_identity_reconciliations (
  repair_id TEXT PRIMARY KEY CHECK (trim(repair_id) <> ''),
  request_digest TEXT NOT NULL CHECK (length(request_digest) = 64),
  actor_id TEXT NOT NULL CHECK (trim(actor_id) <> ''),
  envelope_json TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
