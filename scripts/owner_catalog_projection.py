#!/usr/bin/env python3
"""Store the approved public catalog in Owner and project it atomically.

The website still consumes ``assets/catalog/photosbyelie.sqlite``.  That file is
now a projection: the authoritative bytes and their revision receipt live in
Owner.sqlite.  Import is an explicit one-time/migration operation; ordinary
projection never reads the website and never edits Owner from deployed state.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from typing import Any, Callable
from urllib.request import Request, urlopen


APPROVED_POLICY = "PBE-173"
CURRENT_PROJECTION_ID = "public-catalog"
PUBLIC_CATALOG_URL = "https://photos-by-elie.com/assets/catalog/photosbyelie.sqlite"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def ensure_projection_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS owner_public_catalog_projections (
          projection_id TEXT PRIMARY KEY CHECK (trim(projection_id) <> ''),
          revision INTEGER NOT NULL CHECK (revision > 0),
          catalog_blob BLOB NOT NULL CHECK (length(catalog_blob) > 0),
          catalog_sha256 TEXT NOT NULL CHECK (length(catalog_sha256) = 64),
          media_count INTEGER NOT NULL CHECK (media_count >= 0),
          table_counts_json TEXT NOT NULL,
          source_kind TEXT NOT NULL,
          approved_policy TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS owner_public_catalog_deployments (
          deployment_id TEXT PRIMARY KEY CHECK (trim(deployment_id) <> ''),
          projection_revision INTEGER NOT NULL CHECK (projection_revision > 0),
          projection_sha256 TEXT NOT NULL CHECK (length(projection_sha256) = 64),
          media_count INTEGER NOT NULL CHECK (media_count >= 0),
          public_url TEXT NOT NULL,
          remote_sha256 TEXT NOT NULL DEFAULT '',
          remote_bytes INTEGER NOT NULL DEFAULT 0 CHECK (remote_bytes >= 0),
          state TEXT NOT NULL CHECK (state IN ('verified', 'failed')),
          error_text TEXT NOT NULL DEFAULT '',
          verified_at TEXT NOT NULL
        ) WITHOUT ROWID;

        CREATE INDEX IF NOT EXISTS idx_owner_public_catalog_deployments_projection
          ON owner_public_catalog_deployments(projection_sha256, state, verified_at);
        """
    )


def _catalog_evidence(path: Path) -> dict[str, Any]:
    conn = sqlite3.connect(path)
    try:
        integrity = str(conn.execute("PRAGMA integrity_check").fetchone()[0])
        if integrity != "ok":
            raise RuntimeError(f"catalog failed integrity_check: {integrity}")
        foreign_keys = conn.execute("PRAGMA foreign_key_check").fetchall()
        if foreign_keys:
            raise RuntimeError(f"catalog failed foreign_key_check: {foreign_keys[:5]}")
        tables = [
            str(row[0])
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        required = {"collections", "media_items", "media_assets"}
        missing = sorted(required - set(tables))
        if missing:
            raise RuntimeError(f"catalog is missing required tables: {', '.join(missing)}")
        table_counts = {
            table: int(conn.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0])
            for table in tables
        }
        retired_collections = int(
            conn.execute("SELECT count(*) FROM collections WHERE lower(slug) = 'ai'").fetchone()[0]
        )
        retired_origins = int(
            conn.execute("SELECT count(*) FROM source_origins WHERE lower(code) = 'ai'").fetchone()[0]
        )
        if retired_collections or retired_origins:
            raise RuntimeError("catalog contains the retired ai collection or source origin")
        media_ids = [str(row[0]) for row in conn.execute("SELECT media_id FROM media_items ORDER BY media_id")]
    finally:
        conn.close()
    return {
        "mediaCount": table_counts["media_items"],
        "tableCounts": table_counts,
        "mediaIdsSha256": sha256_bytes("\n".join(media_ids).encode("utf-8")),
    }


def validate_catalog_bytes(payload: bytes) -> dict[str, Any]:
    if not payload.startswith(b"SQLite format 3\x00"):
        raise RuntimeError("catalog payload is not SQLite")
    with tempfile.NamedTemporaryFile(prefix="pbe-owner-catalog-", suffix=".sqlite") as handle:
        handle.write(payload)
        handle.flush()
        evidence = _catalog_evidence(Path(handle.name))
    return {**evidence, "sha256": sha256_bytes(payload), "bytes": len(payload)}


