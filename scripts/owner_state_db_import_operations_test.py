import tempfile
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import owner_state_db
import local_server


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


if __name__ == "__main__":
    unittest.main()
