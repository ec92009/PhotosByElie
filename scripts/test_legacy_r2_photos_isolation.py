"""Offline legacy-R2 isolation tests against actual Photos dispatch boundaries.

Only synthetic Owner databases below TemporaryDirectory are opened. Network,
subprocess and Photos export adapters are denied, including on failed tests.
Run: python3 -B -m unittest scripts.test_legacy_r2_photos_isolation -v
"""

from __future__ import annotations

from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.parse import unquote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

import apple_photos_metadata_writer as writer
import fixture_pipeline as fixture
import native_fixture_delivery as native_delivery
import sidecar_state_db as sidecar


LEGACY = "synthetic-legacy-photo"
FIXTURE = "synthetic-expo"
SHA = "a" * 64
AT = "2026-09-28T12:00:00Z"
ANCHOR = f"legacy-r2://photosbyelie-private/masters/{LEGACY}.jpg#sha256={SHA}"


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


class LegacyR2PhotosIsolationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="pbe-legacy-isolation-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        real_connect = sqlite3.connect

        def isolated_connect(database, *args, **kwargs):
            raw = str(database)
            if raw != ":memory:":
                path = Path(unquote(urlparse(raw).path) if raw.startswith("file:") else raw).resolve()
                if not path.is_relative_to(self.root):
                    raise AssertionError("SQLite access outside synthetic test root")
            return real_connect(database, *args, **kwargs)

        self.start_patch("sqlite3.connect", side_effect=isolated_connect)
        self.denied = [self.start_patch(target, side_effect=AssertionError("external access forbidden"))
                       for target in ("socket.create_connection", "socket.socket.connect",
                                      "socket.socket.connect_ex", "subprocess.Popen",
                                      "sidecar_state_db.request_export_original")]
        # Registered after patch cleanups: assert attempts before mocks restore.
        self.addCleanup(self.assert_no_external_calls)
        with closing(fixture.connect(self.root)) as conn:
            conn.commit()
        fixture.create_fixture(self.root, "Expo", tags=["public"], fixture_id=FIXTURE)
        sidecar.upsert_assets(self.root, [{
            "assetId": asset, "localIdentifier": asset,
            "sourceAnchor": f"apple-photos://{asset}", "filename": asset + ".jpg",
            "mediaType": "photo", "resourceFormat": "JPEG", "pixelWidth": 1200,
            "pixelHeight": 800, "creationDate": AT,
        } for asset in ("photos-present", "photos-absent", "spoofed-prefix")])
        with closing(fixture.connect(self.root)) as conn:
            conn.execute("UPDATE sidecar_assets SET source_anchor=? WHERE asset_id='spoofed-prefix'",
                         ("legacy-r2://unproved/filename.jpg",))
            conn.commit()

    def start_patch(self, target, **kwargs):
        patcher = patch(target, **kwargs)
        result = patcher.start()
        self.addCleanup(patcher.stop)
        return result

    def assert_no_external_calls(self):
        for denied in self.denied:
            denied.assert_not_called()

    def seed_recovered(self):
        """Use the real datastore operation, with an explicitly synthetic plan.

        Not an approval/recovery integration test: no live planning or evidence
        reader runs. This gives the source predicate its actual stored batch.
        """
        from legacy_r2_recovery_store import register_exact_legacy
        request = {"mediaId": LEGACY, "fixtureId": FIXTURE,
                   "originalSha256": SHA, "originalBytes": 12345,
                   "selectionSha256": "b" * 64,
                   "selectionApproval": "synthetic-weekly-approval",
                   "recoveryApproval": "synthetic-exact-recovery-approval"}
        objects = [{"bucket": "photosbyelie-private", "key": f"masters/{LEGACY}.jpg",
                    "sha256": SHA, "bytes": 12345, "width": 1200, "height": 800},
                   {"bucket": "photosbyelie-public", "key": f"expo/{LEGACY}_900.jpg",
                    "sha256": "c" * 64, "bytes": 900, "width": 900, "height": 600},
                   {"bucket": "photosbyelie-public", "key": f"expo/{LEGACY}_1800.jpg",
                    "sha256": "d" * 64, "bytes": 1800, "width": 1200, "height": 800}]
        for obj in objects:
            obj.update(contentType="image/jpeg", method="authenticated-full-get-sha256")
        body = {"schema": "photosbyelie.legacy-r2-recovery.v1", "request": request,
                "owner": {"catalogSha256": "e" * 64,
                          "metadata": {"title": "Synthetic recovered photo", "caption": "",
                                       "keywords": ["Spain"], "capturedAt": AT,
                                       "rowSha256": "f" * 64}}, "objects": objects}
        self.plan = {**body, "planSha256": hashlib.sha256(canonical(body).encode()).hexdigest(),
                     "checkedAt": AT, "observedAt": [AT] * len(objects), "state": "reviewable_no_writes"}
        with closing(fixture.connect(self.root)) as conn:
            conn.execute("BEGIN IMMEDIATE")
            register_exact_legacy(conn, self.plan)
            conn.commit()

    def row(self, asset=LEGACY):
        with closing(fixture.connect_read_only(self.root)) as conn:
            return conn.execute("SELECT * FROM sidecar_assets WHERE asset_id=?", (asset,)).fetchone()

    def refusal_or_result(self, function, *args, **kwargs):
        """Both explicit ValueError rejection and filtered results are valid."""
        try:
            return function(*args, **kwargs)
        except ValueError:
            return None

    def test_capability_marker_blocks_even_without_scan_provenance(self):
        from legacy_r2_source import is_legacy_source, reject_legacy_photos, verified_legacy_source
        self.assertTrue(is_legacy_source(ANCHOR))
        self.assertTrue(is_legacy_source(ANCHOR.upper()))
        self.assertTrue(is_legacy_source("apple-photos://ambiguous", {"sourceKind": "legacy_r2"}))
        self.assertFalse(is_legacy_source("apple-photos://photos-present", {}))
        with closing(fixture.connect_read_only(self.root)) as conn:
            self.assertFalse(verified_legacy_source(conn, "spoofed-prefix"))
            with self.assertRaises(ValueError):
                reject_legacy_photos(conn, "spoofed-prefix")
            reject_legacy_photos(conn, "photos-present")

    def test_scan_immunity_requires_exact_recorded_recovery_batch(self):
        from legacy_r2_source import verified_legacy_source
        self.seed_recovered()
        with closing(fixture.connect_read_only(self.root)) as conn:
            self.assertTrue(verified_legacy_source(conn, LEGACY))
        sidecar.mark_missing_assets(self.root, ["photos-present"])
        self.assertIsNone(self.row()["missing_at"])
        self.assertIsNone(self.row("photos-present")["missing_at"])
        self.assertTrue(self.row("photos-absent")["missing_at"])
        self.assertTrue(self.row("spoofed-prefix")["missing_at"])

    def test_changed_immutable_batch_loses_scan_immunity(self):
        from legacy_r2_source import verified_legacy_source
        self.seed_recovered()
        with closing(fixture.connect(self.root)) as conn:
            body = json.loads(canonical(self.plan))
            body["request"]["originalSha256"] = "0" * 64
            conn.execute("UPDATE fixture_source_batches SET provenance_json=? WHERE batch_id=?",
                         (canonical(body), "legacy-r2-" + self.plan["planSha256"]))
            conn.commit()
        with closing(fixture.connect_read_only(self.root)) as conn:
            self.assertFalse(verified_legacy_source(conn, LEGACY))
        sidecar.mark_missing_assets(self.root, ["photos-present"])
        self.assertTrue(self.row()["missing_at"])

    def test_missing_batch_loses_scan_immunity(self):
        self.seed_recovered()
        with closing(fixture.connect(self.root)) as conn:
            conn.execute("DELETE FROM fixture_source_batches WHERE batch_id=?",
                         ("legacy-r2-" + self.plan["planSha256"],))
            conn.commit()
        sidecar.mark_missing_assets(self.root, ["photos-present"])
        self.assertTrue(self.row()["missing_at"])

    def test_conflicting_photos_identity_cannot_retain_scan_immunity(self):
        from legacy_r2_source import verified_legacy_source
        self.seed_recovered()
        original = json.loads(self.row()["raw_json"])
        for key in ("localIdentifier", "cloudIdentifier", "photosAssetId", "photoLibraryIdentifier"):
            with self.subTest(key=key):
                with closing(fixture.connect(self.root)) as conn:
                    conn.execute("UPDATE sidecar_assets SET raw_json=? WHERE asset_id=?",
                                 (canonical({**original, key: "conflicting-photos-id"}), LEGACY))
                    conn.commit()
                with closing(fixture.connect_read_only(self.root)) as conn:
                    self.assertFalse(verified_legacy_source(conn, LEGACY))

    def test_malformed_raw_provenance_fails_closed_without_aborting_scan(self):
        from legacy_r2_source import verified_legacy_source
        self.seed_recovered()
        for malformed in ("[]", "null", "1", "not-json"):
            with self.subTest(raw=malformed):
                with closing(fixture.connect(self.root)) as conn:
                    conn.execute("UPDATE sidecar_assets SET raw_json=? WHERE asset_id=?", (malformed, LEGACY))
                    conn.commit()
                with closing(fixture.connect_read_only(self.root)) as conn:
                    self.assertFalse(verified_legacy_source(conn, LEGACY))

    def test_index_presentation_strips_conflicting_photos_identifiers(self):
        self.seed_recovered()
        with closing(fixture.connect(self.root)) as conn:
            raw = json.loads(self.row()["raw_json"])
            raw.update(localIdentifier="wrong-local", cloudIdentifier="wrong-cloud", photosAssetId="wrong-photos",
                       photoLibraryIdentifier="wrong-library")
            conn.execute("UPDATE sidecar_assets SET raw_json=? WHERE asset_id=?", (canonical(raw), LEGACY))
            conn.commit()
        presented = sidecar._indexed_asset_row(self.row())
        for key in ("localIdentifier", "cloudIdentifier", "photosAssetId", "photoLibraryIdentifier"):
            self.assertFalse(presented.get(key), key)
        self.assertEqual(presented["sourceAnchor"], ANCHOR)
        self.assertEqual(presented["assetId"], LEGACY)

    def test_review_identifier_cannot_fall_back_to_legacy_asset_id(self):
        self.seed_recovered()
        identifier = self.refusal_or_result(fixture._photo_library_identifier, self.row())
        self.assertFalse(identifier)

    def test_explicit_ai_preview_never_emits_photokit_target(self):
        self.seed_recovered()
        with closing(fixture.connect(self.root)) as conn:
            conn.execute("UPDATE asset_editorial_state SET editorial_state='requesting-ai' WHERE asset_id=?", (LEGACY,))
            conn.commit()
        targets = self.refusal_or_result(fixture.ai_preview_targets, self.root, [LEGACY])
        self.assertFalse(targets)

    def test_planned_r2_keys_rejects_legacy_without_deriving_new_identity(self):
        self.seed_recovered()
        with patch.object(sidecar, "photo_id_for_source_path", side_effect=AssertionError("identity derivation forbidden")) as derive:
            with self.assertRaises(ValueError):
                sidecar._planned_r2_keys(self.row())
            derive.assert_not_called()

    def test_explicit_upload_queue_does_not_enqueue_legacy(self):
        self.seed_recovered()
        self.refusal_or_result(sidecar.queue_upload_bridge, self.root, asset_ids=[LEGACY], limit=1)
        with closing(fixture.connect_read_only(self.root)) as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM sidecar_mock_uploads WHERE asset_id=?", (LEGACY,)).fetchone()[0], 0)

    def test_direct_materializer_rejects_before_photos_adapter(self):
        self.seed_recovered()
        with self.assertRaises(ValueError):
            sidecar._run_backstage_photos_materialize_one(self.root, asset_id=LEGACY,
                destination=self.root / "never-export", allow_icloud_downloads=False)

    def test_direct_batch_item_rejects_before_ledger_or_export(self):
        self.seed_recovered()
        with patch.object(sidecar, "connect", side_effect=AssertionError("ledger access before rejection")) as connect:
            with self.assertRaises(ValueError):
                sidecar.execute_upload_bridge_batch_item(self.root, run_id="synthetic-run",
                    run_root=self.root / "spool", export_root=self.root / "spool/export",
                    item={"assetId": LEGACY, "runItemId": "synthetic-item"})
            connect.assert_not_called()
        self.assertFalse((self.root / "spool").exists())

    def test_ordinary_photos_identity_and_planned_keys_remain_available(self):
        row = self.row("photos-present")
        self.assertEqual(fixture._photo_library_identifier(row), "photos-present")
        photo_id, keys = sidecar._planned_r2_keys(row)
        self.assertTrue(photo_id)
        self.assertEqual(len(keys), 3)

    def test_explicit_native_delivery_stops_before_queue_or_destination_change(self):
        self.seed_recovered()
        with patch.object(native_delivery, "configure_asset_destinations") as configure, \
             patch.object(native_delivery, "queue_upload_bridge") as queue, \
             patch.object(native_delivery, "prepare_upload_bridge_execute_batch") as prepare:
            result = self.refusal_or_result(native_delivery.deliver_fixture_assets, self.root,
                                           fixture_id=FIXTURE, asset_ids=[LEGACY])
            self.assertFalse(result and result.get("ok"))
            configure.assert_not_called()
            queue.assert_not_called()
            prepare.assert_not_called()

    def test_explicit_writeback_never_reads_or_writes_photos(self):
        self.seed_recovered()
        adapter = Mock()
        for name in ("read", "write", "apply", "apply_many"):
            getattr(adapter, name).side_effect = AssertionError("Photos adapter forbidden")
        result = self.refusal_or_result(writer.commit_writeback, self.root, FIXTURE, [LEGACY], adapter=adapter)
        self.assertEqual(adapter.method_calls, [])
        self.assertFalse(result and result.get("written"))
        with closing(fixture.connect_read_only(self.root)) as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM fixture_delivery_receipts WHERE asset_id=? AND destination='apple_photos'", (LEGACY,)).fetchone()[0], 0)

    def test_incremental_sync_excludes_legacy_before_photos_read(self):
        import local_server
        self.seed_recovered()
        adapter = Mock()
        def read_many(requests):
            self.assertNotIn(LEGACY, [row["assetId"] for row in requests],
                             "legacy source reached Photos metadata read")
            return [{"assetId": row["assetId"], "error": "synthetic retry"} for row in requests]
        adapter.read_many.side_effect = read_many
        preview = Mock(return_value={"ok": False, "error": "synthetic preview unavailable"})
        self.refusal_or_result(local_server._incremental_photos_sync, self.root,
                               limit=50, adapter=adapter, preview_runner=preview)
        self.assertNotIn(LEGACY, [call.args[0] for call in preview.call_args_list])

    def test_direct_source_preview_rejects_legacy_before_ipc(self):
        import local_server
        self.seed_recovered()
        with patch.object(local_server, "request_preview", return_value={"ok": False, "error": "synthetic no preview"}) as preview:
            self.refusal_or_result(local_server._apple_photos_source_preview, self.root,
                {"title": "Synthetic legacy", "sourceAnchor": ANCHOR, "sourceKind": "legacy_r2"},
                LEGACY, "photo")
            preview.assert_not_called()


if __name__ == "__main__":
    unittest.main()
