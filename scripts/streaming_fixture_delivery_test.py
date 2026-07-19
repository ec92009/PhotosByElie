import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixture_pipeline import create_fixture, editorial_version_hash
from sidecar_state_db import (
    connect,
    prepare_upload_bridge_execute_batch,
    queue_upload_bridge,
    record_decision,
    upload_plan,
    upsert_assets,
)
from streaming_fixture_delivery import finalize_streamed_upload


class FakePhotos:
    def __init__(self):
        self.values = {
            "asset-1": {"title": "Old", "caption": "", "keywords": ["Keep me"]},
        }

    def read(self, asset_id):
        value = self.values[asset_id]
        return {**value, "keywords": list(value["keywords"])}

    def write(self, asset_id, title, caption, keywords):
        self.values[asset_id] = {"title": title, "caption": caption, "keywords": list(keywords)}


class StreamingFixtureDeliveryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        upsert_assets(self.root, [
            {"localIdentifier": "asset-1", "filename": "one.jpg", "mediaType": "photo", "keywords": ["Paris"]},
            {"localIdentifier": "asset-2", "filename": "two.jpg", "mediaType": "photo", "keywords": ["Paris"]},
        ])
        for asset_id, title in (("asset-1", "Paris one"), ("asset-2", "Paris two")):
            record_decision(self.root, {"assetId": asset_id, "action": "pick"})
            record_decision(self.root, {
                "assetId": asset_id,
                "action": "approve",
                "title": title,
                "caption": "Ready",
                "keywords": ["Paris"],
            })
        queue_upload_bridge(self.root, asset_ids=["asset-1", "asset-2"])

    def tearDown(self):
        self.temp.cleanup()

    def test_batch_plan_can_be_restricted_to_fixture_pool_assets(self):
        batch = prepare_upload_bridge_execute_batch(self.root, limit=30, asset_ids=["asset-2"])
        self.assertEqual(batch["count"], 1)
        self.assertEqual(batch["items"][0]["assetId"], "asset-2")
        self.assertEqual(batch["summary"]["scopedAssetCount"], 1)

        plan = upload_plan(self.root, asset_ids=["asset-1"])
        self.assertEqual(plan["count"], 0)
        self.assertEqual(plan["bridgeQueuedCount"], 1)

    def test_empty_fixture_scope_never_falls_back_to_global_queue(self):
        batch = prepare_upload_bridge_execute_batch(self.root, limit=30, asset_ids=[])
        self.assertEqual(batch["count"], 0)
        self.assertEqual(batch["summary"]["scopedAssetCount"], 0)

    def test_upload_bridge_permanently_excludes_explicit_ai_assets(self):
        record_decision(
            self.root,
            {
                "assetId": "asset-2",
                "action": "metadata",
                "metadataState": "approved",
                "keywords": ["Paris", "AI generated illustration"],
            },
        )
        batch = prepare_upload_bridge_execute_batch(self.root, limit=30)
        self.assertEqual(batch["count"], 1)
        self.assertEqual(batch["items"][0]["assetId"], "asset-1")

    def test_upload_bridge_permanently_excludes_stained_glass_assets(self):
        record_decision(
            self.root,
            {
                "assetId": "asset-2",
                "action": "metadata",
                "metadataState": "approved",
                "keywords": ["Paris", "Stained"],
            },
        )
        batch = prepare_upload_bridge_execute_batch(self.root, limit=30)
        self.assertEqual(batch["count"], 1)
        self.assertEqual(batch["items"][0]["assetId"], "asset-1")

    def test_verified_item_is_adopted_then_returned_to_photos(self):
        fixture = create_fixture(self.root, "Paris")
        run_id = "ub-stream-test"
        result = {
            "status": "uploaded",
            "bucket": "photosbyelie-public",
            "key": "expo/asset-1.jpg",
            "checksumSha256": "a" * 64,
            "remoteChecksumSha256": "a" * 64,
            "remoteVerified": True,
            "bytes": 10,
            "contentType": "image/jpeg",
        }
        with connect(self.root) as conn:
            timestamp = "2026-07-19T12:00:00Z"
            conn.execute(
                """INSERT INTO sidecar_upload_bridge_runs
                   (run_id, mode, status, execute_upload, limit_count, started_at,
                    summary_json, created_at, updated_at)
                   VALUES (?, 'execute-batch', 'running', 1, 1, ?, '{}', ?, ?)""",
                (run_id, timestamp, timestamp, timestamp),
            )
            conn.execute(
                """INSERT INTO sidecar_upload_bridge_run_items
                   (run_item_id, run_id, asset_id, photo_id, filename, media_type,
                    status, export_status, planned_keys_json, upload_status,
                    upload_keys_json, editorial_version_hash, created_at, updated_at)
                   VALUES ('item-1', ?, 'asset-1', 'asset-1', 'one.jpg', 'photo',
                           'uploaded', 'materialized', ?, 'uploaded', ?, ?, ?, ?)""",
                (
                    run_id,
                    json.dumps([{"bucket": result["bucket"], "key": result["key"]}]),
                    json.dumps([result]),
                    editorial_version_hash(conn, "asset-1"),
                    timestamp,
                    timestamp,
                ),
            )
            conn.commit()

        adapter = FakePhotos()
        completed = finalize_streamed_upload(
            self.root,
            run_id=run_id,
            fixture_id=fixture["fixtureId"],
            asset_id="asset-1",
            adapter=adapter,
        )
        self.assertTrue(completed["ok"])
        self.assertEqual(completed["photosWrittenCount"], 1)
        self.assertIn("PBE-Approved", adapter.values["asset-1"]["keywords"])
        self.assertIn("Keep me", adapter.values["asset-1"]["keywords"])


if __name__ == "__main__":
    unittest.main()
