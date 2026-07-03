#!/usr/bin/env python3
"""Local Sidecar workflow state stored inside the Owner SQLite database."""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import re
import sqlite3
import uuid
from pathlib import Path
from typing import Any, Iterable

try:
    from import_source_anchor import photo_id_for_source_path
    from media_keys import DEFAULT_PUBLIC_PREFIX, private_master_key, private_render_key, public_preview_key
except ModuleNotFoundError:  # pragma: no cover - supports package-style test imports.
    from scripts.import_source_anchor import photo_id_for_source_path
    from scripts.media_keys import DEFAULT_PUBLIC_PREFIX, private_master_key, private_render_key, public_preview_key


DEFAULT_DB = Path("assets/owner-actions/Owner.sqlite")
KEYWORD_BLACKLIST_JSON = Path("assets/owner-actions/keyword-blacklist.json")
DEFAULT_PUBLIC_BUCKET = "photosbyelie-public"
DEFAULT_PRIVATE_BUCKET = "photosbyelie-private"
DEFAULT_PRIVATE_PREFIX = "masters"
PRIVATE_RENDER_PRODUCTS = ("jpg-6mp", "jpg-3mp", "jpg-1mp")
RATING_VALUES = {0, 1, 2, 3, 4, 5}
COLOR_VALUES = {"", "red", "yellow", "green", "blue", "purple"}
PICK_STATES = {"undecided", "picked", "rejected", "hidden"}
METADATA_STATES = {"unreviewed", "proposed", "approved", "rework", "blocked"}
REWORK_CATEGORIES = {"", "incorrect", "generic", "placeholder", "keywords", "detail", "shoot", "other"}
INTERNAL_TITLE_MARKERS = {"dontexport", "don't export", "do not export", "notmyphoto", "not my photo"}
AI_METADATA_LADDER: tuple[dict[str, str], ...] = (
    {
        "rung": "seed",
        "label": "Seed metadata",
        "description": "Use existing Photos title, keyword, album, and coarse location seeds only.",
    },
    {
        "rung": "filename-gps",
        "label": "Filename and GPS context",
        "description": "Use descriptive filenames plus known local GPS/city hints; no visual scene understanding.",
    },
    {
        "rung": "geocode-context",
        "label": "Reverse-geocode context",
        "description": "Use external reverse-geocode context when local GPS hints are too coarse; no visual scene understanding.",
    },
    {
        "rung": "vision-description",
        "label": "Vision description",
        "description": "Use image understanding to describe visible subjects, setting, colors, composition, and likely AI-generated or 3D printed media.",
    },
    {
        "rung": "human-review",
        "label": "Human review",
        "description": "Require owner judgment when evidence is ambiguous or policy/context-sensitive.",
    },
)
AI_METADATA_RUNG_ORDER = {item["rung"]: index for index, item in enumerate(AI_METADATA_LADDER)}
AI_GENERATED_KEYWORDS = ("AI generated image", "AI artwork", "Generative AI", "Digital artwork")
THREE_D_PRINTED_KEYWORDS = ("3D printed object", "3D printing", "3D printed sculpture", "3D printed decor")
VISION_CLASSIFICATION_GUIDANCE = {
    "summary": "When visual evidence supports it, classify whether the item appears AI-generated or is a photo of a 3D printed artefact.",
    "rules": [
        "Do not assume all non-photographic or unusual images are AI-generated; only add AI keywords when visual evidence makes it likely.",
        "Do not assume every physical object is 3D printed; add 3D printing keywords when layer lines, filament-like material, printed geometry, or known printed artefact context makes it likely.",
        "If uncertain, prefer a descriptive physical-object keyword and leave AI/3D-printing labels for owner review.",
    ],
    "keywordFamilies": {
        "aiGenerated": list(AI_GENERATED_KEYWORDS),
        "threeDPrinted": list(THREE_D_PRINTED_KEYWORDS),
    },
}
LOCATION_KEYWORD_GUIDANCE = {
    "summary": "Use precise location keywords only for public places; otherwise keep location metadata vague.",
    "rules": [
        "For named public places such as museums, landmarks, parks, stations, galleries, or venues, public-place and neighborhood keywords are acceptable when supported by evidence.",
        "For homes, private interiors, street scenes near a residence, or locations that are not clearly public attractions, keep location keywords to city, region, and country.",
        "Do not add street, building, neighborhood, or address-level keywords for private or ambiguous locations.",
    ],
    "privateLocationMaxPrecision": "city",
}
POI_GPS_HINTS: tuple[dict[str, Any], ...] = (
    {
        "name": "Royal Palace of Madrid",
        "city": "Madrid",
        "region": "Community of Madrid",
        "country": "Spain",
        "keywords": [
            "Royal Palace of Madrid",
            "Palacio Real de Madrid",
            "Royal Palace",
            "Palace",
            "Historic palace",
            "Madrid",
            "Community of Madrid",
            "Spain",
        ],
        "lat": (40.4160, 40.4190),
        "lon": (-3.7160, -3.7120),
    },
    {
        "name": "Musée des Années 30",
        "city": "Boulogne-Billancourt",
        "region": "Île-de-France",
        "country": "France",
        "keywords": ["Musée des Années 30", "Boulogne-Billancourt", "Hauts-de-Seine", "Île-de-France", "France"],
        "lat": (48.8358, 48.8368),
        "lon": (2.2391, 2.2403),
    },
)
CITY_GPS_HINTS: tuple[dict[str, Any], ...] = (
    {"city": "Solana Beach", "region": "California", "country": "United States", "lat": (32.98, 33.02), "lon": (-117.29, -117.24)},
    {"city": "Del Mar", "region": "California", "country": "United States", "lat": (32.93, 33.00), "lon": (-117.30, -117.22)},
    {"city": "San Diego", "region": "California", "country": "United States", "lat": (32.65, 32.90), "lon": (-117.30, -117.00)},
    {"city": "Malaga", "region": "Andalusia", "country": "Spain", "lat": (36.62, 36.82), "lon": (-4.58, -4.25)},
    {"city": "Nerja", "region": "Andalusia", "country": "Spain", "lat": (36.70, 36.80), "lon": (-3.95, -3.80)},
    {"city": "Ronda", "region": "Andalusia", "country": "Spain", "lat": (36.68, 36.78), "lon": (-5.22, -5.10)},
    {"city": "Seville", "region": "Andalusia", "country": "Spain", "lat": (37.30, 37.45), "lon": (-6.05, -5.85)},
    {"city": "Cordoba", "region": "Andalusia", "country": "Spain", "lat": (37.82, 37.95), "lon": (-4.86, -4.70)},
    {"city": "Granada", "region": "Andalusia", "country": "Spain", "lat": (37.12, 37.25), "lon": (-3.65, -3.50)},
    {"city": "Cadiz", "region": "Andalusia", "country": "Spain", "lat": (36.45, 36.58), "lon": (-6.35, -6.20)},
    {"city": "Madrid", "region": "Community of Madrid", "country": "Spain", "lat": (40.30, 40.55), "lon": (-3.85, -3.55)},
    {"city": "Barcelona", "region": "Catalonia", "country": "Spain", "lat": (41.30, 41.50), "lon": (2.05, 2.25)},
    {"city": "Valencia", "region": "Valencian Community", "country": "Spain", "lat": (39.40, 39.55), "lon": (-0.45, -0.25)},
    {"city": "Bilbao", "region": "Basque Country", "country": "Spain", "lat": (43.22, 43.32), "lon": (-3.00, -2.85)},
    {"city": "Paris", "region": "Ile-de-France", "country": "France", "lat": (48.80, 48.92), "lon": (2.20, 2.48)},
    {"city": "Albi", "region": "Occitanie", "country": "France", "lat": (43.88, 43.96), "lon": (2.10, 2.22)},
    {"city": "Lisbon", "region": "Lisbon", "country": "Portugal", "lat": (38.65, 38.82), "lon": (-9.25, -9.05)},
    {"city": "Cascais", "region": "Lisbon", "country": "Portugal", "lat": (38.65, 38.75), "lon": (-9.50, -9.35)},
    {"city": "Sintra", "region": "Lisbon", "country": "Portugal", "lat": (38.75, 38.85), "lon": (-9.45, -9.30)},
    {"city": "Porto", "region": "Northern Portugal", "country": "Portugal", "lat": (41.10, 41.25), "lon": (-8.75, -8.50)},
    {"city": "Florence", "region": "Tuscany", "country": "Italy", "lat": (43.72, 43.83), "lon": (11.18, 11.33)},
    {"city": "Pisa", "region": "Tuscany", "country": "Italy", "lat": (43.67, 43.76), "lon": (10.35, 10.48)},
    {"city": "San Gimignano", "region": "Tuscany", "country": "Italy", "lat": (43.43, 43.50), "lon": (11.00, 11.08)},
    {"city": "Rome", "region": "Lazio", "country": "Italy", "lat": (41.80, 42.02), "lon": (12.35, 12.65)},
    {"city": "Venice", "region": "Veneto", "country": "Italy", "lat": (45.39, 45.48), "lon": (12.25, 12.40)},
    {"city": "Bratislava", "region": "Bratislava", "country": "Slovakia", "lat": (48.08, 48.22), "lon": (16.95, 17.25)},
    {"city": "New York", "region": "New York", "country": "United States", "lat": (40.50, 40.92), "lon": (-74.10, -73.70)},
    {"city": "Miami", "region": "Florida", "country": "United States", "lat": (25.70, 25.90), "lon": (-80.35, -80.10)},
)
COUNTRY_GPS_HINTS: tuple[dict[str, Any], ...] = (
    {"country": "Spain", "lat": (35.0, 44.3), "lon": (-9.5, 4.5)},
    {"country": "France", "lat": (41.0, 51.3), "lon": (-5.5, 9.8)},
    {"country": "Portugal", "lat": (36.8, 42.3), "lon": (-9.7, -6.0)},
    {"country": "Italy", "lat": (36.5, 47.2), "lon": (6.5, 18.6)},
    {"country": "Slovakia", "lat": (47.7, 49.7), "lon": (16.8, 22.7)},
    {"country": "United States", "lat": (24.0, 49.5), "lon": (-125.0, -66.0)},
    {"country": "Mexico", "lat": (14.0, 33.0), "lon": (-118.0, -86.0)},
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _read_json_text(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def connect(repo_root: Path, db_path: Path | None = None) -> sqlite3.Connection:
    path = db_path or DEFAULT_DB
    if not path.is_absolute():
        path = repo_root / path
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    ensure_schema(conn)
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS sidecar_assets (
          asset_id       TEXT PRIMARY KEY CHECK (trim(asset_id) <> ''),
          source_anchor  TEXT NOT NULL CHECK (trim(source_anchor) <> ''),
          media_type     TEXT,
          filename       TEXT,
          captured_at    TEXT,
          modified_at    TEXT,
          pixel_width    INTEGER,
          pixel_height   INTEGER,
          duration       REAL,
          favorite       INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
          hidden         INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
          photos_title   TEXT,
          photos_keywords_json TEXT NOT NULL DEFAULT '[]',
          location_label TEXT,
          location_keywords_json TEXT NOT NULL DEFAULT '[]',
          metadata_seed_title TEXT,
          metadata_seed_keywords_json TEXT NOT NULL DEFAULT '[]',
          raw_json       TEXT NOT NULL DEFAULT '{}',
          missing_at     TEXT,
          indexed_at     TEXT,
          updated_at     TEXT
        ) WITHOUT ROWID;

        CREATE INDEX IF NOT EXISTS idx_sidecar_assets_captured ON sidecar_assets(captured_at, asset_id);
        CREATE INDEX IF NOT EXISTS idx_sidecar_assets_media_type ON sidecar_assets(media_type, captured_at);
        CREATE INDEX IF NOT EXISTS idx_sidecar_assets_missing_indexed ON sidecar_assets(missing_at, indexed_at);

        CREATE TABLE IF NOT EXISTS sidecar_decisions (
          asset_id       TEXT PRIMARY KEY CHECK (trim(asset_id) <> ''),
          rating         INTEGER NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
          color          TEXT NOT NULL DEFAULT '' CHECK (color IN ('', 'red', 'yellow', 'green', 'blue', 'purple')),
          pick_state     TEXT NOT NULL DEFAULT 'undecided' CHECK (pick_state IN ('undecided', 'picked', 'rejected', 'hidden')),
          metadata_state TEXT NOT NULL DEFAULT 'unreviewed' CHECK (metadata_state IN ('unreviewed', 'proposed', 'approved', 'rework', 'blocked')),
          title          TEXT,
          keywords_json  TEXT NOT NULL DEFAULT '[]',
          rework_category TEXT NOT NULL DEFAULT '',
          rework_comment TEXT,
          metadata_ai_rung TEXT,
          metadata_ai_evidence_json TEXT NOT NULL DEFAULT '[]',
          metadata_ai_note TEXT,
          last_action    TEXT,
          created_at     TEXT,
          updated_at     TEXT,
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id) ON DELETE CASCADE
        ) WITHOUT ROWID;

        CREATE INDEX IF NOT EXISTS idx_sidecar_decisions_pick ON sidecar_decisions(pick_state, metadata_state, updated_at);
        CREATE INDEX IF NOT EXISTS idx_sidecar_decisions_rating ON sidecar_decisions(rating, color, updated_at);

        CREATE TABLE IF NOT EXISTS sidecar_pending_sync (
          sync_id        TEXT PRIMARY KEY CHECK (trim(sync_id) <> ''),
          asset_id       TEXT NOT NULL CHECK (trim(asset_id) <> ''),
          field_family   TEXT NOT NULL CHECK (trim(field_family) <> ''),
          old_value_json TEXT NOT NULL DEFAULT '{}',
          new_value_json TEXT NOT NULL DEFAULT '{}',
          status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'committed', 'conflict', 'failed')),
          error_text     TEXT,
          created_at     TEXT,
          updated_at     TEXT,
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_sidecar_pending_status ON sidecar_pending_sync(status, updated_at);
        CREATE INDEX IF NOT EXISTS idx_sidecar_pending_asset ON sidecar_pending_sync(asset_id, status);

        CREATE TABLE IF NOT EXISTS sidecar_tombstones (
          asset_id        TEXT PRIMARY KEY CHECK (trim(asset_id) <> ''),
          tombstone_state TEXT NOT NULL DEFAULT 'active' CHECK (tombstone_state IN ('active', 'restored')),
          reason          TEXT,
          tombstoned_at   TEXT,
          updated_at      TEXT,
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id) ON DELETE CASCADE
        ) WITHOUT ROWID;

        CREATE INDEX IF NOT EXISTS idx_sidecar_tombstones_state ON sidecar_tombstones(tombstone_state, updated_at);

        CREATE TABLE IF NOT EXISTS sidecar_mock_uploads (
          asset_id      TEXT PRIMARY KEY CHECK (trim(asset_id) <> ''),
          mock_state    TEXT NOT NULL DEFAULT 'active' CHECK (mock_state IN ('active', 'cleared')),
          mock_run_id   TEXT,
          uploaded_at   TEXT,
          updated_at    TEXT,
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id) ON DELETE CASCADE
        ) WITHOUT ROWID;

        CREATE INDEX IF NOT EXISTS idx_sidecar_mock_uploads_state ON sidecar_mock_uploads(mock_state, updated_at);
        """
    )
    decision_columns = {
        str(row["name"])
        for row in conn.execute("PRAGMA table_info(sidecar_decisions)").fetchall()
    }
    if "rework_category" not in decision_columns:
        conn.execute("ALTER TABLE sidecar_decisions ADD COLUMN rework_category TEXT NOT NULL DEFAULT ''")
    if "rework_comment" not in decision_columns:
        conn.execute("ALTER TABLE sidecar_decisions ADD COLUMN rework_comment TEXT")
    if "metadata_ai_rung" not in decision_columns:
        conn.execute("ALTER TABLE sidecar_decisions ADD COLUMN metadata_ai_rung TEXT")
    if "metadata_ai_evidence_json" not in decision_columns:
        conn.execute("ALTER TABLE sidecar_decisions ADD COLUMN metadata_ai_evidence_json TEXT NOT NULL DEFAULT '[]'")
    if "metadata_ai_note" not in decision_columns:
        conn.execute("ALTER TABLE sidecar_decisions ADD COLUMN metadata_ai_note TEXT")
    asset_columns = {
        str(row["name"])
        for row in conn.execute("PRAGMA table_info(sidecar_assets)").fetchall()
    }
    asset_column_defaults = {
        "photos_title": "TEXT",
        "photos_keywords_json": "TEXT NOT NULL DEFAULT '[]'",
        "location_label": "TEXT",
        "location_keywords_json": "TEXT NOT NULL DEFAULT '[]'",
        "metadata_seed_title": "TEXT",
        "metadata_seed_keywords_json": "TEXT NOT NULL DEFAULT '[]'",
        "missing_at": "TEXT",
    }
    for column, definition in asset_column_defaults.items():
        if column not in asset_columns:
            conn.execute(f"ALTER TABLE sidecar_assets ADD COLUMN {column} {definition}")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sidecar_assets_available ON sidecar_assets(missing_at, captured_at, asset_id)")


def _asset_id(row: dict[str, Any]) -> str:
    return str(row.get("localIdentifier") or row.get("asset_id") or row.get("assetId") or "").strip()


def _number(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _dedupe_text(values: Iterable[Any]) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = str(value or "").strip()
        normalized = text.casefold()
        if not text or normalized in seen:
            continue
        seen.add(normalized)
        cleaned.append(text)
    return cleaned


def _location_dict(row: dict[str, Any]) -> dict[str, Any]:
    location = row.get("location")
    return location if isinstance(location, dict) else {}


def _location_place_from_gps(row: dict[str, Any]) -> dict[str, str]:
    location = _location_dict(row)
    latitude = _number(location.get("latitude"))
    longitude = _number(location.get("longitude"))
    if latitude is None or longitude is None:
        return {}
    for hint in CITY_GPS_HINTS:
        min_lat, max_lat = hint["lat"]
        min_lon, max_lon = hint["lon"]
        if min_lat <= latitude <= max_lat and min_lon <= longitude <= max_lon:
            return {
                "city": str(hint.get("city") or ""),
                "region": str(hint.get("region") or ""),
                "country": str(hint.get("country") or ""),
            }
    for hint in COUNTRY_GPS_HINTS:
        min_lat, max_lat = hint["lat"]
        min_lon, max_lon = hint["lon"]
        if min_lat <= latitude <= max_lat and min_lon <= longitude <= max_lon:
            return {"country": str(hint.get("country") or "")}
    return {}


def _location_poi_from_gps(row: dict[str, Any]) -> dict[str, Any]:
    location = _location_dict(row)
    latitude = _number(location.get("latitude"))
    longitude = _number(location.get("longitude"))
    if latitude is None or longitude is None:
        return {}
    for hint in POI_GPS_HINTS:
        min_lat, max_lat = hint["lat"]
        min_lon, max_lon = hint["lon"]
        if min_lat <= latitude <= max_lat and min_lon <= longitude <= max_lon:
            return hint
    return {}


def _location_metadata_from_row(row: dict[str, Any]) -> tuple[str, list[str], str]:
    location = _location_dict(row)
    poi = _location_poi_from_gps(row)
    place = {
        "city": str(location.get("city") or row.get("locationCity") or "").strip(),
        "region": str(location.get("region") or row.get("locationRegion") or "").strip(),
        "country": str(location.get("country") or row.get("locationCountry") or "").strip(),
    }
    if poi:
        place = {
            "city": str(poi.get("city") or "").strip(),
            "region": str(poi.get("region") or "").strip(),
            "country": str(poi.get("country") or "").strip(),
        }
    elif not any(place.values()):
        place = _location_place_from_gps(row)
    label = "" if poi else str(row.get("locationLabel") or row.get("locationName") or "").strip()
    keywords = _dedupe_text([
        poi.get("name"),
        *(poi.get("keywords") or []),
        place.get("city"),
        place.get("region"),
        place.get("country"),
    ])
    if not label:
        label = ", ".join(_dedupe_text([poi.get("name"), place.get("city"), place.get("region"), place.get("country")]))
    title_place = str(poi.get("name") or place.get("city") or place.get("country") or (keywords[0] if keywords else "")).strip()
    return label, keywords, title_place


def _seedable_title(value: Any) -> str:
    title = str(value or "").strip()
    if not title:
        return ""
    normalized = "".join(character for character in title.casefold() if character.isalnum())
    if normalized in {"".join(character for character in marker if character.isalnum()) for marker in INTERNAL_TITLE_MARKERS}:
        return ""
    return title


def _photos_title_from_row(row: dict[str, Any]) -> str:
    metadata = row.get("applePhotosMetadata")
    if isinstance(metadata, dict):
        title = _seedable_title(metadata.get("title"))
        if title:
            return title
    return _seedable_title(row.get("applePhotosTitle") or row.get("photosTitle"))


def _photos_keywords_from_row(row: dict[str, Any]) -> list[str]:
    metadata = row.get("applePhotosMetadata")
    if isinstance(metadata, dict) and metadata.get("keywords") is not None:
        return _dedupe_text(metadata.get("keywords") if isinstance(metadata.get("keywords"), list) else [metadata.get("keywords")])
    value = row.get("applePhotosKeywords") if row.get("applePhotosKeywords") is not None else row.get("photosKeywords")
    if isinstance(value, str):
        return _dedupe_text(value.replace(";", ",").split(","))
    if isinstance(value, list):
        return _dedupe_text(value)
    return []


def _capture_year(row: dict[str, Any]) -> str:
    captured = str(row.get("creationDate") or row.get("captured_at") or row.get("capturedAt") or "")
    return captured[:4] if len(captured) >= 4 and captured[:4].isdigit() else ""


def _title_keyword_hints(title: str) -> list[str]:
    value = str(title or "").strip()
    if not value:
        return []
    separators = [",", " - ", " · ", " / "]
    if not any(separator in value for separator in separators):
        return []
    normalized = value
    for separator in separators[1:]:
        normalized = normalized.replace(separator, ",")
    return _dedupe_text(part.strip() for part in normalized.split(",") if part.strip())


def _metadata_seed_from_row(row: dict[str, Any], keyword_blacklist: set[str]) -> dict[str, Any]:
    photos_title = _photos_title_from_row(row)
    photos_keywords = _clean_keywords(_photos_keywords_from_row(row), keyword_blacklist)
    title_keywords = _clean_keywords(_title_keyword_hints(photos_title), keyword_blacklist)
    location_label, location_keywords, title_place = _location_metadata_from_row(row)
    location_keywords = _clean_keywords(location_keywords, keyword_blacklist)
    year = _capture_year(row)
    seed_title = photos_title or (" ".join(part for part in [year, title_place] if part).strip())
    seed_keywords = _clean_keywords([*photos_keywords, *title_keywords, *location_keywords], keyword_blacklist)
    return {
        "photosTitle": photos_title,
        "photosKeywords": photos_keywords,
        "locationLabel": location_label,
        "locationKeywords": location_keywords,
        "seedTitle": seed_title,
        "seedKeywords": seed_keywords,
    }


def _asset_metadata_payload(row: sqlite3.Row | None) -> dict[str, Any]:
    if row is None:
        return {
            "title": "",
            "keywords": [],
            "locationLabel": "",
            "locationKeywords": [],
            "seedTitle": "",
            "seedKeywords": [],
        }
    return {
        "title": row["photos_title"] or "",
        "keywords": _read_json_text(row["photos_keywords_json"], []),
        "locationLabel": row["location_label"] or "",
        "locationKeywords": _read_json_text(row["location_keywords_json"], []),
        "seedTitle": row["metadata_seed_title"] or "",
        "seedKeywords": _read_json_text(row["metadata_seed_keywords_json"], []),
    }


def upsert_assets(repo_root: Path, rows: Iterable[dict[str, Any]]) -> int:
    now = now_iso()
    count = 0
    with connect(repo_root) as conn:
        keyword_blacklist = _keyword_blacklist_set(conn, repo_root)
        for row in rows:
            asset_id = _asset_id(row)
            if not asset_id:
                continue
            metadata_seed = _metadata_seed_from_row(row, keyword_blacklist)
            conn.execute(
                """
                INSERT INTO sidecar_assets (
                  asset_id, source_anchor, media_type, filename, captured_at, modified_at,
                  pixel_width, pixel_height, duration, favorite, hidden, photos_title,
                  photos_keywords_json, location_label, location_keywords_json,
                  metadata_seed_title, metadata_seed_keywords_json, raw_json, indexed_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(asset_id) DO UPDATE SET
                  source_anchor = excluded.source_anchor,
                  media_type = excluded.media_type,
                  filename = excluded.filename,
                  captured_at = excluded.captured_at,
                  modified_at = excluded.modified_at,
                  pixel_width = excluded.pixel_width,
                  pixel_height = excluded.pixel_height,
                  duration = excluded.duration,
                  favorite = excluded.favorite,
                  hidden = excluded.hidden,
                  photos_title = excluded.photos_title,
                  photos_keywords_json = excluded.photos_keywords_json,
                  location_label = excluded.location_label,
                  location_keywords_json = excluded.location_keywords_json,
                  metadata_seed_title = excluded.metadata_seed_title,
                  metadata_seed_keywords_json = excluded.metadata_seed_keywords_json,
                  raw_json = excluded.raw_json,
                  missing_at = NULL,
                  indexed_at = excluded.indexed_at,
                  updated_at = excluded.updated_at
                """,
                (
                    asset_id,
                    str(row.get("sourceAnchor") or f"apple-photos://{asset_id}"),
                    str(row.get("mediaType") or ""),
                    str(row.get("filename") or ""),
                    str(row.get("creationDate") or ""),
                    str(row.get("modificationDate") or ""),
                    int(row.get("pixelWidth") or 0),
                    int(row.get("pixelHeight") or 0),
                    float(row.get("duration") or 0),
                    1 if row.get("favorite") else 0,
                    1 if row.get("hidden") else 0,
                    metadata_seed["photosTitle"],
                    _json_text(metadata_seed["photosKeywords"]),
                    metadata_seed["locationLabel"],
                    _json_text(metadata_seed["locationKeywords"]),
                    metadata_seed["seedTitle"],
                    _json_text(metadata_seed["seedKeywords"]),
                    _json_text(row),
                    now,
                    now,
                ),
            )
            conn.execute(
                """
                INSERT OR IGNORE INTO sidecar_decisions (asset_id, created_at, updated_at)
                VALUES (?, ?, ?)
                """,
                (asset_id, now, now),
            )
            count += 1
    return count


def mark_missing_assets(repo_root: Path, present_asset_ids: Iterable[str]) -> int:
    """Mark previously indexed assets absent after a full Photos index scan."""
    present = {str(asset_id or "").strip() for asset_id in present_asset_ids if str(asset_id or "").strip()}
    if not present:
        return 0
    now = now_iso()
    with connect(repo_root) as conn:
        existing = conn.execute("SELECT asset_id FROM sidecar_assets WHERE missing_at IS NULL OR missing_at = ''").fetchall()
        missing = [str(row["asset_id"]) for row in existing if str(row["asset_id"]) not in present]
        for start in range(0, len(missing), 500):
            batch = missing[start:start + 500]
            placeholders = ",".join("?" for _ in batch)
            conn.execute(
                f"UPDATE sidecar_assets SET missing_at = ?, updated_at = ? WHERE asset_id IN ({placeholders})",
                [now, now, *batch],
            )
    return len(missing)


def _indexed_asset_row(row: sqlite3.Row) -> dict[str, Any]:
    raw = _read_json_text(row["raw_json"], {})
    if not isinstance(raw, dict):
        raw = {}
    asset_id = str(row["asset_id"] or "")
    merged = {
        **raw,
        "localIdentifier": str(raw.get("localIdentifier") or asset_id),
        "sourceAnchor": str(row["source_anchor"] or raw.get("sourceAnchor") or f"apple-photos://{asset_id}"),
        "filename": str(row["filename"] or raw.get("filename") or ""),
        "mediaType": str(row["media_type"] or raw.get("mediaType") or ""),
        "creationDate": str(row["captured_at"] or raw.get("creationDate") or ""),
        "modificationDate": str(row["modified_at"] or raw.get("modificationDate") or ""),
        "pixelWidth": int(row["pixel_width"] or raw.get("pixelWidth") or 0),
        "pixelHeight": int(row["pixel_height"] or raw.get("pixelHeight") or 0),
        "duration": float(row["duration"] or raw.get("duration") or 0),
        "favorite": bool(row["favorite"]),
        "hidden": bool(row["hidden"]),
    }
    if row["photos_title"]:
        merged["applePhotosTitle"] = row["photos_title"]
    photos_keywords = _read_json_text(row["photos_keywords_json"], [])
    if photos_keywords:
        merged["applePhotosKeywords"] = photos_keywords
    return merged


def _date_window_bounds(date_from: str = "", date_to: str = "") -> tuple[str, str]:
    start = str(date_from or "").strip()
    end = str(date_to or "").strip()
    if start and len(start) == 10:
        start = f"{start}T00:00:00Z"
    if end and len(end) == 10:
        try:
            next_day = datetime.fromisoformat(end).date() + timedelta(days=1)
            end = f"{next_day.isoformat()}T00:00:00Z"
        except ValueError:
            end = f"{end}T23:59:59Z"
    return start, end


def indexed_library_window(
    repo_root: Path,
    offset: int = 0,
    limit: int = 120,
    date_from: str = "",
    date_to: str = "",
    ratings: Iterable[Any] | None = None,
    colors: Iterable[Any] | None = None,
    pick_states: Iterable[Any] | None = None,
    media_types: Iterable[Any] | None = None,
    search: str = "",
) -> dict[str, Any]:
    """Return a Sidecar window from the local metadata index."""
    safe_offset = max(0, int(offset or 0))
    safe_limit = max(1, min(int(limit or 120), 5000))
    start, end = _date_window_bounds(date_from, date_to)
    predicates = ["(a.missing_at IS NULL OR a.missing_at = '')"]
    params: list[Any] = []
    if start:
        predicates.append("a.captured_at >= ?")
        params.append(start)
    if end:
        predicates.append("a.captured_at < ?")
        params.append(end)
    where_sql = " AND ".join(predicates)
    filter_predicates = [
        """
        NOT EXISTS (
          SELECT 1 FROM sidecar_tombstones AS t
          WHERE t.asset_id = a.asset_id AND t.tombstone_state = 'active'
        )
        """,
        """
        NOT EXISTS (
          SELECT 1 FROM sidecar_mock_uploads AS m
          WHERE m.asset_id = a.asset_id AND m.mock_state = 'active'
        )
        """,
    ]
    filter_params: list[Any] = []
    clean_ratings = sorted({
        max(0, min(5, int(str(value).strip())))
        for value in (ratings or [])
        if str(value).strip().isdigit()
    })
    if clean_ratings:
        filter_predicates.append(f"COALESCE(a.decision_rating, 0) IN ({', '.join('?' for _ in clean_ratings)})")
        filter_params.extend(clean_ratings)
    clean_colors = []
    for value in colors or []:
        color = str(value or "").strip()
        if color == "none":
            color = ""
        if color in COLOR_VALUES and color not in clean_colors:
            clean_colors.append(color)
    if clean_colors:
        filter_predicates.append(f"COALESCE(a.decision_color, '') IN ({', '.join('?' for _ in clean_colors)})")
        filter_params.extend(clean_colors)
    clean_media_types = []
    for value in media_types or []:
        media_type = str(value or "").strip()
        if media_type in {"photo", "video"} and media_type not in clean_media_types:
            clean_media_types.append(media_type)
    if clean_media_types:
        filter_predicates.append(f"COALESCE(a.media_type, '') IN ({', '.join('?' for _ in clean_media_types)})")
        filter_params.extend(clean_media_types)
    search_columns = (
        "a.asset_id",
        "a.filename",
        "a.photos_title",
        "a.photos_keywords_json",
        "a.location_label",
        "a.location_keywords_json",
        "a.metadata_seed_title",
        "a.metadata_seed_keywords_json",
        "a.decision_title",
        "a.decision_keywords_json",
    )
    for term in re.findall(r"[^\s,;]+", str(search or "").casefold())[:8]:
        escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        filter_predicates.append(
            "(" + " OR ".join(f"lower(COALESCE({column}, '')) LIKE ? ESCAPE '\\'" for column in search_columns) + ")"
        )
        filter_params.extend([f"%{escaped}%"] * len(search_columns))
    clean_pick_states = {str(value or "").strip() for value in (pick_states or [])}
    pick_predicates: list[str] = []
    if "picked" in clean_pick_states:
        pick_predicates.append("COALESCE(a.decision_pick_state, 'undecided') = 'picked'")
    if "undecided" in clean_pick_states:
        pick_predicates.append("COALESCE(a.decision_pick_state, 'undecided') = 'undecided'")
    if "rejected" in clean_pick_states:
        pick_predicates.append("COALESCE(a.decision_pick_state, 'undecided') IN ('rejected', 'hidden')")
    if pick_predicates:
        filter_predicates.append(f"({' OR '.join(pick_predicates)})")
    filter_sql = " AND ".join(filter_predicates)
    ordered_sql = f"""
        WITH ordered AS (
          SELECT
            a.*,
            d.rating AS decision_rating,
            d.color AS decision_color,
            d.pick_state AS decision_pick_state,
            d.title AS decision_title,
            d.keywords_json AS decision_keywords_json,
            ROW_NUMBER() OVER (
              ORDER BY
                CASE WHEN a.captured_at IS NULL OR a.captured_at = '' THEN 1 ELSE 0 END,
                a.captured_at DESC,
                a.asset_id
            ) - 1 AS sidecar_position
          FROM sidecar_assets AS a
          LEFT JOIN sidecar_decisions AS d ON d.asset_id = a.asset_id
          WHERE {where_sql}
        )
    """
    with connect(repo_root) as conn:
        indexed_count = _active_asset_count(conn)
        filtered_count = conn.execute(
            f"""
            {ordered_sql}
            SELECT count(*) AS total
            FROM ordered AS a
            WHERE {filter_sql}
            """,
            [*params, *filter_params],
        ).fetchone()["total"]
        rows = conn.execute(
            f"""
            {ordered_sql}
            SELECT a.*
            FROM ordered AS a
            WHERE {filter_sql}
            ORDER BY a.sidecar_position
            LIMIT ? OFFSET ?
            """,
            [*params, *filter_params, safe_limit, safe_offset],
        ).fetchall()
        next_offset = safe_offset + len(rows)
    items = merge_state(repo_root, [_indexed_asset_row(row) for row in rows])
    return {
        "ok": True,
        "mode": "sidecar-index-window",
        "source": "sidecar-index",
        "limit": safe_limit,
        "offset": safe_offset,
        "nextOffset": next_offset,
        "count": len(items),
        "indexedCount": int(indexed_count or 0),
        "filteredIndexedCount": int(filtered_count or 0),
        "dateFrom": date_from,
        "dateTo": date_to,
        "search": str(search or "").strip(),
        "items": items,
        "sidecarSummary": summary(repo_root),
    }


def _decision_payload(row: sqlite3.Row | None) -> dict[str, Any]:
    if row is None:
        return {
            "rating": 0,
            "color": "",
            "pickState": "undecided",
            "metadataState": "unreviewed",
            "title": "",
            "keywords": [],
            "reworkCategory": "",
            "reworkComment": "",
            "metadataAiRung": "",
            "metadataAiEvidence": [],
            "metadataAiNote": "",
            "lastAction": "",
            "updatedAt": "",
        }
    return {
        "rating": int(row["rating"] or 0),
        "color": row["color"] or "",
        "pickState": row["pick_state"] or "undecided",
        "metadataState": row["metadata_state"] or "unreviewed",
        "title": row["title"] or "",
        "keywords": _read_json_text(row["keywords_json"], []),
        "reworkCategory": row["rework_category"] or "",
        "reworkComment": row["rework_comment"] or "",
        "metadataAiRung": row["metadata_ai_rung"] or "",
        "metadataAiEvidence": _read_json_text(row["metadata_ai_evidence_json"], []),
        "metadataAiNote": row["metadata_ai_note"] or "",
        "lastAction": row["last_action"] or "",
        "updatedAt": row["updated_at"] or "",
    }


def merge_state(repo_root: Path, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    asset_ids = [_asset_id(row) for row in rows if _asset_id(row)]
    if not asset_ids:
        return rows
    placeholders = ",".join("?" for _ in asset_ids)
    with connect(repo_root) as conn:
        decision_rows = conn.execute(
            f"SELECT * FROM sidecar_decisions WHERE asset_id IN ({placeholders})",
            asset_ids,
        ).fetchall()
        decisions = {str(row["asset_id"]): _decision_payload(row) for row in decision_rows}
        asset_metadata_rows = conn.execute(
            f"""
            SELECT asset_id, photos_title, photos_keywords_json, location_label, location_keywords_json,
                   metadata_seed_title, metadata_seed_keywords_json
            FROM sidecar_assets
            WHERE asset_id IN ({placeholders})
            """,
            asset_ids,
        ).fetchall()
        asset_metadata = {str(row["asset_id"]): _asset_metadata_payload(row) for row in asset_metadata_rows}
        pending_rows = conn.execute(
            f"""
            SELECT asset_id, count(*) AS pending_count
            FROM sidecar_pending_sync
            WHERE status = 'pending' AND asset_id IN ({placeholders})
            GROUP BY asset_id
            """,
            asset_ids,
        ).fetchall()
        pending = {str(row["asset_id"]): int(row["pending_count"] or 0) for row in pending_rows}
        tombstone_rows = conn.execute(
            f"""
            SELECT asset_id, tombstone_state
            FROM sidecar_tombstones
            WHERE tombstone_state = 'active' AND asset_id IN ({placeholders})
            """,
            asset_ids,
        ).fetchall()
        tombstones = {str(row["asset_id"]): str(row["tombstone_state"] or "") for row in tombstone_rows}
        mock_upload_rows = conn.execute(
            f"""
            SELECT asset_id, mock_state, mock_run_id, uploaded_at
            FROM sidecar_mock_uploads
            WHERE mock_state = 'active' AND asset_id IN ({placeholders})
            """,
            asset_ids,
        ).fetchall()
        mock_uploads = {
            str(row["asset_id"]): {
                "state": str(row["mock_state"] or ""),
                "mockRunId": str(row["mock_run_id"] or ""),
                "bridgeRunId": str(row["mock_run_id"] or ""),
                "uploadedAt": str(row["uploaded_at"] or ""),
                "queuedAt": str(row["uploaded_at"] or ""),
            }
            for row in mock_upload_rows
        }
    merged = []
    for row in rows:
        asset_id = _asset_id(row)
        mock_upload = mock_uploads.get(asset_id, {})
        merged.append({
            **row,
            "sidecarState": decisions.get(asset_id, _decision_payload(None)),
            "applePhotosMetadata": asset_metadata.get(asset_id, _asset_metadata_payload(None)),
            "pendingSyncCount": pending.get(asset_id, 0),
            "tombstoneState": tombstones.get(asset_id, ""),
            "mockUploadState": mock_upload.get("state", ""),
            "mockUpload": mock_upload,
            "uploadBridgeState": mock_upload.get("state", ""),
            "uploadBridge": mock_upload,
        })
    return merged


def _current_decision(conn: sqlite3.Connection, asset_id: str) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM sidecar_decisions WHERE asset_id = ?", (asset_id,)).fetchone()
    return _decision_payload(row)


def _queue_pending_sync(
    conn: sqlite3.Connection,
    asset_id: str,
    field_family: str,
    old_value: Any,
    new_value: Any,
    now: str,
) -> None:
    conn.execute(
        "DELETE FROM sidecar_pending_sync WHERE asset_id = ? AND field_family = ? AND status = 'pending'",
        (asset_id, field_family),
    )
    conn.execute(
        """
        INSERT INTO sidecar_pending_sync (
          sync_id, asset_id, field_family, old_value_json, new_value_json, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
        """,
        (uuid.uuid4().hex, asset_id, field_family, _json_text(old_value), _json_text(new_value), now, now),
    )


def _pending_sync_count(conn: sqlite3.Connection, asset_id: str) -> int:
    row = conn.execute(
        """
        SELECT count(*) AS total
        FROM sidecar_pending_sync
        WHERE asset_id = ? AND status = 'pending'
        """,
        (asset_id,),
    ).fetchone()
    return int(row["total"] or 0)


def _missing_asset_count(conn: sqlite3.Connection) -> int:
    row = conn.execute(
        "SELECT count(*) AS total FROM sidecar_assets WHERE missing_at IS NOT NULL AND missing_at <> ''"
    ).fetchone()
    return int(row["total"] or 0)


def _active_asset_count(conn: sqlite3.Connection) -> int:
    total = conn.execute("SELECT count(*) AS total FROM sidecar_assets").fetchone()["total"]
    return max(0, int(total or 0) - _missing_asset_count(conn))


def _last_active_indexed_at(conn: sqlite3.Connection) -> str:
    row = conn.execute(
        """
        SELECT max(value) AS value
        FROM (
          SELECT max(indexed_at) AS value FROM sidecar_assets WHERE missing_at IS NULL
          UNION ALL
          SELECT max(indexed_at) AS value FROM sidecar_assets WHERE missing_at = ''
        )
        """
    ).fetchone()
    return str(row["value"] or "")


def _active_tombstone_state(conn: sqlite3.Connection, asset_id: str) -> str:
    row = conn.execute(
        """
        SELECT tombstone_state
        FROM sidecar_tombstones
        WHERE asset_id = ? AND tombstone_state = 'active'
        """,
        (asset_id,),
    ).fetchone()
    return str(row["tombstone_state"] or "") if row else ""


def _rework_category_values(value: Any) -> list[str]:
    if isinstance(value, (list, tuple, set)):
        raw_values = [str(item or "") for item in value]
    else:
        raw_values = re.split(r"[,;|]", str(value or ""))
    values = []
    for item in raw_values:
        category = str(item or "").strip().casefold()
        if not category:
            continue
        if category not in REWORK_CATEGORIES:
            raise ValueError("reworkCategory is invalid")
        if category not in values:
            values.append(category)
    return values


def _normalize_rework_category(value: Any) -> str:
    return ",".join(_rework_category_values(value))


def _keyword_blacklist_json_fallback(repo_root: Path) -> set[str]:
    path = repo_root / KEYWORD_BLACKLIST_JSON
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()
    values = payload.get("keywords") if isinstance(payload, dict) else None
    if not isinstance(values, list):
        return set()
    return {str(keyword).strip().casefold() for keyword in values if str(keyword).strip()}


def _keyword_blacklist_set(conn: sqlite3.Connection, repo_root: Path) -> set[str]:
    try:
        rows = conn.execute("SELECT keyword FROM keyword_blacklist ORDER BY keyword COLLATE NOCASE").fetchall()
    except sqlite3.OperationalError:
        return _keyword_blacklist_json_fallback(repo_root)
    values = {str(row["keyword"] or "").strip().casefold() for row in rows if str(row["keyword"] or "").strip()}
    return values or _keyword_blacklist_json_fallback(repo_root)


def _clean_keywords(value: Any, keyword_blacklist: set[str]) -> list[str]:
    raw_keywords = value
    if isinstance(raw_keywords, str):
        raw_keywords = [part.strip() for part in raw_keywords.replace(";", ",").split(",")]
    elif not isinstance(raw_keywords, list):
        raw_keywords = []
    cleaned: list[str] = []
    seen: set[str] = set()
    for keyword in raw_keywords:
        clean = str(keyword).strip()
        normalized = clean.casefold()
        if not clean or normalized in seen or normalized in keyword_blacklist:
            continue
        seen.add(normalized)
        cleaned.append(clean)
    return cleaned


def _filename_ai_generated_keywords(filename: Any, keyword_blacklist: set[str]) -> list[str]:
    """Return AI-art keywords only when filename evidence is explicit."""
    text = str(filename or "").casefold()
    if not text:
        return []
    ai_filename_markers = (
        "dreamshaper",
        "realityvisionsdxl",
        "hassakuxl",
        "juggernautxl",
        "leosamsfilmgirlultra",
        "ultrabasemodel",
        "realismenginesdxl",
        "dpmsde",
    )
    if not any(marker in text for marker in ai_filename_markers):
        return []
    return _clean_keywords(list(AI_GENERATED_KEYWORDS), keyword_blacklist)


def _filename_style_keywords(filename: Any) -> list[str]:
    text = str(filename or "").casefold()
    styles = (
        ("mucha style", "Mucha style"),
        ("art nouveau", "Art Nouveau"),
        ("art moderne", "Art Moderne"),
        ("gaudi style", "Gaudi-inspired"),
        ("dali style", "Dali-inspired"),
        ("gothic", "Gothic"),
        ("religious", "Religious"),
        ("spiritual", "Spiritual"),
    )
    return [label for marker, label in styles if marker in text]


def _filename_metadata_seed(filename: Any, captured_at: Any, keyword_blacklist: set[str]) -> tuple[str, list[str]]:
    """Derive conservative metadata from explicit generated-image filenames."""
    name = Path(str(filename or "")).stem
    if not name:
        return "", []
    text = name.replace("_", ", ")
    lowered = text.casefold()
    if "stained glass" not in lowered:
        return "", []

    styles = _filename_style_keywords(name)
    title_parts: list[str] = []
    year = str(captured_at or "")[:4]
    if year.isdigit():
        title_parts.append(year)
    if "mucha style" in lowered:
        title_parts.append("Mucha Style")
    title_parts.append("Stained Glass")
    if styles and styles[0] not in {"Mucha style"} and styles[0] not in title_parts:
        title_parts.append(styles[0])
    if "diana" in lowered:
        title_parts.extend(["Diana", "Portrait"])
    elif "abstract drawing" in lowered:
        title_parts.append("Abstract Drawing")
    elif "portrait" in lowered:
        title_parts.append("Portrait")
    title = " ".join(_dedupe_text(title_parts)).strip()

    keywords: list[str] = ["Stained glass"]
    if "abstract drawing" in lowered:
        keywords.append("Abstract drawing")
    if "portrait" in lowered:
        keywords.append("Portrait")
    if "diana" in lowered:
        keywords.extend(["Diana", "Goddess of the hunt"])
    if "black lead" in lowered:
        keywords.append("Black leading")
    if "solid plain" in lowered or "solid colors" in lowered:
        keywords.extend(["Solid colors", "Flat colors"])
    if "primary colors" in lowered or "primary colors only" in lowered:
        keywords.append("Primary palette")
    for color in ("black", "red", "green", "blue"):
        if re.search(rf"\b{color}\b", lowered):
            keywords.append(color.title())
    if "hair red" in lowered:
        keywords.append("Red hair")
    if "dress blue" in lowered:
        keywords.append("Blue dress")
    keywords.extend(styles)
    keywords.extend(_filename_ai_generated_keywords(filename, keyword_blacklist))
    return title, _clean_keywords(_dedupe_text(keywords), keyword_blacklist)


def _metadata_values_from_payload(
    payload: dict[str, Any],
    fallback_title: str,
    fallback_keywords: list[str],
    keyword_blacklist: set[str],
) -> tuple[str, list[str]]:
    title = fallback_title
    keywords = _clean_keywords(fallback_keywords, keyword_blacklist)
    if "title" in payload:
        title = str(payload.get("title") or "").strip()
    if "keywords" in payload:
        keywords = _clean_keywords(payload.get("keywords") or [], keyword_blacklist)
    return title, keywords


def record_decision(repo_root: Path, payload: dict[str, Any]) -> dict[str, Any]:
    asset_id = str(payload.get("assetId") or payload.get("asset_id") or payload.get("localIdentifier") or "").strip()
    if not asset_id:
        raise ValueError("assetId is required")
    action = str(payload.get("action") or "").strip().casefold()
    now = now_iso()
    with connect(repo_root) as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO sidecar_assets (asset_id, source_anchor, indexed_at, updated_at)
            VALUES (?, ?, ?, ?)
            """,
            (asset_id, f"apple-photos://{asset_id}", now, now),
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO sidecar_decisions (asset_id, created_at, updated_at)
            VALUES (?, ?, ?)
            """,
            (asset_id, now, now),
        )
        before = _current_decision(conn, asset_id)
        before_tombstone_state = _active_tombstone_state(conn, asset_id)
        before_for_sync = {**before, "tombstoneState": before_tombstone_state}
        rating = before["rating"]
        color = before["color"]
        pick_state = before["pickState"]
        metadata_state = before["metadataState"]
        title = before["title"]
        keywords = before["keywords"]
        rework_category = before["reworkCategory"]
        rework_comment = before["reworkComment"]
        metadata_ai_rung = before["metadataAiRung"]
        metadata_ai_evidence = before["metadataAiEvidence"]
        metadata_ai_note = before["metadataAiNote"]
        keyword_blacklist = _keyword_blacklist_set(conn, repo_root)
        changed_families: set[str] = set()

        if action == "rating":
            rating = int(payload.get("rating") or payload.get("value") or 0)
            if rating not in RATING_VALUES:
                raise ValueError("rating must be between 0 and 5")
            changed_families.add("rating")
        elif action == "color":
            color = str(payload.get("color") or payload.get("value") or "").strip().casefold()
            if color not in COLOR_VALUES:
                raise ValueError("color must be red, yellow, green, blue, purple, or blank")
            changed_families.add("color")
        elif action == "pick":
            pick_state = "picked"
            changed_families.add("pick_state")
        elif action == "unpick":
            pick_state = "undecided"
            changed_families.add("pick_state")
        elif action == "restore":
            pick_state = "undecided"
            if metadata_state == "blocked":
                metadata_state = "unreviewed"
                changed_families.add("metadata")
            if before_tombstone_state == "active":
                changed_families.add("tombstone")
            changed_families.add("pick_state")
        elif action == "reject":
            pick_state = "rejected"
            changed_families.add("pick_state")
        elif action == "hide":
            pick_state = "hidden"
            changed_families.add("pick_state")
        elif action == "tombstone":
            pick_state = "rejected"
            metadata_state = "blocked"
            rework_category = ""
            rework_comment = ""
            metadata_ai_rung = ""
            metadata_ai_evidence = []
            metadata_ai_note = ""
            changed_families.update({"metadata", "pick_state", "tombstone"})
        elif action == "approve":
            pick_state = "picked"
            metadata_state = "approved"
            title, keywords = _metadata_values_from_payload(payload, title, keywords, keyword_blacklist)
            rework_category = ""
            rework_comment = ""
            metadata_ai_rung = str(payload.get("metadataAiRung") or payload.get("metadata_ai_rung") or metadata_ai_rung or "").strip()
            metadata_ai_evidence = _clean_keywords(
                payload.get("metadataAiEvidence") or payload.get("metadata_ai_evidence") or metadata_ai_evidence,
                set(),
            )
            metadata_ai_note = str(payload.get("metadataAiNote") or payload.get("metadata_ai_note") or metadata_ai_note or "").strip()
            changed_families.update({"pick_state", "metadata"})
        elif action == "metadata":
            title, keywords = _metadata_values_from_payload(payload, title, keywords, keyword_blacklist)
            metadata_state = str(payload.get("metadataState") or "proposed").strip().casefold()
            if metadata_state not in METADATA_STATES:
                raise ValueError("metadataState is invalid")
            metadata_ai_rung = str(payload.get("metadataAiRung") or payload.get("metadata_ai_rung") or metadata_ai_rung or "").strip()
            metadata_ai_evidence = _clean_keywords(
                payload.get("metadataAiEvidence") or payload.get("metadata_ai_evidence") or metadata_ai_evidence,
                set(),
            )
            metadata_ai_note = str(payload.get("metadataAiNote") or payload.get("metadata_ai_note") or metadata_ai_note or "").strip()
            if metadata_state == "rework":
                rework_category = _normalize_rework_category(payload.get("reworkCategory") or payload.get("rework_category"))
                rework_comment = str(payload.get("reworkComment") or payload.get("rework_comment") or "").strip()
                metadata_ai_rung = ""
                metadata_ai_evidence = []
                metadata_ai_note = ""
            elif metadata_state != "blocked":
                rework_category = ""
                rework_comment = ""
            changed_families.add("metadata")
        elif action == "metadata-rework":
            metadata_state = "rework"
            title, keywords = _metadata_values_from_payload(payload, title, keywords, keyword_blacklist)
            rework_category = _normalize_rework_category(payload.get("reworkCategory") or payload.get("rework_category"))
            rework_comment = str(payload.get("reworkComment") or payload.get("rework_comment") or "").strip()
            if rework_comment and not rework_category:
                rework_category = "other"
            metadata_ai_rung = ""
            metadata_ai_evidence = []
            metadata_ai_note = ""
            changed_families.add("metadata")
        else:
            raise ValueError("Unsupported Sidecar action")

        if pick_state not in PICK_STATES:
            raise ValueError("pickState is invalid")
        conn.execute(
            """
            UPDATE sidecar_decisions
            SET rating = ?, color = ?, pick_state = ?, metadata_state = ?,
                title = ?, keywords_json = ?, rework_category = ?, rework_comment = ?,
                metadata_ai_rung = ?, metadata_ai_evidence_json = ?, metadata_ai_note = ?,
                last_action = ?, updated_at = ?
            WHERE asset_id = ?
            """,
            (
                rating,
                color,
                pick_state,
                metadata_state,
                title,
                _json_text(keywords),
                rework_category,
                rework_comment,
                metadata_ai_rung,
                _json_text(metadata_ai_evidence),
                metadata_ai_note,
                action,
                now,
                asset_id,
            ),
        )
        if action == "restore":
            conn.execute(
                """
                UPDATE sidecar_tombstones
                SET tombstone_state = 'restored', updated_at = ?
                WHERE asset_id = ? AND tombstone_state = 'active'
                """,
                (now, asset_id),
            )
        elif action == "tombstone":
            conn.execute(
                """
                INSERT INTO sidecar_tombstones (asset_id, tombstone_state, reason, tombstoned_at, updated_at)
                VALUES (?, 'active', ?, ?, ?)
                ON CONFLICT(asset_id) DO UPDATE SET
                  tombstone_state = 'active',
                  reason = excluded.reason,
                  tombstoned_at = excluded.tombstoned_at,
                  updated_at = excluded.updated_at
                """,
                (asset_id, str(payload.get("reason") or "").strip(), now, now),
            )
        after = _current_decision(conn, asset_id)
        after["tombstoneState"] = _active_tombstone_state(conn, asset_id)
        for family in sorted(changed_families):
            _queue_pending_sync(conn, asset_id, family, before_for_sync, after, now)
        pending_sync_count = _pending_sync_count(conn, asset_id)
        after["pendingSyncCount"] = pending_sync_count
    return {
        "ok": True,
        "assetId": asset_id,
        "state": after,
        "changedFamilies": sorted(changed_families),
        "pendingSyncCount": pending_sync_count,
    }


def record_decisions(repo_root: Path, payloads: Iterable[dict[str, Any]]) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for payload in payloads:
        if not isinstance(payload, dict):
            raise ValueError("Each Sidecar decision must be a JSON object.")
        items.append(record_decision(repo_root, payload))
    return {"ok": True, "count": len(items), "items": items}


def summary(repo_root: Path) -> dict[str, Any]:
    with connect(repo_root) as conn:
        rows = conn.execute(
            """
            SELECT pick_state, metadata_state, count(*) AS total
            FROM sidecar_decisions
            GROUP BY pick_state, metadata_state
            """
        ).fetchall()
        pending_count = conn.execute(
            "SELECT count(*) AS total FROM sidecar_pending_sync WHERE status = 'pending'"
        ).fetchone()["total"]
        total_assets = conn.execute("SELECT count(*) AS total FROM sidecar_assets").fetchone()["total"]
        missing_count = _missing_asset_count(conn)
        indexed_count = max(0, int(total_assets or 0) - missing_count)
        last_indexed_at = _last_active_indexed_at(conn)
        tombstone_count = conn.execute(
            "SELECT count(*) AS total FROM sidecar_tombstones WHERE tombstone_state = 'active'"
        ).fetchone()["total"]
    return {
        "ok": True,
        "indexedCount": int(indexed_count or 0),
        "missingIndexedCount": int(missing_count or 0),
        "lastIndexedAt": str(last_indexed_at or ""),
        "pendingSyncCount": int(pending_count or 0),
        "tombstoneCount": int(tombstone_count or 0),
        "states": [
            {
                "pickState": row["pick_state"],
                "metadataState": row["metadata_state"],
                "count": int(row["total"] or 0),
            }
            for row in rows
        ],
    }

def empty_wastebasket(repo_root: Path) -> dict[str, Any]:
    with connect(repo_root) as conn:
        rows = conn.execute(
            """
            SELECT d.asset_id
            FROM sidecar_decisions AS d
            WHERE d.pick_state IN ('rejected', 'hidden')
              AND NOT EXISTS (
                SELECT 1 FROM sidecar_tombstones AS t
                WHERE t.asset_id = d.asset_id AND t.tombstone_state = 'active'
              )
            ORDER BY d.updated_at, d.asset_id
            """
        ).fetchall()
    items = [
        record_decision(repo_root, {
            "assetId": row["asset_id"],
            "action": "tombstone",
            "reason": "empty wastebasket",
        })
        for row in rows
    ]
    return {"ok": True, "count": len(items), "items": items, "summary": summary(repo_root)}


def _upload_bridge_rows(conn: sqlite3.Connection, limit: int | None = None) -> list[sqlite3.Row]:
    limit_sql = ""
    params: tuple[Any, ...] = ()
    if limit is not None:
        limit_sql = "LIMIT ?"
        params = (max(1, min(int(limit or 500), 5000)),)
    return conn.execute(
        f"""
        SELECT a.asset_id, a.source_anchor, a.media_type, a.filename, a.captured_at, m.uploaded_at
        FROM sidecar_mock_uploads AS m
        JOIN sidecar_assets AS a ON a.asset_id = m.asset_id
        JOIN sidecar_decisions AS d ON d.asset_id = m.asset_id
        WHERE m.mock_state = 'active'
          AND d.pick_state = 'picked'
          AND d.metadata_state = 'approved'
          AND NOT EXISTS (
            SELECT 1 FROM sidecar_tombstones AS t
            WHERE t.asset_id = m.asset_id AND t.tombstone_state = 'active'
          )
        ORDER BY m.uploaded_at DESC, a.captured_at DESC, a.asset_id
        {limit_sql}
        """,
        params,
    ).fetchall()


def _mock_upload_summary(conn: sqlite3.Connection) -> dict[str, Any]:
    """Summarize rows queued across the Sidecar upload bridge."""
    rows = _upload_bridge_rows(conn)
    planned_key_sets: dict[str, list[dict[str, str]]] = {}
    all_planned_keys: list[dict[str, str]] = []
    for row in rows:
        _photo_id, keys = _planned_r2_keys(row)
        planned_key_sets[str(row["asset_id"])] = keys
        all_planned_keys.extend(keys)
    current_r2 = _current_r2_objects_for_plan(conn, all_planned_keys)
    collision_count = 0
    covered_key_count = 0
    for row in rows:
        item_collision_count = 0
        for key in planned_key_sets.get(str(row["asset_id"]), []):
            if current_r2.get((key["bucket"], key["key"])) is not None:
                item_collision_count += 1
                covered_key_count += 1
        if item_collision_count:
            collision_count += 1
    latest_uploaded_at = str(rows[0]["uploaded_at"] or "") if rows else ""
    return {
        "mockUploadedCount": len(rows),
        "bridgeQueuedCount": len(rows),
        "collisionCount": collision_count,
        "coveredKeyCount": covered_key_count,
        "latestUploadedAt": latest_uploaded_at,
        "latestQueuedAt": latest_uploaded_at,
    }


def upload_bridge_plan(repo_root: Path, limit: int = 500) -> dict[str, Any]:
    """Return the dry-run plan for rows already queued across the upload bridge."""
    safe_limit = max(1, min(int(limit or 500), 5000))
    with connect(repo_root) as conn:
        rows = _upload_bridge_rows(conn, safe_limit)
        planned_key_sets: dict[str, list[dict[str, str]]] = {}
        photo_ids: dict[str, str] = {}
        all_planned_keys: list[dict[str, str]] = []
        for row in rows:
            photo_id, keys = _planned_r2_keys(row)
            asset_id = str(row["asset_id"])
            photo_ids[asset_id] = photo_id
            planned_key_sets[asset_id] = keys
            all_planned_keys.extend(keys)
        current_r2 = _current_r2_objects_for_plan(conn, all_planned_keys)
        total_queued = conn.execute(
            """
            SELECT count(*) AS total
            FROM sidecar_mock_uploads AS m
            JOIN sidecar_decisions AS d ON d.asset_id = m.asset_id
            LEFT JOIN sidecar_tombstones AS t ON t.asset_id = m.asset_id AND t.tombstone_state = 'active'
            WHERE m.mock_state = 'active'
              AND d.pick_state = 'picked'
              AND d.metadata_state = 'approved'
              AND t.asset_id IS NULL
            """
        ).fetchone()["total"]
    items = []
    collision_count = 0
    covered_key_count = 0
    total_key_count = 0
    for row in rows:
        asset_id = str(row["asset_id"])
        planned = []
        item_collision_count = 0
        for key in planned_key_sets.get(asset_id, []):
            total_key_count += 1
            current = current_r2.get((key["bucket"], key["key"]))
            exists = current is not None
            if exists:
                item_collision_count += 1
                covered_key_count += 1
            planned.append({
                **key,
                "exists": exists,
                **({"existing": current} if current else {}),
            })
        if item_collision_count:
            collision_count += 1
        items.append({
            "assetId": asset_id,
            "photoId": photo_ids.get(asset_id, ""),
            "filename": row["filename"] or "",
            "capturedAt": row["captured_at"] or "",
            "mediaType": row["media_type"] or "",
            "queuedAt": row["uploaded_at"] or "",
            "collisionCount": item_collision_count,
            "plannedKeys": planned,
        })
    return {
        "ok": True,
        "mode": "dry-run",
        "realUploadImplemented": False,
        "bridgeQueuedCount": int(total_queued or 0),
        "count": len(items),
        "items": items,
        "collisionCount": collision_count,
        "coveredKeyCount": covered_key_count,
        "plannedKeyCount": total_key_count,
        "message": "Upload Bridge dry-run only. Real Apple Photos export, R2 upload, and Owner registration are the next implementation slice.",
    }


def upload_plan(repo_root: Path, limit: int = 500) -> dict[str, Any]:
    safe_limit = max(1, min(int(limit or 500), 5000))
    with connect(repo_root) as conn:
        readiness = conn.execute(
            """
            SELECT
              COUNT(*) AS picked_count,
              COUNT(CASE WHEN d.metadata_state = 'approved' AND m.asset_id IS NULL THEN 1 END) AS approved_picked_count,
              COUNT(CASE WHEN d.metadata_state <> 'approved' THEN 1 END) AS picked_needs_review_count,
              COUNT(CASE WHEN d.metadata_state = 'unreviewed' THEN 1 END) AS picked_unreviewed_count,
              COUNT(CASE WHEN d.metadata_state = 'proposed' THEN 1 END) AS picked_proposed_count,
              COUNT(CASE WHEN d.metadata_state = 'rework' THEN 1 END) AS picked_rework_count,
              COUNT(CASE WHEN d.metadata_state = 'blocked' THEN 1 END) AS picked_blocked_count,
              COUNT(CASE WHEN d.metadata_state = 'approved' AND m.asset_id IS NOT NULL THEN 1 END) AS mock_uploaded_count
            FROM sidecar_decisions AS d
            LEFT JOIN sidecar_mock_uploads AS m ON m.asset_id = d.asset_id AND m.mock_state = 'active'
            LEFT JOIN sidecar_tombstones AS t ON t.asset_id = d.asset_id AND t.tombstone_state = 'active'
            WHERE d.pick_state = 'picked' AND t.asset_id IS NULL
            """
        ).fetchone()
        rows = conn.execute(
            """
            SELECT a.*, d.rating, d.color, d.pick_state, d.metadata_state, d.title, d.keywords_json
            FROM sidecar_decisions AS d
            JOIN sidecar_assets AS a ON a.asset_id = d.asset_id
            WHERE d.pick_state = 'picked' AND d.metadata_state = 'approved'
              AND NOT EXISTS (
                SELECT 1 FROM sidecar_tombstones AS t
                WHERE t.asset_id = d.asset_id AND t.tombstone_state = 'active'
              )
              AND NOT EXISTS (
                SELECT 1 FROM sidecar_mock_uploads AS m
                WHERE m.asset_id = d.asset_id AND m.mock_state = 'active'
              )
            ORDER BY a.captured_at DESC, a.asset_id
            LIMIT ?
            """,
            (safe_limit,),
        ).fetchall()
        mock_upload_summary = _mock_upload_summary(conn)
    items = []
    for row in rows:
        items.append({
            "assetId": row["asset_id"],
            "sourceAnchor": row["source_anchor"],
            "filename": row["filename"] or "",
            "capturedAt": row["captured_at"] or "",
            "mediaType": row["media_type"] or "",
            "rating": int(row["rating"] or 0),
            "color": row["color"] or "",
            "title": row["title"] or "",
            "keywords": _read_json_text(row["keywords_json"], []),
            "eligibleReason": "picked and metadata approved",
        })
    return {
        "ok": True,
        "count": len(items),
        "items": items,
        "pickedCount": int(readiness["picked_count"] or 0),
        "approvedPickedCount": int(readiness["approved_picked_count"] or 0),
        "pickedNeedsReviewCount": int(readiness["picked_needs_review_count"] or 0),
        "pickedUnreviewedCount": int(readiness["picked_unreviewed_count"] or 0),
        "pickedProposedCount": int(readiness["picked_proposed_count"] or 0),
        "pickedReworkCount": int(readiness["picked_rework_count"] or 0),
        "pickedBlockedCount": int(readiness["picked_blocked_count"] or 0),
        "mockUploadedCount": int(readiness["mock_uploaded_count"] or 0),
        "mockUploadSummary": mock_upload_summary,
        "bridgeQueuedCount": int(readiness["mock_uploaded_count"] or 0),
        "uploadBridgeSummary": mock_upload_summary,
    }


def _ai_metadata_reason(row: sqlite3.Row, seed_keywords: list[str]) -> str:
    metadata_state = str(row["metadata_state"] or "")
    if metadata_state == "rework":
        category = str(row["rework_category"] or "").strip()
        return f"rework:{category}" if category else "rework"
    if row["metadata_seed_title"] or seed_keywords:
        return "picked_unreviewed_seeded"
    return "picked_unreviewed_missing_seed_metadata"


def _metadata_ai_ladder_payload() -> list[dict[str, str]]:
    return [dict(item) for item in AI_METADATA_LADDER]


def _vision_classification_guidance_payload() -> dict[str, Any]:
    return json.loads(json.dumps(VISION_CLASSIFICATION_GUIDANCE))


def _location_keyword_guidance_payload() -> dict[str, Any]:
    return json.loads(json.dumps(LOCATION_KEYWORD_GUIDANCE))


def _metadata_ai_rung_rank(rung: str) -> int:
    return AI_METADATA_RUNG_ORDER.get(str(rung or "").strip(), AI_METADATA_RUNG_ORDER["human-review"])


def _filename_has_subject_hint(filename: str) -> bool:
    value = Path(str(filename or "")).stem.strip()
    if not value:
        return False
    if re.fullmatch(r"(IMG|DSC|PXL|VID|MOV|MVI)[-_ ]?\d+", value, re.IGNORECASE):
        return False
    words = re.findall(r"[A-Za-z][A-Za-z-]{2,}", value)
    return len(words) >= 2


def _title_is_location_only(title: str, keywords: Iterable[Any]) -> bool:
    value = str(title or "").strip()
    if not value:
        return True
    without_year = re.sub(r"^\d{4}\s+", "", value).strip()
    if not without_year:
        return True
    keyword_set = {str(keyword or "").strip().casefold() for keyword in keywords if str(keyword or "").strip()}
    return without_year.casefold() in keyword_set


def _title_has_public_place_subject(title: str) -> bool:
    value = re.sub(r"^\d{4}\s+", "", str(title or "").strip()).casefold()
    return bool(re.search(r"\b(palace|museum|musee|gallery|landmark|cathedral|castle|monument|station|park|venue)\b", value))


def _metadata_ai_context(
    row: sqlite3.Row,
    raw_row: dict[str, Any],
    photos_title: str,
    photos_keywords: list[str],
    location_label: str,
    location_keywords: list[str],
    seed_title: str,
    seed_keywords: list[str],
) -> dict[str, Any]:
    evidence: list[str] = []
    limitations: list[str] = []
    filename = str(row["filename"] or "")
    rework_categories = set(_rework_category_values(row["rework_category"]))
    rework_category = ",".join(sorted(rework_categories))
    candidate_title = _seedable_title(row["title"]) or seed_title
    candidate_keywords = _dedupe_text([*_read_json_text(row["keywords_json"], []), *seed_keywords])
    has_subject_filename = _filename_has_subject_hint(filename)
    has_public_poi = bool(_location_poi_from_gps(raw_row))
    location_only = _title_is_location_only(candidate_title, candidate_keywords)

    if photos_title:
        evidence.append("photos-title")
    if photos_keywords:
        evidence.append("photos-keywords")
    if has_subject_filename:
        evidence.append("descriptive-filename")
    if location_label or location_keywords:
        evidence.append("local-gps-location")
    if isinstance(raw_row.get("location"), dict):
        evidence.append("gps-coordinates")
    for category in sorted(rework_categories):
        evidence.append(f"owner-rework-{category}")

    if has_subject_filename:
        recommended_rung = "filename-gps"
        note = "Filename contains subject/style words, so non-vision proposal can be specific enough."
    elif photos_title or photos_keywords:
        recommended_rung = "seed"
        note = "Existing Photos metadata contains title or keyword subject hints."
    elif location_label or location_keywords:
        recommended_rung = "vision-description"
        note = "Local evidence is location-only; use vision to identify visible subject, setting, and likely AI-generated or 3D printed media."
        limitations.append("location-only")
    else:
        recommended_rung = "vision-description"
        note = "No subject evidence is available from local seeds; use vision before proposing metadata, including likely AI-generated or 3D printed media."
        limitations.append("missing-subject-evidence")

    if "generic" in rework_categories and recommended_rung != "filename-gps":
        if has_public_poi:
            recommended_rung = "geocode-context"
            note = "Owner rejected the current metadata as generic; GPS resolves to a supported public place, so proposal can use public-place context."
            evidence.append("gps-public-place")
        elif location_only:
            recommended_rung = "vision-description"
            note = "Owner rejected the current metadata as generic and available local evidence is still location-only; use vision to identify the subject and likely AI-generated or 3D printed media."
            if "location-only" not in limitations:
                limitations.append("location-only")
    if location_only:
        limitations.append("generic-title")

    return {
        "evidence": _dedupe_text(evidence),
        "limitations": _dedupe_text(limitations),
        "recommendedRung": recommended_rung,
        "recommendedRungLabel": AI_METADATA_LADDER[_metadata_ai_rung_rank(recommended_rung)]["label"],
        "note": note,
    }


def _normalize_asset_id_scope(asset_ids: Iterable[Any] | None = None) -> list[str]:
    values = []
    for value in asset_ids or []:
        asset_id = str(value or "").strip()
        if asset_id and asset_id not in values:
            values.append(asset_id)
    return values[:500]


def ai_metadata_plan(repo_root: Path, limit: int = 200, asset_ids: Iterable[Any] | None = None) -> dict[str, Any]:
    """Plan picked-only Sidecar rows for a future local AI metadata pass."""
    safe_limit = max(1, min(int(limit or 200), 5000))
    scoped_asset_ids = _normalize_asset_id_scope(asset_ids)
    asset_scope_sql = ""
    asset_scope_params: list[Any] = []
    if scoped_asset_ids:
        asset_scope_sql = f" AND d.asset_id IN ({','.join('?' for _ in scoped_asset_ids)})"
        asset_scope_params = scoped_asset_ids
    active_item_predicate = """
      d.pick_state = 'picked'
      AND (a.missing_at IS NULL OR a.missing_at = '')
      AND NOT EXISTS (
        SELECT 1 FROM sidecar_tombstones AS t
        WHERE t.asset_id = d.asset_id AND t.tombstone_state = 'active'
      )
    """
    actionable_ai_predicate = """
      d.metadata_state != 'approved'
      AND NOT (
        d.metadata_state = 'proposed'
        AND d.last_action = 'ai-metadata-proposal'
        AND trim(COALESCE(d.title, '')) <> ''
        AND COALESCE(d.keywords_json, '[]') NOT IN ('', '[]')
      )
    """
    with connect(repo_root) as conn:
        keyword_blacklist = _keyword_blacklist_set(conn, repo_root)
        counts = conn.execute(
            f"""
            SELECT
              COUNT(*) AS picked_count,
              COUNT(CASE WHEN d.metadata_state = 'unreviewed' THEN 1 END) AS unreviewed_count,
              COUNT(CASE WHEN d.metadata_state = 'rework' THEN 1 END) AS rework_count,
              COUNT(CASE WHEN d.metadata_state = 'proposed' THEN 1 END) AS proposed_count,
              COUNT(CASE WHEN d.metadata_state = 'approved' THEN 1 END) AS approved_count,
              COUNT(CASE WHEN d.metadata_state = 'blocked' THEN 1 END) AS blocked_count,
              COUNT(CASE WHEN {actionable_ai_predicate}
                AND NOT EXISTS (
                  SELECT 1 FROM sidecar_mock_uploads AS m
                  WHERE m.asset_id = d.asset_id AND m.mock_state = 'active'
                )
              THEN 1 END) AS candidate_count,
              COUNT(CASE WHEN d.metadata_state = 'proposed'
                AND d.last_action = 'ai-metadata-proposal'
              THEN 1 END) AS ai_proposed_count,
              COUNT(CASE WHEN EXISTS (
                SELECT 1 FROM sidecar_mock_uploads AS m
                WHERE m.asset_id = d.asset_id AND m.mock_state = 'active'
              ) THEN 1 END) AS mock_uploaded_count
            FROM sidecar_decisions AS d
            JOIN sidecar_assets AS a ON a.asset_id = d.asset_id
            WHERE {active_item_predicate}
              {asset_scope_sql}
            """,
            asset_scope_params,
        ).fetchone()
        rows = conn.execute(
            f"""
            SELECT
              a.asset_id, a.source_anchor, a.media_type, a.filename, a.captured_at,
              a.pixel_width, a.pixel_height, a.duration, a.photos_title,
              a.photos_keywords_json, a.location_label, a.location_keywords_json,
              a.metadata_seed_title, a.metadata_seed_keywords_json, a.raw_json,
              d.rating, d.color, d.metadata_state, d.title, d.keywords_json,
              d.rework_category, d.rework_comment
            FROM sidecar_decisions AS d
            JOIN sidecar_assets AS a ON a.asset_id = d.asset_id
            WHERE {active_item_predicate}
              {asset_scope_sql}
              AND {actionable_ai_predicate}
              AND NOT EXISTS (
                SELECT 1 FROM sidecar_mock_uploads AS m
                WHERE m.asset_id = d.asset_id AND m.mock_state = 'active'
              )
            ORDER BY
              CASE
                WHEN d.metadata_state = 'rework' THEN 0
                WHEN d.metadata_state = 'unreviewed' THEN 1
                WHEN d.metadata_state = 'proposed' AND d.last_action = 'ai-metadata-proposal' THEN 3
                ELSE 2
              END,
              CASE WHEN a.captured_at IS NULL OR a.captured_at = '' THEN 1 ELSE 0 END,
              a.captured_at ASC,
              a.asset_id
            LIMIT ?
            """,
            (*asset_scope_params, safe_limit),
        ).fetchall()
    items: list[dict[str, Any]] = []
    for row in rows:
        raw_row = _read_json_text(row["raw_json"], {})
        derived_location_label = ""
        derived_location_keywords: list[str] = []
        derived_title_place = ""
        if isinstance(raw_row, dict):
            derived_location_label, derived_location_keywords, derived_title_place = _location_metadata_from_row(raw_row)
        photos_keywords = _clean_keywords(_read_json_text(row["photos_keywords_json"], []), keyword_blacklist)
        location_label = derived_location_label or row["location_label"] or ""
        location_keywords = _clean_keywords(
            _dedupe_text([*derived_location_keywords, *_read_json_text(row["location_keywords_json"], [])]),
            keyword_blacklist,
        )
        seed_title = _seedable_title(row["metadata_seed_title"])
        rework_categories = set(_rework_category_values(row["rework_category"]))
        if "generic" in rework_categories and derived_title_place:
            year = str(row["captured_at"] or "")[:4]
            seed_title = " ".join(part for part in [year if year.isdigit() else "", derived_title_place] if part).strip()
        elif not seed_title and derived_title_place:
            year = str(row["captured_at"] or "")[:4]
            seed_title = " ".join(part for part in [year if year.isdigit() else "", derived_title_place] if part).strip()
        seed_keywords = _clean_keywords(
            _dedupe_text([*_read_json_text(row["metadata_seed_keywords_json"], []), *location_keywords]),
            keyword_blacklist,
        )
        decision_keywords = _read_json_text(row["keywords_json"], [])
        photos_title = _seedable_title(row["photos_title"])
        ai_context = _metadata_ai_context(
            row,
            raw_row if isinstance(raw_row, dict) else {},
            photos_title,
            photos_keywords,
            location_label,
            location_keywords,
            seed_title,
            seed_keywords,
        )
        items.append({
            "assetId": row["asset_id"],
            "sourceAnchor": row["source_anchor"],
            "filename": row["filename"] or "",
            "capturedAt": row["captured_at"] or "",
            "mediaType": row["media_type"] or "",
            "pixelWidth": int(row["pixel_width"] or 0),
            "pixelHeight": int(row["pixel_height"] or 0),
            "duration": float(row["duration"] or 0),
            "rating": int(row["rating"] or 0),
            "color": row["color"] or "",
            "metadataState": row["metadata_state"] or "unreviewed",
            "decisionTitle": row["title"] or "",
            "decisionKeywords": decision_keywords,
            "photosTitle": photos_title,
            "photosKeywords": photos_keywords,
            "locationLabel": location_label,
            "locationKeywords": location_keywords,
            "seedTitle": seed_title,
            "seedKeywords": seed_keywords,
            "titleSeeded": bool(seed_title or row["title"]),
            "keywordSeedCount": len(seed_keywords),
            "reworkCategory": row["rework_category"] or "",
            "reworkComment": row["rework_comment"] or "",
            "reason": _ai_metadata_reason(row, seed_keywords),
            "aiEvidence": ai_context["evidence"],
            "aiLimitations": ai_context["limitations"],
            "recommendedAiRung": ai_context["recommendedRung"],
            "recommendedAiRungLabel": ai_context["recommendedRungLabel"],
            "aiRungNote": ai_context["note"],
            "visionClassificationGuidance": _vision_classification_guidance_payload(),
            "locationKeywordGuidance": _location_keyword_guidance_payload(),
        })
    return {
        "ok": True,
        "mode": "picked-only-ai-metadata-plan",
        "scopedCount": len(scoped_asset_ids),
        "aiLadder": _metadata_ai_ladder_payload(),
        "visionClassificationGuidance": _vision_classification_guidance_payload(),
        "locationKeywordGuidance": _location_keyword_guidance_payload(),
        "count": len(items),
        "candidateCount": int(counts["candidate_count"] or 0),
        "pickedCount": int(counts["picked_count"] or 0),
        "unreviewedCount": int(counts["unreviewed_count"] or 0),
        "reworkCount": int(counts["rework_count"] or 0),
        "proposedCount": int(counts["proposed_count"] or 0),
        "approvedCount": int(counts["approved_count"] or 0),
        "blockedCount": int(counts["blocked_count"] or 0),
        "aiProposedCount": int(counts["ai_proposed_count"] or 0),
        "mockUploadedPickedCount": int(counts["mock_uploaded_count"] or 0),
        "items": items,
        "message": "Only picked, not-approved Sidecar items are eligible for this AI metadata planning lane.",
    }


def _useful_proposal_title(title: str, keywords: Iterable[Any] = ()) -> bool:
    value = str(title or "").strip()
    return bool(
        value
        and not re.fullmatch(r"\d{4}", value)
        and (_title_has_public_place_subject(value) or not _title_is_location_only(value, keywords))
    )


def apply_ai_metadata_proposals(
    repo_root: Path,
    limit: int = 20,
    max_rung: str = "filename-gps",
    asset_ids: Iterable[Any] | None = None,
) -> dict[str, Any]:
    """Promote safe picked-item plan seeds into Sidecar Review proposals.

    This deliberately does not enqueue Photos write-back. Proposed rows still need
    Review approval before they become upload/write-back candidates.
    """
    scoped_asset_ids = _normalize_asset_id_scope(asset_ids)
    safe_limit = max(1, min(int(limit or len(scoped_asset_ids) or 20), 500))
    safe_max_rung = str(max_rung or "filename-gps").strip()
    if safe_max_rung not in AI_METADATA_RUNG_ORDER:
        raise ValueError("max_rung is invalid")
    plan = ai_metadata_plan(repo_root, limit=safe_limit, asset_ids=scoped_asset_ids)
    now = now_iso()
    proposed: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    with connect(repo_root) as conn:
        keyword_blacklist = _keyword_blacklist_set(conn, repo_root)
        for item in plan["items"]:
            asset_id = str(item.get("assetId") or "").strip()
            if not asset_id:
                continue
            rework_categories = set(_rework_category_values(item.get("reworkCategory")))
            if "generic" in rework_categories:
                title = _seedable_title(item.get("seedTitle")) or _seedable_title(item.get("decisionTitle"))
            else:
                title = _seedable_title(item.get("decisionTitle")) or _seedable_title(item.get("seedTitle"))
            filename_title, filename_keywords = _filename_metadata_seed(
                item.get("filename"),
                item.get("capturedAt"),
                keyword_blacklist,
            )
            if (
                not _useful_proposal_title(title, item.get("decisionKeywords") or item.get("seedKeywords") or [])
                and _useful_proposal_title(item.get("decisionTitle"), item.get("decisionKeywords") or item.get("seedKeywords") or [])
            ):
                title = _seedable_title(item.get("decisionTitle"))
            if not _useful_proposal_title(title, item.get("decisionKeywords") or item.get("seedKeywords") or []):
                title = filename_title
            filename_ai_keywords = _filename_ai_generated_keywords(item.get("filename"), keyword_blacklist)
            keywords = _clean_keywords(
                _dedupe_text([
                    *(item.get("decisionKeywords") or []),
                    *(item.get("seedKeywords") or []),
                    *filename_keywords,
                    *filename_ai_keywords,
                ]),
                keyword_blacklist,
            )
            metadata_ai_evidence = _dedupe_text([
                *(item.get("aiEvidence") or []),
                *(["ai-generated-filename-marker"] if filename_ai_keywords else []),
            ])
            recommended_rung = str(item.get("recommendedAiRung") or "human-review")
            if _metadata_ai_rung_rank(recommended_rung) > _metadata_ai_rung_rank(safe_max_rung):
                skipped.append({
                    "assetId": asset_id,
                    "filename": str(item.get("filename") or ""),
                    "reason": "requires_stronger_ai_rung",
                    "recommendedAiRung": recommended_rung,
                })
                continue
            if not _useful_proposal_title(title, keywords):
                skipped.append({
                    "assetId": asset_id,
                    "filename": str(item.get("filename") or ""),
                    "reason": "missing_useful_title_seed",
                    "recommendedAiRung": recommended_rung,
                })
                continue
            if not keywords:
                skipped.append({
                    "assetId": asset_id,
                    "filename": str(item.get("filename") or ""),
                    "reason": "missing_keyword_seed",
                    "recommendedAiRung": recommended_rung,
                })
                continue
            result = conn.execute(
                """
                UPDATE sidecar_decisions
                SET metadata_state = 'proposed',
                    title = ?,
                    keywords_json = ?,
                    rework_category = '',
                    rework_comment = '',
                    metadata_ai_rung = ?,
                    metadata_ai_evidence_json = ?,
                    metadata_ai_note = ?,
                    last_action = 'ai-metadata-proposal',
                    updated_at = ?
                WHERE asset_id = ?
                  AND pick_state = 'picked'
                  AND metadata_state != 'approved'
                """,
                (
                    title,
                    _json_text(keywords),
                    recommended_rung,
                    _json_text(metadata_ai_evidence),
                    str(item.get("aiRungNote") or ""),
                    now,
                    asset_id,
                ),
            )
            if result.rowcount:
                proposed.append({
                    "assetId": asset_id,
                    "filename": str(item.get("filename") or ""),
                    "title": title,
                    "keywords": keywords,
                    "locationLabel": str(item.get("locationLabel") or ""),
                    "metadataAiRung": recommended_rung,
                    "metadataAiEvidence": metadata_ai_evidence,
                    "metadataAiNote": str(item.get("aiRungNote") or ""),
                })
    return {
        "ok": True,
        "mode": "picked-only-ai-metadata-proposals",
        "scopedCount": len(scoped_asset_ids),
        "maxRung": safe_max_rung,
        "aiLadder": _metadata_ai_ladder_payload(),
        "plannedCount": plan["count"],
        "candidateCountBefore": plan["candidateCount"],
        "proposedCount": len(proposed),
        "skippedCount": len(skipped),
        "proposed": proposed,
        "skipped": skipped,
        "message": "Wrote Sidecar Review proposals only; no Photos write-back rows were queued.",
    }


def sidecar_sync_status(repo_root: Path, limit: int = 80) -> dict[str, Any]:
    """Summarize the planned nightly Photos index, AI metadata, and write-back lanes."""
    safe_limit = max(1, min(int(limit or 80), 500))
    sidecar_summary = summary(repo_root)
    ai_plan = ai_metadata_plan(repo_root, limit=safe_limit)
    upload = upload_plan(repo_root, limit=safe_limit)
    write_back = commit_plan(repo_root, limit=safe_limit)
    return {
        "ok": True,
        "mode": "sidecar-sync-status",
        "index": {
            "indexedCount": sidecar_summary["indexedCount"],
            "missingIndexedCount": sidecar_summary["missingIndexedCount"],
            "lastIndexedAt": sidecar_summary["lastIndexedAt"],
        },
        "ai": {
            "pickedOnly": True,
            "candidateCount": ai_plan["candidateCount"],
            "visibleCount": ai_plan["count"],
            "unreviewedCount": ai_plan["unreviewedCount"],
            "reworkCount": ai_plan["reworkCount"],
            "proposedCount": ai_plan["proposedCount"],
            "approvedCount": ai_plan["approvedCount"],
            "blockedCount": ai_plan["blockedCount"],
            "items": ai_plan["items"],
        },
        "writeBack": {
            "pendingCount": sidecar_summary["pendingSyncCount"],
            "visibleCount": write_back["count"],
            "writeBackImplemented": write_back["writeBackImplemented"],
            "items": write_back["items"],
            "message": write_back["message"],
        },
        "upload": {
            "readyCount": upload["approvedPickedCount"],
            "visibleCount": upload["count"],
            "pickedCount": upload["pickedCount"],
            "needsReviewCount": upload["pickedNeedsReviewCount"],
            "mockUploadedCount": upload["mockUploadedCount"],
            "items": upload["items"],
        },
        "nightly": {
            "photosIndexRefresh": "planned-metadata-only",
            "aiMetadata": "planned-picked-only",
            "photosWriteBack": "explicit-commit-only",
        },
    }


def _planned_r2_keys(row: sqlite3.Row, *, include_private_renders: bool = False) -> tuple[str, list[dict[str, str]]]:
    source_anchor = str(row["source_anchor"] or f"apple-photos://{row['asset_id']}")
    photo_id = photo_id_for_source_path(source_anchor)
    filename = str(row["filename"] or "")
    media_type = str(row["media_type"] or "").casefold()
    is_video = media_type == "video" or Path(filename).suffix.lower() in {".mov", ".mp4", ".m4v"}
    source_reference = filename or (f"{photo_id}.mp4" if is_video else f"{photo_id}.jpg")
    keys = [
        {
            "bucket": DEFAULT_PRIVATE_BUCKET,
            "key": private_master_key(DEFAULT_PRIVATE_PREFIX, photo_id, source_reference),
            "kind": "private-master",
        },
        {
            "bucket": DEFAULT_PUBLIC_BUCKET,
            "key": public_preview_key(DEFAULT_PUBLIC_PREFIX, photo_id, "gallery", "video" if is_video else "photo"),
            "kind": "public-preview",
        },
        {
            "bucket": DEFAULT_PUBLIC_BUCKET,
            "key": public_preview_key(DEFAULT_PUBLIC_PREFIX, photo_id, "detail", "video" if is_video else "photo"),
            "kind": "public-preview-video" if is_video else "public-preview",
        },
    ]
    if include_private_renders and not is_video:
        keys.extend(
            {
                "bucket": DEFAULT_PRIVATE_BUCKET,
                "key": private_render_key(photo_id, product_id),
                "kind": "private-render",
            }
            for product_id in PRIVATE_RENDER_PRODUCTS
        )
    return photo_id, keys


def _current_r2_objects_for_plan(conn: sqlite3.Connection, planned_keys: list[dict[str, str]]) -> dict[tuple[str, str], dict[str, Any]]:
    if not planned_keys:
        return {}
    conditions = " OR ".join("(bucket = ? AND object_key = ?)" for _ in planned_keys)
    params: list[str] = []
    for item in planned_keys:
        params.extend([item["bucket"], item["key"]])
    try:
        rows = conn.execute(
            f"""
            SELECT bucket, object_key, photo_id, object_kind, lifecycle_state, bytes, last_seen_at
            FROM r2_objects
            WHERE lifecycle_state = 'current' AND ({conditions})
            """,
            params,
        ).fetchall()
    except sqlite3.OperationalError:
        return {}
    return {
        (str(row["bucket"] or ""), str(row["object_key"] or "")): {
            "photoId": str(row["photo_id"] or ""),
            "kind": str(row["object_kind"] or ""),
            "bytes": int(row["bytes"]) if row["bytes"] is not None else None,
            "lastSeenAt": str(row["last_seen_at"] or ""),
        }
        for row in rows
    }


def mock_upload(repo_root: Path, asset_ids: Iterable[str] | None = None, limit: int = 500) -> dict[str, Any]:
    safe_limit = max(1, min(int(limit or 500), 5000))
    requested_ids = [str(asset_id or "").strip() for asset_id in (asset_ids or []) if str(asset_id or "").strip()]
    now = now_iso()
    run_id = uuid.uuid4().hex
    with connect(repo_root) as conn:
        params: list[Any] = []
        asset_filter = ""
        if requested_ids:
            placeholders = ",".join("?" for _ in requested_ids)
            asset_filter = f"AND d.asset_id IN ({placeholders})"
            params.extend(requested_ids)
        params.append(safe_limit)
        rows = conn.execute(
            f"""
            SELECT a.asset_id, a.source_anchor, a.media_type, a.filename, a.captured_at
            FROM sidecar_decisions AS d
            JOIN sidecar_assets AS a ON a.asset_id = d.asset_id
            WHERE d.pick_state = 'picked' AND d.metadata_state = 'approved'
              {asset_filter}
              AND NOT EXISTS (
                SELECT 1 FROM sidecar_tombstones AS t
                WHERE t.asset_id = d.asset_id AND t.tombstone_state = 'active'
              )
              AND NOT EXISTS (
                SELECT 1 FROM sidecar_mock_uploads AS m
                WHERE m.asset_id = d.asset_id AND m.mock_state = 'active'
              )
            ORDER BY a.captured_at DESC, a.asset_id
            LIMIT ?
            """,
            params,
        ).fetchall()
        planned_key_sets: dict[str, list[dict[str, str]]] = {}
        photo_ids: dict[str, str] = {}
        all_planned_keys: list[dict[str, str]] = []
        for row in rows:
            photo_id, keys = _planned_r2_keys(row)
            photo_ids[str(row["asset_id"])] = photo_id
            planned_key_sets[str(row["asset_id"])] = keys
            all_planned_keys.extend(keys)
        current_r2 = _current_r2_objects_for_plan(conn, all_planned_keys)
        for row in rows:
            conn.execute(
                """
                INSERT INTO sidecar_mock_uploads (asset_id, mock_state, mock_run_id, uploaded_at, updated_at)
                VALUES (?, 'active', ?, ?, ?)
                ON CONFLICT(asset_id) DO UPDATE SET
                  mock_state = 'active',
                  mock_run_id = excluded.mock_run_id,
                  uploaded_at = excluded.uploaded_at,
                  updated_at = excluded.updated_at
                """,
                (row["asset_id"], run_id, now, now),
            )
    items = []
    collision_count = 0
    covered_key_count = 0
    for row in rows:
        asset_id = str(row["asset_id"])
        planned = []
        item_collision_count = 0
        for key in planned_key_sets.get(asset_id, []):
            current = current_r2.get((key["bucket"], key["key"]))
            exists = current is not None
            if exists:
                item_collision_count += 1
                covered_key_count += 1
            planned.append({
                **key,
                "exists": exists,
                **({"existing": current} if current else {}),
            })
        if item_collision_count:
            collision_count += 1
        items.append({
            "assetId": asset_id,
            "photoId": photo_ids.get(asset_id, ""),
            "filename": row["filename"] or "",
            "capturedAt": row["captured_at"] or "",
            "collisionCount": item_collision_count,
            "plannedKeys": planned,
        })
    return {
        "ok": True,
        "mockRunId": run_id,
        "bridgeRunId": run_id,
        "mockUploadedCount": len(rows),
        "bridgeQueuedCount": len(rows),
        "collisionCount": collision_count,
        "coveredKeyCount": covered_key_count,
        "items": items,
        "remainingPlan": upload_plan(repo_root, limit=safe_limit),
    }


def queue_upload_bridge(repo_root: Path, asset_ids: Iterable[str] | None = None, limit: int = 500) -> dict[str, Any]:
    """Queue upload-ready Sidecar items for the bridge using the legacy mock table."""
    result = mock_upload(repo_root, asset_ids=asset_ids, limit=limit)
    result["uploadBridgePlan"] = upload_bridge_plan(repo_root, limit=limit)
    return result


def commit_plan(repo_root: Path, limit: int = 500) -> dict[str, Any]:
    safe_limit = max(1, min(int(limit or 500), 5000))
    with connect(repo_root) as conn:
        rows = conn.execute(
            """
            SELECT p.*, a.filename, a.captured_at
            FROM sidecar_pending_sync AS p
            LEFT JOIN sidecar_assets AS a ON a.asset_id = p.asset_id
            WHERE p.status = 'pending'
            ORDER BY p.created_at, p.sync_id
            LIMIT ?
            """,
            (safe_limit,),
        ).fetchall()
    items = []
    for row in rows:
        items.append({
            "syncId": row["sync_id"],
            "assetId": row["asset_id"],
            "fieldFamily": row["field_family"],
            "oldValue": _read_json_text(row["old_value_json"], {}),
            "newValue": _read_json_text(row["new_value_json"], {}),
            "filename": row["filename"] or "",
            "capturedAt": row["captured_at"] or "",
            "status": row["status"],
            "createdAt": row["created_at"] or "",
            "updatedAt": row["updated_at"] or "",
        })
    return {
        "ok": True,
        "count": len(items),
        "items": items,
        "writeBackImplemented": False,
        "message": "Sidecar write-back is staged. The next implementation slice will commit these pending PBE keywords/title changes to Apple Photos.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect Sidecar local workflow state.")
    parser.add_argument("--summary", action="store_true")
    parser.add_argument("--upload-plan", action="store_true")
    parser.add_argument("--upload-bridge-plan", action="store_true")
    parser.add_argument("--ai-plan", action="store_true")
    parser.add_argument("--sync-status", action="store_true")
    parser.add_argument("--mock-upload", action="store_true")
    parser.add_argument("--queue-upload-bridge", action="store_true")
    parser.add_argument("--commit-plan", action="store_true")
    parser.add_argument("--empty-wastebasket", action="store_true")
    args = parser.parse_args()
    repo_root = Path.cwd()
    if args.empty_wastebasket:
        print(json.dumps(empty_wastebasket(repo_root), indent=2))
    elif args.queue_upload_bridge:
        print(json.dumps(queue_upload_bridge(repo_root), indent=2))
    elif args.mock_upload:
        print(json.dumps(mock_upload(repo_root), indent=2))
    elif args.upload_bridge_plan:
        print(json.dumps(upload_bridge_plan(repo_root), indent=2))
    elif args.upload_plan:
        print(json.dumps(upload_plan(repo_root), indent=2))
    elif args.ai_plan:
        print(json.dumps(ai_metadata_plan(repo_root), indent=2))
    elif args.sync_status:
        print(json.dumps(sidecar_sync_status(repo_root), indent=2))
    elif args.commit_plan:
        print(json.dumps(commit_plan(repo_root), indent=2))
    else:
        print(json.dumps(summary(repo_root), indent=2))


if __name__ == "__main__":
    main()
