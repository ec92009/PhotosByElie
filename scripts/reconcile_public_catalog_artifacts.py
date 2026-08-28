#!/usr/bin/env python3
"""Reconcile public catalog projections with Owner publication policy."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from owner_catalog_projection import project_catalog, projection_snapshot
from owner_state_db import DEFAULT_DB as DEFAULT_OWNER_DB
from public_catalog_policy import public_catalog_policy_snapshot


CATALOG_PATH = Path("assets/catalog/photosbyelie.sqlite")
EXPO_MANIFEST_PATH = Path("assets/expo-manifest.json")
PROJECTION_PATHS = (
    Path("photos-data.js"),
    Path("home-data.js"),
    Path("assets/media-sidecar.json"),
    Path("worker/photos-catalog.generated.mjs"),
)


def _owner_projection_status(owner_db_path: Path, catalog_path: Path) -> dict[str, Any]:
    conn = sqlite3.connect(f"{owner_db_path.as_uri()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'owner_public_catalog_projections'"
        ).fetchone()
        snapshot = projection_snapshot(conn, ensure_schema=False) if exists else None
    finally:
        conn.close()
    if snapshot is None:
        raise RuntimeError("Owner public catalog projection has not been initialized")
    local_sha = ""
    if catalog_path.exists():
        import hashlib

        local_sha = hashlib.sha256(catalog_path.read_bytes()).hexdigest()
    return {
        "revision": snapshot["revision"],
        "approvedSha256": snapshot["sha256"],
        "approvedMediaCount": snapshot["mediaCount"],
        "localSha256": local_sha,
        "localMatchesOwner": local_sha == snapshot["sha256"],
    }


def _read_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        return fallback


def _manifest_media_type(photo: dict[str, Any]) -> str:
    explicit = str(photo.get("media_type") or photo.get("mediaType") or "").strip().casefold()
    if explicit:
        return explicit
    detail = str((photo.get("derivatives") or {}).get("detail") or "").strip().casefold()
    return "video" if detail.endswith(".mp4") else "photo"


def filter_expo_manifest(
    manifest: dict[str, Any],
    *,
    eligible_ids: set[str],
    blocked_ids: set[str],
    retired_media_types: set[str],
) -> tuple[dict[str, Any], dict[str, int]]:
    kept: list[dict[str, Any]] = []
    removed_blocked = 0
    removed_not_eligible = 0
    removed_retired = 0
    for raw in manifest.get("photos", []):
        if not isinstance(raw, dict):
            continue
        photo_id = str(raw.get("id") or "").strip()
        if not photo_id or photo_id not in eligible_ids:
            removed_not_eligible += 1
            continue
        if photo_id in blocked_ids:
            removed_blocked += 1
            continue
        if _manifest_media_type(raw) in retired_media_types:
            removed_retired += 1
            continue
        kept.append(raw)
    payload = dict(manifest)
    payload["photos"] = kept
    payload["photos_count"] = len(kept)
    return payload, {
        "before": len(manifest.get("photos", [])),
        "after": len(kept),
        "removedBlocked": removed_blocked,
        "removedNotEligible": removed_not_eligible,
        "removedRetiredMediaType": removed_retired,
    }


def _catalog_counts(path: Path, policy: dict[str, Any]) -> dict[str, int]:
    eligible_ids = set(policy["eligibleMediaIds"])
    blocked_ids = set(policy["blockedMediaIds"])
    retired_media_types = set(policy["retiredMediaTypes"])
    conn = sqlite3.connect(path)
    try:
        rows = conn.execute(
            """
            SELECT media_items.media_id, lower(media_types.code)
            FROM media_items JOIN media_types USING (media_type_id)
            """
        ).fetchall()
    finally:
        conn.close()
    removed_blocked = sum(media_id in blocked_ids for media_id, _media_type in rows)
    removed_not_eligible = sum(media_id not in eligible_ids for media_id, _media_type in rows)
    removed_retired = sum(media_type in retired_media_types for _media_id, media_type in rows)
    allowed = {
        media_id
        for media_id, media_type in rows
        if media_id in eligible_ids and media_id not in blocked_ids and media_type not in retired_media_types
    }
    return {
        "before": len(rows),
        "after": len(allowed),
        "removedUnion": len(rows) - len(allowed),
        "removedBlocked": removed_blocked,
        "removedNotEligible": removed_not_eligible,
        "removedRetiredMediaType": removed_retired,
    }


def _write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, prefix=path.name, suffix=".tmp", delete=False) as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        temp_path = Path(handle.name)
    os.replace(temp_path, path)


def _refresh_projections(repo_root: Path) -> list[str]:
    commands = [
        ["node", "scripts/write_catalog_tsv.cjs", "--bootstrap-only"],
        ["node", "scripts/write_media_sidecar.mjs"],
        ["node", "scripts/write_worker_catalog.mjs"],
    ]
    completed_steps: list[str] = []
    for command in commands:
        subprocess.run(command, cwd=repo_root, check=True)
        completed_steps.append(" ".join(command))
    return completed_steps


def reconcile(
    repo_root: Path,
    *,
    apply: bool = False,
    owner_db_path: Path | None = None,
) -> dict[str, Any]:
    repo_root = repo_root.resolve()
    catalog_path = repo_root / CATALOG_PATH
    manifest_path = repo_root / EXPO_MANIFEST_PATH
    authority_path = (owner_db_path or (repo_root / DEFAULT_OWNER_DB)).resolve()
    projection_status = _owner_projection_status(authority_path, catalog_path)
    policy = public_catalog_policy_snapshot(repo_root, owner_db_path=owner_db_path)
    catalog_summary = _catalog_counts(catalog_path, policy)
    manifest = _read_json(manifest_path, {})
    filtered_manifest, expo_summary = filter_expo_manifest(
        manifest,
        eligible_ids=set(policy["eligibleMediaIds"]),
        blocked_ids=set(policy["blockedMediaIds"]),
        retired_media_types=set(policy["retiredMediaTypes"]),
    )
    result: dict[str, Any] = {
        "applied": apply,
        "policy": policy["sourceCounts"],
        "catalog": catalog_summary,
        "ownerProjection": projection_status,
        "expoManifest": expo_summary,
        "projectionSteps": [],
    }
    if not apply:
        return result

    protected_paths = (CATALOG_PATH, EXPO_MANIFEST_PATH, *PROJECTION_PATHS)
    with tempfile.TemporaryDirectory(prefix="pbe-catalog-reconcile-") as temp_name:
        temp_root = Path(temp_name)
        existing: set[Path] = set()
        for relative in protected_paths:
            source = repo_root / relative
            if source.exists():
                target = temp_root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
                existing.add(relative)
        try:
            projection_result = project_catalog(authority_path, catalog_path)
            result["ownerProjection"] = {
                **projection_status,
                **projection_result,
                "localSha256": projection_result["sha256"],
                "localMatchesOwner": True,
            }
            _write_json_atomic(manifest_path, filtered_manifest)
            result["projectionSteps"] = _refresh_projections(repo_root)
        except Exception:
            for relative in protected_paths:
                current = repo_root / relative
                backup = temp_root / relative
                if relative in existing:
                    current.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(backup, current)
                elif current.exists():
                    current.unlink()
            raise

    conn = sqlite3.connect(catalog_path)
    try:
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        foreign_keys = conn.execute("PRAGMA foreign_key_check").fetchall()
        final_count = int(conn.execute("SELECT count(*) FROM media_items").fetchone()[0])
    finally:
        conn.close()
    if integrity != "ok" or foreign_keys:
        raise RuntimeError(f"reconciled catalog failed integrity checks: integrity={integrity}, foreign_keys={foreign_keys[:5]}")
    if final_count != projection_status["approvedMediaCount"]:
        raise RuntimeError(
            f"projected catalog row count {final_count} does not match Owner authority "
            f"{projection_status['approvedMediaCount']}"
        )
    result["catalogIntegrity"] = integrity
    result["catalogFinalCount"] = final_count
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--apply", action="store_true", help="atomically replace catalog artifacts after a dry-run review")
    parser.add_argument(
        "--owner-db",
        type=Path,
        default=None,
        help="absolute reviewed Owner.sqlite authority snapshot used for lifecycle eligibility",
    )
    args = parser.parse_args()
    print(json.dumps(reconcile(args.repo_root, apply=args.apply, owner_db_path=args.owner_db), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
