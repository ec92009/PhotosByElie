#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import random
import re
import shutil
from collections import defaultdict
from pathlib import Path

from media_keys import DEFAULT_PUBLIC_PREFIX, public_preview_key_for_reference
from media_policy import media_source_policy, public_preview_allowed, source_file_entries

LABELS = {
    "france": ("01", "France", "france-gallery", "Saturn Lightroom archive selections prepared from the Camera source."),
    "usa": ("02", "USA", "usa-gallery", "Saturn Lightroom archive selections prepared from the Camera source."),
    "spain": ("03", "Spain", "spain-gallery", "Saturn Lightroom archive selections prepared from the Camera source."),
    "mexico": ("04", "Mexico", "mexico-gallery", "Saturn Lightroom archive selections prepared from the Camera source."),
    "ai": ("05", "AI", "ai-gallery", "Leonardo archive selections prepared from the Saturn Lightroom AI source."),
    "italy": ("06", "Italy", "italy-gallery", "Saturn and Apple Photos archive selections prepared from Italian sources."),
    "portugal": ("07", "Portugal", "portugal-gallery", "Saturn Lightroom archive selections prepared from the Camera source."),
    "slovakia": ("08", "Slovakia", "slovakia-gallery", "Saturn Lightroom archive selections prepared from the Camera source."),
    "unknown": ("09", "Unknown", "unknown-gallery", "Saturn Lightroom selections that still need a final gallery assignment."),
}

ORDER = ["france", "usa", "spain", "mexico", "ai", "italy", "portugal", "slovakia", "unknown"]
PUBLIC_ORDER = [slug for slug in ORDER if slug != "unknown"]
OWNER_ORDER = ["unknown"]
COUNTRY_ASSIGNMENT_TARGETS = {"france", "usa", "spain", "mexico", "italy", "portugal", "slovakia"}
DEFAULT_REGULAR_CAP = None
DEFAULT_SELECTION_MODE = "random"
DIVERSITY_BUCKET_MINUTES = 10
DEFAULT_PUBLIC_BUCKET = "photosbyelie-public"
DEFAULT_UPLOAD_STATE = Path(".review-logs/r2-upload-state.jsonl")
REGULAR_ASSET_ROOT = Path("assets/expo")
IMPORT_CACHE_ROOT = Path("tmp/import-cache")
RESERVE_ASSET_ROOT = Path("assets/reserve")
HIDDEN_DATA_PATH = Path("assets/hidden/hidden-data.json")
EXPO_MANIFEST_PATH = Path("assets/expo-manifest.json")
HOME_SAMPLE_COUNT = 4


def ensure_state_folders(root: Path) -> None:
    for slug in ORDER:
        folder = root / slug
        folder.mkdir(parents=True, exist_ok=True)
        keep = folder / ".gitkeep"
        if not keep.exists():
            keep.write_text("\n", encoding="utf-8")


def manifest_specs(repo_root: Path) -> list[tuple[Path, str]]:
    return [
        (repo_root / IMPORT_CACHE_ROOT / "manifest.json", "import-cache"),
    ]


