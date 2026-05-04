#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import random
import re
import shutil
from collections import defaultdict
from pathlib import Path

LABELS = {
    "france": ("01", "France", "france-gallery", "Saturn Lightroom archive selections prepared from the Camera source."),
    "usa": ("02", "USA", "usa-gallery", "Saturn Lightroom archive selections prepared from the Camera source."),
    "spain": ("03", "Spain", "spain-gallery", "Saturn Lightroom archive selections prepared from the Camera source."),
    "mexico": ("04", "Mexico", "mexico-gallery", "Saturn Lightroom archive selections prepared from the Camera source."),
    "ai": ("05", "AI", "ai-gallery", "Leonardo archive selections prepared from the Saturn Lightroom AI source."),
    "portugal": ("06", "Portugal", "portugal-gallery", "Saturn Lightroom archive selections prepared from the Camera source."),
    "slovakia": ("07", "Slovakia", "slovakia-gallery", "Saturn Lightroom archive selections prepared from the Camera source."),
    "unknown": ("08", "Unknown", "unknown-gallery", "Saturn Lightroom selections that still need a final gallery assignment."),
}

ORDER = ["france", "usa", "spain", "mexico", "ai", "portugal", "slovakia", "unknown"]
PUBLIC_ORDER = [slug for slug in ORDER if slug != "unknown"]
OWNER_ORDER = ["unknown"]
COUNTRY_ASSIGNMENT_TARGETS = {"france", "usa", "spain", "mexico", "portugal", "slovakia"}
DEFAULT_REGULAR_CAP = 10
DEFAULT_SELECTION_MODE = "random"
REGULAR_ASSET_ROOT = Path("assets/regular")
RESERVE_ASSET_ROOT = Path("assets/reserve")


def manifest_specs(repo_root: Path) -> list[tuple[Path, str]]:
    return [
        (repo_root / "assets/lightroom/manifest.json", "lightroom"),
        (repo_root / "assets/lightroom-ai/manifest.json", "ai"),
    ]


def existing_manifest_specs(repo_root: Path) -> list[tuple[Path, str]]:
    specs = [(path, mode) for path, mode in manifest_specs(repo_root) if path.exists()]
    if not specs:
        expected = ", ".join(str(path.relative_to(repo_root)) for path, _mode in manifest_specs(repo_root))
        raise FileNotFoundError(
            "No source ingest manifests found; expected at least one of: "
            f"{expected}. Rebuild them with scripts/build_lightroom_thumbnails.py, "
            "or run scripts/apply_curation_pass.py with --rebuild-missing-manifests."
        )
    return specs


def js(value: object) -> str:
    return json.dumps(value, ensure_ascii=False)


def title_from_row(row: dict) -> str:
    raw = row.get("raw_metadata", {}) or {}
    for key in ("Title", "ObjectName"):
        value = raw.get(key)
        if value:
            return str(value).strip()
    for item in row.get("metadata", []) or []:
        if item.get("label") == "Metadata title" and item.get("value"):
            return str(item["value"]).strip()
    stem = Path(row.get("relative_path", row["id"])).stem
    return re.sub(r"[_-]+", " ", stem).strip() or row["id"]


def caption_from_row(row: dict, gallery_title: str) -> str:
    capture = (row.get("capture") or {}).get("date")
    loc = row.get("location") or {}
    place = ", ".join([value for value in [loc.get("location"), loc.get("city"), loc.get("region")] if value])
    parts = [gallery_title]
    if place:
        parts.append(place)
    if capture:
        parts.append(capture)
    return " / ".join(parts)


def normalize_metadata(row: dict) -> list[dict]:
    items = list(row.get("metadata") or [])
    deriv = (row.get("derivative_files") or {}).get("detail") or {}
    width = deriv.get("width")
    height = deriv.get("height")
    fmt = deriv.get("format") or "JPG"
    if width and height and not any(item.get("label") == "Preview file" for item in items):
        items.append(
            {
                "label": "Preview file",
                "value": f"{Path(row['derivatives']['detail']).name} / {width} x {height} / {fmt}",
            }
        )
    return items


def source_files(row: dict) -> list[dict]:
    source = row.get("source_file") or {}
    ext = str(source.get("extension") or "").upper()
    if not ext:
        return []
    return [
        {
            "path": row.get("relative_path"),
            "type": ext,
            "bytes": source.get("bytes"),
        }
    ]


