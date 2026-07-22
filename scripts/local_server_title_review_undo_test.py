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
                "relative_path": f"Apple Photo Albums/Unit Test/{media_id}.jpg",
                "source_file": {"path": f"Apple Photo Albums/Unit Test/{media_id}.jpg", "name": f"{media_id}.jpg"},
                "media_type": "photo",
                "media": {"publicPreview": {"allowed": True}},
            }
            for media_id in media_ids
        ]
        manifest_path.write_text(json.dumps({"photos": photos}), encoding="utf-8")

    def _write_burst_manifest(self, repo_root, rows):
        manifest_path = repo_root / local_server.IMPORT_CACHE_MANIFEST_PATH
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        photos = []
        for media_id, capture, extra in rows:
            extra = dict(extra or {})
            dimensions = extra.pop("dimensions", {"width": 4000, "height": 3000})
            media_type = extra.pop("media_type", "photo")
            photos.append({
                "id": media_id,
                "relative_path": f"Camera/{media_id}.jpg",
                "source_path_hint": f"/Volumes/Saturn/Pictures/LR/Camera/{media_id}.jpg",
                "media_type": media_type,
                "title": f"{media_id} Title",
                "gallery_country": {"slug": "france", "label": "France"},
                "derivatives": {"gallery": f"france/{media_id}_900.jpg", "detail": f"france/{media_id}_1800.jpg"},
                "source_file": {"name": f"{media_id}.jpg", "extension": "jpg", "bytes": 1234},
                "capture": {"sort": capture},
                "dimensions": dimensions,
                **extra,
            })
        manifest_path.write_text(json.dumps({"photos": photos}), encoding="utf-8")

    def _clear_title_keyword_applied_at(self, conn, media_id):
        conn.execute(
            "UPDATE title_keyword_queue SET applied_at = NULL WHERE media_id = ?",
            (media_id,),
        )
        conn.execute(
            "UPDATE title_keyword_decisions SET applied_at = NULL WHERE media_id = ?",
            (media_id,),
        )

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

    def test_review_queue_excludes_manifest_only_backlog_without_site_writeback_target(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            self._write_import_manifest(repo_root, ["manifest-only"])
            conn = owner_state_db.connect(repo_root)
            try:
                self._seed_r2_preview_pair(conn, "manifest-only")
                conn.commit()
            finally:
                conn.close()

            payload = local_server.title_keyword_review_queue_payload(repo_root)

            self.assertEqual(payload["photos"], [])
            self.assertEqual(payload["selection"]["incomplete_backlog_count"], 0)
            self.assertEqual(payload["selection"]["visible_pending_count"], 0)

    def test_review_queue_includes_manifest_backlog_with_site_writeback_target(self):
        photo_id = "site-backed"
        photo = {
            "id": photo_id,
            "title": "Site Backed",
            "keywords": [],
            "metadata": [{"label": "Keywords", "value": ""}],
            "media": {"type": "photo", "publicPreview": {"allowed": True}},
        }
        state = {
            "expo": {slug: [] for slug in local_server.ORDER},
            "reserve": {slug: [] for slug in local_server.ORDER},
            "hidden": {slug: [] for slug in local_server.ORDER},
        }
        state["expo"]["france"].append(copy.deepcopy(photo))
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            self._write_import_manifest(repo_root, [photo_id])
            conn = owner_state_db.connect(repo_root)
            try:
                self._seed_r2_preview_pair(conn, photo_id)
                conn.commit()
            finally:
                conn.close()

            with patched_server_state(state, photo):
                payload = local_server.title_keyword_review_queue_payload(repo_root)

            self.assertEqual([item["photo_id"] for item in payload["photos"]], [photo_id])
            self.assertEqual(payload["selection"]["incomplete_backlog_count"], 1)
            self.assertEqual(payload["selection"]["visible_pending_count"], 1)

    def test_selected_import_source_queues_r2_ready_manifest_rows_for_title_review(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            source_root = repo_root / "tmp/apple-photos-import/20260626T111452Z-14th-street"
            other_root = repo_root / "tmp/apple-photos-import/20260626T111500Z-other-album"
            manifest_path = repo_root / local_server.IMPORT_CACHE_MANIFEST_PATH
            manifest_path.parent.mkdir(parents=True, exist_ok=True)
            manifest_path.write_text(
                json.dumps(
                    {
                        "photos": [
                            {
                                "id": "apple-14th-street",
                                "relative_path": "0001-EC8_1474.jpg",
                                "source_path_hint": str(source_root / "0001-EC8_1474.jpg"),
                                "source_file": {
                                    "path": str(source_root / "0001-EC8_1474.jpg"),
                                    "name": "0001-EC8_1474.jpg",
                                    "extension": "jpg",
                                    "bytes": 1234,
                                    "apple_photos_album": {"title": "14th Street"},
                                },
                                "metadata": [{"label": "Apple Photos album", "value": "14th Street"}],
                                "capture": {"year": 2019, "sort": "2019-01-03T00:49:40"},
                                "dimensions": {"width": 2304, "height": 1536},
                                "gallery_country": {"slug": "unknown", "label": "Unknown"},
                                "location": {"country": None, "region": None, "city": None, "location": None},
                                "media_type": "photo",
                            },
                            {
                                "id": "other-album",
                                "relative_path": "0001-other.jpg",
                                "source_path_hint": str(other_root / "0001-other.jpg"),
                                "source_file": {
                                    "path": str(other_root / "0001-other.jpg"),
                                    "name": "0001-other.jpg",
                                    "extension": "jpg",
                                },
                                "capture": {"year": 2020, "sort": "2020-01-01T00:00:00"},
                                "media_type": "photo",
                            },
                        ]
                    }
                ),
                encoding="utf-8",
            )
            conn = owner_state_db.connect(repo_root)
            try:
                self._seed_r2_preview_pair(conn, "apple-14th-street")
                self._seed_r2_preview_pair(conn, "other-album")
                conn.commit()
            finally:
                conn.close()

            result = local_server.queue_import_cache_title_keyword_review(
                repo_root,
                source_root=source_root,
                source_label="14th Street",
            )

            self.assertEqual(result["queued"], 1)
            self.assertTrue((repo_root / result["path"]).exists())

            payload = local_server.title_keyword_review_queue_payload(repo_root)
            self.assertEqual([item["photo_id"] for item in payload["photos"]], ["apple-14th-street"])
            review_photo = payload["photos"][0]
            self.assertEqual(review_photo["proposed"]["title"], "14th Street")
            self.assertIn("14th Street", review_photo["proposed"]["keywords"])
            self.assertIn("2019", review_photo["proposed"]["keywords"])
            self.assertFalse(any("{" in keyword or "}" in keyword for keyword in review_photo["proposed"]["keywords"]))
            self.assertEqual(review_photo["source"]["album"], "14th Street")
            self.assertEqual(payload["selection"]["sqlite_pending_count"], 1)

    def test_blocked_rework_rows_count_as_blocked_not_rejected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            conn = owner_state_db.connect(repo_root)
            try:
                self._seed_title_keyword_row(conn, "blocked-rework-photo", "blocked")
                owner_state_db._upsert_queue(
                    conn,
                    media_id="blocked-rework-photo",
                    review_state="blocked",
                    latest_attempt=1,
                    batch_id="batch-review-test",
                    proposed_at="2026-06-14T08:00:00Z",
                    reviewed_at="2026-06-14T08:01:00Z",
                    rework_priority=True,
                    rejected_count=2,
                    owner_comment="old rejection context should not make blocked rows active",
                )
                conn.commit()
            finally:
                conn.close()

            counts = owner_state_db.title_keyword_review_counts(repo_root)
            self.assertEqual(counts["blocked"], 1)
            self.assertEqual(counts["rejected"], 0)

    def test_auto_apply_approved_rows_updates_catalog_state_and_applied_at(self):
        photo_id = "approved-pending-auto"
        photo = {
            "id": photo_id,
            "title": "Old Title",
            "keywords": ["Old"],
            "metadata": [{"label": "Keywords", "value": "Old"}],
            "media": {"type": "photo", "publicPreview": {"allowed": True}},
        }
        state = {
            "expo": {slug: [] for slug in local_server.ORDER},
            "reserve": {slug: [] for slug in local_server.ORDER},
            "hidden": {slug: [] for slug in local_server.ORDER},
        }
        state["expo"]["france"].append(copy.deepcopy(photo))

        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            conn = owner_state_db.connect(repo_root)
            try:
                self._seed_title_keyword_row(conn, photo_id, "approved")
                self._clear_title_keyword_applied_at(conn, photo_id)
                conn.commit()
            finally:
                conn.close()

            with patched_server_state(state, photo):
                result = local_server.apply_photo_action(
                    repo_root,
                    {
                        "action": "apply-approved-title-keyword-review-approvals",
                        "reason": "unit-test",
                    },
                )

            self.assertEqual(result["pending_count"], 1)
            self.assertEqual(result["approved_count"], 1)
            self.assertEqual(result["applied_count"], 1)
            self.assertEqual(result["not_found"], [])
            updated = state["expo"]["france"][0]
            self.assertEqual(updated["title"], f"{photo_id} Title")
            self.assertEqual(updated["keywords"], ["France", "Travel"])
            flags = next(item for item in updated["metadata"] if item["label"] == "Flags")
            self.assertIn(local_server.TITLE_KEYWORD_REVIEW_FLAG, flags["value"])

            conn = sqlite3.connect(repo_root / "assets/owner-actions/Owner.sqlite")
            conn.row_factory = sqlite3.Row
            try:
                row = conn.execute(
                    """
                    SELECT q.review_state, q.applied_at AS queue_applied_at,
                           d.applied_at AS decision_applied_at
                    FROM title_keyword_queue AS q
                    JOIN title_keyword_decisions AS d
                      ON d.media_id = q.media_id
                     AND d.attempt = q.latest_attempt
                    WHERE q.media_id = ?
                    """,
                    (photo_id,),
                ).fetchone()
                self.assertEqual(row["review_state"], "approved")
                self.assertTrue(row["queue_applied_at"])
                self.assertTrue(row["decision_applied_at"])
            finally:
                conn.close()

    def test_auto_apply_failure_keeps_approved_rows_unapplied(self):
        photo_id = "approved-missing-auto"
        fallback_photo = {"id": "unused-fallback", "title": "Unused"}
        state = {
            "expo": {slug: [] for slug in local_server.ORDER},
            "reserve": {slug: [] for slug in local_server.ORDER},
            "hidden": {slug: [] for slug in local_server.ORDER},
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            conn = owner_state_db.connect(repo_root)
            try:
                self._seed_title_keyword_row(conn, photo_id, "approved")
                self._clear_title_keyword_applied_at(conn, photo_id)
                conn.commit()
            finally:
                conn.close()

            with patched_server_state(state, fallback_photo):
                with self.assertRaises(ValueError):
                    local_server.apply_photo_action(
                        repo_root,
                        {
                            "action": "apply-approved-title-keyword-review-approvals",
                            "reason": "unit-test",
                        },
                    )

            conn = sqlite3.connect(repo_root / "assets/owner-actions/Owner.sqlite")
            conn.row_factory = sqlite3.Row
            try:
                row = conn.execute(
                    """
                    SELECT q.review_state, q.applied_at AS queue_applied_at,
                           d.applied_at AS decision_applied_at
                    FROM title_keyword_queue AS q
                    JOIN title_keyword_decisions AS d
                      ON d.media_id = q.media_id
                     AND d.attempt = q.latest_attempt
                    WHERE q.media_id = ?
                    """,
                    (photo_id,),
                ).fetchone()
                self.assertEqual(row["review_state"], "approved")
                self.assertIsNone(row["queue_applied_at"])
                self.assertIsNone(row["decision_applied_at"])
            finally:
                conn.close()

    def test_auto_apply_tolerates_approved_pre_catalog_import_rows(self):
        photo_id = "approved-pre-catalog-import"
        fallback_photo = {"id": "unused-fallback", "title": "Unused"}
        state = {
            "expo": {slug: [] for slug in local_server.ORDER},
            "reserve": {slug: [] for slug in local_server.ORDER},
            "hidden": {slug: [] for slug in local_server.ORDER},
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            self._write_import_manifest(repo_root, [photo_id])
            conn = owner_state_db.connect(repo_root)
            try:
                self._seed_title_keyword_row(conn, photo_id, "approved")
                self._clear_title_keyword_applied_at(conn, photo_id)
                self._seed_r2_preview_pair(conn, photo_id)
                conn.commit()
            finally:
                conn.close()

            with patched_server_state(state, fallback_photo):
                result = local_server.apply_photo_action(
                    repo_root,
                    {
                        "action": "apply-approved-title-keyword-review-approvals",
                        "reason": "unit-test",
                    },
                )

            self.assertEqual(result["pending_count"], 1)
            self.assertEqual(result["approved_count"], 1)
            self.assertEqual(result["applied_count"], 0)
            self.assertEqual(result["not_found"], [photo_id])
            self.assertEqual(result["pre_catalog_not_found"], [photo_id])

            conn = sqlite3.connect(repo_root / "assets/owner-actions/Owner.sqlite")
            conn.row_factory = sqlite3.Row
            try:
                row = conn.execute(
                    """
                    SELECT q.review_state, q.applied_at AS queue_applied_at,
                           d.applied_at AS decision_applied_at
                    FROM title_keyword_queue AS q
                    JOIN title_keyword_decisions AS d
                      ON d.media_id = q.media_id
                     AND d.attempt = q.latest_attempt
                    WHERE q.media_id = ?
                    """,
                    (photo_id,),
                ).fetchone()
                self.assertEqual(row["review_state"], "approved")
                self.assertTrue(row["queue_applied_at"])
                self.assertTrue(row["decision_applied_at"])
            finally:
                conn.close()

    def test_direct_approval_tolerates_pre_catalog_import_rows(self):
        photo_id = "direct-approved-pre-catalog-import"
        fallback_photo = {"id": "unused-fallback", "title": "Unused"}
        state = {
            "expo": {slug: [] for slug in local_server.ORDER},
            "reserve": {slug: [] for slug in local_server.ORDER},
            "hidden": {slug: [] for slug in local_server.ORDER},
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            self._write_import_manifest(repo_root, [photo_id])
            conn = owner_state_db.connect(repo_root)
            try:
                self._seed_title_keyword_row(conn, photo_id, "proposed")
                self._seed_r2_preview_pair(conn, photo_id)
                conn.commit()
            finally:
                conn.close()

            with patched_server_state(state, fallback_photo):
                result = local_server.apply_photo_action(
                    repo_root,
                    {
                        "action": "save-title-keyword-review-approvals",
                        "batch_id": "batch-review-test",
                        "approvals": [
                            {
                                "photo_id": photo_id,
                                "approved": True,
                                "title": "Direct Import Title",
                                "keywords": ["Apple Photos", "Import"],
                            }
                        ],
                    },
                )

            self.assertEqual(result["approved_count"], 1)
            self.assertEqual(result["applied_count"], 0)
            self.assertEqual(result["not_found"], [photo_id])
            self.assertEqual(result["pre_catalog_not_found"], [photo_id])

            conn = sqlite3.connect(repo_root / "assets/owner-actions/Owner.sqlite")
            conn.row_factory = sqlite3.Row
            try:
                row = conn.execute(
                    """
                    SELECT q.review_state, q.applied_at AS queue_applied_at,
                           d.decision_state, d.decided_title, d.applied_at AS decision_applied_at
                    FROM title_keyword_queue AS q
                    JOIN title_keyword_decisions AS d
                      ON d.media_id = q.media_id
                     AND d.attempt = q.latest_attempt
                    WHERE q.media_id = ?
                    """,
                    (photo_id,),
                ).fetchone()
                self.assertEqual(row["review_state"], "approved")
                self.assertEqual(row["decision_state"], "accepted")
                self.assertEqual(row["decided_title"], "Direct Import Title")
                self.assertTrue(row["queue_applied_at"])
                self.assertTrue(row["decision_applied_at"])
            finally:
                conn.close()

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

    def test_owner_burst_cull_preview_uses_less_than_one_second_boundary(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            self._write_burst_manifest(
                repo_root,
                [
                    ("burst-a", "2026-06-14T08:00:00.000", {}),
                    ("burst-b", "2026-06-14T08:00:00.999", {}),
                    ("separate-c", "2026-06-14T08:00:01.999", {}),
                ],
            )

            preview = local_server.owner_burst_cull_preview(repo_root)
            self.assertEqual(preview["counts"]["eligible"], 3)
            self.assertEqual(preview["counts"]["burst_groups"], 1)
            self.assertEqual(preview["counts"]["survivors"], 1)
            self.assertEqual(preview["counts"]["non_burst_kept"], 1)
            self.assertEqual(preview["counts"]["waste_basket_moves"], 1)
            outcomes = {item["photo_id"]: item["outcome"] for item in preview["candidates"]}
            self.assertEqual(outcomes["burst-a"], "waste-basket")
            self.assertEqual(outcomes["burst-b"], "survivor-keep")
            self.assertEqual(outcomes["separate-c"], "non-burst-keep")

            protected_preview = local_server.owner_burst_cull_preview(repo_root, ["burst-a"])
            protected = {item["photo_id"]: item["reason"] for item in protected_preview["protected"]}
            self.assertIn("liked/basket/order protected", protected["burst-a"])
            self.assertEqual(protected_preview["counts"]["waste_basket_moves"], 0)

    def test_owner_burst_cull_preview_keeps_every_fourth_from_second_for_large_burst(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            self._write_burst_manifest(
                repo_root,
                [(f"burst-{index}", f"2026-06-14T08:00:00.{index:03d}", {}) for index in range(10)],
            )

            preview = local_server.owner_burst_cull_preview(repo_root)
            survivors = [
                item["photo_id"]
                for item in preview["candidates"]
                if item["outcome"] == "survivor-keep"
            ]
            self.assertEqual(survivors, ["burst-1", "burst-5", "burst-9"])
            self.assertEqual(preview["counts"]["waste_basket_moves"], 7)

    def test_owner_burst_cull_run_discards_only_rejects_and_protects_approved(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            self._write_burst_manifest(
                repo_root,
                [
                    ("reject-a", "2026-06-14T08:00:00.000", {}),
                    ("survivor-b", "2026-06-14T08:00:00.100", {}),
                    ("reject-c", "2026-06-14T08:00:00.200", {}),
                    ("approved-d", "2026-06-14T08:00:00.300", {}),
                ],
            )
            self._write_catalog_db(repo_root, [("approved-d", "Approved D", "2026-06-14T08:00:00.300")])

            result = local_server.owner_burst_cull_run(repo_root)
            self.assertEqual(result["counts"]["waste_basket_moves"], 2)
            applied = {item["photo_id"] for item in result["outcomes"] if item.get("applied")}
            self.assertEqual(applied, {"reject-a", "reject-c"})
            protected = {item["photo_id"]: item["reason"] for item in result["protected"]}
            self.assertIn("approved/public catalog", protected["approved-d"])

            conn = sqlite3.connect(repo_root / "assets/owner-actions/Owner.sqlite")
            conn.row_factory = sqlite3.Row
            try:
                states = {
                    row["media_id"]: row["lifecycle_state"]
                    for row in conn.execute("SELECT media_id, lifecycle_state FROM media_lifecycle")
                }
            finally:
                conn.close()
            self.assertEqual(states, {"reject-a": "discarded", "reject-c": "discarded"})

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

    def test_public_waste_basket_restore_preserves_private_title(self):
        photo_id = "pbe-private-title-restore"
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            local_server._record_hidden_lifecycle(repo_root, [{
                "id": photo_id,
                "title": "Original private title",
                "from_state": "expo",
                "from_slug": "usa",
            }])

            result = local_server.apply_public_photo_moderation(repo_root, {
                "operation": "undo-hide-many",
                "photo_ids": [photo_id],
                "restoreTitles": {photo_id: "Browser supplied title must be ignored"},
            })

            self.assertEqual(result["restored_ids"], [photo_id])
            self.assertEqual(result["lifecycle"]["title_restored"], 1)
            conn = sqlite3.connect(repo_root / "assets/owner-actions/Owner.sqlite")
            conn.row_factory = sqlite3.Row
            try:
                lifecycle = conn.execute(
                    "SELECT lifecycle_state, title FROM media_lifecycle WHERE media_id = ?",
                    (photo_id,),
                ).fetchone()
                self.assertEqual(lifecycle["lifecycle_state"], "active")
                self.assertEqual(lifecycle["title"], "Original private title")
                decision = conn.execute(
                    """
                    SELECT d.decision_state, d.decided_title, d.applied_at
                    FROM title_keyword_queue q
                    JOIN title_keyword_decisions d
                      ON d.media_id = q.media_id AND d.attempt = q.latest_attempt
                    WHERE q.media_id = ?
                    """,
                    (photo_id,),
                ).fetchone()
                self.assertEqual(decision["decision_state"], "accepted")
                self.assertEqual(decision["decided_title"], "Original private title")
                self.assertTrue(decision["applied_at"])
            finally:
                conn.close()

    def test_public_waste_basket_restore_cancels_atomically_without_private_title(self):
        missing_title_id = "pbe-private-title-missing"
        valid_title_id = "pbe-private-title-valid"
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            local_server._record_hidden_lifecycle(repo_root, [
                {"id": missing_title_id, "title": "", "from_state": "expo", "from_slug": "usa"},
                {"id": valid_title_id, "title": "Valid private title", "from_state": "expo", "from_slug": "usa"},
            ])

            with self.assertRaisesRegex(ValueError, "private title could not be recovered"):
                local_server.apply_public_photo_moderation(repo_root, {
                    "operation": "undo-hide-many",
                    "photo_ids": [valid_title_id, missing_title_id],
                    "restoreTitles": {missing_title_id: "Untrusted browser fallback"},
                })

            conn = sqlite3.connect(repo_root / "assets/owner-actions/Owner.sqlite")
            try:
                states = dict(conn.execute(
                    "SELECT media_id, lifecycle_state FROM media_lifecycle ORDER BY media_id"
                ).fetchall())
                self.assertEqual(states[missing_title_id], "hidden")
                self.assertEqual(states[valid_title_id], "hidden")
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
