"""Two-fixture regression tests across the real Review/AI/upload boundaries."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fixture_pipeline import connect, create_fixture, set_fixture_asset_state, ready_ai_proposals, record_ai_preview
from sidecar_state_db import upsert_assets
import fixture_editions as editions
from native_publication_pipeline import create_upload_run, run_upload_batch, upload_eligibility_plan
from fixture_edition_uploads import object_keys, validate_upload
from native_publication_pipeline_test import verified_public_set
from requested_ai_proposal_pass import run_requested_ai_pass


class FixtureEditionIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.root=Path(self.temp.name)
        upsert_assets(self.root,[dict(localIdentifier='photo',filename='one.jpg',mediaType='photo',title='Original')])
        self.a=create_fixture(self.root,'Expo')['fixtureId']
        self.b=create_fixture(self.root,'RE Marketing',template_key='expo')['fixtureId']
        for f in (self.a,self.b): set_fixture_asset_state(self.root,f,['photo'],'picked')
        with connect(self.root) as c:
            c.execute("INSERT INTO asset_source_versions (version_id,asset_id,metadata_fingerprint,rendered_fingerprint,source_exists,state,created_at) VALUES ('original','photo','','',1,'candidate','2026-01-01'),('after','photo','','after-render',1,'candidate','2026-01-02')")
            editions.ensure_schema(c)
            for f in (self.a,self.b): editions.seed_edition(c,f,'photo',source_version_id='original',title='Original')
            c.commit()
    def tearDown(self): self.temp.cleanup()
    def approve(self,f,title,source='original'):
        with connect(self.root) as c:
            e=editions.edit_edition(c,f,'photo',title=title,keywords=[title],source_version_id=source)
            e=editions.approve_edition(c,f,'photo',expected_revision=editions.revision_hash(e))
            c.commit(); return e
    def test_uploads_are_fixture_scoped_and_pin_different_versions(self):
        a=self.approve(self.a,'Expo title'); b=self.approve(self.b,'Marketing title','after')
        for f,title in ((self.a,'Expo title'),(self.b,'Marketing title')):
            p=upload_eligibility_plan(self.root,fixture_id=f)
            self.assertEqual([r['title'] for r in p['items']],[title])
        ra=create_upload_run(self.root,['photo'],fixture_id=self.a)
        rb=create_upload_run(self.root,['photo'],fixture_id=self.b)
        with connect(self.root) as c:
            self.assertEqual(c.execute('SELECT source_version_hash FROM asset_upload_run_items WHERE run_id=?',(ra['runId'],)).fetchone()[0],a['approved_revision_hash'])
            row=dict(c.execute('SELECT * FROM sidecar_assets').fetchone())
            policy={'visibility':'public','retention':'cloud','download':'original','search':'on','delivery':'public'}
            # Use real policy resolver rather than invent policy values.
            from fixture_policy import effective_fixture_policy
            pa=effective_fixture_policy(self.root,self.a,conn=c)['effective']
            ka=object_keys(row,self.a,a['approved_revision_hash'],pa)
            kb=object_keys(row,self.b,b['approved_revision_hash'],pa)
            self.assertTrue(ka); self.assertTrue(set(k['key'] for k in ka).isdisjoint(k['key'] for k in kb))
        # Stub catalog projection only; execute the real receipt/state writer.
        with patch('native_publication_pipeline.catalog_candidate',return_value={'eligible':False,'reason':'test'}):
            run_upload_batch(self.root,ra['runId'],lambda _:[dict(status='uploaded',bucket=k['bucket'],key=k['key'],kind=k['kind'],checksumSha256='a'*64,remoteChecksumSha256='a'*64,remoteVerified=True,bytes=10) for k in ka])
        with connect(self.root) as c:
            states={r['fixture_id']:r['delivery_state'] for r in c.execute('SELECT * FROM fixture_edition_delivery')}
            self.assertEqual(states,{self.a:'live',self.b:'needs-upload'})
            self.assertEqual([r[0] for r in c.execute('SELECT fixture_id FROM asset_publications')],[self.a])
            editions.edit_edition(c,self.b,'photo',title='Changed after queued')
            with self.assertRaises(ValueError): validate_upload(c,self.b,'photo',b['approved_revision_hash'])
            self.assertEqual(editions.approved_edition(c,self.a,'photo')['title'],'Expo title')
    def test_ai_proposal_request_preview_and_completion_stay_in_one_fixture(self):
        preview=self.root/'preview.jpg'; preview.write_bytes(b'test-preview')
        with connect(self.root) as c:
            for f in (self.a,self.b):
                c.execute("UPDATE fixture_asset_editions SET editorial_state='requesting-ai',requested_at='2026-01-01',ai_note=? WHERE fixture_id=?",(f,f))
            c.commit()
        record_ai_preview(self.root,'photo',preview,fixture_id=self.a)
        seen=[]
        def proposer(item):
            seen.append(item)
            return dict(title='AI Expo',keywords=['Expo'],country='',confidence='high',reason='test',needsOwnerContext=False)
        result=run_requested_ai_pass(self.root,fixture_id=self.a,trigger='test',prepared_asset_ids=['photo'],proposer=proposer)
        self.assertTrue(result['ok'],result)
        self.assertEqual(seen[0]['fixtureId'],self.a)
        self.assertEqual(ready_ai_proposals(self.root,fixture_id=self.a)['count'],1)
        self.assertEqual(ready_ai_proposals(self.root,fixture_id=self.b)['count'],0)
        with connect(self.root) as c:
            self.assertEqual(editions.get_edition(c,self.b,'photo')['editorial_state'],'requesting-ai')
            self.assertEqual(editions.get_edition(c,self.b,'photo')['ai_preview_path'],'')
            self.assertEqual(editions.get_edition(c,self.a,'photo')['title'],'Original')
        record_ai_preview(self.root,'photo',preview,fixture_id=self.b)
        second=run_requested_ai_pass(self.root,fixture_id=self.b,trigger='test',prepared_asset_ids=['photo'],proposer=proposer)
        self.assertTrue(second['ok'],second)
        self.assertEqual(ready_ai_proposals(self.root,fixture_id=self.b)['count'],1)
        self.assertEqual(ready_ai_proposals(self.root,fixture_id=self.a)['count'],1)

    def test_owner_api_review_and_undo_do_not_change_another_fixture(self):
        from fixture_pipeline import apply_fixture_review_action,undo_fixture_review_action,fixture_review_window
        a=apply_fixture_review_action(self.root,self.a,['photo'],'approve',title='Expo accepted')
        b=apply_fixture_review_action(self.root,self.b,['photo'],'approve',title='Marketing accepted')
        rows=fixture_review_window(self.root,self.b,state_filters=['approved'])
        self.assertEqual([r['title'] for r in rows['items']],['Marketing accepted'])
        apply_fixture_review_action(self.root,self.a,['photo'],'edit-metadata',title='New Expo draft')
        undo_fixture_review_action(self.root,b['operationId'])
        with connect(self.root) as c:
            self.assertEqual(editions.get_edition(c,self.a,'photo')['title'],'New Expo draft')
            self.assertEqual(editions.get_edition(c,self.b,'photo')['editorial_state'],'unreviewed')
        hide=apply_fixture_review_action(self.root,self.b,['photo'],'hide')
        undo_fixture_review_action(self.root,hide['operationId'])

    def test_give_back_uses_only_expo_edition(self):
        from apple_photos_metadata_writer import writeback_plan
        self.approve(self.a,'Expo title'); self.approve(self.b,'Marketing title','after')
        plan=writeback_plan(self.root,self.a,['photo'])
        self.assertEqual(plan['items'][0]['title'],'Expo title')
        self.assertEqual(plan['items'][0]['fixtureIds'],[self.a])
        for fixture in (self.b,''):
            with self.assertRaisesRegex(ValueError,'only in Expo'):
                writeback_plan(self.root,fixture,['photo'])

    def test_catalog_projection_and_recovery_keep_two_fixture_editions(self):
        import shutil
        from native_publication_pipeline import publish_verified_asset
        from native_asset_publication import catalog_recovery_plan,create_catalog_recovery_run,execute_catalog_recovery_run
        catalog=self.root/'assets/catalog/photosbyelie.sqlite'
        catalog.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(Path(__file__).resolve().parents[1]/'assets/catalog/photosbyelie.sqlite',catalog)
        from owner_catalog_projection import import_projection
        import_projection(self.root/'assets/owner-actions/Owner.sqlite',catalog,approved_policy='PBE-173')
        revisions={}
        media_ids=[]
        for fixture,title,source in ((self.a,'Expo Spain','original'),(self.b,'Marketing Spain','after')):
            edition=self.approve(fixture,title,source);revision=edition['approved_revision_hash'];revisions[fixture]=revision
            with connect(self.root) as c:
                c.execute("UPDATE sidecar_assets SET pixel_width=4176,pixel_height=2784,location_label='Spain' WHERE asset_id='photo'")
                c.commit()
                from fixture_policy import effective_fixture_policy
                policy=effective_fixture_policy(self.root,fixture,conn=c)['effective']
                keys=object_keys(dict(c.execute('SELECT * FROM sidecar_assets').fetchone()),fixture,revision,policy)
            receipts=[dict(k,status='uploaded',objectKind=k['kind'],checksumSha256='a'*64,remoteChecksumSha256='a'*64,remoteVerified=True,bytes=10) for k in keys]
            result=publish_verified_asset(self.root,'photo',receipts,fixture_id=fixture,revision_hash=revision)
            self.assertEqual(result['publicCatalog']['state'],'local',result)
            media_ids.append(result['publicCatalog']['mediaId'])
        self.assertNotEqual(*media_ids)
        import sqlite3
        with sqlite3.connect(catalog) as c:
            rows=c.execute('SELECT title FROM media_items WHERE media_id IN (?,?)',media_ids).fetchall()
            self.assertEqual({r[0] for r in rows},{'Expo Spain','Marketing Spain'})
        with connect(self.root) as c:
            c.execute("UPDATE public_catalog_publications SET state='pending' WHERE source_version_hash=?",(revisions[self.a],));c.commit()
        self.assertEqual(catalog_recovery_plan(self.root,self.a)['recoverableCount'],1)
        self.assertEqual(catalog_recovery_plan(self.root,self.b)['candidateCount'],0)
        run=create_catalog_recovery_run(self.root,self.a)
        with patch('native_asset_publication.refresh_public_catalog_artifacts',return_value={'ok':True}), patch('sidecar_state_db._upload_bridge_execute_r2') as uploader:
            result=execute_catalog_recovery_run(self.root,run['runId'])
        self.assertEqual(result['failed'],0,result);uploader.assert_not_called()

    def test_retry_keeps_exact_approved_revision_and_non_expo_has_no_give_back_authority(self):
        from native_asset_publication import reset_upload_run_for_retry
        from backstage_photos_job import plan
        e=self.approve(self.b,'Marketing title','after')
        run=create_upload_run(self.root,['photo'],fixture_id=self.b)
        with connect(self.root) as c:
            c.execute("UPDATE asset_upload_run_items SET status='failed' WHERE run_id=?",(run['runId'],));c.commit()
        reset_upload_run_for_retry(self.root,run['runId'])
        with connect(self.root) as c:
            self.assertEqual(c.execute('SELECT source_version_hash FROM asset_upload_run_items WHERE run_id=?',(run['runId'],)).fetchone()[0],e['approved_revision_hash'])
        authority=plan(self.root,dict(actionKind='sidecar-culling-review',payload=dict(manifest=dict(mode='asset-upload-run-resume',runId=run['runId']))))
        self.assertEqual(authority['operations'],['photos.export-original'])
        self.assertEqual(authority['writes'],[])

    def test_upload_exports_selected_after_without_non_expo_photos_writeback(self):
        from fixture_edition_uploads import execute_run
        self.approve(self.b,'Marketing','after')
        run=create_upload_run(self.root,['photo'],fixture_id=self.b)
        seen=[]
        def export(_root,**kwargs):
            seen.append(kwargs['source_version_id'])
            path=kwargs['destination']/'after.jpg';path.parent.mkdir(parents=True);path.write_bytes(b'after')
            return dict(materializedCount=1,items=[dict(path=str(path))])
        def upload(**kwargs):
            self.assertEqual(kwargs['export_path'].read_bytes(),b'after')
            return [dict(k,status='uploaded',objectKind=k['kind'],checksumSha256='a'*64,remoteChecksumSha256='a'*64,remoteVerified=True,bytes=5) for k in kwargs['planned_keys']]
        with patch('sidecar_state_db._run_backstage_photos_materialize_one',side_effect=export), patch('sidecar_state_db._upload_bridge_execute_r2',side_effect=upload), patch('native_publication_pipeline.catalog_candidate',return_value={'eligible':False}), patch('apple_photos_metadata_writer.commit_writeback') as giveback:
            result=execute_run(self.root,run['runId'])
        self.assertEqual(result['failed'],0,result)
        self.assertEqual(seen,['after']);giveback.assert_not_called()

    def test_unscoped_upload_or_ai_cannot_fall_back_to_global_approval(self):
        self.approve(self.a,'Expo')
        with self.assertRaises(ValueError): create_upload_run(self.root,['photo'])
        with self.assertRaises(ValueError): run_requested_ai_pass(self.root,trigger='test',prepared_asset_ids=['photo'])

if __name__=='__main__': unittest.main()
