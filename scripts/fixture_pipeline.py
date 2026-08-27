#!/usr/bin/env python3
"""Universal fixture tree, culling-pool, placement, and delivery state.

This module is deliberately additive to Sidecar.  It owns fixture scope and
delivery orchestration, while ``sidecar_state_db`` remains the supported writer
for culling and editorial decisions.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import threading
import time
from typing import Any, Iterable
import uuid

import owner_state_db
from sidecar_state_db import (
    DEFAULT_DB as OWNER_DB,
    connect as connect_owner,
    editorial_version_hash as sidecar_editorial_version_hash,
    location_metadata_from_row,
)


DESTINATIONS = {"r2", "apple_photos", "archive"}
FIXTURE_PLACEMENT_STATES = {"undecided", "picked", "hidden"}
FIXTURE_ELIGIBILITY_STATES = {"active", "dormant"}
FIXTURE_STATE_MIGRATION_ID = "fixture-state-v1"
CULLING_VIEWS = {"undecided", "picked", "hidden", "all-active"}
EDITORIAL_STATES = {"unreviewed", "requesting-ai", "proposed", "approved"}
DELIVERY_STATES = {"not-ready", "needs-upload", "uploading", "live", "failed"}
REVIEW_MODES = {"backfill", "full"}
REVIEW_ACTIONS = {
    "approve",
    "return-to-review",
    "hide",
    "request-ai",
    "edit-metadata",
    "propagate-country",
    "propagate-title",
    "propagate-keywords",
}
_SCHEMA_READY: set[tuple[str, int, int]] = set()
_SCHEMA_LOCK = threading.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _local_transaction_timing(started_at: str, started_clock: float) -> dict[str, Any]:
    completed_at = now_iso()
    return {
        "startedAt": started_at,
        "completedAt": completed_at,
        "durationMs": round(max(0.0, time.perf_counter() - started_clock) * 1000, 3),
    }


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _read_json(value: Any, fallback: Any) -> Any:
    try:
        return json.loads(str(value or ""))
    except json.JSONDecodeError:
        return fallback


def _location_label_specificity(value: Any) -> int:
    return sum(1 for part in str(value or "").split(",") if part.strip())


def _location_label_for_row(row: sqlite3.Row) -> str:
    """Prefer a more precise GPS-derived label while retaining stored detail."""

    stored = str(row["location_label"] or "").strip() if "location_label" in row.keys() else ""
    raw = _read_json(row["raw_json"], {}) if "raw_json" in row.keys() else {}
    derived = ""
    if isinstance(raw, dict):
        derived, _, _ = location_metadata_from_row(raw)
        derived = str(derived or "").strip()
    if derived and _location_label_specificity(derived) > _location_label_specificity(stored):
        return derived
    return stored or derived


def _clean_name(value: Any) -> str:
    name = re.sub(r"\s+", " ", str(value or "").strip())
    if not name:
        raise ValueError("fixture name is required")
    if len(name) > 160:
        raise ValueError("fixture name must be 160 characters or fewer")
    return name


def _slug(value: Any) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value or "").casefold()).strip("-")
    return slug[:120] or "fixture"


def _unique(values: Iterable[Any]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if text and text not in seen:
            seen.add(text)
            result.append(text)
    return result


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS fixtures (
          fixture_id TEXT PRIMARY KEY CHECK (trim(fixture_id) <> ''),
          parent_fixture_id TEXT,
          name TEXT NOT NULL CHECK (trim(name) <> ''),
          slug TEXT NOT NULL CHECK (trim(slug) <> ''),
          template_key TEXT,
          tags_json TEXT NOT NULL DEFAULT '[]',
          destination_defaults_json TEXT NOT NULL DEFAULT '["r2"]',
          access_gallery_key TEXT,
          legacy_identity_json TEXT NOT NULL DEFAULT '{}',
          archived_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (parent_fixture_id) REFERENCES fixtures(fixture_id),
          UNIQUE (parent_fixture_id, name COLLATE NOCASE)
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_fixtures_root_name
          ON fixtures(name COLLATE NOCASE) WHERE parent_fixture_id IS NULL;
        CREATE INDEX IF NOT EXISTS idx_fixtures_parent ON fixtures(parent_fixture_id, archived_at, name);

        CREATE TABLE IF NOT EXISTS fixture_source_batches (
          batch_id TEXT PRIMARY KEY,
          fixture_id TEXT NOT NULL,
          source_kind TEXT NOT NULL,
          source_identity TEXT NOT NULL,
          provenance_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id)
        );

        CREATE TABLE IF NOT EXISTS fixture_access_grants (
          grant_id TEXT PRIMARY KEY,
          fixture_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          external_identity TEXT NOT NULL,
          subject_label TEXT,
          state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'revoked')),
          recovery_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id),
          UNIQUE (fixture_id, provider, external_identity)
        );

        CREATE TABLE IF NOT EXISTS fixture_deliverables (
          deliverable_id TEXT PRIMARY KEY,
          fixture_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          external_identity TEXT NOT NULL,
          kind TEXT NOT NULL,
          state TEXT NOT NULL,
          recovery_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id),
          UNIQUE (fixture_id, provider, external_identity)
        );

        CREATE TABLE IF NOT EXISTS fixture_culling_pools (
          pool_id TEXT PRIMARY KEY,
          fixture_id TEXT NOT NULL,
          name TEXT NOT NULL,
          criteria_json TEXT NOT NULL DEFAULT '{}',
          snapshot_hash TEXT NOT NULL,
          asset_count INTEGER NOT NULL DEFAULT 0,
          state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'archived')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id),
          UNIQUE (fixture_id, snapshot_hash)
        );

        CREATE TABLE IF NOT EXISTS fixture_pool_assets (
          pool_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          source_kind TEXT NOT NULL,
          source_identity TEXT NOT NULL,
          source_batch_id TEXT,
          snapshot_position INTEGER NOT NULL,
          provenance_json TEXT NOT NULL DEFAULT '{}',
          added_at TEXT NOT NULL,
          removed_at TEXT,
          PRIMARY KEY (pool_id, asset_id),
          FOREIGN KEY (pool_id) REFERENCES fixture_culling_pools(pool_id) ON DELETE CASCADE,
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id),
          FOREIGN KEY (source_batch_id) REFERENCES fixture_source_batches(batch_id)
        );
        CREATE INDEX IF NOT EXISTS idx_fixture_pool_assets_asset ON fixture_pool_assets(asset_id, removed_at);

        CREATE TABLE IF NOT EXISTS fixture_asset_placements (
          placement_id TEXT PRIMARY KEY,
          fixture_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          source_pool_id TEXT,
          state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'removed')),
          placed_at TEXT NOT NULL,
          removed_at TEXT,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id),
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id),
          FOREIGN KEY (source_pool_id) REFERENCES fixture_culling_pools(pool_id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_fixture_asset_placement_active
          ON fixture_asset_placements(fixture_id, asset_id) WHERE state = 'active';
        CREATE INDEX IF NOT EXISTS idx_fixture_asset_placements_asset ON fixture_asset_placements(asset_id, state);

        CREATE TABLE IF NOT EXISTS fixture_asset_decisions (
          fixture_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          placement_state TEXT NOT NULL DEFAULT 'undecided'
            CHECK (placement_state IN ('undecided', 'picked', 'hidden')),
          eligibility_state TEXT NOT NULL DEFAULT 'active'
            CHECK (eligibility_state IN ('active', 'dormant')),
          source TEXT NOT NULL DEFAULT 'native',
          last_action TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (fixture_id, asset_id),
          FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id),
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
        );
        CREATE INDEX IF NOT EXISTS idx_fixture_asset_decisions_queue
          ON fixture_asset_decisions(fixture_id, eligibility_state, placement_state, updated_at);
        CREATE INDEX IF NOT EXISTS idx_fixture_asset_decisions_asset
          ON fixture_asset_decisions(asset_id, eligibility_state, placement_state);

        CREATE TABLE IF NOT EXISTS fixture_asset_decision_events (
          event_id TEXT PRIMARY KEY,
          fixture_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          before_state TEXT NOT NULL,
          after_state TEXT NOT NULL,
          before_eligibility TEXT NOT NULL,
          after_eligibility TEXT NOT NULL,
          action TEXT NOT NULL,
          actor TEXT NOT NULL,
          reason TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id),
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
        );
        CREATE INDEX IF NOT EXISTS idx_fixture_asset_decision_events_asset
          ON fixture_asset_decision_events(fixture_id, asset_id, created_at);

        CREATE TABLE IF NOT EXISTS asset_editorial_state (
          asset_id TEXT PRIMARY KEY,
          editorial_state TEXT NOT NULL DEFAULT 'unreviewed'
            CHECK (editorial_state IN ('unreviewed', 'requesting-ai', 'proposed', 'approved')),
          ai_reasons_json TEXT NOT NULL DEFAULT '[]',
          ai_note TEXT NOT NULL DEFAULT '',
          ai_attempt_count INTEGER NOT NULL DEFAULT 0,
          ai_last_error TEXT NOT NULL DEFAULT '',
          requested_at TEXT,
          proposed_at TEXT,
          approved_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
        );
        CREATE INDEX IF NOT EXISTS idx_asset_editorial_state_queue
          ON asset_editorial_state(editorial_state, updated_at, asset_id);

        CREATE TABLE IF NOT EXISTS asset_delivery_state (
          asset_id TEXT PRIMARY KEY,
          delivery_state TEXT NOT NULL DEFAULT 'not-ready'
            CHECK (delivery_state IN ('not-ready', 'needs-upload', 'uploading', 'live', 'failed')),
          source_version_hash TEXT NOT NULL DEFAULT '',
          last_error TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
        );
        CREATE INDEX IF NOT EXISTS idx_asset_delivery_state_queue
          ON asset_delivery_state(delivery_state, updated_at, asset_id);

        CREATE TABLE IF NOT EXISTS r2_objects (
          bucket TEXT NOT NULL,
          object_key TEXT NOT NULL,
          photo_id TEXT,
          object_kind TEXT,
          lifecycle_state TEXT NOT NULL
            CHECK (lifecycle_state IN ('current', 'marked_for_delete', 'deleted_confirmed')),
          first_seen_at TEXT,
          last_seen_at TEXT,
          marked_for_delete_at TEXT,
          deleted_confirmed_at TEXT,
          last_checked_at TEXT,
          source TEXT,
          bytes INTEGER CHECK (bytes IS NULL OR bytes >= 0),
          updated_at TEXT,
          PRIMARY KEY (bucket, object_key)
        );
        CREATE INDEX IF NOT EXISTS idx_r2_objects_state_bucket
          ON r2_objects(lifecycle_state, bucket);
        CREATE INDEX IF NOT EXISTS idx_r2_objects_photo
          ON r2_objects(photo_id, lifecycle_state);

        CREATE TABLE IF NOT EXISTS asset_source_versions (
          version_id TEXT PRIMARY KEY,
          asset_id TEXT NOT NULL,
          metadata_fingerprint TEXT NOT NULL DEFAULT '',
          rendered_fingerprint TEXT NOT NULL DEFAULT '',
          source_exists INTEGER NOT NULL DEFAULT 1 CHECK (source_exists IN (0, 1)),
          state TEXT NOT NULL DEFAULT 'candidate'
            CHECK (state IN ('candidate', 'approved', 'live', 'superseded', 'source-missing')),
          created_at TEXT NOT NULL,
          approved_at TEXT,
          live_at TEXT,
          superseded_at TEXT,
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
        );
        CREATE INDEX IF NOT EXISTS idx_asset_source_versions_asset
          ON asset_source_versions(asset_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_asset_source_versions_state
          ON asset_source_versions(state, created_at, asset_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_source_versions_fingerprints
          ON asset_source_versions(asset_id, metadata_fingerprint, rendered_fingerprint);

        CREATE TABLE IF NOT EXISTS asset_sync_state (
          asset_id TEXT PRIMARY KEY,
          photos_asset_id TEXT NOT NULL DEFAULT '',
          metadata_fingerprint TEXT NOT NULL DEFAULT '',
          rendered_fingerprint TEXT NOT NULL DEFAULT '',
          last_giveback_fingerprint TEXT NOT NULL DEFAULT '',
          last_scanned_at TEXT,
          last_giveback_at TEXT,
          last_error TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
        );

        CREATE TABLE IF NOT EXISTS asset_publications (
          asset_id TEXT NOT NULL,
          fixture_id TEXT NOT NULL,
          source_version_hash TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'live'
            CHECK (state IN ('live', 'withdrawn', 'superseded')),
          published_at TEXT NOT NULL,
          withdrawn_at TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (asset_id, fixture_id, source_version_hash),
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id),
          FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id)
        );
        CREATE INDEX IF NOT EXISTS idx_asset_publications_fixture
          ON asset_publications(fixture_id, state, published_at, asset_id);
        CREATE INDEX IF NOT EXISTS idx_asset_publications_asset
          ON asset_publications(asset_id, state, published_at);

        CREATE TABLE IF NOT EXISTS public_catalog_publications (
          asset_id TEXT NOT NULL,
          source_version_hash TEXT NOT NULL,
          media_id TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'pending'
            CHECK (state IN ('pending', 'local', 'live', 'failed')),
          public_url TEXT NOT NULL DEFAULT '',
          catalog_sha256 TEXT NOT NULL DEFAULT '',
          error_text TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          verified_at TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (asset_id, source_version_hash),
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
        );
        CREATE INDEX IF NOT EXISTS idx_public_catalog_publications_state
          ON public_catalog_publications(state, updated_at, asset_id);

        CREATE TABLE IF NOT EXISTS catalog_collection_resolutions (
          asset_id TEXT NOT NULL,
          source_version_hash TEXT NOT NULL,
          collection_slug TEXT NOT NULL DEFAULT 'unknown',
          city TEXT NOT NULL DEFAULT '',
          country_code TEXT NOT NULL DEFAULT '',
          provider TEXT NOT NULL,
          query_text TEXT NOT NULL DEFAULT '',
          confidence REAL NOT NULL DEFAULT 0,
          response_json TEXT NOT NULL DEFAULT '{}',
          resolved_at TEXT NOT NULL,
          PRIMARY KEY (asset_id, source_version_hash),
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
        );
        CREATE INDEX IF NOT EXISTS idx_catalog_collection_resolutions_collection
          ON catalog_collection_resolutions(collection_slug, resolved_at, asset_id);

        CREATE TABLE IF NOT EXISTS asset_sale_references (
          order_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          source_version_hash TEXT NOT NULL,
          checksum_sha256 TEXT NOT NULL,
          master_key TEXT NOT NULL,
          derivative_keys_json TEXT NOT NULL DEFAULT '[]',
          recorded_at TEXT NOT NULL,
          PRIMARY KEY (order_id, asset_id, source_version_hash),
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
        );
        CREATE INDEX IF NOT EXISTS idx_asset_sale_references_asset
          ON asset_sale_references(asset_id, source_version_hash);

        CREATE TABLE IF NOT EXISTS r2_quarantine (
          bucket TEXT NOT NULL,
          object_key TEXT NOT NULL,
          asset_id TEXT NOT NULL DEFAULT '',
          source_version_hash TEXT NOT NULL DEFAULT '',
          reason TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'quarantined'
            CHECK (state IN ('quarantined', 'restored', 'eligible-delete', 'deleted', 'protected')),
          first_reconciled_at TEXT NOT NULL,
          second_reconciled_at TEXT,
          delete_after TEXT NOT NULL,
          restored_at TEXT,
          deleted_at TEXT,
          last_run_id TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (bucket, object_key)
        );
        CREATE INDEX IF NOT EXISTS idx_r2_quarantine_state
          ON r2_quarantine(state, delete_after, updated_at);

        CREATE TABLE IF NOT EXISTS r2_reconciliation_runs (
          run_id TEXT PRIMARY KEY,
          mode TEXT NOT NULL CHECK (mode IN ('plan', 'commit', 'exceptional-sold-purge')),
          status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
          stage TEXT NOT NULL DEFAULT 'Queued',
          requested_count INTEGER NOT NULL DEFAULT 0,
          scanned_count INTEGER NOT NULL DEFAULT 0,
          protected_count INTEGER NOT NULL DEFAULT 0,
          quarantined_count INTEGER NOT NULL DEFAULT 0,
          restored_count INTEGER NOT NULL DEFAULT 0,
          eligible_delete_count INTEGER NOT NULL DEFAULT 0,
          deleted_count INTEGER NOT NULL DEFAULT 0,
          remaining_count INTEGER NOT NULL DEFAULT 0,
          cancel_requested INTEGER NOT NULL DEFAULT 0,
          actions_json TEXT NOT NULL DEFAULT '[]',
          error_text TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          completed_at TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS photos_sync_runs (
          run_id TEXT PRIMARY KEY,
          status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
          stage TEXT NOT NULL DEFAULT 'Queued',
          requested_count INTEGER NOT NULL DEFAULT 0,
          scanned_count INTEGER NOT NULL DEFAULT 0,
          remaining_count INTEGER NOT NULL DEFAULT 0,
          baseline_count INTEGER NOT NULL DEFAULT 0,
          unchanged_count INTEGER NOT NULL DEFAULT 0,
          metadata_only_count INTEGER NOT NULL DEFAULT 0,
          appearance_count INTEGER NOT NULL DEFAULT 0,
          source_missing_count INTEGER NOT NULL DEFAULT 0,
          source_returned_count INTEGER NOT NULL DEFAULT 0,
          failed_count INTEGER NOT NULL DEFAULT 0,
          cancel_requested INTEGER NOT NULL DEFAULT 0,
          failures_json TEXT NOT NULL DEFAULT '[]',
          elapsed_seconds REAL NOT NULL DEFAULT 0,
          error_text TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          completed_at TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_photos_sync_runs_status
          ON photos_sync_runs(status, updated_at);

        CREATE TABLE IF NOT EXISTS asset_upload_runs (
          run_id TEXT PRIMARY KEY,
          status TEXT NOT NULL
            CHECK (status IN ('queued', 'running', 'completed', 'completed-with-errors', 'cancelled', 'failed')),
          requested_count INTEGER NOT NULL DEFAULT 0,
          processed_count INTEGER NOT NULL DEFAULT 0,
          live_count INTEGER NOT NULL DEFAULT 0,
          failed_count INTEGER NOT NULL DEFAULT 0,
          remaining_count INTEGER NOT NULL DEFAULT 0,
          cancel_requested INTEGER NOT NULL DEFAULT 0,
          concurrency INTEGER NOT NULL DEFAULT 1,
          last_error TEXT NOT NULL DEFAULT '',
          started_at TEXT,
          completed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_asset_upload_runs_status
          ON asset_upload_runs(status, updated_at);

        CREATE TABLE IF NOT EXISTS asset_upload_run_items (
          run_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          source_version_hash TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL
            CHECK (status IN ('queued', 'uploading', 'verified', 'live', 'failed', 'skipped')),
          object_keys_json TEXT NOT NULL DEFAULT '[]',
          error_text TEXT NOT NULL DEFAULT '',
          started_at TEXT,
          completed_at TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (run_id, asset_id),
          FOREIGN KEY (run_id) REFERENCES asset_upload_runs(run_id) ON DELETE CASCADE,
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
        );
        CREATE INDEX IF NOT EXISTS idx_asset_upload_run_items_status
          ON asset_upload_run_items(run_id, status, asset_id);

        CREATE TABLE IF NOT EXISTS asset_editorial_events (
          event_id TEXT PRIMARY KEY,
          asset_id TEXT NOT NULL,
          fixture_id TEXT,
          action TEXT NOT NULL,
          before_state TEXT NOT NULL,
          after_state TEXT NOT NULL,
          before_json TEXT NOT NULL DEFAULT '{}',
          after_json TEXT NOT NULL DEFAULT '{}',
          actor TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id),
          FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id)
        );
        CREATE INDEX IF NOT EXISTS idx_asset_editorial_events_asset
          ON asset_editorial_events(asset_id, created_at);

        CREATE TABLE IF NOT EXISTS fixture_review_operations (
          operation_id TEXT PRIMARY KEY,
          fixture_id TEXT NOT NULL,
          action TEXT NOT NULL,
          anchor_asset_id TEXT NOT NULL,
          propagated INTEGER NOT NULL DEFAULT 0 CHECK (propagated IN (0, 1)),
          asset_ids_json TEXT NOT NULL,
          before_json TEXT NOT NULL,
          after_json TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'applied'
            CHECK (state IN ('applied', 'undone')),
          actor TEXT NOT NULL,
          created_at TEXT NOT NULL,
          undone_at TEXT,
          FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id)
        );
        CREATE INDEX IF NOT EXISTS idx_fixture_review_operations_fixture
          ON fixture_review_operations(fixture_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS asset_ai_proposals (
          proposal_id TEXT PRIMARY KEY,
          asset_id TEXT NOT NULL,
          run_id TEXT NOT NULL,
          attempt INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'ready'
            CHECK (status IN ('ready', 'loaded', 'accepted', 'rejected', 'superseded')),
          previous_title TEXT NOT NULL DEFAULT '',
          previous_keywords_json TEXT NOT NULL DEFAULT '[]',
          previous_country TEXT NOT NULL DEFAULT '',
          proposed_title TEXT NOT NULL,
          proposed_keywords_json TEXT NOT NULL DEFAULT '[]',
          proposed_country TEXT NOT NULL DEFAULT '',
          country_source TEXT NOT NULL DEFAULT '',
          confidence TEXT NOT NULL DEFAULT '',
          reason TEXT NOT NULL DEFAULT '',
          needs_owner_context INTEGER NOT NULL DEFAULT 0,
          request_reasons_json TEXT NOT NULL DEFAULT '[]',
          request_note TEXT NOT NULL DEFAULT '',
          preview_sha256 TEXT NOT NULL DEFAULT '',
          generator TEXT NOT NULL DEFAULT 'codex',
          generator_model TEXT NOT NULL DEFAULT '',
          requested_generator_model TEXT NOT NULL DEFAULT '',
          resolved_model TEXT NOT NULL DEFAULT '',
          reasoning_effort TEXT NOT NULL DEFAULT '',
          vision INTEGER NOT NULL DEFAULT 0 CHECK (vision IN (0, 1)),
          model_ladder TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          loaded_at TEXT,
          decided_at TEXT,
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_ai_proposals_attempt
          ON asset_ai_proposals(asset_id, attempt);
        CREATE INDEX IF NOT EXISTS idx_asset_ai_proposals_ready
          ON asset_ai_proposals(status, created_at, asset_id);

        CREATE TABLE IF NOT EXISTS asset_ai_runs (
          run_id TEXT PRIMARY KEY,
          trigger TEXT NOT NULL CHECK (trigger IN ('scheduled', 'manual', 'test')),
          status TEXT NOT NULL
            CHECK (status IN ('queued', 'running', 'completed', 'completed-with-errors', 'cancelled', 'failed')),
          requested_count INTEGER NOT NULL DEFAULT 0,
          processed_count INTEGER NOT NULL DEFAULT 0,
          proposed_count INTEGER NOT NULL DEFAULT 0,
          skipped_count INTEGER NOT NULL DEFAULT 0,
          failed_count INTEGER NOT NULL DEFAULT 0,
          remaining_count INTEGER NOT NULL DEFAULT 0,
          cancel_requested INTEGER NOT NULL DEFAULT 0,
          owner_pid INTEGER,
          last_error TEXT NOT NULL DEFAULT '',
          started_at TEXT,
          completed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_asset_ai_runs_status
          ON asset_ai_runs(status, updated_at);

        CREATE TABLE IF NOT EXISTS asset_ai_run_items (
          run_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          status TEXT NOT NULL
            CHECK (status IN ('queued', 'running', 'proposed', 'skipped', 'failed')),
          attempt INTEGER NOT NULL DEFAULT 0,
          requested_generator_model TEXT NOT NULL DEFAULT '',
          resolved_model TEXT NOT NULL DEFAULT '',
          reasoning_effort TEXT NOT NULL DEFAULT '',
          vision INTEGER NOT NULL DEFAULT 0 CHECK (vision IN (0, 1)),
          model_ladder TEXT NOT NULL DEFAULT '[]',
          error_text TEXT NOT NULL DEFAULT '',
          started_at TEXT,
          completed_at TEXT,
          PRIMARY KEY (run_id, asset_id),
          FOREIGN KEY (run_id) REFERENCES asset_ai_runs(run_id) ON DELETE CASCADE,
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
        );
        CREATE INDEX IF NOT EXISTS idx_asset_ai_run_items_status
          ON asset_ai_run_items(run_id, status, asset_id);

        CREATE TABLE IF NOT EXISTS workflow_migration_receipts (
          migration_id TEXT PRIMARY KEY,
          state TEXT NOT NULL CHECK (state IN ('planned', 'applied', 'reverted', 'failed')),
          backup_path TEXT NOT NULL DEFAULT '',
          before_json TEXT NOT NULL,
          after_json TEXT NOT NULL DEFAULT '{}',
          receipt_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          applied_at TEXT,
          reverted_at TEXT
        );

        CREATE TABLE IF NOT EXISTS fixture_placement_events (
          event_id TEXT PRIMARY KEY,
          placement_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          from_fixture_id TEXT,
          to_fixture_id TEXT,
          action TEXT NOT NULL CHECK (action IN ('place', 'move', 'remove', 'restore')),
          actor TEXT,
          reason TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (placement_id) REFERENCES fixture_asset_placements(placement_id)
        );

        CREATE TABLE IF NOT EXISTS fixture_asset_destinations (
          fixture_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          destinations_json TEXT NOT NULL,
          version_hash TEXT NOT NULL,
          configured_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (fixture_id, asset_id),
          FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id),
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
        );

        CREATE TABLE IF NOT EXISTS fixture_delivery_receipts (
          receipt_id TEXT PRIMARY KEY,
          fixture_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          destination TEXT NOT NULL CHECK (destination IN ('r2', 'apple_photos', 'archive')),
          version_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'verified', 'failed')),
          object_key TEXT,
          checksum_sha256 TEXT,
          visibility_policy TEXT,
          verification_json TEXT NOT NULL DEFAULT '{}',
          attempted_at TEXT,
          verified_at TEXT,
          error_text TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id),
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id),
          UNIQUE (fixture_id, asset_id, destination, version_hash, object_key)
        );
        CREATE INDEX IF NOT EXISTS idx_fixture_delivery_receipts_state
          ON fixture_delivery_receipts(fixture_id, destination, status, updated_at);
        """
    )
    fixture_columns = {
        str(row["name"])
        for row in conn.execute("PRAGMA table_info(fixtures)").fetchall()
    }
    if "candidate_mode" not in fixture_columns:
        conn.execute(
            "ALTER TABLE fixtures ADD COLUMN candidate_mode TEXT NOT NULL DEFAULT 'inherited'"
        )
    if "owner_only" not in fixture_columns:
        conn.execute(
            "ALTER TABLE fixtures ADD COLUMN owner_only INTEGER NOT NULL DEFAULT 1"
        )
    grant_columns = {
        str(row["name"])
        for row in conn.execute("PRAGMA table_info(fixture_access_grants)").fetchall()
    }
    if "inherit_descendants" not in grant_columns:
        conn.execute(
            "ALTER TABLE fixture_access_grants ADD COLUMN inherit_descendants INTEGER NOT NULL DEFAULT 1"
        )
    editorial_columns = {
        str(row["name"])
        for row in conn.execute("PRAGMA table_info(asset_editorial_state)").fetchall()
    }
    if "ai_preview_path" not in editorial_columns:
        conn.execute(
            "ALTER TABLE asset_editorial_state ADD COLUMN ai_preview_path TEXT NOT NULL DEFAULT ''"
        )
    if "ai_preview_sha256" not in editorial_columns:
        conn.execute(
            "ALTER TABLE asset_editorial_state ADD COLUMN ai_preview_sha256 TEXT NOT NULL DEFAULT ''"
        )
    photos_sync_columns = {
        str(row["name"])
        for row in conn.execute("PRAGMA table_info(photos_sync_runs)").fetchall()
    }
    for column, ddl in {
        "worker_pid": "ALTER TABLE photos_sync_runs ADD COLUMN worker_pid INTEGER",
        "worker_token": "ALTER TABLE photos_sync_runs ADD COLUMN worker_token TEXT NOT NULL DEFAULT ''",
        "lease_expires_at": "ALTER TABLE photos_sync_runs ADD COLUMN lease_expires_at TEXT",
        "recovery_state": "ALTER TABLE photos_sync_runs ADD COLUMN recovery_state TEXT NOT NULL DEFAULT ''",
        "recovery_reason": "ALTER TABLE photos_sync_runs ADD COLUMN recovery_reason TEXT NOT NULL DEFAULT ''",
        "recovery_checked_at": "ALTER TABLE photos_sync_runs ADD COLUMN recovery_checked_at TEXT",
    }.items():
        if column not in photos_sync_columns:
            conn.execute(ddl)
    reconciliation_columns = {
        str(row["name"])
        for row in conn.execute("PRAGMA table_info(r2_reconciliation_runs)").fetchall()
    }
    for column, ddl in {
        "stage": "ALTER TABLE r2_reconciliation_runs ADD COLUMN stage TEXT NOT NULL DEFAULT 'Queued'",
        "requested_count": "ALTER TABLE r2_reconciliation_runs ADD COLUMN requested_count INTEGER NOT NULL DEFAULT 0",
        "remaining_count": "ALTER TABLE r2_reconciliation_runs ADD COLUMN remaining_count INTEGER NOT NULL DEFAULT 0",
        "cancel_requested": "ALTER TABLE r2_reconciliation_runs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0",
        "actions_json": "ALTER TABLE r2_reconciliation_runs ADD COLUMN actions_json TEXT NOT NULL DEFAULT '[]'",
    }.items():
        if column not in reconciliation_columns:
            conn.execute(ddl)
    proposal_columns = {
        str(row["name"])
        for row in conn.execute("PRAGMA table_info(asset_ai_proposals)").fetchall()
    }
    for column, ddl in {
        "previous_country": "ALTER TABLE asset_ai_proposals ADD COLUMN previous_country TEXT NOT NULL DEFAULT ''",
        "proposed_country": "ALTER TABLE asset_ai_proposals ADD COLUMN proposed_country TEXT NOT NULL DEFAULT ''",
        "country_source": "ALTER TABLE asset_ai_proposals ADD COLUMN country_source TEXT NOT NULL DEFAULT ''",
        "requested_generator_model": "ALTER TABLE asset_ai_proposals ADD COLUMN requested_generator_model TEXT NOT NULL DEFAULT ''",
        "resolved_model": "ALTER TABLE asset_ai_proposals ADD COLUMN resolved_model TEXT NOT NULL DEFAULT ''",
        "reasoning_effort": "ALTER TABLE asset_ai_proposals ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT ''",
        "vision": "ALTER TABLE asset_ai_proposals ADD COLUMN vision INTEGER NOT NULL DEFAULT 0",
        "model_ladder": "ALTER TABLE asset_ai_proposals ADD COLUMN model_ladder TEXT NOT NULL DEFAULT '[]'",
    }.items():
        if column not in proposal_columns:
            conn.execute(ddl)
    run_item_columns = {
        str(row["name"])
        for row in conn.execute("PRAGMA table_info(asset_ai_run_items)").fetchall()
    }
    for column, ddl in {
        "requested_generator_model": "ALTER TABLE asset_ai_run_items ADD COLUMN requested_generator_model TEXT NOT NULL DEFAULT ''",
        "resolved_model": "ALTER TABLE asset_ai_run_items ADD COLUMN resolved_model TEXT NOT NULL DEFAULT ''",
        "reasoning_effort": "ALTER TABLE asset_ai_run_items ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT ''",
        "vision": "ALTER TABLE asset_ai_run_items ADD COLUMN vision INTEGER NOT NULL DEFAULT 0",
        "model_ladder": "ALTER TABLE asset_ai_run_items ADD COLUMN model_ladder TEXT NOT NULL DEFAULT '[]'",
    }.items():
        if column not in run_item_columns:
            conn.execute(ddl)
    conn.execute(
        "UPDATE fixtures SET candidate_mode = CASE WHEN parent_fixture_id IS NULL THEN 'photos-library' ELSE 'inherited' END"
    )
    timestamp = now_iso()
    conn.execute(
        """
        INSERT OR IGNORE INTO asset_editorial_state (
          asset_id, editorial_state, approved_at, created_at, updated_at
        )
        SELECT a.asset_id,
               CASE COALESCE(d.metadata_state, 'unreviewed')
                 WHEN 'approved' THEN 'approved'
                 WHEN 'proposed' THEN 'proposed'
                 ELSE 'unreviewed'
               END,
               CASE WHEN d.metadata_state = 'approved' THEN COALESCE(d.updated_at, ?) END,
               COALESCE(d.created_at, a.indexed_at, ?),
               COALESCE(d.updated_at, a.updated_at, ?)
        FROM sidecar_assets AS a
        LEFT JOIN sidecar_decisions AS d ON d.asset_id = a.asset_id
        """,
        (timestamp, timestamp, timestamp),
    )
    conn.execute(
        """
        INSERT OR IGNORE INTO asset_delivery_state (
          asset_id, delivery_state, created_at, updated_at
        )
        SELECT a.asset_id,
               CASE WHEN e.editorial_state = 'approved' THEN 'needs-upload' ELSE 'not-ready' END,
               COALESCE(a.indexed_at, ?),
               COALESCE(a.updated_at, ?)
        FROM sidecar_assets AS a
        JOIN asset_editorial_state AS e ON e.asset_id = a.asset_id
        """,
        (timestamp, timestamp),
    )


