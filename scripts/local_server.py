#!/usr/bin/env python3
"""Local Photos By Elie preview server with owner-only helper endpoints."""

from __future__ import annotations

import argparse
import copy
from datetime import date, datetime, timezone
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
from typing import Callable
from urllib.parse import parse_qs, quote, unquote, urlparse
from urllib.request import Request, urlopen


PHOTO_ACTION_PATH = "/__photosbyelie/photo-action"
PHOTO_ACTION_PROGRESS_PATH = "/__photosbyelie/photo-action-progress"
R2_PROGRESS_PATH = "/__photosbyelie/r2-progress"
R2_COVERAGE_PATH = "/__photosbyelie/r2-coverage"
R2_FIX_PATH = "/__photosbyelie/r2-fix"
R2_FILL_GAPS_PATH = "/__photosbyelie/r2-fill-gaps"
R2_SKIP_PHASE_PATH = "/__photosbyelie/r2-skip-phase"
OWNER_VISIBILITY_SUMMARY_PATH = "/__photosbyelie/owner-visibility-summary"
SELECT_IMPORT_FOLDER_PATH = "/__photosbyelie/select-import-folder"
IMPORT_SOURCES_PATH = "/__photosbyelie/import-sources"
IMPORT_SOURCE_THUMB_PATH = "/__photosbyelie/import-source-thumb"
REAL_ESTATE_OWNER_PATH = "/__photosbyelie/real-estate-owner"
REAL_ESTATE_IMPORT_PROGRESS_PATH = "/__photosbyelie/real-estate-import-progress"
OWNER_SESSION_PATH = "/__photosbyelie/owner-session"
OWNER_LOGIN_PATH = "/__photosbyelie/owner-login"
OWNER_LOGOUT_PATH = "/__photosbyelie/owner-logout"
TITLE_KEYWORD_REVIEW_QUEUE_PATH = "/__photosbyelie/title-keyword-review-queue"
OWNER_SUPER_SEARCH_PATH = "/__photosbyelie/owner-super-search-index"
PUBLIC_MEDIA_PROXY_PATH = "/__photosbyelie/public-media/"
PRIVATE_MEDIA_PROXY_PATH = "/__photosbyelie/private-media/"
SOURCE_PREVIEW_PATH = "/__photosbyelie/source-preview/"
SOURCE_EDIT_PATH = "/__photosbyelie/source-edit"
SOURCE_EDIT_APPS_PATH = "/__photosbyelie/source-edit-apps"
SOURCE_EDITS_PATH = "/__photosbyelie/source-edits"
SOURCE_EDIT_IMPORT_PATH = "/__photosbyelie/source-edit-import"
SOURCE_EDIT_IMPORT_ALL_PATH = "/__photosbyelie/source-edit-import-all"
PUBLISH_PRICES_PATH = "/__photosbyelie/publish-prices"
PUBLISH_PRICES_PROGRESS_PATH = "/__photosbyelie/publish-prices-progress"
MAX_BODY_BYTES = 5 * 1024 * 1024
LOCAL_CLIENTS = {"127.0.0.1", "::1", "localhost"}
VISIBLE_VERSION_EPOCH = date(2026, 2, 28)
DERIVATIVES = (("gallery", "gallerySrc"), ("detail", "imageSrc"))
COUNTRY_ASSIGNMENT_TARGETS = {"france", "usa", "spain", "mexico", "italy", "portugal", "slovakia"}
OWNER_SESSION_COOKIE = "pbe_owner_session"
OWNER_ACTION_ROOT = Path("assets/owner-actions")
KEYWORD_BLACKLIST_PATH = OWNER_ACTION_ROOT / "keyword-blacklist.json"
COUNTRY_ASSIGNMENT_LOG = OWNER_ACTION_ROOT / "country-assignments.jsonl"
COUNTRY_ASSIGNMENT_INDEX = OWNER_ACTION_ROOT / "country-assignments.json"
TITLE_KEYWORD_REVIEW_ROOT = OWNER_ACTION_ROOT / "title-keyword-review-queue"
IMPORT_CACHE_MANIFEST_PATH = Path("tmp/import-cache/manifest.json")
TITLE_KEYWORD_REVIEW_BACKLOG_LIMIT = 500
try:
    TITLE_KEYWORD_REVIEW_BACKLOG_LIMIT = max(
        0,
        int(os.environ.get("PBE_TITLE_KEYWORD_REVIEW_BACKLOG_LIMIT", TITLE_KEYWORD_REVIEW_BACKLOG_LIMIT)),
    )
except (TypeError, ValueError):
    TITLE_KEYWORD_REVIEW_BACKLOG_LIMIT = 500
REAL_ESTATE_CLIENTS_PATH = OWNER_ACTION_ROOT / "real-estate-clients.local.json"
REAL_ESTATE_IMPORT_ROOT = Path("tmp/real-estate-import")
REAL_ESTATE_PUBLIC_ROOT = Path("assets/real-estate")
REAL_ESTATE_SOURCE_ROOT = Path("/Volumes/Saturn/Pictures/RE")
REAL_ESTATE_MEDIA_EXTENSIONS = {".jpg", ".jpeg", ".mov", ".mp4", ".m4v"}
IMPORT_SOURCE_THUMB_ROOT = Path(".review-logs/import-source-thumbs")
SOURCE_PREVIEW_CACHE_ROOT = Path(".review-logs/source-previews")
IMPORT_SOURCE_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".heic", ".heif", ".webp"}
SOURCE_PREVIEW_BROWSER_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
SOURCE_PREVIEW_GENERATABLE_IMAGE_EXTENSIONS = {".heic", ".heif", ".tif", ".tiff", ".png", ".webp"}
SOURCE_PREVIEW_BROWSER_VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov", ".webm"}
SOURCE_EDIT_PHOTO_UTIS = {
    "public.image",
    "public.jpeg",
    "public.jpeg-2000",
    "public.jpeg-xl",
    "public.png",
    "public.tiff",
    "public.heic",
    "public.heif",
    "public.camera-raw-image",
    "com.adobe.photoshop-image",
}
SOURCE_EDIT_VIDEO_UTIS = {
    "public.movie",
    "public.video",
    "public.audiovisual-content",
    "public.mpeg",
    "public.mpeg-4",
    "public.mpeg-2-video",
    "com.apple.quicktime-movie",
    "com.apple.m4v-video",
    "public.avi",
    "public.dv-movie",
}
SOURCE_EDIT_APP_CACHE: dict[str, object] = {"expires_at": 0.0, "apps": []}
PUBLIC_SITE_BASE_URL = "https://ec92009.github.io/PhotosByElie/"
PUBLIC_MEDIA_BASE_URL = "https://pub-a6e07fdd880f4869b4be0e9346cabdc2.r2.dev"
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
PRICE_PUBLISH_TASKS: dict[str, dict] = {}
PRICE_PUBLISH_LOCK = threading.Lock()
R2_SWEEP_SKIPPABLE_PHASES = {
    "discard-start",
    "selected-folder",
    "camera",
    "apple-photo-albums",
    "leonardo",
    "eligibility",
    "real-estate",
    "gap-fill",
    "private",
    "discard-final",
    "test",
    "validate",
}
IMPORT_SOURCE_SETTINGS_KEY = "import_source_roots"
REAL_ESTATE_IMPORT_SOURCE_SETTINGS_KEY = "real_estate_import_source_roots"
IMPORT_SOURCE_HISTORY_LIMIT = 40
IMPORT_SOURCE_ROOTS = {
    "camera": Path("/Volumes/Saturn/Pictures/LR/Camera"),
    "apple-photo-albums": Path("/Volumes/Saturn/Pictures/LR/Apple Photo Albums"),
    "leonardo": Path("/Volumes/Saturn/Pictures/LR/_All Leonardo"),
}
R2_MAINTENANCE_TASKS = {
    "banned-cleanup": {
        "label": "Banned-photo cleanup",
        "phases": [
            (
                "discard-start",
                "Double-check banned R2 cleanup",
                [
                    "node",
                    "scripts/delete_discarded_r2_media.mjs",
                    "--delete",
                    "--discarded-tombstone",
                    "assets/discarded/discarded-photo-ids.json",
                    "--request-timeout-ms",
                    "180000",
                    "--retries",
                    "4",
                ],
            ),
        ],
    },
    "final-cleanup": {
        "label": "Final banned-photo cleanup",
        "phases": [
            (
                "discard-final",
                "Final banned R2 cleanup double-check",
                [
                    "node",
                    "scripts/delete_discarded_r2_media.mjs",
                    "--delete",
                    "--discarded-tombstone",
                    "assets/discarded/discarded-photo-ids.json",
                    "--request-timeout-ms",
                    "180000",
                    "--retries",
                    "4",
                ],
            ),
        ],
    },
    "storage": {
        "label": "Storage estimate",
        "phases": [("storage", "Refresh storage estimate", ["node", "scripts/write_storage_estimate.mjs"])],
    },
    "validate": {
        "label": "Catalog validation",
        "phases": [
            ("test", "Run tests", ["npm", "test"]),
            ("validate", "Validate publish", ["npm", "run", "validate"]),
        ],
    },
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
from media_keys import private_master_key, private_render_key, public_preview_key  # noqa: E402
from import_eligibility import import_select_for_source_root, row_import_eligible  # noqa: E402
from media_policy import private_master_allowed, public_preview_allowed  # noqa: E402
from sync_r2_media import (  # noqa: E402
    DEFAULT_PRIVATE_BUCKET,
    DEFAULT_PRIVATE_PREFIX,
    DEFAULT_PUBLIC_BUCKET,
    DEFAULT_PUBLIC_PREFIX,
    DEFAULT_THROTTLE_FILE,
    UploadItem,
    hidden_photo_ids as r2_hidden_photo_ids,
    item_batches_by_bucket,
    private_key as r2_private_key,
    public_key as r2_public_key,
    s3_config_complete,
    s3_config_from_env,
    s3_delete_objects,
    upload_id as r2_upload_id,
    wrangler_delete,
    wrangler_put,
)
from owner_state_db import backfill_r2_object_metadata, connect as owner_db_connect, media_lifecycle_snapshot, upsert_r2_object_state  # noqa: E402
from owner_state_db import keyword_blacklist_terms as keyword_blacklist_terms_db  # noqa: E402
from owner_state_db import record_country_assignments as record_country_assignments_db  # noqa: E402
from owner_state_db import record_keyword_blacklist as record_keyword_blacklist_db  # noqa: E402
from owner_state_db import record_media_lifecycle_active as record_media_lifecycle_active_db  # noqa: E402
from owner_state_db import record_media_lifecycle_discarded as record_media_lifecycle_discarded_db  # noqa: E402
from owner_state_db import record_media_lifecycle_hidden as record_media_lifecycle_hidden_db  # noqa: E402
from owner_state_db import clear_title_keyword_review_blocks as clear_title_keyword_review_blocks_db  # noqa: E402
from owner_state_db import queue_title_keyword_review_photo as queue_title_keyword_review_photo_db  # noqa: E402
from owner_state_db import queue_title_keyword_review_photos as queue_title_keyword_review_photos_db  # noqa: E402
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
LOCAL_TOOL_DIRS = (
    Path("/opt/homebrew/bin"),
    Path("/usr/local/bin"),
    Path("/opt/homebrew/sbin"),
    Path("/usr/local/sbin"),
)
PIXELMATOR_PRO_BUNDLE_ID = "com.pixelmatorteam.pixelmator.x"
PIXELMATOR_PRO_NAME = "Pixelmator Pro"
PIXELMATOR_EDIT_FOLDER = Path("pixelmator.pro.edits")
PIXELMATOR_IMPORTED_EDIT_FOLDER = Path("pixelmator.pro.imported-edits")
PIXELMATOR_EDIT_IMPORTS_PATH = OWNER_ACTION_ROOT / "pixelmator-edits.local.json"
PIXELMATOR_EDIT_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".heic"}


