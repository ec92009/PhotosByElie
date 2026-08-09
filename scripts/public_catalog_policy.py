#!/usr/bin/env python3
"""Resolve the authoritative set of media allowed in the public catalog."""

from __future__ import annotations

import argparse
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


def _first_column(conn: sqlite3.Connection, sql: str) -> set[str]:
    return {
        str(row[0] or "").strip()
        for row in conn.execute(sql).fetchall()
        if str(row[0] or "").strip()
    }


def public_catalog_policy_snapshot(
    repo_root: Path,
    *,
    conn: sqlite3.Connection | None = None,
    expo_manifest_path: Path = DEFAULT_EXPO_MANIFEST,
) -> dict[str, Any]:
    """Return public eligibility from Owner SQLite plus the tracked legacy baseline.

    The Expo manifest is a compatibility baseline for media published before Owner
    SQLite had complete audit coverage. Current Owner approvals may come from the
    title/keyword workflow, Sidecar Upload Bridge, or native publication audit.
    Lifecycle blocks always win over every approval source.
    """
    owns_conn = conn is None
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
        return {
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
        }
    finally:
        if owns_conn:
            conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    snapshot = public_catalog_policy_snapshot(args.repo_root.resolve())
    if args.json:
        print(json.dumps(snapshot, ensure_ascii=False))
    else:
        counts = snapshot["sourceCounts"]
        print(", ".join(f"{key}={value}" for key, value in counts.items()))


if __name__ == "__main__":
    main()