def existing_manifest_specs(repo_root: Path) -> list[tuple[Path, str]]:
    specs = [(path, mode) for path, mode in manifest_specs(repo_root) if path.exists()]
    if not specs:
        expected = ", ".join(str(path.relative_to(repo_root)) for path, _mode in manifest_specs(repo_root))
        raise FileNotFoundError(
            "No source ingest manifests found; expected at least one of: "
            f"{expected}. Rebuild them with scripts/build_lightroom_thumbnails.py, "
            "or run scripts/apply_review_snapshot.py with --rebuild-missing-manifests."
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
    return source_file_entries(row)


def public_media_key(row: dict, reference: str) -> str:
    return public_preview_key_for_reference(DEFAULT_PUBLIC_PREFIX, row["id"], reference)


def media_object(row: dict, gallery_rel: str, detail_rel: str) -> dict:
    public_allowed = public_preview_allowed(row)
    return {
        "sourcePolicy": media_source_policy(row),
        "publicPreview": {
            "allowed": public_allowed,
            "galleryKey": public_media_key(row, gallery_rel) if public_allowed else "",
            "detailKey": public_media_key(row, detail_rel) if public_allowed else "",
        },
    }


def source_asset_root(repo_root: Path, mode: str) -> Path:
    return repo_root / IMPORT_CACHE_ROOT


def regular_asset_rel(row: dict, derivative: str) -> str:
    country = (row.get("gallery_country") or {}).get("slug") or "unknown"
    suffix = "900" if derivative == "gallery" else "1800"
    return (REGULAR_ASSET_ROOT / country / f"{row['id']}_{suffix}.jpg").as_posix()


def source_derivative_rel(row: dict, mode: str, derivative: str) -> str:
    return f"./{IMPORT_CACHE_ROOT.as_posix()}/{row['derivatives'][derivative]}"


def derivative_files_exist(repo_root: Path, row: dict, mode: str) -> bool:
    derivatives = row.get("derivatives") or {}
    return all(
        derivatives.get(derivative)
        and (source_asset_root(repo_root, mode) / derivatives[derivative]).exists()
        for derivative in ("gallery", "detail")
    )


def load_uploaded_public_keys(repo_root: Path) -> set[str]:
    path = repo_root / DEFAULT_UPLOAD_STATE
    if not path.exists():
        return set()
    uploaded: set[str] = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("bucket") == DEFAULT_PUBLIC_BUCKET and row.get("key"):
            uploaded.add(str(row["key"]))
    return uploaded


def public_derivatives_uploaded(row: dict, uploaded_public_keys: set[str]) -> bool:
    previews = (row.get("r2") or {}).get("public_previews") or []
    r2_keys = {
        str(item.get("key") or "")
        for item in previews
        if isinstance(item, dict) and item.get("bucket") == DEFAULT_PUBLIC_BUCKET
    }
    expected = {
        public_media_key(row, str((row.get("derivatives") or {}).get(derivative) or ""))
        for derivative in ("gallery", "detail")
    }
    return bool(expected) and expected <= (r2_keys | uploaded_public_keys)


def derivative_files_available(repo_root: Path, row: dict, mode: str, uploaded_public_keys: set[str]) -> bool:
    return derivative_files_exist(repo_root, row, mode) or public_derivatives_uploaded(row, uploaded_public_keys)


def photo_object_data(
    row: dict,
    mode: str,
    index: int,
    gallery_title: str,
    gallery_rel: str,
    detail_rel: str,
) -> dict:
    full_label = f"{source_files(row)[0]['type']} master" if source_files(row) else "Source file"
    return {
        "id": row["id"],
        "className": f"p{(index % 5) + 1}",
        "title": title_from_row(row),
        "caption": caption_from_row(row, gallery_title),
        "full": full_label,
        "megapixels": (row.get("dimensions") or {}).get("megapixels") or 0,
        "gallerySrc": gallery_rel,
        "imageSrc": detail_rel,
        "metadata": normalize_metadata(row),
        "media": media_object(row, gallery_rel, detail_rel),
        "sourceFiles": source_files(row),
    }


def photo_object_lines(
    row: dict,
    mode: str,
    index: int,
    gallery_title: str,
    gallery_rel: str,
    detail_rel: str,
) -> list[str]:
    photo = photo_object_data(row, mode, index, gallery_title, gallery_rel, detail_rel)
    return [
        "      {",
        f"        id: {js(photo['id'])},",
        f"        className: {js(photo['className'])},",
        f"        title: {js(photo['title'])},",
        f"        caption: {js(photo['caption'])},",
        f"        full: {js(photo['full'])},",
        f"        megapixels: {json.dumps(photo['megapixels'])},",
        f"        gallerySrc: {js(photo['gallerySrc'])},",
        f"        imageSrc: {js(photo['imageSrc'])},",
        f"        metadata: {json.dumps(photo['metadata'], ensure_ascii=False, indent=10)},",
        f"        media: {json.dumps(photo['media'], ensure_ascii=False, indent=10)},",
        f"        sourceFiles: {json.dumps(photo['sourceFiles'], ensure_ascii=False, indent=10)}",
        "      },",
    ]


def copy_regular_assets(repo_root: Path, regular_rows: list[tuple[dict, str]]) -> dict[str, int]:
    publish_root = repo_root / REGULAR_ASSET_ROOT
    if publish_root.exists():
        shutil.rmtree(publish_root)
    ensure_state_folders(publish_root)

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


def home_photo_object(photo: dict) -> dict:
    return {
        "id": photo.get("id"),
        "title": photo.get("title"),
        "gallerySrc": photo.get("gallerySrc"),
        "imageSrc": photo.get("imageSrc"),
        "media": photo.get("media") or {},
    }


def write_home_data_from_collections(repo_root: Path, collections: dict[str, dict]) -> Path:
    payload: dict[str, dict] = {}
    for slug in PUBLIC_ORDER:
        collection = collections.get(slug) or {}
        number, title, accent, description = LABELS[slug]
        photos = collection.get("photos") or []
        payload[slug] = {
            "number": collection.get("number") or number,
            "title": collection.get("title") or title,
            "description": collection.get("description") or description,
            "accent": collection.get("accent") or accent,
            "count": len(photos),
            "href": f"./{slug}.html",
            "photos": [home_photo_object(photo) for photo in photos[:HOME_SAMPLE_COUNT]],
        }
    output = repo_root / "home-data.js"
    output.write_text(
        "window.photosByElieHomeData = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )
    return output


def write_home_data(
    repo_root: Path,
    regular_groups: dict[str, list[tuple[dict, str]]],
) -> Path:
    collections: dict[str, dict] = {}
    for slug in PUBLIC_ORDER:
        number, title, accent, description = LABELS[slug]
        photos = []
        for index, (row, mode) in enumerate(regular_groups.get(slug, [])):
            gallery_rel = f"./{regular_asset_rel(row, 'gallery')}"
            detail_rel = f"./{regular_asset_rel(row, 'detail')}"
            photos.append(photo_object_data(row, mode, index, title, gallery_rel, detail_rel))
        collections[slug] = {
            "number": number,
            "title": title,
            "description": description,
            "accent": accent,
            "photos": photos,
        }
    return write_home_data_from_collections(repo_root, collections)


def write_regular_manifest(
    repo_root: Path,
    regular_rows: list[tuple[dict, str]],
    reserve_counts: dict[str, int],
    hidden_counts: dict[str, int],
    regular_cap: int | None,
    selection_mode: str,
    seed: int | None,
) -> None:
    payload = {
        "schema_version": 1,
        "state": "expo",
        "expo_cap": regular_cap,
        "publish_scope": "all-eligible" if regular_cap is None or regular_cap <= 0 else "capped",
        "selection_mode": selection_mode,
        "seed": seed,
        "photos_count": len(regular_rows),
        "reserve_counts": dict(sorted(reserve_counts.items())),
        "hidden_counts": dict(sorted(hidden_counts.items())),
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
    output = repo_root / EXPO_MANIFEST_PATH
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_reserve_data(repo_root: Path, reserve_groups: dict[str, list[tuple[dict, str]]]) -> Path:
    payload = {}
    for slug in ORDER:
        number, title, accent, description = LABELS[slug]
        rows = reserve_groups.get(slug, [])
        payload[slug] = {
            "number": number,
            "title": title,
            "description": description,
            "accent": accent,
            "photos": [
                photo_object_data(
                    row,
                    mode,
                    index,
                    title,
                    source_derivative_rel(row, mode, "gallery"),
                    source_derivative_rel(row, mode, "detail"),
                )
                for index, (row, mode) in enumerate(rows)
            ],
        }
    output = repo_root / RESERVE_ASSET_ROOT / "reserve-data.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return output


def sort_rows(rows: list[tuple[dict, str]]) -> list[tuple[dict, str]]:
    return sorted(
        rows,
        key=lambda item: (((item[0].get("capture") or {}).get("sort") or ""), item[0].get("id", "")),
        reverse=True,
    )


def diversity_bucket(row: dict) -> str:
    capture = row.get("capture") or {}
    value = str(capture.get("sort") or capture.get("datetime") or "")
    match = re.match(r"^(\d{4})[-:]?(\d{2})[-:]?(\d{2})[ T:]?(\d{2})?:?(\d{2})?", value)
    if match and match.group(4) and match.group(5):
        year, month, day, hour, minute = (int(part) for part in match.groups()[:5])
        bucket = ((hour * 60) + minute) // DIVERSITY_BUCKET_MINUTES
        return f"{year:04d}-{month:02d}-{day:02d}:{bucket:02d}"
    if match:
        return f"{match.group(1)}-{match.group(2)}-{match.group(3)}"
    fallback = str(row.get("relative_path") or row.get("id") or "")
    compact = re.search(r"\b(\d{4})(\d{2})(\d{2})", fallback)
    if compact:
        return f"{compact.group(1)}-{compact.group(2)}-{compact.group(3)}"
    return f"id:{row.get('id', '')}"


def diversified_random_order(rows: list[tuple[dict, str]], rng: random.Random) -> list[tuple[dict, str]]:
    buckets: dict[str, list[tuple[dict, str]]] = defaultdict(list)
    for item in rows:
        buckets[diversity_bucket(item[0])].append(item)

    for bucket_rows in buckets.values():
        rng.shuffle(bucket_rows)

    ordered: list[tuple[dict, str]] = []
    active = list(buckets)
    while active:
        rng.shuffle(active)
        next_active = []
        for bucket in active:
            bucket_rows = buckets[bucket]
            if bucket_rows:
                ordered.append(bucket_rows.pop())
            if bucket_rows:
                next_active.append(bucket)
        active = next_active
    return ordered


def load_blacklist_payload(path: Path | None) -> dict:
    if not path:
        return {}
    return json.loads(path.expanduser().read_text(encoding="utf-8"))


def load_json(path: Path, fallback: object) -> object:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return fallback


def blacklist_ids_from_payload(payload: dict) -> set[str]:
    return {photo_id for photo_id in payload.get("photo_ids", []) if isinstance(photo_id, str)}


def hidden_ids_from_current_state(repo_root: Path) -> set[str]:
    path = repo_root / HIDDEN_DATA_PATH
    if not path.exists():
        return set()
    payload = json.loads(path.read_text(encoding="utf-8"))
    hidden_ids: set[str] = set()
    for collection in payload.values() if isinstance(payload, dict) else []:
        if not isinstance(collection, dict):
            continue
        for photo in collection.get("photos", []) or []:
            photo_id = photo.get("id") if isinstance(photo, dict) else None
            if isinstance(photo_id, str) and photo_id:
                hidden_ids.add(photo_id)
    return hidden_ids


def expo_state_from_payload(payload: dict) -> dict[str, list[str]]:
    value = payload.get("expo_state")
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


def country_assignments_from_owner_index(repo_root: Path) -> dict[str, str]:
    payload = load_json(repo_root / "assets/owner-actions/country-assignments.json", {})
    photos = payload.get("photos") if isinstance(payload, dict) else {}
    if not isinstance(photos, dict):
        return {}
    assignments: dict[str, str] = {}
    for photo_id, record in photos.items():
        if not isinstance(photo_id, str) or not isinstance(record, dict):
            continue
        slug = record.get("gallery_key")
        if slug in COUNTRY_ASSIGNMENT_TARGETS:
            assignments[photo_id] = slug
    return assignments


def load_blacklist(path: Path | None) -> set[str]:
    return blacklist_ids_from_payload(load_blacklist_payload(path))


def load_blacklist_expo_state(path: Path | None) -> dict[str, list[str]]:
    return expo_state_from_payload(load_blacklist_payload(path))


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
    regular_cap: int | None,
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
    hidden_counts: dict[str, int] = {}
    pinned_regular_ids = pinned_regular_ids or {}
    reserve_only_ids = reserve_only_ids or set()

    for slug, rows in groups.items():
        blocked = [item for item in rows if item[0].get("id") in blacklist_ids]
        eligible = [item for item in rows if item[0].get("id") not in blacklist_ids]
        if slug == "unknown":
            regular_groups[slug] = sort_rows(eligible)
            reserve_groups[slug] = []
            reserve_counts[slug] = 0
            hidden_counts[slug] = len(blocked)
            continue
        regular_eligible = [
            item
            for item in eligible
            if item[0].get("id") not in reserve_only_ids and public_preview_allowed(item[0])
        ]
        eligible_by_id = {item[0].get("id"): item for item in regular_eligible}
        limit = len(regular_eligible) if regular_cap is None or regular_cap <= 0 else regular_cap
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
            if len(selected) >= limit:
                break

        fill_pool = [item for item in regular_eligible if item[0].get("id") not in selected_ids]
        if selection_mode in {"random", "browser"}:
            fill_pool = diversified_random_order(fill_pool, rng)
        selected.extend(fill_pool[: max(0, limit - len(selected))])

        if pinned_regular_ids.get(slug) or selection_mode in {"random", "browser"}:
            regular_groups[slug] = selected[:limit]
        else:
            regular_groups[slug] = sort_rows(selected[:limit])

        selected_ids = {item[0].get("id") for item in regular_groups[slug]}
        reserve_groups[slug] = sort_rows([item for item in eligible if item[0].get("id") not in selected_ids])
        reserve_counts[slug] = len(reserve_groups[slug])
        hidden_counts[slug] = len(blocked)

    return regular_groups, reserve_groups, reserve_counts, hidden_counts, resolved_seed


def write_photos_data(
    repo_root: Path,
    regular_cap: int | None = DEFAULT_REGULAR_CAP,
    sync_regular_assets: bool = True,
    write_regular_state: bool = True,
    selection_mode: str = DEFAULT_SELECTION_MODE,
    blacklist_ids: set[str] | None = None,
    seed: int | None = None,
    pinned_regular_ids: dict[str, list[str]] | None = None,
    reserve_only_ids: set[str] | None = None,
    country_assignments: dict[str, str] | None = None,
) -> Path:
    groups: dict[str, list[tuple[dict, str]]] = defaultdict(list)
    country_assignments = country_assignments or {}
    uploaded_public_keys = load_uploaded_public_keys(repo_root)
    for path, mode in existing_manifest_specs(repo_root):
        for row in json.loads(path.read_text())["photos"]:
            if not derivative_files_available(repo_root, row, mode, uploaded_public_keys):
                continue
            row = apply_country_assignment(row, country_assignments.get(row.get("id")))
            gallery_country = row.get("gallery_country") or {}
            slug = gallery_country.get("slug") if isinstance(gallery_country, dict) else str(gallery_country)
            if slug not in LABELS:
                slug = "unknown"
            groups[slug].append((row, mode))

    for slug, rows in groups.items():
        groups[slug] = sort_rows(rows)

    regular_groups, reserve_groups, reserve_counts, hidden_counts, resolved_seed = select_regular_groups(
        groups,
        regular_cap,
        selection_mode,
        blacklist_ids or set(),
        seed,
        pinned_regular_ids=pinned_regular_ids,
        reserve_only_ids=reserve_only_ids,
    )
    regular_rows = [item for slug in PUBLIC_ORDER for item in regular_groups.get(slug, [])]
    if sync_regular_assets:
        copy_regular_assets(repo_root, regular_rows)
    if write_regular_state:
        write_regular_manifest(
            repo_root,
            regular_rows,
            reserve_counts,
            hidden_counts,
            regular_cap,
            selection_mode,
            resolved_seed,
        )
        write_reserve_data(repo_root, reserve_groups)
    write_home_data(repo_root, regular_groups)

    def collection_lines(slug: str) -> list[str]:
        number, title, accent, description = LABELS[slug]
        rows = regular_groups.get(slug, [])
        next_lines = [
            f"  {slug}: {{",
            f"    number: {js(number)},",
            f"    title: {js(title)},",
            f"    description: {js(description)},",
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
        "delete window.photosByElieData.unknown;",
        'Object.entries(window.photosByElieData || {}).forEach(([slug, collection]) => {',
        '  (collection.photos || []).forEach((photo) => {',
        '    photo.pricingTier = slug === "ai" ? "ai" : "original";',
        '  });',
        '});',
        'window.photosByElieResolutions = [',
        '  { id: "full", type: "digital", label: "Full resolution", detail: "Original source file at native resolution", price: 65, prices: { original: 65, ai: 25 } },',
        '  { id: "jpg-6mp", type: "digital", label: "JPG 6 MP", detail: "Long edge export for print and premium web", price: 28, prices: { original: 28, ai: 14 }, minMegapixels: 6 },',
        '  { id: "jpg-3mp", type: "digital", label: "JPG 3 MP", detail: "Listing, portfolio, and editorial web use", price: 16, prices: { original: 16, ai: 8 }, minMegapixels: 3 },',
        '  { id: "jpg-1mp", type: "digital", label: "JPG 1 MP", detail: "Small web preview and social draft use", price: 8, prices: { original: 8, ai: 4 }, minMegapixels: 1 },',
        '  { id: "print-4x6", type: "print", label: "Print", dimensions: { imperial: "4 x 6 in", metric: "10 x 15 cm" }, detail: "Small classic photo print", price: 12, minMegapixels: 1 },',
        '  { id: "print-5x7", type: "print", label: "Print", dimensions: { imperial: "5 x 7 in", metric: "13 x 18 cm" }, detail: "Popular gift and desk frame size", price: 18, minMegapixels: 2 },',
        '  { id: "print-8x10", type: "print", label: "Print", dimensions: { imperial: "8 x 10 in", metric: "20 x 25 cm" }, detail: "Popular wall and shelf print size", price: 32, minMegapixels: 6 },',
        '  { id: "print-11x14", type: "print", label: "Print", dimensions: { imperial: "11 x 14 in", metric: "28 x 36 cm" }, detail: "Larger display print with manual crop review", price: 48, minMegapixels: 10 }',
        '];',
        'window.photosByEliePriceTiers = {',
        '  original: { label: "Original photo" },',
        '  ai: { label: "AI image" }',
        '};',
        'window.photosByElieFrameOptions = [',
        '  { id: "none", label: "No frame", price: 0 },',
        '  { id: "white", label: "Plain white frame", price: 37, prices: { "print-4x6": 33, "print-5x7": 37, "print-8x10": 53, "print-11x14": 77 } },',
        '  { id: "black", label: "Plain black frame", price: 37, prices: { "print-4x6": 33, "print-5x7": 37, "print-8x10": 53, "print-11x14": 77 } }',
        '];',
        'window.photosByElieShippingHandlingPrices = {',
        '  "print-4x6": 7,',
        '  "print-5x7": 8,',
        '  "print-8x10": 12,',
        '  "print-11x14": 16',
        '};',
        "",
        'window.photosByEliePricingTier = (photo) => photo?.pricingTier || "original";',
        'window.photosByEliePricingTierLabel = (photo) => window.photosByEliePriceTiers?.[window.photosByEliePricingTier(photo)]?.label || "Original photo";',
        'window.photosByElieOptionPrice = (photo, option) => Number(option?.prices?.[window.photosByEliePricingTier(photo)] ?? option?.price ?? 0);',
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
        '  const physicalProductsEnabled = window.photosByElieProductSettings?.physicalProductsEnabled?.() === true;',
        '  return options.filter((option) =>',
        '    (physicalProductsEnabled || option.type !== "print")',
        '    && (!option.minMegapixels || megapixels >= option.minMegapixels)',
        '  ).map((option) => ({ ...option, price: window.photosByElieOptionPrice(photo, option) }));',
        '};',
        "",
        'window.photosByElieFormatLabel = (source) => {',
        '  const value = String(source || "");',
        '  const checks = [',
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
        'window.photosByElieMeasurementSystem = () => {',
        '  const nav = typeof navigator === "undefined" ? {} : navigator;',
        '  const locales = [...(nav.languages || []), nav.language, Intl.DateTimeFormat().resolvedOptions().locale].filter(Boolean);',
        '  const imperialRegions = new Set(["US", "LR", "MM"]);',
        '  for (const locale of locales) {',
        '    try {',
        '      const intlLocale = new Intl.Locale(locale).maximize();',
        '      if (intlLocale.measurementSystem === "metric" || intlLocale.measurementSystem === "ussystem") {',
        '        return intlLocale.measurementSystem === "ussystem" ? "imperial" : "metric";',
        '      }',
        '      if (intlLocale.region) return imperialRegions.has(intlLocale.region) ? "imperial" : "metric";',
        '    } catch {}',
        '  }',
        '  return "metric";',
        '};',
        'window.photosByElieProductLabel = (option) => {',
        '  if (option?.type !== "print" || !option.dimensions) return option?.label || "";',
        '  const preferred = window.photosByElieMeasurementSystem() === "imperial" ? "imperial" : "metric";',
        '  const secondary = preferred === "imperial" ? "metric" : "imperial";',
        '  return `${option.label} ${option.dimensions[preferred]} / ${option.dimensions[secondary]}`;',
        '};',
        'window.photosByElieFrameLabel = (frameId) => (',
        '  (window.photosByElieFrameOptions || []).find((frame) => frame.id === frameId)?.label || "No frame"',
        ');',
        'window.photosByElieFramePrice = (frame, option) => {',
        '  const frameId = typeof frame === "string" ? frame : frame?.id;',
        '  const catalogFrame = (window.photosByElieFrameOptions || []).find((item) => item.id === frameId);',
        '  const pricedFrame = catalogFrame || frame;',
        '  return Number(pricedFrame?.prices?.[option?.id] ?? pricedFrame?.price ?? frame?.price ?? 0);',
        '};',
        'window.photosByElieOptionQuantity = (option) => option?.type === "print" ? Math.max(1, Number(option.quantity) || 1) : 1;',
        'window.photosByElieOptionShippingHandlingUnitPrice = (option) => option?.type === "print" ? Number(window.photosByElieShippingHandlingPrices?.[option?.id] || 0) : 0;',
        'window.photosByElieOptionShippingHandlingTotal = (option) => window.photosByElieOptionQuantity(option) * window.photosByElieOptionShippingHandlingUnitPrice(option);',
        'window.photosByElieShippingHandlingNote = (option) => {',
        '  const price = window.photosByElieOptionShippingHandlingUnitPrice(option);',
        '  return option?.type === "print" && price ? `S&H $${price} added and removed as a limited-time discount.` : "";',
        '};',
        'window.photosByElieProductDetail = (photo, option) => [',
        '  window.photosByElieResolutionDetail(photo, option),',
        '  window.photosByElieShippingHandlingNote(option)',
        '].filter(Boolean).join(" ");',
        'window.photosByElieOptionUnitPrice = (option) => Number(option?.price) + Number(window.photosByElieFramePrice?.(option?.frame, option) || 0);',
        'window.photosByElieOptionTotal = (option) => window.photosByElieOptionQuantity(option) * window.photosByElieOptionUnitPrice(option);',
    ]

    output = repo_root / "photos-data.js"
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export publishable Photos By Elie data from ingest manifests.")
    parser.add_argument(
        "--expo-cap",
        dest="regular_cap",
        type=int,
        default=DEFAULT_REGULAR_CAP,
        help="Optional legacy cap. Omit to publish every eligible cloud-backed preview.",
    )
    parser.add_argument("--selection", choices=("random", "newest"), default=DEFAULT_SELECTION_MODE)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--review-snapshot", "--blacklist", dest="review_snapshot", type=Path, default=None, help="Optional Review Snapshot file to apply hidden, reserve, and classification choices.")
    parser.add_argument("--no-sync-assets", action="store_true")
    parser.add_argument("--external-media", action="store_true", help="Write public metadata/R2 keys without copying JPG derivatives into tracked assets/expo.")
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    review_payload = load_blacklist_payload(args.review_snapshot)
    hidden_ids = hidden_ids_from_current_state(repo_root) | blacklist_ids_from_payload(review_payload)
    country_assignments = country_assignments_from_owner_index(repo_root)
    country_assignments.update(country_assignments_from_payload(review_payload))
    result = write_photos_data(
        repo_root,
        regular_cap=args.regular_cap,
        sync_regular_assets=not args.no_sync_assets and not args.external_media,
        write_regular_state=not args.no_sync_assets,
        selection_mode=args.selection,
        blacklist_ids=hidden_ids,
        seed=args.seed,
        pinned_regular_ids=expo_state_from_payload(review_payload),
        reserve_only_ids=reserve_only_ids_from_payload(review_payload),
        country_assignments=country_assignments,
    )
    print(result)
