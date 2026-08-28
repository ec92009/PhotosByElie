#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from scripts.migrate_owner_catalog_reconciliation import (
    APPROVED_POLICY,
    apply_reviewed_plan,
    build_plan,
)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class OwnerCatalogMigrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.owner = root / "Owner.sqlite"
        self.catalog = root / "production.sqlite"
        self.backup = root / "Owner-before.sqlite"
        self._create_owner()
        self._create_catalog()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _create_owner(self) -> None:
        with closing(sqlite3.connect(self.owner)) as conn:
            conn.executescript(
                """
                CREATE TABLE sidecar_assets (asset_id TEXT PRIMARY KEY);
                CREATE TABLE owner_asset_identity_aliases (
                  legacy_asset_id TEXT PRIMARY KEY,
                  canonical_asset_id TEXT NOT NULL
                );
                CREATE TABLE sidecar_upload_bridge_run_items (
                  photo_id TEXT NOT NULL,
                  asset_id TEXT NOT NULL,
                  editorial_version_hash TEXT NOT NULL DEFAULT ''
                );
                CREATE TABLE country_assignments (
                  media_id TEXT,
                  asset_id TEXT,
                  identity_status TEXT NOT NULL
                );
                CREATE TABLE public_catalog_publications (
                  asset_id TEXT NOT NULL,
                  source_version_hash TEXT NOT NULL,
                  media_id TEXT NOT NULL,
                  state TEXT NOT NULL,
                  public_url TEXT NOT NULL DEFAULT '',
                  catalog_sha256 TEXT NOT NULL DEFAULT '',
                  error_text TEXT NOT NULL DEFAULT '',
                  created_at TEXT NOT NULL,
                  verified_at TEXT,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY (asset_id, source_version_hash)
                );
                """
            )
            conn.executemany(
                "INSERT INTO sidecar_assets VALUES (?)",
                [("asset-current",), ("asset-stale",), ("asset-new",)],
            )
            conn.executemany(
                "INSERT INTO sidecar_upload_bridge_run_items VALUES (?, ?, ?)",
                [
                    ("media-current", "asset-stale", "hash-stale"),
                    ("media-new", "asset-new", "hash-new"),
                ],
            )
            conn.execute(
                """
                INSERT INTO public_catalog_publications VALUES (
                  'asset-current', 'hash-current', 'media-current', 'live',
                  'https://example.test/catalog.sqlite', 'old-catalog-sha', '',
                  '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z',
                  '2026-01-02T00:00:00Z'
                )
                """
            )
            conn.commit()

    def _create_catalog(self) -> None:
        with closing(sqlite3.connect(self.catalog)) as conn:
            conn.execute("CREATE TABLE media_items (media_id TEXT PRIMARY KEY) WITHOUT ROWID")
            conn.executemany(
                "INSERT INTO media_items VALUES (?)",
                [("media-current",), ("media-new",), ("media-unresolved",)],
            )
            conn.commit()

    def _plan(self) -> dict:
        return build_plan(
            owner_db=self.owner.resolve(),
            production_catalog=self.catalog.resolve(),
            generated_at="2026-08-28T10:00:00Z",
        )

    def _apply(self, report: dict, **overrides: object) -> dict:
        options = {
            "owner_db": self.owner.resolve(),
            "production_catalog": self.catalog.resolve(),
            "report": report,
            "backup_path": self.backup.resolve(),
            "allow_unresolved": True,
            "approved_policy": APPROVED_POLICY,
            "applied_at": "2026-08-28T10:01:00Z",
        }
        options.update(overrides)
        return apply_reviewed_plan(**options)

    def test_build_plan_is_deterministic_and_read_only(self) -> None:
        before = {path: digest(path) for path in (self.owner, self.catalog)}
        first = self._plan()
        second = self._plan()
        self.assertEqual(first["planHash"], second["planHash"])
        self.assertEqual(
            first["summary"],
            {
                "productionCount": 3,
                "authoritativeCount": 1,
                "backfillCount": 1,
                "unresolvedCount": 1,
                "conflictCount": 0,
                "historicalReceiptDisagreementCount": 1,
            },
        )
        self.assertEqual(before, {path: digest(path) for path in before})

    def test_apply_preserves_authority_backfills_and_replays_as_noop(self) -> None:
        report = self._plan()
        with closing(sqlite3.connect(self.owner)) as conn:
            before = tuple(
                conn.execute(
                    "SELECT * FROM public_catalog_publications WHERE media_id = 'media-current'"
                ).fetchone()
            )

        first = self._apply(report)
        self.assertTrue(first["applied"])
        self.assertFalse(first["noOp"])
        self.assertTrue(self.backup.is_file())

        with closing(sqlite3.connect(self.owner)) as conn:
            after = tuple(
                conn.execute(
                    "SELECT * FROM public_catalog_publications WHERE media_id = 'media-current'"
                ).fetchone()
            )
            self.assertEqual(before, after)
            backfill = conn.execute(
                """
                SELECT asset_id, source_version_hash, state, catalog_sha256
                FROM public_catalog_publications WHERE media_id = 'media-new'
                """
            ).fetchone()
            self.assertEqual(
                tuple(backfill),
                ("asset-new", "hash-new", "live", report["source"]["productionCatalogSha256"]),
            )
            self.assertEqual(
                conn.execute("SELECT count(*) FROM owner_catalog_reconciliation_rows").fetchone()[0],
                3,
            )
            self.assertEqual(
                conn.execute(
                    """
                    SELECT count(*) FROM owner_catalog_reconciliation_rows
                    WHERE migration_state = 'unresolved' AND asset_id IS NULL
                    """
                ).fetchone()[0],
                1,
            )

        second = self._apply(report)
        self.assertFalse(second["applied"])
        self.assertTrue(second["noOp"])

    def test_unresolved_rows_require_explicit_acknowledgement(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "--allow-unresolved"):
            self._apply(self._plan(), allow_unresolved=False)
        self.assertFalse(self.backup.exists())

    def test_policy_identifier_is_required(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "--approved-policy PBE-173"):
            self._apply(self._plan(), approved_policy="")
        self.assertFalse(self.backup.exists())

    def test_owner_change_after_review_is_rejected(self) -> None:
        report = self._plan()
        with closing(sqlite3.connect(self.owner)) as conn:
            conn.execute("INSERT INTO sidecar_assets VALUES ('asset-after-review')")
            conn.commit()
        with self.assertRaisesRegex(RuntimeError, "Owner.sqlite changed"):
            self._apply(report)
        self.assertFalse(self.backup.exists())

    def test_conflicting_receipts_are_fail_closed(self) -> None:
        with closing(sqlite3.connect(self.owner)) as conn:
            conn.execute(
                "INSERT INTO sidecar_upload_bridge_run_items VALUES ('media-new', 'asset-stale', 'hash-stale')"
            )
            conn.commit()
        report = self._plan()
        self.assertEqual(report["summary"]["conflictCount"], 1)
        with self.assertRaisesRegex(RuntimeError, "contains conflicts"):
            self._apply(report)
        self.assertFalse(self.backup.exists())

    def test_transaction_rolls_back_after_injected_failure(self) -> None:
        report = self._plan()
        with self.assertRaisesRegex(RuntimeError, "injected reconciliation failure"):
            self._apply(report, fail_after_publications=1)
        with closing(sqlite3.connect(self.owner)) as conn:
            self.assertEqual(
                conn.execute(
                    "SELECT count(*) FROM public_catalog_publications WHERE media_id = 'media-new'"
                ).fetchone()[0],
                0,
            )
            self.assertIsNone(
                conn.execute(
                    """
                    SELECT 1 FROM sqlite_master
                    WHERE type = 'table' AND name = 'owner_catalog_reconciliation_migrations'
                    """
                ).fetchone()
            )
            self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")


if __name__ == "__main__":
    unittest.main()
