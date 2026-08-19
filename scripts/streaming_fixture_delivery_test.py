import json
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixture_pipeline import (
    apply_fixture_review_action,
    create_fixture,
    editorial_version_hash,
    set_fixture_asset_state,
)
from sidecar_state_db import (
    connect,
    prepare_upload_bridge_execute_batch,
    queue_upload_bridge,
    record_decision,
    reconcile_stale_upload_bridge_runs,
    upload_plan,
    upsert_assets,
)
from streaming_fixture_delivery import finalize_streamed_upload, finalize_streamed_upload_batch


class FakePhotos:
    def __init__(self):
        self.values = {
            "asset-1": {"title": "Old", "caption": "", "keywords": ["Keep me"]},
            "asset-2": {"title": "Old two", "caption": "", "keywords": ["Keep two"]},
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
        with connect(self.root) as conn:
            run = conn.execute(
                "SELECT worker_pid, worker_token, lease_expires_at FROM sidecar_upload_bridge_runs WHERE run_id = ?",
                (batch["runId"],),
            ).fetchone()
        self.assertEqual(run["worker_pid"], os.getpid())
        self.assertTrue(run["worker_token"])
        self.assertTrue(run["lease_expires_at"])

        plan = upload_plan(self.root, asset_ids=["asset-1"])
        self.assertEqual(plan["count"], 0)
        self.assertEqual(plan["bridgeQueuedCount"], 1)

    def test_stale_upload_bridge_recovery_respects_legacy_boundary(self):
        now = datetime(2026, 8, 19, 18, 0, tzinfo=timezone.utc)
        old = (now - timedelta(hours=2)).isoformat().replace("+00:00", "Z")
        with connect(self.root) as conn:
            conn.executemany(
                """
                INSERT INTO sidecar_upload_bridge_runs
                  (run_id, mode, status, execute_upload, limit_count, started_at,
                   summary_json, created_at, updated_at, worker_pid, worker_token)
                VALUES (?, 'execute-batch', 'running', 1, 1, ?, '{}', ?, ?, ?, ?)
                """,
                [
                    ("ub-legacy-stale", old, old, old, None, ""),
                    ("ub-dead-stale", old, old, old, 4242, "upload-worker-test"),
                ],
            )
            conn.commit()

        with mock.patch("sidecar_state_db._sidecar_workflow_process_alive", return_value=False):
            result = reconcile_stale_upload_bridge_runs(self.root, now=now)
        self.assertEqual(result["reviewedCount"], 1)
        self.assertEqual(result["recoveredCount"], 1)
        with connect(self.root) as conn:
            rows = {
                row["run_id"]: row
                for row in conn.execute(
                    "SELECT run_id, status, recovery_state, lease_expires_at FROM sidecar_upload_bridge_runs WHERE run_id IN (?, ?)",
                    ("ub-legacy-stale", "ub-dead-stale"),
                ).fetchall()
            }
        self.assertEqual(rows["ub-legacy-stale"]["status"], "running")
        self.assertEqual(rows["ub-legacy-stale"]["recovery_state"], "needs-review")
        self.assertEqual(rows["ub-dead-stale"]["status"], "interrupted")
        self.assertEqual(rows["ub-dead-stale"]["recovery_state"], "recovered")
        self.assertIsNone(rows["ub-dead-stale"]["lease_expires_at"])

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
        self.assertIn("PBE:Approved", adapter.values["asset-1"]["keywords"])

    def test_verified_items_are_returned_to_photos_in_one_batch(self):
        fixture = create_fixture(self.root, "Paris")
        run_id = "ub-stream-batch-test"
        timestamp = "2026-07-19T12:00:00Z"
        with connect(self.root) as conn:
            conn.execute(
                """INSERT INTO sidecar_upload_bridge_runs
                   (run_id, mode, status, execute_upload, limit_count, started_at,
                    summary_json, created_at, updated_at)
                   VALUES (?, 'execute-batch', 'running', 1, 2, ?, '{}', ?, ?)""",
                (run_id, timestamp, timestamp, timestamp),
            )
            for index, asset_id in enumerate(("asset-1", "asset-2"), 1):
                result = {
                    "status": "uploaded",
                    "bucket": "photosbyelie-public",
                    "key": f"expo/{asset_id}.jpg",
                    "checksumSha256": str(index) * 64,
                    "remoteChecksumSha256": str(index) * 64,
                    "remoteVerified": True,
                    "bytes": 10,
                    "contentType": "image/jpeg",
                }
                conn.execute(
                    """INSERT INTO sidecar_upload_bridge_run_items
                       (run_item_id, run_id, asset_id, photo_id, filename, media_type,
                        status, export_status, planned_keys_json, upload_status,
                        upload_keys_json, editorial_version_hash, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, 'photo', 'uploaded', 'materialized', ?,
                               'uploaded', ?, ?, ?, ?)""",
                    (
                        f"item-{index}", run_id, asset_id, asset_id, f"{asset_id}.jpg",
                        json.dumps([{"bucket": result["bucket"], "key": result["key"]}]),
                        json.dumps([result]), editorial_version_hash(conn, asset_id),
                        timestamp, timestamp,
                    ),
                )
            conn.commit()

        adapter = FakePhotos()
        completed = finalize_streamed_upload_batch(
            self.root,
            run_id=run_id,
            fixture_id=fixture["fixtureId"],
            asset_ids=["asset-1", "asset-2"],
            adapter=adapter,
        )
        self.assertTrue(completed["ok"])
        self.assertEqual(completed["photosWrittenCount"], 2)
        self.assertEqual([item["assetId"] for item in completed["items"]], ["asset-1", "asset-2"])
        self.assertIn("PBE:Approved", adapter.values["asset-1"]["keywords"])
        self.assertIn("PBE:Approved", adapter.values["asset-2"]["keywords"])
        self.assertIn("Keep me", adapter.values["asset-1"]["keywords"])


class FixtureAuthorizedUploadBridgeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        upsert_assets(
            self.root,
            [
                {
                    "localIdentifier": "native-asset",
                    "filename": "terrace.jpg",
                    "mediaType": "photo",
                },
                {
                    "localIdentifier": "generic-asset",
                    "filename": "generic.jpg",
                    "mediaType": "photo",
                },
                {
                    "localIdentifier": "ai-asset",
                    "filename": "ai.jpg",
                    "mediaType": "photo",
                },
                {
                    "localIdentifier": "stained-glass-photo",
                    "filename": "museum-window.jpg",
                    "mediaType": "photo",
                },
            ],
        )
        self.fixture = create_fixture(self.root, "Expo")
        set_fixture_asset_state(
            self.root,
            self.fixture["fixtureId"],
            ["native-asset", "generic-asset", "ai-asset", "stained-glass-photo"],
            "picked",
        )
        apply_fixture_review_action(
            self.root,
            self.fixture["fixtureId"],
            ["native-asset"],
            "approve",
            title="Palm Framed Hillside View From Terrace",
            keywords=["Terrace", "Palm"],
        )
        apply_fixture_review_action(
            self.root,
            self.fixture["fixtureId"],
            ["generic-asset"],
            "approve",
            title="Photo",
            keywords=[],
        )
        apply_fixture_review_action(
            self.root,
            self.fixture["fixtureId"],
            ["ai-asset"],
            "approve",
            title="Paris Glass Garden",
            keywords=["Paris", "AI generated illustration"],
        )
        apply_fixture_review_action(
            self.root,
            self.fixture["fixtureId"],
            ["stained-glass-photo"],
            "approve",
            title="Stained Glass Apostles at Musée Carnavalet",
            keywords=["Paris", "Musée Carnavalet", "stained glass", "apostles"],
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_native_fixture_authorization_replaces_only_obsolete_legacy_gates(self):
        with connect(self.root) as conn:
            state = conn.execute(
                """
                SELECT pick_state, metadata_state
                FROM sidecar_decisions
                WHERE asset_id = 'native-asset'
                """
            ).fetchone()
            self.assertEqual(state["pick_state"], "undecided")
            self.assertEqual(state["metadata_state"], "approved")

        legacy = queue_upload_bridge(
            self.root,
            asset_ids=["native-asset"],
            limit=1,
        )
        self.assertEqual(legacy["bridgeQueuedCount"], 0)

        authorized = queue_upload_bridge(
            self.root,
            asset_ids=["native-asset"],
            limit=1,
            fixture_authorized_asset_ids=["native-asset"],
        )
        self.assertEqual(authorized["bridgeQueuedCount"], 1)
        self.assertEqual(authorized["items"][0]["assetId"], "native-asset")

        batch = prepare_upload_bridge_execute_batch(
            self.root,
            limit=1,
            asset_ids=["native-asset"],
            fixture_authorized_asset_ids=["native-asset"],
        )
        self.assertEqual(batch["count"], 1)
        self.assertEqual(batch["items"][0]["assetId"], "native-asset")

    def test_native_fixture_authorization_does_not_bypass_generic_title(self):
        queued = queue_upload_bridge(
            self.root,
            asset_ids=["generic-asset"],
            limit=1,
            fixture_authorized_asset_ids=["generic-asset"],
        )
        self.assertEqual(queued["bridgeQueuedCount"], 0)
        self.assertEqual(queued["metadataBlockedCount"], 1)
        self.assertEqual(queued["metadataBlocked"][0]["reason"], "generic-title")

    def test_unverified_explicit_id_cannot_enter_fixture_authorized_bridge(self):
        with connect(self.root) as conn:
            conn.execute(
                """
                UPDATE asset_editorial_state
                SET editorial_state = 'unreviewed'
                WHERE asset_id = 'native-asset'
                """
            )
            conn.commit()
        queued = queue_upload_bridge(
            self.root,
            asset_ids=["native-asset"],
            limit=1,
            fixture_authorized_asset_ids=["native-asset"],
        )
        self.assertEqual(queued["bridgeQueuedCount"], 0)

    def test_fixture_authorization_does_not_bypass_ai_exclusion(self):
        queued = queue_upload_bridge(
            self.root,
            asset_ids=["ai-asset"],
            limit=1,
            fixture_authorized_asset_ids=["ai-asset"],
        )
        self.assertEqual(queued["bridgeQueuedCount"], 0)

    def test_fixture_authorization_allows_reviewed_stained_glass_photo(self):
        queued = queue_upload_bridge(
            self.root,
            asset_ids=["stained-glass-photo"],
            limit=1,
            fixture_authorized_asset_ids=["stained-glass-photo"],
        )
        self.assertEqual(queued["bridgeQueuedCount"], 1)
        self.assertEqual(queued["items"][0]["assetId"], "stained-glass-photo")


if __name__ == "__main__":
    unittest.main()
