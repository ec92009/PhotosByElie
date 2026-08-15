import hashlib
import json
import plistlib
import sqlite3
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
    def test_fixture_pool_scope_limits_the_existing_index_window(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            sidecar_state_db.upsert_assets(repo_root, [
                {"localIdentifier": "scope-a", "filename": "A.JPG", "mediaType": "photo"},
                {"localIdentifier": "scope-b", "filename": "B.JPG", "mediaType": "photo"},
            ])
            payload = sidecar_state_db.indexed_library_window(repo_root, asset_ids=["scope-b"], include_summary=False)
            self.assertEqual(payload["scopeAssetCount"], 1)
            self.assertEqual([item["localIdentifier"] for item in payload["items"]], ["scope-b"])

    def test_context_managed_connection_is_closed_after_use(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            with sidecar_state_db.connect(repo_root) as conn:
                conn.execute("SELECT 1").fetchone()

            with self.assertRaises(sqlite3.ProgrammingError):
                conn.execute("SELECT 1")

    def test_schema_is_initialized_once_per_database_file(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            with patch.object(sidecar_state_db, "ensure_schema", wraps=sidecar_state_db.ensure_schema) as ensure:
                with sidecar_state_db.connect(repo_root):
                    pass
                with sidecar_state_db.connect(repo_root):
                    pass

            self.assertEqual(ensure.call_count, 1)

    def test_batch_decisions_share_one_database_connection(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            rows = [
                {
                    "assetId": f"cloud-{index}",
                    "sourceAnchor": f"apple-photos://cloud-{index}",
                    "mediaType": "photo",
                    "filename": f"Photo {index}.jpg",
                }
                for index in range(1, 4)
            ]
            sidecar_state_db.upsert_assets(repo_root, rows)
            decisions = [
                {"assetId": f"cloud-{index}", "action": "pick"}
                for index in range(1, 4)
            ]

            with patch.object(sidecar_state_db, "connect", wraps=sidecar_state_db.connect) as open_connection:
                result = sidecar_state_db.record_decisions(repo_root, decisions)

            self.assertEqual(result["count"], 3)
            self.assertEqual(open_connection.call_count, 1)

    def test_large_r2_plan_lookup_uses_indexed_staging_table(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            with sidecar_state_db.connect(repo_root) as conn:
                conn.execute(
                    """
                    CREATE TABLE r2_objects (
                      bucket TEXT NOT NULL,
                      object_key TEXT NOT NULL,
                      photo_id TEXT,
                      object_kind TEXT,
                      lifecycle_state TEXT NOT NULL,
                      bytes INTEGER,
                      last_seen_at TEXT,
                      PRIMARY KEY (bucket, object_key)
                    ) WITHOUT ROWID
                    """
                )
                conn.executemany(
                    """
                    INSERT INTO r2_objects
                      (bucket, object_key, photo_id, object_kind, lifecycle_state, bytes, last_seen_at)
                    VALUES (?, ?, ?, 'public-preview', ?, 10, '2026-07-14T00:00:00Z')
                    """,
                    [
                        ("public", f"preview-{index}", f"photo-{index}", "current" if index == 1777 else "deleted_confirmed")
                        for index in range(2500)
                    ],
                )
                planned_keys = [
                    {"bucket": "public", "key": f"preview-{index}"}
                    for index in range(2500)
                ]
                result = sidecar_state_db._current_r2_objects_for_plan(conn, planned_keys)

            self.assertEqual(set(result), {("public", "preview-1777")})

    def test_deleted_r2_object_is_not_resurrected_by_historical_upload_ledger(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            sidecar_state_db.upsert_assets(
                repo_root,
                [{
                    "assetId": "asset-1",
                    "sourceAnchor": "apple-photos://asset-1",
                    "mediaType": "photo",
                    "filename": "Photo.jpg",
                }],
            )
            with sidecar_state_db.connect(repo_root) as conn:
                conn.execute(
                    """
                    CREATE TABLE r2_objects (
                      bucket TEXT NOT NULL,
                      object_key TEXT NOT NULL,
                      photo_id TEXT,
                      object_kind TEXT,
                      lifecycle_state TEXT NOT NULL,
                      bytes INTEGER,
                      last_seen_at TEXT,
                      PRIMARY KEY (bucket, object_key)
                    ) WITHOUT ROWID
                    """
                )
                conn.execute(
                    """
                    INSERT INTO r2_objects
                      (bucket, object_key, photo_id, object_kind, lifecycle_state, bytes, last_seen_at)
                    VALUES ('public', 'preview-deleted', 'photo-1', 'public-preview',
                            'deleted_confirmed', 10, '2026-07-28T00:00:00Z')
                    """
                )
                conn.execute(
                    """
                    INSERT INTO sidecar_upload_bridge_runs
                      (run_id, mode, status, execute_upload, limit_count, started_at,
                       completed_at, spool_root, summary_json, created_at, updated_at)
                    VALUES ('old-run', 'execute-batch', 'completed', 1, 1, '', '', '', '{}', '', '')
                    """
                )
                conn.execute(
                    """
                    INSERT INTO sidecar_upload_bridge_run_items
                      (run_item_id, run_id, asset_id, photo_id, filename, media_type,
                       upload_keys_json, status, export_status, upload_status,
                       created_at, updated_at)
                    VALUES (
                      'old-item', 'old-run', 'asset-1', 'photo-1', 'Photo.jpg', 'photo',
                      '[{"bucket":"public","key":"preview-deleted","kind":"public-preview","status":"uploaded","bytes":10}]',
                      'uploaded', 'exported', 'uploaded', '', ''
                    )
                    """
                )
                result = sidecar_state_db._current_r2_objects_for_plan(
                    conn,
                    [{"bucket": "public", "key": "preview-deleted"}],
                )

            self.assertEqual(result, {})

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
            with sidecar_state_db.connect(repo_root) as connection:
                now = sidecar_state_db.now_iso()
                connection.execute(
                    """
                    INSERT INTO sidecar_tombstones (
                      asset_id, tombstone_state, reason, tombstoned_at, updated_at
                    ) VALUES ('cloud-1', 'active', 'gateway fixture', ?, ?)
                    """,
                    (now, now),
                )

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

    def test_mock_upload_queues_one_current_identity_for_one_photos_item(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            local_id = "0042A239-9AEA-46EE-BA3A-ED3EE17D0332/L0/001"
            cloud_id = "0042A239-9AEA-46EE-BA3A-ED3EE17D0332:001:cloud"
            sidecar_state_db.upsert_assets(repo_root, [
                {
                    "assetId": local_id,
                    "localIdentifier": local_id,
                    "sourceAnchor": f"apple-photos://{local_id}",
                    "mediaType": "photo",
                    "filename": "Legacy.JPG",
                    "creationDate": "2026-01-01T10:00:00Z",
                    "locationLabel": "Spain",
                },
                {
                    "assetId": cloud_id,
                    "cloudIdentifier": cloud_id,
                    "localIdentifier": local_id,
                    "sourceAnchor": f"apple-photos://{cloud_id}",
                    "mediaType": "photo",
                    "filename": "Current.JPG",
                    "creationDate": "2026-01-01T10:00:00Z",
                    "locationLabel": "Spain",
                },
            ])
            sidecar_state_db.record_decision(repo_root, {
                "assetId": local_id,
                "action": "approve",
                "title": "Alicante coast",
                "keywords": ["Spain"],
            })
            sidecar_state_db.record_decision(repo_root, {
                "assetId": cloud_id,
                "action": "approve",
                "title": "Alicante coast",
                "keywords": ["Spain"],
            })
            with sidecar_state_db.connect(repo_root) as conn:
                conn.execute(
                    "UPDATE sidecar_assets SET missing_at = '2026-07-20T00:00:00Z' WHERE asset_id = ?",
                    (local_id,),
                )
                conn.commit()

            payload = sidecar_state_db.mock_upload(repo_root, limit=20)

            self.assertEqual(payload["mockUploadedCount"], 1)
            self.assertEqual(payload["bridgeQueuedCount"], 1)
            self.assertEqual([item["assetId"] for item in payload["items"]], [cloud_id])


class PhotosBridgeLaunchTest(unittest.TestCase):
    @staticmethod
    def write_bundle_info(app: Path, identifier: str, version: str, build: str) -> None:
        info = app / "Contents" / "Info.plist"
        info.parent.mkdir(parents=True, exist_ok=True)
        with info.open("wb") as handle:
            plistlib.dump(
                {
                    "CFBundleIdentifier": identifier,
                    "CFBundleShortVersionString": version,
                    "CFBundleVersion": build,
                },
                handle,
            )

    def test_helper_rebuilds_when_source_fingerprint_is_missing_or_stale(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            bridge_app = repo_root / "PhotosByElie Photos Bridge.app"
            backstage_app = repo_root / "PhotosByElie Backstage.app"
            source = repo_root / sidecar_server.APPLE_PHOTOS_BRIDGE
            installer = repo_root / sidecar_server.APPLE_PHOTOS_BRIDGE_APP_INSTALLER
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text("current bridge source", encoding="utf-8")
            installer.write_text("#!/bin/zsh\n", encoding="utf-8")

            with patch.object(
                sidecar_server,
                "APPLE_PHOTOS_BRIDGE_APP",
                bridge_app,
            ), patch.object(
                sidecar_server,
                "BACKSTAGE_APP",
                backstage_app,
            ), patch.object(
                sidecar_server,
                "APPLE_PHOTOS_BRIDGE_APP_EXECUTABLE",
                repo_root / "installed-helper",
            ), patch.object(
                sidecar_server,
                "APPLE_PHOTOS_BRIDGE_APP_SOURCE_FINGERPRINT",
                repo_root / "BridgeSource.sha256",
            ), patch.object(sidecar_server.subprocess, "run") as install:
                (repo_root / "installed-helper").write_text("binary", encoding="utf-8")
                (repo_root / "BridgeSource.sha256").write_text("stale", encoding="utf-8")
                install.return_value = subprocess.CompletedProcess([], 0, "", "")

                sidecar_server._ensure_apple_photos_bridge_app(repo_root)

            install.assert_called_once()

    def test_helper_is_reused_when_source_fingerprint_matches(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            bridge_app = repo_root / "PhotosByElie Photos Bridge.app"
            backstage_app = repo_root / "PhotosByElie Backstage.app"
            source = repo_root / sidecar_server.APPLE_PHOTOS_BRIDGE
            installer = repo_root / sidecar_server.APPLE_PHOTOS_BRIDGE_APP_INSTALLER
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text("current bridge source", encoding="utf-8")
            installer.write_text("#!/bin/zsh\n", encoding="utf-8")
            fingerprint = hashlib.sha256(source.read_bytes()).hexdigest()

            with patch.object(
                sidecar_server,
                "APPLE_PHOTOS_BRIDGE_APP",
                bridge_app,
            ), patch.object(
                sidecar_server,
                "BACKSTAGE_APP",
                backstage_app,
            ), patch.object(
                sidecar_server,
                "APPLE_PHOTOS_BRIDGE_APP_EXECUTABLE",
                repo_root / "installed-helper",
            ), patch.object(
                sidecar_server,
                "APPLE_PHOTOS_BRIDGE_APP_SOURCE_FINGERPRINT",
                repo_root / "BridgeSource.sha256",
            ), patch.object(sidecar_server.subprocess, "run") as install:
                (repo_root / "installed-helper").write_text("binary", encoding="utf-8")
                (repo_root / "BridgeSource.sha256").write_text(fingerprint, encoding="utf-8")

                sidecar_server._ensure_apple_photos_bridge_app(repo_root)

            install.assert_not_called()

    def test_matching_release_is_not_rebuilt_by_a_stale_connector_source(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            bridge_app = repo_root / "PhotosByElie Photos Bridge.app"
            backstage_app = repo_root / "PhotosByElie Backstage.app"
            executable = bridge_app / "Contents" / "MacOS" / "PhotosByElie Photos Bridge"
            fingerprint = bridge_app / "Contents" / "Resources" / "BridgeSource.sha256"
            source = repo_root / sidecar_server.APPLE_PHOTOS_BRIDGE
            installer = repo_root / sidecar_server.APPLE_PHOTOS_BRIDGE_APP_INSTALLER
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text("stale connector bridge source", encoding="utf-8")
            installer.write_text("#!/bin/zsh\n", encoding="utf-8")
            executable.parent.mkdir(parents=True, exist_ok=True)
            executable.write_text("binary", encoding="utf-8")
            fingerprint.parent.mkdir(parents=True, exist_ok=True)
            fingerprint.write_text("different", encoding="utf-8")
            self.write_bundle_info(bridge_app, "com.photosbyelie.photos-bridge", "226.0", "88")
            self.write_bundle_info(backstage_app, "com.photosbyelie.backstage", "226.0", "88")

            with patch.object(sidecar_server, "APPLE_PHOTOS_BRIDGE_APP", bridge_app), \
                 patch.object(sidecar_server, "BACKSTAGE_APP", backstage_app), \
                 patch.object(sidecar_server, "APPLE_PHOTOS_BRIDGE_APP_EXECUTABLE", executable), \
                 patch.object(sidecar_server, "APPLE_PHOTOS_BRIDGE_APP_SOURCE_FINGERPRINT", fingerprint), \
                 patch.object(sidecar_server.subprocess, "run") as install:
                sidecar_server._ensure_apple_photos_bridge_app(repo_root)

            install.assert_not_called()

    def test_older_helper_is_rebuilt_for_the_installed_backstage_release(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            bridge_app = repo_root / "PhotosByElie Photos Bridge.app"
            backstage_app = repo_root / "PhotosByElie Backstage.app"
            executable = bridge_app / "Contents" / "MacOS" / "PhotosByElie Photos Bridge"
            fingerprint = bridge_app / "Contents" / "Resources" / "BridgeSource.sha256"
            source = repo_root / sidecar_server.APPLE_PHOTOS_BRIDGE
            installer = repo_root / sidecar_server.APPLE_PHOTOS_BRIDGE_APP_INSTALLER
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text("current bridge source", encoding="utf-8")
            installer.write_text("#!/bin/zsh\n", encoding="utf-8")
            executable.parent.mkdir(parents=True, exist_ok=True)
            executable.write_text("binary", encoding="utf-8")
            fingerprint.parent.mkdir(parents=True, exist_ok=True)
            fingerprint.write_text("different", encoding="utf-8")
            self.write_bundle_info(bridge_app, "com.photosbyelie.photos-bridge", "141.10", "1")
            self.write_bundle_info(backstage_app, "com.photosbyelie.backstage", "226.0", "88")

            with patch.object(sidecar_server, "APPLE_PHOTOS_BRIDGE_APP", bridge_app), \
                 patch.object(sidecar_server, "BACKSTAGE_APP", backstage_app), \
                 patch.object(sidecar_server, "APPLE_PHOTOS_BRIDGE_APP_EXECUTABLE", executable), \
                 patch.object(sidecar_server, "APPLE_PHOTOS_BRIDGE_APP_SOURCE_FINGERPRINT", fingerprint), \
                 patch.object(sidecar_server.subprocess, "run") as install:
                install.return_value = subprocess.CompletedProcess([], 0, "", "")
                sidecar_server._ensure_apple_photos_bridge_app(repo_root)

            install.assert_called_once()

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

    def test_empty_bounded_index_is_a_valid_zero_item_result(self):
        commands = []

        def launch(command, **_kwargs):
            commands.append(command)
            destination = Path(command[command.index("--destination") + 1])
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.touch()
            return subprocess.CompletedProcess(command, 0, "", "")

        with tempfile.TemporaryDirectory() as temp_dir, \
             patch.object(sidecar_server, "_ensure_apple_photos_bridge_app"), \
             patch.object(sidecar_server, "_bridge_busy_response", return_value=None), \
             patch.object(sidecar_server, "_write_bridge_busy"), \
             patch.object(sidecar_server, "_clear_bridge_busy"), \
             patch.object(sidecar_server.subprocess, "run", side_effect=launch):
            destination = Path(temp_dir) / "empty-index.jsonl"
            payload = sidecar_server._run_apple_photos_bridge_app_index(
                Path(temp_dir),
                ["library-index-file", "--destination", str(destination), "--date-from", "2030-01-01"],
                destination,
                timeout=1,
            )

        self.assertEqual(payload["count"], 0)
        self.assertIn("--date-from", commands[0])


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


class CloudDecisionOverlayTest(unittest.TestCase):
    def test_local_pending_writeback_count_survives_cloud_overlay(self):
        payload = {
            "items": [{
                "assetId": "cloud-1",
                "sidecarState": {"metadataState": "unreviewed"},
                "pendingSyncCount": 3,
            }],
        }
        cloud_state = {
            "cloud-1": {
                "assetId": "cloud-1",
                "metadataState": "approved",
                "pendingSyncCount": 0,
            },
        }
        with patch.object(sidecar_server, "_sidecar_cloud_enabled", return_value=True), \
             patch.object(sidecar_server, "_query_cloud_decisions", return_value=cloud_state), \
             patch.object(sidecar_server, "mirror_cloud_decisions"):
            result = sidecar_server._overlay_cloud_decisions(Path("/tmp/sidecar-overlay-test"), payload)

        self.assertEqual(result["items"][0]["sidecarState"]["metadataState"], "approved")
        self.assertEqual(result["items"][0]["sidecarState"]["pendingSyncCount"], 3)
        self.assertEqual(result["items"][0]["pendingSyncCount"], 3)

    def test_single_decision_does_not_wait_for_redundant_cloud_upsert(self):
        cloud_calls = []
        response = {}
        handler = type("HandlerStub", (), {})()
        handler._is_loopback_request = lambda: True
        handler._read_json_body = lambda: {"assetId": "cloud-1", "action": "approve"}
        handler._include_summary = lambda _payload: False
        handler._send_json = lambda status, payload: response.update({"status": status, "payload": payload})

        def cloud_request(method, path, payload=None, timeout=30):
            cloud_calls.append((method, path, payload, timeout))
            return {
                "ok": True,
                "assetId": "cloud-1",
                "state": {"assetId": "cloud-1", "metadataState": "approved"},
                "before": {"assetId": "cloud-1", "metadataState": "unreviewed"},
                "changedFamilies": ["metadata", "pick_state"],
            }

        with patch.object(sidecar_server, "_sidecar_cloud_enabled", return_value=True), \
             patch.object(sidecar_server, "_sidecar_cloud_request", side_effect=cloud_request), \
             patch.object(sidecar_server, "record_decision", return_value={"pendingSyncCount": 2}), \
             patch.object(sidecar_server, "mirror_cloud_decisions"), \
             patch.object(sidecar_server, "_invalidate_summary_cache"):
            sidecar_server.SidecarHandler._handle_decision(handler)

        self.assertEqual(response["status"], 200)
        self.assertEqual([call[1] for call in cloud_calls], ["/api/v1/sidecar/decisions/apply"])

    def test_batch_decisions_do_not_wait_for_redundant_cloud_upsert(self):
        cloud_calls = []
        response = {}
        decisions = [
            {"assetId": "cloud-1", "action": "approve"},
            {"assetId": "cloud-2", "action": "approve"},
        ]
        handler = type("HandlerStub", (), {})()
        handler._is_loopback_request = lambda: True
        handler._read_json_body = lambda: {"decisions": decisions}
        handler._include_summary = lambda _payload: False
        handler._send_json = lambda status, payload: response.update({"status": status, "payload": payload})

        def cloud_request(method, path, payload=None, timeout=30):
            cloud_calls.append((method, path, payload, timeout))
            return {
                "ok": True,
                "items": [{
                    "assetId": decision["assetId"],
                    "state": {"assetId": decision["assetId"], "metadataState": "approved"},
                    "before": {"assetId": decision["assetId"], "metadataState": "unreviewed"},
                    "changedFamilies": ["metadata", "pick_state"],
                } for decision in decisions],
            }

        local_result = {
            "items": [{"assetId": decision["assetId"], "pendingSyncCount": 2} for decision in decisions],
        }
        with patch.object(sidecar_server, "_sidecar_cloud_enabled", return_value=True), \
             patch.object(sidecar_server, "_sidecar_cloud_request", side_effect=cloud_request), \
             patch.object(sidecar_server, "record_decisions", return_value=local_result), \
             patch.object(sidecar_server, "mirror_cloud_decisions"), \
             patch.object(sidecar_server, "_invalidate_summary_cache"):
            sidecar_server.SidecarHandler._handle_decisions(handler)

        self.assertEqual(response["status"], 200)
        self.assertEqual([call[1] for call in cloud_calls], ["/api/v1/sidecar/decisions/apply-batch"])


if __name__ == "__main__":
    unittest.main()
