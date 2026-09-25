"""GET-first upload recovery; no real cloud requests."""
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parent))
from r2_receipt_verification import remote_receipt, verify_receipts
from sidecar_state_db import _upload_bridge_execute_r2


class R2ReceiptVerificationTests(unittest.TestCase):
    def test_missing_is_distinct_from_offline_auth_and_ambiguous_failure(self):
        for output in ('HTTP 403 AccessDenied','network timeout','unknown response'):
            with patch('sync_r2_media.wrangler_get',return_value=(None,False,output)):
                with self.assertRaises(OSError):
                    remote_receipt('photosbyelie-public','expo/one_900.jpg',backend='wrangler')
        with patch('sync_r2_media.wrangler_get',return_value=(None,False,'The specified key does not exist')):
            self.assertIsNone(remote_receipt('photosbyelie-public','expo/one_900.jpg',backend='wrangler'))

    def test_receipt_coverage_requires_fresh_exact_bytes(self):
        receipts=[{'bucket':'photosbyelie-public','key':'expo/one_900.jpg','bytes':10,'checksumSha256':'a'*64}]
        self.assertEqual(verify_receipts(receipts,fetch=lambda *_:{'bytes':10,'sha256':'a'*64}),receipts)
        for result in (None,{'bytes':9,'sha256':'a'*64},{'bytes':10,'sha256':'b'*64}):
            with self.assertRaises(ValueError):verify_receipts(receipts,fetch=lambda *_:result)

    def test_lost_put_reply_reuses_existing_bytes_without_another_put(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'original.jpg';source.write_bytes(b'approved bytes')
            proof={'bytes':source.stat().st_size,'sha256':hashlib.sha256(source.read_bytes()).hexdigest()}
            with patch('sidecar_state_db._prepare_upload_bridge_artifact',return_value=(source,'image/jpeg')), \
                 patch('r2_receipt_verification.remote_receipt',return_value=proof), \
                 patch('sync_r2_media.wrangler_put') as put:
                result=_upload_bridge_execute_r2(planned_keys=[{'bucket':'photosbyelie-public','key':'expo/one_900.jpg','kind':'public-preview'}],
                    export_path=source,media_type='photo',artifact_root=root,backend='wrangler',reconcile_existing=True)
            put.assert_not_called()
            self.assertTrue(result[0]['remoteVerified'])
            self.assertEqual(result[0]['verificationMethod'],'existing-remote-bytes')

    def test_remote_collision_or_ambiguous_read_never_overwrites(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'original.jpg';source.write_bytes(b'approved bytes')
            for remote in ({'bytes':3,'sha256':'b'*64},OSError('offline')):
                with patch('sidecar_state_db._prepare_upload_bridge_artifact',return_value=(source,'image/jpeg')), \
                     patch('r2_receipt_verification.remote_receipt',**({'side_effect':remote} if isinstance(remote,Exception) else {'return_value':remote})), \
                     patch('sync_r2_media.wrangler_put') as put:
                    result=_upload_bridge_execute_r2(planned_keys=[{'bucket':'photosbyelie-public','key':'expo/one_900.jpg','kind':'public-preview'}],
                        export_path=source,media_type='photo',artifact_root=root,backend='wrangler',reconcile_existing=True)
                put.assert_not_called()
                self.assertEqual(result[0]['status'],'failed')

    def test_ambiguous_put_has_no_internal_write_retries_and_is_reconciled_by_get(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'original.jpg';source.write_bytes(b'approved bytes')
            events=[]
            def put(item,retries,*_):
                self.assertEqual(retries,0)
                events.append('PUT');return item,False,'reply lost after commit'
            def get(item,path,*_):
                events.append('GET');path.write_bytes(source.read_bytes());return item,True,'read verified'
            with patch('sidecar_state_db._prepare_upload_bridge_artifact',return_value=(source,'image/jpeg')), \
                 patch('r2_receipt_verification.remote_receipt',side_effect=lambda *_a,**_k:events.append('GET')), \
                 patch('sync_r2_media.wrangler_put',side_effect=put), \
                 patch('sync_r2_media.wrangler_get',side_effect=get):
                result=_upload_bridge_execute_r2(planned_keys=[{'bucket':'photosbyelie-public','key':'expo/one_900.jpg','kind':'public-preview'}],
                    export_path=source,media_type='photo',artifact_root=root,backend='wrangler',reconcile_existing=True)
            self.assertEqual(events,['GET','PUT','GET'])
            self.assertTrue(result[0]['remoteVerified'])
