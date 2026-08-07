import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from scripts.release_fixture_real_estate_gallery import (
    LA_CONCHA_ALBUMS,
    app_context_source,
    build_release,
)


class FixtureRealEstateReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.owner_db = root / "Owner.sqlite"
        self.catalog_db = root / "photosbyelie.sqlite"
        self._create_owner_db()
        self._create_catalog_db()

    def tearDown(self):
        self.temporary.cleanup()

    def _create_owner_db(self):
        connection = sqlite3.connect(self.owner_db)
        connection.executescript(
            """
            CREATE TABLE fixture_delivery_receipts (
              receipt_id TEXT PRIMARY KEY, fixture_id TEXT, asset_id TEXT,
              destination TEXT, version_hash TEXT, status TEXT, object_key TEXT,
              checksum_sha256 TEXT, visibility_policy TEXT,
              verification_json TEXT, verified_at TEXT
            );
            CREATE TABLE fixture_asset_placements (
              placement_id TEXT PRIMARY KEY, fixture_id TEXT, asset_id TEXT, state TEXT
            );
            CREATE TABLE sidecar_assets (
              asset_id TEXT PRIMARY KEY, filename TEXT, media_type TEXT,
              captured_at TEXT, pixel_width INTEGER, pixel_height INTEGER,
              photos_title TEXT, photos_keywords_json TEXT
            );
            CREATE TABLE sidecar_decisions (
              asset_id TEXT PRIMARY KEY, title TEXT, keywords_json TEXT
            );
            CREATE TABLE r2_objects (
              bucket TEXT, object_key TEXT, object_kind TEXT,
              lifecycle_state TEXT, bytes INTEGER
            );
            """
        )
        for index, album in enumerate(LA_CONCHA_ALBUMS, start=1):
            asset_id = f"asset-{index}"
            media_id = f"001-release-{index}"
            object_key = f"masters/{media_id}.jpg"
            verification = json.dumps({"bucket": "photosbyelie-private", "bytes": 1000 + index})
            connection.execute(
                "INSERT INTO fixture_delivery_receipts VALUES (?, ?, ?, 'r2', ?, 'verified', ?, ?, 'private', ?, ?)",
                (f"r2-{index}", "fixture-la-concha", asset_id, f"srcv-{index}", object_key, "a" * 64, verification, f"2026-08-06T17:20:0{index}Z"),
            )
            connection.execute(
                "INSERT INTO fixture_delivery_receipts VALUES (?, ?, ?, 'apple_photos', ?, 'verified', ?, ?, 'private', '{}', ?)",
                (f"photos-{index}", "fixture-la-concha", asset_id, f"photos-{index}", f"apple-photos://{asset_id}", "b" * 64, f"2026-08-06T17:21:0{index}Z"),
            )
            connection.execute(
                "INSERT INTO fixture_asset_placements VALUES (?, ?, ?, 'active')",
                (f"placement-{index}", album.fixture_id, asset_id),
            )
            connection.execute(
                "INSERT INTO sidecar_assets VALUES (?, ?, 'photo', ?, 4000, 3000, ?, '[]')",
                (asset_id, f"D5H_{3000 + index}.jpg", f"2026-05-13T14:00:0{index}Z", album.title),
            )
            connection.execute(
                "INSERT INTO sidecar_decisions VALUES (?, ?, '[]')",
                (asset_id, album.title),
            )
            connection.execute(
                "INSERT INTO r2_objects VALUES ('photosbyelie-private', ?, 'private-master', 'current', ?)",
                (object_key, 1000 + index),
            )
        connection.commit()
        connection.close()

    def _create_catalog_db(self):
        connection = sqlite3.connect(self.catalog_db)
        connection.executescript(
            """
            CREATE TABLE media_items (media_id TEXT PRIMARY KEY, source_file_id INTEGER);
            CREATE TABLE source_files (source_file_id INTEGER PRIMARY KEY, filename TEXT);
            CREATE TABLE media_assets (media_id TEXT, asset_type_id INTEGER, width INTEGER, height INTEGER);
            CREATE TABLE asset_types (asset_type_id INTEGER PRIMARY KEY, code TEXT);
            INSERT INTO asset_types VALUES (1, 'still_900'), (2, 'still_1800');
            """
        )
        for index in (1, 2):
            media_id = f"001-release-{index}"
            connection.execute("INSERT INTO media_items VALUES (?, ?)", (media_id, index))
            connection.execute("INSERT INTO source_files VALUES (?, ?)", (index, f"D5H_{3000 + index}.jpg"))
            connection.execute("INSERT INTO media_assets VALUES (?, 1, 900, 675)", (media_id,))
            connection.execute("INSERT INTO media_assets VALUES (?, 2, 1800, 1350)", (media_id,))
        connection.commit()
        connection.close()

    def test_projects_only_dual_verified_assets_into_public_safe_context(self):
        release = build_release(self.owner_db, self.catalog_db, expected_count=2)

        manifest = release["manifest"]
        self.assertEqual(manifest["release"]["verifiedAssetCount"], 2)
        self.assertEqual([album["photoCount"] for album in manifest["albums"]], [1, 1])
        self.assertEqual([photo["id"] for photo in manifest["photos"]], ["001-release-1", "001-release-2"])
        self.assertIn("/media/expo/001-release-1_900.jpg", manifest["photos"][0]["gallerySrc"])
        self.assertNotIn("privateMasterKey", app_context_source(manifest))
        self.assertEqual(release["workerRelease"]["privateMasterLayout"], "flat")
        self.assertEqual(release["workerRelease"]["allowedPhotoIds"], ["001-release-1", "001-release-2"])

    def test_refuses_a_partial_apple_photos_handoff(self):
        connection = sqlite3.connect(self.owner_db)
        connection.execute("DELETE FROM fixture_delivery_receipts WHERE receipt_id = 'photos-2'")
        connection.commit()
        connection.close()

        with self.assertRaisesRegex(ValueError, "projection is incomplete"):
            build_release(self.owner_db, self.catalog_db, expected_count=2)


if __name__ == "__main__":
    unittest.main()
