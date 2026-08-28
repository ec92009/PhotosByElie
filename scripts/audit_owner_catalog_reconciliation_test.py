#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from scripts.audit_owner_catalog_reconciliation import reconcile_catalogs


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class OwnerCatalogReconciliationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.owner = root / "Owner.sqlite"
        self.production = root / "production.sqlite"
        self.candidate = root / "candidate.sqlite"

        with closing(sqlite3.connect(self.owner)) as conn:
            conn.execute(
                """
                CREATE TABLE public_catalog_publications (
                  asset_id TEXT NOT NULL,
                  source_version_hash TEXT NOT NULL,
                  media_id TEXT NOT NULL,
                  state TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY (asset_id, source_version_hash)
                )
                """
            )
            conn.executemany(
                "INSERT INTO public_catalog_publications VALUES (?, ?, ?, ?, ?)",
                [
                    ("asset-a", "v1", "legacy-mapped", "local", "2026-01-01"),
                    ("asset-new", "v1", "candidate-new", "local", "2026-01-02"),
                    ("asset-failed", "v1", "absent", "failed", "2026-01-03"),
                    ("asset-failed", "v2", "absent", "local", "2026-01-04"),
                ],
            )
            conn.execute(
                "CREATE TABLE sidecar_upload_bridge_run_items (asset_id TEXT, photo_id TEXT)"
            )
            conn.executemany(
                "INSERT INTO sidecar_upload_bridge_run_items VALUES (?, ?)",
                [
                    ("asset-old", "legacy-mapped"),
                    ("asset-b", "legacy-bridge"),
                    ("asset-new", "candidate-new"),
                ],
            )
            conn.execute(
                "CREATE TABLE country_assignments (asset_id TEXT, media_id TEXT, identity_status TEXT)"
            )
            conn.execute(
                "CREATE TABLE owner_asset_identity_aliases (legacy_asset_id TEXT, canonical_asset_id TEXT)"
            )
            conn.commit()

        self._catalog(self.production, ["legacy-mapped", "legacy-bridge", "legacy-unresolved"])
        self._catalog(
            self.candidate,
            ["legacy-mapped", "legacy-bridge", "legacy-unresolved", "candidate-new"],
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    @staticmethod
    def _catalog(path: Path, media_ids: list[str]) -> None:
        with closing(sqlite3.connect(path)) as conn:
            conn.execute("CREATE TABLE media_items (media_id TEXT PRIMARY KEY) WITHOUT ROWID")
            conn.executemany("INSERT INTO media_items VALUES (?)", [(value,) for value in media_ids])
            conn.commit()

    def test_reports_aggregate_reconciliation_without_mutating_inputs(self) -> None:
        before = {path: digest(path) for path in (self.owner, self.production, self.candidate)}
        report = reconcile_catalogs(
            owner_db=self.owner.resolve(),
            production_catalog=self.production.resolve(),
            candidate_catalog=self.candidate.resolve(),
        )

        self.assertTrue(report["readOnly"])
        self.assertEqual(report["verdict"], "review-required")
        self.assertEqual(report["production"]["rows"], 3)
        self.assertEqual(report["candidate"]["rows"], 4)
        self.assertEqual(report["ownerAuthority"]["publicationRows"], 4)
        self.assertEqual(report["ownerAuthority"]["distinctMediaIds"], 3)
        self.assertEqual(report["ownerAuthority"]["latestStateCounts"], {"local": 3})
        self.assertEqual(
            report["reconciliation"],
            {
                "commonRows": 3,
                "productionOnlyRows": 0,
                "candidateOnlyRows": 1,
                "productionMappedInOwnerLedger": 1,
                "productionUnmappedLegacyRows": 2,
                "productionApprovedUnresolvedRows": 0,
                "productionUnapprovedUnresolvedRows": 2,
                "productionMappedByLatestState": {"local": 1},
                "productionWithExactDurableOwnerAsset": 2,
                "productionWithConflictingDurableOwnerAssets": 0,
                "productionWithoutDurableOwnerAsset": 1,
                "productionHistoricalReceiptDisagreements": 1,
                "unmappedLegacyWithExactDurableOwnerAsset": 1,
                "unmappedLegacyWithConflictingDurableOwnerAssets": 0,
                "unmappedLegacyWithoutDurableOwnerAsset": 1,
                "candidateOnlyMappedInOwnerLedger": 1,
                "candidateOnlyUnmappedRows": 0,
                "candidateOnlyMappedByLatestState": {"local": 1},
                "candidateWithExactDurableOwnerAsset": 3,
                "candidateWithConflictingDurableOwnerAssets": 0,
                "candidateWithoutDurableOwnerAsset": 1,
                "candidateHistoricalReceiptDisagreements": 1,
                "ownerLedgerMediaAbsentFromBothCatalogs": 1,
                "ownerLedgerAbsentByLatestState": {"local": 1},
            },
        )
        self.assertNotIn("legacy-mapped", str(report))
        self.assertNotIn("candidate-new", str(report))
        self.assertEqual(before, {path: digest(path) for path in before})

    def test_approved_unresolved_receipts_clear_the_policy_gate(self) -> None:
        with closing(sqlite3.connect(self.owner)) as conn:
            conn.executescript(
                """
                CREATE TABLE owner_catalog_reconciliation_migrations (
                  migration_id TEXT PRIMARY KEY,
                  plan_hash TEXT,
                  approved_policy TEXT,
                  production_count INTEGER,
                  authoritative_count INTEGER,
                  backfilled_count INTEGER,
                  unresolved_count INTEGER,
                  disagreement_count INTEGER,
                  applied_at TEXT
                );
                CREATE TABLE owner_catalog_reconciliation_rows (
                  migration_id TEXT,
                  media_id TEXT,
                  migration_state TEXT
                );
                INSERT INTO owner_catalog_reconciliation_migrations VALUES (
                  'migration-1', 'plan-1', 'PBE-173', 3, 1, 1, 1, 1,
                  '2026-08-28T10:00:00Z'
                );
                INSERT INTO owner_catalog_reconciliation_rows VALUES (
                  'migration-1', 'legacy-unresolved', 'unresolved'
                );
                """
            )
            conn.execute(
                """
                INSERT INTO public_catalog_publications VALUES (
                  'asset-b', 'v1', 'legacy-bridge', 'live', '2026-01-05'
                )
                """
            )
            conn.commit()

        report = reconcile_catalogs(
            owner_db=self.owner.resolve(),
            production_catalog=self.production.resolve(),
            candidate_catalog=self.candidate.resolve(),
        )
        self.assertEqual(report["verdict"], "ready-with-approved-exceptions")
        self.assertEqual(report["reconciliation"]["productionApprovedUnresolvedRows"], 1)
        self.assertEqual(report["reconciliation"]["productionUnapprovedUnresolvedRows"], 0)
        self.assertIn("approved unresolved", report["nextGate"])

    def test_rejects_relative_owner_path(self) -> None:
        with self.assertRaisesRegex(ValueError, "Owner authority path must be absolute"):
            reconcile_catalogs(
                owner_db=Path("Owner.sqlite"),
                production_catalog=self.production.resolve(),
                candidate_catalog=self.candidate.resolve(),
            )

    def test_rejects_uncheckpointed_owner_wal(self) -> None:
        Path(f"{self.owner}-wal").write_bytes(b"pending")
        with self.assertRaisesRegex(ValueError, "uncheckpointed WAL"):
            reconcile_catalogs(
                owner_db=self.owner.resolve(),
                production_catalog=self.production.resolve(),
                candidate_catalog=self.candidate.resolve(),
            )

    def test_rejects_catalog_without_media_items(self) -> None:
        broken = Path(self.temp.name) / "broken.sqlite"
        with closing(sqlite3.connect(broken)) as conn:
            conn.execute("CREATE TABLE unrelated (value TEXT)")
            conn.commit()
        with self.assertRaisesRegex(ValueError, "missing required table media_items"):
            reconcile_catalogs(
                owner_db=self.owner.resolve(),
                production_catalog=broken.resolve(),
                candidate_catalog=self.candidate.resolve(),
            )


if __name__ == "__main__":
    unittest.main()
