#!/usr/bin/env python3

from __future__ import annotations

import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from country_assignment_identity_migration import (  # noqa: E402
    apply_reviewed_migration,
    build_report,
    validate_report,
)
from export_photos_data import country_assignments_from_owner_index  # noqa: E402
from owner_state_db import (  # noqa: E402
    export_country_assignments,
    import_country_assignments,
    record_country_assignments,
)


def create_owner_db(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE owner_settings (
          setting_key TEXT PRIMARY KEY,
          setting_value TEXT NOT NULL,
          updated_at TEXT
        ) WITHOUT ROWID;
        CREATE TABLE country_assignments (
          media_id TEXT PRIMARY KEY,
          country_slug TEXT NOT NULL,
          source_slug TEXT,
          batch_id TEXT,
          assigned_at TEXT,
          updated_at TEXT
        ) WITHOUT ROWID;
        CREATE INDEX idx_country_assignments_country
          ON country_assignments(country_slug, media_id);
        CREATE INDEX idx_country_assignments_batch
          ON country_assignments(batch_id);
        CREATE TABLE sidecar_assets (
          asset_id TEXT PRIMARY KEY,
          filename TEXT
        ) WITHOUT ROWID;
        CREATE TABLE public_catalog_publications (
          asset_id TEXT NOT NULL,
          source_version_hash TEXT NOT NULL,
          media_id TEXT NOT NULL,
          state TEXT NOT NULL,
          PRIMARY KEY (asset_id, source_version_hash)
        ) WITHOUT ROWID;
        """
    )
    conn.commit()
    conn.close()


def create_catalog(path: Path, media_ids: list[str]) -> None:
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE media_items (media_id TEXT PRIMARY KEY) WITHOUT ROWID")
    conn.executemany("INSERT INTO media_items VALUES (?)", [(media_id,) for media_id in media_ids])
    conn.commit()
    conn.close()


def write_legacy_index(path: Path, assignments: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "format": "photosbyelie-country-assignments",
                "photos": {
                    media_id: {
                        "gallery_key": country,
                        "from_slug": "unknown",
                        "batch_id": "batch-1",
                        "assigned_at": "2026-05-08T10:00:00Z",
                    }
                    for media_id, country in assignments.items()
                },
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


class CountryIdentityReportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.owner_db = self.root / "Owner.sqlite"
        self.catalog_db = self.root / "catalog.sqlite"
        self.legacy_index = self.root / "country-assignments.json"
        self.reviewed_map = self.root / "reviewed-map.json"
        create_owner_db(self.owner_db)
        create_catalog(
            self.catalog_db,
            ["native-1", "legacy-pub", "legacy-unmapped"],
        )
        write_legacy_index(
            self.legacy_index,
            {
                "native-1": "spain",
                "legacy-pub": "france",
                "legacy-reviewed": "usa",
                "legacy-unmapped": "portugal",
                "legacy-filename": "mexico",
            },
        )
        conn = sqlite3.connect(self.owner_db)
        conn.executemany(
            "INSERT INTO sidecar_assets VALUES (?, ?)",
            [
                ("native-1", "one.jpg"),
                ("asset-pub", "two.jpg"),
                ("asset-reviewed", "three.jpg"),
                ("asset-filename", "legacy-filename"),
            ],
        )
        conn.execute(
            "INSERT INTO public_catalog_publications VALUES (?, ?, ?, ?)",
            ("asset-pub", "srcv-1", "legacy-pub", "live"),
        )
        conn.commit()
        conn.close()
        self.reviewed_map.write_text(
            json.dumps(
                {
                    "mappings": [
                        {
                            "legacyMediaId": "legacy-reviewed",
                            "assetId": "asset-reviewed",
                            "evidenceType": "owner-reviewed-receipt",
                            "evidenceRef": "receipt-1",
                            "reviewedBy": "owner@example.com",
                            "reviewedAt": "2026-08-13T08:00:00Z",
                        }
                    ]
                }
            ),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def report(self, generated_at: str = "2026-08-13T08:30:00Z") -> dict:
        return build_report(
            legacy_index=self.legacy_index,
            owner_db=self.owner_db,
            catalog_db=self.catalog_db,
            reviewed_map=self.reviewed_map,
            generated_at=generated_at,
        )

    def test_report_uses_only_explicit_identity_evidence(self) -> None:
        report = self.report()
        summary = report["summary"]
        self.assertEqual(summary["sourceAssignmentCount"], 5)
        self.assertEqual(summary["accountedCount"], 5)
        self.assertEqual(summary["mappedCount"], 3)
        self.assertEqual(summary["unmappedCount"], 2)
        self.assertEqual(summary["conflictCount"], 0)
        self.assertEqual(summary["directNativeIdMatchCount"], 1)
        self.assertEqual(summary["publicationReceiptMatchCount"], 1)
        self.assertEqual(summary["reviewedMapMatchCount"], 1)
        self.assertEqual(summary["legacyCatalogPresenceCount"], 3)

        by_id = {row["legacyMediaId"]: row for row in report["rows"]}
        self.assertEqual(by_id["native-1"]["assetId"], "native-1")
        self.assertEqual(by_id["legacy-pub"]["assetId"], "asset-pub")
        self.assertEqual(by_id["legacy-reviewed"]["assetId"], "asset-reviewed")
        self.assertEqual(by_id["legacy-filename"]["status"], "unmapped")
        self.assertEqual(by_id["legacy-filename"]["evidence"], [])
        self.assertTrue(by_id["legacy-unmapped"]["legacyCatalogPresent"])

    def test_plan_hash_is_stable_across_report_timestamps(self) -> None:
        first = self.report("2026-08-13T08:30:00Z")
        second = self.report("2026-08-13T09:30:00Z")
        self.assertNotEqual(first["generatedAt"], second["generatedAt"])
        self.assertEqual(first["planHash"], second["planHash"])

    def test_report_tampering_is_rejected(self) -> None:
        report = self.report()
        report["rows"][0]["countrySlug"] = "changed"
        with self.assertRaisesRegex(RuntimeError, "planHash"):
            validate_report(report)

    def test_missing_reviewed_target_fails_closed_as_conflict(self) -> None:
        payload = json.loads(self.reviewed_map.read_text(encoding="utf-8"))
        payload["mappings"][0]["assetId"] = "missing-asset"
        self.reviewed_map.write_text(json.dumps(payload), encoding="utf-8")
        report = self.report()
        row = next(row for row in report["rows"] if row["legacyMediaId"] == "legacy-reviewed")
        self.assertEqual(row["status"], "conflict")
        self.assertIn("missing Sidecar", row["reason"])

    def test_duplicate_native_target_fails_closed_for_every_claim(self) -> None:
        payload = json.loads(self.reviewed_map.read_text(encoding="utf-8"))
        payload["mappings"].append(
            {
                "legacyMediaId": "legacy-unmapped",
                "assetId": "asset-reviewed",
                "evidenceType": "owner-reviewed-receipt",
                "evidenceRef": "receipt-2",
                "reviewedBy": "owner@example.com",
                "reviewedAt": "2026-08-13T08:01:00Z",
            }
        )
        self.reviewed_map.write_text(json.dumps(payload), encoding="utf-8")
        report = self.report()
        by_id = {row["legacyMediaId"]: row for row in report["rows"]}
        self.assertEqual(by_id["legacy-reviewed"]["status"], "conflict")
        self.assertEqual(by_id["legacy-unmapped"]["status"], "conflict")
        self.assertIn("multiple legacy IDs", by_id["legacy-reviewed"]["reason"])

    def test_legacy_owner_helpers_preserve_legacy_schema_and_export(self) -> None:
        record_country_assignments(
            self.root,
            "spain",
            [{"id": "legacy-write", "from_slug": "unknown", "to_slug": "spain"}],
            [],
            db_path=self.owner_db,
        )
        conn = sqlite3.connect(self.owner_db)
        columns = {row[1] for row in conn.execute("PRAGMA table_info(country_assignments)")}
        conn.close()
        self.assertEqual(
            columns,
            {"media_id", "country_slug", "source_slug", "batch_id", "assigned_at", "updated_at"},
        )
        exported_path = self.root / "assets/owner-actions/country-assignments.json"
        exported = json.loads(exported_path.read_text(encoding="utf-8"))
        self.assertNotIn("schema_version", exported)
        self.assertNotIn("native_assets", exported)
        self.assertEqual(exported["photos"]["legacy-write"]["gallery_key"], "spain")


class CountryIdentityMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.owner_db = self.root / "assets/owner-actions/Owner.sqlite"
        self.legacy_index = self.root / "assets/owner-actions/country-assignments.json"
        create_owner_db(self.owner_db)
        write_legacy_index(
            self.legacy_index,
            {"native-1": "spain", "legacy-unmapped": "portugal"},
        )
        conn = sqlite3.connect(self.owner_db)
        conn.execute("INSERT INTO sidecar_assets VALUES ('native-1', 'one.jpg')")
        conn.commit()
        conn.close()
        self.report = build_report(
            legacy_index=self.legacy_index,
            owner_db=self.owner_db,
            generated_at="2026-08-13T08:30:00Z",
        )
        self.backup = self.root / "backup/Owner.before.sqlite"
        self.compatibility = self.root / "audit/country-assignments.json"

    def tearDown(self) -> None:
        self.temp.cleanup()

    def apply(self, *, allow_unmapped: bool = True) -> dict:
        return apply_reviewed_migration(
            owner_db=self.owner_db,
            report=self.report,
            backup_path=self.backup,
            compatibility_output=self.compatibility,
            allow_unmapped=allow_unmapped,
            applied_at="2026-08-13T09:00:00Z",
        )

    def test_apply_requires_explicit_unmapped_acknowledgement(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "--allow-unmapped"):
            self.apply(allow_unmapped=False)
        self.assertFalse(self.backup.exists())

    def test_apply_refuses_owner_db_drift_after_review(self) -> None:
        conn = sqlite3.connect(self.owner_db)
        conn.execute(
            "INSERT INTO owner_settings VALUES ('changed-after-review', 'true', '2026-08-13T08:45:00Z')"
        )
        conn.commit()
        conn.close()
        with self.assertRaisesRegex(RuntimeError, "changed after"):
            self.apply()
        self.assertFalse(self.backup.exists())

    def test_apply_is_backed_up_auditable_and_idempotent(self) -> None:
        result = self.apply()
        self.assertTrue(result["applied"])
        self.assertFalse(result["noOp"])
        self.assertTrue(self.backup.is_file())
        self.assertTrue(self.compatibility.is_file())

        conn = sqlite3.connect(self.owner_db)
        conn.row_factory = sqlite3.Row
        columns = {row[1] for row in conn.execute("PRAGMA table_info(country_assignments)")}
        self.assertIn("assignment_id", columns)
        rows = conn.execute(
            "SELECT media_id, asset_id, identity_status FROM country_assignments ORDER BY media_id"
        ).fetchall()
        self.assertEqual(len(rows), 2)
        self.assertEqual(dict(rows[0]), {
            "media_id": "legacy-unmapped",
            "asset_id": None,
            "identity_status": "unmapped",
        })
        self.assertEqual(dict(rows[1]), {
            "media_id": "native-1",
            "asset_id": "native-1",
            "identity_status": "mapped",
        })
        self.assertEqual(
            conn.execute("SELECT count(*) FROM country_assignment_identity_migration_rows").fetchone()[0],
            2,
        )
        self.assertEqual(conn.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        conn.close()

        backup_conn = sqlite3.connect(self.backup)
        self.assertNotIn(
            "assignment_id",
            {row[1] for row in backup_conn.execute("PRAGMA table_info(country_assignments)")},
        )
        backup_conn.close()

        compatibility = json.loads(self.compatibility.read_text(encoding="utf-8"))
        self.assertEqual(compatibility["schema_version"], 2)
        self.assertEqual(len(compatibility["photos"]), 2)
        self.assertEqual(list(compatibility["native_assets"]), ["native-1"])

        second = self.apply()
        self.assertFalse(second["applied"])
        self.assertTrue(second["noOp"])

        rebuilt = build_report(
            legacy_index=self.legacy_index,
            owner_db=self.owner_db,
            generated_at="2026-08-13T10:00:00Z",
        )
        self.assertEqual(rebuilt["planHash"], self.report["planHash"])

    def test_no_op_revalidates_migration_and_audit_counts(self) -> None:
        self.apply()
        conn = sqlite3.connect(self.owner_db)
        conn.execute(
            "DELETE FROM country_assignment_identity_migration_rows WHERE legacy_media_id = 'legacy-unmapped'"
        )
        conn.commit()
        conn.close()
        with self.assertRaisesRegex(RuntimeError, "does not match"):
            self.apply()

    def test_migrated_db_remains_compatible_with_owner_state_helpers(self) -> None:
        self.apply()
        moved = [{"id": "native-1", "from_slug": "unknown", "to_slug": "france"}]
        record_country_assignments(
            self.root,
            "france",
            moved,
            [],
            db_path=self.owner_db,
        )
        conn = sqlite3.connect(self.owner_db)
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT asset_id, country_slug, identity_status FROM country_assignments WHERE media_id = 'native-1'"
        ).fetchone()
        self.assertEqual(dict(row), {
            "asset_id": "native-1",
            "country_slug": "france",
            "identity_status": "mapped",
        })
        export_country_assignments(self.root, conn)
        conn.close()
        exported = json.loads(self.legacy_index.read_text(encoding="utf-8"))
        self.assertEqual(exported["schema_version"], 2)
        self.assertEqual(exported["photos"]["native-1"]["gallery_key"], "france")
        self.assertEqual(exported["native_assets"]["native-1"]["legacy_media_id"], "native-1")

    def test_post_migration_legacy_write_is_explicitly_unmapped(self) -> None:
        self.apply()
        record_country_assignments(
            self.root,
            "portugal",
            [{"id": "legacy-after-migration", "from_slug": "unknown", "to_slug": "portugal"}],
            [],
            db_path=self.owner_db,
        )
        conn = sqlite3.connect(self.owner_db)
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT asset_id, identity_status, identity_source, migration_id "
            "FROM country_assignments WHERE media_id = 'legacy-after-migration'"
        ).fetchone()
        conn.close()
        self.assertEqual(dict(row), {
            "asset_id": None,
            "identity_status": "unmapped",
            "identity_source": "legacy-owner-action",
            "migration_id": "post-migration-legacy-write",
        })

    def test_force_import_after_v2_fails_closed(self) -> None:
        self.apply()
        conn = sqlite3.connect(self.owner_db)
        try:
            with self.assertRaisesRegex(RuntimeError, "retired"):
                import_country_assignments(self.root, conn, force=True)
        finally:
            conn.close()

    def test_export_photos_data_ignores_null_media_id(self) -> None:
        self.apply()
        conn = sqlite3.connect(self.owner_db)
        conn.execute(
            """
            INSERT INTO country_assignments (
              assignment_id, asset_id, media_id, country_slug, source_slug,
              batch_id, assigned_at, updated_at, identity_status, identity_source,
              identity_evidence_json, migration_id, migrated_at
            ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'mapped', ?, '[]', ?, ?)
            """,
            (
                "asset:null-media",
                "asset-null-media",
                "spain",
                "unknown",
                "batch-null-media",
                "2026-08-13T09:00:00Z",
                "2026-08-13T09:00:00Z",
                "owner-reviewed-receipt",
                "migration-test",
                "2026-08-13T09:00:00Z",
            ),
        )
        conn.commit()
        conn.close()
        assignments = country_assignments_from_owner_index(self.root)
        self.assertNotIn("asset-null-media", assignments)


if __name__ == "__main__":
    unittest.main()
