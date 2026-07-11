CREATE TABLE IF NOT EXISTS pbe_sidecar_decisions (
  asset_id TEXT PRIMARY KEY,
  rating INTEGER NOT NULL DEFAULT 0 CHECK(rating BETWEEN 0 AND 5),
  color TEXT NOT NULL DEFAULT '' CHECK(color IN ('', 'red', 'yellow', 'green', 'blue', 'purple')),
  pick_state TEXT NOT NULL DEFAULT 'undecided' CHECK(pick_state IN ('undecided', 'picked', 'rejected', 'hidden')),
  metadata_state TEXT NOT NULL DEFAULT 'unreviewed' CHECK(metadata_state IN ('unreviewed', 'proposed', 'approved', 'rework', 'blocked')),
  title TEXT NOT NULL DEFAULT '',
  keywords_json TEXT NOT NULL DEFAULT '[]',
  rework_category TEXT NOT NULL DEFAULT '',
  rework_comment TEXT NOT NULL DEFAULT '',
  metadata_ai_rung TEXT NOT NULL DEFAULT '',
  metadata_ai_evidence_json TEXT NOT NULL DEFAULT '[]',
  metadata_ai_note TEXT NOT NULL DEFAULT '',
  tombstone_state TEXT NOT NULL DEFAULT '',
  tombstone_reason TEXT NOT NULL DEFAULT '',
  tombstoned_at TEXT NOT NULL DEFAULT '',
  pending_sync_count INTEGER NOT NULL DEFAULT 0,
  last_action TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pbe_sidecar_decisions_pick
  ON pbe_sidecar_decisions(pick_state, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_pbe_sidecar_decisions_metadata
  ON pbe_sidecar_decisions(metadata_state, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_pbe_sidecar_decisions_tombstone
  ON pbe_sidecar_decisions(tombstone_state, updated_at DESC);

CREATE TABLE IF NOT EXISTS pbe_sidecar_decision_events (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT '',
  changed_families_json TEXT NOT NULL DEFAULT '[]',
  actor_kind TEXT NOT NULL DEFAULT '',
  actor_id TEXT NOT NULL DEFAULT '',
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pbe_sidecar_decision_events_asset
  ON pbe_sidecar_decision_events(asset_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pbe_sidecar_decision_events_created
  ON pbe_sidecar_decision_events(created_at DESC);
