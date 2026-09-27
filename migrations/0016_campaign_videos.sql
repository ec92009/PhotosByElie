-- PBE-215: additive immutable derivative declarations, not Owner workflow state.
CREATE TABLE IF NOT EXISTS pbe_campaign_videos (
  slug TEXT PRIMARY KEY,
  queue_id TEXT NOT NULL UNIQUE,
  binding_sha256 TEXT NOT NULL CHECK(length(binding_sha256) = 64),
  binding_json TEXT NOT NULL CHECK(json_valid(binding_json)),
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
