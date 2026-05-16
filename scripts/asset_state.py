#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import random
import re
import shutil
import subprocess
import sys
from pathlib import Path

from export_photos_data import (
    DEFAULT_REGULAR_CAP,
    EXPO_MANIFEST_PATH,
    LABELS,
    ORDER,
    blacklist_ids_from_payload,
    country_assignments_from_payload,
    existing_manifest_specs,
    ensure_state_folders,
    manifest_specs as source_manifest_specs,
    expo_state_from_payload,
    reserve_only_ids_from_payload,
    write_photos_data,
    write_home_data_from_collections,
)
from media_keys import DEFAULT_PUBLIC_PREFIX, public_preview_key, public_preview_key_for_reference
from media_policy import media_source_policy, public_preview_allowed

COUNTRY_ASSIGNMENT_LABELS = {
    "france": "France",
    "usa": "USA",
    "spain": "Spain",
    "mexico": "Mexico",
    "italy": "Italy",
    "portugal": "Portugal",
    "slovakia": "Slovakia",
}

AI_SOURCE_ROOT_CANDIDATES = [
    Path("/Volumes/Saturn/Pictures/LR/_All Leonardo"),
    Path("/Volumes/Saturn-1/Pictures/LR/_All Leonardo"),
    Path.home() / "Pictures/LR/_All Leonardo",
]
IMPORT_CACHE_ROOT = Path("tmp/import-cache")

HIDDEN_ASSET_ROOT = Path("assets/hidden")
MODERATION_LOG_ROOT = Path(".review-logs")
DIVERSITY_BUCKET_MINUTES = 10


