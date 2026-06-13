#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from import_source_anchor import row_freshness_key, row_source_modified_ns, source_paths_from_row
from import_eligibility import manifest_rows, photo_id_for_row, source_filename
from media_keys import DEFAULT_PUBLIC_PREFIX, private_master_key, private_render_key, public_preview_key


DEFAULT_MANIFEST = Path("tmp/import-cache/manifest.json")
DEFAULT_OUTPUT = Path(".review-logs/import-source-duplicates-audit.json")
DEFAULT_PLAN = Path(".review-logs/import-source-duplicates-cleanup-plan.json")
DEFAULT_PUBLIC_BUCKET = "photosbyelie-public"
DEFAULT_PRIVATE_BUCKET = "photosbyelie-private"
DEFAULT_PRIVATE_PREFIX = "masters"


def load_json(path: Path, fallback: object) -> object:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return fallback


def media_type_for_row(row: dict[str, Any]) -> str:
    value = str(row.get("media_type") or row.get("mediaType") or "").strip().lower()
    if value:
        return value
    suffix = Path(source_filename(row)).suffix.lower()
    return "video" if suffix in {".mov", ".mp4", ".m4v"} else "photo"


def row_summary(row: dict[str, Any]) -> dict[str, Any]:
    photo_id = photo_id_for_row(row)
    source_path = sorted(source_paths_from_row(row))[0]
    media_type = media_type_for_row(row)
    return {
        "id": photo_id,
        "relativePath": row.get("relative_path") or row.get("relativePath") or "",
        "sourcePath": source_path,
        "sourceModifiedNs": row_source_modified_ns(row),
        "sourceCheckpoint": row.get("source_checkpoint") or "",
        "publicPreviewKeys": [
            public_preview_key(DEFAULT_PUBLIC_PREFIX, photo_id, "gallery", media_type),
            public_preview_key(DEFAULT_PUBLIC_PREFIX, photo_id, "detail", media_type),
        ],
        "privateKeys": private_keys_for_row(row),
    }


def private_keys_for_row(row: dict[str, Any]) -> list[str]:
    photo_id = photo_id_for_row(row)
    if not photo_id:
        return []
    filename = source_filename(row)
    keys = [private_master_key(DEFAULT_PRIVATE_PREFIX, photo_id, filename)]
    if media_type_for_row(row) == "photo":
        keys.extend(private_render_key(photo_id, product_id) for product_id in ("jpg-6mp", "jpg-3mp", "jpg-1mp"))
    return keys


def audit(manifest_path: Path) -> dict[str, Any]:
    rows = manifest_rows(load_json(manifest_path, {}))
    groups: dict[str, list[dict[str, Any]]] = {}
    skipped_without_source = 0
    for row in rows:
        paths = sorted(source_paths_from_row(row))
        if not paths:
            skipped_without_source += 1
            continue
        groups.setdefault(paths[0], []).append(row)

    candidates: list[dict[str, Any]] = []
    for source_path, matches in sorted(groups.items()):
        ids = {photo_id_for_row(row) for row in matches if photo_id_for_row(row)}
        relative_paths = {
            str(row.get("relative_path") or row.get("relativePath") or "")
            for row in matches
            if str(row.get("relative_path") or row.get("relativePath") or "").strip()
        }
        if len(matches) < 2 or (len(ids) < 2 and len(relative_paths) < 2):
            continue
        canonical = max(matches, key=row_freshness_key)
        stale = [row for row in matches if row is not canonical]
        candidates.append(
            {
                "sourcePath": source_path,
                "candidateCount": len(matches),
                "canonical": row_summary(canonical),
                "duplicates": [row_summary(row) for row in stale],
            }
        )

    return {
        "schema": "photosbyelie.import-source-duplicates-audit.v1",
        "manifest": str(manifest_path),
        "manifestRows": len(rows),
        "sourcePathGroups": len(groups),
        "rowsWithoutSourcePath": skipped_without_source,
        "duplicateSourcePathCount": len(candidates),
        "duplicateMediaRowCount": sum(len(item["duplicates"]) for item in candidates),
        "candidates": candidates,
    }


def write_cleanup_plan(path: Path, report: dict[str, Any]) -> None:
    stale_public_keys: set[str] = set()
    stale_private_keys: set[str] = set()
    remove_manifest_relative_paths: set[str] = set()
    remove_media_ids: set[str] = set()
    for candidate in report.get("candidates") or []:
        for row in candidate.get("duplicates") or []:
            media_id = str(row.get("id") or "").strip()
            relative_path = str(row.get("relativePath") or "").strip()
            if media_id:
                remove_media_ids.add(media_id)
            if relative_path:
                remove_manifest_relative_paths.add(relative_path)
            stale_public_keys.update(str(key) for key in row.get("publicPreviewKeys") or [] if str(key).strip())
            stale_private_keys.update(str(key) for key in row.get("privateKeys") or [] if str(key).strip())

    payload = {
        "schema": "photosbyelie.import-source-duplicates-cleanup-plan.v1",
        "mode": "audit-only",
        "reversibleBeforeDelete": True,
        "instructions": [
            "Review the audit candidates before deleting any media.",
            "Back up the manifest/catalog state and verify canonical rows in Owner before applying cleanup.",
            "Delete stale R2 objects only after the kept IDs and source paths have been confirmed.",
        ],
        "manifest": report.get("manifest"),
        "duplicateSourcePathCount": report.get("duplicateSourcePathCount", 0),
        "removeManifestRelativePaths": sorted(remove_manifest_relative_paths),
        "removeMediaIds": sorted(remove_media_ids),
        "stalePublicPreviewKeys": sorted(stale_public_keys),
        "stalePrivateKeys": sorted(stale_private_keys),
        "publicBucket": DEFAULT_PUBLIC_BUCKET,
        "privateBucket": DEFAULT_PRIVATE_BUCKET,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit duplicate import rows that share the same full source path.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--write-cleanup-plan", type=Path, default=DEFAULT_PLAN)
    parser.add_argument("--fail-on-duplicates", action="store_true")
    args = parser.parse_args()

    report = audit(args.manifest)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.write_cleanup_plan:
        write_cleanup_plan(args.write_cleanup_plan, report)
    print(
        "Import source duplicate audit: "
        f"{report['duplicateSourcePathCount']} duplicate source paths, "
        f"{report['duplicateMediaRowCount']} duplicate media rows. "
        f"Wrote {args.output}."
    )
    return 1 if args.fail_on_duplicates and report["duplicateSourcePathCount"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