class PhotosByElieLocalHandler(SimpleHTTPRequestHandler):
    server_version = "PhotosByElieLocal/1.0"

    def translate_path(self, path: str) -> str:
        translated = Path(super().translate_path(path))
        return str(translated)

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path.startswith(SOURCE_PREVIEW_PATH):
            self._handle_source_preview(path)
            return
        if path == SOURCE_EDIT_APPS_PATH:
            self._handle_source_edit_apps()
            return
        if path == SOURCE_EDITS_PATH:
            self._handle_source_edits()
            return
        if path.startswith(PUBLIC_MEDIA_PROXY_PATH):
            self._handle_public_media_proxy(path)
            return
        if path.startswith(PRIVATE_MEDIA_PROXY_PATH):
            self._handle_private_media_proxy(path)
            return
        if path == OWNER_SESSION_PATH:
            self._handle_owner_session()
            return
        if path == TITLE_KEYWORD_REVIEW_QUEUE_PATH:
            self._handle_title_keyword_review_queue()
            return
        if path == OWNER_SUPER_SEARCH_PATH:
            self._handle_owner_super_search_index()
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
        if path == OWNER_VISIBILITY_SUMMARY_PATH:
            self._handle_owner_visibility_summary()
            return
        if path == IMPORT_SOURCES_PATH:
            self._handle_import_sources()
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
        if path == PUBLISH_PRICES_PROGRESS_PATH:
            self._handle_publish_prices_progress()
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
        if path == SELECT_IMPORT_FOLDER_PATH:
            self._handle_select_import_folder()
            return
        if path == PHOTO_ACTION_PATH:
            self._handle_photo_action()
            return
        if path == SOURCE_EDIT_PATH:
            self._handle_source_edit()
            return
        if path == SOURCE_EDIT_IMPORT_PATH:
            self._handle_source_edit_import()
            return
        if path == SOURCE_EDIT_IMPORT_ALL_PATH:
            self._handle_source_edit_import_all()
            return
        if path == PUBLISH_PRICES_PATH:
            self._handle_publish_prices()
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

    def _handle_source_edit_import_all(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            result = _import_all_pixelmator_edits(Path.cwd())
        except (OSError, sqlite3.Error, json.JSONDecodeError) as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, result)

    def _handle_publish_prices(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = self._read_json_body()
            task = _start_price_publish_task(Path.cwd(), payload)
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        except OSError as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, {"ok": True, "task": task})

    def _handle_publish_prices_progress(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        query = parse_qs(urlparse(self.path).query)
        task_id = (query.get("task_id") or query.get("taskId") or [""])[0]
        self._send_json(HTTPStatus.OK, {"ok": True, "tasks": _price_publish_task_snapshot(task_id or None)})

    def _handle_source_edit(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = self._read_json_body()
            media_id = str(payload.get("media_id") or payload.get("mediaId") or "").strip()
            source = _source_original_for_media_id(Path.cwd(), media_id)
            edit_folder = _pixelmator_edit_folder(Path.cwd())
            suggested_output = _pixelmator_edit_output_path(Path.cwd(), media_id, source["path"])
            command = ["open", "-b", PIXELMATOR_PRO_BUNDLE_ID, str(source["path"])]
            subprocess.run(command, check=True, capture_output=True, text=True)
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        except subprocess.CalledProcessError as error:
            message = (error.stderr or error.stdout or str(error)).strip() or "Could not open source media."
            self._send_json(HTTPStatus.BAD_GATEWAY, {"ok": False, "error": message})
            return
        except OSError as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, {
            "ok": True,
            "media_id": media_id,
            "path": str(source["path"]),
            "editor": PIXELMATOR_PRO_NAME,
            "bundle_id": PIXELMATOR_PRO_BUNDLE_ID,
            "edit_folder": str(edit_folder),
            "suggested_output_path": str(suggested_output),
            "watch_url": SOURCE_EDITS_PATH,
        })

    def _handle_source_edit_apps(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        query = parse_qs(urlparse(self.path).query)
        media_id = str((query.get("media_id") or query.get("mediaId") or [""])[0]).strip()
        requested_type = str((query.get("media_type") or query.get("kind") or [""])[0]).strip().lower()
        try:
            media_type = _source_edit_media_type(Path.cwd(), media_id, requested_type)
        except OSError as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        apps = [] if media_type == "video" else [{
            "name": PIXELMATOR_PRO_NAME,
            "bundleId": PIXELMATOR_PRO_BUNDLE_ID,
            "path": "/Applications/Pixelmator Pro.app",
            "matchedTypes": sorted(SOURCE_EDIT_PHOTO_UTIS),
        }]
        self._send_json(HTTPStatus.OK, {
            "ok": True,
            "media_id": media_id,
            "mediaType": media_type,
            "apps": apps,
        })

    def _handle_source_edits(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            folder = _pixelmator_edit_folder(Path.cwd())
            files = _pixelmator_edit_files(Path.cwd())
        except OSError as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, {
            "ok": True,
            "folder": str(folder),
            "count": len(files),
            "files": files,
        })

    def _handle_source_edit_import(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = self._read_json_body()
            media_id = str(payload.get("media_id") or payload.get("mediaId") or "").strip()
            edit_name = str(payload.get("edit_name") or payload.get("editName") or "").strip()
            result = _import_pixelmator_edit(Path.cwd(), media_id, edit_name)
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
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

    def _handle_owner_visibility_summary(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            summary = owner_visibility_summary(Path.cwd())
        except (OSError, sqlite3.Error, json.JSONDecodeError) as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, {"ok": True, "summary": summary})

    def _handle_import_sources(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            query = parse_qs(urlparse(self.path).query)
            kind = (query.get("kind") or [""])[0].strip().lower()
            sources = (
                _real_estate_import_source_history(Path.cwd())
                if kind in {"real-estate", "real_estate", "re"}
                else _import_source_history(Path.cwd())
            )
        except sqlite3.Error as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, {"ok": True, "sources": sources})

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
        self.send_header("Cache-Control", "private, max-age=3600")
        self.end_headers()
        self.wfile.write(body)

    def _handle_public_media_proxy(self, path: str) -> None:
        if not self._is_loopback_request():
            self.send_error(HTTPStatus.FORBIDDEN, "localhost-only endpoint")
            return
        key = unquote(path[len(PUBLIC_MEDIA_PROXY_PATH):]).lstrip("/")
        if not key or "\\" in key or ".." in key.split("/"):
            self.send_error(HTTPStatus.BAD_REQUEST, "invalid media key")
            return
        safe_key = "/".join(quote(part, safe="") for part in key.split("/") if part)
        upstream = f"{PUBLIC_MEDIA_BASE_URL}/{safe_key}"
        try:
            request = Request(upstream, headers={"User-Agent": "PhotosByElieLocal/1.0"})
            with urlopen(request, timeout=20) as response:
                body = response.read()
                content_type = response.headers.get_content_type() or mimetypes.guess_type(key)[0] or "application/octet-stream"
        except OSError as error:
            self.send_error(HTTPStatus.BAD_GATEWAY, str(error))
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "private, max-age=3600")
        self.end_headers()
        self.wfile.write(body)

    def _handle_private_media_proxy(self, path: str) -> None:
        if not self._is_loopback_request():
            self.send_error(HTTPStatus.FORBIDDEN, "localhost-only endpoint")
            return
        key = unquote(path[len(PRIVATE_MEDIA_PROXY_PATH):]).lstrip("/")
        if not _is_safe_private_render_key(Path.cwd(), key):
            self.send_error(HTTPStatus.NOT_FOUND, "private render unavailable")
            return
        try:
            local_path = _cached_private_media_path(Path.cwd(), DEFAULT_PRIVATE_BUCKET, key)
        except (OSError, RuntimeError, subprocess.SubprocessError) as error:
            self.send_error(HTTPStatus.BAD_GATEWAY, str(error))
            return
        body = local_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mimetypes.guess_type(key)[0] or "image/jpeg")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "private, max-age=3600")
        self.end_headers()
        self.wfile.write(body)

    def _handle_source_preview(self, path: str) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        media_id = unquote(path[len(SOURCE_PREVIEW_PATH):]).strip("/")
        query = parse_qs(urlparse(self.path).query)
        info_only = "info" in query
        result = _source_preview_for_media_id(Path.cwd(), media_id)
        if not result.get("ok"):
            status = HTTPStatus(int(result.get("status") or HTTPStatus.NOT_FOUND))
            if info_only:
                self._send_json(status, result)
            else:
                self.send_error(status, result.get("error") or "source preview unavailable")
            return
        if info_only:
            self._send_json(HTTPStatus.OK, {
                **{key: value for key, value in result.items() if key != "path"},
                "previewUrl": f"{SOURCE_PREVIEW_PATH}{quote(media_id, safe='')}",
            })
            return
        source_path = Path(result["path"])
        try:
            stat = source_path.stat()
            file_obj = source_path.open("rb")
        except OSError as error:
            self.send_error(HTTPStatus.NOT_FOUND, str(error))
            return
        with file_obj:
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", result.get("contentType") or mimetypes.guess_type(source_path.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(stat.st_size))
            self.send_header("Cache-Control", "private, max-age=3600")
            self.end_headers()
            shutil.copyfileobj(file_obj, self.wfile)

    def _handle_r2_fix(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = self._read_optional_json_body()
            maintenance_key = _normalize_r2_maintenance_task(payload.get("maintenanceTask"))
            skip_phases = _normalize_r2_sweep_skip_phases(payload.get("skipPhases"))
            source_root = _normalize_import_source_root(payload.get("sourceRoot"))
            source_select = _normalize_import_select(payload.get("sourceSelect"))
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        if source_root and _is_real_estate_import_source(source_root):
            self._send_json(
                HTTPStatus.BAD_REQUEST,
                {"ok": False, "error": "Use the Real Estate tab for real-estate source folders."},
            )
            return
        if maintenance_key:
            task = _start_r2_maintenance_task(Path.cwd(), maintenance_key)
        else:
            task = _start_cloud_media_sweep(Path.cwd(), skip_phases, source_root=source_root, source_select=source_select)
            if source_root and task.get("sourceRoot") == str(source_root):
                _remember_import_source_root(Path.cwd(), source_root)
        self._send_json(HTTPStatus.OK, {"ok": True, "task": task})

    def _handle_select_import_folder(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            folder = _select_import_folder()
        except OSError as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        if not folder:
            self._send_json(HTTPStatus.OK, {"ok": True, "cancelled": True})
            return
        self._send_json(HTTPStatus.OK, {"ok": True, "path": str(folder), "name": folder.name or str(folder)})

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

    def _handle_owner_super_search_index(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = owner_super_search_index(Path.cwd())
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


def _clean_price_value(value: object) -> float:
    try:
        amount = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"invalid price value: {value!r}") from error
    if amount < 0 or not amount < float("inf"):
        raise ValueError(f"invalid price value: {value!r}")
    return round(amount, 2)


def _price_publish_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _price_publish_task_snapshot(task_id: str | None = None) -> list[dict]:
    with PRICE_PUBLISH_LOCK:
        if task_id:
            task = PRICE_PUBLISH_TASKS.get(task_id)
            return [copy.deepcopy(task)] if task else []
        return [copy.deepcopy(task) for task in PRICE_PUBLISH_TASKS.values()]


def _active_price_publish_task() -> dict | None:
    with PRICE_PUBLISH_LOCK:
        for task in PRICE_PUBLISH_TASKS.values():
            if task.get("state") in {"queued", "running"}:
                return copy.deepcopy(task)
    return None


def _update_price_publish_task(task_id: str, **updates: object) -> dict | None:
    with PRICE_PUBLISH_LOCK:
        task = PRICE_PUBLISH_TASKS.get(task_id)
        if not task:
            return None
        task.update(updates)
        task["updated_at"] = _price_publish_now()
        return copy.deepcopy(task)


def _append_price_publish_step(task_id: str | None, label: str, command: list[str] | None = None) -> int:
    if not task_id:
        return -1
    with PRICE_PUBLISH_LOCK:
        task = PRICE_PUBLISH_TASKS.get(task_id)
        if not task:
            return -1
        steps = task.setdefault("steps", [])
        steps.append({
            "label": label,
            "command": " ".join(command or []),
            "state": "running",
            "returnCode": None,
            "elapsedMs": None,
            "output": "",
        })
        task["state"] = "running"
        task["currentStep"] = label
        task["completed"] = max(0, len(steps) - 1)
        task["updated_at"] = _price_publish_now()
        return len(steps) - 1


def _finish_price_publish_step(task_id: str | None, index: int, state: str, return_code: int, elapsed_ms: int, output: str) -> None:
    if not task_id or index < 0:
        return
    with PRICE_PUBLISH_LOCK:
        task = PRICE_PUBLISH_TASKS.get(task_id)
        if not task:
            return
        steps = task.setdefault("steps", [])
        if index < len(steps):
            steps[index].update({
                "state": state,
                "returnCode": return_code,
                "elapsedMs": elapsed_ms,
                "output": output[-4000:],
            })
        task["completed"] = len([step for step in steps if step.get("state") == "done"])
        task["updated_at"] = _price_publish_now()


def _apply_owner_price_overrides(catalog: dict, overrides: dict) -> dict:
    if not isinstance(overrides, dict):
        raise ValueError("priceOverrides must be an object")
    product_by_id = {
        str(product.get("id")): product
        for product in catalog.get("products", [])
        if isinstance(product, dict) and product.get("id")
    }
    for product_id, value in (overrides.get("options") or {}).items():
        product = product_by_id.get(str(product_id))
        if not product:
            continue
        price = _clean_price_value(value)
        product["price"] = price
        if isinstance(product.get("prices"), dict) and "original" in product["prices"]:
            product["prices"]["original"] = price
    for product_id, prices in (overrides.get("optionPrices") or {}).items():
        product = product_by_id.get(str(product_id))
        if not product or not isinstance(prices, dict):
            continue
        product["prices"] = dict(product.get("prices") or {})
        for tier_id, value in prices.items():
            price = _clean_price_value(value)
            product["prices"][str(tier_id)] = price
            if tier_id == "original" and "price" in product:
                product["price"] = price

    frame_by_id = {
        str(frame.get("id")): frame
        for frame in catalog.get("frames", [])
        if isinstance(frame, dict) and frame.get("id")
    }
    for frame_id, frame_override in (overrides.get("frames") or {}).items():
        frame = frame_by_id.get(str(frame_id))
        if not frame or not isinstance(frame_override, dict):
            continue
        if "price" in frame_override:
            frame["price"] = _clean_price_value(frame_override.get("price"))
        if isinstance(frame_override.get("prices"), dict):
            frame["prices"] = dict(frame.get("prices") or {})
            for product_id, value in frame_override["prices"].items():
                frame["prices"][str(product_id)] = _clean_price_value(value)

    if isinstance(overrides.get("shippingHandling"), dict):
        catalog["shippingHandlingPrices"] = dict(catalog.get("shippingHandlingPrices") or {})
        for product_id, value in overrides["shippingHandling"].items():
            catalog["shippingHandlingPrices"][str(product_id)] = _clean_price_value(value)

    if isinstance(overrides.get("videoPriceTiers"), dict):
        tier_by_id = {
            str(tier.get("id")): tier
            for tier in catalog.get("videoPriceTiers", [])
            if isinstance(tier, dict) and tier.get("id")
        }
        for tier_id, value in overrides["videoPriceTiers"].items():
            tier = tier_by_id.get(str(tier_id))
            if tier:
                tier["price"] = _clean_price_value(value)
    return catalog


def _run_publish_command(repo_root: Path, command: list[str], steps: list[dict], label: str, task_id: str | None = None) -> str:
    started = time.perf_counter()
    progress_index = _append_price_publish_step(task_id, label, command)
    process = subprocess.run(command, cwd=repo_root, capture_output=True, text=True)
    output = "\n".join(part.strip() for part in [process.stdout, process.stderr] if part and part.strip())
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    step = {
        "label": label,
        "command": " ".join(command),
        "state": "done" if process.returncode == 0 else "failed",
        "returnCode": process.returncode,
        "elapsedMs": elapsed_ms,
        "output": output[-4000:],
    }
    steps.append(step)
    _finish_price_publish_step(task_id, progress_index, step["state"], process.returncode, elapsed_ms, output)
    if process.returncode != 0:
        raise subprocess.CalledProcessError(process.returncode, command, output=process.stdout, stderr=process.stderr)
    return output


def _next_visible_version(current: str, today: date | None = None) -> str:
    match = re.fullmatch(r"(\d+)\.(\d+)", current.strip())
    if not match:
        raise ValueError(f"unsupported VERSION value: {current!r}")
    current_day = int(match.group(1))
    current_build = int(match.group(2))
    expected_day = ((today or date.today()) - VISIBLE_VERSION_EPOCH).days
    if current_day < expected_day:
        return f"{expected_day}.0"
    return f"{current_day}.{current_build + 1}"


def _bump_visible_version(repo_root: Path) -> tuple[str, str, list[str]]:
    version_path = repo_root / "VERSION"
    old_version = version_path.read_text(encoding="utf-8").strip()
    new_version = _next_visible_version(old_version)
    version_path.write_text(f"{new_version}\n", encoding="utf-8")
    changed = ["VERSION"]

    readme_path = repo_root / "README.md"
    if readme_path.exists():
        source = readme_path.read_text(encoding="utf-8")
        updated = re.sub(r"Current visible version: `v[0-9.]+`", f"Current visible version: `v{new_version}`", source)
        if updated != source:
            readme_path.write_text(updated, encoding="utf-8")
            changed.append("README.md")

    for html_path in sorted(repo_root.glob("*.html")):
        source = html_path.read_text(encoding="utf-8")
        updated = re.sub(r"\?v=[0-9.]+", f"?v={new_version}", source)
        updated = re.sub(r">v[0-9.]+<", f">v{new_version}<", updated)
        if updated != source:
            html_path.write_text(updated, encoding="utf-8")
            changed.append(html_path.name)
    return old_version, new_version, changed


def _publish_owner_prices(repo_root: Path, payload: dict, task_id: str | None = None) -> dict:
    overrides = payload.get("priceOverrides")
    if not isinstance(overrides, dict):
        raise ValueError("priceOverrides is required")
    steps: list[dict] = []
    pricing_path = repo_root / "assets/catalog/product-pricing.json"
    write_index = _append_price_publish_step(task_id, "Write canonical pricing")
    started = time.perf_counter()
    catalog = json.loads(pricing_path.read_text(encoding="utf-8"))
    catalog = _apply_owner_price_overrides(catalog, overrides)
    pricing_path.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    steps.append({
        "label": "Write canonical pricing",
        "command": "",
        "state": "done",
        "returnCode": 0,
        "elapsedMs": elapsed_ms,
        "output": str(pricing_path),
    })
    _finish_price_publish_step(task_id, write_index, "done", 0, elapsed_ms, str(pricing_path))

    _run_publish_command(repo_root, ["node", "scripts/write_catalog_tsv.cjs"], steps, "Rebuild public SQLite catalog", task_id)
    _run_publish_command(repo_root, ["node", "scripts/write_worker_catalog.mjs"], steps, "Regenerate Worker catalog", task_id)
    version_index = _append_price_publish_step(task_id, "Bump visible version")
    started = time.perf_counter()
    old_version, new_version, version_files = _bump_visible_version(repo_root)
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    steps.append({
        "label": "Bump visible version",
        "command": "",
        "state": "done",
        "returnCode": 0,
        "elapsedMs": elapsed_ms,
        "output": f"v{old_version} -> v{new_version}",
    })
    _finish_price_publish_step(task_id, version_index, "done", 0, elapsed_ms, f"v{old_version} -> v{new_version}")

    _run_publish_command(repo_root, ["node", "--check", "photos.js"], steps, "Check photos.js", task_id)
    _run_publish_command(repo_root, ["node", "--check", "owner.js"], steps, "Check owner.js", task_id)
    _run_publish_command(repo_root, ["node", "--check", "basket.js"], steps, "Check basket.js", task_id)
    _run_publish_command(repo_root, ["node", "--test", "worker/checkout-worker.test.mjs", "worker/resend-email-client.test.mjs"], steps, "Run checkout/email tests", task_id)
    _run_publish_command(repo_root, ["npm", "run", "validate"], steps, "Validate publish", task_id)
    deploy_output = _run_publish_command(repo_root, ["npx", "wrangler", "deploy"], steps, "Deploy Worker", task_id)

    html_files = [path.name for path in sorted(repo_root.glob("*.html"))]
    stage_files = [
        "README.md",
        "VERSION",
        *html_files,
        "assets/catalog/photosbyelie.sqlite",
        "assets/catalog/product-pricing.json",
        "photos-data.js",
        "worker/photos-catalog.generated.mjs",
    ]
    existing_stage_files = [name for name in stage_files if (repo_root / name).exists()]
    _run_publish_command(repo_root, ["git", "add", "--", *existing_stage_files], steps, "Stage price publish files", task_id)
    commit_message = str(payload.get("commitMessage") or "photosbyelie: publish owner price list").strip()
    _run_publish_command(repo_root, ["git", "commit", "-m", commit_message], steps, "Commit price publish", task_id)
    _run_publish_command(repo_root, ["git", "push"], steps, "Push price publish", task_id)

    version_id_match = re.search(r"Current Version ID:\s*([0-9a-f-]+)", deploy_output)
    return {
        "ok": True,
        "oldVersion": old_version,
        "newVersion": new_version,
        "versionFiles": version_files,
        "stagedFiles": existing_stage_files,
        "workerVersionId": version_id_match.group(1) if version_id_match else "",
        "steps": steps,
    }


def _run_price_publish_task(task_id: str, repo_root: Path, payload: dict) -> None:
    _update_price_publish_task(task_id, state="running", currentStep="Starting price publish")
    try:
        result = _publish_owner_prices(repo_root, payload, task_id)
    except subprocess.CalledProcessError as error:
        message = (error.stderr or error.output or str(error)).strip() or str(error)
        _update_price_publish_task(
            task_id,
            state="failed",
            failed=1,
            error=message[-4000:],
            currentStep="Failed",
            completed_at=_price_publish_now(),
        )
    except (OSError, ValueError, json.JSONDecodeError) as error:
        _update_price_publish_task(
            task_id,
            state="failed",
            failed=1,
            error=str(error),
            currentStep="Failed",
            completed_at=_price_publish_now(),
        )
    else:
        _update_price_publish_task(
            task_id,
            state="done",
            failed=0,
            error="",
            result=result,
            currentStep="Done",
            completed=len(result.get("steps") or []),
            completed_at=_price_publish_now(),
            oldVersion=result.get("oldVersion", ""),
            newVersion=result.get("newVersion", ""),
            workerVersionId=result.get("workerVersionId", ""),
        )


def _start_price_publish_task(repo_root: Path, payload: dict) -> dict:
    if not isinstance(payload.get("priceOverrides"), dict):
        raise ValueError("priceOverrides is required")
    active = _active_price_publish_task()
    if active:
        return active
    task_id = uuid.uuid4().hex
    queued_at = _price_publish_now()
    task = {
        "id": task_id,
        "kind": "price-publish",
        "state": "queued",
        "failed": 0,
        "queued_at": queued_at,
        "started_at": None,
        "completed_at": None,
        "updated_at": queued_at,
        "currentStep": "Queued",
        "total": 13,
        "completed": 0,
        "steps": [],
        "error": "",
        "result": None,
        "oldVersion": "",
        "newVersion": "",
        "workerVersionId": "",
    }
    with PRICE_PUBLISH_LOCK:
        PRICE_PUBLISH_TASKS[task_id] = task
    worker = threading.Thread(target=_run_price_publish_task, args=(task_id, repo_root, payload), daemon=True)
    worker.start()
    return copy.deepcopy(task)


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve Photos By Elie locally with owner helper endpoints.")
    parser.add_argument("port", nargs="?", type=int, default=8000)
    parser.add_argument("--bind", default="127.0.0.1", help="Address to bind. Defaults to 127.0.0.1.")
    parser.add_argument("--allow-lan-owner", action="store_true", help="Allow owner helper endpoints from private LAN clients.")
    args = parser.parse_args()
    _bootstrap_local_tool_path()

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


def _bootstrap_local_tool_path() -> None:
    path_parts = os.environ.get("PATH", "").split(os.pathsep)
    for tool_dir in reversed(LOCAL_TOOL_DIRS):
        if tool_dir.is_dir() and str(tool_dir) not in path_parts:
            path_parts.insert(0, str(tool_dir))
    os.environ["PATH"] = os.pathsep.join(part for part in path_parts if part)


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


def _source_paths_from_manifest_rows(repo_root: Path, photo_id: str) -> list[str]:
    return _source_paths_from_manifest_rows_for_ids(repo_root, {photo_id}).get(photo_id, [])


def _source_paths_from_manifest_rows_for_ids(repo_root: Path, photo_ids: set[str]) -> dict[str, list[str]]:
    wanted_ids = {str(photo_id or "").strip() for photo_id in photo_ids if str(photo_id or "").strip()}
    if not wanted_ids:
        return {}
    paths_by_id: dict[str, list[str]] = {photo_id: [] for photo_id in wanted_ids}
    seen_by_id: dict[str, set[str]] = {photo_id: set() for photo_id in wanted_ids}
    tmp_root = repo_root / "tmp"
    if not tmp_root.exists():
        return paths_by_id
    for manifest_path in tmp_root.glob("**/manifest.json"):
        payload = _read_json_file(manifest_path, {})
        rows = payload.get("photos") if isinstance(payload, dict) else None
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            photo_id = str(row.get("id") or "").strip()
            if photo_id not in wanted_ids:
                continue
            for key in (
                "source_path_hint",
                "metadata_path_hint",
                "sourcePath",
                "source_path",
                "sourceFile",
                "source_file",
            ):
                value = str(row.get(key) or "").strip()
                if value and value not in seen_by_id[photo_id]:
                    seen_by_id[photo_id].add(value)
                    paths_by_id[photo_id].append(value)
    return paths_by_id


def _photo_source_paths(repo_root: Path, photo: dict, manifest_source_paths: list[str] | None = None) -> list[str]:
    paths: list[str] = []
    seen: set[str] = set()

    def add(value: object) -> None:
        text = str(value or "").strip()
        if not text or text in seen:
            return
        seen.add(text)
        paths.append(text)

    for source in photo.get("sourceFiles") or []:
        if not isinstance(source, dict):
            continue
        raw_path = str(source.get("path") or "").strip()
        if raw_path:
            for candidate in _source_candidates(repo_root, raw_path):
                if candidate.exists():
                    add(candidate.resolve())
                    break
            add(raw_path)
    photo_id = str(photo.get("id") or "").strip()
    if manifest_source_paths is not None:
        for path in manifest_source_paths:
            add(path)
    elif photo_id:
        for path in _source_paths_from_manifest_rows(repo_root, photo_id):
            add(path)
    return paths


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


def _sqlite_readonly_connect(path: Path) -> sqlite3.Connection:
    uri = f"file:{quote(str(path.resolve()), safe='/')}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _empty_origin_counts() -> dict[str, int]:
    return {"camera": 0, "ai": 0, "unknown": 0}


def _normalize_origin(value: object) -> str:
    origin = str(value or "").strip().lower()
    return origin if origin in {"camera", "ai"} else "unknown"


def _count_origins(photo_ids: set[str], origin_by_id: dict[str, str]) -> dict[str, int]:
    counts = _empty_origin_counts()
    for photo_id in photo_ids:
        counts[_normalize_origin(origin_by_id.get(photo_id))] += 1
    counts["total"] = sum(counts.values())
    return counts


def _public_catalog_origin_by_id(repo_root: Path) -> dict[str, str]:
    catalog_path = repo_root / "assets/catalog/photosbyelie.sqlite"
    if not catalog_path.exists():
        return {}
    conn = _sqlite_readonly_connect(catalog_path)
    try:
        rows = conn.execute(
            """
            SELECT mi.media_id, COALESCE(so.code, '') AS origin
            FROM media_items AS mi
            LEFT JOIN source_origins AS so
              ON so.source_origin_id = mi.source_origin_id
            """
        ).fetchall()
    finally:
        conn.close()
    return {
        str(row["media_id"]): _normalize_origin(row["origin"] or "camera")
        for row in rows
        if row["media_id"]
    }


def _origin_from_manifest_row(row: dict) -> str:
    gallery_country = row.get("gallery_country") or {}
    slug = gallery_country.get("slug") if isinstance(gallery_country, dict) else str(gallery_country or "")
    source_mode = str(row.get("source_mode") or row.get("sourceMode") or "").strip().lower()
    source_text_parts = [
        row.get("relative_path"),
        row.get("source_path_hint"),
        row.get("sourceMode"),
        row.get("source_mode"),
    ]
    source_file = row.get("source_file")
    if isinstance(source_file, dict):
        source_text_parts.extend(source_file.values())
    elif source_file:
        source_text_parts.append(source_file)
    for source in row.get("sourceFiles") or []:
        if isinstance(source, dict):
            source_text_parts.extend(source.values())
    source_text = " ".join(str(part or "") for part in source_text_parts).lower()
    if slug == "ai" or source_mode in {"ai", "leonardo"} or "leonardo" in source_text:
        return "ai"
    return "camera"


def _manifest_origin_by_id(repo_root: Path, existing: dict[str, str]) -> dict[str, str]:
    origins = dict(existing)
    for path in [repo_root / IMPORT_CACHE_MANIFEST_PATH, repo_root / "assets/private-delivery-manifest.json"]:
        payload = _read_json_file(path, {})
        if not isinstance(payload, dict):
            continue
        rows = payload.get("photos")
        if isinstance(rows, list):
            for row in rows:
                if not isinstance(row, dict):
                    continue
                photo_id = str(row.get("id") or "").strip()
                if photo_id and photo_id not in origins:
                    origins[photo_id] = _origin_from_manifest_row(row)
        records = payload.get("records")
        if isinstance(records, dict):
            for photo_id, record in records.items():
                if not isinstance(record, dict):
                    continue
                clean_id = str(photo_id or record.get("id") or "").strip()
                if clean_id and clean_id not in origins:
                    origins[clean_id] = _origin_from_manifest_row(record)
    return origins


def _current_public_preview_ready_ids(repo_root: Path) -> set[str]:
    owner_path = repo_root / OWNER_ACTION_ROOT / "Owner.sqlite"
    if not owner_path.exists():
        return set()
    conn = _sqlite_readonly_connect(owner_path)
    try:
        rows = conn.execute(
            """
            SELECT photo_id,
                   SUM(CASE WHEN object_kind = 'public-preview'
                              AND object_key LIKE '%_900.%' THEN 1 ELSE 0 END) AS low_count,
                   SUM(CASE WHEN object_kind = 'public-preview'
                              AND object_key LIKE '%_1800.%' THEN 1 ELSE 0 END) AS high_count
            FROM r2_objects
            WHERE lifecycle_state = 'current'
              AND object_kind = 'public-preview'
              AND COALESCE(photo_id, '') <> ''
            GROUP BY photo_id
            """
        ).fetchall()
    finally:
        conn.close()
    return {
        str(row["photo_id"])
        for row in rows
        if row["photo_id"] and int(row["low_count"] or 0) > 0 and int(row["high_count"] or 0) > 0
    }


def _title_keyword_state_by_id(repo_root: Path) -> dict[str, str]:
    owner_path = repo_root / OWNER_ACTION_ROOT / "Owner.sqlite"
    if not owner_path.exists():
        return {}
    conn = _sqlite_readonly_connect(owner_path)
    try:
        rows = conn.execute("SELECT media_id, review_state FROM title_keyword_queue").fetchall()
    finally:
        conn.close()
    return {
        str(row["media_id"]): str(row["review_state"] or "")
        for row in rows
        if row["media_id"]
    }


def _owner_hidden_or_discarded_ids(repo_root: Path) -> set[str]:
    return _lifecycle_blocked_ids(repo_root)


def _lifecycle_snapshot(repo_root: Path) -> dict:
    return media_lifecycle_snapshot(repo_root)


def _lifecycle_hidden_ids(repo_root: Path) -> set[str]:
    return set(_lifecycle_snapshot(repo_root).get("hiddenPhotoIds") or [])


def _lifecycle_discarded_ids(repo_root: Path) -> set[str]:
    return set(_lifecycle_snapshot(repo_root).get("discardedPhotoIds") or [])


def _lifecycle_blocked_ids(repo_root: Path) -> set[str]:
    return set(_lifecycle_snapshot(repo_root).get("blockedPhotoIds") or [])


def _assert_no_lifecycle_blocked_public_rows(repo_root: Path) -> None:
    blocked_ids = _lifecycle_blocked_ids(repo_root)
    if not blocked_ids:
        return
    public_ids = set(_public_catalog_origin_by_id(repo_root))
    manifest = _read_json_file(repo_root / EXPO_MANIFEST_PATH, {})
    manifest_ids = {
        str(photo.get("id") or "").strip()
        for photo in (manifest.get("photos") if isinstance(manifest, dict) else []) or []
        if isinstance(photo, dict) and str(photo.get("id") or "").strip()
    }
    public_leaks = sorted(blocked_ids & public_ids)
    manifest_leaks = sorted(blocked_ids & manifest_ids)
    if public_leaks or manifest_leaks:
        parts = []
        if public_leaks:
            parts.append(f"public catalog: {', '.join(public_leaks[:20])}")
        if manifest_leaks:
            parts.append(f"expo manifest: {', '.join(manifest_leaks[:20])}")
        raise ValueError("hidden/discarded media leaked into public artifacts (" + "; ".join(parts) + ")")


def owner_visibility_summary(repo_root: Path) -> dict:
    public_origin_by_id = _public_catalog_origin_by_id(repo_root)
    origin_by_id = _manifest_origin_by_id(repo_root, public_origin_by_id)
    public_ids = set(public_origin_by_id)
    r2_ready_ids = _current_public_preview_ready_ids(repo_root)
    review_state_by_id = _title_keyword_state_by_id(repo_root)
    hidden_or_discarded_ids = _owner_hidden_or_discarded_ids(repo_root)
    blocked_or_parked_ids = {
        photo_id
        for photo_id, state in review_state_by_id.items()
        if state in {"blocked", "parked"}
    } | hidden_or_discarded_ids
    approved_ids = {photo_id for photo_id, state in review_state_by_id.items() if state == "approved"}
    applied_ids = {photo_id for photo_id, state in review_state_by_id.items() if state == "applied"}
    limbo_ids = r2_ready_ids - public_ids - blocked_or_parked_ids - approved_ids - applied_ids
    approved_not_applied_ids = approved_ids - public_ids - blocked_or_parked_ids
    applied_not_public_ids = applied_ids - public_ids - blocked_or_parked_ids
    blocked_ready_ids = r2_ready_ids & blocked_or_parked_ids
    state_counts: dict[str, int] = {}
    for state in review_state_by_id.values():
        state_counts[state] = state_counts.get(state, 0) + 1
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "definitions": {
            "publicApplied": "Rows exported to assets/catalog/photosbyelie.sqlite and visible to end users.",
            "r2ReadyLimbo": "Photos with both public R2 preview objects present, but not public, approved, exported, parked, or blocked.",
            "approvedNotApplied": "Owner-approved rows that have not yet been exported to the public catalog.",
        },
        "publicApplied": {
            "count": len(public_ids),
            "byOrigin": _count_origins(public_ids, origin_by_id),
        },
        "r2Ready": {
            "count": len(r2_ready_ids),
            "byOrigin": _count_origins(r2_ready_ids, origin_by_id),
        },
        "r2ReadyLimbo": {
            "count": len(limbo_ids),
            "byOrigin": _count_origins(limbo_ids, origin_by_id),
        },
        "approvedNotApplied": {
            "count": len(approved_not_applied_ids),
            "byOrigin": _count_origins(approved_not_applied_ids, origin_by_id),
        },
        "appliedNotPublic": {
            "count": len(applied_not_public_ids),
            "byOrigin": _count_origins(applied_not_public_ids, origin_by_id),
        },
        "blockedOrParkedReady": {
            "count": len(blocked_ready_ids),
            "byOrigin": _count_origins(blocked_ready_ids, origin_by_id),
        },
        "reviewStateCounts": dict(sorted(state_counts.items())),
    }


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


def _merged_pending_title_keyword_batches(batches: list[dict]) -> list[dict]:
    merged: dict[str, dict] = {}
    order: list[str] = []
    for batch in batches:
        batch_id = str(batch.get("batch_id") or "").strip()
        if not batch_id:
            continue
        if batch_id not in merged:
            merged[batch_id] = {
                "batch_id": batch_id,
                "pending_count": 0,
                "first_proposed_at": "",
                "last_proposed_at": "",
            }
            order.append(batch_id)
        target = merged[batch_id]
        target["pending_count"] = int(target.get("pending_count") or 0) + int(batch.get("pending_count") or 0)
        first = str(batch.get("first_proposed_at") or "")
        last = str(batch.get("last_proposed_at") or "")
        if first and (not target["first_proposed_at"] or first < target["first_proposed_at"]):
            target["first_proposed_at"] = first
        if last and (not target["last_proposed_at"] or last > target["last_proposed_at"]):
            target["last_proposed_at"] = last
    return [merged[batch_id] for batch_id in order]


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
    lifecycle = _lifecycle_snapshot(repo_root)
    hidden_ids = set(lifecycle.get("hiddenPhotoIds") or [])
    discarded_ids = set(lifecycle.get("discardedPhotoIds") or [])
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
        SELECT q.media_id, q.review_state, q.latest_proposed_batch_id AS batch_id,
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


def _metadata_label_value(row: dict, label: str) -> str:
    target = label.casefold()
    for item in row.get("metadata") or []:
        if isinstance(item, dict) and str(item.get("label") or "").casefold() == target:
            return str(item.get("value") or "").strip()
    return ""


def _manifest_title(row: dict) -> str:
    owner_title = str(row.get("owner_title") or "").strip()
    if owner_title:
        return owner_title
    raw = row.get("raw_metadata") if isinstance(row.get("raw_metadata"), dict) else {}
    for key in ("Title", "ObjectName"):
        value = str(raw.get(key) or "").strip()
        if value:
            return value
    metadata_title = _metadata_label_value(row, "Metadata title")
    if metadata_title:
        return metadata_title
    stem = Path(str(row.get("relative_path") or row.get("id") or "")).stem
    return re.sub(r"[_-]+", " ", stem).strip() or str(row.get("id") or "")


def _manifest_keywords(row: dict) -> list[str]:
    keywords = row.get("keywords")
    if isinstance(keywords, list):
        return _unique_keywords([str(keyword).strip() for keyword in keywords if str(keyword).strip()])
    metadata_keywords = _metadata_label_value(row, "Keywords")
    return _unique_keywords(_split_keyword_text(metadata_keywords))


def _manifest_capture(row: dict) -> str:
    capture = row.get("capture") if isinstance(row.get("capture"), dict) else {}
    return str(capture.get("sort") or capture.get("datetime") or capture.get("raw") or _metadata_label_value(row, "Captured") or "")


def _manifest_gallery(row: dict) -> tuple[str, str]:
    gallery = row.get("gallery_country") if isinstance(row.get("gallery_country"), dict) else {}
    slug = str(gallery.get("slug") or row.get("gallery_key") or "unknown").strip() or "unknown"
    label = str(gallery.get("label") or COLLECTION_KEYWORD_TARGETS.get(slug) or slug or "Photo").strip()
    return slug, label


def _manifest_source_parts(row: dict) -> tuple[str, str, str]:
    source_file = row.get("source_file") if isinstance(row.get("source_file"), dict) else {}
    relative_path = str(row.get("relative_path") or source_file.get("path") or row.get("source_path_hint") or "").strip()
    filename = str(source_file.get("name") or Path(relative_path).name or "").strip()
    source_folder = str(Path(relative_path).parent if relative_path and Path(relative_path).parent.as_posix() != "." else "").strip()
    extension = str(source_file.get("extension") or Path(filename).suffix.lstrip(".") or "").strip().lower()
    if extension == "jpeg":
        extension = "jpg"
    elif extension == "tiff":
        extension = "tif"
    return source_folder, filename, extension


def _manifest_catalog_row(row: dict) -> dict:
    media_id = str(row.get("id") or "").strip()
    slug, label = _manifest_gallery(row)
    source_folder, filename, extension = _manifest_source_parts(row)
    dimensions = row.get("dimensions") if isinstance(row.get("dimensions"), dict) else {}
    source_file = row.get("source_file") if isinstance(row.get("source_file"), dict) else {}
    return {
        "media_id": media_id,
        "title": _manifest_title(row) or media_id,
        "keyword_ids": "",
        "captured_at": _manifest_capture(row),
        "gallery_key": slug,
        "gallery_label": label,
        "filename": filename,
        "source_folder": source_folder,
        "keywords": _manifest_keywords(row),
        "media_type": str(row.get("media_type") or "photo").strip().lower() or "photo",
        "source_extension": extension,
        "full_width": int(dimensions.get("width") or 0),
        "full_height": int(dimensions.get("height") or 0),
        "full_bytes": int(source_file.get("bytes") or 0),
        "full_duration_seconds": float((dimensions.get("duration_seconds") or dimensions.get("duration") or 0) or 0),
        "location": str(row.get("location") or _metadata_label_value(row, "Location") or ""),
    }


def _manifest_rows_by_media_id(repo_root: Path, media_ids: list[str]) -> dict[str, dict]:
    wanted = {str(media_id or "").strip() for media_id in media_ids if str(media_id or "").strip()}
    if not wanted:
        return {}
    payload = _read_json_file(repo_root / IMPORT_CACHE_MANIFEST_PATH, {})
    photos = payload.get("photos") if isinstance(payload, dict) else []
    if not isinstance(photos, list):
        return {}
    rows: dict[str, dict] = {}
    for row in photos:
        if not isinstance(row, dict):
            continue
        media_id = str(row.get("id") or "").strip()
        if media_id not in wanted:
            continue
        rows[media_id] = _manifest_catalog_row(row)
        if len(rows) >= len(wanted):
            break
    return rows


def _catalog_rows_by_media_id(repo_root: Path, media_ids: list[str]) -> dict[str, dict]:
    clean_ids = [str(media_id or "").strip() for media_id in media_ids if str(media_id or "").strip()]
    if not clean_ids:
        return {}
    result: dict[str, dict] = {}
    catalog_path = repo_root / "assets/catalog/photosbyelie.sqlite"
    if catalog_path.exists():
        catalog_conn = sqlite3.connect(catalog_path)
        catalog_conn.row_factory = sqlite3.Row
        try:
            keyword_lookup = _catalog_keyword_lookup(catalog_conn)
            for index in range(0, len(clean_ids), 500):
                chunk = clean_ids[index:index + 500]
                placeholders = ",".join("?" for _ in chunk)
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
                    chunk,
                ).fetchall()
                for row in rows:
                    result[str(row["media_id"])] = {
                        **dict(row),
                        "keywords": _catalog_keywords(row["keyword_ids"], keyword_lookup),
                    }
        finally:
            catalog_conn.close()
    missing = [media_id for media_id in clean_ids if media_id not in result]
    result.update(_manifest_rows_by_media_id(repo_root, missing))
    return result


