import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixture_pipeline import (
    configure_asset_destinations,
    create_fixture,
    create_pool,
    delivery_plan,
    place_assets,
    publication_plan,
)
from fixture_policy import (
    SAFE_POLICY,
    apply_fixture_policy_migration,
    configure_fixture,
    effective_fixture_policy,
    plan_fixture_policy_migration,
)
from sidecar_state_db import upsert_assets


class FixturePolicyTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        upsert_assets(self.root, [{
            "localIdentifier": "asset-1",
            "filename": "A.JPG",
            "mediaType": "photo",
            "creationDate": "2026-07-26T10:00:00Z",
        }])

    def tearDown(self):
        self.temp.cleanup()

    def test_safe_default_and_template_contracts(self):
        plain = create_fixture(self.root, "Plain", fixture_id="plain")
        expo = create_fixture(
            self.root,
            "Expo",
            fixture_id="expo",
            template_key="expo",
        )
        self.assertEqual(
            effective_fixture_policy(self.root, plain["fixtureId"])["effective"],
            SAFE_POLICY,
        )
        self.assertEqual(
            effective_fixture_policy(self.root, expo["fixtureId"])["effective"],
            {
                "visibility": "public",
                "searchable": True,
                "retention": "public-preview",
                "delivery": "public",
                "download": False,
                "commerce": "retail",
            },
        )

    def test_child_inherits_then_overrides_one_dimension(self):
        parent = create_fixture(
            self.root,
            "RE",
            fixture_id="re",
            template_key="real-estate",
        )
        child = create_fixture(
            self.root,
            "La Concha",
            parent_fixture_id=parent["fixtureId"],
            fixture_id="la-concha",
        )
        inherited = effective_fixture_policy(self.root, child["fixtureId"])
        self.assertEqual(inherited["effective"]["commerce"], "paid-service")
        self.assertTrue(inherited["effective"]["download"])

        changed = configure_fixture(
            self.root,
            child["fixtureId"],
            policy_overrides={"commerce": "free-sharing"},
            actor="test",
            reason="family deal",
        )
        self.assertEqual(changed["policy"]["effective"]["commerce"], "free-sharing")
        self.assertTrue(changed["policy"]["effective"]["download"])
        self.assertEqual(changed["history"][0]["reason"], "family deal")

    def test_root_cannot_use_parent_subset_and_rule_mode_persists(self):
        root = create_fixture(self.root, "Root", fixture_id="root")
        with self.assertRaisesRegex(ValueError, "root fixtures"):
            configure_fixture(
                self.root,
                root["fixtureId"],
                population_mode="parent-subset",
            )
        configured = configure_fixture(
            self.root,
            root["fixtureId"],
            population_mode="rule-based",
            candidate_source={"kind": "photos-library"},
            saved_rule={"query": "Paris", "mediaTypes": ["photo"]},
        )
        self.assertEqual(configured["populationMode"], "rule-based")
        self.assertEqual(configured["savedRule"]["query"], "Paris")

    def test_snapshot_freezes_population_rule_and_effective_policy(self):
        fixture = create_fixture(
            self.root,
            "Expo",
            fixture_id="expo",
            template_key="expo",
        )
        configure_fixture(
            self.root,
            fixture["fixtureId"],
            population_mode="rule-based",
            saved_rule={"query": "Paris"},
        )
        pool = create_pool(
            self.root,
            fixture["fixtureId"],
            ["asset-1"],
            name="Paris snapshot",
        )
        self.assertEqual(pool["contract"]["populationMode"], "rule-based")
        self.assertEqual(pool["contract"]["savedRule"], {"query": "Paris"})
        self.assertTrue(pool["contract"]["effectivePolicy"]["searchable"])

        configure_fixture(
            self.root,
            fixture["fixtureId"],
            population_mode="curated",
            saved_rule={},
            policy_overrides={"searchable": False},
        )
        reopened = create_pool(
            self.root,
            fixture["fixtureId"],
            ["asset-1"],
            name="Same immutable snapshot",
        )
        self.assertEqual(reopened["poolId"], pool["poolId"])
        self.assertEqual(reopened["contract"]["populationMode"], "rule-based")
        self.assertEqual(reopened["contract"]["savedRule"], {"query": "Paris"})
        self.assertTrue(reopened["contract"]["effectivePolicy"]["searchable"])

    def test_plans_enforce_public_private_and_no_cloud_policies(self):
        expo = create_fixture(
            self.root,
            "Expo",
            fixture_id="fixture-expo",
            template_key="expo",
        )
        private = create_fixture(
            self.root,
            "RE",
            fixture_id="fixture-re",
            template_key="real-estate",
        )
        local = create_fixture(self.root, "Local only", fixture_id="local")
        for fixture in (expo, private, local):
            place_assets(self.root, fixture["fixtureId"], ["asset-1"])
            configure_asset_destinations(
                self.root,
                fixture["fixtureId"],
                ["asset-1"],
                ["r2", "apple_photos"],
            )

        self.assertEqual(publication_plan(self.root, expo["fixtureId"])["policy"]["commerce"], "retail")
        with self.assertRaisesRegex(ValueError, "does not permit"):
            publication_plan(self.root, private["fixtureId"])
        local_delivery = delivery_plan(self.root, local["fixtureId"])
        self.assertFalse(local_delivery["cloudAllowed"])
        self.assertTrue(local_delivery["deliveryAllowed"])
        self.assertFalse(local_delivery["downloadAllowed"])
        self.assertEqual(
            local_delivery["items"][0]["destinations"],
            ["apple_photos"],
        )

    def test_policy_migration_is_reversible_and_idempotent(self):
        expo = create_fixture(self.root, "Expo", fixture_id="fixture-expo")
        real_estate = create_fixture(self.root, "RE", fixture_id="fixture-re")
        la_concha = create_fixture(
            self.root,
            "La Concha",
            fixture_id="fixture-la-concha",
            parent_fixture_id=real_estate["fixtureId"],
        )
        family = create_fixture(
            self.root,
            "Friends and Family",
            fixture_id="fixture-family",
        )
        blood = create_fixture(
            self.root,
            "Blood",
            fixture_id="fixture-blood",
            parent_fixture_id=family["fixtureId"],
        )
        plan = plan_fixture_policy_migration(self.root)
        self.assertEqual(plan["targetCount"], 5)
        self.assertFalse(plan["alreadyApplied"])

        applied = apply_fixture_policy_migration(self.root, actor="test")
        self.assertTrue(applied["applied"])
        self.assertTrue(Path(applied["backupPath"]).exists())
        self.assertEqual(
            effective_fixture_policy(self.root, expo["fixtureId"])["effective"]["commerce"],
            "retail",
        )
        self.assertEqual(
            effective_fixture_policy(self.root, la_concha["fixtureId"])["effective"]["delivery"],
            "granted",
        )
        self.assertEqual(
            effective_fixture_policy(self.root, blood["fixtureId"])["effective"]["commerce"],
            "free-sharing",
        )

        replay = apply_fixture_policy_migration(self.root, actor="test")
        self.assertFalse(replay["applied"])
        self.assertTrue(replay["alreadyApplied"])


if __name__ == "__main__":
    unittest.main()
