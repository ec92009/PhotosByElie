"""Offline exact-byte metadata repair against the real disposable Owner schema."""
from contextlib import closing
import copy
import json
from pathlib import Path
import sqlite3
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import legacy_r2_catalog_test as fixtures
from legacy_r2_evidence import RecoveryError
import verified_preview_metadata as plans
import verified_preview_metadata_repair as repair
import legacy_r2_recovery as legacy
from legacy_r2_evidence import stamp


class PreviewMetadataTest(unittest.TestCase):
    def setUp(self):
        self.base = fixtures.LegacyCatalogTest()
        self.base.setUp()
        self.addCleanup(self.base.doCleanups)
        self.f = self.base.fixture
        self.request = {"mediaIds": [self.f.media], "authorization": "test-owner-exact-metadata-repair"}
        self.f.mutate("UPDATE public_catalog_publications SET state='live',public_url=?,catalog_sha256=?",
                      ('https://photos-by-elie.com/assets/catalog/photosbyelie.sqlite', self.base.plan['owner']['catalogSha256']))
        # Deliberately stale bookkeeping in a disposable DB, never production.
        self.f.mutate("UPDATE r2_objects SET bytes=200 WHERE bucket='photosbyelie-public'")
        with closing(sqlite3.connect(self.f.owner)) as conn, conn:
            for rid, raw in conn.execute("SELECT receipt_id,verification_json FROM fixture_delivery_receipts WHERE object_key LIKE 'expo/%'").fetchall():
                proof = json.loads(raw)
                proof['bytes'] = 200
                conn.execute("UPDATE fixture_delivery_receipts SET verification_json=? WHERE receipt_id=?", (json.dumps(proof), rid))

    def plan(self, reader=None):
        return plans.build_plan(self.f.root, self.request, object_reader=reader or self.f.reader,
                                catalog_reader=lambda: self.f.payload)

    def apply(self, plan=None, reader=None, client=None):
        plan = plan or self.plan()
        return repair.apply_plan(self.f.root, plan, approved_plan_sha256=plan['planSha256'],
            object_reader=reader or self.f.reader, catalog_reader=lambda: self.f.payload,
            authority_client=client or self.base.client)

    def test_prepare_is_read_only_and_stable(self):
        before = self.f.snapshot()
        self.assertEqual(self.plan()['planSha256'], self.plan()['planSha256'])
        self.assertEqual(before, self.f.snapshot())
        self.assertEqual(self.base.remote.calls, [])

    def test_apply_corrects_exact_metadata_and_keeps_approval_originals_and_ids(self):
        protected = ['asset_editorial_state', 'asset_source_versions', 'asset_publications', 'sidecar_assets',
                     'fixture_asset_decisions', 'asset_delivery_state']
        before = {t: self.f.rows('SELECT * FROM '+t) for t in protected}
        master = self.f.rows("SELECT * FROM fixture_delivery_receipts WHERE object_key LIKE 'masters/%'")
        master_inventory = self.f.rows("SELECT * FROM r2_objects WHERE bucket='photosbyelie-private'")
        plan = self.plan()
        result = self.apply(plan)
        self.assertEqual(result['state'], 'catalog_projection_prepared_not_deployed')
        self.assertFalse(result['uploaded'])
        self.assertFalse(result['wholeSubjectReady'])
        self.assertEqual(result['addedListings'], 0)
        self.assertEqual(result['previewCount'], 2)
        self.assertEqual({t: self.f.rows('SELECT * FROM '+t) for t in protected}, before)
        self.assertEqual(master, self.f.rows("SELECT * FROM fixture_delivery_receipts WHERE object_key LIKE 'masters/%'"))
        self.assertEqual(master_inventory, self.f.rows("SELECT * FROM r2_objects WHERE bucket='photosbyelie-private'"))
        self.assertEqual(self.f.rows("SELECT bytes FROM r2_objects WHERE bucket='photosbyelie-public'"), [(100,), (100,)])
        self.assertEqual(self.f.rows('SELECT state FROM public_catalog_publications'), [('local',)])
        self.assertEqual(self.base.remote.row['state'], 'pending')
        audit = json.loads(self.f.rows('SELECT plan_json FROM verified_preview_metadata_repairs')[0][0])
        self.assertEqual(audit, plan)
        for (raw,) in self.f.rows("SELECT verification_json FROM fixture_delivery_receipts WHERE object_key LIKE 'expo/%'"):
            proof = json.loads(raw)
            self.assertEqual(proof['bytes'], 100)
            self.assertEqual(proof['metadataRepair']['previousBytes'], 200)
            self.assertEqual(proof['metadataRepair']['planSha256'], plan['planSha256'])

    def test_catalog_changes_only_exact_preview_byte_cells(self):
        plan = self.plan()
        payload = repair.candidate_catalog(self.f.payload, plan)
        with closing(sqlite3.connect(':memory:')) as old, closing(sqlite3.connect(':memory:')) as new:
            old.deserialize(self.f.payload)
            new.deserialize(payload)
            allowed = {r[0] for r in old.execute("SELECT asset_type_id FROM asset_types WHERE code IN ('still_900','still_1800')")}
            for (name,) in old.execute("SELECT name FROM sqlite_master WHERE type='table'"):
                table = '"'+name.replace('"','""')+'"'
                left, right = old.execute('SELECT * FROM '+table).fetchall(), new.execute('SELECT * FROM '+table).fetchall()
                if name == 'media_assets':
                    columns = [r[1] for r in old.execute('PRAGMA table_info(media_assets)')]
                    left = [tuple(None if col=='bytes' else v for col,v in zip(columns,row)) if row[0]==self.f.media and row[1] in allowed else row for row in left]
                    right = [tuple(None if col=='bytes' else v for col,v in zip(columns,row)) if row[0]==self.f.media and row[1] in allowed else row for row in right]
                self.assertEqual(left, right, name)

    def test_replay_never_restores_later_denial(self):
        plan = self.plan()
        self.apply(plan)
        self.f.mutate("UPDATE asset_editorial_state SET editorial_state='unreviewed'")
        before = self.f.snapshot()
        calls = len(self.base.remote.calls)
        self.assertTrue(self.apply(plan)['replayed'])
        self.assertEqual(before, self.f.snapshot())
        self.assertEqual(calls, len(self.base.remote.calls))

    def test_changed_hash_and_dimensions_refused(self):
        for changed in ({'sha256':'f'*64}, {'width':1}):
            with self.subTest(changed=changed):
                before = self.f.snapshot()
                with self.assertRaisesRegex(RecoveryError, 'preview_content_changed'):
                    self.plan(lambda b,k: {**self.f.reader(b,k), **changed})
                self.assertEqual(before, self.f.snapshot())

    def test_changed_approval_source_policy_and_receipt_block_apply(self):
        cases = [
            ("UPDATE asset_editorial_state SET editorial_state='unreviewed'", ()),
            ("UPDATE asset_source_versions SET source_exists=0", ()),
            ("UPDATE fixtures SET archived_at='now'", ()),
            ("UPDATE fixture_delivery_receipts SET checksum_sha256=? WHERE object_key LIKE 'expo/%'", ('f'*64,)),
        ]
        for sql, args in cases:
            with self.subTest(sql=sql), closing(sqlite3.connect(self.f.owner)) as conn:
                plan = self.plan()
                # Save and restore only this disposable fixture for each case.
                backup = sqlite3.connect(':memory:')
                conn.backup(backup)
                try:
                    self.f.mutate(sql,args)
                    before = self.f.snapshot()
                    with self.assertRaises(RecoveryError):
                        self.apply(plan)
                    self.assertEqual(before, self.f.snapshot())
                    self.assertEqual(self.base.remote.calls, [])
                finally:
                    backup.backup(conn)
                    backup.close()

    def test_policy_race_after_remote_get_is_rechecked_under_lock(self):
        plan = self.plan()
        count = 0
        def raced(bucket,key):
            nonlocal count
            obj = self.f.reader(bucket,key)
            count += 1
            if count == 2:
                self.f.mutate("UPDATE fixtures SET policy_overrides_json=?", ('{"visibility":"private"}',))
            return obj
        with self.assertRaises(RecoveryError):
            self.apply(plan, reader=raced)
        self.assertEqual(self.f.rows("SELECT bytes FROM r2_objects WHERE bucket='photosbyelie-public'"), [(200,), (200,)])
        self.assertEqual(self.base.remote.calls, [])

    def test_guarded_projection_failure_rolls_back_receipt_and_inventory(self):
        plan = self.plan()
        before = self.f.snapshot()
        with patch('owner_catalog_projection.store_projection', side_effect=RuntimeError('synthetic authority failure')):
            with self.assertRaisesRegex(RuntimeError,'synthetic authority'):
                self.apply(plan)
        self.assertEqual(before, self.f.snapshot())

    def test_tampered_plan_refused(self):
        plan = self.plan()
        plan['objects'][0]['bytes'] += 1
        before = self.f.snapshot()
        with self.assertRaisesRegex(RecoveryError, 'reviewed_plan_required'):
            self.apply(plan)
        self.assertEqual(before,self.f.snapshot())

    def test_stale_remote_evidence_refused(self):
        plan = self.plan()
        before = self.f.snapshot()
        with self.assertRaisesRegex(RecoveryError, 'object_evidence_expired'):
            self.apply(plan, reader=lambda b,k: {**self.f.reader(b,k),'checkedAt':'2020-01-01T00:00:00Z'})
        self.assertEqual(before, self.f.snapshot())

    def test_catalog_mismatch_and_bad_scope_refused(self):
        with self.assertRaisesRegex(RecoveryError, 'catalog_not_deployed'):
            plans.build_plan(self.f.root,self.request,object_reader=self.f.reader,catalog_reader=lambda:b'changed')
        for ids in ([], [self.f.media,self.f.media], ['../private'], ['new-media']*21):
            with self.subTest(ids=ids), self.assertRaisesRegex(RecoveryError,'repair_media_scope_invalid'):
                plans.validate_request({'mediaIds':ids,'authorization':'owner'})

    def test_source_cannot_write_canonical_owner(self):
        plan = self.plan()
        with patch('legacy_r2_runtime.CANONICAL_ROOT',self.f.root):
            with self.assertRaisesRegex(RecoveryError,'installed_backstage_recovery_runtime_required'):
                self.apply(plan)
        self.assertEqual(self.base.remote.calls, [])

    def test_already_consistent_is_read_only(self):
        self.apply()
        self.f.payload = self.f.rows('SELECT catalog_blob FROM owner_public_catalog_projections')[0][0]
        self.f.mutate("UPDATE public_catalog_publications SET state='live'")
        plan = self.plan()
        before = self.f.snapshot()
        self.assertEqual(self.apply(plan)['state'], 'already_consistent')
        self.assertEqual(before, self.f.snapshot())

    def test_multi_photo_plan_is_atomic_and_preserves_both_originals(self):
        media = '001-e590e72f7c'
        metadata = legacy.catalog_metadata(self.f.payload, media)
        objects = [{**row, 'bytes':100 if i else row['bytes'], 'sha256':str(i+4)*64,
                    'contentType':'image/jpeg','method':'authenticated-full-get-sha256'}
                   for i,row in enumerate(metadata['objects'])]
        def reader(bucket,key):
            candidates = objects + self.f.objects
            return {**next(o for o in candidates if o['bucket']==bucket and o['key']==key),'checkedAt':stamp()}
        request = {**self.f.request,'mediaId':media,'originalSha256':'4'*64,'originalBytes':objects[0]['bytes']}
        plan = legacy.build_plan(self.f.root,request,object_reader=reader,catalog_reader=lambda:self.f.payload)
        legacy.apply_plan(self.f.root,plan,approved_plan_sha256=plan['planSha256'],
            backup_path=self.f.owner.with_name('synthetic-second-backup.sqlite'),object_reader=reader,catalog_reader=lambda:self.f.payload)
        self.f.mutate("UPDATE public_catalog_publications SET state='live',public_url=?,catalog_sha256=?",
            ('https://photos-by-elie.com/assets/catalog/photosbyelie.sqlite',self.base.plan['owner']['catalogSha256']))
        self.request['mediaIds'] = sorted([media,self.f.media])
        plan = self.plan(reader)
        before = self.f.snapshot()
        with self.assertRaisesRegex(RecoveryError,'preview_content_changed'):
            self.apply(plan, reader=lambda b,k:{**reader(b,k), **({'sha256':'f'*64} if k.endswith(self.f.media+'_1800.jpg') else {})})
        self.assertEqual(before,self.f.snapshot())
        originals = self.f.rows("SELECT * FROM fixture_delivery_receipts WHERE object_key LIKE 'masters/%'")
        result = self.apply(plan,reader=reader)
        self.assertEqual(result['previewCount'],4)
        self.assertEqual(originals,self.f.rows("SELECT * FROM fixture_delivery_receipts WHERE object_key LIKE 'masters/%'"))
        self.assertEqual(self.f.rows("SELECT bytes FROM r2_objects WHERE bucket='photosbyelie-public'"),[(100,)]*4)


if __name__ == '__main__':
    unittest.main()