def _catalog_photo_for_hidden(repo_root: Path, media_id: str) -> tuple[str, dict] | None:
    media_id = str(media_id or "").strip()
    if not media_id:
        return None
    catalog_path = repo_root / "assets/catalog/photosbyelie.sqlite"
    if not catalog_path.exists():
        return None
    catalog_conn = sqlite3.connect(catalog_path)
    catalog_conn.row_factory = sqlite3.Row
    try:
        keyword_lookup = _catalog_keyword_lookup(catalog_conn)
        row = catalog_conn.execute(
            """
            SELECT m.media_id, m.title, m.keyword_ids, m.captured_at,
                   m.exposure, m.focal_length, m.location,
                   c.slug AS gallery_key, c.title AS gallery_label,
                   mt.code AS media_type, sf.filename, folder.source_folder,
                   fmt.extension AS source_extension,
                   full_asset.width AS full_width, full_asset.height AS full_height,
                   full_asset.bytes AS full_bytes,
                   full_asset.duration_seconds AS full_duration_seconds
            FROM media_items AS m
            JOIN collections AS c USING(collection_id)
            JOIN media_types AS mt USING(media_type_id)
            JOIN source_files AS sf USING(source_file_id)
            LEFT JOIN source_folders AS folder
              ON folder.source_folder_id = sf.source_folder_id
            LEFT JOIN formats AS fmt
              ON fmt.format_id = sf.format_id
            LEFT JOIN asset_types AS full_type
              ON full_type.code = 'full'
            LEFT JOIN media_assets AS full_asset
              ON full_asset.media_id = m.media_id
             AND full_asset.asset_type_id = full_type.asset_type_id
            WHERE m.media_id = ?
            """,
            (media_id,),
        ).fetchone()
        if not row:
            return _manifest_photo_for_hidden(repo_root, media_id) or _review_batch_photo_for_hidden(repo_root, media_id)
        slug = str(row["gallery_key"] or "").strip()
        if slug not in ORDER:
            slug = "unknown"
        title = str(row["title"] or media_id).strip() or media_id
        source_folder = str(row["source_folder"] or "").strip("/")
        filename = str(row["filename"] or "").strip()
        source_path = "/".join(part for part in [source_folder, filename] if part)
        extension = str(row["source_extension"] or Path(filename).suffix.lstrip(".") or "").upper()
        if extension == "JPEG":
            extension = "JPG"
        if extension == "TIFF":
            extension = "TIF"
        media_type = str(row["media_type"] or "photo").strip().lower() or "photo"
        full_width = int(row["full_width"] or 0)
        full_height = int(row["full_height"] or 0)
        megapixels = round((full_width * full_height / 1_000_000) * 10) / 10 if full_width and full_height else 0
        keywords = _catalog_keywords(row["keyword_ids"], keyword_lookup)
        captured_at = str(row["captured_at"] or "")
        location = str(row["location"] or "")
        gallery_label = str(row["gallery_label"] or slug or "Gallery")
        metadata = [
            {"label": "Metadata title", "value": title},
            {"label": "Keywords", "value": ", ".join(keywords)},
        ]
        if captured_at:
            metadata.append({"label": "Captured", "value": captured_at.replace("T", " ")})
        if filename:
            metadata.append({"label": "Original file", "value": filename})
        if full_width and full_height:
            metadata.append({"label": "Original size", "value": f"{extension or 'Source'} / {full_width} x {full_height} / {megapixels} MP"})
        if location:
            metadata.append({"label": "Location", "value": location})
        public_preview = {
            "allowed": True,
            "galleryKey": public_preview_key(DEFAULT_PUBLIC_PREFIX, media_id, "gallery", media_type),
            "detailKey": public_preview_key(DEFAULT_PUBLIC_PREFIX, media_id, "detail", media_type),
        }
        photo = {
            "id": media_id,
            "title": title,
            "caption": " / ".join(part for part in [gallery_label, location, captured_at[:10]] if part),
            "full": f"{extension or 'Source'} master",
            "megapixels": megapixels,
            "gallerySrc": "",
            "imageSrc": "",
            "metadata": metadata,
            "media": {
                "type": media_type,
                "sourcePolicy": "developed-master",
                "publicPreview": public_preview,
            },
            "sourceFiles": [
                {
                    "path": source_path,
                    "type": extension or "SOURCE",
                    "bytes": int(row["full_bytes"] or 0),
                }
            ] if source_path else [],
            "keywords": keywords,
        }
        if media_type == "video":
            duration = float(row["full_duration_seconds"] or 0)
            if duration:
                photo["duration"] = duration
                photo["media"]["video"] = {"duration": duration}
        return slug, photo
    finally:
        catalog_conn.close()


