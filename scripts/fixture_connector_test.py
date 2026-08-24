import sys
import tempfile
import unittest
import hashlib
import os
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import local_server
import owner_state_db
import sidecar_state_db
from fixture_pipeline import (
    apply_fixture_review_action,
    connect,
    create_fixture,
    link_access_grant,
    set_fixture_asset_state,
)


def action(mode, **manifest):
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


class FixtureConnectorTest(unittest.TestCase):
    def test_photos_sync_db_writes_retry_transient_locks(self):
        attempts = 0

        def operation():
            nonlocal attempts
            attempts += 1
            if attempts < 3:
                raise sqlite3.OperationalError("database is locked")
            return {"ok": True}

        self.assertEqual(
            local_server._retry_photos_sync_db_write(operation, delays=(0, 0)),
            {"ok": True},
        )
        self.assertEqual(attempts, 3)

    def test_photos_sync_recovery_does_not_terminalize_legacy_rows_by_age(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            with connect(root) as connection:
                connection.executemany(
                    """
                    INSERT INTO photos_sync_runs (
                      run_id, status, stage, created_at, updated_at
                    ) VALUES (?, 'running', 'Reading Apple Photos metadata', ?, ?)
                    """,
                    [
                        (
                            "stale-run",
                            "2026-08-19T10:00:00Z",
                            "2026-08-19T10:00:00Z",
                        ),
                        (
                            "fresh-run",
                            "2026-08-19T11:45:00Z",
                            "2026-08-19T11:45:00Z",
                        ),
                    ],
                )
                connection.execute(
                    """
                    INSERT INTO photos_sync_runs (
                      run_id, status, stage, created_at, updated_at, completed_at
                    ) VALUES (
                      'completed-run', 'completed', 'Completed',
                      '2026-08-19T08:00:00Z', '2026-08-19T08:05:00Z',
                      '2026-08-19T08:05:00Z'
                    )
                    """
                )
                connection.commit()

            result = local_server._reconcile_stale_photos_sync_runs(
                root,
                now=datetime(2026, 8, 19, 12, 0, tzinfo=timezone.utc),
                stale_after_seconds=60 * 60,
            )
            self.assertEqual(result["recoveredCount"], 0)
            self.assertEqual(result["reviewedCount"], 1)
            self.assertEqual(result["reviewRunIds"], ["stale-run"])

            with connect(root) as connection:
                rows = {
                    row["run_id"]: row
                    for row in connection.execute(
                        """
                        SELECT run_id, status, stage, error_text, completed_at,
                               recovery_state, recovery_reason
                        FROM photos_sync_runs
                        """
                    )
                }
            self.assertEqual(rows["stale-run"]["status"], "running")
            self.assertEqual(rows["stale-run"]["recovery_state"], "needs-review")
            self.assertIn("no durable worker PID/token", rows["stale-run"]["recovery_reason"])
            self.assertIsNone(rows["stale-run"]["completed_at"])
            self.assertEqual(rows["fresh-run"]["status"], "running")
            self.assertEqual(rows["completed-run"]["status"], "completed")

    def test_photos_sync_recovery_terminalizes_only_a_verified_dead_worker(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            with connect(root) as connection:
                connection.execute(
                    """
                    INSERT INTO photos_sync_runs (
                      run_id, status, stage, worker_pid, worker_token,
                      created_at, updated_at
                    ) VALUES (
                      'dead-worker', 'running', 'Reading Apple Photos metadata',
                      ?, 'worker-token-dead', '2026-08-19T10:00:00Z',
                      '2026-08-19T10:00:00Z'
                    )
                    """,
                    (os.getpid(),),
                )
                connection.commit()

            result = local_server._reconcile_stale_photos_sync_runs(
                root,
                now=datetime(2026, 8, 19, 12, 0, tzinfo=timezone.utc),
                stale_after_seconds=60 * 60,
            )
            self.assertEqual(result["recoveredCount"], 1)
            self.assertEqual(result["recoveredRunIds"], ["dead-worker"])

            with connect(root) as connection:
                row = connection.execute(
                    "SELECT status, recovery_state, recovery_reason FROM photos_sync_runs WHERE run_id = 'dead-worker'"
                ).fetchone()
            self.assertEqual(row["status"], "failed")
            self.assertEqual(row["recovery_state"], "recovered")
            self.assertIn("no longer active", row["recovery_reason"])

    def test_photos_sync_recovery_observes_a_worker_that_died_in_another_process(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            worker = subprocess.Popen([sys.executable, "-c", "pass"])
            worker_pid = worker.pid
            worker.wait(timeout=5)
            with connect(root) as connection:
                connection.execute(
                    """
                    INSERT INTO photos_sync_runs (
                      run_id, status, stage, worker_pid, worker_token,
                      created_at, updated_at
                    ) VALUES (
                      'cross-process-dead-worker', 'running', 'Reading Apple Photos metadata',
                      ?, 'worker-token-cross-process', '2026-08-19T10:00:00Z',
                      '2026-08-19T10:00:00Z'
                    )
                    """,
                    (worker_pid,),
                )
                connection.commit()

            result = local_server._reconcile_stale_photos_sync_runs(
                root,
                now=datetime(2026, 8, 19, 12, 0, tzinfo=timezone.utc),
                stale_after_seconds=60 * 60,
            )
            self.assertEqual(result["recoveredCount"], 1)
            self.assertEqual(result["recoveredRunIds"], ["cross-process-dead-worker"])

    def test_photos_sync_worker_persists_failure_receipt(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            with connect(root) as connection:
                connection.execute(
                    """
                    INSERT INTO photos_sync_runs (
                      run_id, status, stage, created_at, updated_at
                    ) VALUES (
                      'failed-worker', 'running', 'Queued',
                      '2026-08-19T10:00:00Z', '2026-08-19T10:00:00Z'
                    )
                    """
                )
                connection.commit()

            with patch.object(
                local_server,
                "_incremental_photos_sync",
                side_effect=RuntimeError("PhotoKit unavailable"),
            ):
                local_server._run_photos_sync_task(root, "failed-worker", 25)

            status = local_server._photos_sync_run_status(root, "failed-worker")
            self.assertEqual(status["status"], "failed")
            self.assertEqual(status["stage"], "Failed")
            self.assertEqual(status["error"], "PhotoKit unavailable")
            self.assertTrue(status["completedAt"])

    def test_photos_sync_start_finishes_inside_the_action_process(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            with connect(root):
                pass
            result = {
                "ok": True,
                "requested": 2,
                "scanned": 2,
                "remaining": 0,
                "changes": {
                    "baseline": 1,
                    "unchanged": 1,
                    "metadataOnly": 0,
                    "appearance": 0,
                    "sourceMissing": 0,
                    "sourceReturned": 0,
                },
                "failures": [],
                "elapsedSeconds": 0.5,
            }
            with patch.object(local_server, "_incremental_photos_sync", return_value=result), patch.object(
                local_server.threading,
                "Thread",
                side_effect=AssertionError("Photos sync must not outlive its action process"),
            ):
                status = local_server._start_photos_sync_run(root, limit=2)

            self.assertEqual(status["status"], "completed")
            self.assertEqual(status["scanned"], 2)
            self.assertEqual(status["remaining"], 0)
            self.assertTrue(status["completedAt"])
            with connect(root) as connection:
                row = connection.execute(
                    "SELECT status, completed_at FROM photos_sync_runs WHERE run_id = ?",
                    (status["runId"],),
                ).fetchone()
            self.assertEqual(row["status"], "completed")
            self.assertTrue(row["completed_at"])

    def test_connector_exposes_fixture_state_and_effective_access(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sidecar_state_db.upsert_assets(root, [
                {
                    "localIdentifier": "asset-1",
                    "filename": "One.JPG",
                    "mediaType": "photo",
                    "creationDate": "2026-07-15T10:00:00Z",
                },
            ])
            expo = create_fixture(root, "Expo", fixture_id="fixture-expo")
            child = create_fixture(
                root,
                "Child",
                parent_fixture_id=expo["fixtureId"],
                fixture_id="fixture-child",
            )
            link_access_grant(
                root,
                expo["fixtureId"],
                provider="acs",
                external_identity="family@example.test",
            )

            plan = local_server.new_owner_connector_result(
                root,
                action("fixture-state-migration-plan"),
            )
            self.assertTrue(plan["result"]["readOnly"])
            self.assertEqual(
                plan["result"]["migration"]["migrationId"],
                "fixture-state-v1",
            )

            applied = local_server.new_owner_connector_result(
                root,
                action(
                    "fixture-state-apply",
                    fixtureId=expo["fixtureId"],
                    assetIds=["asset-1"],
                    placementState="picked",
                ),
            )
            self.assertEqual(
                applied["result"]["fixtureState"]["items"][0]["placement_state"],
                "picked",
            )
            universe = local_server.new_owner_connector_result(
                root,
                action(
                    "fixture-candidate-universe",
                    fixtureId=child["fixtureId"],
                ),
            )
            self.assertEqual(
                universe["result"]["candidateUniverse"]["assetIds"],
                ["asset-1"],
            )
            culling = local_server.new_owner_connector_result(
                root,
                action(
                    "fixture-culling-window",
                    fixtureId=expo["fixtureId"],
                    view="picked",
                    limit=200,
                ),
            )
            self.assertTrue(culling["result"]["readOnly"])
            self.assertEqual(culling["result"]["cullingWindow"]["count"], 1)
            self.assertEqual(
                culling["result"]["cullingWindow"]["items"][0]["assetId"],
                "asset-1",
            )
            review = local_server.new_owner_connector_result(
                root,
                action(
                    "fixture-review-window",
                    fixtureId=expo["fixtureId"],
                    limit=200,
                ),
            )
            self.assertTrue(review["result"]["readOnly"])
            self.assertEqual(
                review["result"]["reviewWindow"]["items"][0]["assetId"],
                "asset-1",
            )
            requested = local_server.new_owner_connector_result(
                root,
                action(
                    "fixture-review-apply",
                    fixtureId=expo["fixtureId"],
                    assetIds=["asset-1"],
                    anchorAssetId="asset-1",
                    reviewAction="request-ai",
                    aiReasons=["missing location"],
                    aiNote="Use the visible landmark.",
                ),
            )
            self.assertEqual(
                requested["result"]["reviewAction"]["items"][0]["after"]["editorialState"],
                "requesting-ai",
            )
            self.assertGreaterEqual(
                requested["result"]["reviewAction"]["timing"]["localTransaction"]["durationMs"],
                0,
            )
            self.assertNotIn(
                "previewCapture",
                requested["result"]["reviewAction"],
            )
            undone = local_server.new_owner_connector_result(
                root,
                action(
                    "fixture-review-undo",
                    operationId=requested["result"]["reviewAction"]["operationId"],
                ),
            )
            self.assertFalse(undone["result"]["readOnly"])
            self.assertEqual(
                undone["result"]["reviewUndo"]["items"][0]["after"]["editorial"][
                    "editorial_state"
                ],
                "unreviewed",
            )
            self.assertGreaterEqual(
                undone["result"]["reviewUndo"]["timing"]["localTransaction"]["durationMs"],
                0,
            )
            access = local_server.new_owner_connector_result(
                root,
                action(
                    "fixture-access-effective",
                    fixtureId=child["fixtureId"],
                ),
            )
            self.assertEqual(access["result"]["access"]["count"], 1)
            self.assertTrue(access["result"]["access"]["items"][0]["inherited"])

    def test_connector_lists_private_lifecycle_titles_without_mutation(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sidecar_state_db.upsert_assets(root, [{
                "localIdentifier": "photos-hidden",
                "filename": "Hidden Rendered.mp4",
                "preferredResourceFilename": "Hidden Original.MOV",
                "mediaType": "video",
                "creationDate": "2026-07-24T10:00:00Z",
            }])
            with owner_state_db.connect(root) as connection:
                connection.execute(
                    """INSERT INTO media_lifecycle
                       (media_id, lifecycle_state, source_slug, title, media_type,
                        source_paths_json, public_preview_keys_json, private_keys_json,
                        updated_at)
                       VALUES (?, 'hidden', 'france', 'Private saved title', 'video',
                               '[]', '[]', '[]', ?)""",
                    ("photo-hidden", "2026-07-25T00:00:00Z"),
                )
                connection.execute(
                    """INSERT INTO media_lifecycle
                       (media_id, lifecycle_state, source_slug, title, media_type,
                        source_paths_json, public_preview_keys_json, private_keys_json,
                        updated_at)
                       VALUES (?, 'discarded', 'spain', 'Discarded audit title', 'photo',
                               '[]', '[]', '[]', ?)""",
                    ("photo-discarded", "2026-07-25T00:00:01Z"),
                )
                connection.commit()

            with sidecar_state_db.connect(root) as connection:
                connection.execute(
                    """INSERT INTO sidecar_upload_bridge_runs
                       (run_id, mode, status, execute_upload, limit_count, created_at, updated_at)
                       VALUES (?, 'upload', 'completed', 1, 1, ?, ?)""",
                    ("bridge-lifecycle", "2026-07-25T00:00:00Z", "2026-07-25T00:00:00Z"),
                )
                connection.execute(
                    """INSERT INTO sidecar_upload_bridge_run_items
                       (run_item_id, run_id, asset_id, photo_id, filename, media_type,
                        status, upload_status, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, 'uploaded', 'uploaded', ?, ?)""",
                    (
                        "bridge-item-lifecycle",
                        "bridge-lifecycle",
                        "photos-hidden",
                        "photo-hidden",
                        "Hidden Rendered.mp4",
                        "video",
                        "2026-07-25T00:00:00Z",
                        "2026-07-25T00:00:00Z",
                    ),
                )
                connection.commit()

            database = root / "assets/owner-actions/Owner.sqlite"
            before = hashlib.sha256(database.read_bytes()).hexdigest()
            listed = local_server.new_owner_connector_result(
                root,
                action("fixture-lifecycle-list", states=["hidden"]),
            )
            after = hashlib.sha256(database.read_bytes()).hexdigest()

        self.assertTrue(listed["result"]["readOnly"])
        self.assertEqual(after, before)
        self.assertEqual(listed["result"]["lifecycle"]["hiddenCount"], 1)
        self.assertEqual(listed["result"]["lifecycle"]["discardedCount"], 1)
        self.assertEqual(len(listed["result"]["lifecycle"]["items"]), 1)
        self.assertEqual(
            listed["result"]["lifecycle"]["items"][0]["title"],
            "Private saved title",
        )
        self.assertEqual(
            listed["result"]["lifecycle"]["items"][0]["filename"],
            "Hidden Original.MOV",
        )
        self.assertEqual(
            listed["result"]["lifecycle"]["items"][0]["capturedAt"],
            "2026-07-24T10:00:00Z",
        )
        self.assertEqual(
            listed["result"]["lifecycle"]["items"][0]["photoLibraryIdentifier"],
            "photos-hidden",
        )
        self.assertNotIn("previewPath", listed["result"]["lifecycle"]["items"][0])
        self.assertNotIn("quickLookPath", listed["result"]["lifecycle"]["items"][0])

    def test_connector_lists_native_asset_lifecycle_filename_without_bridge_row(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sidecar_state_db.upsert_assets(root, [{
                "localIdentifier": "photos-native-hidden",
                "filename": "Native Hidden.jpg",
                "preferredResourceFilename": "Native Hidden.heic",
                "mediaType": "photo",
                "creationDate": "2026-08-24T08:33:09Z",
            }])
            with owner_state_db.connect(root) as connection:
                connection.execute(
                    """INSERT INTO media_lifecycle
                       (media_id, lifecycle_state, source_slug, title, media_type,
                        hidden_at, source_paths_json, public_preview_keys_json,
                        private_keys_json, updated_at)
                       VALUES (?, 'hidden', 'expo', 'Native hidden title', 'photo',
                               ?, '[]', '[]', '[]', ?)""",
                    (
                        "photos-native-hidden",
                        "2026-08-24T08:33:09Z",
                        "2026-08-24T08:33:09Z",
                    ),
                )
                connection.commit()

            listed = local_server.new_owner_connector_result(
                root,
                action("fixture-lifecycle-list", states=["hidden"]),
            )

        item = listed["result"]["lifecycle"]["items"][0]
        self.assertEqual(item["filename"], "Native Hidden.heic")
        self.assertEqual(item["capturedAt"], "2026-08-24T08:33:09Z")
        self.assertEqual(item["updatedAt"], "2026-08-24T08:33:09Z")

    def test_connector_supports_tree_search_pool_and_delivery_plan(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sidecar_state_db.upsert_assets(root, [
                {"localIdentifier": "asset-1", "filename": "LaConcha.JPG", "mediaType": "photo", "creationDate": "2026-07-15T10:00:00Z"},
            ])
            created = local_server.new_owner_connector_result(root, action("fixture-create", name="La Concha", templateKey="real-estate"))
            fixture_id = created["result"]["fixture"]["fixtureId"]
            configuration = local_server.new_owner_connector_result(
                root,
                action("fixture-configuration-get", fixtureId=fixture_id),
            )
            self.assertTrue(configuration["result"]["readOnly"])
            self.assertEqual(
                configuration["result"]["configuration"]["policy"]["effective"]["commerce"],
                "paid-service",
            )
            configured = local_server.new_owner_connector_result(
                root,
                action(
                    "fixture-configuration-set",
                    fixtureId=fixture_id,
                    populationMode="rule-based",
                    candidateSource={"kind": "photos-library"},
                    savedRule={"query": "LaConcha"},
                    policyOverrides={"commerce": "free-sharing"},
                    reason="connector policy test",
                ),
            )
            self.assertFalse(configured["result"]["readOnly"])
            self.assertEqual(
                configured["result"]["configuration"]["populationMode"],
                "rule-based",
            )
            self.assertEqual(
                configured["result"]["configuration"]["policy"]["effective"]["commerce"],
                "free-sharing",
            )
            migration_plan = local_server.new_owner_connector_result(
                root,
                action("fixture-policy-migration-plan"),
            )
            self.assertTrue(migration_plan["result"]["readOnly"])
            self.assertEqual(
                migration_plan["result"]["migration"]["migrationId"],
                "fixture-policy-v1",
            )
            migration = local_server.new_owner_connector_result(
                root,
                action("fixture-policy-migration-apply"),
            )
            self.assertFalse(migration["result"]["readOnly"])
            self.assertTrue(migration["result"]["migration"]["applied"])
            replay = local_server.new_owner_connector_result(
                root,
                action("fixture-policy-migration-apply"),
            )
            self.assertFalse(replay["result"]["migration"]["applied"])
            self.assertTrue(replay["result"]["migration"]["alreadyApplied"])
            archived = local_server.new_owner_connector_result(root, action("fixture-archive", fixtureId=fixture_id))
            self.assertTrue(archived["result"]["fixture"]["archivedAt"])
            listed = local_server.new_owner_connector_result(root, action("fixture-tree-list", includeArchived=True))
            self.assertEqual(listed["result"]["fixtures"][0]["fixtureId"], fixture_id)
            reopened = local_server.new_owner_connector_result(root, action("fixture-reopen", fixtureId=fixture_id))
            self.assertFalse(reopened["result"]["fixture"]["archivedAt"])
            searched = local_server.new_owner_connector_result(root, action("fixture-search", filters={"query": "LaConcha"}))
            self.assertTrue(searched["result"]["readOnly"])
            self.assertEqual(searched["result"]["candidateCount"], 1)
            pooled = local_server.new_owner_connector_result(root, action(
                "fixture-pool-create",
                fixtureId=fixture_id,
                selectedAssetIds=["asset-1"],
                criteria={"query": "LaConcha"},
            ))
            self.assertEqual(
                pooled["result"]["pool"]["contract"]["savedRule"],
                {"query": "LaConcha"},
            )
            self.assertNotIn("sidecarUrl", pooled["result"])
            pools = local_server.new_owner_connector_result(root, action(
                "fixture-pool-list",
                fixtureId=fixture_id,
            ))
            self.assertTrue(pools["result"]["readOnly"])
            self.assertEqual(
                [item["poolId"] for item in pools["result"]["pools"]],
                [pooled["result"]["pool"]["poolId"]],
            )
            with patch.dict("os.environ", {"PBE_ENABLE_LEGACY_SIDECAR": "1"}):
                legacy_open = local_server.new_owner_connector_result(root, action(
                    "fixture-pool-open",
                    poolId=pooled["result"]["pool"]["poolId"],
                ))
            self.assertIn("?pool=pool-", legacy_open["result"]["sidecarUrl"])
            self.assertEqual(
                pooled["result"]["pool"]["assets"],
                [{
                    "assetId": "asset-1",
                    "sourceKind": "apple_photos",
                    "sourceIdentity": "apple-photos://asset-1",
                    "photoLibraryIdentifier": "asset-1",
                    "sourceBatchId": "",
                    "position": 0,
                    "title": "",
                    "filename": "LaConcha.JPG",
                    "mediaType": "photo",
                    "provenance": {"sourceAnchor": "apple-photos://asset-1", "albums": []},
                    "addedAt": pooled["result"]["pool"]["assets"][0]["addedAt"],
                }],
            )
            second = local_server.new_owner_connector_result(root, action("fixture-create", name="Apartment 2"))
            routed = local_server.new_owner_connector_result(root, action(
                "fixture-place-multi",
                fixtureIds=[second["result"]["fixture"]["fixtureId"]],
                assetIds=["asset-1"],
            ))
            self.assertEqual(routed["result"]["ledger"]["count"], 2)
            planned = local_server.new_owner_connector_result(root, action("fixture-delivery-plan", fixtureId=fixture_id))
            self.assertEqual(planned["result"]["delivery"]["assetCount"], 1)
            self.assertFalse(planned["result"]["clientMessageSent"])
            health = local_server.new_owner_connector_result(
                root,
                action("fixture-upload-health", fixtureId=fixture_id),
            )
            self.assertTrue(health["result"]["readOnly"])
            self.assertEqual(health["result"]["uploadHealth"]["activeAssetCount"], 1)
            self.assertEqual(health["result"]["uploadHealth"]["fixtureId"], fixture_id)
            linked = local_server.new_owner_connector_result(root, action(
                "fixture-deliverable-link",
                fixtureId=fixture_id,
                kind="pdf",
                provider="share-link",
                externalIdentity="https://example.invalid/private.pdf",
            ))
            self.assertEqual(linked["result"]["deliverables"]["count"], 1)
            listed_deliverables = local_server.new_owner_connector_result(
                root,
                action("fixture-deliverable-list", fixtureId=fixture_id),
            )
            self.assertTrue(listed_deliverables["result"]["readOnly"])
            self.assertEqual(
                listed_deliverables["result"]["deliverables"]["items"][0]["kind"],
                "pdf",
            )
            local_server.new_owner_connector_result(root, action("fixture-destinations", fixtureId=fixture_id, assetIds=["asset-1"], destinations=["r2", "apple_photos"]))
            photos_plan = local_server.new_owner_connector_result(root, action("fixture-photos-writeback-plan", fixtureId=fixture_id))
            self.assertTrue(photos_plan["result"]["readOnly"])
            self.assertEqual(photos_plan["result"]["photosWriteback"]["blockedCount"], 0)

    def test_connector_starts_and_reports_bounded_native_publication(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sidecar_state_db.upsert_assets(
                root,
                [{
                    "localIdentifier": "asset-1",
                    "filename": "One.JPG",
                    "mediaType": "photo",
                    "creationDate": "2026-07-15T10:00:00Z",
                }],
            )
            fixture = create_fixture(root, "Expo", fixture_id="fixture-expo")
            set_fixture_asset_state(root, fixture["fixtureId"], ["asset-1"], "picked")
            apply_fixture_review_action(
                root,
                fixture["fixtureId"],
                ["asset-1"],
                "approve",
            )

            with patch.object(
                local_server,
                "_start_native_publication_run",
                return_value={
                    "started": True,
                    "pid": 42,
                    "logPath": "/tmp/native-publication.log",
                },
            ) as start:
                created = local_server.new_owner_connector_result(
                    root,
                    action(
                        "asset-upload-run-start",
                        assetIds=["asset-1"],
                        limit=100,
                        concurrency=99,
                    ),
                )

            run = created["result"]["uploadRun"]
            self.assertFalse(created["result"]["readOnly"])
            self.assertEqual(run["count"], 1)
            self.assertEqual(run["limit"], 50)
            self.assertEqual(run["concurrency"], 8)
            self.assertTrue(run["started"])
            start.assert_called_once_with(root, run["runId"])

            status = local_server.new_owner_connector_result(
                root,
                action("asset-upload-run-status", runId=run["runId"]),
            )
            self.assertTrue(status["result"]["readOnly"])
            self.assertEqual(status["result"]["uploadRun"]["requested"], 1)
            self.assertEqual(status["result"]["uploadRun"]["remaining"], 1)

    def test_connector_imports_photos_snapshot_and_previews_r2_reconciliation(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sidecar_state_db.upsert_assets(
                root,
                [{
                    "localIdentifier": "asset-1",
                    "filename": "One.JPG",
                    "mediaType": "photo",
                    "creationDate": "2026-07-15T10:00:00Z",
                }],
            )
            imported = local_server.new_owner_connector_result(
                root,
                action(
                    "photos-sync-snapshot",
                    items=[{
                        "assetId": "asset-1",
                        "photosAssetId": "asset-1",
                        "title": "One",
                        "keywords": ["Spain"],
                        "renderedFingerprint": "render-one",
                    }],
                ),
            )
            self.assertEqual(imported["result"]["photosSync"]["changes"]["baseline"], 1)

            with connect(root) as connection:
                connection.execute(
                    """
                    INSERT INTO r2_objects (
                      bucket, object_key, photo_id, object_kind, lifecycle_state,
                      first_seen_at, updated_at
                    ) VALUES (
                      'photosbyelie-private', 'masters/orphan.jpg', 'asset-1',
                      'master', 'current',
                      '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
                    )
                    """
                )
                connection.commit()

            preview = local_server.new_owner_connector_result(
                root,
                action("r2-reconciliation-plan"),
            )
            self.assertTrue(preview["result"]["readOnly"])
            self.assertEqual(preview["result"]["reconciliation"]["scanned"], 1)
            self.assertEqual(preview["result"]["reconciliation"]["quarantined"], 1)

    def test_incremental_photos_sync_batches_metadata_and_rendered_previews(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sidecar_state_db.upsert_assets(
                root,
                [{
                    "localIdentifier": "photos-local-1",
                    "assetId": "asset-1",
                    "filename": "One.JPG",
                    "mediaType": "photo",
                    "creationDate": "2026-07-15T10:00:00Z",
                }],
            )

            class FakeAdapter:
                def read_many(self, requests):
                    return [{
                        "assetId": requests[0]["assetId"],
                        "title": "One",
                        "caption": "Caption",
                        "keywords": ["Spain"],
                    }]

            def fake_preview(_photo_id, destination, _max_pixel, _timeout):
                Path(destination).write_bytes(b"rendered-current-jpeg")
                return {"ok": True, "destination": str(destination)}

            synced = local_server._incremental_photos_sync(
                root,
                limit=25,
                adapter=FakeAdapter(),
                preview_runner=fake_preview,
            )
            self.assertEqual(synced["requested"], 1)
            self.assertEqual(synced["scanned"], 1)
            self.assertEqual(synced["changes"]["baseline"], 1)
            self.assertEqual(synced["failures"], [])
            with connect(root) as connection:
                state = connection.execute(
                    "SELECT * FROM asset_sync_state WHERE asset_id = 'asset-1'"
                ).fetchone()
            self.assertEqual(state["photos_asset_id"], "photos-local-1")
            self.assertEqual(
                state["rendered_fingerprint"],
                hashlib.sha256(b"rendered-current-jpeg").hexdigest(),
            )

            with patch.object(
                local_server,
                "_incremental_photos_sync",
                return_value=synced,
            ) as incremental:
                routed = local_server.new_owner_connector_result(
                    root,
                    action("photos-sync-run", limit=25),
                )
            incremental.assert_called_once_with(root, limit=25)
            self.assertFalse(routed["result"]["readOnly"])
            self.assertEqual(routed["result"]["photosSync"]["scanned"], 1)

    def test_incremental_photos_sync_cancellation_keeps_completed_asset_checkpoints(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            sidecar_state_db.upsert_assets(
                root,
                [
                    {"localIdentifier": "photos-local-1", "assetId": "asset-1", "filename": "One.JPG", "mediaType": "photo"},
                    {"localIdentifier": "photos-local-2", "assetId": "asset-2", "filename": "Two.JPG", "mediaType": "photo"},
                ],
            )

            class FakeAdapter:
                def read_many(self, requests):
                    return [
                        {"assetId": request["assetId"], "title": request["assetId"], "keywords": ["Spain"]}
                        for request in requests
                    ]

            def fake_preview(photo_id, destination, _max_pixel, _timeout):
                Path(destination).write_bytes(photo_id.encode())
                return {"ok": True, "destination": str(destination)}

            should_stop = {"value": False}

            def progress(values):
                if values.get("scanned") == 1:
                    should_stop["value"] = True

            result = local_server._incremental_photos_sync(
                root,
                limit=25,
                adapter=FakeAdapter(),
                preview_runner=fake_preview,
                cancel_requested=lambda: should_stop["value"],
                progress=progress,
            )
            self.assertTrue(result["cancelled"])
            self.assertEqual(result["scanned"], 1)
            self.assertEqual(result["remaining"], 1)
            with connect(root) as connection:
                self.assertEqual(
                    connection.execute("SELECT count(*) total FROM asset_sync_state").fetchone()["total"],
                    1,
                )

    def test_incremental_sync_preview_path_has_no_standalone_bridge_batch_fallback(self):
        source = Path(local_server.__file__).read_text(encoding="utf-8")
        start = source.index("def _request_backstage_preview_for_sync")
        end = source.index("def _photos_sync_run_status", start)
        sync_source = source[start:end]

        self.assertIn("request_preview", sync_source)
        self.assertNotIn("_run_apple_photos_bridge", sync_source)
        self.assertNotIn("preview-many", sync_source)


if __name__ == "__main__":
    unittest.main()
