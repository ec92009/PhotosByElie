from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

from scripts import migrate_sidecar_tombstones_to_cloud as migration


class RetiredSidecarTombstoneMigrationTests(unittest.TestCase):
    def test_apply_exits_before_inputs_or_any_writer_can_run(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = root / "report.json"
            with (
                patch.object(sys, "argv", [
                    "migrate_sidecar_tombstones_to_cloud.py",
                    "--apply",
                    "--owner-db", str(root / "missing.sqlite"),
                    "--mapping", str(root / "missing.jsonl"),
                    "--report", str(report),
                ]),
                patch.object(migration, "load_mapping") as load_mapping,
                patch.object(migration, "migration_plan") as migration_plan,
                redirect_stderr(StringIO()),
            ):
                with self.assertRaises(SystemExit) as caught:
                    migration.main()

            self.assertEqual(caught.exception.code, 2)
            load_mapping.assert_not_called()
            migration_plan.assert_not_called()
            self.assertFalse(report.exists())

    def test_inventory_is_read_only_and_contains_no_sidecar_writer_path(self) -> None:
        source = Path(migration.__file__).read_text(encoding="utf-8")
        self.assertNotIn("_sidecar_cloud_request", source)
        self.assertNotIn("/api/v1/sidecar/decisions/apply-batch", source)
        self.assertNotIn("mirror_cloud_decisions", source)
        self.assertFalse(hasattr(migration, "apply_migration"))

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            owner_db = root / "Owner.sqlite"
            mapping_path = root / "mapping.jsonl"
            report = root / "report.json"
            with sqlite3.connect(owner_db) as connection:
                connection.executescript(
                    """
                    CREATE TABLE sidecar_assets (
                      asset_id TEXT PRIMARY KEY,
                      missing_at TEXT
                    );
                    CREATE TABLE sidecar_tombstones (
                      asset_id TEXT PRIMARY KEY,
                      reason TEXT,
                      tombstoned_at TEXT,
                      tombstone_state TEXT
                    );
                    INSERT INTO sidecar_assets VALUES ('legacy-local-id', '2026-08-01T00:00:00Z');
                    INSERT INTO sidecar_assets VALUES ('cloud:current-id', NULL);
                    INSERT INTO sidecar_tombstones VALUES (
                      'legacy-local-id', 'legacy inventory', '2026-07-01T00:00:00Z', 'active'
                    );
                    """
                )
            mapping_path.write_text(json.dumps({
                "ok": True,
                "localIdentifier": "legacy-local-id",
                "cloudIdentifier": "cloud:current-id",
            }) + "\n", encoding="utf-8")

            with (
                patch.object(sys, "argv", [
                    "migrate_sidecar_tombstones_to_cloud.py",
                    "--owner-db", str(owner_db),
                    "--mapping", str(mapping_path),
                    "--report", str(report),
                ]),
                redirect_stdout(StringIO()),
            ):
                self.assertEqual(migration.main(), 0)

            payload = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(payload["mode"], "inventory-only")
            self.assertEqual(payload["mappedCount"], 1)
            self.assertEqual(payload["currentIndexTargetCount"], 1)
            with sqlite3.connect(owner_db) as connection:
                self.assertEqual(
                    connection.execute(
                        "SELECT tombstone_state FROM sidecar_tombstones WHERE asset_id = 'legacy-local-id'"
                    ).fetchone(),
                    ("active",),
                )


if __name__ == "__main__":
    unittest.main()
