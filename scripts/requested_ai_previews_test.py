import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sidecar_state_db
from fixture_pipeline import (
    ai_preview_targets,
    apply_fixture_review_action,
    create_fixture,
    set_fixture_asset_state,
)
from requested_ai_previews import (
    REQUESTED_AI_PREVIEW_ROOT,
    capture_requested_ai_previews,
)


class RequestedAIPreviewsTest(unittest.TestCase):
    def _requesting_fixture(self, root: Path, *, source_anchor: str = "") -> None:
        sidecar_state_db.upsert_assets(root, [
            {
                "localIdentifier": "asset-1",
                "filename": "One.JPG",
                "mediaType": "photo",
                "creationDate": "2026-07-15T10:00:00Z",
                **({"sourceAnchor": source_anchor} if source_anchor else {}),
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

    def test_missing_previews_use_one_backstage_preview_request_per_target(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            self._requesting_fixture(root)

            def request_preview(photo_id, destination, max_pixel, *, timeout):
                Path(destination).write_bytes(b"bounded-jpeg")
                return {
                    "ok": True,
                    "mode": "preview",
                    "assetId": photo_id,
                }

            with patch("requested_ai_previews.request_preview", side_effect=request_preview) as request:
                result = capture_requested_ai_previews(root, ["asset-1", "asset-2"])

            self.assertEqual(request.call_count, 2)
            self.assertEqual(
                [call.args[0] for call in request.call_args_list],
                ["asset-1", "asset-2"],
            )
            for call in request.call_args_list:
                self.assertEqual(call.args[2], 1_600)
                self.assertGreater(call.kwargs["timeout"], 0)
                self.assertLessEqual(call.kwargs["timeout"], 60.0)
            expected_names = {
                hashlib.sha256(asset_id.encode()).hexdigest()[:24] + ".jpg"
                for asset_id in ("asset-1", "asset-2")
            }
            self.assertEqual(
                {Path(call.args[1]).name for call in request.call_args_list},
                expected_names,
            )
            self.assertEqual(result["requested"], 2)
            self.assertEqual(result["captured"], 2)
            self.assertEqual(result["failed"], 0)
            self.assertEqual(
                ai_preview_targets(root, ["asset-1", "asset-2"]),
                [],
            )

    def test_one_preview_failure_is_counted_without_stopping_the_batch(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            self._requesting_fixture(root)
            calls = []

            def preview_runner(photo_id, destination, max_pixel, timeout):
                calls.append((photo_id, destination, max_pixel, timeout))
                if photo_id == "asset-2":
                    return {
                        "ok": False,
                        "code": "preview_timeout",
                        "error": "Backstage preview timed out.",
                    }
                Path(destination).write_bytes(b"bounded-jpeg")
                return {"ok": True, "mode": "preview"}

            result = capture_requested_ai_previews(
                root,
                ["asset-1", "asset-2"],
                preview_runner=preview_runner,
            )

            self.assertEqual([call[0] for call in calls], ["asset-1", "asset-2"])
            self.assertEqual(result["requested"], 2)
            self.assertEqual(result["captured"], 1)
            self.assertEqual(result["failed"], 1)
            self.assertEqual(result["failures"], [{
                "assetId": "asset-2",
                "error": "Backstage preview timed out.",
            }])
            self.assertEqual(
                ai_preview_targets(root, ["asset-1", "asset-2"]),
                [{"assetId": "asset-2", "photoLibraryIdentifier": "asset-2"}],
            )

    def test_invalid_photo_id_fails_closed_without_creating_a_preview(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            self._requesting_fixture(root, source_anchor="apple-photos://asset\u007f-one")

            result = capture_requested_ai_previews(root, ["asset-1"])

            self.assertEqual(result["requested"], 1)
            self.assertEqual(result["captured"], 0)
            self.assertEqual(result["failed"], 1)
            self.assertIn("asset ID", result["failures"][0]["error"])
            preview_root = root / REQUESTED_AI_PREVIEW_ROOT
            self.assertEqual(list(preview_root.glob("*.jpg")), [])

    def test_invalid_preview_root_is_rejected_before_any_artifact_write(self):
        with tempfile.TemporaryDirectory() as temp_dir, tempfile.TemporaryDirectory() as outside_dir:
            root = Path(temp_dir)
            self._requesting_fixture(root)
            outside = Path(outside_dir)
            (root / ".review-logs").symlink_to(outside, target_is_directory=True)

            with self.assertRaisesRegex(ValueError, "escapes"):
                capture_requested_ai_previews(
                    root,
                    ["asset-1"],
                    preview_runner=lambda *_args: {"ok": True},
                )

            self.assertEqual(list(outside.iterdir()), [])

    def test_requested_ai_capture_has_no_standalone_bridge_batch_fallback(self):
        source = Path(__file__).with_name("requested_ai_previews.py").read_text(encoding="utf-8")

        self.assertIn("request_preview", source)
        self.assertNotIn("_run_apple_photos_bridge", source)
        self.assertNotIn("preview-many", source)
        self.assertNotIn("bridge_runner", source)


if __name__ == "__main__":
    unittest.main()
