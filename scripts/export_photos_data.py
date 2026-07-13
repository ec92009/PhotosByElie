#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sqlite3
import subprocess
from collections import defaultdict
from pathlib import Path, PurePosixPath

from media_keys import DEFAULT_PUBLIC_PREFIX, public_preview_key, public_preview_key_for_reference
from media_policy import media_source_policy, public_preview_allowed, source_file_entries
from import_eligibility import row_import_eligible
from import_source_anchor import row_freshness_key, source_paths_from_row
from owner_state_db import connect as owner_db_connect, keyword_blacklist_terms as owner_keyword_blacklist_terms, media_lifecycle_snapshot

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
RETIRED_STOREFRONT_COLLECTIONS = {"ai"}
RETIRED_STOREFRONT_ORIGINS = {"ai"}
PUBLIC_ORDER = [slug for slug in ORDER if slug != "unknown" and slug not in RETIRED_STOREFRONT_COLLECTIONS]
OWNER_ORDER = ["unknown"]
COUNTRY_ASSIGNMENT_TARGETS = {"france", "usa", "spain", "mexico", "italy", "portugal", "slovakia"}
AI_SOURCE_MODE_HINTS = {"ai", "leonardo"}
EXPORT_COUNTRY_HINTS = {
    "florence": ("italy", "Italy"),
    "firenze": ("italy", "Italy"),
    "pisa": ("italy", "Italy"),
    "san gimignano": ("italy", "Italy"),
    "tuscany": ("italy", "Italy"),
}
DEFAULT_REGULAR_CAP = None
DEFAULT_SELECTION_MODE = "random"
DIVERSITY_BUCKET_MINUTES = 10
DEFAULT_PUBLIC_BUCKET = "photosbyelie-public"
DEFAULT_UPLOAD_STATE = Path(".review-logs/r2-upload-state.jsonl")
IMPORT_CACHE_ROOT = Path("tmp/import-cache")
HIDDEN_DATA_PATH = Path("assets/hidden/hidden-data.json")
EXPO_MANIFEST_PATH = Path("assets/expo-manifest.json")
HOME_DATA_PATH = Path("home-data.js")
PUBLIC_CATALOG_DB_PATH = Path("assets/catalog/photosbyelie.sqlite")
ALLOW_EMPTY_PUBLIC_CATALOG_ENV = "PBE_ALLOW_EMPTY_PUBLIC_CATALOG"
DEFAULT_KEYWORD_BLACKLIST = Path("assets/owner-actions/keyword-blacklist.json")
DISCARDED_TOMBSTONE_PATH = Path("assets/discarded/discarded-photo-ids.json")
DISCARDED_MEDIA_MANIFEST_PATH = Path("assets/discarded-media-manifest.json")


def refresh_public_catalog_artifacts(repo_root: Path) -> None:
    subprocess.run(
        ["node", "scripts/write_catalog_tsv.cjs"],
        cwd=repo_root,
        check=True,
        stdout=subprocess.DEVNULL,
    )
HOME_SAMPLE_COUNT = 4


def existing_public_catalog_media_count(repo_root: Path) -> int:
    path = repo_root / PUBLIC_CATALOG_DB_PATH
    if not path.exists():
        return 0
    try:
        conn = sqlite3.connect(path)
        row = conn.execute("SELECT COUNT(*) FROM media_items").fetchone()
    except sqlite3.Error:
        return 0
    finally:
        try:
            conn.close()
        except UnboundLocalError:
            pass
    return int(row[0] or 0) if row else 0


def existing_home_data_photo_count(repo_root: Path) -> int:
    path = repo_root / HOME_DATA_PATH
    if not path.exists():
        return 0
    prefix = "window.photosByElieHomeData = "
    text = path.read_text(encoding="utf-8")
    if not text.startswith(prefix):
        return 0
    payload = text[len(prefix) :].strip()
    if payload.endswith(";"):
        payload = payload[:-1].strip()
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return 0
    total = 0
    for collection in data.values():
        if not isinstance(collection, dict):
            continue
        count = collection.get("count")
        if isinstance(count, int):
            total += count
            continue
        photos = collection.get("photos")
        total += len(photos) if isinstance(photos, list) else 0
    return total


