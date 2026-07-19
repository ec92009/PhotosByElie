import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from apple_photos_metadata_writer import commit_writeback, merge_keywords, writeback_plan
from fixture_pipeline import configure_asset_destinations, create_fixture, place_assets, record_r2_upload_results
from sidecar_state_db import connect, record_decision, upsert_assets


class FakePhotos:
    def __init__(self):
        self.values = {"asset-1": {"title": "Old", "caption": "Old caption", "keywords": ["Family", "PBE-Rating-2"]}}

    def read(self, asset_id):
        return {**self.values[asset_id], "keywords": list(self.values[asset_id]["keywords"])}

    def write(self, asset_id, title, caption, keywords):
        self.values[asset_id] = {"title": title, "caption": caption, "keywords": list(keywords)}


class FastFakePhotos(FakePhotos):
    def __init__(self):
        super().__init__()
        self.apply_count = 0
        self.apply_many_count = 0

    def apply(self, asset_id, title, caption, keywords, managed_keywords):
        self.apply_count += 1
        before = self.read(asset_id)
        merged = merge_keywords(before["keywords"], keywords, managed_keywords)
        self.write(asset_id, title, caption, merged)
        return {"before": before, "after": self.read(asset_id), "keywords": merged}

    def apply_many(self, requests):
        self.apply_many_count += 1
        return [
            {"assetId": item["assetId"], **self.apply(
                item["assetId"], item["title"], item["caption"],
                item["keywords"], item["managedKeywords"],
            )}
            for item in requests
        ]


class ApplePhotosMetadataWriterTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        upsert_assets(self.root, [{"localIdentifier": "asset-1", "filename": "one.jpg", "mediaType": "photo"}])
        self.fixture = create_fixture(self.root, "Apartment 1")
        place_assets(self.root, self.fixture["fixtureId"], ["asset-1"])
        record_decision(self.root, {"assetId": "asset-1", "action": "approve", "title": "Sea view", "caption": "Terrace at sunset", "keywords": ["Spain"]})
        configure_asset_destinations(self.root, self.fixture["fixtureId"], ["asset-1"], ["r2", "apple_photos"])

    def tearDown(self):
        self.temp.cleanup()

    def test_merge_preserves_unrelated_and_replaces_managed_keywords(self):
        result = merge_keywords(["Family", "PBE-Rating-2"], ["Spain"], ["PBE-Rating-5", "PBE-Approved"])
        self.assertEqual(result, ["Family", "Spain", "PBE-Rating-5", "PBE-Approved"])

    def test_commit_is_gated_on_r2_then_verifies_and_records(self):
        self.assertEqual(writeback_plan(self.root, self.fixture["fixtureId"])["blockedCount"], 1)
        record_r2_upload_results(self.root, "asset-1", [{
            "status": "uploaded", "bucket": "photosbyelie-private", "key": "masters/one.jpg",
            "checksumSha256": "b" * 64, "backend": "s3", "bytes": 42, "contentType": "image/jpeg",
            "remoteChecksumSha256": "b" * 64, "remoteVerified": True,
        }])
        adapter = FakePhotos()
        plan = writeback_plan(self.root, self.fixture["fixtureId"], adapter=adapter)
        self.assertEqual(plan["items"][0]["changedFields"], ["title", "caption", "keywords"])
        self.assertEqual(plan["items"][0]["changes"]["title"]["before"], "Old")
        self.assertEqual(adapter.values["asset-1"]["title"], "Old")
        result = commit_writeback(self.root, self.fixture["fixtureId"], adapter=adapter)
        self.assertTrue(result["ok"])
        self.assertEqual(adapter.values["asset-1"]["title"], "Sea view")
        self.assertEqual(adapter.values["asset-1"]["caption"], "Terrace at sunset")
        self.assertIn("Family", adapter.values["asset-1"]["keywords"])
        self.assertIn("PBE-Approved", adapter.values["asset-1"]["keywords"])
        with connect(self.root) as conn:
            receipt = conn.execute("SELECT status FROM fixture_delivery_receipts WHERE destination = 'apple_photos' AND object_key <> ''").fetchone()
            self.assertEqual(receipt["status"], "verified")

    def test_commit_uses_atomic_apply_when_adapter_supports_it(self):
        record_r2_upload_results(self.root, "asset-1", [{
            "status": "uploaded", "bucket": "photosbyelie-private", "key": "masters/one.jpg",
            "checksumSha256": "b" * 64, "backend": "s3", "bytes": 42, "contentType": "image/jpeg",
            "remoteChecksumSha256": "b" * 64, "remoteVerified": True,
        }])
        adapter = FastFakePhotos()
        result = commit_writeback(self.root, self.fixture["fixtureId"], adapter=adapter)
        self.assertTrue(result["ok"])
        self.assertEqual(adapter.apply_many_count, 1)
        self.assertEqual(adapter.apply_count, 1)
        self.assertIn("Family", adapter.values["asset-1"]["keywords"])
        self.assertIn("PBE-Approved", adapter.values["asset-1"]["keywords"])


if __name__ == "__main__":
    unittest.main()
