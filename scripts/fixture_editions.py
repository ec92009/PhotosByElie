"""Fixture-owned editorial editions and immutable approval snapshots.

The camera asset and its source-version catalog remain shared. A fixture owns
the metadata, selected image version and approval; delivery addresses the exact
approved revision. None of these functions commits the caller's transaction.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from typing import Any


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def encoded(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def ensure_schema(conn: sqlite3.Connection) -> None:
    """Add scoped storage without rewriting legacy state or live receipts."""
    statements = [
        """CREATE TABLE IF NOT EXISTS fixture_asset_editions (
          fixture_id TEXT NOT NULL, asset_id TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '', keywords_json TEXT NOT NULL DEFAULT '[]',
          country TEXT NOT NULL DEFAULT '', source_version_id TEXT NOT NULL DEFAULT '',
          editorial_state TEXT NOT NULL DEFAULT 'unreviewed',
          ai_reasons_json TEXT NOT NULL DEFAULT '[]', ai_note TEXT NOT NULL DEFAULT '',
          ai_attempt_count INTEGER NOT NULL DEFAULT 0, ai_last_error TEXT NOT NULL DEFAULT '',
          visual_ai_request_json TEXT NOT NULL DEFAULT '{}',
          ai_preview_path TEXT NOT NULL DEFAULT '', ai_preview_sha256 TEXT NOT NULL DEFAULT '',
          requested_at TEXT, proposed_at TEXT, approved_at TEXT,
          approved_revision_hash TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          provenance TEXT NOT NULL DEFAULT 'new-fixture',
          PRIMARY KEY(fixture_id, asset_id),
          FOREIGN KEY(fixture_id) REFERENCES fixtures(fixture_id),
          FOREIGN KEY(asset_id) REFERENCES sidecar_assets(asset_id)
        )""",
        """CREATE TABLE IF NOT EXISTS fixture_edition_versions (
          fixture_id TEXT NOT NULL, asset_id TEXT NOT NULL, revision_hash TEXT NOT NULL,
          source_version_id TEXT NOT NULL, title TEXT NOT NULL,
          keywords_json TEXT NOT NULL, country TEXT NOT NULL,
          approved_at TEXT NOT NULL, actor TEXT NOT NULL,
          provenance TEXT NOT NULL DEFAULT 'explicit-approval',
          PRIMARY KEY(fixture_id, asset_id, revision_hash),
          FOREIGN KEY(fixture_id, asset_id) REFERENCES fixture_asset_editions(fixture_id, asset_id)
        )""",
        """CREATE TABLE IF NOT EXISTS fixture_edition_delivery (
          fixture_id TEXT NOT NULL, asset_id TEXT NOT NULL, revision_hash TEXT NOT NULL,
          delivery_state TEXT NOT NULL DEFAULT 'needs-upload', source_version_hash TEXT NOT NULL,
          receipt_version_hash TEXT NOT NULL DEFAULT '',
          last_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          PRIMARY KEY(fixture_id,asset_id,revision_hash),
          FOREIGN KEY(fixture_id,asset_id,revision_hash) REFERENCES fixture_edition_versions(fixture_id,asset_id,revision_hash)
        )""",
        """CREATE TABLE IF NOT EXISTS fixture_edition_events (
          event_id INTEGER PRIMARY KEY, fixture_id TEXT NOT NULL, asset_id TEXT NOT NULL,
          action TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL,
          actor TEXT NOT NULL, created_at TEXT NOT NULL
        )""",
        """CREATE TABLE IF NOT EXISTS fixture_edition_migrations (
          migration_id TEXT PRIMARY KEY, completed_at TEXT NOT NULL, report_json TEXT NOT NULL
        )""",
    ]
    for sql in statements:
        conn.execute(sql)
    run_columns = {r[1] for r in conn.execute("PRAGMA table_info(asset_upload_runs)")}
    if run_columns and "fixture_id" not in run_columns:
        conn.execute("ALTER TABLE asset_upload_runs ADD COLUMN fixture_id TEXT NOT NULL DEFAULT ''")
    proposal_columns = {r[1] for r in conn.execute("PRAGMA table_info(asset_ai_proposals)")}
    if proposal_columns and "fixture_id" not in proposal_columns:
        conn.execute("ALTER TABLE asset_ai_proposals ADD COLUMN fixture_id TEXT NOT NULL DEFAULT ''")
    if proposal_columns:
        conn.execute("DROP INDEX IF EXISTS idx_asset_ai_proposals_attempt")
        conn.execute("CREATE UNIQUE INDEX idx_asset_ai_proposals_attempt ON asset_ai_proposals(fixture_id,asset_id,attempt)")
    if conn.execute("SELECT 1 FROM sqlite_master WHERE name='public_access_observations'").fetchone():
        from public_access_verification import ensure_schema as ensure_public_access_schema
        ensure_public_access_schema(conn)



def revision_hash(edition: dict[str, Any]) -> str:
    """Bind approval to all accepted metadata and the immutable image identity."""
    payload = {k: edition.get(k, "") for k in ("fixture_id", "source_version_id", "title", "country")}
    payload["keywords"] = json.loads(edition.get("keywords_json") or "[]")
    return hashlib.sha256(encoded(payload).encode()).hexdigest()


def get_edition(conn: sqlite3.Connection, fixture_id: str, asset_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM fixture_asset_editions WHERE fixture_id=? AND asset_id=?",
                       (fixture_id, asset_id)).fetchone()
    return dict(row) if row else None


def seed_edition(conn: sqlite3.Connection, fixture_id: str, asset_id: str, *,
                 source_version_id: str, title: str = "", keywords: list[str] | None = None,
                 country: str = "", provenance: str = "new-fixture", now: str | None = None) -> dict[str, Any]:
    """Seed a draft once; approval never follows a photo into another fixture."""
    now = now or timestamp()
    if source_version_id:
        require_source(conn, asset_id, source_version_id)
    conn.execute("""INSERT OR IGNORE INTO fixture_asset_editions
        (fixture_id,asset_id,title,keywords_json,country,source_version_id,created_at,updated_at,provenance)
        VALUES (?,?,?,?,?,?,?,?,?)""",
        (fixture_id, asset_id, title, encoded(keywords or []), country, source_version_id, now, now, provenance))
    return get_edition(conn, fixture_id, asset_id)


def require_source(conn: sqlite3.Connection, asset_id: str, version_id: str) -> None:
    if not conn.execute("SELECT 1 FROM asset_source_versions WHERE asset_id=? AND version_id=? AND source_exists=1",
                        (asset_id, version_id)).fetchone():
        raise ValueError("The fixture image version is missing or belongs to another photo.")


def edit_edition(conn: sqlite3.Connection, fixture_id: str, asset_id: str, *,
                 title: str | None = None, keywords: list[str] | None = None,
                 country: str | None = None, source_version_id: str | None = None,
                 actor: str = "owner", now: str | None = None) -> dict[str, Any]:
    """Change one fixture's draft, requiring approval only when content changes."""
    before = get_edition(conn, fixture_id, asset_id)
    if before is None:
        raise ValueError("The fixture edition has not been initialized.")
    after = dict(before)
    for key, value in (("title", title), ("country", country), ("source_version_id", source_version_id)):
        if value is not None:
            after[key] = value
    if keywords is not None:
        after["keywords_json"] = encoded(list(dict.fromkeys(keywords)))
    if source_version_id is not None:
        require_source(conn, asset_id, source_version_id)
    if revision_hash(after) == revision_hash(before):
        return before
    now = now or timestamp()
    conn.execute("""UPDATE fixture_asset_editions SET title=?,keywords_json=?,country=?,source_version_id=?,
        editorial_state='unreviewed',approved_at=NULL,approved_revision_hash='',updated_at=?
        WHERE fixture_id=? AND asset_id=?""",
        (after["title"],after["keywords_json"],after["country"],after["source_version_id"],now,fixture_id,asset_id))
    return record_event(conn, before, "edit", actor, now)


