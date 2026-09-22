"""Executable isolation contract for fixture-owned approvals and upload inputs."""

import sqlite3
import unittest

import fixture_editions as editions


class FixtureEditionTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
            CREATE TABLE fixtures(fixture_id TEXT PRIMARY KEY);
            CREATE TABLE sidecar_assets(asset_id TEXT PRIMARY KEY);
            CREATE TABLE asset_source_versions(version_id TEXT PRIMARY KEY,asset_id TEXT,source_exists INTEGER);
            INSERT INTO fixtures VALUES ('apartment'),('marketing');
            INSERT INTO sidecar_assets VALUES ('photo'),('other');
            INSERT INTO asset_source_versions VALUES ('original','photo',1),('after','photo',1),('wrong','other',1),('missing','photo',0);
        """)
        editions.ensure_schema(self.db)
        for fixture in ("apartment", "marketing"):
            editions.seed_edition(self.db, fixture, "photo", source_version_id="original", title="Original title")
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def approve(self, fixture):
        current = editions.get_edition(self.db, fixture, "photo")
        return editions.approve_edition(self.db, fixture, "photo", expected_revision=editions.revision_hash(current))

    def test_approval_does_not_follow_asset_to_another_fixture(self):
        self.approve("apartment")
        self.assertIsNotNone(editions.approved_edition(self.db, "apartment", "photo"))
        self.assertIsNone(editions.approved_edition(self.db, "marketing", "photo"))

    def test_two_fixtures_can_approve_and_upload_different_images_and_metadata(self):
        self.approve("apartment")
        editions.edit_edition(self.db, "marketing", "photo", title="Marketing title",
                              keywords=["balcony"], source_version_id="after")
        self.approve("marketing")
        apartment = editions.approved_edition(self.db, "apartment", "photo")
        marketing = editions.approved_edition(self.db, "marketing", "photo")
        self.assertEqual((apartment["title"], apartment["source_version_id"]), ("Original title", "original"))
        self.assertEqual((marketing["title"], marketing["source_version_id"]), ("Marketing title", "after"))
        self.assertNotEqual(apartment["revision_hash"], marketing["revision_hash"])

    def test_edit_invalidates_only_own_approval_and_preserves_uploaded_snapshot(self):
        self.approve("apartment")
        self.approve("marketing")
        old = editions.approved_edition(self.db, "marketing", "photo")
        editions.edit_edition(self.db, "marketing", "photo", keywords=["changed"])
        self.assertIsNone(editions.approved_edition(self.db, "marketing", "photo"))
        self.assertIsNotNone(editions.approved_edition(self.db, "apartment", "photo"))
        saved = dict(self.db.execute("SELECT * FROM fixture_edition_versions WHERE fixture_id='marketing'").fetchone())
        self.assertEqual(saved, old)

    def test_noop_edit_preserves_approval(self):
        self.approve("marketing")
        editions.edit_edition(self.db, "marketing", "photo", title="Original title")
        self.assertIsNotNone(editions.approved_edition(self.db, "marketing", "photo"))

    def test_stale_approval_and_wrong_or_missing_sources_are_rejected(self):
        old = editions.get_edition(self.db, "marketing", "photo")
        editions.edit_edition(self.db, "marketing", "photo", title="Changed")
        with self.assertRaises(ValueError):
            editions.approve_edition(self.db, "marketing", "photo", expected_revision=editions.revision_hash(old))
        for source in ("wrong", "missing", "absent"):
            with self.assertRaises(ValueError):
                editions.edit_edition(self.db, "marketing", "photo", source_version_id=source)

    def test_caller_rollback_reverts_edition_approval_and_audit_together(self):
        self.approve("marketing")
        self.db.rollback()
        self.assertIsNone(editions.approved_edition(self.db, "marketing", "photo"))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM fixture_edition_events").fetchone()[0], 0)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM fixture_edition_versions").fetchone()[0], 0)

    def test_seed_replay_does_not_reset_existing_fixture_work(self):
        self.approve("marketing")
        editions.seed_edition(self.db, "marketing", "photo", source_version_id="original", title="Reset attempt")
        self.assertIsNotNone(editions.approved_edition(self.db, "marketing", "photo"))
        self.assertEqual(editions.get_edition(self.db, "marketing", "photo")["title"], "Original title")


if __name__ == "__main__":
    unittest.main()
