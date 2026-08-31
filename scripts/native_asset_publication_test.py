import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fixture_pipeline
from native_asset_publication import (
    claim_upload_run_start,
    reconcile_upload_run_receipts,
    record_upload_run_failure,
    reset_upload_run_for_retry,
    retry_sqlite_lock,
    verified_covered_r2_results,
)


class NativeAssetPublicationTest(unittest.TestCase):
    def test_reconciliation_uses_exact_terminal_receipts_not_age(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "Owner.sqlite"
            conn = sqlite3.connect(database)
            conn.executescript(
                """
                CREATE TABLE asset_upload_runs (
                  run_id TEXT PRIMARY KEY, status TEXT, requested_count INTEGER,
                  processed_count INTEGER, live_count INTEGER, failed_count INTEGER,
                  remaining_count INTEGER, cancel_requested INTEGER, concurrency INTEGER,
                  last_error TEXT, started_at TEXT, completed_at TEXT,
                  created_at TEXT, updated_at TEXT
                );
                CREATE TABLE asset_upload_run_items (
                  run_id TEXT, asset_id TEXT, status TEXT,
                  source_version_hash TEXT, object_keys_json TEXT, error_text TEXT,
                  started_at TEXT, completed_at TEXT, updated_at TEXT
                );
                CREATE TABLE public_catalog_publications (
                  asset_id TEXT, source_version_hash TEXT, state TEXT
                );
                INSERT INTO asset_upload_runs VALUES (
                  'run-zero', 'queued', 0, 0, 0, 0, 0, 0, 1,
                  '', NULL, NULL, 'old', 'old'
                );
                INSERT INTO asset_upload_runs VALUES (
                  'run-locked', 'queued', 1, 0, 0, 0, 1, 0, 1,
                  '', NULL, NULL, 'new', 'new'
                );
                INSERT INTO asset_upload_run_items VALUES (
                  'run-locked', 'asset-1', 'queued', '', '[]', '',
                  NULL, NULL, 'new'
                );
                """
            )
            conn.commit()
            conn.close()
            log_root = root / ".review-logs" / "native-publication-runs"
            log_root.mkdir(parents=True)
            (log_root / "run-locked.log").write_text(
                json.dumps({
                    "ok": False,
                    "runId": "run-locked",
                    "error": "database is locked",
                }) + "\n",
                encoding="utf-8",
            )

            def open_database(_repo_root):
                connection = sqlite3.connect(database)
                connection.row_factory = sqlite3.Row
                return connection

            with (
                patch("native_asset_publication.connect_owner", side_effect=open_database),
                patch("native_publication_pipeline.connect", side_effect=open_database),
            ):
                report = reconcile_upload_run_receipts(root)

            conn = sqlite3.connect(database)
            rows = dict(conn.execute(
                "SELECT run_id, status FROM asset_upload_runs ORDER BY run_id"
            ).fetchall())
            locked_error = conn.execute(
                "SELECT last_error FROM asset_upload_runs WHERE run_id = 'run-locked'"
            ).fetchone()[0]
            conn.close()

        self.assertEqual(report["completedZeroRunIds"], ["run-zero"])
        self.assertEqual(report["failedReceiptRunIds"], ["run-locked"])
        self.assertEqual(report["needsReviewCount"], 0)
        self.assertEqual(report["latestFailedRun"]["runId"], "run-locked")
        self.assertEqual(rows, {"run-locked": "failed", "run-zero": "completed"})
        self.assertEqual(locked_error, "database is locked")

    def test_upload_start_claim_is_single_flight_and_retry_reuses_same_run(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "Owner.sqlite"
            conn = sqlite3.connect(database)
            conn.executescript(
                """
                CREATE TABLE asset_upload_runs (
                  run_id TEXT PRIMARY KEY,
                  status TEXT CHECK (status IN (
                    'queued', 'running', 'completed', 'completed-with-errors',
                    'cancelled', 'failed'
                  )),
                  last_error TEXT,
                  completed_at TEXT, updated_at TEXT
                );
                INSERT INTO asset_upload_runs VALUES (
                  'run-1', 'queued', '', NULL, ''
                );
                """
            )
            conn.commit()
            conn.close()

            def open_database(_repo_root):
                connection = sqlite3.connect(database)
                connection.row_factory = sqlite3.Row
                return connection

            with patch("native_asset_publication.connect_owner", side_effect=open_database):
                first = claim_upload_run_start(Path(directory), "run-1")
                duplicate = claim_upload_run_start(Path(directory), "run-1")
                conn = sqlite3.connect(database)
                conn.execute(
                    "UPDATE asset_upload_runs SET status = 'failed', last_error = 'busy'"
                )
                conn.commit()
                conn.close()
                retry = claim_upload_run_start(
                    Path(directory),
                    "run-1",
                    retry_failed=True,
                )

            conn = sqlite3.connect(database)
            count, status = conn.execute(
                "SELECT count(*), max(status) FROM asset_upload_runs"
            ).fetchone()
            conn.close()

        self.assertTrue(first["claimed"])
        self.assertTrue(duplicate["attached"])
        self.assertTrue(retry["claimed"])
        self.assertEqual((count, status), (1, "running"))

    def test_terminal_runner_failure_is_durable_and_same_run_becomes_retryable(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "Owner.sqlite"
            conn = sqlite3.connect(database)
            conn.executescript(
                """
                CREATE TABLE asset_upload_runs (
                  run_id TEXT PRIMARY KEY, status TEXT, processed_count INTEGER,
                  live_count INTEGER, failed_count INTEGER, remaining_count INTEGER,
                  last_error TEXT, completed_at TEXT, updated_at TEXT
                );
                CREATE TABLE asset_upload_run_items (
                  run_id TEXT, asset_id TEXT, status TEXT,
                  source_version_hash TEXT, object_keys_json TEXT, error_text TEXT,
                  started_at TEXT, completed_at TEXT, updated_at TEXT
                );
                CREATE TABLE asset_delivery_state (
                  asset_id TEXT PRIMARY KEY, delivery_state TEXT,
                  last_error TEXT, updated_at TEXT
                );
                INSERT INTO asset_upload_runs VALUES (
                  'run-1', 'running', 0, 0, 0, 2, '', NULL, ''
                );
                INSERT INTO asset_upload_run_items VALUES (
                  'run-1', 'asset-1', 'queued', '', '[]', '', NULL, NULL, ''
                );
                INSERT INTO asset_upload_run_items VALUES (
                  'run-1', 'asset-2', 'queued', '', '[]', '', NULL, NULL, ''
                );
                INSERT INTO asset_delivery_state VALUES (
                  'asset-1', 'needs-upload', '', ''
                );
                INSERT INTO asset_delivery_state VALUES (
                  'asset-2', 'needs-upload', '', ''
                );
                """
            )
            conn.commit()
            conn.close()

            def open_database(_repo_root):
                connection = sqlite3.connect(database)
                connection.row_factory = sqlite3.Row
                return connection

            with patch("native_asset_publication.connect_owner", side_effect=open_database):
                failure = record_upload_run_failure(
                    Path(directory),
                    "run-1",
                    "database is locked",
                )
                claim_upload_run_start(
                    Path(directory),
                    "run-1",
                    retry_failed=True,
                )
                reset = reset_upload_run_for_retry(Path(directory), "run-1")

            conn = sqlite3.connect(database)
            run = conn.execute(
                "SELECT status, remaining_count, last_error FROM asset_upload_runs"
            ).fetchone()
            run_count = conn.execute("SELECT count(*) FROM asset_upload_runs").fetchone()[0]
            conn.close()

        self.assertTrue(failure["recorded"])
        self.assertEqual(reset["resetCount"], 0)
        self.assertEqual(run, ("running", 2, ""))
        self.assertEqual(run_count, 1)

    def test_fixture_schema_initialization_runs_once_per_database_inode(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "Owner.sqlite"
            sqlite3.connect(database).close()

            def open_database(_repo_root, _db_path=None):
                connection = sqlite3.connect(database)
                connection.row_factory = sqlite3.Row
                return connection

            fixture_pipeline._SCHEMA_READY.clear()
            with (
                patch("fixture_pipeline.connect_owner", side_effect=open_database),
                patch("fixture_pipeline.ensure_schema") as ensure_schema,
            ):
                first = fixture_pipeline.connect(Path(directory), database)
                second = fixture_pipeline.connect(Path(directory), database)
                first.close()
                second.close()

            fixture_pipeline._SCHEMA_READY.clear()

        self.assertEqual(ensure_schema.call_count, 1)

    def test_retries_owner_database_lock_then_returns_result(self):
        attempts = 0

        def operation():
            nonlocal attempts
            attempts += 1
            if attempts < 3:
                raise sqlite3.OperationalError("database is locked")
            return {"ok": True}

        self.assertEqual(
            retry_sqlite_lock(operation, delays=(0, 0)),
            {"ok": True},
        )
        self.assertEqual(attempts, 3)

    def test_does_not_retry_unrelated_sqlite_error(self):
        attempts = 0

        def operation():
            nonlocal attempts
            attempts += 1
            raise sqlite3.OperationalError("no such table")

        with self.assertRaisesRegex(sqlite3.OperationalError, "no such table"):
            retry_sqlite_lock(operation, delays=(0, 0))
        self.assertEqual(attempts, 1)

    def test_raises_after_lock_retry_budget_is_exhausted(self):
        attempts = 0

        def operation():
            nonlocal attempts
            attempts += 1
            raise sqlite3.OperationalError("database is locked")

        with self.assertRaisesRegex(sqlite3.OperationalError, "database is locked"):
            retry_sqlite_lock(operation, delays=(0, 0))
        self.assertEqual(attempts, 3)

    def test_recovers_exact_current_r2_objects_from_verified_receipts(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "Owner.sqlite"
            conn = sqlite3.connect(database)
            conn.executescript(
                """
                CREATE TABLE r2_objects (
                  bucket TEXT, object_key TEXT, lifecycle_state TEXT, bytes INTEGER
                );
                CREATE TABLE fixture_delivery_receipts (
                  receipt_id TEXT, asset_id TEXT, destination TEXT, status TEXT,
                  object_key TEXT, checksum_sha256 TEXT, verification_json TEXT,
                  verified_at TEXT, updated_at TEXT
                );
                """
            )
            conn.execute(
                "INSERT INTO r2_objects VALUES ('photosbyelie-public', 'media/a.jpg', 'current', 12)"
            )
            conn.execute(
                """
                INSERT INTO fixture_delivery_receipts VALUES (
                  'receipt-1', 'asset-1', 'r2', 'verified', 'media/a.jpg',
                  ?, ?, '2026-07-28T00:00:00Z', '2026-07-28T00:00:00Z'
                )
                """,
                ("a" * 64, json.dumps({"bucket": "photosbyelie-public", "bytes": 12})),
            )
            conn.commit()
            conn.close()

            def open_database(_repo_root):
                connection = sqlite3.connect(database)
                connection.row_factory = sqlite3.Row
                return connection

            with (
                patch("native_asset_publication.connect_owner", side_effect=open_database),
                patch("native_asset_publication._upload_bridge_rows", return_value=[{"asset_id": "asset-1"}]),
                patch(
                    "native_asset_publication._planned_r2_keys",
                    return_value=(
                        "photo-1",
                        [
                            {
                                "bucket": "photosbyelie-public",
                                "key": "media/a.jpg",
                                "kind": "public-preview",
                            }
                        ],
                    ),
                ),
            ):
                result = verified_covered_r2_results(Path(directory), "asset-1")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["key"], "media/a.jpg")
        self.assertEqual(result[0]["verificationMethod"], "existing-verified-receipt")
        self.assertEqual(result[0]["remoteChecksumSha256"], "a" * 64)

    def test_reset_upload_run_requeues_failed_and_interrupted_items(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "Owner.sqlite"
            conn = sqlite3.connect(database)
            conn.executescript(
                """
                CREATE TABLE asset_upload_runs (
                  run_id TEXT PRIMARY KEY, status TEXT, processed_count INTEGER,
                  live_count INTEGER, failed_count INTEGER, remaining_count INTEGER,
                  last_error TEXT, completed_at TEXT, updated_at TEXT
                );
                CREATE TABLE asset_upload_run_items (
                  run_id TEXT, asset_id TEXT, status TEXT,
                  source_version_hash TEXT, object_keys_json TEXT, error_text TEXT,
                  started_at TEXT, completed_at TEXT, updated_at TEXT
                );
                CREATE TABLE asset_delivery_state (
                  asset_id TEXT PRIMARY KEY, delivery_state TEXT,
                  last_error TEXT, updated_at TEXT
                );
                INSERT INTO asset_upload_runs VALUES (
                  'run-1', 'running', 1, 0, 1, 1, 'failed', NULL, ''
                );
                INSERT INTO asset_upload_run_items VALUES (
                  'run-1', 'asset-1', 'failed', '', '[]', 'covered',
                  'started', 'done', ''
                );
                INSERT INTO asset_upload_run_items VALUES (
                  'run-1', 'asset-2', 'uploading', '', '[]', '',
                  'started', NULL, ''
                );
                INSERT INTO asset_delivery_state VALUES (
                  'asset-1', 'failed', 'covered', ''
                );
                INSERT INTO asset_delivery_state VALUES (
                  'asset-2', 'uploading', '', ''
                );
                """
            )
            conn.commit()
            conn.close()

            def open_database(_repo_root):
                connection = sqlite3.connect(database)
                connection.row_factory = sqlite3.Row
                return connection

            with patch("native_asset_publication.connect_owner", side_effect=open_database):
                result = reset_upload_run_for_retry(Path(directory), "run-1")

            conn = sqlite3.connect(database)
            statuses = conn.execute(
                "SELECT status FROM asset_upload_run_items ORDER BY asset_id"
            ).fetchall()
            run = conn.execute(
                "SELECT status, processed_count, failed_count, remaining_count FROM asset_upload_runs"
            ).fetchone()
            delivery = conn.execute(
                "SELECT delivery_state FROM asset_delivery_state WHERE asset_id = 'asset-1'"
            ).fetchone()
            conn.close()

        self.assertEqual(result["resetCount"], 2)
        self.assertEqual(statuses, [("queued",), ("queued",)])
        self.assertEqual(run, ("running", 0, 0, 2))
        self.assertEqual(delivery, ("needs-upload",))

    def test_reset_upload_run_leaves_completed_run_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "Owner.sqlite"
            conn = sqlite3.connect(database)
            conn.executescript(
                """
                CREATE TABLE asset_upload_runs (
                  run_id TEXT PRIMARY KEY, status TEXT, processed_count INTEGER,
                  live_count INTEGER, failed_count INTEGER, remaining_count INTEGER,
                  last_error TEXT, completed_at TEXT, updated_at TEXT
                );
                CREATE TABLE asset_upload_run_items (
                  run_id TEXT, asset_id TEXT, status TEXT,
                  source_version_hash TEXT, object_keys_json TEXT, error_text TEXT,
                  started_at TEXT, completed_at TEXT, updated_at TEXT
                );
                CREATE TABLE asset_delivery_state (
                  asset_id TEXT PRIMARY KEY, delivery_state TEXT,
                  last_error TEXT, updated_at TEXT
                );
                INSERT INTO asset_upload_runs VALUES (
                  'run-1', 'completed', 1, 1, 0, 0, '', 'done', 'done'
                );
                INSERT INTO asset_upload_run_items VALUES (
                  'run-1', 'asset-1', 'live', 'version', '["key"]', '',
                  'started', 'done', 'done'
                );
                INSERT INTO asset_delivery_state VALUES (
                  'asset-1', 'live', '', 'done'
                );
                """
            )
            conn.commit()
            conn.close()

            def open_database(_repo_root):
                connection = sqlite3.connect(database)
                connection.row_factory = sqlite3.Row
                return connection

            with patch("native_asset_publication.connect_owner", side_effect=open_database):
                result = reset_upload_run_for_retry(Path(directory), "run-1")

            conn = sqlite3.connect(database)
            run = conn.execute(
                "SELECT status, processed_count, live_count, remaining_count FROM asset_upload_runs"
            ).fetchone()
            conn.close()

        self.assertEqual(result["resetCount"], 0)
        self.assertEqual(run, ("completed", 1, 1, 0))


if __name__ == "__main__":
    unittest.main()
