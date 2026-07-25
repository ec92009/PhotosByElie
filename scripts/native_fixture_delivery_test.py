import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.fixture_pipeline import (
    configure_asset_destinations,
    create_fixture,
    editorial_version_hash,
    place_assets,
    publication_plan,
    record_delivery_receipt,
)
from scripts.native_fixture_delivery import deliver_fixture_assets
from scripts import sidecar_state_db


class NativeFixtureDeliveryTest(unittest.TestCase):
    def test_exact_delivery_finishes_run_then_gives_back_to_photos(self):
        prepared = {
            "runId": "run-1",
            "spoolRoot": "/tmp/run-1",
            "exportRoot": "/tmp/run-1/export",
            "items": [{"runItemId": "item-1", "assetId": "asset-1"}],
        }
        with (
            patch("scripts.native_fixture_delivery.delivery_plan", return_value={
                "items": [{"assetId": "asset-1", "approved": True}],
            }),
            patch("scripts.native_fixture_delivery.configure_asset_destinations") as configure,
            patch("scripts.native_fixture_delivery.queue_upload_bridge") as queue,
            patch("scripts.native_fixture_delivery.prepare_upload_bridge_execute_batch", return_value=prepared),
            patch("scripts.native_fixture_delivery.execute_upload_bridge_batch_item", return_value={
                "ok": True,
                "items": [{"assetId": "asset-1", "status": "uploaded"}],
            }),
            patch("scripts.native_fixture_delivery.finish_upload_bridge_execute_batch") as finish,
            patch("scripts.native_fixture_delivery.finalize_streamed_upload_batch", return_value={
                "ok": True,
                "r2ReceiptCount": 2,
                "photosWrittenCount": 1,
                "photosFailedCount": 0,
                "photosBlockedCount": 0,
            }) as finalize,
        ):
            result = deliver_fixture_assets(
                Path("/tmp/repo"),
                fixture_id="fixture-family",
                asset_ids=["asset-1"],
            )

        self.assertTrue(result["ok"])
        configure.assert_called_once()
        queue.assert_called_once()
        finish.assert_called_once()
        finalize.assert_called_once_with(
            Path("/tmp/repo"),
            run_id="run-1",
            fixture_id="fixture-family",
            asset_ids=["asset-1"],
        )

    def test_publication_requires_public_fixture_and_verified_r2(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sidecar_state_db.upsert_assets(root, [{
                "localIdentifier": "asset-1",
                "filename": "one.jpg",
                "mediaType": "photo",
            }])
            sidecar_state_db.record_decision(
                root,
                {
                    "assetId": "asset-1",
                    "action": "pick",
                },
            )
            sidecar_state_db.record_decision(
                root,
                {
                    "assetId": "asset-1",
                    "action": "approve",
                    "title": "Ready",
                },
            )
            fixture = create_fixture(root, "Expo", tags=["public"])
            place_assets(root, fixture["fixtureId"], ["asset-1"])
            configure_asset_destinations(
                root,
                fixture["fixtureId"],
                ["asset-1"],
                ["r2"],
            )
            from scripts.fixture_pipeline import connect
            with connect(root) as connection:
                version = editorial_version_hash(connection, "asset-1")
            record_delivery_receipt(
                root,
                fixture_id=fixture["fixtureId"],
                asset_id="asset-1",
                destination="r2",
                version_hash=version,
                status="verified",
                object_key="expo/asset-1_1800.jpg",
                checksum_sha256="abc123",
            )

            plan = publication_plan(root, fixture["fixtureId"], ["asset-1"])

        self.assertTrue(plan["ok"])
        self.assertEqual([item["assetId"] for item in plan["eligible"]], ["asset-1"])


if __name__ == "__main__":
    unittest.main()
