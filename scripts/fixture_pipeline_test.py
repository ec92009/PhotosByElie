import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixture_pipeline import (
    apply_pool_refresh,
    archive_fixture,
    configure_asset_destinations,
    create_fixture,
    create_pool,
    delivery_plan,
    fixture_tree,
    list_placements,
    migrate_la_concha_tree,
    move_fixture,
    move_placement,
    place_assets,
    preview_pool_refresh,
    remove_placement,
    rename_fixture,
    record_r2_upload_results,
    record_source_batch,
    reopen_fixture,
    restore_placement,
    search_assets,
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

    def test_search_and_pool_are_read_only_stable_and_idempotent(self):
        fixture = create_fixture(self.root, "Fixture")
        record_decision(self.root, {"assetId": "asset-1", "action": "metadata", "caption": "Mediterranean terrace", "metadataState": "proposed"})
        self.assertEqual(search_assets(self.root, {"query": "Mediterranean"})["totalCount"], 1)
        result = search_assets(self.root, {"mediaTypes": ["photo"], "query": ".jpg"})
        self.assertEqual(result["totalCount"], 2)
        pool = create_pool(self.root, fixture["fixtureId"], [item["assetId"] for item in result["items"]], criteria=result["filters"])
        again = create_pool(self.root, fixture["fixtureId"], [item["assetId"] for item in result["items"]], criteria=result["filters"])
        self.assertEqual(pool["poolId"], again["poolId"])
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


if __name__ == "__main__":
    unittest.main()
