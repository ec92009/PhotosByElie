#!/usr/bin/env python3
"""Build the public Photos By Elie catalog SQLite database."""

from __future__ import annotations

import argparse
import json
import math
import re
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


DEFAULT_OUTPUT = Path("assets/catalog/photosbyelie.sqlite")
DEFAULT_PRODUCT_PRICING = Path("assets/catalog/product-pricing.json")
COLLECTION_ORDER = ["france", "usa", "spain", "mexico", "ai", "italy", "portugal", "slovakia", "unknown"]
COLLECTION_DEFAULTS = {
    "france": ("France", "Saturn Lightroom archive selections prepared from the Camera source."),
    "usa": ("USA", "Saturn Lightroom archive selections prepared from the Camera source."),
    "spain": ("Spain", "Saturn Lightroom archive selections prepared from the Camera source."),
    "mexico": ("Mexico", "Saturn Lightroom archive selections prepared from the Camera source."),
    "ai": ("AI", "Leonardo archive selections prepared from the Saturn Lightroom AI source."),
    "italy": ("Italy", "Saturn and Apple Photos archive selections prepared from Italian sources."),
    "portugal": ("Portugal", "Saturn Lightroom archive selections prepared from the Camera source."),
    "slovakia": ("Slovakia", "Saturn Lightroom archive selections prepared from the Camera source."),
    "unknown": ("Unknown", "Saturn Lightroom selections that still need a final gallery assignment."),
}
MEDIA_TYPES = [(1, "photo"), (2, "video")]
SOURCE_ORIGINS = [(1, "camera"), (2, "ai")]
FORMATS = [(1, "jpg"), (2, "tif"), (3, "png"), (4, "heic"), (5, "mp4"), (6, "mov")]
ASSET_TYPES = [
    (1, "still_900"),
    (2, "still_1800"),
    (3, "short_5s_720p"),
    (4, "jpeg_1mp"),
    (5, "jpeg_3mp"),
    (6, "jpeg_6mp"),
    (7, "full"),
]


def dollars_to_cents(value: Any) -> int:
    return int(round(float(value or 0) * 100))


def load_product_pricing(repo_root: Path, path: Path = DEFAULT_PRODUCT_PRICING) -> dict[str, Any]:
    target = path if path.is_absolute() else repo_root / path
    with target.open("r", encoding="utf-8") as handle:
        pricing = json.load(handle)
    if pricing.get("schema") != "photosbyelie.product-pricing.v1":
        raise RuntimeError(f"unsupported product pricing schema in {target}")
    return pricing


def load_catalog(repo_root: Path) -> dict[str, Any]:
    script = """
const { loadCatalogWindow } = require("./scripts/catalog_tsv.cjs");
const catalog = loadCatalogWindow(process.argv[1]).photosByElieData || {};
process.stdout.write(JSON.stringify(catalog));
"""
    output = subprocess.check_output(["node", "-e", script, str(repo_root)], cwd=repo_root, text=True)
    return json.loads(output)


def metadata_value(photo: dict[str, Any], label: str) -> str:
    for item in photo.get("metadata") or []:
        if item.get("label") == label and item.get("value") not in (None, ""):
            return str(item["value"]).strip()
    return ""


def split_keywords(value: Any) -> list[str]:
    if isinstance(value, list):
        raw_values = [str(item).strip() for item in value]
    else:
        raw_values = [part.strip() for part in str(value or "").split(",")]
    seen: set[str] = set()
    keywords: list[str] = []
    for keyword in raw_values:
        if not keyword:
            continue
        key = keyword.casefold()
        if key in seen:
            continue
        seen.add(key)
        keywords.append(keyword)
    return keywords


def photo_keywords(photo: dict[str, Any]) -> list[str]:
    explicit = split_keywords(photo.get("keywords"))
    return explicit or split_keywords(metadata_value(photo, "Keywords"))


def dimensions_from_text(value: str) -> tuple[int, int] | None:
    match = re.search(r"(\d{2,})\s*x\s*(\d{2,})", value or "", flags=re.IGNORECASE)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def captured_at(photo: dict[str, Any]) -> str | None:
    value = metadata_value(photo, "Captured")
    match = re.match(r"^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})", value)
    if not match:
        return None
    year, month, day, hour, minute, second = match.groups()
    return f"{year}-{month}-{day}T{hour}:{minute}:{second}"


def source_file(photo: dict[str, Any]) -> dict[str, Any]:
    sources = photo.get("sourceFiles")
    if isinstance(sources, list) and sources and isinstance(sources[0], dict):
        return sources[0]
    return {}


def normalize_format(value: str) -> str:
    clean = str(value or "").strip().lower().lstrip(".")
    mapping = {
        "jpeg": "jpg",
        "jpg": "jpg",
        "tiff": "tif",
        "tif": "tif",
        "png": "png",
        "heic": "heic",
        "mp4": "mp4",
        "mov": "mov",
    }
    return mapping.get(clean, clean)


