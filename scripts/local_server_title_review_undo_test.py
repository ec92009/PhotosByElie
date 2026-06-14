import copy
import json
import sqlite3
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import local_server
import owner_state_db


@contextmanager
def patched_server_state(state, fallback_photo):
    originals = {
        "_state_groups": local_server._state_groups,
        "_write_catalog_state": local_server._write_catalog_state,
        "_start_r2_upload_task": local_server._start_r2_upload_task,
        "_start_r2_delete_task": local_server._start_r2_delete_task,
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
    local_server._start_r2_delete_task = lambda *args, **kwargs: None
    local_server._catalog_photo_for_hidden = catalog_photo_for_hidden
    try:
        yield
    finally:
        for name, original in originals.items():
            setattr(local_server, name, original)


class TitleReviewUndoTests(unittest.TestCase):
    def _seed_title_keyword_row(self, conn, media_id, state="proposed", batch_id="batch-review-test", attempt=1, applied_at=""):
        timestamp = "2026-06-14T08:00:00Z"
        owner_state_db._upsert_batch(
            conn,
            {
                "batch_id": batch_id,
                "generated_at": timestamp,
                "selection": {"total_count": 1, "ordinary_new_count": 1, "rework_count": 0},
            },
            "unit-test",
        )
        owner_state_db._ensure_placeholder_proposal(
            conn,
            media_id,
            attempt,
            batch_id,
            timestamp,
            f"{media_id} Title",
            ["France", "Travel"],
            "unit-test-proposal",
        )
        if state in {"approved", "applied"}:
            conn.execute(
                """
                INSERT INTO title_keyword_decisions
                  (media_id, attempt, decision_state, decided_title, decided_keywords, owner_comment, decided_at, applied_at)
                VALUES (?, ?, 'accepted', ?, ?, 'accepted in unit test', ?, ?)
                ON CONFLICT(media_id, attempt) DO UPDATE SET
                  decision_state = excluded.decision_state,
                  decided_title = excluded.decided_title,
                  decided_keywords = excluded.decided_keywords,
                  owner_comment = excluded.owner_comment,
                  decided_at = excluded.decided_at,
                  applied_at = excluded.applied_at
                """,
                (media_id, attempt, f"{media_id} Title", "France, Travel", timestamp, applied_at or timestamp),
            )
        owner_state_db._upsert_queue(
            conn,
            media_id=media_id,
            review_state=state,
            latest_attempt=attempt,
            batch_id=batch_id,
            proposed_at=timestamp,
            reviewed_at=timestamp if state in {"approved", "applied"} else "",
            applied_at=applied_at,
            rework_priority=False,
            rejected_count=0,
            owner_comment="seeded for unit test",
        )

    def _write_catalog_db(self, repo_root, rows):
        catalog_path = repo_root / "assets/catalog/photosbyelie.sqlite"
        catalog_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(catalog_path)
        try:
            normalized_rows = []
            for row in rows:
                media_id, title, captured_at = row[:3]
                origin = row[3] if len(row) > 3 else "camera"
                normalized_rows.append((media_id, title, captured_at, origin))
            conn.executescript(
                """
                CREATE TABLE source_origins (
                  source_origin_id INTEGER PRIMARY KEY,
                  code TEXT NOT NULL UNIQUE
                );
                CREATE TABLE keyword_terms (keyword_id INTEGER PRIMARY KEY, keyword TEXT NOT NULL);
                CREATE TABLE media_items (
                  media_id TEXT PRIMARY KEY,
                  title TEXT,
                  keyword_ids TEXT,
                  captured_at TEXT,
                  source_origin_id INTEGER
                );
                """
            )
            conn.executemany(
                "INSERT INTO source_origins(source_origin_id, code) VALUES (?, ?)",
                [(1, "camera"), (2, "ai")],
            )
            conn.executemany(
                "INSERT INTO keyword_terms(keyword_id, keyword) VALUES (?, ?)",
                [(1, "France"), (2, "Travel"), (3, "Architecture")],
            )
            conn.executemany(
                """
                INSERT INTO media_items(media_id, title, keyword_ids, captured_at, source_origin_id)
                VALUES (?, ?, ?, ?, CASE WHEN ? = 'ai' THEN 2 ELSE 1 END)
                """,
                [(media_id, title, "1,2,3", captured_at, origin) for media_id, title, captured_at, origin in normalized_rows],
            )
            conn.commit()
        finally:
            conn.close()

    def _seed_r2_preview_pair(self, conn, media_id):
        conn.executemany(
            """
            INSERT INTO r2_objects(bucket, object_key, photo_id, object_kind, lifecycle_state, updated_at)
            VALUES ('public-media', ?, ?, 'public-preview', 'current', '2026-06-14T08:00:00Z')
            """,
            [
                (f"expo/{media_id}_900.jpg", media_id),
                (f"expo/{media_id}_1800.jpg", media_id),
            ],
        )

    def _write_import_manifest(self, repo_root, media_ids):
        manifest_path = repo_root / local_server.IMPORT_CACHE_MANIFEST_PATH
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        photos = [
            {
                "id": media_id,
                "owner_title": f"{media_id} Title",
                "keywords": ["France", "Travel"],
                "gallery_key": "france",
                "capture": {"sort": "2026-06-14T08:00:00"},
                "source_file": {"path": f"Camera/{media_id}.jpg", "name": f"{media_id}.jpg"},
                "media_type": "photo",
                "media": {"publicPreview": {"allowed": True}},
            }
            for media_id in media_ids
        ]
        manifest_path.write_text(json.dumps({"photos": photos}), encoding="utf-8")

    def test_review_queue_and_counts_exclude_approved_rows(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            self._write_import_manifest(repo_root, ["pending-photo", "approved-photo", "applied-photo"])
            conn = owner_state_db.connect(repo_root)
            try:
                self._seed_title_keyword_row(conn, "pending-photo", "proposed")
                self._seed_title_keyword_row(conn, "approved-photo", "approved", applied_at="2026-06-14T08:01:00Z")
                self._seed_title_keyword_row(conn, "applied-photo", "applied", applied_at="2026-06-14T08:02:00Z")
                conn.commit()
            finally:
                conn.close()

            payload = local_server.title_keyword_review_queue_payload(repo_root)
            queued_ids = [item["photo_id"] for item in payload["photos"]]
            self.assertEqual(queued_ids, ["pending-photo"])
            self.assertEqual(payload["selection"]["sqlite_pending_count"], 1)

            counts = owner_state_db.title_keyword_review_counts(repo_root)
            self.assertEqual(counts["submitted_unchecked"], 1)
            self.assertEqual(counts["rejected"], 0)
            self.assertEqual(counts["approved"], 2)
            self.assertEqual(counts["accepted"], 0)

    def test_owner_visibility_summary_partitions_r2_ready_gate(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            self._write_import_manifest(repo_root, ["limbo-r2", "approved-r2", "approved-not-ready", "blocked-r2"])
            self._write_catalog_db(
                repo_root,
                [
                    ("public-r2", "Public R2", "2026-06-14T08:00:00", "camera"),
                    ("public-ai", "Public AI", "2026-06-14T08:01:00", "ai"),
                ],
            )
            conn = owner_state_db.connect(repo_root)
            try:
                self._seed_title_keyword_row(conn, "approved-r2", "approved", applied_at="2026-06-14T08:01:00Z")
                self._seed_title_keyword_row(conn, "approved-not-ready", "approved", applied_at="2026-06-14T08:02:00Z")
                self._seed_title_keyword_row(conn, "blocked-r2", "blocked")
                for media_id in ["public-r2", "limbo-r2", "approved-r2", "blocked-r2"]:
                    self._seed_r2_preview_pair(conn, media_id)
                conn.commit()
            finally:
                conn.close()

            summary = local_server.owner_visibility_summary(repo_root)
            self.assertEqual(summary["publicApplied"]["count"], 2)
            self.assertEqual(summary["r2Ready"]["count"], 4)
            self.assertEqual(summary["r2ReadyPublic"]["count"], 1)
            self.assertEqual(summary["r2ReadyLimbo"]["count"], 1)
            self.assertEqual(summary["r2ReadyApprovedNotApplied"]["count"], 1)
            self.assertEqual(summary["approvedNotApplied"]["count"], 2)
            self.assertEqual(summary["approvedNotReady"]["count"], 1)
            self.assertEqual(summary["blockedOrParkedReady"]["count"], 1)
            self.assertEqual(
                summary["r2ReadyPublic"]["count"]
                + summary["r2ReadyLimbo"]["count"]
                + summary["r2ReadyApprovedNotApplied"]["count"]
                + summary["blockedOrParkedReady"]["count"],
                summary["r2Ready"]["count"],
            )

    def test_batch_import_cannot_pull_approved_rows_back_into_review(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            queue_root = repo_root / local_server.TITLE_KEYWORD_REVIEW_ROOT
            queue_root.mkdir(parents=True)
            batch_path = queue_root / "batch-regenerated.json"
            batch_path.write_text(json.dumps({
                "batch_id": "regenerated",
                "generated_at": "2026-06-14T09:00:00Z",
                "photos": [
                    {
                        "photo_id": "approved-photo",
                        "state": {"proposal_attempt": 2},
                        "current": {"title": "Approved Title", "keywords": ["France"]},
                        "proposed": {"title": "Regenerated Title", "keywords": ["France", "Travel"]},
                    }
                ],
            }), encoding="utf-8")
            conn = owner_state_db.connect(repo_root)
            try:
                self._seed_title_keyword_row(conn, "approved-photo", "approved", applied_at="2026-06-14T08:01:00Z")
                conn.commit()
            finally:
                conn.close()

            owner_state_db.import_title_keyword_batch_file(repo_root, batch_path)

            conn = sqlite3.connect(repo_root / "assets/owner-actions/Owner.sqlite")
            conn.row_factory = sqlite3.Row
            try:
                queue = conn.execute(
                    "SELECT review_state, latest_attempt, applied_at FROM title_keyword_queue WHERE media_id = ?",
                    ("approved-photo",),
                ).fetchone()
                self.assertEqual(queue["review_state"], "approved")
                self.assertEqual(queue["latest_attempt"], 1)
                self.assertEqual(queue["applied_at"], "2026-06-14T08:01:00Z")
                regenerated = conn.execute(
                    "SELECT count(*) AS count FROM title_keyword_proposals WHERE media_id = ? AND batch_id = ?",
                    ("approved-photo", "regenerated"),
                ).fetchone()
                self.assertEqual(regenerated["count"], 0)
            finally:
                conn.close()

    def test_gallery_r_requeues_approved_photo_with_provenance_without_losing_acceptance(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            self._write_catalog_db(repo_root, [("approved-photo", "Approved Title", "2026-06-14T08:00:00")])
            conn = owner_state_db.connect(repo_root)
            try:
                self._seed_title_keyword_row(conn, "approved-photo", "approved", applied_at="2026-06-14T08:01:00Z")
                conn.commit()
            finally:
                conn.close()

            result = owner_state_db.queue_title_keyword_review_photo(
                repo_root,
                "approved-photo",
                source="owner-gallery-r",
                context={"view": "gallery", "visible_count": 1, "filtered_total_count": 1},
            )
            self.assertTrue(result["queued"])

            conn = sqlite3.connect(repo_root / "assets/owner-actions/Owner.sqlite")
            conn.row_factory = sqlite3.Row
            try:
                queue = conn.execute(
                    """
                    SELECT review_state, latest_attempt, applied_at, review_request_source,
                           review_request_context
                    FROM title_keyword_queue
                    WHERE media_id = ?
                    """,
                    ("approved-photo",),
                ).fetchone()
                self.assertEqual(queue["review_state"], "proposed")
                self.assertEqual(queue["latest_attempt"], 2)
                self.assertIsNone(queue["applied_at"])
                self.assertEqual(queue["review_request_source"], "owner-gallery-r")
                context = json.loads(queue["review_request_context"])
                self.assertEqual(context["view"], "gallery")
                self.assertEqual(context["visible_count"], 1)
                accepted = conn.execute(
                    """
                    SELECT count(*) AS count
                    FROM title_keyword_decisions
                    WHERE media_id = ? AND decision_state = 'accepted' AND applied_at IS NOT NULL
                    """,
                    ("approved-photo",),
                ).fetchone()
                self.assertEqual(accepted["count"], 1)

                owner_state_db.record_title_keyword_review_decisions(
                    repo_root,
                    result["batch_id"],
                    [{"photo_id": "approved-photo", "title": "Approved Title", "keywords": ["Spain", "Travel"]}],
                    [],
                    [],
                    [],
                    applied_at="2026-06-14T08:10:00Z",
                    decided_at="2026-06-14T08:10:00Z",
                    conn=conn,
                )
                approved_again = conn.execute(
                    """
                    SELECT review_state, applied_at, review_request_source, review_request_context
                    FROM title_keyword_queue
                    WHERE media_id = ?
                    """,
                    ("approved-photo",),
                ).fetchone()
                self.assertEqual(approved_again["review_state"], "approved")
                self.assertEqual(approved_again["applied_at"], "2026-06-14T08:10:00Z")
                self.assertEqual(approved_again["review_request_source"], "owner-gallery-r")
                approved_context = json.loads(approved_again["review_request_context"])
                self.assertEqual(approved_context["view"], "gallery")
            finally:
                conn.close()

    def test_review_all_visible_requeues_batch_with_filter_context_and_count(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            self._write_catalog_db(
                repo_root,
                [
                    ("visible-approved-1", "Visible Approved One", "2026-06-14T08:00:00"),
                    ("visible-approved-2", "Visible Approved Two", "2026-06-14T08:01:00"),
                ],
            )
            conn = owner_state_db.connect(repo_root)
            try:
                self._seed_title_keyword_row(conn, "visible-approved-1", "approved", applied_at="2026-06-14T08:01:00Z")
                self._seed_title_keyword_row(conn, "visible-approved-2", "approved", applied_at="2026-06-14T08:02:00Z")
                conn.commit()
            finally:
                conn.close()

            result = owner_state_db.queue_title_keyword_review_photos(
                repo_root,
                ["visible-approved-1", "visible-approved-2"],
                source="owner-gallery-review-all-visible",
                context={
                    "view": "search-gallery",
                    "query": "Visible",
                    "visible_count": 2,
                    "filtered_total_count": 2,
                },
            )
            self.assertEqual(result["requested_count"], 2)
            self.assertEqual(result["queued_count"], 2)
            self.assertEqual(result["review_request_context"]["affected_count"], 2)

            conn = sqlite3.connect(repo_root / "assets/owner-actions/Owner.sqlite")
            conn.row_factory = sqlite3.Row
            try:
                rows = conn.execute(
                    """
                    SELECT media_id, review_state, review_request_source, review_request_context
                    FROM title_keyword_queue
                    ORDER BY media_id
                    """
                ).fetchall()
                self.assertEqual([row["review_state"] for row in rows], ["proposed", "proposed"])
                for row in rows:
                    self.assertEqual(row["review_request_source"], "owner-gallery-review-all-visible")
                    context = json.loads(row["review_request_context"])
                    self.assertEqual(context["query"], "Visible")
                    self.assertEqual(context["affected_count"], 2)
                    self.assertTrue(context["operation_id"])
            finally:
                conn.close()

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
                lifecycle = conn.execute(
                    "SELECT lifecycle_state FROM media_lifecycle WHERE media_id = ?",
                    (photo_id,),
                ).fetchone()
                self.assertIsNotNone(lifecycle)
                self.assertEqual(lifecycle["lifecycle_state"], "active")
            finally:
                conn.close()

    def test_discard_records_durable_lifecycle_and_tombstone(self):
        photo_id = "pbe-discard-lifecycle"
        fallback_photo = {
            "id": photo_id,
            "title": "Discard Candidate",
            "caption": "France",
            "full": "JPG master",
            "megapixels": 12,
            "gallerySrc": "",
            "imageSrc": "",
            "metadata": [{"label": "Keywords", "value": "France, Travel"}],
            "media": {"type": "photo", "publicPreview": {"allowed": True}},
            "sourceFiles": [{"path": "Camera/discard.jpg", "type": "JPG"}],
        }
        state = {
            "expo": {slug: [] for slug in local_server.ORDER},
            "reserve": {slug: [] for slug in local_server.ORDER},
            "hidden": {slug: [] for slug in local_server.ORDER},
        }
        state["expo"]["france"].append(copy.deepcopy(fallback_photo))

        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            with patched_server_state(state, fallback_photo):
                result = local_server.apply_photo_action(
                    repo_root,
                    {"action": "discard", "photo_id": photo_id},
                )
                self.assertEqual(result["moved"]["to"], "discarded")
                self.assertEqual(state["expo"]["france"], [])

            tombstone = local_server._read_json_file(
                repo_root / local_server.DISCARDED_TOMBSTONE_PATH,
                {},
            )
            self.assertIn(photo_id, tombstone.get("photo_ids") or [])
            conn = sqlite3.connect(repo_root / "assets/owner-actions/Owner.sqlite")
            conn.row_factory = sqlite3.Row
            try:
                lifecycle = conn.execute(
                    "SELECT lifecycle_state, discarded_at FROM media_lifecycle WHERE media_id = ?",
                    (photo_id,),
                ).fetchone()
                self.assertIsNotNone(lifecycle)
                self.assertEqual(lifecycle["lifecycle_state"], "discarded")
                self.assertTrue(lifecycle["discarded_at"])
            finally:
                conn.close()


if __name__ == "__main__":
    unittest.main()
