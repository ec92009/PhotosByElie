#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path

from export_photos_data import (
    DEFAULT_REGULAR_CAP,
    blacklist_ids_from_payload,
    country_assignments_from_payload,
    regular_state_from_payload,
    reserve_only_ids_from_payload,
    write_photos_data,
)

COUNTRY_ASSIGNMENT_LABELS = {
    "france": "France",
    "usa": "USA",
    "spain": "Spain",
    "mexico": "Mexico",
    "portugal": "Portugal",
    "slovakia": "Slovakia",
}


def load_builder(repo_root: Path):
    script_path = repo_root / "scripts" / "build_lightroom_thumbnails.py"
    spec = importlib.util.spec_from_file_location("thumb_builder", script_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def load_manifest(path: Path) -> tuple[dict, dict[str, dict]]:
    payload = json.loads(path.read_text())
    rows = {row["relative_path"]: row for row in payload["photos"]}
    return payload, rows


def args_from_manifest(payload: dict):
    selection = payload.get("selection", {})
    derivatives = payload.get("derivatives", {})
    return argparse.Namespace(
        source_root=Path(payload.get("source_root_hint") or ""),
        select=selection.get("select") or "lightroom",
        label=selection.get("label") or "green",
        min_rating=selection.get("min_rating") or 4,
        years="",
        force_country=selection.get("force_country") or "",
        gallery_max=derivatives.get("gallery_max") or 900,
        detail_max=derivatives.get("detail_max") or 1800,
        watermark=derivatives.get("watermark") or "PhotosByElie",
    )


def move_derivative(repo_root: Path, relative_path: str) -> dict | None:
    source = repo_root / relative_path
    if not source.exists():
        return None
    destination = repo_root / "assets" / ".moderation-hidden" / relative_path
    destination.parent.mkdir(parents=True, exist_ok=True)
    source.replace(destination)
    return {
        "from": relative_path,
        "to": destination.relative_to(repo_root).as_posix(),
    }


def move_regular_derivatives(repo_root: Path, photo_ids: set[str]) -> list[dict]:
    regular_manifest = repo_root / "assets/regular/manifest.json"
    if not regular_manifest.exists():
        return []
    payload = json.loads(regular_manifest.read_text())
    moved = []
    for row in payload.get("photos", []):
        if row.get("id") not in photo_ids:
            continue
        for derivative_rel in (row.get("derivatives") or {}).values():
            moved_row = move_derivative(repo_root, derivative_rel)
            if moved_row:
                moved.append({"id": row.get("id"), "asset": moved_row})
    return moved


def regular_cap_from_payload(payload: dict, fallback: int = DEFAULT_REGULAR_CAP) -> int:
    value = payload.get("regular_cap")
    if isinstance(value, int) and value > 0:
        return value
    return fallback


def apply_country_assignments(rows: dict[str, dict], assignments: dict[str, str]) -> list[dict]:
    changed = []
    for row in rows.values():
        photo_id = row.get("id")
        gallery_slug = assignments.get(photo_id)
        if not gallery_slug:
            continue
        row["gallery_country"] = {
            "slug": gallery_slug,
            "label": COUNTRY_ASSIGNMENT_LABELS[gallery_slug],
            "source": "owner",
        }
        row["owner_classification"] = {
            "gallery_country": gallery_slug,
        }
        changed.append({
            "id": photo_id,
            "relative_path": row.get("relative_path"),
            "gallery_country": gallery_slug,
        })
    return changed


def apply_curation_pass(repo_root: Path, curation_path: Path, regular_cap: int | None) -> None:
    payload = json.loads(curation_path.read_text(encoding="utf-8"))
    photo_ids = blacklist_ids_from_payload(payload)
    regular_state = regular_state_from_payload(payload)
    reserve_only_ids = reserve_only_ids_from_payload(payload)
    country_assignments = country_assignments_from_payload(payload)
    resolved_regular_cap = regular_cap if regular_cap and regular_cap > 0 else regular_cap_from_payload(payload)
    builder = load_builder(repo_root)
    curation_log = {
        "regular": move_regular_derivatives(repo_root, photo_ids),
        "ingest": [],
        "country_assignments": [],
    }

    for manifest_rel in ["assets/lightroom/manifest.json", "assets/lightroom-ai/manifest.json"]:
        manifest_path = repo_root / manifest_rel
        if not manifest_path.exists():
            continue
        manifest_payload, rows = load_manifest(manifest_path)
        curation_log["country_assignments"].extend(apply_country_assignments(rows, country_assignments))
        for relative_path, row in list(rows.items()):
            if row.get("id") not in photo_ids:
                continue
            moved = []
            for derivative_rel in row.get("derivatives", {}).values():
                moved_row = move_derivative(repo_root, "assets/" + ("lightroom-ai/" if "lightroom-ai" in manifest_rel else "lightroom/") + derivative_rel)
                if moved_row:
                    moved.append(moved_row)
            curation_log["ingest"].append({
                "id": row.get("id"),
                "relative_path": relative_path,
                "manifest": manifest_rel,
                "moved": moved,
            })
            rows.pop(relative_path, None)
        builder.write_manifest(manifest_path, rows, args_from_manifest(manifest_payload))
        builder.write_keyword_index(manifest_path.with_name("keywords.json"), rows)
        builder.write_collection_index(manifest_path.with_name("collections.json"), rows)

    log_dir = repo_root / "assets" / ".moderation-hidden"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{curation_path.stem}.applied.json"
    log_path.write_text(json.dumps({"curation_pass": str(curation_path), "applied": curation_log}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_photos_data(
        repo_root,
        regular_cap=resolved_regular_cap,
        blacklist_ids=photo_ids,
        pinned_regular_ids=regular_state,
        reserve_only_ids=reserve_only_ids,
        country_assignments=country_assignments,
    )


def apply_blacklist(repo_root: Path, blacklist_path: Path, regular_cap: int | None) -> None:
    apply_curation_pass(repo_root, blacklist_path, regular_cap)


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply a PhotosByElie Curation Pass.")
    parser.add_argument("curation_pass", type=Path)
    parser.add_argument("--regular-cap", type=int, default=None)
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    apply_curation_pass(repo_root, args.curation_pass.expanduser().resolve(), args.regular_cap)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
