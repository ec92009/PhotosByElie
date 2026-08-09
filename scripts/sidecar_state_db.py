#!/usr/bin/env python3
"""Local Sidecar workflow state stored inside the Owner SQLite database."""

from __future__ import annotations

from contextlib import nullcontext
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
import hashlib
import json
import mimetypes
import os
import re
import sqlite3
import subprocess
import threading
import time
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
DEFAULT_UPLOAD_BRIDGE_RUN_ROOT = Path("assets/owner-actions/sidecar-upload-runs")
APPLE_PHOTOS_BRIDGE_APP = Path.home() / "Applications" / "PhotosByElie Photos Bridge.app"
PRIVATE_RENDER_PRODUCTS = ("jpg-6mp", "jpg-3mp", "jpg-1mp")
RATING_VALUES = {0, 1, 2, 3, 4, 5}
COLOR_VALUES = {"", "red", "yellow", "green", "blue", "purple"}
PICK_STATES = {"undecided", "picked", "rejected", "hidden"}
METADATA_STATES = {"unreviewed", "proposed", "approved", "rework", "blocked"}
REWORK_CATEGORIES = {"", "incorrect", "generic", "placeholder", "keywords", "detail", "shoot", "other"}
INTERNAL_TITLE_MARKERS = {"dontexport", "don't export", "do not export", "notmyphoto", "not my photo"}
GENERIC_UPLOAD_TITLES = {"", "2025", "2026", "whatsapp", "img", "dji album", "untitled", "video", "photo"}
_SCHEMA_READY: set[tuple[str, int, int]] = set()
_SCHEMA_LOCK = threading.Lock()
UPLOAD_BRIDGE_GALLERY_TERMS = {
    "italy": ("italy", "florence", "tuscany"),
    "france": ("france", "paris", "toulouse"),
    "spain": (
        "spain",
        "malaga",
        "málaga",
        "andalusia",
        "andalucía",
        "benalmadena",
        "benalmádena",
        "fuengirola",
        "nerja",
        "ronda",
        "mijas",
        "marbella",
        "cordoba",
        "córdoba",
        "granada",
        "la concha",
        "colleccion del museo ruso",
        "colección del museo ruso",
    ),
    "portugal": ("portugal", "lisbon", "lisboa"),
    "usa": ("usa", "united states"),
    "mexico": ("mexico",),
    "slovakia": ("slovakia",),
    "ai": ("ai generated", "generative ai", "stained glass"),
}
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


def editorial_version_hash(conn: sqlite3.Connection, asset_id: str) -> str:
    """Bind an upload or receipt to the asset's exact editorial state."""
    row = conn.execute(
        """
        SELECT a.asset_id, a.source_anchor, a.modified_at, COALESCE(d.rating, 0) rating,
               COALESCE(d.color, '') color, COALESCE(d.pick_state, 'undecided') pick_state,
               COALESCE(d.metadata_state, 'unreviewed') metadata_state,
               COALESCE(d.title, '') title, COALESCE(d.caption, '') caption,
               COALESCE(d.keywords_json, '[]') keywords_json
        FROM sidecar_assets a LEFT JOIN sidecar_decisions d ON d.asset_id = a.asset_id
        WHERE a.asset_id = ?
        """,
        (asset_id,),
    ).fetchone()
    if not row:
        raise ValueError("asset is not indexed")
    return hashlib.sha256(_json_text(dict(row)).encode("utf-8")).hexdigest()


def _read_json_text(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


class _ClosingConnection(sqlite3.Connection):
    """Commit or roll back a context-managed connection, then close it."""

    def __exit__(self, exc_type: object, exc_value: object, traceback: object) -> bool:
        try:
            return bool(super().__exit__(exc_type, exc_value, traceback))
        finally:
            self.close()


def connect(repo_root: Path, db_path: Path | None = None) -> sqlite3.Connection:
    path = db_path or DEFAULT_DB
    if not path.is_absolute():
        path = repo_root / path
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=15, factory=_ClosingConnection)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 15000")
    conn.execute("PRAGMA foreign_keys = ON")
    stat = path.stat()
    schema_key = (str(path.resolve()), int(stat.st_dev), int(stat.st_ino))
    with _SCHEMA_LOCK:
        if schema_key not in _SCHEMA_READY:
            try:
                ensure_schema(conn)
                conn.commit()
            except Exception:
                conn.close()
                raise
            _SCHEMA_READY.add(schema_key)
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
          caption        TEXT,
          keywords_json  TEXT NOT NULL DEFAULT '[]',
          rework_category TEXT NOT NULL DEFAULT '',
          rework_comment TEXT,
          metadata_ai_rung TEXT,
          metadata_ai_evidence_json TEXT NOT NULL DEFAULT '[]',
          metadata_ai_note TEXT,
          metadata_ai_attempt_count INTEGER NOT NULL DEFAULT 0,
          metadata_ai_last_error TEXT NOT NULL DEFAULT '',
          metadata_ai_last_attempt_at TEXT NOT NULL DEFAULT '',
          last_action    TEXT,
          created_at     TEXT,
          updated_at     TEXT,
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id) ON DELETE CASCADE
        ) WITHOUT ROWID;

        CREATE INDEX IF NOT EXISTS idx_sidecar_decisions_pick ON sidecar_decisions(pick_state, metadata_state, updated_at);
        CREATE INDEX IF NOT EXISTS idx_sidecar_decisions_pick_asset ON sidecar_decisions(pick_state, asset_id);
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

        CREATE TABLE IF NOT EXISTS sidecar_upload_bridge_runs (
          run_id         TEXT PRIMARY KEY CHECK (trim(run_id) <> ''),
          mode           TEXT NOT NULL DEFAULT 'export-dry-run' CHECK (trim(mode) <> ''),
          status         TEXT NOT NULL DEFAULT 'planned' CHECK (trim(status) <> ''),
          execute_upload INTEGER NOT NULL DEFAULT 0 CHECK (execute_upload IN (0, 1)),
          limit_count    INTEGER NOT NULL DEFAULT 1,
          started_at     TEXT,
          completed_at   TEXT,
          error_text     TEXT,
          spool_root     TEXT,
          summary_json   TEXT NOT NULL DEFAULT '{}',
          created_at     TEXT,
          updated_at     TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_sidecar_upload_bridge_runs_status
          ON sidecar_upload_bridge_runs(status, created_at);

        CREATE TABLE IF NOT EXISTS sidecar_upload_bridge_run_items (
          run_item_id       TEXT PRIMARY KEY CHECK (trim(run_item_id) <> ''),
          run_id            TEXT NOT NULL CHECK (trim(run_id) <> ''),
          asset_id          TEXT NOT NULL CHECK (trim(asset_id) <> ''),
          photo_id          TEXT NOT NULL CHECK (trim(photo_id) <> ''),
          filename          TEXT,
          media_type        TEXT,
          queued_at         TEXT,
          status            TEXT NOT NULL DEFAULT 'planned' CHECK (trim(status) <> ''),
          export_status     TEXT NOT NULL DEFAULT 'planned' CHECK (trim(export_status) <> ''),
          export_path       TEXT,
          export_bytes      INTEGER,
          planned_keys_json TEXT NOT NULL DEFAULT '[]',
          upload_status     TEXT NOT NULL DEFAULT 'not_requested' CHECK (trim(upload_status) <> ''),
          upload_keys_json  TEXT NOT NULL DEFAULT '[]',
          upload_error_text TEXT,
          editorial_version_hash TEXT NOT NULL DEFAULT '',
          error_text        TEXT,
          created_at        TEXT,
          updated_at        TEXT,
          FOREIGN KEY (run_id) REFERENCES sidecar_upload_bridge_runs(run_id) ON DELETE CASCADE,
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_sidecar_upload_bridge_run_items_run
          ON sidecar_upload_bridge_run_items(run_id, status);
        CREATE INDEX IF NOT EXISTS idx_sidecar_upload_bridge_run_items_asset
          ON sidecar_upload_bridge_run_items(asset_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_sidecar_upload_bridge_run_items_updated
          ON sidecar_upload_bridge_run_items(updated_at DESC);

        CREATE TABLE IF NOT EXISTS sidecar_upload_bridge_asset_blocks (
          asset_id        TEXT PRIMARY KEY CHECK (trim(asset_id) <> ''),
          block_state     TEXT NOT NULL DEFAULT 'active' CHECK (block_state IN ('active', 'cleared')),
          block_reason    TEXT NOT NULL DEFAULT 'export_failed' CHECK (trim(block_reason) <> ''),
          failure_count   INTEGER NOT NULL DEFAULT 0,
          last_status     TEXT NOT NULL DEFAULT '',
          last_error      TEXT,
          first_failed_at TEXT,
          last_failed_at  TEXT,
          cleared_at      TEXT,
          updated_at      TEXT,
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id) ON DELETE CASCADE
        ) WITHOUT ROWID;

        CREATE INDEX IF NOT EXISTS idx_sidecar_upload_bridge_asset_blocks_state
          ON sidecar_upload_bridge_asset_blocks(block_state, last_failed_at);
        """
    )
    conn.execute(
        """
        INSERT OR IGNORE INTO sidecar_upload_bridge_asset_blocks
          (asset_id, block_state, block_reason, failure_count, last_status, last_error,
           first_failed_at, last_failed_at, cleared_at, updated_at)
        SELECT
          failures.asset_id,
          'active',
          'export_failed',
          failures.failure_count,
          COALESCE(latest.export_status, latest.status, 'export_failed'),
          latest.error_text,
          failures.first_failed_at,
          failures.last_failed_at,
          NULL,
          COALESCE(failures.last_failed_at, ?)
        FROM (
          SELECT
            asset_id,
            COUNT(*) AS failure_count,
            MIN(updated_at) AS first_failed_at,
            MAX(updated_at) AS last_failed_at
          FROM sidecar_upload_bridge_run_items
          WHERE status = 'export_failed'
          GROUP BY asset_id
        ) AS failures
        JOIN sidecar_upload_bridge_run_items AS latest
          ON latest.asset_id = failures.asset_id
         AND latest.updated_at = failures.last_failed_at
        WHERE NOT EXISTS (
          SELECT 1
          FROM sidecar_upload_bridge_run_items AS success
          WHERE success.asset_id = failures.asset_id
            AND success.status IN ('exported', 'uploaded', 'uploaded_with_skips')
            AND COALESCE(success.updated_at, '') > COALESCE(failures.last_failed_at, '')
        )
        """,
        (now_iso(),),
    )
    decision_columns = {
        str(row["name"])
        for row in conn.execute("PRAGMA table_info(sidecar_decisions)").fetchall()
    }
    if "rework_category" not in decision_columns:
        conn.execute("ALTER TABLE sidecar_decisions ADD COLUMN rework_category TEXT NOT NULL DEFAULT ''")
    if "caption" not in decision_columns:
        conn.execute("ALTER TABLE sidecar_decisions ADD COLUMN caption TEXT")
    if "rework_comment" not in decision_columns:
        conn.execute("ALTER TABLE sidecar_decisions ADD COLUMN rework_comment TEXT")
    if "metadata_ai_rung" not in decision_columns:
        conn.execute("ALTER TABLE sidecar_decisions ADD COLUMN metadata_ai_rung TEXT")
    if "metadata_ai_evidence_json" not in decision_columns:
        conn.execute("ALTER TABLE sidecar_decisions ADD COLUMN metadata_ai_evidence_json TEXT NOT NULL DEFAULT '[]'")
    if "metadata_ai_note" not in decision_columns:
        conn.execute("ALTER TABLE sidecar_decisions ADD COLUMN metadata_ai_note TEXT")
    if "metadata_ai_attempt_count" not in decision_columns:
        conn.execute("ALTER TABLE sidecar_decisions ADD COLUMN metadata_ai_attempt_count INTEGER NOT NULL DEFAULT 0")
    if "metadata_ai_last_error" not in decision_columns:
        conn.execute("ALTER TABLE sidecar_decisions ADD COLUMN metadata_ai_last_error TEXT NOT NULL DEFAULT ''")
    if "metadata_ai_last_attempt_at" not in decision_columns:
        conn.execute("ALTER TABLE sidecar_decisions ADD COLUMN metadata_ai_last_attempt_at TEXT NOT NULL DEFAULT ''")
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
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_sidecar_assets_active_id
        ON sidecar_assets(asset_id)
        WHERE missing_at IS NULL OR missing_at = ''
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_sidecar_assets_active_captured
        ON sidecar_assets(captured_at DESC, asset_id)
        WHERE missing_at IS NULL OR missing_at = ''
        """
    )
    upload_item_columns = {
        str(row["name"])
        for row in conn.execute("PRAGMA table_info(sidecar_upload_bridge_run_items)").fetchall()
    }
    upload_item_column_defaults = {
        "upload_status": "TEXT NOT NULL DEFAULT 'not_requested'",
        "upload_keys_json": "TEXT NOT NULL DEFAULT '[]'",
        "upload_error_text": "TEXT",
        "timings_json": "TEXT NOT NULL DEFAULT '{}'",
        "editorial_version_hash": "TEXT NOT NULL DEFAULT ''",
    }
    for column, definition in upload_item_column_defaults.items():
        if column not in upload_item_columns:
            conn.execute(f"ALTER TABLE sidecar_upload_bridge_run_items ADD COLUMN {column} {definition}")


def _asset_id(row: dict[str, Any]) -> str:
    return str(row.get("assetId") or row.get("cloudIdentifier") or row.get("asset_id") or row.get("localIdentifier") or "").strip()


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
    asset_ids: Iterable[Any] | None = None,
    include_summary: bool = True,
) -> dict[str, Any]:
    """Return a Sidecar window from the local metadata index."""
    safe_offset = max(0, int(offset or 0))
    safe_limit = max(1, min(int(limit or 120), 5000))
    start, end = _date_window_bounds(date_from, date_to)
    predicates = ["(a.missing_at IS NULL OR a.missing_at = '')"]
    params: list[Any] = []
    scoped_asset_ids = _dedupe_text(str(value or "").strip() for value in (asset_ids or []))
    if scoped_asset_ids:
        predicates.append(f"a.asset_id IN ({', '.join('?' for _ in scoped_asset_ids)})")
        params.extend(scoped_asset_ids)
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
    if clean_ratings and set(clean_ratings) != RATING_VALUES:
        filter_predicates.append(f"COALESCE(d.rating, 0) IN ({', '.join('?' for _ in clean_ratings)})")
        filter_params.extend(clean_ratings)
    clean_colors = []
    for value in colors or []:
        color = str(value or "").strip()
        if color == "none":
            color = ""
        if color in COLOR_VALUES and color not in clean_colors:
            clean_colors.append(color)
    if clean_colors and set(clean_colors) != COLOR_VALUES:
        filter_predicates.append(f"COALESCE(d.color, '') IN ({', '.join('?' for _ in clean_colors)})")
        filter_params.extend(clean_colors)
    clean_media_types = []
    for value in media_types or []:
        media_type = str(value or "").strip()
        if media_type in {"photo", "video"} and media_type not in clean_media_types:
            clean_media_types.append(media_type)
    if clean_media_types and set(clean_media_types) != {"photo", "video"}:
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
        "d.title",
        "d.keywords_json",
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
        pick_predicates.append("COALESCE(d.pick_state, 'undecided') = 'picked'")
    if "undecided" in clean_pick_states:
        pick_predicates.append("COALESCE(d.pick_state, 'undecided') = 'undecided'")
    if "rejected" in clean_pick_states:
        pick_predicates.append("COALESCE(d.pick_state, 'undecided') IN ('rejected', 'hidden')")
    if pick_predicates:
        filter_predicates.append(f"({' OR '.join(pick_predicates)})")
    filter_sql = " AND ".join(filter_predicates)
    if clean_pick_states == {"picked"}:
        source_sql = """
            sidecar_decisions AS d INDEXED BY idx_sidecar_decisions_pick_asset
            JOIN sidecar_assets AS a ON a.asset_id = d.asset_id
        """
    else:
        source_sql = """
            sidecar_assets AS a INDEXED BY idx_sidecar_assets_active_id
            LEFT JOIN sidecar_decisions AS d ON d.asset_id = a.asset_id
        """
    with connect(repo_root) as conn:
        indexed_count = _active_asset_count(conn)
        filtered_count = conn.execute(
            f"""
            SELECT count(*) AS total
            FROM {source_sql}
            WHERE {where_sql} AND {filter_sql}
            """,
            [*params, *filter_params],
        ).fetchone()["total"]
        rows = conn.execute(
            f"""
            SELECT a.*
            FROM {source_sql}
            WHERE {where_sql} AND {filter_sql}
            ORDER BY a.captured_at DESC, a.asset_id
            LIMIT ? OFFSET ?
            """,
            [*params, *filter_params, safe_limit, safe_offset],
        ).fetchall()
        next_offset = safe_offset + len(rows)
    items = merge_state(repo_root, [_indexed_asset_row(row) for row in rows])
    payload = {
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
        "scopeAssetCount": len(scoped_asset_ids),
        "items": items,
    }
    if include_summary:
        payload["sidecarSummary"] = summary(repo_root)
    return payload