def load_builder(repo_root: Path):
    script_path = repo_root / "scripts" / "build_lightroom_thumbnails.py"
    spec = importlib.util.spec_from_file_location("thumb_builder", script_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def resolve_optional_source_root(value: Path | None, candidates: list[Path], label: str) -> Path | None:
    if value:
        expanded = value.expanduser()
        if not expanded.exists():
            raise FileNotFoundError(f"{label} source root does not exist: {expanded}")
        return expanded.resolve()
    for candidate in candidates:
        expanded = candidate.expanduser()
        if expanded.exists():
            return expanded.resolve()
    return None


def rebuild_missing_manifests(
    repo_root: Path,
    source_root: Path | None = None,
    ai_source_root: Path | None = None,
) -> list[dict]:
    builder = load_builder(repo_root)
    script_path = repo_root / "scripts" / "build_lightroom_thumbnails.py"
    rebuilt = []

    jobs = [
        {
            "manifest": repo_root / IMPORT_CACHE_ROOT / "manifest.json",
            "output": str(IMPORT_CACHE_ROOT),
            "args": [],
            "source": resolve_optional_source_root(
                source_root,
                builder.DEFAULT_SOURCE_ROOT_CANDIDATES,
                "Lightroom",
            ),
        },
        {
            "manifest": repo_root / IMPORT_CACHE_ROOT / "manifest.json",
            "output": str(IMPORT_CACHE_ROOT),
            "args": ["--select", "all", "--force-country", "ai"],
            "source": resolve_optional_source_root(ai_source_root, AI_SOURCE_ROOT_CANDIDATES, "AI"),
            "append_after_camera": True,
        },
    ]

    rebuilt_manifest_paths = set()
    for job in jobs:
        if not job["source"]:
            continue
        if job["manifest"].exists() and job["manifest"] not in rebuilt_manifest_paths:
            continue
        if job.get("append_after_camera") and not rebuilt_manifest_paths and job["manifest"].exists():
            continue
        command = [
            sys.executable,
            str(script_path),
            "--source-root",
            str(job["source"]),
            "--output-root",
            job["output"],
            *job["args"],
        ]
        subprocess.run(command, cwd=repo_root, check=True)
        rebuilt.append(
            {
                "manifest": job["manifest"].relative_to(repo_root).as_posix(),
                "source_root": str(job["source"]),
            }
        )
        rebuilt_manifest_paths.add(job["manifest"])
    return rebuilt


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


def clean_site_src(value: str | None) -> str:
    return str(value or "").removeprefix("./")


def public_media_key(photo: dict, reference: str | None, derivative: str) -> str:
    if reference:
        return public_preview_key_for_reference(DEFAULT_PUBLIC_PREFIX, photo["id"], reference)
    return public_preview_key(DEFAULT_PUBLIC_PREFIX, photo["id"], derivative, media_type_for_photo(photo))


def media_type_for_photo(photo: dict) -> str:
    value = str((photo.get("media") or {}).get("type") or photo.get("media_type") or photo.get("type") or "").lower()
    if value:
        return value
    source_types = {str(source.get("type") or "").strip().upper() for source in (photo.get("sourceFiles") or []) if isinstance(source, dict)}
    return "video" if source_types & {"MOV", "MP4", "M4V"} else "photo"


def media_object_for_photo(photo: dict) -> dict:
    public_allowed = public_preview_allowed(photo)
    return {
        "type": media_type_for_photo(photo),
        "sourcePolicy": media_source_policy(photo),
        "publicPreview": {
            "allowed": public_allowed,
            "galleryKey": public_media_key(photo, photo.get("gallerySrc"), "gallery") if public_allowed else "",
            "detailKey": public_media_key(photo, photo.get("imageSrc"), "detail") if public_allowed else "",
        },
    }


def photo_with_media(photo: dict) -> dict:
    next_photo = copy_photo(photo)
    next_photo["media"] = media_object_for_photo(next_photo)
    return next_photo


def hidden_asset_rel(photo: dict, derivative: str, slug: str) -> str:
    return ""


def move_derivative(repo_root: Path, relative_path: str, destination_rel: str | None = None) -> dict | None:
    source_rel = clean_site_src(relative_path)
    if not source_rel or not destination_rel:
        return None
    source = repo_root / source_rel
    destination = repo_root / (destination_rel or (HIDDEN_ASSET_ROOT / source_rel).as_posix())
    if destination.exists() and not source.exists():
        return {
            "from": source_rel,
            "to": destination.relative_to(repo_root).as_posix(),
            "already": True,
        }
    if not source.exists():
        return None
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.resolve() == destination.resolve():
        return {
            "from": source.relative_to(repo_root).as_posix(),
            "to": destination.relative_to(repo_root).as_posix(),
            "already": True,
        }
    source.replace(destination)
    return {
        "from": source_rel,
        "to": destination.relative_to(repo_root).as_posix(),
    }


def move_regular_derivatives(repo_root: Path, photo_ids: set[str]) -> list[dict]:
    regular_manifest = repo_root / EXPO_MANIFEST_PATH
    if not regular_manifest.exists():
        return []
    payload = json.loads(regular_manifest.read_text())
    moved = []
    for row in payload.get("photos", []):
        if row.get("id") not in photo_ids:
            continue
        slug = ((row.get("gallery_country") or {}).get("slug") or "unknown")
        if slug not in ORDER:
            slug = "unknown"
        for derivative, derivative_rel in (row.get("derivatives") or {}).items():
            moved_row = move_derivative(repo_root, derivative_rel, hidden_asset_rel(row, derivative, slug))
            if moved_row:
                moved.append({"id": row.get("id"), "asset": moved_row})
    return moved


def regular_cap_from_payload(payload: dict, fallback: int | None = DEFAULT_REGULAR_CAP) -> int | None:
    value = payload.get("expo_cap")
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

def load_site_data(repo_root: Path) -> dict:
    script = r"""
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = process.argv[1];
const context = { window: {} };
vm.createContext(context);
Object.assign(context.window, require(path.join(root, "scripts/catalog_tsv.cjs")).loadCatalogWindow(root));
const reservePath = path.join(root, "assets/owner-actions/reserve-data.json");
if (fs.existsSync(reservePath)) {
  context.window.photosByElieReserveData = JSON.parse(fs.readFileSync(reservePath, "utf8"));
}
const hiddenPath = path.join(root, "assets/hidden/hidden-data.json");
if (fs.existsSync(hiddenPath)) {
  context.window.photosByElieHiddenData = JSON.parse(fs.readFileSync(hiddenPath, "utf8"));
}
process.stdout.write(JSON.stringify({
  data: context.window.photosByElieData || {},
  owner: context.window.photosByElieOwnerData || {},
  reserve: context.window.photosByElieReserveData || {},
  hidden: context.window.photosByElieHiddenData || {}
}));
"""
    result = subprocess.run(
        ["node", "-e", script, str(repo_root)],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def metadata_value(photo: dict, label: str) -> str:
    for item in photo.get("metadata") or []:
        if item.get("label") == label and item.get("value"):
            return str(item["value"])
    return ""


def diversity_bucket(photo: dict) -> str:
    value = " ".join(
        item for item in [
            metadata_value(photo, "Captured"),
            str(photo.get("caption") or ""),
            str(photo.get("title") or ""),
            str(photo.get("id") or ""),
        ]
        if item
    )
    match = re.search(r"\b(\d{4})[:/-]?(\d{2})[:/-]?(\d{2})(?:[ T:]+(\d{2}):?(\d{2}))?", value)
    if match and match.group(4) and match.group(5):
        year, month, day, hour, minute = (int(part) for part in match.groups()[:5])
        bucket = ((hour * 60) + minute) // DIVERSITY_BUCKET_MINUTES
        return f"{year:04d}-{month:02d}-{day:02d}:{bucket:02d}"
    if match:
        return f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
    return f"id:{photo.get('id', '')}"


def diversified_random_order(photos: list[dict], rng: random.Random) -> list[dict]:
    buckets: dict[str, list[dict]] = {}
    for photo in photos:
        buckets.setdefault(diversity_bucket(photo), []).append(photo)

    for bucket_photos in buckets.values():
        rng.shuffle(bucket_photos)

    ordered: list[dict] = []
    active = list(buckets)
    while active:
        rng.shuffle(active)
        next_active = []
        for bucket in active:
            bucket_photos = buckets[bucket]
            if bucket_photos:
                ordered.append(bucket_photos.pop())
            if bucket_photos:
                next_active.append(bucket)
        active = next_active
    return ordered


def candidate_asset_roots(repo_root: Path, asset_sources: list[Path] | None = None) -> list[Path]:
    roots = [repo_root]
    for source in asset_sources or []:
        roots.append(source.expanduser().resolve())

    try:
        result = subprocess.run(
            ["git", "worktree", "list", "--porcelain"],
            cwd=repo_root,
            check=True,
            capture_output=True,
            text=True,
        )
        roots.extend(Path(line.split(" ", 1)[1]) for line in result.stdout.splitlines() if line.startswith("worktree "))
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass

    dev_root = repo_root.parent
    roots.extend(path for path in dev_root.glob("photosByElie*") if path.is_dir())
    roots.extend(path for path in dev_root.glob("PhotosByElie*") if path.is_dir())
    webapps_copy = dev_root / "Webapps" / "PhotosByElie"
    if webapps_copy.exists():
        roots.append(webapps_copy)

    unique = []
    seen = set()
    for root in roots:
        try:
            resolved = root.resolve()
        except FileNotFoundError:
            continue
        if resolved in seen or not resolved.exists():
            continue
        unique.append(resolved)
        seen.add(resolved)
    return unique


def find_asset_path(relative_path: str, roots: list[Path]) -> Path | None:
    rel = clean_site_src(relative_path)
    if not rel:
        return None
    path = Path(rel)
    if path.is_absolute():
        return path if path.exists() else None
    for root in roots:
        candidates = [root / rel]
        if rel.startswith("assets/"):
            candidates.append(root / rel.removeprefix("assets/"))
        for candidate in candidates:
            if candidate.exists():
                return candidate
    return None


def photo_has_assets(photo: dict, roots: list[Path]) -> bool:
    return all(
        find_asset_path(photo.get(key), roots)
        for key in ("gallerySrc", "imageSrc")
    )


def photo_has_regular_source_assets(repo_root: Path, photo: dict, slug: str, roots: list[Path]) -> bool:
    for derivative, key, original_key in [
        ("gallery", "gallerySrc", "_originalGallerySrc"),
        ("detail", "imageSrc", "_originalImageSrc"),
    ]:
        source_rel = clean_site_src(photo.get(original_key) or photo.get(key))
        if find_asset_path(source_rel, roots):
            continue
        return False
    return True


def copy_photo(photo: dict) -> dict:
    return json.loads(json.dumps(photo, ensure_ascii=False))


def photo_object_lines(photo: dict, index: int) -> list[str]:
    ordered = copy_photo(photo)
    ordered["className"] = f"p{(index % 5) + 1}"
    ordered["media"] = media_object_for_photo(ordered)
    return [
        "      {",
        f"        id: {json.dumps(ordered.get('id'), ensure_ascii=False)},",
        f"        className: {json.dumps(ordered.get('className'), ensure_ascii=False)},",
        f"        title: {json.dumps(ordered.get('title') or ordered.get('id'), ensure_ascii=False)},",
        f"        caption: {json.dumps(ordered.get('caption') or '', ensure_ascii=False)},",
        f"        full: {json.dumps(ordered.get('full') or 'Source file', ensure_ascii=False)},",
        f"        megapixels: {json.dumps(ordered.get('megapixels') or 0)},",
        f"        gallerySrc: {json.dumps(ordered.get('gallerySrc'), ensure_ascii=False)},",
        f"        imageSrc: {json.dumps(ordered.get('imageSrc'), ensure_ascii=False)},",
        f"        metadata: {json.dumps(ordered.get('metadata') or [], ensure_ascii=False, indent=10)},",
        f"        media: {json.dumps(ordered.get('media') or {}, ensure_ascii=False, indent=10)},",
        f"        sourceFiles: {json.dumps(ordered.get('sourceFiles') or [], ensure_ascii=False, indent=10)}",
        "      },",
    ]


def collection_lines(slug: str, photos: list[dict]) -> list[str]:
    number, title, accent, description = LABELS[slug]
    lines = [
        f"  {slug}: {{",
        f"    number: {json.dumps(number, ensure_ascii=False)},",
        f"    title: {json.dumps(title, ensure_ascii=False)},",
        f"    description: {json.dumps(description, ensure_ascii=False)},",
        f"    accent: {json.dumps(accent, ensure_ascii=False)},",
        "    photos: [",
    ]
    for index, photo in enumerate(photos):
        lines += photo_object_lines(photo, index)
    lines += ["    ]", "  },"]
    return lines


def helper_lines() -> list[str]:
    return [
        "window.photosByElieResolutions = [",
        '  { id: "full", type: "digital", label: "Full resolution", detail: "Original source file at native resolution", price: 45 },',
        '  { id: "jpg-6mp", type: "digital", label: "JPG 6 MP", detail: "Long edge export for print and premium web", price: 18, minMegapixels: 6 },',
        '  { id: "jpg-3mp", type: "digital", label: "JPG 3 MP", detail: "Listing, portfolio, and editorial web use", price: 10, minMegapixels: 3 },',
        '  { id: "jpg-1mp", type: "digital", label: "JPG 1 MP", detail: "Small web preview and social draft use", price: 5, minMegapixels: 1 },',
        '  { id: "print-4x6", type: "print", label: "Print", dimensions: { imperial: "4 x 6 in", metric: "10 x 15 cm" }, detail: "Small classic photo print", price: 12, minMegapixels: 1 },',
        '  { id: "print-5x7", type: "print", label: "Print", dimensions: { imperial: "5 x 7 in", metric: "13 x 18 cm" }, detail: "Popular gift and desk frame size", price: 18, minMegapixels: 2 },',
        '  { id: "print-8x10", type: "print", label: "Print", dimensions: { imperial: "8 x 10 in", metric: "20 x 25 cm" }, detail: "Popular wall and shelf print size", price: 28, minMegapixels: 6 },',
        '  { id: "print-11x14", type: "print", label: "Print", dimensions: { imperial: "11 x 14 in", metric: "28 x 36 cm" }, detail: "Larger display print with manual crop review", price: 42, minMegapixels: 10 }',
        "];",
        "window.photosByElieFrameOptions = [",
        '  { id: "none", label: "No frame", price: 0 },',
        '  { id: "white", label: "Plain white frame", price: 22, prices: { "print-4x6": 16, "print-5x7": 22, "print-8x10": 34, "print-11x14": 48 } },',
        '  { id: "black", label: "Plain black frame", price: 22, prices: { "print-4x6": 16, "print-5x7": 22, "print-8x10": 34, "print-11x14": 48 } }',
        "];",
        "window.photosByElieShippingHandlingPrices = {",
        '  "print-4x6": 5,',
        '  "print-5x7": 6,',
        '  "print-8x10": 9,',
        '  "print-11x14": 12',
        "};",
        "",
        "window.photosByEliePreviewMegapixels = (photo) => {",
        '  const preview = (photo?.metadata || []).find((item) => item.label === "Preview file")?.value || "";',
        r"  const match = preview.match(/(\d+)\s*x\s*(\d+)/i);",
        "  if (!match) return 0;",
        "  return Math.round((Number(match[1]) * Number(match[2]) / 1000000) * 10) / 10;",
        "};",
        "",
        "window.photosByElieVerifiedMegapixels = (photo) => {",
        "  if (Array.isArray(photo?.sourceFiles) && photo.sourceFiles.length) return Number(photo.megapixels) || 0;",
        "  return window.photosByEliePreviewMegapixels(photo);",
        "};",
        "",
        "window.photosByElieAvailableResolutions = (photo, options = window.photosByElieResolutions || []) => {",
        "  const megapixels = window.photosByElieVerifiedMegapixels(photo);",
        "  if (!megapixels) return [];",
        "  const physicalProductsEnabled = window.photosByElieProductSettings?.physicalProductsEnabled?.() === true;",
        "  return options.filter((option) =>",
        "    (physicalProductsEnabled || option.type !== \"print\")",
        "    && (!option.minMegapixels || megapixels >= option.minMegapixels)",
        "  );",
        "};",
        "",
        "window.photosByElieFormatLabel = (source) => {",
        '  const value = String(source || "");',
        "  const checks = [",
        r'    { label: "JPG", pattern: /\b(JPG|JPEG)\b/i },',
        r'    { label: "TIFF", pattern: /\b(TIF|TIFF)\b/i },',
        r'    { label: "PSD", pattern: /\bPSD\b/i },',
        "  ];",
        '  const formats = checks.filter((item) => item.pattern.test(value)).map((item) => item.label);',
        '  return formats.length ? formats.join(" + ") : value;',
        "};",
        "",
        "window.photosByElieSourceFormats = (photo) => {",
        "  if (Array.isArray(photo?.sourceFiles) && photo.sourceFiles.length) {",
        "    const formats = [...new Set(photo.sourceFiles.map((file) => file.type || window.photosByElieFormatLabel(file.path)).filter(Boolean))];",
        '    return formats.join(" + ");',
        "  }",
        '  return photo?.imageSrc ? `${window.photosByElieFormatLabel(photo.imageSrc)} preview/export` : "Source file unverified";',
        "};",
        "",
        "window.photosByElieOriginalSize = (photo) => {",
        "  const megapixels = window.photosByElieVerifiedMegapixels(photo);",
        '  const sizeLabel = Array.isArray(photo?.sourceFiles) && photo.sourceFiles.length ? "source" : "verified";',
        '  return [window.photosByElieSourceFormats(photo), megapixels ? `${megapixels} MP ${sizeLabel}` : ""].filter(Boolean).join(", ");',
        "};",
        "",
        "window.photosByElieResolutionDetail = (photo, option) => {",
        "  if (option.id !== \"full\") return option.detail;",
        "  return `Original: ${window.photosByElieOriginalSize(photo)}`;",
        "};",
        "window.photosByElieMeasurementSystem = () => {",
        "  const nav = typeof navigator === \"undefined\" ? {} : navigator;",
        "  const locales = [...(nav.languages || []), nav.language, Intl.DateTimeFormat().resolvedOptions().locale].filter(Boolean);",
        "  const imperialRegions = new Set([\"US\", \"LR\", \"MM\"]);",
        "  for (const locale of locales) {",
        "    try {",
        "      const intlLocale = new Intl.Locale(locale).maximize();",
        "      if (intlLocale.measurementSystem === \"metric\" || intlLocale.measurementSystem === \"ussystem\") {",
        "        return intlLocale.measurementSystem === \"ussystem\" ? \"imperial\" : \"metric\";",
        "      }",
        "      if (intlLocale.region) return imperialRegions.has(intlLocale.region) ? \"imperial\" : \"metric\";",
        "    } catch {}",
        "  }",
        "  return \"metric\";",
        "};",
        "window.photosByElieProductLabel = (option) => {",
        "  if (option?.type !== \"print\" || !option.dimensions) return option?.label || \"\";",
        "  const preferred = window.photosByElieMeasurementSystem() === \"imperial\" ? \"imperial\" : \"metric\";",
        "  const secondary = preferred === \"imperial\" ? \"metric\" : \"imperial\";",
        "  return `${option.label} ${option.dimensions[preferred]} / ${option.dimensions[secondary]}`;",
        "};",
        "window.photosByElieFrameLabel = (frameId) => (",
        "  (window.photosByElieFrameOptions || []).find((frame) => frame.id === frameId)?.label || \"No frame\"",
        ");",
        "window.photosByElieFramePrice = (frame, option) => {",
        "  const frameId = typeof frame === \"string\" ? frame : frame?.id;",
        "  const catalogFrame = (window.photosByElieFrameOptions || []).find((item) => item.id === frameId);",
        "  const pricedFrame = catalogFrame || frame;",
        "  return Number(pricedFrame?.prices?.[option?.id] ?? pricedFrame?.price ?? frame?.price ?? 0);",
        "};",
        "window.photosByElieOptionQuantity = (option) => option?.type === \"print\" ? Math.max(1, Number(option.quantity) || 1) : 1;",
        "window.photosByElieOptionShippingHandlingUnitPrice = (option) => option?.type === \"print\" ? Number(window.photosByElieShippingHandlingPrices?.[option?.id] || 0) : 0;",
        "window.photosByElieOptionShippingHandlingTotal = (option) => window.photosByElieOptionQuantity(option) * window.photosByElieOptionShippingHandlingUnitPrice(option);",
        "window.photosByElieShippingHandlingNote = (option) => {",
        "  const price = window.photosByElieOptionShippingHandlingUnitPrice(option);",
        "  return option?.type === \"print\" && price ? `S&H $${price} added and removed as a limited-time discount.` : \"\";",
        "};",
        "window.photosByElieProductDetail = (photo, option) => [",
        "  window.photosByElieResolutionDetail(photo, option),",
        "  window.photosByElieShippingHandlingNote(option)",
        "].filter(Boolean).join(\" \");",
        "window.photosByElieOptionUnitPrice = (option) => Number(option?.price) + Number(window.photosByElieFramePrice?.(option?.frame, option) || 0);",
        "window.photosByElieOptionTotal = (option) => window.photosByElieOptionQuantity(option) * window.photosByElieOptionUnitPrice(option);",
    ]


def compact_catalog_tsv(repo_root: Path) -> None:
    subprocess.run(
        ["node", "scripts/write_catalog_tsv.cjs"],
        cwd=repo_root,
        check=True,
        stdout=subprocess.DEVNULL,
    )


def write_photos_data_from_site(repo_root: Path, regular_groups: dict[str, list[dict]], reserve_groups: dict[str, list[dict]]) -> None:
    home_collections = {}
    lines = ["window.photosByElieData = {"]
    for slug in ORDER:
        photos = regular_groups.get(slug, [])
        lines += collection_lines(slug, photos)
        if slug != "unknown":
            number, title, accent, description = LABELS[slug]
            home_collections[slug] = {
                "number": number,
                "title": title,
                "description": description,
                "accent": accent,
                "photos": [photo_with_media(photo) for photo in photos],
            }
    lines += [
        "};",
        "window.photosByElieOwnerData = {",
        "  unknown: window.photosByElieData.unknown,",
        "};",
        "delete window.photosByElieData.unknown;",
    ]
    lines += helper_lines()
    (repo_root / "photos-data.js").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    compact_catalog_tsv(repo_root)
    write_home_data_from_collections(repo_root, home_collections)


def write_reserve_data_from_site(repo_root: Path, reserve_groups: dict[str, list[dict]]) -> None:
    payload = {}
    for slug in ORDER:
        number, title, accent, description = LABELS[slug]
        payload[slug] = {
            "number": number,
            "title": title,
            "description": description,
            "accent": accent,
            "photos": [photo_with_media(photo) for photo in reserve_groups.get(slug, [])],
        }
    output = repo_root / "assets/owner-actions/reserve-data.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_hidden_data_from_site(repo_root: Path, hidden_groups: dict[str, list[dict]]) -> None:
    payload = {}
    for slug in ORDER:
        number, title, accent, description = LABELS[slug]
        payload[slug] = {
            "number": number,
            "title": title,
            "description": description,
            "accent": accent,
            "photos": [photo_with_media(photo) for photo in hidden_groups.get(slug, [])],
        }
    output = repo_root / HIDDEN_ASSET_ROOT / "hidden-data.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def source_mode_for(photo: dict, slug: str) -> str:
    src = clean_site_src(photo.get("_originalGallerySrc") or photo.get("gallerySrc"))
    return "ai" if slug == "ai" else "reserve"


def write_regular_manifest_from_site(
    repo_root: Path,
    regular_groups: dict[str, list[dict]],
    reserve_groups: dict[str, list[dict]],
    regular_cap: int | None,
    hidden_ids: set[str],
    selection_mode: str = "review-snapshot",
) -> None:
    regular_rows = [(slug, photo) for slug in ORDER for photo in regular_groups.get(slug, [])]
    payload = {
        "schema_version": 1,
        "state": "expo",
        "expo_cap": regular_cap,
        "publish_scope": "all-eligible" if regular_cap is None or regular_cap <= 0 else "capped",
        "selection_mode": selection_mode,
        "seed": None,
        "photos_count": len(regular_rows),
        "reserve_counts": {slug: len(reserve_groups.get(slug, [])) for slug in ORDER},
        "hidden_counts": {slug: 0 for slug in ORDER},
        "photos": [
            {
                "id": photo["id"],
                "relative_path": (photo.get("sourceFiles") or [{}])[0].get("path"),
                "gallery_country": {
                    "slug": slug,
                    "label": LABELS[slug][1],
                    "source": "owner" if slug == "unknown" else "review-snapshot",
                },
                "source_mode": source_mode_for(photo, slug),
                "derivatives": {
                    "gallery": public_preview_key(DEFAULT_PUBLIC_PREFIX, photo["id"], "gallery", media_type_for_photo(photo)),
                    "detail": public_preview_key(DEFAULT_PUBLIC_PREFIX, photo["id"], "detail", media_type_for_photo(photo)),
                },
            }
            for slug, photo in regular_rows
        ],
    }
    for slug, photos in regular_groups.items():
        hidden_in_slug = hidden_ids.intersection({photo["id"] for photo in photos})
        payload["hidden_counts"][slug] = len(hidden_in_slug)
    output = repo_root / EXPO_MANIFEST_PATH
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def move_asset(repo_root: Path, relative_path: str, destination_rel: str) -> dict | None:
    source_rel = clean_site_src(relative_path)
    if not source_rel:
        return None
    source = repo_root / source_rel
    destination = repo_root / destination_rel
    if destination.exists() and not source.exists():
        return {
            "from": source_rel,
            "to": destination.relative_to(repo_root).as_posix(),
            "already": True,
        }
    if not source.exists():
        return None
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.resolve() == destination.resolve():
        return {
            "from": source.relative_to(repo_root).as_posix(),
            "to": destination.relative_to(repo_root).as_posix(),
            "already": True,
        }
    source.replace(destination)
    return {"from": source.relative_to(repo_root).as_posix(), "to": destination.relative_to(repo_root).as_posix()}


def apply_asset_review(
    repo_root: Path,
    payload: dict,
    regular_cap: int | None,
    asset_sources: list[Path] | None = None,
) -> dict:
    site = load_site_data(repo_root)
    rng = random.SystemRandom()
    hidden_ids = blacklist_ids_from_payload(payload)
    reserve_only_ids = reserve_only_ids_from_payload(payload)
    country_assignments = country_assignments_from_payload(payload)
    regular_state = expo_state_from_payload(payload)
    reserve_promotions = payload.get("reserve_promotions") if isinstance(payload.get("reserve_promotions"), dict) else {}
    selection_mode = str(payload.get("selection_mode") or "random")
    randomize_expo_selection = selection_mode == "random" and not regular_state
    roots = candidate_asset_roots(repo_root, asset_sources)

    current_groups = {slug: list((site.get("data", {}).get(slug) or {}).get("photos") or []) for slug in ORDER}
    current_groups["unknown"] = list((site.get("owner", {}).get("unknown") or {}).get("photos") or [])
    reserve_groups_input = {
        slug: list((site.get("reserve", {}).get(slug) or {}).get("photos") or [])
        for slug in ORDER
    }
    hidden_groups_input = {
        slug: list((site.get("hidden", {}).get(slug) or {}).get("photos") or [])
        for slug in ORDER
    }

    current_by_id = {
        photo["id"]: (slug, photo)
        for slug, photos in current_groups.items()
        for photo in photos
        if photo.get("id")
    }
    reserve_by_id = {
        photo["id"]: (slug, photo)
        for slug, photos in reserve_groups_input.items()
        for photo in photos
        if photo.get("id")
    }
    hidden_by_id = {
        photo["id"]: (slug, photo)
        for slug, photos in hidden_groups_input.items()
        for photo in photos
        if photo.get("id")
    }
    catalog_ids = set(current_by_id) | set(reserve_by_id) | set(hidden_by_id)
    skipped_missing_hidden_ids = sorted(hidden_ids - catalog_ids)
    skipped_missing_assignment_ids = sorted(set(country_assignments) - catalog_ids)

    def lookup(photo_id: str) -> tuple[str, dict] | None:
        return current_by_id.get(photo_id) or reserve_by_id.get(photo_id)

    def target_slug_for(source_slug: str, photo: dict) -> str:
        assigned_slug = country_assignments.get(photo.get("id"))
        if assigned_slug in ORDER:
            return assigned_slug
        return source_slug if source_slug in ORDER else "unknown"

    if not regular_state:
        regular_state = {}
        for slug in ORDER:
            if slug == "unknown":
                continue
            limit = regular_cap if regular_cap and regular_cap > 0 else None
            current_ids = [
                photo["id"]
                for photo in current_groups.get(slug, [])
                if photo.get("id") not in hidden_ids and photo.get("id") not in reserve_only_ids
            ]
            promoted_ids = [
                photo_id
                for photo_id in reserve_promotions.get(slug, [])
                if isinstance(photo_id, str) and photo_id not in hidden_ids
            ]
            selected_ids = list(dict.fromkeys(current_ids + promoted_ids))
            regular_state[slug] = selected_ids[:limit] if limit else selected_ids

    regular_groups: dict[str, list[dict]] = {slug: [] for slug in ORDER}
    missing_ids = []
    unavailable_regular_ids: set[str] = set()

    def add_regular_photo(slug: str, source_photo: dict) -> bool:
        photo = copy_photo(source_photo)
        photo["_originalGallerySrc"] = photo.get("gallerySrc")
        photo["_originalImageSrc"] = photo.get("imageSrc")
        if not public_preview_allowed(photo):
            if photo.get("id"):
                unavailable_regular_ids.add(photo.get("id"))
            return False
        if not photo_has_regular_source_assets(repo_root, photo, slug, roots):
            if photo.get("id"):
                unavailable_regular_ids.add(photo.get("id"))
            return False
        photo["gallerySrc"] = ""
        photo["imageSrc"] = ""
        regular_groups[slug].append(photo)
        return True

    def randomized_regular_candidates(slug: str) -> list[dict]:
        candidates: list[dict] = []
        seen_ids: set[str] = set()
        for groups in (current_groups, reserve_groups_input):
            for source_slug, photos in groups.items():
                for source_photo in photos:
                    photo_id = source_photo.get("id")
                    if not photo_id or photo_id in seen_ids:
                        continue
                    if not public_preview_allowed(source_photo):
                        continue
                    if photo_id in hidden_ids or photo_id in reserve_only_ids:
                        continue
                    if target_slug_for(source_slug, source_photo) != slug:
                        continue
                    candidates.append(source_photo)
                    seen_ids.add(photo_id)
        return diversified_random_order(candidates, rng)

    for slug in ORDER:
        if slug == "unknown":
            continue
        limit = regular_cap if regular_cap and regular_cap > 0 else None
        if randomize_expo_selection:
            for source_photo in randomized_regular_candidates(slug):
                if limit and len(regular_groups[slug]) >= limit:
                    break
                add_regular_photo(slug, source_photo)
            continue

        for photo_id in (regular_state.get(slug, [])[:limit] if limit else regular_state.get(slug, [])):
            if photo_id in hidden_ids or photo_id in reserve_only_ids:
                continue
            found = lookup(photo_id)
            if not found:
                missing_ids.append(photo_id)
                continue
            _source_slug, source_photo = found
            add_regular_photo(slug, source_photo)

        selected_ids = {photo.get("id") for photo in regular_groups[slug]}
        for source_photo in randomized_regular_candidates(slug):
            photo_id = source_photo.get("id")
            if limit and len(regular_groups[slug]) >= limit:
                break
            if not photo_id or photo_id in selected_ids or photo_id in hidden_ids or photo_id in reserve_only_ids:
                continue
            if add_regular_photo(slug, source_photo):
                selected_ids.add(photo_id)

    regular_groups["unknown"] = []

    target_ids = {photo["id"] for photos in regular_groups.values() for photo in photos}
    copies = []
    missing_assets = []
    for slug, photos in regular_groups.items():
        for photo in photos:
            for derivative, key, original_key in [
                ("gallery", "gallerySrc", "_originalGallerySrc"),
                ("detail", "imageSrc", "_originalImageSrc"),
            ]:
                source_rel = clean_site_src(photo.get(original_key) or photo.get(key))
                source_path = find_asset_path(source_rel, roots)
                if not source_path:
                    missing_assets.append(source_rel)
                    continue
                copies.append((source_path, source_path))

    if missing_assets:
        sample = "\n".join(f"- {path}" for path in missing_assets[:25])
        raise FileNotFoundError(f"Missing derivative assets for review snapshot:\n{sample}")

    reserve_groups: dict[str, list[dict]] = {slug: [] for slug in ORDER}
    hidden_groups: dict[str, list[dict]] = {slug: [] for slug in ORDER}
    skipped_missing_reserve: set[str] = set()
    missing_hidden_assets: set[str] = set()
    moved_hidden_ids: set[str] = set()
    reserve_added_ids: set[str] = set()

    def move_photo_to_hidden(source_slug: str, source_photo: dict) -> list[dict]:
        photo_id = source_photo.get("id")
        if not photo_id:
            return []
        target_slug = country_assignments.get(photo_id, source_slug)
        if target_slug not in hidden_groups:
            target_slug = source_slug if source_slug in hidden_groups else "unknown"
        hidden_photo = copy_photo(source_photo)
        moves: list[dict] = []
        usable = False
        for derivative, key in [("gallery", "gallerySrc"), ("detail", "imageSrc")]:
            target_rel = hidden_asset_rel(source_photo, derivative, target_slug)
            moved = move_asset(repo_root, source_photo.get(key), target_rel)
            if moved:
                hidden_photo[key] = f"./{target_rel}"
                moves.append(moved)
                usable = True
            elif (repo_root / target_rel).exists():
                hidden_photo[key] = f"./{target_rel}"
                usable = True
            else:
                missing_hidden_assets.add(clean_site_src(source_photo.get(key)))
        if usable and photo_id not in moved_hidden_ids:
            hidden_groups[target_slug].append(hidden_photo)
            moved_hidden_ids.add(photo_id)
        return moves

    def move_hidden_photo_to_reserve(source_slug: str, source_photo: dict) -> list[dict]:
        photo_id = source_photo.get("id")
        if not photo_id:
            return []
        target_slug = country_assignments.get(photo_id, source_slug)
        if target_slug not in reserve_groups:
            target_slug = source_slug if source_slug in reserve_groups else "unknown"
        reserve_photo = copy_photo(source_photo)
        for derivative, key in [("gallery", "gallerySrc"), ("detail", "imageSrc")]:
            reserve_photo[key] = ""
        if photo_id not in reserve_added_ids:
            reserve_groups[target_slug].append(reserve_photo)
            reserve_added_ids.add(photo_id)
        return []

    for slug, photos in hidden_groups_input.items():
        for source_photo in photos:
            photo_id = source_photo.get("id")
            if not photo_id or photo_id in target_ids:
                continue
            if photo_id in hidden_ids:
                move_photo_to_hidden(slug, source_photo)
                continue
            move_hidden_photo_to_reserve(slug, source_photo)

    for slug, photos in reserve_groups_input.items():
        for source_photo in photos:
            photo_id = source_photo.get("id")
            if not photo_id or photo_id in target_ids:
                continue
            if photo_id in hidden_ids:
                move_photo_to_hidden(slug, source_photo)
                continue
            target_slug = country_assignments.get(photo_id, slug)
            if target_slug not in reserve_groups:
                target_slug = slug if slug in reserve_groups else "unknown"
            if photo_id in reserve_added_ids:
                continue
            reserve_photo = copy_photo(source_photo)
            reserve_photo["gallerySrc"] = ""
            reserve_photo["imageSrc"] = ""
            reserve_groups[target_slug].append(reserve_photo)
            reserve_added_ids.add(photo_id)

    moved_regular = []
    for slug, photos in current_groups.items():
        for source_photo in photos:
            photo_id = source_photo.get("id")
            if not photo_id or photo_id in target_ids:
                continue
            is_hidden = photo_id in hidden_ids
            target_slug = country_assignments.get(photo_id, slug)
            if target_slug not in reserve_groups:
                target_slug = slug if slug in reserve_groups else "unknown"
            demoted = copy_photo(source_photo)
            for derivative, key in [("gallery", "gallerySrc"), ("detail", "imageSrc")]:
                source_rel = clean_site_src(source_photo.get(key))
                if is_hidden:
                    target_rel = hidden_asset_rel(source_photo, derivative, target_slug)
                    moved = move_asset(repo_root, source_rel, target_rel)
                    if moved:
                        demoted[key] = f"./{target_rel}"
                    elif (repo_root / target_rel).exists():
                        demoted[key] = f"./{target_rel}"
                    else:
                        missing_hidden_assets.add(source_rel)
                else:
                    moved = None
                    demoted[key] = ""
                if moved:
                    moved_regular.append({"id": photo_id, "asset": moved})
            if is_hidden:
                if photo_id not in moved_hidden_ids:
                    hidden_groups[target_slug].append(demoted)
                    moved_hidden_ids.add(photo_id)
            else:
                if photo_id not in reserve_added_ids:
                    reserve_groups[target_slug].append(demoted)
                    reserve_added_ids.add(photo_id)

    ensure_state_folders(repo_root / HIDDEN_ASSET_ROOT)
    write_photos_data_from_site(repo_root, regular_groups, reserve_groups)
    write_regular_manifest_from_site(
        repo_root,
        regular_groups,
        reserve_groups,
        regular_cap,
        hidden_ids,
        "random-review-snapshot" if randomize_expo_selection else "review-snapshot",
    )
    write_reserve_data_from_site(repo_root, reserve_groups)
    write_hidden_data_from_site(repo_root, hidden_groups)
    return {
        "mode": "direct-assets",
        "regular": [{"slug": slug, "count": len(photos)} for slug, photos in regular_groups.items()],
        "reserve": [{"slug": slug, "count": len(photos)} for slug, photos in reserve_groups.items()],
        "hidden": [{"slug": slug, "count": len(photos)} for slug, photos in hidden_groups.items()],
        "moved_regular": moved_regular,
        "hidden_asset_missing_count": len(missing_hidden_assets),
        "unavailable_regular_ids": sorted(unavailable_regular_ids),
        "skipped_missing_state_ids": sorted(set(missing_ids)),
        "skipped_missing_hidden_ids": skipped_missing_hidden_ids,
        "skipped_missing_assignment_ids": skipped_missing_assignment_ids,
        "skipped_missing_reserve_count": len(skipped_missing_reserve),
        "asset_roots": [str(root) for root in roots],
    }


def apply_review_snapshot(
    repo_root: Path,
    review_path: Path,
    regular_cap: int | None,
    rebuild_manifests: bool = False,
    source_root: Path | None = None,
    ai_source_root: Path | None = None,
    asset_sources: list[Path] | None = None,
) -> None:
    payload = json.loads(review_path.read_text(encoding="utf-8"))
    photo_ids = blacklist_ids_from_payload(payload)
    regular_state = expo_state_from_payload(payload)
    reserve_only_ids = reserve_only_ids_from_payload(payload)
    country_assignments = country_assignments_from_payload(payload)
    resolved_regular_cap = regular_cap if regular_cap and regular_cap > 0 else regular_cap_from_payload(payload)
    rebuilt_manifests = []
    if rebuild_manifests:
        rebuilt_manifests = rebuild_missing_manifests(repo_root, source_root, ai_source_root)
    manifest_specs = [(path, mode) for path, mode in source_manifest_specs(repo_root) if path.exists()]
    has_site_asset_catalog = (
        (repo_root / "assets/owner-actions/reserve-data.json").exists()
        or (repo_root / "assets/hidden/hidden-data.json").exists()
    )
    if has_site_asset_catalog or not manifest_specs:
        review_log = apply_asset_review(repo_root, payload, resolved_regular_cap, asset_sources)
        review_log["rebuilt_manifests"] = rebuilt_manifests
        log_dir = repo_root / MODERATION_LOG_ROOT
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / f"{review_path.stem}.applied.json"
        log_path.write_text(json.dumps({"review_snapshot": str(review_path), "applied": review_log}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return

    builder = load_builder(repo_root)
    review_log = {
        "rebuilt_manifests": rebuilt_manifests,
        "regular": move_regular_derivatives(repo_root, photo_ids),
        "ingest": [],
        "country_assignments": [],
    }

    for manifest_path, mode in manifest_specs:
        manifest_rel = manifest_path.relative_to(repo_root).as_posix()
        manifest_payload, rows = load_manifest(manifest_path)
        review_log["country_assignments"].extend(apply_country_assignments(rows, country_assignments))
        for relative_path, row in list(rows.items()):
            if row.get("id") not in photo_ids:
                continue
            moved = []
            slug = ((row.get("gallery_country") or {}).get("slug") or "unknown")
            if slug not in ORDER:
                slug = "unknown"
            for derivative, derivative_rel in row.get("derivatives", {}).items():
                moved_row = move_derivative(repo_root, derivative_rel, hidden_asset_rel(row, derivative, slug))
                if moved_row:
                    moved.append(moved_row)
            review_log["ingest"].append({
                "id": row.get("id"),
                "relative_path": relative_path,
                "manifest": manifest_rel,
                "moved": moved,
            })
            rows.pop(relative_path, None)
        builder.write_manifest(manifest_path, rows, args_from_manifest(manifest_payload))
        builder.write_keyword_index(manifest_path.with_name("keywords.json"), rows)
        builder.write_collection_index(manifest_path.with_name("collections.json"), rows)

    log_dir = repo_root / MODERATION_LOG_ROOT
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{review_path.stem}.applied.json"
    log_path.write_text(json.dumps({"review_snapshot": str(review_path), "applied": review_log}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_photos_data(
        repo_root,
        regular_cap=resolved_regular_cap,
        blacklist_ids=photo_ids,
        pinned_regular_ids=regular_state,
        reserve_only_ids=reserve_only_ids,
        country_assignments=country_assignments,
    )


def apply_blacklist(repo_root: Path, blacklist_path: Path, regular_cap: int | None) -> None:
    apply_review_snapshot(repo_root, blacklist_path, regular_cap)


def main() -> int:
    parser = argparse.ArgumentParser(description="Apply a PhotosByElie Review Snapshot.")
    parser.add_argument("review_snapshot", type=Path)
    parser.add_argument("--expo-cap", dest="regular_cap", type=int, default=None)
    parser.add_argument(
        "--rebuild-missing-manifests",
        action="store_true",
        help="Rebuild missing local Lightroom/AI ingest manifests before applying the pass.",
    )
    parser.add_argument("--source-root", type=Path, default=None, help="Camera source root for manifest rebuilds.")
    parser.add_argument("--ai-source-root", type=Path, default=None, help="AI source root for manifest rebuilds.")
    parser.add_argument(
        "--asset-source",
        action="append",
        type=Path,
        default=[],
        help="Additional repo/worktree or assets folder to search when copying promoted Reserve derivatives.",
    )
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    apply_review_snapshot(
        repo_root,
        args.review_snapshot.expanduser().resolve(),
        args.regular_cap,
        rebuild_manifests=args.rebuild_missing_manifests,
        source_root=args.source_root,
        ai_source_root=args.ai_source_root,
        asset_sources=args.asset_source,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
