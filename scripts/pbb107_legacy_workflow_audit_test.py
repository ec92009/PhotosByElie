import hashlib
import json
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT / "scripts" / "pbb107_legacy_workflow_audit.py"


class PBB107LegacyWorkflowAuditTest(unittest.TestCase):
    def test_classifies_proven_legacy_shapes_without_writing(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "Owner.sqlite"
            connection = sqlite3.connect(database)
            connection.executescript(
                """
                CREATE TABLE photos_sync_runs (
                    run_id TEXT PRIMARY KEY, status TEXT, stage TEXT,
                    scanned_count INTEGER, worker_pid INTEGER,
                    worker_token TEXT, lease_expires_at TEXT,
                    recovery_state TEXT
                );
                CREATE TABLE sidecar_upload_bridge_runs (
                    run_id TEXT PRIMARY KEY, status TEXT, worker_pid INTEGER,
                    worker_token TEXT, lease_expires_at TEXT,
                    recovery_state TEXT
                );
                CREATE TABLE sidecar_upload_bridge_run_items (
                    run_id TEXT, status TEXT, export_status TEXT,
                    upload_status TEXT, export_bytes INTEGER,
                    upload_keys_json TEXT
                );
                INSERT INTO photos_sync_runs VALUES
                    ('queued', 'running', 'Queued', 0, 0, '', NULL, 'needs-review'),
                    ('reading', 'running', 'Reading Apple Photos metadata', 0, 0, '', NULL, 'needs-review'),
                    ('unknown', 'running', 'Queued', 1, 0, '', NULL, 'needs-review');
                INSERT INTO sidecar_upload_bridge_runs VALUES
                    ('untouched', 'running', 0, '', NULL, 'needs-review'),
                    ('partial', 'running', 0, '', NULL, 'needs-review');
                INSERT INTO sidecar_upload_bridge_run_items VALUES
                    ('untouched', 'planned', 'planned', 'not_requested', NULL, '[]'),
                    ('partial', 'uploaded', 'materialized', 'uploaded', 100, '["object"]'),
                    ('partial', 'planned', 'planned', 'not_requested', NULL, '[]');
                """
            )
            connection.commit()
            connection.close()
            before = hashlib.sha256(database.read_bytes()).hexdigest()

            result = subprocess.run(
                ["python3", str(AUDIT), "--database", str(database)],
                check=True,
                capture_output=True,
                text=True,
            )
            report = json.loads(result.stdout)

            self.assertEqual(report["mode"], "read-only")
            self.assertFalse(report["containsRowIdentifiers"])
            self.assertFalse(report["mutationPerformed"])
            self.assertEqual(report["manualReviewRequired"], 1)
            self.assertEqual(
                report["photosSync"]["classes"]["cancelledBeforeScan"]["count"],
                1,
            )
            self.assertEqual(
                report["photosSync"]["classes"]["interruptedBeforeCheckpoint"]["count"],
                1,
            )
            self.assertEqual(
                report["uploadBridge"]["classes"]["cancelledBeforeExport"]["count"],
                1,
            )
            self.assertEqual(
                report["uploadBridge"]["classes"]["interruptedPartial"]["count"],
                1,
            )
            self.assertEqual(before, hashlib.sha256(database.read_bytes()).hexdigest())
            self.assertEqual(list(Path(temporary).iterdir()), [database])

    def test_strict_mode_rejects_an_unproven_shape(self):
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "Owner.sqlite"
            connection = sqlite3.connect(database)
            connection.executescript(
                """
                CREATE TABLE photos_sync_runs (
                    run_id TEXT PRIMARY KEY, status TEXT, stage TEXT,
                    scanned_count INTEGER, worker_pid INTEGER,
                    worker_token TEXT, lease_expires_at TEXT,
                    recovery_state TEXT
                );
                CREATE TABLE sidecar_upload_bridge_runs (
                    run_id TEXT PRIMARY KEY, status TEXT, worker_pid INTEGER,
                    worker_token TEXT, lease_expires_at TEXT,
                    recovery_state TEXT
                );
                CREATE TABLE sidecar_upload_bridge_run_items (
                    run_id TEXT, status TEXT, export_status TEXT,
                    upload_status TEXT, export_bytes INTEGER,
                    upload_keys_json TEXT
                );
                INSERT INTO photos_sync_runs VALUES
                    ('unproven', 'running', 'Scanning', 5, 0, '', NULL, 'needs-review');
                """
            )
            connection.commit()
            connection.close()

            result = subprocess.run(
                [
                    "python3",
                    str(AUDIT),
                    "--database",
                    str(database),
                    "--strict",
                ],
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 2)
            self.assertEqual(json.loads(result.stdout)["manualReviewRequired"], 1)


if __name__ == "__main__":
    unittest.main()