def ensure_state_folders(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)


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
    owner_title = str(row.get("owner_title") or "").strip()
    if owner_title:
        return owner_title
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


def split_keyword_text(value: object) -> list[str]:
    if isinstance(value, list):
        keywords: list[str] = []
        for item in value:
            keywords.extend(split_keyword_text(item))
        return keywords
    return [part.strip() for part in str(value or "").split(",") if part.strip()]


def clean_keywords(values: object, keyword_blacklist: set[str]) -> list[str]:
    keywords: list[str] = []
    seen: set[str] = set()
    for keyword in split_keyword_text(values):
        normalized = keyword.casefold()
        if normalized in seen or normalized in keyword_blacklist:
            continue
        seen.add(normalized)
        keywords.append(keyword)
    return keywords


def set_metadata_value(row: dict, label: str, value: str) -> dict:
    row = dict(row)
    metadata = [dict(item) for item in row.get("metadata") or [] if isinstance(item, dict)]
    target = label.casefold()
    for item in metadata:
        if str(item.get("label") or "").casefold() == target:
            item["value"] = value
            row["metadata"] = metadata
            return row
    metadata.insert(0, {"label": label, "value": value})
    row["metadata"] = metadata
    return row


def load_applied_title_keyword_decisions(repo_root: Path) -> dict[str, dict[str, object]]:
    conn = owner_db_connect(repo_root)
    try:
        rows = conn.execute(
            """
            SELECT q.media_id, d.decided_title, d.decided_keywords
            FROM title_keyword_queue AS q
            JOIN title_keyword_decisions AS d
              ON d.media_id = q.media_id
             AND d.attempt = q.latest_attempt
            WHERE q.review_state IN ('approved', 'applied')
              AND d.decision_state = 'accepted'
              AND COALESCE(d.applied_at, '') <> ''
            """
        ).fetchall()
    finally:
        conn.close()
    decisions: dict[str, dict[str, object]] = {}
    for row in rows:
        media_id = str(row["media_id"] or "").strip()
        if not media_id:
            continue
        decisions[media_id] = {
            "title": str(row["decided_title"] or "").strip(),
            "keywords": split_keyword_text(row["decided_keywords"]),
        }
    return decisions


def apply_title_keyword_decision(row: dict, decision: dict[str, object] | None) -> dict:
    if not decision:
        return row
    title = str(decision.get("title") or "").strip()
    keywords = split_keyword_text(decision.get("keywords"))
    if not title and not keywords:
        return row
    row = dict(row)
    if title:
        row["owner_title"] = title
    if keywords:
        row["keywords"] = keywords
        row = set_metadata_value(row, "Keywords", ", ".join(keywords))
    return row


def normalize_metadata(row: dict, keyword_blacklist: set[str] | None = None) -> list[dict]:
    keyword_blacklist = keyword_blacklist or set()
    items = list(row.get("metadata") or [])
    for item in items:
        if item.get("label") == "Keywords":
            item["value"] = ", ".join(clean_keywords(item.get("value"), keyword_blacklist))
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


def sanitize_keyword_metadata(row: dict, keyword_blacklist: set[str]) -> dict:
    if not keyword_blacklist:
        return row
    row = dict(row)
    if "keywords" in row:
        row["keywords"] = clean_keywords(row.get("keywords"), keyword_blacklist)
    if "metadata" in row:
        row["metadata"] = normalize_metadata(row, keyword_blacklist)
    return row


def source_files(row: dict) -> list[dict]:
    return source_file_entries(row)


def public_media_key(row: dict, reference: str) -> str:
    return public_preview_key_for_reference(DEFAULT_PUBLIC_PREFIX, row["id"], reference)


