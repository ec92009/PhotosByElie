#!/usr/bin/env python3
"""Find imported media whose source path matches a discarded/tombstoned source.

This is intentionally read-only. It uses local ingest manifests for source-path
history and Owner.sqlite R2 object state for the "currently on R2" view.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import re
import sqlite3
from pathlib import Path, PurePosixPath
from typing import Any


DEFAULT_TOMBSTONE = Path("assets/discarded/discarded-photo-ids.json")
DEFAULT_DISCARDED_MANIFEST = Path("assets/discarded-media-manifest.json")
DEFAULT_OWNER_DB = Path("assets/owner-actions/Owner.sqlite")
DEFAULT_OUTPUT = Path(".review-logs/tombstone-source-dodgers.json")


def load_json(path: Path, fallback: object) -> object:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return fallback


def normalize_source_path(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    try:
        return Path(text).expanduser().resolve(strict=False).as_posix()
    except OSError:
        return Path(text).expanduser().as_posix()


def source_paths_from_object(value: Any) -> set[str]:
    paths: set[str] = set()
    if isinstance(value, dict):
        for key in ("source_path_hint", "sourcePath", "source_path", "sourceFile", "path"):
            normalized = normalize_source_path(value.get(key))
            if normalized:
                paths.add(normalized)
        for key in ("source_paths", "sourcePaths", "sourceFiles", "source_files"):
            paths.update(source_paths_from_object(value.get(key)))
        source_file = value.get("source_file")
        if isinstance(source_file, dict):
            paths.update(source_paths_from_object(source_file))
    elif isinstance(value, list):
        for item in value:
            paths.update(source_paths_from_object(item))
    elif isinstance(value, str):
        normalized = normalize_source_path(value)
        if normalized:
            paths.add(normalized)
    return paths


def discarded_ids_from_payload(payload: object) -> set[str]:
    if not isinstance(payload, dict):
        return set()
    ids: set[str] = set()
    for key in ("photo_ids", "discardedPhotoIds"):
        values = payload.get(key)
        if isinstance(values, list):
            ids.update(str(value) for value in values if str(value).strip())
    photos = payload.get("photos")
    if isinstance(photos, list):
        for photo in photos:
            if isinstance(photo, dict) and str(photo.get("id") or "").strip():
                ids.add(str(photo["id"]))
    return ids


def source_path_suffixes(paths: set[str]) -> set[str]:
    suffixes = set()
    for value in paths:
        text = PurePosixPath(value).as_posix().strip("/")
        if "/" in text:
            suffixes.add(text)
    return suffixes


def source_path_matches(value: str, blocked_paths: set[str], blocked_suffixes: set[str]) -> bool:
    if value in blocked_paths:
        return True
    candidate = PurePosixPath(value).as_posix().strip("/")
    return any(candidate == suffix or candidate.endswith(f"/{suffix}") for suffix in blocked_suffixes)


def key_photo_id(key: str) -> str:
    value = str(key or "")
    if value.startswith("masters/"):
        rest = value[len("masters/") :]
        return rest.split("/")[0] if "/" in rest else re.sub(r"\.[A-Za-z0-9]+$", "", rest)
    if value.startswith("renders/"):
        rest = value[len("renders/") :]
        return rest.split("/")[0] if "/" in rest else re.sub(r"_(?:1|3|6)mp\.jpg$", "", rest, flags=re.I)
    if value.startswith("expo/"):
        name = PurePosixPath(value).name
        return re.sub(r"_(?:900|1800|short_5s_720p)\.(?:jpg|mp4)$", "", name, flags=re.I)
    return ""


def collect_manifest_rows(repo_root: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    tmp_root = repo_root / "tmp"
    if not tmp_root.exists():
        return rows
    for manifest_path in sorted(tmp_root.glob("**/manifest.json")):
        payload = load_json(manifest_path, {})
        manifest_rows = payload.get("photos") if isinstance(payload, dict) else None
        if not isinstance(manifest_rows, list):
            continue
        for row in manifest_rows:
            if isinstance(row, dict):
                rows.append({**row, "_manifest_path": manifest_path.relative_to(repo_root).as_posix()})
    return rows


def current_r2_objects(repo_root: Path, owner_db: Path, candidate_ids: set[str]) -> dict[str, list[dict[str, Any]]]:
    db_path = owner_db if owner_db.is_absolute() else repo_root / owner_db
    if not db_path.exists() or not candidate_ids:
        return {}
    grouped: dict[str, list[dict[str, Any]]] = {photo_id: [] for photo_id in candidate_ids}
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        for row in conn.execute(
            """
            SELECT bucket, object_key, photo_id, object_kind, bytes, last_seen_at, updated_at
              FROM r2_objects
             WHERE lifecycle_state = 'current'
            """
        ):
            photo_id = str(row["photo_id"] or "") or key_photo_id(str(row["object_key"] or ""))
            if photo_id not in candidate_ids:
                continue
            grouped.setdefault(photo_id, []).append(dict(row))
    finally:
        conn.close()
    return {photo_id: objects for photo_id, objects in grouped.items() if objects}


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit source-path tombstone dodgers in current manifests/R2 state.")
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--tombstone", type=Path, default=DEFAULT_TOMBSTONE)
    parser.add_argument("--discarded-manifest", type=Path, default=DEFAULT_DISCARDED_MANIFEST)
    parser.add_argument("--owner-db", type=Path, default=DEFAULT_OWNER_DB)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    repo_root = args.repo_root.resolve()
    tombstone = load_json(repo_root / args.tombstone, {})
    discarded_manifest = load_json(repo_root / args.discarded_manifest, {})
    discarded_ids = discarded_ids_from_payload(tombstone) | discarded_ids_from_payload(discarded_manifest)
    rows = collect_manifest_rows(repo_root)

    blocked_source_paths = source_paths_from_object(tombstone) | source_paths_from_object(discarded_manifest)
    for row in rows:
        if str(row.get("id") or "") in discarded_ids:
            blocked_source_paths.update(source_paths_from_object(row))
    blocked_suffixes = source_path_suffixes(blocked_source_paths)

    dodgers: list[dict[str, Any]] = []
    for row in rows:
        photo_id = str(row.get("id") or "")
        if not photo_id or photo_id in discarded_ids:
            continue
        matching_paths = [
            path
            for path in sorted(source_paths_from_object(row))
            if source_path_matches(path, blocked_source_paths, blocked_suffixes)
        ]
        if matching_paths:
            title = str(row.get("title") or "").strip()
            metadata = row.get("metadata")
            if not title and isinstance(metadata, list) and metadata and isinstance(metadata[0], dict):
                title = str(metadata[0].get("value") or "").strip()
            dodgers.append(
                {
                    "media_id": photo_id,
                    "title": title,
                    "relative_path": row.get("relative_path"),
                    "manifest": row.get("_manifest_path"),
                    "matching_source_paths": matching_paths,
                }
            )

    r2_by_id = current_r2_objects(repo_root, args.owner_db, {row["media_id"] for row in dodgers})
    for row in dodgers:
        row["current_r2_objects"] = r2_by_id.get(row["media_id"], [])

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "discarded_photo_ids": len(discarded_ids),
        "discarded_source_paths": len(blocked_source_paths),
        "manifest_dodger_count": len(dodgers),
        "r2_dodger_count": sum(1 for row in dodgers if row["current_r2_objects"]),
        "dodgers": dodgers,
    }
    output = args.output if args.output.is_absolute() else repo_root / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        "Tombstone source-path dodgers: "
        f"{payload['manifest_dodger_count']} in manifests, {payload['r2_dodger_count']} with current R2 objects. "
        f"Wrote {output.relative_to(repo_root) if output.is_relative_to(repo_root) else output}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
