"""Resume only the unfinished stages of one explicit <=50-photo native run."""
from __future__ import annotations

import os
import hashlib
import json
import re

from public_publication_state import get, now, save_item, set_phase, finish_in_transaction
from public_preview_registration import PublicationCancelled, RegistrationClient, current_input, register_item


def deployment_is_current(root, receipt, inputs):
    """Reuse a deployed stage only while Owner and exact live HTTPS bytes agree."""
    from public_catalog_deployment import _current_projection
    from public_access_verification import CATALOG_URL, fetch_catalog
    expected = receipt.get('projectionSha256','')
    if not re.fullmatch(r'[a-f0-9]{64}',expected) or any(
        row['catalog_state']!='live' or row['catalog_sha256']!=expected
        or row['public_url']!=CATALOG_URL or not row['verified_at'] for row in inputs):
        return False
    if _current_projection(root)['sha256'] != expected:
        return False
    return hashlib.sha256(fetch_catalog()).hexdigest()==expected


def finish_publication(root, run_id, *, client=None, register=register_item, deploy=None, verify=None,
                       deployment_current=deployment_is_current):
    """Continue after upload; all public completion is receipt-backed and scoped."""
    from fixture_pipeline import connect
    from native_publication_pipeline import upload_run_status
    from public_access_verification import verify_public_access
    from public_catalog_deployment import deploy_public_catalog
    with connect(root) as conn:
        run = get(conn,run_id)
        if not run or run['status']=='completed':
            return upload_run_status(root,run_id)
        items = [dict(row) for row in conn.execute('SELECT * FROM public_publication_items WHERE run_id=? ORDER BY asset_id',(run_id,))]
    try:
        def guard_all():
            return [current_input(root,run_id,item['asset_id'])[0] for item in items]
        with connect(root) as conn:
            raw = conn.execute('SELECT * FROM asset_upload_runs WHERE run_id=?',(run_id,)).fetchone()
            if raw['cancel_requested']:
                raise PublicationCancelled('Publication stopped safely; uploaded receipts remain available.')
            if raw['failed_count'] or raw['remaining_count']:
                raise ValueError('Some uploads are unfinished. Resume this run; verified objects will be reused.')
        guard_all()
        client = client or RegistrationClient(root)
        set_phase(root,run_id,'registration')
        for item in items:
            # Even a saved applied receipt cannot override a later cloud denial.
            register(root,run_id,item['asset_id'],client)
        inputs = guard_all()
        set_phase(root,run_id,'catalog')
        catalog = json.loads(run['catalog_receipt_json'])
        if not catalog or not deployment_current(root,catalog,inputs):
            catalog = deploy(root) if deploy else deploy_public_catalog(root,before_publish=guard_all)
        if catalog.get('ok') is not True:
            raise ValueError('Catalog deployment has no successful receipt; registration is retained.')
        set_phase(root,run_id,'verification',catalog=catalog)
        guard_all()
        with connect(root) as conn:
            pending, recovered = [], []
            for item in items:
                observation = conn.execute('SELECT * FROM public_access_current WHERE fixture_id=? AND asset_id=? AND approval_revision_hash=?',
                    (run['fixture_id'],item['asset_id'],item['source_version_hash'])).fetchone()
                if not observation:
                    pending.append(item)
                elif not item['verification_json']:
                    recovered.append(dict(assetId=item['asset_id'],mediaId=observation['media_id'],state='allowed',
                        checkedAt=observation['checked_at'],expiresAt=observation['expires_at'],recovered=True))
        for result in recovered:
            current_input(root,run_id,result['assetId'])
            save_item(root,run_id,result['assetId'],'verification_json',result)
        for start in range(0,len(pending),20):
            ids = [item['asset_id'] for item in pending[start:start+20]]
            report = (verify or verify_public_access)(root,run['fixture_id'],limit=len(ids),asset_ids=ids,observer=client.observe)
            results = report.get('items',[])
            returned = [item.get('assetId') for item in results]
            if len(set(returned))!=len(returned) or not set(returned).issubset(ids) or report.get('checked')!=len(results):
                raise ValueError('Public verification returned identities outside this exact batch.')
            for result in results:
                if result.get('state')=='allowed':
                    current_input(root,run_id,result['assetId'])
                    save_item(root,run_id,result['assetId'],'verification_json',result)
            if report.get('allowed')!=len(ids) or len(results)!=len(ids) or any(r.get('state')!='allowed' for r in results):
                raise ValueError('Public verification is incomplete; successful checks are checkpointed. Retry verifies only unfinished or expired photos.')
        guard_all()
        # Live remains PBB-179's fresh exact-input view, never this run ledger.
        with connect(root) as conn:
            conn.execute('BEGIN IMMEDIATE')
            if conn.execute('SELECT cancel_requested FROM asset_upload_runs WHERE run_id=?',(run_id,)).fetchone()[0]:
                raise PublicationCancelled('Publication stopped before its final completion receipt.')
            for item in items:
                if not conn.execute('SELECT 1 FROM public_access_current WHERE fixture_id=? AND asset_id=? AND approval_revision_hash=?',
                    (run['fixture_id'],item['asset_id'],item['source_version_hash'])).fetchone():
                    raise ValueError('Public verification expired or inputs changed before completion; retry verification.')
            finish_in_transaction(conn,run_id,'completed')
            conn.commit()
    except Exception as error:
        with connect(root) as conn:
            phase = get(conn,run_id)['phase']
        status = 'cancelled' if isinstance(error,PublicationCancelled) else 'failed'
        set_phase(root,run_id,phase,status=status,error=str(error)[:500])
    return upload_run_status(root,run_id)


def record_worker(root, run_id):
    """Pin process ownership before work, permitting proven-dead restart recovery."""
    from fixture_pipeline import connect
    with connect(root) as conn:
        if get(conn,run_id):
            conn.execute('UPDATE public_publication_runs SET worker_pid=?,updated_at=? WHERE run_id=?',(os.getpid(),now(),run_id))
            conn.commit()