def _manifest_photo_for_hidden(repo_root: Path, media_id: str) -> tuple[str, dict] | None:
    row = _manifest_rows_by_media_id(repo_root, [media_id]).get(media_id)
    if not row:
        return None
    slug = str(row.get("gallery_key") or "").strip()
    if slug not in ORDER:
        slug = "unknown"
    title = str(row.get("title") or media_id).strip() or media_id
    source_folder = str(row.get("source_folder") or "").strip("/")
    filename = str(row.get("filename") or "").strip()
    source_path = "/".join(part for part in [source_folder, filename] if part)
    extension = str(row.get("source_extension") or Path(filename).suffix.lstrip(".") or "").upper()
    if extension == "JPEG":
        extension = "JPG"
    if extension == "TIFF":
        extension = "TIF"
    media_type = str(row.get("media_type") or "photo").strip().lower() or "photo"
    full_width = int(row.get("full_width") or 0)
    full_height = int(row.get("full_height") or 0)
    megapixels = round((full_width * full_height / 1_000_000) * 10) / 10 if full_width and full_height else 0
    keywords = row.get("keywords") if isinstance(row.get("keywords"), list) else []
    captured_at = str(row.get("captured_at") or "")
    location = str(row.get("location") or "")
    gallery_label = str(row.get("gallery_label") or slug or "Gallery")
    metadata = [
        {"label": "Metadata title", "value": title},
        {"label": "Keywords", "value": ", ".join(str(keyword) for keyword in keywords)},
    ]
    if captured_at:
        metadata.append({"label": "Captured", "value": captured_at.replace("T", " ")})
    if filename:
        metadata.append({"label": "Original file", "value": filename})
    if full_width and full_height:
        metadata.append({"label": "Original size", "value": f"{extension or 'Source'} / {full_width} x {full_height} / {megapixels} MP"})
    if location:
        metadata.append({"label": "Location", "value": location})
    public_preview = {
        "allowed": True,
        "galleryKey": public_preview_key(DEFAULT_PUBLIC_PREFIX, media_id, "gallery", media_type),
        "detailKey": public_preview_key(DEFAULT_PUBLIC_PREFIX, media_id, "detail", media_type),
    }
    photo = {
        "id": media_id,
        "title": title,
        "caption": " / ".join(part for part in [gallery_label, location, captured_at[:10]] if part),
        "full": f"{extension or 'Source'} master",
        "megapixels": megapixels,
        "gallerySrc": "",
        "imageSrc": "",
        "metadata": metadata,
        "media": {
            "type": media_type,
            "sourcePolicy": "import-manifest",
            "publicPreview": public_preview,
        },
        "sourceFiles": [
            {
                "path": source_path,
                "type": extension or "SOURCE",
                "bytes": int(row.get("full_bytes") or 0),
            }
        ] if source_path else [],
        "keywords": keywords,
    }
    if media_type == "video":
        duration = float(row.get("full_duration_seconds") or 0)
        if duration:
            photo["duration"] = duration
            photo["media"]["video"] = {"duration": duration}
    return slug, photo


def _review_batch_photo_for_hidden(repo_root: Path, media_id: str) -> tuple[str, dict] | None:
    media_id = str(media_id or "").strip()
    if not media_id:
        return None
    queue_root = repo_root / TITLE_KEYWORD_REVIEW_ROOT
    if not queue_root.exists():
        return None
    paths = sorted(queue_root.glob("batch-*.json"), key=lambda path: path.stat().st_mtime, reverse=True)
    for batch_path in paths:
        payload = _read_json_file(batch_path, {})
        photos = payload.get("photos") if isinstance(payload, dict) else []
        if not isinstance(photos, list):
            continue
        for item in photos:
            if not isinstance(item, dict) or _review_photo_id(item) != media_id:
                continue
            gallery = item.get("gallery") if isinstance(item.get("gallery"), dict) else {}
            slug = str(gallery.get("key") or item.get("gallery_key") or "unknown").strip() or "unknown"
            if slug not in ORDER:
                slug = "unknown"
            gallery_label = str(gallery.get("label") or item.get("gallery_label") or slug or "Gallery")
            current = item.get("current") if isinstance(item.get("current"), dict) else {}
            proposed = item.get("proposed") if isinstance(item.get("proposed"), dict) else {}
            title = str(current.get("title") or proposed.get("title") or media_id).strip() or media_id
            capture = item.get("capture") if isinstance(item.get("capture"), dict) else {}
            captured_at = str(capture.get("raw") or capture.get("sort") or capture.get("date") or "")
            keywords = current.get("keywords") if isinstance(current.get("keywords"), list) else _split_keyword_text(current.get("keywords_raw"))
            source = item.get("source") if isinstance(item.get("source"), dict) else {}
            source_file = source.get("file") if isinstance(source.get("file"), dict) else {}
            source_path = str(source_file.get("path") or "").strip()
            source_type = str(source_file.get("type") or Path(source_path).suffix.lstrip(".") or "SOURCE").strip().upper()
            if source_type == "JPEG":
                source_type = "JPG"
            if source_type == "TIFF":
                source_type = "TIF"
            media = item.get("media") if isinstance(item.get("media"), dict) else {}
            media_type = str(media.get("type") or source.get("media_type") or current.get("type") or "photo").strip().lower() or "photo"
            if media_type not in {"photo", "video"} and source_type.lower() in {"mov", "mp4", "m4v"}:
                media_type = "video"
            metadata = [
                {"label": "Metadata title", "value": title},
                {"label": "Keywords", "value": ", ".join(str(keyword) for keyword in keywords)},
            ]
            if captured_at:
                metadata.append({"label": "Captured", "value": captured_at.replace("T", " ")})
            if source_path:
                metadata.append({"label": "Original file", "value": Path(source_path).name})
            public_preview = {
                "allowed": True,
                "galleryKey": public_preview_key(DEFAULT_PUBLIC_PREFIX, media_id, "gallery", media_type),
                "detailKey": public_preview_key(DEFAULT_PUBLIC_PREFIX, media_id, "detail", media_type),
            }
            photo = {
                "id": media_id,
                "title": title,
                "caption": " / ".join(part for part in [gallery_label, captured_at[:10]] if part),
                "full": f"{source_type or 'Source'} master",
                "gallerySrc": "",
                "imageSrc": "",
                "metadata": metadata,
                "media": {
                    "type": media_type,
                    "sourcePolicy": "title-review-batch",
                    "publicPreview": public_preview,
                },
                "sourceFiles": [
                    {
                        "path": source_path,
                        "type": source_type or "SOURCE",
                        "bytes": int(source_file.get("bytes") or 0),
                    }
                ] if source_path else [],
                "keywords": keywords,
            }
            return slug, photo
    return None


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
                "tags": [TITLE_KEYWORD_REVIEW_FLAG] if str(row.get("review_state") or "") == "approved" else [TITLE_KEYWORD_PROPOSED_FLAG],
                "review_state": str(row.get("review_state") or "proposed"),
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


def _title_keyword_backlog_photo(catalog: dict, batch_id: str, review_state: str = "incomplete") -> dict:
    media_id = str(catalog.get("media_id") or "").strip()
    gallery_key = str(catalog.get("gallery_key") or "")
    gallery_label = str(catalog.get("gallery_label") or gallery_key or "Photo")
    captured_at = str(catalog.get("captured_at") or "")
    current_keywords = catalog.get("keywords") if isinstance(catalog.get("keywords"), list) else []
    source_folder = str(catalog.get("source_folder") or "").strip("/")
    filename = str(catalog.get("filename") or "").strip()
    source_path = "/".join(part for part in [source_folder, filename] if part)
    media_type = str(catalog.get("media_type") or "photo").strip().lower() or "photo"
    title = str(catalog.get("title") or media_id).strip() or media_id
    model_ladder = ["metadata-baseline-v1"]
    return {
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
            "gallery_key": public_preview_key(DEFAULT_PUBLIC_PREFIX, media_id, "gallery", media_type),
            "detail_key": public_preview_key(DEFAULT_PUBLIC_PREFIX, media_id, "detail", media_type),
        },
        "source": {
            "file": {
                "path": source_path,
                "type": str(catalog.get("source_extension") or Path(filename).suffix.lstrip(".")).upper(),
            },
            "media_type": media_type,
        },
        "media": {"type": media_type},
        "state": {
            "tags": [],
            "review_state": review_state,
            "rework_requested": False,
            "rework_comment": "",
            "proposal_attempt": 1,
            "requested_generator": {
                "model": "metadata-baseline-v1",
                "model_level": 0,
                "model_maxed": False,
                "model_ladder": model_ladder,
            },
        },
        "current": {
            "title": title,
            "keywords_raw": ", ".join(current_keywords),
            "keywords": current_keywords,
            "type": media_type,
        },
        "proposed": {
            "title": title,
            "keywords": current_keywords,
            "status": "metadata_baseline",
            "confidence": "medium",
            "reason": "Current local metadata is incomplete because it is not yet approved/exported for public visibility.",
            "generator": {
                "model": "metadata-baseline-v1",
                "model_level": 0,
                "model_maxed": False,
                "model_ladder": model_ladder,
            },
        },
        "changes": {
            "removed_blacklisted": [],
            "keyword_target": 10,
            "keyword_target_met": len(current_keywords) >= 10,
        },
    }


def _incomplete_title_keyword_backlog_photos(
    repo_root: Path,
    conn,
    excluded_ids: set[str],
    limit: int = TITLE_KEYWORD_REVIEW_BACKLOG_LIMIT,
) -> tuple[list[dict], int]:
    if limit <= 0:
        return [], 0
    payload = _read_json_file(repo_root / IMPORT_CACHE_MANIFEST_PATH, {})
    photos = payload.get("photos") if isinstance(payload, dict) else []
    if not isinstance(photos, list):
        return [], 0
    queue_states = {
        str(row["media_id"]): str(row["review_state"] or "")
        for row in conn.execute("SELECT media_id, review_state FROM title_keyword_queue")
    }
    blocked_ids = _lifecycle_blocked_ids(repo_root)
    public_ids = set(_public_catalog_origin_by_id(repo_root))
    r2_ready_ids = _current_public_preview_ready_ids(repo_root)
    candidates: list[dict] = []
    for row in photos:
        if not isinstance(row, dict):
            continue
        media_id = str(row.get("id") or "").strip()
        if not media_id or media_id in excluded_ids or media_id in blocked_ids or media_id in public_ids or media_id not in r2_ready_ids:
            continue
        review_state = queue_states.get(media_id, "")
        if review_state in {"applied", "approved", "parked", "blocked", "rejected"}:
            continue
        if not row_import_eligible(row)[0] or not public_preview_allowed(row):
            continue
        candidates.append(row)
    candidates.sort(key=lambda row: (_manifest_capture(row), str(row.get("id") or "")), reverse=True)
    batch_id = "incomplete-backlog"
    return [
        _title_keyword_backlog_photo(_manifest_catalog_row(row), batch_id, queue_states.get(str(row.get("id") or ""), "incomplete") or "incomplete")
        for row in candidates[:limit]
    ], len(candidates)


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
        covered_ids = {_review_photo_id(item) for item in all_photos if isinstance(item, dict)}
        backlog_photos, backlog_total_count = _incomplete_title_keyword_backlog_photos(repo_root, conn, covered_ids)
        if backlog_photos:
            pending_batches = [
                *pending_batches,
                {
                    "batch_id": "incomplete-backlog",
                    "pending_count": backlog_total_count,
                    "first_proposed_at": "",
                    "last_proposed_at": "",
                },
            ]
            all_photos.extend(backlog_photos)
        pending_batches = _merged_pending_title_keyword_batches(pending_batches)
        if all_photos:
            sort_values = [value for value in (_capture_sort_value(item) for item in all_photos) if value]
            batch_ids = [batch["batch_id"] for batch in pending_batches if batch.get("pending_count")]
            total_review_count = len(all_pending_rows) + backlog_total_count
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
                    "total_count": total_review_count,
                    "visible_pending_count": len(all_photos),
                    "sqlite_pending_count": len(all_pending_rows),
                    "incomplete_backlog_count": backlog_total_count,
                    "incomplete_backlog_loaded_count": len(backlog_photos),
                    "incomplete_backlog_limit": TITLE_KEYWORD_REVIEW_BACKLOG_LIMIT,
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
                "incomplete_backlog_count": 0,
                "incomplete_backlog_limit": TITLE_KEYWORD_REVIEW_BACKLOG_LIMIT,
                "stale_blocked_count": stale_cleanup.get("blocked", 0),
                "stale_not_found_count": stale_cleanup.get("not_found", 0),
            },
            "photos": [],
        }
    finally:
        conn.close()


def _search_index_text(values: list[object]) -> str:
    parts: list[str] = []
    seen: set[str] = set()
    for value in values:
        candidates = value if isinstance(value, list) else [value]
        for candidate in candidates:
            text = str(candidate or "").strip()
            if not text:
                continue
            normalized = " ".join(text.casefold().split())
            if not normalized or normalized in seen:
                continue
            parts.append(text)
            seen.add(normalized)
    return " ".join(parts)


