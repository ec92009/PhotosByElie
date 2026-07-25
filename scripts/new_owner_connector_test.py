import unittest
import json
from pathlib import Path
import sqlite3
import socket
import time
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

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
    process_exact_action,
    start_local_status_server,
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
        request.assert_called_once_with("GET", "/api/v1/connectors/interactive")

    def test_connector_fetches_one_exact_worker_action(self):
        client = WorkerClient(self.config)
        with patch.object(client, "request", return_value={"action": {"id": "owner-action-1"}}) as request:
            self.assertEqual(client.action("owner-action-1")["id"], "owner-action-1")
        request.assert_called_once_with("GET", "/api/v1/connectors/actions/owner-action-1")

    def test_local_wake_claims_executes_and_completes_exact_action_with_timings(self):
        config = ConnectorConfig("https://worker.test", "david", "x" * 32, Path("/tmp/repo"))

        class FakeClient:
            def __init__(self):
                self.action_record = {
                    "id": "owner-action-test",
                    "type": "owner-connector-check",
                    "state": "queued",
                    "payload": {"requestedConnector": "david"},
                }
                self.transitions = []

            def action(self, action_id):
                self.assert_action_id = action_id
                return dict(self.action_record)

            def transition(self, action_id, transition, payload=None):
                self.transitions.append((action_id, transition, payload or {}))
                if transition == "claim":
                    self.action_record = {
                        **self.action_record,
                        "state": "claimed",
                        "claim": {"connectorId": "david"},
                    }
                elif transition == "complete":
                    self.action_record = {
                        **self.action_record,
                        "state": "completed",
                        "result": (payload or {}).get("result", {}),
                    }
                return {"action": dict(self.action_record)}

        client = FakeClient()
        action, processed = process_exact_action(config, client, "owner-action-test", local_wake=True)

        self.assertTrue(processed)
        self.assertEqual(action["state"], "completed")
        self.assertEqual([item[1] for item in client.transitions], ["claim", "complete"])
        self.assertTrue(client.transitions[0][2]["locallyAwakenedAt"])
        self.assertTrue(client.transitions[1][2]["timing"]["executedAt"])

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

    def test_owner_hidden_metadata_falls_back_to_lifecycle_title(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            actions_dir = root / "assets" / "owner-actions"
            actions_dir.mkdir(parents=True)
            connection = sqlite3.connect(actions_dir / "Owner.sqlite")
            connection.executescript("""
                CREATE TABLE media_lifecycle (
                  media_id TEXT PRIMARY KEY,
                  title TEXT,
                  previous_slug TEXT,
                  source_slug TEXT
                );
                INSERT INTO media_lifecycle VALUES ('001-legacy', 'Original private title', 'unknown', 'unknown');
            """)
            connection.commit()
            connection.close()
            config = ConnectorConfig("https://worker.test", "max", "x" * 32, root)

            result = execute_action(config, {
                "type": "owner-hidden-metadata",
                "payload": {"photoIds": ["001-legacy"]},
            })

        self.assertEqual(result["hiddenMetadata"]["001-legacy"]["title"], "Original private title")
        self.assertEqual(result["hiddenMetadata"]["001-legacy"]["collectionTitle"], "unknown")

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

    def test_local_wake_endpoint_accepts_only_an_opaque_action_id_from_trusted_origin(self):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        config = ConnectorConfig("https://worker.test", "david", "x" * 32, Path("/tmp/repo"), local_status_port=port)
        client = object()
        lease = InteractivePollingLease()
        with patch("scripts.new_owner_connector.process_exact_action", return_value=({
            "id": "owner-action-test",
            "state": "completed",
        }, True)) as process:
            start_local_status_server(config, lease, client)
            deadline = time.time() + 2
            while True:
                try:
                    with urlopen(f"http://127.0.0.1:{port}/photosbyelie/connector-status", timeout=0.2):
                        break
                except OSError:
                    if time.time() >= deadline:
                        self.fail("local connector test server did not start")
                    time.sleep(0.02)

            request = Request(
                f"http://127.0.0.1:{port}/photosbyelie/wake-owner-action",
                data=json.dumps({"actionId": "owner-action-test"}).encode("utf-8"),
                method="POST",
                headers={"Content-Type": "application/json", "Origin": "https://photos-by-elie.com"},
            )
            with urlopen(request, timeout=1) as response:
                body = json.loads(response.read())
            self.assertTrue(body["ok"])
            process.assert_called_once_with(config, client, "owner-action-test", local_wake=True)

            bad_request = Request(
                f"http://127.0.0.1:{port}/photosbyelie/wake-owner-action",
                data=json.dumps({"actionId": "owner-action-test", "operation": "undo-hide-many"}).encode("utf-8"),
                method="POST",
                headers={"Content-Type": "application/json", "Origin": "https://photos-by-elie.com"},
            )
            with self.assertRaises(HTTPError) as rejected:
                urlopen(bad_request, timeout=1)
            self.assertEqual(rejected.exception.code, 400)
            rejected.exception.close()

            untrusted_request = Request(
                f"http://127.0.0.1:{port}/photosbyelie/wake-owner-action",
                data=json.dumps({"actionId": "owner-action-test"}).encode("utf-8"),
                method="POST",
                headers={"Content-Type": "application/json", "Origin": "https://example.com"},
            )
            with self.assertRaises(HTTPError) as rejected_origin:
                urlopen(untrusted_request, timeout=1)
            self.assertEqual(rejected_origin.exception.code, 403)
            rejected_origin.exception.close()

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
                    "caption": "A museum clock in Paris",
                    "keywords": ["Paris", "Clock"],
                },
            })

        self.assertEqual(calls, [{
            "operation": "update-photo-metadata",
            "photo_ids": ["photo-a"],
            "title": "A better title",
            "caption": "A museum clock in Paris",
            "keywords": ["Paris", "Clock"],
        }])

    def test_photo_moderation_forwards_native_ai_review_without_photo_ids(self):
        calls = []

        def apply_public_photo_moderation(_repo_root, payload):
            calls.append(payload)
            return {"ok": True, "action": payload["operation"], "approved_count": 1}

        with patch(
            "scripts.new_owner_connector._load_local_modules",
            return_value=(None, None, None, None, apply_public_photo_moderation),
        ):
            execute_action(self.config, {
                "type": "photo-moderation",
                "payload": {
                    "operation": "save-title-keyword-review-approvals",
                    "batch_id": "batch-1",
                    "approvals": [{
                        "photo_id": "photo-a",
                        "batch_id": "batch-1",
                        "approved": True,
                        "title": "Paris clock",
                        "keywords": ["Paris", "Clock"],
                    }],
                    "rejections": [],
                    "blocked": [],
                },
            })

        self.assertEqual(calls[0]["operation"], "save-title-keyword-review-approvals")
        self.assertEqual(calls[0]["batch_id"], "batch-1")
        self.assertEqual(calls[0]["approvals"][0]["photo_id"], "photo-a")

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
