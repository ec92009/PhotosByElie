#!/usr/bin/env python3
"""Local Photos By Elie preview server with owner-only helper endpoints."""

from __future__ import annotations

import argparse
import copy
from datetime import datetime, timezone
import hashlib
import os
import ipaddress
import json
import mimetypes
import re
import signal
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


PHOTO_ACTION_PATH = "/__photosbyelie/photo-action"
PHOTO_ACTION_PROGRESS_PATH = "/__photosbyelie/photo-action-progress"
R2_PROGRESS_PATH = "/__photosbyelie/r2-progress"
R2_COVERAGE_PATH = "/__photosbyelie/r2-coverage"
R2_FIX_PATH = "/__photosbyelie/r2-fix"
R2_FILL_GAPS_PATH = "/__photosbyelie/r2-fill-gaps"
R2_SKIP_PHASE_PATH = "/__photosbyelie/r2-skip-phase"
IMPORT_SOURCE_THUMB_PATH = "/__photosbyelie/import-source-thumb"
REAL_ESTATE_OWNER_PATH = "/__photosbyelie/real-estate-owner"
REAL_ESTATE_IMPORT_PROGRESS_PATH = "/__photosbyelie/real-estate-import-progress"
OWNER_SESSION_PATH = "/__photosbyelie/owner-session"
OWNER_LOGIN_PATH = "/__photosbyelie/owner-login"
OWNER_LOGOUT_PATH = "/__photosbyelie/owner-logout"
TITLE_KEYWORD_REVIEW_QUEUE_PATH = "/__photosbyelie/title-keyword-review-queue"
MAX_BODY_BYTES = 5 * 1024 * 1024
LOCAL_CLIENTS = {"127.0.0.1", "::1", "localhost"}
DERIVATIVES = (("gallery", "gallerySrc"), ("detail", "imageSrc"))
COUNTRY_ASSIGNMENT_TARGETS = {"france", "usa", "spain", "mexico", "italy", "portugal", "slovakia"}
OWNER_SESSION_COOKIE = "pbe_owner_session"
OWNER_ACTION_ROOT = Path("assets/owner-actions")
KEYWORD_BLACKLIST_PATH = OWNER_ACTION_ROOT / "keyword-blacklist.json"
COUNTRY_ASSIGNMENT_LOG = OWNER_ACTION_ROOT / "country-assignments.jsonl"
COUNTRY_ASSIGNMENT_INDEX = OWNER_ACTION_ROOT / "country-assignments.json"
TITLE_KEYWORD_REVIEW_ROOT = OWNER_ACTION_ROOT / "title-keyword-review-queue"
REAL_ESTATE_CLIENTS_PATH = OWNER_ACTION_ROOT / "real-estate-clients.local.json"
REAL_ESTATE_IMPORT_ROOT = Path("tmp/real-estate-import")
REAL_ESTATE_PUBLIC_ROOT = Path("assets/real-estate")
REAL_ESTATE_SOURCE_ROOT = Path("/Volumes/Saturn/Pictures/RE")
REAL_ESTATE_MEDIA_EXTENSIONS = {".jpg", ".jpeg", ".mov", ".mp4", ".m4v"}
IMPORT_SOURCE_THUMB_ROOT = Path(".review-logs/import-source-thumbs")
IMPORT_SOURCE_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".heic", ".heif", ".webp"}
PUBLIC_SITE_BASE_URL = "https://ec92009.github.io/PhotosByElie/"
TITLE_KEYWORD_REVIEW_FLAG = "Title_Keywords_Reviewed"
TITLE_KEYWORD_PROPOSED_FLAG = "Title_Keywords_Proposed"
TITLE_KEYWORD_REJECTED_FLAG = "Title_Keywords_Rejected"
TITLE_KEYWORD_PARKED_FLAG = "Title_Keywords_Parked"
ACTION_PROGRESS: dict[str, dict] = {}
REAL_ESTATE_IMPORT_PROGRESS: dict[str, dict] = {}
REAL_ESTATE_IMPORT_PROGRESS_LOCK = threading.Lock()
OWNER_ACTION_LOCK = threading.Lock()
R2_BACKGROUND_TASKS: dict[str, dict] = {}
R2_BACKGROUND_LOCK = threading.Lock()
R2_SWEEP_SKIPPABLE_PHASES = {
    "discard-start",
    "camera",
    "apple-photo-albums",
    "leonardo",
    "real-estate",
    "gap-fill",
    "private",
    "discard-final",
    "test",
    "validate",
}
IMPORT_SOURCE_ROOTS = {
    "camera": Path("/Volumes/Saturn/Pictures/LR/Camera"),
    "apple-photo-albums": Path("/Volumes/Saturn/Pictures/LR/Apple Photo Albums"),
    "leonardo": Path("/Volumes/Saturn/Pictures/LR/_All Leonardo"),
    "real-estate": REAL_ESTATE_SOURCE_ROOT,
}

SCRIPT_ROOT = Path(__file__).resolve().parent
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from asset_state import (  # noqa: E402
    EXPO_MANIFEST_PATH,
    HIDDEN_ASSET_ROOT,
    LABELS,
    ORDER,
    clean_site_src,
    copy_photo,
    ensure_state_folders,
    hidden_asset_rel,
    load_site_data,
    move_asset,
    write_hidden_data_from_site,
    write_photos_data_from_site,
    write_regular_manifest_from_site,
    write_reserve_data_from_site,
)
from media_keys import legacy_private_master_key, private_master_key, private_render_key, public_preview_key  # noqa: E402
from media_policy import private_master_allowed, public_preview_allowed  # noqa: E402
from sync_r2_media import (  # noqa: E402
    DEFAULT_PRIVATE_BUCKET,
    DEFAULT_PRIVATE_PREFIX,
    DEFAULT_PUBLIC_BUCKET,
    DEFAULT_PUBLIC_PREFIX,
    UploadItem,
    hidden_photo_ids as r2_hidden_photo_ids,
    private_key as r2_private_key,
    public_key as r2_public_key,
    upload_id as r2_upload_id,
    wrangler_delete,
    wrangler_put,
)
from owner_state_db import backfill_r2_object_metadata, connect as owner_db_connect, upsert_r2_object_state  # noqa: E402
from owner_state_db import keyword_blacklist_terms as keyword_blacklist_terms_db  # noqa: E402
from owner_state_db import record_country_assignments as record_country_assignments_db  # noqa: E402
from owner_state_db import record_keyword_blacklist as record_keyword_blacklist_db  # noqa: E402
from owner_state_db import clear_title_keyword_review_blocks as clear_title_keyword_review_blocks_db  # noqa: E402
from owner_state_db import record_title_keyword_review_decisions as record_title_keyword_review_decisions_db  # noqa: E402


COLLECTION_KEYWORD_TARGETS = {
    slug: label
    for slug, (_number, label, _accent, _description) in LABELS.items()
    if slug != "unknown"
}
SOURCE_ROOT_CANDIDATES = [
    Path("/Volumes/Saturn/Pictures/LR/Camera"),
    Path("/Volumes/Saturn/Pictures/LR/Apple Photo Albums"),
    Path("/Volumes/Saturn/Pictures/LR/_All Leonardo"),
    Path("/Volumes/Saturn/Pictures/Phone Exports"),
    Path("/Volumes/Saturn/Pictures/LR"),
    Path("/Volumes/Saturn"),
    Path.home() / "Pictures/LR/Camera",
    Path.home() / "Pictures/LR/Apple Photo Albums",
    Path.home() / "Pictures/LR/_All Leonardo",
]
RECURSIVE_SOURCE_ROOT_CANDIDATES = [
    Path("/Volumes/Saturn/Pictures/Phone Exports"),
    Path("/Volumes/Saturn-1/Pictures/Phone Exports"),
    Path.home() / "Pictures/Phone Exports",
]
HIDDEN_BLACKLIST_PATH = HIDDEN_ASSET_ROOT / "hidden-blacklist.json"
HIDDEN_BLACKLIST_R2_KEY = "hidden-blacklist.json"
DISCARDED_TOMBSTONE_PATH = Path("assets/discarded/discarded-photo-ids.json")
DISCARDED_MEDIA_MANIFEST_PATH = Path("assets/discarded-media-manifest.json")
PRIVATE_RENDER_PRODUCTS = ("jpg-6mp", "jpg-3mp", "jpg-1mp")


