ALTER TABLE pbe_sidecar_decisions ADD COLUMN metadata_ai_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pbe_sidecar_decisions ADD COLUMN metadata_ai_last_error TEXT NOT NULL DEFAULT '';
ALTER TABLE pbe_sidecar_decisions ADD COLUMN metadata_ai_last_attempt_at TEXT NOT NULL DEFAULT '';
