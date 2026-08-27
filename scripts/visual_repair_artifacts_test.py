import hashlib
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pbe144_synthetic_visual_fixture import stage_fixture
from visual_repair_proposals import (
    list_visual_repair_proposals,
    materialize_visual_repair_proposal,
)


class VisualRepairArtifactsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.repo_root = Path(__file__).resolve().parents[1]
        cls.fixture_root = (
            cls.repo_root
            / "native/PhotosByElieBackstage/Tests/OwnerCoreTests/Fixtures/PBE144SyntheticOpenAI"
        )

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "disposable-re-fixture"
        self.synthetic_env = patch.dict(
            os.environ,
            {"PBE_ENABLE_SYNTHETIC_VISUAL_REPAIR": "1"},
        )
        self.synthetic_env.start()

    def tearDown(self):
        self.synthetic_env.stop()
        self.temp.cleanup()

    def stage(self):
        return stage_fixture(
            self.root,
            self.fixture_root / "original.png",
            self.fixture_root / "proposed.png",
        )

    def test_stages_rendered_pair_with_hashes_and_read_only_draft(self):
        receipt = self.stage()
        self.assertTrue(receipt["syntheticOnly"])
        self.assertTrue(receipt["readOnlyComparison"])
        self.assertTrue(receipt["derivedAvailable"])
        self.assertEqual(receipt["status"], "draft")
        self.assertEqual(
            receipt["originalPreviewSha256"],
            hashlib.sha256((self.fixture_root / "original.png").read_bytes()).hexdigest(),
        )
        self.assertEqual(
            receipt["derivedSha256"],
            hashlib.sha256((self.fixture_root / "proposed.png").read_bytes()).hexdigest(),
        )
        with sqlite3.connect(self.root / "assets/owner-actions/Owner.sqlite") as conn:
            event_actions = [row[0] for row in conn.execute(
                "SELECT action FROM visual_repair_events ORDER BY created_at, rowid"
            )]
            self.assertEqual(event_actions, ["request", "materialize"])
            decision = conn.execute(
                "SELECT placement_state FROM fixture_asset_decisions WHERE asset_id = ? LIMIT 1",
                (receipt["assetId"],),
            ).fetchone()[0]
            self.assertEqual(decision, "picked")

    def test_list_reread_does_not_mutate_disposable_owner_database(self):
        receipt = self.stage()
        database = self.root / "assets/owner-actions/Owner.sqlite"
        before = hashlib.sha256(database.read_bytes()).hexdigest()
        listed = list_visual_repair_proposals(
            self.root,
            receipt["fixtureId"],
            asset_ids=[receipt["assetId"]],
        )
        after = hashlib.sha256(database.read_bytes()).hexdigest()
        self.assertEqual(before, after)
        self.assertEqual(listed["count"], 1)
        self.assertTrue(listed["items"][0]["derivedAvailable"])
        self.assertTrue(listed["items"][0]["originalPreviewReference"].startswith("file://"))
        self.assertTrue(listed["items"][0]["derivedReference"].startswith("file://"))

    def test_materialization_fails_closed_outside_fixture_root(self):
        receipt = self.stage()
        with self.assertRaisesRegex(ValueError, "inside the bounded fixture root"):
            materialize_visual_repair_proposal(
                self.root,
                receipt["proposalId"],
                self.fixture_root / "original.png",
                self.fixture_root / "proposed.png",
                provider_reference="openai-synthetic://built-in-imagegen/test",
            )

    def test_staging_never_replaces_an_existing_root(self):
        self.root.mkdir(parents=True)
        (self.root / "keep.txt").write_text("preserve", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "new or empty"):
            self.stage()
        self.assertEqual((self.root / "keep.txt").read_text(encoding="utf-8"), "preserve")


if __name__ == "__main__":
    unittest.main()