def media_type_from_row(row: dict) -> str:
    value = str(row.get("media_type") or row.get("mediaType") or "").strip().lower()
    if value:
        return value
    source_types = {str(source.get("type") or "").strip().upper() for source in source_files(row)}
    return "video" if source_types & {"MOV", "MP4", "M4V"} else "photo"


def public_media_key_for_derivative(row: dict, derivative: str) -> str:
    return public_preview_key(DEFAULT_PUBLIC_PREFIX, row["id"], derivative, media_type_from_row(row))


def media_object(row: dict, gallery_rel: str, detail_rel: str) -> dict:
    public_allowed = public_preview_allowed(row)
    media_type = media_type_from_row(row)
    media = {
        "type": media_type,
        "sourcePolicy": media_source_policy(row),
        "publicPreview": {
            "allowed": public_allowed,
            "galleryKey": public_media_key_for_derivative(row, "gallery") if public_allowed else "",
            "detailKey": public_media_key_for_derivative(row, "detail") if public_allowed else "",
        },
    }
    if media_type == "video":
        duration = (row.get("dimensions") or {}).get("duration_seconds")
        if duration:
            media["video"] = {"duration": duration}
        detail_facts = (row.get("derivative_files") or {}).get("detail") or {}
        if detail_facts.get("width") and detail_facts.get("height"):
            media["publicPreview"]["dimensions"] = {
                "width": detail_facts["width"],
                "height": detail_facts["height"],
            }
    return media


def source_origin_from_row(row: dict, collection_slug: str | None = None) -> str:
    gallery_country = row.get("gallery_country") or {}
    slug = collection_slug
    if slug is None:
        slug = gallery_country.get("slug") if isinstance(gallery_country, dict) else str(gallery_country or "")
    source_mode = str(row.get("source_mode") or row.get("sourceMode") or "").strip().lower()
    relative_path = str(row.get("relative_path") or "").lower()
    source_paths = " ".join(str(source.get("path") or "").lower() for source in source_files(row))
    if slug == "ai" or source_mode in AI_SOURCE_MODE_HINTS or "leonardo" in relative_path or "leonardo" in source_paths:
        return "ai"
    return "camera"


def source_asset_root(repo_root: Path, mode: str) -> Path:
    return repo_root / IMPORT_CACHE_ROOT


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
    source_origin = source_origin_from_row(row)
    return {
        "id": row["id"],
        "className": f"p{(index % 5) + 1}",
        "title": title_from_row(row),
        "caption": caption_from_row(row, gallery_title),
        "captionColor": str(row.get("caption_color") or row.get("captionColor") or "").strip().upper(),
        "full": full_label,
        "megapixels": (row.get("dimensions") or {}).get("megapixels") or 0,
        "sourceOrigin": source_origin,
        "pricingTier": "ai" if source_origin == "ai" else "original",
        "gallerySrc": gallery_rel,
        "imageSrc": detail_rel,
        "metadata": normalize_metadata(row),
        "media": media_object(row, gallery_rel, detail_rel),
        "gps": row.get("gps") or {},
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
        f"        captionColor: {js(photo['captionColor'])},",
        f"        full: {js(photo['full'])},",
        f"        megapixels: {json.dumps(photo['megapixels'])},",
        f"        sourceOrigin: {js(photo['sourceOrigin'])},",
        f"        pricingTier: {js(photo['pricingTier'])},",
        f"        gallerySrc: {js(photo['gallerySrc'])},",
        f"        imageSrc: {js(photo['imageSrc'])},",
        f"        metadata: {json.dumps(photo['metadata'], ensure_ascii=False, indent=10)},",
        f"        media: {json.dumps(photo['media'], ensure_ascii=False, indent=10)},",
        f"        gps: {json.dumps(photo['gps'], ensure_ascii=False, indent=10)},",
        f"        sourceFiles: {json.dumps(photo['sourceFiles'], ensure_ascii=False, indent=10)}",
        "      },",
    ]


