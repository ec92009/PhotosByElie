CREATE TABLE fixture_asset_editions (
          fixture_id TEXT NOT NULL, asset_id TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '', keywords_json TEXT NOT NULL DEFAULT '[]',
          country TEXT NOT NULL DEFAULT '', source_version_id TEXT NOT NULL DEFAULT '',
          editorial_state TEXT NOT NULL DEFAULT 'unreviewed',
          ai_reasons_json TEXT NOT NULL DEFAULT '[]', ai_note TEXT NOT NULL DEFAULT '',
          ai_attempt_count INTEGER NOT NULL DEFAULT 0, ai_last_error TEXT NOT NULL DEFAULT '',
          visual_ai_request_json TEXT NOT NULL DEFAULT '{}',
          ai_preview_path TEXT NOT NULL DEFAULT '', ai_preview_sha256 TEXT NOT NULL DEFAULT '',
          requested_at TEXT, proposed_at TEXT, approved_at TEXT,
          approved_revision_hash TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          provenance TEXT NOT NULL DEFAULT 'new-fixture',
          PRIMARY KEY(fixture_id, asset_id),
          FOREIGN KEY(fixture_id) REFERENCES fixtures(fixture_id),
          FOREIGN KEY(asset_id) REFERENCES sidecar_assets(asset_id)
        );
CREATE TABLE fixture_edition_versions (
          fixture_id TEXT NOT NULL, asset_id TEXT NOT NULL, revision_hash TEXT NOT NULL,
          source_version_id TEXT NOT NULL, title TEXT NOT NULL,
          keywords_json TEXT NOT NULL, country TEXT NOT NULL,
          approved_at TEXT NOT NULL, actor TEXT NOT NULL,
          provenance TEXT NOT NULL DEFAULT 'explicit-approval',
          PRIMARY KEY(fixture_id, asset_id, revision_hash),
          FOREIGN KEY(fixture_id, asset_id) REFERENCES fixture_asset_editions(fixture_id, asset_id)
        );
CREATE TABLE fixture_edition_delivery (
          fixture_id TEXT NOT NULL, asset_id TEXT NOT NULL, revision_hash TEXT NOT NULL,
          delivery_state TEXT NOT NULL DEFAULT 'needs-upload', source_version_hash TEXT NOT NULL,
          receipt_version_hash TEXT NOT NULL DEFAULT '',
          last_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          PRIMARY KEY(fixture_id,asset_id,revision_hash),
          FOREIGN KEY(fixture_id,asset_id,revision_hash) REFERENCES fixture_edition_versions(fixture_id,asset_id,revision_hash)
        );
CREATE TABLE fixture_edition_events (
          event_id INTEGER PRIMARY KEY, fixture_id TEXT NOT NULL, asset_id TEXT NOT NULL,
          action TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL,
          actor TEXT NOT NULL, created_at TEXT NOT NULL
        );
CREATE TABLE fixture_edition_migrations (
          migration_id TEXT PRIMARY KEY, completed_at TEXT NOT NULL, report_json TEXT NOT NULL
        );