def catalog_media_ids(payload: bytes) -> list[str]:
    """Return the exact stable media identities represented by catalog bytes."""
    with tempfile.NamedTemporaryFile(prefix="pbe-owner-catalog-ids-", suffix=".sqlite") as handle:
        handle.write(payload)
        handle.flush()
        conn = sqlite3.connect(handle.name)
        try:
            return [
                str(row[0])
                for row in conn.execute("SELECT media_id FROM media_items ORDER BY media_id")
            ]
        finally:
            conn.close()


def remove_retired_ai_catalog_path(payload: bytes) -> bytes:
    """Remove only unreferenced legacy ai lookup rows during explicit import."""
    with tempfile.NamedTemporaryFile(prefix="pbe-retire-ai-", suffix=".sqlite") as handle:
        handle.write(payload)
        handle.flush()
        conn = sqlite3.connect(handle.name)
        try:
            retired_collection_rows = int(
                conn.execute("SELECT count(*) FROM collections WHERE lower(slug) = 'ai'").fetchone()[0]
            )
            retired_origin_rows = int(
                conn.execute("SELECT count(*) FROM source_origins WHERE lower(code) = 'ai'").fetchone()[0]
            )
            if not retired_collection_rows and not retired_origin_rows:
                return payload
            collection_refs = int(
                conn.execute(
                    """
                    SELECT count(*) FROM media_items AS media
                    JOIN collections AS collection USING (collection_id)
                    WHERE lower(collection.slug) = 'ai'
                    """
                ).fetchone()[0]
            )
            origin_refs = int(
                conn.execute(
                    """
                    SELECT count(*) FROM media_items AS media
                    JOIN source_origins AS origin USING (source_origin_id)
                    WHERE lower(origin.code) = 'ai'
                    """
                ).fetchone()[0]
            )
            if collection_refs or origin_refs:
                raise RuntimeError(
                    "reviewed catalog still contains published ai media; retire those assets before import"
                )
            conn.execute("DELETE FROM collections WHERE lower(slug) = 'ai'")
            conn.execute("DELETE FROM source_origins WHERE lower(code) = 'ai'")
            conn.commit()
            conn.execute("VACUUM")
        finally:
            conn.close()
        return Path(handle.name).read_bytes()


def projection_snapshot(
    conn: sqlite3.Connection, *, ensure_schema: bool = True
) -> dict[str, Any] | None:
    if ensure_schema:
        ensure_projection_schema(conn)
    row = conn.execute(
        """
        SELECT projection_id, revision, catalog_blob, catalog_sha256, media_count,
               table_counts_json, source_kind, approved_policy, created_at, updated_at
        FROM owner_public_catalog_projections WHERE projection_id = ?
        """,
        (CURRENT_PROJECTION_ID,),
    ).fetchone()
    if row is None:
        return None
    payload = bytes(row["catalog_blob"] if isinstance(row, sqlite3.Row) else row[2])
    values = dict(row) if isinstance(row, sqlite3.Row) else {
        "projection_id": row[0], "revision": row[1], "catalog_sha256": row[3],
        "media_count": row[4], "table_counts_json": row[5], "source_kind": row[6],
        "approved_policy": row[7], "created_at": row[8], "updated_at": row[9],
    }
    if sha256_bytes(payload) != str(values["catalog_sha256"]):
        raise RuntimeError("Owner public catalog projection checksum does not match its bytes")
    return {
        "projectionId": str(values["projection_id"]),
        "revision": int(values["revision"]),
        "payload": payload,
        "sha256": str(values["catalog_sha256"]),
        "mediaCount": int(values["media_count"]),
        "tableCounts": json.loads(str(values["table_counts_json"])),
        "sourceKind": str(values["source_kind"]),
        "approvedPolicy": str(values["approved_policy"]),
        "createdAt": str(values["created_at"]),
        "updatedAt": str(values["updated_at"]),
    }


