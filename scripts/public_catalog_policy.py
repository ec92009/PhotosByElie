#!/usr/bin/env python3
"""Resolve the authoritative set of media allowed in the public catalog."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any

from owner_state_db import connect, media_lifecycle_snapshot


DEFAULT_EXPO_MANIFEST = Path("assets/expo-manifest.json")
DEFAULT_PRODUCT_PRICING = Path("assets/catalog/product-pricing.json")


def _read_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        return fallback


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    return bool(conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
        (table,),
    ).fetchone())


def _first_column(
    conn: sqlite3.Connection, sql: str, parameters: tuple[Any, ...] = ()
) -> set[str]:
    return {
        str(row[0] or "").strip()
        for row in conn.execute(sql, parameters).fetchall()
        if str(row[0] or "").strip()
    }


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def connect_owner_authority_read_only(owner_db_path: Path) -> tuple[sqlite3.Connection, Path]:
    """Open an existing Owner authority without creating or migrating it."""
    if not owner_db_path.is_absolute():
        raise ValueError("Owner authority path must be absolute")
    try:
        resolved = owner_db_path.resolve(strict=True)
    except FileNotFoundError as error:
        raise FileNotFoundError(f"Owner authority does not exist: {owner_db_path}") from error
    if not resolved.is_file():
        raise ValueError(f"Owner authority is not a file: {resolved}")
    wal_path = Path(f"{resolved}-wal")
    if wal_path.exists() and wal_path.stat().st_size:
        raise ValueError(
            f"Owner authority has an uncheckpointed WAL: {wal_path}. "
            "Provide a checkpointed reviewed snapshot."
        )
    # immutable=1 keeps validation tied to the exact bytes being fingerprinted;
    # it neither creates SQLite sidecars nor consumes uncheckpointed WAL state.
    conn = sqlite3.connect(f"{resolved.as_uri()}?mode=ro&immutable=1", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    conn.execute("SELECT 1").fetchone()
    return conn, resolved


def public_catalog_policy_snapshot(
    repo_root: Path,
    *,
    conn: sqlite3.Connection | None = None,
    owner_db_path: Path | None = None,
    expo_manifest_path: Path = DEFAULT_EXPO_MANIFEST,
) -> dict[str, Any]:
    """Return public eligibility from Owner SQLite.

    PBE-173's durable reconciliation ledger is the normal legacy authority.
    The Expo manifest is consulted only by databases that predate that migration.
    Current approvals may come from title/keyword review, Sidecar Upload Bridge,
    or native publication audit. Lifecycle blocks always win.
    """
    if conn is not None and owner_db_path is not None:
        raise ValueError("Pass conn or owner_db_path, not both")
    owns_conn = conn is None
    authority_path: Path | None = None
    if conn is None and owner_db_path is not None:
        conn, authority_path = connect_owner_authority_read_only(owner_db_path)
    else:
        conn = conn or connect(repo_root)
    try:
        title_keyword_ids = _first_column(conn, """
            SELECT q.media_id
            FROM title_keyword_queue AS q
            JOIN title_keyword_decisions AS d
              ON d.media_id = q.media_id
             AND d.attempt = q.latest_attempt
            WHERE q.review_state IN ('approved', 'applied')
              AND d.decision_state = 'accepted'
              AND COALESCE(d.applied_at, '') <> ''
        """) if _table_exists(conn, "title_keyword_queue") else set()

        sidecar_ids = _first_column(conn, """
            SELECT DISTINCT i.photo_id
            FROM sidecar_decisions AS d
            JOIN sidecar_upload_bridge_run_items AS i ON i.asset_id = d.asset_id
            WHERE d.pick_state = 'picked'
              AND d.metadata_state = 'approved'
              AND i.upload_status = 'uploaded'
              AND COALESCE(i.photo_id, '') <> ''
              AND NOT EXISTS (
                SELECT 1 FROM sidecar_tombstones AS t
                WHERE t.asset_id = d.asset_id AND t.tombstone_state = 'active'
              )
        """) if _table_exists(conn, "sidecar_upload_bridge_run_items") else set()

        native_ids = _first_column(conn, """
            SELECT DISTINCT catalog.media_id
            FROM public_catalog_publications AS catalog
            JOIN asset_editorial_state AS editorial
              ON editorial.asset_id = catalog.asset_id
             AND editorial.editorial_state = 'approved'
            WHERE catalog.state IN ('local', 'live')
              AND COALESCE(catalog.media_id, '') <> ''
              AND NOT EXISTS (
                SELECT 1 FROM sidecar_tombstones AS tombstone
                WHERE tombstone.asset_id = catalog.asset_id
                  AND tombstone.tombstone_state = 'active'
              )
        """) if _table_exists(conn, "public_catalog_publications") else set()

        legacy_authority = "owner-catalog-reconciliation"
        legacy_ids: set[str] = set()
        if _table_exists(conn, "owner_catalog_reconciliation_migrations") and _table_exists(
            conn, "owner_catalog_reconciliation_rows"
        ):
            latest = conn.execute(
                """
                SELECT migration_id FROM owner_catalog_reconciliation_migrations
                ORDER BY applied_at DESC, migration_id DESC LIMIT 1
                """
            ).fetchone()
            if latest:
                legacy_ids = _first_column(
                    conn,
                    """
                    SELECT media_id FROM owner_catalog_reconciliation_rows
                    WHERE migration_id = ?
                      AND migration_state IN ('authoritative', 'backfill', 'unresolved')
                    """,
                    (str(latest[0]),),
                )
        if not legacy_ids:
            # Pre-PBE-173 compatibility only. Normal production projection uses
            # the durable Owner reconciliation ledger above, never the manifest.
            legacy_authority = "pre-migration-expo-fallback"
            manifest_path = expo_manifest_path if expo_manifest_path.is_absolute() else repo_root / expo_manifest_path
            manifest = _read_json(manifest_path, {})
            legacy_ids = {
                str(photo.get("id") or "").strip()
                for photo in manifest.get("photos", [])
                if isinstance(photo, dict) and str(photo.get("id") or "").strip()
            }

        lifecycle = media_lifecycle_snapshot(repo_root, conn=conn, sync_compat=False)
        blocked_ids = {
            str(value or "").strip()
            for value in lifecycle.get("blockedPhotoIds", [])
            if str(value or "").strip()
        }
        # Lifecycle blocks win over every approval or legacy baseline source.
        eligible_ids = (title_keyword_ids | sidecar_ids | native_ids | legacy_ids) - blocked_ids

        pricing = _read_json(repo_root / DEFAULT_PRODUCT_PRICING, {})
        retired_media_types = {
            str(value or "").strip().casefold()
            for value in (pricing.get("storefrontPolicy") or {}).get("retiredMediaTypes", [])
            if str(value or "").strip()
        }
        snapshot = {
            "schema": "photosbyelie.public-catalog-policy.v1",
            "eligibleMediaIds": sorted(eligible_ids),
            "blockedMediaIds": sorted(blocked_ids),
            "retiredMediaTypes": sorted(retired_media_types),
            "sourceCounts": {
                "titleKeywordApplied": len(title_keyword_ids),
                "sidecarUploadedApproved": len(sidecar_ids),
                "nativeCatalogApproved": len(native_ids),
                "legacyExpoBaseline": len(legacy_ids),
                "eligibleUnion": len(eligible_ids),
                "blocked": len(blocked_ids),
            },
            "legacyAuthority": legacy_authority,
        }
        if authority_path is not None:
            snapshot["ownerAuthority"] = {
                "path": str(authority_path),
                "sha256": _sha256(authority_path),
                "bytes": authority_path.stat().st_size,
                "mode": "read-only",
            }
        return snapshot
    finally:
        if owns_conn:
            conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument(
        "--owner-db",
        type=Path,
        required=True,
        help="Absolute path to the reviewed Owner.sqlite authority snapshot (opened read-only).",
    )
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    snapshot = public_catalog_policy_snapshot(
        args.repo_root.resolve(),
        owner_db_path=args.owner_db,
    )
    if args.json:
        print(json.dumps(snapshot, ensure_ascii=False))
    else:
        counts = snapshot["sourceCounts"]
        print(", ".join(f"{key}={value}" for key, value in counts.items()))


if __name__ == "__main__":
    main()