def copy_regular_assets(repo_root: Path, regular_rows: list[tuple[dict, str]]) -> dict[str, int]:
    raise RuntimeError("Local preview asset publishing has been retired; use --external-media.")


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
            "href": f"./gallery.html?gallery={slug}",
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
            photos.append(photo_object_data(row, mode, index, title, "", ""))
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
        "title_keyword_visibility": "applied-only",
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
                    "gallery": public_media_key_for_derivative(row, "gallery"),
                    "detail": public_media_key_for_derivative(row, "detail"),
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
    return repo_root / "assets/owner-actions/reserve-data.retired.json"


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


def load_keyword_blacklist(path: Path | None) -> set[str]:
    del path
    repo_root = Path(__file__).resolve().parents[1]
    return {keyword.casefold() for keyword in owner_keyword_blacklist_terms(repo_root)}


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


def discarded_ids_from_payload(payload: object) -> set[str]:
    if not isinstance(payload, dict):
        return set()
    discarded_ids: set[str] = set()
    for key in ("photo_ids", "discardedPhotoIds"):
        values = payload.get(key)
        if isinstance(values, list):
            discarded_ids.update(str(value) for value in values if str(value).strip())
    photos = payload.get("photos")
    if isinstance(photos, list):
        for photo in photos:
            if isinstance(photo, dict) and str(photo.get("id") or "").strip():
                discarded_ids.add(str(photo["id"]))
            elif str(photo).strip():
                discarded_ids.add(str(photo))
    return discarded_ids


def discarded_ids_from_current_state(repo_root: Path) -> set[str]:
    discarded_ids: set[str] = set()
    for relative_path in (DISCARDED_TOMBSTONE_PATH, DISCARDED_MEDIA_MANIFEST_PATH):
        discarded_ids.update(discarded_ids_from_payload(load_json(repo_root / relative_path, {})))
    return discarded_ids


