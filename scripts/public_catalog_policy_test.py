import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from public_catalog_policy import public_catalog_policy_snapshot
from reconcile_public_catalog_artifacts import filter_expo_manifest


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


if __name__ == "__main__":
    unittest.main()
