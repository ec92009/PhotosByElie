"""Durable, run-scoped continuation receipts. Never backfill historical uploads."""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone


def now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def ensure_schema(conn):
    """Safe within an existing transaction; no executescript or implicit commit."""
    conn.execute("""CREATE TABLE IF NOT EXISTS public_publication_runs (
        run_id TEXT PRIMARY KEY, fixture_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running','failed','cancelled','completed')),
        phase TEXT NOT NULL, worker_pid INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '', catalog_receipt_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS public_publication_items (
        run_id TEXT NOT NULL, asset_id TEXT NOT NULL, source_version_hash TEXT NOT NULL,
        input_json TEXT NOT NULL DEFAULT '', envelope_json TEXT NOT NULL DEFAULT '',
        registration_json TEXT NOT NULL DEFAULT '', verification_json TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL, PRIMARY KEY(run_id,asset_id))""")


def get(conn, run_id):
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name='public_publication_runs'").fetchone():
        return None
    row = conn.execute('SELECT * FROM public_publication_runs WHERE run_id=?', (run_id,)).fetchone()
    return dict(row) if row else None


def begin(conn, root, run_id):
    """Opt in only the exact explicitly started public, edition-pinned run."""
    from fixture_editions import enabled
    from fixture_policy import effective_fixture_policy, policy_allows_catalog
    if get(conn, run_id) or run_id.startswith('catrec-') or not enabled(conn):
        return
    run = conn.execute('SELECT * FROM asset_upload_runs WHERE run_id=?', (run_id,)).fetchone()
    if not run or not run['fixture_id'] or not run['requested_count']:
        return
    policy = effective_fixture_policy(root, run['fixture_id'], conn=conn)['effective']
    if not policy_allows_catalog(policy):
        return
    items = conn.execute('SELECT * FROM asset_upload_run_items WHERE run_id=?', (run_id,)).fetchall()
    if not 1 <= len(items) <= 50 or any(not item['source_version_hash'] for item in items):
        raise ValueError('Public publication requires 1 to 50 exact approved source revisions.')
    ensure_schema(conn)
    stamp = now()
    conn.execute("""INSERT INTO public_publication_runs
        (run_id,fixture_id,status,phase,worker_pid,created_at,updated_at) VALUES (?,?,'running','upload',?,?,?)""",
        (run_id,run['fixture_id'],os.getpid(),stamp,stamp))
    conn.executemany("""INSERT INTO public_publication_items
        (run_id,asset_id,source_version_hash,updated_at) VALUES (?,?,?,?)""",
        [(run_id,item['asset_id'],item['source_version_hash'],stamp) for item in items])


def set_phase(root, run_id, phase, *, status='running', error='', catalog=None):
    from fixture_pipeline import connect
    with connect(root) as conn:
        conn.execute("""UPDATE public_publication_runs SET phase=?,status=?,last_error=?,
            catalog_receipt_json=COALESCE(?,catalog_receipt_json),updated_at=? WHERE run_id=?""",
            (phase,status,error,json.dumps(catalog,sort_keys=True) if catalog is not None else None,now(),run_id))
        conn.commit()


def save_item(root, run_id, asset_id, column, value):
    """Record only structured stage evidence for a member of this pinned run."""
    from fixture_pipeline import connect
    if column not in {'input_json','envelope_json','registration_json','verification_json'}:
        raise ValueError('Unsupported publication receipt.')
    with connect(root) as conn:
        count = conn.execute(f'UPDATE public_publication_items SET {column}=?,updated_at=? WHERE run_id=? AND asset_id=?',
            (json.dumps(value,sort_keys=True,separators=(',',':')),now(),run_id,asset_id)).rowcount
        if count != 1:
            raise ValueError('Publication receipt does not belong to this exact run.')
        conn.commit()


def overlay(conn, result):
    """Upload completion cannot masquerade as end-to-end public completion."""
    run = get(conn, result['runId'])
    if not run:
        return result
    items = list(conn.execute('SELECT * FROM public_publication_items WHERE run_id=?', (result['runId'],)))
    stages = {item['asset_id']: dict(item) for item in items}
    for item in result['items']:
        stage = stages[item['asset_id']]
        item['registration_state'] = 'registered' if stage['registration_json'] else 'pending'
        item['verification_state'] = 'verified' if stage['verification_json'] else 'pending'
    return {**result, 'uploadStatus': result['status'], 'status': run['status'],
        'publicationPhase': run['phase'], 'lastError': run['last_error'],
        'registered': sum(bool(item['registration_json']) for item in items),
        'publicVerified': sum(bool(item['verification_json']) for item in items),
        'live': sum(bool(item['public_access_expires_at']) for item in result['items']),
        'remaining': (0 if run['status']=='completed' else max(1,sum(not item['verification_json'] for item in items))),
        'completedAt': result['completedAt'] if run['status'] in {'completed','failed','cancelled'} else ''}


def recover_dead_workers(conn):
    """Only proven-dead registered processes are retryable; never steal a live claim."""
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name='public_publication_runs'").fetchone():
        return []
    recovered = []
    for row in conn.execute("SELECT * FROM public_publication_runs WHERE status='running' AND worker_pid>0").fetchall():
        try:
            os.kill(row['worker_pid'], 0)
        except ProcessLookupError:
            message = f"Publication worker stopped during {row['phase']}; resume this same run."
            conn.execute("UPDATE public_publication_runs SET status='failed',last_error=?,updated_at=? WHERE run_id=?",
                         (message,now(),row['run_id']))
            conn.execute("UPDATE asset_upload_runs SET status='failed',last_error=?,updated_at=? WHERE run_id=?",
                         (message,now(),row['run_id']))
            recovered.append(row['run_id'])
        except PermissionError:
            pass  # Not proof of death.
    return recovered
