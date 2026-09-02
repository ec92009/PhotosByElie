#!/usr/bin/env python3
from __future__ import annotations

import hashlib
from pathlib import Path
import tempfile
import unittest

try:
    from sidecar_state_db import _materialize_external_edit_return, connect
except ModuleNotFoundError:
    from scripts.sidecar_state_db import _materialize_external_edit_return, connect


class ExternalEditMaterializationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="pbb-external-edit-")
        self.root = Path(self.temporary.name)
        self.source = self.root / "accepted" / "developed.tif"
        self.source.parent.mkdir(parents=True)
        self.source.write_bytes(b"developed pixels")
        checksum = hashlib.sha256(self.source.read_bytes()).hexdigest()
        with connect(self.root) as connection:
            connection.executescript(
                """
                CREATE TABLE asset_source_versions (
                  version_id TEXT PRIMARY KEY,
                  asset_id TEXT NOT NULL,
                  source_exists INTEGER NOT NULL,
                  state TEXT NOT NULL,
                  created_at TEXT NOT NULL
                );
                CREATE TABLE external_edit_returns (
                  return_id TEXT PRIMARY KEY,
                  job_id TEXT NOT NULL,
                  destination_asset_id TEXT NOT NULL,
                  source_version_id TEXT NOT NULL,
                  file_path TEXT NOT NULL,
                  checksum_sha256 TEXT NOT NULL,
                  byte_count INTEGER NOT NULL,
                  created_at TEXT NOT NULL
                );
                CREATE TABLE asset_delivery_state (
                  asset_id TEXT PRIMARY KEY,
                  source_version_hash TEXT NOT NULL
                );
                """
            )
            connection.execute(
                "INSERT INTO asset_source_versions VALUES (?, ?, 1, 'candidate', ?)",
                ("version-1", "asset-1", "2026-09-02T00:00:00Z"),
            )
            connection.execute(
                "UPDATE asset_source_versions SET state = 'approved' WHERE version_id = 'version-1'"
            )
            connection.execute(
                "INSERT INTO asset_delivery_state VALUES ('asset-1', 'version-1')"
            )
            connection.execute(
                "INSERT INTO external_edit_returns VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    "return-1",
                    "job-1",
                    "asset-1",
                    "version-1",
                    str(self.source),
                    checksum,
                    self.source.stat().st_size,
                    "2026-09-02T00:00:00Z",
                ),
            )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_latest_accepted_rendition_materializes_without_photos(self) -> None:
        result = _materialize_external_edit_return(
            self.root,
            asset_id="asset-1",
            destination=self.root / "spool",
        )
        self.assertIsNotNone(result)
        item = result["items"][0]
        self.assertEqual(result["mode"], "materialize-external-edit")
        self.assertEqual(item["sourceVersionId"], "version-1")
        self.assertEqual(Path(item["path"]).read_bytes(), b"developed pixels")

    def test_changed_accepted_rendition_fails_closed(self) -> None:
        self.source.write_bytes(b"tampered")
        with self.assertRaisesRegex(RuntimeError, "checksum|size"):
            _materialize_external_edit_return(
                self.root,
                asset_id="asset-1",
                destination=self.root / "spool",
            )

    def test_unapproved_or_mismatched_rendition_is_not_materialized(self) -> None:
        with connect(self.root) as connection:
            connection.execute(
                "UPDATE asset_delivery_state SET source_version_hash = 'different-version' WHERE asset_id = 'asset-1'"
            )
        self.assertIsNone(
            _materialize_external_edit_return(
                self.root,
                asset_id="asset-1",
                destination=self.root / "spool",
            )
        )


if __name__ == "__main__":
    unittest.main()
