from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

try:
    from sidecar_identity_migration import build_dry_run, rehearse_synthetic
except ModuleNotFoundError:
    from scripts.sidecar_identity_migration import build_dry_run, rehearse_synthetic


class SidecarIdentityMigrationTests(unittest.TestCase):
    def _database(self, directory: Path, *, classification: bool = False, unknown: bool = False) -> Path:
        path = directory / "Owner.sqlite"
        connection = sqlite3.connect(path)
        connection.execute("PRAGMA foreign_keys = ON")
        connection.executescript(
            """
            CREATE TABLE fixtures (fixture_id TEXT PRIMARY KEY);
            CREATE TABLE sidecar_assets (
              asset_id TEXT PRIMARY KEY,
              source_anchor TEXT NOT NULL,
              filename TEXT NOT NULL DEFAULT '',
              favorite INTEGER NOT NULL DEFAULT 0,
              hidden INTEGER NOT NULL DEFAULT 0,
              photos_title TEXT,
              photos_keywords_json TEXT NOT NULL DEFAULT '[]',
              raw_json TEXT NOT NULL DEFAULT '{}',
              missing_at TEXT,
              created_at TEXT,
              updated_at TEXT
            );
            CREATE TABLE sidecar_decisions (
              asset_id TEXT PRIMARY KEY,
              rating INTEGER NOT NULL DEFAULT 0,
              color TEXT NOT NULL DEFAULT '',
              pick_state TEXT NOT NULL DEFAULT 'undecided',
              metadata_state TEXT NOT NULL DEFAULT 'unreviewed',
              title TEXT,
              caption TEXT,
              keywords_json TEXT NOT NULL DEFAULT '[]',
              rework_category TEXT NOT NULL DEFAULT '',
              rework_comment TEXT,
              metadata_ai_rung TEXT,
              metadata_ai_evidence_json TEXT NOT NULL DEFAULT '[]',
              metadata_ai_note TEXT,
              metadata_ai_attempt_count INTEGER NOT NULL DEFAULT 0,
              metadata_ai_last_error TEXT NOT NULL DEFAULT '',
              metadata_ai_last_attempt_at TEXT NOT NULL DEFAULT '',
              last_action TEXT,
              created_at TEXT,
              updated_at TEXT,
              FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
            );
            CREATE TABLE sidecar_tombstones (
              asset_id TEXT PRIMARY KEY,
              tombstone_state TEXT NOT NULL,
              reason TEXT,
              tombstoned_at TEXT,
              updated_at TEXT,
              FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
            );
            CREATE TABLE fixture_asset_decisions (
              fixture_id TEXT NOT NULL,
              asset_id TEXT NOT NULL,
              placement_state TEXT NOT NULL DEFAULT 'undecided',
              eligibility_state TEXT NOT NULL DEFAULT 'active',
              source TEXT NOT NULL DEFAULT 'native',
              last_action TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (fixture_id, asset_id),
              FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id),
              FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
            );
            CREATE TABLE fixture_asset_decision_events (
              event_id TEXT PRIMARY KEY,
              fixture_id TEXT NOT NULL,
              asset_id TEXT NOT NULL,
              before_state TEXT NOT NULL,
              after_state TEXT NOT NULL,
              action TEXT NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id),
              FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
            );
            CREATE TABLE asset_editorial_state (
              asset_id TEXT PRIMARY KEY,
              editorial_state TEXT NOT NULL DEFAULT 'unreviewed',
              ai_reasons_json TEXT NOT NULL DEFAULT '[]',
              ai_note TEXT NOT NULL DEFAULT '',
              ai_attempt_count INTEGER NOT NULL DEFAULT 0,
              ai_last_error TEXT NOT NULL DEFAULT '',
              requested_at TEXT,
              proposed_at TEXT,
              approved_at TEXT,
              created_at TEXT,
              updated_at TEXT,
              FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
            );
            CREATE TABLE asset_delivery_state (
              asset_id TEXT PRIMARY KEY,
              delivery_state TEXT NOT NULL DEFAULT 'not-ready',
              source_version_hash TEXT NOT NULL DEFAULT '',
              last_error TEXT NOT NULL DEFAULT '',
              created_at TEXT,
              updated_at TEXT,
              FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
            );
            CREATE TABLE asset_source_versions (
              version_id TEXT PRIMARY KEY,
              asset_id TEXT NOT NULL,
              metadata_fingerprint TEXT NOT NULL DEFAULT '',
              rendered_fingerprint TEXT NOT NULL DEFAULT '',
              state TEXT NOT NULL DEFAULT 'candidate',
              created_at TEXT,
              FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
            );
            CREATE UNIQUE INDEX source_version_fingerprint
              ON asset_source_versions(asset_id, metadata_fingerprint, rendered_fingerprint);
            CREATE TABLE asset_sync_state (
              asset_id TEXT PRIMARY KEY,
              photos_asset_id TEXT NOT NULL DEFAULT '',
              metadata_fingerprint TEXT NOT NULL DEFAULT '',
              rendered_fingerprint TEXT NOT NULL DEFAULT '',
              last_giveback_fingerprint TEXT NOT NULL DEFAULT '',
              last_error TEXT NOT NULL DEFAULT '',
              created_at TEXT,
              updated_at TEXT,
              FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
            );
            CREATE TABLE fixture_pool_assets (
              pool_id TEXT NOT NULL,
              asset_id TEXT NOT NULL,
              source_identity TEXT NOT NULL,
              snapshot_position INTEGER NOT NULL,
              PRIMARY KEY (pool_id, asset_id),
              FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
            );
            CREATE TABLE fixture_asset_placements (
              placement_id TEXT PRIMARY KEY,
              fixture_id TEXT NOT NULL,
              asset_id TEXT NOT NULL,
              state TEXT NOT NULL,
              updated_at TEXT,
              FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id),
              FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
            );
            CREATE TABLE asset_publications (
              asset_id TEXT NOT NULL,
              fixture_id TEXT NOT NULL,
              source_version_hash TEXT NOT NULL,
              state TEXT NOT NULL,
              published_at TEXT NOT NULL,
              PRIMARY KEY (asset_id, fixture_id, source_version_hash),
              FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id),
              FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id)
            );
            CREATE TABLE public_catalog_publications (
              asset_id TEXT NOT NULL,
              source_version_hash TEXT NOT NULL,
              media_id TEXT NOT NULL,
              state TEXT NOT NULL,
              PRIMARY KEY (asset_id, source_version_hash),
              FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
            );
            CREATE TABLE catalog_collection_resolutions (
              asset_id TEXT NOT NULL,
              source_version_hash TEXT NOT NULL,
              collection_slug TEXT NOT NULL,
              PRIMARY KEY (asset_id, source_version_hash),
              FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
            );
            CREATE TABLE asset_sale_references (
              order_id TEXT NOT NULL,
              asset_id TEXT NOT NULL,
              source_version_hash TEXT NOT NULL,
              checksum_sha256 TEXT NOT NULL,
              PRIMARY KEY (order_id, asset_id, source_version_hash),
              FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
            );
            CREATE TABLE fixture_delivery_receipts (
              receipt_id TEXT PRIMARY KEY,
              fixture_id TEXT NOT NULL,
              asset_id TEXT NOT NULL,
              destination TEXT NOT NULL,
              version_hash TEXT NOT NULL,
              status TEXT NOT NULL,
              object_key TEXT,
              checksum_sha256 TEXT,
              UNIQUE (fixture_id, asset_id, destination, version_hash, object_key),
              FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id),
              FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
            );
            CREATE TABLE fixture_review_operations (
              operation_id TEXT PRIMARY KEY,
              anchor_asset_id TEXT NOT NULL,
              asset_ids_json TEXT NOT NULL,
              before_json TEXT NOT NULL,
              after_json TEXT NOT NULL
            );
            CREATE TABLE asset_current_image_sizes (
              asset_id TEXT PRIMARY KEY,
              current_image_byte_count INTEGER NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE sidecar_fence_pushes (
              asset_id TEXT PRIMARY KEY,
              status TEXT NOT NULL,
              pushed_at TEXT,
              updated_at TEXT,
              note TEXT
            );
            CREATE TABLE owner_connector_lifecycle_arm_intents (
              operation_id TEXT PRIMARY KEY,
              operation TEXT NOT NULL,
              denied INTEGER NOT NULL,
              asset_ids_json TEXT NOT NULL,
              request_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE owner_hosted_lifecycle_requests (
              request_id TEXT PRIMARY KEY,
              asset_ids_json TEXT NOT NULL,
              state TEXT NOT NULL
            );
            CREATE TABLE owner_lifecycle_outbox (
              operation_id TEXT NOT NULL,
              canonical_media_id TEXT NOT NULL,
              canonical_asset_id TEXT NOT NULL,
              state TEXT NOT NULL,
              PRIMARY KEY (operation_id, canonical_media_id)
            );
            CREATE TABLE owner_waste_basket_entries (
              entry_id TEXT PRIMARY KEY,
              asset_id TEXT NOT NULL,
              state TEXT NOT NULL
            );
            CREATE TABLE owner_waste_basket_operations (
              operation_id TEXT PRIMARY KEY,
              asset_ids_json TEXT NOT NULL,
              status TEXT NOT NULL
            );
            CREATE TABLE owner_waste_basket_receipts (
              operation_id TEXT NOT NULL,
              asset_id TEXT NOT NULL,
              receipt_state TEXT NOT NULL,
              PRIMARY KEY (operation_id, asset_id)
            );
            """
        )
        connection.execute("INSERT INTO fixtures VALUES ('fixture-synthetic')")
        if unknown:
            connection.execute(
                "CREATE TABLE mystery_asset_refs (asset_id TEXT NOT NULL, note TEXT)"
            )
        if classification:
            assets = [
                ("cloud-a", "apple-photos-cloud://cloud-a", {"cloudIdentifier": "cloud-a"}),
                ("canonical-dup-a", "apple-photos-cloud://cloud-dup", {"cloudIdentifier": "cloud-dup"}),
                ("canonical-dup-b", "apple-photos-cloud://cloud-dup", {"cloudIdentifier": "cloud-dup"}),
                ("legacy-collision", "apple-photos://local-collision", {"localIdentifier": "local-collision"}),
                ("legacy-rewrite", "apple-photos://local-rewrite", {"localIdentifier": "local-rewrite"}),
                ("legacy-unmapped", "apple-photos://local-unmapped", {"localIdentifier": "local-unmapped"}),
                ("legacy-ambiguous", "apple-photos://local-ambiguous", {"localIdentifier": "local-ambiguous"}),
                ("legacy-dup-a", "apple-photos://local-dup", {"localIdentifier": "local-dup"}),
                ("legacy-dup-b", "apple-photos://local-dup", {"localIdentifier": "local-dup"}),
                ("missing-row", "other://missing", {}),
            ]
            for asset_id, anchor, raw in assets:
                connection.execute(
                    "INSERT INTO sidecar_assets(asset_id, source_anchor, raw_json) VALUES (?, ?, ?)",
                    (asset_id, anchor, json.dumps(raw)),
                )
        else:
            connection.executemany(
                "INSERT INTO sidecar_assets(asset_id, source_anchor, filename, raw_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                [
                    ("cloud-a", "apple-photos-cloud://cloud-a", "same.jpg", json.dumps({"cloudIdentifier": "cloud-a", "localIdentifier": "local-current", "checksumSha256": "checksum-1"}), "2024-01", "2024-02"),
                    ("legacy-collision", "apple-photos://local-collision", "", json.dumps({"localIdentifier": "local-collision", "checksumSha256": "checksum-1"}), "2024-01", "2024-01"),
                    ("legacy-rewrite", "apple-photos://local-rewrite", "rewrite.jpg", json.dumps({"localIdentifier": "local-rewrite", "checksumSha256": "checksum-2", "previewSha256": "preview-2"}), "2024-01", "2024-01"),
                ],
            )
            connection.execute(
                "UPDATE sidecar_assets SET photos_title = 'Canonical', photos_keywords_json = '[\"keep\"]' WHERE asset_id = 'cloud-a'"
            )
            connection.execute(
                "UPDATE sidecar_assets SET favorite = 1, photos_keywords_json = '[\"legacy\"]' WHERE asset_id = 'legacy-collision'"
            )
            connection.executemany(
                "INSERT INTO sidecar_decisions(asset_id, rating, pick_state, metadata_state, title, keywords_json, rework_comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    ("cloud-a", 3, "picked", "unreviewed", "Canonical", '["keep"]', "", "2024-01", "2024-02"),
                    ("legacy-collision", 0, "undecided", "proposed", "", '["legacy"]', "preserve this note", "2024-01", "2024-01"),
                ],
            )
            connection.execute(
                "INSERT INTO sidecar_tombstones(asset_id, tombstone_state, reason, tombstoned_at, updated_at) VALUES ('legacy-collision', 'active', 'synthetic-check', '2024-01', '2024-01')"
            )
            connection.executemany(
                "INSERT INTO fixture_asset_decisions(fixture_id, asset_id, placement_state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                [("fixture-synthetic", "cloud-a", "undecided", "2024-01", "2024-02"), ("fixture-synthetic", "legacy-collision", "picked", "2024-01", "2024-01")],
            )
            connection.execute(
                "INSERT INTO fixture_asset_decision_events(event_id, fixture_id, asset_id, before_state, after_state, action, created_at) VALUES ('event-1', 'fixture-synthetic', 'legacy-collision', 'undecided', 'picked', 'pick', '2024-01')"
            )
            connection.execute(
                "INSERT INTO asset_editorial_state(asset_id, editorial_state, ai_reasons_json, ai_note, approved_at) VALUES ('legacy-collision', 'approved', '[\"composition\"]', 'editorial note', '2024-01')"
            )
            connection.execute(
                "INSERT INTO asset_delivery_state(asset_id, delivery_state, source_version_hash) VALUES ('legacy-collision', 'live', 'version-1')"
            )
            connection.execute(
                "INSERT INTO asset_source_versions(version_id, asset_id, metadata_fingerprint, rendered_fingerprint, state) VALUES ('version-row-1', 'legacy-collision', 'metadata-1', 'rendered-1', 'live')"
            )
            connection.execute(
                "INSERT INTO asset_sync_state(asset_id, photos_asset_id, metadata_fingerprint) VALUES ('legacy-collision', 'old-local-runtime', 'metadata-1')"
            )
            connection.execute(
                "INSERT INTO fixture_pool_assets(pool_id, asset_id, source_identity, snapshot_position) VALUES ('pool-1', 'legacy-collision', 'local-capture', 1)"
            )
            connection.execute(
                "INSERT INTO fixture_asset_placements(placement_id, fixture_id, asset_id, state) VALUES ('placement-1', 'fixture-synthetic', 'legacy-collision', 'active')"
            )
            connection.execute(
                "INSERT INTO asset_publications(asset_id, fixture_id, source_version_hash, state, published_at) VALUES ('legacy-collision', 'fixture-synthetic', 'version-1', 'live', '2024-01')"
            )
            connection.execute(
                "INSERT INTO public_catalog_publications(asset_id, source_version_hash, media_id, state) VALUES ('legacy-collision', 'version-1', 'media-1', 'live')"
            )
            connection.execute(
                "INSERT INTO catalog_collection_resolutions(asset_id, source_version_hash, collection_slug) VALUES ('legacy-collision', 'version-1', 'synthetic')"
            )
            connection.execute(
                "INSERT INTO asset_sale_references(order_id, asset_id, source_version_hash, checksum_sha256) VALUES ('order-1', 'legacy-collision', 'version-1', 'checksum-1')"
            )
            connection.execute(
                "INSERT INTO fixture_delivery_receipts(receipt_id, fixture_id, asset_id, destination, version_hash, status, object_key, checksum_sha256) VALUES ('receipt-1', 'fixture-synthetic', 'legacy-collision', 'r2', 'version-1', 'verified', 'key-1', 'checksum-1')"
            )
            connection.execute(
                "INSERT INTO fixture_review_operations(operation_id, anchor_asset_id, asset_ids_json, before_json, after_json) VALUES ('operation-1', 'legacy-collision', '[\"legacy-collision\", \"legacy-rewrite\"]', '{\"history\":true}', '{\"history\":true}')"
            )
            connection.execute(
                "INSERT INTO asset_current_image_sizes VALUES ('legacy-rewrite', 2048, '2024-02')"
            )
            connection.execute(
                "INSERT INTO sidecar_fence_pushes VALUES ('legacy-rewrite', 'pending', NULL, '2024-02', '')"
            )
            connection.execute(
                "INSERT INTO owner_hosted_lifecycle_requests VALUES ('hosted-1', '[\"cloud-a\"]', 'completed')"
            )
            connection.execute(
                "INSERT INTO owner_lifecycle_outbox VALUES ('lifecycle-1', 'media-1', 'cloud-a', 'locally_acked')"
            )
            connection.execute(
                "INSERT INTO owner_waste_basket_entries VALUES ('entry-1', 'cloud-a', 'restored')"
            )
            connection.execute(
                "INSERT INTO owner_waste_basket_operations VALUES ('waste-operation-1', '[\"cloud-a\"]', 'completed')"
            )
            connection.execute(
                "INSERT INTO owner_waste_basket_receipts VALUES ('waste-operation-1', 'cloud-a', 'restored')"
            )
        connection.commit()
        connection.close()
        return path

    def _mapping(self, directory: Path, rows: list[dict[str, str]]) -> Path:
        path = directory / "source-tied-map.jsonl"
        path.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")
        return path

    def test_dry_run_classifies_all_required_classes_and_hides_identifiers(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            owner = self._database(directory, classification=True)
            mapping = self._mapping(
                directory,
                [
                    {"localIdentifier": "local-collision", "cloudIdentifier": "cloud-a"},
                    {"localIdentifier": "local-rewrite", "cloudIdentifier": "cloud-new"},
                    {"localIdentifier": "local-ambiguous", "cloudIdentifier": "cloud-c"},
                    {"localIdentifier": "local-ambiguous", "cloudIdentifier": "cloud-d"},
                    {"localIdentifier": "local-dup", "cloudIdentifier": "cloud-e"},
                ],
            )
            result = build_dry_run(owner, mapping)["report"]
            encoded = json.dumps(result, sort_keys=True)

        counts = result["classificationCounts"]
        self.assertEqual(counts["canonical"], 1)
        self.assertEqual(counts["duplicate-canonical"], 2)
        self.assertEqual(counts["collision-existing-canonical"], 1)
        self.assertEqual(counts["local-only"], 1)
        self.assertEqual(counts["unmapped"], 1)
        self.assertEqual(counts["ambiguous"], 1)
        self.assertEqual(counts["duplicate-local"], 2)
        self.assertEqual(counts["missing-identity"], 1)
        self.assertFalse(result["safety"]["applyReady"])
        self.assertTrue(result["mappingContract"]["sourceTiedRequired"])
        self.assertTrue(result["mergeSemantics"]["scalarReferences"]["knownSurfacesOnly"])
        self.assertEqual(result["mergeSemantics"]["fieldRules"]["nonEmptyConflict"], "fail closed")
        for identifier in ("local-collision", "cloud-a", "local-new", "cloud-c", "cloud-d"):
            self.assertNotIn(identifier, encoded)
        self.assertFalse(result["quarantine"]["privacy"]["rawIdentifiersIncluded"])

    def test_collision_and_rewrite_preserve_lineage_and_second_run_is_noop(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            owner = self._database(directory)
            mapping = self._mapping(
                directory,
                [
                    {"localIdentifier": "local-collision", "cloudIdentifier": "cloud-a"},
                    {"localIdentifier": "local-rewrite", "cloudIdentifier": "cloud-b"},
                ],
            )
            before = owner.read_bytes()
            report = rehearse_synthetic(owner, mapping, directory / "rehearsal")
            working = directory / "rehearsal" / "working.sqlite"
            connection = sqlite3.connect(working)
            connection.row_factory = sqlite3.Row
            target = connection.execute("SELECT * FROM sidecar_assets WHERE asset_id = 'cloud-a'").fetchone()
            decision = connection.execute("SELECT * FROM sidecar_decisions WHERE asset_id = 'cloud-a'").fetchone()
            fixture_decision = connection.execute("SELECT * FROM fixture_asset_decisions WHERE asset_id = 'cloud-a'").fetchone()
            tombstone = connection.execute("SELECT * FROM sidecar_tombstones WHERE asset_id = 'cloud-a'").fetchone()
            publication = connection.execute("SELECT * FROM asset_publications WHERE asset_id = 'cloud-a'").fetchone()
            review = connection.execute("SELECT * FROM fixture_review_operations").fetchone()
            sync = connection.execute("SELECT * FROM asset_sync_state WHERE asset_id = 'cloud-a'").fetchone()
            image_size = connection.execute("SELECT * FROM asset_current_image_sizes").fetchone()
            fence_push = connection.execute("SELECT * FROM sidecar_fence_pushes").fetchone()
            hosted_request = connection.execute("SELECT * FROM owner_hosted_lifecycle_requests").fetchone()
            lifecycle_outbox = connection.execute("SELECT * FROM owner_lifecycle_outbox").fetchone()
            waste_entry = connection.execute("SELECT * FROM owner_waste_basket_entries").fetchone()
            waste_operation = connection.execute("SELECT * FROM owner_waste_basket_operations").fetchone()
            waste_receipt = connection.execute("SELECT * FROM owner_waste_basket_receipts").fetchone()
            source_count = connection.execute("SELECT count(*) FROM sidecar_assets WHERE asset_id LIKE 'legacy-%'").fetchone()[0]
            connection.close()
            source_unchanged = before == owner.read_bytes()

        self.assertTrue(source_unchanged)
        self.assertTrue(report["rehearsal"]["applyPerformed"])
        self.assertEqual(report["rehearsal"]["mergedCount"], 1)
        self.assertEqual(report["rehearsal"]["rewriteOnlyCount"], 1)
        self.assertTrue(report["rehearsal"]["secondRunNoOp"])
        self.assertTrue(report["rehearsal"]["rollbackRestoreVerified"])
        self.assertEqual(source_count, 0)
        self.assertEqual(target["photos_title"], "Canonical")
        self.assertEqual(set(json.loads(target["photos_keywords_json"])), {"keep", "legacy"})
        self.assertIn("local-collision", json.loads(target["raw_json"])["legacyLocalIdentifiers"])
        self.assertEqual(decision["metadata_state"], "proposed")
        self.assertEqual(set(json.loads(decision["keywords_json"])), {"keep", "legacy"})
        self.assertEqual(fixture_decision["placement_state"], "picked")
        self.assertEqual(tombstone["tombstone_state"], "active")
        self.assertIsNotNone(publication)
        self.assertIn("cloud-a", json.loads(review["asset_ids_json"]))
        self.assertEqual(sync["photos_asset_id"], "old-local-runtime")
        self.assertEqual(image_size["asset_id"], "cloud-b")
        self.assertEqual(fence_push["asset_id"], "cloud-b")
        self.assertEqual(json.loads(hosted_request["asset_ids_json"]), ["cloud-a"])
        self.assertEqual(lifecycle_outbox["canonical_asset_id"], "cloud-a")
        self.assertEqual(waste_entry["asset_id"], "cloud-a")
        self.assertEqual(json.loads(waste_operation["asset_ids_json"]), ["cloud-a"])
        self.assertEqual(waste_receipt["asset_id"], "cloud-a")
        self.assertTrue(report["referenceContract"]["operationalDrain"]["allDrained"])
        self.assertEqual(
            report["referenceContract"]["preservedReferences"]["preservedAuditRowCount"],
            0,
        )
        self.assertEqual(
            report["referenceContract"]["preservedReferences"]["sourceLocalReferenceRowCount"],
            0,
        )

    def test_unresolved_rows_get_privacy_safe_quarantine_and_never_apply(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            owner = self._database(directory, classification=True)
            mapping = self._mapping(directory, [{"localIdentifier": "local-ambiguous", "cloudIdentifier": "cloud-c"}, {"localIdentifier": "local-ambiguous", "cloudIdentifier": "cloud-d"}])
            report = rehearse_synthetic(owner, mapping, directory / "blocked")
            encoded = (directory / "blocked" / "quarantine-manifest.json").read_text(encoding="utf-8")
        self.assertFalse(report["rehearsal"]["applyPerformed"])
        self.assertFalse(report["rehearsal"]["workingCopyCreated"])
        self.assertNotIn("local-ambiguous", encoded)
        self.assertGreater(report["quarantine"]["entryCount"], 0)

    def test_duplicate_local_is_quarantined_even_with_one_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            owner = self._database(directory, classification=True)
            mapping = self._mapping(directory, [{"localIdentifier": "local-dup", "cloudIdentifier": "cloud-e"}])
            report = build_dry_run(owner, mapping)["report"]
        self.assertEqual(report["classificationCounts"]["duplicate-local"], 2)
        self.assertFalse(report["safety"]["applyReady"])

    def test_ineligible_mapping_status_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            owner = self._database(directory)
            mapping = self._mapping(
                directory,
                [{
                    "localIdentifier": "local-collision",
                    "cloudIdentifier": "cloud-a",
                    "status": "ambiguous-local-to-cloud",
                }],
            )
            report = build_dry_run(owner, mapping)["report"]
        self.assertIn("ineligible-source-mapping-status", report["safety"]["blockedReasons"])
        self.assertEqual(report["mapping"]["ineligibleStatusCount"], 1)
        self.assertFalse(report["safety"]["applyReady"])

    def test_unknown_reference_surface_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            owner = self._database(directory, unknown=True)
            connection = sqlite3.connect(owner)
            connection.execute("INSERT INTO mystery_asset_refs VALUES ('legacy-collision', 'unknown')")
            connection.commit()
            connection.close()
            mapping = self._mapping(directory, [{"localIdentifier": "local-collision", "cloudIdentifier": "cloud-a"}, {"localIdentifier": "local-rewrite", "cloudIdentifier": "cloud-b"}])
            report = rehearse_synthetic(owner, mapping, directory / "unknown")
        self.assertIn("unknown-schema-or-reference-surface", report["safety"]["blockedReasons"])
        self.assertFalse(report["rehearsal"]["applyPerformed"])
        self.assertEqual(report["schema"]["unknownSurfaceCount"], 1)

    def test_active_lifecycle_intent_blocks_before_copy(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            owner = self._database(directory)
            connection = sqlite3.connect(owner)
            connection.execute(
                "INSERT INTO owner_connector_lifecycle_arm_intents VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    "intent-1",
                    "restore",
                    0,
                    '["legacy-collision"]',
                    '{"operationId":"intent-1"}',
                    "2024-01",
                    "2024-01",
                ),
            )
            connection.commit()
            connection.close()
            mapping = self._mapping(
                directory,
                [
                    {"localIdentifier": "local-collision", "cloudIdentifier": "cloud-a"},
                    {"localIdentifier": "local-rewrite", "cloudIdentifier": "cloud-b"},
                ],
            )
            report = rehearse_synthetic(owner, mapping, directory / "active-intent")
        self.assertIn(
            "pending-connector-lifecycle-arm-intents",
            report["safety"]["blockedReasons"],
        )
        self.assertFalse(report["rehearsal"]["workingCopyCreated"])

    def test_noncanonical_lifecycle_outbox_reference_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            owner = self._database(directory)
            connection = sqlite3.connect(owner)
            connection.execute(
                "UPDATE owner_lifecycle_outbox SET canonical_asset_id = 'legacy-collision'"
            )
            connection.commit()
            connection.close()
            mapping = self._mapping(
                directory,
                [
                    {"localIdentifier": "local-collision", "cloudIdentifier": "cloud-a"},
                    {"localIdentifier": "local-rewrite", "cloudIdentifier": "cloud-b"},
                ],
            )
            report = rehearse_synthetic(owner, mapping, directory / "bad-outbox")
        self.assertIn(
            "noncanonical-canonical-audit-reference",
            report["safety"]["blockedReasons"],
        )
        self.assertFalse(report["rehearsal"]["workingCopyCreated"])

    def test_legacy_lifecycle_audit_reference_requires_alias_plan(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            owner = self._database(directory)
            connection = sqlite3.connect(owner)
            connection.execute(
                "UPDATE owner_waste_basket_entries SET asset_id = 'legacy-collision'"
            )
            connection.commit()
            connection.close()
            mapping = self._mapping(
                directory,
                [
                    {"localIdentifier": "local-collision", "cloudIdentifier": "cloud-a"},
                    {"localIdentifier": "local-rewrite", "cloudIdentifier": "cloud-b"},
                ],
            )
            report = rehearse_synthetic(owner, mapping, directory / "legacy-audit")
        self.assertIn(
            "preserved-lifecycle-audit-references-require-alias-plan",
            report["safety"]["blockedReasons"],
        )
        self.assertEqual(
            report["referenceContract"]["preservedReferences"]["preservedAuditRowCount"],
            1,
        )
        self.assertFalse(report["rehearsal"]["workingCopyCreated"])

    def test_rollback_is_verified_after_injected_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            owner = self._database(directory)
            mapping = self._mapping(directory, [{"localIdentifier": "local-collision", "cloudIdentifier": "cloud-a"}, {"localIdentifier": "local-rewrite", "cloudIdentifier": "cloud-b"}])
            report = rehearse_synthetic(owner, mapping, directory / "rollback", failure_stage="after-first-reference")
        self.assertFalse(report["rehearsal"]["applyPerformed"])
        self.assertTrue(report["rehearsal"]["rollbackVerified"])

    def test_invariant_failure_is_blocked_and_rolled_back(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            owner = self._database(directory)
            mapping = self._mapping(directory, [{"localIdentifier": "local-collision", "cloudIdentifier": "cloud-a"}, {"localIdentifier": "local-rewrite", "cloudIdentifier": "cloud-b"}])
            report = rehearse_synthetic(owner, mapping, directory / "invariant", failure_stage="invariant")
        self.assertEqual(report["rehearsal"]["errorType"], "MigrationSafetyError")
        self.assertTrue(report["rehearsal"]["rollbackVerified"])

    def test_conflicting_non_empty_values_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            owner = self._database(directory)
            connection = sqlite3.connect(owner)
            connection.execute(
                "UPDATE sidecar_assets SET raw_json = ? WHERE asset_id = 'legacy-collision'",
                (json.dumps({"localIdentifier": "local-collision", "checksumSha256": "different"}),),
            )
            connection.commit()
            connection.close()
            mapping = self._mapping(directory, [{"localIdentifier": "local-collision", "cloudIdentifier": "cloud-a"}, {"localIdentifier": "local-rewrite", "cloudIdentifier": "cloud-b"}])
            report = rehearse_synthetic(owner, mapping, directory / "conflict")
        self.assertFalse(report["rehearsal"]["applyPerformed"])
        self.assertTrue(report["rehearsal"]["rollbackVerified"])


if __name__ == "__main__":
    unittest.main()
