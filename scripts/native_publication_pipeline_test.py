import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixture_pipeline import (
    apply_fixture_review_action,
    connect,
    create_fixture,
    set_fixture_asset_state,
)
from native_publication_pipeline import (
    create_upload_run,
    publish_verified_asset,
    reconcile_r2_objects,
    record_photos_sync_snapshot,
    record_sale_reference,
    run_upload_batch,
    upload_eligibility_plan,
)
from sidecar_state_db import upsert_assets


def verified(key, bucket="photosbyelie-public"):
    checksum = ("a" if "master" in key else "b") * 64
    return {
        "status": "uploaded",
        "bucket": bucket,
        "key": key,
        "checksumSha256": checksum,
        "remoteChecksumSha256": checksum,
        "remoteVerified": True,
        "bytes": 10,
        "objectKind": "master" if "master" in key else "preview",
    }


class NativePublicationPipelineTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        upsert_assets(
            self.root,
            [
                {"localIdentifier": "asset-1", "filename": "one.jpg", "mediaType": "photo"},
                {"localIdentifier": "asset-2", "filename": "two.jpg", "mediaType": "photo"},
            ],
        )
        self.fixture = create_fixture(self.root, "Expo")
        set_fixture_asset_state(self.root, self.fixture["fixtureId"], ["asset-1", "asset-2"], "picked")
        apply_fixture_review_action(self.root, self.fixture["fixtureId"], ["asset-1", "asset-2"], "approve")

    def tearDown(self):
        self.temp.cleanup()

    def test_metadata_change_preserves_approval_and_appearance_returns_to_review(self):
        baseline = [
            {
                "assetId": "asset-1",
                "photosAssetId": "asset-1",
                "title": "Old title",
                "keywords": ["Spain"],
                "renderedFingerprint": "render-a",
            }
        ]
        self.assertEqual(record_photos_sync_snapshot(self.root, baseline)["changes"]["baseline"], 1)
        metadata = [{**baseline[0], "title": "Photos title", "keywords": ["Spain", "Sea"]}]
        self.assertEqual(record_photos_sync_snapshot(self.root, metadata)["changes"]["metadataOnly"], 1)
        with connect(self.root) as conn:
            editorial = conn.execute("SELECT editorial_state FROM asset_editorial_state WHERE asset_id = 'asset-1'").fetchone()
            delivery = conn.execute("SELECT delivery_state FROM asset_delivery_state WHERE asset_id = 'asset-1'").fetchone()
            decision = conn.execute("SELECT title FROM sidecar_decisions WHERE asset_id = 'asset-1'").fetchone()
            self.assertEqual(editorial["editorial_state"], "approved")
            self.assertEqual(delivery["delivery_state"], "needs-upload")
            self.assertEqual(decision["title"], "Photos title")
        appearance = [{**metadata[0], "renderedFingerprint": "render-b"}]
        self.assertEqual(record_photos_sync_snapshot(self.root, appearance)["changes"]["appearance"], 1)
        with connect(self.root) as conn:
            editorial = conn.execute("SELECT editorial_state FROM asset_editorial_state WHERE asset_id = 'asset-1'").fetchone()
            delivery = conn.execute("SELECT delivery_state FROM asset_delivery_state WHERE asset_id = 'asset-1'").fetchone()
            self.assertEqual(editorial["editorial_state"], "unreviewed")
            self.assertEqual(delivery["delivery_state"], "not-ready")

    def test_verified_upload_publishes_once_across_effective_fixtures(self):
        child = create_fixture(self.root, "Child", parent_fixture_id=self.fixture["fixtureId"])
        set_fixture_asset_state(self.root, child["fixtureId"], ["asset-1"], "picked")
        record_photos_sync_snapshot(
            self.root,
            [{"assetId": "asset-1", "title": "One", "keywords": [], "renderedFingerprint": "render-a"}],
        )
        result = publish_verified_asset(
            self.root,
            "asset-1",
            [verified("masters/asset-1.jpg", "photosbyelie-private"), verified("media/asset-1.jpg")],
        )
        self.assertEqual(set(result["fixtureIds"]), {self.fixture["fixtureId"], child["fixtureId"]})
        with connect(self.root) as conn:
            publications = conn.execute(
                "SELECT count(*) total FROM asset_publications WHERE asset_id = 'asset-1' AND state = 'live'"
            ).fetchone()
            objects = conn.execute(
                "SELECT count(*) total FROM r2_objects WHERE photo_id = 'asset-1' AND lifecycle_state = 'current'"
            ).fetchone()
            self.assertEqual(publications["total"], 2)
            self.assertEqual(objects["total"], 2)

    def test_upload_run_is_bounded_and_isolates_failure(self):
        run = create_upload_run(self.root, ["asset-1", "asset-2"], limit=50, concurrency=2)

        def upload(asset_id):
            if asset_id == "asset-2":
                raise RuntimeError("network failed")
            return [verified(f"masters/{asset_id}.jpg", "photosbyelie-private")]

        result = run_upload_batch(self.root, run["runId"], upload)
        self.assertEqual(result["status"], "completed-with-errors")
        self.assertEqual(result["live"], 1)
        self.assertEqual(result["failed"], 1)
        self.assertEqual(result["remaining"], 0)

    def test_upload_eligibility_plan_is_fixture_scoped_and_read_only(self):
        child = create_fixture(self.root, "Child", parent_fixture_id=self.fixture["fixtureId"])
        set_fixture_asset_state(self.root, child["fixtureId"], ["asset-1"], "picked")
        with connect(self.root) as conn:
            conn.execute(
                "UPDATE sidecar_decisions SET keywords_json = ? WHERE asset_id = ?",
                ('["Spain", "Sea"]', "asset-1"),
            )
            conn.commit()

        root_plan = upload_eligibility_plan(
            self.root,
            fixture_id=self.fixture["fixtureId"],
        )
        child_plan = upload_eligibility_plan(
            self.root,
            fixture_id=child["fixtureId"],
        )

        self.assertTrue(root_plan["readOnly"])
        self.assertEqual(root_plan["pickedCount"], 2)
        self.assertEqual(root_plan["approvedCount"], 2)
        self.assertEqual(root_plan["needsUploadCount"], 2)
        self.assertEqual([item["assetId"] for item in root_plan["items"]], ["asset-1", "asset-2"])
        self.assertEqual(root_plan["items"][0]["photoLibraryIdentifier"], "asset-1")
        self.assertEqual(root_plan["items"][0]["keywords"], ["Spain", "Sea"])
        self.assertEqual(child_plan["pickedCount"], 1)
        self.assertEqual(child_plan["needsUploadCount"], 1)
        self.assertEqual([item["assetId"] for item in child_plan["items"]], ["asset-1"])
        with connect(self.root) as conn:
            self.assertEqual(
                conn.execute("SELECT count(*) total FROM asset_upload_runs").fetchone()["total"],
                0,
            )

    def test_source_missing_withdraws_but_preserves_r2(self):
        record_photos_sync_snapshot(
            self.root,
            [{"assetId": "asset-1", "title": "One", "keywords": [], "renderedFingerprint": "a"}],
        )
        publish_verified_asset(
            self.root,
            "asset-1",
            [verified("masters/asset-1.jpg", "photosbyelie-private")],
        )
        record_photos_sync_snapshot(
            self.root,
            [{"assetId": "asset-1", "sourceExists": False, "renderedFingerprint": "a"}],
        )
        with connect(self.root) as conn:
            publication = conn.execute(
                "SELECT state FROM asset_publications WHERE asset_id = 'asset-1' ORDER BY updated_at DESC LIMIT 1"
            ).fetchone()
            obj = conn.execute(
                "SELECT lifecycle_state FROM r2_objects WHERE object_key = 'masters/asset-1.jpg'"
            ).fetchone()
            self.assertEqual(publication["state"], "withdrawn")
            self.assertEqual(obj["lifecycle_state"], "current")

    def test_sold_objects_are_protected_and_unsold_objects_need_two_passes(self):
        with connect(self.root) as conn:
            for key in ("masters/sold.jpg", "media/sold.jpg", "masters/orphan.jpg"):
                conn.execute(
                    """
                    INSERT INTO r2_objects (
                      bucket, object_key, photo_id, object_kind, lifecycle_state,
                      first_seen_at, updated_at
                    ) VALUES ('photosbyelie-private', ?, 'asset-1', 'master', 'current',
                              '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
                    """,
                    (key,),
                )
            conn.commit()
        record_sale_reference(
            self.root,
            order_id="order-1",
            asset_id="asset-1",
            source_version_hash="srcv-sale",
            checksum_sha256="c" * 64,
            master_key="masters/sold.jpg",
            derivative_keys=["media/sold.jpg"],
        )
        first = reconcile_r2_objects(
            self.root,
            commit=True,
            now="2026-01-01T00:00:00Z",
        )
        self.assertEqual(first["protected"], 2)
        self.assertEqual(first["quarantined"], 1)
        deleted = []
        second = reconcile_r2_objects(
            self.root,
            commit=True,
            now="2026-02-01T00:00:00Z",
            delete_object=lambda bucket, key: deleted.append((bucket, key)),
        )
        self.assertEqual(second["eligibleDelete"], 1)
        self.assertEqual(deleted, [("photosbyelie-private", "masters/orphan.jpg")])
        with connect(self.root) as conn:
            sold = conn.execute(
                "SELECT lifecycle_state FROM r2_objects WHERE object_key = 'masters/sold.jpg'"
            ).fetchone()
            orphan = conn.execute(
                "SELECT lifecycle_state FROM r2_objects WHERE object_key = 'masters/orphan.jpg'"
            ).fetchone()
            self.assertEqual(sold["lifecycle_state"], "current")
            self.assertEqual(orphan["lifecycle_state"], "deleted_confirmed")


if __name__ == "__main__":
    unittest.main()
