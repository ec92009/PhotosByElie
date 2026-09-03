import json
import hashlib
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from public_catalog_policy import public_catalog_policy_snapshot
from reconcile_public_catalog_artifacts import (
    _filter_catalog_projection,
    filter_expo_manifest,
)


class PublicCatalogPolicyTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "assets/owner-actions").mkdir(parents=True)
        (self.root / "assets/catalog").mkdir(parents=True)
        (self.root / "assets/expo-manifest.json").write_text(json.dumps({
            "photos": [
                {"id": "legacy-photo", "derivatives": {"detail": "expo/legacy-photo_1800.jpg"}},
                {"id": "legacy-video", "derivatives": {"detail": "expo/legacy-video_short_5s_720p.mp4"}},
            ]
        }))
        (self.root / "assets/catalog/product-pricing.json").write_text(json.dumps({
            "storefrontPolicy": {"retiredMediaTypes": ["video"]}
        }))
        self.db = self.root / "assets/owner-actions/Owner.sqlite"
        conn = sqlite3.connect(self.db)
        conn.executescript("""
            CREATE TABLE title_keyword_queue (media_id TEXT, latest_attempt INTEGER, review_state TEXT);
            CREATE TABLE title_keyword_decisions (media_id TEXT, attempt INTEGER, decision_state TEXT, applied_at TEXT);
            CREATE TABLE sidecar_decisions (asset_id TEXT, pick_state TEXT, metadata_state TEXT);
            CREATE TABLE sidecar_upload_bridge_run_items (asset_id TEXT, photo_id TEXT, upload_status TEXT);
            CREATE TABLE sidecar_tombstones (asset_id TEXT, tombstone_state TEXT);
            CREATE TABLE public_catalog_publications (asset_id TEXT, media_id TEXT, state TEXT);
            CREATE TABLE asset_editorial_state (asset_id TEXT, editorial_state TEXT);
            CREATE TABLE media_lifecycle (
              media_id TEXT PRIMARY KEY, lifecycle_state TEXT, previous_slug TEXT, source_slug TEXT,
              title TEXT, media_type TEXT, source_paths_json TEXT, public_preview_keys_json TEXT,
              private_keys_json TEXT, hidden_at TEXT, discarded_at TEXT, restored_at TEXT, updated_at TEXT
            );
            INSERT INTO title_keyword_queue VALUES ('title-approved', 1, 'applied');
            INSERT INTO title_keyword_decisions VALUES ('title-approved', 1, 'accepted', 'now');
            INSERT INTO sidecar_decisions VALUES ('asset-sidecar', 'picked', 'approved');
            INSERT INTO sidecar_upload_bridge_run_items VALUES ('asset-sidecar', 'sidecar-approved', 'uploaded');
            INSERT INTO public_catalog_publications VALUES ('asset-native', 'native-approved', 'local');
            INSERT INTO asset_editorial_state VALUES ('asset-native', 'approved');
            INSERT INTO media_lifecycle VALUES ('legacy-photo', 'hidden', '', '', '', 'photo', '[]', '[]', '[]', 'now', '', '', 'now');
        """)
        conn.commit()
        conn.close()

    def tearDown(self):
        self.temp.cleanup()

    def test_policy_unions_approval_sources_but_keeps_lifecycle_block_separate(self):
        conn = sqlite3.connect(self.db)
        conn.row_factory = sqlite3.Row
        try:
            snapshot = public_catalog_policy_snapshot(self.root, conn=conn)
        finally:
            conn.close()
        self.assertEqual(
            set(snapshot["eligibleMediaIds"]),
            {"legacy-video", "title-approved", "sidecar-approved", "native-approved"},
        )
        self.assertEqual(set(snapshot["blockedMediaIds"]), {"legacy-photo"})
        self.assertEqual(set(snapshot["retiredMediaTypes"]), {"video"})

    def test_manifest_filter_applies_block_and_retirement_before_projection(self):
        manifest = json.loads((self.root / "assets/expo-manifest.json").read_text())
        filtered, summary = filter_expo_manifest(
            manifest,
            eligible_ids={"legacy-photo", "legacy-video"},
            blocked_ids={"legacy-photo"},
            retired_media_types={"video"},
        )
        self.assertEqual(filtered["photos"], [])
        self.assertEqual(filtered["photos_count"], 0)
        self.assertEqual(summary["removedBlocked"], 1)
        self.assertEqual(summary["removedRetiredMediaType"], 1)

    def test_catalog_filter_applies_eligibility_and_retirement_to_projection(self):
        catalog = self.root / "assets/catalog/filter-test.sqlite"
        conn = sqlite3.connect(catalog)
        conn.executescript("""
            PRAGMA foreign_keys = ON;
            CREATE TABLE media_types (
              media_type_id INTEGER PRIMARY KEY,
              code TEXT NOT NULL UNIQUE
            );
            CREATE TABLE media_items (
              media_id TEXT PRIMARY KEY,
              media_type_id INTEGER NOT NULL REFERENCES media_types(media_type_id)
            ) WITHOUT ROWID;
            CREATE TABLE media_assets (
              media_id TEXT NOT NULL REFERENCES media_items(media_id) ON DELETE CASCADE,
              asset_type TEXT NOT NULL,
              PRIMARY KEY (media_id, asset_type)
            ) WITHOUT ROWID;
            INSERT INTO media_types VALUES (1, 'photo'), (2, 'video');
            INSERT INTO media_items VALUES
              ('keep-photo', 1),
              ('blocked-photo', 1),
              ('retired-video', 2);
            INSERT INTO media_assets VALUES
              ('keep-photo', 'preview'),
              ('blocked-photo', 'preview'),
              ('retired-video', 'preview');
        """)
        conn.commit()
        conn.close()

        summary = _filter_catalog_projection(
            catalog,
            eligible_ids={"keep-photo", "retired-video"},
            retired_media_types={"video"},
        )

        self.assertEqual(summary, {"before": 3, "after": 1, "removed": 2})
        with sqlite3.connect(catalog) as conn:
            self.assertEqual(
                conn.execute("SELECT media_id FROM media_items").fetchall(),
                [("keep-photo",)],
            )
            self.assertEqual(conn.execute("SELECT count(*) FROM media_assets").fetchone()[0], 1)
            self.assertEqual(conn.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_catalog_filter_keeps_compliant_projection_bytes_unchanged(self):
        catalog = self.root / "assets/catalog/idempotent-filter-test.sqlite"
        conn = sqlite3.connect(catalog)
        conn.executescript("""
            CREATE TABLE media_types (
              media_type_id INTEGER PRIMARY KEY,
              code TEXT NOT NULL UNIQUE
            );
            CREATE TABLE media_items (
              media_id TEXT PRIMARY KEY,
              media_type_id INTEGER NOT NULL REFERENCES media_types(media_type_id)
            ) WITHOUT ROWID;
            CREATE TABLE media_assets (
              media_id TEXT NOT NULL REFERENCES media_items(media_id) ON DELETE CASCADE,
              asset_type TEXT NOT NULL,
              PRIMARY KEY (media_id, asset_type)
            ) WITHOUT ROWID;
            INSERT INTO media_types VALUES (1, 'photo');
            INSERT INTO media_items VALUES ('keep-photo', 1);
            INSERT INTO media_assets VALUES ('keep-photo', 'preview');
        """)
        conn.commit()
        conn.close()
        before = catalog.read_bytes()

        summary = _filter_catalog_projection(
            catalog,
            eligible_ids={"keep-photo"},
            retired_media_types={"video"},
        )

        self.assertEqual(summary, {"before": 1, "after": 1, "removed": 0})
        self.assertEqual(catalog.read_bytes(), before)

    def test_owner_reconciliation_replaces_manifest_as_legacy_authority(self):
        with sqlite3.connect(self.db) as conn:
            conn.executescript("""
                CREATE TABLE owner_catalog_reconciliation_migrations (
                  migration_id TEXT PRIMARY KEY, applied_at TEXT
                );
                CREATE TABLE owner_catalog_reconciliation_rows (
                  migration_id TEXT, media_id TEXT, migration_state TEXT
                );
                INSERT INTO owner_catalog_reconciliation_migrations
                  VALUES ('migration-1', '2026-08-28T10:00:00Z');
                INSERT INTO owner_catalog_reconciliation_rows
                  VALUES ('migration-1', 'owner-legacy', 'unresolved');
            """)
        conn = sqlite3.connect(self.db)
        conn.row_factory = sqlite3.Row
        try:
            snapshot = public_catalog_policy_snapshot(self.root, conn=conn)
        finally:
            conn.close()
        self.assertEqual(snapshot["legacyAuthority"], "owner-catalog-reconciliation")
        self.assertIn("owner-legacy", snapshot["eligibleMediaIds"])
        self.assertNotIn("legacy-video", snapshot["eligibleMediaIds"])

    def test_explicit_owner_authority_is_read_only_and_fingerprinted(self):
        before = hashlib.sha256(self.db.read_bytes()).hexdigest()
        before_stat = self.db.stat()
        snapshot = public_catalog_policy_snapshot(self.root, owner_db_path=self.db.resolve())
        after = hashlib.sha256(self.db.read_bytes()).hexdigest()
        after_stat = self.db.stat()

        self.assertEqual(snapshot["ownerAuthority"]["path"], str(self.db.resolve()))
        self.assertEqual(snapshot["ownerAuthority"]["sha256"], before)
        self.assertEqual(snapshot["ownerAuthority"]["mode"], "read-only")
        self.assertEqual(after, before)
        self.assertEqual(after_stat.st_size, before_stat.st_size)
        self.assertEqual(after_stat.st_mtime_ns, before_stat.st_mtime_ns)

    def test_explicit_owner_authority_does_not_create_a_missing_database(self):
        missing = (self.root / "missing.sqlite").resolve()
        with self.assertRaises(FileNotFoundError):
            public_catalog_policy_snapshot(self.root, owner_db_path=missing)
        self.assertFalse(missing.exists())

    def test_explicit_owner_authority_rejects_relative_paths(self):
        with self.assertRaisesRegex(ValueError, "must be absolute"):
            public_catalog_policy_snapshot(self.root, owner_db_path=Path("Owner.sqlite"))

    def test_explicit_owner_authority_rejects_uncheckpointed_wal(self):
        wal = Path(f"{self.db}-wal")
        wal.write_bytes(b"uncheckpointed")
        with self.assertRaisesRegex(ValueError, "uncheckpointed WAL"):
            public_catalog_policy_snapshot(self.root, owner_db_path=self.db.resolve())


if __name__ == "__main__":
    unittest.main()
