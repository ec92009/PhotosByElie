import importlib.util
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))
REHEARSAL_TEST_SPEC = importlib.util.spec_from_file_location(
    "pbb107_rehearsal_test_helpers",
    SCRIPTS / "pbb107_legacy_workflow_rehearsal_test.py",
)
REHEARSAL_TEST_MODULE = importlib.util.module_from_spec(REHEARSAL_TEST_SPEC)
assert REHEARSAL_TEST_SPEC.loader is not None
REHEARSAL_TEST_SPEC.loader.exec_module(REHEARSAL_TEST_MODULE)
APPLY_SPEC = importlib.util.spec_from_file_location(
    "pbb107_apply", SCRIPTS / "pbb107_legacy_workflow_apply.py"
)
APPLY_MODULE = importlib.util.module_from_spec(APPLY_SPEC)
assert APPLY_SPEC.loader is not None
APPLY_SPEC.loader.exec_module(APPLY_MODULE)


def _logical_snapshot(path: Path) -> str:
    connection = sqlite3.connect(path)
    try:
        self_check = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if self_check != "ok":
            raise AssertionError(f"SQLite integrity check failed: {self_check}")
        return "\n".join(connection.iterdump())
    finally:
        connection.close()


class PBB107LegacyWorkflowApplyTest(unittest.TestCase):
    def test_creates_verified_backup_then_applies_the_rehearsed_transaction(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "Owner.sqlite"
            backup = Path(temporary) / "backups" / "Owner-before-pbb107.sqlite"
            REHEARSAL_TEST_MODULE._seed(database)
            original_snapshot = _logical_snapshot(database)

            report = APPLY_MODULE.apply_canonical(
                database,
                backup,
                timestamp="2026-08-25T20:00:00Z",
            )

            self.assertTrue(report["canonicalMutationPerformed"])
            self.assertEqual(report["rollbackBackupIntegrity"], "ok")
            self.assertNotEqual(original_snapshot, _logical_snapshot(database))
            self.assertEqual(original_snapshot, _logical_snapshot(backup))
            connection = sqlite3.connect(database)
            statuses = dict(
                connection.execute("SELECT run_id, status FROM photos_sync_runs")
            )
            item_rows = connection.execute(
                """
                SELECT run_item_id, status, upload_keys_json
                FROM sidecar_upload_bridge_run_items ORDER BY run_item_id
                """
            ).fetchall()
            connection.close()
            self.assertEqual(statuses, {"queued": "cancelled", "reading": "failed"})
            self.assertEqual(
                item_rows,
                [
                    ("p1", "uploaded", '["durable-object"]'),
                    ("p2", "planned", "[]"),
                    ("u1", "planned", "[]"),
                ],
            )

    def test_unproven_shape_rolls_back_canonical_database(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "Owner.sqlite"
            backup = Path(temporary) / "Owner-before-pbb107.sqlite"
            REHEARSAL_TEST_MODULE._seed(database, include_unproven=True)
            original_snapshot = _logical_snapshot(database)

            with self.assertRaisesRegex(RuntimeError, "unproven"):
                APPLY_MODULE.apply_canonical(database, backup)

            self.assertEqual(original_snapshot, _logical_snapshot(database))
            self.assertTrue(backup.exists())
            self.assertEqual(original_snapshot, _logical_snapshot(backup))

    def test_refuses_to_overwrite_an_existing_backup(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "Owner.sqlite"
            backup = Path(temporary) / "existing.sqlite"
            REHEARSAL_TEST_MODULE._seed(database)
            backup.write_text("keep", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "already exists"):
                APPLY_MODULE.apply_canonical(database, backup)
            self.assertEqual(backup.read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main()
