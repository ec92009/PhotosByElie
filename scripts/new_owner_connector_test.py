import unittest
import json
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
from unittest.mock import patch

from scripts.new_owner_connector import (
    ConnectorConfig,
    InteractivePollingLease,
    WorkerClient,
    _allowed_local_status_origin,
    _local_status_payload,
    _local_sidecar_open_action,
    _owner_waste_basket_url,
    _sidecar_job_public_payload,
    _upload_and_register,
    execute_action,
    next_poll_interval,
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

    def test_idle_polling_backs_off_and_active_work_resets_it(self):
        self.assertEqual(next_poll_interval(5, 5, 0), 10)
        self.assertEqual(next_poll_interval(5, 10, 0), 20)
        self.assertEqual(next_poll_interval(5, 40, 0), 60)
        self.assertEqual(next_poll_interval(5, 60, 0), 60)
        self.assertEqual(next_poll_interval(5, 60, 1), 5)

    def test_interactive_gallery_lease_holds_short_polling(self):
        self.assertEqual(next_poll_interval(5, 60, 0, interactive=True), 5)
        self.assertEqual(next_poll_interval(30, 60, 0, interactive=True), 5)
        lease = InteractivePollingLease()
        self.assertFalse(lease.active())
        lease.touch(5)
        self.assertTrue(lease.active())

    def test_connector_uses_lightweight_interactive_probe(self):
        client = WorkerClient(self.config)
        with patch.object(client, "request", return_value={"interactivePolling": True}) as request:
            self.assertTrue(client.interactive())
        request.assert_called_once_with("GET", "/owner/connector/interactive")

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

    def test_owner_hidden_metadata_resolves_private_title_without_public_catalog(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            actions_dir = root / "assets" / "owner-actions"
            actions_dir.mkdir(parents=True)
            (actions_dir / "sidecar-register-uploaded-catalog-latest.json").write_text(json.dumps({
                "result": {"skipped": [{"photoId": "001-private", "assetId": "asset-private"}]},
            }), encoding="utf-8")
            connection = sqlite3.connect(actions_dir / "Owner.sqlite")
            connection.executescript("""
                CREATE TABLE sidecar_assets (
                  asset_id TEXT PRIMARY KEY,
                  photos_title TEXT,
                  metadata_seed_title TEXT,
                  location_label TEXT
                );
                CREATE TABLE sidecar_decisions (asset_id TEXT PRIMARY KEY, title TEXT);
                INSERT INTO sidecar_assets VALUES ('asset-private', '', '2023 Mexico', 'Mexico');
                INSERT INTO sidecar_decisions VALUES ('asset-private', 'Puerto Vallarta, Mexico');
            """)
            connection.commit()
            connection.close()
            config = ConnectorConfig("https://worker.test", "max", "x" * 32, root)

            result = execute_action(config, {
                "type": "owner-hidden-metadata",
                "payload": {"photoIds": ["001-private"]},
            })

        self.assertEqual(result["hiddenMetadata"]["001-private"]["title"], "Puerto Vallarta, Mexico")
        self.assertEqual(result["hiddenMetadata"]["001-private"]["collectionTitle"], "Mexico")

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

    def test_local_sidecar_open_action_is_claimed_for_this_connector(self):
        action = _local_sidecar_open_action(self.config, "local-sidecar-test")

        self.assertEqual(action["id"], "local-sidecar-test")
        self.assertEqual(action["state"], "claimed")
        self.assertEqual(action["claim"]["connectorId"], "david")
        self.assertFalse(action["payload"]["manifest"]["includePreviews"])
        self.assertFalse(action["payload"]["manifest"]["launchWorkspace"])

    def test_owner_waste_basket_url_targets_local_owner_review(self):
        self.assertEqual(
            _owner_waste_basket_url(8007),
            "http://127.0.0.1:8007/owner-review.html?view=blocked",
        )

    def test_sidecar_job_payload_surfaces_redirect_url(self):
        payload = _sidecar_job_public_payload(self.config, "local-sidecar-test", {
            "state": "completed",
            "message": "ready",
            "result": {
                "recordsPrepared": 24,
                "candidateCount": 52076,
                "workspace": {"url": "http://127.0.0.1:8011/sidecar.html"},
            },
        })

        self.assertTrue(payload["ok"])
        self.assertEqual(payload["url"], "http://127.0.0.1:8011/sidecar.html")
        self.assertEqual(payload["recordsPrepared"], 24)
        self.assertEqual(payload["connector"]["connectorId"], "david")

    def test_culling_action_launches_the_canonical_local_sidecar_when_requested(self):
        local_result = {
            "result": {"recordsPrepared": 24},
            "preview": {"items": [], "stateCounts": [{"pickState": "undecided", "count": 24}]},
        }
        with patch(
            "scripts.new_owner_connector._load_local_modules",
            return_value=(lambda *_args, **_kwargs: local_result, None, None, None, None),
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

    def test_photo_moderation_batches_public_photo_ids(self):
        calls = []

        def apply_public_photo_moderation(_repo_root, payload):
            calls.append(payload)
            return {"ok": True, "action": payload["operation"], "photo_ids": payload.get("photo_ids", [])}

        with patch(
            "scripts.new_owner_connector._load_local_modules",
            return_value=(None, None, None, None, apply_public_photo_moderation),
        ):
            result = execute_action(self.config, {
                "type": "photo-moderation",
                "payload": {"operation": "hide-many", "photoIds": ["photo-a", "photo-b"]},
            })

        self.assertEqual(calls, [{"operation": "hide-many", "photo_ids": ["photo-a", "photo-b"]}])
        self.assertEqual(result["photoIds"], ["photo-a", "photo-b"])

    def test_photo_moderation_group_undo_restores_each_photo(self):
        calls = []

        def apply_public_photo_moderation(_repo_root, payload):
            calls.append(payload)
            return {"ok": True, "action": payload["operation"], "photo_ids": payload["photo_ids"]}

        with patch(
            "scripts.new_owner_connector._load_local_modules",
            return_value=(None, None, None, None, apply_public_photo_moderation),
        ):
            result = execute_action(self.config, {
                "type": "photo-moderation",
                "payload": {"operation": "undo-hide-many", "photoIds": ["photo-a", "photo-b"]},
            })

        self.assertEqual(calls, [{"operation": "undo-hide-many", "photo_ids": ["photo-a", "photo-b"]}])
        self.assertEqual(result["result"]["action"], "undo-hide-many")

    def test_photo_moderation_forwards_metadata_edit_fields(self):
        calls = []

        def apply_public_photo_moderation(_repo_root, payload):
            calls.append(payload)
            return {"ok": True, "action": payload["operation"], "metadata": {"photo_id": payload["photo_ids"][0]}}

        with patch(
            "scripts.new_owner_connector._load_local_modules",
            return_value=(None, None, None, None, apply_public_photo_moderation),
        ):
            execute_action(self.config, {
                "type": "photo-moderation",
                "payload": {
                    "operation": "update-photo-metadata",
                    "photoId": "photo-a",
                    "title": "A better title",
                    "keywords": ["Paris", "Clock"],
                },
            })

        self.assertEqual(calls, [{
            "operation": "update-photo-metadata",
            "photo_ids": ["photo-a"],
            "title": "A better title",
            "keywords": ["Paris", "Clock"],
        }])

    def test_photo_moderation_allows_keyword_blacklist_without_photo_ids(self):
        calls = []

        def apply_public_photo_moderation(_repo_root, payload):
            calls.append(payload)
            return {"ok": True, "action": payload["operation"], "keywords": payload["keywords"]}

        with patch(
            "scripts.new_owner_connector._load_local_modules",
            return_value=(None, None, None, None, apply_public_photo_moderation),
        ):
            execute_action(self.config, {
                "type": "photo-moderation",
                "payload": {
                    "operation": "save-keyword-blacklist",
                    "keywords": ["camera photo", "travel photography"],
                    "mode": "replace",
                },
            })

        self.assertEqual(calls, [{
            "operation": "save-keyword-blacklist",
            "photo_ids": [],
            "keywords": ["camera photo", "travel photography"],
            "mode": "replace",
        }])


if __name__ == "__main__":
    unittest.main()
