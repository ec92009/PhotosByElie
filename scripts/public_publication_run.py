"""Resume only the unfinished stages of one explicit <=50-photo native run."""
from __future__ import annotations

import os

from public_publication_state import get, now, save_item, set_phase
from public_preview_registration import PublicationCancelled, RegistrationClient, current_input, register_item


def finish_publication(root, run_id, *, client=None, register=register_item, deploy=None, verify=None):
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
            for item in items:
                current_input(root,run_id,item['asset_id'])
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
        guard_all()
        set_phase(root,run_id,'catalog')
        catalog = deploy(root) if deploy else deploy_public_catalog(root,before_publish=guard_all)
        if catalog.get('ok') is not True:
            raise ValueError('Catalog deployment has no successful receipt; registration is retained.')
        set_phase(root,run_id,'verification',catalog=catalog)
        guard_all()
        for start in range(0,len(items),20):
            ids = [item['asset_id'] for item in items[start:start+20]]
            report = (verify or verify_public_access)(root,run['fixture_id'],limit=len(ids),asset_ids=ids,observer=client.observe)
            if (report.get('allowed')!=len(ids) or report.get('checked')!=len(ids)
                or {item.get('assetId') for item in report.get('items',[])}!=set(ids)
                or any(item.get('state')!='allowed' for item in report.get('items',[]))):
                raise ValueError('Exact public access verification is incomplete; retain uploaded and registration receipts.')
            for result in report['items']:
                current_input(root,run_id,result['assetId'])
                save_item(root,run_id,result['assetId'],'verification_json',result)
        guard_all()
        # Live remains PBB-179's fresh exact-input view, never this run ledger.
        with connect(root) as conn:
            for item in items:
                if not conn.execute('SELECT 1 FROM public_access_current WHERE fixture_id=? AND asset_id=? AND approval_revision_hash=?',
                    (run['fixture_id'],item['asset_id'],item['source_version_hash'])).fetchone():
                    raise ValueError('Public verification expired or inputs changed before completion; retry verification.')
        set_phase(root,run_id,'complete',status='completed')
        with connect(root) as conn:
            conn.execute("UPDATE asset_upload_runs SET status='completed',last_error='',completed_at=?,updated_at=? WHERE run_id=?",(now(),now(),run_id))
            conn.commit()
    except Exception as error:
        with connect(root) as conn:
            phase = get(conn,run_id)['phase']
        status = 'cancelled' if isinstance(error,PublicationCancelled) else 'failed'
        set_phase(root,run_id,phase,status=status,error=str(error)[:500])
        with connect(root) as conn:
            conn.execute('UPDATE asset_upload_runs SET status=?,last_error=?,completed_at=?,updated_at=? WHERE run_id=?',
                         (status,str(error)[:500],now(),now(),run_id))
            conn.commit()
    return upload_run_status(root,run_id)


def record_worker(root, run_id):
    """Pin process ownership before work, permitting proven-dead restart recovery."""
    from fixture_pipeline import connect
    with connect(root) as conn:
        if get(conn,run_id):
            conn.execute('UPDATE public_publication_runs SET worker_pid=?,updated_at=? WHERE run_id=?',(os.getpid(),now(),run_id))
            conn.commit()
