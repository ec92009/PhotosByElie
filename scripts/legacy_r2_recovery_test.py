"""Offline exact legacy recovery tests against the real native SQLite schema."""

from contextlib import closing
import copy
import json
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import legacy_r2_recovery as recovery
from fixture_pipeline import connect, create_fixture
from fixture_policy import ensure_policy_schema
from owner_catalog_projection import import_projection
from legacy_r2_evidence import RecoveryError, sha256, stamp, jpeg_dimensions
from legacy_r2_source import verified_legacy_source


class LegacyRecoveryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        catalog = self.root / "assets/catalog/photosbyelie.sqlite"
        catalog.parent.mkdir(parents=True)
        shutil.copy2(Path(__file__).resolve().parents[1] / "assets/catalog/photosbyelie.sqlite", catalog)
        self.media = "img-1404-b704ed7a17"
        # Model the pre-recovery defect only in this disposable catalog. The
        # checked-in production photo may already have been repaired; tests
        # must not lose their missing-metadata scenario when that happens.
        with closing(sqlite3.connect(catalog)) as conn, conn:
            conn.execute("""UPDATE media_assets SET bytes=NULL WHERE media_id=?
                AND asset_type_id IN (SELECT asset_type_id FROM asset_types
                  WHERE code IN ('still_900','still_1800'))""", (self.media,))
        self.payload = catalog.read_bytes()
        self.owner = self.root / "assets/owner-actions/Owner.sqlite"
        with connect(self.root):
            pass
        fixture = create_fixture(self.root, "Expo")
        with connect(self.root) as conn:
            ensure_policy_schema(conn)
            conn.commit()
        import_projection(self.owner, catalog, approved_policy="PBE-173")
        with closing(sqlite3.connect(self.owner)) as conn, conn:
            revision = conn.execute("SELECT revision FROM owner_public_catalog_projections").fetchone()[0]
            conn.execute("""INSERT INTO owner_public_catalog_authority_enrollment VALUES
                ('public-catalog','synthetic-publisher',1,?,?,?,'verified',?,?)""",
                ("e" * 64, revision, sha256(self.payload), stamp(), stamp()))
        metadata = recovery.catalog_metadata(self.payload, self.media)
        self.objects = [{**row, "bytes": row["bytes"] or 100, "sha256": str(i+1) * 64,
                         "contentType": "image/jpeg", "method": "authenticated-full-get-sha256"}
                        for i, row in enumerate(metadata["objects"])]
        self.request = {"mediaId": self.media, "fixtureId": fixture["fixtureId"],
                        "originalSha256": "1" * 64, "originalBytes": self.objects[0]["bytes"],
                        "selectionSha256": "a" * 64, "selectionApproval": "test-weekly-approval",
                        "recoveryApproval": "test-distinct-exact-recovery"}
        self.backup = self.owner.with_name("synthetic-recovery-backup.sqlite")

    def reader(self, bucket, key):
        return {**next(row for row in self.objects if row["bucket"] == bucket and row["key"] == key), "checkedAt": stamp()}

    def plan(self):
        return recovery.build_plan(self.root, self.request, object_reader=self.reader, catalog_reader=lambda: self.payload)

    def apply(self, plan=None):
        plan = plan or self.plan()
        return recovery.apply_plan(self.root, plan, approved_plan_sha256=plan["planSha256"],
                                   backup_path=self.backup, object_reader=self.reader, catalog_reader=lambda: self.payload)

    def rows(self, sql, params=()):
        with closing(sqlite3.connect(self.owner)) as conn:
            return conn.execute(sql, params).fetchall()

    def mutate(self, sql, params=()):
        with closing(sqlite3.connect(self.owner)) as conn, conn:
            conn.execute(sql, params)

    def snapshot(self):
        with closing(sqlite3.connect(self.owner)) as conn:
            return '\n'.join(conn.iterdump())

    def test_plan_is_read_only_and_stable(self):
        before = self.snapshot()
        first, second = self.plan(), self.plan()
        self.assertEqual(first["planSha256"], second["planSha256"])
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(self.backup.exists())

    def test_apply_atomic_exact_registration_and_repeat(self):
        plan = self.plan()
        projection = self.rows("SELECT * FROM owner_public_catalog_projections")
        result = self.apply(plan)
        self.assertEqual(result["state"], "registered_catalog_verification_pending")
        self.assertFalse(result["wholeSubjectReady"])
        self.assertTrue(result["catalogMetadataRepairRequired"])
        self.assertEqual(self.rows("SELECT count(*) FROM fixture_delivery_receipts"), [(3,)])
        self.assertEqual(self.rows("SELECT count(*) FROM sidecar_pending_sync"), [(0,)])
        self.assertEqual(self.rows("SELECT state FROM public_catalog_publications"), [("local",)])
        self.assertEqual(self.rows("SELECT * FROM owner_public_catalog_projections"), projection)
        self.assertEqual(self.backup.stat().st_mode & 0o777, 0o600)
        with closing(recovery._owner(self.root)) as conn:
            self.assertTrue(verified_legacy_source(conn, self.media))
        raw = json.loads(self.rows("SELECT raw_json FROM sidecar_assets")[0][0])
        self.assertNotIn("localIdentifier", raw)
        before = self.snapshot()
        replay = self.apply(plan)
        self.assertFalse(replay["changed"])
        self.assertFalse(replay["wholeSubjectReady"])
        self.assertEqual(self.snapshot(), before)

    def test_late_failure_rolls_back_and_keeps_backup(self):
        before = self.snapshot()
        with patch("legacy_r2_recovery_store.record_delivery_receipt", side_effect=RuntimeError("test-late-failure")):
            with self.assertRaisesRegex(RuntimeError, "test-late-failure"):
                self.apply()
        self.assertEqual(self.snapshot(), before)
        self.assertTrue(self.backup.is_file())

    def test_tampered_plan_blocked_without_writes(self):
        plan = self.plan()
        plan["objects"][1]["bytes"] += 1
        with self.assertRaisesRegex(RecoveryError, "reviewed_plan_required"):
            self.apply(plan)
        self.assertFalse(self.backup.exists())

    def test_changed_remote_bytes_cannot_apply_reviewed_plan(self):
        plan = self.plan()
        self.objects[1]["sha256"] = "b" * 64
        with self.assertRaisesRegex(RecoveryError, "reviewed_plan_changed"):
            self.apply(plan)
        self.assertFalse(self.backup.exists())

    def test_approved_original_mismatch(self):
        self.objects[0]["sha256"] = "f" * 64
        with self.assertRaisesRegex(RecoveryError, "approved_original_mismatch"):
            self.plan()

    def test_public_catalog_parity_required(self):
        with self.assertRaisesRegex(RecoveryError, "public_catalog_parity_failed"):
            recovery.build_plan(self.root, self.request, object_reader=self.reader, catalog_reader=lambda: b"wrong")

    def test_private_backup_location_required(self):
        self.backup = self.root / "assets/catalog/public-leak.sqlite"
        with self.assertRaisesRegex(RecoveryError, "new_absolute_private_backup_required"):
            self.apply()
        self.assertFalse(self.backup.exists())

    def test_policy_drift_blocks_before_backup(self):
        plan = self.plan()
        self.mutate("UPDATE fixtures SET policy_overrides_json=?", ('{"visibility":"private"}',))
        with self.assertRaisesRegex(RecoveryError, "fixture_not_public_catalog_eligible"):
            self.apply(plan)
        self.assertFalse(self.backup.exists())

    def test_projection_authority_drift_blocks(self):
        self.mutate("UPDATE owner_public_catalog_authority_enrollment SET projection_revision=projection_revision+1")
        with self.assertRaisesRegex(RecoveryError, "catalog_authority_not_current"):
            self.plan()

    def test_owner_snapshot_keeps_immediate_lock(self):
        with closing(recovery._owner(self.root, "rw")) as conn:
            conn.execute("BEGIN IMMEDIATE")
            recovery.owner_snapshot(conn, self.request)
            self.assertTrue(conn.in_transaction)
            with closing(sqlite3.connect(self.owner, timeout=0)) as other:
                with self.assertRaisesRegex(sqlite3.OperationalError, "locked"):
                    other.execute("BEGIN IMMEDIATE")
            conn.rollback()

    def test_jpeg_header_dimensions(self):
        header = b'\xff\xd8\xff\xc0\x00\x11\x08\x02\xa3\x03\x84' + b'\x00'*10
        self.assertEqual(jpeg_dimensions(header), (900, 675))
        with self.assertRaises(RecoveryError):
            jpeg_dimensions(b"not a jpeg")


if __name__ == "__main__":
    unittest.main()