def owner_super_search_index(repo_root: Path) -> dict:
    conn = owner_db_connect(repo_root)
    try:
        rows = conn.execute(
            """
            SELECT q.media_id, q.review_state, q.latest_attempt, q.owner_comment,
                   p.previous_title, p.previous_keywords,
                   p.proposed_title, p.proposed_keywords,
                   p.proposal_status, p.proposal_reason,
                   p.removed_blacklisted,
                   d.decision_state, d.decided_title, d.decided_keywords
            FROM title_keyword_queue AS q
            LEFT JOIN title_keyword_proposals AS p
              ON p.media_id = q.media_id
             AND p.attempt = q.latest_attempt
            LEFT JOIN title_keyword_decisions AS d
              ON d.media_id = q.media_id
             AND d.attempt = q.latest_attempt
            ORDER BY q.updated_at DESC, q.media_id
            """
        ).fetchall()
    finally:
        conn.close()

    catalog_rows = _catalog_rows_by_media_id(repo_root, [str(row["media_id"]) for row in rows])
    records: dict[str, dict] = {}
    for row in rows:
        media_id = str(row["media_id"] or "")
        if not media_id:
            continue
        catalog = catalog_rows.get(media_id, {})
        text = _search_index_text([
            media_id,
            row["review_state"],
            row["owner_comment"],
            catalog.get("gallery_key"),
            catalog.get("gallery_label"),
            catalog.get("filename"),
            catalog.get("source_folder"),
            catalog.get("title"),
            catalog.get("keywords") if isinstance(catalog.get("keywords"), list) else [],
            row["previous_title"],
            _split_keyword_text(row["previous_keywords"]),
            row["proposed_title"],
            _split_keyword_text(row["proposed_keywords"]),
            row["proposal_status"],
            row["proposal_reason"],
            row["removed_blacklisted"],
            row["decision_state"],
            row["decided_title"],
            _split_keyword_text(row["decided_keywords"]),
        ])
        records[media_id] = {
            "text": text,
            "reviewState": str(row["review_state"] or ""),
            "decisionState": str(row["decision_state"] or ""),
            "attempt": int(row["latest_attempt"] or 0),
            "catalog": bool(catalog),
        }
    return {
        "ok": True,
        "format": "photosbyelie-owner-super-search-index",
        "schema_version": 1,
        "records": records,
        "count": len(records),
    }


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


def _restore_hidden_photo_to_normal_group(
    expo_groups: dict[str, list[dict]],
    reserve_groups: dict[str, list[dict]],
    hidden_photo: dict,
    photo_id: str,
    target_state: str,
    target_slug: str,
) -> bool:
    target_groups = reserve_groups if target_state == "reserve" else expo_groups
    target_slug = target_slug if target_slug in target_groups else "unknown"
    if _find_photo(target_groups, photo_id):
        return False
    restored = copy_photo(hidden_photo)
    for key in ("hiddenFromState", "hiddenFromSlug", "hiddenAt"):
        restored.pop(key, None)
    owner_state = restored.get("ownerState")
    if isinstance(owner_state, dict):
        for key in ("hiddenFromState", "hiddenFromSlug", "hiddenAt"):
            owner_state.pop(key, None)
        if not owner_state:
            restored.pop("ownerState", None)
    _remove_existing(expo_groups, photo_id)
    _remove_existing(reserve_groups, photo_id)
    target_groups.setdefault(target_slug, []).append(restored)
    return True


def _photo_media_type(photo: dict) -> str:
    return str((photo.get("media") or {}).get("type") or photo.get("type") or "photo").strip().lower() or "photo"


def _hidden_public_preview_keys(photo: dict, slug: str) -> list[str]:
    photo_id = str(photo.get("id") or "")
    if not photo_id:
        return []
    media_type = _photo_media_type(photo)
    keys = [
        public_preview_key(DEFAULT_PUBLIC_PREFIX, photo_id, "gallery", media_type),
        public_preview_key(DEFAULT_PUBLIC_PREFIX, photo_id, "detail", media_type),
    ]
    unique = []
    seen = set()
    for key in keys:
        normalized = key.strip("/")
        if not normalized or normalized in seen:
            continue
        unique.append(normalized)
        seen.add(normalized)
    return unique


def _hidden_blacklist_payload(repo_root: Path, hidden_groups: dict[str, list[dict]]) -> dict:
    photo_ids = []
    public_preview_keys = []
    source_paths = []
    manifest_source_paths = _source_paths_from_manifest_rows_for_ids(
        repo_root,
        {
            str(photo.get("id") or "").strip()
            for photos in hidden_groups.values()
            for photo in photos
            if str(photo.get("id") or "").strip()
        },
    )
    for slug, photos in hidden_groups.items():
        for photo in photos:
            photo_id = photo.get("id")
            if photo_id:
                photo_ids.append(photo_id)
            public_preview_keys.extend(_hidden_public_preview_keys(photo, slug))
            source_paths.extend(_photo_source_paths(repo_root, photo, manifest_source_paths.get(str(photo_id or ""), [])))
    return {
        "format": "photosbyelie-hidden-blacklist",
        "version": 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "photo_ids": sorted(set(photo_ids)),
        "source_paths": sorted(set(source_paths)),
        "public_preview_keys": sorted(set(public_preview_keys)),
    }


def _write_hidden_blacklist(repo_root: Path, hidden_groups: dict[str, list[dict]]) -> Path:
    path = repo_root / HIDDEN_BLACKLIST_PATH
    _write_json_file(path, _hidden_blacklist_payload(repo_root, hidden_groups))
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
    repo_root = Path.cwd()
    entries: list[dict] = []
    photo_ids = {
        str(photo.get("id") or "").strip()
        for photos in hidden_groups.values()
        for photo in photos
        if str(photo.get("id") or "").strip()
    }
    manifest_source_paths = _source_paths_from_manifest_rows_for_ids(repo_root, photo_ids)
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
                    "media_type": _photo_media_type(photo),
                    "asset_paths": _photo_asset_paths(photo),
                    "source_paths": _photo_source_paths(repo_root, photo, manifest_source_paths.get(photo_id, [])),
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
        "source_paths": sorted({
            path
            for path in payload.get("source_paths") or []
            if isinstance(path, str) and path
        }),
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


def _discarded_private_keys(photo: dict) -> list[str]:
    photo_id = str(photo.get("id") or "")
    if not photo_id:
        return []
    keys = []
    media_type = _photo_media_type(photo)
    for source in photo.get("sourceFiles") or []:
        if not isinstance(source, dict):
            continue
        source_name = _source_basename(source)
        if not source_name:
            continue
        keys.append(private_master_key(DEFAULT_PRIVATE_PREFIX, photo_id, source_name))
        if media_type != "video":
            keys.extend(private_render_key(photo_id, product_id) for product_id in PRIVATE_RENDER_PRODUCTS)
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
    source_paths = set(payload.get("source_paths") or [])
    public_preview_keys = set(payload.get("public_preview_keys") or [])
    private_keys = set(payload.get("private_keys") or [])
    for discarded_photo in discarded_photos or []:
        photo_id = str(discarded_photo.get("id") or "")
        if not photo_id:
            continue
        photos_by_id[photo_id] = discarded_photo
        photo_ids.add(photo_id)
        source_paths.update(discarded_photo.get("source_paths") or [])
        public_preview_keys.update(discarded_photo.get("public_preview_keys") or [])
        private_keys.update(discarded_photo.get("private_keys") or [])
    payload["photo_ids"] = sorted(photo_id for photo_id in photo_ids if isinstance(photo_id, str) and photo_id)
    payload["source_paths"] = sorted(path for path in source_paths if isinstance(path, str) and path)
    payload["public_preview_keys"] = sorted(key for key in public_preview_keys if isinstance(key, str) and key)
    payload["private_keys"] = sorted(key for key in private_keys if isinstance(key, str) and key)
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    payload["photos"] = sorted(photos_by_id.values(), key=lambda photo: str(photo.get("id") or ""))
    _write_json_file(repo_root / DISCARDED_TOMBSTONE_PATH, payload)
    return payload


def _write_discarded_tombstone(repo_root: Path, discarded_photo: dict | None = None) -> dict:
    return _write_discarded_tombstones(repo_root, [discarded_photo] if discarded_photo else [])


def _hidden_lifecycle_entry(
    repo_root: Path,
    photo: dict,
    photo_id: str,
    source_state: str,
    source_slug: str,
    hidden_at: str,
    manifest_source_paths: list[str] | None = None,
) -> dict:
    return {
        "id": photo_id,
        "title": photo.get("title") or photo_id,
        "hidden_at": hidden_at,
        "from_state": source_state,
        "from_slug": source_slug,
        "source_slug": source_slug,
        "media_type": _photo_media_type(photo),
        "asset_paths": _photo_asset_paths(photo),
        "source_paths": _photo_source_paths(repo_root, photo, manifest_source_paths),
        "public_preview_keys": _hidden_public_preview_keys(photo, source_slug),
    }


def _record_hidden_lifecycle(repo_root: Path, entries: list[dict]) -> dict:
    return record_media_lifecycle_hidden_db(repo_root, entries) if entries else {"hidden": 0}


def _record_discarded_lifecycle(repo_root: Path, entries: list[dict]) -> dict:
    return record_media_lifecycle_discarded_db(repo_root, entries) if entries else {"discarded": 0}


def _record_active_lifecycle(repo_root: Path, photo_ids: list[str]) -> dict:
    return record_media_lifecycle_active_db(repo_root, photo_ids) if photo_ids else {"active": 0}


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
    discarded_ids = _lifecycle_discarded_ids(repo_root)
    hidden_ids = (
        {photo.get("id") for photos in hidden_groups.values() for photo in photos if photo.get("id")}
        | _lifecycle_hidden_ids(repo_root)
    )
    blocked_ids = discarded_ids | hidden_ids
    expo_groups = _groups_without_photo_ids(expo_groups, blocked_ids)
    reserve_groups = _groups_without_photo_ids(reserve_groups, blocked_ids)
    hidden_groups = _groups_without_photo_ids(hidden_groups, discarded_ids)
    hidden_ids = {photo.get("id") for photos in hidden_groups.values() for photo in photos if photo.get("id")}
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
    write_photos_data_from_site(repo_root, expo_groups, reserve_groups)
    _assert_no_lifecycle_blocked_public_rows(repo_root)
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


REJECTED_PROPOSAL_COMMENT_MARKER = "Rejected proposal:"


