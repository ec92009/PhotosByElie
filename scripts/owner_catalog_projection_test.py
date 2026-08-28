import sqlite3
import tempfile
import unittest
from pathlib import Path
import shutil
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from owner_catalog_projection import (
    import_projection,
    project_catalog,
    verify_deployed_projection,
)


class OwnerCatalogProjectionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.owner = (self.root / "Owner.sqlite").resolve()
        self.catalog = (self.root / "reviewed.sqlite").resolve()
        shutil.copy2(
            Path(__file__).resolve().parents[1] / "assets/catalog/photosbyelie.sqlite",
            self.catalog,
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_reviewed_import_retires_ai_and_projects_identical_bytes(self):
        imported = import_projection(
            self.owner,
            self.catalog,
            approved_policy="PBE-173",
        )
        self.assertTrue(imported["changed"])
        self.assertGreater(imported["mediaCount"], 0)

        first = self.root / "first.sqlite"
        second = self.root / "second.sqlite"
        first_result = project_catalog(self.owner, first)
        second_result = project_catalog(self.owner, second)
        self.assertEqual(first_result["sha256"], second_result["sha256"])
        self.assertEqual(first.read_bytes(), second.read_bytes())
        with sqlite3.connect(first) as conn:
            self.assertEqual(
                conn.execute("SELECT count(*) FROM collections WHERE lower(slug) = 'ai'").fetchone()[0],
                0,
            )
            self.assertEqual(
                conn.execute("SELECT count(*) FROM source_origins WHERE lower(code) = 'ai'").fetchone()[0],
                0,
            )

        replay = import_projection(
            self.owner,
            first,
            approved_policy="PBE-173",
            expected_sha256=first_result["sha256"],
        )
        self.assertFalse(replay["changed"])
        self.assertEqual(replay["revision"], imported["revision"])

    def test_remote_verification_records_exact_parity_or_failure(self):
        imported = import_projection(
            self.owner,
            self.catalog,
            approved_policy="PBE-173",
        )
        projection = self.root / "projection.sqlite"
        project_catalog(self.owner, projection)
        payload = projection.read_bytes()
        with sqlite3.connect(projection) as catalog_conn:
            included_media_id = str(
                catalog_conn.execute(
                    "SELECT media_id FROM media_items ORDER BY media_id LIMIT 1"
                ).fetchone()[0]
            )
        with sqlite3.connect(self.owner) as owner_conn:
            owner_conn.execute(
                """
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
                )
                """
            )
            owner_conn.executemany(
                """
                INSERT INTO public_catalog_publications (
                  asset_id, source_version_hash, media_id, state, created_at, updated_at
                ) VALUES (?, 'version-1', ?, ?, '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z')
                """,
                [
                    ("included", included_media_id, "local"),
                    ("removed", "not-in-projection", "live"),
                ],
            )
            owner_conn.commit()

        verified = verify_deployed_projection(
            self.owner,
            public_url="https://example.test/catalog.sqlite",
            fetch=lambda _url: (200, payload),
        )
        self.assertEqual(verified["state"], "verified")
        self.assertEqual(verified["remoteSha256"], imported["sha256"])
        with sqlite3.connect(self.owner) as owner_conn:
            self.assertEqual(
                owner_conn.execute(
                    "SELECT state, catalog_sha256 FROM public_catalog_publications WHERE asset_id = 'included'"
                ).fetchone(),
                ("live", imported["sha256"]),
            )
            self.assertEqual(
                owner_conn.execute(
                    "SELECT state, verified_at FROM public_catalog_publications WHERE asset_id = 'removed'"
                ).fetchone(),
                ("pending", None),
            )

        stale_path = self.root / "stale.sqlite"
        shutil.copy2(projection, stale_path)
        with sqlite3.connect(stale_path) as conn:
            conn.execute(
                "UPDATE media_items SET title = title || ' stale' WHERE media_id = (SELECT media_id FROM media_items ORDER BY media_id LIMIT 1)"
            )
            conn.commit()
        failed = verify_deployed_projection(
            self.owner,
            public_url="https://example.test/catalog.sqlite",
            fetch=lambda _url: (200, stale_path.read_bytes()),
        )
        self.assertEqual(failed["state"], "failed")
        self.assertIn("does not match", failed["error"])
        with sqlite3.connect(self.owner) as conn:
            self.assertEqual(
                conn.execute(
                    "SELECT count(*) FROM owner_public_catalog_deployments WHERE state = 'verified'"
                ).fetchone()[0],
                1,
            )
            self.assertEqual(
                conn.execute(
                    "SELECT count(*) FROM owner_public_catalog_deployments WHERE state = 'failed'"
                ).fetchone()[0],
                1,
            )


if __name__ == "__main__":
    unittest.main()