def source_asset_root(repo_root: Path, mode: str) -> Path:
    return repo_root / ("assets/lightroom-ai" if mode == "ai" else "assets/lightroom")


def regular_asset_rel(row: dict, derivative: str) -> str:
    country = (row.get("gallery_country") or {}).get("slug") or "unknown"
    return (REGULAR_ASSET_ROOT / derivative / country / f"{row['id']}.jpg").as_posix()


def source_derivative_rel(row: dict, mode: str, derivative: str) -> str:
    root = "assets/lightroom-ai" if mode == "ai" else "assets/lightroom"
    return f"./{root}/{row['derivatives'][derivative]}"


def photo_object_lines(
    row: dict,
    mode: str,
    index: int,
    gallery_title: str,
    gallery_rel: str,
    detail_rel: str,
) -> list[str]:
    full_label = f"{source_files(row)[0]['type']} master" if source_files(row) else "Source file"
    return [
        "      {",
        f"        id: {js(row['id'])},",
        f"        className: {js('p' + str((index % 5) + 1))},",
        f"        title: {js(title_from_row(row))},",
        f"        caption: {js(caption_from_row(row, gallery_title))},",
        f"        full: {js(full_label)},",
        f"        megapixels: {json.dumps((row.get('dimensions') or {}).get('megapixels') or 0)},",
        f"        gallerySrc: {js(gallery_rel)},",
        f"        imageSrc: {js(detail_rel)},",
        f"        metadata: {json.dumps(normalize_metadata(row), ensure_ascii=False, indent=10)},",
        f"        sourceFiles: {json.dumps(source_files(row), ensure_ascii=False, indent=10)}",
        "      },",
    ]


def copy_regular_assets(repo_root: Path, regular_rows: list[tuple[dict, str]]) -> dict[str, int]:
    publish_root = repo_root / REGULAR_ASSET_ROOT
    if publish_root.exists():
        shutil.rmtree(publish_root)

    copied = {"gallery": 0, "detail": 0}
    for row, mode in regular_rows:
        for derivative in ("gallery", "detail"):
            source_rel = row["derivatives"][derivative]
            source = source_asset_root(repo_root, mode) / source_rel
            target = repo_root / regular_asset_rel(row, derivative)
            if not source.exists():
                raise FileNotFoundError(f"Missing derivative for regular export: {source}")
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            copied[derivative] += 1
    return copied


def write_regular_manifest(
    repo_root: Path,
    regular_rows: list[tuple[dict, str]],
    reserve_counts: dict[str, int],
    unworthy_counts: dict[str, int],
    regular_cap: int,
    selection_mode: str,
    seed: int | None,
) -> None:
    payload = {
        "schema_version": 1,
        "regular_cap": regular_cap,
        "selection_mode": selection_mode,
        "seed": seed,
        "photos_count": len(regular_rows),
        "reserve_counts": dict(sorted(reserve_counts.items())),
        "unworthy_counts": dict(sorted(unworthy_counts.items())),
        "photos": [
            {
                "id": row["id"],
                "relative_path": row.get("relative_path"),
                "gallery_country": row.get("gallery_country"),
                "source_mode": mode,
                "derivatives": {
                    "gallery": regular_asset_rel(row, "gallery"),
                    "detail": regular_asset_rel(row, "detail"),
                },
            }
            for row, mode in regular_rows
        ],
    }
    output = repo_root / REGULAR_ASSET_ROOT / "manifest.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_reserve_data(repo_root: Path, reserve_groups: dict[str, list[tuple[dict, str]]]) -> Path:
    lines: list[str] = ["window.photosByElieReserveData = {"]
    for slug in ORDER:
        number, title, accent, description = LABELS[slug]
        rows = reserve_groups.get(slug, [])
        lines += [
            f"  {slug}: {{",
            f"    number: {js(number)},",
            f"    title: {js(title)},",
            f"    description: {js(description)},",
            f"    accent: {js(accent)},",
            "    photos: [",
        ]
        for index, (row, mode) in enumerate(rows):
            lines += photo_object_lines(
                row,
                mode,
                index,
                title,
                source_derivative_rel(row, mode, "gallery"),
                source_derivative_rel(row, mode, "detail"),
            )
        lines += ["    ]", "  },"]
    lines.append("};")
    output = repo_root / RESERVE_ASSET_ROOT / "reserve-data.js"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return output


