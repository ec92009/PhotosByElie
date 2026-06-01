#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter
from pathlib import Path
from typing import Any

from import_eligibility import manifest_rows, photo_id_for_row, row_import_eligible, source_filename, source_paths_from_row


DEFAULT_MANIFEST = Path("tmp/import-cache/manifest.json")
DEFAULT_OWNER_DB = Path("assets/owner-actions/Owner.sqlite")
DEFAULT_REPORT = Path(".review-logs/import-eligibility-audit.json")
DEFAULT_PUBLIC_BUCKET = "photosbyelie-public"
DEFAULT_PRIVATE_BUCKET = "photosbyelie-private"


def load_json(path: Path, fallback: object) -> object:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return fallback


def r2_current_objects(owner_db: Path, photo_ids: set[str]) -> dict[str, list[dict[str, Any]]]:
    if not owner_db.exists() or not photo_ids:
        return {}
    conn = sqlite3.connect(owner_db)
    conn.row_factory = sqlite3.Row
    try:
        output: dict[str, list[dict[str, Any]]] = {}
        for photo_id in sorted(photo_ids):
            rows = conn.execute(
                """
                SELECT bucket, object_key, object_kind, lifecycle_state, bytes
                FROM r2_objects
                WHERE photo_id = ? AND lifecycle_state = 'current'
                ORDER BY bucket, object_key
                """,
                (photo_id,),
            ).fetchall()
            if rows:
                output[photo_id] = [dict(row) for row in rows]
        return output
    finally:
        conn.close()


def expected_private_keys(row: dict[str, Any]) -> list[str]:
    photo_id = photo_id_for_row(row)
    if not photo_id:
        return []
    suffix = Path(source_filename(row)).suffix.lower().lstrip(".") or "jpg"
    if suffix == "jpeg":
        suffix = "jpg"
    return [
        f"masters/{photo_id}.{suffix}",
        f"renders/{photo_id}_6mp.jpg",
        f"renders/{photo_id}_3mp.jpg",
        f"renders/{photo_id}_1mp.jpg",
    ]


def expected_public_keys(row: dict[str, Any]) -> list[str]:
    photo_id = photo_id_for_row(row)
    if not photo_id:
        return []
    return [
        f"expo/{photo_id}_900.jpg",
        f"expo/{photo_id}_1800.jpg",
        f"expo/{photo_id}_short_5s_720p.mp4",
    ]


def audit(manifest_path: Path, owner_db: Path) -> dict[str, Any]:
    rows = manifest_rows(load_json(manifest_path, {}))
    kind_counts: Counter[str] = Counter()
    ineligible: list[dict[str, Any]] = []
    for row in rows:
        ok, kind, reason = row_import_eligible(row)
        kind_counts[kind] += 1
        if ok:
            continue
        photo_id = photo_id_for_row(row)
        if not photo_id:
            continue
        ineligible.append(
            {
                "id": photo_id,
                "kind": kind,
                "reason": reason,
                "rating": row.get("rating"),
                "label": row.get("label"),
                "relativePath": row.get("relative_path") or row.get("relativePath") or "",
                "sourcePaths": source_paths_from_row(row),
                "publicKeys": expected_public_keys(row),
                "privateKeys": expected_private_keys(row),
            }
        )
    current = r2_current_objects(owner_db, {row["id"] for row in ineligible})
    for row in ineligible:
        row["currentR2"] = current.get(row["id"], [])
    public_current = sum(1 for row in ineligible for item in row["currentR2"] if item.get("bucket") == DEFAULT_PUBLIC_BUCKET)
    private_current = sum(1 for row in ineligible for item in row["currentR2"] if item.get("bucket") == DEFAULT_PRIVATE_BUCKET)
    return {
        "schema": "photosbyelie.import-eligibility-audit.v1",
        "manifest": str(manifest_path),
        "ownerDb": str(owner_db),
        "policy": "Camera source rows must be Green with rating >= 4. Apple Photos and AI/Leonardo rows are not filtered by this audit.",
        "manifestRows": len(rows),
        "sourceKindCounts": dict(sorted(kind_counts.items())),
        "ineligibleCount": len(ineligible),
        "currentR2Objects": public_current + private_current,
        "currentPublicR2Objects": public_current,
        "currentPrivateR2Objects": private_current,
        "ineligible": ineligible,
    }


def write_delete_plan(path: Path, report: dict[str, Any]) -> None:
    public_keys: set[str] = set()
    private_keys: set[str] = set()
    photo_ids: list[str] = []
    photos: list[dict[str, Any]] = []
    for row in report.get("ineligible") or []:
        photo_id = str(row.get("id") or "").strip()
        if not photo_id:
            continue
        photo_ids.append(photo_id)
        public_keys.update(str(key) for key in row.get("publicKeys") or [] if str(key).strip())
        private_keys.update(str(key) for key in row.get("privateKeys") or [] if str(key).strip())
        for item in row.get("currentR2") or []:
            bucket = item.get("bucket")
            key = str(item.get("object_key") or "").strip()
            if not key:
                continue
            if bucket == DEFAULT_PUBLIC_BUCKET:
                public_keys.add(key)
            elif bucket == DEFAULT_PRIVATE_BUCKET:
                private_keys.add(key)
        photos.append(
            {
                "id": photo_id,
                "reason": row.get("reason") or "ineligible Camera source",
                "source_paths": row.get("sourcePaths") or [],
            }
        )
    payload = {
        "schema": "photosbyelie.r2-delete-plan.v1",
        "reason": "Camera import eligibility enforcement: source is not Green with 4+ stars.",
        "photo_ids": sorted(set(photo_ids)),
        "photos": photos,
        "public_preview_keys": sorted(public_keys),
        "private_keys": sorted(private_keys),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit import manifest rows against source eligibility policy.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--owner-db", type=Path, default=DEFAULT_OWNER_DB)
    parser.add_argument("--output", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--write-delete-plan", type=Path, default=None)
    parser.add_argument("--fail-on-ineligible", action="store_true")
    args = parser.parse_args()

    report = audit(args.manifest, args.owner_db)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.write_delete_plan:
        write_delete_plan(args.write_delete_plan, report)
    print(
        "Camera import eligibility: "
        f"{report['ineligibleCount']} ineligible rows, "
        f"{report['currentR2Objects']} current R2 objects. "
        f"Wrote {args.output}."
    )
    return 1 if args.fail_on_ineligible and report["ineligibleCount"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
