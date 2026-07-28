import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sidecar_state_db
from fixture_pipeline import (
    ai_preview_targets,
    apply_fixture_review_action,
    create_fixture,
    set_fixture_asset_state,
)
from requested_ai_previews import capture_requested_ai_previews


class RequestedAIPreviewsTest(unittest.TestCase):
    def test_missing_previews_use_one_batched_signed_bridge_request(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sidecar_state_db.upsert_assets(root, [
                {
                    "localIdentifier": "asset-1",
                    "filename": "One.JPG",
                    "mediaType": "photo",
                    "creationDate": "2026-07-15T10:00:00Z",
                },
                {
                    "localIdentifier": "asset-2",
                    "filename": "Two.JPG",
                    "mediaType": "photo",
                    "creationDate": "2026-07-15T10:01:00Z",
                },
            ])
            fixture = create_fixture(root, "Expo", fixture_id="fixture-expo")
            set_fixture_asset_state(
                root,
                fixture["fixtureId"],
                ["asset-1", "asset-2"],
                "picked",
            )
            apply_fixture_review_action(
                root,
                fixture["fixtureId"],
                ["asset-1", "asset-2"],
                "request-ai",
                ai_reasons=["too generic"],
            )
            calls = []

            def bridge_runner(repo_root, args, timeout):
                calls.append((repo_root, args, timeout))
                requests = json.loads(Path(args[2]).read_text(encoding="utf-8"))
                for request in requests:
                    Path(request["destination"]).write_bytes(b"bounded-jpeg")
                return {
                    "ok": True,
                    "items": [
                        {"assetId": request["assetId"]}
                        for request in requests
                    ],
                }

            result = capture_requested_ai_previews(
                root,
                ["asset-1", "asset-2"],
                bridge_runner=bridge_runner,
            )

            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0][1][:2], ["preview-many", "--input"])
            self.assertEqual(result["requested"], 2)
            self.assertEqual(result["captured"], 2)
            self.assertEqual(result["failed"], 0)
            self.assertEqual(
                ai_preview_targets(root, ["asset-1", "asset-2"]),
                [],
            )


if __name__ == "__main__":
    unittest.main()