def sort_rows(rows: list[tuple[dict, str]]) -> list[tuple[dict, str]]:
    return sorted(
        rows,
        key=lambda item: (((item[0].get("capture") or {}).get("sort") or ""), item[0].get("id", "")),
        reverse=True,
    )


def load_blacklist_payload(path: Path | None) -> dict:
    if not path:
        return {}
    return json.loads(path.expanduser().read_text(encoding="utf-8"))


def blacklist_ids_from_payload(payload: dict) -> set[str]:
    return {photo_id for photo_id in payload.get("photo_ids", []) if isinstance(photo_id, str)}


def regular_state_from_payload(payload: dict) -> dict[str, list[str]]:
    value = payload.get("regular_state")
    if not isinstance(value, dict):
        return {}
    state: dict[str, list[str]] = {}
    for slug, photo_ids in value.items():
        if slug not in LABELS or not isinstance(photo_ids, list):
            continue
        clean = []
        seen = set()
        for photo_id in photo_ids:
            if not isinstance(photo_id, str) or not photo_id or photo_id in seen:
                continue
            clean.append(photo_id)
            seen.add(photo_id)
        state[slug] = clean
    return state


def reserve_only_ids_from_payload(payload: dict) -> set[str]:
    return {photo_id for photo_id in payload.get("reserve_only", []) if isinstance(photo_id, str)}


def country_assignments_from_payload(payload: dict) -> dict[str, str]:
    value = payload.get("country_assignments")
    if not isinstance(value, dict):
        return {}
    return {
        photo_id: slug
        for photo_id, slug in value.items()
        if isinstance(photo_id, str) and photo_id and slug in COUNTRY_ASSIGNMENT_TARGETS
    }


def load_blacklist(path: Path | None) -> set[str]:
    return blacklist_ids_from_payload(load_blacklist_payload(path))


def load_blacklist_regular_state(path: Path | None) -> dict[str, list[str]]:
    return regular_state_from_payload(load_blacklist_payload(path))


def apply_country_assignment(row: dict, slug: str | None) -> dict:
    if slug not in COUNTRY_ASSIGNMENT_TARGETS:
        return row
    row = dict(row)
    number, title, _accent, _description = LABELS[slug]
    row["gallery_country"] = {
        "slug": slug,
        "label": title,
        "source": "owner",
    }
    row["owner_classification"] = {
        "gallery_country": slug,
        "collection_number": number,
    }
    return row


def select_regular_groups(
    groups: dict[str, list[tuple[dict, str]]],
    regular_cap: int,
    selection_mode: str,
    blacklist_ids: set[str],
    seed: int | None,
    pinned_regular_ids: dict[str, list[str]] | None = None,
    reserve_only_ids: set[str] | None = None,
) -> tuple[
    dict[str, list[tuple[dict, str]]],
    dict[str, list[tuple[dict, str]]],
    dict[str, int],
    dict[str, int],
    int | None,
]:
    resolved_seed = seed
    if selection_mode == "random" and resolved_seed is None:
        resolved_seed = random.SystemRandom().randrange(1, 2**31)
    rng = random.Random(resolved_seed)
    regular_groups: dict[str, list[tuple[dict, str]]] = {}
    reserve_groups: dict[str, list[tuple[dict, str]]] = {}
    reserve_counts: dict[str, int] = {}
    unworthy_counts: dict[str, int] = {}
    pinned_regular_ids = pinned_regular_ids or {}
    reserve_only_ids = reserve_only_ids or set()

    for slug, rows in groups.items():
        blocked = [item for item in rows if item[0].get("id") in blacklist_ids]
        eligible = [item for item in rows if item[0].get("id") not in blacklist_ids]
        regular_eligible = [item for item in eligible if item[0].get("id") not in reserve_only_ids]
        eligible_by_id = {item[0].get("id"): item for item in regular_eligible}
        selected: list[tuple[dict, str]] = []
        selected_ids: set[str] = set()

        for photo_id in pinned_regular_ids.get(slug, []):
            if photo_id in selected_ids:
                continue
            item = eligible_by_id.get(photo_id)
            if not item:
                continue
            selected.append(item)
            selected_ids.add(photo_id)
            if len(selected) >= regular_cap:
                break

        fill_pool = [item for item in regular_eligible if item[0].get("id") not in selected_ids]
        if selection_mode == "random":
            rng.shuffle(fill_pool)
        selected.extend(fill_pool[: max(0, regular_cap - len(selected))])

        if pinned_regular_ids.get(slug) or selection_mode == "random":
            regular_groups[slug] = selected[:regular_cap]
        else:
            regular_groups[slug] = sort_rows(selected[:regular_cap])

        selected_ids = {item[0].get("id") for item in regular_groups[slug]}
        reserve_groups[slug] = sort_rows([item for item in eligible if item[0].get("id") not in selected_ids])
        reserve_counts[slug] = len(reserve_groups[slug])
        unworthy_counts[slug] = len(blocked)

    return regular_groups, reserve_groups, reserve_counts, unworthy_counts, resolved_seed


