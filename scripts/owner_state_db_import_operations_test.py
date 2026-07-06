import tempfile
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import owner_state_db
import local_server
import sidecar_state_db


class ImportOperationTests(unittest.TestCase):
    def test_record_and_update_import_operation(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            db_path = Path("Owner.sqlite")

            operation = owner_state_db.record_import_operation(
                repo_root,
                {
                    "state": "preflighted",
                    "sourceKind": "apple_photos",
                    "source": {
                        "kind": "apple_photos",
                        "mode": "album",
                        "albumLocalIdentifier": "album-1",
                        "albumName": "Test Album",
                    },
                    "destinationKind": "expo",
                    "destination": {"kind": "expo", "collectionHint": "infer"},
                    "filters": {"skipDiscarded": True},
                    "outputs": {"publicPreview": True, "privateMaster": True},
                    "preflight": {"ok": True, "candidateCount": 3},
                },
                db_path=db_path,
            )

            self.assertTrue(operation["operationId"].startswith("import-"))
            self.assertEqual(operation["state"], "preflighted")
            self.assertEqual(operation["source"]["albumLocalIdentifier"], "album-1")
            self.assertEqual(operation["preflight"]["candidateCount"], 3)

            updated = owner_state_db.update_import_operation(
                repo_root,
                operation["operationId"],
                db_path=db_path,
                state="queued",
                task={"id": "task-1", "kind": "cloud-media-sweep"},
            )

            self.assertEqual(updated["operationId"], operation["operationId"])
            self.assertEqual(updated["state"], "queued")
            self.assertEqual(updated["task"]["id"], "task-1")
            self.assertEqual(updated["preflight"]["candidateCount"], 3)
            self.assertTrue(updated["queuedAt"])

            conn = owner_state_db.connect(repo_root, db_path)
            try:
                count = conn.execute("SELECT count(*) FROM import_operations").fetchone()[0]
            finally:
                conn.close()
            self.assertEqual(count, 1)

    def test_legacy_folder_import_records_operation(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            source_root = repo_root / "legacy-source"
            source_root.mkdir()
            task = {"id": "task-legacy", "operation": "repair", "state": "queued"}

            operation = local_server._record_legacy_folder_import_operation(
                repo_root,
                source_root,
                "auto",
                task,
            )

            self.assertEqual(operation["sourceKind"], "legacy_folder")
            self.assertEqual(operation["destinationKind"], "expo")
            self.assertEqual(operation["source"]["canonicalSource"], "apple_photos")
            self.assertEqual(operation["task"]["id"], "task-legacy")


class AccessUserTests(unittest.TestCase):
    def test_access_user_registry_rows_round_trip(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            db_path = Path("Owner.sqlite")

            user = owner_state_db.upsert_access_user(
                repo_root,
                {
                    "email": "Client@Example.com",
                    "tier": "re-client",
                    "realEstateClients": "corine-real-estate, elie-real-estate",
                    "grantedBy": "ec92009@gmail.com",
                    "notes": "test client",
                },
                db_path=db_path,
            )

            self.assertEqual(user["email"], "client@example.com")
            self.assertEqual(user["tier"], "re_client")
            self.assertEqual(user["realEstateClients"], ["corine-real-estate", "elie-real-estate"])
            self.assertEqual(user["publishStatus"], "pending")
            self.assertEqual(user["kvRecord"]["schema"], "photosbyelie.accessUser.v1")

            synced = owner_state_db.mark_access_user_published(
                repo_root,
                "client@example.com",
                ok=True,
                db_path=db_path,
            )
            self.assertEqual(synced["publishStatus"], "synced")
            self.assertTrue(synced["publishedAt"])

            users = owner_state_db.list_access_users(repo_root, db_path=db_path)
            self.assertEqual(len(users), 1)
            self.assertEqual(users[0]["email"], "client@example.com")

    def test_local_admin_access_user_save_action_without_publish(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            summary = local_server.apply_owner_access_user_action(
                repo_root,
                {
                    "action": "save-user",
                    "user": {
                        "email": "owner@example.com",
                        "tier": "owner",
                    },
                },
            )

            self.assertTrue(summary["ok"])
            self.assertEqual(summary["user"]["email"], "owner@example.com")
            self.assertEqual(summary["counts"]["owners"], 1)
            self.assertEqual(summary["users"][0]["publishStatus"], "pending")


class NewOwnerConnectorTests(unittest.TestCase):
    def test_tailscale_addresses_are_lan_owner_addresses(self):
        self.assertTrue(local_server._is_private_lan_address("100.111.30.109"))
        self.assertFalse(local_server._is_private_lan_address("8.8.8.8"))

    def test_sidecar_culling_connector_returns_read_only_window(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            with sidecar_state_db.connect(repo_root) as conn:
                conn.executemany(
                    """
                    INSERT INTO sidecar_assets (
                      asset_id, source_anchor, media_type, filename, captured_at,
                      photos_title, indexed_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            "asset-1",
                            "apple-photos://asset-1",
                            "photo",
                            "agnes-001.jpg",
                            "2026-07-05T10:00:00Z",
                            "Agnes birthday",
                            "2026-07-05T11:00:00Z",
                            "2026-07-05T11:00:00Z",
                        ),
                        (
                            "asset-2",
                            "apple-photos://asset-2",
                            "video",
                            "agnes-clip.mov",
                            "2026-07-05T09:00:00Z",
                            "",
                            "2026-07-05T11:00:00Z",
                            "2026-07-05T11:00:00Z",
                        ),
                        (
                            "asset-3",
                            "apple-photos://asset-3",
                            "photo",
                            "already-tombstoned.jpg",
                            "2026-07-05T08:00:00Z",
                            "",
                            "2026-07-05T11:00:00Z",
                            "2026-07-05T11:00:00Z",
                        ),
                    ],
                )
                conn.execute(
                    """
                    INSERT INTO sidecar_decisions (
                      asset_id, rating, color, pick_state, metadata_state, title, keywords_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    ("asset-1", 5, "green", "picked", "approved", "Agnes's B'day candle moment", '["birthday"]'),
                )
                conn.execute(
                    """
                    INSERT INTO sidecar_tombstones (
                      asset_id, tombstone_state, reason, tombstoned_at, updated_at
                    ) VALUES (?, 'active', 'fixture', ?, ?)
                    """,
                    ("asset-3", "2026-07-05T12:00:00Z", "2026-07-05T12:00:00Z"),
                )
                conn.commit()

            result = local_server.new_owner_connector_result(
                repo_root,
                {
                    "action": {
                        "id": "owner-action-test",
                        "type": "sidecar-culling-review",
                        "state": "claimed",
                        "claim": {"connectorId": "Max Sidecar"},
                        "payload": {
                            "manifest": {
                                "mode": "review-window",
                                "source": "owner-sqlite",
                                "limit": 2,
                            },
                        },
                    },
                },
            )

            self.assertTrue(result["ok"])
            self.assertTrue(result["result"]["readOnly"])
            self.assertEqual(result["result"]["connectorId"], "max-sidecar")
            self.assertEqual(result["result"]["actionId"], "owner-action-test")
            self.assertEqual(result["result"]["indexedCount"], 3)
            self.assertEqual(result["result"]["candidateCount"], 2)
            self.assertEqual(result["result"]["recordsPrepared"], 2)
            self.assertEqual(result["result"]["sampleItems"][0]["assetId"], "asset-1")
            self.assertEqual(result["result"]["sampleItems"][0]["pickState"], "picked")
            self.assertEqual(result["result"]["reviewWindow"]["source"], "owner-sqlite")

    def test_completed_sidecar_culling_connector_reopens_read_only_window(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            with sidecar_state_db.connect(repo_root) as conn:
                conn.execute(
                    """
                    INSERT INTO sidecar_assets (
                      asset_id, source_anchor, media_type, filename, captured_at,
                      indexed_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "asset-1",
                        "apple-photos://asset-1",
                        "photo",
                        "reopen-001.jpg",
                        "2026-07-05T10:00:00Z",
                        "2026-07-05T11:00:00Z",
                        "2026-07-05T11:00:00Z",
                    ),
                )
                conn.commit()

            result = local_server.new_owner_connector_result(
                repo_root,
                {
                    "action": {
                        "id": "owner-action-completed",
                        "type": "sidecar-culling-review",
                        "state": "completed",
                        "claim": {"connectorId": "Max"},
                        "payload": {"manifest": {"limit": 1}},
                    },
                },
            )

            self.assertTrue(result["ok"])
            self.assertEqual(result["result"]["actionId"], "owner-action-completed")
            self.assertEqual(result["result"]["recordsPrepared"], 1)

    def test_new_owner_sidecar_decision_stages_explicit_pick(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            with sidecar_state_db.connect(repo_root) as conn:
                conn.execute(
                    """
                    INSERT INTO sidecar_assets (
                      asset_id, source_anchor, media_type, filename, captured_at,
                      indexed_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        "asset-1",
                        "apple-photos://asset-1",
                        "photo",
                        "decision-001.jpg",
                        "2026-07-05T10:00:00Z",
                        "2026-07-05T11:00:00Z",
                        "2026-07-05T11:00:00Z",
                    ),
                )
                conn.commit()

            result = local_server.new_owner_sidecar_decision_result(
                repo_root,
                {"assetId": "asset-1", "action": "pick"},
            )

            self.assertTrue(result["ok"])
            self.assertEqual(result["source"], "new-owner-review")
            self.assertEqual(result["state"]["pickState"], "picked")
            self.assertIn("pick_state", result["changedFamilies"])
            self.assertGreaterEqual(result["pendingSyncCount"], 1)
            self.assertEqual(result["summary"]["pendingSyncCount"], 1)


if __name__ == "__main__":
    unittest.main()
