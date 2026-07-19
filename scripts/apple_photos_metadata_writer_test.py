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
        }])
        adapter = FakePhotos()
        result = commit_writeback(self.root, self.fixture["fixtureId"], adapter=adapter)
        self.assertTrue(result["ok"])
        self.assertEqual(adapter.values["asset-1"]["title"], "Sea view")
        self.assertEqual(adapter.values["asset-1"]["caption"], "Terrace at sunset")
        self.assertIn("Family", adapter.values["asset-1"]["keywords"])
        self.assertIn("PBE-Approved", adapter.values["asset-1"]["keywords"])
        with connect(self.root) as conn:
            receipt = conn.execute("SELECT status FROM fixture_delivery_receipts WHERE destination = 'apple_photos' AND object_key <> ''").fetchone()
            self.assertEqual(receipt["status"], "verified")


if __name__ == "__main__":
    unittest.main()