def write_photos_data(
    repo_root: Path,
    regular_cap: int = DEFAULT_REGULAR_CAP,
    sync_regular_assets: bool = True,
    selection_mode: str = DEFAULT_SELECTION_MODE,
    blacklist_ids: set[str] | None = None,
    seed: int | None = None,
    pinned_regular_ids: dict[str, list[str]] | None = None,
    reserve_only_ids: set[str] | None = None,
    country_assignments: dict[str, str] | None = None,
) -> Path:
    groups: dict[str, list[tuple[dict, str]]] = defaultdict(list)
    country_assignments = country_assignments or {}
    for path, mode in existing_manifest_specs(repo_root):
        for row in json.loads(path.read_text())["photos"]:
            row = apply_country_assignment(row, country_assignments.get(row.get("id")))
            gallery_country = row.get("gallery_country") or {}
            slug = gallery_country.get("slug") if isinstance(gallery_country, dict) else str(gallery_country)
            if slug not in LABELS:
                slug = "unknown"
            groups[slug].append((row, mode))

    for slug, rows in groups.items():
        groups[slug] = sort_rows(rows)

    regular_groups, reserve_groups, reserve_counts, unworthy_counts, resolved_seed = select_regular_groups(
        groups,
        regular_cap,
        selection_mode,
        blacklist_ids or set(),
        seed,
        pinned_regular_ids=pinned_regular_ids,
        reserve_only_ids=reserve_only_ids,
    )
    regular_rows = [item for slug in ORDER for item in regular_groups.get(slug, [])]
    if sync_regular_assets:
        copy_regular_assets(repo_root, regular_rows)
        write_regular_manifest(
            repo_root,
            regular_rows,
            reserve_counts,
            unworthy_counts,
            regular_cap,
            selection_mode,
            resolved_seed,
        )
        write_reserve_data(repo_root, reserve_groups)

    def collection_lines(slug: str) -> list[str]:
        number, title, accent, description = LABELS[slug]
        rows = regular_groups.get(slug, [])
        reserve_count = reserve_counts.get(slug, 0)
        next_lines = [
            f"  {slug}: {{",
            f"    number: {js(number)},",
            f"    title: {js(title)},",
            f"    description: {js(f'{description} {len(rows)} expo photos currently loaded; {reserve_count} in local reserve.')},",
            f"    accent: {js(accent)},",
            "    photos: [",
        ]
        for index, (row, mode) in enumerate(rows):
            gallery_rel = f"./{regular_asset_rel(row, 'gallery')}"
            detail_rel = f"./{regular_asset_rel(row, 'detail')}"
            next_lines += photo_object_lines(row, mode, index, title, gallery_rel, detail_rel)
        next_lines += ["    ]", "  },"]
        return next_lines

    lines: list[str] = ["window.photosByElieData = {"]
    for slug in PUBLIC_ORDER:
        lines += collection_lines(slug)

    lines += ["};", "window.photosByElieOwnerData = {"]
    for slug in OWNER_ORDER:
        lines += collection_lines(slug)

    lines += [
        "};",
        'window.photosByElieResolutions = [',
        '  { id: "full", label: "Full resolution", detail: "Original source file at native resolution", price: 45 },',
        '  { id: "jpg-6mp", label: "JPG 6 MP", detail: "Long edge export for print and premium web", price: 18, minMegapixels: 6 },',
        '  { id: "jpg-3mp", label: "JPG 3 MP", detail: "Listing, portfolio, and editorial web use", price: 10, minMegapixels: 3 },',
        '  { id: "jpg-1mp", label: "JPG 1 MP", detail: "Small web preview and social draft use", price: 5, minMegapixels: 1 }',
        '];',
        "",
        'window.photosByEliePreviewMegapixels = (photo) => {',
        '  const preview = (photo?.metadata || []).find((item) => item.label === "Preview file")?.value || "";',
        r'  const match = preview.match(/(\d+)\s*x\s*(\d+)/i);',
        '  if (!match) return 0;',
        '  return Math.round((Number(match[1]) * Number(match[2]) / 1000000) * 10) / 10;',
        '};',
        "",
        'window.photosByElieVerifiedMegapixels = (photo) => {',
        '  if (Array.isArray(photo?.sourceFiles) && photo.sourceFiles.length) return Number(photo.megapixels) || 0;',
        '  return window.photosByEliePreviewMegapixels(photo);',
        '};',
        "",
        'window.photosByElieAvailableResolutions = (photo, options = window.photosByElieResolutions || []) => {',
        '  const megapixels = window.photosByElieVerifiedMegapixels(photo);',
        '  if (!megapixels) return [];',
        '  return options.filter((option) => !option.minMegapixels || megapixels >= option.minMegapixels);',
        '};',
        "",
        'window.photosByElieFormatLabel = (source) => {',
        '  const value = String(source || "");',
        '  const checks = [',
        r'    { label: "RAW", pattern: /\b(DNG|CR2|CR3|NEF|ARW|RAF|ORF|RW2)\b/i },',
        r'    { label: "JPG", pattern: /\b(JPG|JPEG)\b/i },',
        r'    { label: "TIFF", pattern: /\b(TIF|TIFF)\b/i },',
        r'    { label: "PSD", pattern: /\bPSD\b/i },',
        "  ];",
        '  const formats = checks.filter((item) => item.pattern.test(value)).map((item) => item.label);',
        '  return formats.length ? formats.join(" + ") : value;',
        '};',
        "",
        'window.photosByElieSourceFormats = (photo) => {',
        '  if (Array.isArray(photo?.sourceFiles) && photo.sourceFiles.length) {',
        '    const formats = [...new Set(photo.sourceFiles.map((file) => file.type || window.photosByElieFormatLabel(file.path)).filter(Boolean))];',
        '    return formats.join(" + ");',
        '  }',
        '  return photo?.imageSrc ? `${window.photosByElieFormatLabel(photo.imageSrc)} preview/export` : "Source file unverified";',
        '};',
        "",
        'window.photosByElieOriginalSize = (photo) => {',
        '  const megapixels = window.photosByElieVerifiedMegapixels(photo);',
        '  const sizeLabel = Array.isArray(photo?.sourceFiles) && photo.sourceFiles.length ? "source" : "verified";',
        '  return [window.photosByElieSourceFormats(photo), megapixels ? `${megapixels} MP ${sizeLabel}` : ""].filter(Boolean).join(", ");',
        '};',
        "",
        'window.photosByElieResolutionDetail = (photo, option) => {',
        '  if (option.id !== "full") return option.detail;',
        '  return `Original: ${window.photosByElieOriginalSize(photo)}`;',
        '};',
    ]

    output = repo_root / "photos-data.js"
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export publishable Photos By Elie data from ingest manifests.")
    parser.add_argument("--regular-cap", type=int, default=DEFAULT_REGULAR_CAP)
    parser.add_argument("--selection", choices=("random", "newest"), default=DEFAULT_SELECTION_MODE)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--curation-pass", "--blacklist", dest="curation_pass", type=Path, default=None, help="Optional Curation Pass file to apply hidden, reserve, and classification choices.")
    parser.add_argument("--no-sync-assets", action="store_true")
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    curation_payload = load_blacklist_payload(args.curation_pass)
    result = write_photos_data(
        repo_root,
        regular_cap=args.regular_cap,
        sync_regular_assets=not args.no_sync_assets,
        selection_mode=args.selection,
        blacklist_ids=blacklist_ids_from_payload(curation_payload),
        seed=args.seed,
        pinned_regular_ids=regular_state_from_payload(curation_payload),
        reserve_only_ids=reserve_only_ids_from_payload(curation_payload),
        country_assignments=country_assignments_from_payload(curation_payload),
    )
    print(result)