def normalize_source_path_value(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    try:
        return Path(text).expanduser().resolve(strict=False).as_posix()
    except OSError:
        return Path(text).expanduser().as_posix()


def source_path_values_from_object(value: object) -> set[str]:
    paths: set[str] = set()
    if isinstance(value, dict):
        for key in ("source_path_hint", "sourcePath", "source_path", "sourceFile", "path"):
            normalized = normalize_source_path_value(value.get(key))
            if normalized:
                paths.add(normalized)
        for key in ("source_paths", "sourcePaths", "sourceFiles", "source_files"):
            paths.update(source_path_values_from_object(value.get(key)))
        source_file = value.get("source_file")
        if isinstance(source_file, dict):
            paths.update(source_path_values_from_object(source_file))
    elif isinstance(value, list):
        for item in value:
            paths.update(source_path_values_from_object(item))
    elif isinstance(value, str):
        normalized = normalize_source_path_value(value)
        if normalized:
            paths.add(normalized)
    return paths


def discarded_source_paths_from_payload(payload: object) -> set[str]:
    return source_path_values_from_object(payload)


def discarded_source_paths_from_current_state(repo_root: Path, discarded_ids: set[str]) -> set[str]:
    paths: set[str] = set()
    for relative_path in (DISCARDED_TOMBSTONE_PATH, DISCARDED_MEDIA_MANIFEST_PATH):
        paths.update(discarded_source_paths_from_payload(load_json(repo_root / relative_path, {})))
    tmp_root = repo_root / "tmp"
    if discarded_ids and tmp_root.exists():
        for manifest_path in tmp_root.glob("**/manifest.json"):
            payload = load_json(manifest_path, {})
            rows = payload.get("photos") if isinstance(payload, dict) else None
            if not isinstance(rows, list):
                continue
            for row in rows:
                if isinstance(row, dict) and str(row.get("id") or "") in discarded_ids:
                    paths.update(source_path_values_from_object(row))
    return paths


def source_path_suffixes(paths: set[str]) -> set[str]:
    suffixes = set()
    for value in paths:
        text = PurePosixPath(value).as_posix().strip("/")
        if "/" in text:
            suffixes.add(text)
    return suffixes


def row_source_path_is_blocked(row: dict, blocked_paths: set[str], blocked_suffixes: set[str]) -> bool:
    for value in source_path_values_from_object(row):
        if value in blocked_paths:
            return True
        candidate = PurePosixPath(value).as_posix().strip("/")
        for suffix in blocked_suffixes:
            if candidate == suffix or candidate.endswith(f"/{suffix}"):
                return True
    return False


def apply_export_country_hints(row: dict) -> dict:
    gallery_country = row.get("gallery_country") or {}
    slug = gallery_country.get("slug") if isinstance(gallery_country, dict) else str(gallery_country or "")
    if slug and slug != "unknown":
        return row
    haystack_values = [
        str(row.get("relative_path") or row.get("relativePath") or ""),
        *source_path_values_from_object(row),
    ]
    haystack = " ".join(haystack_values).casefold()
    if "leonardo" in haystack:
        return row
    for hint, (target_slug, label) in EXPORT_COUNTRY_HINTS.items():
        if hint in haystack:
            row = dict(row)
            row["gallery_country"] = {"slug": target_slug, "label": label, "source": "path_hint"}
            return row
    return row


def dedupe_rows_by_source_anchor(rows: list[dict]) -> list[dict]:
    keyed: dict[str, dict] = {}
    output: list[dict] = []
    for row in rows:
        paths = sorted(source_paths_from_row(row))
        if not paths:
            output.append(row)
            continue
        key = paths[0]
        previous = keyed.get(key)
        if previous is None:
            keyed[key] = row
            output.append(row)
            continue
        if row_freshness_key(row) <= row_freshness_key(previous):
            continue
        keyed[key] = row
        for index, existing in enumerate(output):
            if existing is previous:
                output[index] = row
                break
    return output


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
    conn = owner_db_connect(repo_root)
    assignments: dict[str, str] = {}
    try:
        rows = conn.execute("SELECT media_id, country_slug FROM country_assignments").fetchall()
        for row in rows:
            slug = row["country_slug"]
            if slug in COUNTRY_ASSIGNMENT_TARGETS:
                assignments[row["media_id"]] = slug
    finally:
        conn.close()
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
    keyword_blacklist: set[str] | None = None,
    blacklist_source_paths: set[str] | None = None,
    title_keyword_decisions: dict[str, dict[str, object]] | None = None,
) -> Path:
    groups: dict[str, list[tuple[dict, str]]] = defaultdict(list)
    country_assignments = country_assignments or {}
    keyword_blacklist = keyword_blacklist or set()
    blacklist_source_paths = blacklist_source_paths or set()
    if title_keyword_decisions is None:
        title_keyword_decisions = load_applied_title_keyword_decisions(repo_root)
    applied_title_keyword_ids = set(title_keyword_decisions)
    blacklist_source_suffixes = source_path_suffixes(blacklist_source_paths)
    uploaded_public_keys = load_uploaded_public_keys(repo_root)
    blacklist_ids = blacklist_ids or set()
    for path, mode in existing_manifest_specs(repo_root):
        manifest_rows = [row for row in json.loads(path.read_text())["photos"] if isinstance(row, dict)]
        for row in dedupe_rows_by_source_anchor(manifest_rows):
            row_id = str(row.get("id") or "").strip()
            if not row_id or row_id not in applied_title_keyword_ids:
                continue
            if row_id in blacklist_ids:
                continue
            if row_source_path_is_blocked(row, blacklist_source_paths, blacklist_source_suffixes):
                continue
            if not row_import_eligible(row)[0]:
                continue
            if not derivative_files_available(repo_root, row, mode, uploaded_public_keys):
                continue
            row = apply_country_assignment(row, country_assignments.get(row.get("id")))
            row = apply_export_country_hints(row)
            row = apply_title_keyword_decision(row, title_keyword_decisions.get(row_id))
            row = sanitize_keyword_metadata(row, keyword_blacklist)
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
    for slug in PUBLIC_ORDER:
        regular_groups[slug] = [
            item
            for item in regular_groups.get(slug, [])
            if source_origin_from_row(item[0], slug) not in RETIRED_STOREFRONT_ORIGINS
        ]
    regular_rows = [item for slug in PUBLIC_ORDER for item in regular_groups.get(slug, [])]
    existing_catalog_count = existing_public_catalog_media_count(repo_root)
    existing_home_count = existing_home_data_photo_count(repo_root)
    if (
        not regular_rows
        and (existing_catalog_count > 0 or existing_home_count > 0)
        and os.environ.get(ALLOW_EMPTY_PUBLIC_CATALOG_ENV) != "1"
    ):
        raise RuntimeError(
            "Refusing to overwrite populated public catalog artifacts with zero publishable photos "
            f"(sqlite={existing_catalog_count:,}, home-data={existing_home_count:,}). "
            f"Rebuild the full import cache or set {ALLOW_EMPTY_PUBLIC_CATALOG_ENV}=1 if this is intentional."
        )
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
            next_lines += photo_object_lines(row, mode, index, title, "", "")
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
        'window.photosByElieOriginTypes = {',
        '  camera: { label: "Camera photo", shortLabel: "Camera" },',
        '  ai: { label: "AI image", shortLabel: "AI" }',
        '};',
        'window.photosByEliePhotoOrigin = (photo, collectionKey = "") => {',
        '  const origin = String(photo?.sourceOrigin || photo?.origin || "").toLowerCase();',
        '  if (origin === "ai" || origin === "camera") return origin;',
        '  if (String(photo?.pricingTier || "").toLowerCase() === "ai") return "ai";',
        '  const sourceText = [',
        '    photo?.caption,',
        '    ...(photo?.sourceFiles || []).map((source) => source?.path),',
        '    ...(photo?.metadata || []).map((item) => item?.value)',
        '  ].filter(Boolean).join(" ").toLowerCase();',
        '  if (sourceText.includes("leonardo")) return "ai";',
        '  return String(collectionKey || "").toLowerCase() === "ai" ? "ai" : "camera";',
        '};',
        'window.photosByEliePhotoOriginLabel = (photo, collectionKey = "") => {',
        '  const origin = window.photosByEliePhotoOrigin(photo, collectionKey);',
        '  return window.photosByElieOriginTypes?.[origin]?.label || "Camera photo";',
        '};',
        'window.photosByEliePhotoOriginShortLabel = (photo, collectionKey = "") => {',
        '  const origin = window.photosByEliePhotoOrigin(photo, collectionKey);',
        '  return window.photosByElieOriginTypes?.[origin]?.shortLabel || "Camera";',
        '};',
        'window.photosByElieApplyCollectionOrigins = (collections = {}) => {',
        '  Object.entries(collections || {}).forEach(([slug, collection]) => {',
        '    (collection.photos || []).forEach((photo) => {',
        '      const origin = window.photosByEliePhotoOrigin(photo, slug);',
        '      photo.sourceOrigin = origin;',
        '      photo.pricingTier = origin === "ai" ? "ai" : "original";',
        '    });',
        '  });',
        '  return collections;',
        '};',
        'window.photosByElieApplyCollectionOrigins(window.photosByElieData);',
        'window.photosByElieApplyCollectionOrigins(window.photosByElieOwnerData);',
        'window.photosByElieApplyStorefrontPolicy?.(window.photosByElieData);',
        'window.photosByElieResolutions = window.photosByElieResolutions || [];',
        'window.photosByEliePriceTiers = window.photosByEliePriceTiers || {};',
        'window.photosByElieFrameOptions = window.photosByElieFrameOptions || [];',
        'window.photosByElieShippingHandlingPrices = window.photosByElieShippingHandlingPrices || {};',
        'window.photosByEliePodAutomation = window.photosByEliePodAutomation || {};',
        'window.photosByEliePodSuppliers = window.photosByEliePodSuppliers || [];',
        'window.photosByEliePodQualityTiers = window.photosByEliePodQualityTiers || [];',
        'window.photosByEliePodOptions = window.photosByEliePodOptions || [];',
        "",
        'window.photosByEliePricingTier = (photo) => window.photosByEliePhotoOrigin(photo) === "ai" ? "ai" : "original";',
        'window.photosByEliePricingTierLabel = (photo) => window.photosByEliePriceTiers?.[window.photosByEliePricingTier(photo)]?.label || "Camera photo";',
        'window.photosByElieOptionPrice = (photo, option) => Number(option?.prices?.[window.photosByEliePricingTier(photo)] ?? option?.price ?? 0);',
        "",
        'window.photosByElieMediaType = (photo) => String(photo?.media?.type || photo?.type || "photo").toLowerCase();',
        'window.photosByElieIsVideo = (photo) => window.photosByElieMediaType(photo) === "video";',
        'window.photosByElieVideoPriceTiers = window.photosByElieVideoPriceTiers || {};',
        'window.photosByElieVideoTier = (photo) => {',
        '  const duration = Number(photo?.media?.video?.duration || photo?.duration || 0);',
        '  if (duration < 10) return "video_short";',
        '  if (duration < 30) return "video_medium";',
        '  if (duration < 60) return "video_long";',
        '  if (duration < 180) return "video_extended";',
        '  return "video_premium";',
        '};',
        'window.photosByElieVideoDownloadOption = (photo) => {',
        '  const tier = window.photosByElieVideoTier(photo);',
        '  const priceTier = window.photosByElieVideoPriceTiers?.[tier] || { price: 20 };',
        '  return { id: "video-original", type: "video", label: "Original video download", detail: "Private original video file after purchase", price: Number(priceTier.price) || 0, priceKey: tier };',
        '};',
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
        '  if (!window.photosByElieStorefrontAllowsPhoto?.(photo)) return [];',
        '  if (window.photosByElieIsVideo?.(photo)) return [window.photosByElieVideoDownloadOption(photo)];',
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
        r'    { label: "MOV", pattern: /\b(MOV|QUICKTIME)\b/i },',
        r'    { label: "MP4", pattern: /\b(MP4|M4V)\b/i },',
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
    output.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    refresh_public_catalog_artifacts(repo_root)
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
    parser.add_argument("--keyword-blacklist", type=Path, default=DEFAULT_KEYWORD_BLACKLIST, help="Owner metadata keywords to omit from generated public/reserve catalogs.")
    parser.add_argument("--no-sync-assets", action="store_true")
    parser.add_argument("--external-media", action="store_true", help="Write public metadata/R2 keys without copying local preview derivatives.")
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    review_payload = load_blacklist_payload(args.review_snapshot)
    lifecycle = media_lifecycle_snapshot(repo_root)
    hidden_ids = (
        hidden_ids_from_current_state(repo_root)
        | discarded_ids_from_current_state(repo_root)
        | set(lifecycle.get("blockedPhotoIds") or [])
        | blacklist_ids_from_payload(review_payload)
    )
    hidden_source_paths = (
        discarded_source_paths_from_current_state(repo_root, hidden_ids)
        | set(lifecycle.get("blockedSourcePaths") or [])
    )
    country_assignments = country_assignments_from_owner_index(repo_root)
    country_assignments.update(country_assignments_from_payload(review_payload))
    keyword_blacklist = load_keyword_blacklist(repo_root / args.keyword_blacklist)
    title_keyword_decisions = load_applied_title_keyword_decisions(repo_root)
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
        keyword_blacklist=keyword_blacklist,
        blacklist_source_paths=hidden_source_paths,
        title_keyword_decisions=title_keyword_decisions,
    )
    print(result)
