import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.new_owner_connector import (
    ConnectorConfig,
    _allowed_local_status_origin,
    _local_status_payload,
    _upload_and_register,
    execute_action,
)


class UploadRegistrationScopeTest(unittest.TestCase):
    def setUp(self):
        self.config = ConnectorConfig("https://worker.test", "david", "x" * 32, Path("/tmp/repo"))

    def test_registration_is_limited_to_uploaded_action_assets(self):
        calls = []

        def fake_run(_config, arguments, timeout=3600):
            calls.append(arguments)
            if any(argument.endswith("sidecar_upload_bridge.py") for argument in arguments):
                return {
                    "runId": "run-1",
                    "status": "done",
                    "items": [
                        {"assetId": "asset-a", "status": "uploaded"},
                        {"assetId": "asset-b", "status": "uploaded"},
                    ],
                }
            return {"result": {"registeredCount": 2}, "rebuild": {"returnCode": 0}}

        with patch("scripts.new_owner_connector._run_repo_json", side_effect=fake_run):
            result = _upload_and_register(self.config, {"payload": {"limit": 1}})

        self.assertEqual(result["registration"]["registeredCount"], 2)
        self.assertEqual(calls[1][-4:], ["--asset-id", "asset-a", "--asset-id", "asset-b"])

    def test_empty_upload_does_not_run_global_registration(self):
        with patch("scripts.new_owner_connector._run_repo_json", return_value={"status": "done", "items": []}) as run:
            result = _upload_and_register(self.config, {"payload": {"limit": 1}})

        self.assertEqual(run.call_count, 1)
        self.assertEqual(result["registration"]["candidateCount"], 0)
        self.assertEqual(result["registration"]["registeredCount"], 0)

    def test_photos_index_sync_runs_the_non_ui_maintenance_command(self):
        payload = {"job": {"status": "done", "indexedCount": 57_500}, "sync": {"pendingCount": 3}}
        with patch("scripts.new_owner_connector._run_repo_json", return_value=payload) as run:
            result = execute_action(self.config, {"type": "sidecar-photos-index-sync"})

        arguments = run.call_args.args[1]
        self.assertEqual(arguments[1:3], ["scripts/sidecar_maintenance.py", "photos-index-sync"])
        self.assertEqual(result["job"]["status"], "done")
        self.assertEqual(result["job"]["indexedCount"], 57_500)

    def test_local_status_payload_identifies_connector_without_token(self):
        payload = _local_status_payload(self.config)

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["connectorId"], "david")
        self.assertNotIn("token", payload)

    def test_local_status_origin_allows_local_preview_ports(self):
        self.assertEqual(
            _allowed_local_status_origin("http://127.0.0.1:8131"),
            "http://127.0.0.1:8131",
        )
        self.assertEqual(
            _allowed_local_status_origin("https://photos-by-elie.com"),
            "https://photos-by-elie.com",
        )
        self.assertEqual(_allowed_local_status_origin("https://example.com"), "")

    def test_culling_action_launches_the_canonical_local_sidecar_when_requested(self):
        local_result = {
            "result": {"recordsPrepared": 24},
            "preview": {"items": [], "stateCounts": [{"pickState": "undecided", "count": 24}]},
        }
        with patch(
            "scripts.new_owner_connector._load_local_modules",
            return_value=(lambda *_args, **_kwargs: local_result, None, None, None),
        ), patch(
            "scripts.new_owner_connector._launch_sidecar_workspace",
            return_value={"launched": True, "surface": "sidecar.html", "connectorId": "david"},
        ) as launch:
            result = execute_action(self.config, {
                "type": "sidecar-culling-review",
                "payload": {"manifest": {"includePreviews": False, "launchWorkspace": True}},
            })

        launch.assert_called_once_with(self.config)
        self.assertTrue(result["workspace"]["launched"])
        self.assertEqual(result["workspace"]["surface"], "sidecar.html")


if __name__ == "__main__":
    unittest.main()
