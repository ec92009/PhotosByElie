"""Synthetic acceptance coverage for the PBB-79 Owner SQLite lifecycle gateway."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
import hashlib
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))

import fixture_pipeline
import owner_state_db
import sidecar_state_db
import waste_basket_gateway as gateway


NOW = "2026-08-09T12:00:00Z"
AUDITED_LEGACY_MARKER = {
    "kind": "PBB-78-legacy-expo-hidden",
    "planDigest": "synthetic-plan-digest",
    "auditReceipt": "synthetic-audit-receipt",
}


class WasteBasketGatewayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.db = self.root / "assets" / "owner-actions" / "Owner.sqlite"
        gateway.ensure_schema(self.root, self.db)
        self._seed_asset("asset-1", with_fixture=True)
        self._seed_asset("asset-2")
        self._seed_asset("asset-3")
        self._seed_asset("asset-4")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _seed_asset(self, asset_id: str, *, with_fixture: bool = False) -> None:
        with sidecar_state_db.connect(self.root, self.db) as connection:
            connection.execute(
                """
                INSERT OR REPLACE INTO sidecar_assets
                  (asset_id, source_anchor, media_type, filename, captured_at,
                   favorite, hidden, raw_json, indexed_at, updated_at)
                VALUES (?, ?, 'photo', ?, ?, 1, 0, ?, ?, ?)
                """,
                (
                    asset_id,
                    f"apple-photos://{asset_id}",
                    f"{asset_id}.jpg",
                    NOW,
                    json.dumps({"source": "synthetic", "asset": asset_id}),
                    NOW,
                    NOW,
                ),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO sidecar_decisions
                  (asset_id, rating, color, pick_state, metadata_state, title,
                   caption, keywords_json, last_action, created_at, updated_at)
                VALUES (?, 4, 'green', 'picked', 'approved', ?, ?, ?, 'approve', ?, ?)
                """,
                (
                    asset_id,
                    f"Title {asset_id}",
                    f"Caption {asset_id}",
                    json.dumps(["synthetic", asset_id]),
                    NOW,
                    NOW,
                ),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO sidecar_pending_sync
                  (sync_id, asset_id, field_family, old_value_json, new_value_json,
                   status, created_at, updated_at)
                VALUES (?, ?, 'metadata', '{}', '{}', 'pending', ?, ?)
                """,
                (f"sync-{asset_id}", asset_id, NOW, NOW),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO media_lifecycle
                  (media_id, lifecycle_state, previous_state, previous_slug,
                   source_slug, title, media_type, source_paths_json,
                   public_preview_keys_json, private_keys_json, updated_at)
                VALUES (?, 'active', 'active', 'expo', 'expo', ?, 'photo', ?, ?, ?, ?)
                """,
                (
                    asset_id,
                    f"Title {asset_id}",
                    json.dumps([f"source/{asset_id}.jpg"]),
                    json.dumps([f"expo/{asset_id}_900.jpg"]),
                    json.dumps([f"private/{asset_id}.jpg"]),
                    NOW,
                ),
            )
            if not with_fixture:
                return
            connection.execute(
                """
                INSERT OR IGNORE INTO fixtures
                  (fixture_id, parent_fixture_id, name, slug, tags_json,
                   destination_defaults_json, access_gallery_key, created_at, updated_at)
                VALUES ('fixture-1', NULL, 'Synthetic Fixture', 'synthetic-fixture',
                        '[]', '[\"r2\"]', 'synthetic-gallery', ?, ?)
                """,
                (NOW, NOW),
            )
            connection.execute(
                """
                INSERT OR IGNORE INTO fixture_culling_pools
                  (pool_id, fixture_id, name, criteria_json, snapshot_hash,
                   asset_count, state, created_at, updated_at)
                VALUES ('pool-1', 'fixture-1', 'Synthetic Pool', '{}', 'pool-hash', 1,
                        'active', ?, ?)
                """,
                (NOW, NOW),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO fixture_pool_assets
                  (pool_id, asset_id, source_kind, source_identity, snapshot_position,
                   provenance_json, added_at)
                VALUES ('pool-1', ?, 'apple-photos', ?, 0, ?, ?)
                """,
                (asset_id, f"apple://{asset_id}", json.dumps({"asset": asset_id}), NOW),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO fixture_asset_placements
                  (placement_id, fixture_id, asset_id, source_pool_id, state,
                   placed_at, updated_at)
                VALUES ('placement-1', 'fixture-1', ?, 'pool-1', 'active', ?, ?)
                """,
                (asset_id, NOW, NOW),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO fixture_asset_decisions
                  (fixture_id, asset_id, placement_state, eligibility_state,
                   source, last_action, created_at, updated_at)
                VALUES ('fixture-1', ?, 'picked', 'active', 'synthetic', 'pick', ?, ?)
                """,
                (asset_id, NOW, NOW),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO fixture_asset_decision_events
                  (event_id, fixture_id, asset_id, before_state, after_state,
                   before_eligibility, after_eligibility, action, actor, reason, created_at)
                VALUES ('decision-event-1', 'fixture-1', ?, 'undecided', 'picked',
                        'active', 'active', 'pick', 'synthetic', 'seed', ?)
                """,
                (asset_id, NOW),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO fixture_placement_events
                  (event_id, placement_id, asset_id, to_fixture_id, action, actor, reason, created_at)
                VALUES ('placement-event-1', 'placement-1', ?, 'fixture-1', 'place', 'synthetic', 'seed', ?)
                """,
                (asset_id, NOW),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO asset_editorial_state
                  (asset_id, editorial_state, ai_note, created_at, updated_at)
                VALUES (?, 'approved', 'synthetic approval', ?, ?)
                """,
                (asset_id, NOW, NOW),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO asset_delivery_state
                  (asset_id, delivery_state, source_version_hash, created_at, updated_at)
                VALUES (?, 'live', 'source-hash-1', ?, ?)
                """,
                (asset_id, NOW, NOW),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO asset_source_versions
                  (version_id, asset_id, metadata_fingerprint, rendered_fingerprint,
                   source_exists, state, created_at, live_at)
                VALUES ('version-1', ?, 'metadata-hash-1', 'rendered-hash-1', 1, 'live', ?, ?)
                """,
                (asset_id, NOW, NOW),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO asset_publications
                  (asset_id, fixture_id, source_version_hash, state, published_at, updated_at)
                VALUES (?, 'fixture-1', 'source-hash-1', 'live', ?, ?)
                """,
                (asset_id, NOW, NOW),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO public_catalog_publications
                  (asset_id, source_version_hash, media_id, state, public_url,
                   catalog_sha256, created_at, updated_at)
                VALUES (?, 'source-hash-1', ?, 'live', 'https://synthetic.invalid/photo', 'catalog-hash', ?, ?)
                """,
                (asset_id, asset_id, NOW, NOW),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO asset_sale_references
                  (order_id, asset_id, source_version_hash, checksum_sha256,
                   master_key, derivative_keys_json, recorded_at)
                VALUES ('order-1', ?, 'source-hash-1', 'checksum', 'master/key', '[]', ?)
                """,
                (asset_id, NOW),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO fixture_asset_destinations
                  (fixture_id, asset_id, destinations_json, version_hash, configured_at, updated_at)
                VALUES ('fixture-1', ?, '[\"r2\"]', 'source-hash-1', ?, ?)
                """,
                (asset_id, NOW, NOW),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO fixture_delivery_receipts
                  (receipt_id, fixture_id, asset_id, destination, version_hash,
                   status, object_key, checksum_sha256, visibility_policy,
                   verification_json, created_at, updated_at)
                VALUES ('delivery-1', 'fixture-1', ?, 'r2', 'source-hash-1',
                        'verified', 'expo/key.jpg', 'checksum', 'public', '{}', ?, ?)
                """,
                (asset_id, NOW, NOW),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO asset_editorial_events
                  (event_id, asset_id, fixture_id, action, before_state, after_state,
                   before_json, after_json, actor, created_at)
                VALUES ('editorial-event-1', ?, 'fixture-1', 'approve', 'proposed',
                        'approved', '{}', '{}', 'synthetic', ?)
                """,
                (asset_id, NOW),
            )
            connection.execute(
                """
                INSERT OR REPLACE INTO r2_objects
                  (bucket, object_key, photo_id, object_kind, lifecycle_state,
                   first_seen_at, last_seen_at, source, bytes, updated_at)
                VALUES ('public', ?, ?, 'preview', 'current', ?, ?, 'synthetic', 12, ?)
                """,
                (f"expo/{asset_id}_900.jpg", asset_id, NOW, NOW, NOW),
            )

    def _seed_uploaded_r2_identity(
        self,
        *,
        upload_asset_id: str,
        photo_id: str,
    ) -> None:
        """Record one successful durable upload identity and its current R2 objects."""
        run_id = f"run-{photo_id}"
        with sidecar_state_db.connect(self.root, self.db) as connection:
            connection.execute(
                """INSERT OR REPLACE INTO sidecar_upload_bridge_runs
                     (run_id, mode, status, execute_upload, limit_count,
                      started_at, completed_at, summary_json, created_at, updated_at)
                   VALUES (?, 'execute', 'completed', 1, 1, ?, ?, '{}', ?, ?)""",
                (run_id, NOW, NOW, NOW, NOW),
            )
            connection.execute(
                """INSERT OR REPLACE INTO sidecar_upload_bridge_run_items
                     (run_item_id, run_id, asset_id, photo_id, filename, media_type,
                      queued_at, status, export_status, planned_keys_json,
                      created_at, updated_at, upload_status, upload_keys_json)
                   VALUES (?, ?, ?, ?, ?, 'photo', ?, 'uploaded', 'exported', '[]',
                           ?, ?, 'uploaded', '[]')""",
                (
                    f"item-{photo_id}",
                    run_id,
                    upload_asset_id,
                    photo_id,
                    f"{photo_id}.jpg",
                    NOW,
                    NOW,
                    NOW,
                ),
            )
            for bucket, object_key, kind in (
                ("public", f"expo/{photo_id}_900.jpg", "public-preview"),
                ("private", f"masters/{photo_id}.jpg", "private-master"),
            ):
                connection.execute(
                    """INSERT OR REPLACE INTO r2_objects
                         (bucket, object_key, photo_id, object_kind, lifecycle_state,
                          first_seen_at, last_seen_at, source, bytes, updated_at)
                       VALUES (?, ?, ?, ?, 'current', ?, ?, 'synthetic-upload', 12, ?)""",
                    (bucket, object_key, photo_id, kind, NOW, NOW, NOW),
                )

    def _arm(self, operation_id: str, *, operation: str = "x", revision: int = 17) -> dict:
        members = gateway.derive_deployed_lifecycle_members(self.root, ["asset-1"], self.db)
        denied = operation not in {"restore", "tombstone-restore"}
        envelope = {
            "operationId": operation_id,
            "operation": operation,
            "denied": denied,
            "members": members,
        }
        digest = hashlib.sha256(
            json.dumps(envelope, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        return {
            "ok": True,
            "operationId": operation_id,
            "operationDigest": digest,
            "operation": operation,
            "denied": denied,
            "revision": revision,
            "state": "armed",
            "members": [{
                "canonicalAssetId": item["canonicalAssetId"],
                "canonicalMediaId": item["canonicalMediaId"],
                "revision": revision,
            } for item in members],
        }

    def _rows(self, table: str, column: str, value: str) -> list[dict[str, object]]:
        with sidecar_state_db.connect(self.root, self.db) as connection:
            rows = [
                dict(row)
                for row in connection.execute(
                    f"SELECT * FROM {table} WHERE {column} = ?",
                    (value,),
                ).fetchall()
            ]
        return sorted(rows, key=lambda row: json.dumps(row, sort_keys=True, default=str))

    def _lifecycle_snapshot(self) -> dict[str, list[dict[str, object]]]:
        identities = {
            "sidecar_assets": "asset_id",
            "sidecar_decisions": "asset_id",
            "sidecar_pending_sync": "asset_id",
            "media_lifecycle": "media_id",
            "fixture_pool_assets": "asset_id",
            "fixture_asset_placements": "asset_id",
            "fixture_asset_decisions": "asset_id",
            "fixture_asset_decision_events": "asset_id",
            "fixture_placement_events": "asset_id",
            "asset_editorial_state": "asset_id",
            "asset_delivery_state": "asset_id",
            "asset_source_versions": "asset_id",
            "asset_publications": "asset_id",
            "public_catalog_publications": "asset_id",
            "asset_sale_references": "asset_id",
            "fixture_asset_destinations": "asset_id",
            "fixture_delivery_receipts": "asset_id",
            "asset_editorial_events": "asset_id",
            "r2_objects": "photo_id",
        }
        return {
            table: self._rows(table, column, "asset-1")
            for table, column in identities.items()
        }

    def test_hosted_lifecycle_queue_is_durable_sanitized_and_idempotent(self) -> None:
        queued = gateway.queue_hosted_lifecycle_request(
            self.root, operation="waste-basket-x", asset_ids=["asset-1"],
            session_id="session-one", fixture_id="fixture-1",
            request_key="browser-secret-idempotency-key", db_path=self.db,
        )
        replay = gateway.queue_hosted_lifecycle_request(
            self.root, operation="waste-basket-x", asset_ids=["asset-1"],
            session_id="session-one", fixture_id="fixture-1",
            request_key="browser-secret-idempotency-key", db_path=self.db,
        )
        self.assertEqual(replay["requestId"], queued["requestId"])
        self.assertEqual(queued["state"], "queued")
        with sqlite3.connect(self.db) as connection:
            row = connection.execute("SELECT * FROM owner_hosted_lifecycle_requests").fetchone()
            columns = [item[1] for item in connection.execute(
                "PRAGMA table_info(owner_hosted_lifecycle_requests)"
            )]
        self.assertNotIn("browser-secret-idempotency-key", repr(row))
        self.assertFalse(any(fragment in column.casefold() for column in columns for fragment in ("token", "auth", "member")))
        with self.assertRaisesRegex(gateway.WasteBasketError, "conflicts"):
            gateway.queue_hosted_lifecycle_request(
                self.root, operation="waste-basket-restore", asset_ids=["asset-1"],
                session_id="session-one", fixture_id="fixture-1",
                request_key="browser-secret-idempotency-key", db_path=self.db,
            )

    def test_hosted_lifecycle_status_is_session_bound_and_restart_replayable(self) -> None:
        queued = gateway.queue_hosted_lifecycle_request(
            self.root, operation="waste-basket-restore", asset_ids=["asset-1"],
            session_id="session-one", fixture_id="fixture-1",
            request_key="restore-one", db_path=self.db,
        )
        with self.assertRaises(gateway.WasteBasketError):
            gateway.hosted_lifecycle_request_status(
                self.root, queued["requestId"], session_id="attacker",
                fixture_id="fixture-1", db_path=self.db,
            )
        gateway.claim_hosted_lifecycle_request(self.root, queued["requestId"], self.db)
        restarted = gateway.claim_hosted_lifecycle_request(self.root, queued["requestId"], self.db)
        self.assertEqual(restarted["attemptCount"], 2)
        completed = gateway.finish_hosted_lifecycle_request(
            self.root, queued["requestId"],
            result={"ok": True, "restored": ["asset-1"]}, db_path=self.db,
        )
        self.assertEqual(completed["state"], "completed")
        replay = gateway.finish_hosted_lifecycle_request(
            self.root, queued["requestId"], result={"attacker": True}, db_path=self.db,
        )
        self.assertEqual(replay["result"], {"ok": True, "restored": ["asset-1"]})

    def test_hosted_retry_budget_blocks_with_an_actionable_disposition(self) -> None:
        queued = gateway.queue_hosted_lifecycle_request(
            self.root, operation="waste-basket-x", asset_ids=["asset-1"],
            session_id="session-one", fixture_id="fixture-1",
            request_key="bounded-missing-r2", db_path=self.db,
        )
        error = "canonical R2 mapping is missing for asset-1"
        for attempt in range(gateway.MAX_HOSTED_LIFECYCLE_ATTEMPTS):
            claimed = gateway.claim_hosted_lifecycle_request(
                self.root, queued["requestId"], self.db
            )
            self.assertEqual(claimed["attemptCount"], attempt + 1)
            finished = gateway.finish_hosted_lifecycle_request(
                self.root,
                queued["requestId"],
                error=error,
                retryable=True,
                db_path=self.db,
            )
            if attempt + 1 < gateway.MAX_HOSTED_LIFECYCLE_ATTEMPTS:
                self.assertEqual(finished["state"], "queued")
            else:
                self.assertEqual(finished["state"], "blocked")
                self.assertEqual(finished["disposition"], "blocked")
                self.assertEqual(finished["attemptCount"], gateway.MAX_HOSTED_LIFECYCLE_ATTEMPTS)
                self.assertIn("Repair the canonical R2 mapping", finished["nextAction"])

        with sqlite3.connect(self.db) as connection:
            row = connection.execute(
                """SELECT state, disposition, attempt_count, completed_at, blocked_at
                   FROM owner_hosted_lifecycle_requests WHERE request_id = ?""",
                (queued["requestId"],),
            ).fetchone()
        self.assertEqual(row[0], "failed")
        self.assertEqual(row[1], "blocked")
        self.assertEqual(row[2], gateway.MAX_HOSTED_LIFECYCLE_ATTEMPTS)
        self.assertTrue(row[3])
        self.assertTrue(row[4])

    def test_existing_over_budget_request_is_blocked_without_another_attempt(self) -> None:
        queued = gateway.queue_hosted_lifecycle_request(
            self.root, operation="waste-basket-x", asset_ids=["asset-1"],
            session_id="session-one", fixture_id="fixture-1",
            request_key="legacy-over-budget", db_path=self.db,
        )
        with sqlite3.connect(self.db) as connection:
            connection.execute(
                """UPDATE owner_hosted_lifecycle_requests
                   SET state = 'running', attempt_count = ?,
                       error_text = 'canonical R2 mapping is missing for asset-1'
                   WHERE request_id = ?""",
                (gateway.MAX_HOSTED_LIFECYCLE_ATTEMPTS + 1000, queued["requestId"]),
            )
        blocked = gateway.claim_hosted_lifecycle_request(
            self.root, queued["requestId"], self.db
        )
        self.assertEqual(blocked["state"], "blocked")
        self.assertEqual(blocked["attemptCount"], gateway.MAX_HOSTED_LIFECYCLE_ATTEMPTS + 1000)
        self.assertIn("Automatic retries stopped", blocked["error"])

    def test_active_hosted_request_is_recovered_without_replaying_a_new_intent(self) -> None:
        with patch.object(gateway.uuid, "uuid4", return_value=uuid.UUID(int=(1 << 128) - 1)):
            queued = gateway.queue_hosted_lifecycle_request(
                self.root, operation="waste-basket-x", asset_ids=["asset-1"],
                session_id="session-one", fixture_id="fixture-1",
                request_key="first-browser-intent", db_path=self.db,
            )
        resumed = gateway.queue_hosted_lifecycle_request(
            self.root, operation="waste-basket-restore", asset_ids=["asset-2"],
            session_id="session-one", fixture_id="fixture-1",
            request_key="second-browser-intent", db_path=self.db,
        )
        self.assertEqual(resumed["requestId"], queued["requestId"])
        self.assertTrue(resumed["resumedActive"])
        self.assertEqual(resumed["operation"], "waste-basket-x")
        self.assertEqual(resumed["assetIds"], ["asset-1"])
        self.assertEqual(
            gateway.latest_hosted_lifecycle_request(
                self.root, session_id="session-one", fixture_id="fixture-1", db_path=self.db,
            )["requestId"],
            queued["requestId"],
        )
        self.assertIsNone(gateway.latest_hosted_lifecycle_request(
            self.root, session_id="other-session", fixture_id="fixture-1", db_path=self.db,
        ))
        self.assertIsNone(gateway.latest_hosted_lifecycle_request(
            self.root, session_id="session-one", fixture_id="other-fixture", db_path=self.db,
        ))
        with sqlite3.connect(self.db) as connection:
            count = connection.execute(
                "SELECT COUNT(*) FROM owner_hosted_lifecycle_requests"
            ).fetchone()[0]
        self.assertEqual(count, 1)

        gateway.claim_hosted_lifecycle_request(self.root, queued["requestId"], self.db)
        gateway.finish_hosted_lifecycle_request(
            self.root, queued["requestId"], result={"ok": True}, db_path=self.db,
        )
        with patch.object(gateway.uuid, "uuid4", return_value=uuid.UUID(int=0)):
            next_request = gateway.queue_hosted_lifecycle_request(
                self.root, operation="waste-basket-restore", asset_ids=["asset-2"],
                session_id="session-one", fixture_id="fixture-1",
                request_key="third-browser-intent", db_path=self.db,
            )
        self.assertNotEqual(next_request["requestId"], queued["requestId"])
        self.assertNotIn("resumedActive", next_request)
        with sqlite3.connect(self.db) as connection:
            connection.execute(
                "UPDATE owner_hosted_lifecycle_requests SET created_at = ?",
                (NOW,),
            )
        latest = gateway.latest_hosted_lifecycle_request(
            self.root, session_id="session-one", fixture_id="fixture-1", db_path=self.db,
        )
        self.assertEqual(latest["requestId"], next_request["requestId"])

    def test_completed_hosted_result_projection_update_is_scoped_and_optimistic(self) -> None:
        queued = gateway.queue_hosted_lifecycle_request(
            self.root, operation="waste-basket-restore", asset_ids=["asset-1"],
            session_id="session-one", fixture_id="fixture-1",
            request_key="projection-result", db_path=self.db,
        )
        gateway.claim_hosted_lifecycle_request(self.root, queued["requestId"], self.db)
        original = {
            "ok": True,
            "operationId": f"owner-action:hosted-lifecycle:{queued['requestId']}",
            "authoritative_committed": True,
            "projection": {"state": "pending", "retryable": True},
        }
        gateway.finish_hosted_lifecycle_request(
            self.root, queued["requestId"], result=original, db_path=self.db,
        )
        replacement = {
            **original,
            "projection": {"state": "applied", "retryable": False},
        }
        updated = gateway.replace_completed_hosted_lifecycle_result(
            self.root,
            queued["requestId"],
            session_id="session-one",
            fixture_id="fixture-1",
            expected_result=original,
            result=replacement,
            db_path=self.db,
        )
        self.assertEqual(updated["state"], "completed")
        self.assertEqual(updated["operation"], "waste-basket-restore")
        self.assertEqual(updated["assetIds"], ["asset-1"])
        self.assertEqual(updated["result"], replacement)
        with self.assertRaisesRegex(gateway.WasteBasketError, "changed before retry"):
            gateway.replace_completed_hosted_lifecycle_result(
                self.root,
                queued["requestId"],
                session_id="session-one",
                fixture_id="fixture-1",
                expected_result=original,
                result={"attacker": True},
                db_path=self.db,
            )
        with self.assertRaisesRegex(gateway.WasteBasketError, "unavailable"):
            gateway.replace_completed_hosted_lifecycle_result(
                self.root,
                queued["requestId"],
                session_id="other-session",
                fixture_id="fixture-1",
                expected_result=replacement,
                result=replacement,
                db_path=self.db,
            )

    def test_culling_review_and_owner_gallery_share_authorized_gateway(self) -> None:
        culling = gateway.move_to_waste_basket(
            self.root,
            ["asset-1"],
            source="backstage-culling",
            fixture_id="fixture-1",
            request_key="culling-x-1",
            db_path=self.db,
        )
        self.assertEqual(culling["state"], "recoverable")
        gateway.restore_from_waste_basket(self.root, ["asset-1"], request_key="culling-restore-1", db_path=self.db)

        review = gateway.move_to_waste_basket(
            self.root,
            ["asset-2"],
            source="backstage-review",
            fixture_id="fixture-1",
            request_key="review-x-1",
            db_path=self.db,
        )
        self.assertEqual(review["items"][0]["status"], "applied")
        gateway.restore_from_waste_basket(self.root, ["asset-2"], request_key="review-restore-1", db_path=self.db)

        with self.assertRaises(gateway.OwnerAuthorizationError):
            gateway.move_to_waste_basket(
                self.root,
                ["asset-3"],
                source="owner-gallery",
                owner_mode=True,
                owner_authorized=False,
                request_key="gallery-denied-1",
                db_path=self.db,
            )
        gallery = gateway.move_to_waste_basket(
            self.root,
            ["asset-3"],
            source="owner-gallery",
            owner_mode=True,
            owner_authorized=True,
            gallery_id="owner-gallery-1",
            request_key="gallery-x-1",
            db_path=self.db,
        )
        self.assertEqual(gallery["items"][0]["source"], "owner-gallery")

    def test_hosted_restore_is_transactionally_bound_to_its_fixture(self) -> None:
        gateway.move_to_waste_basket(
            self.root,
            ["asset-2"],
            source="owner-gallery",
            fixture_id="fixture-current",
            gallery_id="fixture-current",
            owner_mode=True,
            owner_authorized=True,
            request_key="fixture-bound-x",
            db_path=self.db,
        )

        with self.assertRaisesRegex(gateway.WasteBasketError, "outside the frozen fixture"):
            gateway.restore_from_waste_basket(
                self.root,
                ["asset-2"],
                fixture_id="fixture-other",
                request_key="fixture-bound-restore-denied",
                db_path=self.db,
            )
        self.assertTrue(gateway.is_globally_ineligible(self.root, "asset-2", self.db))

        restored = gateway.restore_from_waste_basket(
            self.root,
            ["asset-2"],
            fixture_id="fixture-current",
            request_key="fixture-bound-restore-allowed",
            db_path=self.db,
        )
        self.assertEqual(restored["state"], "restored")
        self.assertEqual(restored["assetIds"], ["asset-2"])
        self.assertFalse(gateway.is_globally_ineligible(self.root, "asset-2", self.db))

        retried = gateway.restore_from_waste_basket(
            self.root,
            ["asset-2"],
            fixture_id="fixture-current",
            request_key="fixture-bound-restore-new-request-after-ack-loss",
            db_path=self.db,
        )
        self.assertEqual(retried["assetIds"], ["asset-2"])
        self.assertEqual(retried["items"][0]["status"], "already-restored")
        with sqlite3.connect(self.db) as connection:
            receipt = connection.execute(
                """
                SELECT r.receipt_state
                FROM owner_waste_basket_receipts AS r
                JOIN owner_waste_basket_operations AS o ON o.operation_id = r.operation_id
                WHERE o.request_key = ? AND r.asset_id = ?
                """,
                ("fixture-bound-restore-new-request-after-ack-loss", "asset-2"),
            ).fetchone()
        self.assertEqual(receipt, ("already-applied",))

    def test_local_mutation_and_deployed_outbox_commit_atomically_and_resume(self) -> None:
        arm = self._arm("cloud-op-1")
        gateway.record_deployed_lifecycle_arm(self.root, "x", ["asset-1"], arm, self.db)
        result = gateway.move_to_waste_basket(
            self.root,
            ["asset-1"],
            source="backstage-culling",
            request_key="cloud-op-1",
            deployed_lifecycle=arm,
            db_path=self.db,
        )
        self.assertEqual(result["operationId"], "cloud-op-1")
        outbox = gateway.deployed_lifecycle_outbox(self.root, "cloud-op-1", self.db)
        self.assertEqual(outbox["revision"], 17)
        self.assertEqual(outbox["state"], "locally_committed")
        self.assertEqual(outbox["receipts"][0]["canonicalMediaId"], "asset-1")
        self.assertTrue(outbox["receipts"][0]["denied"])

        replay = gateway.move_to_waste_basket(
            self.root,
            ["asset-1"],
            source="backstage-culling",
            request_key="cloud-op-1",
            deployed_lifecycle=arm,
            db_path=self.db,
        )
        self.assertEqual(replay, result)
        gateway.acknowledge_deployed_lifecycle(
            self.root, "cloud-op-1", arm["operationDigest"], state="deployed_applied", db_path=self.db
        )
        acked = gateway.acknowledge_deployed_lifecycle(
            self.root, "cloud-op-1", arm["operationDigest"], state="locally_acked", db_path=self.db
        )
        self.assertEqual(acked["state"], "locally_acked")

    def test_bad_arm_receipt_rolls_back_local_mutation_and_outbox(self) -> None:
        arm = self._arm("cloud-op-bad", revision=18)
        arm["members"][0]["canonicalAssetId"] = "another-asset"
        with self.assertRaisesRegex(gateway.WasteBasketError, "authoritative"):
            gateway.record_deployed_lifecycle_arm(self.root, "x", ["asset-1"], arm, self.db)
        self.assertFalse(gateway.is_globally_ineligible(self.root, "asset-1", self.db))
        with sqlite3.connect(self.db) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM owner_lifecycle_outbox").fetchone()[0], 0)

    def test_missing_pre_persisted_arm_rolls_back_local_mutation(self) -> None:
        arm = self._arm("cloud-op-not-persisted", revision=19)
        with self.assertRaisesRegex(gateway.WasteBasketError, "not persisted"):
            gateway.move_to_waste_basket(
                self.root,
                ["asset-1"],
                source="backstage-culling",
                request_key="cloud-op-not-persisted",
                deployed_lifecycle=arm,
                db_path=self.db,
            )
        self.assertFalse(gateway.is_globally_ineligible(self.root, "asset-1", self.db))
        with sqlite3.connect(self.db) as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT state FROM owner_lifecycle_operations WHERE operation_id = ?",
                    ("cloud-op-not-persisted",),
                ).fetchone(),
                None,
            )

    def test_armed_state_yields_deterministic_abort_proof_until_local_commit(self) -> None:
        arm = self._arm("cloud-op-abort")
        gateway.record_deployed_lifecycle_arm(self.root, "x", ["asset-1"], arm, self.db)
        first = gateway.deployed_lifecycle_abort_proof(
            self.root, "cloud-op-abort", arm["operationDigest"], self.db
        )
        second = gateway.deployed_lifecycle_abort_proof(
            self.root, "cloud-op-abort", arm["operationDigest"], self.db
        )
        self.assertEqual(first, second)
        self.assertFalse(first["localMutationCommitted"])
        self.assertEqual(first["kind"], "owner-sqlite-no-local-commit-v1")
        self.assertEqual(
            first["proofDigest"],
            "d38789c3b4a245e996a8384bd8c0d4864bff6e13002833765fb6ae577846e0f3",
        )
        gateway.move_to_waste_basket(
            self.root,
            ["asset-1"],
            source="backstage-culling",
            request_key="cloud-op-abort",
            deployed_lifecycle=arm,
            db_path=self.db,
        )
        self.assertIsNone(gateway.deployed_lifecycle_abort_proof(
            self.root, "cloud-op-abort", arm["operationDigest"], self.db
        ))

    def test_exact_provenance_restore_preserves_relationships_and_state(self) -> None:
        before = self._lifecycle_snapshot()
        moved = gateway.move_to_waste_basket(
            self.root,
            ["asset-1"],
            source="backstage-culling",
            fixture_id="fixture-1",
            gallery_id="gallery-1",
            reason="synthetic X",
            request_key="exact-x-1",
            db_path=self.db,
        )
        self.assertTrue(gateway.is_globally_ineligible(self.root, "asset-1", self.db))
        self.assertFalse(gateway.is_globally_blocked(self.root, "asset-1", self.db))
        after_x = self._lifecycle_snapshot()
        for table in before:
            if table in {"sidecar_assets", "sidecar_decisions", "media_lifecycle"}:
                continue
            self.assertEqual(after_x[table], before[table], table)
        with sidecar_state_db.connect(self.root, self.db) as connection:
            relations = {
                row["relation_name"]
                for row in connection.execute(
                    "SELECT relation_name FROM owner_waste_basket_provenance WHERE entry_id = ?",
                    (moved["items"][0]["entryId"],),
                ).fetchall()
            }
        self.assertIn("media_lifecycle", relations)
        self.assertIn("asset_source_versions", relations)
        with self.assertRaises(sqlite3.IntegrityError):
            with sidecar_state_db.connect(self.root, self.db) as connection:
                connection.execute(
                    "UPDATE owner_waste_basket_provenance SET row_json = '{}' WHERE entry_id = ?",
                    (moved["items"][0]["entryId"],),
                )

        gateway.restore_from_waste_basket(
            self.root,
            ["asset-1"],
            source="backstage-waste-basket",
            request_key="exact-restore-1",
            db_path=self.db,
        )
        self.assertEqual(self._lifecycle_snapshot(), before)
        self.assertFalse(gateway.is_globally_ineligible(self.root, "asset-1", self.db))
        self.assertFalse(gateway.is_globally_blocked(self.root, "asset-1", self.db))

    def test_batch_retry_and_concurrent_retry_are_idempotent(self) -> None:
        first = gateway.move_to_waste_basket(
            self.root,
            ["asset-2", "asset-3"],
            source="backstage-review",
            request_key="batch-x-1",
            db_path=self.db,
        )
        retry = gateway.move_to_waste_basket(
            self.root,
            ["asset-3", "asset-2"],
            source="backstage-review",
            request_key="batch-x-1",
            db_path=self.db,
        )
        self.assertEqual(retry["operationId"], first["operationId"])
        with sidecar_state_db.connect(self.root, self.db) as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT count(*) AS count FROM owner_waste_basket_entries WHERE state = 'recoverable'"
                ).fetchone()["count"],
                2,
            )

        def concurrent_x() -> dict[str, object]:
            return gateway.move_to_waste_basket(
                self.root,
                ["asset-4"],
                source="backstage-culling",
                request_key="concurrent-x-1",
                db_path=self.db,
            )

        with ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(lambda _index: concurrent_x(), range(4)))
        self.assertEqual({result["operationId"] for result in results}, {results[0]["operationId"]})
        with sidecar_state_db.connect(self.root, self.db) as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT count(*) AS count FROM owner_waste_basket_entries WHERE asset_id = 'asset-4'"
                ).fetchone()["count"],
                1,
            )

    def test_confirmed_empty_is_only_normal_tombstone_transition(self) -> None:
        gateway.move_to_waste_basket(
            self.root,
            ["asset-1"],
            source="backstage-culling",
            request_key="empty-x-1",
            db_path=self.db,
        )
        with self.assertRaises(gateway.WasteBasketError):
            gateway.empty_waste_basket(
                self.root,
                ["asset-1"],
                confirmed=False,
                confirmation_token=gateway.EMPTY_CONFIRMATION_TOKEN,
                request_key="empty-no-confirm-1",
                db_path=self.db,
            )
        with self.assertRaises(gateway.WasteBasketError):
            gateway.empty_waste_basket(
                self.root,
                ["asset-1"],
                confirmed=True,
                confirmation_token="wrong",
                request_key="empty-wrong-token-1",
                db_path=self.db,
            )
        emptied = gateway.empty_waste_basket(
            self.root,
            ["asset-1"],
            confirmed=True,
            confirmation_token=gateway.EMPTY_CONFIRMATION_TOKEN,
            reason="synthetic explicit empty",
            request_key="empty-confirmed-1",
            db_path=self.db,
        )
        self.assertEqual(emptied["state"], "tombstoned")
        self.assertFalse(emptied["r2Deleted"])
        self.assertTrue(gateway.is_globally_blocked(self.root, "asset-1", self.db))
        self.assertTrue(gateway.is_globally_ineligible(self.root, "asset-1", self.db))
        self.assertNotIn("asset-1", fixture_pipeline.fixture_candidate_asset_ids(self.root, "fixture-1"))
        self.assertNotIn(
            "asset-1",
            {item["assetId"] for item in fixture_pipeline.search_assets(self.root, {"assetIds": ["asset-1"]})["items"]},
        )
        with sidecar_state_db.connect(self.root, self.db) as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT lifecycle_state FROM media_lifecycle WHERE media_id = 'asset-1'"
                ).fetchone()["lifecycle_state"],
                "discarded",
            )
            self.assertEqual(
                connection.execute(
                    "SELECT count(*) AS count FROM r2_objects WHERE photo_id = 'asset-1'"
                ).fetchone()["count"],
                1,
            )
        with self.assertRaises(gateway.WasteBasketError):
            gateway.restore_from_waste_basket(self.root, ["asset-1"], request_key="normal-restore-after-empty", db_path=self.db)
        restored = gateway.restore_tombstone(
            self.root,
            ["asset-1"],
            explicit_tombstone_restore=True,
            request_key="explicit-tombstone-restore-1",
            db_path=self.db,
        )
        self.assertEqual(restored["operation"], "tombstone-restore")
        self.assertFalse(gateway.is_globally_blocked(self.root, "asset-1", self.db))

    def test_derivation_uses_unambiguous_durable_legacy_upload_identity(self) -> None:
        self._seed_asset("legacy-upload-id")
        with sidecar_state_db.connect(self.root, self.db) as connection:
            connection.execute(
                "UPDATE sidecar_assets SET raw_json = ? WHERE asset_id = 'asset-4'",
                (json.dumps({"localIdentifier": "legacy-upload-id"}),),
            )
            connection.execute("DELETE FROM r2_objects WHERE photo_id = 'asset-4'")
            connection.execute(
                """UPDATE media_lifecycle
                      SET public_preview_keys_json = '[]', private_keys_json = '[]'
                    WHERE media_id = 'asset-4'"""
            )
        self._seed_uploaded_r2_identity(
            upload_asset_id="legacy-upload-id",
            photo_id="canonical-media-4",
        )

        members = gateway.derive_deployed_lifecycle_members(self.root, ["asset-4"], self.db)

        self.assertEqual(members, [{
            "canonicalAssetId": "asset-4",
            "canonicalMediaId": "canonical-media-4",
            "bindings": [
                {"bucket": "private", "objectKey": "masters/canonical-media-4.jpg"},
                {"bucket": "public", "objectKey": "expo/canonical-media-4_900.jpg"},
            ],
        }])

    def test_derivation_rejects_ambiguous_durable_upload_identity(self) -> None:
        self._seed_asset("legacy-upload-id")
        with sidecar_state_db.connect(self.root, self.db) as connection:
            connection.execute(
                "UPDATE sidecar_assets SET raw_json = ? WHERE asset_id = 'asset-4'",
                (json.dumps({"localIdentifier": "legacy-upload-id"}),),
            )
            connection.execute("DELETE FROM r2_objects WHERE photo_id = 'asset-4'")
            connection.execute(
                """UPDATE media_lifecycle
                      SET public_preview_keys_json = '[]', private_keys_json = '[]'
                    WHERE media_id = 'asset-4'"""
            )
        for photo_id in ("canonical-media-4a", "canonical-media-4b"):
            self._seed_uploaded_r2_identity(
                upload_asset_id="legacy-upload-id",
                photo_id=photo_id,
            )

        with self.assertRaisesRegex(gateway.WasteBasketError, "ambiguous canonical R2 mapping"):
            gateway.derive_deployed_lifecycle_members(self.root, ["asset-4"], self.db)
        self.assertIn(
            "Repair the canonical R2 mapping",
            gateway._blocked_hosted_lifecycle_error(
                "ambiguous canonical R2 mapping for asset-4",
                gateway.MAX_HOSTED_LIFECYCLE_ATTEMPTS,
            ),
        )

    def test_lifecycle_scope_allows_only_assets_with_no_cloud_media_evidence(self) -> None:
        with sidecar_state_db.connect(self.root, self.db) as connection:
            connection.execute(
                """INSERT INTO sidecar_assets
                     (asset_id, source_anchor, media_type, filename, raw_json, indexed_at, updated_at)
                   VALUES ('local-only', 'apple-photos-cloud://local-only', 'photo',
                           'local-only.jpg', '{}', ?, ?)""",
                (NOW, NOW),
            )

        scope = gateway.classify_deployed_lifecycle_scope(
            self.root,
            ["local-only"],
            self.db,
        )

        self.assertEqual(scope, {
            "scope": "local-only",
            "assetIds": ["local-only"],
            "members": [],
            "reason": "no-cloud-media-evidence",
        })

        with sidecar_state_db.connect(self.root, self.db) as connection:
            connection.execute(
                """INSERT INTO public_catalog_publications
                     (asset_id, source_version_hash, media_id, state, created_at, updated_at)
                   VALUES ('local-only', 'source-v1', 'missing-media', 'failed', ?, ?)""",
                (NOW, NOW),
            )
        with self.assertRaisesRegex(gateway.WasteBasketError, "canonical R2 mapping is missing"):
            gateway.classify_deployed_lifecycle_scope(
                self.root,
                ["local-only"],
                self.db,
            )

    def test_explicit_empty_adopts_legacy_hidden_rows_and_uses_legacy_preview_keys(self) -> None:
        self._seed_asset("legacy-hidden")
        with sidecar_state_db.connect(self.root, self.db) as connection:
            connection.execute(
                """UPDATE media_lifecycle
                   SET lifecycle_state = 'hidden', hidden_at = ?, previous_state = 'active',
                       public_preview_keys_json = ?, private_keys_json = '[]'
                 WHERE media_id = ?""",
                (NOW, json.dumps(["expo/legacy-hidden_900.jpg"]), "legacy-hidden"),
            )
            connection.execute(
                "DELETE FROM r2_objects WHERE photo_id = ?",
                ("legacy-hidden",),
            )
            connection.commit()

        members = gateway.derive_deployed_lifecycle_members(self.root, ["legacy-hidden"], self.db)
        self.assertEqual(
            members[0]["bindings"],
            [{"bucket": "public", "objectKey": "expo/legacy-hidden_900.jpg"}],
        )
        emptied = gateway.empty_waste_basket(
            self.root,
            confirmed=True,
            confirmation_token=gateway.EMPTY_CONFIRMATION_TOKEN,
            request_key="legacy-empty-1",
            db_path=self.db,
        )
        self.assertEqual(emptied["assetIds"], ["legacy-hidden"])
        with sidecar_state_db.connect(self.root, self.db) as connection:
            entry = connection.execute(
                "SELECT state FROM owner_waste_basket_entries WHERE asset_id = ?",
                ("legacy-hidden",),
            ).fetchone()
            self.assertEqual(entry["state"], "tombstoned")
            self.assertEqual(
                connection.execute(
                    "SELECT lifecycle_state FROM media_lifecycle WHERE media_id = ?",
                    ("legacy-hidden",),
                ).fetchone()["lifecycle_state"],
                "discarded",
            )
            self.assertGreater(
                connection.execute(
                    "SELECT count(*) FROM owner_waste_basket_provenance WHERE entry_id = (SELECT entry_id FROM owner_waste_basket_entries WHERE asset_id = ?)",
                    ("legacy-hidden",),
                ).fetchone()[0],
                0,
            )

    def test_explicit_empty_materializes_sidecar_parents_for_orphaned_legacy_rows(self) -> None:
        asset_id = "legacy-orphaned-sidecar"
        with sidecar_state_db.connect(self.root, self.db) as connection:
            connection.execute(
                """
                INSERT INTO media_lifecycle
                  (media_id, lifecycle_state, previous_state, source_slug, title,
                   hidden_at, updated_at)
                VALUES (?, 'hidden', 'active', 'expo', 'Legacy orphan', ?, ?)
                """,
                (asset_id, NOW, NOW),
            )
            connection.commit()

        emptied = gateway.empty_waste_basket(
            self.root,
            [asset_id],
            confirmed=True,
            confirmation_token=gateway.EMPTY_CONFIRMATION_TOKEN,
            request_key="legacy-orphaned-empty-1",
            db_path=self.db,
        )
        self.assertEqual(emptied["state"], "tombstoned")
        with sidecar_state_db.connect(self.root, self.db) as connection:
            self.assertIsNotNone(
                connection.execute(
                    "SELECT 1 FROM sidecar_assets WHERE asset_id = ?", (asset_id,)
                ).fetchone()
            )
            self.assertIsNotNone(
                connection.execute(
                    "SELECT 1 FROM sidecar_decisions WHERE asset_id = ?", (asset_id,)
                ).fetchone()
            )
            self.assertEqual(
                connection.execute(
                    "SELECT tombstone_state FROM sidecar_tombstones WHERE asset_id = ?",
                    (asset_id,),
                ).fetchone()[0],
                "active",
            )

    def test_direct_bypasses_are_rejected_even_with_legacy_marker(self) -> None:
        with self.assertRaises(ValueError):
            owner_state_db.record_media_lifecycle_discarded(
                self.root,
                [{"id": "asset-1"}],
                db_path=self.db,
            )
        with self.assertRaises(ValueError):
            sidecar_state_db.record_decision(
                self.root,
                {"assetId": "asset-1", "action": "tombstone", "reason": "bypass"},
            )
        with self.assertRaises(gateway.WasteBasketError):
            sidecar_state_db.empty_wastebasket(self.root)
        with self.assertRaisesRegex(ValueError, "Sidecar lifecycle writes are disabled"):
            sidecar_state_db.record_decision(self.root, {
                "assetId": "asset-1",
                "action": "tombstone",
                "reason": "PBB-78 synthetic compatibility",
                "legacyMigration": AUDITED_LEGACY_MARKER,
            })

    def test_legacy_json_lifecycle_import_is_read_only_and_audited(self) -> None:
        legacy_path = self.root / "assets" / "discarded" / "discarded-photo-ids.json"
        legacy_path.parent.mkdir(parents=True, exist_ok=True)
        legacy_path.write_text(json.dumps({"photo_ids": ["legacy-asset"]}) + "\n", encoding="utf-8")

        snapshot = owner_state_db.media_lifecycle_snapshot(self.root, self.db)
        self.assertIn("legacy-asset", snapshot["discardedPhotoIds"])
        with sidecar_state_db.connect(self.root, self.db) as connection:
            self.assertIsNone(
                connection.execute(
                    "SELECT 1 FROM media_lifecycle WHERE media_id = 'legacy-asset'"
                ).fetchone()
            )

        dry_run = owner_state_db.sync_media_lifecycle_from_compat(self.root, db_path=self.db)
        self.assertTrue(dry_run["dryRun"])
        with self.assertRaises(ValueError):
            owner_state_db.sync_media_lifecycle_from_compat(
                self.root,
                db_path=self.db,
                apply=True,
            )
        applied = owner_state_db.sync_media_lifecycle_from_compat(
            self.root,
            db_path=self.db,
            apply=True,
            audit_receipt="synthetic-legacy-receipt",
            plan_digest="synthetic-legacy-plan",
        )
        self.assertTrue(applied["applied"])
        with sidecar_state_db.connect(self.root, self.db) as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT lifecycle_state FROM media_lifecycle WHERE media_id = 'legacy-asset'"
                ).fetchone()["lifecycle_state"],
                "discarded",
            )


if __name__ == "__main__":
    unittest.main()
