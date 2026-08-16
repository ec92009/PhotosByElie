import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

import owner_state_db
import local_server
from fixture_pipeline import create_fixture, set_fixture_asset_state
from sidecar_state_db import connect, upsert_assets
from visual_repair_proposals import (
    VISUAL_REPAIR_CATEGORIES,
    decide_visual_repair_proposal,
    list_visual_repair_proposals,
    request_visual_repair_proposal,
)


class VisualRepairProposalsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.synthetic_env = patch.dict(
            os.environ,
            {"PBE_ENABLE_SYNTHETIC_VISUAL_REPAIR": "1"},
        )
        self.synthetic_env.start()
        upsert_assets(self.root, [{
            "localIdentifier": "asset-1",
            "filename": "Synthetic RE photo.jpg",
            "mediaType": "photo",
            "creationDate": "2026-08-01T10:00:00Z",
            "title": "Original title",
            "keywords": ["Original keyword"],
        }])
        self.re = create_fixture(
            self.root,
            "RE",
            fixture_id="fixture-re",
            template_key="real-estate",
        )
        self.child = create_fixture(
            self.root,
            "La Concha",
            parent_fixture_id=self.re["fixtureId"],
            fixture_id="fixture-la-concha",
        )
        self.expo = create_fixture(self.root, "Expo", fixture_id="fixture-expo")
        set_fixture_asset_state(self.root, self.re["fixtureId"], ["asset-1"], "picked")
        set_fixture_asset_state(self.root, self.child["fixtureId"], ["asset-1"], "picked")
        with connect(self.root) as conn:
            conn.execute(
                """
                INSERT INTO asset_source_versions (
                  version_id, asset_id, metadata_fingerprint, rendered_fingerprint,
                  source_exists, state, created_at
                ) VALUES ('source-v1', 'asset-1', 'metadata-1', 'rendered-1', 1, 'approved', '2026-08-01T10:00:00Z')
                """
            )
            conn.commit()

    def tearDown(self):
        self.synthetic_env.stop()
        self.temp.cleanup()

    def request(self, *, categories=None, key="request-1", attempt_time="2026-08-09T10:00:00Z"):
        return request_visual_repair_proposal(
            self.root,
            self.child["fixtureId"],
            "asset-1",
            "source-v1",
            categories or list(VISUAL_REPAIR_CATEGORIES),
            generator="synthetic",
            idempotency_key=key,
            generated_at=attempt_time,
        )

    def test_each_initial_defect_category_is_normalized_and_audited(self):
        for index, category in enumerate(VISUAL_REPAIR_CATEGORIES):
            proposal = self.request(categories=[category], key=f"category-{index}")
            self.assertEqual(proposal["defectCategories"], [category])
            self.assertEqual(proposal["defectCategoryLabels"], [
                {
                    "lighting-exposure": "Lighting / exposure",
                    "contrast": "Contrast",
                    "white-balance-color": "White balance / color",
                    "perspective-geometry": "Perspective / geometry",
                    "distracting-items": "Distracting items",
                }[category]
            ])
            self.assertEqual(proposal["sourceVersionId"], "source-v1")
            self.assertTrue(proposal["originalReference"].endswith("source-v1"))
            self.assertTrue(proposal["derivedReference"].startswith("synthetic://"))
            self.assertEqual(proposal["status"], "draft")
            self.assertTrue(proposal["readOnlyComparison"])

    def test_re_scope_requires_re_root_and_allows_descendants(self):
        proposal = self.request(key="descendant-request")
        self.assertEqual(proposal["fixtureId"], "fixture-la-concha")
        with self.assertRaisesRegex(ValueError, "RE fixture subtree"):
            request_visual_repair_proposal(
                self.root,
                self.expo["fixtureId"],
                "asset-1",
                "source-v1",
                ["contrast"],
                generator="synthetic",
                idempotency_key="wrong-root",
            )

    def test_persistence_reread_and_read_only_list_preserve_identity(self):
        proposal = self.request(key="persist-request")
        before = self._state_snapshot()
        listed = list_visual_repair_proposals(
            self.root,
            self.child["fixtureId"],
            asset_ids=["asset-1"],
        )
        after = self._state_snapshot()
        self.assertEqual(before, after)
        self.assertEqual(listed["count"], 1)
        self.assertEqual(listed["items"][0]["proposalId"], proposal["proposalId"])
        self.assertEqual(listed["items"][0]["sourceVersionId"], "source-v1")

    def test_missing_or_mismatched_source_version_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "source version"):
            request_visual_repair_proposal(
                self.root,
                self.child["fixtureId"],
                "asset-1",
                "source-v2",
                ["contrast"],
                generator="synthetic",
                idempotency_key="missing-version",
            )

    def test_reject_regenerate_and_accept_are_auditable_and_idempotent(self):
        rejected = self.request(key="reject-request")
        self.assertFalse(rejected["derivedAvailable"])
        rejected_again = decide_visual_repair_proposal(
            self.root,
            rejected["proposalId"],
            "reject",
            fixture_id=self.child["fixtureId"],
            reason="Not a useful repair idea",
            idempotency_key="reject-decision",
            generated_at="2026-08-09T10:01:00Z",
        )
        rejected_replay = decide_visual_repair_proposal(
            self.root,
            rejected["proposalId"],
            "reject",
            fixture_id=self.child["fixtureId"],
            idempotency_key="reject-decision",
        )
        self.assertEqual(rejected_again["status"], "rejected")
        self.assertFalse(rejected_again["derivedAvailable"])
        self.assertTrue(rejected_replay["idempotentReplay"])

        regenerated = decide_visual_repair_proposal(
            self.root,
            rejected["proposalId"],
            "regenerate",
            fixture_id=self.child["fixtureId"],
            generator="synthetic",
            idempotency_key="regenerate-decision",
            generated_at="2026-08-09T10:02:00Z",
        )
        regenerated_replay = decide_visual_repair_proposal(
            self.root,
            rejected["proposalId"],
            "regenerate",
            fixture_id=self.child["fixtureId"],
            generator="synthetic",
            idempotency_key="regenerate-decision",
        )
        self.assertNotEqual(regenerated["proposalId"], rejected["proposalId"])
        self.assertEqual(regenerated["previousProposalId"], rejected["proposalId"])
        self.assertEqual(regenerated["attempt"], 2)
        self.assertEqual(regenerated["sourceVersionId"], "source-v1")
        self.assertFalse(regenerated["derivedAvailable"])
        self.assertEqual(regenerated_replay["proposalId"], regenerated["proposalId"])
        self.assertTrue(regenerated_replay["idempotentReplay"])

        with self.assertRaisesRegex(ValueError, "rendered derived image"):
            decide_visual_repair_proposal(
                self.root,
                regenerated["proposalId"],
                "accept",
                fixture_id=self.child["fixtureId"],
                idempotency_key="accept-blocked",
            )

        with connect(self.root) as conn:
            conn.execute(
                "UPDATE visual_repair_proposals SET derived_available = 1 WHERE proposal_id = ?",
                (regenerated["proposalId"],),
            )
            conn.commit()

        accepted = decide_visual_repair_proposal(
            self.root,
            regenerated["proposalId"],
            "accept",
            fixture_id=self.child["fixtureId"],
            idempotency_key="accept-decision",
            generated_at="2026-08-09T10:03:00Z",
        )
        accepted_replay = decide_visual_repair_proposal(
            self.root,
            regenerated["proposalId"],
            "accept",
            fixture_id=self.child["fixtureId"],
            idempotency_key="accept-decision",
        )
        self.assertEqual(accepted["status"], "accepted")
        self.assertTrue(accepted["derivedAvailable"])
        self.assertTrue(accepted_replay["idempotentReplay"])

        with connect(self.root) as conn:
            events = conn.execute(
                "SELECT action, before_status, after_status FROM visual_repair_events ORDER BY created_at, event_id"
            ).fetchall()
            self.assertEqual(
                [(row[0], row[1], row[2]) for row in events],
                [
                    ("request", "", "draft"),
                    ("reject", "draft", "rejected"),
                    ("regenerate", "rejected", "draft"),
                    ("accept", "draft", "accepted"),
                ],
            )

    def test_visual_path_does_not_change_title_keyword_ratings_editorial_or_delivery_state(self):
        with connect(self.root) as conn:
            before = conn.execute(
                """
                SELECT d.title, d.keywords_json, d.rating, d.color,
                       e.editorial_state, e.ai_attempt_count, delivery.delivery_state
                FROM sidecar_decisions AS d
                JOIN asset_editorial_state AS e ON e.asset_id = d.asset_id
                JOIN asset_delivery_state AS delivery ON delivery.asset_id = d.asset_id
                WHERE d.asset_id = 'asset-1'
                """
            ).fetchone()
        proposal = self.request(key="independence-request")
        with connect(self.root) as conn:
            conn.execute(
                "UPDATE visual_repair_proposals SET derived_available = 1 WHERE proposal_id = ?",
                (proposal["proposalId"],),
            )
            conn.commit()
        decide_visual_repair_proposal(
            self.root,
            proposal["proposalId"],
            "accept",
            fixture_id=self.child["fixtureId"],
            idempotency_key="independence-accept",
        )
        with connect(self.root) as conn:
            after = conn.execute(
                """
                SELECT d.title, d.keywords_json, d.rating, d.color,
                       e.editorial_state, e.ai_attempt_count, delivery.delivery_state
                FROM sidecar_decisions AS d
                JOIN asset_editorial_state AS e ON e.asset_id = d.asset_id
                JOIN asset_delivery_state AS delivery ON delivery.asset_id = d.asset_id
                WHERE d.asset_id = 'asset-1'
                """
            ).fetchone()
            self.assertEqual(tuple(before), tuple(after))
            self.assertEqual(
                conn.execute(
                    "SELECT count(*) FROM asset_ai_proposals WHERE asset_id = 'asset-1'"
                ).fetchone()[0],
                0,
            )

    def test_visual_path_reads_the_existing_title_keyword_ladder_without_changing_it(self):
        with owner_state_db.connect(self.root) as conn:
            owner_state_db.save_title_keyword_model_ladder(
                self.root,
                [
                    {"model": "gpt-5.6-luna", "effort": "max", "vision": True},
                    {"model": "gpt-5.4-mini", "effort": "low", "vision": True},
                ],
                conn=conn,
            )
            before = owner_state_db.title_keyword_model_ladder_for_connection(conn)
        proposal = self.request(key="ladder-request")
        self.assertEqual(proposal["ladderRung"], 1)
        self.assertEqual(proposal["resolvedModel"], "gpt-5.6-luna")
        with owner_state_db.connect(self.root) as conn:
            self.assertEqual(owner_state_db.title_keyword_model_ladder_for_connection(conn), before)

    def test_synthetic_generator_has_an_explicit_gate(self):
        with patch.dict(os.environ, {"PBE_ENABLE_SYNTHETIC_VISUAL_REPAIR": "0"}):
            with self.assertRaisesRegex(ValueError, "synthetic visual generation is disabled"):
                self.request(key="disabled-generator")

    def test_connector_routes_visual_request_list_and_decision_modes(self):
        requested = local_server.new_owner_connector_result(
            self.root,
            self._connector_action(
                "fixture-visual-repair-proposal-request",
                fixtureId=self.child["fixtureId"],
                assetId="asset-1",
                sourceVersionId="source-v1",
                defectCategories=["lighting-exposure"],
                generator="synthetic",
                idempotencyKey="connector-request",
            ),
        )
        self.assertFalse(requested["result"]["readOnly"])
        proposal_id = requested["result"]["visualRepairProposal"]["proposalId"]
        before = self._state_snapshot()
        listed = local_server.new_owner_connector_result(
            self.root,
            self._connector_action(
                "fixture-visual-repair-proposal-list",
                fixtureId=self.child["fixtureId"],
                assetIds=["asset-1"],
            ),
        )
        after = self._state_snapshot()
        self.assertTrue(listed["result"]["readOnly"])
        self.assertEqual(before, after)
        self.assertEqual(
            listed["result"]["visualRepairProposals"]["items"][0]["proposalId"],
            proposal_id,
        )
        decided = local_server.new_owner_connector_result(
            self.root,
            self._connector_action(
                "fixture-visual-repair-proposal-decide",
                fixtureId=self.child["fixtureId"],
                proposalId=proposal_id,
                decision="reject",
                idempotencyKey="connector-reject",
            ),
        )
        self.assertFalse(decided["result"]["readOnly"])
        self.assertEqual(
            decided["result"]["visualRepairProposal"]["status"],
            "rejected",
        )

    @staticmethod
    def _connector_action(mode, **manifest):
        return {
            "connectorId": "max",
            "action": {
                "id": f"action-{mode}",
                "type": "sidecar-culling-review",
                "state": "claimed",
                "claim": {"connectorId": "max"},
                "payload": {"manifest": {"mode": mode, **manifest}},
            },
        }

    def _state_snapshot(self):
        database = self.root / "assets/owner-actions/Owner.sqlite"
        with connect(self.root) as conn:
            rows = conn.execute(
                """
                SELECT d.title, d.keywords_json, d.rating, d.color,
                       e.editorial_state, e.ai_attempt_count, delivery.delivery_state
                FROM sidecar_decisions AS d
                JOIN asset_editorial_state AS e ON e.asset_id = d.asset_id
                JOIN asset_delivery_state AS delivery ON delivery.asset_id = d.asset_id
                WHERE d.asset_id = 'asset-1'
                """
            ).fetchone()
            visual_schema = conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'visual_repair_%' ORDER BY name"
            ).fetchall()
        return hashlib.sha256(database.read_bytes()).hexdigest(), tuple(rows), tuple(row[0] for row in visual_schema)


if __name__ == "__main__":
    unittest.main()