def store_projection(
    conn: sqlite3.Connection,
    payload: bytes,
    *,
    source_kind: str,
    approved_policy: str = APPROVED_POLICY,
    expected_sha256: str | None = None,
    ensure_schema: bool = True,
) -> dict[str, Any]:
    if approved_policy != APPROVED_POLICY:
        raise RuntimeError(f"catalog projection changes require approved policy {APPROVED_POLICY}")
    evidence = validate_catalog_bytes(payload)
    if ensure_schema:
        ensure_projection_schema(conn)
    current = projection_snapshot(conn, ensure_schema=False)
    if expected_sha256 is not None:
        actual = current["sha256"] if current else ""
        if actual != expected_sha256:
            raise RuntimeError("Owner projection changed since the reviewed revision")
    if current and current["sha256"] == evidence["sha256"]:
        return {**current, "changed": False}
    timestamp = now_iso()
    revision = (current["revision"] if current else 0) + 1
    created_at = current["createdAt"] if current else timestamp
    conn.execute(
        """
        INSERT INTO owner_public_catalog_projections (
          projection_id, revision, catalog_blob, catalog_sha256, media_count,
          table_counts_json, source_kind, approved_policy, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(projection_id) DO UPDATE SET
          revision = excluded.revision,
          catalog_blob = excluded.catalog_blob,
          catalog_sha256 = excluded.catalog_sha256,
          media_count = excluded.media_count,
          table_counts_json = excluded.table_counts_json,
          source_kind = excluded.source_kind,
          approved_policy = excluded.approved_policy,
          updated_at = excluded.updated_at
        """,
        (
            CURRENT_PROJECTION_ID,
            revision,
            payload,
            evidence["sha256"],
            evidence["mediaCount"],
            json.dumps(evidence["tableCounts"], sort_keys=True, separators=(",", ":")),
            source_kind,
            approved_policy,
            created_at,
            timestamp,
        ),
    )
    return {
        "projectionId": CURRENT_PROJECTION_ID,
        "revision": revision,
        "payload": payload,
        "sha256": evidence["sha256"],
        "mediaCount": evidence["mediaCount"],
        "tableCounts": evidence["tableCounts"],
        "sourceKind": source_kind,
        "approvedPolicy": approved_policy,
        "createdAt": created_at,
        "updatedAt": timestamp,
        "changed": True,
    }


