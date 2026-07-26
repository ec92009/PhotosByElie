import tempfile
import unittest
import json
import hashlib
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixture_pipeline import (
    apply_fixture_state_migration,
    apply_pool_refresh,
    adopt_upload_run,
    archive_fixture,
    configure_asset_destinations,
    create_fixture,
    create_pool,
    delivery_plan,
    fixture_tree,
    fixture_candidate_asset_ids,
    effective_fixture_access_grants,
    list_pools,
    list_placements,
    link_access_grant,
    migrate_access_fixture_tree,
    migrate_la_concha_tree,
    move_fixture,
    move_placement,
    place_assets,
    plan_fixture_state_migration,
    plan_upload_run_adoption,
    preview_pool_refresh,
    remove_placement,
    rename_fixture,
    record_r2_upload_results,
    record_source_batch,
    reopen_fixture,
    restore_placement,
    search_assets,
    set_fixture_asset_state,
    editorial_version_hash,
)
from sidecar_state_db import connect, record_decision, upsert_assets


class FixturePipelineTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        upsert_assets(self.root, [
            {"localIdentifier": "asset-1", "filename": "A.JPG", "mediaType": "photo", "creationDate": "2026-07-15T10:00:00Z", "keywords": ["La Concha"]},
            {"localIdentifier": "asset-2", "filename": "B.MOV", "mediaType": "video", "creationDate": "2026-07-15T10:01:00Z"},
            {"localIdentifier": "asset-3", "filename": "C.JPG", "mediaType": "photo", "creationDate": "2026-07-16T10:00:00Z"},
        ])

    def tearDown(self):
        self.temp.cleanup()

    def test_recursive_tree_keeps_stable_ids_and_rejects_cycles(self):
        root = create_fixture(self.root, "RE", fixture_id="root")
        fixture = create_fixture(self.root, "La Concha", parent_fixture_id=root["fixtureId"], fixture_id="la-concha")
        child = create_fixture(self.root, "Apartment 1", parent_fixture_id=fixture["fixtureId"], fixture_id="apt-1")
        self.assertEqual(fixture_tree(self.root)[0]["children"][0]["children"][0]["fixtureId"], child["fixtureId"])
        with self.assertRaisesRegex(ValueError, "descendants"):
            move_fixture(self.root, root["fixtureId"], child["fixtureId"])
        renamed = rename_fixture(self.root, fixture["fixtureId"], "La Concha renamed")
        self.assertEqual(renamed["fixtureId"], "la-concha")
        self.assertEqual(renamed["name"], "La Concha renamed")
        self.assertTrue(archive_fixture(self.root, fixture["fixtureId"])["archivedAt"])
        self.assertFalse(reopen_fixture(self.root, fixture["fixtureId"])["archivedAt"])

    def test_fixture_state_migration_is_read_only_then_backed_up_and_reversible(self):
        expo = create_fixture(self.root, "Expo", fixture_id="fixture-expo")
        parent = create_fixture(self.root, "RE", fixture_id="fixture-re")
        child = create_fixture(
            self.root,
            "La Concha",
            parent_fixture_id=parent["fixtureId"],
            fixture_id="fixture-la-concha",
        )
        record_decision(self.root, {"assetId": "asset-1", "action": "pick"})
        record_decision(self.root, {"assetId": "asset-2", "action": "reject"})
        place_assets(self.root, child["fixtureId"], ["asset-3"])
        database = self.root / "assets/owner-actions/Owner.sqlite"
        before_hash = hashlib.sha256(database.read_bytes()).hexdigest()

        plan = plan_fixture_state_migration(self.root)
        self.assertEqual(hashlib.sha256(database.read_bytes()).hexdigest(), before_hash)
        self.assertEqual(plan["legacyExpoPicked"], 1)
        self.assertEqual(plan["legacyExpoHidden"], 1)
        self.assertEqual(plan["explicitPlacementCount"], 1)
        self.assertEqual(plan["ancestorClosureCount"], 2)
        self.assertFalse(plan["applied"])

        receipt = apply_fixture_state_migration(self.root)
        self.assertTrue(receipt["applied"])
        self.assertTrue(Path(receipt["backupPath"]).exists())
        self.assertTrue(Path(receipt["receiptPath"]).exists())
        self.assertEqual(receipt["globalEditorialMutationCount"], 0)
        with connect(self.root) as conn:
            rows = {
                (row["fixture_id"], row["asset_id"]): (
                    row["placement_state"],
                    row["eligibility_state"],
                )
                for row in conn.execute(
                    """
                    SELECT fixture_id, asset_id, placement_state, eligibility_state
                    FROM fixture_asset_decisions
                    """
                ).fetchall()
            }
            self.assertEqual(rows[(expo["fixtureId"], "asset-1")], ("picked", "active"))
            self.assertEqual(rows[(expo["fixtureId"], "asset-2")], ("hidden", "active"))
            self.assertEqual(rows[(parent["fixtureId"], "asset-3")], ("picked", "active"))
            self.assertEqual(rows[(child["fixtureId"], "asset-3")], ("picked", "active"))
            self.assertEqual(
                conn.execute(
                    "SELECT metadata_state FROM sidecar_decisions WHERE asset_id = 'asset-1'"
                ).fetchone()[0],
                "unreviewed",
            )
        replayed = apply_fixture_state_migration(self.root)
        self.assertTrue(replayed["idempotencyReplayed"])

    def test_fixture_universes_preserve_dormant_child_decisions(self):
        parent = create_fixture(self.root, "Root", fixture_id="root")
        child = create_fixture(
            self.root,
            "Child",
            parent_fixture_id=parent["fixtureId"],
            fixture_id="child",
        )
        set_fixture_asset_state(self.root, parent["fixtureId"], ["asset-1"], "picked")
        set_fixture_asset_state(self.root, child["fixtureId"], ["asset-1"], "picked")
        self.assertIn("asset-1", fixture_candidate_asset_ids(self.root, child["fixtureId"]))

        set_fixture_asset_state(self.root, parent["fixtureId"], ["asset-1"], "hidden")
        self.assertNotIn("asset-1", fixture_candidate_asset_ids(self.root, child["fixtureId"]))
        with connect(self.root) as conn:
            child_state = conn.execute(
                """
                SELECT placement_state, eligibility_state
                FROM fixture_asset_decisions
                WHERE fixture_id = 'child' AND asset_id = 'asset-1'
                """
            ).fetchone()
            self.assertEqual(tuple(child_state), ("picked", "dormant"))

        set_fixture_asset_state(self.root, parent["fixtureId"], ["asset-1"], "picked")
        self.assertIn("asset-1", fixture_candidate_asset_ids(self.root, child["fixtureId"]))
        self.assertEqual(
            fixture_candidate_asset_ids(self.root, parent["fixtureId"]),
            ["asset-3", "asset-2", "asset-1"],
        )

    def test_access_grants_inherit_downward_only_and_new_roots_are_owner_only(self):
        root = create_fixture(self.root, "Root", fixture_id="root")
        child = create_fixture(
            self.root,
            "Child",
            parent_fixture_id=root["fixtureId"],
            fixture_id="child",
        )
        sibling = create_fixture(
            self.root,
            "Sibling",
            parent_fixture_id=root["fixtureId"],
            fixture_id="sibling",
        )
        grandchild = create_fixture(
            self.root,
            "Grandchild",
            parent_fixture_id=child["fixtureId"],
            fixture_id="grandchild",
        )
        with connect(self.root) as conn:
            self.assertEqual(
                conn.execute("SELECT owner_only FROM fixtures WHERE fixture_id = 'root'").fetchone()[0],
                1,
            )
        link_access_grant(
            self.root,
            root["fixtureId"],
            provider="acs",
            external_identity="root@example.com",
        )
        link_access_grant(
            self.root,
            child["fixtureId"],
            provider="acs",
            external_identity="child@example.com",
        )
        self.assertEqual(
            {item["externalIdentity"] for item in effective_fixture_access_grants(self.root, grandchild["fixtureId"])},
            {"root@example.com", "child@example.com"},
        )
        self.assertEqual(
            {item["externalIdentity"] for item in effective_fixture_access_grants(self.root, sibling["fixtureId"])},
            {"root@example.com"},
        )
        self.assertEqual(
            {item["externalIdentity"] for item in effective_fixture_access_grants(self.root, root["fixtureId"])},
            {"root@example.com"},
        )

    def test_search_and_pool_are_read_only_stable_and_idempotent(self):
        fixture = create_fixture(self.root, "Fixture")
        record_decision(self.root, {"assetId": "asset-1", "action": "metadata", "caption": "Mediterranean terrace", "metadataState": "proposed"})
        self.assertEqual(search_assets(self.root, {"query": "Mediterranean"})["totalCount"], 1)
        result = search_assets(self.root, {"mediaTypes": ["photo"], "query": ".jpg"})
        self.assertEqual(result["totalCount"], 2)
        pool = create_pool(self.root, fixture["fixtureId"], [item["assetId"] for item in result["items"]], criteria=result["filters"])
        again = create_pool(self.root, fixture["fixtureId"], [item["assetId"] for item in result["items"]], criteria=result["filters"])
        self.assertEqual(pool["poolId"], again["poolId"])
        self.assertEqual(
            [item["poolId"] for item in list_pools(self.root, fixture_id=fixture["fixtureId"])],
            [pool["poolId"]],
        )
        self.assertEqual(list_pools(self.root, fixture_id="missing"), [])
        upsert_assets(self.root, [{"localIdentifier": "asset-4", "filename": "D.JPG", "mediaType": "photo", "creationDate": "2026-07-17T10:00:00Z"}])
        self.assertEqual(pool["assetCount"], 2)
        refresh = preview_pool_refresh(self.root, pool["poolId"])
        self.assertEqual(refresh["afterCount"], 3)
        self.assertFalse(refresh["applied"])
        applied = apply_pool_refresh(self.root, pool["poolId"])
        self.assertTrue(applied["applied"])
        self.assertEqual(applied["pool"]["assetCount"], 3)
        self.assertEqual(apply_pool_refresh(self.root, pool["poolId"])["pool"]["poolId"], applied["pool"]["poolId"])

    def test_exact_identity_dedupe_never_uses_capture_time(self):
        upsert_assets(self.root, [{"cloudIdentifier": "cloud-asset-1", "localIdentifier": "asset-1", "filename": "A copy.JPG", "mediaType": "photo", "creationDate": "2026-07-15T10:00:00Z"}])
        self.assertEqual(search_assets(self.root, {"mediaTypes": ["photo"], "dedupeExact": True})["totalCount"], 2)
        self.assertEqual(search_assets(self.root, {"dateFrom": "2026-07-15T10:00:00Z", "dateTo": "2026-07-15T10:00:00Z", "dedupeExact": True})["totalCount"], 1)
        upsert_assets(self.root, [
            {"localIdentifier": "checksum-a", "filename": "checksum-a.jpg", "mediaType": "photo", "checksumSha256": "c" * 64},
            {"localIdentifier": "checksum-b", "filename": "checksum-b.jpg", "mediaType": "photo", "checksumSha256": "c" * 64},
        ])
        self.assertEqual(search_assets(self.root, {"assetIds": ["checksum-a", "checksum-b"], "dedupeExact": True})["totalCount"], 1)

    def test_pool_preserves_registered_source_batch(self):
        fixture = create_fixture(self.root, "Batch fixture")
        batch = record_source_batch(self.root, fixture["fixtureId"], source_kind="apple_photos_album", source_identity="album-123", provenance={"albumName": "July intake"})
        pool = create_pool(self.root, fixture["fixtureId"], ["asset-1"], criteria={"sourceBatchIdsByAsset": {"asset-1": batch["batchId"]}})
        self.assertEqual(pool["assets"][0]["sourceBatchId"], batch["batchId"])

    def test_placement_is_reversible_and_multi_fixture(self):
        first = create_fixture(self.root, "First")
        second = create_fixture(self.root, "Second")
        third = create_fixture(self.root, "Third")
        one = place_assets(self.root, first["fixtureId"], ["asset-1"])
        place_assets(self.root, second["fixtureId"], ["asset-1"])
        self.assertEqual(list_placements(self.root, ["asset-1"])["count"], 2)
        moved = move_placement(self.root, one["placementIds"][0], third["fixtureId"], reason="correct route")
        self.assertEqual(moved["fromFixtureId"], first["fixtureId"])
        self.assertEqual(moved["toFixtureId"], third["fixtureId"])
        self.assertEqual(remove_placement(self.root, one["placementIds"][0])["state"], "removed")
        self.assertEqual(restore_placement(self.root, one["placementIds"][0])["state"], "active")

    def test_delivery_defaults_keep_pick_and_approval_distinct(self):
        fixture = create_fixture(self.root, "Delivery", destination_defaults=["r2", "apple_photos"])
        place_assets(self.root, fixture["fixtureId"], ["asset-1"])
        configure_asset_destinations(self.root, fixture["fixtureId"], ["asset-1"], ["r2", "apple_photos"])
        self.assertFalse(delivery_plan(self.root, fixture["fixtureId"])["items"][0]["approved"])
        record_decision(self.root, {"assetId": "asset-1", "action": "pick"})
        self.assertFalse(delivery_plan(self.root, fixture["fixtureId"])["items"][0]["approved"])
        record_decision(self.root, {"assetId": "asset-1", "action": "approve", "title": "Ready", "caption": "Sea-view terrace", "keywords": ["La Concha"]})
        item = delivery_plan(self.root, fixture["fixtureId"])["items"][0]
        self.assertTrue(item["approved"])
        with connect(self.root) as conn:
            self.assertEqual(conn.execute("SELECT caption FROM sidecar_decisions WHERE asset_id = 'asset-1'").fetchone()["caption"], "Sea-view terrace")
        self.assertFalse(item["complete"])

        configure_asset_destinations(self.root, fixture["fixtureId"], ["asset-1"], ["r2", "apple_photos"])
        item = delivery_plan(self.root, fixture["fixtureId"])["items"][0]
        first_version = item["versionHash"]
        uploaded = {
            "status": "uploaded", "bucket": "photosbyelie-public", "key": "fixture/asset-1.jpg",
            "backend": "s3", "bytes": 123, "contentType": "image/jpeg", "checksumSha256": "a" * 64,
            "remoteChecksumSha256": "a" * 64, "remoteVerified": True,
        }
        unverified = {**uploaded, "remoteChecksumSha256": "", "remoteVerified": False}
        failed_receipts = record_r2_upload_results(self.root, "asset-1", [unverified])
        self.assertEqual(failed_receipts["receipts"][0]["status"], "failed")
        self.assertEqual(record_r2_upload_results(self.root, "asset-1", [uploaded])["receiptCount"], 1)
        r2_only = create_fixture(self.root, "R2 only")
        place_assets(self.root, r2_only["fixtureId"], ["asset-1"])
        configure_asset_destinations(self.root, r2_only["fixtureId"], ["asset-1"], ["r2"])
        self.assertEqual(record_r2_upload_results(self.root, "asset-1", [uploaded])["receiptCount"], 2)
        self.assertTrue(delivery_plan(self.root, r2_only["fixtureId"])["items"][0]["complete"])
        record_r2_upload_results(self.root, "asset-1", [uploaded])
        with connect(self.root) as conn:
            count = conn.execute("SELECT count(*) FROM fixture_delivery_receipts WHERE fixture_id = ? AND object_key <> ''", (r2_only["fixtureId"],)).fetchone()[0]
        self.assertEqual(count, 1)

        record_decision(self.root, {"assetId": "asset-1", "action": "metadata", "metadataState": "approved", "caption": "Changed caption"})
        configure_asset_destinations(self.root, r2_only["fixtureId"], ["asset-1"], ["r2"])
        changed = delivery_plan(self.root, r2_only["fixtureId"])["items"][0]
        self.assertNotEqual(changed["versionHash"], first_version)
        self.assertFalse(changed["complete"])

    def test_la_concha_migration_builds_target_tree_idempotently(self):
        first = migrate_la_concha_tree(self.root)
        second = migrate_la_concha_tree(self.root)
        self.assertEqual(first["root"]["fixtureId"], second["root"]["fixtureId"])
        self.assertEqual([item["name"] for item in second["commonChildren"]], ["Street", "Main lobby", "Pool", "Tennis court"])
        self.assertEqual(second["accessGrant"]["externalIdentity"], "gallery:la-concha:client:corine")
        with connect(self.root) as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM fixture_access_grants").fetchone()[0], 1)

    def test_access_fixture_migration_enforces_public_roots_and_corine_only_re(self):
        create_fixture(self.root, "Universal Fixture Parity Rehearsal", fixture_id="fixture-universal-parity-rehearsal")
        first = migrate_access_fixture_tree(self.root)
        second = migrate_access_fixture_tree(self.root)
        self.assertEqual([item["name"] for item in second["publicRoots"]], ["Expo", "Travel"])
        self.assertEqual(second["privateRoot"]["fixtureId"], "fixture-re")
        roots = {item["fixtureId"]: item for item in second["tree"]}
        self.assertNotIn("fixture-universal-parity-rehearsal", roots)
        self.assertIn("fixture-la-concha", {item["fixtureId"] for item in roots["fixture-re"]["children"]})
        with connect(self.root) as conn:
            grants = conn.execute(
                "SELECT fixture_id, external_identity, state FROM fixture_access_grants WHERE state = 'active'"
            ).fetchall()
            self.assertEqual([(row["fixture_id"], row["external_identity"]) for row in grants], [
                ("fixture-la-concha", "corine.bn2007@yahoo.fr")
            ])
            self.assertEqual(conn.execute(
                "SELECT count(*) FROM fixture_access_grants WHERE fixture_id = 'fixture-re' AND state = 'active'"
            ).fetchone()[0], 0)
        self.assertEqual(first["accessGrant"]["externalIdentity"], second["accessGrant"]["externalIdentity"])

    def _insert_upload_run(self, *, captured_hash: bool, drift_hash: str = ""):
        record_decision(self.root, {"assetId": "asset-1", "action": "pick"})
        record_decision(self.root, {"assetId": "asset-1", "action": "approve", "title": "A", "caption": "Ready", "keywords": ["Fixture"]})
        record_decision(self.root, {"assetId": "asset-2", "action": "pick"})
        record_decision(self.root, {"assetId": "asset-2", "action": "approve", "title": "B", "caption": "Ready", "keywords": ["Fixture"]})
        run_id = "ub-test-run"
        timestamp = "2099-01-01T00:00:00Z"
        with connect(self.root) as conn:
            conn.execute(
                """INSERT INTO sidecar_upload_bridge_runs
                   (run_id, mode, status, execute_upload, limit_count, started_at, completed_at,
                    summary_json, created_at, updated_at)
                   VALUES (?, 'execute-batch', 'cancelled', 1, 3, ?, ?, '{}', ?, ?)""",
                (run_id, timestamp, timestamp, timestamp, timestamp),
            )
            for index, asset_id in enumerate(("asset-1", "asset-2", "asset-3"), 1):
                result = {
                    "status": "uploaded", "bucket": "photosbyelie-public", "key": f"expo/{asset_id}.jpg",
                    "checksumSha256": str(index) * 64, "remoteChecksumSha256": str(index) * 64,
                    "remoteVerified": True, "bytes": 10, "contentType": "image/jpeg",
                }
                version_hash = editorial_version_hash(conn, asset_id) if captured_hash else ""
                if asset_id == "asset-1" and drift_hash:
                    version_hash = drift_hash
                uploaded = asset_id != "asset-3"
                conn.execute(
                    """INSERT INTO sidecar_upload_bridge_run_items
                       (run_item_id, run_id, asset_id, photo_id, filename, media_type, status,
                        export_status, planned_keys_json, upload_status, upload_keys_json,
                        editorial_version_hash, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, 'photo', ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        f"item-{index}", run_id, asset_id, asset_id, f"{asset_id}.jpg",
                        "uploaded" if uploaded else "planned",
                        "materialized" if uploaded else "planned",
                        json.dumps([{"bucket": result["bucket"], "key": result["key"]}]),
                        "uploaded" if uploaded else "not_requested",
                        json.dumps([result]) if uploaded else "[]",
                        version_hash, timestamp, timestamp,
                    ),
                )
            conn.commit()
        return run_id

    def test_cancelled_upload_run_adopts_only_verified_completed_items(self):
        fixture = create_fixture(self.root, "Upload destination")
        run_id = self._insert_upload_run(captured_hash=False)
        blocked = plan_upload_run_adoption(self.root, run_id, fixture["fixtureId"])
        self.assertEqual(blocked["totalRunItemCount"], 3)
        self.assertEqual(blocked["completedUploadCount"], 2)
        self.assertEqual(blocked["eligibleCount"], 0)
        self.assertEqual(blocked["blockedCount"], 2)
        planned = plan_upload_run_adoption(self.root, run_id, fixture["fixtureId"], historical_backfill=True)
        self.assertEqual(planned["eligibleCount"], 2)
        subset = plan_upload_run_adoption(self.root, run_id, fixture["fixtureId"], historical_backfill=True, asset_ids=["asset-2"])
        self.assertEqual(subset["eligibleCount"], 1)
        self.assertEqual(subset["items"][0]["assetId"], "asset-2")
        adopted = adopt_upload_run(self.root, run_id, fixture["fixtureId"], historical_backfill=True)
        self.assertEqual(adopted["placementCount"], 2)
        self.assertEqual(adopted["r2ReceiptCount"], 2)
        self.assertEqual(list_placements(self.root, fixture_id=fixture["fixtureId"])["count"], 2)
        self.assertEqual(delivery_plan(self.root, fixture["fixtureId"])["items"][0]["receipts"]["r2"]["status"], "verified")
        adopt_upload_run(self.root, run_id, fixture["fixtureId"])
        with connect(self.root) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM fixture_asset_placements WHERE fixture_id = ? AND state = 'active'", (fixture["fixtureId"],)).fetchone()[0], 2)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM fixture_delivery_receipts WHERE fixture_id = ? AND destination = 'r2'", (fixture["fixtureId"],)).fetchone()[0], 2)

    def test_upload_run_adoption_rejects_editorial_drift_and_archived_fixture(self):
        fixture = create_fixture(self.root, "Upload destination")
        run_id = self._insert_upload_run(captured_hash=True)
        record_decision(self.root, {"assetId": "asset-1", "action": "metadata", "metadataState": "approved", "caption": "Changed after planning"})
        plan = plan_upload_run_adoption(self.root, run_id, fixture["fixtureId"])
        self.assertEqual(plan["eligibleCount"], 1)
        self.assertEqual(plan["blockedCount"], 1)
        self.assertIn("changed after upload planning", plan["blocked"][0]["reason"])
        archive_fixture(self.root, fixture["fixtureId"])
        with self.assertRaisesRegex(ValueError, "archived"):
            plan_upload_run_adoption(self.root, run_id, fixture["fixtureId"])

    def test_upload_run_adoption_can_accept_recorded_checksum_evidence_after_drift(self):
        fixture = create_fixture(self.root, "Upload destination")
        run_id = self._insert_upload_run(captured_hash=True)
        record_decision(
            self.root,
            {
                "assetId": "asset-1",
                "action": "metadata",
                "metadataState": "approved",
                "caption": "Changed after planning",
            },
        )
        plan = plan_upload_run_adoption(
            self.root,
            run_id,
            fixture["fixtureId"],
            revalidate_recorded_content=True,
            asset_ids=["asset-1"],
        )
        self.assertEqual(plan["eligibleCount"], 1)
        self.assertTrue(plan["items"][0]["recordedContentRevalidated"])
        adopted = adopt_upload_run(
            self.root,
            run_id,
            fixture["fixtureId"],
            revalidate_recorded_content=True,
            asset_ids=["asset-1"],
        )
        self.assertEqual(adopted["r2ReceiptCount"], 1)
        with connect(self.root) as conn:
            receipt = conn.execute(
                """SELECT verification_json FROM fixture_delivery_receipts
                   WHERE fixture_id = ? AND asset_id = 'asset-1' AND destination = 'r2'""",
                (fixture["fixtureId"],),
            ).fetchone()
        self.assertTrue(json.loads(receipt["verification_json"])["recordedContentRevalidated"])

    def test_expo_adoption_blocks_explicit_ai_assets(self):
        fixture = create_fixture(self.root, "Expo", fixture_id="fixture-expo")
        run_id = self._insert_upload_run(captured_hash=True)
        record_decision(
            self.root,
            {
                "assetId": "asset-1",
                "action": "metadata",
                "metadataState": "approved",
                "keywords": ["Fixture", "Generative AI"],
            },
        )
        plan = plan_upload_run_adoption(self.root, run_id, fixture["fixtureId"])
        self.assertEqual(plan["eligibleCount"], 1)
        self.assertEqual(plan["blockedCount"], 1)
        self.assertEqual(plan["blocked"][0]["assetId"], "asset-1")
        self.assertEqual(plan["blocked"][0]["reason"], "AI-generated assets are retired from Expo")

    def test_expo_adoption_blocks_stained_glass_assets(self):
        fixture = create_fixture(self.root, "Expo", fixture_id="fixture-expo")
        run_id = self._insert_upload_run(captured_hash=True)
        record_decision(
            self.root,
            {
                "assetId": "asset-1",
                "action": "metadata",
                "metadataState": "approved",
                "keywords": ["Fixture", "Stained"],
            },
        )
        plan = plan_upload_run_adoption(self.root, run_id, fixture["fixtureId"])
        self.assertEqual(plan["eligibleCount"], 1)
        self.assertEqual(plan["blockedCount"], 1)
        self.assertEqual(plan["blocked"][0]["assetId"], "asset-1")
        self.assertEqual(plan["blocked"][0]["reason"], "Stained assets are retired from Expo")


if __name__ == "__main__":
    unittest.main()