def original_format(photo: dict[str, Any]) -> str:
    source = source_file(photo)
    candidates = [
        source.get("type"),
        metadata_value(photo, "Original size").split("/", 1)[0].strip(),
        Path(str(metadata_value(photo, "Original file") or source.get("path") or "")).suffix,
    ]
    for candidate in candidates:
        fmt = normalize_format(str(candidate or ""))
        if fmt:
            return fmt
    return "jpg"


def split_source_path(path: str) -> tuple[str, str]:
    clean = str(path or "").strip()
    if "/" not in clean:
        return "", clean
    folder, filename = clean.rsplit("/", 1)
    return folder, filename


def original_dimensions(photo: dict[str, Any]) -> tuple[int, int] | None:
    return (
        dimensions_from_text(metadata_value(photo, "Original size"))
        or dimensions_from_text(metadata_value(photo, "Preview file"))
    )


def preview_dimensions(photo: dict[str, Any]) -> tuple[int, int] | None:
    return dimensions_from_text(metadata_value(photo, "Preview file"))


def scale_to_max(width: int, height: int, max_dimension: int) -> tuple[int, int]:
    largest = max(width, height)
    if largest <= max_dimension:
        return width, height
    scale = max_dimension / largest
    return max(1, round(width * scale)), max(1, round(height * scale))


def scale_to_megapixels(width: int, height: int, megapixels: float) -> tuple[int, int]:
    pixels = width * height
    target = megapixels * 1_000_000
    if pixels <= target:
        return width, height
    scale = math.sqrt(target / pixels)
    return max(1, round(width * scale)), max(1, round(height * scale))


