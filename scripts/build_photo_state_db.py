#!/usr/bin/env python3
"""Build an inspectable SQLite database from Photos By Elie state manifests."""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


DEFAULT_OUTPUT = Path("tmp/photo-state.sqlite")
IMPORT_CACHE_MANIFEST = Path("tmp/import-cache/manifest.json")
MANIFEST_PATHS = [
    ("import-cache", IMPORT_CACHE_MANIFEST),
    ("expo-manifest", Path("assets/expo-manifest.json")),
    ("private-delivery", Path("assets/private-delivery-manifest.json")),
    ("media-sidecar", Path("assets/media-sidecar.json")),
    ("hidden-blacklist", Path("assets/hidden/hidden-blacklist.json")),
    ("hidden-data", Path("assets/hidden/hidden-data.json")),
    ("reserve-data", Path("assets/owner-actions/reserve-data.json")),
    ("discarded-tombstone", Path("assets/discarded/discarded-photo-ids.json")),
    ("discarded-media", Path("assets/discarded-media-manifest.json")),
    ("country-assignments-log", Path("assets/owner-actions/country-assignments.jsonl")),
    ("country-assignments-index", Path("assets/owner-actions/country-assignments.json")),
    ("storage-estimate", Path("assets/storage-estimate.json")),
    ("home-data", Path("home-data.js")),
    ("photos-data", Path("photos-data.js")),
    ("r2-upload-log", Path(".review-logs/r2-upload-state.jsonl")),
    ("r2-delete-log", Path(".review-logs/r2-delete-state.jsonl")),
]

SCRIPT_ROOT = Path(__file__).resolve().parent
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from owner_state_db import ensure_schema as ensure_owner_schema  # noqa: E402
from owner_state_db import import_country_assignments  # noqa: E402


def load_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def load_window_data(repo_root: Path, path: Path, variable_name: str) -> Any:
    if not (repo_root / path).exists():
        return None
    script = """
const fs = require("fs");
const vm = require("vm");
const path = process.argv[1];
const variableName = process.argv[2];
const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path, "utf8"), context, { filename: path });
process.stdout.write(JSON.stringify(context.window[variableName] || null));
"""
    output = subprocess.check_output(
        ["node", "-e", script, str(repo_root / path), variable_name],
        text=True,
    )
    return json.loads(output)


def metadata_value(photo: dict[str, Any], label: str) -> str:
    for item in photo.get("metadata") or []:
        if item.get("label") == label and item.get("value") not in (None, ""):
            return str(item["value"])
    return ""


def keyword_values(photo: dict[str, Any]) -> list[str]:
    keywords = photo.get("keywords")
    if isinstance(keywords, list):
        return [str(value).strip() for value in keywords if str(value).strip()]
    raw = metadata_value(photo, "Keywords")
    if raw:
        return [value.strip() for value in raw.split(",") if value.strip()]
    return []


def capture_date(photo: dict[str, Any]) -> tuple[str, str]:
    capture = photo.get("capture") or {}
    if isinstance(capture, dict):
        return str(capture.get("date") or ""), str(capture.get("sort") or "")
    raw = metadata_value(photo, "Captured")
    if raw:
        match = re.match(r"^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})", raw)
        if match:
            year, month, day, hour, minute, second = match.groups()
            return f"{year}-{month}-{day}", f"{year}-{month}-{day}T{hour}:{minute}:{second}"
    return "", ""


def source_file(photo: dict[str, Any]) -> dict[str, Any]:
    source_files = photo.get("sourceFiles")
    if isinstance(source_files, list) and source_files:
        return source_files[0] if isinstance(source_files[0], dict) else {}
    source = photo.get("source_file")
    return source if isinstance(source, dict) else {}


def infer_photo_id_from_key(key: str) -> str:
    parts = key.split("/")
    if not parts:
        return ""
    if parts[0] == "expo":
        stem = Path(parts[-1]).stem
        return re.sub(r"_(900|1800)$", "", stem)
    if parts[0] in {"masters", "renders"} and len(parts) > 1:
        return parts[1]
    return ""


