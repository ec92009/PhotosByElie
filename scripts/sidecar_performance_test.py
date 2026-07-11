import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parent))

import sidecar_server
import sidecar_state_db


class IndexedWindowTest(unittest.TestCase):
    def test_cloud_id_filters_and_order_do_not_require_legacy_positions(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            rows = [
                {
                    "assetId": f"cloud-{index}",
                    "cloudIdentifier": f"cloud-{index}",
                    "localIdentifier": f"local-{index}/L0/001",
                    "sourceAnchor": f"apple-photos://cloud-{index}",
                    "mediaType": "photo",
                    "filename": f"Stained Glass {index}.jpg",
                    "creationDate": f"2026-01-0{index}T12:00:00Z",
                }
                for index in range(1, 5)
            ]
            sidecar_state_db.upsert_assets(repo_root, rows)
            sidecar_state_db.record_decision(repo_root, {"assetId": "cloud-3", "action": "pick"})
            sidecar_state_db.record_decision(repo_root, {"assetId": "cloud-2", "action": "reject"})
            sidecar_state_db.record_decision(repo_root, {"assetId": "cloud-1", "action": "tombstone"})

            payload = sidecar_state_db.indexed_library_window(
                repo_root,
                limit=10,
                pick_states=["undecided"],
                media_types=["photo"],
                search="stained glass",
                include_summary=False,
            )

            self.assertEqual([item["assetId"] for item in payload["items"]], ["cloud-4"])
            self.assertEqual(payload["filteredIndexedCount"], 1)
            self.assertNotIn("sidecarSummary", payload)
            self.assertEqual(payload["items"][0]["localIdentifier"], "local-4/L0/001")


class PhotosBridgeLaunchTest(unittest.TestCase):
    def test_app_task_waits_for_unique_result_file_without_open_wait_mode(self):
        commands = []

        def launch(command, **_kwargs):
            commands.append(command)
            destination = Path(command[command.index("--result-destination") + 1])
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(json.dumps({"ok": True, "mode": "preview"}), encoding="utf-8")
            return subprocess.CompletedProcess(command, 0, "", "")

        with tempfile.TemporaryDirectory() as temp_dir, \
             patch.object(sidecar_server, "_ensure_apple_photos_bridge_app"), \
             patch.object(sidecar_server.subprocess, "run", side_effect=launch):
            payload = sidecar_server._run_apple_photos_bridge_app_task(
                Path(temp_dir),
                ["preview", "--asset-id", "cloud-1"],
                timeout=1,
            )

        self.assertTrue(payload["ok"])
        self.assertEqual(commands[0][:2], ["open", "-n"])
        self.assertNotIn("-W", commands[0])


class SummaryCacheTest(unittest.TestCase):
    def test_summary_snapshot_is_reused_until_invalidated(self):
        sidecar_server._invalidate_summary_cache()
        with patch.object(sidecar_server, "summary", return_value={"ok": True, "indexedCount": 4}) as load:
            first = sidecar_server._summary_snapshot(Path("/tmp/sidecar-cache-test"))
            second = sidecar_server._summary_snapshot(Path("/tmp/sidecar-cache-test"))
            sidecar_server._invalidate_summary_cache()
            third = sidecar_server._summary_snapshot(Path("/tmp/sidecar-cache-test"))

        self.assertEqual(first, second)
        self.assertEqual(second, third)
        self.assertEqual(load.call_count, 2)


if __name__ == "__main__":
    unittest.main()