def maker_model(name: str, kind: str) -> tuple[str | None, str | None]:
    clean = str(name or "").strip()
    if not clean:
        return None, None
    known_makers = ["NIKON CORPORATION", "NIKON", "Apple", "Canon", "Sigma", "Tokina"]
    for maker in known_makers:
        if clean == maker:
            return maker, clean
        if clean.startswith(f"{maker} "):
            return maker, clean[len(maker) + 1 :]
    if kind == "camera":
        return None, clean
    return None, clean


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA foreign_keys = ON;

        CREATE TABLE collections (
          collection_id INTEGER PRIMARY KEY,
          slug          TEXT NOT NULL UNIQUE CHECK (trim(slug) <> ''),
          title         TEXT NOT NULL CHECK (trim(title) <> ''),
          description   TEXT,
          scope         TEXT,
          sort_order    INTEGER,
          created_at    TEXT,
          updated_at    TEXT
        );

        CREATE TABLE cameras (
          camera_id INTEGER PRIMARY KEY,
          name      TEXT NOT NULL UNIQUE CHECK (trim(name) <> ''),
          maker     TEXT,
          model     TEXT
        );

        CREATE TABLE lenses (
          lens_id INTEGER PRIMARY KEY,
          name    TEXT NOT NULL UNIQUE CHECK (trim(name) <> ''),
          maker   TEXT,
          model   TEXT
        );

        CREATE TABLE media_types (
          media_type_id INTEGER PRIMARY KEY,
          code          TEXT NOT NULL UNIQUE CHECK (code IN ('photo', 'video'))
        );

        CREATE TABLE source_origins (
          source_origin_id INTEGER PRIMARY KEY,
          code             TEXT NOT NULL UNIQUE CHECK (trim(code) <> '')
        );

        CREATE TABLE formats (
          format_id  INTEGER PRIMARY KEY,
          extension  TEXT NOT NULL UNIQUE CHECK (extension IN ('jpg','tif','png','heic','mp4','mov'))
        );

        CREATE TABLE asset_types (
          asset_type_id INTEGER PRIMARY KEY,
          code          TEXT NOT NULL UNIQUE CHECK (
            code IN ('still_900', 'still_1800', 'short_5s_720p', 'jpeg_1mp', 'jpeg_3mp', 'jpeg_6mp', 'full')
          )
        );

        CREATE TABLE keyword_terms (
          keyword_id INTEGER PRIMARY KEY,
          keyword    TEXT NOT NULL UNIQUE CHECK (trim(keyword) <> '')
        );

        CREATE TABLE source_folders (
          source_folder_id INTEGER PRIMARY KEY,
          source_folder    TEXT NOT NULL UNIQUE
        );

        CREATE TABLE source_files (
          source_file_id INTEGER PRIMARY KEY,
          source_folder_id INTEGER NOT NULL,
          filename       TEXT NOT NULL CHECK (trim(filename) <> ''),
          format_id      INTEGER NOT NULL,
          FOREIGN KEY (source_folder_id) REFERENCES source_folders(source_folder_id),
          FOREIGN KEY (format_id) REFERENCES formats(format_id)
        );

        CREATE TABLE price_tiers (
          price_tier_id  TEXT PRIMARY KEY CHECK (trim(price_tier_id) <> ''),
          label          TEXT NOT NULL CHECK (trim(label) <> ''),
          sort_order     INTEGER NOT NULL CHECK (sort_order > 0)
        ) WITHOUT ROWID;

        CREATE TABLE products (
          product_id             TEXT PRIMARY KEY CHECK (trim(product_id) <> ''),
          product_type           TEXT NOT NULL CHECK (product_type IN ('digital', 'print')),
          label                  TEXT NOT NULL CHECK (trim(label) <> ''),
          detail                 TEXT,
          dimensions_imperial    TEXT,
          dimensions_metric      TEXT,
          min_megapixels         REAL CHECK (min_megapixels IS NULL OR min_megapixels >= 0),
          delivery_asset_type_id INTEGER,
          base_price_cents       INTEGER NOT NULL CHECK (base_price_cents >= 0),
          sort_order             INTEGER NOT NULL CHECK (sort_order > 0),
          active                 INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
          FOREIGN KEY (delivery_asset_type_id) REFERENCES asset_types(asset_type_id)
        ) WITHOUT ROWID;

        CREATE TABLE product_prices (
          product_id      TEXT NOT NULL,
          price_tier_id   TEXT NOT NULL,
          price_cents     INTEGER NOT NULL CHECK (price_cents >= 0),
          PRIMARY KEY (product_id, price_tier_id),
          FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE,
          FOREIGN KEY (price_tier_id) REFERENCES price_tiers(price_tier_id)
        ) WITHOUT ROWID;

        CREATE TABLE frame_options (
          frame_id          TEXT PRIMARY KEY CHECK (trim(frame_id) <> ''),
          label             TEXT NOT NULL CHECK (trim(label) <> ''),
          base_price_cents  INTEGER NOT NULL CHECK (base_price_cents >= 0),
          sort_order        INTEGER NOT NULL CHECK (sort_order > 0),
          active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
        ) WITHOUT ROWID;

        CREATE TABLE frame_prices (
          frame_id      TEXT NOT NULL,
          product_id    TEXT NOT NULL,
          price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
          PRIMARY KEY (frame_id, product_id),
          FOREIGN KEY (frame_id) REFERENCES frame_options(frame_id) ON DELETE CASCADE,
          FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
        ) WITHOUT ROWID;

        CREATE TABLE shipping_handling_prices (
          product_id    TEXT PRIMARY KEY,
          price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
          FOREIGN KEY (product_id) REFERENCES products(product_id) ON DELETE CASCADE
        ) WITHOUT ROWID;

        CREATE TABLE video_price_tiers (
          video_price_tier_id   TEXT PRIMARY KEY CHECK (trim(video_price_tier_id) <> ''),
          label                 TEXT NOT NULL CHECK (trim(label) <> ''),
          min_duration_seconds  REAL NOT NULL CHECK (min_duration_seconds >= 0),
          max_duration_seconds  REAL CHECK (max_duration_seconds IS NULL OR max_duration_seconds > min_duration_seconds),
          price_cents           INTEGER NOT NULL CHECK (price_cents >= 0),
          sort_order            INTEGER NOT NULL CHECK (sort_order > 0)
        ) WITHOUT ROWID;

        CREATE TABLE media_items (
          media_id            TEXT PRIMARY KEY,
          collection_id       INTEGER NOT NULL,
          sort_index          INTEGER NOT NULL CHECK (sort_index >= 0),
          media_type_id       INTEGER NOT NULL,
          camera_id           INTEGER,
          lens_id             INTEGER,
          title               TEXT NOT NULL CHECK (trim(title) <> ''),
          description         TEXT,
          keyword_ids         TEXT,
          source_origin_id    INTEGER,
          captured_at         TEXT,
          exposure            TEXT,
          focal_length        TEXT,
          source_file_id      INTEGER NOT NULL,
          location            TEXT,
          gps_latitude        REAL CHECK (gps_latitude IS NULL OR gps_latitude BETWEEN -90 AND 90),
          gps_longitude       REAL CHECK (gps_longitude IS NULL OR gps_longitude BETWEEN -180 AND 180),
          created_at          TEXT,
          updated_at          TEXT,
          FOREIGN KEY (collection_id) REFERENCES collections(collection_id),
          FOREIGN KEY (media_type_id) REFERENCES media_types(media_type_id),
          FOREIGN KEY (camera_id) REFERENCES cameras(camera_id),
          FOREIGN KEY (lens_id) REFERENCES lenses(lens_id),
          FOREIGN KEY (source_origin_id) REFERENCES source_origins(source_origin_id),
          FOREIGN KEY (source_file_id) REFERENCES source_files(source_file_id),
          CHECK ((gps_latitude IS NULL AND gps_longitude IS NULL) OR (gps_latitude IS NOT NULL AND gps_longitude IS NOT NULL))
        ) WITHOUT ROWID;

        CREATE TABLE media_assets (
          media_id          TEXT NOT NULL,
          asset_type_id     INTEGER NOT NULL,
          width             INTEGER NOT NULL CHECK (width > 0),
          height            INTEGER NOT NULL CHECK (height > 0),
          duration_seconds  REAL CHECK (duration_seconds IS NULL OR duration_seconds > 0),
          bytes             INTEGER CHECK (bytes IS NULL OR bytes >= 0),
          format_id         INTEGER NOT NULL,
          PRIMARY KEY (media_id, asset_type_id),
          FOREIGN KEY (media_id) REFERENCES media_items(media_id) ON DELETE CASCADE,
          FOREIGN KEY (asset_type_id) REFERENCES asset_types(asset_type_id),
          FOREIGN KEY (format_id) REFERENCES formats(format_id)
        ) WITHOUT ROWID;

        CREATE TRIGGER media_assets_full_photo_duration_insert
        BEFORE INSERT ON media_assets
        WHEN (SELECT code FROM asset_types WHERE asset_type_id = NEW.asset_type_id) = 'full'
          AND EXISTS (
            SELECT 1
            FROM media_items
            JOIN media_types USING (media_type_id)
            WHERE media_items.media_id = NEW.media_id AND media_types.code = 'photo'
          )
          AND NEW.duration_seconds IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, 'photo full assets must not have duration_seconds');
        END;

        CREATE TRIGGER media_assets_full_photo_duration_update
        BEFORE UPDATE OF media_id, asset_type_id, duration_seconds ON media_assets
        WHEN (SELECT code FROM asset_types WHERE asset_type_id = NEW.asset_type_id) = 'full'
          AND EXISTS (
            SELECT 1
            FROM media_items
            JOIN media_types USING (media_type_id)
            WHERE media_items.media_id = NEW.media_id AND media_types.code = 'photo'
          )
          AND NEW.duration_seconds IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, 'photo full assets must not have duration_seconds');
        END;

        CREATE TRIGGER media_assets_full_video_duration_insert
        BEFORE INSERT ON media_assets
        WHEN (SELECT code FROM asset_types WHERE asset_type_id = NEW.asset_type_id) = 'full'
          AND EXISTS (
            SELECT 1
            FROM media_items
            JOIN media_types USING (media_type_id)
            WHERE media_items.media_id = NEW.media_id AND media_types.code = 'video'
          )
          AND (NEW.duration_seconds IS NULL OR NEW.duration_seconds <= 0)
        BEGIN
          SELECT RAISE(ABORT, 'video full assets require positive duration_seconds');
        END;

        CREATE TRIGGER media_assets_full_video_duration_update
        BEFORE UPDATE OF media_id, asset_type_id, duration_seconds ON media_assets
        WHEN (SELECT code FROM asset_types WHERE asset_type_id = NEW.asset_type_id) = 'full'
          AND EXISTS (
            SELECT 1
            FROM media_items
            JOIN media_types USING (media_type_id)
            WHERE media_items.media_id = NEW.media_id AND media_types.code = 'video'
          )
          AND (NEW.duration_seconds IS NULL OR NEW.duration_seconds <= 0)
        BEGIN
          SELECT RAISE(ABORT, 'video full assets require positive duration_seconds');
        END;

        CREATE TRIGGER media_assets_photo_detail_preview_insert
        BEFORE INSERT ON media_assets
        WHEN (SELECT code FROM asset_types WHERE asset_type_id = NEW.asset_type_id) = 'still_1800'
          AND NOT EXISTS (
            SELECT 1
            FROM media_items
            JOIN media_types USING (media_type_id)
            WHERE media_items.media_id = NEW.media_id AND media_types.code = 'photo'
          )
        BEGIN
          SELECT RAISE(ABORT, 'photo detail previews require media_type photo');
        END;

        CREATE TRIGGER media_assets_photo_detail_preview_update
        BEFORE UPDATE OF media_id, asset_type_id ON media_assets
        WHEN (SELECT code FROM asset_types WHERE asset_type_id = NEW.asset_type_id) = 'still_1800'
          AND NOT EXISTS (
            SELECT 1
            FROM media_items
            JOIN media_types USING (media_type_id)
            WHERE media_items.media_id = NEW.media_id AND media_types.code = 'photo'
          )
        BEGIN
          SELECT RAISE(ABORT, 'photo detail previews require media_type photo');
        END;

        CREATE TRIGGER media_assets_photo_deliverable_insert
        BEFORE INSERT ON media_assets
        WHEN (SELECT code FROM asset_types WHERE asset_type_id = NEW.asset_type_id) IN ('jpeg_1mp', 'jpeg_3mp', 'jpeg_6mp')
          AND NOT EXISTS (
            SELECT 1
            FROM media_items
            JOIN media_types USING (media_type_id)
            WHERE media_items.media_id = NEW.media_id AND media_types.code = 'photo'
          )
        BEGIN
          SELECT RAISE(ABORT, 'photo JPEG deliverables require media_type photo');
        END;

        CREATE TRIGGER media_assets_photo_deliverable_update
        BEFORE UPDATE OF media_id, asset_type_id ON media_assets
        WHEN (SELECT code FROM asset_types WHERE asset_type_id = NEW.asset_type_id) IN ('jpeg_1mp', 'jpeg_3mp', 'jpeg_6mp')
          AND NOT EXISTS (
            SELECT 1
            FROM media_items
            JOIN media_types USING (media_type_id)
            WHERE media_items.media_id = NEW.media_id AND media_types.code = 'photo'
          )
        BEGIN
          SELECT RAISE(ABORT, 'photo JPEG deliverables require media_type photo');
        END;

        CREATE TRIGGER media_assets_short_video_insert
        BEFORE INSERT ON media_assets
        WHEN (SELECT code FROM asset_types WHERE asset_type_id = NEW.asset_type_id) = 'short_5s_720p'
          AND NOT EXISTS (
            SELECT 1
            FROM media_items
            JOIN media_types USING (media_type_id)
            WHERE media_items.media_id = NEW.media_id AND media_types.code = 'video'
          )
        BEGIN
          SELECT RAISE(ABORT, 'short video previews require media_type video');
        END;

        CREATE TRIGGER media_assets_short_video_update
        BEFORE UPDATE OF media_id, asset_type_id ON media_assets
        WHEN (SELECT code FROM asset_types WHERE asset_type_id = NEW.asset_type_id) = 'short_5s_720p'
          AND NOT EXISTS (
            SELECT 1
            FROM media_items
            JOIN media_types USING (media_type_id)
            WHERE media_items.media_id = NEW.media_id AND media_types.code = 'video'
          )
        BEGIN
          SELECT RAISE(ABORT, 'short video previews require media_type video');
        END;
        """
    )


def ordered_collections(catalog: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    order = {slug: index for index, slug in enumerate(COLLECTION_ORDER)}
    merged = dict(catalog)
    for slug, (title, description) in COLLECTION_DEFAULTS.items():
        if slug == "unknown" and slug not in merged:
            continue
        merged.setdefault(slug, {"title": title, "description": description, "photos": []})
    return sorted(merged.items(), key=lambda item: (order.get(item[0], len(order)), item[0]))


def write_db(repo_root: Path, output: Path) -> dict[str, int]:
    catalog = load_catalog(repo_root)
    pricing = load_product_pricing(repo_root)
    collection_entries = ordered_collections(catalog)
    photos: list[tuple[str, dict[str, Any], str, int, dict[str, Any]]] = []
    seen_photo_ids: set[str] = set()
    duplicate_photo_ids: set[str] = set()
    for sort_order, (slug, collection) in enumerate(collection_entries, start=1):
        for sort_index, photo in enumerate(collection.get("photos") or []):
            if photo.get("id"):
                photo_id = str(photo["id"])
                if photo_id in seen_photo_ids:
                    duplicate_photo_ids.add(photo_id)
                seen_photo_ids.add(photo_id)
                photos.append((slug, collection, photo_id, sort_index, photo))
    if duplicate_photo_ids:
        raise RuntimeError(f"duplicate media ids: {', '.join(sorted(duplicate_photo_ids)[:20])}")

    camera_names = sorted({metadata_value(photo, "Camera") for *_prefix, photo in photos if metadata_value(photo, "Camera")}, key=str.casefold)
    lens_names = sorted({metadata_value(photo, "Lens") for *_prefix, photo in photos if metadata_value(photo, "Lens")}, key=str.casefold)
    keyword_names = sorted({keyword for *_prefix, photo in photos for keyword in photo_keywords(photo)}, key=str.casefold)

    source_origin_codes = {code for _id, code in SOURCE_ORIGINS}
    source_origin_codes.update(str(photo.get("sourceOrigin") or "").strip() for *_prefix, photo in photos if str(photo.get("sourceOrigin") or "").strip())
    extra_source_origins = sorted(source_origin_codes - {code for _id, code in SOURCE_ORIGINS}, key=str.casefold)
    source_origins = SOURCE_ORIGINS + [(len(SOURCE_ORIGINS) + index, code) for index, code in enumerate(extra_source_origins, start=1)]

    collection_id = {slug: index for index, slug in enumerate(COLLECTION_ORDER, start=1)}
    next_collection_id = len(collection_id) + 1
    for slug, _collection in collection_entries:
        if slug not in collection_id:
            collection_id[slug] = next_collection_id
            next_collection_id += 1
    camera_id = {name: index for index, name in enumerate(camera_names, start=1)}
    lens_id = {name: index for index, name in enumerate(lens_names, start=1)}
    keyword_id = {name: index for index, name in enumerate(keyword_names, start=1)}
    media_type_id = {code: row_id for row_id, code in MEDIA_TYPES}
    source_origin_id = {code: row_id for row_id, code in source_origins}
    format_id = {code: row_id for row_id, code in FORMATS}
    asset_type_id = {code: row_id for row_id, code in ASSET_TYPES}
    source_paths = sorted({
        str(source_file(photo).get("path") or "").strip()
        for *_prefix, photo in photos
        if str(source_file(photo).get("path") or "").strip()
    })
    source_file_id = {path: index for index, path in enumerate(source_paths, start=1)}
    source_folders = sorted({split_source_path(path)[0] for path in source_paths})
    source_folder_id = {folder: index for index, folder in enumerate(source_folders, start=1)}
    source_format_by_path: dict[str, str] = {}
    for *_prefix, photo in photos:
        path = str(source_file(photo).get("path") or "").strip()
        if path and path not in source_format_by_path:
            source_format_by_path[path] = original_format(photo)

    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix=output.name, suffix=".tmp", dir=output.parent, delete=False) as temp:
        temp_path = Path(temp.name)
    try:
        conn = sqlite3.connect(temp_path)
        conn.execute("PRAGMA foreign_keys = ON")
        create_schema(conn)
        conn.executemany("INSERT INTO media_types VALUES (?, ?)", MEDIA_TYPES)
        conn.executemany("INSERT INTO source_origins VALUES (?, ?)", source_origins)
        conn.executemany("INSERT INTO formats VALUES (?, ?)", FORMATS)
        conn.executemany("INSERT INTO asset_types VALUES (?, ?)", ASSET_TYPES)

        price_tiers = sorted(pricing.get("priceTiers") or [], key=lambda item: (int(item.get("sortOrder") or 0), str(item.get("id") or "")))
        products = sorted(pricing.get("products") or [], key=lambda item: (int(item.get("sortOrder") or 0), str(item.get("id") or "")))
        frames = sorted(pricing.get("frames") or [], key=lambda item: (int(item.get("sortOrder") or 0), str(item.get("id") or "")))
        video_price_tiers = sorted(pricing.get("videoPriceTiers") or [], key=lambda item: (int(item.get("sortOrder") or 0), str(item.get("id") or "")))

        price_tier_ids = {str(tier.get("id") or "") for tier in price_tiers}
        product_ids = {str(product.get("id") or "") for product in products}
        if not price_tier_ids:
            raise RuntimeError("product pricing requires at least one price tier")
        if not product_ids:
            raise RuntimeError("product pricing requires at least one product")

        conn.executemany(
            "INSERT INTO price_tiers VALUES (?, ?, ?)",
            [
                (
                    str(tier.get("id") or "").strip(),
                    str(tier.get("label") or "").strip(),
                    int(tier.get("sortOrder") or index),
                )
                for index, tier in enumerate(price_tiers, start=1)
            ],
        )
        product_rows = []
        product_price_rows = []
        for index, product in enumerate(products, start=1):
            product_id = str(product.get("id") or "").strip()
            if not product_id:
                raise RuntimeError("product pricing contains a product without an id")
            prices = product.get("prices") or {}
            unknown_tiers = sorted(set(prices) - price_tier_ids)
            if unknown_tiers:
                raise RuntimeError(f"{product_id}: unknown price tiers: {', '.join(unknown_tiers)}")
            dimensions = product.get("dimensions") or {}
            base_price = product.get("price", prices.get("original", 0))
            delivery_asset_type = product.get("deliveryAssetType")
            if delivery_asset_type and delivery_asset_type not in asset_type_id:
                raise RuntimeError(f"{product_id}: unknown delivery asset type {delivery_asset_type!r}")
            product_rows.append(
                (
                    product_id,
                    str(product.get("type") or "").strip(),
                    str(product.get("label") or "").strip(),
                    product.get("detail"),
                    dimensions.get("imperial"),
                    dimensions.get("metric"),
                    product.get("minMegapixels"),
                    asset_type_id.get(delivery_asset_type),
                    dollars_to_cents(base_price),
                    int(product.get("sortOrder") or index),
                    0 if product.get("active") is False else 1,
                )
            )
            for tier_id, price in prices.items():
                product_price_rows.append((product_id, str(tier_id), dollars_to_cents(price)))
        conn.executemany(
            "INSERT INTO products VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            product_rows,
        )
        conn.executemany(
            "INSERT INTO product_prices VALUES (?, ?, ?)",
            product_price_rows,
        )
        frame_rows = []
        frame_price_rows = []
        for index, frame in enumerate(frames, start=1):
            frame_id = str(frame.get("id") or "").strip()
            if not frame_id:
                raise RuntimeError("product pricing contains a frame without an id")
            frame_rows.append(
                (
                    frame_id,
                    str(frame.get("label") or "").strip(),
                    dollars_to_cents(frame.get("price", 0)),
                    int(frame.get("sortOrder") or index),
                    0 if frame.get("active") is False else 1,
                )
            )
            for product_id, price in (frame.get("prices") or {}).items():
                if product_id not in product_ids:
                    raise RuntimeError(f"{frame_id}: unknown framed product {product_id!r}")
                frame_price_rows.append((frame_id, product_id, dollars_to_cents(price)))
        conn.executemany(
            "INSERT INTO frame_options VALUES (?, ?, ?, ?, ?)",
            frame_rows,
        )
        conn.executemany(
            "INSERT INTO frame_prices VALUES (?, ?, ?)",
            frame_price_rows,
        )
        shipping_rows = []
        for product_id, price in (pricing.get("shippingHandlingPrices") or {}).items():
            if product_id not in product_ids:
                raise RuntimeError(f"shipping handling references unknown product {product_id!r}")
            shipping_rows.append((product_id, dollars_to_cents(price)))
        conn.executemany(
            "INSERT INTO shipping_handling_prices VALUES (?, ?)",
            shipping_rows,
        )
        conn.executemany(
            "INSERT INTO video_price_tiers VALUES (?, ?, ?, ?, ?, ?)",
            [
                (
                    str(tier.get("id") or "").strip(),
                    str(tier.get("label") or "").strip(),
                    float(tier.get("minDurationSeconds") or 0),
                    None if tier.get("maxDurationSeconds") in (None, "") else float(tier.get("maxDurationSeconds")),
                    dollars_to_cents(tier.get("price", 0)),
                    int(tier.get("sortOrder") or index),
                )
                for index, tier in enumerate(video_price_tiers, start=1)
            ],
        )

        conn.executemany(
            "INSERT INTO collections VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (
                    collection_id[slug],
                    slug,
                    collection.get("title") or slug,
                    collection.get("description"),
                    "public",
                    sort_order,
                    None,
                    None,
                )
                for sort_order, (slug, collection) in enumerate(collection_entries, start=1)
            ],
        )
        conn.executemany(
            "INSERT INTO cameras VALUES (?, ?, ?, ?)",
            [(camera_id[name], name, *maker_model(name, "camera")) for name in camera_names],
        )
        conn.executemany(
            "INSERT INTO lenses VALUES (?, ?, ?, ?)",
            [(lens_id[name], name, *maker_model(name, "lens")) for name in lens_names],
        )
        conn.executemany(
            "INSERT INTO keyword_terms VALUES (?, ?)",
            [(keyword_id[name], name) for name in keyword_names],
        )
        conn.executemany(
            "INSERT INTO source_folders VALUES (?, ?)",
            [(source_folder_id[folder], folder) for folder in source_folders],
        )
        conn.executemany(
            "INSERT INTO source_files VALUES (?, ?, ?, ?)",
            [
                (
                    source_file_id[path],
                    source_folder_id[split_source_path(path)[0]],
                    split_source_path(path)[1],
                    format_id[source_format_by_path[path]],
                )
                for path in source_paths
            ],
        )

        media_rows = []
        asset_rows = []
        asset_codes_by_photo: dict[str, set[str]] = {}
        media_type_by_photo: dict[str, str] = {}
        errors: list[str] = []
        for slug, collection, photo_id, sort_index, photo in photos:
            media_type = str((photo.get("media") or {}).get("type") or "photo").strip().lower()
            if media_type not in media_type_id:
                errors.append(f"{photo_id}: unsupported media type {media_type!r}")
                continue
            dimensions = original_dimensions(photo)
            if not dimensions:
                errors.append(f"{photo_id}: missing original dimensions")
                continue
            width, height = dimensions
            fmt = original_format(photo)
            if fmt not in format_id:
                errors.append(f"{photo_id}: unsupported original format {fmt!r}")
                continue
            duration_seconds = None
            if media_type == "video":
                raw_duration = (photo.get("media") or {}).get("video", {}).get("duration") or photo.get("duration")
                try:
                    duration_seconds = float(raw_duration)
                except (TypeError, ValueError):
                    duration_seconds = None
                if not duration_seconds or duration_seconds <= 0:
                    errors.append(f"{photo_id}: video rows require positive duration_seconds")
                    continue
            keywords = photo_keywords(photo)
            keyword_ids = ",".join(str(keyword_id[keyword]) for keyword in keywords)
            if any(keyword not in keyword_id for keyword in keywords):
                errors.append(f"{photo_id}: keyword id lookup failed")
                continue
            camera_name = metadata_value(photo, "Camera")
            lens_name = metadata_value(photo, "Lens")
            source_origin = str(photo.get("sourceOrigin") or "").strip() or None
            location = metadata_value(photo, "Location")
            if not location and slug != "ai":
                location = collection.get("title") or None
            source = source_file(photo)
            source_path = str(source.get("path") or "").strip()
            if not source_path:
                errors.append(f"{photo_id}: missing source path")
                continue
            media_rows.append(
                {
                    "media_id": photo_id,
                    "collection_id": collection_id[slug],
                    "sort_index": sort_index,
                    "media_type_id": media_type_id[media_type],
                    "camera_id": camera_id.get(camera_name),
                    "lens_id": lens_id.get(lens_name),
                    "title": str(photo.get("title") or photo_id).strip() or photo_id,
                    "description": None,
                    "keyword_ids": keyword_ids or None,
                    "source_origin_id": source_origin_id.get(source_origin or ""),
                    "captured_at": captured_at(photo),
                    "exposure": metadata_value(photo, "Exposure") or None,
                    "focal_length": metadata_value(photo, "Focal length") or None,
                    "source_file_id": source_file_id[source_path],
                    "location": location or None,
                    "gps_latitude": None,
                    "gps_longitude": None,
                    "created_at": None,
                    "updated_at": None,
                }
            )
            media_type_by_photo[photo_id] = media_type
            asset_codes_by_photo.setdefault(photo_id, set()).add("full")

            source_bytes = source.get("bytes")
            full_bytes = int(source_bytes) if isinstance(source_bytes, int) or str(source_bytes).isdigit() else None
            asset_rows.append((photo_id, asset_type_id["full"], width, height, duration_seconds, full_bytes, format_id[fmt]))
            gallery_width, gallery_height = scale_to_max(width, height, 900)
            asset_rows.append((photo_id, asset_type_id["still_900"], gallery_width, gallery_height, None, None, format_id["jpg"]))
            asset_codes_by_photo.setdefault(photo_id, set()).add("still_900")
            if media_type == "photo":
                detail_width, detail_height = scale_to_max(width, height, 1800)
                asset_rows.append((photo_id, asset_type_id["still_1800"], detail_width, detail_height, None, None, format_id["jpg"]))
                asset_codes_by_photo[photo_id].add("still_1800")
                for code, target_mp in (("jpeg_1mp", 1), ("jpeg_3mp", 3), ("jpeg_6mp", 6)):
                    render_width, render_height = scale_to_megapixels(width, height, target_mp)
                    asset_rows.append((photo_id, asset_type_id[code], render_width, render_height, None, None, format_id["jpg"]))
                    asset_codes_by_photo[photo_id].add(code)
            else:
                preview = preview_dimensions(photo) or scale_to_max(width, height, 1280)
                asset_rows.append((photo_id, asset_type_id["short_5s_720p"], preview[0], preview[1], 5.0, None, format_id["mp4"]))
                asset_codes_by_photo[photo_id].add("short_5s_720p")

        if errors:
            raise RuntimeError("\n".join(errors[:20]))

        for photo_id, media_type in media_type_by_photo.items():
            required = {"full", "still_900", "short_5s_720p"} if media_type == "video" else {"full", "still_900", "still_1800", "jpeg_1mp", "jpeg_3mp", "jpeg_6mp"}
            missing = required - asset_codes_by_photo.get(photo_id, set())
            if missing:
                errors.append(f"{photo_id}: missing asset rows {', '.join(sorted(missing))}")
        if errors:
            raise RuntimeError("\n".join(errors[:20]))

        conn.executemany(
            """
            INSERT INTO media_items (
              media_id, collection_id, sort_index, media_type_id, camera_id, lens_id, title,
              description, keyword_ids, source_origin_id, captured_at, exposure, focal_length,
              source_file_id, location, gps_latitude, gps_longitude, created_at, updated_at
            ) VALUES (
              :media_id, :collection_id, :sort_index, :media_type_id, :camera_id, :lens_id, :title,
              :description, :keyword_ids, :source_origin_id, :captured_at, :exposure, :focal_length,
              :source_file_id, :location, :gps_latitude, :gps_longitude, :created_at, :updated_at
            )
            """,
            media_rows,
        )
        conn.executemany(
            "INSERT INTO media_assets VALUES (?, ?, ?, ?, ?, ?, ?)",
            asset_rows,
        )
        conn.commit()
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"integrity_check failed: {integrity}")
        fk_violations = conn.execute("PRAGMA foreign_key_check").fetchall()
        if fk_violations:
            raise RuntimeError(f"foreign_key_check failed: {fk_violations[:5]}")
        conn.execute("VACUUM")
        counts = {
            table: conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            for table in [
                "collections",
                "cameras",
                "lenses",
                "media_types",
                "source_origins",
                "formats",
                "asset_types",
                "source_folders",
                "source_files",
                "price_tiers",
                "products",
                "product_prices",
                "frame_options",
                "frame_prices",
                "shipping_handling_prices",
                "video_price_tiers",
                "keyword_terms",
                "media_items",
                "media_assets",
            ]
        }
        conn.close()
        temp_path.replace(output)
        return counts
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()
    repo_root = args.repo_root.resolve()
    output = args.output if args.output.is_absolute() else repo_root / args.output
    counts = write_db(repo_root, output)
    if not args.quiet:
        print(f"Wrote {output}")
        print(", ".join(f"{table}={count}" for table, count in counts.items()))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        raise
