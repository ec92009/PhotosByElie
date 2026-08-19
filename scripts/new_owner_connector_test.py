import unittest
import hashlib
import importlib
import json
import os
from pathlib import Path
import sqlite3
import socket
import sys
import threading
import time
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import scripts.new_owner_connector as new_owner_connector
from scripts.new_owner_connector import (
    ConnectorConfig,
    InteractivePollingLease,
    WorkerRequestError,
    WorkerClient,
    _allowed_local_status_origin,
    _launch_sidecar_workspace,
    _load_local_modules,
    _local_status_payload,
    _local_sidecar_open_action,
    _action_is_read_only,
    _connector_process_lock,
    _new_action_timing,
    _owner_waste_basket_url,
    _sidecar_job_public_payload,
    _upload_and_register,
    drain_deployed_lifecycle_outbox,
    drain_hosted_lifecycle_requests,
    execute_action,
    next_poll_interval,
    process_exact_action,
    process_once,
    start_local_status_server,
)

sys.path.insert(0, str(Path(__file__).resolve().parent))
import waste_basket_gateway as lifecycle_gateway


class UploadRegistrationScopeTest(unittest.TestCase):
    def setUp(self):
        self.config = ConnectorConfig("https://worker.test", "david", "x" * 32, Path("/tmp/repo"))

    def test_runtime_modules_replace_mutable_checkout_shadows(self):
        with TemporaryDirectory() as runtime_temp, TemporaryDirectory() as checkout_temp:
            runtime_scripts = Path(runtime_temp) / "scripts"
            checkout_scripts = Path(checkout_temp) / "scripts"
            runtime_scripts.mkdir()
            checkout_scripts.mkdir()
            (runtime_scripts / "local_server.py").write_text(
                "from import_source_anchor import source_identity_from_row\n"
                "new_owner_connector_result = 'runtime-connector'\n"
                "new_owner_sidecar_decision_result = 'runtime-decision'\n"
                "apply_public_photo_moderation = source_identity_from_row\n",
                encoding="utf-8",
            )
            (runtime_scripts / "import_source_anchor.py").write_text(
                "source_identity_from_row = 'runtime-moderation'\n",
                encoding="utf-8",
            )
            (runtime_scripts / "sidecar_server.py").write_text(
                "_preview_cache_path = 'runtime-cache'\n"
                "_run_backstage_photos_preview_task = 'runtime-preview'\n",
                encoding="utf-8",
            )
            (checkout_scripts / "local_server.py").write_text(
                "new_owner_connector_result = 'checkout-connector'\n"
                "new_owner_sidecar_decision_result = 'checkout-decision'\n"
                "apply_public_photo_moderation = 'checkout-moderation'\n",
                encoding="utf-8",
            )
            (checkout_scripts / "sidecar_server.py").write_text(
                "_preview_cache_path = 'checkout-cache'\n",
                encoding="utf-8",
            )
            (checkout_scripts / "import_source_anchor.py").write_text(
                "checkout_only = True\n",
                encoding="utf-8",
            )
            original_path = list(sys.path)
            original_modules = {
                name: sys.modules.get(name)
                for name in ("local_server", "sidecar_server", "import_source_anchor")
            }
            try:
                sys.path.insert(0, str(checkout_scripts))
                importlib.import_module("local_server")
                importlib.import_module("sidecar_server")
                importlib.import_module("import_source_anchor")

                loaded = _load_local_modules(Path(runtime_temp))

                self.assertEqual(
                    loaded,
                    (
                        "runtime-connector",
                        "runtime-decision",
                        "runtime-cache",
                        "runtime-preview",
                        "runtime-moderation",
                    ),
                )
                self.assertTrue(
                    Path(sys.modules["sidecar_server"].__file__).resolve().is_relative_to(
                        runtime_scripts.resolve()
                    )
                )
                self.assertTrue(
                    Path(sys.modules["import_source_anchor"].__file__).resolve().is_relative_to(
                        runtime_scripts.resolve()
                    )
                )
            finally:
                sys.path[:] = original_path
                for name, module in original_modules.items():
                    sys.modules.pop(name, None)
                    if module is not None:
                        sys.modules[name] = module

    def test_launch_agent_does_not_throttle_interactive_owner_reads(self):
        template = (
            Path(__file__).with_name("new_owner_connector_launch_agent.plist.in")
        ).read_text(encoding="utf-8")
        self.assertIn("<key>ProcessType</key>\n  <string>Standard</string>", template)
        self.assertNotIn("<string>Background</string>", template)

    def test_on_demand_mode_rejects_a_long_running_invocation(self):
        with (
            patch.dict(os.environ, {"PBE_ON_DEMAND_OWNER_CONNECTOR": "1"}),
            patch.object(sys, "argv", ["new_owner_connector.py"]),
        ):
            with self.assertRaises(SystemExit) as raised:
                new_owner_connector.main()
        self.assertIn("must use --once", str(raised.exception))

    def test_bounded_connector_drain_uses_a_shared_nonblocking_process_lock(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "assets" / "owner-actions").mkdir(parents=True)
            config = ConnectorConfig("https://worker.test", "max", "x" * 32, root)

            with _connector_process_lock(config) as first:
                self.assertTrue(first)
                with _connector_process_lock(config) as second:
                    self.assertFalse(second)

            with _connector_process_lock(config) as reacquired:
                self.assertTrue(reacquired)

            lock_path = root / "assets" / "owner-actions" / ".owner-connector-on-demand.lock"
            self.assertEqual(lock_path.stat().st_mode & 0o777, 0o600)

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
        connector_timing = client.transitions[1][2]["timing"]["connector"]
        self.assertEqual(connector_timing["schema"], "photosbyelie.ownerActionTiming.v1")
        self.assertGreaterEqual(connector_timing["elapsedMs"], 0)
        self.assertEqual(
            set(("action.fetch", "action.claim", "action.execute", "action.complete"))
            - set(connector_timing["phases"]),
            set(),
        )

    def test_fixture_tree_is_a_read_only_connector_action(self):
        self.assertTrue(_action_is_read_only({
            "type": "sidecar-culling-review",
            "payload": {"manifest": {"mode": "fixture-tree-list"}},
        }))
        self.assertFalse(_action_is_read_only({
            "type": "sidecar-culling-review",
            "payload": {"manifest": {"mode": "fixture-state-apply"}},
        }))

    def test_read_only_fixture_action_does_not_wait_for_unrelated_mutation(self):
        config = ConnectorConfig("https://worker.test", "max", "x" * 32, Path("/tmp/repo"))
        mutation_started = threading.Event()
        release_mutation = threading.Event()

        class FakeClient:
            def __init__(self):
                self.records = {
                    "owner-action-write": {
                        "id": "owner-action-write",
                        "type": "sidecar-culling-review",
                        "state": "queued",
                        "payload": {"manifest": {"mode": "fixture-state-apply"}},
                    },
                    "owner-action-read": {
                        "id": "owner-action-read",
                        "type": "sidecar-culling-review",
                        "state": "queued",
                        "payload": {"manifest": {"mode": "fixture-tree-list"}},
                    },
                }
                self.guard = threading.Lock()

            def action(self, action_id):
                with self.guard:
                    return dict(self.records[action_id])

            def transition(self, action_id, transition, payload=None):
                with self.guard:
                    if transition == "claim":
                        self.records[action_id] = {
                            **self.records[action_id],
                            "state": "claimed",
                            "claim": {"connectorId": "max"},
                        }
                    elif transition == "complete":
                        self.records[action_id] = {
                            **self.records[action_id],
                            "state": "completed",
                            "result": (payload or {}).get("result", {}),
                        }
                    return {"action": dict(self.records[action_id])}

        def fake_execute(_config, action, **_kwargs):
            if action["id"] == "owner-action-write":
                mutation_started.set()
                self.assertTrue(release_mutation.wait(2))
            return {"id": action["id"]}

        client = FakeClient()
        with patch("scripts.new_owner_connector.execute_action", side_effect=fake_execute):
            write_thread = threading.Thread(
                target=process_exact_action,
                args=(config, client, "owner-action-write"),
            )
            write_thread.start()
            self.assertTrue(mutation_started.wait(1))
            read_action, processed = process_exact_action(config, client, "owner-action-read")
            self.assertTrue(processed)
            self.assertEqual(read_action["state"], "completed")
            release_mutation.set()
            write_thread.join(2)
            self.assertFalse(write_thread.is_alive())

    def test_empty_upload_does_not_run_global_registration(self):
        with patch("scripts.new_owner_connector._run_repo_json", return_value={"status": "done", "items": []}) as run:
            result = _upload_and_register(self.config, {"payload": {"limit": 1}})

        self.assertEqual(run.call_count, 1)
        self.assertEqual(result["registration"]["candidateCount"], 0)
        self.assertEqual(result["registration"]["registeredCount"], 0)

    def test_fixture_delivery_uses_only_the_exact_fixture_asset_ids(self):
        with patch("scripts.new_owner_connector._run_repo_json", return_value={
            "ok": True,
            "fixtureId": "fixture-family",
            "status": "completed",
        }) as run:
            result = _upload_and_register(self.config, {"payload": {
                "workflow": "fixture-delivery",
                "fixtureId": "fixture-family",
                "assetIds": ["asset-b", "asset-a", "asset-b"],
            }})

        arguments = run.call_args.args[1]
        self.assertEqual(arguments[1], "scripts/native_fixture_delivery.py")
        self.assertEqual(arguments[-4:], ["--asset-id", "asset-b", "--asset-id", "asset-a"])
        self.assertEqual(result["assetIds"], ["asset-b", "asset-a"])


    def test_photos_index_sync_runs_the_non_ui_maintenance_command(self):
        payload = {"job": {"status": "done", "indexedCount": 57_500}, "sync": {"pendingCount": 3}}
        with patch("scripts.new_owner_connector._run_repo_json", return_value=payload) as run:
            result = execute_action(self.config, {
                "type": "sidecar-photos-index-sync",
                "payload": {
                    "dateFrom": "2026-06-13T00:00:00Z",
                    "dateTo": "2026-07-29T00:00:00Z",
                },
            })

        arguments = run.call_args.args[1]
        self.assertEqual(arguments[1:3], ["scripts/sidecar_maintenance.py", "photos-index-sync"])
        self.assertEqual(
            arguments[-4:],
            [
                "--date-from",
                "2026-06-13T00:00:00Z",
                "--date-to",
                "2026-07-29T00:00:00Z",
            ],
        )
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
        started = threading.Event()
        release = threading.Event()

        def fake_process(*args, **kwargs):
            started.set()
            release.wait(2)
            return ({
                "id": "owner-action-test",
                "state": "completed",
            }, True)

        with patch("scripts.new_owner_connector.process_exact_action", side_effect=fake_process) as process:
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
                self.assertEqual(response.status, 202)
                body = json.loads(response.read())
            self.assertTrue(body["ok"])
            self.assertTrue(body["diagnostics"]["accepted"])
            self.assertIsNone(body["action"])
            self.assertTrue(started.wait(1))
            release.set()
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
            "scripts.new_owner_connector.LEGACY_SIDECAR_ENABLED",
            True,
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

    def test_culling_action_refuses_legacy_workspace_without_explicit_kill_switch(self):
        with patch("scripts.new_owner_connector.LEGACY_SIDECAR_ENABLED", False):
            with self.assertRaisesRegex(RuntimeError, "Legacy Sidecar is disabled"):
                _launch_sidecar_workspace(self.config)

    def test_culling_action_preserves_read_only_connector_result(self):
        local_result = {
            "result": {"recordsPrepared": 2, "readOnly": True},
            "preview": {"items": [], "stateCounts": []},
        }
        with patch(
            "scripts.new_owner_connector._load_local_modules",
            return_value=(lambda *_args, **_kwargs: local_result, None, None, None, None),
        ):
            result = execute_action(self.config, {
                "type": "sidecar-culling-review",
                "payload": {"manifest": {"includePreviews": False}},
            })

        self.assertTrue(result["readOnly"])

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

    def test_photo_moderation_forwards_model_ladder_without_photo_ids(self):
        calls = []

        def apply_public_photo_moderation(_repo_root, payload):
            calls.append(payload)
            return {"ok": True, "action": payload["operation"], "model_ladder": payload["model_ladder"]}

        with patch(
            "scripts.new_owner_connector._load_local_modules",
            return_value=(None, None, None, None, apply_public_photo_moderation),
        ):
            execute_action(self.config, {
                "type": "photo-moderation",
                "payload": {
                    "operation": "save-title-keyword-model-ladder",
                    "model_ladder": [
                        "codex-gpt-5.6-luna-max-vision",
                        "codex-gpt-5.4-mini",
                    ],
                },
            })

        self.assertEqual(calls, [{
            "operation": "save-title-keyword-model-ladder",
            "photo_ids": [],
            "model_ladder": [
                "codex-gpt-5.6-luna-max-vision",
                "codex-gpt-5.4-mini",
            ],
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


class ConnectorLifecycleProtocolTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.db = self.root / "assets" / "owner-actions" / "Owner.sqlite"
        lifecycle_gateway.ensure_schema(self.root, self.db)
        with sqlite3.connect(self.db) as connection:
            connection.execute(
                """INSERT INTO sidecar_assets
                  (asset_id, source_anchor, media_type, filename, indexed_at, updated_at)
                  VALUES ('asset-2', 'synthetic://asset-2', 'photo', 'asset-2.jpg',
                          '2026-08-13T00:00:00Z', '2026-08-13T00:00:00Z')"""
            )
            connection.execute(
                """INSERT INTO r2_objects
                  (bucket, object_key, photo_id, object_kind, lifecycle_state,
                   first_seen_at, last_seen_at, source, bytes, updated_at)
                  VALUES ('public', 'expo/asset-1_900.jpg', 'asset-1', 'preview', 'current',
                          '2026-08-13T00:00:00Z', '2026-08-13T00:00:00Z', 'synthetic', 12,
                          '2026-08-13T00:00:00Z')"""
            )
            connection.commit()
        self.config = ConnectorConfig("https://worker.test", "david", "x" * 32, self.root)

    def tearDown(self):
        self.temp_dir.cleanup()

    @staticmethod
    def _arm(payload):
        members = payload["items"]
        envelope = {
            "operationId": payload["operationId"],
            "operation": payload["operation"],
            "denied": payload["denied"],
            "members": members,
        }
        digest = hashlib.sha256(
            json.dumps(envelope, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        return {
            "operationId": payload["operationId"],
            "operationDigest": digest,
            "operation": payload["operation"],
            "denied": payload["denied"],
            "revision": 23,
            "state": "armed",
            "members": [{
                "canonicalAssetId": item["canonicalAssetId"],
                "canonicalMediaId": item["canonicalMediaId"],
                "revision": 23,
            } for item in members],
        }

    class FakeWorker:
        def __init__(self, owner, *, fail_once_at="", lose_response_once_at=""):
            self.owner = owner
            self.fail_once_at = fail_once_at
            self.lose_response_once_at = lose_response_once_at
            self.failed = False
            self.calls = []
            self.arm_receipts = {}

        def request(self, method, path, payload=None, *, idempotency_key=""):
            phase = path.rsplit("/", 1)[-1]
            self.calls.append((phase, payload, idempotency_key))
            if phase == self.fail_once_at and not self.failed:
                self.failed = True
                raise RuntimeError(f"synthetic {phase} crash")
            if phase == "arm":
                operation_id = payload["operationId"]
                receipt = self.arm_receipts.setdefault(operation_id, self.owner._arm(payload))
                if phase == self.lose_response_once_at and not self.failed:
                    self.failed = True
                    raise RuntimeError(f"synthetic {phase} response loss after commit")
                return receipt
            return {"ok": True, "state": phase}

    def _persist_local_commit(self, operation_id="owner-action:action-1"):
        members = lifecycle_gateway.derive_deployed_lifecycle_members(self.root, ["asset-1"], self.db)
        arm = self._arm({
            "operationId": operation_id,
            "operation": "x",
            "denied": True,
            "items": members,
        })
        lifecycle_gateway.record_deployed_lifecycle_arm(self.root, "x", ["asset-1"], arm, self.db)
        lifecycle_gateway.move_to_waste_basket(
            self.root,
            ["asset-1"],
            source="backstage-culling",
            request_key=operation_id,
            deployed_lifecycle=arm,
            db_path=self.db,
        )
        return arm

    def test_connector_ignores_untrusted_members_and_threads_only_trusted_arm(self):
        worker = self.FakeWorker(self)
        calls = []

        def apply(_root, payload, *, trusted_deployed_lifecycle=None):
            calls.append((payload, trusted_deployed_lifecycle))
            return lifecycle_gateway.move_to_waste_basket(
                self.root,
                payload["photo_ids"],
                source="backstage-culling",
                request_key=payload["request_key"],
                deployed_lifecycle=trusted_deployed_lifecycle,
                db_path=self.db,
            )

        with patch("scripts.new_owner_connector.WorkerClient", return_value=worker), patch(
            "scripts.new_owner_connector._load_local_modules",
            return_value=(None, None, None, None, apply),
        ):
            timing = _new_action_timing("owner-action:action-1")
            result = execute_action(self.config, {
                "id": "action-1",
                "type": "photo-moderation",
                "payload": {
                    "operation": "waste-basket-x",
                    "photoIds": ["asset-1"],
                    "lifecycleMembers": [{"canonicalAssetId": "attacker", "bindings": []}],
                    "requestKey": "attacker-request-key",
                    "source": "backstage-culling",
                },
            }, action_timing=timing)

        arm_call = worker.calls[0]
        self.assertEqual(arm_call[0], "arm")
        self.assertEqual(arm_call[1]["items"][0]["canonicalAssetId"], "asset-1")
        self.assertEqual(
            arm_call[1]["items"][0]["bindings"],
            [{"bucket": "public", "objectKey": "expo/asset-1_900.jpg"}],
        )
        self.assertNotIn("deployed_lifecycle", calls[0][0])
        self.assertEqual(calls[0][0]["request_key"], "owner-action:action-1")
        self.assertNotIn("requestKey", calls[0][0])
        self.assertEqual(calls[0][1]["operationId"], "owner-action:action-1")
        self.assertEqual(result["timing"]["connector"], timing)
        self.assertGreaterEqual(timing["phases"]["lifecycle.remote.arm.owner-action:action-1"]["elapsedMs"], 0)
        self.assertGreaterEqual(timing["phases"]["lifecycle.local-moderation"]["elapsedMs"], 0)
        self.assertGreaterEqual(timing["phases"]["lifecycle.outbox.replay"]["elapsedMs"], 0)
        self.assertEqual(result["lifecycle"]["replay"][-1]["state"], "locally_acked")
        self.assertEqual(
            [item[2] for item in worker.calls],
            [
                "connector-lifecycle:owner-action:action-1:arm",
                "connector-lifecycle:owner-action:action-1:local-commit",
                "connector-lifecycle:owner-action:action-1:apply",
                "connector-lifecycle:owner-action:action-1:ack",
            ],
        )

    def test_commit_then_arm_response_loss_replays_stable_intent_and_aborts(self):
        worker = self.FakeWorker(self, lose_response_once_at="arm")
        applied = []

        def apply(*_args, **_kwargs):
            applied.append(True)
            raise AssertionError("local mutation must not run without a durable arm receipt")

        action = {
            "id": "action-response-loss",
            "type": "photo-moderation",
            "payload": {
                "operation": "waste-basket-x",
                "photoIds": ["asset-1"],
                "source": "backstage-culling",
            },
        }
        with patch(
            "scripts.new_owner_connector._load_local_modules",
            return_value=(None, None, None, None, apply),
        ):
            with self.assertRaisesRegex(RuntimeError, "synthetic arm response loss after commit"):
                execute_action(self.config, action, lifecycle_client=worker)

        self.assertEqual(applied, [])
        self.assertIn("owner-action:action-response-loss", worker.arm_receipts)
        self.assertEqual(worker.calls[0][0], "arm")
        self.assertEqual(
            worker.calls[0][2],
            "connector-lifecycle:owner-action:action-response-loss:arm",
        )
        with sqlite3.connect(self.db) as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT operation_id FROM owner_connector_lifecycle_arm_intents"
                ).fetchone()[0],
                "owner-action:action-response-loss",
            )

        drained = drain_deployed_lifecycle_outbox(self.config, worker)

        self.assertEqual([call[0] for call in worker.calls], ["arm", "arm", "abort"])
        self.assertEqual(worker.calls[1][1], worker.calls[0][1])
        self.assertEqual(worker.calls[1][2], worker.calls[0][2])
        self.assertEqual(drained[-1]["state"], "aborted")
        self.assertEqual(
            lifecycle_gateway.deployed_lifecycle_operation_state(
                self.root, "owner-action:action-response-loss", self.db
            ),
            "aborted",
        )
        with sqlite3.connect(self.db) as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT COUNT(*) FROM owner_connector_lifecycle_arm_intents"
                ).fetchone()[0],
                0,
            )

    def test_deterministic_remote_identity_rejection_retires_pre_mutation_intent(self):
        members = lifecycle_gateway.derive_deployed_lifecycle_members(self.root, ["asset-1"], self.db)
        request = {
            "operationId": "owner-action:identity-rejected",
            "operation": "empty",
            "denied": True,
            "items": members,
        }
        intent = new_owner_connector._persist_lifecycle_arm_intent(
            self.config,
            "empty",
            ["asset-1"],
            request,
        )

        class RejectingWorker:
            def request(self, *_args, **_kwargs):
                raise WorkerRequestError(
                    "Lifecycle arm membership must exactly match the activated canonical manifest.",
                    status=409,
                    code="lifecycle_identity_conflict",
                )

        with self.assertRaisesRegex(WorkerRequestError, "activated canonical manifest"):
            new_owner_connector._reconcile_lifecycle_arm_intent(
                self.config,
                RejectingWorker(),
                lifecycle_gateway,
                intent,
            )
        with sqlite3.connect(self.db) as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT COUNT(*) FROM owner_connector_lifecycle_arm_intents"
                ).fetchone()[0],
                0,
            )

    def test_drain_replays_from_each_committed_phase_after_crash(self):
        arm = self._persist_local_commit()
        crashed = self.FakeWorker(self, fail_once_at="apply")
        with self.assertRaisesRegex(RuntimeError, "synthetic apply crash"):
            drain_deployed_lifecycle_outbox(self.config, crashed)
        self.assertEqual(
            lifecycle_gateway.deployed_lifecycle_outbox(self.root, arm["operationId"], self.db)["state"],
            "locally_committed",
        )

        replay = self.FakeWorker(self)
        result = drain_deployed_lifecycle_outbox(self.config, replay)
        self.assertEqual([item[0] for item in replay.calls], ["local-commit", "apply", "ack"])
        self.assertEqual(result[-1]["state"], "locally_acked")
        self.assertEqual(
            lifecycle_gateway.deployed_lifecycle_outbox(self.root, arm["operationId"], self.db)["state"],
            "locally_acked",
        )

    def test_drain_replays_after_local_commit_call_crash(self):
        arm = self._persist_local_commit()
        crashed = self.FakeWorker(self, fail_once_at="local-commit")
        with self.assertRaisesRegex(RuntimeError, "synthetic local-commit crash"):
            drain_deployed_lifecycle_outbox(self.config, crashed)
        self.assertEqual(
            lifecycle_gateway.deployed_lifecycle_outbox(self.root, arm["operationId"], self.db)["state"],
            "locally_committed",
        )
        replay = self.FakeWorker(self)
        drain_deployed_lifecycle_outbox(self.config, replay)
        self.assertEqual([item[0] for item in replay.calls], ["local-commit", "apply", "ack"])

    def test_drain_replays_ack_without_reapplying_and_aborts_uncommitted_arm(self):
        arm = self._persist_local_commit()
        crashed = self.FakeWorker(self, fail_once_at="ack")
        with self.assertRaisesRegex(RuntimeError, "synthetic ack crash"):
            drain_deployed_lifecycle_outbox(self.config, crashed)
        self.assertEqual(
            lifecycle_gateway.deployed_lifecycle_outbox(self.root, arm["operationId"], self.db)["state"],
            "deployed_applied",
        )
        replay = self.FakeWorker(self)
        drain_deployed_lifecycle_outbox(self.config, replay)
        self.assertEqual([item[0] for item in replay.calls], ["ack"])

        members = lifecycle_gateway.derive_deployed_lifecycle_members(self.root, ["asset-1"], self.db)
        second = self._arm({
            "operationId": "owner-action:action-abort",
            "operation": "x",
            "denied": True,
            "items": members,
        })
        lifecycle_gateway.record_deployed_lifecycle_arm(self.root, "x", ["asset-1"], second, self.db)
        aborting = self.FakeWorker(self)
        result = drain_deployed_lifecycle_outbox(self.config, aborting)
        self.assertEqual([item[0] for item in aborting.calls], ["abort"])
        self.assertEqual(result[0]["state"], "aborted")
        self.assertFalse(aborting.calls[0][1]["proof"]["localMutationCommitted"])

    def test_normal_poll_drains_before_and_after_cloud_actions(self):
        class PollClient:
            def heartbeat(self):
                return {"ok": True}

            def actions(self):
                return []

        client = PollClient()
        with patch(
            "scripts.new_owner_connector.drain_deployed_lifecycle_outbox",
            return_value=[],
        ) as drain, patch(
            "scripts.new_owner_connector.drain_hosted_lifecycle_requests",
            return_value=[],
        ) as hosted:
            self.assertEqual(process_once(self.config, client), 0)
        self.assertEqual(drain.call_count, 2)
        self.assertEqual(drain.call_args_list[0].args, (self.config, client))
        self.assertEqual(drain.call_args_list[1].args, (self.config, client))
        self.assertEqual(hosted.call_count, 2)
        self.assertEqual(hosted.call_args_list[0].args, (self.config, client))
        self.assertEqual(hosted.call_args_list[1].args, (self.config, client))

    def test_hosted_armed_crash_is_shielded_until_resume_but_failed_orphan_aborts(self):
        worker = self.FakeWorker(self)
        queued = lifecycle_gateway.queue_hosted_lifecycle_request(
            self.root, operation="waste-basket-x", asset_ids=["asset-1"],
            session_id="session-one", fixture_id="fixture-1", request_key="browser-armed-crash",
            db_path=self.db,
        )
        operation_id = f"owner-action:hosted-lifecycle:{queued['requestId']}"
        members = lifecycle_gateway.derive_deployed_lifecycle_members(
            self.root, ["asset-1"], self.db
        )
        arm = self._arm({
            "operationId": operation_id, "operation": "x", "denied": True,
            "items": members,
        })
        lifecycle_gateway.record_deployed_lifecycle_arm(
            self.root, "x", ["asset-1"], arm, self.db
        )

        queued_shield = drain_deployed_lifecycle_outbox(self.config, worker)
        self.assertEqual(queued_shield, [{
            "operationId": operation_id,
            "state": "armed",
            "hostedRequestState": "queued",
        }])
        lifecycle_gateway.claim_hosted_lifecycle_request(self.root, queued["requestId"], self.db)
        running_shield = drain_deployed_lifecycle_outbox(self.config, worker)
        self.assertEqual(running_shield, [{
            "operationId": operation_id,
            "state": "armed",
            "hostedRequestState": "running",
        }])
        self.assertEqual(worker.calls, [])
        self.assertEqual(
            lifecycle_gateway.deployed_lifecycle_operation_state(
                self.root, operation_id, self.db
            ),
            "armed",
        )

        def apply(_root, payload, *, trusted_deployed_lifecycle=None):
            return lifecycle_gateway.move_to_waste_basket(
                self.root, payload["photo_ids"], source="owner-gallery",
                actor=payload["actor"], fixture_id=payload["fixture_id"],
                gallery_id=payload["gallery_id"], request_key=payload["request_key"],
                owner_mode=True, owner_authorized=True,
                deployed_lifecycle=trusted_deployed_lifecycle, db_path=self.db,
            )

        with patch(
            "scripts.new_owner_connector._load_local_modules",
            return_value=(None, None, None, None, apply),
        ):
            resumed = drain_hosted_lifecycle_requests(self.config, worker)
        self.assertEqual(resumed[0]["state"], "completed")
        self.assertEqual(
            lifecycle_gateway.deployed_lifecycle_operation_state(
                self.root, operation_id, self.db
            ),
            "locally_acked",
        )

        terminal = lifecycle_gateway.queue_hosted_lifecycle_request(
            self.root, operation="waste-basket-x", asset_ids=["asset-1"],
            session_id="session-one", fixture_id="fixture-1", request_key="browser-terminal",
            db_path=self.db,
        )
        terminal_operation_id = f"owner-action:hosted-lifecycle:{terminal['requestId']}"
        terminal_arm = self._arm({
            "operationId": terminal_operation_id, "operation": "x", "denied": True,
            "items": members,
        })
        lifecycle_gateway.record_deployed_lifecycle_arm(
            self.root, "x", ["asset-1"], terminal_arm, self.db
        )
        lifecycle_gateway.finish_hosted_lifecycle_request(
            self.root, terminal["requestId"], error="terminal synthetic failure",
            db_path=self.db,
        )
        worker.calls.clear()
        aborted = drain_deployed_lifecycle_outbox(self.config, worker)
        self.assertEqual(aborted[0]["state"], "aborted")
        self.assertEqual([call[0] for call in worker.calls], ["abort"])

    def test_hosted_queue_executes_x_and_restore_with_stable_synthetic_action(self):
        worker = self.FakeWorker(self)
        calls = []

        def apply(_root, payload, *, trusted_deployed_lifecycle=None):
            calls.append(dict(payload))
            operation = payload["operation"]
            keywords = {
                "source": "owner-gallery", "actor": payload["actor"],
                "fixture_id": payload["fixture_id"], "request_key": payload["request_key"],
                "owner_mode": True, "owner_authorized": True,
                "deployed_lifecycle": trusted_deployed_lifecycle, "db_path": self.db,
            }
            if operation == "waste-basket-restore":
                return lifecycle_gateway.restore_from_waste_basket(
                    self.root, payload["photo_ids"], **keywords,
                )
            return lifecycle_gateway.move_to_waste_basket(
                self.root, payload["photo_ids"], gallery_id=payload["gallery_id"], **keywords,
            )

        first = lifecycle_gateway.queue_hosted_lifecycle_request(
            self.root, operation="waste-basket-x", asset_ids=["asset-1"],
            session_id="session-one", fixture_id="fixture-1", request_key="browser-x",
            db_path=self.db,
        )
        with patch("scripts.new_owner_connector._load_local_modules", return_value=(None, None, None, None, apply)):
            result = drain_hosted_lifecycle_requests(self.config, worker)
        self.assertEqual(result[0]["state"], "completed")
        self.assertEqual(calls[0]["request_key"], f"owner-action:hosted-lifecycle:{first['requestId']}")
        self.assertEqual(calls[0]["fixture_id"], "fixture-1")

        with sqlite3.connect(self.db) as connection:
            connection.execute(
                """INSERT INTO r2_objects
                  (bucket, object_key, photo_id, object_kind, lifecycle_state,
                   first_seen_at, last_seen_at, source, bytes, updated_at)
                  VALUES ('public', 'expo/asset-2_900.jpg', 'asset-2', 'preview', 'current',
                          '2026-08-13T00:00:00Z', '2026-08-13T00:00:00Z', 'synthetic', 12,
                          '2026-08-13T00:00:00Z')"""
            )
        lifecycle_gateway.move_to_waste_basket(
            self.root, ["asset-2"], source="backstage-culling", fixture_id="fixture-1",
            db_path=self.db,
        )
        second = lifecycle_gateway.queue_hosted_lifecycle_request(
            self.root, operation="waste-basket-restore", asset_ids=["asset-2"],
            session_id="session-one", fixture_id="fixture-1", request_key="browser-restore",
            db_path=self.db,
        )
        with patch("scripts.new_owner_connector._load_local_modules", return_value=(None, None, None, None, apply)):
            result = drain_hosted_lifecycle_requests(self.config, worker)
        self.assertEqual(result[0], {"requestId": second["requestId"], "state": "completed"})

    def test_hosted_queue_survives_connector_failure_and_replays_once(self):
        queued = lifecycle_gateway.queue_hosted_lifecycle_request(
            self.root, operation="waste-basket-x", asset_ids=["asset-1"],
            session_id="session-one", fixture_id="fixture-1", request_key="browser-replay",
            db_path=self.db,
        )
        with patch("scripts.new_owner_connector.execute_action", side_effect=RuntimeError("connector offline")):
            first = drain_hosted_lifecycle_requests(self.config, self.FakeWorker(self))
        self.assertEqual(first[0]["state"], "queued")
        pending = lifecycle_gateway.pending_hosted_lifecycle_requests(self.root, db_path=self.db)
        self.assertEqual(pending[0]["requestId"], queued["requestId"])
        with patch("scripts.new_owner_connector.execute_action", return_value={"result": {"ok": True}}) as execute:
            second = drain_hosted_lifecycle_requests(self.config, self.FakeWorker(self))
            third = drain_hosted_lifecycle_requests(self.config, self.FakeWorker(self))
        self.assertEqual(second[0]["state"], "completed")
        self.assertEqual(third, [])
        self.assertEqual(execute.call_count, 1)

    def test_hosted_missing_r2_retries_are_bounded_and_blocked(self):
        queued = lifecycle_gateway.queue_hosted_lifecycle_request(
            self.root, operation="waste-basket-x", asset_ids=["asset-1"],
            session_id="session-one", fixture_id="fixture-1", request_key="connector-missing-r2",
            db_path=self.db,
        )
        with patch(
            "scripts.new_owner_connector.execute_action",
            side_effect=RuntimeError("canonical R2 mapping is missing for asset-1"),
        ) as execute:
            drained = [
                drain_hosted_lifecycle_requests(self.config, self.FakeWorker(self))
                for _ in range(lifecycle_gateway.MAX_HOSTED_LIFECYCLE_ATTEMPTS)
            ]
            after_block = drain_hosted_lifecycle_requests(
                self.config, self.FakeWorker(self)
            )

        self.assertEqual(execute.call_count, lifecycle_gateway.MAX_HOSTED_LIFECYCLE_ATTEMPTS)
        self.assertEqual([item[0]["state"] for item in drained], [
            "queued", "queued", "blocked",
        ])
        self.assertEqual(after_block, [])
        status = lifecycle_gateway.hosted_lifecycle_request_status(
            self.root,
            queued["requestId"],
            session_id="session-one",
            fixture_id="fixture-1",
            db_path=self.db,
        )
        self.assertEqual(status["state"], "blocked")
        self.assertEqual(status["disposition"], "blocked")
        self.assertIn("Repair the canonical R2 mapping", status["nextAction"])

    def test_hosted_queue_restart_finishes_committed_outbox_without_remutating(self):
        queued = lifecycle_gateway.queue_hosted_lifecycle_request(
            self.root, operation="waste-basket-x", asset_ids=["asset-1"],
            session_id="session-one", fixture_id="fixture-1", request_key="browser-crash",
            db_path=self.db,
        )
        lifecycle_gateway.claim_hosted_lifecycle_request(self.root, queued["requestId"], self.db)
        operation_id = f"owner-action:hosted-lifecycle:{queued['requestId']}"
        arm = self._persist_local_commit(operation_id)
        worker = self.FakeWorker(self)
        with patch("scripts.new_owner_connector.execute_action") as execute:
            result = drain_hosted_lifecycle_requests(self.config, worker)
        execute.assert_not_called()
        self.assertEqual(result[0]["state"], "completed")
        self.assertEqual([call[0] for call in worker.calls], ["local-commit", "apply", "ack"])
        status = lifecycle_gateway.hosted_lifecycle_request_status(
            self.root, queued["requestId"], session_id="session-one",
            fixture_id="fixture-1", db_path=self.db,
        )
        self.assertEqual(status["result"]["operationId"], operation_id)
        self.assertEqual(
            lifecycle_gateway.deployed_lifecycle_operation_state(
                self.root, arm["operationId"], self.db
            ),
            "locally_acked",
        )


if __name__ == "__main__":
    unittest.main()
