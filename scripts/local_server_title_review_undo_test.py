import copy
import sqlite3
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import local_server


@contextmanager
def patched_server_state(state, fallback_photo):
    originals = {
        "_state_groups": local_server._state_groups,
        "_write_catalog_state": local_server._write_catalog_state,
        "_start_r2_upload_task": local_server._start_r2_upload_task,
        "_catalog_photo_for_hidden": local_server._catalog_photo_for_hidden,
    }

    def state_groups(_repo_root):
        return state["expo"], state["reserve"], state["hidden"]

    def write_catalog_state(_repo_root, expo_groups, reserve_groups, hidden_groups):
        state["expo"] = expo_groups
        state["reserve"] = reserve_groups
        state["hidden"] = hidden_groups
        return {
            "data": copy.deepcopy(expo_groups),
            "reserve": copy.deepcopy(reserve_groups),
            "hidden": copy.deepcopy(hidden_groups),
        }, {"ok": True, "path": "worker/photos-catalog.generated.mjs"}

    def catalog_photo_for_hidden(_repo_root, media_id):
        if media_id != fallback_photo["id"]:
            return None
        return "france", copy.deepcopy(fallback_photo)

    local_server._state_groups = state_groups
    local_server._write_catalog_state = write_catalog_state
    local_server._start_r2_upload_task = lambda *args, **kwargs: None
    local_server._catalog_photo_for_hidden = catalog_photo_for_hidden
    try:
        yield
    finally:
        for name, original in originals.items():
            setattr(local_server, name, original)


class TitleReviewUndoTests(unittest.TestCase):
    def test_undo_restores_catalog_fallback_block_to_normal_review_state(self):
        photo_id = "pbe-title-undo-fallback"
        batch_id = "batch-title-undo-test"
        fallback_photo = {
            "id": photo_id,
            "title": "Fallback Catalog Photo",
            "caption": "France",
            "full": "JPG master",
            "megapixels": 12,
            "gallerySrc": "",
            "imageSrc": "",
            "metadata": [{"label": "Keywords", "value": "France, Travel"}],
            "media": {"type": "photo", "publicPreview": {"allowed": True}},
            "sourceFiles": [{"path": "Camera/fallback.jpg", "type": "JPG"}],
        }
        state = {
            "expo": {slug: [] for slug in local_server.ORDER},
            "reserve": {slug: [] for slug in local_server.ORDER},
            "hidden": {slug: [] for slug in local_server.ORDER},
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            (repo_root / local_server.TITLE_KEYWORD_REVIEW_ROOT).mkdir(parents=True)
            with patched_server_state(state, fallback_photo):
                hide_result = local_server.apply_photo_action(
                    repo_root,
                    {"action": "hide-many", "photo_ids": [photo_id]},
                )
                self.assertEqual(hide_result["hidden_ids"], [photo_id])
                self.assertEqual([photo["id"] for photo in state["hidden"]["france"]], [photo_id])
                self.assertEqual(state["expo"]["france"], [])

                save_result = local_server.apply_photo_action(
                    repo_root,
                    {
                        "action": "save-title-keyword-review-approvals",
                        "batch_id": batch_id,
                        "approvals": [],
                        "rejections": [],
                        "blocked": [{"photo_id": photo_id, "batch_id": batch_id, "blocked": True}],
                    },
                )
                self.assertEqual(save_result["blocked_count"], 1)

                undo_result = local_server.apply_photo_action(
                    repo_root,
                    {"action": "undo-hide", "photo_id": photo_id},
                )
                self.assertEqual(undo_result["moved"]["to"], "expo")
                self.assertEqual(state["hidden"]["france"], [])
                self.assertEqual([photo["id"] for photo in state["expo"]["france"]], [photo_id])
                restored = state["expo"]["france"][0]
                self.assertNotIn("hiddenFromState", restored)
                self.assertNotIn("hiddenFromSlug", restored)

                clear_result = local_server.apply_photo_action(
                    repo_root,
                    {
                        "action": "clear-title-keyword-review-block",
                        "photo_id": photo_id,
                        "batch_id": batch_id,
                    },
                )
                self.assertEqual(clear_result["unblocked_count"], 1)
                self.assertEqual(clear_result["record_removed_count"], 1)

            conn = sqlite3.connect(repo_root / "assets/owner-actions/Owner.sqlite")
            conn.row_factory = sqlite3.Row
            try:
                queue = conn.execute(
                    "SELECT review_state, reviewed_at FROM title_keyword_queue WHERE media_id = ?",
                    (photo_id,),
                ).fetchone()
                self.assertIsNotNone(queue)
                self.assertEqual(queue["review_state"], "proposed")
                self.assertIsNone(queue["reviewed_at"])
                blocked_decisions = conn.execute(
                    """
                    SELECT count(*) AS count
                    FROM title_keyword_decisions
                    WHERE media_id = ? AND decision_state = 'blocked'
                    """,
                    (photo_id,),
                ).fetchone()
                self.assertEqual(blocked_decisions["count"], 0)
            finally:
                conn.close()


if __name__ == "__main__":
    unittest.main()