def _strip_rejected_proposal_comment_context(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    marker = f"\n\n{REJECTED_PROPOSAL_COMMENT_MARKER}".casefold()
    index = text.casefold().find(marker)
    return (text[:index] if index >= 0 else text).strip()


def _rejection_comment_with_proposal_context(comment: object, title: object, keywords: object) -> str:
    owner_comment = _strip_rejected_proposal_comment_context(comment)
    if not owner_comment:
        return ""
    clean_title = str(title or "").strip()
    clean_keywords = _unique_keywords(_split_keyword_text(keywords))
    if not clean_title and not clean_keywords:
        return owner_comment
    return "\n".join([
        owner_comment,
        "",
        REJECTED_PROPOSAL_COMMENT_MARKER,
        f"Title: {clean_title or '(blank)'}",
        f"Keywords: {', '.join(clean_keywords) if clean_keywords else '(none)'}",
    ])


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
    suffixes: list[str] = []

    def add_suffix(value: str) -> None:
        if value not in suffixes:
            suffixes.append(value)

    add_suffix(candidate.suffix)
    if candidate.suffix:
        add_suffix(candidate.suffix.lower())
        add_suffix(candidate.suffix.upper())
    if candidate.suffix.lower() in {".jpg", ".jpeg", ".jpe"}:
        for suffix in (".jpg", ".jpeg", ".JPG", ".JPEG"):
            add_suffix(suffix)
    for suffix in suffixes:
        _append_unique_path(variants, candidate.with_suffix(suffix))
    return variants


def _source_candidates(repo_root: Path, source_path: str) -> list[Path]:
    raw = Path(source_path)
    bases = [raw] if raw.is_absolute() else [repo_root / raw, *(root / raw for root in SOURCE_ROOT_CANDIDATES)]
    if not raw.is_absolute() and raw.parts:
        match = re.match(r"^(\d{4})(?:\D|$)", raw.parts[0])
        if match:
            year = match.group(1)
            bases.extend(root / year / raw for root in SOURCE_ROOT_CANDIDATES)
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
    raw_paths: list[str] = []
    seen_raw: set[str] = set()

    def add_raw_path(value: object) -> None:
        text = str(value or "").strip()
        if text and text not in seen_raw:
            seen_raw.add(text)
            raw_paths.append(text)

    for source in photo.get("sourceFiles") or []:
        raw_path = source.get("path")
        if not raw_path:
            continue
        add_raw_path(raw_path)
    source_raw_count = len(raw_paths)

    def append_existing_paths(values: list[str]) -> None:
        for raw_path in values:
            for candidate in _source_candidates(repo_root, raw_path):
                if candidate.exists():
                    _append_unique_path(paths, candidate)

    append_existing_paths(raw_paths)
    if paths:
        return paths

    photo_id = str(photo.get("id") or "").strip()
    if photo_id:
        for raw_path in _source_paths_from_manifest_rows(repo_root, photo_id):
            add_raw_path(raw_path)
    append_existing_paths(raw_paths[source_raw_count:])
    if paths:
        return paths

    for raw_path in raw_paths:
        names = {variant.name.lower() for variant in _source_path_variants(Path(raw_path))}
        for root in RECURSIVE_SOURCE_ROOT_CANDIDATES:
            found = _find_source_by_basename(root, names)
            if found:
                _append_unique_path(paths, found)
                break
    return paths


def _source_preview_error(
    status: HTTPStatus,
    media_id: str,
    media_type: str,
    source_type: str,
    source_label: str,
    error: str,
) -> dict:
    return {
        "ok": False,
        "status": int(status),
        "mediaId": media_id,
        "mediaType": media_type or "photo",
        "sourceType": source_type or "source/full",
        "sourceLabel": source_label or media_id,
        "error": error,
    }


def _source_preview_photo_from_catalog(repo_root: Path, media_id: str) -> dict | None:
    found = _catalog_photo_for_hidden(repo_root, media_id)
    if found:
        return found[1]
    row = _catalog_rows_by_media_id(repo_root, [media_id]).get(media_id)
    if not row:
        return None
    source_folder = str(row.get("source_folder") or "").strip("/")
    filename = str(row.get("filename") or "").strip()
    source_path = "/".join(part for part in [source_folder, filename] if part)
    extension = str(row.get("source_extension") or Path(filename).suffix.lstrip(".") or "").strip().lower()
    if extension == "jpeg":
        extension = "jpg"
    if extension == "tiff":
        extension = "tif"
    media_type = str(row.get("media_type") or "").strip().lower()
    if not media_type:
        media_type = "video" if f".{extension}" in SOURCE_PREVIEW_BROWSER_VIDEO_EXTENSIONS else "photo"
    return {
        "id": media_id,
        "title": str(row.get("title") or media_id).strip() or media_id,
        "media": {"type": media_type},
        "sourceFiles": [
            {
                "path": source_path,
                "type": (extension or Path(filename).suffix.lstrip(".") or "source").upper(),
                "bytes": int(row.get("full_bytes") or 0),
            }
        ] if source_path else [],
    }


def _source_preview_cache_path(source: Path) -> Path:
    stat = source.stat()
    digest = hashlib.sha256(
        f"{source.resolve()}:{stat.st_size}:{stat.st_mtime_ns}".encode("utf-8")
    ).hexdigest()[:20]
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", source.stem).strip("-._") or "source"
    return SOURCE_PREVIEW_CACHE_ROOT / f"{stem}-{digest}.jpg"


def _source_original_for_media_id(repo_root: Path, media_id: str) -> dict:
    clean_id = str(media_id or "").strip()
    if not clean_id:
        raise ValueError("missing media id")
    photo = _source_preview_photo_from_catalog(repo_root, clean_id)
    if not photo:
        raise ValueError("No catalog or manifest source metadata was found for this media id.")
    source_files = photo.get("sourceFiles") if isinstance(photo.get("sourceFiles"), list) else []
    source_label = str(source_files[0].get("path") if source_files and isinstance(source_files[0], dict) else clean_id)
    paths = _source_paths(repo_root, photo)
    if not paths:
        raise ValueError(f"No local source file could be resolved for {source_label}.")
    source = paths[0]
    if not source.exists():
        raise ValueError(f"Resolved source file does not exist: {source}")
    media_type = str(photo.get("media", {}).get("type") or photo.get("type") or "photo").strip().lower() or "photo"
    return {
        "mediaId": clean_id,
        "mediaType": media_type,
        "sourceLabel": source_label,
        "path": source,
    }


def _pixelmator_edit_folder(repo_root: Path) -> Path:
    folder = (repo_root / PIXELMATOR_EDIT_FOLDER).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _safe_edit_stem(value: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-._")
    return stem or "pixelmator-edit"


def _normalized_edit_stem(value: str) -> str:
    stem = Path(str(value or "")).stem.lower().strip()
    stem = re.sub(r"\.photosbyelie-edit$", "", stem)
    stem = re.sub(r"\s+", " ", stem)
    return stem


def _pixelmator_edit_output_path(repo_root: Path, media_id: str, source: Path) -> Path:
    source_suffix = source.suffix.lower()
    if source_suffix not in {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp", ".heic"}:
        source_suffix = ".jpeg"
    stem = _safe_edit_stem(Path(source.name).stem or media_id)
    return _pixelmator_edit_folder(repo_root) / f"{stem}.photosbyelie-edit{source_suffix}"


def _pixelmator_edit_files(repo_root: Path) -> list[dict]:
    folder = _pixelmator_edit_folder(repo_root)
    files: list[dict] = []
    for path in folder.iterdir():
        if not path.is_file() or path.suffix.lower() not in PIXELMATOR_EDIT_EXTENSIONS:
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        files.append({
            "name": path.name,
            "path": str(path),
            "folder": str(folder),
            "bytes": stat.st_size,
            "modified": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
            "modifiedMs": int(stat.st_mtime * 1000),
        })
    files.sort(key=lambda item: (int(item.get("modifiedMs") or 0), str(item.get("name") or "")), reverse=True)
    return files


def _pixelmator_import_folder(repo_root: Path) -> Path:
    folder = (repo_root / PIXELMATOR_IMPORTED_EDIT_FOLDER).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _pixelmator_imports_path(repo_root: Path) -> Path:
    path = repo_root / PIXELMATOR_EDIT_IMPORTS_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _pixelmator_source_match_stems(photo: dict, media_id: str) -> set[str]:
    stems: set[str] = set()

    def add(value: object) -> None:
        text = str(value or "").strip()
        if not text:
            return
        stem = _normalized_edit_stem(text)
        if stem:
            stems.add(stem)

    for source in photo.get("sourceFiles") or []:
        if isinstance(source, dict):
            add(source.get("path"))
            add(source.get("label"))
    for metadata in photo.get("metadata") or []:
        if isinstance(metadata, dict) and str(metadata.get("label") or "").strip().lower() in {"original file", "source file"}:
            add(metadata.get("value"))
    add(photo.get("title"))
    add(media_id)
    return stems


def _pixelmator_known_media_stem_index(repo_root: Path) -> dict[str, list[str]]:
    index: dict[str, list[str]] = {}

    def add(stem_source: object, media_id: object) -> None:
        media_text = str(media_id or "").strip()
        if not media_text:
            return
        stem = _normalized_edit_stem(str(stem_source or ""))
        if not stem:
            return
        bucket = index.setdefault(stem, [])
        if media_text not in bucket:
            bucket.append(media_text)

    catalog_path = repo_root / "assets/catalog/photosbyelie.sqlite"
    if catalog_path.exists():
        conn = sqlite3.connect(catalog_path)
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                """
                SELECT m.media_id, m.title, sf.filename, folder.source_folder
                FROM media_items AS m
                JOIN source_files AS sf USING(source_file_id)
                LEFT JOIN source_folders AS folder
                  ON folder.source_folder_id = sf.source_folder_id
                """
            ).fetchall()
            for row in rows:
                media_id = row["media_id"]
                source_folder = str(row["source_folder"] or "").strip("/")
                filename = str(row["filename"] or "").strip()
                source_path = "/".join(part for part in [source_folder, filename] if part)
                add(filename, media_id)
                add(source_path, media_id)
                add(row["title"], media_id)
                add(media_id, media_id)
        finally:
            conn.close()

    payload = _read_json_file(repo_root / IMPORT_CACHE_MANIFEST_PATH, {})
    photos = payload.get("photos") if isinstance(payload, dict) else []
    if isinstance(photos, list):
        for row in photos:
            if not isinstance(row, dict):
                continue
            media_id = str(row.get("id") or "").strip()
            if not media_id:
                continue
            catalog_row = _manifest_catalog_row(row)
            source_folder = str(catalog_row.get("source_folder") or "").strip("/")
            filename = str(catalog_row.get("filename") or "").strip()
            source_path = "/".join(part for part in [source_folder, filename] if part)
            add(filename, media_id)
            add(source_path, media_id)
            add(catalog_row.get("title"), media_id)
            add(media_id, media_id)
            for metadata in row.get("metadata") or []:
                if isinstance(metadata, dict) and str(metadata.get("label") or "").strip().lower() in {"original file", "source file"}:
                    add(metadata.get("value"), media_id)
    return index


def _matching_pixelmator_edit(repo_root: Path, media_id: str, edit_name: str = "") -> tuple[dict, dict]:
    clean_id = str(media_id or "").strip()
    if not clean_id:
        raise ValueError("missing media id")
    photo = _source_preview_photo_from_catalog(repo_root, clean_id)
    if not photo:
        raise ValueError("No catalog or manifest source metadata was found for this media id.")
    stems = _pixelmator_source_match_stems(photo, clean_id)
    if not stems:
        raise ValueError("No source filename is available for this media item.")
    files = _pixelmator_edit_files(repo_root)
    if edit_name:
        files = [file for file in files if str(file.get("name") or "") == edit_name]
    for file in files:
        if _normalized_edit_stem(str(file.get("name") or "")) in stems:
            return photo, file
    raise ValueError("No matching Pixelmator export was found for this media item.")


def _read_pixelmator_imports(repo_root: Path) -> dict:
    path = _pixelmator_imports_path(repo_root)
    payload = _read_json_file(path, {})
    return payload if isinstance(payload, dict) else {}


def _pixelmator_import_already_recorded(repo_root: Path, media_id: str, edit: dict) -> bool:
    media_text = str(media_id or "").strip()
    edit_path = str(edit.get("path") or "").strip()
    edit_bytes = int(edit.get("bytes") or 0)
    if not media_text or not edit_path:
        return False
    payload = _read_pixelmator_imports(repo_root)
    imports = payload.get("imports") if isinstance(payload.get("imports"), list) else []
    for record in imports:
        if not isinstance(record, dict):
            continue
        if str(record.get("media_id") or "") != media_text:
            continue
        if str(record.get("edit_path") or "") != edit_path:
            continue
        if edit_bytes and int(record.get("edit_bytes") or record.get("bytes") or 0) == edit_bytes:
            return True
    return False


def _write_pixelmator_imports(repo_root: Path, payload: dict) -> None:
    path = _pixelmator_imports_path(repo_root)
    tmp_path = path.with_suffix(f".{uuid.uuid4().hex}.tmp")
    tmp_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp_path.replace(path)


def _import_pixelmator_edit(repo_root: Path, media_id: str, edit_name: str = "") -> dict:
    clean_id = str(media_id or "").strip()
    photo, edit = _matching_pixelmator_edit(repo_root, clean_id, edit_name)
    edit_path = Path(str(edit.get("path") or "")).resolve()
    edit_folder = _pixelmator_edit_folder(repo_root).resolve()
    if not _path_is_relative_to(edit_path, edit_folder):
        raise ValueError("Pixelmator export is outside the watched edit folder.")
    if not edit_path.exists() or not edit_path.is_file():
        raise ValueError("Pixelmator export no longer exists.")
    imported_folder = _pixelmator_import_folder(repo_root)
    safe_stem = _safe_edit_stem(Path(edit_path.name).stem)
    imported_name = f"{clean_id}__{safe_stem}{edit_path.suffix.lower()}"
    imported_path = imported_folder / imported_name
    counter = 2
    while imported_path.exists():
        imported_path = imported_folder / f"{clean_id}__{safe_stem}-{counter}{edit_path.suffix.lower()}"
        counter += 1
    shutil.copy2(edit_path, imported_path)
    imported_stat = imported_path.stat()
    source_files = photo.get("sourceFiles") if isinstance(photo.get("sourceFiles"), list) else []
    source_label = str(source_files[0].get("path") if source_files and isinstance(source_files[0], dict) else clean_id)
    imported_at = datetime.now(timezone.utc).isoformat()
    record = {
        "media_id": clean_id,
        "title": str(photo.get("title") or clean_id),
        "source_path": source_label,
        "edit_name": edit_path.name,
        "edit_path": str(edit_path),
        "edit_bytes": int(edit.get("bytes") or edit_path.stat().st_size),
        "edit_modified_ms": int(edit.get("modifiedMs") or 0),
        "imported_path": str(imported_path),
        "bytes": imported_stat.st_size,
        "imported_at": imported_at,
    }
    payload = _read_pixelmator_imports(repo_root)
    imports = payload.get("imports") if isinstance(payload.get("imports"), list) else []
    imports.append(record)
    payload.update({
        "updated_at": imported_at,
        "imported_folder": str(imported_folder),
        "imports": imports,
    })
    _write_pixelmator_imports(repo_root, payload)
    return {
        "ok": True,
        "media_id": clean_id,
        "edit": edit,
        "imported": record,
        "message": "Edited version imported locally. It is ready for the next catalog publish step.",
    }


def _import_all_pixelmator_edits(repo_root: Path) -> dict:
    files = _pixelmator_edit_files(repo_root)
    index = _pixelmator_known_media_stem_index(repo_root)
    imported: list[dict] = []
    skipped: list[dict] = []
    for edit in files:
        edit_name = str(edit.get("name") or "").strip()
        stem = _normalized_edit_stem(edit_name)
        media_ids = index.get(stem) or []
        if not media_ids:
            skipped.append({"edit_name": edit_name, "reason": "no matching media source"})
            continue
        if len(media_ids) > 1:
            skipped.append({"edit_name": edit_name, "reason": "ambiguous media source", "media_ids": media_ids})
            continue
        media_id = media_ids[0]
        if _pixelmator_import_already_recorded(repo_root, media_id, edit):
            skipped.append({"edit_name": edit_name, "media_id": media_id, "reason": "already imported"})
            continue
        try:
            result = _import_pixelmator_edit(repo_root, media_id, edit_name)
            imported.append(result.get("imported") or {"media_id": media_id, "edit_name": edit_name})
        except ValueError as error:
            skipped.append({"edit_name": edit_name, "media_id": media_id, "reason": str(error)})
    return {
        "ok": True,
        "count": len(files),
        "imported_count": len(imported),
        "skipped_count": len(skipped),
        "imported": imported,
        "skipped": skipped,
        "message": f"Imported {len(imported)} Pixelmator edit{'s' if len(imported) != 1 else ''}; skipped {len(skipped)}.",
    }


def _generated_source_image_preview(repo_root: Path, source: Path) -> Path:
    cache_path = repo_root / _source_preview_cache_path(source)
    if cache_path.exists() and cache_path.stat().st_size > 0:
        return cache_path
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = cache_path.with_suffix(f".{uuid.uuid4().hex}.tmp.jpg")
    try:
        subprocess.run(
            ["sips", "-s", "format", "jpeg", str(source), "--out", str(tmp_path)],
            check=True,
            capture_output=True,
            text=True,
        )
        if not tmp_path.exists() or tmp_path.stat().st_size <= 0:
            raise RuntimeError("sips did not produce a JPEG preview")
        tmp_path.replace(cache_path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
    return cache_path


def _source_preview_for_media_id(repo_root: Path, media_id: str) -> dict:
    clean_id = str(media_id or "").strip()
    if not clean_id:
        return _source_preview_error(HTTPStatus.BAD_REQUEST, clean_id, "photo", "source/full", "", "missing media id")
    photo = _source_preview_photo_from_catalog(repo_root, clean_id)
    if not photo:
        return _source_preview_error(
            HTTPStatus.NOT_FOUND,
            clean_id,
            "photo",
            "source/full",
            clean_id,
            "No catalog or manifest source metadata was found for this media id.",
        )
    media_type = str(photo.get("media", {}).get("type") or photo.get("type") or "photo").strip().lower() or "photo"
    source_files = photo.get("sourceFiles") if isinstance(photo.get("sourceFiles"), list) else []
    source_label = str(source_files[0].get("path") if source_files and isinstance(source_files[0], dict) else clean_id)
    source_type = str(source_files[0].get("type") if source_files and isinstance(source_files[0], dict) else "source/full")
    paths = _source_paths(repo_root, photo)
    if not paths:
        return _source_preview_error(
            HTTPStatus.NOT_FOUND,
            clean_id,
            media_type,
            source_type,
            source_label,
            "No local source file could be resolved from catalog or manifest metadata.",
        )
    source = paths[0]
    suffix = source.suffix.lower()
    if media_type == "video":
        if suffix not in SOURCE_PREVIEW_BROWSER_VIDEO_EXTENSIONS:
            return _source_preview_error(
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                clean_id,
                media_type,
                source_type,
                str(source),
                f"Original video format {suffix or '(unknown)'} is not browser-displayable here.",
            )
        return {
            "ok": True,
            "mediaId": clean_id,
            "mediaType": "video",
            "sourceType": source_type or "source video",
            "sourceLabel": str(source),
            "path": str(source),
            "contentType": mimetypes.guess_type(source.name)[0] or "video/mp4",
            "isOriginal": True,
        }
    if suffix in SOURCE_PREVIEW_BROWSER_IMAGE_EXTENSIONS:
        return {
            "ok": True,
            "mediaId": clean_id,
            "mediaType": "photo",
            "sourceType": source_type or "source image",
            "sourceLabel": str(source),
            "path": str(source),
            "contentType": mimetypes.guess_type(source.name)[0] or "image/jpeg",
            "isOriginal": True,
        }
    if suffix in SOURCE_PREVIEW_GENERATABLE_IMAGE_EXTENSIONS:
        try:
            generated = _generated_source_image_preview(repo_root, source)
        except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
            return _source_preview_error(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                clean_id,
                "photo",
                source_type,
                str(source),
                f"Could not generate full-size JPEG source preview: {error}",
            )
        return {
            "ok": True,
            "mediaId": clean_id,
            "mediaType": "photo",
            "sourceType": f"{source_type or 'source image'} converted to full-size JPEG",
            "sourceLabel": str(source),
            "path": str(generated),
            "contentType": "image/jpeg",
            "isOriginal": False,
        }
    return _source_preview_error(
        HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
        clean_id,
        "photo",
        source_type,
        str(source),
        f"Source image format {suffix or '(unknown)'} is not browser-displayable and cannot be converted by this helper.",
    )


def _source_edit_media_type(repo_root: Path, media_id: str, requested_type: str = "") -> str:
    normalized = str(requested_type or "").strip().lower()
    if normalized in {"photo", "image"}:
        return "photo"
    if normalized in {"video", "movie"}:
        return "video"
    clean_id = str(media_id or "").strip()
    if clean_id:
        try:
            source = _source_original_for_media_id(repo_root, clean_id)
            media_type = str(source.get("mediaType") or "").strip().lower()
            if media_type == "video":
                return "video"
        except ValueError:
            photo = _source_preview_photo_from_catalog(repo_root, clean_id)
            media_type = str(photo.get("media", {}).get("type") if photo else "").strip().lower()
            if media_type == "video":
                return "video"
    return "photo"


def _source_edit_app_score(app: dict, media_type: str, matched_count: int) -> int:
    text = f"{app.get('name', '')} {app.get('bundleId', '')} {app.get('path', '')}".casefold()
    photo_order = [
        "photomator",
        "pixelmator",
        "photoshop",
        "lightroom",
        "affinity photo",
        "capture one",
        "darkroom",
        "gimp",
        "preview",
        "photos",
    ]
    video_order = [
        "final cut",
        "davinci resolve",
        "premiere",
        "imovie",
        "quicktime player",
        "vlc",
        "screenflow",
    ]
    preferred = video_order if media_type == "video" else photo_order
    score = matched_count * 20
    for index, needle in enumerate(preferred):
        if needle in text:
            score += 1000 - index * 40
            break
    if "/applications/" in text:
        score += 12
    if "/system/applications/" in text:
        score += 6
    return score


def _launch_services_app_records() -> list[dict]:
    now = time.monotonic()
    cached_apps = SOURCE_EDIT_APP_CACHE.get("apps")
    if cached_apps and now < float(SOURCE_EDIT_APP_CACHE.get("expires_at") or 0):
        return list(cached_apps)  # type: ignore[arg-type]
    lsregister = Path("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister")
    if not lsregister.exists():
        SOURCE_EDIT_APP_CACHE.update({"expires_at": now + 60, "apps": []})
        return []
    try:
        output = subprocess.run(
            [str(lsregister), "-dump"],
            check=True,
            capture_output=True,
            text=True,
            timeout=12,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        SOURCE_EDIT_APP_CACHE.update({"expires_at": now + 60, "apps": []})
        return []
    apps: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for block in output.split("\n--------------------------------------------------------------------------------\n"):
        if "kLSBundleClassApplication" not in block or "\npath:" not in block:
            continue
        path_match = re.search(r"^path:\s+(.+?\.app)\s+\(", block, re.MULTILINE)
        if not path_match:
            continue
        path = path_match.group(1).strip()
        if not path.startswith(("/Applications/", "/System/Applications/", "/System/Library/CoreServices/")):
            continue
        display_match = re.search(r"^displayName:\s+(.+)$", block, re.MULTILINE)
        name_match = re.search(r"^name:\s+(.+)$", block, re.MULTILINE)
        bundle_match = re.search(r"^identifier:\s+(.+)$", block, re.MULTILINE)
        claimed_match = re.search(r"^claimed UTIs:\s+(.+)$", block, re.MULTILINE)
        name = (display_match or name_match).group(1).strip() if (display_match or name_match) else Path(path).stem
        bundle_id = bundle_match.group(1).strip() if bundle_match else ""
        claimed_uti_text = claimed_match.group(1).strip().lower() if claimed_match else ""
        if not claimed_uti_text:
            continue
        hidden_text = f"{name} {bundle_id} {path}".casefold()
        if any(skip in hidden_text for skip in (" helper", " setup", "installer", "uninstaller", "remote monitor", "control panels")):
            continue
        key = (bundle_id, path)
        if key in seen:
            continue
        seen.add(key)
        apps.append({
            "name": name,
            "bundleId": bundle_id,
            "path": path,
            "claimedUTIs": sorted(set(re.split(r"[\s,]+", claimed_uti_text)) - {""}),
        })
    SOURCE_EDIT_APP_CACHE.update({"expires_at": now + 300, "apps": apps})
    return apps


def _source_edit_apps_for_media_type(media_type: str) -> list[dict]:
    normalized = "video" if str(media_type or "").lower() == "video" else "photo"
    targets = SOURCE_EDIT_VIDEO_UTIS if normalized == "video" else SOURCE_EDIT_PHOTO_UTIS
    matched: list[tuple[int, dict]] = []
    for app in _launch_services_app_records():
        claimed = {str(uti).strip().lower() for uti in app.get("claimedUTIs", [])}
        overlap = claimed & targets
        if not overlap:
            continue
        public_image_match = normalized == "photo" and "public.image" in claimed
        public_video_match = normalized == "video" and (
            "public.movie" in claimed
            or "public.video" in claimed
            or "public.audiovisual-content" in claimed
        )
        if public_image_match:
            overlap.add("public.image")
        if public_video_match:
            overlap.add("public.movie")
        score = _source_edit_app_score(app, normalized, len(overlap))
        matched.append((score, {
            "name": app["name"],
            "bundleId": app.get("bundleId", ""),
            "path": app["path"],
            "matchedTypes": sorted(overlap),
        }))
    matched.sort(key=lambda item: (-item[0], item[1]["name"].casefold()))
    deduped: list[dict] = []
    seen_names: set[str] = set()
    for _, app in matched:
        name_key = str(app["name"]).casefold()
        if name_key in seen_names:
            continue
        seen_names.add(name_key)
        deduped.append(app)
        if len(deduped) >= 14:
            break
    return deduped


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


def _record_r2_task_item_result(
    task_id: str,
    item: UploadItem,
    operation: str,
    ok: bool,
    output: str,
    lifecycle_source: str,
) -> bool:
    with R2_BACKGROUND_LOCK:
        task = R2_BACKGROUND_TASKS.get(task_id)
        if not task:
            return False
        task["completed"] = int(task.get("completed") or 0) + 1
        if ok:
            if operation == "upload" and item.path.exists():
                task["bytes_done"] = int(task.get("bytes_done") or 0) + item.path.stat().st_size
                _record_r2_item_lifecycle(item, "current", lifecycle_source)
            elif operation == "delete":
                _record_r2_item_lifecycle(item, "deleted_confirmed", lifecycle_source)
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
    return True


def _finish_r2_task(task_id: str) -> None:
    with R2_BACKGROUND_LOCK:
        task = R2_BACKGROUND_TASKS.get(task_id)
        if not task:
            return
        task["state"] = "failed" if int(task.get("failed") or 0) else "done"
        task["completed_at"] = datetime.now(timezone.utc).isoformat()
        task["updated_at"] = task["completed_at"]


def _run_r2_s3_delete_task(task_id: str, items: list[UploadItem], s3_config: dict[str, str]) -> None:
    _update_r2_task(task_id, backend="s3-batch")
    for item in items:
        _record_r2_item_lifecycle(item, "marked_for_delete", "owner-r2-delete-batch")
    for batch in item_batches_by_bucket(items):
        try:
            results = s3_delete_objects(
                batch,
                retries=2,
                throttle_file=DEFAULT_THROTTLE_FILE,
                request_min_interval=0.75,
                retry_max_delay=900,
                account_id=s3_config["account_id"],
                access_key_id=s3_config["access_key_id"],
                secret_access_key=s3_config["secret_access_key"],
                endpoint=s3_config.get("endpoint") or "",
            )
        except Exception as error:  # noqa: BLE001 - background progress should capture any delete failure.
            results = [(item, False, str(error)) for item in batch]
        for item, ok, output in results:
            if not _record_r2_task_item_result(task_id, item, "delete", ok, output, "owner-r2-delete-batch"):
                return
    _finish_r2_task(task_id)


def _run_r2_prepare(task_id: str, prepare: Callable[[], None] | None) -> None:
    if not prepare:
        return
    try:
        prepare()
        _update_r2_task(task_id, local_prepared=True)
    except Exception as error:  # noqa: BLE001 - keep R2 deletion moving even if local artifact refresh needs attention.
        _update_r2_task(task_id, local_prepared=False, local_prepare_error=str(error))


def _run_r2_task(task_id: str, items: list[UploadItem], operation: str, prepare: Callable[[], None] | None = None) -> None:
    s3_config = s3_config_from_env() if operation == "delete" else {}
    if operation == "delete" and s3_config_complete(s3_config):
        _update_r2_task(task_id, state="running", started_at=datetime.now(timezone.utc).isoformat())
        _run_r2_prepare(task_id, prepare)
        _run_r2_s3_delete_task(task_id, items, s3_config)
        return
    _update_r2_task(
        task_id,
        state="running",
        started_at=datetime.now(timezone.utc).isoformat(),
        backend="wrangler",
    )
    _run_r2_prepare(task_id, prepare)
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
        lifecycle_source = "owner-r2-delete" if operation == "delete" else "owner-r2-upload"
        if not _record_r2_task_item_result(task_id, item, operation, ok, output, lifecycle_source):
            return
    _finish_r2_task(task_id)


def _start_r2_task(
    photo_id: str,
    items: list[UploadItem],
    kind: str,
    operation: str = "upload",
    prepare: Callable[[], None] | None = None,
) -> dict | None:
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
        "local_prepared": None,
        "local_prepare_error": "",
    }
    with R2_BACKGROUND_LOCK:
        R2_BACKGROUND_TASKS[task_id] = task
    worker = threading.Thread(target=_run_r2_task, args=(task_id, items, operation, prepare), daemon=True)
    worker.start()
    return dict(task)


def _start_r2_upload_task(photo_id: str, items: list[UploadItem], kind: str = "metadata-upload") -> dict | None:
    return _start_r2_task(photo_id, items, kind, "upload")


def _start_r2_delete_task(
    photo_id: str,
    items: list[UploadItem],
    kind: str = "hidden-public-wipe",
    prepare: Callable[[], None] | None = None,
) -> dict | None:
    return _start_r2_task(photo_id, items, kind, "delete", prepare)


def _active_r2_work_task() -> dict | None:
    active_states = {"queued", "running"}
    with R2_BACKGROUND_LOCK:
        return next(
            (
                dict(task)
                for task in R2_BACKGROUND_TASKS.values()
                if task.get("operation") in {"repair", "gap-fill", "maintenance"}
                and task.get("state") in active_states
            ),
            None,
        )


def _maintenance_phase_scope(maintenance_key: str) -> list[str]:
    task = R2_MAINTENANCE_TASKS[maintenance_key]
    return [phase_key for phase_key, _label, _command in task["phases"]]


def _run_r2_maintenance_task(task_id: str, repo_root: Path, maintenance_key: str, log_path: Path) -> None:
    definition = R2_MAINTENANCE_TASKS[maintenance_key]
    phases = definition["phases"]
    started_at = datetime.now(timezone.utc).isoformat()
    first_phase = phases[0][0] if phases else ""
    _update_r2_task(task_id, state="running", started_at=started_at, currentPhaseKey=first_phase)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    completed = 0
    return_code = 0
    errors: list[str] = []
    with log_path.open("ab") as log:
        for phase_key, phase_label, command in phases:
            _update_r2_task(task_id, currentPhaseKey=phase_key)
            log.write(f"SWEEP_PHASE {phase_key} {phase_label}\n".encode("utf-8"))
            log.flush()
            process = subprocess.run(command, cwd=repo_root, stdout=log, stderr=subprocess.STDOUT)
            return_code = process.returncode
            if process.returncode != 0:
                errors.append(f"{phase_label} exited {process.returncode}")
                break
            completed += 1
            log.write(f"SWEEP_DONE {phase_key}\n".encode("utf-8"))
            log.flush()
            _update_r2_task(task_id, completed=completed)
    failed = return_code != 0
    completed_at = datetime.now(timezone.utc).isoformat()
    with R2_BACKGROUND_LOCK:
        task = R2_BACKGROUND_TASKS.get(task_id)
        if not task:
            return
        task["completed"] = completed
        task["state"] = "failed" if failed else "done"
        task["failed"] = 1 if failed else 0
        task["return_code"] = return_code
        task["errors"] = errors
        task["completed_at"] = completed_at
        task["updated_at"] = completed_at


def _start_r2_maintenance_task(repo_root: Path, maintenance_key: str) -> dict:
    external = _external_cloud_media_sweep_task(repo_root)
    if external:
        return external
    existing = _active_r2_work_task()
    if existing:
        return existing
    definition = R2_MAINTENANCE_TASKS[maintenance_key]
    phase_scope = _maintenance_phase_scope(maintenance_key)
    task_id = uuid.uuid4().hex
    queued_at = datetime.now(timezone.utc).isoformat()
    log_path = repo_root / ".review-logs" / f"owner-r2-maintenance-{maintenance_key}-{task_id}.log"
    commands = [" ".join(command) for _phase_key, _label, command in definition["phases"]]
    task = {
        "id": task_id,
        "kind": f"r2-maintenance-{maintenance_key}",
        "operation": "maintenance",
        "maintenanceKey": maintenance_key,
        "label": definition["label"],
        "photo_id": "catalog",
        "state": "queued",
        "queued_at": queued_at,
        "started_at": None,
        "completed_at": None,
        "updated_at": queued_at,
        "total": len(phase_scope),
        "completed": 0,
        "failed": 0,
        "bytes_total": 0,
        "bytes_done": 0,
        "currentPhaseKey": phase_scope[0] if phase_scope else "",
        "phaseScopeKeys": phase_scope,
        "items": [{"command": command, "log": str(log_path)} for command in commands],
        "errors": [],
        "log": str(log_path),
    }
    with R2_BACKGROUND_LOCK:
        R2_BACKGROUND_TASKS[task_id] = task
    worker = threading.Thread(target=_run_r2_maintenance_task, args=(task_id, repo_root, maintenance_key, log_path), daemon=True)
    worker.start()
    return dict(task)


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
    try:
        roots.extend(Path(entry["path"]) for entry in _read_import_source_setting(Path.cwd()) if entry.get("path"))
    except sqlite3.Error:
        pass
    manifest = _read_json_file(Path.cwd() / "tmp/import-cache/manifest.json", {})
    if isinstance(manifest, dict) and manifest.get("source_root_hint"):
        roots.append(Path(str(manifest["source_root_hint"])))
    with R2_BACKGROUND_LOCK:
        for task in R2_BACKGROUND_TASKS.values():
            source_root = task.get("sourceRoot")
            if source_root:
                roots.append(Path(str(source_root)))
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
            -_iso_to_timestamp(str(task.get("updated_at") or task.get("queued_at") or "")),
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


def _normalize_import_source_root(value: object) -> Path | None:
    if value is None:
        return None
    source = str(value or "").strip()
    if not source:
        return None
    path = Path(source).expanduser().resolve()
    if not path.is_dir():
        raise ValueError(f"import source folder not found: {path}")
    return path


def _normalize_import_select(value: object) -> str:
    mode = str(value or "auto").strip().lower()
    if mode not in {"auto", "all", "lightroom", "green"}:
        raise ValueError("sourceSelect must be auto, all, green, or lightroom")
    return mode


def _normalize_r2_maintenance_task(value: object) -> str:
    key = str(value or "").strip()
    if not key:
        return ""
    if key not in R2_MAINTENANCE_TASKS:
        raise ValueError(f"unsupported R2 maintenance task: {key}")
    return key


def _import_source_label(path: Path) -> str:
    name = path.name or str(path)
    parent = path.parent.name
    return f"{name} ({parent})" if parent else name


def _import_source_entry(path: Path, *, last_used_at: str = "", use_count: int = 0, discovered: bool = False) -> dict:
    try:
        resolved = path.expanduser().resolve()
    except OSError:
        resolved = path.expanduser()
    return {
        "path": str(resolved),
        "label": _import_source_label(resolved),
        "lastUsedAt": str(last_used_at or ""),
        "useCount": max(0, int(use_count or 0)),
        "exists": resolved.is_dir(),
        "discovered": bool(discovered),
    }


def _path_is_relative_to(path: Path, root: Path) -> bool:
    try:
        resolved_path = path.expanduser().resolve()
        resolved_root = root.expanduser().resolve()
    except OSError:
        resolved_path = path.expanduser()
        resolved_root = root.expanduser()
    return resolved_path == resolved_root or resolved_root in resolved_path.parents


def _is_real_estate_import_source(path: Path) -> bool:
    return _path_is_relative_to(path, REAL_ESTATE_SOURCE_ROOT)


def _read_import_source_setting(repo_root: Path, setting_key: str = IMPORT_SOURCE_SETTINGS_KEY) -> list[dict]:
    conn = owner_db_connect(repo_root)
    try:
        row = conn.execute(
            "SELECT setting_value FROM owner_settings WHERE setting_key = ?",
            (setting_key,),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return []
    try:
        payload = json.loads(row["setting_value"] or "[]")
    except json.JSONDecodeError:
        return []
    if not isinstance(payload, list):
        return []
    entries: list[dict] = []
    for item in payload:
        if isinstance(item, str):
            path = item
            last_used_at = ""
            use_count = 0
        elif isinstance(item, dict):
            path = str(item.get("path") or "")
            last_used_at = str(item.get("lastUsedAt") or "")
            use_count = int(item.get("useCount") or 0)
        else:
            continue
        path = path.strip()
        if not path:
            continue
        if setting_key == IMPORT_SOURCE_SETTINGS_KEY and not last_used_at and use_count <= 0:
            continue
        entries.append(_import_source_entry(Path(path), last_used_at=last_used_at, use_count=use_count))
    return entries


def _write_import_source_setting(repo_root: Path, entries: list[dict], setting_key: str = IMPORT_SOURCE_SETTINGS_KEY) -> None:
    now = datetime.now(timezone.utc).isoformat()
    payload = [
        {
            "path": entry["path"],
            "label": entry.get("label") or _import_source_label(Path(entry["path"])),
            "lastUsedAt": entry.get("lastUsedAt") or "",
            "useCount": int(entry.get("useCount") or 0),
            "rememberedBy": "owner",
        }
        for entry in entries[:IMPORT_SOURCE_HISTORY_LIMIT]
        if entry.get("path")
    ]
    conn = owner_db_connect(repo_root)
    try:
        conn.execute(
            """
            INSERT INTO owner_settings (setting_key, setting_value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(setting_key) DO UPDATE SET
              setting_value = excluded.setting_value,
              updated_at = excluded.updated_at
            """,
            (setting_key, json.dumps(payload, ensure_ascii=True), now),
        )
        conn.commit()
    finally:
        conn.close()


def _discover_import_sources_from_logs(repo_root: Path) -> list[dict]:
    log_root = repo_root / ".review-logs"
    try:
        logs = sorted(log_root.glob("owner-r2-fix-*.log"), key=lambda path: path.stat().st_mtime, reverse=True)[:25]
    except OSError:
        return []
    entries: dict[str, dict] = {}
    for log_path in logs:
        try:
            lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for line in lines:
            if "PBE_IMPORT_PHOTO " not in line or '"sourcePath"' not in line:
                continue
            _, _, raw_payload = line.partition("PBE_IMPORT_PHOTO ")
            try:
                payload = json.loads(raw_payload)
            except json.JSONDecodeError:
                continue
            source_path = str(payload.get("sourcePath") or "").strip()
            if not source_path:
                continue
            parent = Path(source_path).expanduser().parent
            if not str(parent):
                continue
            entry = _import_source_entry(parent, discovered=True)
            entries.setdefault(entry["path"], entry)
    return list(entries.values())


def _import_source_history(repo_root: Path) -> list[dict]:
    merged: dict[str, dict] = {}
    for entry in _read_import_source_setting(repo_root):
        if _is_real_estate_import_source(Path(entry["path"])):
            continue
        existing = merged.get(entry["path"], {})
        merged[entry["path"]] = {**existing, **entry, "discovered": False}
    entries = list(merged.values())
    recent = sorted(
        (entry for entry in entries if entry.get("lastUsedAt")),
        key=lambda entry: str(entry.get("lastUsedAt") or ""),
        reverse=True,
    )
    discovered = sorted(
        (entry for entry in entries if not entry.get("lastUsedAt")),
        key=lambda entry: str(entry.get("label") or entry.get("path") or "").casefold(),
    )
    return [*recent, *discovered][:IMPORT_SOURCE_HISTORY_LIMIT]


def _remember_import_source_root(repo_root: Path, source_root: Path) -> None:
    entry = _import_source_entry(source_root, last_used_at=datetime.now(timezone.utc).isoformat(), use_count=1)
    entries = [item for item in _read_import_source_setting(repo_root) if item.get("path") != entry["path"]]
    previous = next((item for item in _read_import_source_setting(repo_root) if item.get("path") == entry["path"]), None)
    if previous:
        entry["useCount"] = int(previous.get("useCount") or 0) + 1
    _write_import_source_setting(repo_root, [entry, *entries])


def _real_estate_import_source_history(repo_root: Path) -> list[dict]:
    merged: dict[str, dict] = {}
    try:
        saved_sources = _read_import_source_setting(repo_root, REAL_ESTATE_IMPORT_SOURCE_SETTINGS_KEY)
    except sqlite3.Error:
        saved_sources = []
    for entry in saved_sources:
        merged[entry["path"]] = entry
    try:
        state = _read_real_estate_client_payload(repo_root)
    except Exception:
        state = {}
    for client in state.get("clients") or []:
        if not isinstance(client, dict):
            continue
        source_root = str(client.get("sourceRoot") or "").strip()
        if not source_root:
            continue
        path = Path(source_root)
        entry = _import_source_entry(path, discovered=True)
        client_name = str(client.get("customer") or client.get("id") or "").strip()
        if client_name:
            entry["label"] = f"{client_name}: {entry['label']}"
        existing = merged.get(entry["path"], {})
        merged[entry["path"]] = {**entry, **existing, "discovered": bool(existing.get("discovered") or entry.get("discovered"))}
    entries = list(merged.values())
    recent = sorted(
        (entry for entry in entries if entry.get("lastUsedAt")),
        key=lambda entry: str(entry.get("lastUsedAt") or ""),
        reverse=True,
    )
    discovered = sorted(
        (entry for entry in entries if not entry.get("lastUsedAt")),
        key=lambda entry: str(entry.get("label") or entry.get("path") or "").casefold(),
    )
    return [*recent, *discovered][:IMPORT_SOURCE_HISTORY_LIMIT]


def _remember_real_estate_import_source_root(repo_root: Path, source_root: Path) -> None:
    entry = _import_source_entry(source_root, last_used_at=datetime.now(timezone.utc).isoformat(), use_count=1)
    entries = [item for item in _real_estate_import_source_history(repo_root) if item.get("path") != entry["path"]]
    previous = next((
        item
        for item in _read_import_source_setting(repo_root, REAL_ESTATE_IMPORT_SOURCE_SETTINGS_KEY)
        if item.get("path") == entry["path"]
    ), None)
    if previous:
        entry["useCount"] = int(previous.get("useCount") or 0) + 1
    _write_import_source_setting(repo_root, [entry, *entries], REAL_ESTATE_IMPORT_SOURCE_SETTINGS_KEY)


def _select_import_folder() -> Path | None:
    osascript = shutil.which("osascript")
    if not osascript:
        raise OSError("macOS folder selection is unavailable: osascript was not found")
    result = subprocess.run(
        [
            osascript,
            "-e",
            'POSIX path of (choose folder with prompt "Select the Photos By Elie import folder")',
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        message = (result.stderr or result.stdout or "").strip()
        if "User canceled" in message or "-128" in message:
            return None
        raise OSError(message or f"folder selection failed with exit code {result.returncode}")
    selected = result.stdout.strip()
    if not selected:
        return None
    path = Path(selected).expanduser().resolve()
    if not path.is_dir():
        raise OSError(f"selected import folder is not readable: {path}")
    return path


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


def _private_render_photo_id(key: str) -> str:
    match = re.fullmatch(r"renders/([A-Za-z0-9._-]+)_6mp\.jpg", str(key or "").strip())
    return match.group(1) if match else ""


def _is_safe_private_render_key(repo_root: Path, key: str) -> bool:
    clean_key = str(key or "").strip().lstrip("/")
    photo_id = _private_render_photo_id(clean_key)
    if not photo_id:
        return False
    manifest = _read_json_file(repo_root / "assets/private-delivery-manifest.json", {})
    records = manifest.get("records") if isinstance(manifest, dict) else {}
    record = records.get(photo_id) if isinstance(records, dict) else None
    renders = record.get("privateRenders") if isinstance(record, dict) and isinstance(record.get("privateRenders"), dict) else {}
    render = renders.get("jpg-6mp") if isinstance(renders, dict) else None
    if not isinstance(render, dict):
        return False
    expected_keys = set(_r2_record_keys(render))
    expected_keys.add(private_render_key(photo_id, "jpg-6mp"))
    if clean_key not in expected_keys:
        return False
    private_bucket = str(manifest.get("privateBucket") or DEFAULT_PRIVATE_BUCKET) if isinstance(manifest, dict) else DEFAULT_PRIVATE_BUCKET
    if render.get("present") is True or render.get("targetPresent") is True:
        return True
    return _r2_key_known_current(_owner_db_current_r2_keys(repo_root), private_bucket, clean_key)


def _cached_private_media_path(repo_root: Path, bucket: str, key: str) -> Path:
    cache_root = repo_root / ".review-logs" / "private-media-cache"
    cache_root.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(f"{bucket}/{key}".encode("utf-8")).hexdigest()[:16]
    cache_path = cache_root / f"{digest}-{Path(key).name}"
    if cache_path.exists() and cache_path.stat().st_size > 0:
        return cache_path
    tmp_path = cache_path.with_name(f"{cache_path.name}.{uuid.uuid4().hex}.tmp")
    command = [
        "npx",
        "wrangler",
        "r2",
        "object",
        "get",
        f"{bucket}/{key}",
        "--remote",
        "--file",
        str(tmp_path),
    ]
    try:
        result = subprocess.run(command, cwd=repo_root, capture_output=True, text=True, timeout=90)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise
    if result.returncode != 0:
        tmp_path.unlink(missing_ok=True)
        output = (result.stderr or result.stdout or "Could not fetch private media.").strip()
        raise RuntimeError(output)
    if not tmp_path.exists() or tmp_path.stat().st_size <= 0:
        tmp_path.unlink(missing_ok=True)
        raise RuntimeError("Fetched private media was empty.")
    tmp_path.replace(cache_path)
    return cache_path


def _r2_record_keys(payload: object) -> list[str]:
    if not isinstance(payload, dict):
        return []
    keys: list[str] = []
    for field in ("key", "expectedKey", "legacyKey", "galleryKey", "detailKey"):
        value = payload.get(field)
        if isinstance(value, str) and value.strip():
            keys.append(value.strip())
    for field in ("keys", "expectedKeys", "legacyKeys"):
        values = payload.get(field)
        if isinstance(values, list):
            keys.extend(str(value).strip() for value in values if str(value or "").strip())
    return sorted(set(keys))


def _record_private_master_keys(record: dict) -> list[str]:
    return _r2_record_keys(record.get("privateMaster"))


def _record_private_render_keys(record: dict, product_id: str) -> list[str]:
    renders = record.get("privateRenders") if isinstance(record.get("privateRenders"), dict) else {}
    return _r2_record_keys(renders.get(product_id))


def _record_public_preview_keys(photo_id: str, record: dict) -> list[str]:
    media_type = str(record.get("mediaType") or "photo")
    collection_key = str(record.get("collectionKey") or "").strip("/")
    keys = [
        public_preview_key(DEFAULT_PUBLIC_PREFIX, photo_id, "gallery", media_type),
        public_preview_key(DEFAULT_PUBLIC_PREFIX, photo_id, "detail", media_type),
    ]
    if collection_key:
        keys.append(f"{DEFAULT_PUBLIC_PREFIX}/{collection_key}/{photo_id}_900.jpg")
        detail_suffix = "_short_5s_720p.mp4" if media_type.lower() == "video" else "_1800.jpg"
        keys.append(f"{DEFAULT_PUBLIC_PREFIX}/{collection_key}/{photo_id}{detail_suffix}")
    previews = record.get("publicPreviews") if isinstance(record.get("publicPreviews"), dict) else {}
    keys.extend(_r2_record_keys(previews))
    return sorted({key.strip("/") for key in keys if str(key or "").strip("/")})


def _record_has_current_key(current_keys: set[str], bucket: str, keys: list[str]) -> bool:
    return any(_r2_key_known_current(current_keys, bucket, key) for key in keys)


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
    lifecycle = _lifecycle_snapshot(repo_root)
    hidden_photo_ids = set(lifecycle.get("hiddenPhotoIds") or [])
    discarded_photo_ids = set(lifecycle.get("discardedPhotoIds") or [])
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
    if owner_current_r2_keys:
        blocked_present = {
            "master": sum(
                1
                for _photo_id, record in blocked_records
                if _record_has_current_key(owner_current_r2_keys, private_bucket, _record_private_master_keys(record))
            ),
            "public": sum(
                1
                for photo_id, record in blocked_records
                if _record_has_current_key(owner_current_r2_keys, public_bucket, _record_public_preview_keys(photo_id, record))
            ),
            **{
                product: sum(
                    1
                    for _photo_id, record in blocked_records
                    if _record_has_current_key(owner_current_r2_keys, private_bucket, _record_private_render_keys(record, product))
                )
                for product in ("jpg-6mp", "jpg-3mp", "jpg-1mp")
            },
        }
    else:
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


def _cloud_media_sweep_command(source_root: Path | None, source_select: str, skip_phases: list[str]) -> list[str]:
    command = ["zsh", "scripts/run_cloud_media_sweep.zsh", "--push"]
    if source_root:
        command.extend(["--source-root", str(source_root), "--source-select", source_select])
    for phase_key in skip_phases:
        command.extend(["--skip-phase", phase_key])
    return command


def _effective_import_select(source_root: Path | None, source_select: str) -> str:
    if source_select != "auto":
        return source_select
    if not source_root:
        return "auto"
    return import_select_for_source_root(source_root)


def _run_cloud_media_sweep_task(
    task_id: str,
    repo_root: Path,
    log_path: Path,
    skip_phases: list[str],
    source_root: Path | None,
    source_select: str,
) -> None:
    current_phase = "selected-folder" if source_root else None
    _update_r2_task(
        task_id,
        state="running",
        started_at=datetime.now(timezone.utc).isoformat(),
        **({"currentPhaseKey": current_phase} if current_phase else {}),
    )
    log_path.parent.mkdir(parents=True, exist_ok=True)
    command = _cloud_media_sweep_command(source_root, source_select, skip_phases)
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


def _start_cloud_media_sweep(
    repo_root: Path,
    skip_phases: list[str] | None = None,
    *,
    source_root: Path | None = None,
    source_select: str = "all",
) -> dict:
    external = _external_cloud_media_sweep_task(repo_root)
    if external:
        return external
    skip_phases = list(skip_phases or [])
    existing = _active_r2_work_task()
    if existing:
        return existing
    task_id = uuid.uuid4().hex
    queued_at = datetime.now(timezone.utc).isoformat()
    log_path = repo_root / ".review-logs" / f"owner-r2-fix-{task_id}.log"
    command = _cloud_media_sweep_command(source_root, source_select, skip_phases)
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
        "sourceRoot": str(source_root) if source_root else "",
        "sourceSelect": _effective_import_select(source_root, source_select),
        "currentPhaseKey": "selected-folder" if source_root else None,
        "phaseScopeKeys": (
            ["prepare", "import-cache", "selected-folder", "catalog", "eligibility", "worker", "sidecar", "gap-fill", "storage", "test", "validate", "commit"]
            if source_root
            else ["prepare", "discard-start", "import-cache", "camera", "apple-photo-albums", "leonardo", "catalog", "eligibility", "worker", "sidecar", "gap-fill", "discard-final", "storage", "test", "validate", "commit"]
        ),
        "items": [{"command": " ".join(command), "log": str(log_path)}],
        "errors": [],
        "log": str(log_path),
    }
    with R2_BACKGROUND_LOCK:
        R2_BACKGROUND_TASKS[task_id] = task
    worker = threading.Thread(
        target=_run_cloud_media_sweep_task,
        args=(task_id, repo_root, log_path, skip_phases, source_root, source_select),
        daemon=True,
    )
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
    existing = _active_r2_work_task()
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
    source_root = str(incoming.get("sourceRoot") or existing.get("sourceRoot") or convention["sourceRoot"]).strip()
    return {
        **existing,
        "id": client_id,
        "customer": customer,
        "email": email,
        "username": convention["username"],
        "accessCode": access_code,
        "accessCodeSalt": str(existing.get("accessCodeSalt") or incoming.get("accessCodeSalt") or uuid.uuid4().hex),
        "sourceRoot": source_root or convention["sourceRoot"],
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
    source_root_override = _normalize_import_source_root(payload.get("sourceRoot"))
    if source_root_override:
        client["sourceRoot"] = str(source_root_override)
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
        sourceRoot=str(source_root),
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
    _remember_real_estate_import_source_root(repo_root, source_root)
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
        "queue-title-keyword-review",
        "queue-title-keyword-review-many",
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
        "queue-title-keyword-review-many",
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
    if action == "queue-title-keyword-review-many":
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
            rejected_title = str(item.get("title") or "").strip()
            rejected_keywords = _review_keywords(repo_root, item.get("keywords"))
            normalized_rejections.append(
                {
                    "photo_id": current_photo_id,
                    "batch_id": _review_item_batch_id(item, batch_id),
                    "rejected": True,
                    "title": rejected_title,
                    "keywords": rejected_keywords,
                    "comment": _rejection_comment_with_proposal_context(
                        item.get("comment"),
                        rejected_title,
                        rejected_keywords,
                    ),
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

    if action == "queue-title-keyword-review":
        queue_result = queue_title_keyword_review_photo_db(
            repo_root,
            photo_id,
            requested_by=str(payload.get("requested_by") or "owner"),
            source=str(payload.get("source") or "owner-gallery-r"),
            context=payload.get("context") if isinstance(payload.get("context"), dict) else {},
        )
        return {
            "ok": True,
            "action": action,
            **queue_result,
            "review_url": "./owner-review.html?view=title-keywords",
        }

    if action == "queue-title-keyword-review-many":
        photo_ids = _normalized_photo_ids(payload.get("photo_ids"))
        queue_result = queue_title_keyword_review_photos_db(
            repo_root,
            photo_ids,
            requested_by=str(payload.get("requested_by") or "owner"),
            source=str(payload.get("source") or "owner-gallery-review-all-visible"),
            context=payload.get("context") if isinstance(payload.get("context"), dict) else {},
        )
        return {
            "ok": True,
            "action": action,
            **queue_result,
            "review_url": "./owner-review.html?view=title-keywords",
        }

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
        lifecycle_result = _record_discarded_lifecycle(repo_root, discard_entries)
        delete_items = _waste_basket_delete_items(repo_root, hidden_groups)
        cleared_hidden_groups = {slug: [] for slug in ORDER}

        def prepare_waste_basket_media_wipe() -> None:
            _write_state(repo_root, expo_groups, reserve_groups, cleared_hidden_groups)

        r2_task = _start_r2_delete_task(
            "waste-basket-cloud-media",
            delete_items,
            "waste-basket-media-wipe",
            prepare=prepare_waste_basket_media_wipe,
        )
        if r2_task is None:
            threading.Thread(target=prepare_waste_basket_media_wipe, daemon=True).start()
        return {
            "ok": True,
            "action": action,
            "hidden_count": 0,
            "hidden_count_before": hidden_count_before,
            "moved_to_tombstones_count": len(discard_entries),
            "discarded_count": len(tombstone.get("photo_ids") or []),
            "lifecycle": lifecycle_result,
            "hidden_ids": [],
            "r2_delete_task": r2_task,
        }

    if action == "hide-many":
        photo_ids = _normalized_photo_ids(payload.get("photo_ids"))
        hidden_at = datetime.now(timezone.utc).isoformat()
        moved = []
        lifecycle_entries = []
        already_hidden = []
        not_found = []
        manifest_source_paths = _source_paths_from_manifest_rows_for_ids(repo_root, set(photo_ids))
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
                fallback = _catalog_photo_for_hidden(repo_root, current_photo_id)
                if not fallback:
                    not_found.append(current_photo_id)
                    continue
                source_slug, source_photo = fallback
                source_state = "expo"
            else:
                source_slug, source_photo = found
            hidden_photo = _hidden_review_photo(source_photo, source_slug, source_state, hidden_at)
            _remove_existing(expo_groups, current_photo_id)
            _remove_existing(reserve_groups, current_photo_id)
            _remove_existing(hidden_groups, current_photo_id)
            hidden_groups[source_slug].append(hidden_photo)
            lifecycle_entries.append(
                _hidden_lifecycle_entry(
                    repo_root,
                    source_photo,
                    current_photo_id,
                    source_state,
                    source_slug,
                    hidden_at,
                    manifest_source_paths.get(current_photo_id, []),
                )
            )
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
        lifecycle_result = _record_hidden_lifecycle(repo_root, lifecycle_entries)
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
            "lifecycle": lifecycle_result,
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
            rejected_title = str(item.get("title") or "").strip()
            rejected_keywords = _review_keywords(repo_root, item.get("keywords"))
            normalized_rejections.append(
                {
                    "photo_id": current_photo_id,
                    "batch_id": _review_item_batch_id(item, batch_id),
                    "rejected": True,
                    "title": rejected_title,
                    "keywords": rejected_keywords,
                    "comment": _rejection_comment_with_proposal_context(
                        item.get("comment"),
                        rejected_title,
                        rejected_keywords,
                    ),
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
            if photo_id in _lifecycle_discarded_ids(repo_root):
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
            "media_type": _photo_media_type(source_photo),
            "asset_paths": source_assets,
            "source_paths": _photo_source_paths(repo_root, source_photo),
            "public_preview_keys": public_preview_keys,
            "private_keys": private_keys,
        }
        tombstone = _write_discarded_tombstone(repo_root, tombstone_entry)
        lifecycle_result = _record_discarded_lifecycle(repo_root, [tombstone_entry])
        site_state, worker_catalog = _write_catalog_state(repo_root, expo_groups, reserve_groups, hidden_groups)
        r2_task = _start_r2_delete_task(photo_id, _discarded_delete_items(repo_root, source_photo, original_slug), "discarded-media-wipe")
        return {
            "ok": True,
            "action": action,
            "photo_id": photo_id,
            "moved": {"from": source_state, "from_slug": source_slug, "to": "discarded", "to_slug": original_slug},
            "discarded_count": len(tombstone.get("photo_ids") or []),
            "lifecycle": lifecycle_result,
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
                hidden_slug, hidden_photo = hidden_hit
                lifecycle_result = _record_hidden_lifecycle(
                    repo_root,
                    [
                        _hidden_lifecycle_entry(
                            repo_root,
                            hidden_photo,
                            photo_id,
                            str(hidden_photo.get("hiddenFromState") or "expo"),
                            str(hidden_photo.get("hiddenFromSlug") or hidden_slug),
                            str(hidden_photo.get("hiddenAt") or datetime.now(timezone.utc).isoformat()),
                        )
                    ],
                )
                site_state = _write_state(repo_root, expo_groups, reserve_groups, hidden_groups)
                r2_task = _start_r2_upload_task("hidden-blacklist", [_hidden_blacklist_upload_item(repo_root)], "hidden-blacklist-upload")
                return {
                    "ok": True,
                    "action": action,
                    "photo_id": photo_id,
                    "message": "already hidden",
                    "lifecycle": lifecycle_result,
                    "r2_blacklist_task": r2_task,
                    "site": site_state,
                }
            fallback = _catalog_photo_for_hidden(repo_root, photo_id)
            if not fallback:
                raise ValueError(f"photo not found in Expo, Reserve, or SQLite catalog: {photo_id}")
            source_slug, source_photo = fallback
            source_state = "expo"
        else:
            source_slug, source_photo = found
        hidden_at = datetime.now(timezone.utc).isoformat()
        hidden_photo = _hidden_review_photo(source_photo, source_slug, source_state, hidden_at)
        _remove_existing(expo_groups, photo_id)
        _remove_existing(reserve_groups, photo_id)
        _remove_existing(hidden_groups, photo_id)
        hidden_groups[source_slug].append(hidden_photo)
        lifecycle_result = _record_hidden_lifecycle(
            repo_root,
            [_hidden_lifecycle_entry(repo_root, source_photo, photo_id, source_state, source_slug, hidden_at)],
        )
        moved = {"from": source_state, "from_slug": source_slug, "to": "hidden", "to_slug": source_slug, "mode": "blacklist"}

    elif action == "undo-hide":
        found = _find_and_remove(hidden_groups, photo_id)
        if not found:
            raise ValueError(f"photo not found in Hidden: {photo_id}")
        hidden_slug, hidden_photo = found
        target_state, target_slug = _hidden_provenance(hidden_photo, "expo", hidden_slug)
        if target_state == "expo" and not public_preview_allowed(hidden_photo):
            target_state = "reserve"
        restored = _restore_hidden_photo_to_normal_group(
            expo_groups,
            reserve_groups,
            hidden_photo,
            photo_id,
            target_state,
            target_slug,
        )
        moved = {
            "from": "hidden",
            "from_slug": hidden_slug,
            "to": target_state,
            "to_slug": target_slug,
            "mode": "blacklist",
            "restored": restored,
        }
        lifecycle_result = _record_active_lifecycle(repo_root, [photo_id])

    else:
        found = _find_and_remove(hidden_groups, photo_id)
        if not found:
            lifecycle_result = _record_active_lifecycle(repo_root, [photo_id])
            site_state, worker_catalog = _write_catalog_state(repo_root, expo_groups, reserve_groups, hidden_groups)
            r2_task = _start_r2_upload_task("hidden-blacklist", [_hidden_blacklist_upload_item(repo_root)], "hidden-blacklist-upload")
            return {
                "ok": True,
                "action": action,
                "photo_id": photo_id,
                "message": "already put back",
                "moved": {"from": "hidden", "to": "expo", "mode": "blacklist", "already_put_back": True},
                "lifecycle": lifecycle_result,
                "r2_blacklist_task": r2_task,
                "worker_catalog": worker_catalog,
                "site": site_state,
            }
        hidden_slug, hidden_photo = found
        _source_state, target_slug = _hidden_provenance(hidden_photo, "expo", hidden_slug)
        if not _find_photo(expo_groups, photo_id):
            restored = copy_photo(hidden_photo)
            restored.pop("hiddenFromState", None)
            restored.pop("hiddenFromSlug", None)
            _remove_existing(expo_groups, photo_id)
            expo_groups[target_slug].append(restored)
        moved = {"from": "hidden", "from_slug": hidden_slug, "to": "expo", "to_slug": target_slug, "mode": "blacklist"}
        lifecycle_result = _record_active_lifecycle(repo_root, [photo_id])

    site_state, worker_catalog = _write_catalog_state(repo_root, expo_groups, reserve_groups, hidden_groups)
    r2_task = _start_r2_upload_task("hidden-blacklist", [_hidden_blacklist_upload_item(repo_root)], "hidden-blacklist-upload")
    return {
        "ok": True,
        "action": action,
        "photo_id": photo_id,
        "moved": moved,
        "lifecycle": lifecycle_result,
        "r2_blacklist_task": r2_task,
        "worker_catalog": worker_catalog,
        "site": site_state,
    }


if __name__ == "__main__":
    raise SystemExit(main())
