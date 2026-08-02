import json
import tempfile
import unittest
from pathlib import Path
import sys
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

from apple_photos_metadata_writer import (
    SignedPhotosBridgeAdapter,
    commit_writeback,
    merge_keywords,
    writeback_plan,
)
from fixture_pipeline import (
    apply_fixture_review_action,
    create_fixture,
    place_assets,
    set_fixture_asset_state,
)
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
        set_fixture_asset_state(
            self.root,
            self.fixture["fixtureId"],
            ["asset-1"],
            "picked",
        )
        apply_fixture_review_action(
            self.root,
            self.fixture["fixtureId"],
            ["asset-1"],
            "approve",
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_merge_preserves_unrelated_and_replaces_managed_keywords(self):
        result = merge_keywords(
            ["Family", "PBE-Rating-2", "PBE-Fixture-ID:private"],
            ["Spain"],
            ["PBE:Rating:5", "PBE:Approved"],
        )
        self.assertEqual(result, ["Family", "Spain", "PBE:Rating:5", "PBE:Approved"])

    def test_commit_is_not_gated_on_r2_and_records_sync_state(self):
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
        self.assertIn("PBE:Approved", adapter.values["asset-1"]["keywords"])
        self.assertFalse(any(value.startswith("PBE-Fixture-ID:") for value in adapter.values["asset-1"]["keywords"]))
        with connect(self.root) as conn:
            receipt = conn.execute("SELECT status FROM fixture_delivery_receipts WHERE destination = 'apple_photos' AND object_key <> ''").fetchone()
            self.assertEqual(receipt["status"], "verified")
            sync = conn.execute(
                "SELECT last_giveback_fingerprint, last_error FROM asset_sync_state WHERE asset_id = 'asset-1'"
            ).fetchone()
            self.assertTrue(sync["last_giveback_fingerprint"])
            self.assertEqual(sync["last_error"], "")

    def test_commit_uses_atomic_apply_when_adapter_supports_it(self):
        adapter = FastFakePhotos()
        result = commit_writeback(self.root, self.fixture["fixtureId"], adapter=adapter)
        self.assertTrue(result["ok"])
        self.assertEqual(adapter.apply_many_count, 1)
        self.assertEqual(adapter.apply_count, 1)
        self.assertIn("Family", adapter.values["asset-1"]["keywords"])
        self.assertIn("PBE:Approved", adapter.values["asset-1"]["keywords"])

    def test_unapproved_tombstone_only_adds_tombstone_marker(self):
        upsert_assets(
            self.root,
            [{"localIdentifier": "asset-2", "filename": "two.jpg", "mediaType": "photo"}],
        )
        record_decision(
            self.root,
            {
                "assetId": "asset-2",
                "action": "tombstone",
                "reason": "owner rejected",
            },
        )
        adapter = FastFakePhotos()
        adapter.values["asset-2"] = {
            "title": "Keep Photos title",
            "caption": "Keep Photos caption",
            "keywords": ["Personal", "PBE:Approved", "PBE:Rating:5"],
        }
        plan = writeback_plan(self.root, asset_ids=["asset-2"], adapter=adapter)
        self.assertFalse(plan["items"][0]["approved"])
        self.assertEqual(plan["items"][0]["managedKeywords"], ["PBE:Tombstone"])
        result = commit_writeback(self.root, asset_ids=["asset-2"], adapter=adapter)
        self.assertTrue(result["ok"])
        self.assertEqual(adapter.values["asset-2"]["title"], "Keep Photos title")
        self.assertEqual(adapter.values["asset-2"]["caption"], "Keep Photos caption")
        self.assertEqual(
            adapter.values["asset-2"]["keywords"],
            ["Personal", "PBE:Tombstone"],
        )

    def test_tombstone_precedes_stale_approved_editorial_state(self):
        record_decision(
            self.root,
            {
                "assetId": "asset-1",
                "action": "tombstone",
                "reason": "superseded after approval",
            },
        )
        adapter = FastFakePhotos()
        adapter.values["asset-1"] = {
            "title": "Keep Photos title",
            "caption": "Keep Photos caption",
            "keywords": ["Personal", "PBE:Approved", "PBE:Rating:5"],
        }
        plan = writeback_plan(self.root, asset_ids=["asset-1"], adapter=adapter)
        self.assertFalse(plan["items"][0]["approved"])
        self.assertEqual(plan["items"][0]["managedKeywords"], ["PBE:Tombstone"])
        result = commit_writeback(self.root, asset_ids=["asset-1"], adapter=adapter)
        self.assertTrue(result["ok"])
        self.assertEqual(
            adapter.values["asset-1"]["keywords"],
            ["Personal", "PBE:Tombstone"],
        )

    def test_signed_adapter_batches_through_app_and_removes_private_input(self):
        calls = []

        def bridge(_root, args, timeout):
            calls.append((args, timeout))
            request = json.loads(Path(args[2]).read_text(encoding="utf-8"))
            return {
                "ok": True,
                "items": [
                    {
                        "assetId": item["assetId"],
                        "title": "Read title",
                        "caption": "",
                        "keywords": ["PBE-Approved"],
                    }
                    for item in request
                ],
            }

        adapter = SignedPhotosBridgeAdapter(self.root)
        with mock.patch("sidecar_server._run_apple_photos_bridge_app_task", side_effect=bridge):
            rows = adapter.read_many([{"assetId": "asset-1"}])
        self.assertEqual(rows[0]["title"], "Read title")
        self.assertEqual(calls[0][0][0], "metadata-read-many")
        self.assertFalse(Path(calls[0][0][2]).exists())


if __name__ == "__main__":
    unittest.main()