def connect(repo_root: Path, db_path: Path | None = None) -> sqlite3.Connection:
    selected = db_path or OWNER_DB
    path = selected if selected.is_absolute() else repo_root / selected
    conn = connect_owner(repo_root, db_path)
    stat = path.stat()
    schema_key = (str(path.resolve()), int(stat.st_dev), int(stat.st_ino))
    with _SCHEMA_LOCK:
        if schema_key not in _SCHEMA_READY:
            try:
                owner_state_db.ensure_schema(conn)
                ensure_schema(conn)
                conn.commit()
            except Exception:
                conn.close()
                raise
            _SCHEMA_READY.add(schema_key)
    return conn


def connect_read_only(repo_root: Path, db_path: Path | None = None) -> sqlite3.Connection:
    """Open the existing Owner database without schema writes or writer-lock waits."""
    selected = db_path or OWNER_DB
    path = selected if selected.is_absolute() else repo_root / selected
    connection = sqlite3.connect(
        f"{path.resolve().as_uri()}?mode=ro",
        uri=True,
        timeout=2,
    )
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout = 2000")
    connection.execute("PRAGMA query_only = ON")
    return connection


def _fixture_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "fixtureId": row["fixture_id"],
        "parentFixtureId": row["parent_fixture_id"] or "",
        "name": row["name"],
        "slug": row["slug"],
        "templateKey": row["template_key"] or "",
        "tags": _read_json(row["tags_json"], []),
        "destinationDefaults": _read_json(row["destination_defaults_json"], ["r2"]),
        "accessGalleryKey": row["access_gallery_key"] or "",
        "legacyIdentity": _read_json(row["legacy_identity_json"], {}),
        "candidateMode": row["candidate_mode"] if "candidate_mode" in row.keys() else (
            "photos-library" if not row["parent_fixture_id"] else "inherited"
        ),
        "ownerOnly": bool(row["owner_only"]) if "owner_only" in row.keys() else True,
        "archivedAt": row["archived_at"] or "",
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def create_fixture(
    repo_root: Path,
    name: str,
    *,
    parent_fixture_id: str = "",
    fixture_id: str = "",
    tags: Iterable[str] = (),
    template_key: str = "",
    destination_defaults: Iterable[str] = ("r2",),
    access_gallery_key: str = "",
    legacy_identity: dict[str, Any] | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    owns = conn is None
    conn = conn or connect(repo_root)
    timestamp = now_iso()
    clean_name = _clean_name(name)
    parent = str(parent_fixture_id or "").strip() or None
    destinations = _unique(destination_defaults)
    if not destinations or any(item not in DESTINATIONS for item in destinations):
        raise ValueError("destination defaults must use r2, apple_photos, or archive")
    try:
        if parent and not conn.execute("SELECT 1 FROM fixtures WHERE fixture_id = ? AND archived_at IS NULL", (parent,)).fetchone():
            raise ValueError("parent fixture does not exist")
        existing = conn.execute(
            "SELECT * FROM fixtures WHERE parent_fixture_id IS ? AND name = ? COLLATE NOCASE AND archived_at IS NULL",
            (parent, clean_name),
        ).fetchone()
        if existing:
            return _fixture_row(existing)
        clean_id = str(fixture_id or "").strip() or f"fxt-{uuid.uuid4().hex[:16]}"
        conn.execute(
            """
            INSERT INTO fixtures (
              fixture_id, parent_fixture_id, name, slug, template_key, tags_json,
              destination_defaults_json, access_gallery_key, legacy_identity_json,
              candidate_mode, owner_only, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (
                clean_id, parent, clean_name, _slug(clean_name), str(template_key or "").strip() or None,
                _json(_unique(tags)), _json(destinations), str(access_gallery_key or "").strip() or None,
                _json(legacy_identity or {}),
                "inherited" if parent else "photos-library",
                timestamp,
                timestamp,
            ),
        )
        if owns:
            conn.commit()
        return _fixture_row(conn.execute("SELECT * FROM fixtures WHERE fixture_id = ?", (clean_id,)).fetchone())
    finally:
        if owns:
            conn.close()


def fixture_tree(repo_root: Path, *, include_archived: bool = False) -> list[dict[str, Any]]:
    with connect_read_only(repo_root) as conn:
        rows = conn.execute(
            f"SELECT * FROM fixtures {'WHERE archived_at IS NULL' if not include_archived else ''} ORDER BY name COLLATE NOCASE"
        ).fetchall()
    by_parent: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        item = _fixture_row(row)
        item["children"] = []
        by_parent.setdefault(item["parentFixtureId"], []).append(item)
    def attach(item: dict[str, Any], ancestors: tuple[str, ...]) -> dict[str, Any]:
        if item["fixtureId"] in ancestors:
            raise ValueError("fixture tree contains a cycle")
        item["children"] = [attach(child, (*ancestors, item["fixtureId"])) for child in by_parent.get(item["fixtureId"], [])]
        return item
    return [attach(root, ()) for root in by_parent.get("", [])]


def fixture_breadcrumbs(conn: sqlite3.Connection, fixture_id: str) -> list[dict[str, str]]:
    chain: list[dict[str, str]] = []
    seen: set[str] = set()
    current = str(fixture_id or "").strip()
    while current:
        if current in seen:
            raise ValueError("fixture tree contains a cycle")
        seen.add(current)
        row = conn.execute("SELECT fixture_id, parent_fixture_id, name FROM fixtures WHERE fixture_id = ?", (current,)).fetchone()
        if not row:
            raise ValueError("fixture does not exist")
        chain.append({"fixtureId": row["fixture_id"], "name": row["name"]})
        current = row["parent_fixture_id"] or ""
    return list(reversed(chain))


def _owner_db_path(repo_root: Path, db_path: Path | None = None) -> Path:
    selected = db_path or OWNER_DB
    return selected if selected.is_absolute() else repo_root / selected


def _read_only_connection(repo_root: Path, db_path: Path | None = None) -> sqlite3.Connection:
    path = _owner_db_path(repo_root, db_path)
    if not path.exists():
        raise ValueError("Owner database does not exist")
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return bool(conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (name,),
    ).fetchone())


def _count(conn: sqlite3.Connection, sql: str, params: Iterable[Any] = ()) -> int:
    return int(conn.execute(sql, tuple(params)).fetchone()[0])


def _fixture_state_parity(conn: sqlite3.Connection) -> dict[str, int]:
    tables = {
        str(row[0])
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    }
    def total(table: str, where: str = "1 = 1") -> int:
        return _count(conn, f"SELECT count(*) FROM {table} WHERE {where}") if table in tables else 0
    return {
        "assetCount": total("sidecar_assets"),
        "globalDecisionCount": total("sidecar_decisions"),
        "globalPickedCount": total("sidecar_decisions", "pick_state = 'picked'"),
        "globalRejectedCount": total("sidecar_decisions", "pick_state IN ('rejected', 'hidden')"),
        "globalApprovedCount": total("sidecar_decisions", "metadata_state = 'approved'"),
        "globalTombstoneCount": total("sidecar_tombstones", "tombstone_state = 'active'"),
        "fixtureCount": total("fixtures"),
        "activeLegacyPlacementCount": total("fixture_asset_placements", "state = 'active'"),
        "normalizedFixtureDecisionCount": total("fixture_asset_decisions"),
        "deliveryReceiptCount": total("fixture_delivery_receipts"),
    }


def plan_fixture_state_migration(
    repo_root: Path,
    *,
    db_path: Path | None = None,
) -> dict[str, Any]:
    """Read-only report for moving the overloaded global Pick/Hide state into Expo."""
    with _read_only_connection(repo_root, db_path) as conn:
        before = _fixture_state_parity(conn)
        if not _table_exists(conn, "fixtures"):
            raise ValueError("fixture schema is not initialized")
        expo = conn.execute(
            "SELECT fixture_id FROM fixtures WHERE fixture_id = 'fixture-expo'"
        ).fetchone()
        if not expo:
            raise ValueError("Expo fixture does not exist")
        legacy_rows = conn.execute(
            """
            SELECT asset_id,
                   CASE WHEN pick_state = 'picked' THEN 'picked' ELSE 'hidden' END state
            FROM sidecar_decisions
            WHERE pick_state IN ('picked', 'rejected', 'hidden')
            """
        ).fetchall()
        explicit_rows = conn.execute(
            """
            SELECT fixture_id, asset_id
            FROM fixture_asset_placements
            WHERE state = 'active'
            """
        ).fetchall()
        fixture_parents = {
            str(row["fixture_id"]): str(row["parent_fixture_id"] or "")
            for row in conn.execute(
                "SELECT fixture_id, parent_fixture_id FROM fixtures"
            ).fetchall()
        }
        inferred: set[tuple[str, str]] = set()
        for row in explicit_rows:
            current = str(row["fixture_id"])
            asset_id = str(row["asset_id"])
            while current:
                inferred.add((current, asset_id))
                current = fixture_parents.get(current, "")
        proposed: dict[tuple[str, str], str] = {
            ("fixture-expo", str(row["asset_id"])): str(row["state"])
            for row in legacy_rows
        }
        for key in inferred:
            proposed.setdefault(key, "picked")
        existing = set()
        if _table_exists(conn, "fixture_asset_decisions"):
            existing = {
                (str(row["fixture_id"]), str(row["asset_id"]))
                for row in conn.execute(
                    "SELECT fixture_id, asset_id FROM fixture_asset_decisions"
                ).fetchall()
            }
        insertions = set(proposed) - existing
        planned_picked = sum(proposed[key] == "picked" for key in insertions)
        planned_hidden = sum(proposed[key] == "hidden" for key in insertions)
        return {
            "ok": True,
            "mode": "dry-run",
            "migrationId": FIXTURE_STATE_MIGRATION_ID,
            "before": before,
            "legacyExpoPicked": sum(row["state"] == "picked" for row in legacy_rows),
            "legacyExpoHidden": sum(row["state"] == "hidden" for row in legacy_rows),
            "explicitPlacementCount": len(explicit_rows),
            "ancestorClosureCount": len(inferred),
            "plannedDecisionInsertCount": len(insertions),
            "plannedPickedCount": planned_picked,
            "plannedHiddenCount": planned_hidden,
            "preservedExistingDecisionCount": len(existing & set(proposed)),
            "globalEditorialMutationCount": 0,
            "globalLifecycleMutationCount": 0,
            "deliveryMutationCount": 0,
            "applied": False,
        }


def _backup_owner_database(
    repo_root: Path,
    *,
    db_path: Path | None = None,
    migration_id: str,
) -> Path:
    source_path = _owner_db_path(repo_root, db_path)
    backup_root = source_path.parent / "backups"
    backup_root.mkdir(parents=True, exist_ok=True)
    stamp = now_iso().replace(":", "-")
    destination = backup_root / f"Owner-{stamp}-{migration_id}.sqlite"
    source = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True)
    target = sqlite3.connect(destination)
    try:
        source.backup(target)
        result = str(target.execute("PRAGMA integrity_check").fetchone()[0])
        if result != "ok":
            raise ValueError(f"Owner backup integrity failed: {result}")
    finally:
        target.close()
        source.close()
    return destination


def _recompute_fixture_eligibility(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        UPDATE fixture_asset_decisions
        SET eligibility_state = CASE
          WHEN (SELECT parent_fixture_id FROM fixtures WHERE fixture_id = fixture_asset_decisions.fixture_id) IS NULL
            THEN 'active'
          ELSE 'dormant'
        END
        """
    )
    changed = True
    while changed:
        before = conn.total_changes
        conn.execute(
            """
            UPDATE fixture_asset_decisions AS child
            SET eligibility_state = 'active'
            WHERE child.eligibility_state = 'dormant'
              AND EXISTS (
                SELECT 1
                FROM fixtures AS fixture
                JOIN fixture_asset_decisions AS parent
                  ON parent.fixture_id = fixture.parent_fixture_id
                 AND parent.asset_id = child.asset_id
                WHERE fixture.fixture_id = child.fixture_id
                  AND parent.placement_state = 'picked'
                  AND parent.eligibility_state = 'active'
              )
            """
        )
        changed = conn.total_changes > before


def apply_fixture_state_migration(
    repo_root: Path,
    *,
    db_path: Path | None = None,
) -> dict[str, Any]:
    """Apply the additive fixture-state migration with a verified backup and receipt."""
    plan = plan_fixture_state_migration(repo_root, db_path=db_path)
    backup = _backup_owner_database(
        repo_root,
        db_path=db_path,
        migration_id=FIXTURE_STATE_MIGRATION_ID,
    )
    timestamp = now_iso()
    with connect(repo_root, db_path) as conn:
        existing_receipt = conn.execute(
            "SELECT receipt_json FROM workflow_migration_receipts WHERE migration_id = ? AND state = 'applied'",
            (FIXTURE_STATE_MIGRATION_ID,),
        ).fetchone()
        if existing_receipt:
            backup.unlink(missing_ok=True)
            return {**_read_json(existing_receipt["receipt_json"], {}), "idempotencyReplayed": True}
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                """
                INSERT OR IGNORE INTO fixture_asset_decisions (
                  fixture_id, asset_id, placement_state, eligibility_state,
                  source, last_action, created_at, updated_at
                )
                SELECT 'fixture-expo', asset_id,
                       CASE WHEN pick_state = 'picked' THEN 'picked' ELSE 'hidden' END,
                       'active', 'legacy-global-sidecar', 'migration', ?, ?
                FROM sidecar_decisions
                WHERE pick_state IN ('picked', 'rejected', 'hidden')
                """,
                (timestamp, timestamp),
            )
            active_placements = conn.execute(
                """
                SELECT fixture_id, asset_id
                FROM fixture_asset_placements
                WHERE state = 'active'
                ORDER BY fixture_id, asset_id
                """
            ).fetchall()
            for placement in active_placements:
                current = str(placement["fixture_id"])
                asset_id = str(placement["asset_id"])
                source_fixture = current
                while current:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO fixture_asset_decisions (
                          fixture_id, asset_id, placement_state, eligibility_state,
                          source, last_action, created_at, updated_at
                        ) VALUES (?, ?, 'picked', 'dormant', ?, 'migration', ?, ?)
                        """,
                        (
                            current,
                            asset_id,
                            "legacy-explicit-placement" if current == source_fixture
                            else "legacy-ancestor-inference",
                            timestamp,
                            timestamp,
                        ),
                    )
                    parent = conn.execute(
                        "SELECT parent_fixture_id FROM fixtures WHERE fixture_id = ?",
                        (current,),
                    ).fetchone()
                    current = str(parent["parent_fixture_id"] or "") if parent else ""
            _recompute_fixture_eligibility(conn)
            after = _fixture_state_parity(conn)
            receipt = {
                **plan,
                "mode": "commit",
                "backupPath": str(backup),
                "after": after,
                "applied": True,
                "appliedAt": timestamp,
                "idempotencyReplayed": False,
                "reversal": {
                    "kind": "verified-sqlite-backup",
                    "backupPath": str(backup),
                    "requiresOfflineRestore": True,
                },
            }
            conn.execute(
                """
                INSERT INTO workflow_migration_receipts (
                  migration_id, state, backup_path, before_json, after_json,
                  receipt_json, created_at, applied_at
                ) VALUES (?, 'applied', ?, ?, ?, ?, ?, ?)
                """,
                (
                    FIXTURE_STATE_MIGRATION_ID,
                    str(backup),
                    _json(plan["before"]),
                    _json(after),
                    _json(receipt),
                    timestamp,
                    timestamp,
                ),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    receipt_path = (
        _owner_db_path(repo_root, db_path).parent
        / "migrations"
        / f"{FIXTURE_STATE_MIGRATION_ID}.json"
    )
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = receipt_path.with_name(f".{receipt_path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(receipt_path)
    return {**receipt, "receiptPath": str(receipt_path)}


def set_fixture_asset_state(
    repo_root: Path,
    fixture_id: str,
    asset_ids: Iterable[str],
    placement_state: str,
    *,
    actor: str = "owner",
    reason: str = "",
) -> dict[str, Any]:
    clean_state = str(placement_state or "").strip().casefold()
    if clean_state not in FIXTURE_PLACEMENT_STATES:
        raise ValueError("fixture placement state must be undecided, picked, or hidden")
    clean_ids = _unique(asset_ids)
    timestamp = now_iso()
    with connect(repo_root) as conn:
        fixture_breadcrumbs(conn, fixture_id)
        before_by_asset: dict[str, tuple[str, str]] = {}
        for asset_id in clean_ids:
            if not conn.execute(
                "SELECT 1 FROM sidecar_assets WHERE asset_id = ?",
                (asset_id,),
            ).fetchone():
                raise ValueError(f"asset is not indexed: {asset_id}")
            existing = conn.execute(
                """
                SELECT placement_state, eligibility_state
                FROM fixture_asset_decisions
                WHERE fixture_id = ? AND asset_id = ?
                """,
                (fixture_id, asset_id),
            ).fetchone()
            before_state = str(existing["placement_state"]) if existing else "undecided"
            before_eligibility = str(existing["eligibility_state"]) if existing else "active"
            before_by_asset[asset_id] = (before_state, before_eligibility)
            conn.execute(
                """
                INSERT INTO fixture_asset_decisions (
                  fixture_id, asset_id, placement_state, eligibility_state,
                  source, last_action, created_at, updated_at
                ) VALUES (?, ?, ?, 'dormant', 'native', ?, ?, ?)
                ON CONFLICT(fixture_id, asset_id) DO UPDATE SET
                  placement_state = excluded.placement_state,
                  source = 'native',
                  last_action = excluded.last_action,
                  updated_at = excluded.updated_at
                """,
                (fixture_id, asset_id, clean_state, clean_state, timestamp, timestamp),
            )
        _recompute_fixture_eligibility(conn)
        for asset_id in clean_ids:
            after = conn.execute(
                """
                SELECT placement_state, eligibility_state
                FROM fixture_asset_decisions
                WHERE fixture_id = ? AND asset_id = ?
                """,
                (fixture_id, asset_id),
            ).fetchone()
            before_state, before_eligibility = before_by_asset[asset_id]
            conn.execute(
                """
                INSERT INTO fixture_asset_decision_events (
                  event_id, fixture_id, asset_id, before_state, after_state,
                  before_eligibility, after_eligibility, action, actor, reason, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"fde-{uuid.uuid4().hex[:16]}",
                    fixture_id,
                    asset_id,
                    before_state,
                    clean_state,
                    before_eligibility,
                    str(after["eligibility_state"]),
                    clean_state,
                    actor,
                    str(reason or ""),
                    timestamp,
                ),
            )
        conn.commit()
        rows = conn.execute(
            f"""
            SELECT fixture_id, asset_id, placement_state, eligibility_state, source, updated_at
            FROM fixture_asset_decisions
            WHERE fixture_id = ? AND asset_id IN ({','.join('?' for _ in clean_ids)})
            ORDER BY asset_id
            """,
            [fixture_id, *clean_ids],
        ).fetchall() if clean_ids else []
    items = []
    for row in rows:
        item = dict(row)
        before_state, before_eligibility = before_by_asset[str(row["asset_id"])]
        item["before_placement_state"] = before_state
        item["before_eligibility_state"] = before_eligibility
        items.append(item)
    return {
        "ok": True,
        "fixtureId": fixture_id,
        "count": len(rows),
        "items": items,
    }