def import_projection(
    owner_db: Path,
    catalog_path: Path,
    *,
    approved_policy: str,
    expected_sha256: str | None = None,
) -> dict[str, Any]:
    if not owner_db.is_absolute() or not catalog_path.is_absolute():
        raise RuntimeError("Owner and catalog paths must be absolute")
    payload = remove_retired_ai_catalog_path(catalog_path.read_bytes())
    conn = sqlite3.connect(owner_db)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        ensure_projection_schema(conn)
        conn.commit()
        conn.execute("BEGIN IMMEDIATE")
        result = store_projection(
            conn,
            payload,
            source_kind="reviewed-local-import",
            approved_policy=approved_policy,
            expected_sha256=expected_sha256,
            ensure_schema=False,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return {key: value for key, value in result.items() if key != "payload"}


def _atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temp_path = Path(temp_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def project_catalog(owner_db: Path, output: Path) -> dict[str, Any]:
    conn = sqlite3.connect(owner_db)
    conn.row_factory = sqlite3.Row
    try:
        snapshot = projection_snapshot(conn)
    finally:
        conn.close()
    if snapshot is None:
        raise RuntimeError("Owner public catalog projection has not been initialized")
    _atomic_write(output, snapshot["payload"])
    evidence = validate_catalog_bytes(output.read_bytes())
    if evidence["sha256"] != snapshot["sha256"]:
        raise RuntimeError("projected catalog checksum differs from Owner authority")
    return {
        "projectionId": snapshot["projectionId"],
        "revision": snapshot["revision"],
        "sha256": snapshot["sha256"],
        "mediaCount": snapshot["mediaCount"],
        "output": str(output),
    }


def verify_deployed_projection(
    owner_db: Path,
    *,
    public_url: str = PUBLIC_CATALOG_URL,
    fetch: Callable[[str], tuple[int, bytes]] | None = None,
) -> dict[str, Any]:
    conn = sqlite3.connect(owner_db)
    conn.row_factory = sqlite3.Row
    try:
        snapshot = projection_snapshot(conn)
        if snapshot is None:
            raise RuntimeError("Owner public catalog projection has not been initialized")
        timestamp = now_iso()
        try:
            if fetch is None:
                response = urlopen(
                    Request(public_url, headers={"User-Agent": "PhotosByElie projection verifier"}),
                    timeout=30,
                )
                status, payload = int(response.status), response.read()
            else:
                status, payload = fetch(public_url)
            if status != 200:
                raise RuntimeError(f"deployed catalog returned HTTP {status}")
            remote = validate_catalog_bytes(payload)
            if remote["sha256"] != snapshot["sha256"]:
                raise RuntimeError(
                    "deployed catalog checksum does not match the approved Owner projection"
                )
            state, error_text = "verified", ""
        except Exception as error:  # retain a durable failed deployment receipt
            payload = locals().get("payload", b"")
            remote = {
                "sha256": sha256_bytes(payload) if payload else "",
                "bytes": len(payload),
            }
            state, error_text = "failed", str(error)
        deployment_id = "catalog-deploy-" + hashlib.sha256(
            f"{snapshot['revision']}\n{snapshot['sha256']}\n{timestamp}\n{state}".encode("utf-8")
        ).hexdigest()[:24]
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            """
            INSERT INTO owner_public_catalog_deployments (
              deployment_id, projection_revision, projection_sha256, media_count,
              public_url, remote_sha256, remote_bytes, state, error_text, verified_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                deployment_id,
                snapshot["revision"],
                snapshot["sha256"],
                snapshot["mediaCount"],
                public_url,
                remote["sha256"],
                int(remote["bytes"]),
                state,
                error_text,
                timestamp,
            ),
        )
        publication_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'public_catalog_publications'"
        ).fetchone()
        if state == "verified" and publication_table:
            media_ids = catalog_media_ids(snapshot["payload"])
            conn.execute(
                """
                UPDATE public_catalog_publications
                SET state = 'pending', catalog_sha256 = '', verified_at = NULL,
                    error_text = 'not present in the latest verified catalog projection',
                    updated_at = ?
                WHERE state = 'live'
                """,
                (timestamp,),
            )
            for start in range(0, len(media_ids), 500):
                chunk = media_ids[start:start + 500]
                placeholders = ",".join("?" for _ in chunk)
                conn.execute(
                    f"""
                    UPDATE public_catalog_publications
                    SET state = 'live', public_url = ?, catalog_sha256 = ?,
                        error_text = '', verified_at = ?, updated_at = ?
                    WHERE media_id IN ({placeholders})
                    """,
                    (public_url, snapshot["sha256"], timestamp, timestamp, *chunk),
                )
        conn.commit()
    finally:
        conn.close()
    result = {
        "deploymentId": deployment_id,
        "state": state,
        "projectionRevision": snapshot["revision"],
        "projectionSha256": snapshot["sha256"],
        "remoteSha256": remote["sha256"],
        "mediaCount": snapshot["mediaCount"],
        "publicUrl": public_url,
        "verifiedAt": timestamp,
    }
    if error_text:
        result["error"] = error_text
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner-db", type=Path, required=True)
    subparsers = parser.add_subparsers(dest="command", required=True)
    imported = subparsers.add_parser("import", help="explicitly adopt a reviewed catalog into Owner")
    imported.add_argument("--catalog", type=Path, required=True)
    imported.add_argument("--approved-policy", required=True)
    imported.add_argument("--expected-sha256")
    projected = subparsers.add_parser("project", help="write the Owner projection atomically")
    projected.add_argument("--output", type=Path, required=True)
    verified = subparsers.add_parser("verify-deployed", help="record exact remote parity")
    verified.add_argument("--public-url", default=PUBLIC_CATALOG_URL)
    args = parser.parse_args()
    owner_db = args.owner_db.resolve()
    if args.command == "import":
        result = import_projection(
            owner_db,
            args.catalog.resolve(),
            approved_policy=args.approved_policy,
            expected_sha256=args.expected_sha256,
        )
    elif args.command == "project":
        result = project_catalog(owner_db, args.output.resolve())
    else:
        result = verify_deployed_projection(owner_db, public_url=args.public_url)
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
