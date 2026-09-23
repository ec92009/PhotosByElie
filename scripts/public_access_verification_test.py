"""Real Owner schema with mock read-only providers; no real Owner or network."""
import hashlib
import json
from datetime import datetime, timedelta, timezone
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

import native_publication_pipeline_test as pipeline_tests
from fixture_pipeline import connect
from native_publication_pipeline import publish_verified_asset, upload_eligibility_plan
import public_access_verification as access


class PublicAccessVerificationTests(unittest.TestCase):
    def setUp(self):
        self.base = pipeline_tests.NativePublicationPipelineTest()
        self.base.setUp()
        self.root = self.base.root
        self.fixture = self.base.fixture['fixtureId']
        self.preview = b'approved preview bytes'
        self.catalog = b'approved catalog bytes'
        with connect(self.root) as conn:
            conn.execute("UPDATE sidecar_assets SET pixel_width=3000,pixel_height=2000,location_label='Spain'");conn.commit()
        results = pipeline_tests.verified_public_set()
        for result in results:
            if result['bucket'].endswith('public'):
                result.update(checksumSha256=hashlib.sha256(self.preview).hexdigest(),
                    remoteChecksumSha256=hashlib.sha256(self.preview).hexdigest(), bytes=len(self.preview))
        publish_verified_asset(self.root, 'asset-1', results)
        with connect(self.root) as conn:
            conn.execute("""UPDATE public_catalog_publications SET state='live',public_url=?,
                catalog_sha256=?,verified_at=? WHERE asset_id='asset-1'""",
                (access.CATALOG_URL,hashlib.sha256(self.catalog).hexdigest(),access._now()))
            conn.commit()

    def tearDown(self):
        self.base.tearDown()

    def observe(self, items):
        now = datetime.now(timezone.utc)
        return dict(ok=True,schema=access.SCHEMA,readOnly=True,checkedAt=now.isoformat(),
            expiresAt=(now+timedelta(minutes=5)).isoformat(),
            items=[dict(items[0],allowed=True,reason='allowed',revision=1,receiptId='registered')])

    def verify(self, **kwargs):
        return access.verify_public_access(self.root,self.fixture,observer=kwargs.pop('observer',self.observe),
            fetch=kwargs.pop('fetch',lambda _:self.preview),catalog_fetch=lambda:self.catalog,**kwargs)

    def count(self):
        return upload_eligibility_plan(self.root,fixture_id=self.fixture)['liveOnWebsiteCount']

    def test_historical_catalog_is_pending_until_explicit_read_only_check(self):
        self.assertEqual(self.count(),0)
        with connect(self.root) as conn:
            before = [tuple(r) for r in conn.execute('SELECT * FROM fixture_delivery_receipts')]
        for _ in range(2):
            result = self.verify()
            self.assertEqual(result['allowed'],1,result)
            self.assertEqual(self.count(),1)
        with connect(self.root) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM public_access_observations').fetchone()[0],1)
            self.assertEqual([tuple(r) for r in conn.execute('SELECT * FROM fixture_delivery_receipts')],before)

    def test_denied_missing_mismatch_failure_and_replay_remove_live_without_reupload(self):
        for reason in ('identity-missing','binding-missing','lifecycle-denied','binding-mismatch'):
            self.verify()
            def denied(items):
                result=self.observe(items);result['items'][0].update(allowed=False,reason=reason);return result
            result=self.verify(observer=denied)
            self.assertEqual(result['allowed'],0,result)
            self.assertEqual(self.count(),0)
        def wrong(items):
            result=self.observe(items);result['items'][0]['canonicalAssetId']='other';return result
        def old(items):
            result=self.observe(items);result['checkedAt']='2026-01-01T00:00:00Z';return result
        for observer in (wrong,old,lambda _: (_ for _ in ()).throw(OSError('offline'))):
            self.verify()
            self.assertEqual(self.verify(observer=observer)['failed'],1)
            self.assertEqual(self.count(),0)
        self.assertEqual(upload_eligibility_plan(self.root,fixture_id=self.fixture)['mediaUploadedCount'],1)

    def test_changed_receipts_catalog_approval_source_and_expiry_invalidate(self):
        for sql in (
            "UPDATE fixture_delivery_receipts SET checksum_sha256='changed' WHERE destination='r2' AND visibility_policy='public'",
            "UPDATE public_catalog_publications SET catalog_sha256='changed'",
            "UPDATE asset_editorial_state SET editorial_state='unreviewed'",
            "UPDATE asset_source_versions SET source_exists=0",
            "UPDATE r2_objects SET lifecycle_state='marked_for_delete'",
            "UPDATE fixtures SET policy_revision=policy_revision+1",
            "UPDATE public_access_observations SET expires_at='2026-01-01T00:00:00Z'",
        ):
            with self.subTest(sql=sql):
                self.assertEqual(self.verify()['allowed'],1)
                with connect(self.root) as conn:
                    conn.execute('SAVEPOINT change');conn.execute(sql)
                    self.assertEqual(conn.execute('SELECT COUNT(*) FROM public_access_current').fetchone()[0],0)
                    conn.execute('ROLLBACK TO change');conn.execute('RELEASE change')

    def test_bytes_failure_and_local_change_while_network_pending_fail_closed(self):
        self.assertEqual(self.verify(fetch=lambda _:b'wrong')['failed'],1)
        def changed(items):
            result=self.observe(items)
            with connect(self.root) as conn:
                conn.execute("UPDATE asset_editorial_state SET editorial_state='unreviewed'");conn.commit()
            return result
        self.assertEqual(self.verify(observer=changed)['pending'],1)
        self.assertEqual(self.count(),0)

    def test_bounded_batch_and_private_fixture_rejected(self):
        for limit in (0,21,500):
            with self.assertRaises(ValueError):self.verify(limit=limit)
        with connect(self.root) as conn:
            conn.execute("UPDATE fixtures SET policy_overrides_json=? WHERE fixture_id=?",(json.dumps({'visibility':'private'}),self.fixture));conn.commit()
        with self.assertRaises(ValueError):self.verify()

    def test_current_fixture_edition_and_source_change_are_bound(self):
        import fixture_editions as editions
        with connect(self.root) as conn:
            source=conn.execute("SELECT source_version_hash FROM asset_publications WHERE asset_id='asset-1'").fetchone()[0]
            editions.ensure_schema(conn)
            edition=editions.seed_edition(conn,self.fixture,'asset-1',source_version_id=source,title='Spain')
            edition=editions.approve_edition(conn,self.fixture,'asset-1',expected_revision=editions.revision_hash(edition))
            conn.execute("UPDATE fixture_edition_delivery SET delivery_state='live',receipt_version_hash=source_version_hash")
            conn.commit()
        self.assertEqual(self.verify()['allowed'],1)
        self.assertEqual(self.count(),1)
        with connect(self.root) as conn:
            editions.edit_edition(conn,self.fixture,'asset-1',title='New edition')
            conn.commit()
        self.assertEqual(self.count(),0)

    def test_revoke_during_preview_read_and_obsolete_fence_fail_closed(self):
        calls=0
        def revoke(items):
            nonlocal calls
            calls+=1
            result=self.observe(items)
            if calls==2:result['items'][0].update(allowed=False,reason='lifecycle-denied')
            return result
        self.assertEqual(self.verify(observer=revoke)['blocked'],1)
        self.assertEqual(self.count(),0)
        calls=0
        def changed(items):
            nonlocal calls
            calls+=1
            result=self.observe(items);result['items'][0]['revision']=calls;return result
        self.assertEqual(self.verify(observer=changed)['failed'],1)
