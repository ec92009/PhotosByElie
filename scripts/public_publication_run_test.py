"""Real disposable Owner schema; fake providers, never production mutations."""
import hashlib
import json
import shutil
import unittest
from pathlib import Path
from unittest.mock import patch
import sys

sys.path.insert(0,str(Path(__file__).resolve().parent))

import fixture_edition_integration_test as edition_tests
from fixture_pipeline import connect
from fixture_policy import effective_fixture_policy
from fixture_edition_uploads import object_keys
from native_publication_pipeline import create_upload_run, run_upload_batch, upload_run_status, request_upload_run_cancel
from native_asset_publication import claim_upload_run_start, reconcile_upload_run_receipts
from owner_catalog_projection import import_projection
from public_preview_registration import register_item, current_input
from public_publication_run import finish_publication
from public_publication_state import get, recover_dead_workers
import public_access_verification as access


class Cloud:
    def __init__(self):
        self.allowed = False
        self.denied = False
        self.applies = 0
        self.plans = []
        self.lose_reply = False

    def observe(self, items):
        from datetime import datetime, timedelta, timezone
        now = datetime.now(timezone.utc)
        return dict(schema=access.SCHEMA,readOnly=True,checkedAt=now.isoformat(),
            expiresAt=(now+timedelta(minutes=5)).isoformat(),items=[dict(items[0],
                allowed=self.allowed and not self.denied,revision=1,receiptId='receipt',
                reason='lifecycle-denied' if self.denied else 'allowed' if self.allowed else 'identity-missing')])

    def prepare(self, repair_id, items):
        envelope = dict(repairId=repair_id,seedId='public-preview:'+repair_id,items=items)
        self.plans.append(envelope)
        return dict(schema='photosbyelie.publicPreviewRegistrationPlan.v1',readOnly=True,state='prepared',envelope=envelope)

    def apply(self, envelope):
        self.applies += 1
        self.allowed = True
        if self.lose_reply:
            self.lose_reply = False
            raise OSError('connection lost after durable cloud commit')
        return {'ok':True}