class StateBuilder:
    def __init__(self, repo_root: Path) -> None:
        self.repo_root = repo_root
        self.photos: dict[str, dict[str, Any]] = {}
        self.states: list[dict[str, Any]] = []
        self.objects: list[dict[str, Any]] = []
        self.keywords: set[tuple[str, str, str]] = set()
        self.collections: dict[str, dict[str, Any]] = {}

    def photo(self, photo_id: str) -> dict[str, Any]:
        row = self.photos.setdefault(
            photo_id,
            {
                "photo_id": photo_id,
                "state_summary": set(),
                "source_paths": set(),
                "raw_sources": [],
            },
        )
        return row

    def add_state(
        self,
        photo_id: str,
        state: str,
        source_path: str,
        collection_key: str = "",
        relative_path: str = "",
        details: dict[str, Any] | None = None,
    ) -> None:
        if not photo_id:
            return
        row = self.photo(photo_id)
        row["state_summary"].add(state)
        if source_path:
            row["source_paths"].add(source_path)
        self.states.append(
            {
                "photo_id": photo_id,
                "state": state,
                "source_path": source_path,
                "collection_key": collection_key,
                "relative_path": relative_path,
                "details_json": json.dumps(details or {}, ensure_ascii=False, sort_keys=True),
            }
        )

    def add_object(
        self,
        photo_id: str,
        object_type: str,
        key: str,
        present: bool | None,
        source_path: str,
        bucket: str = "",
        bytes_value: int | None = None,
        event_at: str = "",
        local_path: str = "",
    ) -> None:
        if not photo_id or not key:
            return
        self.objects.append(
            {
                "photo_id": photo_id,
                "object_type": object_type,
                "key": key,
                "present": None if present is None else int(bool(present)),
                "bucket": bucket,
                "bytes": bytes_value,
                "event_at": event_at,
                "local_path": local_path,
                "source_path": source_path,
            }
        )

    def absorb_photo(
        self,
        photo: dict[str, Any],
        state: str,
        source_path: str,
        collection_key: str = "",
        collection_title: str = "",
    ) -> None:
        photo_id = str(photo.get("id") or "")
        if not photo_id:
            return
        row = self.photo(photo_id)
        row.setdefault("title", "")
        row["title"] = row.get("title") or str(photo.get("title") or metadata_value(photo, "Metadata title") or "")
        row["collection_key"] = row.get("collection_key") or collection_key
        row["collection_title"] = row.get("collection_title") or collection_title
        gallery_country = photo.get("gallery_country") or {}
        row["gallery_country"] = row.get("gallery_country") or gallery_country.get("slug") or collection_key
        row["country_source"] = row.get("country_source") or gallery_country.get("source") or ""
        row["relative_path"] = row.get("relative_path") or str(photo.get("relative_path") or "")
        source = source_file(photo)
        row["source_path"] = row.get("source_path") or str(
            photo.get("source_path_hint") or source.get("path") or photo.get("relative_path") or ""
        )
        row["source_type"] = row.get("source_type") or str(source.get("type") or source.get("extension") or "")
        row["source_bytes"] = row.get("source_bytes") or source.get("bytes")
        date, sort = capture_date(photo)
        row["capture_date"] = row.get("capture_date") or date
        row["capture_sort"] = row.get("capture_sort") or sort
        dims = photo.get("dimensions") or {}
        row["megapixels"] = row.get("megapixels") or photo.get("megapixels") or dims.get("megapixels")
        row["width"] = row.get("width") or dims.get("width")
        row["height"] = row.get("height") or dims.get("height")
        row["orientation"] = row.get("orientation") or dims.get("orientation")
        media = photo.get("media") or {}
        preview = media.get("publicPreview") or {}
        row["public_gallery_key"] = row.get("public_gallery_key") or preview.get("galleryKey") or ""
        row["public_detail_key"] = row.get("public_detail_key") or preview.get("detailKey") or ""
        row["raw_sources"].append(source_path)

        self.add_state(photo_id, state, source_path, collection_key, row.get("relative_path") or "", photo)
        for keyword in keyword_values(photo):
            self.keywords.add((photo_id, keyword, source_path))

    def absorb_collections(self, payload: dict[str, Any] | None, state: str, source_path: str) -> None:
        if not isinstance(payload, dict):
            return
        for collection_key, collection in payload.items():
            if not isinstance(collection, dict):
                continue
            title = str(collection.get("title") or collection_key)
            photos = collection.get("photos") or []
            self.collections[f"{state}:{collection_key}"] = {
                "source_path": source_path,
                "state": state,
                "collection_key": collection_key,
                "title": title,
                "photo_count": len(photos) if isinstance(photos, list) else 0,
            }
            if isinstance(photos, list):
                for photo in photos:
                    if isinstance(photo, dict):
                        self.absorb_photo(photo, state, source_path, collection_key, title)

    def absorb_import_cache(self, payload: dict[str, Any] | None) -> None:
        if not isinstance(payload, dict):
            return
        for photo in payload.get("photos") or []:
            if isinstance(photo, dict):
                self.absorb_photo(photo, "import_cache", str(IMPORT_CACHE_MANIFEST), (photo.get("gallery_country") or {}).get("slug") or "")
                r2 = photo.get("r2") or {}
                for item in r2.get("public_previews") or []:
                    self.add_object(photo["id"], "public_preview", item.get("key") or "", True, str(IMPORT_CACHE_MANIFEST))
                if r2.get("private_master"):
                    self.add_object(photo["id"], "private_master", r2["private_master"].get("key") or "", True, str(IMPORT_CACHE_MANIFEST))
                for item in r2.get("private_renders") or []:
                    self.add_object(photo["id"], "private_render", item.get("key") or "", True, str(IMPORT_CACHE_MANIFEST))

    def absorb_expo_manifest(self, payload: dict[str, Any] | None) -> None:
        if not isinstance(payload, dict):
            return
        for photo in payload.get("photos") or []:
            if not isinstance(photo, dict):
                continue
            self.absorb_photo(photo, "expo_manifest", "assets/expo-manifest.json", (photo.get("gallery_country") or {}).get("slug") or "")

    def absorb_private_delivery(self, payload: dict[str, Any] | None) -> None:
        if not isinstance(payload, dict):
            return
        records = payload.get("records") or {}
        for photo_id, record in records.items():
            if not isinstance(record, dict):
                continue
            row = self.photo(str(photo_id))
            row["collection_key"] = row.get("collection_key") or record.get("collectionKey") or ""
            row["source_path"] = row.get("source_path") or record.get("sourcePath") or ""
            master = record.get("privateMaster") or {}
            row["has_private_master"] = int(bool(master.get("present")))
            row["private_master_key"] = master.get("key") or master.get("expectedKey") or ""
            self.add_object(str(photo_id), "private_master", row["private_master_key"], master.get("present"), "assets/private-delivery-manifest.json")
            present_renders = 0
            for product_id, render in (record.get("privateRenders") or {}).items():
                if not isinstance(render, dict):
                    continue
                if render.get("present"):
                    present_renders += 1
                self.add_object(str(photo_id), f"private_render:{product_id}", render.get("key") or render.get("expectedKey") or "", render.get("present"), "assets/private-delivery-manifest.json")
            row["private_render_count"] = max(int(row.get("private_render_count") or 0), present_renders)
            row["has_public_previews"] = int(bool((record.get("publicPreviews") or {}).get("present")))
            self.add_state(str(photo_id), "private_delivery", "assets/private-delivery-manifest.json", record.get("collectionKey") or "", record.get("sourcePath") or "", record)

    def absorb_media_sidecar(self, payload: dict[str, Any] | None) -> None:
        if not isinstance(payload, dict):
            return
        for photo_id, record in (payload.get("photos") or {}).items():
            if not isinstance(record, dict):
                continue
            row = self.photo(str(photo_id))
            row["collection_key"] = row.get("collection_key") or record.get("collectionKey") or ""
            row["collection_title"] = row.get("collection_title") or record.get("collectionTitle") or ""
            row["source_path"] = row.get("source_path") or record.get("sourcePath") or ""
            preview = record.get("publicPreview") or {}
            row["public_gallery_key"] = row.get("public_gallery_key") or preview.get("galleryKey") or ""
            row["public_detail_key"] = row.get("public_detail_key") or preview.get("detailKey") or ""
            delivery = record.get("privateDelivery") or {}
            row["private_master_key"] = row.get("private_master_key") or delivery.get("masterKey") or ""
            if row["private_master_key"]:
                self.add_object(str(photo_id), "private_master_sidecar", row["private_master_key"], None, "assets/media-sidecar.json")
            for product_id, key in (delivery.get("renderKeys") or {}).items():
                self.add_object(str(photo_id), f"private_render_sidecar:{product_id}", key, None, "assets/media-sidecar.json")
            self.add_state(str(photo_id), "media_sidecar", "assets/media-sidecar.json", record.get("collectionKey") or "", record.get("sourcePath") or "", record)

    def absorb_tombstone_ids(self, payload: Any, state: str, source_path: str) -> None:
        if isinstance(payload, dict):
            ids = payload.get("photo_ids") or payload.get("hidden_ids") or payload.get("discardedPhotoIds") or []
        elif isinstance(payload, list):
            ids = payload
        else:
            ids = []
        for photo_id in ids:
            if isinstance(photo_id, str) and photo_id:
                self.add_state(photo_id, state, source_path)

    def absorb_discarded_media(self, payload: dict[str, Any] | None) -> None:
        if not isinstance(payload, dict):
            return
        self.absorb_tombstone_ids(payload, "discarded_media_manifest", "assets/discarded-media-manifest.json")
        for key in payload.get("publicKeys") or []:
            self.add_object(infer_photo_id_from_key(str(key)), "discarded_public_key", str(key), None, "assets/discarded-media-manifest.json")
        for key in payload.get("privateKeys") or []:
            self.add_object(infer_photo_id_from_key(str(key)), "discarded_private_key", str(key), None, "assets/discarded-media-manifest.json")

    def absorb_r2_upload_log(self, path: Path) -> None:
        if not path.exists():
            return
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                key = str(entry.get("key") or "")
                photo_id = infer_photo_id_from_key(key)
                if not photo_id:
                    continue
                bucket = str(entry.get("bucket") or "")
                object_type = "r2_upload_log"
                if key.startswith("expo/"):
                    object_type = "r2_upload_public_preview"
                elif key.startswith("masters/"):
                    object_type = "r2_upload_private_master"
                elif key.startswith("renders/"):
                    object_type = "r2_upload_private_render"
                self.add_object(
                    photo_id,
                    object_type,
                    key,
                    entry.get("ok"),
                    str(path),
                    bucket=bucket,
                    bytes_value=entry.get("bytes") if isinstance(entry.get("bytes"), int) else None,
                    event_at=str(entry.get("uploaded_at") or ""),
                    local_path=str(entry.get("path") or ""),
                )

    def absorb_r2_delete_log(self, path: Path) -> None:
        if not path.exists():
            return
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                key = str(entry.get("key") or "")
                photo_id = infer_photo_id_from_key(key)
                if not photo_id:
                    continue
                self.add_object(
                    photo_id,
                    "r2_delete_log",
                    key,
                    entry.get("ok"),
                    str(path),
                    bucket=str(entry.get("bucket") or ""),
                    event_at=str(entry.get("deleted_at") or ""),
                )

    def summary_flags(self, row: dict[str, Any]) -> dict[str, int]:
        states = row.get("state_summary") or set()
        return {
            "in_public_catalog": int("public_catalog" in states),
            "in_home_data": int("home_data" in states),
            "in_expo_manifest": int("expo_manifest" in states),
            "in_import_cache": int("import_cache" in states),
            "in_hidden_catalog": int("hidden_catalog" in states),
            "in_reserve_compat": int("reserve_compat" in states),
            "is_blocked": int("blocked_tombstone" in states),
            "is_discarded": int("discarded_tombstone" in states or "discarded_media_manifest" in states),
            "in_private_delivery": int("private_delivery" in states),
        }


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA journal_mode = WAL;

        CREATE TABLE manifest_files (
          path TEXT PRIMARY KEY,
          kind TEXT,
          exists_on_disk INTEGER NOT NULL,
          bytes INTEGER,
          mtime TEXT,
          top_level_count INTEGER,
          summary_json TEXT
        );

        CREATE TABLE collections (
          source_path TEXT,
          state TEXT,
          collection_key TEXT,
          title TEXT,
          photo_count INTEGER,
          PRIMARY KEY (source_path, state, collection_key)
        );

        CREATE TABLE photos (
          photo_id TEXT PRIMARY KEY,
          title TEXT,
          collection_key TEXT,
          collection_title TEXT,
          state_summary TEXT,
          in_public_catalog INTEGER DEFAULT 0,
          in_home_data INTEGER DEFAULT 0,
          in_expo_manifest INTEGER DEFAULT 0,
          in_import_cache INTEGER DEFAULT 0,
          in_hidden_catalog INTEGER DEFAULT 0,
          in_reserve_compat INTEGER DEFAULT 0,
          is_blocked INTEGER DEFAULT 0,
          is_discarded INTEGER DEFAULT 0,
          in_private_delivery INTEGER DEFAULT 0,
          has_private_master INTEGER DEFAULT 0,
          private_render_count INTEGER DEFAULT 0,
          has_public_previews INTEGER DEFAULT 0,
          gallery_country TEXT,
          country_source TEXT,
          relative_path TEXT,
          source_path TEXT,
          source_type TEXT,
          source_bytes INTEGER,
          capture_date TEXT,
          capture_sort TEXT,
          megapixels REAL,
          width INTEGER,
          height INTEGER,
          orientation TEXT,
          public_gallery_key TEXT,
          public_detail_key TEXT,
          private_master_key TEXT,
          raw_sources_json TEXT
        );

        CREATE TABLE photo_states (
          photo_id TEXT,
          state TEXT,
          source_path TEXT,
          collection_key TEXT,
          relative_path TEXT,
          details_json TEXT
        );

        CREATE TABLE r2_objects (
          photo_id TEXT,
          object_type TEXT,
          key TEXT,
          present INTEGER,
          bucket TEXT,
          bytes INTEGER,
          event_at TEXT,
          local_path TEXT,
          source_path TEXT
        );

        CREATE TABLE keywords (
          photo_id TEXT,
          keyword TEXT,
          source_path TEXT,
          PRIMARY KEY (photo_id, keyword, source_path)
        );

        CREATE VIEW IF NOT EXISTS state_counts AS
          SELECT state, count(DISTINCT photo_id) AS photos
          FROM photo_states
          GROUP BY state
          ORDER BY photos DESC;

        CREATE VIEW IF NOT EXISTS collection_counts AS
          SELECT coalesce(collection_key, '') AS collection_key,
                 count(*) AS photos,
                 sum(in_public_catalog) AS public_catalog,
                 sum(in_import_cache) AS import_cache,
                 sum(is_blocked) AS blocked,
                 sum(is_discarded) AS discarded
          FROM photos
          GROUP BY collection_key
          ORDER BY photos DESC;

        CREATE VIEW IF NOT EXISTS attention AS
          SELECT *
          FROM photos
          WHERE is_blocked = 1
             OR is_discarded = 1
             OR (in_public_catalog = 1 AND in_private_delivery = 0)
             OR (in_public_catalog = 1 AND has_private_master = 0)
             OR (in_public_catalog = 1 AND private_render_count < 3)
             OR (in_import_cache = 1 AND in_public_catalog = 0);

        CREATE VIEW IF NOT EXISTS unwanted_r2_objects AS
          SELECT photos.photo_id,
                 photos.title,
                 photos.collection_key,
                 photos.state_summary,
                 r2_objects.object_type,
                 r2_objects.bucket,
                 r2_objects.key,
                 r2_objects.bytes,
                 r2_objects.event_at,
                 r2_objects.local_path
          FROM photos
          JOIN r2_objects ON r2_objects.photo_id = photos.photo_id
          WHERE photos.is_blocked = 1 OR photos.is_discarded = 1
          ORDER BY photos.photo_id, r2_objects.key, r2_objects.event_at;

        CREATE VIEW IF NOT EXISTS import_not_public AS
          SELECT *
          FROM photos
          WHERE in_import_cache = 1 AND in_public_catalog = 0
          ORDER BY capture_sort DESC, photo_id;

        CREATE INDEX idx_photo_states_photo ON photo_states(photo_id);
        CREATE INDEX idx_photo_states_state ON photo_states(state);
        CREATE INDEX idx_r2_objects_photo ON r2_objects(photo_id);
        CREATE INDEX idx_r2_objects_key ON r2_objects(key);
        CREATE INDEX idx_r2_objects_type ON r2_objects(object_type);
        CREATE INDEX idx_keywords_keyword ON keywords(keyword);
        """
    )


def manifest_summary(path: Path, kind: str) -> dict[str, Any]:
    if path.suffix == ".js":
        return {"kind": kind}
    if path.suffix == ".jsonl":
        rows = 0
        ok_rows = 0
        with path.open(encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                rows += 1
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if entry.get("ok"):
                    ok_rows += 1
        return {"items": rows, "ok_rows": ok_rows}
    payload = load_json(path, None)
    if isinstance(payload, dict):
        explicit_count = None
        for key in ("photos_count", "catalogPhotos", "privateMasterPhotoIds", "privateRenderTripletPhotoIds"):
            value = payload.get(key)
            if isinstance(value, int):
                explicit_count = value
                break
        return {
            "keys": list(payload.keys())[:20],
            "photos": len(payload.get("photos") or []) if isinstance(payload.get("photos"), list) else None,
            "records": len(payload.get("records") or {}) if isinstance(payload.get("records"), dict) else None,
            "explicit_count": explicit_count,
        }
    if isinstance(payload, list):
        return {"items": len(payload)}
    return {"type": type(payload).__name__}


def write_db(repo_root: Path, output: Path) -> None:
    builder = StateBuilder(repo_root)

    photos_data = load_window_data(repo_root, Path("photos-data.js"), "photosByElieData")
    home_data = load_window_data(repo_root, Path("home-data.js"), "photosByElieHomeData")
    builder.absorb_collections(photos_data, "public_catalog", "photos-data.js")
    builder.absorb_collections(home_data, "home_data", "home-data.js")
    builder.absorb_import_cache(load_json(repo_root / IMPORT_CACHE_MANIFEST, {}))
    builder.absorb_expo_manifest(load_json(repo_root / "assets/expo-manifest.json", {}))
    builder.absorb_collections(load_json(repo_root / "assets/hidden/hidden-data.json", {}), "hidden_catalog", "assets/hidden/hidden-data.json")
    builder.absorb_collections(load_json(repo_root / "assets/owner-actions/reserve-data.json", {}), "reserve_compat", "assets/owner-actions/reserve-data.json")
    builder.absorb_tombstone_ids(load_json(repo_root / "assets/hidden/hidden-blacklist.json", {}), "blocked_tombstone", "assets/hidden/hidden-blacklist.json")
    builder.absorb_tombstone_ids(load_json(repo_root / "assets/discarded/discarded-photo-ids.json", {}), "discarded_tombstone", "assets/discarded/discarded-photo-ids.json")
    builder.absorb_discarded_media(load_json(repo_root / "assets/discarded-media-manifest.json", {}))
    builder.absorb_private_delivery(load_json(repo_root / "assets/private-delivery-manifest.json", {}))
    builder.absorb_media_sidecar(load_json(repo_root / "assets/media-sidecar.json", {}))
    builder.absorb_r2_upload_log(repo_root / ".review-logs/r2-upload-state.jsonl")
    builder.absorb_r2_delete_log(repo_root / ".review-logs/r2-delete-state.jsonl")

    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix=output.name, suffix=".tmp", dir=output.parent, delete=False) as temp:
        temp_path = Path(temp.name)
    try:
        conn = sqlite3.connect(temp_path)
        create_schema(conn)
        ensure_owner_schema(conn)

        for kind, rel_path in MANIFEST_PATHS:
            path = repo_root / rel_path
            stat = path.stat() if path.exists() else None
            summary = manifest_summary(path, kind) if path.exists() else {}
            top_count = summary.get("photos") or summary.get("records") or summary.get("items") or summary.get("explicit_count")
            conn.execute(
                "INSERT INTO manifest_files VALUES (?, ?, ?, ?, datetime(?, 'unixepoch'), ?, ?)",
                (
                    rel_path.as_posix(),
                    kind,
                    int(path.exists()),
                    stat.st_size if stat else None,
                    stat.st_mtime if stat else None,
                    top_count,
                    json.dumps(summary, ensure_ascii=False, sort_keys=True),
                ),
            )

        conn.executemany(
            "INSERT OR REPLACE INTO collections VALUES (:source_path, :state, :collection_key, :title, :photo_count)",
            builder.collections.values(),
        )

        photo_rows = []
        for row in builder.photos.values():
            flags = builder.summary_flags(row)
            states = sorted(row.get("state_summary") or [])
            photo_rows.append(
                {
                    **{key: row.get(key) for key in [
                        "photo_id", "title", "collection_key", "collection_title", "gallery_country",
                        "country_source", "relative_path", "source_path", "source_type", "source_bytes",
                        "capture_date", "capture_sort", "megapixels", "width", "height", "orientation",
                        "public_gallery_key", "public_detail_key", "private_master_key",
                    ]},
                    **flags,
                    "state_summary": ",".join(states),
                    "has_private_master": int(row.get("has_private_master") or 0),
                    "private_render_count": int(row.get("private_render_count") or 0),
                    "has_public_previews": int(row.get("has_public_previews") or bool(row.get("public_gallery_key") and row.get("public_detail_key"))),
                    "raw_sources_json": json.dumps(sorted(set(row.get("raw_sources") or [])), ensure_ascii=False),
                }
            )
        conn.executemany(
            """
            INSERT OR REPLACE INTO photos (
              photo_id, title, collection_key, collection_title, state_summary,
              in_public_catalog, in_home_data, in_expo_manifest, in_import_cache,
              in_hidden_catalog, in_reserve_compat, is_blocked, is_discarded,
              in_private_delivery, has_private_master, private_render_count,
              has_public_previews, gallery_country, country_source, relative_path,
              source_path, source_type, source_bytes, capture_date, capture_sort,
              megapixels, width, height, orientation, public_gallery_key,
              public_detail_key, private_master_key, raw_sources_json
            ) VALUES (
              :photo_id, :title, :collection_key, :collection_title, :state_summary,
              :in_public_catalog, :in_home_data, :in_expo_manifest, :in_import_cache,
              :in_hidden_catalog, :in_reserve_compat, :is_blocked, :is_discarded,
              :in_private_delivery, :has_private_master, :private_render_count,
              :has_public_previews, :gallery_country, :country_source, :relative_path,
              :source_path, :source_type, :source_bytes, :capture_date, :capture_sort,
              :megapixels, :width, :height, :orientation, :public_gallery_key,
              :public_detail_key, :private_master_key, :raw_sources_json
            )
            """,
            photo_rows,
        )
        conn.executemany(
            "INSERT INTO photo_states VALUES (:photo_id, :state, :source_path, :collection_key, :relative_path, :details_json)",
            builder.states,
        )
        conn.executemany(
            "INSERT INTO r2_objects VALUES (:photo_id, :object_type, :key, :present, :bucket, :bytes, :event_at, :local_path, :source_path)",
            builder.objects,
        )
        conn.executemany(
            "INSERT OR IGNORE INTO keywords VALUES (?, ?, ?)",
            sorted(builder.keywords),
        )
        import_country_assignments(repo_root, conn, force=True)
        conn.commit()
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.execute("PRAGMA journal_mode = DELETE")
        conn.execute("VACUUM")
        conn.close()
        for suffix in ("-wal", "-shm"):
            temp_path.with_name(f"{temp_path.name}{suffix}").unlink(missing_ok=True)
        temp_path.replace(output)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--quiet", action="store_true", help="Only print errors.")
    args = parser.parse_args()
    repo_root = args.repo_root.resolve()
    output = args.output if args.output.is_absolute() else repo_root / args.output
    write_db(repo_root, output)
    conn = sqlite3.connect(output)
    counts = dict(conn.execute("SELECT state, photos FROM state_counts").fetchall())
    total = conn.execute("SELECT count(*) FROM photos").fetchone()[0]
    attention = conn.execute("SELECT count(*) FROM attention").fetchone()[0]
    conn.close()
    if not args.quiet:
        print(f"Wrote {output}")
        print(f"Photos: {total}")
        print(f"Attention rows: {attention}")
        print("States: " + ", ".join(f"{key}={value}" for key, value in sorted(counts.items())))


if __name__ == "__main__":
    main()
