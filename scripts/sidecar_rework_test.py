import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent))

import sidecar_state_db


def _asset(asset_id: str, *, title: str = "Museum", keywords: list[str] | None = None) -> dict:
    return {
        "assetId": asset_id,
        "localIdentifier": asset_id,
        "filename": f"{asset_id}.jpg",
        "mediaType": "photo",
        "creationDate": "2026-07-11T10:00:00Z",
        "applePhotosTitle": title,
        "applePhotosKeywords": keywords if keywords is not None else ["Museum"],
    }


def _pick_rework(root: Path, asset_id: str, *, category: str = "generic") -> None:
    sidecar_state_db.record_decision(root, {"assetId": asset_id, "action": "pick"})
    sidecar_state_db.record_decision(
        root,
        {
            "assetId": asset_id,
            "action": "metadata-rework",
            "reworkCategory": category,
            "reworkComment": "Please retry the metadata proposal.",
        },
    )


class SidecarReworkQueueTest(unittest.TestCase):
    def test_rework_is_persisted_and_visible_with_auditable_error(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sidecar_state_db.upsert_assets(root, [_asset("asset-1")])
            _pick_rework(root, "asset-1", category="generic")

            with sidecar_state_db.connect(root) as conn:
                state = sidecar_state_db._decision_payload(
                    conn.execute("SELECT * FROM sidecar_decisions WHERE asset_id = 'asset-1'").fetchone()
                )
            self.assertEqual(state["metadataState"], "rework")
            self.assertEqual(state["pickState"], "picked")
            self.assertEqual(state["reworkCategory"], "generic")
            self.assertEqual(state["metadataAiAttemptCount"], 0)

            result = sidecar_state_db.apply_ai_metadata_proposals(
                root,
                rework_only=True,
                max_rung="human-review",
            )
            self.assertEqual(result["skippedCount"], 0)
            self.assertEqual(result["proposedCount"], 1)
            with sidecar_state_db.connect(root) as conn:
                state = sidecar_state_db._decision_payload(
                    conn.execute("SELECT * FROM sidecar_decisions WHERE asset_id = 'asset-1'").fetchone()
                )
            self.assertEqual(state["metadataState"], "proposed")
            self.assertEqual(state["pickState"], "picked")
            self.assertEqual(state["reworkCategory"], "")
            self.assertEqual(state["metadataAiAttemptCount"], 1)
            self.assertEqual(state["metadataAiLastError"], "")

            source = (Path(__file__).resolve().parents[1] / "sidecar.js").read_text(encoding="utf-8")
            self.assertIn("rework: ${reworkLabel}", source)
            self.assertIn("AI error:", source)

    def test_nightly_plan_is_only_picked_rework_and_excludes_handoff_states(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            ids = [
                "eligible", "unpicked", "rejected", "hidden", "tombstoned",
                "bridge", "uploaded", "approved", "unreviewed", "missing",
            ]
            sidecar_state_db.upsert_assets(root, [_asset(asset_id) for asset_id in ids])
            for asset_id in ids:
                _pick_rework(root, asset_id)
            sidecar_state_db.record_decision(root, {"assetId": "unpicked", "action": "unpick"})
            sidecar_state_db.record_decision(root, {"assetId": "rejected", "action": "reject"})
            sidecar_state_db.record_decision(root, {"assetId": "hidden", "action": "hide"})
            sidecar_state_db.record_decision(root, {"assetId": "tombstoned", "action": "tombstone", "reason": "test"})
            sidecar_state_db.record_decision(
                root,
                {"assetId": "unreviewed", "action": "metadata", "metadataState": "unreviewed"},
            )
            sidecar_state_db.record_decision(
                root,
                {
                    "assetId": "approved",
                    "action": "metadata",
                    "metadataState": "approved",
                    "title": "Approved Museum",
                    "keywords": ["Museum"],
                },
            )
            with sidecar_state_db.connect(root) as conn:
                conn.execute("UPDATE sidecar_assets SET missing_at = '2026-07-11T10:00:00Z' WHERE asset_id = 'missing'")
                conn.execute(
                    """
                    INSERT INTO sidecar_upload_bridge_runs
                      (run_id, mode, status, execute_upload, limit_count, created_at, updated_at)
                    VALUES ('bridge-run', 'export-dry-run', 'planned', 0, 1, '', '')
                    """
                )
                for asset_id, item_id in (("bridge", "bridge-item"), ("uploaded", "uploaded-item")):
                    conn.execute(
                        """
                        INSERT INTO sidecar_upload_bridge_run_items
                          (run_item_id, run_id, asset_id, photo_id, status, export_status,
                           upload_status, created_at, updated_at)
                        VALUES (?, 'bridge-run', ?, ?, ?, ?, ?, '', '')
                        """,
                        (
                            item_id,
                            asset_id,
                            f"photo-{asset_id}",
                            "uploaded" if asset_id == "uploaded" else "planned",
                            "exported" if asset_id == "uploaded" else "planned",
                            "uploaded" if asset_id == "uploaded" else "not_requested",
                        ),
                    )

            plan = sidecar_state_db.ai_metadata_plan(root, rework_only=True)
            self.assertTrue(plan["reworkOnly"])
            self.assertEqual(plan["candidateCount"], 1)
            self.assertEqual([item["assetId"] for item in plan["items"]], ["eligible"])

    def test_failed_safe_and_vision_attempts_retain_rework_and_can_retry(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sidecar_state_db.upsert_assets(
                root,
                [
                    _asset("safe-failure", title="", keywords=[]),
                    _asset("vision-failure"),
                ],
            )
            _pick_rework(root, "safe-failure")
            _pick_rework(root, "vision-failure", category="detail")

            safe_result = sidecar_state_db.apply_ai_metadata_proposals(
                root,
                rework_only=True,
                max_rung="human-review",
                asset_ids=["safe-failure"],
            )
            self.assertEqual(safe_result["proposedCount"], 0)
            self.assertEqual(safe_result["skippedCount"], 1)
            with sidecar_state_db.connect(root) as conn:
                safe_state = sidecar_state_db._decision_payload(
                    conn.execute("SELECT * FROM sidecar_decisions WHERE asset_id = 'safe-failure'").fetchone()
                )
                vision_state = sidecar_state_db._decision_payload(
                    conn.execute("SELECT * FROM sidecar_decisions WHERE asset_id = 'vision-failure'").fetchone()
                )
            self.assertEqual(safe_state["metadataState"], "rework")
            self.assertEqual(safe_state["metadataAiAttemptCount"], 1)
            self.assertTrue(safe_state["metadataAiLastError"])

            vision_result = sidecar_state_db.apply_ai_metadata_vision_proposals(
                root,
                [{"assetId": "vision-failure", "title": "Museum", "keywords": ["Museum"]}],
                preview_manifest=[{"assetId": "vision-failure", "ok": False}],
                rework_only=True,
            )
            self.assertEqual(vision_result["proposedCount"], 0)
            self.assertEqual(vision_result["skippedCount"], 1)
            with sidecar_state_db.connect(root) as conn:
                vision_state = sidecar_state_db._decision_payload(
                    conn.execute("SELECT * FROM sidecar_decisions WHERE asset_id = 'vision-failure'").fetchone()
                )
            self.assertEqual(vision_state["metadataState"], "rework")
            self.assertEqual(vision_state["metadataAiAttemptCount"], 1)
            self.assertEqual(vision_state["metadataAiLastError"], "preview_export_failed")

            retry = sidecar_state_db.apply_ai_metadata_proposals(
                root,
                rework_only=True,
                max_rung="human-review",
                asset_ids=["safe-failure"],
            )
            self.assertEqual(retry["skippedCount"], 1)
            with sidecar_state_db.connect(root) as conn:
                safe_state = sidecar_state_db._decision_payload(
                    conn.execute("SELECT * FROM sidecar_decisions WHERE asset_id = 'safe-failure'").fetchone()
                )
            self.assertEqual(safe_state["metadataState"], "rework")
            self.assertEqual(safe_state["metadataAiAttemptCount"], 2)
            self.assertTrue(safe_state["metadataAiLastError"])


if __name__ == "__main__":
    unittest.main()