class PublicPublicationRunTests(unittest.TestCase):
    def setUp(self):
        self.base = edition_tests.FixtureEditionIntegrationTests()
        self.base.setUp()
        self.root,self.fixture = self.base.root,self.base.a
        catalog = self.root/'assets/catalog/photosbyelie.sqlite'
        catalog.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(Path(__file__).resolve().parents[1]/'assets/catalog/photosbyelie.sqlite',catalog)
        import_projection(self.root/'assets/owner-actions/Owner.sqlite',catalog,approved_policy='PBE-173')
        with connect(self.root) as conn:
            conn.execute("UPDATE sidecar_assets SET pixel_width=3000,pixel_height=2000,location_label='Spain'")
            conn.commit()
        edition = self.base.approve(self.fixture,'Spain')
        self.revision = edition['approved_revision_hash']
        run = create_upload_run(self.root,['photo'],fixture_id=self.fixture)
        self.run = run['runId']
        claim_upload_run_start(self.root,self.run)
        self.preview = b'approved preview bytes'
        self.catalog = b'approved catalog bytes'
        self.sha = hashlib.sha256(self.preview).hexdigest()
        with connect(self.root) as conn:
            keys = object_keys(dict(conn.execute('SELECT * FROM sidecar_assets').fetchone()),self.fixture,self.revision,
                effective_fixture_policy(self.root,self.fixture,conn=conn)['effective'])
        receipts = [dict(k,status='uploaded',objectKind=k['kind'],checksumSha256=self.sha,
                         remoteChecksumSha256=self.sha,remoteVerified=True,bytes=len(self.preview)) for k in keys]
        run_upload_batch(self.root,self.run,lambda _:receipts)
        self.cloud = Cloud()
        self.deploys = 0

    def tearDown(self):
        self.base.tearDown()

    def register(self, root, run, asset, cloud):
        return register_item(root,run,asset,cloud,fetch=lambda *_:{'bytes':len(self.preview),'sha256':self.sha})

    def deploy(self, root):
        self.deploys += 1
        with connect(root) as conn:
            conn.execute("UPDATE public_catalog_publications SET state='live',public_url=?,catalog_sha256=?,verified_at=?",
                         (access.CATALOG_URL,hashlib.sha256(self.catalog).hexdigest(),access._now()))
            conn.commit()
        return {'ok':True,'commitSha':'mock-deployment'}

    def verify(self, *args, **kwargs):
        return access.verify_public_access(*args,**kwargs,fetch=lambda _:self.preview,catalog_fetch=lambda:self.catalog)

    def finish(self, **kwargs):
        return finish_publication(self.root,self.run,client=self.cloud,register=self.register,
            deploy=kwargs.pop('deploy',self.deploy),verify=kwargs.pop('verify',self.verify),**kwargs)

    def test_raw_upload_complete_is_not_public_complete_and_claim_stays_exclusive(self):
        result = upload_run_status(self.root,self.run)
        self.assertEqual((result['uploadStatus'],result['status'],result['publicationPhase']),('completed','running','upload'))
        self.assertEqual(result['remaining'],1)
        self.assertFalse(claim_upload_run_start(self.root,self.run)['claimed'])
        with connect(self.root) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM public_access_current').fetchone()[0],0)
        result = self.finish()
        self.assertEqual((result['status'],result['live'],result['registered'],result['publicVerified']),('completed',1,1,1),result)

    def test_lost_registration_reply_reuses_cloud_state_and_saved_exact_envelope(self):
        self.cloud.lose_reply = True
        result = self.finish()
        self.assertEqual((result['status'],result['publicationPhase']),('failed','registration'),result)
        with connect(self.root) as conn:
            saved = json.loads(conn.execute('SELECT envelope_json FROM public_publication_items').fetchone()[0])
            receipts = [tuple(row) for row in conn.execute('SELECT * FROM fixture_delivery_receipts')]
        self.assertEqual(saved,self.cloud.plans[0])
        claim_upload_run_start(self.root,self.run,retry_failed=True)
        self.assertEqual(self.finish()['status'],'completed')
        self.assertEqual(self.cloud.applies,1)
        self.assertEqual(len(self.cloud.plans),1)
        with connect(self.root) as conn:
            self.assertEqual(receipts,[tuple(row) for row in conn.execute('SELECT * FROM fixture_delivery_receipts')])

    def test_catalog_and_verification_interruptions_keep_prior_receipts(self):
        result = self.finish(deploy=lambda _:(_ for _ in ()).throw(OSError('offline during catalog')))
        self.assertEqual((result['status'],result['publicationPhase'],result['registered']),('failed','catalog',1))
        self.assertEqual(reconcile_upload_run_receipts(self.root)['latestFailedRun']['runId'],self.run)
        claim_upload_run_start(self.root,self.run,retry_failed=True)
        result = self.finish(verify=lambda *a,**k:(_ for _ in ()).throw(OSError('offline after deployment')))
        self.assertEqual((result['status'],result['publicationPhase']),('failed','verification'))
        claim_upload_run_start(self.root,self.run,retry_failed=True)
        self.assertEqual(self.finish()['status'],'completed')
        self.assertEqual(self.cloud.applies,1)

    def test_private_policy_or_withdrawn_approval_cannot_register(self):
        with connect(self.root) as conn:
            conn.execute("UPDATE fixtures SET policy_overrides_json=? WHERE fixture_id=?",(json.dumps({'visibility':'private'}),self.fixture))
            conn.commit()
        self.assertEqual(self.finish()['status'],'failed')
        self.assertEqual(self.cloud.applies,0)
        self.assertEqual(self.deploys,0)

    def test_stale_approval_during_remote_byte_check_stops_before_apply(self):
        def changed(*_):
            with connect(self.root) as conn:
                conn.execute("UPDATE fixture_asset_editions SET editorial_state='unreviewed' WHERE fixture_id=?",(self.fixture,))
                conn.commit()
            return {'bytes':len(self.preview),'sha256':self.sha}
        with self.assertRaisesRegex(ValueError,'approval was withdrawn'):
            register_item(self.root,self.run,'photo',self.cloud,fetch=changed)
        self.assertEqual(self.cloud.applies,0)

    def test_source_change_after_plan_and_later_cloud_denial_never_reopen(self):
        self.cloud.lose_reply = True
        self.finish()
        self.cloud.denied = True
        claim_upload_run_start(self.root,self.run,retry_failed=True)
        self.assertEqual(self.finish()['status'],'failed')
        self.assertEqual(self.cloud.applies,1)
        with connect(self.root) as conn:
            conn.execute("UPDATE asset_source_versions SET source_exists=0 WHERE version_id='original'")
            conn.commit()
        with self.assertRaises(ValueError):current_input(self.root,self.run,'photo')

    def test_cancellation_after_upload_is_resumable_and_does_not_deploy(self):
        requested = request_upload_run_cancel(self.root,self.run)
        self.assertTrue(requested['cancelRequested'])
        self.assertEqual(self.finish()['status'],'cancelled')
        self.assertEqual(self.cloud.applies,0)
        claim_upload_run_start(self.root,self.run,retry_failed=True)
        self.assertEqual(self.finish()['status'],'completed')

    def test_dead_worker_recovery_does_not_steal_active_process(self):
        with connect(self.root) as conn:
            conn.execute('UPDATE public_publication_runs SET worker_pid=12345')
            with patch('public_publication_state.os.kill'):
                self.assertEqual(recover_dead_workers(conn),[])
            with patch('public_publication_state.os.kill',side_effect=ProcessLookupError):
                self.assertEqual(recover_dead_workers(conn),[self.run])
            self.assertEqual(get(conn,self.run)['status'],'failed')
            conn.commit()

    def test_stale_dead_worker_observation_cannot_fail_a_new_claim(self):
        with connect(self.root) as conn:
            conn.execute('UPDATE public_publication_runs SET worker_pid=111')
            conn.commit()
            def replaced(*_):
                with connect(self.root) as newer:
                    newer.execute("UPDATE public_publication_runs SET worker_pid=222,updated_at='new-claim'")
                    newer.execute("UPDATE asset_upload_runs SET status='running'")
                    newer.commit()
                raise ProcessLookupError
            with patch('public_publication_state.os.kill',side_effect=replaced):
                self.assertEqual(recover_dead_workers(conn),[])
            self.assertEqual(get(conn,self.run)['worker_pid'],222)
            self.assertEqual(get(conn,self.run)['status'],'running')
            self.assertEqual(conn.execute('SELECT status FROM asset_upload_runs WHERE run_id=?',(self.run,)).fetchone()[0],'running')

    def extra_run(self):
        """Build a real two-photo run; the earlier photo is deliberately out of scope."""
        import fixture_editions as editions
        from fixture_pipeline import set_fixture_asset_state
        from sidecar_state_db import upsert_assets
        ids=['partial-one','partial-two']
        upsert_assets(self.root,[dict(localIdentifier=asset,filename=asset+'.jpg',mediaType='photo',
                                     pixelWidth=3000,pixelHeight=2000) for asset in ids])
        set_fixture_asset_state(self.root,self.fixture,ids,'picked')
        revisions={}
        with connect(self.root) as conn:
            conn.execute("UPDATE sidecar_assets SET location_label='Spain'")
            for asset in ids:
                conn.execute("INSERT INTO asset_source_versions (version_id,asset_id,metadata_fingerprint,rendered_fingerprint,source_exists,state,created_at) VALUES (?,?, '', '',1,'candidate','2026-01-01')",(asset+'-source',asset))
                e=editions.seed_edition(conn,self.fixture,asset,source_version_id=asset+'-source',title='Spain',keywords=['Spain'],country='Spain')
                e=editions.approve_edition(conn,self.fixture,asset,expected_revision=editions.revision_hash(e))
                revisions[asset]=e['approved_revision_hash']
            conn.commit()
        self.run=create_upload_run(self.root,ids,fixture_id=self.fixture)['runId']
        claim_upload_run_start(self.root,self.run)
        def upload(asset):
            with connect(self.root) as conn:
                keys=object_keys(dict(conn.execute('SELECT * FROM sidecar_assets WHERE asset_id=?',(asset,)).fetchone()),
                    self.fixture,revisions[asset],effective_fixture_policy(self.root,self.fixture,conn=conn)['effective'])
            return [dict(k,status='uploaded',objectKind=k['kind'],checksumSha256=self.sha,
                         remoteChecksumSha256=self.sha,remoteVerified=True,bytes=len(self.preview)) for k in keys]
        run_upload_batch(self.root,self.run,upload)
        return ids

    def test_partial_verification_resumes_only_unfinished_and_reuses_catalog(self):
        ids=self.extra_run()
        def partial(*args,**kwargs):
            kwargs['asset_ids']=kwargs['asset_ids'][:1]
            return self.verify(*args,**kwargs)
        first=self.finish(verify=partial)
        self.assertEqual((first['status'],first['publicVerified']),('failed',1),first)
        claim_upload_run_start(self.root,self.run,retry_failed=True)
        checked=[]
        def rest(*args,**kwargs):
            checked.extend(kwargs['asset_ids']);return self.verify(*args,**kwargs)
        second=self.finish(verify=rest,deployment_current=lambda *_:True)
        self.assertEqual(second['status'],'completed',second)
        self.assertEqual(checked,[ids[1]])
        self.assertEqual(self.deploys,1)

    def test_catalog_reuse_requires_current_owner_and_live_exact_bytes(self):
        from public_publication_run import deployment_is_current
        self.deploy(self.root)
        row=current_input(self.root,self.run,'photo')[0]
        sha=hashlib.sha256(self.catalog).hexdigest()
        with patch('public_catalog_deployment._current_projection',return_value={'sha256':sha}), \
             patch('public_access_verification.fetch_catalog',return_value=self.catalog):
            self.assertTrue(deployment_is_current(self.root,{'projectionSha256':sha},[row]))
        with patch('public_catalog_deployment._current_projection',return_value={'sha256':'b'*64}), \
             patch('public_access_verification.fetch_catalog') as fetch:
            self.assertFalse(deployment_is_current(self.root,{'projectionSha256':sha},[row]))
            fetch.assert_not_called()
        with patch('public_catalog_deployment._current_projection',return_value={'sha256':sha}), \
             patch('public_access_verification.fetch_catalog',side_effect=OSError('offline')):
            with self.assertRaises(OSError):deployment_is_current(self.root,{'projectionSha256':sha},[row])

    def test_exact_verification_never_selects_another_fixture_photo(self):
        self.deploy(self.root)
        self.cloud.allowed=True
        with self.assertRaises(ValueError):
            self.verify(self.root,self.fixture,asset_ids=['not-in-run'],observer=self.cloud.observe)
        with connect(self.root) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM public_access_observations').fetchone()[0],0)

    def test_terminal_receipts_roll_back_together_after_write_failure(self):
        from public_publication_state import set_phase
        with connect(self.root) as conn:
            conn.execute("""CREATE TRIGGER fail_terminal BEFORE UPDATE OF status ON asset_upload_runs
                WHEN NEW.status='failed' BEGIN SELECT RAISE(ABORT,'simulated interruption'); END""")
            conn.commit()
        with self.assertRaisesRegex(Exception,'simulated interruption'):
            set_phase(self.root,self.run,'catalog',status='failed',error='offline')
        with connect(self.root) as conn:
            self.assertEqual(get(conn,self.run)['status'],'running')
            self.assertEqual(conn.execute('SELECT status FROM asset_upload_runs WHERE run_id=?',(self.run,)).fetchone()[0],'completed')