def _decision_payload(row: sqlite3.Row | None) -> dict[str, Any]:
    if row is None:
        return {
            "rating": 0,
            "color": "",
            "pickState": "undecided",
            "metadataState": "unreviewed",
            "title": "",
            "caption": "",
            "keywords": [],
            "reworkCategory": "",
            "reworkComment": "",
            "metadataAiRung": "",
            "metadataAiEvidence": [],
            "metadataAiNote": "",
            "metadataAiAttemptCount": 0,
            "metadataAiLastError": "",
            "metadataAiLastAttemptAt": "",
            "lastAction": "",
            "updatedAt": "",
        }
    return {
        "rating": int(row["rating"] or 0),
        "color": row["color"] or "",
        "pickState": row["pick_state"] or "undecided",
        "metadataState": row["metadata_state"] or "unreviewed",
        "title": row["title"] or "",
        "caption": row["caption"] or "",
        "keywords": _read_json_text(row["keywords_json"], []),
        "reworkCategory": row["rework_category"] or "",
        "reworkComment": row["rework_comment"] or "",
        "metadataAiRung": row["metadata_ai_rung"] or "",
        "metadataAiEvidence": _read_json_text(row["metadata_ai_evidence_json"], []),
        "metadataAiNote": row["metadata_ai_note"] or "",
        "metadataAiAttemptCount": max(0, int(row["metadata_ai_attempt_count"] or 0)),
        "metadataAiLastError": row["metadata_ai_last_error"] or "",
        "metadataAiLastAttemptAt": row["metadata_ai_last_attempt_at"] or "",
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


def _cloud_decision_state(payload: dict[str, Any]) -> dict[str, Any]:
    state = payload.get("state") if isinstance(payload.get("state"), dict) else payload
    asset_id = str(payload.get("assetId") or payload.get("asset_id") or state.get("assetId") or state.get("asset_id") or "").strip()
    if not asset_id:
        raise ValueError("Cloud Sidecar decision is missing assetId.")
    return {
        "assetId": asset_id,
        "rating": max(0, min(5, int(state.get("rating") or 0))),
        "color": str(state.get("color") or "").strip().casefold(),
        "pickState": str(state.get("pickState") or state.get("pick_state") or "undecided").strip().casefold(),
        "metadataState": str(state.get("metadataState") or state.get("metadata_state") or "unreviewed").strip().casefold(),
        "title": str(state.get("title") or "").strip(),
        "keywords": _clean_keywords(state.get("keywords") or _read_json_text(state.get("keywords_json"), []), set()),
        "reworkCategory": str(state.get("reworkCategory") or state.get("rework_category") or "").strip(),
        "reworkComment": str(state.get("reworkComment") or state.get("rework_comment") or "").strip(),
        "metadataAiRung": str(state.get("metadataAiRung") or state.get("metadata_ai_rung") or "").strip(),
        "metadataAiEvidence": _clean_keywords(
            state.get("metadataAiEvidence") or state.get("metadata_ai_evidence") or _read_json_text(state.get("metadata_ai_evidence_json"), []),
            set(),
        ),
        "metadataAiNote": str(state.get("metadataAiNote") or state.get("metadata_ai_note") or "").strip(),
        "metadataAiAttemptCount": max(0, int(state.get("metadataAiAttemptCount") or state.get("metadata_ai_attempt_count") or 0)),
        "metadataAiLastError": str(state.get("metadataAiLastError") or state.get("metadata_ai_last_error") or "").strip(),
        "metadataAiLastAttemptAt": str(state.get("metadataAiLastAttemptAt") or state.get("metadata_ai_last_attempt_at") or "").strip(),
        "lastAction": str(state.get("lastAction") or state.get("last_action") or "").strip(),
        "updatedAt": str(state.get("updatedAt") or state.get("updated_at") or now_iso()).strip(),
        "tombstoneState": str(state.get("tombstoneState") or state.get("tombstone_state") or "").strip().casefold(),
        "tombstoneReason": str(state.get("tombstoneReason") or state.get("tombstone_reason") or "").strip(),
        "tombstonedAt": str(state.get("tombstonedAt") or state.get("tombstoned_at") or "").strip(),
        "pendingSyncCount": max(0, int(state.get("pendingSyncCount") or state.get("pending_sync_count") or 0)),
    }


def mirror_cloud_decisions(repo_root: Path, decisions: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Mirror cloud-canonical Sidecar decisions into the local cache tables.

    The local SQLite remains useful for filtering, upload planning, and bridge
    staging, but these rows are no longer treated as an independent source of
    truth when the cloud Owner layer is available.
    """
    mirrored = 0
    skipped = 0
    with connect(repo_root) as conn:
        for payload in decisions:
            if not isinstance(payload, dict):
                continue
            state = _cloud_decision_state(payload)
            asset_id = state["assetId"]
            updated_at = state["updatedAt"] or now_iso()
            asset_row = conn.execute(
                """
                SELECT 1
                FROM sidecar_assets
                WHERE asset_id = ?
                  AND (missing_at IS NULL OR missing_at = '')
                """,
                (asset_id,),
            ).fetchone()
            if not asset_row:
                skipped += 1
                continue
            if state["color"] not in COLOR_VALUES:
                state["color"] = ""
            if state["pickState"] not in PICK_STATES:
                state["pickState"] = "undecided"
            if state["metadataState"] not in METADATA_STATES:
                state["metadataState"] = "unreviewed"
            conn.execute(
                """
                INSERT INTO sidecar_decisions (
                  asset_id, rating, color, pick_state, metadata_state,
                  title, keywords_json, rework_category, rework_comment,
                  metadata_ai_rung, metadata_ai_evidence_json, metadata_ai_note,
                  metadata_ai_attempt_count, metadata_ai_last_error, metadata_ai_last_attempt_at,
                  last_action, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(asset_id) DO UPDATE SET
                  rating = excluded.rating,
                  color = excluded.color,
                  pick_state = excluded.pick_state,
                  metadata_state = excluded.metadata_state,
                  title = excluded.title,
                  keywords_json = excluded.keywords_json,
                  rework_category = excluded.rework_category,
                  rework_comment = excluded.rework_comment,
                  metadata_ai_rung = excluded.metadata_ai_rung,
                  metadata_ai_evidence_json = excluded.metadata_ai_evidence_json,
                  metadata_ai_note = excluded.metadata_ai_note,
                  metadata_ai_attempt_count = excluded.metadata_ai_attempt_count,
                  metadata_ai_last_error = excluded.metadata_ai_last_error,
                  metadata_ai_last_attempt_at = excluded.metadata_ai_last_attempt_at,
                  last_action = excluded.last_action,
                  updated_at = excluded.updated_at
                """,
                (
                    asset_id,
                    state["rating"],
                    state["color"],
                    state["pickState"],
                    state["metadataState"],
                    state["title"],
                    _json_text(state["keywords"]),
                    state["reworkCategory"],
                    state["reworkComment"],
                    state["metadataAiRung"],
                    _json_text(state["metadataAiEvidence"]),
                    state["metadataAiNote"],
                    state["metadataAiAttemptCount"],
                    state["metadataAiLastError"],
                    state["metadataAiLastAttemptAt"],
                    state["lastAction"],
                    updated_at,
                    updated_at,
                ),
            )
            if state["tombstoneState"] == "active":
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
                    (asset_id, state["tombstoneReason"], state["tombstonedAt"] or updated_at, updated_at),
                )
            elif state["tombstoneState"] in {"", "restored"}:
                conn.execute(
                    """
                    UPDATE sidecar_tombstones
                    SET tombstone_state = 'restored', updated_at = ?
                    WHERE asset_id = ? AND tombstone_state = 'active'
                    """,
                    (updated_at, asset_id),
                )
            mirrored += 1
    return {"ok": True, "mirroredCount": mirrored, "skippedCount": skipped}


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
    fallback_caption: str,
    fallback_keywords: list[str],
    keyword_blacklist: set[str],
) -> tuple[str, str, list[str]]:
    title = fallback_title
    caption = fallback_caption
    keywords = _clean_keywords(fallback_keywords, keyword_blacklist)
    if "title" in payload:
        title = str(payload.get("title") or "").strip()
    if "caption" in payload:
        caption = str(payload.get("caption") or "").strip()
    if "keywords" in payload:
        keywords = _clean_keywords(payload.get("keywords") or [], keyword_blacklist)
    return title, caption, keywords


def record_decision(
    repo_root: Path,
    payload: dict[str, Any],
    *,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    asset_id = str(payload.get("assetId") or payload.get("asset_id") or payload.get("localIdentifier") or "").strip()
    if not asset_id:
        raise ValueError("assetId is required")
    action = str(payload.get("action") or payload.get("decision") or "").strip().casefold()
    if action == "tombstone":
        legacy_migration = payload.get("legacyMigration")
        audited_legacy_path = (
            isinstance(legacy_migration, dict)
            and legacy_migration.get("kind") == "PBB-78-legacy-expo-hidden"
            and str(legacy_migration.get("auditReceipt") or "").strip()
            and str(legacy_migration.get("planDigest") or "").strip()
        )
        if not audited_legacy_path:
            raise ValueError("Direct global tombstone writes are disabled; use the Waste Basket gateway.")
    now = now_iso()
    connection_context = nullcontext(conn) if conn is not None else connect(repo_root)
    with connection_context as conn:
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
        caption = before["caption"]
        keywords = before["keywords"]
        rework_category = before["reworkCategory"]
        rework_comment = before["reworkComment"]
        metadata_ai_rung = before["metadataAiRung"]
        metadata_ai_evidence = before["metadataAiEvidence"]
        metadata_ai_note = before["metadataAiNote"]
        metadata_ai_attempt_count = before["metadataAiAttemptCount"]
        metadata_ai_last_error = before["metadataAiLastError"]
        metadata_ai_last_attempt_at = before["metadataAiLastAttemptAt"]
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
            metadata_ai_attempt_count = 0
            metadata_ai_last_error = ""
            metadata_ai_last_attempt_at = ""
            changed_families.update({"metadata", "pick_state", "tombstone"})
        elif action == "approve":
            pick_state = "picked"
            metadata_state = "approved"
            title, caption, keywords = _metadata_values_from_payload(payload, title, caption, keywords, keyword_blacklist)
            rework_category = ""
            rework_comment = ""
            metadata_ai_rung = str(payload.get("metadataAiRung") or payload.get("metadata_ai_rung") or metadata_ai_rung or "").strip()
            metadata_ai_evidence = _clean_keywords(
                payload.get("metadataAiEvidence") or payload.get("metadata_ai_evidence") or metadata_ai_evidence,
                set(),
            )
            metadata_ai_note = str(payload.get("metadataAiNote") or payload.get("metadata_ai_note") or metadata_ai_note or "").strip()
            metadata_ai_attempt_count = 0
            metadata_ai_last_error = ""
            metadata_ai_last_attempt_at = ""
            changed_families.update({"pick_state", "metadata"})
        elif action == "metadata":
            title, caption, keywords = _metadata_values_from_payload(payload, title, caption, keywords, keyword_blacklist)
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
            metadata_ai_attempt_count = 0
            metadata_ai_last_error = ""
            metadata_ai_last_attempt_at = ""
            changed_families.add("metadata")
        elif action == "metadata-rework":
            metadata_state = "rework"
            title, caption, keywords = _metadata_values_from_payload(payload, title, caption, keywords, keyword_blacklist)
            rework_category = _normalize_rework_category(payload.get("reworkCategory") or payload.get("rework_category"))
            rework_comment = str(payload.get("reworkComment") or payload.get("rework_comment") or "").strip()
            if rework_comment and not rework_category:
                rework_category = "other"
            metadata_ai_rung = ""
            metadata_ai_evidence = []
            metadata_ai_note = ""
            metadata_ai_attempt_count = 0
            metadata_ai_last_error = ""
            metadata_ai_last_attempt_at = ""
            changed_families.add("metadata")
        else:
            raise ValueError("Unsupported Sidecar action")

        if pick_state not in PICK_STATES:
            raise ValueError("pickState is invalid")
        conn.execute(
            """
            UPDATE sidecar_decisions
            SET rating = ?, color = ?, pick_state = ?, metadata_state = ?,
                title = ?, caption = ?, keywords_json = ?, rework_category = ?, rework_comment = ?,
                metadata_ai_rung = ?, metadata_ai_evidence_json = ?, metadata_ai_note = ?,
                metadata_ai_attempt_count = ?, metadata_ai_last_error = ?, metadata_ai_last_attempt_at = ?,
                last_action = ?, updated_at = ?
            WHERE asset_id = ?
            """,
            (
                rating,
                color,
                pick_state,
                metadata_state,
                title,
                caption,
                _json_text(keywords),
                rework_category,
                rework_comment,
                metadata_ai_rung,
                _json_text(metadata_ai_evidence),
                metadata_ai_note,
                metadata_ai_attempt_count,
                metadata_ai_last_error,
                metadata_ai_last_attempt_at,
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
    with connect(repo_root) as conn:
        for payload in payloads:
            if not isinstance(payload, dict):
                raise ValueError("Each Sidecar decision must be a JSON object.")
            items.append(record_decision(repo_root, payload, conn=conn))
    return {"ok": True, "count": len(items), "items": items}


def summary(repo_root: Path) -> dict[str, Any]:
    with connect(repo_root) as conn:
        rows = conn.execute(
            """
            SELECT d.pick_state, d.metadata_state, count(*) AS total
            FROM sidecar_assets AS a INDEXED BY idx_sidecar_assets_active_id
            JOIN sidecar_decisions AS d ON d.asset_id = a.asset_id
            WHERE a.missing_at IS NULL OR a.missing_at = ''
            GROUP BY d.pick_state, d.metadata_state
            """
        ).fetchall()
        pending_count = conn.execute(
            """
            SELECT count(*) AS total
            FROM sidecar_pending_sync AS p
            JOIN sidecar_assets AS a ON a.asset_id = p.asset_id
            WHERE p.status = 'pending'
              AND (a.missing_at IS NULL OR a.missing_at = '')
            """
        ).fetchone()["total"]
        total_assets = conn.execute("SELECT count(*) AS total FROM sidecar_assets").fetchone()["total"]
        missing_count = _missing_asset_count(conn)
        indexed_count = max(0, int(total_assets or 0) - missing_count)
        last_indexed_at = _last_active_indexed_at(conn)
        tombstone_count = conn.execute(
            """
            SELECT count(*) AS total
            FROM sidecar_tombstones AS t
            JOIN sidecar_assets AS a ON a.asset_id = t.asset_id
            WHERE t.tombstone_state = 'active'
              AND (a.missing_at IS NULL OR a.missing_at = '')
            """
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

def empty_wastebasket(
    repo_root: Path,
    *,
    confirmed: bool = False,
    confirmation_token: str = "",
    actor: str = "legacy-sidecar",
    request_key: str | None = None,
) -> dict[str, Any]:
    """Compatibility wrapper; direct Sidecar empty is no longer a writer.

    The retired Sidecar route remains callable only as an explicit, audited
    compatibility surface.  It cannot promote ``hidden``/``rejected`` rows
    to tombstones without the same confirmation gate as Backstage.
    """
    from waste_basket_gateway import empty_waste_basket

    return empty_waste_basket(
        repo_root,
        (),
        confirmed=confirmed,
        confirmation_token=confirmation_token,
        source="backstage-waste-basket",
        actor=actor,
        request_key=request_key,
    )


def _fixture_authorized_upload_asset_ids(
    conn: sqlite3.Connection,
    asset_ids: Iterable[str] | None,
) -> set[str]:
    """Verify explicit native-publication assets against fixture/editorial truth."""
    requested = {
        str(asset_id).strip()
        for asset_id in (asset_ids or ())
        if str(asset_id).strip()
    }
    conn.execute(
        """
        CREATE TEMP TABLE IF NOT EXISTS sidecar_fixture_authorized_upload_assets (
          asset_id TEXT PRIMARY KEY
        ) WITHOUT ROWID
        """
    )
    conn.execute("DELETE FROM sidecar_fixture_authorized_upload_assets")
    if not requested:
        return set()
    conn.executemany(
        """
        INSERT OR IGNORE INTO sidecar_fixture_authorized_upload_assets (asset_id)
        VALUES (?)
        """,
        ((asset_id,) for asset_id in requested),
    )
    rows = conn.execute(
        """
        SELECT DISTINCT requested.asset_id
        FROM sidecar_fixture_authorized_upload_assets AS requested
        JOIN sidecar_assets AS asset ON asset.asset_id = requested.asset_id
        JOIN asset_editorial_state AS editorial
          ON editorial.asset_id = requested.asset_id
         AND editorial.editorial_state = 'approved'
        JOIN fixture_asset_decisions AS decision
          ON decision.asset_id = requested.asset_id
         AND decision.placement_state = 'picked'
         AND decision.eligibility_state = 'active'
        JOIN fixtures AS fixture
          ON fixture.fixture_id = decision.fixture_id
         AND fixture.archived_at IS NULL
        WHERE (asset.missing_at IS NULL OR asset.missing_at = '')
          AND NOT EXISTS (
            SELECT 1
            FROM sidecar_tombstones AS tombstone
            WHERE tombstone.asset_id = requested.asset_id
              AND tombstone.tombstone_state = 'active'
          )
        """
    ).fetchall()
    return {str(row["asset_id"]) for row in rows}


def _upload_bridge_rows(
    conn: sqlite3.Connection,
    limit: int | None = None,
    *,
    include_blocked: bool = False,
    asset_ids: Iterable[str] | None = None,
    fixture_authorized_asset_ids: Iterable[str] | None = None,
) -> list[sqlite3.Row]:
    scoped_ids = None if asset_ids is None else {str(asset_id) for asset_id in asset_ids if str(asset_id)}
    fixture_authorized_ids = _fixture_authorized_upload_asset_ids(
        conn,
        fixture_authorized_asset_ids,
    )
    limit_sql = ""
    params: tuple[Any, ...] = ()
    if limit is not None and scoped_ids is None:
        limit_sql = "LIMIT ?"
        params = (max(1, min(int(limit or 500), 5000)),)
    blocked_sql = "" if include_blocked else """
          AND NOT EXISTS (
            SELECT 1 FROM sidecar_upload_bridge_asset_blocks AS b
            WHERE b.asset_id = m.asset_id AND b.block_state = 'active'
          )
    """
    rows = conn.execute(
        f"""
        WITH ranked AS (
          SELECT a.asset_id, a.source_anchor, a.raw_json, a.media_type, a.filename,
                 a.captured_at, a.indexed_at, a.updated_at AS asset_updated_at, a.missing_at,
                 m.uploaded_at, a.location_label, a.location_keywords_json,
                 d.title, d.keywords_json,
                 COALESCE(NULLIF(json_extract(a.raw_json, '$.localIdentifier'), ''), a.asset_id)
                   AS photos_identity,
                 CASE
                   WHEN COALESCE(NULLIF(json_extract(a.raw_json, '$.localIdentifier'), ''), '') <> ''
                    AND EXISTS (
                      SELECT 1
                      FROM sidecar_upload_bridge_run_items AS legacy_item
                      JOIN sidecar_upload_bridge_runs AS legacy_run
                        ON legacy_run.run_id = legacy_item.run_id
                      WHERE legacy_item.asset_id = json_extract(a.raw_json, '$.localIdentifier')
                        AND legacy_item.asset_id <> a.asset_id
                        AND legacy_run.execute_upload = 1
                        AND legacy_item.status = 'uploaded'
                        AND legacy_item.upload_status IN ('uploaded', 'uploaded_with_skips')
                    )
                   THEN 'apple-photos://' || json_extract(a.raw_json, '$.localIdentifier')
                   ELSE a.source_anchor
                 END AS r2_source_anchor,
                 ROW_NUMBER() OVER (
                   PARTITION BY COALESCE(
                     NULLIF(json_extract(a.raw_json, '$.localIdentifier'), ''), a.asset_id
                   )
                   ORDER BY
                     CASE WHEN a.missing_at IS NULL OR a.missing_at = '' THEN 0 ELSE 1 END,
                     COALESCE(a.indexed_at, '') DESC,
                     COALESCE(a.updated_at, '') DESC,
                     a.asset_id DESC
                 ) AS identity_rank
          FROM sidecar_mock_uploads AS m
          JOIN sidecar_assets AS a ON a.asset_id = m.asset_id
          JOIN sidecar_decisions AS d ON d.asset_id = m.asset_id
          WHERE m.mock_state = 'active'
            AND (
              (d.pick_state = 'picked' AND d.metadata_state = 'approved')
              OR EXISTS (
                SELECT 1
                FROM sidecar_fixture_authorized_upload_assets AS authorized
                WHERE authorized.asset_id = m.asset_id
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM json_each(d.keywords_json) AS keyword
              WHERE lower(trim(keyword.value)) LIKE 'ai generated%'
                 OR lower(trim(keyword.value)) IN ('generative ai', 'ai artwork')
            )
            AND (
              EXISTS (
                SELECT 1
                FROM sidecar_fixture_authorized_upload_assets AS authorized
                WHERE authorized.asset_id = m.asset_id
              )
              OR NOT EXISTS (
                SELECT 1 FROM json_each(d.keywords_json) AS keyword
                WHERE lower(trim(keyword.value)) LIKE 'stained%'
              )
            )
            AND NOT EXISTS (
              SELECT 1 FROM sidecar_tombstones AS t
              WHERE t.asset_id = m.asset_id AND t.tombstone_state = 'active'
            )
            {blocked_sql}
        )
        SELECT * FROM ranked
        WHERE identity_rank = 1
        ORDER BY uploaded_at DESC, captured_at DESC, asset_id
        {limit_sql}
        """,
        params,
    ).fetchall()
    if scoped_ids is not None:
        rows = [row for row in rows if str(row["asset_id"]) in scoped_ids]
    if not include_blocked:
        rows = [
            row
            for row in rows
            if _upload_bridge_metadata_ready(
                row,
                allow_missing_gallery=str(row["asset_id"]) in fixture_authorized_ids,
            )
        ]
    return rows[:limit] if limit is not None else rows


def _upload_bridge_block_summary(
    conn: sqlite3.Connection,
    asset_ids: Iterable[str] | None = None,
) -> dict[str, Any]:
    scoped_ids = None if asset_ids is None else [
        str(asset_id) for asset_id in asset_ids if str(asset_id)
    ]
    scope_sql = ""
    params: list[Any] = []
    if scoped_ids is not None:
        if scoped_ids:
            scope_sql = f"AND b.asset_id IN ({','.join('?' for _ in scoped_ids)})"
            params.extend(scoped_ids)
        else:
            scope_sql = "AND 0"
    row = conn.execute(
        f"""
        SELECT
          COUNT(*) AS blocked_count,
          COALESCE(SUM(b.failure_count), 0) AS failure_count,
          MAX(b.last_failed_at) AS last_blocked_at
        FROM sidecar_upload_bridge_asset_blocks AS b
        JOIN sidecar_mock_uploads AS m ON m.asset_id = b.asset_id AND m.mock_state = 'active'
        JOIN sidecar_decisions AS d ON d.asset_id = b.asset_id
        LEFT JOIN sidecar_tombstones AS t ON t.asset_id = b.asset_id AND t.tombstone_state = 'active'
        WHERE b.block_state = 'active'
          AND d.pick_state = 'picked'
          AND d.metadata_state = 'approved'
          AND t.asset_id IS NULL
          {scope_sql}
        """,
        params,
    ).fetchone()
    return {
        "blockedExportFailureCount": int(row["blocked_count"] or 0),
        "blockedExportAttemptCount": int(row["failure_count"] or 0),
        "latestBlockedExportAt": str(row["last_blocked_at"] or ""),
    }


def _record_upload_bridge_export_block(conn: sqlite3.Connection, asset_id: str, status: str, error: str, failed_at: str) -> None:
    clean_asset_id = str(asset_id or "").strip()
    if not clean_asset_id:
        return
    conn.execute(
        """
        INSERT INTO sidecar_upload_bridge_asset_blocks
          (asset_id, block_state, block_reason, failure_count, last_status, last_error,
           first_failed_at, last_failed_at, cleared_at, updated_at)
        VALUES (?, 'active', 'export_failed', 1, ?, ?, ?, ?, NULL, ?)
        ON CONFLICT(asset_id) DO UPDATE SET
          block_state = 'active',
          block_reason = 'export_failed',
          failure_count = sidecar_upload_bridge_asset_blocks.failure_count + 1,
          last_status = excluded.last_status,
          last_error = excluded.last_error,
          first_failed_at = COALESCE(sidecar_upload_bridge_asset_blocks.first_failed_at, excluded.first_failed_at),
          last_failed_at = excluded.last_failed_at,
          cleared_at = NULL,
          updated_at = excluded.updated_at
        """,
        (clean_asset_id, status, error, failed_at, failed_at, failed_at),
    )


def _clear_upload_bridge_export_block(conn: sqlite3.Connection, asset_id: str, cleared_at: str) -> None:
    clean_asset_id = str(asset_id or "").strip()
    if not clean_asset_id:
        return
    conn.execute(
        """
        UPDATE sidecar_upload_bridge_asset_blocks
        SET block_state = 'cleared', cleared_at = ?, updated_at = ?
        WHERE asset_id = ? AND block_state = 'active'
        """,
        (cleared_at, cleared_at, clean_asset_id),
    )


def _upload_bridge_gallery_slug(row: sqlite3.Row) -> str:
    text = " ".join(
        [
            str(row["location_label"] or ""),
            str(row["location_keywords_json"] or ""),
            str(row["keywords_json"] or ""),
            str(row["title"] or ""),
            str(row["filename"] or ""),
        ]
    ).casefold()
    for slug, terms in UPLOAD_BRIDGE_GALLERY_TERMS.items():
        if any(term in text for term in terms):
            return slug
    return ""


def _upload_bridge_metadata_block_reason(row: sqlite3.Row) -> str:
    title = str(row["title"] or "").strip()
    normalized_title = re.sub(r"\s+", " ", title).casefold()
    gallery_slug = _upload_bridge_gallery_slug(row)
    if normalized_title in GENERIC_UPLOAD_TITLES:
        return "generic-title"
    if not gallery_slug:
        return "missing-gallery-signal"
    return ""


def _upload_bridge_metadata_ready(
    row: sqlite3.Row,
    *,
    allow_missing_gallery: bool = False,
) -> bool:
    reason = _upload_bridge_metadata_block_reason(row)
    return reason == "" or (allow_missing_gallery and reason == "missing-gallery-signal")


def _mock_upload_summary(
    conn: sqlite3.Connection,
    asset_ids: Iterable[str] | None = None,
    *,
    fixture_authorized_asset_ids: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Summarize rows queued across the Sidecar upload bridge."""
    fixture_authorized_ids = _fixture_authorized_upload_asset_ids(
        conn,
        fixture_authorized_asset_ids,
    )
    rows = _upload_bridge_rows(
        conn,
        asset_ids=asset_ids,
        fixture_authorized_asset_ids=fixture_authorized_ids,
    )
    all_rows = _upload_bridge_rows(
        conn,
        include_blocked=True,
        asset_ids=asset_ids,
        fixture_authorized_asset_ids=fixture_authorized_ids,
    )
    metadata_blocked_rows = [
        row
        for row in all_rows
        if not _upload_bridge_metadata_ready(
            row,
            allow_missing_gallery=str(row["asset_id"]) in fixture_authorized_ids,
        )
    ]
    block_summary = _upload_bridge_block_summary(conn, asset_ids=asset_ids)
    planned_key_sets: dict[str, list[dict[str, str]]] = {}
    all_planned_keys: list[dict[str, str]] = []
    for row in rows:
        _photo_id, keys = _planned_r2_keys(row)
        planned_key_sets[str(row["asset_id"])] = keys
        all_planned_keys.extend(keys)
    current_r2 = _current_r2_objects_for_plan(conn, all_planned_keys)
    collision_count = 0
    covered_key_count = 0
    planned_key_count = 0
    missing_key_count = 0
    uploadable_item_count = 0
    fully_covered_item_count = 0
    partially_covered_item_count = 0
    for row in rows:
        item_collision_count = 0
        item_keys = planned_key_sets.get(str(row["asset_id"]), [])
        for key in item_keys:
            planned_key_count += 1
            if current_r2.get((key["bucket"], key["key"])) is not None:
                item_collision_count += 1
                covered_key_count += 1
            else:
                missing_key_count += 1
        if item_collision_count:
            collision_count += 1
        if item_keys and item_collision_count >= len(item_keys):
            fully_covered_item_count += 1
        elif item_collision_count:
            partially_covered_item_count += 1
        if item_keys and item_collision_count < len(item_keys):
            uploadable_item_count += 1
    latest_uploaded_at = str(all_rows[0]["uploaded_at"] or "") if all_rows else ""
    return {
        "mockUploadedCount": len(all_rows),
        "bridgeQueuedCount": len(all_rows),
        "metadataBlockedQueuedCount": len(metadata_blocked_rows),
        "uploadableItemCount": uploadable_item_count,
        "fullyCoveredItemCount": fully_covered_item_count,
        "partiallyCoveredItemCount": partially_covered_item_count,
        "collisionCount": collision_count,
        "coveredKeyCount": covered_key_count,
        "missingKeyCount": missing_key_count,
        "plannedKeyCount": planned_key_count,
        "latestUploadedAt": latest_uploaded_at,
        "latestQueuedAt": latest_uploaded_at,
        **block_summary,
    }


def upload_bridge_plan(
    repo_root: Path,
    limit: int = 500,
    asset_ids: Iterable[str] | None = None,
    *,
    fixture_authorized_asset_ids: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Return the dry-run plan for rows already queued across the upload bridge."""
    safe_limit = max(1, min(int(limit or 500), 5000))
    with connect(repo_root) as conn:
        rows = _upload_bridge_rows(
            conn,
            safe_limit,
            asset_ids=asset_ids,
            fixture_authorized_asset_ids=fixture_authorized_asset_ids,
        )
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
        total_queued = len(_upload_bridge_rows(
            conn,
            asset_ids=asset_ids,
            fixture_authorized_asset_ids=fixture_authorized_asset_ids,
        ))
        mock_upload_summary = _mock_upload_summary(
            conn,
            asset_ids=asset_ids,
            fixture_authorized_asset_ids=fixture_authorized_asset_ids,
        )
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
        "realUploadImplemented": True,
        "bridgeQueuedCount": int(total_queued or 0),
        "count": len(items),
        "items": items,
        "collisionCount": int(mock_upload_summary.get("collisionCount") or collision_count),
        "coveredKeyCount": int(mock_upload_summary.get("coveredKeyCount") or covered_key_count),
        "missingKeyCount": int(mock_upload_summary.get("missingKeyCount") or 0),
        "plannedKeyCount": int(mock_upload_summary.get("plannedKeyCount") or total_key_count),
        "uploadableItemCount": int(mock_upload_summary.get("uploadableItemCount") or 0),
        "fullyCoveredItemCount": int(mock_upload_summary.get("fullyCoveredItemCount") or 0),
        "partiallyCoveredItemCount": int(mock_upload_summary.get("partiallyCoveredItemCount") or 0),
        "blockedExportFailureCount": int(mock_upload_summary.get("blockedExportFailureCount") or 0),
        "blockedExportAttemptCount": int(mock_upload_summary.get("blockedExportAttemptCount") or 0),
        "uploadBridgeSummary": mock_upload_summary,
        "message": "Upload Bridge plan only. Use sidecar_upload_bridge.py --export-one for a local Photos export dry run, or --execute --limit 1 for guarded single-item R2 upload execution. The Sidecar Review rail can execute larger streamed batches. Owner catalog registration remains a later slice.",
    }


def _upload_bridge_run_id() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"ub-{stamp}-{uuid.uuid4().hex[:8]}"


def _run_apple_photos_materialize_one(
    repo_root: Path,
    *,
    asset_id: str,
    destination: Path,
    allow_icloud_downloads: bool,
    timeout: int = 1800,
) -> dict[str, Any]:
    destination.mkdir(parents=True, exist_ok=True)
    result_destination = destination / "photos-bridge-result.json"
    launched_app_bundle = APPLE_PHOTOS_BRIDGE_APP.exists()
    if launched_app_bundle:
        command = [
            "open",
            "-W",
            "-n",
            str(APPLE_PHOTOS_BRIDGE_APP),
            "--args",
            "materialize-one",
        ]
    else:
        bridge = repo_root / "scripts/apple_photos_bridge.swift"
        if not bridge.exists():
            raise RuntimeError(f"Apple Photos bridge is missing: {bridge}")
        command = ["swift", str(bridge), "materialize-one"]
    command.extend([
        "--asset-id",
        asset_id,
        "--destination",
        str(destination),
        "--result-destination",
        str(result_destination),
    ])
    if allow_icloud_downloads:
        command.append("--allow-icloud-downloads")
    try:
        result = subprocess.run(
            command,
            cwd=repo_root,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as error:
        if launched_app_bundle:
            raise RuntimeError("macOS open is required to launch the Photos Bridge app bundle.") from error
        raise RuntimeError("Swift is required for the Apple Photos PhotoKit bridge development fallback. Install Xcode Command Line Tools.") from error
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("Apple Photos bridge timed out while materializing the queued asset.") from error
    stdout = (result.stdout or "").strip()
    stderr = (result.stderr or "").strip()
    if result_destination.exists() and result_destination.stat().st_size > 0:
        stdout = result_destination.read_text(encoding="utf-8").strip()
    try:
        payload = json.loads(stdout or "{}")
    except json.JSONDecodeError as error:
        message = stderr or stdout or "Apple Photos bridge returned invalid JSON or did not write its result file."
        raise RuntimeError(message.strip()) from error
    if result.returncode != 0 or payload.get("ok") is False:
        message = str(payload.get("error") or stderr or f"Apple Photos bridge exited {result.returncode}").strip()
        raise RuntimeError(message)
    if stderr:
        payload["stderr"] = stderr
    return payload


def _first_env(*names: str) -> str:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return ""


def _default_r2_backend() -> str:
    configured = os.environ.get("PBE_R2_BACKEND", "").strip().casefold()
    if configured in {"wrangler", "s3"}:
        return configured
    if (
        _first_env("R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID")
        and _first_env("R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID")
        and _first_env("R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY")
    ):
        return "s3"
    return "wrangler"


def _content_type_for_upload(path: Path, kind: str) -> str:
    if kind == "public-preview-video" or path.suffix.lower() == ".mp4":
        return "video/mp4"
    if kind == "public-preview":
        return "image/jpeg"
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def _artifact_path_for_key(artifact_root: Path, key: str) -> Path:
    return artifact_root.joinpath(*[part for part in str(key).split("/") if part])


def _prepare_upload_bridge_artifact(
    *,
    export_path: Path,
    planned_key: dict[str, Any],
    media_type: str,
    artifact_root: Path,
    force: bool = False,
) -> tuple[Path, str]:
    """Return the local file to upload for one planned bridge key."""
    kind = str(planned_key.get("kind") or "")
    key = str(planned_key.get("key") or "")
    if kind == "private-master":
        return export_path, _content_type_for_upload(export_path, kind)

    if not export_path.exists():
        raise FileNotFoundError(f"Missing exported source for public preview generation: {export_path}")

    from build_lightroom_thumbnails import (  # noqa: PLC0415
        DEFAULT_DETAIL_MAX,
        DEFAULT_GALLERY_MAX,
        DEFAULT_WATERMARK,
        choose_font,
        render_derivative,
        render_video_poster,
        render_video_preview,
        run_exiftool_tags,
    )

    output = _artifact_path_for_key(artifact_root, key)
    normalized_media_type = str(media_type or "").casefold()
    is_video = normalized_media_type == "video" or export_path.suffix.lower() in {".mov", ".mp4", ".m4v"}
    font = choose_font()
    if kind == "public-preview-video":
        render_video_preview(export_path, output, DEFAULT_WATERMARK, font, force)
        return output, "video/mp4"
    if is_video and key.endswith("_900.jpg"):
        render_video_poster(export_path, output, DEFAULT_WATERMARK, font, force)
        return output, "image/jpeg"
    max_px = DEFAULT_GALLERY_MAX if key.endswith("_900.jpg") else DEFAULT_DETAIL_MAX
    source_orientation = None
    try:
        source_orientation = run_exiftool_tags(export_path, ["Orientation"]).get("Orientation")
    except Exception:
        source_orientation = None
    render_derivative(export_path, output, max_px, DEFAULT_WATERMARK, font, force, source_orientation)
    return output, "image/jpeg"


def _upload_bridge_execute_r2(
    *,
    planned_keys: list[dict[str, Any]],
    export_path: Path,
    media_type: str,
    artifact_root: Path,
    allow_r2_overwrite: bool = False,
    backend: str | None = None,
    retries: int = 2,
    request_min_interval: float = 0.75,
    retry_max_delay: float = 900.0,
    s3_account_id: str | None = None,
    s3_access_key_id: str | None = None,
    s3_secret_access_key: str | None = None,
    s3_endpoint: str | None = None,
) -> list[dict[str, Any]]:
    from sync_r2_media import (  # noqa: PLC0415
        DEFAULT_THROTTLE_FILE,
        UploadItem,
        s3_get,
        s3_put,
        wrangler_get,
        wrangler_put,
    )

    selected_backend = (backend or _default_r2_backend()).strip().casefold()
    if selected_backend not in {"wrangler", "s3"}:
        raise ValueError(f"Unsupported R2 backend: {backend}")

    account_id = s3_account_id if s3_account_id is not None else _first_env("R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID")
    access_key_id = s3_access_key_id if s3_access_key_id is not None else _first_env("R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID")
    secret_access_key = s3_secret_access_key if s3_secret_access_key is not None else _first_env("R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY")
    endpoint = s3_endpoint if s3_endpoint is not None else os.environ.get("R2_S3_ENDPOINT", "")
    if selected_backend == "s3":
        missing = [
            name
            for name, value in (
                ("R2_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID", account_id),
                ("R2_ACCESS_KEY_ID or AWS_ACCESS_KEY_ID", access_key_id),
                ("R2_SECRET_ACCESS_KEY or AWS_SECRET_ACCESS_KEY", secret_access_key),
            )
            if not value
        ]
        if missing:
            raise RuntimeError(f"Missing S3 backend credential(s): {', '.join(missing)}")

    def upload_one(position: int, key: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        key_started = time.perf_counter()
        bucket = str(key.get("bucket") or "")
        object_key = str(key.get("key") or "")
        kind = str(key.get("kind") or "")
        exists = bool(key.get("exists"))
        base_result: dict[str, Any] = {
            "bucket": bucket,
            "key": object_key,
            "kind": kind,
            "backend": selected_backend,
            "existedBeforeUpload": exists,
        }
        if exists and not allow_r2_overwrite:
            return position, {
                **base_result,
                "status": "skipped_collision",
                "timings": {"totalSeconds": round(time.perf_counter() - key_started, 3)},
                "error": "planned R2 key already exists in Owner R2 inventory",
                **({"existing": key.get("existing")} if key.get("existing") else {}),
            }
        try:
            prepare_started = time.perf_counter()
            source_path, content_type = _prepare_upload_bridge_artifact(
                export_path=export_path,
                planned_key=key,
                media_type=media_type,
                artifact_root=artifact_root,
            )
            upload_started = time.perf_counter()
            cache_control = "public, max-age=31536000, immutable" if bucket == DEFAULT_PUBLIC_BUCKET else ""
            upload_item = UploadItem(
                bucket=bucket,
                key=object_key,
                path=source_path,
                content_type=content_type,
                cache_control=cache_control,
            )
            if selected_backend == "s3":
                _, ok, output = s3_put(
                    upload_item,
                    retries,
                    DEFAULT_THROTTLE_FILE,
                    request_min_interval,
                    retry_max_delay,
                    account_id,
                    access_key_id,
                    secret_access_key,
                    endpoint,
                )
            else:
                _, ok, output = wrangler_put(upload_item, retries, DEFAULT_THROTTLE_FILE, request_min_interval, retry_max_delay)
            local_checksum = hashlib.sha256(source_path.read_bytes()).hexdigest() if ok and source_path.exists() else ""
            remote_checksum = ""
            verification_output = ""
            if ok:
                verification_path = artifact_root / ".r2-verification" / bucket / object_key
                verification_path.parent.mkdir(parents=True, exist_ok=True)
                if selected_backend == "s3":
                    _, remote_ok, verification_output = s3_get(
                        upload_item,
                        verification_path,
                        retries,
                        DEFAULT_THROTTLE_FILE,
                        request_min_interval,
                        retry_max_delay,
                        account_id,
                        access_key_id,
                        secret_access_key,
                        endpoint,
                    )
                else:
                    _, remote_ok, verification_output = wrangler_get(
                        upload_item,
                        verification_path,
                        retries,
                        DEFAULT_THROTTLE_FILE,
                        request_min_interval,
                        retry_max_delay,
                    )
                if remote_ok and verification_path.is_file():
                    remote_checksum = hashlib.sha256(verification_path.read_bytes()).hexdigest()
                verification_path.unlink(missing_ok=True)
            remote_verified = bool(ok and local_checksum and remote_checksum == local_checksum)
            return position, {
                **base_result,
                "status": "uploaded" if ok else "failed",
                "sourcePath": str(source_path),
                "bytes": source_path.stat().st_size if source_path.exists() else 0,
                "checksumSha256": local_checksum,
                "remoteChecksumSha256": remote_checksum,
                "remoteVerified": remote_verified,
                "contentType": content_type,
                "cacheControl": cache_control,
                "timings": {
                    "prepareSeconds": round(upload_started - prepare_started, 3),
                    "uploadSeconds": round(time.perf_counter() - upload_started, 3),
                    "totalSeconds": round(time.perf_counter() - key_started, 3),
                },
                "output": output[-4000:] if output else "",
                "verificationOutput": verification_output[-4000:] if verification_output else "",
                **({"error": output[-4000:]} if not ok and output else {}),
                **({"verificationError": verification_output[-4000:] or "remote checksum did not match local upload"} if ok and not remote_verified else {}),
            }
        except Exception as error:  # noqa: BLE001 - keep remaining planned keys auditable.
            return position, {
                **base_result,
                "status": "failed",
                "timings": {"totalSeconds": round(time.perf_counter() - key_started, 3)},
                "error": str(error),
            }

    if len(planned_keys) <= 1:
        return [upload_one(index, key)[1] for index, key in enumerate(planned_keys)]

    ordered: list[dict[str, Any] | None] = [None] * len(planned_keys)
    worker_count = min(3, len(planned_keys))
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = [executor.submit(upload_one, index, key) for index, key in enumerate(planned_keys)]
        for future in as_completed(futures):
            position, result = future.result()
            ordered[position] = result
    return [result for result in ordered if result is not None]


def prepare_upload_bridge_execute_batch(
    repo_root: Path,
    *,
    limit: int = 500,
    spool_root: Path | None = None,
    allow_r2_overwrite: bool = False,
    asset_ids: Iterable[str] | None = None,
    exclude_asset_ids: Iterable[str] | None = None,
    fixture_authorized_asset_ids: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Plan a multi-item Upload Bridge execute run with one queue/R2 coverage pass."""
    requested_limit = max(1, min(int(limit or 1), 5000))
    scan_limit = 5000 if not allow_r2_overwrite else requested_limit
    scan_limit = max(scan_limit, requested_limit)
    run_id = _upload_bridge_run_id()
    run_mode = "execute-batch"
    now = now_iso()
    planning_started = time.perf_counter()
    base_root = spool_root or DEFAULT_UPLOAD_BRIDGE_RUN_ROOT
    if not base_root.is_absolute():
        base_root = repo_root / base_root
    run_root = base_root / run_id
    export_root = run_root / "export"
    export_root.mkdir(parents=True, exist_ok=True)
    included_asset_ids = None if asset_ids is None else {
        str(asset_id) for asset_id in asset_ids if str(asset_id)
    }
    excluded_asset_ids = {str(asset_id) for asset_id in (exclude_asset_ids or []) if str(asset_id)}

    with connect(repo_root) as conn:
        rows = _upload_bridge_rows(
            conn,
            scan_limit,
            fixture_authorized_asset_ids=fixture_authorized_asset_ids,
        )
        if included_asset_ids is not None:
            rows = [row for row in rows if str(row["asset_id"]) in included_asset_ids]
        if excluded_asset_ids:
            rows = [row for row in rows if str(row["asset_id"]) not in excluded_asset_ids]
        if not rows:
            summary_payload = {
                "bridgeQueuedCount": 0,
                "scopedAssetCount": len(included_asset_ids or ()),
                "excludedAssetCount": len(excluded_asset_ids),
                "requestedCount": requested_limit,
                "r2UploadPerformed": False,
                "executeUpload": True,
                "planningSeconds": round(time.perf_counter() - planning_started, 3),
            }
            conn.execute(
                """
                INSERT INTO sidecar_upload_bridge_runs
                  (run_id, mode, status, execute_upload, limit_count, started_at, completed_at,
                   spool_root, summary_json, created_at, updated_at)
                VALUES (?, ?, 'no-queued-items', 1, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    run_mode,
                    requested_limit,
                    now,
                    now,
                    str(run_root),
                    _json_text(summary_payload),
                    now,
                    now,
                ),
            )
            return {
                "ok": True,
                "mode": run_mode,
                "runId": run_id,
                "status": "no-queued-items",
                "count": 0,
                "spoolRoot": str(run_root),
                "exportRoot": str(export_root),
                "items": [],
                "summary": summary_payload,
                "message": "No active Upload Bridge rows are queued.",
            }

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

        selected_rows: list[sqlite3.Row] = []
        skipped_covered = 0
        for row in rows:
            asset_id = str(row["asset_id"])
            keys = planned_key_sets.get(asset_id, [])
            missing_keys = [
                key
                for key in keys
                if current_r2.get((key["bucket"], key["key"])) is None
            ]
            if allow_r2_overwrite or missing_keys:
                selected_rows.append(row)
                if len(selected_rows) >= requested_limit:
                    break
            else:
                skipped_covered += 1

        if not selected_rows:
            summary_payload = {
                "bridgeQueuedCount": len(rows),
                "scannedCount": len(rows),
                "skippedCoveredCount": skipped_covered,
                "requestedCount": requested_limit,
                "r2UploadPerformed": False,
                "executeUpload": True,
                "planningSeconds": round(time.perf_counter() - planning_started, 3),
            }
            conn.execute(
                """
                INSERT INTO sidecar_upload_bridge_runs
                  (run_id, mode, status, execute_upload, limit_count, started_at, completed_at,
                   spool_root, summary_json, created_at, updated_at)
                VALUES (?, ?, 'no-uploadable-items', 1, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    run_mode,
                    requested_limit,
                    now,
                    now,
                    str(run_root),
                    _json_text(summary_payload),
                    now,
                    now,
                ),
            )
            return {
                "ok": True,
                "mode": run_mode,
                "runId": run_id,
                "status": "no-uploadable-items",
                "count": 0,
                "spoolRoot": str(run_root),
                "exportRoot": str(export_root),
                "items": [],
                "summary": summary_payload,
                "message": "All active Upload Bridge rows already have their planned R2 keys covered.",
            }

        summary_payload = {
            "bridgeQueuedCount": len(rows),
            "scopedAssetCount": len(included_asset_ids or ()),
            "scannedCount": len(rows),
            "selectedCount": len(selected_rows),
            "skippedCoveredCount": skipped_covered,
            "requestedCount": requested_limit,
            "r2UploadPerformed": False,
            "executeUpload": True,
            "allowR2Overwrite": allow_r2_overwrite,
            "planningSeconds": round(time.perf_counter() - planning_started, 3),
        }
        conn.execute(
            """
            INSERT INTO sidecar_upload_bridge_runs
              (run_id, mode, status, execute_upload, limit_count, started_at, spool_root,
               summary_json, created_at, updated_at)
            VALUES (?, ?, 'running', 1, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                run_mode,
                requested_limit,
                now,
                str(run_root),
                _json_text(summary_payload),
                now,
                now,
            ),
        )

        ledger_items: list[dict[str, Any]] = []
        for row in selected_rows:
            asset_id = str(row["asset_id"])
            planned_keys: list[dict[str, Any]] = []
            item_collision_count = 0
            for key in planned_key_sets.get(asset_id, []):
                current = current_r2.get((key["bucket"], key["key"]))
                if current is not None:
                    item_collision_count += 1
                planned_keys.append({
                    **key,
                    "exists": current is not None,
                    **({"existing": current} if current else {}),
                })
            run_item_id = uuid.uuid4().hex
            conn.execute(
                """
                INSERT INTO sidecar_upload_bridge_run_items
                  (run_item_id, run_id, asset_id, photo_id, filename, media_type, queued_at,
                   status, export_status, planned_keys_json, timings_json, editorial_version_hash,
                   created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', 'planned', ?, '{}', ?, ?, ?)
                """,
                (
                    run_item_id,
                    run_id,
                    asset_id,
                    photo_ids.get(asset_id, ""),
                    row["filename"] or "",
                    row["media_type"] or "",
                    row["uploaded_at"] or "",
                    _json_text(planned_keys),
                    editorial_version_hash(conn, asset_id),
                    now,
                    now,
                ),
            )
            ledger_items.append({
                "runItemId": run_item_id,
                "assetId": asset_id,
                "photoId": photo_ids.get(asset_id, ""),
                "filename": row["filename"] or "",
                "capturedAt": row["captured_at"] or "",
                "mediaType": row["media_type"] or "",
                "queuedAt": row["uploaded_at"] or "",
                "collisionCount": item_collision_count,
                "editorialVersionHash": editorial_version_hash(conn, asset_id),
                "plannedKeys": planned_keys,
            })

    return {
        "ok": True,
        "mode": run_mode,
        "runId": run_id,
        "status": "running",
        "spoolRoot": str(run_root),
        "exportRoot": str(export_root),
        "count": len(ledger_items),
        "items": ledger_items,
        "summary": summary_payload,
        "message": f"Planned {len(ledger_items):,} Upload Bridge item(s) with one R2 coverage pass.",
    }


def execute_upload_bridge_batch_item(
    repo_root: Path,
    *,
    run_id: str,
    run_root: Path,
    export_root: Path,
    item: dict[str, Any],
    allow_icloud_downloads: bool = True,
    allow_r2_overwrite: bool = False,
    r2_backend: str | None = None,
    r2_retries: int = 2,
    r2_request_min_interval: float = 0.75,
    r2_retry_max_delay: float = 900.0,
    r2_s3_account_id: str | None = None,
    r2_s3_access_key_id: str | None = None,
    r2_s3_secret_access_key: str | None = None,
    r2_s3_endpoint: str | None = None,
) -> dict[str, Any]:
    """Materialize and upload one already-planned batch item."""
    item_started = time.perf_counter()
    now = now_iso()
    with connect(repo_root) as conn:
        conn.execute(
            """
            UPDATE sidecar_upload_bridge_run_items
            SET status = 'exporting', export_status = 'running', updated_at = ?
            WHERE run_item_id = ?
            """,
            (now, item["runItemId"]),
        )

    export_payload: dict[str, Any] | None = None
    export_error = ""
    export_status = "planned"
    export_path = ""
    export_bytes: int | None = None
    item_status = "planned"
    upload_status = "not_requested"
    upload_results: list[dict[str, Any]] = []
    upload_error = ""
    timings: dict[str, Any] = {}

    try:
        export_started = time.perf_counter()
        export_payload = _run_apple_photos_materialize_one(
            repo_root,
            asset_id=item["assetId"],
            destination=export_root / str(item["runItemId"]),
            allow_icloud_downloads=allow_icloud_downloads,
        )
        timings["photosExportSeconds"] = round(time.perf_counter() - export_started, 3)
        exported_item = (export_payload.get("items") or [{}])[0]
        if isinstance(exported_item, dict):
            export_status = str(exported_item.get("status") or "")
            export_path = str(exported_item.get("path") or "")
            export_error = str(exported_item.get("reason") or exported_item.get("error") or "")
        materialized_count = int(export_payload.get("materializedCount") or 0)
        if export_path and Path(export_path).exists():
            export_bytes = Path(export_path).stat().st_size
        if materialized_count > 0 and export_path:
            item_status = "exported"
            upload_started = time.perf_counter()
            upload_results = _upload_bridge_execute_r2(
                planned_keys=item.get("plannedKeys") or [],
                export_path=Path(export_path),
                media_type=str(item.get("mediaType") or ""),
                artifact_root=run_root / "public-artifacts",
                allow_r2_overwrite=allow_r2_overwrite,
                backend=r2_backend,
                retries=r2_retries,
                request_min_interval=r2_request_min_interval,
                retry_max_delay=r2_retry_max_delay,
                s3_account_id=r2_s3_account_id,
                s3_access_key_id=r2_s3_access_key_id,
                s3_secret_access_key=r2_s3_secret_access_key,
                s3_endpoint=r2_s3_endpoint,
            )
            from fixture_pipeline import record_r2_upload_results  # noqa: PLC0415
            record_r2_upload_results(repo_root, str(item.get("assetId") or ""), upload_results)
            timings["r2UploadSeconds"] = round(time.perf_counter() - upload_started, 3)
            failed_uploads = [result for result in upload_results if result.get("status") == "failed"]
            skipped_uploads = [result for result in upload_results if result.get("status") == "skipped_collision"]
            if failed_uploads:
                upload_status = "failed"
                item_status = "upload_failed"
                upload_error = "; ".join(str(result.get("error") or "") for result in failed_uploads if result.get("error"))
            elif skipped_uploads:
                upload_status = "uploaded_with_skips"
                item_status = "uploaded_with_skips"
            else:
                upload_status = "uploaded"
                item_status = "uploaded"
        else:
            item_status = "export_failed"
            export_error = export_error or "Apple Photos bridge did not materialize an export file."
    except Exception as error:  # noqa: BLE001 - ledger must capture bridge failures.
        message = str(error)
        if item_status == "exported":
            item_status = "upload_failed"
            upload_status = "failed"
            upload_error = message
        else:
            item_status = "export_failed"
            export_status = "failed"
            export_error = message

    completed_at = now_iso()
    timings["totalSeconds"] = round(time.perf_counter() - item_started, 3)
    uploaded_key_count = sum(1 for result in upload_results if result.get("status") == "uploaded")
    skipped_collision_count = sum(1 for result in upload_results if result.get("status") == "skipped_collision")
    failed_upload_count = sum(1 for result in upload_results if result.get("status") == "failed")
    if upload_status == "failed" and not upload_results:
        failed_upload_count = 1
    run_error = export_error or upload_error
    run_summary = {
        "bridgeQueuedCount": 1,
        "exportedCount": 1 if export_path and item_status != "export_failed" else 0,
        "failedCount": 1 if item_status in {"export_failed", "upload_failed"} else 0,
        "r2UploadPerformed": bool(upload_results),
        "executeUpload": True,
        "allowR2Overwrite": allow_r2_overwrite,
        "uploadedKeyCount": uploaded_key_count,
        "skippedCollisionCount": skipped_collision_count,
        "failedUploadCount": failed_upload_count,
        "timings": timings,
    }
    with connect(repo_root) as conn:
        if item_status == "export_failed":
            _record_upload_bridge_export_block(
                conn,
                asset_id=str(item.get("assetId") or ""),
                status=export_status or item_status,
                error=export_error,
                failed_at=completed_at,
            )
        elif item_status in {"exported", "uploaded", "uploaded_with_skips"}:
            _clear_upload_bridge_export_block(conn, str(item.get("assetId") or ""), completed_at)
        conn.execute(
            """
            UPDATE sidecar_upload_bridge_run_items
            SET status = ?, export_status = ?, export_path = ?, export_bytes = ?,
                upload_status = ?, upload_keys_json = ?, upload_error_text = ?,
                error_text = ?, timings_json = ?, updated_at = ?
            WHERE run_item_id = ?
            """,
            (
                item_status,
                export_status,
                export_path,
                export_bytes,
                upload_status,
                _json_text(upload_results),
                upload_error,
                run_error,
                _json_text(timings),
                completed_at,
                item["runItemId"],
            ),
        )
        conn.execute(
            """
            UPDATE sidecar_upload_bridge_runs
            SET summary_json = ?, updated_at = ?
            WHERE run_id = ?
            """,
            (_json_text(run_summary), completed_at, run_id),
        )

    item = {**item}
    item["status"] = item_status
    item["export"] = {
        "status": export_status,
        "path": export_path,
        "bytes": export_bytes,
        "error": export_error,
        "allowIcloudDownloads": allow_icloud_downloads,
    }
    item["upload"] = {
        "status": upload_status,
        "keys": upload_results,
        "error": upload_error,
        "allowR2Overwrite": allow_r2_overwrite,
    }
    item["timings"] = timings
    if export_payload:
        item["photosBridge"] = {
            "mode": export_payload.get("mode"),
            "materializedCount": export_payload.get("materializedCount"),
            "sidecar": export_payload.get("sidecar"),
        }
    return {
        "ok": item_status in {"uploaded", "uploaded_with_skips"},
        "mode": "execute-batch",
        "runId": run_id,
        "status": item_status,
        "spoolRoot": str(run_root),
        "exportRoot": str(export_root),
        "r2UploadPerformed": bool(upload_results),
        "executeUpload": True,
        "count": 1,
        "items": [item],
        "summary": run_summary,
        "message": "Apple Photos export and guarded R2 upload completed; Owner catalog registration was not performed.",
    }


def finish_upload_bridge_execute_batch(
    repo_root: Path,
    *,
    run_id: str,
    status: str,
    summary: dict[str, Any],
    error_text: str = "",
) -> None:
    completed_at = now_iso()
    with connect(repo_root) as conn:
        conn.execute(
            """
            UPDATE sidecar_upload_bridge_runs
            SET status = ?, completed_at = ?, error_text = ?, summary_json = ?, updated_at = ?
            WHERE run_id = ?
            """,
            (status, completed_at, error_text, _json_text(summary), completed_at, run_id),
        )


def run_upload_bridge_export_dry_run(
    repo_root: Path,
    *,
    limit: int = 1,
    spool_root: Path | None = None,
    allow_icloud_downloads: bool = True,
    execute_upload: bool = False,
    allow_r2_overwrite: bool = False,
    r2_backend: str | None = None,
    r2_retries: int = 2,
    r2_request_min_interval: float = 0.75,
    r2_retry_max_delay: float = 900.0,
    r2_s3_account_id: str | None = None,
    r2_s3_access_key_id: str | None = None,
    r2_s3_secret_access_key: str | None = None,
    r2_s3_endpoint: str | None = None,
    exclude_asset_ids: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Materialize one bridge-queued item from Photos and record an upload-run ledger.

    The default path is still export-only. When execute_upload is true, the
    exported master and generated watermarked public previews are uploaded to
    their planned R2 keys, while Owner catalog registration remains out of scope.
    """
    requested_limit = max(1, min(int(limit or 1), 5000))
    safe_limit = 1
    scan_limit = 5000 if execute_upload and not allow_r2_overwrite else safe_limit
    scan_limit = max(scan_limit, requested_limit)
    run_id = _upload_bridge_run_id()
    run_mode = "execute" if execute_upload else "export-dry-run"
    execute_int = 1 if execute_upload else 0
    now = now_iso()
    base_root = spool_root or DEFAULT_UPLOAD_BRIDGE_RUN_ROOT
    if not base_root.is_absolute():
        base_root = repo_root / base_root
    run_root = base_root / run_id
    export_root = run_root / "export"
    export_root.mkdir(parents=True, exist_ok=True)

    excluded_asset_ids = {str(asset_id) for asset_id in (exclude_asset_ids or []) if str(asset_id)}

    with connect(repo_root) as conn:
        rows = _upload_bridge_rows(conn, scan_limit)
        if excluded_asset_ids:
            rows = [row for row in rows if str(row["asset_id"]) not in excluded_asset_ids]
        if not rows:
            conn.execute(
                """
                INSERT INTO sidecar_upload_bridge_runs
                  (run_id, mode, status, execute_upload, limit_count, started_at, completed_at,
                   spool_root, summary_json, created_at, updated_at)
                VALUES (?, ?, 'no-queued-items', ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    run_mode,
                    execute_int,
                    safe_limit,
                    now,
                    now,
                    str(run_root),
                    _json_text({
                        "bridgeQueuedCount": 0,
                        "excludedAssetCount": len(excluded_asset_ids),
                        "r2UploadPerformed": False,
                        "executeUpload": execute_upload,
                    }),
                    now,
                    now,
                ),
            )
            return {
                "ok": True,
                "mode": run_mode,
                "runId": run_id,
                "status": "no-queued-items",
                "count": 0,
                "spoolRoot": str(run_root),
                "r2UploadPerformed": False,
                "summary": {
                    "bridgeQueuedCount": 0,
                    "excludedAssetCount": len(excluded_asset_ids),
                    "r2UploadPerformed": False,
                    "executeUpload": execute_upload,
                },
                "message": (
                    "No unattempted Upload Bridge rows remain in this batch."
                    if excluded_asset_ids
                    else "No active Upload Bridge rows are queued."
                ),
            }
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
        selected_rows = rows
        if execute_upload and not allow_r2_overwrite:
            selected_rows = []
            skipped_covered = 0
            for row in rows:
                asset_id = str(row["asset_id"])
                keys = planned_key_sets.get(asset_id, [])
                missing_keys = [
                    key
                    for key in keys
                    if current_r2.get((key["bucket"], key["key"])) is None
                ]
                if missing_keys:
                    selected_rows = [row]
                    break
                skipped_covered += 1
            if not selected_rows:
                conn.execute(
                    """
                    INSERT INTO sidecar_upload_bridge_runs
                      (run_id, mode, status, execute_upload, limit_count, started_at, completed_at,
                       spool_root, summary_json, created_at, updated_at)
                    VALUES (?, ?, 'no-uploadable-items', ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        run_id,
                        run_mode,
                        execute_int,
                        safe_limit,
                        now,
                        now,
                        str(run_root),
                        _json_text({
                            "bridgeQueuedCount": len(rows),
                            "skippedCoveredCount": skipped_covered,
                            "r2UploadPerformed": False,
                            "executeUpload": execute_upload,
                        }),
                        now,
                        now,
                    ),
                )
                return {
                    "ok": True,
                    "mode": run_mode,
                    "runId": run_id,
                    "status": "no-uploadable-items",
                    "count": 0,
                    "spoolRoot": str(run_root),
                    "r2UploadPerformed": False,
                    "summary": {
                        "bridgeQueuedCount": len(rows),
                        "skippedCoveredCount": skipped_covered,
                        "r2UploadPerformed": False,
                        "executeUpload": execute_upload,
                    },
                    "message": "All active Upload Bridge rows already have their planned R2 keys covered.",
                }
        else:
            selected_rows = rows[:1]

        conn.execute(
            """
            INSERT INTO sidecar_upload_bridge_runs
              (run_id, mode, status, execute_upload, limit_count, started_at, spool_root,
               summary_json, created_at, updated_at)
            VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                run_mode,
                execute_int,
                safe_limit,
                now,
                str(run_root),
                _json_text({"bridgeQueuedCount": len(selected_rows), "r2UploadPerformed": False, "executeUpload": execute_upload}),
                now,
                now,
            ),
        )
        ledger_items: list[dict[str, Any]] = []
        for row in selected_rows:
            asset_id = str(row["asset_id"])
            planned_keys: list[dict[str, Any]] = []
            item_collision_count = 0
            for key in planned_key_sets.get(asset_id, []):
                current = current_r2.get((key["bucket"], key["key"]))
                if current is not None:
                    item_collision_count += 1
                planned_keys.append({
                    **key,
                    "exists": current is not None,
                    **({"existing": current} if current else {}),
                })
            run_item_id = uuid.uuid4().hex
            conn.execute(
                """
                INSERT INTO sidecar_upload_bridge_run_items
                  (run_item_id, run_id, asset_id, photo_id, filename, media_type, queued_at,
                   status, export_status, planned_keys_json, editorial_version_hash, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'planned', 'planned', ?, ?, ?, ?)
                """,
                (
                    run_item_id,
                    run_id,
                    asset_id,
                    photo_ids.get(asset_id, ""),
                    row["filename"] or "",
                    row["media_type"] or "",
                    row["uploaded_at"] or "",
                    _json_text(planned_keys),
                    editorial_version_hash(conn, asset_id),
                    now,
                    now,
                ),
            )
            ledger_items.append({
                "runItemId": run_item_id,
                "assetId": asset_id,
                "photoId": photo_ids.get(asset_id, ""),
                "filename": row["filename"] or "",
                "capturedAt": row["captured_at"] or "",
                "mediaType": row["media_type"] or "",
                "queuedAt": row["uploaded_at"] or "",
                "collisionCount": item_collision_count,
                "editorialVersionHash": editorial_version_hash(conn, asset_id),
                "plannedKeys": planned_keys,
            })

    item = ledger_items[0]
    export_payload: dict[str, Any] | None = None
    export_error = ""
    export_status = "planned"
    export_path = ""
    export_bytes: int | None = None
    item_status = "planned"
    run_status = "running"
    upload_status = "not_requested"
    upload_results: list[dict[str, Any]] = []
    upload_error = ""
    try:
        export_payload = _run_apple_photos_materialize_one(
            repo_root,
            asset_id=item["assetId"],
            destination=export_root,
            allow_icloud_downloads=allow_icloud_downloads,
        )
        exported_item = (export_payload.get("items") or [{}])[0]
        if isinstance(exported_item, dict):
            export_status = str(exported_item.get("status") or "")
            export_path = str(exported_item.get("path") or "")
            export_error = str(exported_item.get("reason") or exported_item.get("error") or "")
        materialized_count = int(export_payload.get("materializedCount") or 0)
        if export_path and Path(export_path).exists():
            export_bytes = Path(export_path).stat().st_size
        if materialized_count > 0 and export_path:
            item_status = "exported"
            run_status = "exported"
            if execute_upload:
                upload_results = _upload_bridge_execute_r2(
                    planned_keys=item.get("plannedKeys") or [],
                    export_path=Path(export_path),
                    media_type=str(item.get("mediaType") or ""),
                    artifact_root=run_root / "public-artifacts",
                    allow_r2_overwrite=allow_r2_overwrite,
                    backend=r2_backend,
                    retries=r2_retries,
                    request_min_interval=r2_request_min_interval,
                    retry_max_delay=r2_retry_max_delay,
                    s3_account_id=r2_s3_account_id,
                    s3_access_key_id=r2_s3_access_key_id,
                    s3_secret_access_key=r2_s3_secret_access_key,
                    s3_endpoint=r2_s3_endpoint,
                )
                failed_uploads = [result for result in upload_results if result.get("status") == "failed"]
                skipped_uploads = [result for result in upload_results if result.get("status") == "skipped_collision"]
                if failed_uploads:
                    upload_status = "failed"
                    item_status = "upload_failed"
                    run_status = "upload_failed"
                    upload_error = "; ".join(str(result.get("error") or "") for result in failed_uploads if result.get("error"))
                elif skipped_uploads:
                    upload_status = "uploaded_with_skips"
                    item_status = "uploaded_with_skips"
                    run_status = "uploaded_with_skips"
                else:
                    upload_status = "uploaded"
                    item_status = "uploaded"
                    run_status = "uploaded"
        else:
            item_status = "export_failed"
            run_status = "export_failed"
            export_error = export_error or "Apple Photos bridge did not materialize an export file."
    except Exception as error:  # noqa: BLE001 - ledger must capture bridge failures.
        message = str(error)
        if item_status == "exported" and execute_upload:
            item_status = "upload_failed"
            run_status = "upload_failed"
            upload_status = "failed"
            upload_error = message
        else:
            item_status = "export_failed"
            run_status = "export_failed"
            export_status = "failed"
            export_error = message

    completed_at = now_iso()
    uploaded_key_count = sum(1 for result in upload_results if result.get("status") == "uploaded")
    skipped_collision_count = sum(1 for result in upload_results if result.get("status") == "skipped_collision")
    failed_upload_count = sum(1 for result in upload_results if result.get("status") == "failed")
    if upload_status == "failed" and not upload_results:
        failed_upload_count = 1
    run_error = export_error or upload_error
    run_summary = {
        "bridgeQueuedCount": len(ledger_items),
        "exportedCount": 1 if export_path and item_status != "export_failed" else 0,
        "failedCount": 1 if item_status in {"export_failed", "upload_failed"} else 0,
        "r2UploadPerformed": bool(execute_upload and upload_results),
        "executeUpload": execute_upload,
        "allowR2Overwrite": allow_r2_overwrite,
        "uploadedKeyCount": uploaded_key_count,
        "skippedCollisionCount": skipped_collision_count,
        "failedUploadCount": failed_upload_count,
    }
    with connect(repo_root) as conn:
        if item_status == "export_failed":
            _record_upload_bridge_export_block(
                conn,
                asset_id=str(item.get("assetId") or ""),
                status=export_status or item_status,
                error=export_error,
                failed_at=completed_at,
            )
        elif item_status in {"exported", "uploaded", "uploaded_with_skips"}:
            _clear_upload_bridge_export_block(conn, str(item.get("assetId") or ""), completed_at)
        conn.execute(
            """
            UPDATE sidecar_upload_bridge_run_items
            SET status = ?, export_status = ?, export_path = ?, export_bytes = ?,
                upload_status = ?, upload_keys_json = ?, upload_error_text = ?,
                error_text = ?, updated_at = ?
            WHERE run_item_id = ?
            """,
            (
                item_status,
                export_status,
                export_path,
                export_bytes,
                upload_status,
                _json_text(upload_results),
                upload_error,
                export_error,
                completed_at,
                item["runItemId"],
            ),
        )
        conn.execute(
            """
            UPDATE sidecar_upload_bridge_runs
            SET status = ?, completed_at = ?, error_text = ?, summary_json = ?, updated_at = ?
            WHERE run_id = ?
            """,
            (
                run_status,
                completed_at,
                run_error,
                _json_text(run_summary),
                completed_at,
                run_id,
            ),
        )

    item["status"] = item_status
    item["export"] = {
        "status": export_status,
        "path": export_path,
        "bytes": export_bytes,
        "error": export_error,
        "allowIcloudDownloads": allow_icloud_downloads,
    }
    item["upload"] = {
        "status": upload_status,
        "keys": upload_results,
        "error": upload_error,
        "allowR2Overwrite": allow_r2_overwrite,
    }
    if export_payload:
        item["photosBridge"] = {
            "mode": export_payload.get("mode"),
            "materializedCount": export_payload.get("materializedCount"),
            "sidecar": export_payload.get("sidecar"),
        }
    return {
        "ok": item_status in {"exported", "uploaded", "uploaded_with_skips"},
        "mode": run_mode,
        "runId": run_id,
        "status": run_status,
        "spoolRoot": str(run_root),
        "exportRoot": str(export_root),
        "r2UploadPerformed": bool(execute_upload and upload_results),
        "executeUpload": execute_upload,
        "count": len(ledger_items),
        "items": [item],
        "summary": run_summary,
        "message": (
            "Apple Photos export and guarded R2 upload completed; Owner catalog registration was not performed."
            if execute_upload
            else "Apple Photos export dry run completed; no R2 writes or Owner catalog registration were performed."
        ),
    }


def upload_plan(
    repo_root: Path,
    limit: int = 500,
    asset_ids: Iterable[str] | None = None,
    *,
    fixture_authorized_asset_ids: Iterable[str] | None = None,
) -> dict[str, Any]:
    safe_limit = max(1, min(int(limit or 500), 5000))
    requested_ids = list(dict.fromkeys(str(asset_id) for asset_id in (asset_ids or ()) if str(asset_id)))
    scoped = asset_ids is not None
    scope_sql = ""
    scope_params: list[Any] = []
    if scoped:
        if requested_ids:
            scope_sql = f"AND d.asset_id IN ({','.join('?' for _ in requested_ids)})"
            scope_params = requested_ids
        else:
            scope_sql = "AND 0"
    with connect(repo_root) as conn:
        fixture_authorized_ids = _fixture_authorized_upload_asset_ids(
            conn,
            fixture_authorized_asset_ids,
        )
        picked_predicate = """
          (
            d.pick_state = 'picked'
            OR EXISTS (
              SELECT 1
              FROM sidecar_fixture_authorized_upload_assets AS authorized
              WHERE authorized.asset_id = d.asset_id
            )
          )
        """
        approved_predicate = """
          (
            (d.pick_state = 'picked' AND d.metadata_state = 'approved')
            OR EXISTS (
              SELECT 1
              FROM sidecar_fixture_authorized_upload_assets AS authorized
              WHERE authorized.asset_id = d.asset_id
            )
          )
        """
        readiness = conn.execute(
            f"""
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
            WHERE {picked_predicate} AND t.asset_id IS NULL
              {scope_sql}
            """,
            scope_params,
        ).fetchone()
        raw_rows = conn.execute(
            f"""
            SELECT a.*, d.rating, d.color, d.pick_state, d.metadata_state, d.title, d.keywords_json
            FROM sidecar_decisions AS d
            JOIN sidecar_assets AS a ON a.asset_id = d.asset_id
            WHERE {approved_predicate}
              {scope_sql}
              AND NOT EXISTS (
                SELECT 1 FROM sidecar_tombstones AS t
                WHERE t.asset_id = d.asset_id AND t.tombstone_state = 'active'
              )
              AND NOT EXISTS (
                SELECT 1 FROM sidecar_mock_uploads AS m
                WHERE m.asset_id = d.asset_id AND m.mock_state = 'active'
              )
            ORDER BY a.captured_at DESC, a.asset_id
            """,
            scope_params,
        ).fetchall()
        metadata_blocked_rows = [
            row
            for row in raw_rows
            if not _upload_bridge_metadata_ready(
                row,
                allow_missing_gallery=str(row["asset_id"]) in fixture_authorized_ids,
            )
        ]
        rows = [
            row
            for row in raw_rows
            if _upload_bridge_metadata_ready(
                row,
                allow_missing_gallery=str(row["asset_id"]) in fixture_authorized_ids,
            )
        ][:safe_limit]
        mock_upload_summary = _mock_upload_summary(
            conn,
            asset_ids=requested_ids if scoped else None,
            fixture_authorized_asset_ids=fixture_authorized_ids,
        )
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
            "gallerySlug": _upload_bridge_gallery_slug(row),
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
        "metadataBlockedCount": len(metadata_blocked_rows),
        "metadataBlockedExamples": [
            {
                "assetId": row["asset_id"],
                "filename": row["filename"] or "",
                "title": row["title"] or "",
                "reason": _upload_bridge_metadata_block_reason(row),
            }
            for row in metadata_blocked_rows[:12]
        ],
        "mockUploadedCount": int(readiness["mock_uploaded_count"] or 0),
        "mockUploadSummary": mock_upload_summary,
        "bridgeQueuedCount": int(readiness["mock_uploaded_count"] or 0),
        "uploadableItemCount": int(mock_upload_summary.get("uploadableItemCount") or 0),
        "fullyCoveredItemCount": int(mock_upload_summary.get("fullyCoveredItemCount") or 0),
        "partiallyCoveredItemCount": int(mock_upload_summary.get("partiallyCoveredItemCount") or 0),
        "coveredKeyCount": int(mock_upload_summary.get("coveredKeyCount") or 0),
        "missingKeyCount": int(mock_upload_summary.get("missingKeyCount") or 0),
        "plannedKeyCount": int(mock_upload_summary.get("plannedKeyCount") or 0),
        "blockedExportFailureCount": int(mock_upload_summary.get("blockedExportFailureCount") or 0),
        "blockedExportAttemptCount": int(mock_upload_summary.get("blockedExportAttemptCount") or 0),
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


def _ai_queue_active_predicate(*, rework_only: bool) -> str:
    metadata_scope = "AND d.metadata_state = 'rework'" if rework_only else ""
    return f"""
      d.pick_state = 'picked'
      AND (a.missing_at IS NULL OR a.missing_at = '')
      AND NOT EXISTS (
        SELECT 1 FROM sidecar_tombstones AS t
        WHERE t.asset_id = d.asset_id AND t.tombstone_state = 'active'
      )
      AND NOT EXISTS (
        SELECT 1 FROM sidecar_mock_uploads AS m
        WHERE m.asset_id = d.asset_id AND m.mock_state = 'active'
      )
      AND NOT EXISTS (
        SELECT 1 FROM sidecar_upload_bridge_run_items AS bridge
        WHERE bridge.asset_id = d.asset_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM sidecar_upload_bridge_asset_blocks AS block
        WHERE block.asset_id = d.asset_id AND block.block_state = 'active'
      )
      {metadata_scope}
    """


def ai_metadata_plan(
    repo_root: Path,
    limit: int = 200,
    asset_ids: Iterable[Any] | None = None,
    *,
    rework_only: bool = False,
) -> dict[str, Any]:
    """Plan picked Sidecar rows, optionally restricting the queue to rework."""
    safe_limit = max(1, min(int(limit or 200), 5000))
    scoped_asset_ids = _normalize_asset_id_scope(asset_ids)
    asset_scope_sql = ""
    asset_scope_params: list[Any] = []
    if scoped_asset_ids:
        asset_scope_sql = f" AND d.asset_id IN ({','.join('?' for _ in scoped_asset_ids)})"
        asset_scope_params = scoped_asset_ids
    active_item_predicate = _ai_queue_active_predicate(rework_only=rework_only)
    actionable_ai_predicate = """d.metadata_state = 'rework'""" if rework_only else """
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
              COUNT(CASE WHEN {actionable_ai_predicate} THEN 1 END) AS candidate_count,
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
              d.rework_category, d.rework_comment,
              d.metadata_ai_attempt_count, d.metadata_ai_last_error, d.metadata_ai_last_attempt_at
            FROM sidecar_decisions AS d
            JOIN sidecar_assets AS a ON a.asset_id = d.asset_id
            WHERE {active_item_predicate}
              {asset_scope_sql}
              AND {actionable_ai_predicate}
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
            "metadataAiAttemptCount": max(0, int(row["metadata_ai_attempt_count"] or 0)),
            "metadataAiLastError": row["metadata_ai_last_error"] or "",
            "metadataAiLastAttemptAt": row["metadata_ai_last_attempt_at"] or "",
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
        "mode": "picked-only-ai-metadata-rework-plan" if rework_only else "picked-only-ai-metadata-plan",
        "reworkOnly": bool(rework_only),
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
        "message": (
            "Only explicitly picked Sidecar rework items are eligible for this nightly AI metadata lane."
            if rework_only
            else "Only picked, not-approved Sidecar items are eligible for this AI metadata planning lane."
        ),
    }


def _useful_proposal_title(title: str, keywords: Iterable[Any] = ()) -> bool:
    value = str(title or "").strip()
    return bool(
        value
        and not re.fullmatch(r"\d{4}", value)
        and (_title_has_public_place_subject(value) or not _title_is_location_only(value, keywords))
    )


def _begin_ai_metadata_attempt(
    conn: sqlite3.Connection,
    asset_id: str,
    now: str,
    *,
    rework_only: bool,
) -> bool:
    metadata_scope = "AND metadata_state = 'rework'" if rework_only else ""
    result = conn.execute(
        f"""
        UPDATE sidecar_decisions
        SET metadata_ai_attempt_count = COALESCE(metadata_ai_attempt_count, 0) + 1,
            metadata_ai_last_error = '',
            metadata_ai_last_attempt_at = ?,
            updated_at = ?
        WHERE asset_id = ?
          AND pick_state = 'picked'
          AND metadata_state != 'approved'
          {metadata_scope}
          AND EXISTS (
            SELECT 1 FROM sidecar_assets AS a
            WHERE a.asset_id = sidecar_decisions.asset_id
              AND (a.missing_at IS NULL OR a.missing_at = '')
          )
          AND NOT EXISTS (
            SELECT 1 FROM sidecar_tombstones AS t
            WHERE t.asset_id = sidecar_decisions.asset_id AND t.tombstone_state = 'active'
          )
          AND NOT EXISTS (
            SELECT 1 FROM sidecar_mock_uploads AS m
            WHERE m.asset_id = sidecar_decisions.asset_id AND m.mock_state = 'active'
          )
          AND NOT EXISTS (
            SELECT 1 FROM sidecar_upload_bridge_run_items AS bridge
            WHERE bridge.asset_id = sidecar_decisions.asset_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM sidecar_upload_bridge_asset_blocks AS block
            WHERE block.asset_id = sidecar_decisions.asset_id AND block.block_state = 'active'
          )
        """,
        (now, now, asset_id),
    )
    return bool(result.rowcount)


def _record_ai_metadata_failure(
    conn: sqlite3.Connection,
    asset_id: str,
    error: Any,
    now: str,
) -> None:
    message = str(error or "AI metadata attempt failed").strip()[:2000]
    conn.execute(
        """
        UPDATE sidecar_decisions
        SET metadata_ai_last_error = ?,
            metadata_ai_last_attempt_at = COALESCE(NULLIF(metadata_ai_last_attempt_at, ''), ?),
            updated_at = ?
        WHERE asset_id = ?
        """,
        (message, now, now, asset_id),
    )


def apply_ai_metadata_proposals(
    repo_root: Path,
    limit: int = 20,
    max_rung: str = "filename-gps",
    asset_ids: Iterable[Any] | None = None,
    *,
    rework_only: bool = False,
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
    plan = ai_metadata_plan(
        repo_root,
        limit=safe_limit,
        asset_ids=scoped_asset_ids,
        rework_only=rework_only,
    )
    now = now_iso()
    proposed: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    with connect(repo_root) as conn:
        keyword_blacklist = _keyword_blacklist_set(conn, repo_root)
        for item in plan["items"]:
            asset_id = str(item.get("assetId") or "").strip()
            if not asset_id:
                continue
            if not _begin_ai_metadata_attempt(conn, asset_id, now, rework_only=rework_only):
                skipped.append({
                    "assetId": asset_id,
                    "filename": str(item.get("filename") or ""),
                    "reason": "no_longer_eligible",
                })
                continue
            attempt_count = int(item.get("metadataAiAttemptCount") or 0) + 1

            def skip(reason: str, **details: Any) -> None:
                _record_ai_metadata_failure(conn, asset_id, reason, now)
                skipped.append({
                    "assetId": asset_id,
                    "filename": str(item.get("filename") or ""),
                    "reason": reason,
                    "metadataAiAttemptCount": attempt_count,
                    **details,
                })

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
                skip("requires_stronger_ai_rung", recommendedAiRung=recommended_rung)
                continue
            if not _useful_proposal_title(title, keywords):
                skip("missing_useful_title_seed", recommendedAiRung=recommended_rung)
                continue
            if not keywords:
                skip("missing_keyword_seed", recommendedAiRung=recommended_rung)
                continue
            result = conn.execute(
                f"""
                UPDATE sidecar_decisions
                SET metadata_state = 'proposed',
                    title = ?,
                    keywords_json = ?,
                    rework_category = '',
                    rework_comment = '',
                    metadata_ai_rung = ?,
                    metadata_ai_evidence_json = ?,
                    metadata_ai_note = ?,
                    metadata_ai_last_error = '',
                    last_action = 'ai-metadata-proposal',
                    updated_at = ?
                WHERE asset_id = ?
                  AND pick_state = 'picked'
                  AND metadata_state != 'approved'
                  {"AND metadata_state = 'rework'" if rework_only else ""}
                  AND NOT EXISTS (
                    SELECT 1 FROM sidecar_tombstones AS t
                    WHERE t.asset_id = sidecar_decisions.asset_id AND t.tombstone_state = 'active'
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM sidecar_mock_uploads AS m
                    WHERE m.asset_id = sidecar_decisions.asset_id AND m.mock_state = 'active'
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM sidecar_upload_bridge_run_items AS bridge
                    WHERE bridge.asset_id = sidecar_decisions.asset_id
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM sidecar_upload_bridge_asset_blocks AS block
                    WHERE block.asset_id = sidecar_decisions.asset_id AND block.block_state = 'active'
                  )
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
                    "metadataState": "proposed",
                    "pickState": "picked",
                    "metadataAiAttemptCount": attempt_count,
                    "metadataAiLastError": "",
                })
    return {
        "ok": True,
        "mode": "picked-only-ai-metadata-rework-proposals" if rework_only else "picked-only-ai-metadata-proposals",
        "reworkOnly": bool(rework_only),
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


def _proposal_items_from_payload(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        raw_items = payload
    elif isinstance(payload, dict):
        raw_items = payload.get("proposals") or payload.get("updates") or payload.get("items") or []
    else:
        raw_items = []
    return [item for item in raw_items if isinstance(item, dict)]


def apply_ai_metadata_vision_proposals(
    repo_root: Path,
    payload: Any,
    preview_manifest: Any | None = None,
    dry_run: bool = False,
    *,
    rework_only: bool = False,
) -> dict[str, Any]:
    """Apply reviewed preview/vision proposals to picked Sidecar Review rows.

    This intentionally writes only local Review proposals. Owner approval is still
    required before Photos write-back or upload eligibility.
    """
    items = _proposal_items_from_payload(payload)
    preview_items = _proposal_items_from_payload(preview_manifest)
    preview_by_asset_id = {
        str(item.get("assetId") or "").strip(): item
        for item in preview_items
        if str(item.get("assetId") or "").strip()
    }
    now = now_iso()
    proposed: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    seen_asset_ids: set[str] = set()
    attempted_asset_ids: set[str] = set()
    with connect(repo_root) as conn:
        keyword_blacklist = _keyword_blacklist_set(conn, repo_root)
        for item in items:
            asset_id = str(item.get("assetId") or item.get("asset_id") or "").strip()
            if not asset_id:
                skipped.append({"assetId": "", "reason": "missing_asset_id"})
                continue
            if asset_id in seen_asset_ids:
                skipped.append({"assetId": asset_id, "reason": "duplicate_asset_id"})
                continue
            seen_asset_ids.add(asset_id)

            row = conn.execute(
                f"""
                SELECT
                  a.filename, a.media_type, a.location_label, a.location_keywords_json,
                  a.metadata_seed_keywords_json, a.missing_at,
                  d.metadata_state, d.pick_state, d.metadata_ai_attempt_count
                FROM sidecar_decisions AS d
                JOIN sidecar_assets AS a ON a.asset_id = d.asset_id
                WHERE d.asset_id = ?
                  AND (a.missing_at IS NULL OR a.missing_at = '')
                  AND NOT EXISTS (
                    SELECT 1 FROM sidecar_tombstones AS t
                    WHERE t.asset_id = d.asset_id AND t.tombstone_state = 'active'
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM sidecar_mock_uploads AS m
                    WHERE m.asset_id = d.asset_id AND m.mock_state = 'active'
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM sidecar_upload_bridge_run_items AS bridge
                    WHERE bridge.asset_id = d.asset_id
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM sidecar_upload_bridge_asset_blocks AS block
                    WHERE block.asset_id = d.asset_id AND block.block_state = 'active'
                  )
                  {"AND d.metadata_state = 'rework'" if rework_only else ""}
                """,
                (asset_id,),
            ).fetchone()
            if row is None:
                skipped.append({"assetId": asset_id, "reason": "asset_not_found"})
                continue
            if str(row["pick_state"] or "") != "picked":
                skipped.append({
                    "assetId": asset_id,
                    "filename": str(row["filename"] or ""),
                    "reason": "not_picked",
                })
                continue
            if str(row["metadata_state"] or "") == "approved":
                skipped.append({
                    "assetId": asset_id,
                    "filename": str(row["filename"] or ""),
                    "reason": "already_approved",
                })
                continue

            attempt_count = int(row["metadata_ai_attempt_count"] or 0)
            if not dry_run:
                if not _begin_ai_metadata_attempt(conn, asset_id, now, rework_only=rework_only):
                    skipped.append({
                        "assetId": asset_id,
                        "filename": str(row["filename"] or ""),
                        "reason": "no_longer_eligible",
                    })
                    continue
                attempted_asset_ids.add(asset_id)
                attempt_count += 1

            preview = preview_by_asset_id.get(asset_id)
            if preview_manifest is not None and not preview:
                skipped.append({
                    "assetId": asset_id,
                    "filename": str(row["filename"] or ""),
                    "reason": "missing_preview_manifest_row",
                })
                continue
            if preview and not preview.get("ok"):
                skipped.append({
                    "assetId": asset_id,
                    "filename": str(row["filename"] or ""),
                    "reason": "preview_export_failed",
                })
                continue

            title = _seedable_title(item.get("title") or item.get("proposedTitle"))
            seed_keywords = _read_json_text(row["metadata_seed_keywords_json"], [])
            location_keywords = _read_json_text(row["location_keywords_json"], [])
            keywords = _clean_keywords(
                _dedupe_text([*location_keywords, *seed_keywords, *(item.get("keywords") or item.get("proposedKeywords") or [])]),
                keyword_blacklist,
            )
            if not _useful_proposal_title(title, keywords):
                skipped.append({
                    "assetId": asset_id,
                    "filename": str(row["filename"] or ""),
                    "reason": "missing_useful_title",
                })
                continue
            if not keywords:
                skipped.append({
                    "assetId": asset_id,
                    "filename": str(row["filename"] or ""),
                    "reason": "missing_keywords",
                })
                continue

            evidence = _dedupe_text([
                "preview-vision",
                *(item.get("evidence") or item.get("metadataAiEvidence") or []),
                *(["preview-manifest"] if preview else []),
            ])
            preview_path = str((preview or {}).get("previewPath") or item.get("previewPath") or "").strip()
            if preview_path:
                evidence.append("preview-path")
            note_parts = [
                str(item.get("note") or item.get("metadataAiNote") or "Vision proposal from exported Sidecar preview.").strip(),
                f"Preview: {preview_path}" if preview_path else "",
            ]
            note = " ".join(part for part in note_parts if part)

            if not dry_run:
                result = conn.execute(
                    f"""
                    UPDATE sidecar_decisions
                    SET metadata_state = 'proposed',
                        title = ?,
                        keywords_json = ?,
                        rework_category = '',
                        rework_comment = '',
                        metadata_ai_rung = 'vision-description',
                        metadata_ai_evidence_json = ?,
                        metadata_ai_note = ?,
                        metadata_ai_last_error = '',
                        last_action = 'ai-metadata-proposal',
                        updated_at = ?
                    WHERE asset_id = ?
                      AND pick_state = 'picked'
                      AND metadata_state != 'approved'
                      {"AND metadata_state = 'rework'" if rework_only else ""}
                      AND NOT EXISTS (
                        SELECT 1 FROM sidecar_tombstones AS t
                        WHERE t.asset_id = sidecar_decisions.asset_id AND t.tombstone_state = 'active'
                      )
                      AND NOT EXISTS (
                        SELECT 1 FROM sidecar_mock_uploads AS m
                        WHERE m.asset_id = sidecar_decisions.asset_id AND m.mock_state = 'active'
                      )
                      AND NOT EXISTS (
                        SELECT 1 FROM sidecar_upload_bridge_run_items AS bridge
                        WHERE bridge.asset_id = sidecar_decisions.asset_id
                      )
                      AND NOT EXISTS (
                        SELECT 1 FROM sidecar_upload_bridge_asset_blocks AS block
                        WHERE block.asset_id = sidecar_decisions.asset_id AND block.block_state = 'active'
                      )
                    """,
                    (
                        title,
                        _json_text(keywords),
                        _json_text(evidence),
                        note,
                        now,
                        asset_id,
                    ),
                )
                if not result.rowcount:
                    skipped.append({
                        "assetId": asset_id,
                        "filename": str(row["filename"] or ""),
                        "reason": "update_not_applied",
                    })
                    continue

            proposed.append({
                "assetId": asset_id,
                "filename": str(row["filename"] or ""),
                "title": title,
                "keywords": keywords,
                "locationLabel": str(row["location_label"] or ""),
                "metadataAiRung": "vision-description",
                "metadataAiEvidence": evidence,
                "metadataAiNote": note,
                "metadataState": "proposed",
                "pickState": "picked",
                "metadataAiAttemptCount": attempt_count,
                "metadataAiLastError": "",
                "dryRun": dry_run,
            })
        if not dry_run:
            for skipped_item in skipped:
                skipped_asset_id = str(skipped_item.get("assetId") or "").strip()
                if skipped_asset_id and skipped_asset_id in attempted_asset_ids:
                    _record_ai_metadata_failure(conn, skipped_asset_id, skipped_item.get("reason"), now)
    return {
        "ok": True,
        "mode": "picked-only-ai-metadata-rework-vision-proposals" if rework_only else "picked-only-ai-metadata-vision-proposals",
        "dryRun": dry_run,
        "reworkOnly": bool(rework_only),
        "inputCount": len(items),
        "proposedCount": len(proposed),
        "skippedCount": len(skipped),
        "proposed": proposed,
        "skipped": skipped,
        "message": "Wrote vision-backed Sidecar Review proposals only; no Photos write-back rows were queued.",
    }


def sidecar_sync_status(repo_root: Path, limit: int = 80) -> dict[str, Any]:
    """Summarize the planned nightly Photos index, AI metadata, and write-back lanes."""
    safe_limit = max(1, min(int(limit or 80), 500))
    sidecar_summary = summary(repo_root)
    ai_plan = ai_metadata_plan(repo_root, limit=safe_limit, rework_only=True)
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
            "reworkOnly": True,
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
            "aiMetadata": "planned-picked-rework-only",
            "photosWriteBack": "explicit-commit-only",
        },
    }


def _planned_r2_keys(row: sqlite3.Row, *, include_private_renders: bool = False) -> tuple[str, list[dict[str, str]]]:
    row_keys = set(row.keys())
    canonical_anchor = row["r2_source_anchor"] if "r2_source_anchor" in row_keys else ""
    source_anchor = str(canonical_anchor or row["source_anchor"] or f"apple-photos://{row['asset_id']}")
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
    planned_pairs = {(str(item["bucket"]), str(item["key"])) for item in planned_keys}
    try:
        conn.execute(
            """
            CREATE TEMP TABLE IF NOT EXISTS sidecar_planned_r2_keys (
              bucket TEXT NOT NULL,
              object_key TEXT NOT NULL,
              PRIMARY KEY (bucket, object_key)
            ) WITHOUT ROWID
            """
        )
        conn.execute("DELETE FROM sidecar_planned_r2_keys")
        conn.executemany(
            "INSERT OR IGNORE INTO sidecar_planned_r2_keys (bucket, object_key) VALUES (?, ?)",
            planned_pairs,
        )
        rows = conn.execute(
            """
            SELECT r.bucket, r.object_key, r.photo_id, r.object_kind, r.lifecycle_state, r.bytes, r.last_seen_at
            FROM sidecar_planned_r2_keys AS p
            JOIN r2_objects AS r ON r.bucket = p.bucket AND r.object_key = p.object_key
            WHERE r.lifecycle_state = 'current'
            """,
        ).fetchall()
    except sqlite3.OperationalError:
        rows = []
    current = {
        (str(row["bucket"] or ""), str(row["object_key"] or "")): {
            "photoId": str(row["photo_id"] or ""),
            "kind": str(row["object_kind"] or ""),
            "bytes": int(row["bytes"]) if row["bytes"] is not None else None,
            "lastSeenAt": str(row["last_seen_at"] or ""),
            "source": "owner-r2-objects",
        }
        for row in rows
    }
    return current


def mock_upload(
    repo_root: Path,
    asset_ids: Iterable[str] | None = None,
    limit: int = 500,
    *,
    fixture_authorized_asset_ids: Iterable[str] | None = None,
) -> dict[str, Any]:
    safe_limit = max(1, min(int(limit or 500), 5000))
    requested_ids = [str(asset_id or "").strip() for asset_id in (asset_ids or []) if str(asset_id or "").strip()]
    now = now_iso()
    run_id = uuid.uuid4().hex
    with connect(repo_root) as conn:
        fixture_authorized_ids = _fixture_authorized_upload_asset_ids(
            conn,
            fixture_authorized_asset_ids,
        )
        params: list[Any] = []
        asset_filter = ""
        if requested_ids:
            placeholders = ",".join("?" for _ in requested_ids)
            asset_filter = f"AND d.asset_id IN ({placeholders})"
            params.extend(requested_ids)
        raw_rows = conn.execute(
            f"""
            SELECT a.asset_id, a.source_anchor, a.raw_json, a.missing_at,
                   a.indexed_at, a.updated_at AS asset_updated_at,
                   a.media_type, a.filename, a.captured_at,
                   a.location_label, a.location_keywords_json, d.title, d.keywords_json
            FROM sidecar_decisions AS d
            JOIN sidecar_assets AS a ON a.asset_id = d.asset_id
            WHERE (
                (d.pick_state = 'picked' AND d.metadata_state = 'approved')
                OR EXISTS (
                  SELECT 1
                  FROM sidecar_fixture_authorized_upload_assets AS authorized
                  WHERE authorized.asset_id = d.asset_id
                )
              )
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
            """,
            params,
        ).fetchall()
        # The Photos index can retain both a retired local asset id and the
        # current cloud id for one physical item. Queue only the current owner
        # identity so a mock/real upload can never recreate two R2 families.
        by_photos_identity: dict[str, sqlite3.Row] = {}
        for row in raw_rows:
            raw = _read_json_text(row["raw_json"], {})
            local_identifier = str(raw.get("localIdentifier") or "").strip() if isinstance(raw, dict) else ""
            identity = local_identifier or str(row["asset_id"])
            current = by_photos_identity.get(identity)
            rank = (
                int(not str(row["missing_at"] or "").strip()),
                str(row["indexed_at"] or ""),
                str(row["asset_updated_at"] or ""),
                str(row["asset_id"]),
            )
            current_rank = (
                int(not str(current["missing_at"] or "").strip()),
                str(current["indexed_at"] or ""),
                str(current["asset_updated_at"] or ""),
                str(current["asset_id"]),
            ) if current is not None else None
            if current is None or rank > current_rank:
                by_photos_identity[identity] = row
        physical_rows = sorted(
            by_photos_identity.values(),
            key=lambda row: (str(row["captured_at"] or ""), str(row["asset_id"])),
            reverse=True,
        )
        metadata_blocked_rows = [
            row
            for row in physical_rows
            if not _upload_bridge_metadata_ready(
                row,
                allow_missing_gallery=str(row["asset_id"]) in fixture_authorized_ids,
            )
        ]
        rows = [
            row
            for row in physical_rows
            if _upload_bridge_metadata_ready(
                row,
                allow_missing_gallery=str(row["asset_id"]) in fixture_authorized_ids,
            )
        ][:safe_limit]
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
        rows = _upload_bridge_rows(
            conn,
            asset_ids=[str(row["asset_id"]) for row in rows],
            fixture_authorized_asset_ids=fixture_authorized_ids,
        )
        planned_key_sets: dict[str, list[dict[str, str]]] = {}
        photo_ids: dict[str, str] = {}
        all_planned_keys: list[dict[str, str]] = []
        for row in rows:
            photo_id, keys = _planned_r2_keys(row)
            photo_ids[str(row["asset_id"])] = photo_id
            planned_key_sets[str(row["asset_id"])] = keys
            all_planned_keys.extend(keys)
        current_r2 = _current_r2_objects_for_plan(conn, all_planned_keys)
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
        "metadataBlockedCount": len(metadata_blocked_rows),
        "metadataBlocked": [
            {
                "assetId": row["asset_id"],
                "filename": row["filename"] or "",
                "title": row["title"] or "",
                "reason": _upload_bridge_metadata_block_reason(row),
            }
            for row in metadata_blocked_rows[:50]
        ],
        "collisionCount": collision_count,
        "coveredKeyCount": covered_key_count,
        "items": items,
        "remainingPlan": upload_plan(
            repo_root,
            limit=safe_limit,
            asset_ids=requested_ids if asset_ids is not None else None,
            fixture_authorized_asset_ids=fixture_authorized_ids,
        ),
    }


def queue_upload_bridge(
    repo_root: Path,
    asset_ids: Iterable[str] | None = None,
    limit: int = 500,
    *,
    fixture_authorized_asset_ids: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Queue upload-ready Sidecar items for the bridge using the legacy mock table."""
    result = mock_upload(
        repo_root,
        asset_ids=asset_ids,
        limit=limit,
        fixture_authorized_asset_ids=fixture_authorized_asset_ids,
    )
    result["uploadBridgePlan"] = upload_bridge_plan(
        repo_root,
        limit=limit,
        asset_ids=asset_ids,
        fixture_authorized_asset_ids=fixture_authorized_asset_ids,
    )
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
    parser.add_argument("--upload-bridge-export-one", action="store_true")
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
    elif args.upload_bridge_export_one:
        print(json.dumps(run_upload_bridge_export_dry_run(repo_root), indent=2))
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
