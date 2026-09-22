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
        key = {'pending':'projectionPendingCount','local':'deploymentPendingCount','live':'liveOnWebsiteCount'}.get(state)
        if state=='failed': key='deploymentFailedCount' if catalog['catalog_sha256'] else 'projectionFailedCount'
        if key: counts[key]+=1
    items=[]
    for row in uploadable[offset:offset+limit]:
        raw=json.loads(row['raw_json'] or '{}')
        items.append(dict(assetId=row['asset_id'],photoLibraryIdentifier=raw.get('localIdentifier') or row['asset_id'],
            title=row['title'],keywords=json.loads(row['keywords_json']),filename=row['filename'],
            capturedAt=row['captured_at'] or '',deliveryState=row['delivery_state'],errorText=row['last_error'],
            sourceVersionId=row['source_version_id'],revisionHash=row['approved_revision_hash']))
    return dict(ok=True,readOnly=True,fixtureId=fixture_id,fixtureName=fixture['name'],cloudAllowed=cloud,
        pickedCount=len(rows),approvedCount=len(approved),needsReviewCount=len(rows)-len(approved),
        needsUploadCount=len(uploadable),liveCount=counts['liveOnWebsiteCount'],**counts,
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
        spool=root/'assets/owner-actions/fixture-edition-uploads'/run_id/hashlib.sha256(asset_id.encode()).hexdigest()[:20]
        spool.mkdir(parents=True,exist_ok=True)
        exported=_run_backstage_photos_materialize_one(root,asset_id=asset_id,destination=spool/uuid.uuid4().hex,
            allow_icloud_downloads=True,source_version_id=edition['source_version_id'])
        item=(exported.get('items') or [{}])[0]
        path=Path(item.get('path') or '')
        if not exported.get('materializedCount') or not path.is_file():
            raise ValueError(item.get('error') or item.get('reason') or 'The approved image could not be exported.')
        with connect(root) as conn: validate_upload(conn,fixture_id,asset_id,revisions[asset_id])
        return _upload_bridge_execute_r2(planned_keys=keys,export_path=path,media_type=row['media_type'],artifact_root=spool/'renders')
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


def recovery_receipts(root, conn, fixture_id, asset_id, revision):
    """Recover only this edition's exact current, checksum-verified object set."""
    from fixture_policy import effective_fixture_policy
    validate_upload(conn, fixture_id, asset_id, revision)
    delivery = conn.execute('SELECT * FROM fixture_edition_delivery WHERE fixture_id=? AND asset_id=? AND revision_hash=?',
                            (fixture_id, asset_id, revision)).fetchone()
    receipt_version = delivery['receipt_version_hash'] or revision
    # Legacy objects have shared names. Keep their evidence intact; recovery
    # requires an explicit new scoped upload rather than reassigning those keys.
    if receipt_version != revision:
        return []
    asset = dict(conn.execute('SELECT * FROM sidecar_assets WHERE asset_id=?', (asset_id,)).fetchone())
    policy = effective_fixture_policy(root, fixture_id, conn=conn)['effective']
    results = []
    for key in object_keys(asset, fixture_id, revision, policy):
        receipt = conn.execute("""SELECT r.checksum_sha256,r.verification_json,o.bytes
            FROM fixture_delivery_receipts r JOIN r2_objects o
            ON o.object_key=r.object_key AND o.bucket=? AND o.lifecycle_state='current'
            WHERE r.fixture_id=? AND r.asset_id=? AND r.version_hash=?
              AND r.destination='r2' AND r.status='verified' AND r.object_key=?""",
            (key['bucket'], fixture_id, asset_id, revision, key['key'])).fetchone()
        if not receipt:
            return []
        proof = json.loads(receipt['verification_json'])
        checksum = receipt['checksum_sha256']
        if not checksum or proof.get('bucket') != key['bucket'] or not proof.get('remoteVerified') or proof.get('remoteChecksumSha256') != checksum:
            return []
        results.append(dict(key, status='uploaded', objectKind=key['kind'], checksumSha256=checksum,
                            remoteChecksumSha256=checksum, remoteVerified=True, bytes=receipt['bytes'],
                            verificationMethod='existing-fixture-edition-receipt'))
    return results