def approve_edition(conn: sqlite3.Connection, fixture_id: str, asset_id: str, *,
                    expected_revision: str, actor: str = "owner", now: str | None = None,
                    provenance: str = "explicit-approval") -> dict[str, Any]:
    """Approve the displayed fixture version; reject stale UI and missing images."""
    before = get_edition(conn, fixture_id, asset_id)
    if before is None or revision_hash(before) != expected_revision:
        raise ValueError("The fixture edition changed; refresh before approving.")
    require_source(conn, asset_id, before["source_version_id"])
    now = now or timestamp()
    conn.execute("""INSERT OR IGNORE INTO fixture_edition_versions
        (fixture_id,asset_id,revision_hash,source_version_id,title,keywords_json,country,approved_at,actor,provenance)
        VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (fixture_id,asset_id,expected_revision,before["source_version_id"],before["title"],
         before["keywords_json"],before["country"],now,actor,provenance))
    conn.execute("""UPDATE fixture_asset_editions SET editorial_state='approved',approved_at=?,
        approved_revision_hash=?,updated_at=? WHERE fixture_id=? AND asset_id=?""",
        (now,expected_revision,now,fixture_id,asset_id))
    conn.execute("""INSERT OR IGNORE INTO fixture_edition_delivery
        (fixture_id,asset_id,revision_hash,source_version_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)""",
        (fixture_id,asset_id,expected_revision,before["source_version_id"],now,now))
    return record_event(conn, before, "approve", actor, now)


def approved_edition(conn: sqlite3.Connection, fixture_id: str, asset_id: str) -> dict[str, Any] | None:
    """Return the immutable upload input only for the current scoped approval."""
    edition = get_edition(conn, fixture_id, asset_id)
    if not edition or edition["editorial_state"] != "approved":
        return None
    if not edition["approved_revision_hash"] or revision_hash(edition) != edition["approved_revision_hash"]:
        return None
    row = conn.execute("""SELECT * FROM fixture_edition_versions
        WHERE fixture_id=? AND asset_id=? AND revision_hash=?""",
        (fixture_id,asset_id,edition["approved_revision_hash"])).fetchone()
    return dict(row) if row else None


def record_event(conn: sqlite3.Connection, before: dict[str, Any], action: str,
                 actor: str, now: str) -> dict[str, Any]:
    after = get_edition(conn, before["fixture_id"], before["asset_id"])
    conn.execute("""INSERT INTO fixture_edition_events
        (fixture_id,asset_id,action,before_json,after_json,actor,created_at) VALUES (?,?,?,?,?,?,?)""",
        (before["fixture_id"],before["asset_id"],action,encoded(before),encoded(after),actor,now))
    return after


def enabled(conn: sqlite3.Connection) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fixture_asset_editions'").fetchone() is not None


def editorial_scope(conn: sqlite3.Connection, fixture_id: str | None) -> tuple[str, str, tuple[str, ...]]:
    """Explicit SQL scope for code that also supports pre-migration databases."""
    if not enabled(conn):
        return "asset_editorial_state", "asset_id=?", ()
    if not fixture_id:
        raise ValueError("A fixture ID is required for editorial work.")
    return "fixture_asset_editions", "asset_id=? AND fixture_id=?", (fixture_id,)


def is_expo_fixture(conn: sqlite3.Connection, fixture_id: str) -> bool:
    """Give Back belongs to the exact Expo fixture, not its descendants."""
    row = conn.execute("SELECT fixture_id,name,parent_fixture_id FROM fixtures WHERE fixture_id=? AND archived_at IS NULL", (fixture_id,)).fetchone()
    return bool(row and not row["parent_fixture_id"] and
                (row["fixture_id"] == "fixture-expo" or row["name"].strip().casefold() == "expo"))


def render_selected_preview(conn, fixture_id: str, asset_id: str, destination, maximum: int) -> bool:
    """Render a bounded preview of an accepted local edit, or use PhotoKit's original.

    A missing/corrupted selected edit is an error; it must never quietly substitute
    the camera original as AI input.
    """
    from pathlib import Path
    import subprocess
    edition=get_edition(conn,fixture_id,asset_id)
    if not edition: raise ValueError('The fixture edition is missing.')
    require_source(conn,asset_id,edition['source_version_id'])
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name='external_edit_returns'").fetchone(): return False
    row=conn.execute('SELECT file_path,checksum_sha256,byte_count FROM external_edit_returns WHERE destination_asset_id=? AND source_version_id=?', (asset_id,edition['source_version_id'])).fetchone()
    if row is None: return False
    source=Path(row['file_path'])
    if source.is_symlink() or not source.is_file() or source.stat().st_size!=row['byte_count']:
        raise ValueError('The fixture selected image is missing or changed.')
    if hashlib.sha256(source.read_bytes()).hexdigest()!=row['checksum_sha256']:
        raise ValueError('The fixture selected image checksum no longer matches.')
    destination=Path(destination); destination.parent.mkdir(parents=True,exist_ok=True)
    subprocess.run(['/usr/bin/sips','-s','format','jpeg','-Z',str(maximum),str(source),'--out',str(destination)],check=True,capture_output=True,timeout=60)
    return True


def seed_memberships(conn, fixture_id):
    register_original_sources(conn,fixture_id)
    returned = conn.execute("SELECT 1 FROM sqlite_master WHERE name='external_edit_returns'").fetchone()
    original_only = "AND NOT EXISTS (SELECT 1 FROM external_edit_returns r WHERE r.source_version_id=v.version_id)" if returned else ""
    now=timestamp()
    conn.execute(f"""INSERT OR IGNORE INTO fixture_asset_editions
        (fixture_id,asset_id,title,keywords_json,source_version_id,created_at,updated_at)
        SELECT p.fixture_id,p.asset_id,COALESCE(a.photos_title,''),COALESCE(a.photos_keywords_json,'[]'),
        COALESCE((SELECT version_id FROM asset_source_versions v WHERE v.asset_id=p.asset_id AND v.source_exists=1
        {original_only} ORDER BY v.created_at DESC,v.version_id DESC LIMIT 1),''),?,?
        FROM fixture_asset_decisions p JOIN sidecar_assets a USING(asset_id) WHERE p.fixture_id=?""",(now,now,fixture_id))
    conn.execute(f"""UPDATE fixture_asset_editions SET source_version_id=COALESCE((SELECT version_id FROM asset_source_versions v
        WHERE v.asset_id=fixture_asset_editions.asset_id AND v.source_exists=1 {original_only} ORDER BY v.created_at LIMIT 1),'')
        WHERE fixture_id=? AND source_version_id='' AND editorial_state!='approved'""",(fixture_id,))



def register_original_sources(conn, fixture_id=None):
    """Give unchanged PhotoKit originals a stable shared identity when unscanned.

    This is an identity receipt, not a claim of a content checksum. Export still
    verifies the actual bytes before Uploads can record a verified receipt.
    """
    rows=conn.execute("""SELECT DISTINCT a.asset_id FROM sidecar_assets a
        JOIN fixture_asset_decisions p ON p.asset_id=a.asset_id
        WHERE COALESCE(a.missing_at,'')='' AND (? IS NULL OR p.fixture_id=?)
          AND NOT EXISTS (SELECT 1 FROM asset_source_versions v WHERE v.asset_id=a.asset_id)
        """,(fixture_id,fixture_id)).fetchall()
    now=timestamp()
    for row in rows:
        asset_id=row['asset_id']; version='srcv-original-'+hashlib.sha256(asset_id.encode()).hexdigest()[:32]
        conn.execute("""INSERT OR IGNORE INTO asset_source_versions
            (version_id,asset_id,metadata_fingerprint,rendered_fingerprint,source_exists,state,created_at)
            VALUES (?,?,'',?,1,'candidate',?)""",(version,asset_id,'camera-original:'+asset_id,now))
    return len(rows)
