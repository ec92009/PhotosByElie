import tempfile
import unittest
import json
import hashlib
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fixture_pipeline import (
    apply_fixture_state_migration,
    apply_pool_refresh,
    adopt_upload_run,
    archive_fixture,
    configure_asset_destinations,
    create_fixture,
    create_pool,
    delivery_plan,
    fixture_tree,
    fixture_candidate_asset_ids,
    fixture_culling_window,
    fixture_review_window,
    apply_fixture_review_action,
    undo_fixture_review_action,
    ai_preview_targets,
    ai_run_status,
    effective_fixture_access_grants,
    list_pools,
    list_placements,
    link_access_grant,
    migrate_access_fixture_tree,
    migrate_la_concha_tree,
    move_fixture,
    move_placement,
    place_assets,
    plan_fixture_state_migration,
    plan_upload_run_adoption,
    preview_pool_refresh,
    remove_placement,
    rename_fixture,
    record_r2_upload_results,
    ready_ai_proposals,
    mark_ai_proposals_loaded,
    record_ai_preview,
    record_source_batch,
    reopen_fixture,
    restore_placement,
    search_assets,
    set_fixture_asset_state,
    editorial_version_hash,
)
from requested_ai_proposal_pass import run_requested_ai_pass
from sidecar_state_db import connect, record_decision, upsert_assets


class FixturePipelineTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        upsert_assets(self.root, [
            {"localIdentifier": "asset-1", "filename": "A.JPG", "mediaType": "photo", "creationDate": "2026-07-15T10:00:00Z", "keywords": ["La Concha"]},
            {"localIdentifier": "asset-2", "filename": "B.MOV", "mediaType": "video", "creationDate": "2026-07-15T10:01:00Z"},
            {"localIdentifier": "asset-3", "filename": "C.JPG", "mediaType": "photo", "creationDate": "2026-07-16T10:00:00Z"},
        ])

    def tearDown(self):
        self.temp.cleanup()

    def test_recursive_tree_keeps_stable_ids_and_rejects_cycles(self):
        root = create_fixture(self.root, "RE", fixture_id="root")
        fixture = create_fixture(self.root, "La Concha", parent_fixture_id=root["fixtureId"], fixture_id="la-concha")
        child = create_fixture(self.root, "Apartment 1", parent_fixture_id=fixture["fixtureId"], fixture_id="apt-1")
        database = self.root / "assets/owner-actions/Owner.sqlite"
        before = hashlib.sha256(database.read_bytes()).hexdigest()
        self.assertEqual(
            fixture_tree(self.root)[0]["children"][0]["children"][0]["fixtureId"],
            child["fixtureId"],
        )
        self.assertEqual(hashlib.sha256(database.read_bytes()).hexdigest(), before)
        with self.assertRaisesRegex(ValueError, "descendants"):
            move_fixture(self.root, root["fixtureId"], child["fixtureId"])
        renamed = rename_fixture(self.root, fixture["fixtureId"], "La Concha renamed")
        self.assertEqual(renamed["fixtureId"], "la-concha")
        self.assertEqual(renamed["name"], "La Concha renamed")
        self.assertTrue(archive_fixture(self.root, fixture["fixtureId"])["archivedAt"])
        self.assertFalse(reopen_fixture(self.root, fixture["fixtureId"])["archivedAt"])

    def test_fixture_state_migration_is_read_only_then_backed_up_and_reversible(self):
        expo = create_fixture(self.root, "Expo", fixture_id="fixture-expo")
        parent = create_fixture(self.root, "RE", fixture_id="fixture-re")
        child = create_fixture(
            self.root,
            "La Concha",
            parent_fixture_id=parent["fixtureId"],
            fixture_id="fixture-la-concha",
        )
        record_decision(self.root, {"assetId": "asset-1", "action": "pick"})
        record_decision(self.root, {"assetId": "asset-2", "action": "reject"})
        place_assets(self.root, child["fixtureId"], ["asset-3"])
        database = self.root / "assets/owner-actions/Owner.sqlite"
        before_hash = hashlib.sha256(database.read_bytes()).hexdigest()

        plan = plan_fixture_state_migration(self.root)
        self.assertEqual(hashlib.sha256(database.read_bytes()).hexdigest(), before_hash)
        self.assertEqual(plan["legacyExpoPicked"], 1)
        self.assertEqual(plan["legacyExpoHidden"], 1)
        self.assertEqual(plan["explicitPlacementCount"], 1)
        self.assertEqual(plan["ancestorClosureCount"], 2)
        self.assertFalse(plan["applied"])

        receipt = apply_fixture_state_migration(self.root)
        self.assertTrue(receipt["applied"])
        self.assertTrue(Path(receipt["backupPath"]).exists())
        self.assertTrue(Path(receipt["receiptPath"]).exists())
        self.assertEqual(receipt["globalEditorialMutationCount"], 0)
        with connect(self.root) as conn:
            rows = {
                (row["fixture_id"], row["asset_id"]): (
                    row["placement_state"],
                    row["eligibility_state"],
                )
                for row in conn.execute(
                    """
                    SELECT fixture_id, asset_id, placement_state, eligibility_state
                    FROM fixture_asset_decisions
                    """
                ).fetchall()
            }
            self.assertEqual(rows[(expo["fixtureId"], "asset-1")], ("picked", "active"))
            self.assertEqual(rows[(expo["fixtureId"], "asset-2")], ("hidden", "active"))
            self.assertEqual(rows[(parent["fixtureId"], "asset-3")], ("picked", "active"))
            self.assertEqual(rows[(child["fixtureId"], "asset-3")], ("picked", "active"))
            self.assertEqual(
                conn.execute(
                    "SELECT metadata_state FROM sidecar_decisions WHERE asset_id = 'asset-1'"
                ).fetchone()[0],
                "unreviewed",
            )
        replayed = apply_fixture_state_migration(self.root)
        self.assertTrue(replayed["idempotencyReplayed"])

    def test_fixture_universes_preserve_dormant_child_decisions(self):
        parent = create_fixture(self.root, "Root", fixture_id="root")
        child = create_fixture(
            self.root,
            "Child",
            parent_fixture_id=parent["fixtureId"],
            fixture_id="child",
        )
        changed = set_fixture_asset_state(
            self.root,
            parent["fixtureId"],
            ["asset-1"],
            "picked",
        )
        self.assertEqual(
            changed["items"][0]["before_placement_state"],
            "undecided",
        )
        set_fixture_asset_state(self.root, child["fixtureId"], ["asset-1"], "picked")
        self.assertIn("asset-1", fixture_candidate_asset_ids(self.root, child["fixtureId"]))

        set_fixture_asset_state(self.root, parent["fixtureId"], ["asset-1"], "hidden")
        self.assertNotIn("asset-1", fixture_candidate_asset_ids(self.root, child["fixtureId"]))
        with connect(self.root) as conn:
            child_state = conn.execute(
                """
                SELECT placement_state, eligibility_state
                FROM fixture_asset_decisions
                WHERE fixture_id = 'child' AND asset_id = 'asset-1'
                """
            ).fetchone()
            self.assertEqual(tuple(child_state), ("picked", "dormant"))

        set_fixture_asset_state(self.root, parent["fixtureId"], ["asset-1"], "picked")
        self.assertIn("asset-1", fixture_candidate_asset_ids(self.root, child["fixtureId"]))
        self.assertEqual(
            fixture_candidate_asset_ids(self.root, parent["fixtureId"]),
            ["asset-3", "asset-2", "asset-1"],
        )

    def test_root_culling_window_is_newest_first_and_backfills_after_decisions(self):
        fixture = create_fixture(self.root, "Root", fixture_id="root")
        first = fixture_culling_window(self.root, fixture["fixtureId"], limit=2)
        self.assertEqual(
            [item["assetId"] for item in first["items"]],
            ["asset-3", "asset-2"],
        )
        self.assertEqual(first["summary"]["universe"], 3)
        self.assertEqual(first["summary"]["undecided"], 3)
        self.assertTrue(first["hasNext"])

        set_fixture_asset_state(
            self.root,
            fixture["fixtureId"],
            ["asset-3"],
            "picked",
        )
        backfilled = fixture_culling_window(self.root, fixture["fixtureId"], limit=2)
        self.assertEqual(
            [item["assetId"] for item in backfilled["items"]],
            ["asset-2", "asset-1"],
        )
        self.assertEqual(backfilled["summary"]["universe"], 3)
        self.assertEqual(backfilled["summary"]["undecided"], 2)
        self.assertEqual(backfilled["summary"]["picked"], 1)
        self.assertFalse(backfilled["hasNext"])

    def test_child_culling_window_uses_parent_picks_and_full_universe_search(self):
        parent = create_fixture(self.root, "Root", fixture_id="root")
        child = create_fixture(
            self.root,
            "Child",
            parent_fixture_id=parent["fixtureId"],
            fixture_id="child",
        )
        set_fixture_asset_state(
            self.root,
            parent["fixtureId"],
            ["asset-1", "asset-2"],
            "picked",
        )
        child_window = fixture_culling_window(self.root, child["fixtureId"])
        self.assertEqual(
            [item["assetId"] for item in child_window["items"]],
            ["asset-2", "asset-1"],
        )
        self.assertEqual(child_window["candidateMode"], "inherited")

        searched = fixture_culling_window(
            self.root,
            child["fixtureId"],
            search="A.JPG",
            limit=1,
        )
        self.assertEqual([item["assetId"] for item in searched["items"]], ["asset-1"])
        set_fixture_asset_state(
            self.root,
            parent["fixtureId"],
            ["asset-1"],
            "hidden",
        )
        self.assertEqual(
            fixture_culling_window(
                self.root,
                child["fixtureId"],
                search="A.JPG",
            )["items"],
            [],
        )

    def test_review_is_oldest_first_and_global_approval_removes_every_queue(self):
        root = create_fixture(self.root, "Root", fixture_id="root")
        child = create_fixture(
            self.root,
            "Child",
            parent_fixture_id=root["fixtureId"],
            fixture_id="child",
        )
        set_fixture_asset_state(
            self.root,
            root["fixtureId"],
            ["asset-1", "asset-2", "asset-3"],
            "picked",
        )
        set_fixture_asset_state(
            self.root,
            child["fixtureId"],
            ["asset-1", "asset-2"],
            "picked",
        )
        self.assertEqual(
            [item["assetId"] for item in fixture_review_window(self.root, root["fixtureId"])["items"]],
            ["asset-1", "asset-2", "asset-3"],
        )
        apply_fixture_review_action(
            self.root,
            root["fixtureId"],
            ["asset-1"],
            "approve",
            title="Approved globally",
            keywords=["Family"],
        )
        self.assertEqual(
            [item["assetId"] for item in fixture_review_window(self.root, root["fixtureId"])["items"]],
            ["asset-2", "asset-3"],
        )
        self.assertEqual(
            [item["assetId"] for item in fixture_review_window(self.root, child["fixtureId"])["items"]],
            ["asset-2"],
        )
        with connect(self.root) as conn:
            self.assertEqual(
                conn.execute(
                    "SELECT placement_state FROM fixture_asset_decisions WHERE fixture_id = 'root' AND asset_id = 'asset-1'"
                ).fetchone()[0],
                "picked",
            )
            self.assertEqual(
                conn.execute(
                    "SELECT delivery_state FROM asset_delivery_state WHERE asset_id = 'asset-1'"
                ).fetchone()[0],
                "needs-upload",
            )

    def test_review_modes_separate_unresolved_backfill_from_full_queue(self):
        root = create_fixture(self.root, "Root", fixture_id="root")
        set_fixture_asset_state(
            self.root,
            root["fixtureId"],
            ["asset-1", "asset-2"],
            "picked",
        )
        apply_fixture_review_action(
            self.root,
            root["fixtureId"],
            ["asset-1"],
            "approve",
        )

        backfill = fixture_review_window(
            self.root,
            root["fixtureId"],
            mode="backfill",
        )
        self.assertEqual(backfill["mode"], "backfill")
        self.assertEqual(
            [item["assetId"] for item in backfill["items"]],
            ["asset-2"],
        )
        self.assertEqual(backfill["summary"]["approved"], 0)

        full = fixture_review_window(
            self.root,
            root["fixtureId"],
            mode="full",
        )
        self.assertEqual(full["mode"], "full")
        self.assertEqual(
            [item["assetId"] for item in full["items"]],
            ["asset-1", "asset-2"],
        )
        self.assertEqual(full["summary"]["approved"], 1)
        with self.assertRaisesRegex(ValueError, "review mode is invalid"):
            fixture_review_window(
                self.root,
                root["fixtureId"],
                mode="everything",
            )

    def test_review_hide_is_fixture_local_and_ai_request_is_mutually_exclusive(self):
        root = create_fixture(self.root, "Root", fixture_id="root")
        other = create_fixture(self.root, "Other", fixture_id="other")
        for fixture_id in (root["fixtureId"], other["fixtureId"]):
            set_fixture_asset_state(self.root, fixture_id, ["asset-1"], "picked")
        requested = apply_fixture_review_action(
            self.root,
            root["fixtureId"],
            ["asset-1"],
            "request-ai",
            ai_reasons=["weak title", "missing location"],
            ai_note="Use the visible landmark.",
        )
        self.assertEqual(requested["items"][0]["after"]["editorialState"], "requesting-ai")
        hidden = apply_fixture_review_action(
            self.root,
            root["fixtureId"],
            ["asset-1"],
            "hide",
        )
        self.assertEqual(hidden["items"][0]["after"]["editorialState"], "unreviewed")
        self.assertEqual(hidden["items"][0]["after"]["aiReasons"], [])
        with connect(self.root) as conn:
            states = {
                row["fixture_id"]: row["placement_state"]
                for row in conn.execute(
                    "SELECT fixture_id, placement_state FROM fixture_asset_decisions WHERE asset_id = 'asset-1'"
                ).fetchall()
            }
        self.assertEqual(states["root"], "hidden")
        self.assertEqual(states["other"], "picked")
        cleared = apply_fixture_review_action(
            self.root,
            other["fixtureId"],
            ["asset-1"],
            "request-ai",
            ai_reasons=[],
        )
        self.assertEqual(cleared["items"][0]["after"]["editorialState"], "unreviewed")

    def test_requested_ai_pass_keeps_proposals_separate_and_is_one_attempt_per_pass(self):
        root = create_fixture(self.root, "Root", fixture_id="root")
        set_fixture_asset_state(self.root, root["fixtureId"], ["asset-1", "asset-2"], "picked")
        apply_fixture_review_action(
            self.root,
            root["fixtureId"],
            ["asset-1", "asset-2"],
            "request-ai",
            ai_reasons=["weak title"],
            ai_note="Use the visible subject.",
        )
        targets = ai_preview_targets(self.root, ["asset-1", "asset-2"])
        self.assertEqual({item["assetId"] for item in targets}, {"asset-1", "asset-2"})
        for target in targets:
            preview = self.root / f"{target['assetId']}.jpg"
            preview.write_bytes(f"preview-{target['assetId']}".encode())
            record_ai_preview(self.root, target["assetId"], preview)

        attempts = []
        def fake_proposer(item):
            attempts.append(item["assetId"])
            if item["assetId"] == "asset-2":
                raise RuntimeError("temporary model failure")
            return {
                "title": "Visible family scene",
                "keywords": ["Family", "Portrait"],
                "confidence": "high",
                "reason": "Visible people support the proposal.",
                "needs_owner_context": False,
            }

        result = run_requested_ai_pass(
            self.root,
            trigger="test",
            proposer=fake_proposer,
        )
        self.assertEqual(result["proposed"], 1)
        self.assertEqual(result["failed"], 1)
        self.assertEqual(attempts, ["asset-1", "asset-2"])
        proposals = ready_ai_proposals(self.root)
        self.assertEqual(proposals["count"], 1)
        self.assertEqual(proposals["items"][0]["proposedTitle"], "Visible family scene")
        self.assertEqual(proposals["items"][0]["canonicalTitle"], "")
        proposal_id = proposals["items"][0]["proposalId"]
        loaded = mark_ai_proposals_loaded(self.root, [proposal_id])
        self.assertEqual(loaded["count"], 1)
        self.assertEqual(ready_ai_proposals(self.root)["count"], 0)
        durable_drafts = ready_ai_proposals(self.root, include_loaded=True)
        self.assertEqual(durable_drafts["count"], 1)
        self.assertEqual(durable_drafts["items"][0]["status"], "loaded")
        with connect(self.root) as conn:
            states = {
                row["asset_id"]: (
                    row["editorial_state"],
                    row["ai_attempt_count"],
                    row["ai_last_error"],
                )
                for row in conn.execute(
                    """
                    SELECT asset_id, editorial_state, ai_attempt_count, ai_last_error
                    FROM asset_editorial_state
                    WHERE asset_id IN ('asset-1', 'asset-2')
                    """
                ).fetchall()
            }
        self.assertEqual(states["asset-1"][:2], ("proposed", 1))
        self.assertEqual(states["asset-2"][:2], ("requesting-ai", 1))
        self.assertIn("temporary model failure", states["asset-2"][2])
        status = ai_run_status(self.root)
        self.assertFalse(status["active"])
        self.assertEqual(status["ready"], 0)

        retried = run_requested_ai_pass(
            self.root,
            trigger="test",
            proposer=lambda item: {
                "title": "Recovered proposal",
                "keywords": ["Recovered"],
                "confidence": "medium",
                "reason": "Retry succeeded.",
                "needs_owner_context": False,
            },
        )
        self.assertEqual(retried["requested"], 1)
        self.assertEqual(retried["proposed"], 1)
        apply_fixture_review_action(
            self.root,
            root["fixtureId"],
            ["asset-1"],
            "edit-metadata",
            title="Owner accepted draft",
            keywords=["Accepted"],
        )
        with connect(self.root) as conn:
            self.assertEqual(
                conn.execute(
                    "SELECT ai_attempt_count FROM asset_editorial_state WHERE asset_id = 'asset-2'"
                ).fetchone()[0],
                2,
            )
            accepted = conn.execute(
                "SELECT status FROM asset_ai_proposals WHERE proposal_id = ?",
                (proposal_id,),
            ).fetchone()[0]
        self.assertEqual(accepted, "accepted")

    def test_review_propagation_crosses_visible_page_with_two_hour_boundary(self):
        upsert_assets(self.root, [
            {
                "localIdentifier": "asset-4",
                "filename": "D.JPG",
                "mediaType": "photo",
                "creationDate": "2026-07-15T11:59:00Z",
            },
            {
                "localIdentifier": "asset-5",
                "filename": "E.JPG",
                "mediaType": "photo",
                "creationDate": "2026-07-15T12:01:00Z",
            },
        ])
        root = create_fixture(self.root, "Root", fixture_id="root")
        set_fixture_asset_state(
            self.root,
            root["fixtureId"],
            ["asset-1", "asset-2", "asset-4", "asset-5"],
            "picked",
        )
        propagated = apply_fixture_review_action(
            self.root,
            root["fixtureId"],
            ["asset-1"],
            "approve",
            anchor_asset_id="asset-1",
            propagate=True,
        )
        self.assertEqual(
            [item["assetId"] for item in propagated["items"]],
            ["asset-1", "asset-2", "asset-4"],
        )
        self.assertEqual(
            [item["assetId"] for item in fixture_review_window(self.root, root["fixtureId"])["items"]],
            ["asset-5"],
        )
        apply_fixture_review_action(
            self.root,
            root["fixtureId"],
            ["asset-4"],
            "edit-metadata",
            title="Shoot title",
            keywords=["One", "Two"],
        )
        with connect(self.root) as conn:
            self.assertEqual(
                conn.execute(
                    "SELECT editorial_state FROM asset_editorial_state WHERE asset_id = 'asset-4'"
                ).fetchone()[0],
                "approved",
            )
            self.assertEqual(
                conn.execute(
                    "SELECT delivery_state FROM asset_delivery_state WHERE asset_id = 'asset-4'"
                ).fetchone()[0],
                "needs-upload",
            )

    def test_review_propagation_is_fully_audited_and_batch_actions_are_atomic(self):
        root = create_fixture(self.root, "Root", fixture_id="root")
        set_fixture_asset_state(
            self.root,
            root["fixtureId"],
            ["asset-1", "asset-2"],
            "picked",
        )

        propagated = apply_fixture_review_action(
            self.root,
            root["fixtureId"],
            ["asset-1"],
            "approve",
            anchor_asset_id="asset-1",
            propagate=True,
        )
        self.assertEqual(
            [item["assetId"] for item in propagated["items"]],
            ["asset-1", "asset-2"],
        )
        with connect(self.root) as conn:
            audit_rows = conn.execute(
                """
                SELECT asset_id, action, before_state, after_state
                FROM asset_editorial_events
                WHERE fixture_id = ?
                ORDER BY asset_id
                """,
                (root["fixtureId"],),
            ).fetchall()
        self.assertEqual(
            [
                (
                    row["asset_id"],
                    row["action"],
                    row["before_state"],
                    row["after_state"],
                )
                for row in audit_rows
            ],
            [
                ("asset-1", "approve", "unreviewed", "approved"),
                ("asset-2", "approve", "unreviewed", "approved"),
            ],
        )

        other = create_fixture(self.root, "Other", fixture_id="other")
        set_fixture_asset_state(
            self.root,
            other["fixtureId"],
            ["asset-3"],
            "picked",
        )
        with self.assertRaisesRegex(ValueError, "asset is not indexed"):
            apply_fixture_review_action(
                self.root,
                other["fixtureId"],
                ["asset-3", "missing-asset"],
                "approve",
                anchor_asset_id="asset-3",
            )
        with connect(self.root) as conn:
            state = conn.execute(
                """
                SELECT editorial_state
                FROM asset_editorial_state
                WHERE asset_id = 'asset-3'
                """
            ).fetchone()[0]
            event_count = conn.execute(
                """
                SELECT COUNT(*)
                FROM asset_editorial_events
                WHERE fixture_id = ? AND asset_id = 'asset-3'
                """,
                (other["fixtureId"],),
            ).fetchone()[0]
        self.assertEqual(state, "unreviewed")
        self.assertEqual(event_count, 0)

    def test_review_undo_restores_exact_editorial_delivery_placement_and_proposals(self):
        root = create_fixture(self.root, "Root", fixture_id="root")
        other = create_fixture(self.root, "Other", fixture_id="other")
        for fixture_id in (root["fixtureId"], other["fixtureId"]):
            set_fixture_asset_state(
                self.root,
                fixture_id,
                ["asset-1"],
                "picked",
            )
        timestamp = "2026-07-15T12:00:00Z"
        with connect(self.root) as conn:
            conn.execute(
                """
                UPDATE sidecar_decisions
                SET metadata_state = 'proposed', title = 'Before title',
                    keywords_json = '["Before"]', last_action = 'metadata',
                    updated_at = ?
                WHERE asset_id = 'asset-1'
                """,
                (timestamp,),
            )
            conn.execute(
                """
                UPDATE asset_editorial_state
                SET editorial_state = 'proposed', proposed_at = ?, updated_at = ?
                WHERE asset_id = 'asset-1'
                """,
                (timestamp, timestamp),
            )
            conn.execute(
                """
                UPDATE asset_delivery_state
                SET delivery_state = 'failed', source_version_hash = 'before-hash',
                    last_error = 'before error', updated_at = ?
                WHERE asset_id = 'asset-1'
                """,
                (timestamp,),
            )
            conn.execute(
                """
                INSERT INTO asset_ai_proposals (
                  proposal_id, asset_id, run_id, attempt, status,
                  proposed_title, created_at
                ) VALUES (
                  'proposal-1', 'asset-1', 'run-1', 1, 'ready',
                  'Draft title', ?
                )
                """,
                (timestamp,),
            )
            conn.commit()
            expected_before = {
                "decision": dict(
                    conn.execute(
                        "SELECT * FROM sidecar_decisions WHERE asset_id = 'asset-1'"
                    ).fetchone()
                ),
                "editorial": dict(
                    conn.execute(
                        "SELECT * FROM asset_editorial_state WHERE asset_id = 'asset-1'"
                    ).fetchone()
                ),
                "delivery": dict(
                    conn.execute(
                        "SELECT * FROM asset_delivery_state WHERE asset_id = 'asset-1'"
                    ).fetchone()
                ),
                "fixtureDecisions": [
                    dict(row)
                    for row in conn.execute(
                        """
                        SELECT *
                        FROM fixture_asset_decisions
                        WHERE asset_id = 'asset-1'
                        ORDER BY fixture_id
                        """
                    ).fetchall()
                ],
                "proposals": [
                    dict(row)
                    for row in conn.execute(
                        """
                        SELECT *
                        FROM asset_ai_proposals
                        WHERE asset_id = 'asset-1'
                        ORDER BY proposal_id
                        """
                    ).fetchall()
                ],
            }

        applied = apply_fixture_review_action(
            self.root,
            root["fixtureId"],
            ["asset-1"],
            "approve",
            title="Approved title",
            keywords=["Approved"],
        )
        self.assertTrue(applied["operationId"].startswith("reviewop-"))
        with connect(self.root) as conn:
            self.assertEqual(
                conn.execute(
                    "SELECT status FROM asset_ai_proposals WHERE proposal_id = 'proposal-1'"
                ).fetchone()[0],
                "superseded",
            )
            self.assertEqual(
                conn.execute(
                    "SELECT delivery_state FROM asset_delivery_state WHERE asset_id = 'asset-1'"
                ).fetchone()[0],
                "needs-upload",
            )

        undone = undo_fixture_review_action(
            self.root,
            applied["operationId"],
        )
        self.assertFalse(undone["alreadyUndone"])
        self.assertEqual(undone["count"], 1)
        with connect(self.root) as conn:
            actual_after = {
                "decision": dict(
                    conn.execute(
                        "SELECT * FROM sidecar_decisions WHERE asset_id = 'asset-1'"
                    ).fetchone()
                ),
                "editorial": dict(
                    conn.execute(
                        "SELECT * FROM asset_editorial_state WHERE asset_id = 'asset-1'"
                    ).fetchone()
                ),
                "delivery": dict(
                    conn.execute(
                        "SELECT * FROM asset_delivery_state WHERE asset_id = 'asset-1'"
                    ).fetchone()
                ),
                "fixtureDecisions": [
                    dict(row)
                    for row in conn.execute(
                        """
                        SELECT *
                        FROM fixture_asset_decisions
                        WHERE asset_id = 'asset-1'
                        ORDER BY fixture_id
                        """
                    ).fetchall()
                ],
                "proposals": [
                    dict(row)
                    for row in conn.execute(
                        """
                        SELECT *
                        FROM asset_ai_proposals
                        WHERE asset_id = 'asset-1'
                        ORDER BY proposal_id
                        """
                    ).fetchall()
                ],
            }
            undo_events = conn.execute(
                """
                SELECT COUNT(*)
                FROM asset_editorial_events
                WHERE asset_id = 'asset-1' AND action = 'undo-approve'
                """
            ).fetchone()[0]
        self.assertEqual(actual_after, expected_before)
        self.assertEqual(undo_events, 1)
        self.assertTrue(
            undo_fixture_review_action(
                self.root,
                applied["operationId"],
            )["alreadyUndone"]
        )

    def test_review_undo_refuses_to_overwrite_a_later_change(self):
        root = create_fixture(self.root, "Root", fixture_id="root")
        set_fixture_asset_state(
            self.root,
            root["fixtureId"],
            ["asset-1"],
            "picked",
        )
        applied = apply_fixture_review_action(
            self.root,
            root["fixtureId"],
            ["asset-1"],
            "edit-metadata",
            title="First change",
        )
        apply_fixture_review_action(
            self.root,
            root["fixtureId"],
            ["asset-1"],
            "edit-metadata",
            title="Later change",
        )
        with self.assertRaisesRegex(ValueError, "state changed"):
            undo_fixture_review_action(
                self.root,
                applied["operationId"],
            )
        with connect(self.root) as conn:
            self.assertEqual(
                conn.execute(
                    "SELECT title FROM sidecar_decisions WHERE asset_id = 'asset-1'"
                ).fetchone()[0],
                "Later change",
            )

    def test_culling_views_keep_universe_counts_and_global_metadata(self):
        fixture = create_fixture(self.root, "Root", fixture_id="root")
        record_decision(
            self.root,
            {
                "assetId": "asset-1",
                "action": "metadata",
                "title": "Canonical title",
                "keywords": ["museum"],
                "metadataState": "proposed",
            },
        )
        record_decision(
            self.root,
            {"assetId": "asset-1", "action": "rating", "rating": 4},
        )
        record_decision(
            self.root,
            {"assetId": "asset-1", "action": "color", "color": "green"},
        )
        set_fixture_asset_state(
            self.root,
            fixture["fixtureId"],
            ["asset-1"],
            "hidden",
        )
        hidden = fixture_culling_window(
            self.root,
            fixture["fixtureId"],
            view="hidden",
        )
        self.assertEqual(hidden["summary"]["universe"], 3)
        self.assertEqual(hidden["summary"]["hidden"], 1)
        self.assertEqual(hidden["summary"]["undecided"], 2)
        self.assertEqual(hidden["items"][0]["title"], "Canonical title")
        self.assertEqual(hidden["items"][0]["rating"], 4)
        self.assertEqual(hidden["items"][0]["color"], "green")
        self.assertEqual(hidden["items"][0]["keywords"], ["museum"])

    def test_access_grants_inherit_downward_only_and_new_roots_are_owner_only(self):
        root = create_fixture(self.root, "Root", fixture_id="root")
        child = create_fixture(
            self.root,
            "Child",
            parent_fixture_id=root["fixtureId"],
            fixture_id="child",
        )
        sibling = create_fixture(
            self.root,
            "Sibling",
            parent_fixture_id=root["fixtureId"],
            fixture_id="sibling",
        )
        grandchild = create_fixture(
            self.root,
            "Grandchild",
            parent_fixture_id=child["fixtureId"],
            fixture_id="grandchild",
        )
        with connect(self.root) as conn:
            self.assertEqual(
                conn.execute("SELECT owner_only FROM fixtures WHERE fixture_id = 'root'").fetchone()[0],
                1,
            )
        link_access_grant(
            self.root,
            root["fixtureId"],
            provider="acs",
            external_identity="root@example.com",
        )
        link_access_grant(
            self.root,
            child["fixtureId"],
            provider="acs",
            external_identity="child@example.com",
        )
        self.assertEqual(
            {item["externalIdentity"] for item in effective_fixture_access_grants(self.root, grandchild["fixtureId"])},
            {"root@example.com", "child@example.com"},
        )
        self.assertEqual(
            {item["externalIdentity"] for item in effective_fixture_access_grants(self.root, sibling["fixtureId"])},
            {"root@example.com"},
        )
        self.assertEqual(
            {item["externalIdentity"] for item in effective_fixture_access_grants(self.root, root["fixtureId"])},
            {"root@example.com"},
        )

    def test_search_and_pool_are_read_only_stable_and_idempotent(self):
        fixture = create_fixture(self.root, "Fixture")
        record_decision(self.root, {"assetId": "asset-1", "action": "metadata", "caption": "Mediterranean terrace", "metadataState": "proposed"})
        self.assertEqual(search_assets(self.root, {"query": "Mediterranean"})["totalCount"], 1)
        result = search_assets(self.root, {"mediaTypes": ["photo"], "query": ".jpg"})
        self.assertEqual(result["totalCount"], 2)
        pool = create_pool(self.root, fixture["fixtureId"], [item["assetId"] for item in result["items"]], criteria=result["filters"])
        again = create_pool(self.root, fixture["fixtureId"], [item["assetId"] for item in result["items"]], criteria=result["filters"])
        self.assertEqual(pool["poolId"], again["poolId"])
        self.assertEqual(
            [item["poolId"] for item in list_pools(self.root, fixture_id=fixture["fixtureId"])],
            [pool["poolId"]],
        )
        self.assertEqual(list_pools(self.root, fixture_id="missing"), [])
        upsert_assets(self.root, [{"localIdentifier": "asset-4", "filename": "D.JPG", "mediaType": "photo", "creationDate": "2026-07-17T10:00:00Z"}])
        self.assertEqual(pool["assetCount"], 2)
        refresh = preview_pool_refresh(self.root, pool["poolId"])
        self.assertEqual(refresh["afterCount"], 3)
        self.assertFalse(refresh["applied"])
        applied = apply_pool_refresh(self.root, pool["poolId"])
        self.assertTrue(applied["applied"])
        self.assertEqual(applied["pool"]["assetCount"], 3)
        self.assertEqual(apply_pool_refresh(self.root, pool["poolId"])["pool"]["poolId"], applied["pool"]["poolId"])

    def test_search_filters_escape_literal_like_wildcards(self):
        upsert_assets(self.root, [{
            "localIdentifier": "asset-like-wildcards",
            "filename": "escape%_token.jpg",
            "mediaType": "photo",
            "albumIds": ["album%_one"],
            "cameraMetadata": {"model": "Cam%_Body"},
        }])

        self.assertEqual(
            search_assets(self.root, {"albumIds": ["album%_one"]})["totalCount"],
            1,
        )
        self.assertEqual(
            search_assets(self.root, {"camera": "Cam%_Body"})["totalCount"],
            1,
        )
        self.assertEqual(
            search_assets(self.root, {"query": "escape%_token"})["totalCount"],
            1,
        )

    def test_exact_identity_dedupe_never_uses_capture_time(self):
        upsert_assets(self.root, [{"cloudIdentifier": "cloud-asset-1", "localIdentifier": "asset-1", "filename": "A copy.JPG", "mediaType": "photo", "creationDate": "2026-07-15T10:00:00Z"}])
        self.assertEqual(search_assets(self.root, {"mediaTypes": ["photo"], "dedupeExact": True})["totalCount"], 2)
        self.assertEqual(search_assets(self.root, {"dateFrom": "2026-07-15T10:00:00Z", "dateTo": "2026-07-15T10:00:00Z", "dedupeExact": True})["totalCount"], 1)
        upsert_assets(self.root, [
            {"localIdentifier": "checksum-a", "filename": "checksum-a.jpg", "mediaType": "photo", "checksumSha256": "c" * 64},
            {"localIdentifier": "checksum-b", "filename": "checksum-b.jpg", "mediaType": "photo", "checksumSha256": "c" * 64},
        ])
        self.assertEqual(search_assets(self.root, {"assetIds": ["checksum-a", "checksum-b"], "dedupeExact": True})["totalCount"], 1)

    def test_pool_preserves_registered_source_batch(self):
        fixture = create_fixture(self.root, "Batch fixture")
        batch = record_source_batch(self.root, fixture["fixtureId"], source_kind="apple_photos_album", source_identity="album-123", provenance={"albumName": "July intake"})
        pool = create_pool(self.root, fixture["fixtureId"], ["asset-1"], criteria={"sourceBatchIdsByAsset": {"asset-1": batch["batchId"]}})
        self.assertEqual(pool["assets"][0]["sourceBatchId"], batch["batchId"])

    def test_placement_is_reversible_and_multi_fixture(self):
        first = create_fixture(self.root, "First")
        second = create_fixture(self.root, "Second")
        third = create_fixture(self.root, "Third")
        one = place_assets(self.root, first["fixtureId"], ["asset-1"])
        place_assets(self.root, second["fixtureId"], ["asset-1"])
        self.assertEqual(list_placements(self.root, ["asset-1"])["count"], 2)
        moved = move_placement(self.root, one["placementIds"][0], third["fixtureId"], reason="correct route")
        self.assertEqual(moved["fromFixtureId"], first["fixtureId"])
        self.assertEqual(moved["toFixtureId"], third["fixtureId"])
        self.assertEqual(remove_placement(self.root, one["placementIds"][0])["state"], "removed")
        self.assertEqual(restore_placement(self.root, one["placementIds"][0])["state"], "active")

    def test_delivery_defaults_keep_pick_and_approval_distinct(self):
        fixture = create_fixture(
            self.root,
            "Delivery",
            template_key="real-estate",
            destination_defaults=["r2", "apple_photos"],
        )
        place_assets(self.root, fixture["fixtureId"], ["asset-1"])
        configure_asset_destinations(self.root, fixture["fixtureId"], ["asset-1"], ["r2", "apple_photos"])
        self.assertFalse(delivery_plan(self.root, fixture["fixtureId"])["items"][0]["approved"])
        record_decision(self.root, {"assetId": "asset-1", "action": "pick"})
        self.assertFalse(delivery_plan(self.root, fixture["fixtureId"])["items"][0]["approved"])
        record_decision(self.root, {"assetId": "asset-1", "action": "approve", "title": "Ready", "caption": "Sea-view terrace", "keywords": ["La Concha"]})
        item = delivery_plan(self.root, fixture["fixtureId"])["items"][0]
        self.assertTrue(item["approved"])
        with connect(self.root) as conn:
            self.assertEqual(conn.execute("SELECT caption FROM sidecar_decisions WHERE asset_id = 'asset-1'").fetchone()["caption"], "Sea-view terrace")
        self.assertFalse(item["complete"])

        configure_asset_destinations(self.root, fixture["fixtureId"], ["asset-1"], ["r2", "apple_photos"])
        item = delivery_plan(self.root, fixture["fixtureId"])["items"][0]
        first_version = item["versionHash"]
        uploaded = {
            "status": "uploaded", "bucket": "photosbyelie-public", "key": "fixture/asset-1.jpg",
            "backend": "s3", "bytes": 123, "contentType": "image/jpeg", "checksumSha256": "a" * 64,
            "remoteChecksumSha256": "a" * 64, "remoteVerified": True,
        }
        unverified = {**uploaded, "remoteChecksumSha256": "", "remoteVerified": False}
        failed_receipts = record_r2_upload_results(self.root, "asset-1", [unverified])
        self.assertEqual(failed_receipts["receipts"][0]["status"], "failed")
        self.assertEqual(record_r2_upload_results(self.root, "asset-1", [uploaded])["receiptCount"], 1)
        r2_only = create_fixture(
            self.root,
            "R2 only",
            template_key="real-estate",
        )
        place_assets(self.root, r2_only["fixtureId"], ["asset-1"])
        configure_asset_destinations(self.root, r2_only["fixtureId"], ["asset-1"], ["r2"])
        self.assertEqual(record_r2_upload_results(self.root, "asset-1", [uploaded])["receiptCount"], 2)
        self.assertTrue(delivery_plan(self.root, r2_only["fixtureId"])["items"][0]["complete"])
        record_r2_upload_results(self.root, "asset-1", [uploaded])
        with connect(self.root) as conn:
            count = conn.execute("SELECT count(*) FROM fixture_delivery_receipts WHERE fixture_id = ? AND object_key <> ''", (r2_only["fixtureId"],)).fetchone()[0]
        self.assertEqual(count, 1)

        record_decision(self.root, {"assetId": "asset-1", "action": "metadata", "metadataState": "approved", "caption": "Changed caption"})
        configure_asset_destinations(self.root, r2_only["fixtureId"], ["asset-1"], ["r2"])
        changed = delivery_plan(self.root, r2_only["fixtureId"])["items"][0]
        self.assertNotEqual(changed["versionHash"], first_version)
        self.assertFalse(changed["complete"])

    def test_la_concha_migration_builds_target_tree_idempotently(self):
        first = migrate_la_concha_tree(self.root)
        second = migrate_la_concha_tree(self.root)
        self.assertEqual(first["root"]["fixtureId"], second["root"]["fixtureId"])
        self.assertEqual([item["name"] for item in second["commonChildren"]], ["Street", "Main lobby", "Pool", "Tennis court"])
        self.assertEqual(second["accessGrant"]["externalIdentity"], "gallery:la-concha:client:corine")
        with connect(self.root) as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM fixture_access_grants").fetchone()[0], 1)

    def test_access_fixture_migration_enforces_public_roots_and_corine_only_re(self):
        create_fixture(self.root, "Universal Fixture Parity Rehearsal", fixture_id="fixture-universal-parity-rehearsal")
        first = migrate_access_fixture_tree(self.root)
        second = migrate_access_fixture_tree(self.root)
        self.assertEqual([item["name"] for item in second["publicRoots"]], ["Expo", "Travel"])
        self.assertEqual(second["privateRoot"]["fixtureId"], "fixture-re")
        roots = {item["fixtureId"]: item for item in second["tree"]}
        self.assertNotIn("fixture-universal-parity-rehearsal", roots)
        self.assertIn("fixture-la-concha", {item["fixtureId"] for item in roots["fixture-re"]["children"]})
        with connect(self.root) as conn:
            grants = conn.execute(
                "SELECT fixture_id, external_identity, state FROM fixture_access_grants WHERE state = 'active'"
            ).fetchall()
            self.assertEqual([(row["fixture_id"], row["external_identity"]) for row in grants], [
                ("fixture-la-concha", "corine.bn2007@yahoo.fr")
            ])
            self.assertEqual(conn.execute(
                "SELECT count(*) FROM fixture_access_grants WHERE fixture_id = 'fixture-re' AND state = 'active'"
            ).fetchone()[0], 0)
        self.assertEqual(first["accessGrant"]["externalIdentity"], second["accessGrant"]["externalIdentity"])

    def _insert_upload_run(self, *, captured_hash: bool, drift_hash: str = ""):
        record_decision(self.root, {"assetId": "asset-1", "action": "pick"})
        record_decision(self.root, {"assetId": "asset-1", "action": "approve", "title": "A", "caption": "Ready", "keywords": ["Fixture"]})
        record_decision(self.root, {"assetId": "asset-2", "action": "pick"})
        record_decision(self.root, {"assetId": "asset-2", "action": "approve", "title": "B", "caption": "Ready", "keywords": ["Fixture"]})
        run_id = "ub-test-run"
        timestamp = "2099-01-01T00:00:00Z"
        with connect(self.root) as conn:
            conn.execute(
                """INSERT INTO sidecar_upload_bridge_runs
                   (run_id, mode, status, execute_upload, limit_count, started_at, completed_at,
                    summary_json, created_at, updated_at)
                   VALUES (?, 'execute-batch', 'cancelled', 1, 3, ?, ?, '{}', ?, ?)""",
                (run_id, timestamp, timestamp, timestamp, timestamp),
            )
            for index, asset_id in enumerate(("asset-1", "asset-2", "asset-3"), 1):
                result = {
                    "status": "uploaded", "bucket": "photosbyelie-public", "key": f"expo/{asset_id}.jpg",
                    "checksumSha256": str(index) * 64, "remoteChecksumSha256": str(index) * 64,
                    "remoteVerified": True, "bytes": 10, "contentType": "image/jpeg",
                }
                version_hash = editorial_version_hash(conn, asset_id) if captured_hash else ""
                if asset_id == "asset-1" and drift_hash:
                    version_hash = drift_hash
                uploaded = asset_id != "asset-3"
                conn.execute(
                    """INSERT INTO sidecar_upload_bridge_run_items
                       (run_item_id, run_id, asset_id, photo_id, filename, media_type, status,
                        export_status, planned_keys_json, upload_status, upload_keys_json,
                        editorial_version_hash, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, 'photo', ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        f"item-{index}", run_id, asset_id, asset_id, f"{asset_id}.jpg",
                        "uploaded" if uploaded else "planned",
                        "materialized" if uploaded else "planned",
                        json.dumps([{"bucket": result["bucket"], "key": result["key"]}]),
                        "uploaded" if uploaded else "not_requested",
                        json.dumps([result]) if uploaded else "[]",
                        version_hash, timestamp, timestamp,
                    ),
                )
            conn.commit()
        return run_id

    def test_cancelled_upload_run_adopts_only_verified_completed_items(self):
        fixture = create_fixture(
            self.root,
            "Upload destination",
            template_key="real-estate",
        )
        run_id = self._insert_upload_run(captured_hash=False)
        blocked = plan_upload_run_adoption(self.root, run_id, fixture["fixtureId"])
        self.assertEqual(blocked["totalRunItemCount"], 3)
        self.assertEqual(blocked["completedUploadCount"], 2)
        self.assertEqual(blocked["eligibleCount"], 0)
        self.assertEqual(blocked["blockedCount"], 2)
        planned = plan_upload_run_adoption(self.root, run_id, fixture["fixtureId"], historical_backfill=True)
        self.assertEqual(planned["eligibleCount"], 2)
        subset = plan_upload_run_adoption(self.root, run_id, fixture["fixtureId"], historical_backfill=True, asset_ids=["asset-2"])
        self.assertEqual(subset["eligibleCount"], 1)
        self.assertEqual(subset["items"][0]["assetId"], "asset-2")
        adopted = adopt_upload_run(self.root, run_id, fixture["fixtureId"], historical_backfill=True)
        self.assertEqual(adopted["placementCount"], 2)
        self.assertEqual(adopted["r2ReceiptCount"], 2)
        self.assertEqual(list_placements(self.root, fixture_id=fixture["fixtureId"])["count"], 2)
        self.assertEqual(delivery_plan(self.root, fixture["fixtureId"])["items"][0]["receipts"]["r2"]["status"], "verified")
        adopt_upload_run(self.root, run_id, fixture["fixtureId"])
        with connect(self.root) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM fixture_asset_placements WHERE fixture_id = ? AND state = 'active'", (fixture["fixtureId"],)).fetchone()[0], 2)
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM fixture_delivery_receipts WHERE fixture_id = ? AND destination = 'r2'", (fixture["fixtureId"],)).fetchone()[0], 2)

    def test_upload_run_adoption_rejects_editorial_drift_and_archived_fixture(self):
        fixture = create_fixture(self.root, "Upload destination")
        run_id = self._insert_upload_run(captured_hash=True)
        record_decision(self.root, {"assetId": "asset-1", "action": "metadata", "metadataState": "approved", "caption": "Changed after planning"})
        plan = plan_upload_run_adoption(self.root, run_id, fixture["fixtureId"])
        self.assertEqual(plan["eligibleCount"], 1)
        self.assertEqual(plan["blockedCount"], 1)
        self.assertIn("changed after upload planning", plan["blocked"][0]["reason"])
        archive_fixture(self.root, fixture["fixtureId"])
        with self.assertRaisesRegex(ValueError, "archived"):
            plan_upload_run_adoption(self.root, run_id, fixture["fixtureId"])

    def test_upload_run_adoption_can_accept_recorded_checksum_evidence_after_drift(self):
        fixture = create_fixture(self.root, "Upload destination")
        run_id = self._insert_upload_run(captured_hash=True)
        record_decision(
            self.root,
            {
                "assetId": "asset-1",
                "action": "metadata",
                "metadataState": "approved",
                "caption": "Changed after planning",
            },
        )
        plan = plan_upload_run_adoption(
            self.root,
            run_id,
            fixture["fixtureId"],
            revalidate_recorded_content=True,
            asset_ids=["asset-1"],
        )
        self.assertEqual(plan["eligibleCount"], 1)
        self.assertTrue(plan["items"][0]["recordedContentRevalidated"])
        adopted = adopt_upload_run(
            self.root,
            run_id,
            fixture["fixtureId"],
            revalidate_recorded_content=True,
            asset_ids=["asset-1"],
        )
        self.assertEqual(adopted["r2ReceiptCount"], 1)
        with connect(self.root) as conn:
            receipt = conn.execute(
                """SELECT verification_json FROM fixture_delivery_receipts
                   WHERE fixture_id = ? AND asset_id = 'asset-1' AND destination = 'r2'""",
                (fixture["fixtureId"],),
            ).fetchone()
        self.assertTrue(json.loads(receipt["verification_json"])["recordedContentRevalidated"])

    def test_expo_adoption_blocks_explicit_ai_assets(self):
        fixture = create_fixture(self.root, "Expo", fixture_id="fixture-expo")
        run_id = self._insert_upload_run(captured_hash=True)
        record_decision(
            self.root,
            {
                "assetId": "asset-1",
                "action": "metadata",
                "metadataState": "approved",
                "keywords": ["Fixture", "Generative AI"],
            },
        )
        plan = plan_upload_run_adoption(self.root, run_id, fixture["fixtureId"])
        self.assertEqual(plan["eligibleCount"], 1)
        self.assertEqual(plan["blockedCount"], 1)
        self.assertEqual(plan["blocked"][0]["assetId"], "asset-1")
        self.assertEqual(plan["blocked"][0]["reason"], "AI-generated assets are retired from Expo")

    def test_expo_adoption_blocks_stained_glass_assets(self):
        fixture = create_fixture(self.root, "Expo", fixture_id="fixture-expo")
        run_id = self._insert_upload_run(captured_hash=True)
        record_decision(
            self.root,
            {
                "assetId": "asset-1",
                "action": "metadata",
                "metadataState": "approved",
                "keywords": ["Fixture", "Stained"],
            },
        )
        plan = plan_upload_run_adoption(self.root, run_id, fixture["fixtureId"])
        self.assertEqual(plan["eligibleCount"], 1)
        self.assertEqual(plan["blockedCount"], 1)
        self.assertEqual(plan["blocked"][0]["assetId"], "asset-1")
        self.assertEqual(plan["blocked"][0]["reason"], "Stained assets are retired from Expo")


if __name__ == "__main__":
    unittest.main()
