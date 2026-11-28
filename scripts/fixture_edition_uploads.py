"""Exact-revision upload planning for fixture editions.

No global approval, metadata, Photos write-back or other fixture publication is
changed here. The existing batch runner owns progress, retries and cancellation.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import uuid
import sqlite3

from fixture_editions import approved_edition, enabled, require_source, timestamp, is_expo_fixture


def eligible_rows(conn, fixture_id):
    if not fixture_id:
        raise ValueError("Uploads require an explicit fixture.")
    return conn.execute("""SELECT a.*, e.title,e.keywords_json,e.country,e.source_version_id,
        e.approved_revision_hash,e.editorial_state, e.updated_at AS edition_updated_at,
        COALESCE(d.delivery_state,'needs-upload') AS delivery_state,COALESCE(NULLIF(d.receipt_version_hash,''),e.approved_revision_hash) AS receipt_version_hash,COALESCE(d.last_error,'') AS last_error
        FROM fixture_asset_decisions p JOIN sidecar_assets a USING(asset_id)
        JOIN fixture_asset_editions e ON e.asset_id=p.asset_id AND e.fixture_id=p.fixture_id
        LEFT JOIN fixture_edition_delivery d ON d.asset_id=e.asset_id AND d.fixture_id=e.fixture_id
          AND d.revision_hash=e.approved_revision_hash
        WHERE p.fixture_id=? AND p.placement_state='picked' AND p.eligibility_state='active'
          AND COALESCE(a.missing_at,'')=''
          AND NOT EXISTS (SELECT 1 FROM sidecar_tombstones t WHERE t.asset_id=a.asset_id AND t.tombstone_state='active')
          AND NOT EXISTS (SELECT 1 FROM media_lifecycle l WHERE l.media_id=a.asset_id AND l.lifecycle_state IN ('hidden','discarded'))
        ORDER BY e.updated_at,a.asset_id""", (fixture_id,)).fetchall()


def upload_plan(root, conn, fixture_id, *, offset=0, limit=200, order="oldest", asset_ids=()):
    from fixture_policy import effective_fixture_policy
    from fixture_policy import policy_allows_cloud, policy_allows_catalog
    from native_catalog_promotion import retired_storefront_media_types
    fixture = conn.execute("SELECT name FROM fixtures WHERE fixture_id=? AND archived_at IS NULL", (fixture_id,)).fetchone()
    if not fixture:
        raise ValueError("Fixture does not exist or is archived.")
    policy=effective_fixture_policy(root,fixture_id,conn=conn)["effective"]
    cloud = policy_allows_cloud(policy)
    rows = eligible_rows(conn, fixture_id)
    retired = retired_storefront_media_types(root)
    approved = [r for r in rows if r['editorial_state']=='approved']
    uploadable = [r for r in approved if r['delivery_state'] in ('needs-upload','failed')
                  and r['media_type'] not in retired and approved_edition(conn,fixture_id,r['asset_id'])
                  and conn.execute('SELECT 1 FROM asset_source_versions WHERE version_id=? AND asset_id=? AND source_exists=1', (r['source_version_id'],r['asset_id'])).fetchone()]
    uploadable = uploadable if cloud else []
    if asset_ids:
        selected = set(asset_ids)
        uploadable = [row for row in uploadable if row['asset_id'] in selected]
    if order == 'recent': uploadable.reverse()
    offset,limit = max(0,int(offset)), max(1,min(500,int(limit)))
    counts = dict(mediaUploadedCount=0,projectionPendingCount=0,projectionFailedCount=0,
                  deploymentPendingCount=0,deploymentFailedCount=0,liveOnWebsiteCount=0)
    for row in approved:
        if row['delivery_state']!='live': continue
        counts['mediaUploadedCount'] += 1
        if not policy_allows_catalog(policy): continue
        catalog = conn.execute('SELECT * FROM public_catalog_publications WHERE asset_id=? AND source_version_hash=?', (row['asset_id'],row['receipt_version_hash'])).fetchone()
        state = catalog['state'] if catalog else 'pending'
        key = {'pending':'projectionPendingCount','local':'deploymentPendingCount'}.get(state)
        if state=='failed': key='deploymentFailedCount' if catalog['catalog_sha256'] else 'projectionFailedCount'
        if key: counts[key]+=1
    items=[]
    for row in uploadable[offset:offset+limit]:
        raw=json.loads(row['raw_json'] or '{}')
        items.append(dict(assetId=row['asset_id'],photoLibraryIdentifier=raw.get('localIdentifier') or row['asset_id'],
            title=row['title'],keywords=json.loads(row['keywords_json']),filename=row['filename'],
            capturedAt=row['captured_at'] or '',deliveryState=row['delivery_state'],errorText=row['last_error'],
            sourceVersionId=row['source_version_id'],revisionHash=row['approved_revision_hash']))
    from public_access_verification import current_counts
    public_access = current_counts(conn, fixture_id)
    counts['liveOnWebsiteCount'] = public_access['liveOnWebsiteCount'] if policy_allows_catalog(policy) else 0
    return dict(ok=True,readOnly=True,fixtureId=fixture_id,fixtureName=fixture['name'],cloudAllowed=cloud,
        pickedCount=len(rows),approvedCount=len(approved),needsReviewCount=len(rows)-len(approved),
        needsUploadCount=len(uploadable),liveCount=counts['liveOnWebsiteCount'],**counts,
        publicAccessExpiresAt=public_access['publicAccessExpiresAt'],
        catalogDeployedCount=public_access['catalogDeployedCount'],
        offset=offset,limit=limit,order=order,count=len(items),hasNext=offset+len(items)<len(uploadable),items=items)


def create_run(root, conn, fixture_id, asset_ids, limit, concurrency):
    # Re-read under a writer lock, then pin an immutable approved revision.
    conn.execute('BEGIN IMMEDIATE')
    plan=upload_plan(root,conn,fixture_id,limit=500,asset_ids=asset_ids)
    requested=set(asset_ids)
    rows=[r for r in plan['items'] if not requested or r['assetId'] in requested][:limit]
    now,run_id=timestamp(),'uplrun-'+uuid.uuid4().hex[:16]
    conn.execute('''INSERT INTO asset_upload_runs
        (run_id,fixture_id,status,requested_count,remaining_count,concurrency,completed_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?)''',(run_id,fixture_id,'queued' if rows else 'completed',len(rows),len(rows),concurrency,None if rows else now,now,now))
    conn.executemany('''INSERT INTO asset_upload_run_items
        (run_id,asset_id,source_version_hash,status,updated_at) VALUES (?,?,?,'queued',?)''',
        [(run_id,r['assetId'],r['revisionHash'],now) for r in rows])
    conn.commit()
    return dict(ok=True,runId=run_id,fixtureId=fixture_id,status='queued' if rows else 'completed',count=len(rows),assetIds=[r['assetId'] for r in rows],limit=limit,concurrency=concurrency)


def validate_upload(conn, fixture_id, asset_id, revision):
    edition=approved_edition(conn,fixture_id,asset_id)
    if not edition or edition['revision_hash']!=revision:
        raise ValueError('This fixture edition changed or approval was withdrawn. Approve it again before uploading.')
    require_source(conn,asset_id,edition['source_version_id'])
    placement=conn.execute("SELECT 1 FROM fixture_asset_decisions WHERE fixture_id=? AND asset_id=? AND placement_state='picked' AND eligibility_state='active'",(fixture_id,asset_id)).fetchone()
    if not placement: raise ValueError('This photo is no longer picked in the upload fixture.')
    return edition


def object_keys(row, fixture_id, revision, policy):
    from sidecar_state_db import _planned_r2_keys, photo_id_for_source_path
    from fixture_policy import policy_allows_r2_result
    # Stable per fixture+revision. Retry reuses these bytes; another fixture can
    # neither overwrite nor retire them, even for the same immutable original.
    token=hashlib.sha256((fixture_id+':'+revision).encode()).hexdigest()[:24]
    media_id=photo_id_for_source_path(row['source_anchor'] or 'apple-photos://'+row['asset_id'])+'-e'+token
    _,keys=_planned_r2_keys(row,media_id=media_id)
    return [k for k in keys if policy_allows_r2_result(policy,k)]


def execute_run(root: Path, run_id: str):
    from fixture_pipeline import connect
    from fixture_policy import effective_fixture_policy
    from native_publication_pipeline import run_upload_batch
    from native_catalog_promotion import refresh_public_catalog_artifacts
    from sidecar_state_db import _run_backstage_photos_materialize_one, _upload_bridge_execute_r2
    with connect(root) as conn:
        run=conn.execute('SELECT * FROM asset_upload_runs WHERE run_id=?',(run_id,)).fetchone()
        fixture_id=run['fixture_id']
        revisions={r['asset_id']:r['source_version_hash'] for r in conn.execute('SELECT * FROM asset_upload_run_items WHERE run_id=?',(run_id,))}
    def upload(asset_id):
        with connect(root) as conn:
            edition=validate_upload(conn,fixture_id,asset_id,revisions[asset_id])
            row=dict(conn.execute('SELECT * FROM sidecar_assets WHERE asset_id=?',(asset_id,)).fetchone())
            policy=effective_fixture_policy(root,fixture_id,conn=conn)['effective']
            keys=object_keys(row,fixture_id,revisions[asset_id],policy)
        if not keys: raise ValueError('Fixture policy no longer permits uploading.')
        with connect(root) as conn:
            receipts = recovery_receipts(root,conn,fixture_id,asset_id,revisions[asset_id])
        if receipts:
            from r2_receipt_verification import verify_receipts
            return verify_receipts(receipts)
        spool=root/'assets/owner-actions/fixture-edition-uploads'/run_id/hashlib.sha256(asset_id.encode()).hexdigest()[:20]
        spool.mkdir(parents=True,exist_ok=True)
        exported=_run_backstage_photos_materialize_one(root,asset_id=asset_id,destination=spool/uuid.uuid4().hex,
            allow_icloud_downloads=True,source_version_id=edition['source_version_id'])
        item=(exported.get('items') or [{}])[0]
        path=Path(item.get('path') or '')
        if not exported.get('materializedCount') or not path.is_file():
            raise ValueError(item.get('error') or item.get('reason') or 'The approved image could not be exported.')
        with connect(root) as conn: validate_upload(conn,fixture_id,asset_id,revisions[asset_id])
        return _upload_bridge_execute_r2(planned_keys=keys,export_path=path,media_type=row['media_type'],artifact_root=spool/'renders',reconcile_existing=True)
    completed=run_upload_batch(root,run_id,upload)
    if any(r.get('catalog_state')=='local' for r in completed.get('items',[])):
        completed['publicCatalogArtifacts']=refresh_public_catalog_artifacts(root)
    with connect(root) as conn:
        expo = is_expo_fixture(conn,fixture_id)
    if expo:
        from apple_photos_metadata_writer import commit_writeback, BackstagePhotosMetadataAdapter
        written=[r['asset_id'] for r in completed.get('items',[]) if r['status'] in ('verified','live')]
        if written:
            completed['photosGiveBack']=commit_writeback(root,fixture_id,written,adapter=BackstagePhotosMetadataAdapter(root))
    # Other fixture metadata intentionally remains local; a single Photos asset cannot
    # represent several independent fixture editions.
    return completed


def catalog_recovery_rows(root, conn, fixture_id):
    from fixture_policy import effective_fixture_policy, policy_allows_catalog
    policy = effective_fixture_policy(root, fixture_id, conn=conn)['effective']
    if not policy_allows_catalog(policy):
        return []
    rows = []
    for row in eligible_rows(conn, fixture_id):
        if row['editorial_state'] != 'approved' or row['delivery_state'] != 'live':
            continue
        catalog = conn.execute('SELECT * FROM public_catalog_publications WHERE asset_id=? AND source_version_hash=?',
                               (row['asset_id'], row['receipt_version_hash'])).fetchone()
        if catalog and not (catalog['state'] == 'pending' or (catalog['state'] == 'failed' and catalog['error_text'].startswith('deployed catalog does not contain media id '))):
            continue
        rows.append(dict(row, fixture_id=fixture_id, source_version_hash=row['approved_revision_hash'],
                         catalog_state=catalog['state'] if catalog else 'missing'))
    return rows


def _verified_receipts_for_version(conn, fixture_id, asset_id, version_hash, planned_keys, *, verification_method):
    if not planned_keys:
        return []
    results = []
    for key in planned_keys:
        receipt = conn.execute("""SELECT r.checksum_sha256,r.verification_json,o.bytes
            FROM fixture_delivery_receipts r JOIN r2_objects o
            ON o.object_key=r.object_key AND o.bucket=? AND o.lifecycle_state='current' AND o.photo_id=r.asset_id
            WHERE r.fixture_id=? AND r.asset_id=? AND r.version_hash=?
              AND r.destination='r2' AND r.status='verified' AND r.object_key=?""",
            (key['bucket'], fixture_id, asset_id, version_hash, key['key'])).fetchone()
        if not receipt:
            return []
        proof = json.loads(receipt['verification_json'] or '{}')
        checksum = receipt['checksum_sha256']
        if not checksum or proof.get('bucket') != key['bucket'] or not proof.get('remoteVerified') or proof.get('remoteChecksumSha256') != checksum:
            return []
        results.append(dict(key, status='uploaded', objectKind=key['kind'], checksumSha256=checksum,
                            remoteChecksumSha256=checksum, remoteVerified=True, bytes=receipt['bytes'],
                            verificationMethod=verification_method))
    return results


def reusable_expo_same_source_receipts(conn, fixture_id, asset_id, revision, policy):
    """Reuse verified current Expo R2 objects for the exact same source version.

    Preserves cloud D1 1-to-1 canonical_asset_id identity and avoids duplicate
    uploads or SQLite rows when Expo metadata/approvals advance on unchanged
    image pixels. Non-Expo fixtures never share Expo object keys.
    """
    from sidecar_state_db import _planned_r2_keys
    from fixture_policy import policy_allows_r2_result
    if not is_expo_fixture(conn, fixture_id):
        return None
    edition = validate_upload(conn, fixture_id, asset_id, revision)
    source_version_id = str(edition.get('source_version_id') or '')
    if not source_version_id:
        return None
    has_pub_items = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='public_publication_items'").fetchone() is not None
    asset_row = conn.execute('SELECT * FROM sidecar_assets WHERE asset_id=?', (asset_id,)).fetchone()
    if asset_row is None:
        return None
    asset = dict(asset_row)
    if has_pub_items:
        already_registered = conn.execute("""SELECT i.registration_json FROM public_publication_items i
            JOIN public_publication_runs r ON r.run_id=i.run_id
            WHERE r.fixture_id=? AND i.asset_id=? AND i.source_version_hash=? AND i.registration_json<>''
            ORDER BY i.updated_at DESC LIMIT 1""", (fixture_id, asset_id, revision)).fetchone()
        if already_registered:
            # Keep this revision's own edition keys when D1 registered that exact
            # edition media_id; when another run registered a reused same-source
            # pre-edition/prior-edition media_id, continue below so overlapping runs
            # reuse those exact registered receipts instead of re-exporting.
            reg_data = json.loads(already_registered['registration_json'] or '{}')
            reg_items = reg_data.get('items') if isinstance(reg_data, dict) else []
            reg_mid = str((reg_items[0] or {}).get('canonicalMediaId') or '') if reg_items else ''
            expected_ed_mid = ''
            try:
                ed_keys = object_keys(asset, fixture_id, revision, policy)
                pub_key = next((k['key'] for k in ed_keys if k['key'].startswith('expo/') and k['key'].endswith('_900.jpg')), '')
                if pub_key:
                    expected_ed_mid = pub_key[len('expo/'):-len('_900.jpg')]
            except ValueError:
                pass
            if not reg_mid or reg_mid == expected_ed_mid:
                return None
    # Priority 1: a prior Expo edition with the exact same source_version_id
    # that already holds a registered cloud D1 identity.
    if has_pub_items:
        prior_registered = conn.execute("""SELECT DISTINCT i.source_version_hash AS rev
            FROM public_publication_items i
            JOIN public_publication_runs r ON r.run_id=i.run_id
            JOIN fixture_edition_versions v
              ON v.fixture_id=r.fixture_id AND v.asset_id=i.asset_id AND v.revision_hash=i.source_version_hash
            WHERE r.fixture_id=? AND i.asset_id=? AND v.source_version_id=?
              AND i.source_version_hash<>? AND i.registration_json<>''
            ORDER BY i.updated_at DESC""", (fixture_id, asset_id, source_version_id, revision)).fetchall()
        for candidate in prior_registered:
            prior_rev = str(candidate['rev'] or '')
            if not prior_rev:
                continue
            try:
                planned = object_keys(asset, fixture_id, prior_rev, policy)
            except ValueError:
                continue
            receipts = _verified_receipts_for_version(
                conn, fixture_id, asset_id, prior_rev, planned,
                verification_method='existing-expo-edition-receipt',
            )
            if receipts:
                return {'receiptVersionHash': prior_rev, 'receipts': receipts}
    # Priority 2: verified pre-edition Expo R2 objects for the exact same source_version_id.
    candidate_media_ids = [
        str(row['media_id'])
        for row in conn.execute("""SELECT DISTINCT media_id FROM public_catalog_publications
            WHERE asset_id=? AND source_version_hash=? AND media_id<>''
            ORDER BY updated_at DESC, media_id""", (asset_id, source_version_id)).fetchall()
    ]
    for row in conn.execute("""SELECT object_key FROM fixture_delivery_receipts
        WHERE fixture_id=? AND asset_id=? AND version_hash=? AND destination='r2' AND status='verified'
          AND object_key LIKE 'expo/%_900.jpg'
        ORDER BY updated_at DESC, object_key""", (fixture_id, asset_id, source_version_id)).fetchall():
        key = str(row['object_key'] or '')
        if key.startswith('expo/') and key.endswith('_900.jpg'):
            mid = key[len('expo/'):-len('_900.jpg')]
            if mid and mid not in candidate_media_ids:
                candidate_media_ids.append(mid)
    for legacy_media_id in candidate_media_ids:
        try:
            _, raw_keys = _planned_r2_keys(asset, media_id=legacy_media_id)
        except ValueError:
            continue
        planned = [k for k in raw_keys if policy_allows_r2_result(policy, k)]
        receipts = _verified_receipts_for_version(
            conn, fixture_id, asset_id, source_version_id, planned,
            verification_method='existing-expo-preedition-receipt',
        )
        if receipts:
            return {'receiptVersionHash': source_version_id, 'mediaId': legacy_media_id, 'receipts': receipts}
    return None


def recovery_receipts(root, conn, fixture_id, asset_id, revision):
    """Recover only this edition's exact current, checksum-verified object set."""
    from fixture_policy import effective_fixture_policy
    validate_upload(conn, fixture_id, asset_id, revision)
    policy = effective_fixture_policy(root, fixture_id, conn=conn)['effective']
    reusable = reusable_expo_same_source_receipts(conn, fixture_id, asset_id, revision, policy)
    if reusable:
        return reusable['receipts']
    delivery = conn.execute('SELECT * FROM fixture_edition_delivery WHERE fixture_id=? AND asset_id=? AND revision_hash=?',
                            (fixture_id, asset_id, revision)).fetchone()
    if not delivery:
        return []
    receipt_version = delivery['receipt_version_hash'] or revision
    # Legacy objects have shared names. Keep their evidence intact; recovery
    # requires an explicit new scoped upload rather than reassigning those keys.
    if receipt_version != revision:
        return []
    asset = dict(conn.execute('SELECT * FROM sidecar_assets WHERE asset_id=?', (asset_id,)).fetchone())
    return _verified_receipts_for_version(
        conn, fixture_id, asset_id, revision, object_keys(asset, fixture_id, revision, policy),
        verification_method='existing-fixture-edition-receipt',
    )
