-- PBE-215: additive immutable derivative declarations, not Owner workflow state.
CREATE TABLE IF NOT EXISTS pbe_campaign_videos (
  slug TEXT PRIMARY KEY,
  queue_id TEXT NOT NULL UNIQUE,
  binding_sha256 TEXT NOT NULL CHECK(length(binding_sha256) = 64),
  binding_json TEXT NOT NULL CHECK(json_valid(binding_json)),
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- The enrolled catalog publisher invalidates eligibility before changing Owner's
-- projection, and verifies the exact public bytes before committing a revision.
CREATE TABLE IF NOT EXISTS pbe_public_catalog_authority (
  authority_id TEXT PRIMARY KEY CHECK(authority_id = 'public-catalog'),
  generation INTEGER NOT NULL CHECK(generation > 0),
  state TEXT NOT NULL CHECK(state IN ('pending', 'verified')),
  operation_id TEXT NOT NULL CHECK(length(operation_id) = 64),
  projection_revision INTEGER NOT NULL CHECK(projection_revision > 0),
  catalog_sha256 TEXT NOT NULL CHECK(length(catalog_sha256) = 64),
  publisher_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
