"""Bounded, explicit public-access observations; never upload or register media.

The cloud knows canonical IDs and object ownership, not local source versions.
Bind its five-minute observation to current Owner inputs and verified preview
bytes here. A changed input, failed retry or expired observation fails closed.
Legacy upload/catalog receipts remain untouched and are not backfilled as Live.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from urllib.request import Request, urlopen

CATALOG_URL = "https://photos-by-elie.com/assets/catalog/photosbyelie.sqlite"
PREVIEW_BASE = "https://download.photos-by-elie.com/media/"
SCHEMA = "photosbyelie.publicPreviewObservation.v1"
MAX_BATCH = 20
MAX_PREVIEW_BYTES = 12 * 1024 * 1024


def ensure_schema(conn):
    # This is also called inside the edition migration transaction. Never use
    # executescript (including another schema helper): it implicitly commits.
    columns = {row['name'] for row in conn.execute('PRAGMA table_info(fixtures)')}
    for name, declaration in {
        'policy_overrides_json': "TEXT NOT NULL DEFAULT '{}'",
        'policy_revision': 'INTEGER NOT NULL DEFAULT 0',
    }.items():
        if name not in columns:
            conn.execute(f'ALTER TABLE fixtures ADD COLUMN {name} {declaration}')
    conn.execute("""CREATE TABLE IF NOT EXISTS public_access_observations (
        fixture_id TEXT NOT NULL, asset_id TEXT NOT NULL, input_json TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('allowed','pending','blocked','failed')),
        reason TEXT NOT NULL, checked_at TEXT NOT NULL, expires_at TEXT NOT NULL,
        observation_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY(fixture_id,asset_id))""")
    scoped = conn.execute("SELECT 1 FROM sqlite_master WHERE name='fixture_asset_editions'").fetchone()
    if scoped:
        editorial_join = """JOIN fixture_asset_editions e ON e.asset_id=p.asset_id AND e.fixture_id=p.fixture_id
            JOIN fixture_edition_delivery d ON d.asset_id=e.asset_id AND d.fixture_id=e.fixture_id
              AND d.revision_hash=e.approved_revision_hash
            JOIN asset_source_versions s ON s.version_id=e.source_version_id AND s.asset_id=p.asset_id"""
        revision = "e.approved_revision_hash"
        receipt_version = "COALESCE(NULLIF(d.receipt_version_hash,''),e.approved_revision_hash)"
        editorial_json = "json_array(e.title,e.keywords_json,e.country,e.source_version_id,e.approved_revision_hash,e.updated_at)"
    else:
        editorial_join = """JOIN asset_editorial_state e ON e.asset_id=p.asset_id
            JOIN asset_delivery_state d ON d.asset_id=p.asset_id
            JOIN asset_source_versions s ON s.version_id=d.source_version_hash AND s.asset_id=p.asset_id"""
        revision = "d.source_version_hash"
        receipt_version = "d.source_version_hash"
        editorial_json = "json_array(e.updated_at,d.updated_at)"
    # A single shared view supplies both Python counts and Swift customer links.
    # Snapshot equality invalidates evidence after any relevant supported edit,
    # policy/ancestor change, catalog deployment or upload-receipt replacement.
    conn.execute("DROP VIEW IF EXISTS public_access_current")
    conn.execute("DROP VIEW IF EXISTS public_access_inputs")
    conn.execute(f"""CREATE VIEW public_access_inputs AS
        SELECT p.fixture_id,p.asset_id,p.source_version_hash,c.media_id,
          {revision} AS approval_revision_hash,s.version_id AS source_version_id,
          c.public_url,c.catalog_sha256,c.verified_at,
          json_object('fixture',p.fixture_id,'asset',p.asset_id,'version',p.source_version_hash,
            'media',c.media_id,'catalog',json_array(c.public_url,c.catalog_sha256,c.verified_at),
            'editorial',{editorial_json},
            'source',json_array(s.version_id,s.metadata_fingerprint,s.rendered_fingerprint,s.source_exists),
            'policy',(WITH RECURSIVE lineage AS (
                SELECT fixture_id,parent_fixture_id,name,tags_json,template_key,policy_overrides_json,policy_revision,archived_at
                FROM fixtures WHERE fixture_id=p.fixture_id
                UNION
                SELECT f.fixture_id,f.parent_fixture_id,f.name,f.tags_json,f.template_key,f.policy_overrides_json,f.policy_revision,f.archived_at
                FROM fixtures f JOIN lineage l ON f.fixture_id=l.parent_fixture_id
              ) SELECT json_group_array(json_array(fixture_id,parent_fixture_id,name,tags_json,template_key,policy_overrides_json,policy_revision,archived_at))
                FROM (SELECT * FROM lineage ORDER BY fixture_id)),
            'previews',(SELECT json_group_array(json_object('key',object_key,'sha256',checksum_sha256,
                  'status',status,'proof',verification_json,'receipt',receipt_id,'updated',receipt_updated,
                  'objectState',lifecycle_state,'objectAsset',photo_id,'bytes',bytes,'objectUpdated',object_updated))
              FROM (SELECT r.*,r.updated_at AS receipt_updated,o.lifecycle_state,o.photo_id,o.bytes,o.updated_at AS object_updated
                FROM fixture_delivery_receipts r LEFT JOIN r2_objects o ON o.bucket='photosbyelie-public' AND o.object_key=r.object_key
                WHERE r.fixture_id=p.fixture_id AND r.asset_id=p.asset_id AND r.version_hash=p.source_version_hash
                  AND r.destination='r2' AND r.visibility_policy='public'
                  AND r.object_key IN ('expo/'||c.media_id||'_900.jpg','expo/'||c.media_id||'_1800.jpg')
                ORDER BY r.object_key))) AS input_json
        FROM asset_publications p
        JOIN fixtures f ON f.fixture_id=p.fixture_id AND f.archived_at IS NULL
        JOIN fixture_asset_decisions pick ON pick.fixture_id=p.fixture_id AND pick.asset_id=p.asset_id
          AND pick.placement_state='picked' AND pick.eligibility_state='active'
        JOIN sidecar_assets a ON a.asset_id=p.asset_id AND COALESCE(a.missing_at,'')=''
        JOIN public_catalog_publications c ON c.asset_id=p.asset_id AND c.source_version_hash=p.source_version_hash
        {editorial_join}
        WHERE p.state='live' AND p.withdrawn_at IS NULL AND e.editorial_state='approved'
          AND d.delivery_state='live' AND p.source_version_hash={receipt_version} AND s.source_exists=1
          AND c.state='live' AND length(c.catalog_sha256)=64 AND c.verified_at IS NOT NULL
          AND c.public_url='{CATALOG_URL}'
          AND NOT EXISTS (SELECT 1 FROM sidecar_tombstones t WHERE t.asset_id=p.asset_id AND t.tombstone_state='active')
          AND NOT EXISTS (SELECT 1 FROM media_lifecycle l WHERE l.media_id IN (p.asset_id,c.media_id) AND l.lifecycle_state<>'active')
    """)
    conn.execute("""CREATE VIEW public_access_current AS
        SELECT i.*,o.checked_at,o.expires_at FROM public_access_inputs i
        JOIN public_access_observations o ON o.fixture_id=i.fixture_id AND o.asset_id=i.asset_id AND o.input_json=i.input_json
        WHERE o.state='allowed' AND julianday(o.checked_at)<=julianday('now')
          AND julianday(o.expires_at)>julianday('now')
          AND julianday(o.expires_at)-julianday(o.checked_at) BETWEEN 0 AND (300.01/86400.0)
    """)


def current_counts(conn, fixture_id):
    row = conn.execute("SELECT COUNT(*) AS count,MIN(expires_at) AS expires FROM public_access_current WHERE fixture_id=?", (fixture_id,)).fetchone()
    deployed = conn.execute('SELECT COUNT(*) FROM public_access_inputs WHERE fixture_id=?',(fixture_id,)).fetchone()[0]
    return dict(liveOnWebsiteCount=row['count'], liveCount=row['count'], publicAccessExpiresAt=row['expires'] or '', catalogDeployedCount=deployed)


def _time(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def _now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def _expected(row):
    value = json.loads(row['input_json'])
    previews = json.loads(value['previews']) if isinstance(value['previews'], str) else value['previews']
    if len(previews) != 2 or not re.fullmatch(r'[a-f0-9]{64}', row['catalog_sha256']):
        raise ValueError('Exact public preview receipts are missing; retain uploads and reconcile their receipts.')
    for preview in previews:
        proof = json.loads(preview['proof'])
        if (preview['status'] != 'verified' or preview['objectState'] != 'current'
            or preview['objectAsset'] != row['asset_id'] or not 0 < (preview['bytes'] or 0) <= MAX_PREVIEW_BYTES
            or not re.fullmatch(r'[a-f0-9]{64}', preview['sha256'] or '')
            or proof.get('bucket') != 'photosbyelie-public' or proof.get('remoteVerified') is not True
            or proof.get('remoteChecksumSha256') != preview['sha256']):
            raise ValueError('Current source-bound public preview receipts are incomplete; no re-upload was started.')
    expected = {'canonicalAssetId': row['asset_id'], 'canonicalMediaId': row['media_id'],
                'bindings': [{'bucket': 'public', 'objectKey': p['key']} for p in previews]}
    if {p['key'] for p in previews} != {f"expo/{row['media_id']}_{size}.jpg" for size in (900, 1800)}:
        raise ValueError('Preview identities do not match the catalog.')
    return expected, previews


def fetch_preview(key):
    if not re.fullmatch(r'expo/[a-zA-Z0-9._-]+_(900|1800)\.jpg', key):
        raise ValueError('Unsupported public preview key.')
    request = Request(PREVIEW_BASE + key, headers={'Cache-Control': 'no-cache'})
    with urlopen(request, timeout=12) as response:
        if response.status != 200 or response.url != PREVIEW_BASE + key or response.headers.get_content_type() != 'image/jpeg':
            raise ValueError('Public preview is not an accessible JPEG at its exact URL.')
        body = response.read(MAX_PREVIEW_BYTES + 1)
    if len(body) > MAX_PREVIEW_BYTES:
        raise ValueError('Public preview exceeds the verification limit.')
    return body


def fetch_catalog():
    with urlopen(Request(CATALOG_URL, headers={'Cache-Control': 'no-cache'}), timeout=20) as response:
        if response.status != 200 or response.url != CATALOG_URL:
            raise ValueError('The exact public catalog URL is unavailable.')
        body = response.read(16 * 1024 * 1024 + 1)
    if len(body) > 16 * 1024 * 1024:
        raise ValueError('Public catalog exceeds the verification limit.')
    return body


def cloud_observer(root):
    from new_owner_connector import DEFAULT_CONFIG_PATH, WorkerClient, load_config
    config = load_config(DEFAULT_CONFIG_PATH)
    if config.repo_root.resolve() != root.resolve() or config.worker_base not in {
        'https://auth.photos-by-elie.com','https://download.photos-by-elie.com',
        'https://photosbyelie-checkout-mock.ec92009.workers.dev',
    }:
        raise ValueError('The existing connector identity does not match this Owner workspace.')
    client = WorkerClient(config)
    return lambda items: client.request('POST', '/api/v1/lifecycle/public-previews/verify', {'items': items})


def validate_observation(response, expected, started):
    if (response.get('schema') != SCHEMA or response.get('readOnly') is not True
        or len(response.get('items', [])) != 1):
        raise ValueError('Cloud verification returned an unsupported observation.')
    remote = response['items'][0]
    if any(remote.get(k) != v for k, v in expected.items()):
        raise ValueError('Cloud observation does not match the exact requested photo and previews.')
    checked, expiry = _time(response['checkedAt']), _time(response['expiresAt'])
    if not _time(started)-5 <= checked <= _time(_now()) or not checked < expiry <= checked+300 or expiry <= _time(_now()):
        raise ValueError('Cloud observation is stale or has an invalid expiry.')
    return remote


def verify_public_access(root: Path, fixture_id: str, *, limit=20, observer=None, fetch=fetch_preview, catalog_fetch=fetch_catalog):
    """One explicit bounded batch. Local observation writes only; no scheduler."""
    from fixture_pipeline import connect
    from fixture_policy import effective_fixture_policy, policy_allows_catalog
    if not fixture_id or not 1 <= int(limit) <= MAX_BATCH:
        raise ValueError('Choose one fixture and a verification batch of 1 to 20 photos.')
    with connect(root) as conn:
        ensure_schema(conn)
        if not policy_allows_catalog(effective_fixture_policy(root, fixture_id, conn=conn)['effective']):
            raise ValueError('This fixture does not permit public catalog access.')
        rows = [dict(row) for row in conn.execute("""SELECT i.* FROM public_access_inputs i
            LEFT JOIN public_access_observations o ON o.fixture_id=i.fixture_id AND o.asset_id=i.asset_id
            WHERE i.fixture_id=? ORDER BY COALESCE(o.checked_at,''),i.asset_id LIMIT ?""", (fixture_id, int(limit)))]
        conn.commit()
    results = []
    batch_started = _time(_now())
    catalog_sha = None
    catalog_error = ''
    if rows:
        try:
            catalog_sha = hashlib.sha256(catalog_fetch()).hexdigest()
        except Exception as error:
            catalog_error = str(error)[:240]
    for row in rows:
        if _time(_now()) - batch_started > 120:
            break  # Explicit retry continues oldest observations; never drain.
        started = _now()
        state, reason, expires, response = 'failed', '', started, {}
        try:
            if catalog_error or catalog_sha != row['catalog_sha256']:
                raise ValueError(catalog_error or 'Public catalog changed; deploy/verify its current receipt before checking access.')
            expected, previews = _expected(row)
            observer = observer or cloud_observer(root)
            response = observer([expected])
            remote = validate_observation(response, expected, started)
            if remote.get('allowed') is True:
                first = remote
                for preview in previews:
                    body = fetch(preview['key'])
                    if len(body) != preview['bytes'] or hashlib.sha256(body).hexdigest() != preview['sha256']:
                        raise ValueError('Public preview bytes do not match the approved upload receipt.')
                # Recheck after the bytes: a concurrent revoke must not become Live.
                response = observer([expected])
                remote = validate_observation(response, expected, started)
                if remote.get('allowed') is True and any(first.get(k) != remote.get(k) for k in ('revision','receiptId')):
                    raise ValueError('Lifecycle changed while preview bytes were verified; retry safely.')
            reason = str(remote.get('reason') or 'unverified')
            if remote.get('allowed') is True and reason == 'allowed' and type(remote.get('revision')) is int:
                state, expires = 'allowed', response['expiresAt']
            elif reason in {'identity-missing','binding-missing','projection-missing'}:
                state = 'pending'
            else:
                state = 'blocked'
        except Exception as error:
            reason = str(error)[:240]
        with connect(root) as conn:
            conn.execute('BEGIN IMMEDIATE')
            current = conn.execute("SELECT input_json FROM public_access_inputs WHERE fixture_id=? AND asset_id=? AND source_version_hash=?", (fixture_id,row['asset_id'],row['source_version_hash'])).fetchone()
            if not current or current['input_json'] != row['input_json']:
                state, reason, expires = 'pending', 'Local approval, catalog or upload evidence changed during verification.', started
            conn.execute("""INSERT INTO public_access_observations
                (fixture_id,asset_id,input_json,state,reason,checked_at,expires_at,observation_json)
                VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(fixture_id,asset_id) DO UPDATE SET
                  input_json=excluded.input_json,state=excluded.state,reason=excluded.reason,
                  checked_at=excluded.checked_at,expires_at=excluded.expires_at,observation_json=excluded.observation_json""",
                (fixture_id,row['asset_id'],row['input_json'],state,reason,response.get('checkedAt',started),expires,json.dumps(response,sort_keys=True)))
            conn.commit()
        results.append(dict(assetId=row['asset_id'],mediaId=row['media_id'],state=state,reason=reason))
    return dict(ok=True,fixtureId=fixture_id,checked=len(results),allowed=sum(r['state']=='allowed' for r in results),
                pending=sum(r['state']=='pending' for r in results),blocked=sum(r['state']=='blocked' for r in results),
                failed=sum(r['state']=='failed' for r in results),items=results,cloudReadOnly=True)