def fixture_candidate_asset_ids(
    repo_root: Path,
    fixture_id: str,
    *,
    include_missing: bool = False,
) -> list[str]:
    """Return the complete effective universe; presentation windows are applied later."""
    with connect(repo_root) as conn:
        fixture = conn.execute(
            "SELECT parent_fixture_id FROM fixtures WHERE fixture_id = ? AND archived_at IS NULL",
            (fixture_id,),
        ).fetchone()
        if not fixture:
            raise ValueError("fixture does not exist or is archived")
        if not fixture["parent_fixture_id"]:
            predicates = [
                "1 = 1",
                "lower(COALESCE(a.media_type, 'photo')) NOT LIKE '%video%'",
            ]
            if not include_missing:
                predicates.append("(a.missing_at IS NULL OR a.missing_at = '')")
            predicates.append(
                """NOT EXISTS (
                     SELECT 1 FROM sidecar_tombstones t
                     WHERE t.asset_id = a.asset_id AND t.tombstone_state = 'active'
                   )"""
            )
            predicates.append(
                """NOT EXISTS (
                     SELECT 1 FROM sidecar_decisions global_decision
                     WHERE global_decision.asset_id = a.asset_id
                       AND global_decision.pick_state = 'hidden'
                   )"""
            )
            rows = conn.execute(
                f"""
                SELECT a.asset_id
                FROM sidecar_assets a
                WHERE {' AND '.join(predicates)}
                ORDER BY a.captured_at DESC, a.asset_id
                """
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT d.asset_id
                FROM fixture_asset_decisions d
                JOIN sidecar_assets a ON a.asset_id = d.asset_id
                WHERE d.fixture_id = ?
                  AND d.placement_state = 'picked'
                  AND d.eligibility_state = 'active'
                  AND (a.missing_at IS NULL OR a.missing_at = '')
                  AND lower(COALESCE(a.media_type, 'photo')) NOT LIKE '%video%'
                  AND NOT EXISTS (
                    SELECT 1 FROM sidecar_tombstones t
                    WHERE t.asset_id = d.asset_id AND t.tombstone_state = 'active'
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM sidecar_decisions global_decision
                    WHERE global_decision.asset_id = d.asset_id
                      AND global_decision.pick_state = 'hidden'
                  )
                ORDER BY a.captured_at DESC, d.asset_id
                """,
                (str(fixture["parent_fixture_id"]),),
            ).fetchall()
    return [str(row["asset_id"]) for row in rows]


def fixture_culling_window(
    repo_root: Path,
    fixture_id: str,
    *,
    view: str = "undecided",
    views: Iterable[Any] | None = None,
    offset: int = 0,
    limit: int = 200,
    search: str = "",
    media_types: Iterable[Any] | None = None,
    ratings: Iterable[Any] | None = None,
    colors: Iterable[Any] | None = None,
) -> dict[str, Any]:
    """Query one fixture's complete effective universe without materializing ID lists."""
    clean_view = str(view or "undecided").strip().casefold()
    if clean_view not in CULLING_VIEWS:
        raise ValueError("culling view must be undecided, picked, hidden, or all-active")
    clean_views = {
        str(value or "").strip().casefold()
        for value in (views or [])
        if str(value or "").strip().casefold() in {"undecided", "picked", "hidden"}
    }
    if not clean_views:
        clean_views = (
            {"undecided", "picked", "hidden"}
            if clean_view == "all-active"
            else {clean_view}
        )
    safe_offset = max(0, int(offset or 0))
    safe_limit = max(1, min(500, int(limit or 200)))
    with connect(repo_root) as conn:
        fixture = conn.execute(
            """
            SELECT fixture_id, parent_fixture_id, candidate_mode
            FROM fixtures
            WHERE fixture_id = ? AND archived_at IS NULL
            """,
            (fixture_id,),
        ).fetchone()
        if not fixture:
            raise ValueError("fixture does not exist or is archived")

        params: list[Any] = []
        if fixture["parent_fixture_id"]:
            universe_join = """
                JOIN fixture_asset_decisions AS parent_decision
                  ON parent_decision.asset_id = a.asset_id
                 AND parent_decision.fixture_id = ?
                 AND parent_decision.placement_state = 'picked'
                 AND parent_decision.eligibility_state = 'active'
            """
            params.append(str(fixture["parent_fixture_id"]))
        else:
            universe_join = ""
        params.append(fixture_id)
        predicates = [
            "(a.missing_at IS NULL OR a.missing_at = '')",
            "lower(COALESCE(a.media_type, 'photo')) NOT LIKE '%video%'",
            """
            NOT EXISTS (
              SELECT 1 FROM sidecar_tombstones AS tombstone
              WHERE tombstone.asset_id = a.asset_id
                AND tombstone.tombstone_state = 'active'
            )
            """,
            "COALESCE(global_decision.pick_state, '') <> 'hidden'",
        ]
        # Culling is a still-photo source workflow. Snapshot that still-only
        # universe before any interactive status/rating/color/search filter.
        universe_predicates = list(predicates)
        universe_params = list(params)
        clean_media = {
            str(value or "").strip().casefold()
            for value in (media_types or [])
            if str(value or "").strip().casefold() in {"photo", "video"}
        }
        if clean_media and clean_media != {"photo", "video"}:
            placeholders = ",".join("?" for _ in clean_media)
            predicates.append(f"COALESCE(a.media_type, 'photo') IN ({placeholders})")
            params.extend(sorted(clean_media))
        clean_ratings = sorted({
            int(str(value).strip())
            for value in (ratings or [])
            if str(value).strip().isdigit() and 0 <= int(str(value).strip()) <= 5
        })
        if clean_ratings and set(clean_ratings) != set(range(6)):
            placeholders = ",".join("?" for _ in clean_ratings)
            predicates.append(f"COALESCE(global_decision.rating, 0) IN ({placeholders})")
            params.extend(clean_ratings)
        clean_colors = {
            "" if str(value or "").strip().casefold() == "none"
            else str(value or "").strip().casefold()
            for value in (colors or [])
        }
        clean_colors &= {"", "red", "yellow", "green", "blue", "purple"}
        if clean_colors and clean_colors != {"", "red", "yellow", "green", "blue", "purple"}:
            placeholders = ",".join("?" for _ in clean_colors)
            predicates.append(f"COALESCE(global_decision.color, '') IN ({placeholders})")
            params.extend(sorted(clean_colors))
        search_columns = (
            "a.asset_id",
            "a.filename",
            "a.photos_title",
            "a.photos_keywords_json",
            "a.location_label",
            "a.location_keywords_json",
            "global_decision.title",
            "global_decision.keywords_json",
        )
        for term in re.findall(r"[^\s,;]+", str(search or "").casefold())[:8]:
            escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            predicates.append(
                "(" + " OR ".join(
                    f"lower(COALESCE({column}, '')) LIKE ? ESCAPE '\\'"
                    for column in search_columns
                ) + ")"
            )
            params.extend([f"%{escaped}%"] * len(search_columns))

        from_sql = f"""
            sidecar_assets AS a
            {universe_join}
            LEFT JOIN fixture_asset_decisions AS current_decision
              ON current_decision.asset_id = a.asset_id
             AND current_decision.fixture_id = ?
            LEFT JOIN sidecar_decisions AS global_decision
              ON global_decision.asset_id = a.asset_id
        """
        universe_media = conn.execute(
            f"""
            SELECT sum(CASE WHEN lower(COALESCE(a.media_type, 'photo')) LIKE '%video%'
                            THEN 0 ELSE 1 END) photos,
                   sum(CASE WHEN lower(COALESCE(a.media_type, 'photo')) LIKE '%video%'
                            THEN 1 ELSE 0 END) videos
            FROM {from_sql}
            WHERE {' AND '.join(universe_predicates)}
            """,
            universe_params,
        ).fetchone()
        base_where_sql = " AND ".join(predicates)
        summary = conn.execute(
            f"""
            SELECT count(*) total,
                   sum(CASE WHEN COALESCE(current_decision.placement_state, 'undecided') = 'undecided'
                            THEN 1 ELSE 0 END) undecided,
                   sum(CASE WHEN current_decision.placement_state = 'picked' THEN 1 ELSE 0 END) picked,
                   sum(CASE WHEN current_decision.placement_state = 'hidden' THEN 1 ELSE 0 END) hidden
            FROM {from_sql}
            WHERE {base_where_sql}
            """,
            params,
        ).fetchone()
        view_predicates = list(predicates)
        view_params = list(params)
        if clean_views != {"undecided", "picked", "hidden"}:
            placeholders = ",".join("?" for _ in clean_views)
            view_predicates.append(
                f"COALESCE(current_decision.placement_state, 'undecided') IN ({placeholders})"
            )
            view_params.extend(sorted(clean_views))
        view_where_sql = " AND ".join(view_predicates)
        filtered_total = conn.execute(
            f"SELECT count(*) FROM {from_sql} WHERE {view_where_sql}",
            view_params,
        ).fetchone()[0]
        rows = conn.execute(
            f"""
            SELECT a.asset_id, a.source_anchor, a.raw_json, a.filename, a.media_type, a.captured_at,
                   a.location_label,
                   COALESCE(a.pixel_width, 0) pixel_width,
                   COALESCE(a.pixel_height, 0) pixel_height,
                   COALESCE(
                     json_extract(a.raw_json, '$.resourceFormat'),
                     json_extract(a.raw_json, '$.preferredResourceFormat'),
                     ''
                   ) resource_format,
                   COALESCE((
                     SELECT CAST(COALESCE(
                       json_extract(upload.value, '$.bytes'),
                       json_extract(upload.value, '$.existing.bytes')
                     ) AS INTEGER)
                     FROM sidecar_upload_bridge_run_items AS run_item,
                          json_each(COALESCE(run_item.upload_keys_json, '[]')) AS upload
                     WHERE run_item.asset_id = a.asset_id
                       AND json_extract(upload.value, '$.kind') = 'private-master'
                       AND CAST(COALESCE(
                         json_extract(upload.value, '$.bytes'),
                         json_extract(upload.value, '$.existing.bytes'),
                         0
                       ) AS INTEGER) > 0
                     ORDER BY run_item.updated_at DESC
                     LIMIT 1
                   ), 0) original_byte_count,
                   COALESCE(NULLIF(a.photos_title, ''), NULLIF(global_decision.title, ''), '') title,
                   COALESCE(current_decision.placement_state, 'undecided') placement_state,
                   COALESCE(current_decision.eligibility_state, 'active') eligibility_state,
                   COALESCE(global_decision.rating, 0) rating,
                   COALESCE(global_decision.color, '') color,
                   COALESCE(global_decision.metadata_state, 'unreviewed') editorial_state,
                   CASE
                     WHEN COALESCE(global_decision.metadata_state, 'unreviewed') <> 'unreviewed'
                       THEN COALESCE(global_decision.keywords_json, '[]')
                     ELSE COALESCE(NULLIF(a.photos_keywords_json, ''), '[]')
                   END keywords_json
            FROM {from_sql}
            WHERE {view_where_sql}
            ORDER BY a.captured_at DESC, a.asset_id
            LIMIT ? OFFSET ?
            """,
            [*view_params, safe_limit, safe_offset],
        ).fetchall()
    items = []
    for row in rows:
        items.append({
            "assetId": str(row["asset_id"]),
            "photoLibraryIdentifier": _photo_library_identifier(row),
            "title": str(row["title"] or ""),
            "filename": str(row["filename"] or ""),
            "mediaType": str(row["media_type"] or "photo"),
            "capturedAt": str(row["captured_at"] or ""),
            "locationLabel": _location_label_for_row(row),
            "pixelWidth": int(row["pixel_width"] or 0),
            "pixelHeight": int(row["pixel_height"] or 0),
            "resourceFormat": str(row["resource_format"] or ""),
            "originalByteCount": int(row["original_byte_count"] or 0),
            "placementState": str(row["placement_state"]),
            "eligibilityState": str(row["eligibility_state"]),
            "rating": int(row["rating"] or 0),
            "color": str(row["color"] or ""),
            "editorialState": str(row["editorial_state"]),
            "keywords": _read_json(row["keywords_json"], []),
        })
    total = int(filtered_total or 0)
    return {
        "ok": True,
        "readOnly": True,
        "fixtureId": fixture_id,
        "candidateMode": str(fixture["candidate_mode"] or ""),
        "view": next(iter(clean_views)) if len(clean_views) == 1 else "all-active",
        "offset": safe_offset,
        "limit": safe_limit,
        "count": len(items),
        "nextOffset": safe_offset + len(items),
        "hasNext": safe_offset + len(items) < total,
        "summary": {
            "filtered": total,
            "universe": int(summary["total"] or 0),
            "undecided": int(summary["undecided"] or 0),
            "picked": int(summary["picked"] or 0),
            "hidden": int(summary["hidden"] or 0),
        },
        "mediaAvailability": {
            "photos": int(universe_media["photos"] or 0),
            "videos": int(universe_media["videos"] or 0),
        },
        "items": items,
    }


def _fixture_review_from_sql(
    fixture: sqlite3.Row,
    *,
    include_hidden: bool = False,
) -> tuple[str, list[Any]]:
    placement_predicate = (
        "IN ('picked', 'hidden')" if include_hidden else "= 'picked'"
    )
    if fixture["parent_fixture_id"]:
        return (
            f"""
            sidecar_assets AS a
            JOIN fixture_asset_decisions AS current_decision
              ON current_decision.asset_id = a.asset_id
             AND current_decision.fixture_id = ?
             AND current_decision.placement_state {placement_predicate}
             AND current_decision.eligibility_state = 'active'
            """,
            [str(fixture["fixture_id"])],
        )
    return (
        f"""
        sidecar_assets AS a
        JOIN fixture_asset_decisions AS current_decision
          ON current_decision.asset_id = a.asset_id
         AND current_decision.fixture_id = ?
         AND current_decision.placement_state {placement_predicate}
         AND current_decision.eligibility_state = 'active'
        """,
        [str(fixture["fixture_id"])],
    )


def _fixture_review_predicates(
    search: str = "",
    *,
    include_approved: bool = False,
    state_filters: list[str] | None = None,
    proposal_available_only: bool = False,
    media_filters: list[str] | None = None,
) -> tuple[list[str], list[Any]]:
    predicates = [
        "(a.missing_at IS NULL OR a.missing_at = '')",
        "lower(COALESCE(a.media_type, 'photo')) NOT LIKE '%video%'",
        """
        NOT EXISTS (
          SELECT 1 FROM sidecar_tombstones AS tombstone
          WHERE tombstone.asset_id = a.asset_id
            AND tombstone.tombstone_state = 'active'
        )
        """,
        "COALESCE(decision.pick_state, '') <> 'hidden'",
    ]
    if not include_approved:
        predicates.append("editorial.editorial_state != 'approved'")
    if state_filters is not None:
        selected_states = {
            str(value or "").strip().casefold()
            for value in state_filters
        } & {"picked", "approved", "hidden"}
        state_predicates: list[str] = []
        if "picked" in selected_states:
            state_predicates.append(
                """
                (
                  current_decision.placement_state = 'picked'
                  AND editorial.editorial_state != 'approved'
                )
                """
            )
        if "approved" in selected_states:
            state_predicates.append(
                """
                (
                  current_decision.placement_state = 'picked'
                  AND editorial.editorial_state = 'approved'
                )
                """
            )
        if "hidden" in selected_states:
            state_predicates.append(
                "current_decision.placement_state = 'hidden'"
            )
        predicates.append(
            "(" + " OR ".join(state_predicates) + ")"
            if state_predicates
            else "0 = 1"
        )
    if proposal_available_only:
        predicates.append(
            """
            EXISTS (
              SELECT 1 FROM asset_ai_proposals AS available_proposal
              WHERE available_proposal.asset_id = a.asset_id
                AND available_proposal.status IN ('ready', 'loaded')
            )
            """
        )
    selected_media = {
        str(value or "").strip().casefold()
        for value in (media_filters if media_filters is not None else ["photos"])
    } & {"photos", "videos"}
    if selected_media != {"photos", "videos"}:
        if not selected_media:
            predicates.append("0 = 1")
        elif selected_media == {"videos"}:
            predicates.append("lower(COALESCE(a.media_type, 'photo')) = 'video'")
        else:
            predicates.append("lower(COALESCE(a.media_type, 'photo')) NOT LIKE '%video%'")
    params: list[Any] = []
    columns = (
        "a.asset_id",
        "a.filename",
        "a.photos_title",
        "a.photos_keywords_json",
        "a.location_label",
        "decision.title",
        "decision.keywords_json",
    )
    for term in re.findall(r"[^\s,;]+", str(search or "").casefold())[:8]:
        escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        predicates.append(
            "(" + " OR ".join(
                f"lower(COALESCE({column}, '')) LIKE ? ESCAPE '\\'"
                for column in columns
            ) + ")"
        )
        params.extend([f"%{escaped}%"] * len(columns))
    return predicates, params


def _photo_library_identifier(row: sqlite3.Row) -> str:
    raw = _read_json(row["raw_json"], {}) if "raw_json" in row.keys() else {}
    local_identifier = str(raw.get("localIdentifier") or "")
    if local_identifier:
        return local_identifier
    source_anchor = str(row["source_anchor"] or "")
    return (
        source_anchor.removeprefix("apple-photos://")
        if source_anchor.startswith("apple-photos://")
        else str(row["asset_id"])
    )


def _review_item(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "assetId": str(row["asset_id"]),
        "sourceVersionId": str(row["source_version_id"] or ""),
        "photoLibraryIdentifier": _photo_library_identifier(row),
        "title": str(row["title"] or ""),
        "caption": str(row["caption"] or ""),
        "keywords": _read_json(row["keywords_json"], []),
        "filename": str(row["filename"] or ""),
        "mediaType": str(row["media_type"] or "photo"),
        "capturedAt": str(row["captured_at"] or ""),
        "locationLabel": _location_label_for_row(row),
        "rating": int(row["rating"] or 0),
        "color": str(row["color"] or ""),
        "placementState": str(row["placement_state"] or "picked"),
        "editorialState": str(row["editorial_state"] or "unreviewed"),
        "aiReasons": _read_json(row["ai_reasons_json"], []),
        "aiNote": str(row["ai_note"] or ""),
        "aiAttemptCount": int(row["ai_attempt_count"] or 0),
        "aiLastError": str(row["ai_last_error"] or ""),
        "aiPreviewReady": bool(str(row["ai_preview_path"] or "")),
        "proposalReady": str(row["proposal_status"] or "") in {"ready", "loaded"},
        "proposalContextAvailable": bool(str(row["proposal_id"] or "")),
        "proposalId": str(row["proposal_id"] or ""),
        "proposedTitle": str(row["proposal_title"] or ""),
        "proposedKeywords": _read_json(row["proposal_keywords_json"], []),
        "proposedCountry": str(row["proposal_country"] or ""),
        "countryProposalSource": str(row["proposal_country_source"] or ""),
        "proposalReason": str(row["proposal_reason"] or ""),
        "proposalStatus": str(row["proposal_status"] or ""),
        "requestedGeneratorModel": str(row["proposal_requested_generator_model"] or ""),
        "resolvedModel": str(row["proposal_resolved_model"] or ""),
        "reasoningEffort": str(row["proposal_reasoning_effort"] or ""),
        "vision": bool(row["proposal_vision"]),
        "modelLadder": _read_json(row["proposal_model_ladder"], []),
        "deliveryState": str(row["delivery_state"] or "not-ready"),
    }


def fixture_review_window(
    repo_root: Path,
    fixture_id: str,
    *,
    mode: str = "backfill",
    state_filters: list[str] | None = None,
    proposal_available_only: bool = False,
    media_filters: list[str] | None = None,
    offset: int = 0,
    limit: int = 200,
    search: str = "",
) -> dict[str, Any]:
    """Return a bounded chronological Review window for one fixture."""
    clean_mode = str(mode or "backfill").strip().casefold()
    if clean_mode not in REVIEW_MODES:
        raise ValueError("review mode is invalid")
    safe_offset = max(0, int(offset or 0))
    safe_limit = max(1, min(500, int(limit or 200)))
    with connect(repo_root) as conn:
        fixture = conn.execute(
            """
            SELECT fixture_id, parent_fixture_id
            FROM fixtures
            WHERE fixture_id = ? AND archived_at IS NULL
            """,
            (fixture_id,),
        ).fetchone()
        if not fixture:
            raise ValueError("fixture does not exist or is archived")
        selected_states = {
            str(value or "").strip().casefold()
            for value in (state_filters or [])
        } & {"picked", "approved", "hidden"}
        from_sql, base_params = _fixture_review_from_sql(
            fixture,
            include_hidden=(
                "hidden" in selected_states
                if state_filters is not None
                else clean_mode == "full"
            ),
        )
        predicates, search_params = _fixture_review_predicates(
            search,
            include_approved=(
                True if state_filters is not None else clean_mode == "full"
            ),
            state_filters=state_filters,
            proposal_available_only=bool(proposal_available_only),
            media_filters=media_filters,
        )
        joins = """
            LEFT JOIN sidecar_decisions AS decision
              ON decision.asset_id = a.asset_id
            JOIN asset_editorial_state AS editorial
              ON editorial.asset_id = a.asset_id
            JOIN asset_delivery_state AS delivery
              ON delivery.asset_id = a.asset_id
            LEFT JOIN asset_source_versions AS latest_source_version
              ON latest_source_version.version_id = (
                SELECT source_version.version_id
                FROM asset_source_versions AS source_version
                WHERE source_version.asset_id = a.asset_id
                ORDER BY source_version.created_at DESC, source_version.version_id DESC
                LIMIT 1
              )
        """
        proposal_join = """
            LEFT JOIN asset_ai_proposals AS available_proposal
              ON available_proposal.proposal_id = (
                SELECT latest_proposal.proposal_id
                FROM asset_ai_proposals AS latest_proposal
                WHERE latest_proposal.asset_id = a.asset_id
                  AND (
                    latest_proposal.status IN ('ready', 'loaded')
                    OR (
                      editorial.editorial_state = 'requesting-ai'
                      AND latest_proposal.status = 'superseded'
                      AND latest_proposal.decided_at = editorial.requested_at
                    )
                  )
                ORDER BY
                  CASE
                    WHEN latest_proposal.status IN ('ready', 'loaded') THEN 0
                    ELSE 1
                  END,
                  latest_proposal.attempt DESC,
                  latest_proposal.created_at DESC,
                  latest_proposal.proposal_id DESC
                LIMIT 1
              )
        """
        params = [*base_params, *search_params]
        where_sql = " AND ".join(predicates)
        summary = conn.execute(
            f"""
            SELECT count(*) total,
                   sum(CASE WHEN editorial.editorial_state = 'unreviewed' THEN 1 ELSE 0 END) unreviewed,
                   sum(CASE WHEN editorial.editorial_state = 'requesting-ai' THEN 1 ELSE 0 END) requesting_ai,
                   sum(CASE WHEN editorial.editorial_state = 'proposed' THEN 1 ELSE 0 END) proposed,
                   sum(CASE WHEN editorial.editorial_state = 'approved' THEN 1 ELSE 0 END) approved
            FROM {from_sql}
            {joins}
            WHERE {where_sql}
            """,
            params,
        ).fetchone()
        rows = conn.execute(
            f"""
            SELECT a.asset_id, a.source_anchor, a.raw_json, a.filename, a.media_type, a.captured_at,
                   a.location_label,
                   latest_source_version.version_id source_version_id,
                   current_decision.placement_state,
                   COALESCE(NULLIF(decision.title, ''), NULLIF(a.photos_title, ''), '') title,
                   COALESCE(decision.caption, '') caption,
                   CASE
                     WHEN COALESCE(decision.metadata_state, 'unreviewed') <> 'unreviewed'
                       THEN COALESCE(decision.keywords_json, '[]')
                     ELSE COALESCE(NULLIF(a.photos_keywords_json, ''), '[]')
                   END keywords_json,
                   COALESCE(decision.rating, 0) rating,
                   COALESCE(decision.color, '') color,
                   editorial.editorial_state, editorial.ai_reasons_json, editorial.ai_note,
                   editorial.ai_attempt_count, editorial.ai_last_error,
                   editorial.ai_preview_path,
                   available_proposal.proposal_id,
                   available_proposal.proposed_title proposal_title,
                   available_proposal.proposed_keywords_json proposal_keywords_json,
                   available_proposal.proposed_country proposal_country,
                   available_proposal.country_source proposal_country_source,
                   available_proposal.reason proposal_reason,
                   available_proposal.status proposal_status,
                   available_proposal.requested_generator_model proposal_requested_generator_model,
                   available_proposal.resolved_model proposal_resolved_model,
                   available_proposal.reasoning_effort proposal_reasoning_effort,
                   available_proposal.vision proposal_vision,
                   available_proposal.model_ladder proposal_model_ladder,
                   delivery.delivery_state
            FROM {from_sql}
            {joins}
            {proposal_join}
            WHERE {where_sql}
            ORDER BY COALESCE(a.captured_at, '') ASC, a.asset_id ASC
            LIMIT ? OFFSET ?
            """,
            [*params, safe_limit, safe_offset],
        ).fetchall()
        country_capability = owner_state_db.country_review_write_capability(conn)
        country_columns = {
            str(column["name"])
            for column in conn.execute("PRAGMA table_info(country_assignments)").fetchall()
        }
        if "asset_id" in country_columns:
            country_missing = int(conn.execute(
                f"""
                SELECT sum(CASE WHEN country.asset_id IS NULL THEN 1 ELSE 0 END)
                FROM {from_sql}
                {joins}
                LEFT JOIN country_assignments AS country
                  ON country.asset_id = a.asset_id
                 AND country.identity_status = 'mapped'
                WHERE {where_sql}
                """,
                params,
            ).fetchone()[0] or 0)
        else:
            country_missing = int(summary["total"] or 0)
        review_items = []
        for row in rows:
            item = _review_item(row)
            item.update(owner_state_db.country_review_context(
                conn,
                str(row["asset_id"]),
                capability=country_capability,
            ))
            review_items.append(item)
    total = int(summary["total"] or 0)
    return {
        "ok": True,
        "readOnly": True,
        "fixtureId": fixture_id,
        "mode": clean_mode,
        "reviewStateFilters": list(
            state_filters
            if state_filters is not None
            else (
                ["picked", "approved", "hidden"]
                if clean_mode == "full"
                else ["picked"]
            )
        ),
        "proposalAvailableOnly": bool(proposal_available_only),
        "mediaFilters": list(
            media_filters if media_filters is not None else ["photos"]
        ),
        "offset": safe_offset,
        "limit": safe_limit,
        "count": len(rows),
        "nextOffset": safe_offset + len(rows),
        "hasNext": safe_offset + len(rows) < total,
        "countryWriteEnabled": bool(country_capability["enabled"]),
        "countryWriteBlockReason": str(country_capability["reason"]),
        "summary": {
            "total": total,
            "unreviewed": int(summary["unreviewed"] or 0),
            "requestingAI": int(summary["requesting_ai"] or 0),
            "proposed": int(summary["proposed"] or 0),
            "approved": int(summary["approved"] or 0),
            "countryMissing": country_missing,
        },
        "items": review_items,
    }


def _ensure_global_decision(
    conn: sqlite3.Connection,
    asset_id: str,
    timestamp: str,
) -> sqlite3.Row:
    conn.execute(
        """
        INSERT OR IGNORE INTO sidecar_decisions (asset_id, created_at, updated_at)
        VALUES (?, ?, ?)
        """,
        (asset_id, timestamp, timestamp),
    )
    return conn.execute(
        "SELECT * FROM sidecar_decisions WHERE asset_id = ?",
        (asset_id,),
    ).fetchone()


def _review_target_ids(
    conn: sqlite3.Connection,
    fixture: sqlite3.Row,
    anchor_asset_id: str,
    *,
    include_anchor: bool,
) -> list[str]:
    anchor = conn.execute(
        "SELECT captured_at FROM sidecar_assets WHERE asset_id = ?",
        (anchor_asset_id,),
    ).fetchone()
    if not anchor or not anchor["captured_at"]:
        return [anchor_asset_id] if include_anchor else []
    from_sql, base_params = _fixture_review_from_sql(fixture)
    predicates, _ = _fixture_review_predicates("")
    operator = ">=" if include_anchor else ">"
    rows = conn.execute(
        f"""
        SELECT a.asset_id
        FROM {from_sql}
        LEFT JOIN sidecar_decisions AS decision ON decision.asset_id = a.asset_id
        JOIN asset_editorial_state AS editorial ON editorial.asset_id = a.asset_id
        WHERE {' AND '.join(predicates)}
          AND datetime(a.captured_at) {operator} datetime(?)
          AND datetime(a.captured_at) <= datetime(?, '+2 hours')
        ORDER BY datetime(a.captured_at), a.asset_id
        """,
        [*base_params, anchor["captured_at"], anchor["captured_at"]],
    ).fetchall()
    return [str(row["asset_id"]) for row in rows]


def _set_delivery_state(
    conn: sqlite3.Connection,
    asset_id: str,
    state: str,
    timestamp: str,
) -> None:
    if state not in DELIVERY_STATES:
        raise ValueError("delivery state is invalid")
    conn.execute(
        """
        INSERT INTO asset_delivery_state (
          asset_id, delivery_state, created_at, updated_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(asset_id) DO UPDATE SET
          delivery_state = excluded.delivery_state,
          updated_at = excluded.updated_at
        """,
        (asset_id, state, timestamp, timestamp),
    )


def _set_fixture_review_placement(
    conn: sqlite3.Connection,
    fixture_id: str,
    asset_id: str,
    placement_state: str,
    *,
    actor: str,
    reason: str,
    timestamp: str,
) -> None:
    existing = conn.execute(
        """
        SELECT placement_state, eligibility_state
        FROM fixture_asset_decisions
        WHERE fixture_id = ? AND asset_id = ?
        """,
        (fixture_id, asset_id),
    ).fetchone()
    before_state = str(existing["placement_state"]) if existing else "undecided"
    before_eligibility = str(existing["eligibility_state"]) if existing else "active"
    conn.execute(
        """
        INSERT INTO fixture_asset_decisions (
          fixture_id, asset_id, placement_state, eligibility_state,
          source, last_action, created_at, updated_at
        ) VALUES (?, ?, ?, 'dormant', 'native', ?, ?, ?)
        ON CONFLICT(fixture_id, asset_id) DO UPDATE SET
          placement_state = excluded.placement_state,
          source = 'native',
          last_action = excluded.last_action,
          updated_at = excluded.updated_at
        """,
        (
            fixture_id,
            asset_id,
            placement_state,
            f"review-{placement_state}",
            timestamp,
            timestamp,
        ),
    )
    _recompute_fixture_eligibility(conn)
    after = conn.execute(
        """
        SELECT eligibility_state
        FROM fixture_asset_decisions
        WHERE fixture_id = ? AND asset_id = ?
        """,
        (fixture_id, asset_id),
    ).fetchone()
    conn.execute(
        """
        INSERT INTO fixture_asset_decision_events (
          event_id, fixture_id, asset_id, before_state, after_state,
          before_eligibility, after_eligibility, action, actor, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            f"fde-{uuid.uuid4().hex[:16]}",
            fixture_id,
            asset_id,
            before_state,
            placement_state,
            before_eligibility,
            str(after["eligibility_state"]),
            placement_state,
            actor,
            reason,
            timestamp,
        ),
    )


def _row_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {str(key): row[key] for key in row.keys()}


def _review_asset_snapshot(
    conn: sqlite3.Connection,
    asset_id: str,
) -> dict[str, Any]:
    return {
        "assetId": asset_id,
        "decision": _row_dict(
            conn.execute(
                "SELECT * FROM sidecar_decisions WHERE asset_id = ?",
                (asset_id,),
            ).fetchone()
        ),
        "editorial": _row_dict(
            conn.execute(
                "SELECT * FROM asset_editorial_state WHERE asset_id = ?",
                (asset_id,),
            ).fetchone()
        ),
        "delivery": _row_dict(
            conn.execute(
                "SELECT * FROM asset_delivery_state WHERE asset_id = ?",
                (asset_id,),
            ).fetchone()
        ),
        "fixtureDecisions": [
            _row_dict(row)
            for row in conn.execute(
                """
                SELECT *
                FROM fixture_asset_decisions
                WHERE asset_id = ?
                ORDER BY fixture_id
                """,
                (asset_id,),
            ).fetchall()
        ],
        "proposals": [
            _row_dict(row)
            for row in conn.execute(
                """
                SELECT *
                FROM asset_ai_proposals
                WHERE asset_id = ?
                ORDER BY proposal_id
                """,
                (asset_id,),
            ).fetchall()
        ],
        "countryAssignment": _row_dict(
            conn.execute(
                "SELECT * FROM country_assignments WHERE asset_id = ?",
                (asset_id,),
            ).fetchone()
        ) if "asset_id" in {
            str(row["name"])
            for row in conn.execute("PRAGMA table_info(country_assignments)").fetchall()
        } else None,
    }


def _review_item_update_from_snapshot(
    conn: sqlite3.Connection,
    fixture_id: str,
    snapshot: dict[str, Any],
) -> dict[str, Any]:
    """Return the small Review projection needed to apply an undo locally."""
    asset_id = str(snapshot.get("assetId") or "")
    asset = conn.execute(
        "SELECT photos_title, photos_keywords_json FROM sidecar_assets WHERE asset_id = ?",
        (asset_id,),
    ).fetchone()
    decision = snapshot.get("decision") or {}
    editorial = snapshot.get("editorial") or {}
    delivery = snapshot.get("delivery") or {}
    country_assignment = snapshot.get("countryAssignment")
    fixture_decision = next(
        (
            item
            for item in snapshot.get("fixtureDecisions") or []
            if isinstance(item, dict) and str(item.get("fixture_id") or "") == fixture_id
        ),
        None,
    ) or {}
    proposals = [
        item
        for item in snapshot.get("proposals") or []
        if isinstance(item, dict)
    ]
    available = [
        item
        for item in proposals
        if str(item.get("status") or "") in {"ready", "loaded"}
    ]
    if not available and str(editorial.get("editorial_state") or "") == "requesting-ai":
        requested_at = str(editorial.get("requested_at") or "")
        available = [
            item
            for item in proposals
            if str(item.get("status") or "") == "superseded"
            and str(item.get("decided_at") or "") == requested_at
        ]
    proposal = max(
        available,
        key=lambda item: (
            int(item.get("attempt") or 0),
            str(item.get("created_at") or ""),
            str(item.get("proposal_id") or ""),
        ),
        default=None,
    )
    decision_title = str(decision.get("title") or "").strip()
    decision_keywords = _read_json(decision.get("keywords_json"), [])
    if not decision_title and asset:
        decision_title = str(asset["photos_title"] or "")
    if not decision_keywords and asset:
        decision_keywords = _read_json(asset["photos_keywords_json"], [])
    proposal_status = str(proposal.get("status") or "") if proposal else ""
    return {
        "title": decision_title,
        "caption": str(decision.get("caption") or ""),
        "keywords": decision_keywords if isinstance(decision_keywords, list) else [],
        "rating": int(decision.get("rating") or 0),
        "color": str(decision.get("color") or ""),
        "placementState": str(fixture_decision.get("placement_state") or "picked"),
        "editorialState": str(editorial.get("editorial_state") or "unreviewed"),
        "aiReasons": _read_json(editorial.get("ai_reasons_json"), []),
        "aiNote": str(editorial.get("ai_note") or ""),
        "aiAttemptCount": int(editorial.get("ai_attempt_count") or 0),
        "aiLastError": str(editorial.get("ai_last_error") or ""),
        "proposalReady": proposal_status in {"ready", "loaded"},
        "proposalContextAvailable": proposal is not None,
        "proposalId": str(proposal.get("proposal_id") or "") if proposal else "",
        "proposedTitle": str(proposal.get("proposed_title") or "") if proposal else "",
        "proposedKeywords": _read_json(proposal.get("proposed_keywords_json"), []) if proposal else [],
        "proposedCountry": str(proposal.get("proposed_country") or "") if proposal else "",
        "countryProposalSource": str(proposal.get("country_source") or "") if proposal else "",
        "proposalReason": str(proposal.get("reason") or "") if proposal else "",
        "proposalStatus": proposal_status,
        "requestedGeneratorModel": str(proposal.get("requested_generator_model") or "") if proposal else "",
        "resolvedModel": str(proposal.get("resolved_model") or proposal.get("generator_model") or "") if proposal else "",
        "reasoningEffort": str(proposal.get("reasoning_effort") or "") if proposal else "",
        "vision": bool(proposal.get("vision")) if proposal else False,
        "modelLadder": _read_json(proposal.get("model_ladder"), []) if proposal else [],
        "deliveryState": str(delivery.get("delivery_state") or "not-ready"),
        "country": str(country_assignment.get("country_slug") or "")
        if isinstance(country_assignment, dict) else "",
    }


def _upsert_snapshot_row(
    conn: sqlite3.Connection,
    table: str,
    row: dict[str, Any],
    conflict_columns: tuple[str, ...],
) -> None:
    allowed_tables = {
        "sidecar_decisions",
        "asset_editorial_state",
        "asset_delivery_state",
        "fixture_asset_decisions",
        "asset_ai_proposals",
        "country_assignments",
    }
    if table not in allowed_tables:
        raise ValueError("review snapshot table is invalid")
    schema_columns = {
        str(item["name"])
        for item in conn.execute(f"PRAGMA table_info({table})").fetchall()
    }
    columns = [column for column in row if column in schema_columns]
    if not columns or any(column not in columns for column in conflict_columns):
        raise ValueError(f"review snapshot is invalid for {table}")
    update_columns = [column for column in columns if column not in conflict_columns]
    column_sql = ", ".join(columns)
    value_sql = ", ".join("?" for _ in columns)
    conflict_sql = ", ".join(conflict_columns)
    update_sql = ", ".join(f"{column} = excluded.{column}" for column in update_columns)
    conn.execute(
        f"""
        INSERT INTO {table} ({column_sql})
        VALUES ({value_sql})
        ON CONFLICT({conflict_sql}) DO UPDATE SET {update_sql}
        """,
        [row[column] for column in columns],
    )


def _restore_review_asset_snapshot(
    conn: sqlite3.Connection,
    snapshot: dict[str, Any],
) -> None:
    asset_id = str(snapshot.get("assetId") or "").strip()
    if not asset_id:
        raise ValueError("review snapshot asset is missing")
    decision = snapshot.get("decision")
    editorial = snapshot.get("editorial")
    delivery = snapshot.get("delivery")
    if not isinstance(decision, dict) or not isinstance(editorial, dict):
        raise ValueError(f"review snapshot is incomplete: {asset_id}")
    _upsert_snapshot_row(
        conn,
        "sidecar_decisions",
        decision,
        ("asset_id",),
    )
    _upsert_snapshot_row(
        conn,
        "asset_editorial_state",
        editorial,
        ("asset_id",),
    )
    if isinstance(delivery, dict):
        _upsert_snapshot_row(
            conn,
            "asset_delivery_state",
            delivery,
            ("asset_id",),
        )
    else:
        conn.execute(
            "DELETE FROM asset_delivery_state WHERE asset_id = ?",
            (asset_id,),
        )
    conn.execute(
        "DELETE FROM fixture_asset_decisions WHERE asset_id = ?",
        (asset_id,),
    )
    for fixture_decision in snapshot.get("fixtureDecisions") or []:
        if not isinstance(fixture_decision, dict):
            raise ValueError(f"review fixture snapshot is invalid: {asset_id}")
        _upsert_snapshot_row(
            conn,
            "fixture_asset_decisions",
            fixture_decision,
            ("fixture_id", "asset_id"),
        )
    conn.execute(
        "DELETE FROM asset_ai_proposals WHERE asset_id = ?",
        (asset_id,),
    )
    for proposal in snapshot.get("proposals") or []:
        if not isinstance(proposal, dict):
            raise ValueError(f"review proposal snapshot is invalid: {asset_id}")
        _upsert_snapshot_row(
            conn,
            "asset_ai_proposals",
            proposal,
            ("proposal_id",),
        )
    if "asset_id" in {
        str(row["name"])
        for row in conn.execute("PRAGMA table_info(country_assignments)").fetchall()
    }:
        conn.execute("DELETE FROM country_assignments WHERE asset_id = ?", (asset_id,))
        country_assignment = snapshot.get("countryAssignment")
        if isinstance(country_assignment, dict):
            _upsert_snapshot_row(
                conn,
                "country_assignments",
                country_assignment,
                ("assignment_id",),
            )


def apply_fixture_review_action(
    repo_root: Path,
    fixture_id: str,
    asset_ids: Iterable[str],
    action: str,
    *,
    anchor_asset_id: str = "",
    propagate: bool = False,
    title: str | None = None,
    keywords: Iterable[Any] | None = None,
    country: str | None = None,
    proposal_id: str | None = None,
    ai_reasons: Iterable[Any] | None = None,
    ai_note: str = "",
    actor: str = "owner",
) -> dict[str, Any]:
    """Apply one audited Review action, including server-side shoot propagation."""
    clean_action = str(action or "").strip().casefold()
    if clean_action not in REVIEW_ACTIONS:
        raise ValueError("unsupported fixture review action")
    clean_ids = _unique(asset_ids)
    clean_anchor = str(anchor_asset_id or "").strip() or (clean_ids[-1] if clean_ids else "")
    expected_proposal_id = str(proposal_id or "").strip()
    if not clean_anchor:
        raise ValueError("at least one review asset is required")
    timestamp = now_iso()
    operation_id = f"reviewop-{uuid.uuid4().hex[:20]}"
    local_transaction_timing: dict[str, Any] | None = None
    with connect(repo_root) as conn:
        local_transaction_started_at = now_iso()
        local_transaction_started_clock = time.perf_counter()
        fixture = conn.execute(
            """
            SELECT fixture_id, parent_fixture_id
            FROM fixtures
            WHERE fixture_id = ? AND archived_at IS NULL
            """,
            (fixture_id,),
        ).fetchone()
        if not fixture:
            raise ValueError("fixture does not exist or is archived")
        if propagate or clean_action in {"propagate-country", "propagate-title", "propagate-keywords"}:
            propagated = _review_target_ids(
                conn,
                fixture,
                clean_anchor,
                include_anchor=clean_action not in {"propagate-country", "propagate-title", "propagate-keywords"},
            )
            clean_ids = _unique([*clean_ids, *propagated])
        if not clean_ids:
            raise ValueError("review action has no eligible targets")

        decisions: dict[str, sqlite3.Row] = {}
        assets: dict[str, sqlite3.Row] = {}
        active_proposals: dict[str, sqlite3.Row | None] = {}
        for asset_id in clean_ids:
            asset = conn.execute(
                """
                SELECT photos_title, photos_keywords_json
                FROM sidecar_assets
                WHERE asset_id = ?
                """,
                (asset_id,),
            ).fetchone()
            if not asset:
                raise ValueError(f"asset is not indexed: {asset_id}")
            assets[asset_id] = asset
            if not conn.execute(
                "SELECT 1 FROM asset_editorial_state WHERE asset_id = ?",
                (asset_id,),
            ).fetchone():
                raise ValueError(f"editorial state is missing: {asset_id}")
            decisions[asset_id] = _ensure_global_decision(conn, asset_id, timestamp)
            active_proposals[asset_id] = conn.execute(
                """
                SELECT proposal_id, proposed_title, proposed_keywords_json, proposed_country
                FROM asset_ai_proposals
                WHERE asset_id = ? AND status IN ('ready', 'loaded')
                ORDER BY attempt DESC, created_at DESC, proposal_id DESC
                LIMIT 1
                """,
                (asset_id,),
            ).fetchone()

        if clean_action == "approve" and expected_proposal_id:
            active_anchor_proposal = active_proposals[clean_anchor]
            if (
                not active_anchor_proposal
                or str(active_anchor_proposal["proposal_id"]) != expected_proposal_id
            ):
                raise ValueError(
                    "the visible AI proposal was superseded or is no longer active; refresh Review before approving"
                )

        def effective_metadata(
            decision: sqlite3.Row,
            asset: sqlite3.Row,
        ) -> tuple[str, list[str]]:
            decision_title = str(decision["title"] or "").strip()
            decision_keywords = _read_json(decision["keywords_json"], [])
            return (
                decision_title or str(asset["photos_title"] or "").strip(),
                decision_keywords
                or _read_json(asset["photos_keywords_json"], []),
            )

        explicit_title = str(title).strip() if title is not None else None
        explicit_keywords = _unique(keywords or []) if keywords is not None else None
        explicit_country = str(country or "").strip().casefold() if country is not None else None
        source_decision = decisions[clean_anchor]
        source_effective_title, source_effective_keywords = effective_metadata(
            source_decision,
            assets[clean_anchor],
        )
        source_title = (
            explicit_title
            if explicit_title is not None
            else source_effective_title
        )
        source_keywords = (
            explicit_keywords
            if explicit_keywords is not None
            else source_effective_keywords
        )
        source_country = (
            explicit_country
            if explicit_country is not None
            else str(owner_state_db.country_review_context(conn, clean_anchor)["country"])
        )
        reasons = _unique(ai_reasons or [])
        note = str(ai_note or "").strip()
        items: list[dict[str, Any]] = []
        before_snapshots = [
            _review_asset_snapshot(conn, asset_id)
            for asset_id in clean_ids
        ]
        for asset_id in clean_ids:
            before_editorial = conn.execute(
                "SELECT * FROM asset_editorial_state WHERE asset_id = ?",
                (asset_id,),
            ).fetchone()
            decision = decisions[asset_id]
            before_title, before_keywords = effective_metadata(
                decision,
                assets[asset_id],
            )
            before = {
                "editorialState": str(before_editorial["editorial_state"]),
                "aiReasons": _read_json(before_editorial["ai_reasons_json"], []),
                "aiNote": str(before_editorial["ai_note"] or ""),
                "title": before_title,
                "keywords": before_keywords,
                "country": str(owner_state_db.country_review_context(conn, asset_id)["country"]),
            }
            after_state = before["editorialState"]
            after_reasons = before["aiReasons"]
            after_note = before["aiNote"]

            if clean_action == "hide":
                _set_fixture_review_placement(
                    conn,
                    fixture_id,
                    asset_id,
                    "hidden",
                    actor=actor,
                    reason="native review hide",
                    timestamp=timestamp,
                )
                after_state = "unreviewed"
                after_reasons = []
                after_note = ""
            elif clean_action == "approve":
                after_state = "approved"
                after_reasons = []
                after_note = ""
                active_proposal = active_proposals[asset_id]
                use_explicit_anchor_metadata = asset_id == clean_anchor
                approved_title = (
                    explicit_title
                    if use_explicit_anchor_metadata and explicit_title is not None
                    else str(active_proposal["proposed_title"] or "").strip()
                    if active_proposal
                    else str(decision["title"] or "")
                )
                approved_keywords = (
                    explicit_keywords
                    if use_explicit_anchor_metadata and explicit_keywords is not None
                    else _read_json(active_proposal["proposed_keywords_json"], [])
                    if active_proposal
                    else _read_json(decision["keywords_json"], [])
                )
                approved_country = (
                    explicit_country
                    if use_explicit_anchor_metadata and explicit_country is not None
                    else str(active_proposal["proposed_country"] or "").strip().casefold()
                    if active_proposal and str(active_proposal["proposed_country"] or "").strip()
                    else None
                )
                conn.execute(
                    """
                    UPDATE sidecar_decisions
                    SET metadata_state = 'approved',
                        title = ?, keywords_json = ?,
                        last_action = 'approve', updated_at = ?
                    WHERE asset_id = ?
                    """,
                    (
                        approved_title,
                        _json(approved_keywords),
                        timestamp,
                        asset_id,
                    ),
                )
                _set_delivery_state(conn, asset_id, "needs-upload", timestamp)
                if approved_country is not None:
                    owner_state_db.set_review_country_assignment(
                        conn,
                        asset_id,
                        approved_country,
                        actor=actor,
                        updated_at=timestamp,
                    )
            elif clean_action == "return-to-review":
                delivery = conn.execute(
                    """
                    SELECT delivery_state
                    FROM asset_delivery_state
                    WHERE asset_id = ?
                    """,
                    (asset_id,),
                ).fetchone()
                if before["editorialState"] != "approved":
                    raise ValueError(f"asset is not approved: {asset_id}")
                if delivery and str(delivery["delivery_state"]) == "live":
                    raise ValueError(f"live asset cannot return to Review: {asset_id}")
                after_state = "unreviewed"
                after_reasons = []
                after_note = ""
                conn.execute(
                    """
                    UPDATE sidecar_decisions
                    SET metadata_state = 'unreviewed',
                        last_action = 'return-to-review',
                        updated_at = ?
                    WHERE asset_id = ?
                    """,
                    (timestamp, asset_id),
                )
                _set_delivery_state(conn, asset_id, "not-ready", timestamp)
            elif clean_action == "request-ai":
                has_ai_request = bool(reasons or note)
                after_state = "requesting-ai" if has_ai_request else "unreviewed"
                after_reasons = reasons
                after_note = note if has_ai_request else ""
                conn.execute(
                    """
                    UPDATE asset_ai_proposals
                    SET status = 'superseded', decided_at = ?
                    WHERE asset_id = ? AND status IN ('ready', 'loaded')
                    """,
                    (timestamp, asset_id),
                )
                _set_fixture_review_placement(
                    conn,
                    fixture_id,
                    asset_id,
                    "picked",
                    actor=actor,
                    reason="native review AI request",
                    timestamp=timestamp,
                )
            elif clean_action == "edit-metadata":
                if title is not None:
                    conn.execute(
                        "UPDATE sidecar_decisions SET title = ?, last_action = 'metadata', updated_at = ? WHERE asset_id = ?",
                        (str(title).strip(), timestamp, asset_id),
                    )
                if keywords is not None:
                    conn.execute(
                        "UPDATE sidecar_decisions SET keywords_json = ?, last_action = 'metadata', updated_at = ? WHERE asset_id = ?",
                        (_json(_unique(keywords)), timestamp, asset_id),
                    )
                if explicit_country is not None:
                    owner_state_db.set_review_country_assignment(
                        conn,
                        asset_id,
                        explicit_country,
                        actor=actor,
                        updated_at=timestamp,
                    )
                if after_state == "approved":
                    _set_delivery_state(conn, asset_id, "needs-upload", timestamp)
                elif after_state == "proposed":
                    after_state = "unreviewed"
                    conn.execute(
                        """
                        UPDATE asset_ai_proposals
                        SET status = 'accepted', decided_at = ?
                        WHERE asset_id = ? AND status IN ('ready', 'loaded')
                        """,
                        (timestamp, asset_id),
                    )
            elif clean_action == "propagate-title":
                conn.execute(
                    "UPDATE sidecar_decisions SET title = ?, last_action = 'metadata', updated_at = ? WHERE asset_id = ?",
                    (source_title, timestamp, asset_id),
                )
                if after_state == "approved":
                    _set_delivery_state(conn, asset_id, "needs-upload", timestamp)
            elif clean_action == "propagate-keywords":
                conn.execute(
                    "UPDATE sidecar_decisions SET keywords_json = ?, last_action = 'metadata', updated_at = ? WHERE asset_id = ?",
                    (_json(source_keywords), timestamp, asset_id),
                )
                if after_state == "approved":
                    _set_delivery_state(conn, asset_id, "needs-upload", timestamp)
            elif clean_action == "propagate-country":
                owner_state_db.set_review_country_assignment(
                    conn,
                    asset_id,
                    source_country,
                    actor=actor,
                    updated_at=timestamp,
                )
                if after_state == "approved":
                    _set_delivery_state(conn, asset_id, "needs-upload", timestamp)

            approved_at = (
                timestamp
                if after_state == "approved"
                else None
                if clean_action == "return-to-review"
                else before_editorial["approved_at"]
            )
            requested_at = timestamp if after_state == "requesting-ai" else None
            if clean_action == "approve" and active_proposals[asset_id]:
                accepted_proposal_id = str(active_proposals[asset_id]["proposal_id"])
                conn.execute(
                    """
                    UPDATE asset_ai_proposals
                    SET status = 'accepted', decided_at = ?
                    WHERE proposal_id = ?
                    """,
                    (timestamp, accepted_proposal_id),
                )
                conn.execute(
                    """
                    UPDATE asset_ai_proposals
                    SET status = 'superseded', decided_at = ?
                    WHERE asset_id = ? AND status IN ('ready', 'loaded')
                      AND proposal_id != ?
                    """,
                    (timestamp, asset_id, accepted_proposal_id),
                )
            elif clean_action == "hide":
                conn.execute(
                    """
                    UPDATE asset_ai_proposals
                    SET status = 'superseded', decided_at = ?
                    WHERE asset_id = ? AND status IN ('ready', 'loaded')
                    """,
                    (timestamp, asset_id),
                )
            conn.execute(
                """
                UPDATE asset_editorial_state
                SET editorial_state = ?, ai_reasons_json = ?, ai_note = ?,
                    requested_at = ?, approved_at = ?, updated_at = ?
                WHERE asset_id = ?
                """,
                (
                    after_state,
                    _json(after_reasons),
                    after_note,
                    requested_at,
                    approved_at,
                    timestamp,
                    asset_id,
                ),
            )
            updated_decision = conn.execute(
                "SELECT title, keywords_json FROM sidecar_decisions WHERE asset_id = ?",
                (asset_id,),
            ).fetchone()
            after_title, after_keywords = effective_metadata(
                updated_decision,
                assets[asset_id],
            )
            after = {
                "editorialState": after_state,
                "aiReasons": after_reasons,
                "aiNote": after_note,
                "title": after_title,
                "keywords": after_keywords,
                "country": str(owner_state_db.country_review_context(conn, asset_id)["country"]),
            }
            conn.execute(
                """
                INSERT INTO asset_editorial_events (
                  event_id, asset_id, fixture_id, action, before_state, after_state,
                  before_json, after_json, actor, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"aee-{uuid.uuid4().hex[:16]}",
                    asset_id,
                    fixture_id,
                    clean_action,
                    before["editorialState"],
                    after_state,
                    _json(before),
                    _json(after),
                    actor,
                    timestamp,
                ),
            )
            items.append({"assetId": asset_id, "before": before, "after": after})
        after_snapshots = [
            _review_asset_snapshot(conn, asset_id)
            for asset_id in clean_ids
        ]
        conn.execute(
            """
            INSERT INTO fixture_review_operations (
              operation_id, fixture_id, action, anchor_asset_id, propagated,
              asset_ids_json, before_json, after_json, state, actor, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'applied', ?, ?)
            """,
            (
                operation_id,
                fixture_id,
                clean_action,
                clean_anchor,
                int(bool(propagate or clean_action.startswith("propagate-"))),
                _json(clean_ids),
                _json(before_snapshots),
                _json(after_snapshots),
                actor,
                timestamp,
            ),
        )
        conn.commit()
        local_transaction_timing = _local_transaction_timing(
            local_transaction_started_at,
            local_transaction_started_clock,
        )
    return {
        "ok": True,
        "operationId": operation_id,
        "fixtureId": fixture_id,
        "action": clean_action,
        "anchorAssetId": clean_anchor,
        "proposalId": expected_proposal_id,
        "propagated": bool(propagate or clean_action.startswith("propagate-")),
        "count": len(items),
        "items": items,
        "timing": {"localTransaction": local_transaction_timing or {}},
    }


def undo_fixture_review_action(
    repo_root: Path,
    operation_id: str,
    *,
    actor: str = "owner",
) -> dict[str, Any]:
    """Undo one exact Review operation when its resulting state is still current."""
    clean_operation_id = str(operation_id or "").strip()
    if not clean_operation_id:
        raise ValueError("review operation ID is required")
    timestamp = now_iso()
    local_transaction_timing: dict[str, Any] | None = None
    with connect(repo_root) as conn:
        local_transaction_started_at = now_iso()
        local_transaction_started_clock = time.perf_counter()
        operation = conn.execute(
            """
            SELECT *
            FROM fixture_review_operations
            WHERE operation_id = ?
            """,
            (clean_operation_id,),
        ).fetchone()
        if not operation:
            raise ValueError("review operation does not exist")
        before_snapshots = _read_json(operation["before_json"], [])
        after_snapshots = _read_json(operation["after_json"], [])
        if not isinstance(before_snapshots, list) or not isinstance(after_snapshots, list):
            raise ValueError("review operation snapshot is invalid")
        if str(operation["state"]) == "undone":
            return {
                "ok": True,
                "operationId": clean_operation_id,
                "fixtureId": str(operation["fixture_id"]),
                "action": str(operation["action"]),
                "count": len(before_snapshots),
                "alreadyUndone": True,
                "items": [],
            }
        if str(operation["state"]) != "applied":
            raise ValueError("review operation is not undoable")

        current_snapshots = [
            _review_asset_snapshot(conn, str(snapshot.get("assetId") or ""))
            for snapshot in after_snapshots
            if isinstance(snapshot, dict)
        ]
        if len(current_snapshots) != len(after_snapshots):
            raise ValueError("review operation after snapshot is invalid")
        if _json(current_snapshots) != _json(after_snapshots):
            raise ValueError(
                "review state changed after this operation; reload before undoing"
            )

        items: list[dict[str, Any]] = []
        for before_snapshot, current_snapshot in zip(
            before_snapshots,
            current_snapshots,
        ):
            if not isinstance(before_snapshot, dict):
                raise ValueError("review operation before snapshot is invalid")
            asset_id = str(before_snapshot.get("assetId") or "")
            current_editorial = current_snapshot.get("editorial") or {}
            current_fixture_decisions = {
                str(item.get("fixture_id") or ""): item
                for item in current_snapshot.get("fixtureDecisions") or []
                if isinstance(item, dict)
            }
            _restore_review_asset_snapshot(conn, before_snapshot)
            restored_snapshot = _review_asset_snapshot(conn, asset_id)
            restored_editorial = restored_snapshot.get("editorial") or {}
            conn.execute(
                """
                INSERT INTO asset_editorial_events (
                  event_id, asset_id, fixture_id, action, before_state, after_state,
                  before_json, after_json, actor, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    f"aee-{uuid.uuid4().hex[:16]}",
                    asset_id,
                    str(operation["fixture_id"]),
                    f"undo-{operation['action']}",
                    str(current_editorial.get("editorial_state") or ""),
                    str(restored_editorial.get("editorial_state") or ""),
                    _json(current_snapshot),
                    _json(restored_snapshot),
                    actor,
                    timestamp,
                ),
            )
            restored_fixture_decisions = {
                str(item.get("fixture_id") or ""): item
                for item in restored_snapshot.get("fixtureDecisions") or []
                if isinstance(item, dict)
            }
            for changed_fixture_id in sorted(
                set(current_fixture_decisions) | set(restored_fixture_decisions)
            ):
                current_decision = current_fixture_decisions.get(changed_fixture_id) or {}
                restored_decision = restored_fixture_decisions.get(changed_fixture_id) or {}
                if _json(current_decision) == _json(restored_decision):
                    continue
                conn.execute(
                    """
                    INSERT INTO fixture_asset_decision_events (
                      event_id, fixture_id, asset_id, before_state, after_state,
                      before_eligibility, after_eligibility, action, actor, reason,
                      created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        f"fde-{uuid.uuid4().hex[:16]}",
                        changed_fixture_id,
                        asset_id,
                        str(current_decision.get("placement_state") or "undecided"),
                        str(restored_decision.get("placement_state") or "undecided"),
                        str(current_decision.get("eligibility_state") or "active"),
                        str(restored_decision.get("eligibility_state") or "active"),
                        f"undo-{operation['action']}",
                        actor,
                        f"undo Review operation {clean_operation_id}",
                        timestamp,
                    ),
                )
            items.append(
                {
                    "assetId": asset_id,
                    "before": current_snapshot,
                    "after": restored_snapshot,
                    "review": _review_item_update_from_snapshot(
                        conn,
                        str(operation["fixture_id"]),
                        restored_snapshot,
                    ),
                }
            )
        conn.execute(
            """
            UPDATE fixture_review_operations
            SET state = 'undone', undone_at = ?
            WHERE operation_id = ? AND state = 'applied'
            """,
            (timestamp, clean_operation_id),
        )
        conn.commit()
        local_transaction_timing = _local_transaction_timing(
            local_transaction_started_at,
            local_transaction_started_clock,
        )
    return {
        "ok": True,
        "operationId": clean_operation_id,
        "fixtureId": str(operation["fixture_id"]),
        "action": str(operation["action"]),
        "count": len(items),
        "alreadyUndone": False,
        "items": items,
        "timing": {"localTransaction": local_transaction_timing or {}},
    }


def ai_preview_targets(
    repo_root: Path,
    asset_ids: Iterable[str],
) -> list[dict[str, str]]:
    """Return exact PhotoKit identifiers for requested items missing a bounded preview."""
    selected = _unique(asset_ids)
    if not selected:
        return []
    with connect(repo_root) as conn:
        rows = conn.execute(
            f"""
            SELECT a.asset_id, a.source_anchor, editorial.ai_preview_path
            FROM sidecar_assets AS a
            JOIN asset_editorial_state AS editorial
              ON editorial.asset_id = a.asset_id
            WHERE a.asset_id IN ({','.join('?' for _ in selected)})
              AND editorial.editorial_state = 'requesting-ai'
            ORDER BY a.asset_id
            """,
            selected,
        ).fetchall()
    targets: list[dict[str, str]] = []
    for row in rows:
        existing = Path(str(row["ai_preview_path"] or ""))
        if existing.is_file():
            continue
        anchor = str(row["source_anchor"] or "")
        photo_id = (
            anchor.removeprefix("apple-photos://")
            if anchor.startswith("apple-photos://")
            else str(row["asset_id"])
        )
        targets.append({"assetId": str(row["asset_id"]), "photoLibraryIdentifier": photo_id})
    return targets


def record_ai_preview(
    repo_root: Path,
    asset_id: str,
    preview_path: Path,
) -> dict[str, Any]:
    """Attach one bounded local JPEG to an existing explicit AI request."""
    resolved = preview_path.expanduser().resolve()
    if not resolved.is_file():
        raise ValueError("AI request preview does not exist")
    digest = hashlib.sha256(resolved.read_bytes()).hexdigest()
    timestamp = now_iso()
    with connect(repo_root) as conn:
        row = conn.execute(
            "SELECT editorial_state FROM asset_editorial_state WHERE asset_id = ?",
            (asset_id,),
        ).fetchone()
        if not row or row["editorial_state"] != "requesting-ai":
            raise ValueError("AI preview can only be attached to a requested item")
        conn.execute(
            """
            UPDATE asset_editorial_state
            SET ai_preview_path = ?, ai_preview_sha256 = ?, updated_at = ?
            WHERE asset_id = ?
            """,
            (str(resolved), digest, timestamp, asset_id),
        )
        conn.commit()
    return {
        "ok": True,
        "assetId": asset_id,
        "previewPath": str(resolved),
        "previewSha256": digest,
    }


def ready_ai_proposals(
    repo_root: Path,
    *,
    asset_ids: Iterable[str] = (),
    include_loaded: bool = False,
) -> dict[str, Any]:
    """Read proposal drafts without changing canonical editorial metadata."""
    selected = _unique(asset_ids)
    statuses = ("ready", "loaded") if include_loaded else ("ready",)
    where = [f"proposal.status IN ({','.join('?' for _ in statuses)})"]
    params: list[Any] = list(statuses)
    if selected:
        where.append(f"proposal.asset_id IN ({','.join('?' for _ in selected)})")
        params.extend(selected)
    with connect(repo_root) as conn:
        rows = conn.execute(
            f"""
            SELECT proposal.*, editorial.editorial_state,
                   COALESCE(decision.title, '') canonical_title,
                   COALESCE(decision.keywords_json, '[]') canonical_keywords_json
            FROM asset_ai_proposals AS proposal
            JOIN asset_editorial_state AS editorial
              ON editorial.asset_id = proposal.asset_id
            LEFT JOIN sidecar_decisions AS decision
              ON decision.asset_id = proposal.asset_id
            WHERE {' AND '.join(where)}
            ORDER BY proposal.created_at, proposal.asset_id
            """,
            params,
        ).fetchall()
    items = [{
        "proposalId": str(row["proposal_id"]),
        "status": str(row["status"]),
        "assetId": str(row["asset_id"]),
        "runId": str(row["run_id"]),
        "attempt": int(row["attempt"]),
        "previousTitle": str(row["previous_title"] or ""),
        "previousKeywords": _read_json(row["previous_keywords_json"], []),
        "previousCountry": str(row["previous_country"] or ""),
        "canonicalTitle": str(row["canonical_title"] or ""),
        "canonicalKeywords": _read_json(row["canonical_keywords_json"], []),
        "proposedTitle": str(row["proposed_title"] or ""),
        "proposedKeywords": _read_json(row["proposed_keywords_json"], []),
        "proposedCountry": str(row["proposed_country"] or ""),
        "countryProposalSource": str(row["country_source"] or ""),
        "confidence": str(row["confidence"] or ""),
        "reason": str(row["reason"] or ""),
        "needsOwnerContext": bool(row["needs_owner_context"]),
        "requestReasons": _read_json(row["request_reasons_json"], []),
        "requestNote": str(row["request_note"] or ""),
        "requestedGeneratorModel": str(row["requested_generator_model"] or ""),
        "resolvedModel": str(row["resolved_model"] or row["generator_model"] or ""),
        "reasoningEffort": str(row["reasoning_effort"] or ""),
        "vision": bool(row["vision"]),
        "modelLadder": _read_json(row["model_ladder"], []),
        "createdAt": str(row["created_at"]),
    } for row in rows]
    return {"ok": True, "count": len(items), "items": items}


def mark_ai_proposals_loaded(
    repo_root: Path,
    proposal_ids: Iterable[str],
) -> dict[str, Any]:
    """Audit that ready proposals were loaded as drafts; never alter canonical T/K."""
    selected = _unique(proposal_ids)
    if not selected:
        return {"ok": True, "count": 0, "proposalIds": []}
    timestamp = now_iso()
    with connect(repo_root) as conn:
        cursor = conn.execute(
            f"""
            UPDATE asset_ai_proposals
            SET status = 'loaded', loaded_at = ?
            WHERE proposal_id IN ({','.join('?' for _ in selected)})
              AND status = 'ready'
            """,
            [timestamp, *selected],
        )
        changed = max(0, int(cursor.rowcount))
        conn.commit()
    return {"ok": True, "count": changed, "proposalIds": selected}


def ai_run_status(repo_root: Path) -> dict[str, Any]:
    """Return the active/latest AI pass and the durable ready-proposal count."""
    conn = connect_read_only(repo_root)
    try:
        active = conn.execute(
            """
            SELECT * FROM asset_ai_runs
            WHERE status IN ('queued', 'running')
            ORDER BY created_at DESC LIMIT 1
            """
        ).fetchone()
        latest = active or conn.execute(
            "SELECT * FROM asset_ai_runs ORDER BY created_at DESC LIMIT 1"
        ).fetchone()
        requested = int(conn.execute(
            "SELECT count(*) FROM asset_editorial_state WHERE editorial_state = 'requesting-ai'"
        ).fetchone()[0])
        ready = int(conn.execute(
            "SELECT count(*) FROM asset_ai_proposals WHERE status = 'ready'"
        ).fetchone()[0])
    finally:
        conn.close()
    if not latest:
        return {
            "ok": True,
            "active": False,
            "requested": requested,
            "ready": ready,
            "run": {},
        }
    started = str(latest["started_at"] or latest["created_at"])
    elapsed = 0.0
    try:
        elapsed = max(
            0.0,
            (
                datetime.now(timezone.utc)
                - datetime.fromisoformat(started.replace("Z", "+00:00"))
            ).total_seconds(),
        )
    except ValueError:
        pass
    return {
        "ok": True,
        "active": str(latest["status"]) in {"queued", "running"},
        "requested": requested,
        "ready": ready,
        "run": {
            "runId": str(latest["run_id"]),
            "trigger": str(latest["trigger"]),
            "status": str(latest["status"]),
            "requested": int(latest["requested_count"]),
            "processed": int(latest["processed_count"]),
            "proposed": int(latest["proposed_count"]),
            "skipped": int(latest["skipped_count"]),
            "failed": int(latest["failed_count"]),
            "remaining": int(latest["remaining_count"]),
            "cancelRequested": bool(latest["cancel_requested"]),
            "elapsedSeconds": round(elapsed, 1),
            "lastError": str(latest["last_error"] or ""),
            "startedAt": str(latest["started_at"] or ""),
            "completedAt": str(latest["completed_at"] or ""),
        },
    }


def request_ai_run_cancel(repo_root: Path) -> dict[str, Any]:
    timestamp = now_iso()
    with connect(repo_root) as conn:
        row = conn.execute(
            """
            SELECT run_id FROM asset_ai_runs
            WHERE status IN ('queued', 'running')
            ORDER BY created_at DESC LIMIT 1
            """
        ).fetchone()
        if not row:
            return {"ok": True, "active": False, "runId": ""}
        conn.execute(
            "UPDATE asset_ai_runs SET cancel_requested = 1, updated_at = ? WHERE run_id = ?",
            (timestamp, row["run_id"]),
        )
        conn.commit()
    return {"ok": True, "active": True, "runId": str(row["run_id"])}


def effective_fixture_access_grants(repo_root: Path, fixture_id: str) -> list[dict[str, Any]]:
    """Resolve direct plus inheritable ancestor grants; never include descendants."""
    with connect(repo_root) as conn:
        breadcrumbs = fixture_breadcrumbs(conn, fixture_id)
        fixture_ids = [item["fixtureId"] for item in breadcrumbs]
        placeholders = ",".join("?" for _ in fixture_ids)
        rows = conn.execute(
            f"""
            SELECT g.*, f.name fixture_name
            FROM fixture_access_grants g
            JOIN fixtures f ON f.fixture_id = g.fixture_id
            WHERE g.state = 'active'
              AND g.fixture_id IN ({placeholders})
              AND (g.fixture_id = ? OR g.inherit_descendants = 1)
            ORDER BY g.created_at, g.grant_id
            """,
            [*fixture_ids, fixture_id],
        ).fetchall()
    return [{
        "grantId": row["grant_id"],
        "sourceFixtureId": row["fixture_id"],
        "sourceFixtureName": row["fixture_name"],
        "provider": row["provider"],
        "externalIdentity": row["external_identity"],
        "subjectLabel": row["subject_label"] or "",
        "inherited": row["fixture_id"] != fixture_id,
    } for row in rows]


def record_source_batch(repo_root: Path, fixture_id: str, *, source_kind: str, source_identity: str, provenance: dict[str, Any] | None = None, batch_id: str = "") -> dict[str, Any]:
    timestamp = now_iso()
    stable_id = str(batch_id or "").strip() or f"batch-{hashlib.sha256(f'{fixture_id}|{source_kind}|{source_identity}'.encode()).hexdigest()[:16]}"
    with connect(repo_root) as conn:
        fixture_breadcrumbs(conn, fixture_id)
        conn.execute(
            """INSERT INTO fixture_source_batches (batch_id, fixture_id, source_kind, source_identity, provenance_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(batch_id) DO UPDATE SET provenance_json = excluded.provenance_json""",
            (stable_id, fixture_id, _clean_name(source_kind), _clean_name(source_identity), _json(provenance or {}), timestamp),
        )
        conn.commit()
    return {"batchId": stable_id, "fixtureId": fixture_id, "sourceKind": source_kind, "sourceIdentity": source_identity, "provenance": provenance or {}}


def move_fixture(repo_root: Path, fixture_id: str, parent_fixture_id: str = "") -> dict[str, Any]:
    with connect(repo_root) as conn:
        fixture = conn.execute("SELECT * FROM fixtures WHERE fixture_id = ?", (fixture_id,)).fetchone()
        if not fixture:
            raise ValueError("fixture does not exist")
        parent = str(parent_fixture_id or "").strip() or None
        if parent == fixture_id:
            raise ValueError("fixture cannot be its own parent")
        if parent:
            ancestors = {item["fixtureId"] for item in fixture_breadcrumbs(conn, parent)}
            if fixture_id in ancestors:
                raise ValueError("fixture cannot be moved below one of its descendants")
        conn.execute(
            """
            UPDATE fixtures
            SET parent_fixture_id = ?,
                candidate_mode = ?,
                owner_only = CASE WHEN ? IS NULL THEN 1 ELSE owner_only END,
                updated_at = ?
            WHERE fixture_id = ?
            """,
            (parent, "inherited" if parent else "photos-library", parent, now_iso(), fixture_id),
        )
        _recompute_fixture_eligibility(conn)
        conn.commit()
        return _fixture_row(conn.execute("SELECT * FROM fixtures WHERE fixture_id = ?", (fixture_id,)).fetchone())


def rename_fixture(repo_root: Path, fixture_id: str, name: str) -> dict[str, Any]:
    """Rename a fixture while retaining its stable identity and relationships."""
    clean_name = _clean_name(name)
    with connect(repo_root) as conn:
        row = conn.execute("SELECT parent_fixture_id FROM fixtures WHERE fixture_id = ? AND archived_at IS NULL", (fixture_id,)).fetchone()
        if not row:
            raise ValueError("fixture does not exist")
        duplicate = conn.execute(
            "SELECT fixture_id FROM fixtures WHERE parent_fixture_id IS ? AND name = ? COLLATE NOCASE AND archived_at IS NULL AND fixture_id <> ?",
            (row["parent_fixture_id"], clean_name, fixture_id),
        ).fetchone()
        if duplicate:
            raise ValueError("a sibling fixture already uses that name")
        conn.execute("UPDATE fixtures SET name = ?, slug = ?, updated_at = ? WHERE fixture_id = ?", (clean_name, _slug(clean_name), now_iso(), fixture_id))
        conn.commit()
        return _fixture_row(conn.execute("SELECT * FROM fixtures WHERE fixture_id = ?", (fixture_id,)).fetchone())


def archive_fixture(repo_root: Path, fixture_id: str) -> dict[str, Any]:
    """Hide a fixture tree without deleting its stable IDs or relationships."""
    timestamp = now_iso()
    with connect(repo_root) as conn:
        row = conn.execute("SELECT * FROM fixtures WHERE fixture_id = ?", (fixture_id,)).fetchone()
        if not row:
            raise ValueError("fixture does not exist")
        conn.execute(
            """WITH RECURSIVE subtree(fixture_id) AS (
                 SELECT fixture_id FROM fixtures WHERE fixture_id = ?
                 UNION ALL
                 SELECT f.fixture_id FROM fixtures f JOIN subtree s ON f.parent_fixture_id = s.fixture_id
               )
               UPDATE fixtures SET archived_at = ?, updated_at = ? WHERE fixture_id IN (SELECT fixture_id FROM subtree)""",
            (fixture_id, timestamp, timestamp),
        )
        conn.commit()
        return _fixture_row(conn.execute("SELECT * FROM fixtures WHERE fixture_id = ?", (fixture_id,)).fetchone())


def reopen_fixture(repo_root: Path, fixture_id: str) -> dict[str, Any]:
    """Restore an archived fixture while preserving all attached state."""
    with connect(repo_root) as conn:
        row = conn.execute("SELECT * FROM fixtures WHERE fixture_id = ?", (fixture_id,)).fetchone()
        if not row:
            raise ValueError("fixture does not exist")
        parent = row["parent_fixture_id"] or ""
        if parent:
            parent_row = conn.execute("SELECT archived_at FROM fixtures WHERE fixture_id = ?", (parent,)).fetchone()
            if parent_row and parent_row["archived_at"]:
                raise ValueError("reopen the archived parent fixture first")
        conn.execute(
            """WITH RECURSIVE subtree(fixture_id) AS (
                 SELECT fixture_id FROM fixtures WHERE fixture_id = ?
                 UNION ALL
                 SELECT f.fixture_id FROM fixtures f JOIN subtree s ON f.parent_fixture_id = s.fixture_id
               )
               UPDATE fixtures SET archived_at = NULL, updated_at = ? WHERE fixture_id IN (SELECT fixture_id FROM subtree)""",
            (fixture_id, now_iso()),
        )
        conn.commit()
        return _fixture_row(conn.execute("SELECT * FROM fixtures WHERE fixture_id = ?", (fixture_id,)).fetchone())


def link_access_grant(
    repo_root: Path,
    fixture_id: str,
    *,
    provider: str,
    external_identity: str,
    subject_label: str = "",
    recovery: dict[str, Any] | None = None,
    inherit_descendants: bool = True,
) -> dict[str, Any]:
    timestamp = now_iso()
    clean_provider = _clean_name(provider)
    clean_identity = _clean_name(external_identity)
    with connect(repo_root) as conn:
        fixture_breadcrumbs(conn, fixture_id)
        existing = conn.execute("SELECT grant_id FROM fixture_access_grants WHERE fixture_id = ? AND provider = ? AND external_identity = ?", (fixture_id, clean_provider, clean_identity)).fetchone()
        grant_id = existing["grant_id"] if existing else f"grant-{uuid.uuid4().hex[:16]}"
        conn.execute(
            """INSERT INTO fixture_access_grants (grant_id, fixture_id, provider, external_identity, subject_label, state, recovery_json, inherit_descendants, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
               ON CONFLICT(fixture_id, provider, external_identity) DO UPDATE SET subject_label = excluded.subject_label,
                 state = 'active', recovery_json = excluded.recovery_json,
                 inherit_descendants = excluded.inherit_descendants, updated_at = excluded.updated_at""",
            (
                grant_id,
                fixture_id,
                clean_provider,
                clean_identity,
                str(subject_label or "").strip(),
                _json(recovery or {}),
                1 if inherit_descendants else 0,
                timestamp,
                timestamp,
            ),
        )
        conn.execute(
            "UPDATE fixtures SET owner_only = 0, updated_at = ? WHERE fixture_id = ?",
            (timestamp, fixture_id),
        )
        conn.commit()
    return {
        "grantId": grant_id,
        "fixtureId": fixture_id,
        "provider": clean_provider,
        "externalIdentity": clean_identity,
        "state": "active",
        "inheritDescendants": inherit_descendants,
    }


def link_deliverable(repo_root: Path, fixture_id: str, *, provider: str, external_identity: str, kind: str, state: str, recovery: dict[str, Any] | None = None) -> dict[str, Any]:
    timestamp = now_iso()
    clean_provider = _clean_name(provider)
    clean_identity = _clean_name(external_identity)
    clean_kind = _clean_name(kind)
    clean_state = _clean_name(state)
    with connect(repo_root) as conn:
        fixture_breadcrumbs(conn, fixture_id)
        existing = conn.execute("SELECT deliverable_id FROM fixture_deliverables WHERE fixture_id = ? AND provider = ? AND external_identity = ?", (fixture_id, clean_provider, clean_identity)).fetchone()
        deliverable_id = existing["deliverable_id"] if existing else f"dlv-{uuid.uuid4().hex[:16]}"
        conn.execute(
            """INSERT INTO fixture_deliverables (deliverable_id, fixture_id, provider, external_identity, kind, state, recovery_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(fixture_id, provider, external_identity) DO UPDATE SET kind = excluded.kind,
                 state = excluded.state, recovery_json = excluded.recovery_json, updated_at = excluded.updated_at""",
            (deliverable_id, fixture_id, clean_provider, clean_identity, clean_kind, clean_state, _json(recovery or {}), timestamp, timestamp),
        )
        conn.commit()
    return {"deliverableId": deliverable_id, "fixtureId": fixture_id, "provider": clean_provider, "externalIdentity": clean_identity, "kind": clean_kind, "state": clean_state}


def list_deliverables(repo_root: Path, fixture_id: str) -> dict[str, Any]:
    with connect(repo_root) as conn:
        breadcrumbs = fixture_breadcrumbs(conn, fixture_id)
        rows = conn.execute(
            """SELECT deliverable_id, provider, external_identity, kind, state,
                      recovery_json, created_at, updated_at
               FROM fixture_deliverables
               WHERE fixture_id = ?
               ORDER BY updated_at DESC, deliverable_id""",
            (fixture_id,),
        ).fetchall()
    items = [{
        "deliverableId": row["deliverable_id"],
        "fixtureId": fixture_id,
        "provider": row["provider"],
        "externalIdentity": row["external_identity"],
        "kind": row["kind"],
        "state": row["state"],
        "recovery": _read_json(row["recovery_json"], {}),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    } for row in rows]
    return {
        "ok": True,
        "fixtureId": fixture_id,
        "breadcrumbs": breadcrumbs,
        "count": len(items),
        "items": items,
    }


def publication_plan(
    repo_root: Path,
    fixture_id: str,
    asset_ids: Iterable[str] = (),
) -> dict[str, Any]:
    """Return exact catalog-eligible assets with current verified R2 receipts."""
    selected_ids = _unique(asset_ids)
    with connect(repo_root) as conn:
        fixture = conn.execute(
            "SELECT fixture_id, name, tags_json, archived_at FROM fixtures WHERE fixture_id = ?",
            (fixture_id,),
        ).fetchone()
        if not fixture or fixture["archived_at"]:
            raise ValueError("publication fixture does not exist or is archived")
        tags = _read_json(fixture["tags_json"], [])
        fixture_name = str(fixture["name"])
        # Local import avoids a schema-bootstrap cycle with fixture_policy.
        from fixture_policy import effective_fixture_policy, policy_allows_catalog
        policy = effective_fixture_policy(
            repo_root,
            fixture_id,
            conn=conn,
        )["effective"]
        if not policy_allows_catalog(policy):
            raise ValueError(
                "fixture policy does not permit public searchable catalog publication"
            )
    delivery = delivery_plan(repo_root, fixture_id)
    eligible: list[dict[str, Any]] = []
    blocked: list[dict[str, Any]] = []
    selected = set(selected_ids)
    found: set[str] = set()
    for item in delivery["items"]:
        asset_id = str(item["assetId"])
        if selected and asset_id not in selected:
            continue
        found.add(asset_id)
        r2 = item.get("receipts", {}).get("r2", {})
        reason = ""
        if not item.get("approved"):
            reason = "asset is not both picked and metadata-approved"
        elif r2.get("status") != "verified":
            reason = "same-version R2 delivery is not verified"
        target = {
            "assetId": asset_id,
            "versionHash": item.get("versionHash") or "",
            "r2Status": r2.get("status") or "pending",
        }
        (blocked if reason else eligible).append({**target, **({"reason": reason} if reason else {})})
    for missing in selected - found:
        blocked.append({"assetId": missing, "reason": "asset is not actively placed in this fixture"})
    return {
        "ok": not blocked,
        "fixtureId": fixture_id,
        "fixtureName": fixture_name,
        "tags": tags,
        "policy": policy,
        "eligibleCount": len(eligible),
        "blockedCount": len(blocked),
        "eligible": eligible,
        "blocked": blocked,
        "published": False,
    }


def search_assets(repo_root: Path, filters: dict[str, Any] | None = None, *, limit: int = 500, offset: int = 0) -> dict[str, Any]:
    filters = filters or {}
    predicates = [
        "(a.missing_at IS NULL OR a.missing_at = '')",
        "lower(COALESCE(a.media_type, 'photo')) NOT LIKE '%video%'",
        "COALESCE(d.pick_state, '') <> 'hidden'",
        "NOT EXISTS (SELECT 1 FROM sidecar_tombstones t WHERE t.asset_id = a.asset_id AND t.tombstone_state = 'active')",
        "NOT EXISTS (SELECT 1 FROM media_lifecycle lifecycle WHERE lifecycle.media_id = a.asset_id AND lifecycle.lifecycle_state IN ('hidden', 'discarded'))",
    ]
    params: list[Any] = []
    exact_ids = _unique(filters.get("assetIds") or filters.get("albumAssetIds") or [])
    if exact_ids:
        predicates.append(f"a.asset_id IN ({','.join('?' for _ in exact_ids)})")
        params.extend(exact_ids)
    for key, column in (("dateFrom", "a.captured_at"), ("dateTo", "a.captured_at")):
        value = str(filters.get(key) or "").strip()
        if value:
            predicates.append(f"{column} {'>=' if key == 'dateFrom' else '<='} ?")
            params.append(value)
    for key, column in (("mediaTypes", "a.media_type"), ("ratings", "COALESCE(d.rating, 0)"), ("colors", "COALESCE(d.color, '')"), ("pickStates", "COALESCE(d.pick_state, 'undecided')"), ("metadataStates", "COALESCE(d.metadata_state, 'unreviewed')")):
        values = _unique(filters.get(key) or [])
        if values:
            predicates.append(f"{column} IN ({','.join('?' for _ in values)})")
            params.extend(values)
    fixture_id = str(filters.get("fixtureId") or "").strip()
    if fixture_id:
        predicates.append("EXISTS (SELECT 1 FROM fixture_asset_placements p WHERE p.asset_id = a.asset_id AND p.fixture_id = ? AND p.state = 'active')")
        params.append(fixture_id)
    for album_id in _unique(filters.get("albumIds") or []):
        predicates.append("lower(COALESCE(a.raw_json, '')) LIKE ? ESCAPE '\\'")
        escaped_album_id = album_id.casefold().replace("%", "\\%").replace("_", "\\_")
        params.append(f"%{escaped_album_id}%")
    for key in ("camera", "lens"):
        value = str(filters.get(key) or "").strip().casefold()
        if value:
            predicates.append("lower(COALESCE(a.raw_json, '')) LIKE ? ESCAPE '\\'")
            escaped_value = value.replace("%", "\\%").replace("_", "\\_")
            params.append(f"%{escaped_value}%")
    delivery_states = _unique(filters.get("deliveryStates") or [])
    if delivery_states:
        predicates.append(f"EXISTS (SELECT 1 FROM fixture_delivery_receipts r WHERE r.asset_id = a.asset_id AND r.status IN ({','.join('?' for _ in delivery_states)}))")
        params.extend(delivery_states)
    if bool(filters.get("dedupeExact")):
        predicates.append(
            """a.asset_id = (SELECT min(a2.asset_id) FROM sidecar_assets a2
               WHERE (
                   COALESCE(NULLIF(json_extract(a2.raw_json, '$.localIdentifier'), ''), NULLIF(a2.source_anchor, ''), a2.asset_id) =
                   COALESCE(NULLIF(json_extract(a.raw_json, '$.localIdentifier'), ''), NULLIF(a.source_anchor, ''), a.asset_id)
                   OR (
                     COALESCE(json_extract(a.raw_json, '$.checksumSha256'), '') <> ''
                     AND json_extract(a2.raw_json, '$.checksumSha256') = json_extract(a.raw_json, '$.checksumSha256')
                   )
               )
                 AND (a2.missing_at IS NULL OR a2.missing_at = ''))"""
        )
    query = str(filters.get("query") or filters.get("q") or "").strip().casefold()
    for term in re.findall(r"[^\s,;]+", query)[:8]:
        escaped_term = term.replace("%", "\\%").replace("_", "\\_")
        like = f"%{escaped_term}%"
        columns = ["a.asset_id", "a.filename", "a.photos_title", "a.photos_keywords_json", "a.location_label", "a.metadata_seed_title", "a.metadata_seed_keywords_json", "d.title", "d.caption", "d.keywords_json"]
        predicates.append("(" + " OR ".join(f"lower(COALESCE({column}, '')) LIKE ? ESCAPE '\\'" for column in columns) + ")")
        params.extend([like] * len(columns))
    where = " AND ".join(predicates)
    safe_limit = max(1, min(int(limit or 500), 5000))
    safe_offset = max(0, int(offset or 0))
    with connect(repo_root) as conn:
        count = int(conn.execute(f"SELECT count(*) FROM sidecar_assets a LEFT JOIN sidecar_decisions d ON d.asset_id = a.asset_id WHERE {where}", params).fetchone()[0])
        rows = conn.execute(
            f"""
            SELECT a.asset_id, a.source_anchor, a.filename, a.media_type, a.captured_at,
                   a.pixel_width, a.pixel_height, a.photos_title, a.photos_keywords_json,
                   a.location_label, COALESCE(d.rating, 0) rating, COALESCE(d.color, '') color,
                   COALESCE(d.pick_state, 'undecided') pick_state,
                   COALESCE(d.metadata_state, 'unreviewed') metadata_state,
                   COALESCE(d.title, '') decision_title, COALESCE(d.caption, '') decision_caption,
                   COALESCE(d.keywords_json, '[]') decision_keywords, COALESCE(a.raw_json, '{{}}') raw_json
            FROM sidecar_assets a LEFT JOIN sidecar_decisions d ON d.asset_id = a.asset_id
            WHERE {where}
            ORDER BY a.captured_at DESC, a.asset_id
            LIMIT ? OFFSET ?
            """,
            [*params, safe_limit, safe_offset],
        ).fetchall()
    items = []
    for row in rows:
        raw = _read_json(row["raw_json"], {})
        camera = raw.get("cameraMetadata") or raw.get("camera") or {}
        lens = raw.get("lensMetadata") or raw.get("lens") or camera.get("lensModel") or ""
        source_anchor = str(row["source_anchor"] or "")
        source_kind = "apple_photos" if source_anchor.startswith(("apple-photos", "ph://")) or raw.get("localIdentifier") else "photosbyelie"
        items.append({
        "assetId": row["asset_id"], "sourceKind": source_kind, "sourceIdentity": source_anchor,
        "filename": row["filename"] or "", "mediaType": row["media_type"] or "", "capturedAt": row["captured_at"] or "",
        "pixelWidth": int(row["pixel_width"] or 0), "pixelHeight": int(row["pixel_height"] or 0),
        "title": row["decision_title"] or row["photos_title"] or "", "keywords": _read_json(row["decision_keywords"], []) or _read_json(row["photos_keywords_json"], []),
        "caption": row["decision_caption"] or "", "camera": camera, "lens": lens,
        "locationLabel": _location_label_for_row(row), "rating": int(row["rating"] or 0), "color": row["color"] or "",
        "pickState": row["pick_state"], "metadataState": row["metadata_state"],
        "missingFields": [field for field, value in (("camera", camera), ("lens", lens)) if not value],
        "exactIdentity": raw.get("localIdentifier") or source_anchor,
        "checksumSha256": raw.get("checksumSha256") or raw.get("sha256") or "",
    })
    return {"ok": True, "count": len(items), "totalCount": count, "offset": safe_offset, "limit": safe_limit, "filters": filters, "items": items, "readOnly": True}


def _snapshot_hash(asset_ids: Iterable[str], criteria: dict[str, Any]) -> str:
    payload = {"assetIds": sorted(_unique(asset_ids)), "criteria": criteria}
    return hashlib.sha256(_json(payload).encode("utf-8")).hexdigest()


def create_pool(repo_root: Path, fixture_id: str, asset_ids: Iterable[str], *, name: str = "", criteria: dict[str, Any] | None = None) -> dict[str, Any]:
    clean_ids = _unique(asset_ids)
    if not clean_ids:
        raise ValueError("select at least one asset")
    criteria = criteria or {}
    timestamp = now_iso()
    snapshot_hash = _snapshot_hash(clean_ids, criteria)
    with connect(repo_root) as conn:
        breadcrumbs = fixture_breadcrumbs(conn, fixture_id)
        placeholders = ",".join("?" for _ in clean_ids)
        rows = conn.execute(
            f"SELECT asset_id, source_anchor, raw_json, media_type FROM sidecar_assets WHERE asset_id IN ({placeholders})",
            clean_ids,
        ).fetchall()
        by_id = {row["asset_id"]: row for row in rows}
        missing = [asset_id for asset_id in clean_ids if asset_id not in by_id]
        if missing:
            raise ValueError(f"{len(missing)} selected asset(s) are not indexed")
        source_videos = [
            asset_id
            for asset_id in clean_ids
            if "video" in str(by_id[asset_id]["media_type"] or "photo").strip().casefold()
        ]
        if source_videos:
            raise ValueError(
                "source videos cannot enter a still-only Culling snapshot"
            )
        existing = conn.execute(
            "SELECT pool_id FROM fixture_culling_pools WHERE fixture_id = ? AND snapshot_hash = ?",
            (fixture_id, snapshot_hash),
        ).fetchone()
        if existing:
            return get_pool(repo_root, existing["pool_id"], conn=conn)
        pool_id = f"pool-{uuid.uuid4().hex[:16]}"
        pool_name = _clean_name(name or f"{' / '.join(item['name'] for item in breadcrumbs)} pool")
        conn.execute("INSERT INTO fixture_culling_pools (pool_id, fixture_id, name, criteria_json, snapshot_hash, asset_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (pool_id, fixture_id, pool_name, _json(criteria), snapshot_hash, len(clean_ids), timestamp, timestamp))
        for position, asset_id in enumerate(clean_ids):
            row = by_id[asset_id]
            raw = _read_json(row["raw_json"], {})
            provenance = {"sourceAnchor": row["source_anchor"], "albums": raw.get("albums") or raw.get("albumLocalIdentifiers") or []}
            source_kind = str(raw.get("sourceKind") or ("apple_photos" if raw.get("localIdentifier") or str(row["source_anchor"] or "").startswith("apple-photos") else "photosbyelie"))
            source_batch_id = str(raw.get("sourceBatchId") or (criteria.get("sourceBatchIdsByAsset") or {}).get(asset_id) or "").strip() or None
            if source_batch_id and not conn.execute("SELECT 1 FROM fixture_source_batches WHERE batch_id = ?", (source_batch_id,)).fetchone():
                raise ValueError(f"source batch is not registered: {source_batch_id}")
            conn.execute("INSERT INTO fixture_pool_assets (pool_id, asset_id, source_kind, source_identity, source_batch_id, snapshot_position, provenance_json, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (pool_id, asset_id, source_kind, row["source_anchor"], source_batch_id, position, _json(provenance), timestamp))
        # Freeze the fixture's population contract and effective policy with
        # the immutable pool. The local import avoids a schema bootstrap cycle.
        from fixture_policy import capture_snapshot_contract
        capture_snapshot_contract(repo_root, pool_id, conn=conn)
        conn.commit()
        return get_pool(repo_root, pool_id, conn=conn)


def get_pool(repo_root: Path, pool_id: str, *, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    owns = conn is None
    conn = conn or connect(repo_root)
    try:
        row = conn.execute("SELECT * FROM fixture_culling_pools WHERE pool_id = ?", (pool_id,)).fetchone()
        if not row:
            raise ValueError("culling pool does not exist")
        assets = conn.execute(
            """
            SELECT p.asset_id, p.source_kind, p.source_identity, p.source_batch_id,
                   p.snapshot_position, p.provenance_json, p.added_at,
                   COALESCE(d.title, a.photos_title, '') AS title,
                   COALESCE(a.filename, '') AS filename,
                   COALESCE(a.media_type, '') AS media_type,
                   COALESCE(a.raw_json, '{}') AS raw_json
            FROM fixture_pool_assets p
            LEFT JOIN sidecar_assets a ON a.asset_id = p.asset_id
            LEFT JOIN sidecar_decisions d ON d.asset_id = p.asset_id
            WHERE p.pool_id = ? AND p.removed_at IS NULL
            ORDER BY p.snapshot_position
            """,
            (pool_id,),
        ).fetchall()
        contract_row = None
        if conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'fixture_snapshot_contracts'"
        ).fetchone():
            contract_row = conn.execute(
                "SELECT * FROM fixture_snapshot_contracts WHERE pool_id = ?",
                (pool_id,),
            ).fetchone()
        contract = None
        if contract_row:
            contract = {
                "poolId": str(contract_row["pool_id"]),
                "fixtureId": str(contract_row["fixture_id"]),
                "populationMode": str(contract_row["population_mode"]),
                "candidateSource": _read_json(contract_row["candidate_source_json"], {}),
                "savedRule": _read_json(contract_row["saved_rule_json"], {}),
                "policyRevision": int(contract_row["policy_revision"]),
                "effectivePolicy": _read_json(contract_row["effective_policy_json"], {}),
                "createdAt": str(contract_row["created_at"]),
            }
        return {
            "poolId": row["pool_id"], "fixtureId": row["fixture_id"], "name": row["name"], "criteria": _read_json(row["criteria_json"], {}),
            "snapshotHash": row["snapshot_hash"], "assetCount": len(assets), "state": row["state"], "createdAt": row["created_at"], "updatedAt": row["updated_at"],
            "breadcrumbs": fixture_breadcrumbs(conn, row["fixture_id"]),
            "contract": contract,
            "assets": [{
                "assetId": item["asset_id"],
                "sourceKind": item["source_kind"],
                "sourceIdentity": item["source_identity"],
                "photoLibraryIdentifier": str(
                    _read_json(item["raw_json"], {}).get("localIdentifier") or ""
                ),
                "sourceBatchId": item["source_batch_id"] or "",
                "position": item["snapshot_position"],
                "title": item["title"],
                "filename": item["filename"],
                "mediaType": item["media_type"],
                "provenance": _read_json(item["provenance_json"], {}),
                "addedAt": item["added_at"],
            } for item in assets],
        }
    finally:
        if owns:
            conn.close()


def list_pools(
    repo_root: Path,
    *,
    fixture_id: str = "",
    limit: int = 50,
) -> list[dict[str, Any]]:
    """List recent immutable culling snapshots without loading their assets."""
    safe_limit = max(1, min(250, int(limit or 50)))
    query = """
        SELECT pool_id, fixture_id, name, snapshot_hash, asset_count, state,
               created_at, updated_at
        FROM fixture_culling_pools
    """
    params: list[Any] = []
    if fixture_id.strip():
        query += " WHERE fixture_id = ?"
        params.append(fixture_id.strip())
    query += " ORDER BY created_at DESC, pool_id DESC LIMIT ?"
    params.append(safe_limit)
    with connect(repo_root) as conn:
        rows = conn.execute(query, params).fetchall()
    return [{
        "poolId": row["pool_id"],
        "fixtureId": row["fixture_id"],
        "name": row["name"],
        "snapshotHash": row["snapshot_hash"],
        "assetCount": int(row["asset_count"] or 0),
        "state": row["state"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    } for row in rows]


def pool_asset_ids(repo_root: Path, pool_id: str) -> list[str]:
    return [item["assetId"] for item in get_pool(repo_root, pool_id)["assets"]]


def preview_pool_refresh(repo_root: Path, pool_id: str) -> dict[str, Any]:
    pool = get_pool(repo_root, pool_id)
    search = search_assets(repo_root, pool["criteria"], limit=5000)
    before = [item["assetId"] for item in pool["assets"]]
    after = [item["assetId"] for item in search["items"]]
    return {"ok": True, "poolId": pool_id, "beforeCount": len(before), "afterCount": len(after), "additions": [item for item in after if item not in set(before)], "removals": [item for item in before if item not in set(after)], "applied": False}


def apply_pool_refresh(repo_root: Path, pool_id: str) -> dict[str, Any]:
    """Create a new idempotent snapshot after an explicit refresh preview."""
    preview = preview_pool_refresh(repo_root, pool_id)
    original = get_pool(repo_root, pool_id)
    search = search_assets(repo_root, original["criteria"], limit=5000)
    refreshed = create_pool(
        repo_root,
        original["fixtureId"],
        [item["assetId"] for item in search["items"]],
        name=f"{original['name']} refresh",
        criteria=original["criteria"],
    )
    return {**preview, "applied": True, "originalPoolId": pool_id, "pool": refreshed}


def place_assets(repo_root: Path, fixture_id: str, asset_ids: Iterable[str], *, source_pool_id: str = "", actor: str = "owner", reason: str = "") -> dict[str, Any]:
    timestamp = now_iso()
    clean_ids = _unique(asset_ids)
    with connect(repo_root) as conn:
        fixture_breadcrumbs(conn, fixture_id)
        placed = []
        for asset_id in clean_ids:
            if not conn.execute("SELECT 1 FROM sidecar_assets WHERE asset_id = ?", (asset_id,)).fetchone():
                raise ValueError(f"asset is not indexed: {asset_id}")
            existing = conn.execute("SELECT placement_id FROM fixture_asset_placements WHERE fixture_id = ? AND asset_id = ? AND state = 'active'", (fixture_id, asset_id)).fetchone()
            if existing:
                placed.append(existing["placement_id"])
                continue
            placement_id = f"plc-{uuid.uuid4().hex[:16]}"
            conn.execute("INSERT INTO fixture_asset_placements (placement_id, fixture_id, asset_id, source_pool_id, placed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", (placement_id, fixture_id, asset_id, source_pool_id or None, timestamp, timestamp))
            conn.execute("INSERT INTO fixture_placement_events (event_id, placement_id, asset_id, to_fixture_id, action, actor, reason, created_at) VALUES (?, ?, ?, ?, 'place', ?, ?, ?)", (f"evt-{uuid.uuid4().hex[:16]}", placement_id, asset_id, fixture_id, actor, reason, timestamp))
            placed.append(placement_id)
        conn.commit()
    return {"ok": True, "fixtureId": fixture_id, "assetCount": len(clean_ids), "placementIds": placed}


def list_placements(repo_root: Path, asset_ids: Iterable[str] = (), *, fixture_id: str = "") -> dict[str, Any]:
    clean_ids = _unique(asset_ids)
    predicates = ["1 = 1"]
    params: list[Any] = []
    if clean_ids:
        predicates.append(f"p.asset_id IN ({','.join('?' for _ in clean_ids)})")
        params.extend(clean_ids)
    if fixture_id:
        predicates.append("p.fixture_id = ?")
        params.append(fixture_id)
    with connect(repo_root) as conn:
        rows = conn.execute(
            f"""SELECT p.*, f.name fixture_name
                FROM fixture_asset_placements p JOIN fixtures f ON f.fixture_id = p.fixture_id
                WHERE {' AND '.join(predicates)}
                ORDER BY p.asset_id, p.state, p.updated_at DESC""",
            params,
        ).fetchall()
        items = []
        for row in rows:
            items.append({
                "placementId": row["placement_id"], "fixtureId": row["fixture_id"],
                "fixtureName": row["fixture_name"], "breadcrumbLabel": " / ".join(item["name"] for item in fixture_breadcrumbs(conn, row["fixture_id"])),
                "assetId": row["asset_id"], "sourcePoolId": row["source_pool_id"] or "",
                "state": row["state"], "placedAt": row["placed_at"], "removedAt": row["removed_at"] or "",
                "updatedAt": row["updated_at"],
            })
    return {"ok": True, "count": len(items), "items": items}


def move_placement(repo_root: Path, placement_id: str, to_fixture_id: str, *, actor: str = "owner", reason: str = "") -> dict[str, Any]:
    timestamp = now_iso()
    with connect(repo_root) as conn:
        fixture_breadcrumbs(conn, to_fixture_id)
        row = conn.execute("SELECT * FROM fixture_asset_placements WHERE placement_id = ? AND state = 'active'", (placement_id,)).fetchone()
        if not row:
            raise ValueError("active placement does not exist")
        existing = conn.execute("SELECT placement_id FROM fixture_asset_placements WHERE fixture_id = ? AND asset_id = ? AND state = 'active'", (to_fixture_id, row["asset_id"])).fetchone()
        if existing:
            raise ValueError("asset is already placed in the destination fixture")
        conn.execute("UPDATE fixture_asset_placements SET fixture_id = ?, updated_at = ? WHERE placement_id = ?", (to_fixture_id, timestamp, placement_id))
        conn.execute("INSERT INTO fixture_placement_events (event_id, placement_id, asset_id, from_fixture_id, to_fixture_id, action, actor, reason, created_at) VALUES (?, ?, ?, ?, ?, 'move', ?, ?, ?)", (f"evt-{uuid.uuid4().hex[:16]}", placement_id, row["asset_id"], row["fixture_id"], to_fixture_id, actor, reason, timestamp))
        conn.commit()
        return {"ok": True, "placementId": placement_id, "assetId": row["asset_id"], "fromFixtureId": row["fixture_id"], "toFixtureId": to_fixture_id}


def remove_placement(repo_root: Path, placement_id: str, *, actor: str = "owner", reason: str = "") -> dict[str, Any]:
    timestamp = now_iso()
    with connect(repo_root) as conn:
        row = conn.execute("SELECT * FROM fixture_asset_placements WHERE placement_id = ? AND state = 'active'", (placement_id,)).fetchone()
        if not row:
            raise ValueError("active placement does not exist")
        conn.execute("UPDATE fixture_asset_placements SET state = 'removed', removed_at = ?, updated_at = ? WHERE placement_id = ?", (timestamp, timestamp, placement_id))
        conn.execute("INSERT INTO fixture_placement_events (event_id, placement_id, asset_id, from_fixture_id, action, actor, reason, created_at) VALUES (?, ?, ?, ?, 'remove', ?, ?, ?)", (f"evt-{uuid.uuid4().hex[:16]}", placement_id, row["asset_id"], row["fixture_id"], actor, reason, timestamp))
        conn.commit()
        return {"ok": True, "placementId": placement_id, "assetId": row["asset_id"], "fixtureId": row["fixture_id"], "state": "removed"}


def restore_placement(repo_root: Path, placement_id: str, *, actor: str = "owner", reason: str = "") -> dict[str, Any]:
    timestamp = now_iso()
    with connect(repo_root) as conn:
        row = conn.execute("SELECT * FROM fixture_asset_placements WHERE placement_id = ? AND state = 'removed'", (placement_id,)).fetchone()
        if not row:
            raise ValueError("removed placement does not exist")
        if conn.execute("SELECT 1 FROM fixture_asset_placements WHERE fixture_id = ? AND asset_id = ? AND state = 'active'", (row["fixture_id"], row["asset_id"])).fetchone():
            raise ValueError("an active placement already exists for this asset and fixture")
        conn.execute("UPDATE fixture_asset_placements SET state = 'active', removed_at = NULL, updated_at = ? WHERE placement_id = ?", (timestamp, placement_id))
        conn.execute("INSERT INTO fixture_placement_events (event_id, placement_id, asset_id, to_fixture_id, action, actor, reason, created_at) VALUES (?, ?, ?, ?, 'restore', ?, ?, ?)", (f"evt-{uuid.uuid4().hex[:16]}", placement_id, row["asset_id"], row["fixture_id"], actor, reason, timestamp))
        conn.commit()
        return {"ok": True, "placementId": placement_id, "assetId": row["asset_id"], "fixtureId": row["fixture_id"], "state": "active"}


def editorial_version_hash(conn: sqlite3.Connection, asset_id: str) -> str:
    return sidecar_editorial_version_hash(conn, asset_id)


def _verified_upload_results(value: Any) -> tuple[list[dict[str, Any]], str]:
    results = _read_json(value, [])
    if not isinstance(results, list) or not results:
        return [], "no R2 upload results were recorded"
    verified: list[dict[str, Any]] = []
    for result in results:
        if not isinstance(result, dict):
            return [], "an R2 upload result is malformed"
        checksum = str(result.get("checksumSha256") or "")
        remote_checksum = str(result.get("remoteChecksumSha256") or "")
        local_md5 = str(result.get("checksumMd5") or "").strip().lower()
        remote_etag_md5 = str(result.get("remoteEtagMd5") or "").strip().lower()
        verification_method = str(result.get("verificationMethod") or "")
        checksum_verified = bool(checksum and remote_checksum == checksum)
        etag_verified = bool(
            verification_method == "etag-md5-content-length"
            and checksum
            and local_md5
            and remote_etag_md5 == local_md5
        )
        if (
            str(result.get("status") or "") != "uploaded"
            or not bool(result.get("remoteVerified"))
            or not (checksum_verified or etag_verified)
            or not str(result.get("key") or "")
        ):
            return [], "not every R2 upload result is checksum-verified"
        verified.append(result)
    return verified, ""


def plan_upload_run_adoption(
    repo_root: Path,
    run_id: str,
    fixture_id: str,
    *,
    historical_backfill: bool = False,
    revalidate_recorded_content: bool = False,
    asset_ids: Iterable[str] = (),
) -> dict[str, Any]:
    """Dry-run adoption of completed Upload Bridge rows into one explicit fixture."""
    selected_run_id = str(run_id or "").strip()
    selected_fixture_id = str(fixture_id or "").strip()
    if not selected_run_id:
        raise ValueError("upload run id is required")
    if not selected_fixture_id:
        raise ValueError("fixture id is required")
    selected_asset_ids = _unique(asset_ids)
    with connect(repo_root) as conn:
        run = conn.execute(
            "SELECT run_id, execute_upload, status, started_at, created_at FROM sidecar_upload_bridge_runs WHERE run_id = ?",
            (selected_run_id,),
        ).fetchone()
        if not run:
            raise ValueError("upload run does not exist")
        if not int(run["execute_upload"] or 0):
            raise ValueError("only a real upload run can be adopted")
        fixture = conn.execute(
            "SELECT fixture_id, name FROM fixtures WHERE fixture_id = ? AND archived_at IS NULL",
            (selected_fixture_id,),
        ).fetchone()
        if not fixture:
            raise ValueError("destination fixture does not exist or is archived")
        breadcrumbs = fixture_breadcrumbs(conn, selected_fixture_id)
        run_started_at = str(run["started_at"] or run["created_at"] or "")
        asset_filter = ""
        params: list[Any] = [selected_run_id]
        if selected_asset_ids:
            asset_filter = f" AND i.asset_id IN ({','.join('?' for _ in selected_asset_ids)})"
            params.extend(selected_asset_ids)
        rows = conn.execute(
            f"""
            SELECT i.run_item_id, i.asset_id, i.photo_id, i.filename, i.status,
                   i.export_status, i.upload_status, i.planned_keys_json, i.upload_keys_json,
                   COALESCE(i.editorial_version_hash, '') captured_version_hash,
                   COALESCE(a.updated_at, '') asset_updated_at,
                   COALESCE(d.updated_at, '') decision_updated_at,
                   COALESCE(d.title, '') title,
                   COALESCE(d.keywords_json, '[]') keywords_json,
                   COALESCE(d.pick_state, 'undecided') pick_state,
                   COALESCE(d.metadata_state, 'unreviewed') metadata_state,
                   COALESCE(t.tombstone_state, '') tombstone_state
            FROM sidecar_upload_bridge_run_items i
            JOIN sidecar_assets a ON a.asset_id = i.asset_id
            LEFT JOIN sidecar_decisions d ON d.asset_id = i.asset_id
            LEFT JOIN sidecar_tombstones t
              ON t.asset_id = i.asset_id AND t.tombstone_state = 'active'
            WHERE i.run_id = ?
              AND i.status = 'uploaded'
              AND i.export_status = 'materialized'
              AND i.upload_status IN ('uploaded', 'uploaded_with_skips')
              {asset_filter}
            ORDER BY i.updated_at, i.run_item_id
            """,
            params,
        ).fetchall()
        total_row = conn.execute(
            "SELECT COUNT(*) total FROM sidecar_upload_bridge_run_items WHERE run_id = ?",
            (selected_run_id,),
        ).fetchone()
        eligible: list[dict[str, Any]] = []
        blocked: list[dict[str, Any]] = []
        for row in rows:
            reason = ""
            results, verification_error = _verified_upload_results(row["upload_keys_json"])
            planned = _read_json(row["planned_keys_json"], [])
            planned_pairs = {
                (str(item.get("bucket") or ""), str(item.get("key") or ""))
                for item in planned if isinstance(item, dict)
            }
            result_pairs = {
                (str(item.get("bucket") or ""), str(item.get("key") or ""))
                for item in results
            }
            current_version = editorial_version_hash(conn, row["asset_id"])
            historical = not bool(row["captured_version_hash"])
            retirement_keywords = {
                str(value).strip().casefold()
                for value in _read_json(row["keywords_json"], [])
                if str(value).strip()
            }
            ai_retired = any(value.startswith("ai generated") for value in retirement_keywords) or bool(
                retirement_keywords & {"generative ai", "ai artwork"}
            )
            stained_retired = any(value.startswith("stained") for value in retirement_keywords)
            if selected_fixture_id == "fixture-expo" and (ai_retired or stained_retired):
                reason = (
                    "AI-generated assets are retired from Expo"
                    if ai_retired
                    else "Stained assets are retired from Expo"
                )
            elif verification_error:
                reason = verification_error
            elif not planned_pairs or not planned_pairs.issubset(result_pairs):
                reason = "the uploaded R2 objects do not cover every planned key"
            elif row["pick_state"] != "picked" or row["metadata_state"] != "approved":
                reason = "asset is not both picked and metadata-approved"
            elif row["tombstone_state"] == "active":
                reason = "asset is tombstoned"
            elif historical and not historical_backfill:
                reason = "historical run requires explicit backfill acknowledgement"
            elif historical and (
                not run_started_at
                or str(row["asset_updated_at"] or "") > run_started_at
                or str(row["decision_updated_at"] or "") > run_started_at
            ) and not revalidate_recorded_content:
                reason = "editorial state changed after this historical run started"
            elif (
                not historical
                and row["captured_version_hash"] != current_version
                and not revalidate_recorded_content
            ):
                reason = "editorial state changed after upload planning"
            recorded_content_revalidated = bool(
                revalidate_recorded_content
                and (
                    historical
                    or row["captured_version_hash"] != current_version
                )
            )
            item = {
                "runItemId": row["run_item_id"],
                "assetId": row["asset_id"],
                "photoId": row["photo_id"] or "",
                "filename": row["filename"] or "",
                "title": row["title"] or "",
                "versionHash": current_version,
                "historicalBackfill": historical,
                "recordedContentRevalidated": recorded_content_revalidated,
                "capturedVersionHash": row["captured_version_hash"] or "",
                "uploadResults": results,
            }
            if reason:
                blocked.append({**item, "reason": reason})
            else:
                eligible.append(item)
    return {
        "ok": True,
        "mode": "dry-run",
        "runId": selected_run_id,
        "runStatus": str(run["status"] or ""),
        "fixtureId": selected_fixture_id,
        "fixtureName": fixture["name"],
        "fixtureBreadcrumbs": breadcrumbs,
        "totalRunItemCount": int(total_row["total"] or 0),
        "completedUploadCount": len(rows),
        "selectedAssetCount": len(selected_asset_ids) if selected_asset_ids else len(rows),
        "eligibleCount": len(eligible),
        "blockedCount": len(blocked),
        "historicalBackfill": historical_backfill,
        "revalidateRecordedContent": revalidate_recorded_content,
        "items": eligible,
        "blocked": blocked,
        "applied": False,
    }


def adopt_upload_run(
    repo_root: Path,
    run_id: str,
    fixture_id: str,
    *,
    historical_backfill: bool = False,
    revalidate_recorded_content: bool = False,
    asset_ids: Iterable[str] = (),
    actor: str = "owner",
) -> dict[str, Any]:
    """Adopt only verified completed run items, then reconstruct their R2 receipts."""
    plan = plan_upload_run_adoption(
        repo_root,
        run_id,
        fixture_id,
        historical_backfill=historical_backfill,
        revalidate_recorded_content=revalidate_recorded_content,
        asset_ids=asset_ids,
    )
    if plan["blockedCount"]:
        raise ValueError("upload run adoption is blocked; review the dry-run details")
    if not plan["eligibleCount"]:
        raise ValueError("upload run has no completed eligible items to adopt")
    timestamp = now_iso()
    placements: list[str] = []
    receipt_count = 0
    with connect(repo_root) as conn:
        fixture = conn.execute(
            "SELECT fixture_id FROM fixtures WHERE fixture_id = ? AND archived_at IS NULL",
            (fixture_id,),
        ).fetchone()
        if not fixture:
            raise ValueError("destination fixture does not exist or is archived")
        for item in plan["items"]:
            _set_fixture_review_placement(
                conn,
                fixture_id,
                item["assetId"],
                "picked",
                actor=actor,
                reason=f"Adopt verified Upload Bridge run {run_id}",
                timestamp=timestamp,
            )
            existing = conn.execute(
                "SELECT placement_id FROM fixture_asset_placements WHERE fixture_id = ? AND asset_id = ? AND state = 'active'",
                (fixture_id, item["assetId"]),
            ).fetchone()
            if existing:
                placement_id = existing["placement_id"]
            else:
                placement_id = f"plc-{uuid.uuid4().hex[:16]}"
                conn.execute(
                    "INSERT INTO fixture_asset_placements (placement_id, fixture_id, asset_id, placed_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                    (placement_id, fixture_id, item["assetId"], timestamp, timestamp),
                )
                conn.execute(
                    """INSERT INTO fixture_placement_events
                       (event_id, placement_id, asset_id, to_fixture_id, action, actor, reason, created_at)
                       VALUES (?, ?, ?, ?, 'place', ?, ?, ?)""",
                    (
                        f"evt-{uuid.uuid4().hex[:16]}", placement_id, item["assetId"], fixture_id,
                        actor, f"Adopt verified Upload Bridge run {run_id}", timestamp,
                    ),
                )
            placements.append(placement_id)
            conn.execute(
                """
                INSERT INTO fixture_asset_destinations
                  (fixture_id, asset_id, destinations_json, version_hash, configured_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(fixture_id, asset_id) DO UPDATE SET
                  destinations_json = excluded.destinations_json,
                  version_hash = excluded.version_hash,
                  updated_at = excluded.updated_at
                """,
                (fixture_id, item["assetId"], _json(["r2", "apple_photos"]), item["versionHash"], timestamp, timestamp),
            )
            conn.execute(
                """INSERT OR IGNORE INTO fixture_delivery_receipts
                   (receipt_id, fixture_id, asset_id, destination, version_hash, status,
                    object_key, created_at, updated_at)
                   VALUES (?, ?, ?, 'apple_photos', ?, 'pending', '', ?, ?)""",
                (f"rcp-{uuid.uuid4().hex[:16]}", fixture_id, item["assetId"], item["versionHash"], timestamp, timestamp),
            )
            for result in item["uploadResults"]:
                record_delivery_receipt(
                    repo_root,
                    fixture_id=fixture_id,
                    asset_id=item["assetId"],
                    destination="r2",
                    version_hash=item["versionHash"],
                    status="verified",
                    object_key=str(result.get("key") or ""),
                    checksum_sha256=str(result.get("checksumSha256") or ""),
                    visibility_policy="public" if str(result.get("bucket") or "").endswith("public") else "private",
                    verification={
                        "source": "upload-bridge-adoption",
                        "runId": run_id,
                        "runItemId": item["runItemId"],
                        "historicalBackfill": bool(item["historicalBackfill"]),
                        "recordedContentRevalidated": bool(item["recordedContentRevalidated"]),
                        "capturedVersionHash": item["capturedVersionHash"],
                        "adoptedVersionHash": item["versionHash"],
                        "bucket": result.get("bucket"),
                        "bytes": result.get("bytes"),
                        "contentType": result.get("contentType"),
                        "remoteVerified": True,
                        "remoteChecksumSha256": result.get("remoteChecksumSha256"),
                        "verificationMethod": result.get("verificationMethod") or "sha256-download",
                        "checksumMd5": result.get("checksumMd5") or "",
                        "remoteEtagMd5": result.get("remoteEtagMd5") or "",
                    },
                    conn=conn,
                )
                receipt_count += 1
            if item["historicalBackfill"]:
                conn.execute(
                    "UPDATE sidecar_upload_bridge_run_items SET editorial_version_hash = ?, updated_at = ? WHERE run_item_id = ?",
                    (item["versionHash"], timestamp, item["runItemId"]),
                )
        conn.commit()
    return {
        **plan,
        "mode": "commit",
        "applied": True,
        "placementCount": len(placements),
        "placementIds": placements,
        "r2ReceiptCount": receipt_count,
        "destinations": ["r2", "apple_photos"],
    }


def configure_asset_destinations(repo_root: Path, fixture_id: str, asset_ids: Iterable[str], destinations: Iterable[str]) -> dict[str, Any]:
    selected = _unique(destinations)
    if not selected or any(item not in DESTINATIONS for item in selected):
        raise ValueError("destinations must use r2, apple_photos, or archive")
    timestamp = now_iso()
    clean_ids = _unique(asset_ids)
    with connect(repo_root) as conn:
        fixture_breadcrumbs(conn, fixture_id)
        for asset_id in clean_ids:
            version_hash = editorial_version_hash(conn, asset_id)
            conn.execute("""
              INSERT INTO fixture_asset_destinations (fixture_id, asset_id, destinations_json, version_hash, configured_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(fixture_id, asset_id) DO UPDATE SET destinations_json = excluded.destinations_json,
                version_hash = excluded.version_hash, updated_at = excluded.updated_at
            """, (fixture_id, asset_id, _json(selected), version_hash, timestamp, timestamp))
            for destination in selected:
                conn.execute("""
                  INSERT OR IGNORE INTO fixture_delivery_receipts
                    (receipt_id, fixture_id, asset_id, destination, version_hash, status, object_key, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, 'pending', '', ?, ?)
                """, (f"rcp-{uuid.uuid4().hex[:16]}", fixture_id, asset_id, destination, version_hash, timestamp, timestamp))
        conn.commit()
    return {"ok": True, "fixtureId": fixture_id, "assetCount": len(clean_ids), "destinations": selected}


def record_delivery_receipt(
    repo_root: Path,
    *,
    fixture_id: str,
    asset_id: str,
    destination: str,
    version_hash: str,
    status: str,
    object_key: str = "",
    checksum_sha256: str = "",
    visibility_policy: str = "",
    verification: dict[str, Any] | None = None,
    error_text: str = "",
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    if destination not in DESTINATIONS:
        raise ValueError("destination must use r2, apple_photos, or archive")
    if status not in {"pending", "running", "verified", "failed"}:
        raise ValueError("receipt status is invalid")
    if status == "verified" and not checksum_sha256:
        raise ValueError("verified receipts require a checksum")
    timestamp = now_iso()
    owns = conn is None
    conn = conn or connect(repo_root)
    try:
        if object_key:
            conn.execute(
                """DELETE FROM fixture_delivery_receipts
                   WHERE fixture_id = ? AND asset_id = ? AND destination = ?
                     AND version_hash = ? AND COALESCE(object_key, '') = ''""",
                (fixture_id, asset_id, destination, version_hash),
            )
        existing = conn.execute(
            """SELECT receipt_id FROM fixture_delivery_receipts
               WHERE fixture_id = ? AND asset_id = ? AND destination = ?
                 AND version_hash = ? AND COALESCE(object_key, '') = ?""",
            (fixture_id, asset_id, destination, version_hash, object_key),
        ).fetchone()
        receipt_id = existing["receipt_id"] if existing else f"rcp-{uuid.uuid4().hex[:16]}"
        conn.execute(
            """
            INSERT INTO fixture_delivery_receipts (
              receipt_id, fixture_id, asset_id, destination, version_hash, status,
              object_key, checksum_sha256, visibility_policy, verification_json,
              attempted_at, verified_at, error_text, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(fixture_id, asset_id, destination, version_hash, object_key)
            DO UPDATE SET status = excluded.status, checksum_sha256 = excluded.checksum_sha256,
              visibility_policy = excluded.visibility_policy,
              verification_json = excluded.verification_json,
              attempted_at = excluded.attempted_at, verified_at = excluded.verified_at,
              error_text = excluded.error_text, updated_at = excluded.updated_at
            """,
            (
                receipt_id, fixture_id, asset_id, destination, version_hash, status,
                object_key, checksum_sha256, visibility_policy, _json(verification or {}),
                timestamp, timestamp if status == "verified" else None, error_text,
                timestamp, timestamp,
            ),
        )
        if owns:
            conn.commit()
        return {
            "receiptId": receipt_id,
            "fixtureId": fixture_id,
            "assetId": asset_id,
            "destination": destination,
            "versionHash": version_hash,
            "status": status,
            "objectKey": object_key,
            "checksumSha256": checksum_sha256,
        }
    finally:
        if owns:
            conn.close()


def record_r2_upload_results(repo_root: Path, asset_id: str, upload_results: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Attach R2 results to active, R2-enabled placements at the configured editorial version."""
    results = [item for item in upload_results if isinstance(item, dict)]
    receipts: list[dict[str, Any]] = []
    with connect(repo_root) as conn:
        current_version = editorial_version_hash(conn, asset_id)
        rows = conn.execute(
            """
            SELECT p.fixture_id, x.version_hash, x.destinations_json
            FROM fixture_asset_placements p
            JOIN fixture_asset_destinations x
              ON x.fixture_id = p.fixture_id AND x.asset_id = p.asset_id
            WHERE p.asset_id = ? AND p.state = 'active'
            """,
            (asset_id,),
        ).fetchall()
        for row in rows:
            if "r2" not in _read_json(row["destinations_json"], []):
                continue
            if row["version_hash"] != current_version:
                continue
            for result in results:
                upload_status = str(result.get("status") or "failed")
                checksum = str(result.get("checksumSha256") or "")
                remote_checksum = str(result.get("remoteChecksumSha256") or "")
                verified = (
                    upload_status == "uploaded"
                    and bool(result.get("remoteVerified"))
                    and bool(checksum)
                    and remote_checksum == checksum
                )
                receipts.append(record_delivery_receipt(
                    repo_root,
                    fixture_id=row["fixture_id"],
                    asset_id=asset_id,
                    destination="r2",
                    version_hash=current_version,
                    status="verified" if verified else "failed",
                    object_key=str(result.get("key") or ""),
                    checksum_sha256=checksum,
                    visibility_policy="public" if str(result.get("bucket") or "").endswith("public") else "private",
                    verification={
                        "backend": result.get("backend"),
                        "bucket": result.get("bucket"),
                        "bytes": result.get("bytes"),
                        "contentType": result.get("contentType"),
                        "uploadStatus": upload_status,
                        "remoteVerified": bool(result.get("remoteVerified")),
                        "remoteChecksumSha256": remote_checksum,
                    },
                    error_text=str(result.get("error") or result.get("verificationError") or "remote R2 object was not checksum-verified") if not verified else "",
                    conn=conn,
                ))
        conn.commit()
    return {"ok": True, "assetId": asset_id, "receiptCount": len(receipts), "receipts": receipts}


def delivery_plan(repo_root: Path, fixture_id: str) -> dict[str, Any]:
    with connect(repo_root) as conn:
        breadcrumbs = fixture_breadcrumbs(conn, fixture_id)
        fixture = conn.execute("SELECT destination_defaults_json FROM fixtures WHERE fixture_id = ?", (fixture_id,)).fetchone()
        defaults = _read_json(fixture["destination_defaults_json"], ["r2"])
        # The receipt plan remains useful for owner-local Apple Photos and
        # archive work, while cloud/client delivery follows the fixture policy.
        from fixture_policy import (
            effective_fixture_policy,
            policy_allows_cloud,
            policy_allows_delivery,
            policy_allows_download,
        )
        policy = effective_fixture_policy(
            repo_root,
            fixture_id,
            conn=conn,
        )["effective"]
        cloud_allowed = policy_allows_cloud(policy)
        delivery_allowed = policy_allows_delivery(policy)
        download_allowed = policy_allows_download(policy)
        rows = conn.execute("""
            SELECT p.asset_id,
                   COALESCE(scoped.placement_state, d.pick_state, 'undecided') pick_state,
                   COALESCE(d.metadata_state, 'unreviewed') metadata_state,
                   COALESCE(d.pick_state, '') global_pick_state,
                   COALESCE(t.tombstone_state, '') tombstone_state,
                   COALESCE(lifecycle.lifecycle_state, '') lifecycle_state,
                   x.destinations_json,
                   x.version_hash
          FROM fixture_asset_placements p
          LEFT JOIN fixture_asset_decisions scoped
            ON scoped.fixture_id = p.fixture_id AND scoped.asset_id = p.asset_id
          LEFT JOIN sidecar_decisions d ON d.asset_id = p.asset_id
          LEFT JOIN sidecar_tombstones t
            ON t.asset_id = p.asset_id AND t.tombstone_state = 'active'
          LEFT JOIN media_lifecycle lifecycle
            ON lifecycle.media_id = p.asset_id
          LEFT JOIN fixture_asset_destinations x ON x.fixture_id = p.fixture_id AND x.asset_id = p.asset_id
          WHERE p.fixture_id = ? AND p.state = 'active'
          ORDER BY p.placed_at, p.asset_id
        """, (fixture_id,)).fetchall()
        # Native fixture culling is authoritative for pick state.  The global
        # Sidecar pick is retained only as a compatibility fallback for older
        # migrated rows that predate fixture_asset_decisions.
        items = []
        for row in rows:
            destinations = _read_json(row["destinations_json"], defaults)
            destinations = [
                destination
                for destination in destinations
                if destination != "r2" or cloud_allowed
            ]
            version_hash = row["version_hash"] or editorial_version_hash(conn, row["asset_id"])
            receipts = conn.execute("SELECT destination, status, object_key, checksum_sha256, verified_at, error_text FROM fixture_delivery_receipts WHERE fixture_id = ? AND asset_id = ? AND version_hash = ? ORDER BY updated_at", (fixture_id, row["asset_id"], version_hash)).fetchall()
            receipt_map: dict[str, dict[str, Any]] = {}
            for destination in destinations:
                destination_receipts = [dict(item) for item in receipts if item["destination"] == destination]
                actual = [item for item in destination_receipts if item.get("object_key")]
                destination_verified = bool(actual) and all(item.get("status") == "verified" for item in actual)
                errors = [str(item.get("error_text") or "") for item in destination_receipts if item.get("error_text")]
                receipt_map[destination] = {
                    "status": "verified" if destination_verified else ("failed" if errors else "pending"),
                    "items": destination_receipts,
                    "errorText": "; ".join(errors),
                }
            globally_blocked = row["global_pick_state"] == "hidden" or row["tombstone_state"] == "active" or row["lifecycle_state"] in {"hidden", "discarded"}
            approved = row["pick_state"] == "picked" and row["metadata_state"] == "approved" and not globally_blocked
            complete = approved and all(receipt_map.get(destination, {}).get("status") == "verified" for destination in destinations)
            items.append({"assetId": row["asset_id"], "pickState": row["pick_state"], "metadataState": row["metadata_state"], "approved": approved, "destinations": destinations, "versionHash": version_hash, "receipts": receipt_map, "complete": complete})
    return {
        "ok": True,
        "fixtureId": fixture_id,
        "breadcrumbs": breadcrumbs,
        "policy": policy,
        "cloudAllowed": cloud_allowed,
        "deliveryAllowed": delivery_allowed,
        "downloadAllowed": download_allowed,
        "assetCount": len(items),
        "approvedCount": sum(item["approved"] for item in items),
        "completeCount": sum(item["complete"] for item in items),
        "items": items,
        "clientMessageSent": False,
    }


def migrate_la_concha_tree(repo_root: Path) -> dict[str, Any]:
    with connect(repo_root) as conn:
        existing_root = conn.execute("SELECT * FROM fixtures WHERE fixture_id = ?", ("fixture-la-concha",)).fetchone()
        root = _fixture_row(existing_root) if existing_root else create_fixture(repo_root, "La Concha", fixture_id="fixture-la-concha", tags=["real-estate"], template_key="real-estate", access_gallery_key="la-concha", legacy_identity={"track": "RE", "fixture": "La Concha"}, conn=conn)
        apartment_1 = create_fixture(repo_root, "Apartment 1", parent_fixture_id=root["fixtureId"], fixture_id="fixture-la-concha-apartment-1", conn=conn)
        apartment_2 = create_fixture(repo_root, "Apartment 2", parent_fixture_id=root["fixtureId"], fixture_id="fixture-la-concha-apartment-2", conn=conn)
        common = create_fixture(repo_root, "Common", parent_fixture_id=root["fixtureId"], fixture_id="fixture-la-concha-common", conn=conn)
        children = [create_fixture(repo_root, name, parent_fixture_id=common["fixtureId"], fixture_id=f"fixture-la-concha-{_slug(name)}", conn=conn) for name in ("Street", "Main lobby", "Pool", "Tennis court")]
        conn.commit()
    access_grant = link_access_grant(
        repo_root,
        root["fixtureId"],
        provider="acs",
        external_identity="gallery:la-concha:client:corine",
        subject_label="Corine",
        recovery={"galleryKey": "la-concha", "livePolicyChanged": False, "clientMessageSent": False},
    )
    return {"ok": True, "root": root, "apartments": [apartment_1, apartment_2], "common": common, "commonChildren": children, "accessGrant": access_grant, "tree": fixture_tree(repo_root)}


def migrate_access_fixture_tree(repo_root: Path) -> dict[str, Any]:
    """Converge universal fixtures on the public Expo/Travel and private RE policy."""
    with connect(repo_root) as conn:
        expo = create_fixture(
            repo_root,
            "Expo",
            fixture_id="fixture-expo",
            tags=["public"],
            access_gallery_key="expo",
            legacy_identity={"track": "Expo"},
            conn=conn,
        )
        real_estate = create_fixture(
            repo_root,
            "RE",
            fixture_id="fixture-re",
            tags=["real-estate", "private"],
            template_key="real-estate",
            legacy_identity={"track": "RE"},
            conn=conn,
        )
        travel = create_fixture(
            repo_root,
            "Travel",
            fixture_id="fixture-travel",
            tags=["public", "travel"],
            access_gallery_key="travel",
            legacy_identity={"track": "Travel"},
            conn=conn,
        )
        conn.commit()

    la_concha = migrate_la_concha_tree(repo_root)["root"]
    move_fixture(repo_root, la_concha["fixtureId"], real_estate["fixtureId"])
    timestamp = now_iso()
    corine_identity = "corine.bn2007@yahoo.fr"
    with connect(repo_root) as conn:
        conn.execute(
            "UPDATE fixtures SET access_gallery_key = ?, updated_at = ? WHERE fixture_id = ?",
            ("corine-real-estate", timestamp, la_concha["fixtureId"]),
        )
        conn.execute(
            "UPDATE fixture_access_grants SET state = 'revoked', updated_at = ? WHERE fixture_id = ? AND external_identity <> ? AND state = 'active'",
            (timestamp, la_concha["fixtureId"], corine_identity),
        )
        conn.execute(
            "UPDATE fixtures SET archived_at = ?, updated_at = ? WHERE fixture_id = ? AND archived_at IS NULL",
            (timestamp, timestamp, "fixture-universal-parity-rehearsal"),
        )
        conn.commit()
    grant = link_access_grant(
        repo_root,
        la_concha["fixtureId"],
        provider="acs",
        external_identity=corine_identity,
        subject_label="Corine",
        recovery={
            "galleryKey": "corine-real-estate",
            "inheritToDescendants": True,
            "rootReGrant": False,
            "livePolicyChanged": True,
            "clientMessageSent": False,
        },
    )
    return {
        "ok": True,
        "publicRoots": [expo, travel],
        "privateRoot": real_estate,
        "exclusiveFixture": la_concha,
        "accessGrant": grant,
        "tree": fixture_tree(repo_root),
    }
