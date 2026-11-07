"""Private fixtures for resumable PBB discovery, not the operator's library."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import backstage_photos_job as jobs
import pbb_photos_sync as sync
import sidecar_server as server
from sidecar_state_db import connect, upsert_assets


def source(identity, local=None, capture="2001-01-01T00:00:00Z"):
    return dict(assetId=identity, localIdentifier=local or identity, sourceAnchor="apple-photos://" + identity,
                filename=identity + ".jpg", mediaType="photo", creationDate=capture)


class PersistentPhotosSyncTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.path = self.root / "snapshot.jsonl"
        upsert_assets(self.root, [source("known"), source("unowned")])

    def finish(self, token, sources=(), previous=None, baseline=True, removed=(), **changes):
        self.path.write_text("".join(json.dumps(row) + "\n" for row in sources))
        report = dict(syncComplete=True, nextChangeToken=token, syncBaseline=baseline,
                      removedLocalIdentifiers=list(removed), count=len(sources), **changes)
        return sync.complete(self.root, "pbb-max", previous, self.path, report)

    def test_baseline_recovers_old_import_and_keeps_each_consumer_independent(self):
        old = source("new-old-photo")
        plan = jobs.plan(self.root, dict(actionKind="sidecar-photos-index-sync", target="pbb-max"))
        self.assertEqual(plan["dateFrom"], "")
        self.assertIsNone(plan["syncCheckpoint"])
        with patch.object(jobs, "credential", return_value=plan), patch.object(server, "_run_backstage_photos_library_index", return_value={
            "ok": True, "syncSession": plan["syncSession"], "items": [old], "offset": 0,
            "nextOffset": 1, "hasMore": False, "totalCount": 1, "scannedCount": 1,
            "nextChangeToken": "token-one", "syncBaseline": True,
        }):
            report = server._write_backstage_library_index(self.root, self.path)
        self.assertEqual(report["recoveredCount"], 1)
        server._import_index_jsonl(self.root, self.path, 1, False)
        sync.complete(self.root, "pbb-max", None, self.path, report)
        self.assertEqual(sync.checkpoint(self.root, "pbb-max")["token"], "token-one")
        self.assertEqual(sync.checkpoint(self.root, "another-app"), {})
        self.assertEqual(jobs.plan(self.root, dict(actionKind="sidecar-photos-index-sync", target="pbb-max"))["syncCheckpoint"], "token-one")
        full = jobs.plan(self.root, dict(actionKind="sidecar-photos-index-sync", target="pbb-max", payload={"fullLibrary": True}))
        self.assertIsNone(full["syncCheckpoint"])
        self.assertEqual(full["syncPreviousCheckpoint"], "token-one")
        with connect(self.root) as conn:
            self.assertIsNone(conn.execute("SELECT missing_at FROM sidecar_assets WHERE asset_id='unowned'").fetchone()[0])

    def test_failed_completion_and_concurrent_cursor_preserve_retry_point(self):
        self.finish("one", [source("known")])
        with connect(self.root) as conn:
            conn.execute("CREATE TRIGGER fail_cursor BEFORE UPDATE ON owner_settings BEGIN SELECT RAISE(ABORT,'simulated failure'); END")
        with self.assertRaises(Exception):
            self.finish("two", previous="one", baseline=False, removed=["known"])
        self.assertEqual(sync.checkpoint(self.root, "pbb-max")["token"], "one")
        with connect(self.root) as conn:
            self.assertIsNone(conn.execute("SELECT missing_at FROM sidecar_assets WHERE asset_id='known'").fetchone()[0])
            conn.execute("DROP TRIGGER fail_cursor")
        self.finish("two", previous="one", baseline=False, removed=["known"])
        with self.assertRaisesRegex(ValueError, "changed during sync"):
            self.finish("stale", previous="one")
        self.assertEqual(sync.checkpoint(self.root, "pbb-max")["token"], "two")

    def test_rebaseline_removes_only_owned_sources_and_preserves_decisions(self):
        self.finish("one", [source("known")])
        with connect(self.root) as conn:
            conn.execute("UPDATE sidecar_decisions SET pick_state='picked',title='Reviewed' WHERE asset_id='known'")
            conn.execute("INSERT INTO owner_settings VALUES ('other-app-cursor','private','now')")
        self.finish("baseline-after-expiry", previous="one")
        with connect(self.root) as conn:
            self.assertTrue(conn.execute("SELECT missing_at FROM sidecar_assets WHERE asset_id='known'").fetchone()[0])
            self.assertIsNone(conn.execute("SELECT missing_at FROM sidecar_assets WHERE asset_id='unowned'").fetchone()[0])
            self.assertEqual(tuple(conn.execute("SELECT pick_state,title FROM sidecar_decisions WHERE asset_id='known'").fetchone()), ("picked", "Reviewed"))
            self.assertEqual(conn.execute("SELECT setting_value FROM owner_settings WHERE setting_key='other-app-cursor'").fetchone()[0], "private")
        upsert_assets(self.root, [source("known")])
        self.finish("restored", [source("known")], previous="baseline-after-expiry", baseline=False)
        with connect(self.root) as conn:
            self.assertIsNone(conn.execute("SELECT missing_at FROM sidecar_assets WHERE asset_id='known'").fetchone()[0])

    def test_empty_filtered_page_continues_and_local_identity_never_duplicates(self):
        plan = dict(syncSession="session")
        pages = [dict(ok=True, items=[], offset=0, nextOffset=200, hasMore=True, totalCount=201,
                      scannedCount=200, syncSession="session", syncBaseline=True, nextChangeToken="next"),
                 dict(ok=True, items=[source("known", "known")], offset=200, nextOffset=201,
                      hasMore=False, totalCount=201, scannedCount=201, syncSession="session", syncBaseline=True, nextChangeToken="next")]
        with patch.object(jobs, "credential", return_value=plan), patch.object(server, "_run_backstage_photos_library_index", side_effect=pages) as reader:
            report = server._write_backstage_library_index(self.root, self.path)
        self.assertEqual(reader.call_count, 2)
        self.assertTrue(report["syncComplete"])
        self.assertEqual(report["recoveredCount"], 0)
        self.assertEqual(json.loads(self.path.read_text())["assetId"], "known")

    def test_corrupt_checkpoint_rebuilds_and_incomplete_scan_cannot_commit(self):
        with connect(self.root) as conn:
            conn.execute("INSERT INTO owner_settings VALUES (?,?,?)", (sync.PREFIX + "pbb-max", '{"schemaVersion":1,"token":42}', "now"))
        self.assertEqual(sync.checkpoint(self.root, "pbb-max"), {})
        with self.assertRaisesRegex(ValueError, "Incomplete"):
            sync.complete(self.root, "pbb-max", None, self.path, dict(syncComplete=False, nextChangeToken="partial"))
        self.finish("new-baseline", [source("known")])
        self.assertEqual(sync.checkpoint(self.root, "pbb-max")["token"], "new-baseline")

    def test_mixed_snapshot_pages_are_rejected_without_saving_a_cursor(self):
        scan = sync.ScanReceipt(self.root, "one-session")
        page = dict(syncSession="one-session", nextChangeToken="one-token", syncBaseline=True,
                    scannedCount=1, totalCount=2, nextOffset=1, hasMore=True)
        scan.accept(page, [], 0, 1)
        with self.assertRaisesRegex(ValueError, "changed between pages"):
            scan.accept(dict(page, nextChangeToken="other-token", nextOffset=2, hasMore=False), [], 1, 1)
        self.assertEqual(sync.checkpoint(self.root, "pbb-max"), {})


if __name__ == "__main__":
    unittest.main()
