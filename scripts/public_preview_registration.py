"""Exact source-authorized public registration via the existing connector API."""
from __future__ import annotations

import hashlib
import json

from public_access_verification import _expected, _now, validate_observation
from public_publication_state import save_item


class PublicationCancelled(RuntimeError):
    pass


def current_input(root, run_id, asset_id):
    """Fail closed on changed approval, source, policy, receipts or selection."""
    from fixture_pipeline import connect
    from fixture_policy import effective_fixture_policy, policy_allows_catalog
    from fixture_edition_uploads import validate_upload
    with connect(root) as conn:
        run = conn.execute('SELECT * FROM public_publication_runs WHERE run_id=?',(run_id,)).fetchone()
        raw = conn.execute('SELECT cancel_requested FROM asset_upload_runs WHERE run_id=?',(run_id,)).fetchone()
        if raw['cancel_requested']:
            raise PublicationCancelled('Publication stopped at a safe checkpoint; existing receipts are retained.')
        item = conn.execute('SELECT * FROM public_publication_items WHERE run_id=? AND asset_id=?',(run_id,asset_id)).fetchone()
        if not item:
            raise ValueError('Photo is not a member of this pinned publication run.')
        if not policy_allows_catalog(effective_fixture_policy(root,run['fixture_id'],conn=conn)['effective']):
            raise ValueError('The selected fixture no longer allows public publication.')
        validate_upload(conn,run['fixture_id'],asset_id,item['source_version_hash'])
        row = conn.execute('SELECT * FROM public_registration_inputs WHERE fixture_id=? AND asset_id=? AND approval_revision_hash=?',
                           (run['fixture_id'],asset_id,item['source_version_hash'])).fetchone()
        if not row or row['source_version_hash'] != item['source_version_hash']:
            raise ValueError('Exact current uploaded preview and local catalog evidence is missing.')
        row, item = dict(row), dict(item)
        expected, previews = _expected(row,require_deployed=False)
        fingerprint = json.loads(row['input_json'])
        fingerprint.pop('catalog',None)  # Deployment advances independently of source authorization.
        if item['input_json'] and json.loads(item['input_json']) != fingerprint:
            raise ValueError('Approved publication inputs changed; do not reuse or replace the saved registration plan.')
    return row, item, expected, previews, fingerprint


class RegistrationClient:
    """Use only the already configured connector and current exact-ID observer."""
    def __init__(self, root):
        from new_owner_connector import DEFAULT_CONFIG_PATH, WorkerClient, load_config
        config = load_config(DEFAULT_CONFIG_PATH)
        if config.repo_root.resolve()!=root.resolve() or config.worker_base not in {
            'https://auth.photos-by-elie.com','https://download.photos-by-elie.com',
            'https://photosbyelie-checkout-mock.ec92009.workers.dev',
        }:
            raise ValueError('Existing connector identity does not match this Owner workspace.')
        self.client = WorkerClient(config)

    def observe(self, items):
        return self.client.request('POST','/api/v1/lifecycle/public-previews/verify',{'items':items})

    def prepare(self, repair_id, items):
        return self.client.request('POST','/api/v1/lifecycle/reconcile',
                                   {'prepareOnly':True,'repairId':repair_id,'items':items})

    def apply(self, envelope):
        return self.client.request('POST','/api/v1/lifecycle/reconcile',envelope)


def register_item(root, run_id, asset_id, client, *, fetch=None):
    """Reconcile before every apply; lost replies never mint another identity."""
    from r2_receipt_verification import remote_receipt
    fetch = fetch or remote_receipt
    row, item, expected, previews, fingerprint = current_input(root,run_id,asset_id)
    if not item['input_json']:
        save_item(root,run_id,asset_id,'input_json',fingerprint)
    started = _now()
    observation = client.observe([expected])
    remote = validate_observation(observation,expected,started)
    reused_registration = remote.get('allowed') is True and bool(item['registration_json'])
    if remote.get('allowed') is not True:
        if remote.get('reason') != 'identity-missing':
            raise ValueError('Existing lifecycle identity/binding is blocked or mismatched; supported reconciliation is required.')
        repair_id = 'native-'+hashlib.sha256((run_id+'\0'+asset_id+'\0'+item['source_version_hash']).encode()).hexdigest()
        # Preparing again is read-only and recovers the original receipt after a
        # lost apply response. It also refreshes an unapplied stale global fence.
        plan = client.prepare(repair_id,[expected])
        envelope = plan.get('envelope',{})
        if (plan.get('schema')!='photosbyelie.publicPreviewRegistrationPlan.v1'
            or plan.get('readOnly') is not True or plan.get('state') not in {'prepared','applied'}
            or envelope.get('repairId')!=repair_id or envelope.get('items')!=[expected]
            or envelope.get('seedId')!='public-preview:'+repair_id):
            raise ValueError('Prepared registration envelope does not match this exact run/source.')
        save_item(root,run_id,asset_id,'envelope_json',envelope)
        for preview in previews:
            proof = fetch('photosbyelie-public',preview['key'])
            if proof != {'bytes':preview['bytes'],'sha256':preview['sha256']}:
                raise ValueError('R2 public preview bytes no longer match the approved upload receipt.')
        current_input(root,run_id,asset_id)  # No apply after cancellation or stale local approval.
        client.apply(envelope)
        observation = client.observe([expected])
        remote = validate_observation(observation,expected,started)
    if remote.get('allowed') is not True or remote.get('reason')!='allowed' or type(remote.get('revision')) is not int:
        raise ValueError('Registration has no current allowed cloud receipt; public verification remains pending.')
    # Also validate bytes when reusing an existing cloud identity. This is a GET,
    # never a reason to overwrite missing or conflicting evidence.
    if not reused_registration:
        for preview in previews:
            if fetch('photosbyelie-public',preview['key']) != {'bytes':preview['bytes'],'sha256':preview['sha256']}:
                raise ValueError('Registered preview bytes no longer match the approved upload receipt.')
    current_input(root,run_id,asset_id)
    save_item(root,run_id,asset_id,'registration_json',observation)
    return observation
