import hashlib
import importlib.util
import shutil
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "pbb107_legacy_workflow_rehearsal.py"
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("pbb107_rehearsal", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _seed(path: Path, *, include_unproven: bool = False) -> None:
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE photos_sync_runs (
            run_id TEXT PRIMARY KEY, status TEXT, stage TEXT,
            scanned_count INTEGER, error_text TEXT, completed_at TEXT,
            updated_at TEXT, worker_pid INTEGER, worker_token TEXT,
            lease_expires_at TEXT, recovery_state TEXT,
            recovery_reason TEXT, recovery_checked_at TEXT
        );
        CREATE TABLE sidecar_upload_bridge_runs (
            run_id TEXT PRIMARY KEY, status TEXT, error_text TEXT,
            completed_at TEXT, updated_at TEXT, worker_pid INTEGER,
            worker_token TEXT, lease_expires_at TEXT, recovery_state TEXT,
            recovery_reason TEXT, recovery_checked_at TEXT
        );
        CREATE TABLE sidecar_upload_bridge_run_items (
            run_item_id TEXT PRIMARY KEY, run_id TEXT, status TEXT,
            export_status TEXT, upload_status TEXT, export_bytes INTEGER,
            upload_keys_json TEXT
        );
        INSERT INTO photos_sync_runs VALUES
            ('queued', 'running', 'Queued', 0, '', NULL, 'old', 0, '', NULL,
             'needs-review', '', NULL),
            ('reading', 'running', 'Reading Apple Photos metadata', 0, '', NULL,
             'old', 0, '', NULL, 'needs-review', '', NULL);
        INSERT INTO sidecar_upload_bridge_runs VALUES
            ('untouched', 'running', '', NULL, 'old', 0, '', NULL,
             'needs-review', '', NULL),
            ('partial', 'running', '', NULL, 'old', 0, '', NULL,
             'needs-review', '', NULL);
        INSERT INTO sidecar_upload_bridge_run_items VALUES
            ('u1', 'untouched', 'planned', 'planned', 'not_requested', 0, '[]'),
            ('p1', 'partial', 'uploaded', 'materialized', 'uploaded', 100,
             '["durable-object"]'),
            ('p2', 'partial', 'planned', 'planned', 'not_requested', 0, '[]');
        """
    )
    if include_unproven:
        connection.execute(
            """
            INSERT INTO photos_sync_runs VALUES
                ('unproven', 'running', 'Scanning', 4, '', NULL, 'old', 0, '',
                 NULL, 'needs-review', '', NULL)
            """
        )
    connection.commit()
    connection.close()


class PBB107LegacyWorkflowRehearsalTest(unittest.TestCase):
    def test_rehearses_all_proven_shapes_on_copy_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "Owner.sqlite"
            copied = Path(temporary) / "Owner.rehearsal.sqlite"
            _seed(source)
            shutil.copy2(source, copied)
            source_before = _sha256(source)

            report = MODULE.rehearse(
                source,
                copied,
                timestamp="2026-08-25T20:00:00Z",
            )

            self.assertEqual(source_before, _sha256(source))
            self.assertTrue(report["canonicalDatabaseUnchanged"])
            self.assertEqual(report["photosSync"]["cancelledBeforeScan"], 1)
            self.assertEqual(report["photosSync"]["failedBeforeCheckpoint"], 1)
            self.assertEqual(report["uploadBridge"]["cancelledBeforeExport"], 1)
            self.assertEqual(report["uploadBridge"]["interruptedPartial"], 1)
            self.assertTrue(report["uploadBridge"]["allItemRowsValueEquivalent"])
            self.assertEqual(report["uploadBridge"]["uploadedItemsPreserved"], 1)

            connection = sqlite3.connect(copied)
            photo_statuses = dict(
                connection.execute("SELECT run_id, status FROM photos_sync_runs")
            )
            upload_statuses = dict(
                connection.execute(
                    "SELECT run_id, status FROM sidecar_upload_bridge_runs"
                )
            )
            items = connection.execute(
                """
                SELECT run_item_id, status, upload_keys_json
                FROM sidecar_upload_bridge_run_items ORDER BY run_item_id
                """
            ).fetchall()
            connection.close()
            self.assertEqual(photo_statuses, {"queued": "cancelled", "reading": "failed"})
            self.assertEqual(
                upload_statuses,
                {"untouched": "cancelled", "partial": "interrupted"},
            )
            self.assertEqual(
                items,
                [
                    ("p1", "uploaded", '["durable-object"]'),
                    ("p2", "planned", "[]"),
                    ("u1", "planned", "[]"),
                ],
            )

    def test_unproven_shape_rolls_back_every_copy_update(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "Owner.sqlite"
            copied = Path(temporary) / "Owner.rehearsal.sqlite"
            _seed(source, include_unproven=True)
            shutil.copy2(source, copied)
            copied_before = _sha256(copied)

            with self.assertRaisesRegex(RuntimeError, "unproven"):
                MODULE.rehearse(source, copied)

            self.assertEqual(copied_before, _sha256(copied))
            connection = sqlite3.connect(copied)
            running = connection.execute(
                "SELECT COUNT(*) FROM photos_sync_runs WHERE status = 'running'"
            ).fetchone()[0]
            connection.close()
            self.assertEqual(running, 3)

    def test_refuses_the_source_database_as_the_rehearsal_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "Owner.sqlite"
            _seed(source)
            with self.assertRaisesRegex(ValueError, "distinct copied file"):
                MODULE.rehearse(source, source)


if __name__ == "__main__":
    unittest.main()