class PhotosByElieLocalHandler(SimpleHTTPRequestHandler):
    server_version = "PhotosByElieLocal/1.0"

    def translate_path(self, path: str) -> str:
        translated = Path(super().translate_path(path))
        return str(translated)

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == OWNER_SESSION_PATH:
            self._handle_owner_session()
            return
        if path == TITLE_KEYWORD_REVIEW_QUEUE_PATH:
            self._handle_title_keyword_review_queue()
            return
        if path == PHOTO_ACTION_PROGRESS_PATH:
            self._handle_photo_action_progress()
            return
        if path == R2_PROGRESS_PATH:
            self._handle_r2_progress()
            return
        if path == R2_COVERAGE_PATH:
            self._handle_r2_coverage()
            return
        if path == IMPORT_SOURCE_THUMB_PATH:
            self._handle_import_source_thumb()
            return
        if path == REAL_ESTATE_OWNER_PATH:
            self._handle_real_estate_owner()
            return
        if path == REAL_ESTATE_IMPORT_PROGRESS_PATH:
            self._handle_real_estate_import_progress()
            return
        super().do_GET()

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == OWNER_LOGIN_PATH:
            self._handle_owner_login()
            return
        if path == OWNER_LOGOUT_PATH:
            self._handle_owner_logout()
            return
        if path == R2_FIX_PATH:
            self._handle_r2_fix()
            return
        if path == R2_FILL_GAPS_PATH:
            self._handle_r2_fill_gaps()
            return
        if path == R2_SKIP_PHASE_PATH:
            self._handle_r2_skip_phase()
            return
        if path == PHOTO_ACTION_PATH:
            self._handle_photo_action()
            return
        if path == REAL_ESTATE_OWNER_PATH:
            self._handle_real_estate_owner()
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def end_headers(self) -> None:
        path = self.path.split("?", 1)[0]
        if path in {"", "/"} or path.endswith(".html"):
            self.send_header("Cache-Control", "no-cache, max-age=0, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def _handle_photo_action(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = self._read_json_body()
            with OWNER_ACTION_LOCK:
                result = apply_photo_action(Path.cwd(), payload)
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        except (sqlite3.Error, subprocess.CalledProcessError) as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        except OSError as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, result)

    def _handle_photo_action_progress(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        query = parse_qs(urlparse(self.path).query)
        operation_id = (query.get("operation_id") or [""])[0]
        progress = ACTION_PROGRESS.get(operation_id) if operation_id else None
        self._send_json(HTTPStatus.OK, {"ok": True, "progress": progress})

    def _handle_r2_progress(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        self._send_json(HTTPStatus.OK, {"ok": True, "tasks": _r2_task_snapshot()})

    def _handle_r2_coverage(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        self._send_json(HTTPStatus.OK, {"ok": True, "coverage": _r2_coverage_summary(Path.cwd(), resolve_sources=False)})

    def _handle_import_source_thumb(self) -> None:
        if not self._is_loopback_request():
            self.send_error(HTTPStatus.FORBIDDEN, "localhost-only endpoint")
            return
        query = parse_qs(urlparse(self.path).query)
        phase = (query.get("phase") or [""])[0]
        relative = (query.get("path") or [""])[0]
        source_hint = (query.get("source") or [""])[0]
        try:
            source = _resolve_import_source_thumbnail(phase, relative, source_hint)
            thumb = _import_source_thumbnail_path(source)
        except ValueError as error:
            message = str(error)
            status = HTTPStatus.UNSUPPORTED_MEDIA_TYPE if "not a still image" in message else HTTPStatus.BAD_REQUEST
            self.send_error(status, message)
            return
        except (OSError, FileNotFoundError) as error:
            self.send_error(HTTPStatus.NOT_FOUND, str(error))
            return
        body = thumb.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _handle_r2_fix(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = self._read_optional_json_body()
            skip_phases = _normalize_r2_sweep_skip_phases(payload.get("skipPhases"))
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        task = _start_cloud_media_sweep(Path.cwd(), skip_phases)
        self._send_json(HTTPStatus.OK, {"ok": True, "task": task})

    def _handle_r2_fill_gaps(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = self._read_optional_json_body()
            limit = int(payload.get("limit") or 0)
        except (TypeError, ValueError) as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        task = _start_r2_gap_fill(Path.cwd(), max(0, limit))
        self._send_json(HTTPStatus.OK, {"ok": True, "task": task})

    def _handle_r2_skip_phase(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        repo_root = Path.cwd()
        try:
            payload = self._read_json_body()
            requested_phase = str(payload.get("phaseKey") or "").strip()
            requested_skips = _normalize_r2_sweep_skip_phases(payload.get("skipPhases") or requested_phase)
            skip_phases = _merge_r2_sweep_skip_phases(
                _read_cloud_media_sweep_skip_phases(repo_root),
                requested_skips,
            )
            _write_cloud_media_sweep_skip_phases(repo_root, skip_phases)
            current_phase = _read_cloud_media_sweep_current_phase(repo_root)
            interrupted = False
            if requested_phase and requested_phase == current_phase:
                interrupted = _terminate_process_tree(_read_cloud_media_sweep_current_child_pid(repo_root))
                current_phase = _wait_for_cloud_media_sweep_phase_change(repo_root, current_phase)
                skip_phases = _read_cloud_media_sweep_skip_phases(repo_root)
            with R2_BACKGROUND_LOCK:
                for task in R2_BACKGROUND_TASKS.values():
                    if task.get("kind") == "cloud-media-sweep" and task.get("state") in {"queued", "running"}:
                        task["skipPhases"] = skip_phases
                        task["currentPhaseKey"] = current_phase
                        task["currentChildPid"] = _read_cloud_media_sweep_current_child_pid(repo_root)
                        task["updated_at"] = datetime.now(timezone.utc).isoformat()
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, {
            "ok": True,
            "skipPhases": skip_phases,
            "currentPhaseKey": current_phase,
            "interrupted": interrupted,
        })

    def _handle_real_estate_owner(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            if self.command == "GET":
                result = real_estate_owner_summary(Path.cwd())
            else:
                result = apply_real_estate_owner_action(Path.cwd(), self._read_json_body())
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        except OSError as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, result)

    def _handle_real_estate_import_progress(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        query = parse_qs(urlparse(self.path).query)
        operation_id = (query.get("operation_id") or [""])[0]
        self._send_json(HTTPStatus.OK, {"ok": True, "progress": _real_estate_import_progress(operation_id)})

    def _handle_owner_session(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        self._send_json(HTTPStatus.OK, self._owner_session_payload())

    def _handle_title_keyword_review_queue(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = title_keyword_review_queue_payload(Path.cwd())
        except (OSError, sqlite3.Error, ValueError) as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, payload)

    def _handle_owner_login(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        raw_length = self.headers.get("Content-Length")
        if raw_length:
            try:
                length = min(int(raw_length), MAX_BODY_BYTES)
            except ValueError:
                length = 0
            if length > 0:
                self.rfile.read(length)
        self._send_json(
            HTTPStatus.OK,
            self._owner_session_payload(),
            extra_headers={
                "Set-Cookie": f"{OWNER_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"
            },
        )

    def _handle_owner_logout(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        self._send_json(
            HTTPStatus.OK,
            {"ok": True, "authenticated": True},
            extra_headers={
                "Set-Cookie": f"{OWNER_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"
            },
        )

    def _is_loopback_request(self) -> bool:
        host = self.headers.get("Host", "").split(":", 1)[0].strip("[]")
        client = self.client_address[0]
        if client.startswith("127.") or client == "::1":
            return host in LOCAL_CLIENTS or host.startswith("127.")
        if getattr(self.server, "allow_lan_owner", False) and _is_private_lan_address(client):
            return _is_private_lan_address(host)
        return False

    def _owner_session_payload(self) -> dict:
        return {
            "ok": True,
            "authenticated": True,
            "sessionSeconds": 0,
            "passwordConfigured": False,
            "passwordSource": "none",
        }

    def _read_json_body(self) -> dict:
        raw_length = self.headers.get("Content-Length")
        if not raw_length:
            raise ValueError("missing request body")
        try:
            length = int(raw_length)
        except ValueError as error:
            raise ValueError("invalid content length") from error
        if length < 1 or length > MAX_BODY_BYTES:
            raise ValueError("request body is too large")
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError as error:
            raise ValueError("request body is not valid JSON") from error
        if not isinstance(payload, dict):
            raise ValueError("request body must be a JSON object")
        return payload

    def _read_optional_json_body(self) -> dict:
        raw_length = self.headers.get("Content-Length")
        if not raw_length or raw_length == "0":
            return {}
        return self._read_json_body()

    def _send_json(self, status: HTTPStatus, payload: dict, extra_headers: dict[str, str] | None = None) -> None:
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve Photos By Elie locally with owner helper endpoints.")
    parser.add_argument("port", nargs="?", type=int, default=8000)
    parser.add_argument("--bind", default="127.0.0.1", help="Address to bind. Defaults to 127.0.0.1.")
    parser.add_argument("--allow-lan-owner", action="store_true", help="Allow owner helper endpoints from private LAN clients.")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.bind, args.port), PhotosByElieLocalHandler)
    server.allow_lan_owner = args.allow_lan_owner
    url_host = "localhost" if args.bind in {"127.0.0.1", "::1"} else args.bind
    print(f"Serving Photos By Elie at http://{url_host}:{args.port}/")
    print(f"Live photo action endpoint: {PHOTO_ACTION_PATH}")
    print(f"Real Estate owner endpoint: {REAL_ESTATE_OWNER_PATH}")
    print("Owner helper endpoints are enabled on loopback without a password.")
    if args.allow_lan_owner:
        print("Owner helper endpoints are enabled for private LAN clients without a password.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        server.server_close()
    return 0


def _is_private_lan_address(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    return bool(address.is_private or address.is_loopback)


def _state_groups(repo_root: Path) -> tuple[dict[str, list[dict]], dict[str, list[dict]], dict[str, list[dict]]]:
    site = load_site_data(repo_root)
    expo_groups = {slug: list((site.get("data", {}).get(slug) or {}).get("photos") or []) for slug in ORDER}
    expo_groups["unknown"] = list((site.get("owner", {}).get("unknown") or {}).get("photos") or [])
    reserve_groups = {slug: list((site.get("reserve", {}).get(slug) or {}).get("photos") or []) for slug in ORDER}
    hidden_groups = {slug: list((site.get("hidden", {}).get(slug) or {}).get("photos") or []) for slug in ORDER}
    return expo_groups, reserve_groups, hidden_groups


def _find_and_remove(groups: dict[str, list[dict]], photo_id: str) -> tuple[str, dict] | None:
    for slug, photos in groups.items():
        for index, photo in enumerate(photos):
            if photo.get("id") == photo_id:
                return slug, photos.pop(index)
    return None


def _find_photo(groups: dict[str, list[dict]], photo_id: str) -> tuple[str, dict] | None:
    for slug, photos in groups.items():
        for photo in photos:
            if photo.get("id") == photo_id:
                return slug, photo
    return None


def _matching_photos(groups: dict[str, list[dict]], photo_id: str) -> list[tuple[str, dict]]:
    return [
        (slug, photo)
        for slug, photos in groups.items()
        for photo in photos
        if photo.get("id") == photo_id
    ]


def _remove_existing(groups: dict[str, list[dict]], photo_id: str) -> None:
    for slug, photos in groups.items():
        groups[slug] = [photo for photo in photos if photo.get("id") != photo_id]


def _normalized_photo_ids(value: object) -> list[str]:
    raw_items = [value] if isinstance(value, str) else value
    if not isinstance(raw_items, list):
        return []
    photo_ids = []
    for item in raw_items:
        if not isinstance(item, str) or not item or item in photo_ids:
            continue
        photo_ids.append(item)
    return photo_ids


def _destination_rel(photo: dict, derivative: str, state: str, slug: str) -> str:
    if state == "hidden":
        return hidden_asset_rel(photo, derivative, slug)
    raise ValueError(f"unsupported destination state: {state}")


def _move_photo(repo_root: Path, source_photo: dict, state: str, slug: str) -> dict:
    photo = copy_photo(source_photo)
    if state in {"expo", "reserve", "hidden"}:
        for _, key in DERIVATIVES:
            photo[key] = ""
        return photo
    missing = []
    for derivative, key in DERIVATIVES:
        destination_rel = _destination_rel(photo, derivative, state, slug)
        moved = move_asset(repo_root, photo.get(key), destination_rel)
        if not moved and not (repo_root / destination_rel).exists():
            missing.append(photo.get(key) or destination_rel)
        photo[key] = f"./{destination_rel}"
    if missing:
        raise ValueError(f"missing derivative assets for {photo.get('id')}: {', '.join(str(item) for item in missing)}")
    return photo


def _photo_asset_paths(photo: dict) -> dict[str, str]:
    return {
        derivative: clean_site_src(photo.get(key))
        for derivative, key in DERIVATIVES
        if clean_site_src(photo.get(key))
    }


def _existing_preview_rel(repo_root: Path, photo_id: str, derivative: str, preferred_slug: str) -> tuple[str, str, str] | None:
    suffix = "900" if derivative == "gallery" else "1800"
    slugs = [preferred_slug] + [slug for slug in ORDER if slug != preferred_slug]
    for state in ("expo", "reserve"):
        for slug in slugs:
            rel = f"assets/{state}/{slug}/{photo_id}_{suffix}.jpg"
            if (repo_root / rel).exists():
                return state, slug, rel
    return None


def _hidden_review_photo(source_photo: dict, source_slug: str, source_state: str = "expo", hidden_at: str | None = None) -> dict:
    photo = copy_photo(source_photo)
    photo["hiddenFromState"] = source_state if source_state in {"expo", "reserve"} else "expo"
    photo["hiddenFromSlug"] = source_slug if source_slug in ORDER else "unknown"
    if hidden_at:
        photo["hiddenAt"] = hidden_at
    return photo


def _repair_hidden_references(
    repo_root: Path,
    hidden_groups: dict[str, list[dict]],
    expo_groups: dict[str, list[dict]],
    reserve_groups: dict[str, list[dict]],
) -> None:
    for slug, photos in list(hidden_groups.items()):
        repaired = []
        for photo in photos:
            photo_id = photo.get("id")
            if not photo_id:
                continue
            found = _find_photo(expo_groups, photo_id)
            source_state = "expo"
            if not found:
                found = _find_photo(reserve_groups, photo_id)
                source_state = "reserve"
            if found:
                source_slug, source_photo = found
                repaired.append(_hidden_review_photo(source_photo, source_slug, source_state))
                continue

            fallback_slug = slug if slug in ORDER else "unknown"
            review_photo = _hidden_review_photo(photo, fallback_slug, "expo")
            resolved_slug = fallback_slug
            for derivative, key in DERIVATIVES:
                current_rel = clean_site_src(review_photo.get(key))
                if current_rel and (repo_root / current_rel).exists():
                    continue
                located = _existing_preview_rel(repo_root, photo_id, derivative, fallback_slug)
                if not located:
                    continue
                _state, resolved_slug, rel = located
                review_photo[key] = f"./{rel}"
            review_photo["hiddenFromSlug"] = resolved_slug
            repaired.append(review_photo)
        hidden_groups[slug] = repaired


def _read_json_file(path: Path, fallback: object) -> object:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return fallback


def _write_json_file(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _normalized_keyword_blacklist(value: object) -> list[str]:
    source = value if isinstance(value, list) else _split_keyword_text(value)
    keywords: list[str] = []
    seen: set[str] = set()
    for item in source:
        keyword = str(item or "").strip()
        key = keyword.casefold()
        if not keyword or key in seen:
            continue
        seen.add(key)
        keywords.append(keyword)
    return keywords


def _save_keyword_blacklist(repo_root: Path, payload: dict) -> dict:
    path = repo_root / KEYWORD_BLACKLIST_PATH
    current = _normalized_keyword_blacklist(keyword_blacklist_terms_db(repo_root))
    incoming = _normalized_keyword_blacklist(payload.get("keywords") or [])
    mode = str(payload.get("mode") or "replace").strip().casefold()
    keywords = _normalized_keyword_blacklist(current + incoming) if mode == "append" else incoming
    db_result = record_keyword_blacklist_db(repo_root, keywords)
    return {
        "ok": True,
        "action": "save-keyword-blacklist",
        "path": path.relative_to(repo_root).as_posix(),
        "db": db_result.get("db"),
        "keyword_count": len(keywords),
        "keywords": keywords,
    }


def _keyword_blacklist_set(repo_root: Path) -> set[str]:
    return {keyword.casefold() for keyword in keyword_blacklist_terms_db(repo_root)}


def _review_keywords(repo_root: Path, value: object) -> list[str]:
    blacklist = _keyword_blacklist_set(repo_root)
    return [
        keyword
        for keyword in _unique_keywords(_split_keyword_text(value))
        if keyword.casefold() not in blacklist
    ]


def _review_photo_id(item: dict) -> str:
    return str(item.get("photo_id") or item.get("photoId") or "").strip()


def _pending_title_keyword_batches(conn) -> list[dict]:
    rows = conn.execute(
        """
        SELECT COALESCE(latest_proposed_batch_id, '') AS batch_id,
               COUNT(*) AS pending_count,
               MIN(latest_proposed_at) AS first_proposed_at,
               MAX(latest_proposed_at) AS last_proposed_at
        FROM title_keyword_queue
        WHERE review_state = 'proposed'
        GROUP BY COALESCE(latest_proposed_batch_id, '')
        HAVING batch_id <> ''
        ORDER BY last_proposed_at DESC, batch_id DESC
        """
    ).fetchall()
    return [
        {
            "batch_id": str(row["batch_id"] or ""),
            "pending_count": int(row["pending_count"] or 0),
            "first_proposed_at": row["first_proposed_at"] or "",
            "last_proposed_at": row["last_proposed_at"] or "",
        }
        for row in rows
    ]


def _clear_stale_title_keyword_review_rows(repo_root: Path, conn) -> dict:
    rows = conn.execute(
        """
        SELECT media_id, latest_proposed_batch_id
        FROM title_keyword_queue
        WHERE review_state = 'proposed'
        """
    ).fetchall()
    media_ids = [str(row["media_id"] or "") for row in rows if str(row["media_id"] or "")]
    if not media_ids:
        return {"blocked": 0, "not_found": 0}
    catalog_ids = set(_catalog_rows_by_media_id(repo_root, media_ids))
    discarded_ids = _discarded_photo_ids(repo_root)
    hidden_payload = _read_json_file(repo_root / HIDDEN_BLACKLIST_PATH, {})
    hidden_ids = set()
    if isinstance(hidden_payload, dict) and isinstance(hidden_payload.get("photo_ids"), list):
        hidden_ids = {str(photo_id) for photo_id in hidden_payload["photo_ids"] if photo_id}
    by_batch: dict[str, dict[str, list[dict]]] = {}
    for row in rows:
        media_id = str(row["media_id"] or "").strip()
        if not media_id:
            continue
        is_hidden = media_id in hidden_ids
        is_discarded = media_id in discarded_ids
        is_missing = media_id not in catalog_ids
        if not is_hidden and not is_discarded and not is_missing:
            continue
        batch_id = str(row["latest_proposed_batch_id"] or "stale-title-keyword-review").strip()
        bucket = by_batch.setdefault(batch_id, {"blocked": [], "not_found": []})
        item = {"photo_id": media_id, "batch_id": batch_id}
        if is_hidden or is_discarded:
            bucket["blocked"].append({**item, "blocked": True})
        else:
            bucket["not_found"].append(item)
    decided_at = datetime.now(timezone.utc).isoformat()
    blocked_count = 0
    not_found_count = 0
    for batch_id, grouped in by_batch.items():
        result = record_title_keyword_review_decisions_db(
            repo_root,
            batch_id,
            [],
            [],
            grouped["blocked"],
            grouped["not_found"],
            decided_at=decided_at,
            conn=conn,
        )
        blocked_count += int(result.get("blocked") or 0)
        not_found_count += int(result.get("not_found") or 0)
    return {"blocked": blocked_count, "not_found": not_found_count}


def _pending_title_keyword_rows(conn, batch_id: str) -> list[dict]:
    rows = conn.execute(
        """
        SELECT q.media_id, q.latest_proposed_batch_id AS batch_id,
               q.latest_attempt, q.latest_proposed_at, q.rejected_count,
               q.owner_comment, p.previous_title, p.previous_keywords,
               p.proposed_title, p.proposed_keywords, p.proposal_status,
               p.confidence, p.needs_owner_context, p.proposal_reason,
               p.removed_blacklisted, p.keyword_target, p.keyword_target_met,
               p.generator_model, p.generator_model_level, p.generator_model_maxed,
               p.model_ladder
        FROM title_keyword_queue AS q
        JOIN title_keyword_proposals AS p
          ON p.media_id = q.media_id
         AND p.attempt = q.latest_attempt
        WHERE q.review_state = 'proposed'
          AND q.latest_proposed_batch_id = ?
        ORDER BY q.latest_proposed_at DESC, q.media_id
        """,
        (batch_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def _capture_sort_value(item: dict) -> str:
    capture = item.get("capture") if isinstance(item.get("capture"), dict) else {}
    return str(capture.get("sort") or capture.get("date") or capture.get("raw") or "")


def _title_keyword_payload_from_batch_file(repo_root: Path, batch_id: str, pending_rows: list[dict], pending_batches: list[dict]) -> dict | None:
    batch_path = repo_root / TITLE_KEYWORD_REVIEW_ROOT / f"batch-{batch_id}.json"
    payload = _read_json_file(batch_path, {})
    if not isinstance(payload, dict):
        return None
    photos = payload.get("photos")
    if not isinstance(photos, list):
        return None
    pending_ids = {str(row.get("media_id") or "") for row in pending_rows}
    visible_photos = []
    for item in photos:
        if not isinstance(item, dict) or _review_photo_id(item) not in pending_ids:
            continue
        photo = copy.deepcopy(item)
        photo["batch_id"] = batch_id
        photo["proposal_batch_id"] = batch_id
        visible_photos.append(photo)
    if not visible_photos:
        return None

    next_payload = dict(payload)
    next_payload["ok"] = True
    next_payload["queue_source"] = "owner-sqlite-helper"
    next_payload["source_of_truth"] = OWNER_ACTION_ROOT.joinpath("Owner.sqlite").as_posix()
    next_payload["pending_batches"] = pending_batches
    next_payload["photos"] = visible_photos
    next_payload["proposal_files"] = {
        **(payload.get("proposal_files") if isinstance(payload.get("proposal_files"), dict) else {}),
        "batch": batch_path.relative_to(repo_root).as_posix(),
    }
    selection = dict(payload.get("selection") if isinstance(payload.get("selection"), dict) else {})
    selection["visible_pending_count"] = len(visible_photos)
    selection["sqlite_pending_count"] = len(pending_rows)
    next_payload["selection"] = selection
    sort_values = [value for value in (_capture_sort_value(item) for item in visible_photos) if value]
    if sort_values:
        range_info = dict(payload.get("range") if isinstance(payload.get("range"), dict) else {})
        range_info["newest"] = max(sort_values)
        range_info["oldest"] = min(sort_values)
        next_payload["range"] = range_info
    return next_payload


def _catalog_keyword_lookup(catalog_conn: sqlite3.Connection) -> dict[int, str]:
    return {
        int(row["keyword_id"]): str(row["keyword"])
        for row in catalog_conn.execute("SELECT keyword_id, keyword FROM keyword_terms")
    }


def _catalog_keywords(keyword_ids: object, keyword_lookup: dict[int, str]) -> list[str]:
    keywords = []
    for item in str(keyword_ids or "").split(","):
        try:
            keyword_id = int(item.strip())
        except ValueError:
            continue
        keyword = keyword_lookup.get(keyword_id)
        if keyword:
            keywords.append(keyword)
    return keywords


def _catalog_rows_by_media_id(repo_root: Path, media_ids: list[str]) -> dict[str, dict]:
    if not media_ids:
        return {}
    catalog_path = repo_root / "assets/catalog/photosbyelie.sqlite"
    if not catalog_path.exists():
        return {}
    catalog_conn = sqlite3.connect(catalog_path)
    catalog_conn.row_factory = sqlite3.Row
    try:
        keyword_lookup = _catalog_keyword_lookup(catalog_conn)
        placeholders = ",".join("?" for _ in media_ids)
        rows = catalog_conn.execute(
            f"""
            SELECT m.media_id, m.title, m.keyword_ids, m.captured_at,
                   c.slug AS gallery_key, c.title AS gallery_label,
                   sf.filename, folder.source_folder
            FROM media_items AS m
            JOIN collections AS c USING(collection_id)
            JOIN source_files AS sf USING(source_file_id)
            LEFT JOIN source_folders AS folder
              ON folder.source_folder_id = sf.source_folder_id
            WHERE m.media_id IN ({placeholders})
            """,
            media_ids,
        ).fetchall()
        return {
            str(row["media_id"]): {
                **dict(row),
                "keywords": _catalog_keywords(row["keyword_ids"], keyword_lookup),
            }
            for row in rows
        }
    finally:
        catalog_conn.close()


def _json_text_list(value: object) -> list:
    if not value:
        return []
    try:
        parsed = json.loads(str(value))
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def _title_keyword_payload_from_sqlite(repo_root: Path, batch_id: str, pending_rows: list[dict], pending_batches: list[dict]) -> dict:
    catalog_rows = _catalog_rows_by_media_id(repo_root, [str(row["media_id"]) for row in pending_rows])
    photos = []
    capture_values = []
    for row in pending_rows:
        media_id = str(row.get("media_id") or "")
        catalog = catalog_rows.get(media_id, {})
        gallery_key = str(catalog.get("gallery_key") or "")
        gallery_label = str(catalog.get("gallery_label") or gallery_key or "Photo")
        captured_at = str(catalog.get("captured_at") or "")
        if captured_at:
            capture_values.append(captured_at)
        current_keywords = _split_keyword_text(row.get("previous_keywords")) or catalog.get("keywords") or []
        proposed_keywords = _split_keyword_text(row.get("proposed_keywords"))
        source_folder = str(catalog.get("source_folder") or "").strip("/")
        filename = str(catalog.get("filename") or "").strip()
        source_path = "/".join(part for part in [source_folder, filename] if part)
        model_ladder = _json_text_list(row.get("model_ladder"))
        photos.append({
            "photo_id": media_id,
            "batch_id": batch_id,
            "proposal_batch_id": batch_id,
            "gallery": {"key": gallery_key, "label": gallery_label},
            "capture": {
                "raw": captured_at,
                "date": captured_at[:10] if captured_at else "",
                "sort": captured_at,
            },
            "thumbs": {
                "gallery_key": f"expo/{media_id}_900.jpg",
                "detail_key": f"expo/{media_id}_1800.jpg",
            },
            "source": {
                "file": {
                    "path": source_path,
                    "type": Path(filename).suffix.lstrip(".").upper(),
                },
            },
            "state": {
                "tags": [TITLE_KEYWORD_PROPOSED_FLAG],
                "rework_requested": int(row.get("latest_attempt") or 1) > 1,
                "rework_comment": str(row.get("owner_comment") or ""),
                "proposal_attempt": int(row.get("latest_attempt") or 1),
                "requested_generator": {
                    "model": row.get("generator_model") or "",
                    "model_level": row.get("generator_model_level"),
                    "model_maxed": bool(row.get("generator_model_maxed")),
                    "model_ladder": model_ladder,
                },
            },
            "current": {
                "title": str(row.get("previous_title") or catalog.get("title") or media_id),
                "keywords_raw": ", ".join(current_keywords),
                "keywords": current_keywords,
            },
            "proposed": {
                "title": str(row.get("proposed_title") or row.get("previous_title") or catalog.get("title") or media_id),
                "keywords": proposed_keywords,
                "status": str(row.get("proposal_status") or ""),
                "confidence": row.get("confidence"),
                "reason": str(row.get("proposal_reason") or ""),
                "generator": {
                    "model": row.get("generator_model") or "",
                    "model_level": row.get("generator_model_level"),
                    "model_maxed": bool(row.get("generator_model_maxed")),
                    "model_ladder": model_ladder,
                },
            },
            "changes": {
                "removed_blacklisted": _json_text_list(row.get("removed_blacklisted")),
                "keyword_target": row.get("keyword_target"),
                "keyword_target_met": bool(row.get("keyword_target_met")),
            },
        })
    return {
        "ok": True,
        "format": "photosbyelie-title-keyword-review-queue",
        "schema_version": 1,
        "queue_source": "owner-sqlite-helper",
        "source_of_truth": OWNER_ACTION_ROOT.joinpath("Owner.sqlite").as_posix(),
        "batch_id": batch_id,
        "pending_batches": pending_batches,
        "selection": {
            "total_count": len(photos),
            "visible_pending_count": len(photos),
            "sqlite_pending_count": len(pending_rows),
        },
        "range": {
            "newest": max(capture_values) if capture_values else "",
            "oldest": min(capture_values) if capture_values else "",
        },
        "photos": photos,
    }


def title_keyword_review_queue_payload(repo_root: Path) -> dict:
    conn = owner_db_connect(repo_root)
    try:
        stale_cleanup = _clear_stale_title_keyword_review_rows(repo_root, conn)
        pending_batches = _pending_title_keyword_batches(conn)
        all_photos = []
        all_pending_rows = []
        for batch in pending_batches:
            batch_id = batch["batch_id"]
            pending_rows = _pending_title_keyword_rows(conn, batch_id)
            all_pending_rows.extend(pending_rows)
            payload = _title_keyword_payload_from_batch_file(repo_root, batch_id, pending_rows, pending_batches)
            if payload:
                payload_photos = payload.get("photos") or []
                all_photos.extend(payload_photos)
                covered_ids = {_review_photo_id(item) for item in payload_photos if isinstance(item, dict)}
                missing_rows = [row for row in pending_rows if str(row.get("media_id") or "") not in covered_ids]
                if missing_rows:
                    fallback_payload = _title_keyword_payload_from_sqlite(repo_root, batch_id, missing_rows, pending_batches)
                    all_photos.extend(fallback_payload.get("photos") or [])
                continue
            if pending_rows:
                payload = _title_keyword_payload_from_sqlite(repo_root, batch_id, pending_rows, pending_batches)
                all_photos.extend(payload.get("photos") or [])
        if all_photos:
            sort_values = [value for value in (_capture_sort_value(item) for item in all_photos) if value]
            batch_ids = [batch["batch_id"] for batch in pending_batches if batch.get("pending_count")]
            return {
                "ok": True,
                "format": "photosbyelie-title-keyword-review-queue",
                "schema_version": 1,
                "queue_source": "owner-sqlite-helper",
                "source_of_truth": OWNER_ACTION_ROOT.joinpath("Owner.sqlite").as_posix(),
                "review_scope": "all-pending",
                "batch_id": "all-pending",
                "batch_ids": batch_ids,
                "pending_batches": pending_batches,
                "proposal_files": {
                    "queue": TITLE_KEYWORD_REVIEW_QUEUE_PATH,
                },
                "selection": {
                    "total_count": len(all_photos),
                    "visible_pending_count": len(all_photos),
                    "sqlite_pending_count": len(all_pending_rows),
                    "batch_count": len(batch_ids),
                    "stale_blocked_count": stale_cleanup.get("blocked", 0),
                    "stale_not_found_count": stale_cleanup.get("not_found", 0),
                },
                "range": {
                    "newest": max(sort_values) if sort_values else "",
                    "oldest": min(sort_values) if sort_values else "",
                },
                "photos": all_photos,
            }
        return {
            "ok": True,
            "format": "photosbyelie-title-keyword-review-queue",
            "schema_version": 1,
            "queue_source": "owner-sqlite-helper",
            "source_of_truth": OWNER_ACTION_ROOT.joinpath("Owner.sqlite").as_posix(),
            "batch_id": "",
            "pending_batches": [],
            "selection": {
                "total_count": 0,
                "visible_pending_count": 0,
                "sqlite_pending_count": 0,
                "stale_blocked_count": stale_cleanup.get("blocked", 0),
                "stale_not_found_count": stale_cleanup.get("not_found", 0),
            },
            "photos": [],
        }
    finally:
        conn.close()


def _merge_title_keyword_review_record(repo_root: Path, batch_id: str, payload_out: dict) -> tuple[Path, dict]:
    approvals_path = repo_root / TITLE_KEYWORD_REVIEW_ROOT / f"approvals-{batch_id}.json"
    existing = _read_json_file(approvals_path, {})
    if not isinstance(existing, dict):
        existing = {}

    approvals_by_id = {
        str(item.get("photo_id") or "").strip(): item
        for item in existing.get("approvals", [])
        if isinstance(item, dict) and str(item.get("photo_id") or "").strip()
    }
    rejections_by_id = {
        str(item.get("photo_id") or "").strip(): item
        for item in existing.get("rejections", [])
        if isinstance(item, dict) and str(item.get("photo_id") or "").strip()
    }
    blocked_by_id = {
        str(item.get("photo_id") or "").strip(): item
        for item in existing.get("blocked", [])
        if isinstance(item, dict) and str(item.get("photo_id") or "").strip()
    }
    for item in payload_out.get("approvals", []):
        photo_id = str(item.get("photo_id") or "").strip()
        if not photo_id:
            continue
        approvals_by_id[photo_id] = item
        rejections_by_id.pop(photo_id, None)
        blocked_by_id.pop(photo_id, None)
    for item in payload_out.get("rejections", []):
        photo_id = str(item.get("photo_id") or "").strip()
        if not photo_id:
            continue
        rejections_by_id[photo_id] = item
        approvals_by_id.pop(photo_id, None)
        blocked_by_id.pop(photo_id, None)
    for item in payload_out.get("blocked", []):
        photo_id = str(item.get("photo_id") or "").strip()
        if not photo_id:
            continue
        blocked_by_id[photo_id] = item
        approvals_by_id.pop(photo_id, None)
        rejections_by_id.pop(photo_id, None)

    existing_not_found = existing.get("not_found", [])
    payload_not_found = payload_out.get("not_found", [])
    if not isinstance(existing_not_found, list):
        existing_not_found = []
    if not isinstance(payload_not_found, list):
        payload_not_found = []
    not_found_by_id = {}
    for item in existing_not_found + payload_not_found:
        if isinstance(item, dict):
            photo_id = str(item.get("photo_id") or "").strip()
            if photo_id:
                not_found_by_id[photo_id] = item
            continue
        photo_id = str(item or "").strip()
        if photo_id:
            not_found_by_id[photo_id] = photo_id
    not_found = list(not_found_by_id.values())
    merged = {
        **existing,
        **payload_out,
        "approvals": list(approvals_by_id.values()),
        "rejections": list(rejections_by_id.values()),
        "blocked": list(blocked_by_id.values()),
        "not_found": not_found,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    _write_json_file(approvals_path, merged)
    return approvals_path, merged


def _clear_title_keyword_review_block_record(
    repo_root: Path,
    batch_id: str,
    photo_ids: list[str],
    decided_at: str,
) -> dict:
    normalized_ids = {str(photo_id or "").strip() for photo_id in photo_ids}
    normalized_ids.discard("")
    approvals_path = repo_root / TITLE_KEYWORD_REVIEW_ROOT / f"approvals-{batch_id}.json"
    existing = _read_json_file(approvals_path, {})
    if not normalized_ids or not isinstance(existing, dict):
        return {"path": approvals_path.relative_to(repo_root).as_posix(), "removed_count": 0, "wrote": False}
    blocked = existing.get("blocked", [])
    if not isinstance(blocked, list):
        blocked = []
    remaining = []
    removed_count = 0
    for item in blocked:
        if not isinstance(item, dict):
            remaining.append(item)
            continue
        photo_id = str(item.get("photo_id") or "").strip()
        if photo_id in normalized_ids:
            removed_count += 1
            continue
        remaining.append(item)
    if not removed_count:
        return {"path": approvals_path.relative_to(repo_root).as_posix(), "removed_count": 0, "wrote": False}
    updated = {
        **existing,
        "batch_id": batch_id,
        "blocked": remaining,
        "updated_at": decided_at,
    }
    _write_json_file(approvals_path, updated)
    return {
        "path": approvals_path.relative_to(repo_root).as_posix(),
        "removed_count": removed_count,
        "wrote": True,
    }


def _record_country_assignments(repo_root: Path, target_slug: str, moved: list[dict], skipped: list[dict]) -> dict:
    return record_country_assignments_db(repo_root, target_slug, moved, skipped)


def _set_action_progress(operation_id: object, total: int, completed: int) -> None:
    if not isinstance(operation_id, str) or not operation_id:
        return
    ACTION_PROGRESS[operation_id] = {
        "total": total,
        "completed": completed,
        "remaining": max(0, total - completed),
    }


def _hidden_provenance(photo: dict, fallback_state: str, fallback_slug: str) -> tuple[str, str]:
    state = photo.get("hiddenFromState") or (photo.get("ownerState") or {}).get("hiddenFromState") or fallback_state
    slug = photo.get("hiddenFromSlug") or (photo.get("ownerState") or {}).get("hiddenFromSlug") or fallback_slug
    if state not in {"expo", "reserve"}:
        state = fallback_state
    if slug not in ORDER:
        slug = fallback_slug if fallback_slug in ORDER else "unknown"
    return state, slug


def _hidden_public_preview_keys(photo: dict, slug: str) -> list[str]:
    keys: list[str] = []
    for source in (photo.get("gallerySrc"), photo.get("imageSrc")):
        rel = clean_site_src(source)
        parts = rel.split("/")
        if len(parts) >= 4 and parts[0] == "assets" and parts[1] in {"expo", "reserve"}:
            keys.append("/".join([DEFAULT_PUBLIC_PREFIX, *parts[2:]]))
    _source_state, source_slug = _hidden_provenance(photo, "expo", slug)
    if source_slug in ORDER and photo.get("id"):
        keys.extend([
            f"{DEFAULT_PUBLIC_PREFIX}/{source_slug}/{photo['id']}_900.jpg",
            f"{DEFAULT_PUBLIC_PREFIX}/{source_slug}/{photo['id']}_1800.jpg",
        ])
    unique = []
    seen = set()
    for key in keys:
        normalized = key.strip("/")
        if not normalized or normalized in seen:
            continue
        unique.append(normalized)
        seen.add(normalized)
    return unique


def _hidden_blacklist_payload(hidden_groups: dict[str, list[dict]]) -> dict:
    photo_ids = []
    public_preview_keys = []
    for slug, photos in hidden_groups.items():
        for photo in photos:
            photo_id = photo.get("id")
            if photo_id:
                photo_ids.append(photo_id)
            public_preview_keys.extend(_hidden_public_preview_keys(photo, slug))
    return {
        "format": "photosbyelie-hidden-blacklist",
        "version": 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "photo_ids": sorted(set(photo_ids)),
        "public_preview_keys": sorted(set(public_preview_keys)),
    }


def _write_hidden_blacklist(repo_root: Path, hidden_groups: dict[str, list[dict]]) -> Path:
    path = repo_root / HIDDEN_BLACKLIST_PATH
    _write_json_file(path, _hidden_blacklist_payload(hidden_groups))
    return path


def _hidden_blacklist_upload_item(repo_root: Path) -> UploadItem:
    return UploadItem(
        bucket=DEFAULT_PUBLIC_BUCKET,
        key=HIDDEN_BLACKLIST_R2_KEY,
        path=repo_root / HIDDEN_BLACKLIST_PATH,
        content_type="application/json",
        cache_control="public, max-age=30, must-revalidate",
    )


def _hidden_public_delete_items(repo_root: Path, hidden_groups: dict[str, list[dict]]) -> list[UploadItem]:
    items = []
    seen = set()
    placeholder = repo_root / HIDDEN_BLACKLIST_PATH
    for slug, photos in hidden_groups.items():
        for photo in photos:
            for key in _hidden_public_preview_keys(photo, slug):
                identifier = f"{DEFAULT_PUBLIC_BUCKET}/{key}"
                if identifier in seen:
                    continue
                seen.add(identifier)
                items.append(
                    UploadItem(
                        bucket=DEFAULT_PUBLIC_BUCKET,
                        key=key,
                        path=placeholder,
                        content_type="image/jpeg",
                    )
                )
    return items


def _waste_basket_discard_entries(hidden_groups: dict[str, list[dict]]) -> list[dict]:
    entries: list[dict] = []
    for slug, photos in hidden_groups.items():
        for photo in photos:
            photo_id = str(photo.get("id") or "")
            if not photo_id:
                continue
            _source_state, original_slug = _hidden_provenance(photo, "expo", slug)
            entries.append(
                {
                    "id": photo_id,
                    "title": photo.get("title") or photo_id,
                    "discarded_at": datetime.now(timezone.utc).isoformat(),
                    "from_state": "hidden",
                    "from_slug": slug,
                    "source_slug": original_slug,
                    "asset_paths": _photo_asset_paths(photo),
                    "public_preview_keys": _hidden_public_preview_keys(photo, original_slug),
                    "private_keys": _discarded_private_keys(photo),
                }
            )
    return entries


def _waste_basket_delete_items(repo_root: Path, hidden_groups: dict[str, list[dict]]) -> list[UploadItem]:
    items: list[UploadItem] = []
    seen: set[str] = set()
    for slug, photos in hidden_groups.items():
        for photo in photos:
            _source_state, original_slug = _hidden_provenance(photo, "expo", slug)
            for item in _discarded_delete_items(repo_root, photo, original_slug):
                identifier = f"{item.bucket}/{item.key}"
                if identifier in seen:
                    continue
                seen.add(identifier)
                items.append(item)
    return items


def _legacy_discarded_photo_ids(repo_root: Path) -> set[str]:
    payload = _read_json_file(repo_root / DISCARDED_MEDIA_MANIFEST_PATH, {})
    if not isinstance(payload, dict):
        return set()
    values = payload.get("discardedPhotoIds") or []
    return {value for value in values if isinstance(value, str) and value}


def _read_discarded_tombstone(repo_root: Path) -> dict:
    payload = _read_json_file(repo_root / DISCARDED_TOMBSTONE_PATH, {})
    if not isinstance(payload, dict):
        payload = {}
    photos = payload.get("photos") if isinstance(payload.get("photos"), list) else []
    photo_ids = set(_legacy_discarded_photo_ids(repo_root))
    photo_ids.update(value for value in payload.get("photo_ids") or [] if isinstance(value, str) and value)
    photo_ids.update(photo.get("id") for photo in photos if isinstance(photo, dict) and isinstance(photo.get("id"), str))
    return {
        "format": payload.get("format") or "photosbyelie-discarded-photo-ids",
        "version": 1,
        "updated_at": payload.get("updated_at"),
        "photo_ids": sorted(photo_ids),
        "public_preview_keys": sorted({
            key
            for key in payload.get("public_preview_keys") or []
            if isinstance(key, str) and key
        }),
        "private_keys": sorted({
            key
            for key in payload.get("private_keys") or []
            if isinstance(key, str) and key
        }),
        "photos": [photo for photo in photos if isinstance(photo, dict) and photo.get("id")],
    }


def _discarded_photo_ids(repo_root: Path) -> set[str]:
    return set(_read_discarded_tombstone(repo_root).get("photo_ids") or [])


def _source_basename(source: dict) -> str:
    return Path(str(source.get("path") or "")).name


def _safe_r2_source_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-") or "source"


def _discarded_private_keys(photo: dict) -> list[str]:
    photo_id = str(photo.get("id") or "")
    if not photo_id:
        return []
    keys = []
    for source in photo.get("sourceFiles") or []:
        if not isinstance(source, dict):
            continue
        source_name = _source_basename(source)
        if not source_name:
            continue
        keys.append(private_master_key(DEFAULT_PRIVATE_PREFIX, photo_id, source_name))
        keys.append(legacy_private_master_key(DEFAULT_PRIVATE_PREFIX, photo_id, source_name))
        safe_name = _safe_r2_source_name(source_name)
        keys.extend(private_render_key(photo_id, product_id) for product_id in PRIVATE_RENDER_PRODUCTS)
        keys.extend(f"renders/{photo_id}/{safe_name}-{product_id}.jpg" for product_id in PRIVATE_RENDER_PRODUCTS)
    return sorted(set(keys))


def _discarded_delete_items(repo_root: Path, photo: dict, source_slug: str) -> list[UploadItem]:
    placeholder = repo_root / DISCARDED_TOMBSTONE_PATH
    items = []
    seen = set()
    for bucket, keys in (
        (DEFAULT_PUBLIC_BUCKET, _hidden_public_preview_keys(photo, source_slug)),
        (DEFAULT_PRIVATE_BUCKET, _discarded_private_keys(photo)),
    ):
        for key in keys:
            identifier = f"{bucket}/{key}"
            if identifier in seen:
                continue
            seen.add(identifier)
            items.append(
                UploadItem(
                    bucket=bucket,
                    key=key,
                    path=placeholder,
                    content_type=mimetypes.guess_type(key)[0] or "application/octet-stream",
                )
            )
    return items


def _write_discarded_tombstones(repo_root: Path, discarded_photos: list[dict] | None = None) -> dict:
    payload = _read_discarded_tombstone(repo_root)
    photos_by_id = {
        str(photo.get("id")): photo
        for photo in payload.get("photos") or []
        if isinstance(photo, dict) and photo.get("id")
    }
    photo_ids = set(payload.get("photo_ids") or [])
    public_preview_keys = set(payload.get("public_preview_keys") or [])
    private_keys = set(payload.get("private_keys") or [])
    for discarded_photo in discarded_photos or []:
        photo_id = str(discarded_photo.get("id") or "")
        if not photo_id:
            continue
        photos_by_id[photo_id] = discarded_photo
        photo_ids.add(photo_id)
        public_preview_keys.update(discarded_photo.get("public_preview_keys") or [])
        private_keys.update(discarded_photo.get("private_keys") or [])
    payload["photo_ids"] = sorted(photo_id for photo_id in photo_ids if isinstance(photo_id, str) and photo_id)
    payload["public_preview_keys"] = sorted(key for key in public_preview_keys if isinstance(key, str) and key)
    payload["private_keys"] = sorted(key for key in private_keys if isinstance(key, str) and key)
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    payload["photos"] = sorted(photos_by_id.values(), key=lambda photo: str(photo.get("id") or ""))
    _write_json_file(repo_root / DISCARDED_TOMBSTONE_PATH, payload)
    return payload


def _write_discarded_tombstone(repo_root: Path, discarded_photo: dict | None = None) -> dict:
    return _write_discarded_tombstones(repo_root, [discarded_photo] if discarded_photo else [])


def _groups_without_photo_ids(groups: dict[str, list[dict]], photo_ids: set[str]) -> dict[str, list[dict]]:
    if not photo_ids:
        return groups
    return {
        slug: [
            photo
            for photo in photos
            if str(photo.get("id") or "") not in photo_ids
        ]
        for slug, photos in groups.items()
    }


def _write_state(repo_root: Path, expo_groups: dict[str, list[dict]], reserve_groups: dict[str, list[dict]], hidden_groups: dict[str, list[dict]]) -> dict:
    _repair_hidden_references(repo_root, hidden_groups, expo_groups, reserve_groups)
    discarded_ids = _discarded_photo_ids(repo_root)
    expo_groups = _groups_without_photo_ids(expo_groups, discarded_ids)
    reserve_groups = _groups_without_photo_ids(reserve_groups, discarded_ids)
    hidden_groups = _groups_without_photo_ids(hidden_groups, discarded_ids)
    hidden_ids = {photo.get("id") for photos in hidden_groups.values() for photo in photos if photo.get("id")}
    write_photos_data_from_site(repo_root, expo_groups, reserve_groups)
    write_reserve_data_from_site(repo_root, reserve_groups)
    write_hidden_data_from_site(repo_root, hidden_groups)
    _write_hidden_blacklist(repo_root, hidden_groups)
    write_regular_manifest_from_site(
        repo_root,
        expo_groups,
        reserve_groups,
        None,
        hidden_ids,
        "live-local-action",
    )
    site = load_site_data(repo_root)
    return {
        "data": site.get("data", {}),
        "owner": site.get("owner", {}),
        "reserve": site.get("reserve", {}),
        "hidden": site.get("hidden", {}),
    }


def _write_worker_catalog(repo_root: Path) -> dict:
    started = time.perf_counter()
    try:
        result = subprocess.run(
            ["node", "scripts/write_worker_catalog.mjs"],
            cwd=repo_root,
            check=True,
            capture_output=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        output = getattr(error, "stderr", "") or getattr(error, "stdout", "") or str(error)
        return {
            "ok": False,
            "path": "worker/photos-catalog.generated.mjs",
            "error": output.strip(),
        }
    return {
        "ok": True,
        "path": (result.stdout or "worker/photos-catalog.generated.mjs").strip(),
        "elapsed_ms": round((time.perf_counter() - started) * 1000),
    }


def _write_catalog_state(repo_root: Path, expo_groups: dict[str, list[dict]], reserve_groups: dict[str, list[dict]], hidden_groups: dict[str, list[dict]]) -> tuple[dict, dict]:
    site_state = _write_state(repo_root, expo_groups, reserve_groups, hidden_groups)
    worker_catalog = _write_worker_catalog(repo_root)
    return site_state, worker_catalog


def _split_keyword_text(value: object) -> list[str]:
    if isinstance(value, list):
        keywords = []
        for item in value:
            keywords.extend(_split_keyword_text(item))
        return keywords
    return [item.strip() for item in re.split(r"[;,]", str(value or "")) if item.strip()]


def _unique_keywords(values: list[str]) -> list[str]:
    seen = set()
    unique = []
    for value in values:
        normalized = value.casefold()
        if not normalized or normalized in seen:
            continue
        unique.append(value)
        seen.add(normalized)
    return unique


def _record_title_keyword_rejections(repo_root: Path, batch_id: str, rejections: list[dict]) -> dict:
    if not rejections:
        return {"path": "", "rejected": []}
    rejected = []
    for item in rejections:
        photo_id = str(item.get("photo_id") or "").strip()
        if not photo_id:
            continue
        rejected.append(photo_id)
    return {
        "path": "",
        "rejected": rejected,
        "role": "owner-sqlite",
    }


def _review_item_batch_id(item: dict, fallback_batch_id: str) -> str:
    return str(item.get("batch_id") or item.get("proposal_batch_id") or fallback_batch_id or "").strip()


def _group_review_items_by_batch(items: list[dict], fallback_batch_id: str) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = {}
    for item in items:
        batch_id = _review_item_batch_id(item, fallback_batch_id)
        if not batch_id:
            continue
        grouped_item = {**item, "batch_id": batch_id}
        groups.setdefault(batch_id, []).append(grouped_item)
    return groups


def _review_batch_ids_for_items(*groups: dict[str, list[dict]]) -> list[str]:
    batch_ids = []
    seen = set()
    for group in groups:
        for batch_id, items in group.items():
            if batch_id in seen or not items:
                continue
            seen.add(batch_id)
            batch_ids.append(batch_id)
    return batch_ids


def _review_record_not_found(not_found: list[str], approvals: list[dict], fallback_batch_id: str) -> list[dict]:
    batch_by_id = {
        str(item.get("photo_id") or "").strip(): _review_item_batch_id(item, fallback_batch_id)
        for item in approvals
        if str(item.get("photo_id") or "").strip()
    }
    records = []
    for media_id in not_found:
        media_id = str(media_id or "").strip()
        if not media_id:
            continue
        records.append({"photo_id": media_id, "batch_id": batch_by_id.get(media_id, fallback_batch_id)})
    return records


def _save_title_keyword_review_records(
    repo_root: Path,
    *,
    fallback_batch_id: str,
    approvals: list[dict],
    rejections: list[dict],
    blocked: list[dict],
    not_found: list[dict],
    review_flag: str,
    applied_at: str,
    decided_at: str,
) -> dict:
    approval_groups = _group_review_items_by_batch(approvals, fallback_batch_id)
    rejection_groups = _group_review_items_by_batch(rejections, fallback_batch_id)
    blocked_groups = _group_review_items_by_batch(blocked, fallback_batch_id)
    not_found_groups = _group_review_items_by_batch(not_found, fallback_batch_id)
    paths = []
    db_path = ""
    approved_count = 0
    rejected_count = 0
    blocked_count = 0
    not_found_count = 0
    for batch_id in _review_batch_ids_for_items(approval_groups, rejection_groups, blocked_groups, not_found_groups):
        batch_approvals = approval_groups.get(batch_id, [])
        batch_rejections = rejection_groups.get(batch_id, [])
        batch_blocked = blocked_groups.get(batch_id, [])
        batch_not_found = not_found_groups.get(batch_id, [])
        payload_out = {
            "format": "photosbyelie-title-keyword-review-approvals",
            "schema_version": 1,
            "updated_at": decided_at,
            "batch_id": batch_id,
            "review_flag": review_flag,
            "proposal_state_flag": TITLE_KEYWORD_PROPOSED_FLAG,
            "rejection_flag": TITLE_KEYWORD_REJECTED_FLAG,
            "approvals": batch_approvals,
            "rejections": batch_rejections,
            "blocked": batch_blocked,
            "not_found": batch_not_found,
        }
        if batch_approvals and applied_at:
            payload_out["applied_at"] = applied_at
        approvals_path, _merged_record = _merge_title_keyword_review_record(repo_root, batch_id, payload_out)
        db_result = record_title_keyword_review_decisions_db(
            repo_root,
            batch_id,
            batch_approvals,
            batch_rejections,
            batch_blocked,
            batch_not_found,
            applied_at=applied_at if batch_approvals else "",
            decided_at=decided_at,
        )
        paths.append(approvals_path.relative_to(repo_root).as_posix())
        db_path = db_result.get("db") or db_path
        approved_count += int(db_result.get("accepted") or 0)
        rejected_count += int(db_result.get("rejected") or 0)
        blocked_count += int(db_result.get("blocked") or 0)
        not_found_count += int(db_result.get("not_found") or 0)
    return {
        "db": db_path,
        "paths": paths,
        "path": paths[0] if paths else "",
        "approved_count": approved_count,
        "rejected_count": rejected_count,
        "blocked_count": blocked_count,
        "not_found_count": not_found_count,
    }


def _metadata_item(photo: dict, label: str) -> dict | None:
    normalized_label = label.casefold()
    return next(
        (item for item in photo.get("metadata") or [] if str(item.get("label", "")).casefold() == normalized_label),
        None,
    )


def _set_metadata_value(photo: dict, label: str, value: str) -> bool:
    metadata = list(photo.get("metadata") or [])
    item = _metadata_item(photo, label)
    if item:
        if item.get("value") == value:
            return False
        item["value"] = value
        photo["metadata"] = metadata
        return True
    if not value:
        return False
    metadata.insert(0, {"label": label, "value": value})
    photo["metadata"] = metadata
    return True


def _set_photo_title(photo: dict, title: str) -> bool:
    title = str(title or "").strip()
    if not title:
        return False
    changed = photo.get("title") != title
    photo["title"] = title
    changed = _set_metadata_value(photo, "Metadata title", title) or changed
    return changed


def _set_photo_keywords(photo: dict, keywords: list[str]) -> bool:
    keywords = _unique_keywords(keywords)
    value = ", ".join(keywords)
    changed = False
    if "keywords" in photo and photo.get("keywords") != keywords:
        photo["keywords"] = keywords
        changed = True
    changed = _set_metadata_value(photo, "Keywords", value) or changed
    return changed


def _ensure_photo_flag(photo: dict, flag: str) -> bool:
    flag = str(flag or "").strip()
    if not flag:
        return False
    item = _metadata_item(photo, "Flags")
    current = _unique_keywords(_split_keyword_text(item.get("value") if item else ""))
    if any(value == flag for value in current):
        return False
    current.append(flag)
    return _set_metadata_value(photo, "Flags", ", ".join(current))


def _apply_title_keyword_approvals_to_groups(
    expo_groups: dict[str, list[dict]],
    reserve_groups: dict[str, list[dict]],
    hidden_groups: dict[str, list[dict]],
    approvals: list[dict],
) -> tuple[list[dict], list[str], int]:
    updated = []
    not_found = []
    metadata_changed = 0
    review_flag = TITLE_KEYWORD_REVIEW_FLAG
    for approval in approvals:
        approval_photo_id = approval["photo_id"]
        matches = (
            [("expo", *item) for item in _matching_photos(expo_groups, approval_photo_id)]
            + [("reserve", *item) for item in _matching_photos(reserve_groups, approval_photo_id)]
            + [("hidden", *item) for item in _matching_photos(hidden_groups, approval_photo_id)]
        )
        if not matches:
            not_found.append(approval_photo_id)
            continue
        photo_changed = False
        for state, slug, photo in matches:
            title_changed = _set_photo_title(photo, approval["title"])
            keywords_changed = _set_photo_keywords(photo, approval["keywords"])
            flag_changed = _ensure_photo_flag(photo, review_flag)
            photo_changed = title_changed or keywords_changed or flag_changed or photo_changed
            updated.append({"state": state, "slug": slug, "id": approval_photo_id})
        if photo_changed:
            metadata_changed += 1
    return updated, not_found, metadata_changed


def _remove_photo_keyword(photo: dict, keyword: str) -> bool:
    target = str(keyword or "").strip().casefold()
    if not target:
        return False
    changed = False
    if "keywords" in photo:
        current_keywords = _unique_keywords(_split_keyword_text(photo.get("keywords")))
        next_keywords = [item for item in current_keywords if item.casefold() != target]
        if next_keywords != current_keywords:
            photo["keywords"] = next_keywords
            changed = True

    keyword_item = _metadata_item(photo, "Keywords")
    if keyword_item:
        current_keywords = _unique_keywords(_split_keyword_text(keyword_item.get("value")))
        next_keywords = [item for item in current_keywords if item.casefold() != target]
        next_value = ", ".join(next_keywords)
        if keyword_item.get("value") != next_value:
            keyword_item["value"] = next_value
            changed = True
    return changed


def _remove_collection_keyword(*state_groups: dict[str, list[dict]], slug: str, keyword: str) -> dict:
    scanned = 0
    changed = 0
    states: dict[str, int] = {}
    for state_index, groups in enumerate(state_groups):
        state_name = ["expo", "reserve", "hidden"][state_index] if state_index < 3 else f"state-{state_index + 1}"
        for photo in groups.get(slug, []):
            scanned += 1
            if _remove_photo_keyword(photo, keyword):
                changed += 1
                states[state_name] = states.get(state_name, 0) + 1
    return {
        "gallery_key": slug,
        "keyword": str(keyword or "").strip(),
        "scanned": scanned,
        "changed": changed,
        "states": states,
    }


def _ensure_photo_keyword(photo: dict, keyword: str) -> bool:
    if not keyword:
        return False
    changed = False
    if "keywords" in photo:
        keywords = _unique_keywords(_split_keyword_text(photo.get("keywords")) + [keyword])
        if keywords != _split_keyword_text(photo.get("keywords")):
            photo["keywords"] = keywords
            changed = True

    metadata = list(photo.get("metadata") or [])
    keyword_item = next((item for item in metadata if str(item.get("label", "")).casefold() == "keywords"), None)
    if keyword_item:
        keywords = _unique_keywords(_split_keyword_text(keyword_item.get("value")) + [keyword])
        next_value = ", ".join(keywords)
        if keyword_item.get("value") != next_value:
            keyword_item["value"] = next_value
            changed = True
    else:
        metadata.insert(0, {"label": "Keywords", "value": keyword})
        changed = True
    if changed:
        photo["metadata"] = metadata
    return changed


def _ensure_country_caption(photo: dict, slug: str) -> bool:
    keyword = COLLECTION_KEYWORD_TARGETS.get(slug)
    if not keyword:
        return False
    caption = str(photo.get("caption") or "")
    if not caption.startswith("Unknown /"):
        return False
    photo["caption"] = f"{keyword} /{caption.split('/', 1)[1]}"
    return True


def _asset_keywords(path: Path) -> list[str]:
    exiftool = shutil.which("exiftool")
    if not exiftool:
        return []
    result = subprocess.run(
        [exiftool, "-json", "-IPTC:Keywords", "-XMP:Subject", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout or "[]")
    if not payload:
        return []
    row = payload[0]
    return _unique_keywords(_split_keyword_text(row.get("Keywords")) + _split_keyword_text(row.get("Subject")))


def _append_unique_path(paths: list[Path], path: Path) -> None:
    try:
        resolved = path.resolve()
    except OSError:
        resolved = path
    if resolved not in paths:
        paths.append(resolved)


def _is_allowed_source_path(path: Path) -> bool:
    return "apple photo albums with faces" not in {part.lower() for part in path.parts}


def _source_path_variants(candidate: Path) -> list[Path]:
    variants: list[Path] = []
    suffixes = {candidate.suffix}
    if candidate.suffix:
        suffixes.add(candidate.suffix.lower())
        suffixes.add(candidate.suffix.upper())
    if candidate.suffix.lower() in {".jpg", ".jpeg", ".jpe"}:
        suffixes.update({".jpg", ".jpeg", ".JPG", ".JPEG"})
    for suffix in suffixes:
        _append_unique_path(variants, candidate.with_suffix(suffix))
    return variants


def _source_candidates(repo_root: Path, source_path: str) -> list[Path]:
    raw = Path(source_path)
    bases = [raw] if raw.is_absolute() else [repo_root / raw, *(root / raw for root in SOURCE_ROOT_CANDIDATES)]
    if not raw.is_absolute() and raw.name:
        bases.extend(root / raw.name for root in SOURCE_ROOT_CANDIDATES)
    candidates: list[Path] = []
    for base in bases:
        for variant in _source_path_variants(base):
            if _is_allowed_source_path(variant):
                _append_unique_path(candidates, variant)
    return candidates


def _find_source_by_basename(root: Path, names: set[str]) -> Path | None:
    if not root.exists() or not _is_allowed_source_path(root):
        return None
    try:
        entries = list(root.iterdir())
    except OSError:
        return None
    for entry in entries:
        if not _is_allowed_source_path(entry):
            continue
        try:
            if entry.is_file() and entry.name.lower() in names:
                return entry
        except OSError:
            continue
    for entry in entries:
        try:
            if entry.is_dir():
                found = _find_source_by_basename(entry, names)
                if found:
                    return found
        except OSError:
            continue
    return None


def _source_paths(repo_root: Path, photo: dict) -> list[Path]:
    paths = []
    for source in photo.get("sourceFiles") or []:
        raw_path = source.get("path")
        if not raw_path:
            continue
        for candidate in _source_candidates(repo_root, str(raw_path)):
            if candidate.exists():
                _append_unique_path(paths, candidate)
        if not paths:
            names = {variant.name.lower() for variant in _source_path_variants(Path(str(raw_path)))}
            for root in RECURSIVE_SOURCE_ROOT_CANDIDATES:
                found = _find_source_by_basename(root, names)
                if found:
                    _append_unique_path(paths, found)
                    break
    return paths


def _site_asset_paths(repo_root: Path, rel: str) -> list[Path]:
    """Resolve local working asset references used by owner-state mutations."""
    paths: list[Path] = []
    if not rel:
        return paths
    direct = repo_root / rel
    if direct.exists():
        _append_unique_path(paths, direct)
    return paths


def _photo_file_paths(repo_root: Path, photo: dict, include_source: bool = True) -> list[Path]:
    paths = []
    for key in ("gallerySrc", "imageSrc"):
        rel = clean_site_src(photo.get(key))
        if not rel:
            continue
        for path in _site_asset_paths(repo_root, rel):
            if path not in paths:
                paths.append(path)
    if include_source:
        paths.extend(path for path in _source_paths(repo_root, photo) if path not in paths)
    return paths


def _relative_to_repo(repo_root: Path, path: Path) -> Path | None:
    try:
        return path.relative_to(repo_root)
    except ValueError:
        return None


def _metadata_upload_items_for_paths(repo_root: Path, photo: dict, paths: list[Path]) -> list[UploadItem]:
    items: list[UploadItem] = []
    seen: set[str] = set()
    photo_id = str(photo.get("id") or "")
    allow_public = public_preview_allowed(photo) and photo_id not in r2_hidden_photo_ids(repo_root)
    allow_private = private_master_allowed(photo)
    for path in paths:
        if not path.exists():
            continue
        rel = _relative_to_repo(repo_root, path)
        if rel and rel.parts and rel.parts[0] == "assets":
            if len(rel.parts) < 3 or rel.parts[1] not in {"expo", "reserve"} or not allow_public:
                continue
            item = UploadItem(
                bucket=DEFAULT_PUBLIC_BUCKET,
                key=r2_public_key(DEFAULT_PUBLIC_PREFIX, photo, rel),
                path=path,
                content_type="image/jpeg",
                cache_control="public, max-age=31536000, immutable",
            )
        else:
            if not allow_private:
                continue
            item = UploadItem(
                bucket=DEFAULT_PRIVATE_BUCKET,
                key=r2_private_key(DEFAULT_PRIVATE_PREFIX, photo, path),
                path=path,
                content_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream",
            )
        identifier = r2_upload_id(item)
        if identifier in seen:
            continue
        seen.add(identifier)
        items.append(item)
    return items


def _update_r2_task(task_id: str, **updates: object) -> None:
    with R2_BACKGROUND_LOCK:
        task = R2_BACKGROUND_TASKS.get(task_id)
        if not task:
            return
        task.update(updates)
        task["updated_at"] = datetime.now(timezone.utc).isoformat()


def _run_r2_task(task_id: str, items: list[UploadItem], operation: str) -> None:
    _update_r2_task(task_id, state="running", started_at=datetime.now(timezone.utc).isoformat())
    for item in items:
        if operation == "delete":
            _record_r2_item_lifecycle(item, "marked_for_delete", "owner-r2-delete")
        try:
            if operation == "delete":
                _processed_item, ok, output = wrangler_delete(item, retries=2)
            else:
                _processed_item, ok, output = wrangler_put(item, retries=2)
        except Exception as error:  # noqa: BLE001 - background progress should capture any upload failure.
            ok = False
            output = str(error)
        with R2_BACKGROUND_LOCK:
            task = R2_BACKGROUND_TASKS.get(task_id)
            if not task:
                return
            task["completed"] = int(task.get("completed") or 0) + 1
            if ok:
                if operation == "upload" and item.path.exists():
                    task["bytes_done"] = int(task.get("bytes_done") or 0) + item.path.stat().st_size
                    _record_r2_item_lifecycle(item, "current", "owner-r2-upload")
                elif operation == "delete":
                    _record_r2_item_lifecycle(item, "deleted_confirmed", "owner-r2-delete")
            else:
                task["failed"] = int(task.get("failed") or 0) + 1
                errors = list(task.get("errors") or [])
                if len(errors) < 20:
                    errors.append({
                        "bucket": item.bucket,
                        "key": item.key,
                        "path": str(item.path),
                        "error": output,
                    })
                task["errors"] = errors
            task["updated_at"] = datetime.now(timezone.utc).isoformat()
    with R2_BACKGROUND_LOCK:
        task = R2_BACKGROUND_TASKS.get(task_id)
        if not task:
            return
        task["state"] = "failed" if int(task.get("failed") or 0) else "done"
        task["completed_at"] = datetime.now(timezone.utc).isoformat()
        task["updated_at"] = task["completed_at"]


def _start_r2_task(photo_id: str, items: list[UploadItem], kind: str, operation: str = "upload") -> dict | None:
    if not items:
        return None
    task_id = uuid.uuid4().hex
    queued_at = datetime.now(timezone.utc).isoformat()
    task = {
        "id": task_id,
        "kind": kind,
        "operation": operation,
        "photo_id": photo_id,
        "state": "queued",
        "queued_at": queued_at,
        "started_at": None,
        "completed_at": None,
        "updated_at": queued_at,
        "total": len(items),
        "completed": 0,
        "failed": 0,
        "bytes_total": sum(item.path.stat().st_size for item in items if operation == "upload" and item.path.exists()),
        "bytes_done": 0,
        "items": [
            {"bucket": item.bucket, "key": item.key, "path": str(item.path)}
            for item in items[:10]
        ],
        "errors": [],
    }
    with R2_BACKGROUND_LOCK:
        R2_BACKGROUND_TASKS[task_id] = task
    worker = threading.Thread(target=_run_r2_task, args=(task_id, items, operation), daemon=True)
    worker.start()
    return dict(task)


def _start_r2_upload_task(photo_id: str, items: list[UploadItem], kind: str = "metadata-upload") -> dict | None:
    return _start_r2_task(photo_id, items, kind, "upload")


def _start_r2_delete_task(photo_id: str, items: list[UploadItem], kind: str = "hidden-public-wipe") -> dict | None:
    return _start_r2_task(photo_id, items, kind, "delete")


def _record_r2_item_lifecycle(item: UploadItem, lifecycle_state: str, source: str) -> None:
    try:
        conn = owner_db_connect(Path.cwd())
        try:
            upsert_r2_object_state(
                conn,
                bucket=item.bucket,
                object_key=item.key,
                lifecycle_state=lifecycle_state,
                source=source,
                bytes_value=item.path.stat().st_size if lifecycle_state == "current" and item.path.exists() else None,
            )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        return


def _import_source_allowed_roots() -> list[Path]:
    roots = [root for root in IMPORT_SOURCE_ROOTS.values()]
    roots.extend(SOURCE_ROOT_CANDIDATES)
    return roots


def _resolve_import_source_thumbnail(phase: str, relative: str, source_hint: str) -> Path:
    if source_hint:
        source = Path(source_hint).expanduser().resolve()
        allowed = False
        for root in _import_source_allowed_roots():
            try:
                root_resolved = root.resolve()
            except OSError:
                continue
            if source == root_resolved or root_resolved in source.parents:
                allowed = True
                break
        if not allowed:
            raise ValueError("source path is outside known import roots")
    else:
        root = IMPORT_SOURCE_ROOTS.get(phase)
        if not root or not relative:
            raise ValueError("missing import source thumbnail parameters")
        relative_path = Path(relative)
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise ValueError("unsafe source path")
        root_resolved = root.resolve()
        source = (root_resolved / relative_path).resolve()
        if source != root_resolved and root_resolved not in source.parents:
            raise ValueError("unsafe source path")
    if not source.exists() or not source.is_file():
        raise FileNotFoundError(str(source))
    if source.suffix.lower() not in IMPORT_SOURCE_IMAGE_EXTENSIONS:
        raise ValueError("source is not a still image")
    return source


def _import_source_thumbnail_path(source: Path) -> Path:
    stat = source.stat()
    token = hashlib.sha256(f"{source}:{stat.st_size}:{stat.st_mtime_ns}".encode("utf-8")).hexdigest()
    thumb = IMPORT_SOURCE_THUMB_ROOT / f"{token}.jpg"
    if thumb.exists():
        return thumb
    thumb.parent.mkdir(parents=True, exist_ok=True)
    tmp = thumb.with_suffix(".tmp.jpg")
    result = subprocess.run(
        ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "82", "-Z", "96", str(source), "--out", str(tmp)],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0 or not tmp.exists():
        tmp.unlink(missing_ok=True)
        raise OSError((result.stderr or result.stdout or "thumbnail render failed").strip())
    tmp.replace(thumb)
    return thumb


def _r2_task_snapshot() -> list[dict]:
    repo_root = Path.cwd()
    cutoff = time.time() - 60 * 60
    active_states = {"queued", "running"}
    with R2_BACKGROUND_LOCK:
        stale = [
            task_id
            for task_id, task in R2_BACKGROUND_TASKS.items()
            if task.get("state") in {"done", "failed"}
            and task.get("completed_at")
            and _iso_to_timestamp(str(task["completed_at"])) < cutoff
        ]
        for task_id in stale:
            R2_BACKGROUND_TASKS.pop(task_id, None)
        tasks = [dict(task) for task in R2_BACKGROUND_TASKS.values()]
    tasks = [
        _hydrate_cloud_media_sweep_task(repo_root, task)
        if task.get("kind") == "cloud-media-sweep" and task.get("state") in active_states
        else task
        for task in tasks
    ]
    has_active_sweep = any(
        task.get("kind") == "cloud-media-sweep" and task.get("state") in active_states
        for task in tasks
    )
    if not has_active_sweep:
        external = _external_cloud_media_sweep_task(repo_root)
        if external:
            tasks.append(external)
    return sorted(
        tasks,
        key=lambda task: (
            0 if task.get("state") in active_states else 1,
            str(task.get("queued_at") or ""),
        ),
    )


def _live_cloud_media_sweep_pid(repo_root: Path) -> int | None:
    pid_path = _cloud_media_sweep_lock_dir(repo_root) / "pid"
    try:
        pid = int(pid_path.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None
    try:
        os.kill(pid, 0)
    except OSError:
        return None
    return pid


def _cloud_media_sweep_lock_dir(repo_root: Path) -> Path:
    return repo_root / ".review-logs" / "cloud-media-sweep.lock"


def _cloud_media_sweep_skip_path(repo_root: Path) -> Path:
    return _cloud_media_sweep_lock_dir(repo_root) / "skip-phases"


def _cloud_media_sweep_current_phase_path(repo_root: Path) -> Path:
    return _cloud_media_sweep_lock_dir(repo_root) / "current-phase"


def _cloud_media_sweep_current_child_path(repo_root: Path) -> Path:
    return _cloud_media_sweep_lock_dir(repo_root) / "current-child-pid"


def _normalize_r2_sweep_skip_phases(value: object) -> list[str]:
    if value is None:
        return []
    values: list[object]
    if isinstance(value, str):
        values = re.split(r"[\s,]+", value)
    elif isinstance(value, list):
        values = value
    else:
        raise ValueError("skipPhases must be a string or list")
    result: list[str] = []
    seen: set[str] = set()
    for raw in values:
        key = str(raw or "").strip()
        if not key:
            continue
        if key not in R2_SWEEP_SKIPPABLE_PHASES:
            raise ValueError(f"unsupported R2 sweep phase: {key}")
        if key in seen:
            continue
        seen.add(key)
        result.append(key)
    return result


def _read_cloud_media_sweep_skip_phases(repo_root: Path) -> list[str]:
    try:
        lines = _cloud_media_sweep_skip_path(repo_root).read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    try:
        return _normalize_r2_sweep_skip_phases(lines)
    except ValueError:
        return []


def _write_cloud_media_sweep_skip_phases(repo_root: Path, skip_phases: list[str]) -> None:
    path = _cloud_media_sweep_skip_path(repo_root)
    if not path.parent.exists():
        return
    path.write_text("".join(f"{phase}\n" for phase in skip_phases), encoding="utf-8")


def _merge_r2_sweep_skip_phases(*phase_lists: list[str]) -> list[str]:
    merged: list[str] = []
    seen: set[str] = set()
    for phases in phase_lists:
        for phase in phases:
            if phase in seen:
                continue
            seen.add(phase)
            merged.append(phase)
    return merged


def _read_cloud_media_sweep_current_phase(repo_root: Path) -> str:
    try:
        phase_key = _cloud_media_sweep_current_phase_path(repo_root).read_text(encoding="utf-8").strip()
    except OSError:
        return ""
    return phase_key if phase_key in R2_SWEEP_SKIPPABLE_PHASES else ""


def _read_cloud_media_sweep_current_child_pid(repo_root: Path) -> int | None:
    try:
        return int(_cloud_media_sweep_current_child_path(repo_root).read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None


def _child_pids(pid: int) -> list[int]:
    result = subprocess.run(["pgrep", "-P", str(pid)], text=True, capture_output=True, check=False)
    children: list[int] = []
    for line in result.stdout.splitlines():
        try:
            children.append(int(line.strip()))
        except ValueError:
            continue
    return children


def _terminate_process_tree(pid: int | None) -> bool:
    if not pid:
        return False
    terminated = False
    for child in _child_pids(pid):
        terminated = _terminate_process_tree(child) or terminated
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        return terminated
    terminated = True
    time.sleep(0.5)
    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        pass
    return terminated


def _wait_for_cloud_media_sweep_phase_change(repo_root: Path, previous_phase: str) -> str:
    deadline = time.time() + 3
    current_phase = previous_phase
    while time.time() < deadline:
        current_phase = _read_cloud_media_sweep_current_phase(repo_root)
        if current_phase != previous_phase:
            return current_phase
        if not current_phase:
            return ""
        time.sleep(0.2)
    return current_phase


def _hydrate_cloud_media_sweep_task(repo_root: Path, task: dict) -> dict:
    hydrated = dict(task)
    live_pid = _live_cloud_media_sweep_pid(repo_root)
    current_phase = _read_cloud_media_sweep_current_phase(repo_root)
    if live_pid is not None:
        hydrated["external_pid"] = live_pid
    hydrated["skipPhases"] = _read_cloud_media_sweep_skip_phases(repo_root)
    hydrated["currentPhaseKey"] = current_phase
    hydrated["currentChildPid"] = _read_cloud_media_sweep_current_child_pid(repo_root)
    hydrated["updated_at"] = datetime.now(timezone.utc).isoformat()
    return hydrated


def _latest_cloud_media_sweep_log(repo_root: Path) -> Path | None:
    log_root = repo_root / ".review-logs"
    try:
        logs = list(log_root.glob("cloud-media-sweep-resume-*.log"))
    except OSError:
        return None
    if not logs:
        return None
    return max(logs, key=lambda path: path.stat().st_mtime)


def _external_cloud_media_sweep_task(repo_root: Path) -> dict | None:
    pid = _live_cloud_media_sweep_pid(repo_root)
    if pid is None:
        return None
    started_path = _cloud_media_sweep_lock_dir(repo_root) / "started_at"
    try:
        started_at = started_path.read_text(encoding="utf-8").strip()
    except OSError:
        started_at = datetime.now(timezone.utc).isoformat()
    log_path = _latest_cloud_media_sweep_log(repo_root)
    updated_at = datetime.now(timezone.utc).isoformat()
    task = {
        "id": f"external-cloud-media-sweep-{pid}",
        "kind": "cloud-media-sweep",
        "operation": "repair",
        "photo_id": "catalog",
        "state": "running",
        "queued_at": started_at,
        "started_at": started_at,
        "completed_at": None,
        "updated_at": updated_at,
        "total": 1,
        "completed": 0,
        "failed": 0,
        "bytes_total": 0,
        "bytes_done": 0,
        "external_pid": pid,
        "skipPhases": _read_cloud_media_sweep_skip_phases(repo_root),
        "currentPhaseKey": _read_cloud_media_sweep_current_phase(repo_root),
        "currentChildPid": _read_cloud_media_sweep_current_child_pid(repo_root),
        "items": [{"command": "existing lock-guarded cloud media sweep", "log": str(log_path) if log_path else ""}],
        "errors": [],
    }
    if log_path:
        task["log"] = str(log_path)
    return task


def _coverage_row(
    label: str,
    present: int,
    expected: int,
    bucket: str,
    object_class: str,
    blocked_excluded: int = 0,
    blocked_present: int = 0,
) -> dict:
    missing = max(0, expected - present)
    extra = max(0, present - expected)
    return {
        "label": label,
        "present": present,
        "expected": expected,
        "totalExpected": expected + blocked_excluded,
        "missing": missing,
        "extra": extra,
        "blockedExcluded": blocked_excluded,
        "blockedPresent": blocked_present,
        "ok": missing == 0 and extra == 0,
        "bucket": bucket,
        "objectClass": object_class,
    }


def _owner_db_current_r2_keys(repo_root: Path) -> set[str]:
    try:
        conn = owner_db_connect(repo_root)
        try:
            backfill_r2_object_metadata(conn)
            conn.commit()
            return {
                f"{row['bucket']}/{row['object_key']}"
                for row in conn.execute(
                    "SELECT bucket, object_key FROM r2_objects WHERE lifecycle_state = 'current'"
                )
                if row["bucket"] and row["object_key"]
            }
        finally:
            conn.close()
    except Exception:
        return set()


def _r2_key_known_current(current_keys: set[str], bucket: str, key: object) -> bool:
    clean_key = str(key or "").strip()
    return bool(clean_key and f"{bucket}/{clean_key}" in current_keys)


def _apply_owner_db_r2_coverage(
    record: dict,
    photo_id: str,
    private_bucket: str,
    public_bucket: str,
    current_keys: set[str],
) -> set[str]:
    trusted: set[str] = set()
    master = record.get("privateMaster") if isinstance(record.get("privateMaster"), dict) else {}
    master_key = master.get("expectedKey") or master.get("key")
    if master.get("present") is not True and _r2_key_known_current(current_keys, private_bucket, master_key):
        master["present"] = True
        master["key"] = str(master_key)
        master["trustedBy"] = "owner-db"
        record["privateMaster"] = master
        trusted.add("master")

    renders = record.get("privateRenders") if isinstance(record.get("privateRenders"), dict) else {}
    for product_id, render in renders.items():
        if not isinstance(render, dict):
            continue
        render_key = render.get("expectedKey") or render.get("key")
        if render.get("present") is not True and _r2_key_known_current(current_keys, private_bucket, render_key):
            render["present"] = True
            render["key"] = str(render_key)
            render["trustedBy"] = "owner-db"
            trusted.add(f"render:{product_id}")

    previews = record.get("publicPreviews") if isinstance(record.get("publicPreviews"), dict) else {}
    media_type = str(record.get("mediaType") or "photo")
    gallery_key = public_preview_key(DEFAULT_PUBLIC_PREFIX, photo_id, "gallery", media_type)
    detail_key = public_preview_key(DEFAULT_PUBLIC_PREFIX, photo_id, "detail", media_type)
    if previews.get("present") is not True and all(
        _r2_key_known_current(current_keys, public_bucket, key)
        for key in (gallery_key, detail_key)
    ):
        previews["present"] = True
        previews["galleryKey"] = gallery_key
        previews["detailKey"] = detail_key
        previews["trustedBy"] = "owner-db"
        record["publicPreviews"] = previews
        trusted.add("public-previews")
    return trusted


def _resolve_source_path(repo_root: Path, source_path: str) -> str:
    if not source_path:
        return ""
    for candidate in _source_candidates(repo_root, source_path):
        try:
            if candidate.is_file():
                return str(candidate)
        except OSError:
            continue
    names = {variant.name.lower() for variant in _source_path_variants(Path(source_path))}
    for root in RECURSIVE_SOURCE_ROOT_CANDIDATES:
        found = _find_source_by_basename(root, names)
        if found and found.is_file():
            return str(found)
    return ""


def _private_delivery_missing_details(
    repo_root: Path,
    active_records: list[tuple[str, dict]],
    limit: int = 50,
    resolve_sources: bool = True,
) -> list[dict]:
    missing: list[dict] = []
    for photo_id, record in active_records:
        source_path = str(record.get("sourcePath") or "")
        source_file = _resolve_source_path(repo_root, source_path) if resolve_sources else ""
        source_repair_state = "source_missing" if resolve_sources else "source_not_checked"
        master = record.get("privateMaster") if isinstance(record.get("privateMaster"), dict) else {}
        if master.get("present") is not True:
            missing.append({
                "photoId": photo_id,
                "kind": "master",
                "productId": "full",
                "productLabel": "Full resolution",
                "objectKey": master.get("key") or master.get("expectedKey") or "",
                "sourcePath": source_path,
                "sourceFile": source_file,
                "repair": "upload_source_master" if source_file else source_repair_state,
            })
        renders = record.get("privateRenders") if isinstance(record.get("privateRenders"), dict) else {}
        if renders:
            for product_id, label in (("jpg-6mp", "JPG 6 MP"), ("jpg-3mp", "JPG 3 MP"), ("jpg-1mp", "JPG 1 MP")):
                render = renders.get(product_id) if isinstance(renders.get(product_id), dict) else {}
                if render.get("present") is True:
                    continue
                missing.append({
                    "photoId": photo_id,
                    "kind": "render",
                    "productId": product_id,
                    "productLabel": label,
                    "objectKey": render.get("key") or render.get("expectedKey") or "",
                    "sourcePath": source_path,
                    "sourceFile": source_file,
                    "repair": "render_from_source" if source_file else source_repair_state,
                })
                if limit > 0 and len(missing) >= limit:
                    return missing
        if limit > 0 and len(missing) >= limit:
            return missing
    return missing


def _missing_import_photo_details(
    repo_root: Path,
    active_records: list[tuple[str, dict]],
    limit: int = 80,
    resolve_sources: bool = True,
) -> list[dict]:
    missing: list[dict] = []
    for photo_id, record in active_records:
        master = record.get("privateMaster") if isinstance(record.get("privateMaster"), dict) else {}
        renders = record.get("privateRenders") if isinstance(record.get("privateRenders"), dict) else {}
        previews = record.get("publicPreviews") if isinstance(record.get("publicPreviews"), dict) else {}
        master_missing = master.get("present") is not True
        render_missing = any(
            isinstance(render, dict) and render.get("present") is not True
            for render in renders.values()
        )
        previews_missing = previews.get("present") is not True
        if not master_missing and not render_missing and not previews_missing:
            continue
        source_path = str(record.get("sourcePath") or "")
        source_file = _resolve_source_path(repo_root, source_path) if resolve_sources else ""
        media_type = str(record.get("mediaType") or "")
        missing.append({
            "photoId": photo_id,
            "relativePath": source_path,
            "sourceFile": source_file,
            "collectionKey": str(record.get("collectionKey") or ""),
            "mediaType": media_type,
            "steps": {
                "master_uploaded": {"status": "pending" if master_missing else "done", "total": 1, "completed": 0 if master_missing else 1},
                "triplets_created": {
                    "status": "pending" if render_missing else ("skipped" if not renders else "done"),
                    "total": len(renders),
                    "completed": sum(1 for render in renders.values() if isinstance(render, dict) and render.get("present") is True),
                },
                "triplets_uploaded": {
                    "status": "pending" if render_missing else ("skipped" if not renders else "done"),
                    "total": len(renders),
                    "completed": sum(1 for render in renders.values() if isinstance(render, dict) and render.get("present") is True),
                },
                "previews_created": {"status": "pending" if previews_missing else "done", "total": 2, "completed": 0 if previews_missing else 2},
                "previews_uploaded": {"status": "pending" if previews_missing else "done", "total": 2, "completed": 0 if previews_missing else 2},
            },
            "missing": {
                "master": master_missing,
                "renders": render_missing,
                "previews": previews_missing,
            },
        })
        if limit > 0 and len(missing) >= limit:
            break
    return missing


def _r2_coverage_summary(
    repo_root: Path,
    resolve_sources: bool = True,
    private_missing_limit: int = 50,
    import_missing_limit: int = 80,
) -> dict:
    private_manifest = _read_json_file(repo_root / "assets/private-delivery-manifest.json", {})
    sidecar = _read_json_file(repo_root / "assets/media-sidecar.json", {})
    hidden_blacklist = _read_json_file(repo_root / "assets/hidden/hidden-blacklist.json", {})
    discarded_tombstone = _read_json_file(repo_root / DISCARDED_TOMBSTONE_PATH, {})
    hidden_photo_ids = set()
    if isinstance(hidden_blacklist, dict) and isinstance(hidden_blacklist.get("photo_ids"), list):
        hidden_photo_ids = {str(photo_id) for photo_id in hidden_blacklist["photo_ids"] if photo_id}
    discarded_photo_ids = set()
    if isinstance(discarded_tombstone, dict):
        discarded_photo_ids.update(str(photo_id) for photo_id in discarded_tombstone.get("photo_ids") or [] if photo_id)
        discarded_photo_ids.update(str(photo.get("id")) for photo in discarded_tombstone.get("photos") or [] if isinstance(photo, dict) and photo.get("id"))
    excluded_photo_ids = hidden_photo_ids | discarded_photo_ids
    records = private_manifest.get("records") if isinstance(private_manifest, dict) else {}
    if not isinstance(records, dict):
        records = {}
    photos = sidecar.get("photos") if isinstance(sidecar, dict) else {}
    if not isinstance(photos, dict):
        photos = {}

    expected = max(
        len(records),
        len(photos),
        int(private_manifest.get("catalogPhotos") or 0) if isinstance(private_manifest, dict) else 0,
    )
    private_bucket = str(private_manifest.get("privateBucket") or "photosbyelie-private") if isinstance(private_manifest, dict) else "photosbyelie-private"
    public_bucket = "photosbyelie-public"
    owner_current_r2_keys = _owner_db_current_r2_keys(repo_root)
    record_items = [(str(photo_id), record) for photo_id, record in records.items() if isinstance(record, dict)]
    trusted_by_owner_db: dict[str, list[str]] = {}
    if owner_current_r2_keys:
        for photo_id, record in record_items:
            trusted = _apply_owner_db_r2_coverage(record, photo_id, private_bucket, public_bucket, owner_current_r2_keys)
            if trusted:
                trusted_by_owner_db[photo_id] = sorted(trusted)
    active_records = [(photo_id, record) for photo_id, record in record_items if photo_id not in excluded_photo_ids]
    blocked_records = [(photo_id, record) for photo_id, record in record_items if photo_id in excluded_photo_ids]
    active_expected = len(active_records) or expected
    blocked_excluded = len(blocked_records)
    active_render_records = [
        (photo_id, record)
        for photo_id, record in active_records
        if isinstance(record.get("privateRenders"), dict) and record.get("privateRenders")
    ]
    blocked_render_records = [
        (photo_id, record)
        for photo_id, record in blocked_records
        if isinstance(record.get("privateRenders"), dict) and record.get("privateRenders")
    ]
    render_expected = len(active_render_records) or active_expected
    blocked_render_excluded = len(blocked_render_records)

    master_present_for_catalog = sum(1 for _photo_id, record in active_records if record.get("privateMaster", {}).get("present") is True)
    master_present = int(private_manifest.get("privateMasterPhotoIds") or master_present_for_catalog) if isinstance(private_manifest, dict) else master_present_for_catalog
    render_present = {
        product: sum(1 for _photo_id, record in active_render_records if record.get("privateRenders", {}).get(product, {}).get("present") is True)
        for product in ("jpg-6mp", "jpg-3mp", "jpg-1mp")
    }
    blocked_present = {
        "master": sum(1 for _photo_id, record in blocked_records if record.get("privateMaster", {}).get("present") is True),
        "public": sum(1 for _photo_id, record in blocked_records if record.get("publicPreviews", {}).get("present") is True),
        **{
            product: sum(1 for _photo_id, record in blocked_records if record.get("privateRenders", {}).get(product, {}).get("present") is True)
            for product in ("jpg-6mp", "jpg-3mp", "jpg-1mp")
        },
    }
    public_present = sum(1 for _photo_id, record in active_records if record.get("publicPreviews", {}).get("present") is True)
    sidecar_gallery_expected = sum(1 for photo in photos.values() if photo.get("publicPreview", {}).get("galleryKey"))
    sidecar_detail_expected = sum(1 for photo in photos.values() if photo.get("publicPreview", {}).get("detailKey"))
    gallery_expected = active_expected if sidecar_gallery_expected else active_expected
    detail_expected = active_expected if sidecar_detail_expected else active_expected

    rows = [
        _coverage_row("Private masters", master_present_for_catalog, active_expected, private_bucket, "masters", blocked_excluded, blocked_present["master"]),
        _coverage_row("Private JPG 6 MP", render_present["jpg-6mp"], render_expected, private_bucket, "renders/jpg-6mp", blocked_render_excluded, blocked_present["jpg-6mp"]),
        _coverage_row("Private JPG 3 MP", render_present["jpg-3mp"], render_expected, private_bucket, "renders/jpg-3mp", blocked_render_excluded, blocked_present["jpg-3mp"]),
        _coverage_row("Private JPG 1 MP", render_present["jpg-1mp"], render_expected, private_bucket, "renders/jpg-1mp", blocked_render_excluded, blocked_present["jpg-1mp"]),
        _coverage_row("Preview low 900px", min(public_present, gallery_expected), gallery_expected, public_bucket, "expo/*_900.jpg", blocked_excluded, blocked_present["public"]),
        _coverage_row("Preview high 1800px", min(public_present, detail_expected), detail_expected, public_bucket, "expo/*_1800.jpg", blocked_excluded, blocked_present["public"]),
    ]
    missing_rows = [row for row in rows if not row["ok"]]
    missing_private_delivery = _private_delivery_missing_details(
        repo_root,
        active_records,
        limit=private_missing_limit,
        resolve_sources=resolve_sources,
    )
    missing_import_photos = _missing_import_photo_details(
        repo_root,
        active_records,
        limit=import_missing_limit,
        resolve_sources=resolve_sources,
    )
    if missing_rows:
        recommendation = "Missing coverage. Run the lock-guarded cloud media sweep."
    else:
        recommendation = "Coverage matches policy for the current catalog manifest."
    return {
        "updatedAt": private_manifest.get("updatedAt") if isinstance(private_manifest, dict) else None,
        "catalogPhotos": expected,
        "activeCatalogPhotos": active_expected,
        "blockedCatalogPhotos": blocked_excluded,
        "discardedCatalogPhotos": len([photo_id for photo_id, _record in record_items if photo_id in discarded_photo_ids]),
        "ownerDbCurrentObjects": len(owner_current_r2_keys),
        "ownerDbTrustedPhotos": len(trusted_by_owner_db),
        "sidecarPhotos": len(photos),
        "rows": rows,
        "missingPrivateDelivery": missing_private_delivery,
        "missingImportPhotos": missing_import_photos,
        "ok": not missing_rows,
        "recommendation": recommendation,
        "fixAvailable": True,
        "fixCommand": "zsh -lc './scripts/run_cloud_media_sweep.zsh --push'",
        "note": "The sweep repairs R2 and refreshes tracked manifests.",
    }


def _run_cloud_media_sweep_task(task_id: str, repo_root: Path, log_path: Path, skip_phases: list[str]) -> None:
    _update_r2_task(task_id, state="running", started_at=datetime.now(timezone.utc).isoformat())
    log_path.parent.mkdir(parents=True, exist_ok=True)
    command = ["zsh", "scripts/run_cloud_media_sweep.zsh", "--push"]
    for phase_key in skip_phases:
        command.extend(["--skip-phase", phase_key])
    with log_path.open("ab") as log:
        process = subprocess.run(command, cwd=repo_root, stdout=log, stderr=subprocess.STDOUT)
    coverage = _r2_coverage_summary(repo_root, resolve_sources=False, private_missing_limit=0, import_missing_limit=0)
    coverage_ok = bool(coverage.get("ok"))
    errors = []
    failed = process.returncode != 0 or not coverage_ok
    if process.returncode != 0:
        errors.append(f"cloud media sweep exited {process.returncode}")
    if not coverage_ok:
        rows = coverage.get("rows") if isinstance(coverage, dict) else []
        missing = max((int(row.get("missing") or 0) for row in rows if isinstance(row, dict)), default=0)
        errors.append(f"coverage still missing {missing:,} catalog photos")
    with R2_BACKGROUND_LOCK:
        task = R2_BACKGROUND_TASKS.get(task_id)
        if not task:
            return
        task["completed"] = 1
        task["state"] = "failed" if failed else "done"
        task["failed"] = 1 if failed else 0
        task["return_code"] = process.returncode
        task["coverage_ok"] = coverage_ok
        task["errors"] = errors
        task["completed_at"] = datetime.now(timezone.utc).isoformat()
        task["updated_at"] = task["completed_at"]


def _start_cloud_media_sweep(repo_root: Path, skip_phases: list[str] | None = None) -> dict:
    external = _external_cloud_media_sweep_task(repo_root)
    if external:
        return external
    skip_phases = list(skip_phases or [])
    active_states = {"queued", "running"}
    with R2_BACKGROUND_LOCK:
        existing = next(
            (
                dict(task)
                for task in R2_BACKGROUND_TASKS.values()
                if task.get("operation") in {"repair", "gap-fill"} and task.get("state") in active_states
            ),
            None,
        )
    if existing:
        return existing
    task_id = uuid.uuid4().hex
    queued_at = datetime.now(timezone.utc).isoformat()
    log_path = repo_root / ".review-logs" / f"owner-r2-fix-{task_id}.log"
    command = ["zsh", "scripts/run_cloud_media_sweep.zsh", "--push"]
    for phase_key in skip_phases:
        command.extend(["--skip-phase", phase_key])
    task = {
        "id": task_id,
        "kind": "cloud-media-sweep",
        "operation": "repair",
        "photo_id": "catalog",
        "state": "queued",
        "queued_at": queued_at,
        "started_at": None,
        "completed_at": None,
        "updated_at": queued_at,
        "total": 1,
        "completed": 0,
        "failed": 0,
        "bytes_total": 0,
        "bytes_done": 0,
        "skipPhases": skip_phases,
        "items": [{"command": " ".join(command), "log": str(log_path)}],
        "errors": [],
        "log": str(log_path),
    }
    with R2_BACKGROUND_LOCK:
        R2_BACKGROUND_TASKS[task_id] = task
    worker = threading.Thread(target=_run_cloud_media_sweep_task, args=(task_id, repo_root, log_path, skip_phases), daemon=True)
    worker.start()
    return dict(task)


def _run_r2_gap_fill_task(task_id: str, repo_root: Path, log_path: Path, limit: int) -> None:
    _update_r2_task(task_id, state="running", started_at=datetime.now(timezone.utc).isoformat(), currentPhaseKey="gap-fill")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    command = ["python3", "scripts/fill_r2_coverage_gaps.py"]
    if limit:
        command.extend(["--limit", str(limit)])
    with log_path.open("ab") as log:
        process = subprocess.run(command, cwd=repo_root, stdout=log, stderr=subprocess.STDOUT)
    coverage = _r2_coverage_summary(repo_root, resolve_sources=False, private_missing_limit=0, import_missing_limit=0)
    coverage_ok = bool(coverage.get("ok"))
    errors = []
    failed = process.returncode != 0 or not coverage_ok
    if process.returncode != 0:
        errors.append(f"gap fill exited {process.returncode}")
    if not coverage_ok:
        rows = coverage.get("rows") if isinstance(coverage, dict) else []
        missing = max((int(row.get("missing") or 0) for row in rows if isinstance(row, dict)), default=0)
        errors.append(f"coverage still missing {missing:,} catalog photos")
    with R2_BACKGROUND_LOCK:
        task = R2_BACKGROUND_TASKS.get(task_id)
        if not task:
            return
        task["completed"] = int(task.get("total") or 1)
        task["state"] = "failed" if failed else "done"
        task["failed"] = 1 if failed else 0
        task["return_code"] = process.returncode
        task["coverage_ok"] = coverage_ok
        task["errors"] = errors
        task["completed_at"] = datetime.now(timezone.utc).isoformat()
        task["updated_at"] = task["completed_at"]


def _start_r2_gap_fill(repo_root: Path, limit: int = 0) -> dict:
    active_states = {"queued", "running"}
    with R2_BACKGROUND_LOCK:
        existing = next(
            (
                dict(task)
                for task in R2_BACKGROUND_TASKS.values()
                if task.get("operation") in {"repair", "gap-fill"} and task.get("state") in active_states
            ),
            None,
        )
    if existing:
        return existing
    coverage = _r2_coverage_summary(repo_root, resolve_sources=False, private_missing_limit=0, import_missing_limit=0)
    missing_photos = coverage.get("missingImportPhotos") if isinstance(coverage, dict) else []
    total = len(missing_photos) if isinstance(missing_photos, list) else 0
    if limit:
        total = min(total, limit)
    task_id = uuid.uuid4().hex
    queued_at = datetime.now(timezone.utc).isoformat()
    log_path = repo_root / ".review-logs" / f"owner-r2-gap-fill-{task_id}.log"
    command = ["python3", "scripts/fill_r2_coverage_gaps.py"]
    if limit:
        command.extend(["--limit", str(limit)])
    task = {
        "id": task_id,
        "kind": "r2-gap-fill",
        "operation": "gap-fill",
        "photo_id": "catalog",
        "state": "queued",
        "queued_at": queued_at,
        "started_at": None,
        "completed_at": None,
        "updated_at": queued_at,
        "total": total,
        "completed": 0,
        "failed": 0,
        "bytes_total": 0,
        "bytes_done": 0,
        "currentPhaseKey": "gap-fill",
        "items": [{"command": " ".join(command), "log": str(log_path)}],
        "errors": [],
        "log": str(log_path),
    }
    with R2_BACKGROUND_LOCK:
        R2_BACKGROUND_TASKS[task_id] = task
    worker = threading.Thread(target=_run_r2_gap_fill_task, args=(task_id, repo_root, log_path, limit), daemon=True)
    worker.start()
    return dict(task)


def _iso_to_timestamp(value: str) -> float:
    try:
        return datetime.fromisoformat(value).timestamp()
    except ValueError:
        return time.time()


def _write_file_metadata(path: Path, title: str | None = None, keywords: list[str] | None = None, append_keyword: str | None = None) -> str:
    exiftool = shutil.which("exiftool")
    if not exiftool:
        raise FileNotFoundError("exiftool not found")
    command = [exiftool, "-overwrite_original", "-P"]
    if title is not None:
        command.extend([
            f"-IPTC:ObjectName={title}",
            f"-XMP-dc:Title={title}",
            f"-EXIF:ImageDescription={title}",
        ])
    if keywords is not None:
        command.extend(["-IPTC:Keywords=", "-XMP-dc:Subject="])
        for keyword in _unique_keywords(keywords):
            command.extend([f"-IPTC:Keywords+={keyword}", f"-XMP-dc:Subject+={keyword}"])
    if append_keyword:
        existing = _asset_keywords(path)
        keywords = _unique_keywords(existing + [append_keyword])
        command.extend(["-IPTC:Keywords=", "-XMP-dc:Subject="])
        for keyword in keywords:
            command.extend([f"-IPTC:Keywords+={keyword}", f"-XMP-dc:Subject+={keyword}"])
    command.append(str(path))
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    return (result.stdout or result.stderr).strip()


def _sync_asset_keyword(repo_root: Path, photo: dict, keyword: str) -> dict:
    exiftool = shutil.which("exiftool")
    if not exiftool:
        return {"updated": 0, "skipped": 0, "errors": ["exiftool not found"]}
    updated = 0
    skipped = 0
    errors = []
    updated_paths = []
    for path in _photo_file_paths(repo_root, photo):
        rel = path.relative_to(repo_root).as_posix() if path.is_relative_to(repo_root) else str(path)
        try:
            existing = _asset_keywords(path)
            if keyword.casefold() in {item.casefold() for item in existing}:
                skipped += 1
                continue
            _write_file_metadata(path, append_keyword=keyword)
            updated += 1
            updated_paths.append(str(path))
        except (OSError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
            errors.append(f"{rel}: {error}")
    return {"updated": updated, "skipped": skipped, "errors": errors, "updated_paths": updated_paths}


def _apply_collection_keyword(repo_root: Path, photo: dict, slug: str, sync_assets: bool = False) -> dict:
    keyword = COLLECTION_KEYWORD_TARGETS.get(slug)
    if not keyword:
        return {
            "keyword": "",
            "metadata_changed": False,
            "caption_changed": False,
            "assets": {"updated": 0, "skipped": 0, "errors": [], "state": "manifest-only"},
        }
    metadata_changed = _ensure_photo_keyword(photo, keyword)
    caption_changed = _ensure_country_caption(photo, slug)
    assets = (
        _sync_asset_keyword(repo_root, photo, keyword)
        if sync_assets
        else {"updated": 0, "skipped": 0, "errors": [], "state": "manifest-only"}
    )
    return {
        "keyword": keyword,
        "metadata_changed": metadata_changed,
        "caption_changed": caption_changed,
        "assets": assets,
    }


def _sync_collection_keywords(repo_root: Path, *state_groups: dict[str, list[dict]]) -> dict:
    photos_seen = 0
    metadata_changed = 0
    asset_updated = 0
    asset_skipped = 0
    errors = []
    for groups in state_groups:
        for slug, keyword in COLLECTION_KEYWORD_TARGETS.items():
            for photo in groups.get(slug, []):
                photos_seen += 1
                result = _apply_collection_keyword(repo_root, photo, slug, sync_assets=False)
                if result["metadata_changed"] or result["caption_changed"]:
                    metadata_changed += 1
                asset_updated += result["assets"].get("updated", 0)
                asset_skipped += result["assets"].get("skipped", 0)
                errors.extend(result["assets"].get("errors", []))
    return {
        "photos_seen": photos_seen,
        "metadata_changed": metadata_changed,
        "asset_updated": asset_updated,
        "asset_skipped": asset_skipped,
        "r2_upload_task": None,
        "state": "manifest-only",
        "errors": errors[:20],
        "error_count": len(errors),
    }


def _slugify(value: str, fallback: str = "client") -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value or "").casefold()).strip("-")
    return slug or fallback


def _key_prefix(value: str) -> str:
    return re.sub(r"/+", "/", str(value or "").strip().strip("/"))


def _real_estate_client_name(client) -> str:
    if isinstance(client, dict):
        return str(client.get("customer") or client.get("name") or client.get("id") or "").strip()
    return str(client or "").strip()


def _real_estate_client_slug(client) -> str:
    return _slugify(_real_estate_client_name(client), "client")


def _real_estate_convention_fields(customer: str) -> dict[str, str]:
    client_name = _real_estate_client_name(customer)
    client_slug = _real_estate_client_slug(client_name)
    return {
        "id": client_slug,
        "username": client_name,
        "sourceRoot": str(REAL_ESTATE_SOURCE_ROOT / client_name) if client_name else "",
        "outputSlug": client_slug,
        "publicSlug": client_slug,
        "galleryKey": f"{client_name}-gallery" if client_name else "",
        "galleryTitle": client_name,
        "publicKeyPrefix": _key_prefix(f"RE/{client_name}/previews") if client_name else "",
        "privateKeyPrefix": _key_prefix(f"RE/{client_name}/masters") if client_name else "",
    }


def _real_estate_config_path(repo_root: Path) -> Path:
    return repo_root / REAL_ESTATE_CLIENTS_PATH


def _real_estate_client_output_slug(client: dict) -> str:
    return _slugify(str(client.get("outputSlug") or _real_estate_client_slug(client)), "client")


def _real_estate_client_public_slug(client: dict) -> str:
    return _slugify(str(client.get("publicSlug") or _real_estate_client_output_slug(client)), "client")


def _real_estate_paths(repo_root: Path, client: dict) -> dict[str, Path]:
    output_slug = _real_estate_client_output_slug(client)
    public_slug = _real_estate_client_public_slug(client)
    import_dir = repo_root / REAL_ESTATE_IMPORT_ROOT / output_slug
    public_dir = repo_root / REAL_ESTATE_PUBLIC_ROOT / public_slug
    return {
        "import_dir": import_dir,
        "manifest": import_dir / "manifest.json",
        "summary": import_dir / "summary.json",
        "local_context": import_dir / "app-context.js",
        "public_dir": public_dir,
        "public_context": public_dir / "app-context.js",
    }


def _repo_rel(repo_root: Path, path: Path) -> str:
    try:
        return path.relative_to(repo_root).as_posix()
    except ValueError:
        return str(path)


def _manifest_client_seed(repo_root: Path, output_slug: str, manifest: dict) -> dict:
    customer = manifest.get("customer") if isinstance(manifest.get("customer"), dict) else {}
    gallery = manifest.get("gallery") if isinstance(manifest.get("gallery"), dict) else {}
    customer_name = str(customer.get("name") or output_slug).strip()
    convention = _real_estate_convention_fields(customer_name)
    return {
        "id": convention["id"],
        "customer": customer_name,
        "email": str(customer.get("email") or "").strip(),
        "username": convention["username"],
        "accessCode": str(customer.get("accessCode") or "").strip(),
        "accessCodeSalt": str(customer.get("accessCodeSalt") or uuid.uuid4().hex).strip(),
        "sourceRoot": convention["sourceRoot"],
        "outputSlug": output_slug or convention["outputSlug"],
        "publicSlug": output_slug or convention["publicSlug"],
        "galleryKey": convention["galleryKey"] or str(gallery.get("key") or "").strip(),
        "galleryTitle": convention["galleryTitle"] or str(gallery.get("title") or "").strip(),
        "publicKeyPrefix": convention["publicKeyPrefix"],
        "privateKeyPrefix": convention["privateKeyPrefix"],
        "properties": [],
        "albums": [],
        "maxItems": 300,
    }


def _default_real_estate_clients(repo_root: Path) -> list[dict]:
    clients: list[dict] = []
    for manifest_path in sorted((repo_root / REAL_ESTATE_IMPORT_ROOT).glob("*/manifest.json")):
        manifest = _read_json_file(manifest_path, {})
        if isinstance(manifest, dict):
            clients.append(_manifest_client_seed(repo_root, manifest_path.parent.name, manifest))
    if clients:
        return clients
    return [{
        "id": "corine",
        "customer": "Corine",
        "email": "",
        "username": "Corine",
        "accessCode": "",
        "accessCodeSalt": uuid.uuid4().hex,
        "sourceRoot": "/Volumes/Saturn/Pictures/RE/Corine",
        "outputSlug": "corine",
        "publicSlug": "corine",
        "galleryKey": "Corine-gallery",
        "galleryTitle": "Corine",
        "publicKeyPrefix": "RE/Corine/previews",
        "privateKeyPrefix": "RE/Corine/masters",
        "properties": [],
        "albums": [],
        "maxItems": 300,
    }]


def _read_real_estate_client_payload(repo_root: Path) -> dict:
    path = _real_estate_config_path(repo_root)
    saved = _read_json_file(path, {})
    if not isinstance(saved, dict):
        saved = {}
    saved_clients = [
        client for client in saved.get("clients") or []
        if isinstance(client, dict) and str(client.get("id") or client.get("customer") or "").strip()
    ]
    if saved_clients:
        clients = saved_clients
    else:
        clients = _default_real_estate_clients(repo_root)
    clients = [
        _normalize_real_estate_client(client, client, require_password=False)
        for client in clients
    ]
    return {
        "format": "photosbyelie-real-estate-owner-local",
        "schema_version": 1,
        "updated_at": saved.get("updated_at") or "",
        "clients": clients,
    }


def _write_real_estate_client_payload(repo_root: Path, payload: dict) -> None:
    payload = {
        "format": "photosbyelie-real-estate-owner-local",
        "schema_version": 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "clients": payload.get("clients") or [],
    }
    _write_json_file(_real_estate_config_path(repo_root), payload)


def _real_estate_manifest_stats(repo_root: Path, client: dict) -> dict:
    paths = _real_estate_paths(repo_root, client)
    manifest = _read_json_file(paths["manifest"], {})
    if not isinstance(manifest, dict):
        manifest = {}
    stats = manifest.get("stats") if isinstance(manifest.get("stats"), dict) else {}
    albums = manifest.get("albums") if isinstance(manifest.get("albums"), list) else []
    return {
        "generatedAt": manifest.get("generatedAt") or "",
        "photoCount": int(stats.get("photoCount") or 0),
        "albumCount": int(stats.get("albumCount") or len(albums)),
        "preview900Rendered": int(stats.get("preview900Rendered") or 0),
        "preview1800Rendered": int(stats.get("preview1800Rendered") or 0),
        "sourceBytes": int(stats.get("sourceBytes") or 0),
        "preview900Bytes": int(stats.get("preview900Bytes") or 0),
        "preview1800Bytes": int(stats.get("preview1800Bytes") or 0),
    }


def _real_estate_client_properties(client: dict) -> list[str]:
    raw = client.get("properties") if "properties" in client else client.get("albums")
    return _normalize_album_list(raw)


def _real_estate_child_directories(source_root: str) -> list[str]:
    root = Path(str(source_root or "")).expanduser()
    if not root.is_dir():
        return []
    return sorted(path.name for path in root.iterdir() if path.is_dir())


def _real_estate_media_count(path: Path) -> int:
    if not path.is_dir():
        return 0
    return sum(
        1
        for child in path.rglob("*")
        if child.is_file()
        and child.name != ".DS_Store"
        and child.suffix.lower() in REAL_ESTATE_MEDIA_EXTENSIONS
    )


def _real_estate_client_missing_properties(client: dict) -> list[str]:
    source_root = Path(str(client.get("sourceRoot") or "")).expanduser()
    if not source_root.is_dir():
        return _real_estate_client_properties(client)
    return [
        property_name
        for property_name in _real_estate_client_properties(client)
        if not (source_root / property_name).is_dir()
    ]


def _real_estate_discovered_properties(source_root: str) -> list[str]:
    root = Path(str(source_root or "")).expanduser()
    if not root.is_dir():
        return []
    properties: list[str] = []
    for path in sorted(root.iterdir()):
        if not path.is_dir():
            continue
        try:
            has_media = any(
                child.is_file()
                and child.name != ".DS_Store"
                and child.suffix.lower() in REAL_ESTATE_MEDIA_EXTENSIONS
                for child in path.rglob("*")
            )
        except OSError:
            has_media = False
        if has_media:
            properties.append(path.name)
    return properties


def _real_estate_public_url(path: str) -> str:
    clean_path = str(path or "").lstrip("./")
    return f"{PUBLIC_SITE_BASE_URL}real-estate.html?context=./{clean_path}&logout=1"


def _safe_real_estate_client(repo_root: Path, client: dict) -> dict:
    paths = _real_estate_paths(repo_root, client)
    output_slug = _real_estate_client_output_slug(client)
    public_slug = _real_estate_client_public_slug(client)
    local_context_rel = _repo_rel(repo_root, paths["local_context"])
    public_context_rel = _repo_rel(repo_root, paths["public_context"])
    source_root = str(client.get("sourceRoot") or "")
    properties = _real_estate_client_properties(client)
    available_properties = _real_estate_discovered_properties(source_root)
    missing_properties = _real_estate_client_missing_properties(client)
    return {
        "id": str(client.get("id") or output_slug),
        "customer": str(client.get("customer") or ""),
        "email": str(client.get("email") or ""),
        "username": str(client.get("username") or ""),
        "accessCode": str(client.get("accessCode") or ""),
        "passwordSet": bool(str(client.get("accessCode") or "").strip()),
        "sourceRoot": source_root,
        "sourceRootExists": bool(source_root and Path(source_root).expanduser().is_dir()),
        "outputSlug": output_slug,
        "publicSlug": public_slug,
        "galleryKey": str(client.get("galleryKey") or ""),
        "galleryTitle": str(client.get("galleryTitle") or ""),
        "publicKeyPrefix": str(client.get("publicKeyPrefix") or ""),
        "privateKeyPrefix": str(client.get("privateKeyPrefix") or ""),
        "properties": properties,
        "availableProperties": available_properties,
        "effectiveProperties": properties or available_properties,
        "missingProperties": missing_properties,
        "albums": properties,
        "maxItems": int(client.get("maxItems") or 300),
        "lastImportedAt": str(client.get("lastImportedAt") or ""),
        "lastPublishedAt": str(client.get("lastPublishedAt") or ""),
        "lastUploadAt": str(client.get("lastUploadAt") or ""),
        "localManifestPath": _repo_rel(repo_root, paths["manifest"]),
        "localManifestExists": paths["manifest"].exists(),
        "localContextPath": local_context_rel,
        "localContextExists": paths["local_context"].exists(),
        "publicContextPath": public_context_rel,
        "publicContextExists": paths["public_context"].exists(),
        "localReviewUrl": f"./real-estate.html?context=./{local_context_rel}&logout=1",
        "publicReviewUrl": _real_estate_public_url(public_context_rel),
        "stats": _real_estate_manifest_stats(repo_root, client),
    }


def real_estate_owner_summary(repo_root: Path) -> dict:
    payload = _read_real_estate_client_payload(repo_root)
    return {
        "ok": True,
        "path": REAL_ESTATE_CLIENTS_PATH.as_posix(),
        "pathExists": _real_estate_config_path(repo_root).exists(),
        "clients": [_safe_real_estate_client(repo_root, client) for client in payload.get("clients") or []],
    }


def _real_estate_clients_by_id(payload: dict) -> dict[str, dict]:
    return {
        str(client.get("id") or _real_estate_client_output_slug(client)): client
        for client in payload.get("clients") or []
        if isinstance(client, dict)
    }


def _normalize_album_list(value: object) -> list[str]:
    source = value if isinstance(value, list) else re.split(r"[\n,]", str(value or ""))
    albums = []
    for item in source:
        album = str(item or "").strip()
        if album and album not in albums:
            albums.append(album)
    return albums


def _normalize_real_estate_client(incoming: dict, existing: dict | None = None, *, require_password: bool = True) -> dict:
    existing = existing or {}
    customer = str(incoming.get("customer") or existing.get("customer") or "").strip()
    if not customer:
        raise ValueError("customer is required")
    convention = _real_estate_convention_fields(customer)
    client_id = convention["id"]
    email = str(incoming.get("email") or existing.get("email") or "").strip()
    access_code = str(incoming.get("accessCode") or "").strip() or str(existing.get("accessCode") or "").strip()
    if require_password and not access_code:
        raise ValueError("password is required for real-estate client access")
    properties_source = incoming.get("properties") if "properties" in incoming else (
        incoming.get("albums") if "albums" in incoming else (
            existing.get("properties") if "properties" in existing else existing.get("albums")
        )
    )
    properties = _normalize_album_list(properties_source)
    return {
        **existing,
        "id": client_id,
        "customer": customer,
        "email": email,
        "username": convention["username"],
        "accessCode": access_code,
        "accessCodeSalt": str(existing.get("accessCodeSalt") or incoming.get("accessCodeSalt") or uuid.uuid4().hex),
        "sourceRoot": convention["sourceRoot"],
        "outputSlug": convention["outputSlug"],
        "publicSlug": convention["publicSlug"],
        "galleryKey": convention["galleryKey"],
        "galleryTitle": convention["galleryTitle"],
        "publicKeyPrefix": convention["publicKeyPrefix"],
        "privateKeyPrefix": convention["privateKeyPrefix"],
        "properties": properties,
        "albums": properties,
        "maxItems": max(1, int(incoming.get("maxItems") or existing.get("maxItems") or 300)),
    }


def _save_real_estate_client(repo_root: Path, incoming: dict) -> dict:
    payload = _read_real_estate_client_payload(repo_root)
    clients_by_id = _real_estate_clients_by_id(payload)
    client_id = _slugify(str(incoming.get("id") or incoming.get("customer") or "client"))
    client = _normalize_real_estate_client(incoming, clients_by_id.get(client_id))
    if client_id in clients_by_id and client_id != client["id"]:
        del clients_by_id[client_id]
    clients_by_id[client["id"]] = client
    payload["clients"] = sorted(clients_by_id.values(), key=lambda item: str(item.get("customer") or item.get("id")))
    _write_real_estate_client_payload(repo_root, payload)
    return {
        "ok": True,
        "action": "save-client",
        "client": _safe_real_estate_client(repo_root, client),
        "clients": [_safe_real_estate_client(repo_root, item) for item in payload["clients"]],
    }


def _delete_real_estate_client(repo_root: Path, incoming: dict) -> dict:
    payload = _read_real_estate_client_payload(repo_root)
    client_id = _slugify(str(incoming.get("id") or incoming.get("clientId") or ""))
    if not client_id:
        raise ValueError("client id is required")
    clients_by_id = _real_estate_clients_by_id(payload)
    client = clients_by_id.pop(client_id, None)
    if not client:
        raise ValueError("real-estate client was not found")
    payload["clients"] = sorted(clients_by_id.values(), key=lambda item: str(item.get("customer") or item.get("id")))
    _write_real_estate_client_payload(repo_root, payload)
    return {
        "ok": True,
        "action": "delete-client",
        "deletedClient": _safe_real_estate_client(repo_root, client),
        "clients": [_safe_real_estate_client(repo_root, item) for item in payload["clients"]],
    }


def _real_estate_client_for_action(repo_root: Path, payload: dict) -> tuple[dict, dict]:
    state = _read_real_estate_client_payload(repo_root)
    client_id = _slugify(str(payload.get("id") or payload.get("clientId") or ""))
    clients = _real_estate_clients_by_id(state)
    client = clients.get(client_id)
    if not client:
        raise ValueError("real-estate client was not found")
    return state, client


def _discover_real_estate_client_properties(repo_root: Path, payload: dict) -> dict:
    state, client = _real_estate_client_for_action(repo_root, payload)
    source_root = Path(str(client.get("sourceRoot") or "")).expanduser()
    if not source_root.is_dir():
        raise ValueError(f"source root not found: {source_root}")
    discovered = _real_estate_discovered_properties(str(source_root))
    if not discovered:
        available_text = ", ".join(_real_estate_child_directories(str(source_root))) or "none"
        raise ValueError(
            f"No property folders with supported media were found under {source_root}. "
            f"Available folders: {available_text}."
        )
    client["properties"] = discovered
    client["albums"] = discovered
    _persist_real_estate_client_update(repo_root, state, client)
    return {
        "ok": True,
        "action": "discover-properties",
        "client": _safe_real_estate_client(repo_root, client),
        "clients": [_safe_real_estate_client(repo_root, item) for item in state["clients"]],
        "properties": discovered,
    }


def _run_real_estate_command(repo_root: Path, command: list[str], env: dict[str, str] | None = None) -> dict:
    result = subprocess.run(
        command,
        cwd=repo_root,
        check=False,
        capture_output=True,
        text=True,
        env={**os.environ, **(env or {})},
    )
    output = ((result.stdout or "") + (("\n" + result.stderr) if result.stderr else "")).strip()
    return {
        "exitCode": result.returncode,
        "ok": result.returncode == 0,
        "output": output[-12000:],
    }


def _real_estate_import_progress(operation_id: str) -> dict | None:
    if not operation_id:
        return None
    with REAL_ESTATE_IMPORT_PROGRESS_LOCK:
        progress = REAL_ESTATE_IMPORT_PROGRESS.get(operation_id)
        return dict(progress) if progress else None


def _set_real_estate_import_progress(operation_id: object, **updates: object) -> None:
    if not isinstance(operation_id, str) or not operation_id:
        return
    now = datetime.now(timezone.utc).isoformat()
    with REAL_ESTATE_IMPORT_PROGRESS_LOCK:
        progress = dict(REAL_ESTATE_IMPORT_PROGRESS.get(operation_id) or {})
        progress.update(updates)
        total = int(progress.get("total") or 0)
        completed = int(progress.get("completed") or 0)
        progress["remaining"] = max(0, total - completed)
        progress["updatedAt"] = now
        REAL_ESTATE_IMPORT_PROGRESS[operation_id] = progress


def _import_progress_from_line(line: str) -> dict | None:
    prefix = "PBE_IMPORT_PROGRESS "
    if not line.startswith(prefix):
        return None
    try:
        data = json.loads(line[len(prefix):])
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _run_real_estate_import_command(
    repo_root: Path,
    command: list[str],
    operation_id: str,
    env: dict[str, str] | None = None,
) -> dict:
    process = subprocess.Popen(
        command,
        cwd=repo_root,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env={**os.environ, **(env or {})},
    )
    output_lines: list[str] = []
    if process.stdout:
        for raw_line in process.stdout:
            line = raw_line.rstrip("\n")
            progress = _import_progress_from_line(line)
            if progress:
                event = str(progress.get("event") or "")
                state = "running"
                if event == "done":
                    state = "finalizing"
                updates: dict[str, object] = {
                    "state": state,
                    "event": event,
                    "total": int(progress.get("total") or 0),
                    "completed": int(progress.get("completed") or 0),
                }
                for text_key in ("album", "file", "mediaType"):
                    if text_key in progress:
                        updates[text_key] = str(progress.get(text_key) or "")
                for number_key in ("albumIndex", "albumTotal", "albumMediaCount"):
                    if number_key in progress:
                        updates[number_key] = int(progress.get(number_key) or 0)
                _set_real_estate_import_progress(operation_id, **updates)
                continue
            output_lines.append(line)
    return_code = process.wait()
    output = "\n".join(output_lines).strip()
    if return_code == 0:
        current = _real_estate_import_progress(operation_id) or {}
        _set_real_estate_import_progress(
            operation_id,
            state="done",
            completed=int(current.get("completed") or 0),
            total=int(current.get("total") or 0),
        )
    else:
        _set_real_estate_import_progress(
            operation_id,
            state="failed",
            error=output_lines[-1] if output_lines else "real-estate import failed",
        )
    return {
        "exitCode": return_code,
        "ok": return_code == 0,
        "output": output[-12000:],
    }


def _strip_public_real_estate_photo(photo: dict) -> dict:
    public_photo = json.loads(json.dumps(photo))
    public_photo.pop("realEstate", None)
    return public_photo


def _sanitize_real_estate_public_manifest(manifest: dict) -> dict:
    public_manifest = json.loads(json.dumps(manifest))
    customer = public_manifest.get("customer") if isinstance(public_manifest.get("customer"), dict) else {}
    public_manifest["customer"] = {
        key: value
        for key, value in customer.items()
        if key in {"name", "username", "email", "accessCodeAlgorithm", "accessCodeHash", "accessCodeSalt"}
    }
    public_manifest.pop("sourceRoot", None)
    public_manifest.pop("outputRoot", None)

    r2 = public_manifest.get("r2") if isinstance(public_manifest.get("r2"), dict) else {}
    public_manifest["r2"] = {
        key: value
        for key, value in r2.items()
        if key in {"publicBucket", "publicPreviewPrefix"}
    }

    if isinstance(public_manifest.get("albums"), list):
        public_manifest["albums"] = [
            {key: value for key, value in album.items() if key != "sourcePath"}
            if isinstance(album, dict)
            else album
            for album in public_manifest["albums"]
        ]

    photos = [
        _strip_public_real_estate_photo(photo)
        for photo in public_manifest.get("photos") or []
        if isinstance(photo, dict)
    ]
    public_manifest["photos"] = photos
    gallery = public_manifest.get("gallery") if isinstance(public_manifest.get("gallery"), dict) else {}
    gallery["photos"] = photos
    public_manifest["gallery"] = gallery
    return public_manifest


def _write_real_estate_app_context(manifest: dict, path: Path) -> None:
    payload = json.dumps(manifest, indent=2, sort_keys=True)
    context = f"""(() => {{
  const payload = {payload};
  const script = document.currentScript;
  const base = script?.src ? new URL("./", script.src) : new URL("./", window.location.href);
  const absoluteUrl = (value) => {{
    if (!value || /^(https?:|data:|blob:|\\/)/i.test(value)) return value || "";
    return new URL(value, base).href;
  }};
  const photos = (payload.photos || []).map((photo) => {{
    const publicPreview = photo.media?.publicPreview || {{}};
    const pdfSource = photo.cloudPdfSource || {{}};
    return {{
      ...photo,
      media: {{
        ...(photo.media || {{}}),
        publicPreview: {{
          ...publicPreview,
          galleryUrl: absoluteUrl(publicPreview.galleryUrl || photo.gallerySrc),
          detailUrl: absoluteUrl(publicPreview.detailUrl || photo.imageSrc),
          previewUrl: absoluteUrl(publicPreview.previewUrl || photo.imageSrc),
          thumbnailUrl: absoluteUrl(publicPreview.thumbnailUrl || photo.gallerySrc),
        }},
      }},
      cloudPdfSource: {{
        ...pdfSource,
        imageUrl: absoluteUrl(pdfSource.imageUrl),
      }},
    }};
  }});
  const gallery = {{
    ...(payload.gallery || {{}}),
    photos,
  }};
  window.photosByElieRealEstateImport = {{
    ...payload,
    gallery,
    photos,
  }};
  window.photosByElieRealEstateGalleryKey = gallery.key;
  window.photosByElieData = {{
    ...(window.photosByElieData || {{}}),
    [gallery.key]: gallery,
  }};
}})();
"""
    path.write_text(context, encoding="utf-8")


def _persist_real_estate_client_update(repo_root: Path, state: dict, client: dict) -> None:
    clients = _real_estate_clients_by_id(state)
    clients[str(client.get("id"))] = client
    state["clients"] = sorted(clients.values(), key=lambda item: str(item.get("customer") or item.get("id")))
    _write_real_estate_client_payload(repo_root, state)


def _import_real_estate_client(repo_root: Path, payload: dict) -> dict:
    state, client = _real_estate_client_for_action(repo_root, payload)
    source_root = Path(str(client.get("sourceRoot") or "")).expanduser()
    if not source_root.is_dir():
        raise ValueError(f"source root not found: {source_root}")
    access_code = str(client.get("accessCode") or "").strip()
    if not access_code:
        raise ValueError("client password is required before import")
    operation_id = str(payload.get("operationId") or payload.get("operation_id") or "").strip()
    configured_properties = _real_estate_client_properties(client)
    missing_properties = _real_estate_client_missing_properties(client)
    available_properties = [
        property_name
        for property_name in configured_properties
        if (source_root / property_name).is_dir()
    ]
    if configured_properties and not available_properties:
        available_text = ", ".join(_real_estate_child_directories(str(source_root))) or "none"
        raise ValueError(
            f"No configured property folders were found for {client.get('customer')}. "
            f"Expected under {source_root}. Available property folders: {available_text}."
        )
    import_properties = available_properties or []
    if not configured_properties:
        import_properties = _real_estate_discovered_properties(str(source_root))
    total_media = sum(_real_estate_media_count(source_root / property_name) for property_name in import_properties)
    _set_real_estate_import_progress(
        operation_id,
        state="queued",
        client=str(client.get("customer") or ""),
        total=total_media,
        completed=0,
        skippedProperties=missing_properties,
        properties=import_properties,
    )
    command = [
        sys.executable,
        "-u",
        "scripts/import_real_estate_gallery.py",
        "--source-root",
        str(source_root),
        "--output-root",
        REAL_ESTATE_IMPORT_ROOT.as_posix(),
        "--customer",
        str(client.get("customer") or ""),
        "--username",
        str(client.get("username") or client.get("customer") or ""),
        "--email",
        str(client.get("email") or ""),
        "--access-code-env",
        "PBE_REAL_ESTATE_ACCESS_CODE",
        "--access-code-salt",
        str(client.get("accessCodeSalt") or uuid.uuid4().hex),
        "--gallery-key",
        str(client.get("galleryKey") or ""),
        "--gallery-title",
        str(client.get("galleryTitle") or ""),
        "--public-key-prefix",
        str(client.get("publicKeyPrefix") or ""),
        "--private-key-prefix",
        str(client.get("privateKeyPrefix") or ""),
        "--progress-json",
    ]
    for property_name in import_properties:
        command.extend(["--album", str(property_name)])
    if payload.get("force") is True:
        command.append("--force")
    result = _run_real_estate_import_command(repo_root, command, operation_id, {"PBE_REAL_ESTATE_ACCESS_CODE": access_code})
    if not result["ok"]:
        raise OSError(result["output"] or "real-estate import failed")
    client["lastImportedAt"] = datetime.now(timezone.utc).isoformat()
    _persist_real_estate_client_update(repo_root, state, client)
    import_progress = _real_estate_import_progress(operation_id) or {
        "total": total_media,
        "completed": total_media,
        "skippedProperties": missing_properties,
        "properties": import_properties,
    }
    return {
        "ok": True,
        "action": "import-client",
        "client": _safe_real_estate_client(repo_root, client),
        "command": result,
        "importProgress": import_progress,
    }


def _publish_real_estate_client(repo_root: Path, payload: dict) -> dict:
    state, client = _real_estate_client_for_action(repo_root, payload)
    paths = _real_estate_paths(repo_root, client)
    if not paths["manifest"].exists():
        raise ValueError("import the client before publishing the public context")
    manifest = _read_json_file(paths["manifest"], {})
    if not isinstance(manifest, dict):
        raise ValueError("real-estate manifest is not readable")
    paths["public_dir"].mkdir(parents=True, exist_ok=True)
    _write_real_estate_app_context(
        _sanitize_real_estate_public_manifest(manifest),
        paths["public_context"],
    )
    client["lastPublishedAt"] = datetime.now(timezone.utc).isoformat()
    _persist_real_estate_client_update(repo_root, state, client)
    return {
        "ok": True,
        "action": "publish-client",
        "client": _safe_real_estate_client(repo_root, client),
        "path": _repo_rel(repo_root, paths["public_context"]),
    }


def _upload_real_estate_client(repo_root: Path, payload: dict) -> dict:
    state, client = _real_estate_client_for_action(repo_root, payload)
    paths = _real_estate_paths(repo_root, client)
    if not paths["manifest"].exists():
        raise ValueError("import the client before uploading real-estate media")
    scope = str(payload.get("scope") or "both").strip().lower()
    if scope not in {"public", "private", "both"}:
        raise ValueError("scope must be public, private, or both")
    command = [
        sys.executable,
        "scripts/upload_real_estate_media.py",
        "--manifest",
        _repo_rel(repo_root, paths["manifest"]),
        "--scope",
        scope,
        "--json",
    ]
    if payload.get("upload") is True:
        command.append("--upload")
    result = _run_real_estate_command(repo_root, command)
    if not result["ok"]:
        raise OSError(result["output"] or "real-estate upload failed")
    client["lastUploadAt"] = datetime.now(timezone.utc).isoformat() if payload.get("upload") is True else str(client.get("lastUploadAt") or "")
    _persist_real_estate_client_update(repo_root, state, client)
    summary = {}
    try:
        summary = json.loads(result["output"] or "{}")
    except json.JSONDecodeError:
        summary = {}
    return {
        "ok": True,
        "action": "upload-client" if payload.get("upload") is True else "upload-dry-run",
        "client": _safe_real_estate_client(repo_root, client),
        "summary": summary,
        "command": result,
    }


def _real_estate_worker_secret(repo_root: Path) -> dict:
    state = _read_real_estate_client_payload(repo_root)
    galleries = []
    for client in state.get("clients") or []:
        access_code = str(client.get("accessCode") or "").strip()
        if not access_code:
            continue
        galleries.append({
            "key": str(client.get("galleryKey") or ""),
            "username": str(client.get("username") or client.get("customer") or ""),
            "email": str(client.get("email") or ""),
            "accessCode": access_code,
            "privateMasterPrefix": str(client.get("privateKeyPrefix") or ""),
            "maxItems": int(client.get("maxItems") or 300),
        })
    secret_json = json.dumps(galleries, indent=2, sort_keys=True)
    return {
        "ok": True,
        "action": "worker-secret",
        "secretName": "REAL_ESTATE_GALLERIES_JSON",
        "secretJson": secret_json,
        "wranglerCommand": "npx wrangler secret put REAL_ESTATE_GALLERIES_JSON",
        "galleryCount": len(galleries),
    }


def apply_real_estate_owner_action(repo_root: Path, payload: dict) -> dict:
    action = str(payload.get("action") or "").strip()
    if action == "save-client":
        return _save_real_estate_client(repo_root, payload.get("client") if isinstance(payload.get("client"), dict) else payload)
    if action == "delete-client":
        return _delete_real_estate_client(repo_root, payload)
    if action == "discover-properties":
        return _discover_real_estate_client_properties(repo_root, payload)
    if action == "import-client":
        return _import_real_estate_client(repo_root, payload)
    if action == "publish-client":
        return _publish_real_estate_client(repo_root, payload)
    if action == "upload-client":
        payload["upload"] = True
        return _upload_real_estate_client(repo_root, payload)
    if action == "upload-dry-run":
        payload["upload"] = False
        return _upload_real_estate_client(repo_root, payload)
    if action == "worker-secret":
        return _real_estate_worker_secret(repo_root)
    raise ValueError("unsupported real-estate owner action")


def apply_photo_action(repo_root: Path, payload: dict) -> dict:
    action = payload.get("action")
    photo_id = payload.get("photo_id")
    if action not in {
        "hide",
        "hide-many",
        "undo-hide",
        "promote-hidden",
        "return-to-reserve",
        "discard",
        "assign-country",
        "sync-country-keywords",
        "remove-collection-keyword",
        "update-photo-metadata",
        "apply-title-keyword-review-approvals",
        "publish-hidden-blacklist",
        "wipe-hidden-r2",
        "save-title-keyword-review-approvals",
        "clear-title-keyword-review-block",
        "save-keyword-blacklist",
    }:
        raise ValueError("unsupported photo action")
    if action not in {
        "assign-country",
        "hide-many",
        "sync-country-keywords",
        "remove-collection-keyword",
        "publish-hidden-blacklist",
        "wipe-hidden-r2",
        "save-title-keyword-review-approvals",
        "apply-title-keyword-review-approvals",
        "save-keyword-blacklist",
    } and (not isinstance(photo_id, str) or not photo_id):
        raise ValueError("photo_id must be a non-empty string")
    if action == "assign-country":
        target_slug = payload.get("gallery_key") or payload.get("country")
        if target_slug not in COUNTRY_ASSIGNMENT_TARGETS:
            raise ValueError("gallery_key must be a country slug")
        photo_ids = _normalized_photo_ids(payload.get("photo_ids") or photo_id)
        if not photo_ids:
            raise ValueError("photo_ids must include at least one photo id")
    if action == "hide-many":
        photo_ids = _normalized_photo_ids(payload.get("photo_ids"))
        if not photo_ids:
            raise ValueError("photo_ids must include at least one photo id")

    if action == "save-title-keyword-review-approvals":
        batch_id = str(payload.get("batch_id") or "").strip()
        if not batch_id:
            raise ValueError("batch_id must be a non-empty string")
        approvals = payload.get("approvals")
        if not isinstance(approvals, list):
            raise ValueError("approvals must be a JSON list")
        rejections = payload.get("rejections") or []
        if not isinstance(rejections, list):
            raise ValueError("rejections must be a JSON list")
        blocked = payload.get("blocked") or []
        if not isinstance(blocked, list):
            raise ValueError("blocked must be a JSON list")
        normalized = []
        for item in approvals:
            if not isinstance(item, dict):
                continue
            current_photo_id = str(item.get("photo_id") or "").strip()
            if not current_photo_id:
                continue
            if item.get("approved") is not True:
                continue
            title = str(item.get("title") or "").strip()
            if not title:
                raise ValueError(f"approved title must be non-empty for {current_photo_id}")
            normalized.append(
                {
                    "photo_id": current_photo_id,
                    "batch_id": _review_item_batch_id(item, batch_id),
                    "approved": True,
                    "title": title,
                    "keywords": _review_keywords(repo_root, item.get("keywords")),
                }
            )
        normalized_rejections = []
        for item in rejections:
            if not isinstance(item, dict):
                continue
            current_photo_id = str(item.get("photo_id") or "").strip()
            if not current_photo_id or item.get("rejected") is not True:
                continue
            normalized_rejections.append(
                {
                    "photo_id": current_photo_id,
                    "batch_id": _review_item_batch_id(item, batch_id),
                    "rejected": True,
                    "title": str(item.get("title") or "").strip(),
                    "keywords": _review_keywords(repo_root, item.get("keywords")),
                    "comment": str(item.get("comment") or "").strip(),
                }
            )
        rejected_ids = {item["photo_id"] for item in normalized_rejections}
        normalized = [item for item in normalized if item["photo_id"] not in rejected_ids]
        now = datetime.now(timezone.utc).isoformat()
        normalized_blocked = []
        for item in blocked:
            if not isinstance(item, dict):
                raise ValueError("blocked items must be JSON objects")
            current_photo_id = str(item.get("photo_id") or "").strip()
            if not current_photo_id or item.get("blocked") is not True:
                continue
            normalized_blocked.append(
                {
                    "photo_id": current_photo_id,
                    "batch_id": _review_item_batch_id(item, batch_id),
                    "blocked": True,
                    "blocked_at": now,
                }
            )
        updated = []
        not_found = []
        metadata_changed = 0
        site_state = {}
        worker_catalog = {}
        review_flag = TITLE_KEYWORD_REVIEW_FLAG
        if normalized:
            ensure_state_folders(repo_root / HIDDEN_ASSET_ROOT)
            (repo_root / DISCARDED_TOMBSTONE_PATH).parent.mkdir(parents=True, exist_ok=True)
            expo_groups, reserve_groups, hidden_groups = _state_groups(repo_root)
            _repair_hidden_references(repo_root, hidden_groups, expo_groups, reserve_groups)
            updated, not_found, metadata_changed = _apply_title_keyword_approvals_to_groups(
                expo_groups,
                reserve_groups,
                hidden_groups,
                normalized,
            )
            if metadata_changed:
                site_state, worker_catalog = _write_catalog_state(repo_root, expo_groups, reserve_groups, hidden_groups)
        not_found_records = _review_record_not_found(not_found, normalized, batch_id)
        save_result = _save_title_keyword_review_records(
            repo_root,
            fallback_batch_id=batch_id,
            approvals=normalized,
            rejections=normalized_rejections,
            blocked=normalized_blocked,
            not_found=not_found_records,
            review_flag=review_flag,
            applied_at=now if normalized else "",
            decided_at=now,
        )
        return {
            "ok": True,
            "action": action,
            "batch_id": batch_id,
            "path": save_result.get("path", ""),
            "paths": save_result.get("paths", []),
            "db": save_result.get("db", ""),
            "approved_count": save_result.get("approved_count", 0),
            "rejected_count": save_result.get("rejected_count", 0),
            "blocked_count": save_result.get("blocked_count", 0),
            "applied_count": len({item["id"] for item in updated}),
            "metadata_changed": metadata_changed,
            "not_found": not_found,
            "updated": updated,
            "review_flag": review_flag,
            "proposal_state_flag": TITLE_KEYWORD_PROPOSED_FLAG,
            "rejection_flag": TITLE_KEYWORD_REJECTED_FLAG,
            "worker_catalog": worker_catalog,
            "site": site_state,
        }

    if action == "save-keyword-blacklist":
        return _save_keyword_blacklist(repo_root, payload)

    if action == "clear-title-keyword-review-block":
        batch_id = str(payload.get("batch_id") or "").strip()
        if not batch_id:
            raise ValueError("batch_id must be a non-empty string")
        now = datetime.now(timezone.utc).isoformat()
        db_result = clear_title_keyword_review_blocks_db(
            repo_root,
            batch_id,
            [photo_id],
            decided_at=now,
        )
        record_result = _clear_title_keyword_review_block_record(repo_root, batch_id, [photo_id], now)
        return {
            "ok": True,
            "action": action,
            "photo_id": photo_id,
            "batch_id": batch_id,
            "db": db_result.get("db", ""),
            "unblocked_count": db_result.get("unblocked", 0),
            "missing_count": db_result.get("missing", 0),
            "skipped_count": db_result.get("skipped", 0),
            "decisions_deleted": db_result.get("decisions_deleted", 0),
            "path": record_result.get("path", ""),
            "record_removed_count": record_result.get("removed_count", 0),
        }

    ensure_state_folders(repo_root / HIDDEN_ASSET_ROOT)
    (repo_root / DISCARDED_TOMBSTONE_PATH).parent.mkdir(parents=True, exist_ok=True)

    expo_groups, reserve_groups, hidden_groups = _state_groups(repo_root)
    _repair_hidden_references(repo_root, hidden_groups, expo_groups, reserve_groups)
    moved = None

    if action == "sync-country-keywords":
        keyword_updates = _sync_collection_keywords(repo_root, expo_groups, reserve_groups, hidden_groups)
        site_state, worker_catalog = _write_catalog_state(repo_root, expo_groups, reserve_groups, hidden_groups)
        return {
            "ok": True,
            "action": action,
            "keyword_updates": keyword_updates,
            "worker_catalog": worker_catalog,
            "site": site_state,
        }

    if action == "remove-collection-keyword":
        target_slug = str(payload.get("gallery_key") or "").strip()
        if target_slug not in COLLECTION_KEYWORD_TARGETS:
            raise ValueError("gallery_key must be a collection slug")
        keyword = str(payload.get("keyword") or "").strip()
        if not keyword:
            raise ValueError("keyword must be a non-empty string")
        keyword_removal = _remove_collection_keyword(expo_groups, reserve_groups, hidden_groups, slug=target_slug, keyword=keyword)
        site_state, worker_catalog = _write_catalog_state(repo_root, expo_groups, reserve_groups, hidden_groups)
        return {
            "ok": True,
            "action": action,
            "keyword_removal": keyword_removal,
            "file_updates": {
                "updated": 0,
                "skipped": 0,
                "error_count": 0,
                "errors": [],
                "state": "manifest-only",
            },
            "worker_catalog": worker_catalog,
            "site": site_state,
        }

    if action == "publish-hidden-blacklist":
        site_state = _write_state(repo_root, expo_groups, reserve_groups, hidden_groups)
        r2_task = _start_r2_upload_task("hidden-blacklist", [_hidden_blacklist_upload_item(repo_root)], "hidden-blacklist-upload")
        return {
            "ok": True,
            "action": action,
            "hidden_count": sum(len(photos) for photos in hidden_groups.values()),
            "r2_upload_task": r2_task,
            "site": site_state,
        }

    if action == "wipe-hidden-r2":
        discard_entries = _waste_basket_discard_entries(hidden_groups)
        hidden_count_before = sum(len(photos) for photos in hidden_groups.values())
        tombstone = _write_discarded_tombstones(repo_root, discard_entries)
        r2_task = _start_r2_delete_task(
            "waste-basket-cloud-media",
            _waste_basket_delete_items(repo_root, hidden_groups),
            "waste-basket-media-wipe",
        )
        hidden_groups = {slug: [] for slug in ORDER}
        site_state = _write_state(repo_root, expo_groups, reserve_groups, hidden_groups)
        return {
            "ok": True,
            "action": action,
            "hidden_count": 0,
            "hidden_count_before": hidden_count_before,
            "moved_to_tombstones_count": len(discard_entries),
            "discarded_count": len(tombstone.get("photo_ids") or []),
            "hidden_ids": [],
            "r2_delete_task": r2_task,
            "site": site_state,
        }

    if action == "hide-many":
        photo_ids = _normalized_photo_ids(payload.get("photo_ids"))
        hidden_at = datetime.now(timezone.utc).isoformat()
        moved = []
        already_hidden = []
        not_found = []
        for current_photo_id in photo_ids:
            found = _find_photo(expo_groups, current_photo_id)
            source_state = "expo"
            if not found:
                found = _find_photo(reserve_groups, current_photo_id)
                source_state = "reserve"
            if not found:
                hidden_hit = next(
                    ((slug, photo) for slug, photos in hidden_groups.items() for photo in photos if photo.get("id") == current_photo_id),
                    None,
                )
                if hidden_hit:
                    already_hidden.append(current_photo_id)
                    continue
                not_found.append(current_photo_id)
                continue
            source_slug, source_photo = found
            hidden_photo = _hidden_review_photo(source_photo, source_slug, source_state, hidden_at)
            _remove_existing(hidden_groups, current_photo_id)
            hidden_groups[source_slug].append(hidden_photo)
            moved.append(
                {
                    "photo_id": current_photo_id,
                    "from": source_state,
                    "from_slug": source_slug,
                    "to": "hidden",
                    "to_slug": source_slug,
                    "mode": "blacklist",
                }
            )
        site_state, worker_catalog = _write_catalog_state(repo_root, expo_groups, reserve_groups, hidden_groups)
        r2_task = _start_r2_upload_task("hidden-blacklist", [_hidden_blacklist_upload_item(repo_root)], "hidden-blacklist-upload")
        hidden_ids = [item["photo_id"] for item in moved] + already_hidden
        return {
            "ok": True,
            "action": action,
            "photo_ids": photo_ids,
            "hidden_ids": hidden_ids,
            "already_hidden": already_hidden,
            "not_found": not_found,
            "moved": moved,
            "r2_blacklist_task": r2_task,
            "worker_catalog": worker_catalog,
            "site": site_state,
        }

    if action == "update-photo-metadata":
        title = str(payload.get("title") or "").strip()
        if not title:
            raise ValueError("title must be a non-empty string")
        keywords = _unique_keywords(_split_keyword_text(payload.get("keywords")))
        matches = (
            [("expo", *item) for item in _matching_photos(expo_groups, photo_id)]
            + [("reserve", *item) for item in _matching_photos(reserve_groups, photo_id)]
            + [("hidden", *item) for item in _matching_photos(hidden_groups, photo_id)]
        )
        if not matches:
            raise ValueError(f"photo not found: {photo_id}")
        metadata_changed = 0
        for _state, _slug, photo in matches:
            title_changed = _set_photo_title(photo, title)
            keywords_changed = _set_photo_keywords(photo, keywords)
            if title_changed or keywords_changed:
                metadata_changed += 1
        site_state, worker_catalog = _write_catalog_state(repo_root, expo_groups, reserve_groups, hidden_groups)
        return {
            "ok": True,
            "action": action,
            "photo_id": photo_id,
            "updated": [
                {"state": state, "slug": slug, "id": photo_id}
                for state, slug, _photo in matches
            ],
            "metadata_changed": metadata_changed,
            "file_updates": {
                "updated": 0,
                "skipped": 0,
                "error_count": 0,
                "errors": [],
                "state": "manifest-only",
            },
            "metadata": {
                "photo_id": photo_id,
                "title": title,
                "keywords": keywords,
            },
            "worker_catalog": worker_catalog,
            "site": site_state,
        }

    if action == "apply-title-keyword-review-approvals":
        batch_id = str(payload.get("batch_id") or "").strip()
        if not batch_id:
            raise ValueError("batch_id must be a non-empty string")
        approvals = payload.get("approvals")
        if not isinstance(approvals, list):
            raise ValueError("approvals must be a JSON list")
        rejections = payload.get("rejections") or []
        if not isinstance(rejections, list):
            raise ValueError("rejections must be a JSON list")
        normalized = []
        for item in approvals:
            if not isinstance(item, dict):
                continue
            current_photo_id = str(item.get("photo_id") or "").strip()
            if not current_photo_id or item.get("approved") is not True:
                continue
            title = str(item.get("title") or "").strip()
            if not title:
                raise ValueError(f"approved title must be non-empty for {current_photo_id}")
            keywords = _review_keywords(repo_root, item.get("keywords"))
            normalized.append(
                {
                    "photo_id": current_photo_id,
                    "batch_id": _review_item_batch_id(item, batch_id),
                    "approved": True,
                    "title": title,
                    "keywords": keywords,
                }
            )
        normalized_rejections = []
        for item in rejections:
            if not isinstance(item, dict):
                continue
            current_photo_id = str(item.get("photo_id") or "").strip()
            if not current_photo_id or item.get("rejected") is not True:
                continue
            normalized_rejections.append(
                {
                    "photo_id": current_photo_id,
                    "batch_id": _review_item_batch_id(item, batch_id),
                    "rejected": True,
                    "title": str(item.get("title") or "").strip(),
                    "keywords": _review_keywords(repo_root, item.get("keywords")),
                    "comment": str(item.get("comment") or "").strip(),
                }
            )
        rejected_ids = {item["photo_id"] for item in normalized_rejections}
        normalized = [item for item in normalized if item["photo_id"] not in rejected_ids]
        if not normalized and not normalized_rejections:
            raise ValueError("approvals must include at least one approved or rejected photo")

        review_flag = TITLE_KEYWORD_REVIEW_FLAG
        updated, not_found, metadata_changed = _apply_title_keyword_approvals_to_groups(
            expo_groups,
            reserve_groups,
            hidden_groups,
            normalized,
        )

        decided_at = datetime.now(timezone.utc).isoformat()
        not_found_records = _review_record_not_found(not_found, normalized, batch_id)
        save_result = _save_title_keyword_review_records(
            repo_root,
            fallback_batch_id=batch_id,
            approvals=normalized,
            rejections=normalized_rejections,
            blocked=[],
            not_found=not_found_records,
            review_flag=review_flag,
            applied_at=decided_at if normalized else "",
            decided_at=decided_at,
        )
        site_state = {}
        worker_catalog = {}
        if normalized:
            site_state, worker_catalog = _write_catalog_state(repo_root, expo_groups, reserve_groups, hidden_groups)
        return {
            "ok": True,
            "action": action,
            "batch_id": batch_id,
            "path": save_result.get("path", ""),
            "paths": save_result.get("paths", []),
            "db": save_result.get("db", ""),
            "approved_count": save_result.get("approved_count", 0),
            "rejected_count": save_result.get("rejected_count", 0),
            "blocked_count": save_result.get("blocked_count", 0),
            "applied_count": len({item["id"] for item in updated}),
            "metadata_changed": metadata_changed,
            "not_found": not_found,
            "updated": updated,
            "review_flag": review_flag,
            "proposal_state_flag": TITLE_KEYWORD_PROPOSED_FLAG,
            "rejection_flag": TITLE_KEYWORD_REJECTED_FLAG,
            "worker_catalog": worker_catalog,
            "site": site_state,
        }

    if action == "assign-country":
        moved = []
        skipped = []
        keyword_updates = []
        operation_id = payload.get("operation_id")
        total_photos = len(photo_ids)
        _set_action_progress(operation_id, total_photos, 0)
        for index, current_photo_id in enumerate(photo_ids, start=1):
            found = _find_and_remove({"unknown": expo_groups.get("unknown", [])}, current_photo_id)
            source_state = "expo"
            if not found:
                found = _find_and_remove({"unknown": reserve_groups.get("unknown", [])}, current_photo_id)
                source_state = "reserve"
            if not found:
                already_assigned = any(
                    photo.get("id") == current_photo_id for photo in reserve_groups.get(target_slug, [])
                )
                if already_assigned:
                    skipped.append({"id": current_photo_id, "reason": "already assigned"})
                    _set_action_progress(operation_id, total_photos, index)
                    continue
                raise ValueError(f"unknown photo not found in Expo or Reserve: {current_photo_id}")
            source_slug, source_photo = found
            source_assets = _photo_asset_paths(source_photo)
            reserve_photo = _move_photo(repo_root, source_photo, "reserve", target_slug)
            target_assets = _photo_asset_paths(reserve_photo)
            reserve_photo.pop("hiddenFromState", None)
            reserve_photo.pop("hiddenFromSlug", None)
            keyword_updates.append({
                "id": current_photo_id,
                **_apply_collection_keyword(repo_root, reserve_photo, target_slug),
            })
            _remove_existing(reserve_groups, current_photo_id)
            reserve_groups[target_slug].append(reserve_photo)
            moved.append({
                "id": current_photo_id,
                "from": source_state,
                "from_slug": source_slug,
                "to": "reserve",
                "to_slug": target_slug,
                "assets": {
                    derivative: {
                        "from": source_assets.get(derivative),
                        "to": target_assets.get(derivative),
                    }
                    for derivative in sorted(set(source_assets) | set(target_assets))
                },
            })
            _set_action_progress(operation_id, total_photos, index)
        _set_action_progress(operation_id, total_photos, total_photos)
        site_state, worker_catalog = _write_catalog_state(repo_root, expo_groups, reserve_groups, hidden_groups)
        action_log = _record_country_assignments(repo_root, target_slug, moved, skipped)
        return {
            "ok": True,
            "action": action,
            "photo_ids": photo_ids,
            "moved": moved,
            "removed_from_unknown": [item["id"] for item in moved],
            "skipped": skipped,
            "action_log": action_log,
            "keyword_updates": keyword_updates,
            "worker_catalog": worker_catalog,
            "site": site_state,
        }

    if action == "discard":
        hidden_found = _find_and_remove(hidden_groups, photo_id)
        expo_found = _find_and_remove(expo_groups, photo_id)
        reserve_found = _find_and_remove(reserve_groups, photo_id)
        found = hidden_found or expo_found or reserve_found
        source_state = "hidden" if hidden_found else "expo" if expo_found else "reserve"
        if not found:
            if photo_id in _discarded_photo_ids(repo_root):
                site_state, worker_catalog = _write_catalog_state(repo_root, expo_groups, reserve_groups, hidden_groups)
                tombstone = _write_discarded_tombstone(repo_root)
                return {
                    "ok": True,
                    "action": action,
                    "photo_id": photo_id,
                    "message": "already discarded",
                    "discarded_count": len(tombstone.get("photo_ids") or []),
                    "worker_catalog": worker_catalog,
                    "site": site_state,
                }
            raise ValueError(f"photo not found in Expo, Reserve, or Waste Basket: {photo_id}")
        source_slug, source_photo = found
        _source_state, original_slug = _hidden_provenance(source_photo, "expo", source_slug)
        source_assets = _photo_asset_paths(source_photo)
        public_preview_keys = _hidden_public_preview_keys(source_photo, original_slug)
        private_keys = _discarded_private_keys(source_photo)
        tombstone_entry = {
            "id": photo_id,
            "title": source_photo.get("title") or photo_id,
            "discarded_at": datetime.now(timezone.utc).isoformat(),
            "from_state": source_state,
            "from_slug": source_slug,
            "source_slug": original_slug,
            "asset_paths": source_assets,
            "public_preview_keys": public_preview_keys,
            "private_keys": private_keys,
        }
        tombstone = _write_discarded_tombstone(repo_root, tombstone_entry)
        site_state, worker_catalog = _write_catalog_state(repo_root, expo_groups, reserve_groups, hidden_groups)
        r2_task = _start_r2_delete_task(photo_id, _discarded_delete_items(repo_root, source_photo, original_slug), "discarded-media-wipe")
        return {
            "ok": True,
            "action": action,
            "photo_id": photo_id,
            "moved": {"from": source_state, "from_slug": source_slug, "to": "discarded", "to_slug": original_slug},
            "discarded_count": len(tombstone.get("photo_ids") or []),
            "r2_delete_task": r2_task,
            "worker_catalog": worker_catalog,
            "site": site_state,
        }

    if action == "hide":
        found = _find_photo(expo_groups, photo_id)
        source_state = "expo"
        if not found:
            found = _find_photo(reserve_groups, photo_id)
            source_state = "reserve"
        if not found:
            hidden_hit = next(
                ((slug, photo) for slug, photos in hidden_groups.items() for photo in photos if photo.get("id") == photo_id),
                None,
            )
            if hidden_hit:
                site_state = _write_state(repo_root, expo_groups, reserve_groups, hidden_groups)
                r2_task = _start_r2_upload_task("hidden-blacklist", [_hidden_blacklist_upload_item(repo_root)], "hidden-blacklist-upload")
                return {
                    "ok": True,
                    "action": action,
                    "photo_id": photo_id,
                    "message": "already hidden",
                    "r2_blacklist_task": r2_task,
                    "site": site_state,
                }
            raise ValueError(f"photo not found in Expo or Reserve: {photo_id}")
        source_slug, source_photo = found
        hidden_photo = _hidden_review_photo(source_photo, source_slug, source_state, datetime.now(timezone.utc).isoformat())
        _remove_existing(hidden_groups, photo_id)
        hidden_groups[source_slug].append(hidden_photo)
        moved = {"from": source_state, "from_slug": source_slug, "to": "hidden", "to_slug": source_slug, "mode": "blacklist"}

    elif action == "undo-hide":
        found = _find_and_remove(hidden_groups, photo_id)
        if not found:
            raise ValueError(f"photo not found in Hidden: {photo_id}")
        hidden_slug, hidden_photo = found
        target_state, target_slug = _hidden_provenance(hidden_photo, "expo", hidden_slug)
        if target_state == "expo" and not public_preview_allowed(hidden_photo):
            target_state = "reserve"
        moved = {"from": "hidden", "from_slug": hidden_slug, "to": target_state, "to_slug": target_slug, "mode": "blacklist"}

    else:
        found = _find_and_remove(hidden_groups, photo_id)
        if not found:
            raise ValueError(f"photo not found in Hidden: {photo_id}")
        hidden_slug, hidden_photo = found
        _source_state, target_slug = _hidden_provenance(hidden_photo, "expo", hidden_slug)
        if not _find_photo(expo_groups, photo_id):
            restored = copy_photo(hidden_photo)
            restored.pop("hiddenFromState", None)
            restored.pop("hiddenFromSlug", None)
            _remove_existing(expo_groups, photo_id)
            expo_groups[target_slug].append(restored)
        moved = {"from": "hidden", "from_slug": hidden_slug, "to": "expo", "to_slug": target_slug, "mode": "blacklist"}

    site_state, worker_catalog = _write_catalog_state(repo_root, expo_groups, reserve_groups, hidden_groups)
    r2_task = _start_r2_upload_task("hidden-blacklist", [_hidden_blacklist_upload_item(repo_root)], "hidden-blacklist-upload")
    return {
        "ok": True,
        "action": action,
        "photo_id": photo_id,
        "moved": moved,
        "r2_blacklist_task": r2_task,
        "worker_catalog": worker_catalog,
        "site": site_state,
    }


if __name__ == "__main__":
    raise SystemExit(main())
