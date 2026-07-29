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
import tempfile
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
REVEAL_IMPORT_SOURCE_PATH = "/__photosbyelie/reveal-import-source"
IMPORT_SOURCES_PATH = "/__photosbyelie/import-sources"
IMPORT_SOURCE_THUMB_PATH = "/__photosbyelie/import-source-thumb"
APPLE_PHOTOS_ALBUMS_PATH = "/__photosbyelie/apple-photos/albums"
APPLE_PHOTOS_PREFLIGHT_PATH = "/__photosbyelie/apple-photos/preflight"
APPLE_PHOTOS_IMPORT_PATH = "/__photosbyelie/apple-photos/import"
APPLE_PHOTOS_IMPORT_PROGRESS_PATH = "/__photosbyelie/apple-photos/import-progress"
APPLE_PHOTOS_SOURCE_ANCHORS = ".pbe-apple-photos-assets.json"
REAL_ESTATE_OWNER_PATH = "/__photosbyelie/real-estate-owner"
REAL_ESTATE_IMPORT_PROGRESS_PATH = "/__photosbyelie/real-estate-import-progress"
OWNER_ACCESS_USERS_PATH = "/__photosbyelie/access-users"
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
OWNER_BURST_CULL_PATH = "/__photosbyelie/owner-burst-cull"
NEW_OWNER_CONNECTOR_PATH = "/__photosbyelie/new-owner-connector"
NEW_OWNER_SIDECAR_DECISION_PATH = "/__photosbyelie/new-owner-sidecar-decision"
MAX_BODY_BYTES = 5 * 1024 * 1024
LOCAL_CLIENTS = {"127.0.0.1", "::1", "localhost"}
TAILSCALE_CGNAT_NETWORK = ipaddress.ip_network("100.64.0.0/10")
VISIBLE_VERSION_EPOCH = date(2026, 2, 28)
DERIVATIVES = (("gallery", "gallerySrc"), ("detail", "imageSrc"))
COUNTRY_ASSIGNMENT_TARGETS = {"france", "usa", "spain", "mexico", "italy", "portugal", "slovakia"}
OWNER_SESSION_COOKIE = "pbe_owner_session"
OWNER_ADMIN_EMAIL = os.environ.get("ACCESS_ADMIN_EMAIL", os.environ.get("PBE_OWNER_ADMIN_EMAIL", "ec92009@gmail.com")).strip().lower()
ACCESS_USER_KV_BINDING = os.environ.get("PBE_ACCESS_USERS_KV_BINDING", "ORDERS_KV")
ACCESS_USER_KV_PREFIX = os.environ.get("PBE_ACCESS_USERS_KV_PREFIX", os.environ.get("KV_PREFIX", "pbe"))
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
APPLE_PHOTOS_BRIDGE = Path("scripts/apple_photos_bridge.swift")
APPLE_PHOTOS_BRIDGE_APP_INSTALLER = Path("scripts/install_sidecar_photos_bridge_app.zsh")
APPLE_PHOTOS_BRIDGE_APP = Path.home() / "Applications" / "PhotosByElie Photos Bridge.app"
APPLE_PHOTOS_BRIDGE_APP_EXECUTABLE = APPLE_PHOTOS_BRIDGE_APP / "Contents" / "MacOS" / "PhotosByElie Photos Bridge"
APPLE_PHOTOS_BRIDGE_APP_SOURCE_FINGERPRINT = APPLE_PHOTOS_BRIDGE_APP / "Contents" / "Resources" / "BridgeSource.sha256"
APPLE_PHOTOS_IMPORT_ROOT = Path("tmp/apple-photos-import")
REAL_ESTATE_APPLE_PHOTOS_INTAKE_ROOT = Path(
    os.environ.get(
        "PBE_REAL_ESTATE_INTAKE_ROOT",
        str(Path.home() / "Pictures" / "PhotosByElie" / "Real Estate Intake"),
    )
)
APPLE_PHOTOS_ALBUM_CACHE_TTL_SECONDS = 12 * 60 * 60
APPLE_PHOTOS_ALBUMS_CACHE: dict[str, object] = {"payload": None, "loaded_at": 0.0}
APPLE_PHOTOS_ALBUMS_CACHE_LOCK = threading.Lock()
APPLE_PHOTOS_IMPORT_PROGRESS: dict[str, dict] = {}
APPLE_PHOTOS_IMPORT_PROGRESS_LOCK = threading.Lock()
APPLE_PHOTOS_PROGRESS_PREFIX = "PBE_APPLE_PHOTOS_PROGRESS "
APPLE_PHOTOS_PROGRESS_ITEM_LIMIT = 60
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
PUBLIC_MEDIA_BASE_URL = "https://download.photos-by-elie.com/media/"
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
PHOTOS_INCREMENTAL_SYNC_LOCK = threading.Lock()
PRICE_PUBLISH_TASKS: dict[str, dict] = {}
PRICE_PUBLISH_LOCK = threading.Lock()
R2_SWEEP_PHASES = {
    "prepare",
    "preflight",
    "discard-start",
    "import-cache",
    "selected-folder",
    "camera",
    "apple-photo-albums",
    "leonardo",
    "catalog",
    "catalog-blocked",
    "eligibility",
    "worker",
    "sidecar",
    "gap-fill",
    "private",
    "discard-final",
    "storage",
    "test",
    "validate",
    "commit",
    "coverage",
    "cleanup-cache",
    "real-estate",
}

ADMIN_MACHINE_NAMES_CACHE: list[str] | None = None


def _local_machine_names() -> list[str]:
    global ADMIN_MACHINE_NAMES_CACHE
    if ADMIN_MACHINE_NAMES_CACHE is not None:
        return ADMIN_MACHINE_NAMES_CACHE
    names: list[str] = []
    for command in (["scutil", "--get", "ComputerName"], ["hostname"]):
        try:
            result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=2)
        except (OSError, subprocess.SubprocessError):
            continue
        name = (result.stdout or "").strip()
        if name:
            names.append(name)
    ADMIN_MACHINE_NAMES_CACHE = names
    return names


def _is_david_admin_machine() -> bool:
    return any(name.casefold().startswith("david") for name in _local_machine_names())
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
from owner_state_db import (  # noqa: E402
    backfill_r2_object_metadata,
    connect as owner_db_connect,
    list_access_users as list_access_users_db,
    mark_access_user_published as mark_access_user_published_db,
    media_lifecycle_snapshot,
    record_import_operation as record_import_operation_db,
    update_import_operation as update_import_operation_db,
    upsert_access_user as upsert_access_user_db,
    upsert_r2_object_state,
)
from owner_state_db import keyword_blacklist_terms as keyword_blacklist_terms_db  # noqa: E402
from owner_state_db import record_country_assignments as record_country_assignments_db  # noqa: E402
from owner_state_db import record_keyword_blacklist as record_keyword_blacklist_db  # noqa: E402
from owner_state_db import record_media_lifecycle_active as record_media_lifecycle_active_db  # noqa: E402
from owner_state_db import record_media_lifecycle_restored as record_media_lifecycle_restored_db  # noqa: E402
from owner_state_db import record_media_lifecycle_discarded as record_media_lifecycle_discarded_db  # noqa: E402
from owner_state_db import record_media_lifecycle_hidden as record_media_lifecycle_hidden_db  # noqa: E402
from owner_state_db import clear_title_keyword_review_blocks as clear_title_keyword_review_blocks_db  # noqa: E402
from owner_state_db import import_title_keyword_batch_file as import_title_keyword_batch_file_db  # noqa: E402
from owner_state_db import queue_title_keyword_review_photo as queue_title_keyword_review_photo_db  # noqa: E402
from owner_state_db import queue_title_keyword_review_photos as queue_title_keyword_review_photos_db  # noqa: E402
from owner_state_db import record_title_keyword_review_decisions as record_title_keyword_review_decisions_db  # noqa: E402
from sidecar_state_db import record_decision as record_sidecar_decision_db  # noqa: E402
from sidecar_state_db import summary as sidecar_summary_db  # noqa: E402
from sidecar_state_db import upload_bridge_plan as upload_bridge_plan_db  # noqa: E402
from fixture_pipeline import (  # noqa: E402
    apply_fixture_state_migration,
    apply_pool_refresh,
    adopt_upload_run,
    archive_fixture,
    connect as fixture_connect,
    configure_asset_destinations,
    create_fixture,
    create_pool,
    delivery_plan,
    fixture_tree,
    fixture_candidate_asset_ids,
    fixture_culling_window,
    fixture_review_window,
    apply_fixture_review_action,
    undo_fixture_review_action,
    ai_run_status,
    effective_fixture_access_grants,
    get_pool,
    link_deliverable,
    list_deliverables,
    list_pools,
    list_placements,
    mark_ai_proposals_loaded,
    migrate_la_concha_tree,
    move_fixture,
    move_placement,
    place_assets,
    plan_upload_run_adoption,
    plan_fixture_state_migration,
    preview_pool_refresh,
    publication_plan,
    ready_ai_proposals,
    remove_placement,
    rename_fixture,
    reopen_fixture,
    restore_placement,
    search_assets,
    set_fixture_asset_state,
    request_ai_run_cancel,
)
from fixture_policy import (  # noqa: E402
    apply_fixture_policy_migration,
    configure_fixture as configure_fixture_policy,
    fixture_configuration,
    plan_fixture_policy_migration,
)
from apple_photos_metadata_writer import SignedPhotosBridgeAdapter, commit_writeback, writeback_plan  # noqa: E402
from native_publication_pipeline import (  # noqa: E402
    create_upload_run as create_native_upload_run,
    record_photos_sync_snapshot,
    record_sale_reference,
    reconcile_r2_objects,
    upload_eligibility_plan as native_upload_eligibility_plan,
    upload_run_status as native_upload_run_status,
)


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
BURST_CULL_KEEP_MARKERS = {
    "manual-keep",
    "manual_keep",
    "review-approved",
    "review_approved",
}


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
        if path == OWNER_BURST_CULL_PATH:
            self._handle_owner_burst_cull_preview()
            return
        if path == IMPORT_SOURCES_PATH:
            self._handle_import_sources()
            return
        if path == APPLE_PHOTOS_ALBUMS_PATH:
            self._handle_apple_photos_albums()
            return
        if path == APPLE_PHOTOS_IMPORT_PROGRESS_PATH:
            self._handle_apple_photos_import_progress()
            return
        if path == IMPORT_SOURCE_THUMB_PATH:
            self._handle_import_source_thumb()
            return
        if path == REAL_ESTATE_OWNER_PATH:
            self._handle_real_estate_owner()
            return
        if path == OWNER_ACCESS_USERS_PATH:
            self._handle_owner_access_users()
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
        if path == IMPORT_SOURCES_PATH:
            self._handle_import_sources_update()
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
        if path == REVEAL_IMPORT_SOURCE_PATH:
            self._handle_reveal_import_source()
            return
        if path == APPLE_PHOTOS_PREFLIGHT_PATH:
            self._handle_apple_photos_preflight()
            return
        if path == APPLE_PHOTOS_IMPORT_PATH:
            self._handle_apple_photos_import()
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
        if path == OWNER_BURST_CULL_PATH:
            self._handle_owner_burst_cull_run()
            return
        if path == NEW_OWNER_CONNECTOR_PATH:
            self._handle_new_owner_connector()
            return
        if path == NEW_OWNER_SIDECAR_DECISION_PATH:
            self._handle_new_owner_sidecar_decision()
            return
        if path == REAL_ESTATE_OWNER_PATH:
            self._handle_real_estate_owner()
            return
        if path == OWNER_ACCESS_USERS_PATH:
            self._handle_owner_access_users()
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

    def _handle_owner_burst_cull_preview(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            preview = owner_burst_cull_preview(Path.cwd())
        except (OSError, sqlite3.Error, json.JSONDecodeError, ValueError) as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, {"ok": True, **preview})

    def _handle_owner_burst_cull_run(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = self._read_json_body()
            protected_ids = _normalized_photo_ids(payload.get("protected_ids") or payload.get("protectedIds"))
            if payload.get("confirm") is not True:
                preview = owner_burst_cull_preview(Path.cwd(), protected_ids)
                self._send_json(HTTPStatus.OK, {"ok": True, **preview})
                return
            with OWNER_ACTION_LOCK:
                result = owner_burst_cull_run(Path.cwd(), protected_ids)
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        except (OSError, sqlite3.Error, json.JSONDecodeError) as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, {"ok": True, **result})

    def _handle_new_owner_connector(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            result = new_owner_connector_result(Path.cwd(), self._read_json_body())
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        except FileNotFoundError as error:
            self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": str(error)})
            return
        except sqlite3.Error as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, result)

    def _handle_new_owner_sidecar_decision(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            result = new_owner_sidecar_decision_result(Path.cwd(), self._read_json_body())
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        except sqlite3.Error as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, result)

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

    def _handle_import_sources_update(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = self._read_json_body()
            kind = _import_source_kind(payload.get("kind"))
            path = _import_source_history_path(payload.get("path"))
            action = str(payload.get("action") or "").strip().lower()
            if action not in {"pin", "unpin", "remove", "review"}:
                raise ValueError("action must be pin, unpin, remove, or review")
            result = _update_import_source_history(Path.cwd(), kind, path, action)
            sources = (
                _real_estate_import_source_history(Path.cwd())
                if kind == "real_estate"
                else _import_source_history(Path.cwd())
            )
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        except sqlite3.Error as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, {"ok": True, "source": result, "sources": sources})

    def _handle_apple_photos_albums(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        query = parse_qs(urlparse(self.path).query)
        refresh = str((query.get("refresh") or [""])[0]).strip().lower() in {"1", "true", "yes"}
        cache_only = str((query.get("cacheOnly") or query.get("cache_only") or [""])[0]).strip().lower() in {
            "1",
            "true",
            "yes",
        }
        if not refresh:
            cached = _cached_apple_photos_albums_payload()
            if cached:
                self._send_json(HTTPStatus.OK, _with_apple_photos_import_stats(Path.cwd(), cached))
                return
            if cache_only:
                self._send_json(
                    HTTPStatus.OK,
                    {
                        "ok": True,
                        "albums": [],
                        "albumImportStats": _apple_photos_album_import_stats(Path.cwd()),
                        "cacheMiss": True,
                        "cacheTtlSeconds": APPLE_PHOTOS_ALBUM_CACHE_TTL_SECONDS,
                    },
                )
                return
        try:
            started = time.monotonic()
            result = _run_apple_photos_bridge(Path.cwd(), ["albums"])
        except (OSError, RuntimeError, json.JSONDecodeError) as error:
            self._send_json(HTTPStatus.BAD_GATEWAY, {"ok": False, "error": str(error)})
            return
        if result.get("ok"):
            result = {
                **result,
                "cached": False,
                "cacheMiss": False,
                "loadedAt": datetime.now(timezone.utc).isoformat(),
                "durationMs": round((time.monotonic() - started) * 1000),
                "cacheTtlSeconds": APPLE_PHOTOS_ALBUM_CACHE_TTL_SECONDS,
            }
            _store_apple_photos_albums_payload(result)
        if result.get("ok"):
            result = _with_apple_photos_import_stats(Path.cwd(), result)
        self._send_json(HTTPStatus.OK if result.get("ok") else HTTPStatus.BAD_GATEWAY, result)

    def _handle_apple_photos_preflight(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = self._read_json_body()
            result = _apple_photos_preflight(Path.cwd(), payload)
            operation = _record_apple_photos_import_operation(
                Path.cwd(),
                payload,
                result,
                state="preflighted" if result.get("ok") else "failed",
                error=str(result.get("error") or ""),
            )
            result = {**result, "operation": operation}
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        except (OSError, RuntimeError, json.JSONDecodeError) as error:
            self._send_json(HTTPStatus.BAD_GATEWAY, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK if result.get("ok") else HTTPStatus.BAD_GATEWAY, result)

    def _handle_apple_photos_import(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        payload: dict = {}
        try:
            payload = self._read_json_body()
            result = _start_apple_photos_import(Path.cwd(), payload)
        except ValueError as error:
            _finish_apple_photos_import_progress(_apple_photos_progress_id(payload), "failed", {"error": str(error)})
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        except (OSError, RuntimeError, json.JSONDecodeError) as error:
            _finish_apple_photos_import_progress(_apple_photos_progress_id(payload), "failed", {"error": str(error)})
            self._send_json(HTTPStatus.BAD_GATEWAY, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK if result.get("ok") else HTTPStatus.BAD_GATEWAY, result)

    def _handle_apple_photos_import_progress(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        query = parse_qs(urlparse(self.path).query)
        progress_id = _clean_apple_photos_progress_id((query.get("progress_id") or query.get("task_id") or [""])[0])
        progress = _apple_photos_import_progress(progress_id) if progress_id else _latest_apple_photos_import_progress()
        self._send_json(HTTPStatus.OK, {"ok": True, "progress": progress})

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
        upstream = f"{PUBLIC_MEDIA_BASE_URL.rstrip('/')}/{safe_key}"
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
                "previewUrl": result.get("previewUrl") or f"{SOURCE_PREVIEW_PATH}{quote(media_id, safe='')}",
            })
            return
        if result.get("previewUrl") and not result.get("path"):
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", str(result["previewUrl"]))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
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
        if source_root:
            try:
                review_required = _import_source_requires_review(Path.cwd(), "expo", source_root)
            except sqlite3.Error as error:
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
                return
            if review_required:
                self._send_json(
                    HTTPStatus.BAD_REQUEST,
                    {
                        "ok": False,
                        "error": "Mark the selected source reviewed before starting the Expo import.",
                        "code": "review_required",
                    },
                )
                return
        if maintenance_key:
            task = _start_r2_maintenance_task(Path.cwd(), maintenance_key)
        else:
            task = _start_cloud_media_sweep(Path.cwd(), skip_phases, source_root=source_root, source_select=source_select)
            operation = _record_legacy_folder_import_operation(Path.cwd(), source_root, source_select, task)
            if operation:
                task = {**task, "importOperationId": operation.get("operationId")}
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

    def _handle_reveal_import_source(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = self._read_json_body()
            path = Path(_import_source_history_path(payload.get("path")))
            if not path.is_dir():
                raise ValueError(f"import folder not found: {path}")
            subprocess.run(["open", str(path)], check=True, capture_output=True, text=True)
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        except subprocess.CalledProcessError as error:
            message = (error.stderr or error.stdout or str(error)).strip() or "Could not open the import folder in Finder."
            self._send_json(HTTPStatus.BAD_GATEWAY, {"ok": False, "error": message})
            return
        except OSError as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, {"ok": True, "path": str(path), "name": path.name or str(path)})

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

    def _is_admin_loopback_request(self) -> bool:
        host = self.headers.get("Host", "").split(":", 1)[0].strip("[]")
        client = self.client_address[0]
        loopback = client.startswith("127.") or client == "::1"
        local_host = host in LOCAL_CLIENTS or host.startswith("127.")
        return loopback and local_host

    def _handle_owner_access_users(self) -> None:
        if not self._is_admin_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "admin endpoint is David localhost only"})
            return
        if not _is_david_admin_machine():
            self._send_json(HTTPStatus.FORBIDDEN, {
                "ok": False,
                "error": "admin endpoint is available only on David",
                "machineNames": _local_machine_names(),
            })
            return
        try:
            if self.command == "GET":
                result = owner_access_users_summary(Path.cwd())
            else:
                result = apply_owner_access_user_action(Path.cwd(), self._read_json_body())
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        except (OSError, sqlite3.Error, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
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
        admin = _is_david_admin_machine()
        roles = ["user", "owner"] + (["admin"] if admin else [])
        return {
            "ok": True,
            "authenticated": True,
            "user": {
                "email": "ec92009@gmail.com" if admin else "",
                "provider": "localhost",
                "tier": "admin" if admin else "owner",
            },
            "roles": roles,
            "tier": "admin" if admin else "owner",
            "admin": admin,
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


def _clean_connector_id(value: object) -> str:
    clean = re.sub(r"[^a-z0-9._-]+", "-", str(value or "").strip().lower()).strip("-")
    return (clean[:80] or "local")


def _new_owner_action_from_payload(payload: dict) -> dict:
    action = payload.get("action")
    if not isinstance(action, dict):
        raise ValueError("action must be a JSON object")
    return action


def _new_owner_manifest(action: dict) -> dict:
    action_payload = action.get("payload")
    if not isinstance(action_payload, dict):
        return {}
    manifest = action_payload.get("manifest")
    return manifest if isinstance(manifest, dict) else {}


def _new_owner_manifest_limit(manifest: dict, default: int = 50) -> int:
    try:
        value = int(manifest.get("limit") or default)
    except (TypeError, ValueError):
        value = default
    return max(1, min(value, 120))


def _owner_sqlite_path(repo_root: Path) -> Path:
    return repo_root / OWNER_ACTION_ROOT / "Owner.sqlite"


def _connect_owner_sqlite_readonly(repo_root: Path) -> sqlite3.Connection:
    path = _owner_sqlite_path(repo_root)
    if not path.exists():
        raise FileNotFoundError(f"{path} is missing")
    conn = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _require_sidecar_tables(conn: sqlite3.Connection) -> None:
    required = {
        "sidecar_assets",
        "sidecar_decisions",
        "sidecar_pending_sync",
        "sidecar_tombstones",
        "sidecar_mock_uploads",
    }
    rows = conn.execute(
        f"""
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN ({", ".join("?" for _ in required)})
        """,
        sorted(required),
    ).fetchall()
    found = {str(row["name"]) for row in rows}
    missing = sorted(required - found)
    if missing:
        raise ValueError(f"Owner.sqlite does not contain Sidecar state yet: missing {', '.join(missing)}")


def _sidecar_state_counts(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        """
        SELECT
          COALESCE(d.pick_state, 'undecided') AS pick_state,
          COALESCE(d.metadata_state, 'unreviewed') AS metadata_state,
          count(*) AS total
        FROM sidecar_assets AS a
        LEFT JOIN sidecar_decisions AS d ON d.asset_id = a.asset_id
        WHERE a.missing_at IS NULL OR a.missing_at = ''
        GROUP BY COALESCE(d.pick_state, 'undecided'), COALESCE(d.metadata_state, 'unreviewed')
        ORDER BY total DESC, pick_state, metadata_state
        """
    ).fetchall()
    return [
        {
            "pickState": str(row["pick_state"] or "undecided"),
            "metadataState": str(row["metadata_state"] or "unreviewed"),
            "count": int(row["total"] or 0),
        }
        for row in rows
    ]


def _sidecar_culling_review_rows(conn: sqlite3.Connection, limit: int) -> tuple[int, int, list[dict]]:
    indexed_count = conn.execute(
        "SELECT count(*) AS total FROM sidecar_assets WHERE missing_at IS NULL OR missing_at = ''"
    ).fetchone()["total"]
    candidate_sql = """
      FROM sidecar_assets AS a
      LEFT JOIN sidecar_decisions AS d ON d.asset_id = a.asset_id
      WHERE (a.missing_at IS NULL OR a.missing_at = '')
        AND NOT EXISTS (
          SELECT 1
          FROM sidecar_tombstones AS t
          WHERE t.asset_id = a.asset_id AND t.tombstone_state = 'active'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM sidecar_mock_uploads AS m
          WHERE m.asset_id = a.asset_id AND m.mock_state = 'active'
        )
    """
    candidate_count = conn.execute(f"SELECT count(*) AS total {candidate_sql}").fetchone()["total"]
    rows = conn.execute(
        f"""
        SELECT
          a.asset_id,
          a.filename,
          a.media_type,
          a.captured_at,
          a.indexed_at,
          a.photos_title,
          a.photos_keywords_json,
          a.metadata_seed_title,
          a.metadata_seed_keywords_json,
          COALESCE(d.rating, 0) AS rating,
          COALESCE(d.color, '') AS color,
          COALESCE(d.pick_state, 'undecided') AS pick_state,
          COALESCE(d.metadata_state, 'unreviewed') AS metadata_state,
          COALESCE(d.title, '') AS decision_title,
          COALESCE(d.keywords_json, '[]') AS decision_keywords_json,
          (
            SELECT count(*) FROM sidecar_pending_sync AS p
            WHERE p.asset_id = a.asset_id AND p.status = 'pending'
          ) AS pending_sync_count
        {candidate_sql}
        ORDER BY
          CASE WHEN a.captured_at IS NULL OR a.captured_at = '' THEN 1 ELSE 0 END,
          a.captured_at DESC,
          a.asset_id
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    items = []
    for position, row in enumerate(rows):
        keyword_candidates = [
            row["decision_keywords_json"],
            row["photos_keywords_json"],
            row["metadata_seed_keywords_json"],
        ]
        keywords = []
        for value in keyword_candidates:
            try:
                parsed = json.loads(str(value or "[]"))
            except json.JSONDecodeError:
                parsed = []
            if isinstance(parsed, list) and parsed:
                keywords = [str(item).strip() for item in parsed if str(item).strip()]
                break
        items.append({
            "assetId": str(row["asset_id"] or ""),
            "filename": str(row["filename"] or ""),
            "mediaType": str(row["media_type"] or ""),
            "capturedAt": str(row["captured_at"] or ""),
            "indexedAt": str(row["indexed_at"] or ""),
            "rating": int(row["rating"] or 0),
            "color": str(row["color"] or ""),
            "pickState": str(row["pick_state"] or "undecided"),
            "metadataState": str(row["metadata_state"] or "unreviewed"),
            "title": str(row["decision_title"] or row["photos_title"] or row["metadata_seed_title"] or ""),
            "keywords": keywords,
            "pendingSyncCount": int(row["pending_sync_count"] or 0),
            "sidecarPosition": position,
        })
    return int(indexed_count or 0), int(candidate_count or 0), items


def _new_owner_sidecar_culling_review_result(repo_root: Path, action: dict, connector_id: str) -> dict:
    manifest = _new_owner_manifest(action)
    limit = _new_owner_manifest_limit(manifest)
    owner_db = _owner_sqlite_path(repo_root)
    with _connect_owner_sqlite_readonly(repo_root) as conn:
        _require_sidecar_tables(conn)
        indexed_count, candidate_count, items = _sidecar_culling_review_rows(conn, limit)
        state_counts = _sidecar_state_counts(conn)
        pending_sync_count = conn.execute(
            "SELECT count(*) AS total FROM sidecar_pending_sync WHERE status = 'pending'"
        ).fetchone()["total"]
        tombstone_count = conn.execute(
            "SELECT count(*) AS total FROM sidecar_tombstones WHERE tombstone_state = 'active'"
        ).fetchone()["total"]
        last_indexed_at = conn.execute(
            "SELECT max(indexed_at) AS value FROM sidecar_assets WHERE missing_at IS NULL OR missing_at = ''"
        ).fetchone()["value"]
    completed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    result = {
        "connectorId": connector_id,
        "surface": "new-owner-local-bridge",
        "actionId": str(action.get("id") or ""),
        "type": "sidecar-culling-review",
        "readOnly": True,
        "recordsPrepared": len(items),
        "candidateCount": candidate_count,
        "indexedCount": indexed_count,
        "pendingSyncCount": int(pending_sync_count or 0),
        "tombstoneCount": int(tombstone_count or 0),
        "lastIndexedAt": str(last_indexed_at or ""),
        "stateCounts": state_counts,
        "reviewWindow": {
            "mode": str(manifest.get("mode") or "review-window"),
            "source": "owner-sqlite",
            "limit": limit,
            "count": len(items),
        },
        "sampleItems": items[:8],
        "local": {
            "machineNames": _local_machine_names(),
            "ownerDb": str(owner_db.relative_to(repo_root) if owner_db.is_relative_to(repo_root) else owner_db),
        },
        "completedAt": completed_at,
    }
    return {
        "ok": True,
        "connector": {
            "id": connector_id,
            "type": "sidecar-culling-review",
            "readOnly": True,
            "completedAt": completed_at,
        },
        "result": result,
        "preview": {
            "items": items,
            "stateCounts": state_counts,
        },
    }


def _new_owner_re_album_payload(item: dict, manifest: dict) -> dict:
    return {
        "albumLocalIdentifier": str(item.get("albumLocalIdentifier") or item.get("localIdentifier") or "").strip(),
        "albumName": str(item.get("albumName") or item.get("title") or "").strip(),
        "filterBursts": bool(item.get("filterBursts", manifest.get("filterBursts", True))),
        "allowIcloudDownloads": bool(item.get("allowIcloudDownloads", manifest.get("allowIcloudDownloads", True))),
        "destinationKind": "real_estate",
        "intakeAssignment": manifest.get("intakeAssignment"),
    }


def _new_owner_apple_photos_real_estate_result(repo_root: Path, action: dict, connector_id: str) -> dict:
    """Run private Apple Photos -> RE intake modes through NewOwner's existing Mac bridge."""
    manifest = _new_owner_manifest(action)
    mode = str(manifest.get("mode") or "").strip()
    completed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    base_result = {
        "connectorId": connector_id,
        "surface": "new-owner-local-bridge",
        "actionId": str(action.get("id") or ""),
        "type": "sidecar-culling-review",
        "workflow": "apple-photos-real-estate-intake",
        "mode": mode,
        "readOnly": mode != "apple-photos-re-assign",
        "published": False,
        "completedAt": completed_at,
    }

    if mode == "apple-photos-re-albums":
        bridge = _run_apple_photos_bridge(repo_root, ["albums"])
        if not bridge.get("ok"):
            raise RuntimeError(str(bridge.get("error") or "Apple Photos albums could not be loaded."))
        albums = [item for item in bridge.get("albums", []) if isinstance(item, dict)]
        result = {
            **base_result,
            "albums": albums,
            "recordsPrepared": len(albums),
            "message": f"Loaded {len(albums):,} Apple Photos album(s) from this Mac.",
        }
        return {
            "ok": True,
            "connector": {"id": connector_id, "type": "sidecar-culling-review", "completedAt": completed_at},
            "result": result,
            "preview": {"items": [], "stateCounts": []},
        }

    raw_albums = manifest.get("albums")
    if not isinstance(raw_albums, list) or not raw_albums:
        raise ValueError("Choose at least one Apple Photos album for Real Estate intake.")
    if len(raw_albums) > 24:
        raise ValueError("Choose no more than 24 Apple Photos albums at a time.")
    albums = [_new_owner_re_album_payload(item, manifest) for item in raw_albums if isinstance(item, dict)]
    albums = [item for item in albums if item["albumLocalIdentifier"] or item["albumName"]]
    if not albums:
        raise ValueError("The selected Apple Photos albums do not have valid identifiers.")
    assignment = _apple_photos_real_estate_assignment({
        "destinationKind": "real_estate",
        "intakeAssignment": manifest.get("intakeAssignment"),
    })

    if mode == "apple-photos-re-preflight":
        preflights = []
        items = []
        for album in albums:
            preflight = _apple_photos_preflight(repo_root, album)
            if not preflight.get("ok"):
                raise RuntimeError(str(preflight.get("error") or f"Could not inspect {album['albumName'] or 'Apple Photos album'}."))
            preflights.append(preflight)
            album_row = preflight.get("album") if isinstance(preflight.get("album"), dict) else {}
            album_id = str(album_row.get("localIdentifier") or album["albumLocalIdentifier"])
            album_name = str(album_row.get("title") or album["albumName"] or "Apple Photos album")
            # The PhotoKit bridge returns its dry-run rows as ``items``.  Keep
            # only rows that survived format checks and the conservative burst
            # filter; blocked rows remain summarized by the preflight so the UI
            # can explain why the album count is larger than the preview count.
            for candidate in preflight.get("items", []):
                if not isinstance(candidate, dict):
                    continue
                if candidate.get("eligible") is not True:
                    continue
                asset_id = str(candidate.get("localIdentifier") or "").strip()
                if not asset_id:
                    continue
                items.append({
                    **candidate,
                    "assetId": asset_id,
                    "albumLocalIdentifier": album_id,
                    "albumName": album_name,
                })
        limit = _new_owner_manifest_limit(manifest, default=60)
        items = items[:limit]
        inspected_count = sum(int(row.get("count") or 0) for row in preflights)
        burst_filtered_count = sum(
            int((row.get("burstFilter") or {}).get("skippedCount") or 0)
            for row in preflights
            if isinstance(row.get("burstFilter"), dict)
        )
        filter_note = (
            f" from {inspected_count:,} item(s); {burst_filtered_count:,} burst frame(s) filtered"
            if burst_filtered_count
            else f" from {inspected_count:,} item(s)"
            if inspected_count != len(items)
            else ""
        )
        result = {
            **base_result,
            "intakeAssignment": assignment,
            "albumCount": len(albums),
            "candidateCount": sum(int(row.get("candidateCount") or 0) for row in preflights),
            "recordsPrepared": len(items),
            "inspectedCount": inspected_count,
            "burstFilteredCount": burst_filtered_count,
            "preflights": preflights,
            "message": (
                f"Prepared {len(items):,} private Apple Photos candidate(s) for "
                f"{assignment['track']} / {assignment['fixture']} / {assignment['project']}"
                f"{filter_note}."
            ),
        }
        return {
            "ok": True,
            "connector": {"id": connector_id, "type": "sidecar-culling-review", "completedAt": completed_at},
            "result": result,
            "preview": {"items": items, "stateCounts": []},
        }

    if mode == "apple-photos-re-assign":
        import_payload = {
            "albums": albums,
            "selectedAssetIds": manifest.get("selectedAssetIds") or [],
            "filterBursts": bool(manifest.get("filterBursts", True)),
            "allowIcloudDownloads": bool(manifest.get("allowIcloudDownloads", True)),
            "destinationKind": "real_estate",
            "intakeAssignment": assignment,
        }
        imported = _start_apple_photos_import(repo_root, import_payload)
        if not imported.get("ok"):
            raise RuntimeError(str(imported.get("error") or "Apple Photos Real Estate assignment failed."))
        return {
            "ok": True,
            "connector": {"id": connector_id, "type": "sidecar-culling-review", "completedAt": completed_at},
            "result": {
                **base_result,
                **imported,
                "intakeAssignment": imported.get("intakeAssignment") or assignment,
                "published": False,
            },
            "preview": {"items": [], "stateCounts": []},
        }

    raise ValueError(f"Unsupported Apple Photos Real Estate intake mode: {mode or 'missing'}")


def _incremental_photos_sync(
    repo_root: Path,
    *,
    limit: int = 25,
    adapter: SignedPhotosBridgeAdapter | None = None,
    preview_runner: Callable[..., dict] | None = None,
) -> dict:
    """Read a bounded least-recently-scanned PhotoKit slice and import fingerprints."""
    bounded_limit = max(1, min(int(limit or 25), 50))
    started = time.monotonic()
    adapter = adapter or SignedPhotosBridgeAdapter(repo_root)
    preview_runner = preview_runner or _run_apple_photos_bridge
    with fixture_connect(repo_root) as connection:
        rows = connection.execute(
            """
            SELECT asset.asset_id, asset.raw_json,
                   COALESCE(sync.last_scanned_at, '') last_scanned_at
            FROM sidecar_assets AS asset
            LEFT JOIN asset_sync_state AS sync
              ON sync.asset_id = asset.asset_id
            ORDER BY
              CASE WHEN sync.last_scanned_at IS NULL THEN 0 ELSE 1 END,
              sync.last_scanned_at,
              asset.captured_at DESC,
              asset.asset_id
            LIMIT ?
            """,
            (bounded_limit,),
        ).fetchall()
    targets: list[dict] = []
    for row in rows:
        raw = json.loads(str(row["raw_json"] or "{}"))
        targets.append({
            "assetId": str(row["asset_id"]),
            "photosAssetId": str(raw.get("localIdentifier") or row["asset_id"]),
        })
    if not targets:
        return {
            "ok": True,
            "requested": 0,
            "scanned": 0,
            "failures": [],
            "changes": {},
            "elapsedSeconds": 0.0,
        }

    metadata_rows = adapter.read_many([
        {"assetId": target["photosAssetId"]}
        for target in targets
    ])
    metadata_by_id = {
        str(row.get("assetId") or ""): row
        for row in metadata_rows
        if isinstance(row, dict)
    }
    preview_by_id: dict[str, dict] = {}
    with tempfile.TemporaryDirectory(prefix="pbe-incremental-photos-sync-") as temp_dir:
        temp_root = Path(temp_dir)
        preview_requests: list[dict] = []
        destination_by_id: dict[str, Path] = {}
        for target in targets:
            photos_id = target["photosAssetId"]
            destination = temp_root / f"{hashlib.sha256(photos_id.encode()).hexdigest()[:24]}.jpg"
            destination_by_id[photos_id] = destination
            preview_requests.append({
                "assetId": photos_id,
                "destination": str(destination),
                "maxPixel": 1600,
            })
        preview_input = temp_root / "preview-requests.json"
        preview_input.write_text(
            json.dumps(preview_requests, ensure_ascii=False),
            encoding="utf-8",
        )
        preview_payload = preview_runner(
            repo_root,
            ["preview-many", "--input", str(preview_input)],
        )
        if preview_payload.get("ok"):
            preview_by_id = {
                str(row.get("assetId") or ""): row
                for row in preview_payload.get("items") or []
                if isinstance(row, dict)
            }

        snapshots: list[dict] = []
        failures: list[dict] = []
        transient_errors: list[tuple[str, str, str]] = []
        for target in targets:
            asset_id = target["assetId"]
            photos_id = target["photosAssetId"]
            metadata = metadata_by_id.get(photos_id) or {}
            metadata_error = str(metadata.get("error") or "").strip()
            preview = preview_by_id.get(photos_id) or {}
            preview_error = str(
                preview.get("error")
                or (preview_payload.get("error") if not preview_payload.get("ok") else "")
                or ""
            ).strip()
            combined_error = "; ".join(
                value for value in [metadata_error, preview_error] if value
            )
            missing = (
                bool(metadata_error)
                and any(token in metadata_error.casefold() for token in ("not found", "missing"))
            )
            if metadata_error and not missing:
                failures.append({"assetId": asset_id, "error": metadata_error})
                transient_errors.append((asset_id, photos_id, combined_error))
                continue
            destination = destination_by_id[photos_id]
            rendered = (
                hashlib.sha256(destination.read_bytes()).hexdigest()
                if destination.is_file()
                else ""
            )
            if preview_error:
                failures.append({"assetId": asset_id, "error": preview_error})
            snapshots.append({
                "assetId": asset_id,
                "photosAssetId": photos_id,
                "sourceExists": not missing,
                "title": str(metadata.get("title") or ""),
                "caption": str(metadata.get("caption") or ""),
                "keywords": [
                    str(value)
                    for value in metadata.get("keywords") or []
                    if str(value).strip()
                ],
                "renderedFingerprint": rendered,
            })

        imported = record_photos_sync_snapshot(repo_root, snapshots)
        if transient_errors:
            timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            with fixture_connect(repo_root) as connection:
                connection.executemany(
                    """
                    INSERT INTO asset_sync_state (
                      asset_id, photos_asset_id, metadata_fingerprint,
                      rendered_fingerprint, last_scanned_at, last_error,
                      created_at, updated_at
                    ) VALUES (?, ?, '', '', ?, ?, ?, ?)
                    ON CONFLICT(asset_id) DO UPDATE SET
                      photos_asset_id = excluded.photos_asset_id,
                      last_scanned_at = excluded.last_scanned_at,
                      last_error = excluded.last_error,
                      updated_at = excluded.updated_at
                    """,
                    [
                        (
                            asset_id,
                            photos_id,
                            timestamp,
                            error,
                            timestamp,
                            timestamp,
                        )
                        for asset_id, photos_id, error in transient_errors
                    ],
                )
                connection.commit()
    return {
        "ok": not failures,
        "requested": len(targets),
        "scanned": imported["count"],
        "failures": failures,
        "changes": imported["changes"],
        "elapsedSeconds": round(time.monotonic() - started, 3),
    }


def _start_requested_ai_pass(repo_root: Path) -> dict:
    status = ai_run_status(repo_root)
    if status.get("active"):
        return {**status, "attached": True, "started": False}
    log_root = repo_root / ".review-logs" / "requested-ai-runs"
    log_root.mkdir(parents=True, exist_ok=True)
    log_path = log_root / f"manual-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.log"
    log_handle = log_path.open("ab")
    try:
        process = subprocess.Popen(
            [
                sys.executable,
                str(repo_root / "scripts" / "requested_ai_proposal_pass.py"),
                "--repo-root",
                str(repo_root),
                "--trigger",
                "manual",
            ],
            cwd=repo_root,
            stdin=subprocess.DEVNULL,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    finally:
        log_handle.close()
    return {
        "ok": True,
        "active": True,
        "attached": False,
        "started": True,
        "pid": process.pid,
        "logPath": str(log_path),
    }


def _start_native_publication_run(repo_root: Path, run_id: str) -> dict:
    log_root = repo_root / ".review-logs" / "native-publication-runs"
    log_root.mkdir(parents=True, exist_ok=True)
    log_path = log_root / f"{run_id}.log"
    log_handle = log_path.open("ab")
    try:
        process = subprocess.Popen(
            [
                sys.executable,
                str(repo_root / "scripts" / "native_asset_publication.py"),
                "--repo-root",
                str(repo_root),
                "--run-id",
                run_id,
            ],
            cwd=repo_root,
            stdin=subprocess.DEVNULL,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    finally:
        log_handle.close()
    return {
        "started": True,
        "pid": process.pid,
        "logPath": str(log_path),
    }


def _delete_reconciled_r2_object(bucket: str, key: str) -> None:
    item = UploadItem(bucket=bucket, key=key, path=Path("/dev/null"), content_type="")
    _item, ok, output = wrangler_delete(item, retries=3)
    if not ok:
        raise RuntimeError(output or f"R2 deletion failed for {bucket}/{key}")


def _new_owner_fixture_pipeline_result(repo_root: Path, action: dict, connector_id: str) -> dict:
    """Run universal fixture orchestration through the enrolled local connector."""
    manifest = _new_owner_manifest(action)
    mode = str(manifest.get("mode") or "").strip()
    completed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    result: dict = {
        "connectorId": connector_id,
        "surface": "new-owner-local-bridge",
        "actionId": str(action.get("id") or ""),
        "type": "sidecar-culling-review",
        "workflow": "universal-fixture-pipeline",
        "mode": mode,
        "published": False,
        "clientMessageSent": False,
        "completedAt": completed_at,
    }
    preview: dict = {"items": [], "stateCounts": []}

    if mode == "fixture-tree-list":
        result.update({"readOnly": True, "fixtures": fixture_tree(repo_root, include_archived=bool(manifest.get("includeArchived")))})
    elif mode == "fixture-state-migration-plan":
        result.update({
            "readOnly": True,
            "migration": plan_fixture_state_migration(repo_root),
        })
    elif mode == "fixture-state-migration-apply":
        result.update({
            "readOnly": False,
            "migration": apply_fixture_state_migration(repo_root),
        })
    elif mode == "fixture-candidate-universe":
        fixture_id = str(manifest.get("fixtureId") or "")
        asset_ids = fixture_candidate_asset_ids(repo_root, fixture_id)
        result.update({
            "readOnly": True,
            "candidateUniverse": {
                "fixtureId": fixture_id,
                "count": len(asset_ids),
                "assetIds": asset_ids,
            },
        })
    elif mode == "fixture-culling-window":
        result.update({
            "readOnly": True,
            "cullingWindow": fixture_culling_window(
                repo_root,
                str(manifest.get("fixtureId") or ""),
                view=str(manifest.get("view") or "undecided"),
                views=manifest.get("views") or [],
                offset=int(manifest.get("offset") or 0),
                limit=int(manifest.get("limit") or 200),
                search=str(manifest.get("search") or ""),
                media_types=manifest.get("mediaTypes") or [],
                ratings=manifest.get("ratings") or [],
                colors=manifest.get("colors") or [],
            ),
        })
    elif mode == "fixture-state-apply":
        result.update({
            "readOnly": False,
            "fixtureState": set_fixture_asset_state(
                repo_root,
                str(manifest.get("fixtureId") or ""),
                manifest.get("assetIds") or [],
                str(manifest.get("placementState") or ""),
                actor="owner-connector",
                reason=str(manifest.get("reason") or "native fixture culling"),
            ),
        })
    elif mode == "fixture-review-window":
        result.update({
            "readOnly": True,
            "reviewWindow": fixture_review_window(
                repo_root,
                str(manifest.get("fixtureId") or ""),
                mode=str(manifest.get("reviewMode") or "backfill"),
                proposal_available_only=bool(
                    manifest.get("proposalAvailableOnly") or False
                ),
                media_filters=(
                    manifest.get("mediaFilters")
                    if "mediaFilters" in manifest
                    else ["photos", "videos"]
                ),
                offset=int(manifest.get("offset") or 0),
                limit=int(manifest.get("limit") or 200),
                search=str(manifest.get("search") or ""),
            ),
        })
    elif mode == "fixture-review-apply":
        review_action = apply_fixture_review_action(
            repo_root,
            str(manifest.get("fixtureId") or ""),
            manifest.get("assetIds") or [],
            str(manifest.get("reviewAction") or ""),
            anchor_asset_id=str(manifest.get("anchorAssetId") or ""),
            propagate=bool(manifest.get("propagate")),
            title=manifest.get("title") if "title" in manifest else None,
            keywords=manifest.get("keywords") if "keywords" in manifest else None,
            ai_reasons=manifest.get("aiReasons") or [],
            ai_note=str(manifest.get("aiNote") or ""),
            actor="owner-connector",
        )
        result.update({"readOnly": False, "reviewAction": review_action})
    elif mode == "fixture-review-undo":
        result.update({
            "readOnly": False,
            "reviewUndo": undo_fixture_review_action(
                repo_root,
                str(manifest.get("operationId") or ""),
                actor="owner-connector",
            ),
        })
    elif mode == "fixture-ai-status":
        result.update({"readOnly": True, "ai": ai_run_status(repo_root)})
    elif mode == "fixture-ai-proposals-ready":
        result.update({
            "readOnly": True,
            "aiProposals": ready_ai_proposals(
                repo_root,
                asset_ids=manifest.get("assetIds") or [],
                include_loaded=bool(manifest.get("includeLoaded")),
            ),
        })
    elif mode == "fixture-ai-proposals-load":
        result.update({
            "readOnly": False,
            "aiProposals": mark_ai_proposals_loaded(
                repo_root,
                manifest.get("proposalIds") or [],
            ),
        })
    elif mode == "fixture-ai-pass-start":
        result.update({"readOnly": False, "ai": _start_requested_ai_pass(repo_root)})
    elif mode == "fixture-ai-pass-cancel":
        result.update({"readOnly": False, "ai": request_ai_run_cancel(repo_root)})
    elif mode == "photos-sync-snapshot":
        result.update({
            "readOnly": False,
            "photosSync": record_photos_sync_snapshot(
                repo_root,
                manifest.get("items") or [],
            ),
        })
    elif mode == "photos-sync-run":
        if not PHOTOS_INCREMENTAL_SYNC_LOCK.acquire(blocking=False):
            result.update({
                "readOnly": False,
                "photosSync": {
                    "ok": True,
                    "attached": True,
                    "requested": 0,
                    "scanned": 0,
                    "failures": [],
                    "changes": {},
                    "elapsedSeconds": 0.0,
                },
            })
        else:
            try:
                result.update({
                    "readOnly": False,
                    "photosSync": _incremental_photos_sync(
                        repo_root,
                        limit=int(manifest.get("limit") or 25),
                    ),
                })
            finally:
                PHOTOS_INCREMENTAL_SYNC_LOCK.release()
    elif mode == "asset-upload-plan":
        result.update({
            "readOnly": True,
            "uploadPlan": native_upload_eligibility_plan(
                repo_root,
                fixture_id=str(manifest.get("fixtureId") or ""),
                offset=int(manifest.get("offset") or 0),
                limit=int(manifest.get("limit") or 200),
            ),
        })
    elif mode == "asset-upload-run-start":
        upload_run = create_native_upload_run(
            repo_root,
            manifest.get("assetIds") or [],
            limit=int(manifest.get("limit") or 50),
            concurrency=int(manifest.get("concurrency") or 4),
        )
        background = (
            _start_native_publication_run(repo_root, str(upload_run["runId"]))
            if int(upload_run.get("count") or 0)
            else {"started": False, "reason": "No approved assets need upload."}
        )
        result.update({
            "readOnly": False,
            "uploadRun": {**upload_run, **background},
        })
    elif mode == "asset-upload-run-status":
        result.update({
            "readOnly": True,
            "uploadRun": native_upload_run_status(
                repo_root,
                str(manifest.get("runId") or ""),
            ),
        })
    elif mode == "asset-sale-reference-record":
        result.update({
            "readOnly": False,
            "saleReference": record_sale_reference(
                repo_root,
                order_id=str(manifest.get("orderId") or ""),
                asset_id=str(manifest.get("assetId") or ""),
                source_version_hash=str(manifest.get("sourceVersionHash") or ""),
                checksum_sha256=str(manifest.get("checksumSha256") or ""),
                master_key=str(manifest.get("masterKey") or ""),
                derivative_keys=manifest.get("derivativeKeys") or [],
            ),
        })
    elif mode == "r2-reconciliation-plan":
        result.update({
            "readOnly": True,
            "reconciliation": reconcile_r2_objects(repo_root, commit=False),
        })
    elif mode == "r2-reconciliation-commit":
        result.update({
            "readOnly": False,
            "reconciliation": reconcile_r2_objects(
                repo_root,
                commit=True,
                delete_object=_delete_reconciled_r2_object,
            ),
        })
    elif mode == "fixture-access-effective":
        fixture_id = str(manifest.get("fixtureId") or "")
        grants = effective_fixture_access_grants(repo_root, fixture_id)
        result.update({
            "readOnly": True,
            "access": {
                "fixtureId": fixture_id,
                "count": len(grants),
                "items": grants,
            },
        })
    elif mode == "fixture-configuration-get":
        result.update({
            "readOnly": True,
            "configuration": fixture_configuration(
                repo_root,
                str(manifest.get("fixtureId") or ""),
            ),
        })
    elif mode == "fixture-configuration-set":
        result.update({
            "readOnly": False,
            "configuration": configure_fixture_policy(
                repo_root,
                str(manifest.get("fixtureId") or ""),
                population_mode=(
                    str(manifest.get("populationMode") or "")
                    if "populationMode" in manifest else None
                ),
                candidate_source=(
                    manifest.get("candidateSource")
                    if isinstance(manifest.get("candidateSource"), dict) else None
                ),
                saved_rule=(
                    manifest.get("savedRule")
                    if isinstance(manifest.get("savedRule"), dict) else None
                ),
                policy_overrides=(
                    manifest.get("policyOverrides")
                    if isinstance(manifest.get("policyOverrides"), dict) else None
                ),
                template_key=(
                    str(manifest.get("templateKey") or "")
                    if "templateKey" in manifest else None
                ),
                actor="owner-connector",
                reason=str(manifest.get("reason") or "Backstage fixture configuration"),
            ),
        })
    elif mode == "fixture-policy-migration-plan":
        result.update({
            "readOnly": True,
            "migration": plan_fixture_policy_migration(repo_root),
        })
    elif mode == "fixture-policy-migration-apply":
        result.update({
            "readOnly": False,
            "migration": apply_fixture_policy_migration(
                repo_root,
                actor="owner-connector",
            ),
        })
    elif mode == "fixture-create":
        result.update({
            "readOnly": False,
            "fixture": create_fixture(
                repo_root,
                str(manifest.get("name") or ""),
                parent_fixture_id=str(manifest.get("parentFixtureId") or ""),
                tags=manifest.get("tags") or [],
                template_key=str(manifest.get("templateKey") or ""),
                destination_defaults=manifest.get("destinationDefaults") or ["r2"],
            ),
            "fixtures": fixture_tree(repo_root, include_archived=True),
        })
    elif mode == "fixture-rename":
        result.update({"readOnly": False, "fixture": rename_fixture(repo_root, str(manifest.get("fixtureId") or ""), str(manifest.get("name") or "")), "fixtures": fixture_tree(repo_root, include_archived=True)})
    elif mode == "fixture-move":
        result.update({"readOnly": False, "fixture": move_fixture(repo_root, str(manifest.get("fixtureId") or ""), str(manifest.get("parentFixtureId") or "")), "fixtures": fixture_tree(repo_root, include_archived=True)})
    elif mode == "fixture-archive":
        result.update({"readOnly": False, "fixture": archive_fixture(repo_root, str(manifest.get("fixtureId") or "")), "fixtures": fixture_tree(repo_root, include_archived=True)})
    elif mode == "fixture-reopen":
        result.update({"readOnly": False, "fixture": reopen_fixture(repo_root, str(manifest.get("fixtureId") or "")), "fixtures": fixture_tree(repo_root, include_archived=True)})
    elif mode == "fixture-search":
        search = search_assets(
            repo_root,
            manifest.get("filters") if isinstance(manifest.get("filters"), dict) else {},
            limit=_new_owner_manifest_limit(manifest, default=120),
        )
        result.update({"readOnly": True, "search": search, "recordsPrepared": search["count"], "candidateCount": search["totalCount"]})
        preview = {"items": search["items"], "stateCounts": []}
    elif mode == "fixture-pool-create":
        pool = create_pool(
            repo_root,
            str(manifest.get("fixtureId") or ""),
            manifest.get("selectedAssetIds") or [],
            name=str(manifest.get("name") or ""),
            criteria=manifest.get("criteria") if isinstance(manifest.get("criteria"), dict) else {},
        )
        placement = place_assets(
            repo_root,
            pool["fixtureId"],
            [item["assetId"] for item in pool["assets"]],
            source_pool_id=pool["poolId"],
            actor="owner-connector",
            reason="fixture culling pool snapshot",
        )
        result.update({"readOnly": False, "pool": pool, "placement": placement})
        if os.environ.get("PBE_ENABLE_LEGACY_SIDECAR", "").strip() == "1":
            result["sidecarUrl"] = f"http://127.0.0.1:8011/sidecar.html?pool={quote(pool['poolId'])}"
    elif mode == "fixture-pool-open":
        pool = get_pool(repo_root, str(manifest.get("poolId") or ""))
        result.update({"readOnly": True, "pool": pool})
        if os.environ.get("PBE_ENABLE_LEGACY_SIDECAR", "").strip() == "1":
            result["sidecarUrl"] = f"http://127.0.0.1:8011/sidecar.html?pool={quote(pool['poolId'])}"
    elif mode == "fixture-pool-list":
        result.update({
            "readOnly": True,
            "pools": list_pools(
                repo_root,
                fixture_id=str(manifest.get("fixtureId") or ""),
                limit=_new_owner_manifest_limit(manifest, default=50),
            ),
        })
    elif mode == "fixture-pool-refresh-preview":
        result.update({"readOnly": True, "refresh": preview_pool_refresh(repo_root, str(manifest.get("poolId") or ""))})
    elif mode == "fixture-pool-refresh-apply":
        result.update({"readOnly": False, "refresh": apply_pool_refresh(repo_root, str(manifest.get("poolId") or ""))})
    elif mode == "fixture-place":
        result.update({"readOnly": False, "placement": place_assets(repo_root, str(manifest.get("fixtureId") or ""), manifest.get("assetIds") or [], source_pool_id=str(manifest.get("poolId") or ""), actor="owner-connector", reason=str(manifest.get("reason") or "manual fixture routing"))})
    elif mode == "fixture-place-multi":
        targets = list(dict.fromkeys(str(item or "").strip() for item in (manifest.get("fixtureIds") or []) if str(item or "").strip()))
        if not targets:
            raise ValueError("choose at least one destination fixture")
        result.update({
            "readOnly": False,
            "placements": [place_assets(repo_root, target, manifest.get("assetIds") or [], source_pool_id=str(manifest.get("poolId") or ""), actor="owner-connector", reason=str(manifest.get("reason") or "multi-fixture routing")) for target in targets],
            "ledger": list_placements(repo_root, manifest.get("assetIds") or []),
        })
    elif mode == "fixture-placement-list":
        result.update({"readOnly": True, "ledger": list_placements(repo_root, manifest.get("assetIds") or [], fixture_id=str(manifest.get("fixtureId") or ""))})
    elif mode == "fixture-placement-move":
        result.update({"readOnly": False, "placement": move_placement(repo_root, str(manifest.get("placementId") or ""), str(manifest.get("fixtureId") or ""), actor="owner-connector", reason=str(manifest.get("reason") or "manual fixture reroute"))})
    elif mode == "fixture-placement-remove":
        result.update({"readOnly": False, "placement": remove_placement(repo_root, str(manifest.get("placementId") or ""), actor="owner-connector", reason=str(manifest.get("reason") or "manual fixture removal"))})
    elif mode == "fixture-placement-restore":
        result.update({"readOnly": False, "placement": restore_placement(repo_root, str(manifest.get("placementId") or ""), actor="owner-connector", reason=str(manifest.get("reason") or "manual fixture restore"))})
    elif mode == "fixture-destinations":
        result.update({"readOnly": False, "destinations": configure_asset_destinations(repo_root, str(manifest.get("fixtureId") or ""), manifest.get("assetIds") or [], manifest.get("destinations") or [])})
    elif mode == "fixture-delivery-plan":
        result.update({"readOnly": True, "delivery": delivery_plan(repo_root, str(manifest.get("fixtureId") or ""))})
    elif mode == "fixture-upload-health":
        fixture_id = str(manifest.get("fixtureId") or "")
        ledger = list_placements(repo_root, fixture_id=fixture_id)
        asset_ids = list(dict.fromkeys(
            str(item.get("assetId") or "")
            for item in ledger.get("items") or []
            if item.get("state") == "active" and str(item.get("assetId") or "")
        ))
        result.update({
            "readOnly": True,
            "uploadHealth": {
                "fixtureId": fixture_id,
                "activeAssetCount": len(asset_ids),
                **upload_bridge_plan_db(
                    repo_root,
                    limit=max(1, len(asset_ids)),
                    asset_ids=asset_ids,
                ),
            },
        })
    elif mode == "fixture-deliverable-list":
        result.update({"readOnly": True, "deliverables": list_deliverables(repo_root, str(manifest.get("fixtureId") or ""))})
    elif mode == "fixture-deliverable-link":
        kind = str(manifest.get("kind") or "").strip().lower()
        if kind not in {"pdf", "video", "originals"}:
            raise ValueError("deliverable kind must be pdf, video, or originals")
        result.update({
            "readOnly": False,
            "deliverable": link_deliverable(
                repo_root,
                str(manifest.get("fixtureId") or ""),
                provider=str(manifest.get("provider") or "share-link"),
                external_identity=str(manifest.get("externalIdentity") or ""),
                kind=kind,
                state=str(manifest.get("state") or "ready"),
                recovery=manifest.get("recovery") if isinstance(manifest.get("recovery"), dict) else {},
            ),
            "deliverables": list_deliverables(repo_root, str(manifest.get("fixtureId") or "")),
        })
    elif mode == "fixture-publication-plan":
        result.update({
            "readOnly": True,
            "publication": publication_plan(
                repo_root,
                str(manifest.get("fixtureId") or ""),
                manifest.get("assetIds") or [],
            ),
        })
    elif mode == "fixture-lifecycle-list":
        # Backstage lifecycle browsing is a read-only operation. Compatibility
        # JSON is imported by the explicit migration/write paths; refreshing it
        # here rewrites every discarded row and Owner settings on each list
        # request, which makes a native read mutate the live Owner database.
        lifecycle = media_lifecycle_snapshot(repo_root, sync_compat=False)
        all_states = [
            {
                "mediaId": str(item.get("media_id") or ""),
                "state": str(item.get("lifecycle_state") or ""),
                "title": str(item.get("title") or ""),
                "mediaType": str(item.get("media_type") or ""),
                "sourceSlug": str(item.get("source_slug") or item.get("previous_slug") or ""),
                "hiddenAt": str(item.get("hidden_at") or ""),
                "discardedAt": str(item.get("discarded_at") or ""),
                "restoredAt": str(item.get("restored_at") or ""),
                "updatedAt": str(item.get("updated_at") or ""),
            }
            for item in lifecycle.get("states") or []
            if str(item.get("lifecycle_state") or "") in {"hidden", "discarded"}
        ]
        requested_states = {
            str(value or "").strip()
            for value in (manifest.get("states") or [])
            if str(value or "").strip() in {"hidden", "discarded"}
        }
        states = [
            item for item in all_states
            if not requested_states or item["state"] in requested_states
        ]
        result.update({
            "readOnly": True,
            "lifecycle": {
                "items": states,
                "hiddenCount": sum(item["state"] == "hidden" for item in all_states),
                "discardedCount": sum(item["state"] == "discarded" for item in all_states),
            },
        })
    elif mode == "fixture-upload-run-adoption-plan":
        result.update({
            "readOnly": True,
            "uploadRunAdoption": plan_upload_run_adoption(
                repo_root,
                str(manifest.get("runId") or ""),
                str(manifest.get("fixtureId") or ""),
                historical_backfill=bool(manifest.get("historicalBackfill")),
                revalidate_recorded_content=bool(manifest.get("revalidateRecordedContent")),
                asset_ids=manifest.get("assetIds") or [],
            ),
        })
    elif mode == "fixture-upload-run-adoption-commit":
        result.update({
            "readOnly": False,
            "uploadRunAdoption": adopt_upload_run(
                repo_root,
                str(manifest.get("runId") or ""),
                str(manifest.get("fixtureId") or ""),
                historical_backfill=bool(manifest.get("historicalBackfill")),
                revalidate_recorded_content=bool(manifest.get("revalidateRecordedContent")),
                asset_ids=manifest.get("assetIds") or [],
                actor="owner-connector",
            ),
        })
    elif mode == "fixture-photos-writeback-plan":
        result.update({"readOnly": True, "photosWriteback": writeback_plan(
            repo_root,
            str(manifest.get("fixtureId") or ""),
            manifest.get("assetIds") or [],
            adapter=SignedPhotosBridgeAdapter(repo_root),
        )})
    elif mode == "fixture-photos-writeback-commit":
        result.update({"readOnly": False, "photosWriteback": commit_writeback(repo_root, str(manifest.get("fixtureId") or ""), manifest.get("assetIds") or [])})
    elif mode == "fixture-la-concha-migrate":
        result.update({"readOnly": False, "migration": migrate_la_concha_tree(repo_root)})
    else:
        raise ValueError(f"Unsupported universal fixture mode: {mode or 'missing'}")

    result.setdefault("message", {
        "fixture-tree-list": "Loaded the recursive fixture tree.",
        "fixture-configuration-get": "Loaded the fixture population and policy contract.",
        "fixture-configuration-set": "Saved a revisioned fixture population and policy contract.",
        "fixture-policy-migration-plan": "Prepared the reversible fixture policy migration without changing policy state.",
        "fixture-policy-migration-apply": "Applied the backed-up fixture policy migration and wrote its durable receipt.",
        "fixture-create": "Created the fixture without changing source assets.",
        "fixture-rename": "Renamed the fixture while preserving its stable ID and relationships.",
        "fixture-move": "Moved the fixture without changing its stable ID or source assets.",
        "fixture-archive": "Archived the fixture without deleting its attached state.",
        "fixture-reopen": "Reopened the fixture with its attached state intact.",
        "fixture-search": "Search is read-only. Select candidates to snapshot a culling pool.",
        "fixture-pool-create": "Created a private fixture-scoped culling pool. Nothing was uploaded or messaged.",
        "fixture-pool-open": "Prepared the fixture-scoped Sidecar workspace.",
        "fixture-pool-refresh-preview": "Previewed source-search drift without changing the stable pool.",
        "fixture-pool-refresh-apply": "Created or reused an idempotent refreshed snapshot after explicit preview.",
        "fixture-place": "Recorded reversible fixture placement without copying or deleting source assets.",
        "fixture-place-multi": "Recorded reversible placement in every selected fixture without copying source assets.",
        "fixture-placement-list": "Loaded the placement ledger without changing relationships.",
        "fixture-placement-move": "Rerouted the placement and recorded an auditable move event.",
        "fixture-placement-remove": "Removed the placement relationship without deleting the source asset.",
        "fixture-placement-restore": "Restored the placement relationship without reimporting the source asset.",
        "fixture-destinations": "Configured per-asset delivery destinations.",
        "fixture-delivery-plan": "Prepared the delivery plan; no delivery or client message was triggered.",
        "fixture-upload-health": "Loaded fixture-scoped Upload Bridge queue and R2 coverage health without changing either.",
        "fixture-deliverable-list": "Loaded fixture PDF, video, originals, and share-link records without changing them.",
        "fixture-deliverable-link": "Linked a ready fixture deliverable without sending a client message.",
        "fixture-publication-plan": "Prepared exact public-catalog eligibility without rebuilding or deploying the site.",
        "fixture-lifecycle-list": "Loaded the private lifecycle ledger without changing any media.",
        "fixture-upload-run-adoption-plan": "Previewed the exact completed Upload Bridge items eligible for fixture adoption; nothing changed.",
        "fixture-upload-run-adoption-commit": "Adopted checksum-verified completed upload items into the chosen fixture and reconstructed their R2 receipts.",
        "fixture-photos-writeback-plan": "Prepared the Apple Photos metadata give-back plan without changing Photos.",
        "fixture-photos-writeback-commit": "Committed and verified eligible metadata in Apple Photos. No client message was sent.",
        "fixture-la-concha-migrate": "Created the La Concha target fixture tree without moving source assets.",
        "photos-sync-snapshot": "Imported the incremental Apple Photos snapshot into the version ledger.",
        "photos-sync-run": "Scanned a bounded Apple Photos slice and imported metadata and rendered-image fingerprints.",
        "asset-upload-plan": "Loaded the fixture-scoped approved publication queue without changing any asset.",
        "asset-upload-run-start": "Started a bounded verified upload run. Each successful asset publishes immediately.",
        "asset-upload-run-status": "Loaded current upload and publication progress.",
        "asset-sale-reference-record": "Protected the exact sold source version and object keys.",
        "r2-reconciliation-plan": "Previewed protected, referenced, quarantined, and deletion-eligible R2 objects.",
        "r2-reconciliation-commit": "Applied the guarded two-pass R2 reconciliation.",
    }.get(mode, "Fixture operation completed."))
    return {
        "ok": True,
        "connector": {"id": connector_id, "type": "sidecar-culling-review", "completedAt": completed_at},
        "result": result,
        "preview": preview,
    }


def new_owner_connector_result(repo_root: Path, payload: dict) -> dict:
    action = _new_owner_action_from_payload(payload)
    action_type = str(action.get("type") or action.get("action") or "").strip()
    if action_type != "sidecar-culling-review":
        raise ValueError(f"Unsupported NewOwner connector action: {action_type or 'missing'}")
    if str(action.get("state") or "").strip() not in {"claimed", "completed"}:
        raise ValueError("Sidecar culling connector actions must be claimed or completed before local review.")
    claim = action.get("claim") if isinstance(action.get("claim"), dict) else {}
    connector_id = _clean_connector_id(payload.get("connectorId") or claim.get("connectorId") or "local")
    mode = str(_new_owner_manifest(action).get("mode") or "").strip()
    if mode.startswith("fixture-") or mode in {
        "photos-sync-snapshot",
        "photos-sync-run",
        "asset-upload-plan",
        "asset-upload-run-start",
        "asset-upload-run-status",
        "asset-sale-reference-record",
        "r2-reconciliation-plan",
        "r2-reconciliation-commit",
    }:
        return _new_owner_fixture_pipeline_result(repo_root, action, connector_id)
    if mode.startswith("apple-photos-re-"):
        return _new_owner_apple_photos_real_estate_result(repo_root, action, connector_id)
    return _new_owner_sidecar_culling_review_result(repo_root, action, connector_id)


def new_owner_sidecar_decision_result(repo_root: Path, payload: dict) -> dict:
    asset_id = str(payload.get("assetId") or payload.get("asset_id") or "").strip()
    action = str(payload.get("action") or "").strip().casefold()
    if not asset_id:
        raise ValueError("assetId is required")
    if action not in {"pick", "unpick", "reject", "rating", "color", "approve", "metadata"}:
        raise ValueError("unsupported Sidecar decision action")
    decision_payload = {
        "assetId": asset_id,
        "action": action,
    }
    for key in ["rating", "color", "title", "keywords", "metadataState"]:
        if key in payload:
            decision_payload[key] = payload[key]
    decision = record_sidecar_decision_db(repo_root, decision_payload)
    decision["summary"] = sidecar_summary_db(repo_root)
    decision["source"] = "new-owner-review"
    return decision


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

    _run_publish_command(repo_root, ["node", "scripts/write_catalog_tsv.cjs", "--commerce-only"], steps, "Refresh public catalog commerce", task_id)
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
    return bool(address.is_private or address.is_loopback or address in TAILSCALE_CGNAT_NETWORK)


def _state_groups(repo_root: Path) -> tuple[dict[str, list[dict]], dict[str, list[dict]], dict[str, list[dict]]]:
    site = load_site_data(repo_root)
    expo_groups = {slug: list((site.get("data", {}).get(slug) or {}).get("photos") or []) for slug in ORDER}
    expo_groups["unknown"] = list((site.get("owner", {}).get("unknown") or {}).get("photos") or [])
    reserve_groups = {slug: list((site.get("reserve", {}).get(slug) or {}).get("photos") or []) for slug in ORDER}
    hidden_groups = {slug: list((site.get("hidden", {}).get(slug) or {}).get("photos") or []) for slug in ORDER}
    return expo_groups, reserve_groups, hidden_groups


def _site_state_media_ids(repo_root: Path) -> set[str]:
    try:
        expo_groups, reserve_groups, hidden_groups = _state_groups(repo_root)
    except Exception:
        return set()
    media_ids: set[str] = set()
    for groups in (expo_groups, reserve_groups, hidden_groups):
        for photos in groups.values():
            for photo in photos:
                if not isinstance(photo, dict):
                    continue
                media_id = str(photo.get("id") or "").strip()
                if media_id:
                    media_ids.add(media_id)
    return media_ids


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


def _source_paths_from_upload_bridge_ledger(repo_root: Path, photo_id: str) -> list[str]:
    clean_id = str(photo_id or "").strip()
    if not clean_id:
        return []
    owner_path = repo_root / OWNER_ACTION_ROOT / "Owner.sqlite"
    if not owner_path.exists():
        return []
    try:
        conn = _sqlite_readonly_connect(owner_path)
        try:
            rows = conn.execute(
                """
                SELECT export_path
                FROM sidecar_upload_bridge_run_items
                WHERE photo_id = ?
                  AND COALESCE(export_path, '') <> ''
                  AND COALESCE(export_status, '') = 'materialized'
                ORDER BY updated_at DESC, created_at DESC
                LIMIT 8
                """,
                (clean_id,),
            ).fetchall()
        finally:
            conn.close()
    except sqlite3.Error:
        return []
    paths: list[str] = []
    seen: set[str] = set()
    for row in rows:
        path = str(row["export_path"] or "").strip()
        if path and path not in seen:
            seen.add(path)
            paths.append(path)
    return paths


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


def _lifecycle_blocked_sets_readonly(repo_root: Path) -> dict[str, set[str]]:
    owner_path = repo_root / OWNER_ACTION_ROOT / "Owner.sqlite"
    empty = {"hiddenPhotoIds": set(), "discardedPhotoIds": set(), "blockedPhotoIds": set()}
    if not owner_path.exists():
        return empty
    try:
        conn = _sqlite_readonly_connect(owner_path)
        try:
            rows = conn.execute(
                """
                SELECT media_id, lifecycle_state
                FROM media_lifecycle
                WHERE lifecycle_state IN ('hidden', 'discarded')
                """
            ).fetchall()
        finally:
            conn.close()
    except sqlite3.Error:
        return empty
    hidden_ids = {str(row["media_id"]) for row in rows if row["media_id"] and row["lifecycle_state"] == "hidden"}
    discarded_ids = {str(row["media_id"]) for row in rows if row["media_id"] and row["lifecycle_state"] == "discarded"}
    return {
        "hiddenPhotoIds": hidden_ids,
        "discardedPhotoIds": discarded_ids,
        "blockedPhotoIds": hidden_ids | discarded_ids,
    }


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
    hidden_or_discarded_ids = _lifecycle_blocked_sets_readonly(repo_root)["blockedPhotoIds"]
    blocked_or_parked_ids = {
        photo_id
        for photo_id, state in review_state_by_id.items()
        if state in {"blocked", "parked"}
    } | hidden_or_discarded_ids
    approved_ids = {photo_id for photo_id, state in review_state_by_id.items() if state == "approved"}
    applied_ids = {photo_id for photo_id, state in review_state_by_id.items() if state == "applied"}
    r2_public_ids = r2_ready_ids & public_ids
    limbo_ids = r2_ready_ids - public_ids - blocked_or_parked_ids - approved_ids - applied_ids
    approved_not_applied_ids = approved_ids - public_ids - blocked_or_parked_ids
    r2_approved_not_applied_ids = r2_ready_ids & approved_not_applied_ids
    approved_not_ready_ids = approved_not_applied_ids - r2_ready_ids
    applied_not_public_ids = applied_ids - public_ids - blocked_or_parked_ids
    blocked_ready_ids = r2_ready_ids & blocked_or_parked_ids
    state_counts: dict[str, int] = {}
    for state in review_state_by_id.values():
        state_counts[state] = state_counts.get(state, 0) + 1
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "definitions": {
            "publicApplied": "Rows exported to assets/catalog/photosbyelie.sqlite and visible to end users.",
            "r2ReadyPublic": "Rows with public R2 preview objects that are already visible in the public catalog.",
            "r2ReadyLimbo": "Photos with both public R2 preview objects present, but not public, approved, exported, parked, or blocked.",
            "r2ReadyApprovedNotApplied": "Owner-approved rows with public R2 preview objects that have not yet been exported to the public catalog.",
            "approvedNotApplied": "All Owner-approved rows that have not yet been exported to the public catalog.",
        },
        "publicApplied": {
            "count": len(public_ids),
            "byOrigin": _count_origins(public_ids, origin_by_id),
        },
        "r2ReadyPublic": {
            "count": len(r2_public_ids),
            "byOrigin": _count_origins(r2_public_ids, origin_by_id),
        },
        "r2Ready": {
            "count": len(r2_ready_ids),
            "byOrigin": _count_origins(r2_ready_ids, origin_by_id),
        },
        "r2ReadyLimbo": {
            "count": len(limbo_ids),
            "byOrigin": _count_origins(limbo_ids, origin_by_id),
        },
        "r2ReadyApprovedNotApplied": {
            "count": len(r2_approved_not_applied_ids),
            "byOrigin": _count_origins(r2_approved_not_applied_ids, origin_by_id),
        },
        "approvedNotApplied": {
            "count": len(approved_not_applied_ids),
            "byOrigin": _count_origins(approved_not_applied_ids, origin_by_id),
        },
        "approvedNotReady": {
            "count": len(approved_not_ready_ids),
            "byOrigin": _count_origins(approved_not_ready_ids, origin_by_id),
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


def _owner_burst_parse_timestamp(value: object) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    normalized = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        return parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _owner_burst_manifest_rows(repo_root: Path) -> list[dict]:
    payload = _read_json_file(repo_root / IMPORT_CACHE_MANIFEST_PATH, {})
    rows = payload.get("photos") if isinstance(payload, dict) else []
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict) and str(row.get("id") or "").strip()]


def _owner_burst_source_files(row: dict) -> list[dict]:
    files: list[dict] = []
    source_file = row.get("source_file")
    if isinstance(source_file, dict):
        name = str(source_file.get("name") or Path(str(row.get("relative_path") or "")).name).strip()
        path = str(source_file.get("path") or row.get("source_path_hint") or row.get("relative_path") or name).strip()
        if name or path:
            files.append({"name": name or Path(path).name, "path": path, "type": str(source_file.get("extension") or Path(name or path).suffix).strip(".")})
    for source in row.get("sourceFiles") or []:
        if not isinstance(source, dict):
            continue
        name = str(source.get("name") or Path(str(source.get("path") or "")).name).strip()
        path = str(source.get("path") or name).strip()
        if name or path:
            files.append({"name": name or Path(path).name, "path": path, "type": str(source.get("type") or Path(name or path).suffix).strip(".")})
    if not files:
        path = str(row.get("source_path_hint") or row.get("relative_path") or "").strip()
        if path:
            files.append({"name": Path(path).name, "path": path, "type": Path(path).suffix.strip(".")})
    return files


def _owner_burst_photo_from_row(row: dict) -> dict:
    media = row.get("media") if isinstance(row.get("media"), dict) else {}
    derivatives = row.get("derivatives") if isinstance(row.get("derivatives"), dict) else {}
    slug = "unknown"
    gallery_country = row.get("gallery_country")
    if isinstance(gallery_country, dict):
        slug = str(gallery_country.get("slug") or "unknown")
    return {
        "id": str(row.get("id") or "").strip(),
        "title": _manifest_title(row) or str(row.get("id") or "").strip(),
        "caption": str(row.get("caption") or ""),
        "gallerySrc": derivatives.get("gallery") or row.get("gallerySrc") or "",
        "imageSrc": derivatives.get("detail") or row.get("imageSrc") or "",
        "media": {"type": str(row.get("media_type") or media.get("type") or "photo").strip().lower() or "photo"},
        "sourceFiles": _owner_burst_source_files(row),
        "ownerState": {
            "burstCullMode": "conservative-unapproved-owner-pool",
            "source": IMPORT_CACHE_MANIFEST_PATH.as_posix(),
        },
        "source_slug": slug if slug in ORDER else "unknown",
    }


def _owner_burst_manifest_source_paths(row: dict) -> list[str]:
    paths = []
    for key in ("source_path_hint", "metadata_path_hint", "relative_path"):
        value = str(row.get(key) or "").strip()
        if value:
            paths.append(value)
    for source in _owner_burst_source_files(row):
        path = str(source.get("path") or "").strip()
        if path:
            paths.append(path)
    seen = set()
    unique = []
    for path in paths:
        if path in seen:
            continue
        unique.append(path)
        seen.add(path)
    return unique


def _owner_burst_is_standard_photo(row: dict) -> tuple[bool, str]:
    media_type = str(row.get("media_type") or (row.get("media") or {}).get("type") or "photo").strip().lower()
    if media_type != "photo":
        return False, "non-photo asset"
    filenames = [str(source.get("name") or source.get("path") or "") for source in _owner_burst_source_files(row)]
    joined = " ".join([str(row.get("relative_path") or ""), str(row.get("source_path_hint") or ""), *filenames]).casefold()
    if re.search(r"(^|[._\\/-])(xmp|aae|dop|pp3)($|[._\\/-])", joined):
        return False, "sidecar asset"
    if any(marker in joined for marker in ("pixelmator", "edited", "-edit", "_edit", "/edit", ".edit", "derivative")):
        return False, "edited derivative"
    extensions = {Path(name).suffix.casefold().lstrip(".") for name in filenames if Path(name).suffix}
    if extensions and not extensions <= {"jpg", "jpeg", "tif", "tiff", "png", "heic", "heif"}:
        return False, "non-standard photo extension"
    dimensions = row.get("dimensions") if isinstance(row.get("dimensions"), dict) else {}
    width = float(dimensions.get("width") or 0)
    height = float(dimensions.get("height") or 0)
    if width > 0 and height > 0:
        ratio = max(width / height, height / width)
        if ratio >= 2.0:
            return False, "panorama-like aspect ratio"
    return True, ""


def _owner_burst_has_keep_marker(row: dict) -> bool:
    values = [
        row.get("label"),
        row.get("rating"),
        row.get("review_state"),
        row.get("owner_state"),
        row.get("ownerState"),
        row.get("flags"),
        row.get("keywords"),
        row.get("metadata"),
    ]
    text = json.dumps(values, ensure_ascii=False, sort_keys=True, default=str).casefold()
    return any(marker in text for marker in BURST_CULL_KEEP_MARKERS)


def _owner_burst_candidate_records(repo_root: Path, protected_ids: list[str] | None = None) -> tuple[list[dict], list[dict]]:
    rows = _owner_burst_manifest_rows(repo_root)
    client_protected_ids = set(protected_ids or [])
    public_ids = set(_public_catalog_origin_by_id(repo_root))
    review_state_by_id = _title_keyword_state_by_id(repo_root)
    lifecycle_sets = _lifecycle_blocked_sets_readonly(repo_root)
    blocked_ids = lifecycle_sets["blockedPhotoIds"]
    records: list[dict] = []
    protected: list[dict] = []
    for index, row in enumerate(rows):
        media_id = str(row.get("id") or "").strip()
        timestamp_text = _manifest_capture(row)
        timestamp = _owner_burst_parse_timestamp(timestamp_text)
        title = _manifest_title(row) or media_id
        base = {
            "photo_id": media_id,
            "title": title,
            "captured_at": timestamp_text,
            "source": str(row.get("relative_path") or row.get("source_path_hint") or ""),
            "original_index": index,
        }
        reasons = []
        if media_id in client_protected_ids:
            reasons.append("liked/basket/order protected")
        if media_id in public_ids:
            reasons.append("approved/public catalog")
        review_state = review_state_by_id.get(media_id, "")
        if review_state in {"approved", "applied"}:
            reasons.append(f"review {review_state}")
        elif review_state in {"blocked", "parked"}:
            reasons.append(f"review {review_state}")
        if media_id in blocked_ids:
            reasons.append("already in Waste Basket/discarded")
        standard, standard_reason = _owner_burst_is_standard_photo(row)
        if not standard:
            reasons.append(standard_reason)
        if _owner_burst_has_keep_marker(row):
            reasons.append("manual/review keep marker")
        if not timestamp:
            reasons.append("missing capture timestamp")
        if reasons:
            protected.append({**base, "outcome": "protected-skip", "reason": "; ".join(reasons)})
            continue
        records.append({
            **base,
            "timestamp": timestamp,
            "timestamp_epoch": timestamp.timestamp(),
            "row": row,
            "outcome": "non-burst-keep",
            "burst_id": "",
            "burst_position": None,
            "burst_size": None,
        })
    records.sort(key=lambda item: (item["timestamp"], item["photo_id"]))
    return records, protected


def _owner_burst_survivor_positions(size: int) -> set[int]:
    if size <= 1:
        return {1}
    if size <= 5:
        return {2}
    return set(range(2, size + 1, 4))


def owner_burst_cull_preview(repo_root: Path, protected_ids: list[str] | None = None) -> dict:
    records, protected = _owner_burst_candidate_records(repo_root, protected_ids)
    groups: list[list[dict]] = []
    current: list[dict] = []
    previous: dict | None = None
    for record in records:
        if previous and (record["timestamp"] - previous["timestamp"]).total_seconds() < 1:
            current.append(record)
        else:
            if current:
                groups.append(current)
            current = [record]
        previous = record
    if current:
        groups.append(current)

    burst_groups = []
    candidates = []
    reject_count = 0
    survivor_count = 0
    non_burst_count = 0
    for group_index, group in enumerate(groups, start=1):
        if len(group) == 1:
            item = group[0]
            item["outcome"] = "non-burst-keep"
            non_burst_count += 1
            candidates.append({key: value for key, value in item.items() if key not in {"timestamp", "row"}})
            continue
        burst_id = f"burst-{group_index:05d}"
        survivor_positions = _owner_burst_survivor_positions(len(group))
        survivor_ids = []
        reject_ids = []
        for position, item in enumerate(group, start=1):
            keep = position in survivor_positions
            item["burst_id"] = burst_id
            item["burst_position"] = position
            item["burst_size"] = len(group)
            item["outcome"] = "survivor-keep" if keep else "waste-basket"
            if keep:
                survivor_count += 1
                survivor_ids.append(item["photo_id"])
            else:
                reject_count += 1
                reject_ids.append(item["photo_id"])
            candidates.append({key: value for key, value in item.items() if key not in {"timestamp", "row"}})
        burst_groups.append({
            "burst_id": burst_id,
            "size": len(group),
            "start": group[0]["captured_at"],
            "end": group[-1]["captured_at"],
            "survivor_ids": survivor_ids,
            "reject_ids": reject_ids,
            "photo_ids": [item["photo_id"] for item in group],
        })

    counts = {
        "pool": len(records) + len(protected),
        "eligible": len(records),
        "protected_skips": len(protected),
        "burst_groups": len(burst_groups),
        "survivors": survivor_count,
        "non_burst_kept": non_burst_count,
        "waste_basket_moves": reject_count,
        "failures": 0,
    }
    return {
        "format": "photosbyelie-owner-burst-cull-preview",
        "schema_version": 1,
        "mode": "conservative-unapproved-owner-pool",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": IMPORT_CACHE_MANIFEST_PATH.as_posix(),
        "counts": counts,
        "burst_groups": burst_groups,
        "candidates": candidates,
        "protected": protected,
    }


def owner_burst_cull_run(repo_root: Path, protected_ids: list[str] | None = None) -> dict:
    preview = owner_burst_cull_preview(repo_root, protected_ids)
    reject_ids = {
        str(item.get("photo_id") or "")
        for item in preview.get("candidates") or []
        if item.get("outcome") == "waste-basket"
    }
    rows_by_id = {
        str(row.get("id") or "").strip(): row
        for row in _owner_burst_manifest_rows(repo_root)
        if str(row.get("id") or "").strip() in reject_ids
    }
    timestamp = datetime.now(timezone.utc).isoformat()
    entries = []
    outcomes = []
    failures = []
    for item in preview.get("candidates") or []:
        photo_id = str(item.get("photo_id") or "")
        if item.get("outcome") != "waste-basket":
            outcomes.append({**item, "applied": False})
            continue
        row = rows_by_id.get(photo_id)
        if not row:
            failures.append({"photo_id": photo_id, "error": "manifest row not found"})
            outcomes.append({**item, "applied": False, "error": "manifest row not found"})
            continue
        photo = _owner_burst_photo_from_row(row)
        slug = str(photo.get("source_slug") or "unknown")
        entries.append({
            "id": photo_id,
            "title": photo.get("title") or photo_id,
            "discarded_at": timestamp,
            "from_state": "active",
            "from_slug": slug,
            "source_slug": slug,
            "media_type": _photo_media_type(photo),
            "asset_paths": _photo_asset_paths(photo),
            "source_paths": _owner_burst_manifest_source_paths(row),
            "public_preview_keys": _hidden_public_preview_keys(photo, slug),
            "private_keys": _discarded_private_keys(photo),
        })
        outcomes.append({**item, "applied": True})

    if entries:
        _record_discarded_lifecycle(repo_root, entries)
        _write_discarded_tombstones(repo_root, entries)

    counts = dict(preview["counts"])
    counts["failures"] = len(failures)
    counts["waste_basket_moves"] = len(entries)
    return {
        "format": "photosbyelie-owner-burst-cull-result",
        "schema_version": 1,
        "mode": preview["mode"],
        "generated_at": timestamp,
        "counts": counts,
        "burst_groups": preview.get("burst_groups") or [],
        "outcomes": outcomes,
        "protected": preview.get("protected") or [],
        "failures": failures,
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
        "previous_keywords": current,
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


def _ensure_catalog_keyword_ids(conn: sqlite3.Connection, keywords: list[str]) -> str:
    ids: list[str] = []
    seen: set[str] = set()
    for keyword in _unique_keywords(keywords):
        clean = str(keyword or "").strip()
        normalized = clean.casefold()
        if not clean or normalized in seen:
            continue
        seen.add(normalized)
        row = conn.execute("SELECT keyword_id FROM keyword_terms WHERE keyword = ?", (clean,)).fetchone()
        if row:
            keyword_id = int(row["keyword_id"] if isinstance(row, sqlite3.Row) else row[0])
        else:
            keyword_id = int(conn.execute("SELECT COALESCE(MAX(keyword_id), 0) + 1 FROM keyword_terms").fetchone()[0])
            conn.execute("INSERT INTO keyword_terms(keyword_id, keyword) VALUES (?, ?)", (keyword_id, clean))
        ids.append(str(keyword_id))
    return ",".join(ids)


def _update_public_catalog_metadata(
    repo_root: Path,
    media_id: str,
    title: str,
    caption: str,
    keywords: list[str],
) -> dict:
    clean_id = str(media_id or "").strip()
    catalog_path = repo_root / "assets/catalog/photosbyelie.sqlite"
    if not clean_id or not catalog_path.exists():
        return {"updated": 0, "path": str(catalog_path)}
    conn = sqlite3.connect(catalog_path)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            "SELECT media_id, title, description, keyword_ids FROM media_items WHERE media_id = ?",
            (clean_id,),
        ).fetchone()
        if not row:
            return {"updated": 0, "path": str(catalog_path)}
        previous = {
            "photo_id": clean_id,
            "title": str(row["title"] or ""),
            "caption": str(row["description"] or ""),
            "keywords": _catalog_keywords(row["keyword_ids"], _catalog_keyword_lookup(conn)),
        }
        keyword_ids = _ensure_catalog_keyword_ids(conn, keywords)
        updated_at = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE media_items SET title = ?, description = ?, keyword_ids = ?, updated_at = ? WHERE media_id = ?",
            (title, caption or None, keyword_ids or None, updated_at, clean_id),
        )
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"catalog integrity_check failed: {integrity}")
        conn.commit()
        return {
            "updated": 1,
            "path": str(catalog_path),
            "keyword_ids": keyword_ids,
            "previous": previous,
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


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


def _manifest_location(row: dict) -> str:
    location = row.get("location")
    if isinstance(location, dict):
        parts = []
        seen = set()
        for key in ("location", "city", "region", "country"):
            value = str(location.get(key) or "").strip()
            comparable = value.casefold()
            if value and comparable not in seen:
                parts.append(value)
                seen.add(comparable)
        if parts:
            return ", ".join(parts)
        return _metadata_label_value(row, "Location")
    if isinstance(location, str) and location.strip():
        return str(location).strip()
    return _metadata_label_value(row, "Location")


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
        "location": _manifest_location(row),
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
    writeback_ids = _site_state_media_ids(repo_root)
    r2_ready_ids = _current_public_preview_ready_ids(repo_root)
    candidates: list[dict] = []
    for row in photos:
        if not isinstance(row, dict):
            continue
        media_id = str(row.get("id") or "").strip()
        if (
            not media_id
            or media_id in excluded_ids
            or media_id in blocked_ids
            or media_id not in writeback_ids
            or media_id not in r2_ready_ids
        ):
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


def _manifest_all_photo_rows(repo_root: Path) -> list[dict]:
    payload = _read_json_file(repo_root / IMPORT_CACHE_MANIFEST_PATH, {})
    photos = payload.get("photos") if isinstance(payload, dict) else []
    if not isinstance(photos, list):
        return []
    return [row for row in photos if isinstance(row, dict)]


def _manifest_row_source_paths(row: dict) -> list[str]:
    paths: list[str] = []

    def add(value: object) -> None:
        text = str(value or "").strip()
        if text and text not in paths:
            paths.append(text)

    for key in ("source_path_hint", "metadata_path_hint", "relative_path"):
        add(row.get(key))
    source_file = row.get("source_file") if isinstance(row.get("source_file"), dict) else {}
    for key in ("path", "original_path", "source_path", "metadata_path"):
        add(source_file.get(key))
    for source in row.get("sourceFiles") or []:
        if not isinstance(source, dict):
            continue
        for key in ("path", "original_path", "source_path"):
            add(source.get(key))
    return paths


def _manifest_row_matches_source_root(row: dict, source_root: Path | None) -> bool:
    if source_root is None:
        return True
    root = source_root.expanduser().resolve(strict=False)
    for path_text in _manifest_row_source_paths(row):
        candidate = Path(path_text).expanduser()
        if not candidate.is_absolute():
            continue
        try:
            candidate.resolve(strict=False).relative_to(root)
        except ValueError:
            continue
        return True
    return False


def _manifest_apple_photos_album(row: dict) -> str:
    source_file = row.get("source_file") if isinstance(row.get("source_file"), dict) else {}
    candidates = [
        source_file.get("apple_photos_album"),
        source_file.get("apple_photos"),
        row.get("apple_photos_album"),
        row.get("apple_photos"),
        row.get("album"),
        row.get("albumName"),
        row.get("album_name"),
        _metadata_label_value(row, "Apple Photos album"),
    ]
    for candidate in candidates:
        if isinstance(candidate, dict):
            text = str(candidate.get("title") or candidate.get("name") or "").strip()
        else:
            text = str(candidate or "").strip()
        if text:
            return text
    return ""


def _review_album_title(album_name: str) -> str:
    title = str(album_name or "").strip()
    if not title:
        return ""
    without_year = re.sub(r"^\s*(?:19|20)\d{2}\s+[-–—]?\s*", "", title).strip()
    return without_year or title


def _album_keyword_candidates(album_name: str) -> list[str]:
    clean_album = str(album_name or "").strip()
    if not clean_album:
        return []
    candidates = [clean_album]
    for part in re.split(r"[,/|;]+|\s+-\s+", clean_album):
        part = re.sub(r"^\s*(?:19|20)\d{2}\s+", "", part).strip(" ._-")
        if part and not re.fullmatch(r"(?:19|20)\d{2}", part):
            candidates.append(part)
    return candidates


def _manifest_import_review_keywords(repo_root: Path, row: dict, catalog: dict) -> list[str]:
    keywords: list[str] = []
    current_keywords = catalog.get("keywords") if isinstance(catalog.get("keywords"), list) else []
    keywords.extend(str(keyword) for keyword in current_keywords)

    album_name = _manifest_apple_photos_album(row)
    keywords.extend(_album_keyword_candidates(album_name))

    location = _manifest_location(row)
    if location:
        keywords.extend(part.strip() for part in re.split(r"[,/;]+", location) if part.strip())

    gallery_key = str(catalog.get("gallery_key") or "").strip()
    gallery_label = str(catalog.get("gallery_label") or "").strip()
    if gallery_key and gallery_key != "unknown" and gallery_label:
        keywords.append(gallery_label)

    capture = row.get("capture") if isinstance(row.get("capture"), dict) else {}
    year = str(capture.get("year") or "") or _manifest_capture(row)[:4]
    if re.fullmatch(r"(?:19|20)\d{2}", year):
        keywords.append(year)

    return _review_keywords(repo_root, keywords)


def _manifest_import_review_photo(repo_root: Path, row: dict, batch_id: str, source_label: str) -> dict:
    catalog = _manifest_catalog_row(row)
    photo = _title_keyword_backlog_photo(catalog, batch_id, "proposed")
    album_name = _manifest_apple_photos_album(row)
    proposed_title = _review_album_title(album_name) or _manifest_location(row) or str(catalog.get("title") or "")
    proposed_keywords = _manifest_import_review_keywords(repo_root, row, catalog)
    model = "apple-photos-import-context-v1" if album_name else "metadata-baseline-v1"
    reason = "Seeded from the Apple Photos import sidecar before public catalog publication."
    if album_name:
        reason = f"Seeded from Apple Photos album \"{album_name}\" before public catalog publication."
    photo["proposed"] = {
        **photo.get("proposed", {}),
        "title": proposed_title,
        "keywords": proposed_keywords,
        "status": "apple_photos_album_context" if album_name else "metadata_baseline",
        "confidence": "medium",
        "reason": reason,
        "generator": {
            "model": model,
            "model_level": 0,
            "model_maxed": False,
            "model_ladder": [model],
        },
    }
    photo["state"] = {
        **photo.get("state", {}),
        "review_state": "proposed",
        "requested_generator": {
            "model": model,
            "model_level": 0,
            "model_maxed": False,
            "model_ladder": [model],
        },
    }
    photo["changes"] = {
        **photo.get("changes", {}),
        "keyword_target": 8,
        "keyword_target_met": len(proposed_keywords) >= 8,
    }
    source_file = row.get("source_file") if isinstance(row.get("source_file"), dict) else {}
    source_path = str(source_file.get("path") or row.get("source_path_hint") or "").strip()
    source_type = str(source_file.get("extension") or Path(source_path).suffix.lstrip(".") or "").strip().upper()
    source = dict(photo.get("source") if isinstance(photo.get("source"), dict) else {})
    source["file"] = {
        **(source.get("file") if isinstance(source.get("file"), dict) else {}),
        "path": source_path or (source.get("file") or {}).get("path", ""),
        "type": source_type or (source.get("file") or {}).get("type", ""),
        "bytes": int(source_file.get("bytes") or (source.get("file") or {}).get("bytes") or 0),
    }
    source["album"] = album_name
    source["source_label"] = source_label
    source["media_type"] = str(catalog.get("media_type") or "photo")
    photo["source"] = source
    return photo


def queue_import_cache_title_keyword_review(
    repo_root: Path,
    *,
    source_root: Path | None = None,
    source_label: str = "",
    limit: int = 0,
) -> dict:
    """Queue R2-ready import-cache rows for title/keyword review before catalog publication."""
    rows = _manifest_all_photo_rows(repo_root)
    queue_states = _title_keyword_state_by_id(repo_root)
    blocked_ids = _lifecycle_blocked_ids(repo_root)
    r2_ready_ids = _current_public_preview_ready_ids(repo_root)
    selected: list[dict] = []
    skipped = {
        "outside_source": 0,
        "missing_id": 0,
        "blocked": 0,
        "already_reviewed_or_pending": 0,
        "not_import_eligible": 0,
        "not_public_preview_allowed": 0,
        "not_r2_ready": 0,
    }
    for row in rows:
        if not _manifest_row_matches_source_root(row, source_root):
            skipped["outside_source"] += 1
            continue
        media_id = str(row.get("id") or "").strip()
        if not media_id:
            skipped["missing_id"] += 1
            continue
        if media_id in blocked_ids:
            skipped["blocked"] += 1
            continue
        if queue_states.get(media_id, "") in {"proposed", "approved", "applied", "parked", "blocked"}:
            skipped["already_reviewed_or_pending"] += 1
            continue
        if not row_import_eligible(row)[0]:
            skipped["not_import_eligible"] += 1
            continue
        if not public_preview_allowed(row):
            skipped["not_public_preview_allowed"] += 1
            continue
        if media_id not in r2_ready_ids:
            skipped["not_r2_ready"] += 1
            continue
        selected.append(row)

    selected.sort(key=lambda row: (_manifest_capture(row), str(row.get("relative_path") or row.get("id") or "")))
    if limit > 0:
        selected = selected[:limit]
    if not selected:
        return {
            "queued": 0,
            "photo_count": 0,
            "batch_id": "",
            "path": "",
            "latest_path": "",
            "source_root": str(source_root) if source_root else "",
            "skipped": skipped,
        }

    now = datetime.now(timezone.utc)
    source_name = source_label or (source_root.name if source_root else "import-cache")
    slug = re.sub(r"[^a-z0-9]+", "-", source_name.casefold()).strip("-")[:40] or "import-cache"
    batch_id = f"import-title-keyword-review-{now.strftime('%Y%m%dT%H%M%SZ')}-{slug}-{uuid.uuid4().hex[:6]}"
    generated_at = now.isoformat()
    photos = [_manifest_import_review_photo(repo_root, row, batch_id, source_name) for row in selected]
    capture_values = [value for value in (_capture_sort_value(item) for item in photos) if value]
    queue_root = repo_root / TITLE_KEYWORD_REVIEW_ROOT
    batch_path = queue_root / f"batch-{batch_id}.json"
    latest_path = queue_root / "latest.json"
    payload = {
        "ok": True,
        "format": "photosbyelie-title-keyword-review-queue",
        "schema_version": 1,
        "queue_source": "import-cache-selected-source",
        "source_of_truth": OWNER_ACTION_ROOT.joinpath("Owner.sqlite").as_posix(),
        "batch_id": batch_id,
        "generated_at": generated_at,
        "source": {
            "label": source_name,
            "source_root": str(source_root) if source_root else "",
            "manifest": IMPORT_CACHE_MANIFEST_PATH.as_posix(),
        },
        "proposal_files": {"batch": batch_path.relative_to(repo_root).as_posix()},
        "selection": {
            "total_count": len(photos),
            "visible_pending_count": len(photos),
            "candidate_count": len(selected),
            "r2_ready_count": len(r2_ready_ids),
            "source_root": str(source_root) if source_root else "",
            "skipped": skipped,
        },
        "range": {
            "newest": max(capture_values) if capture_values else "",
            "oldest": min(capture_values) if capture_values else "",
        },
        "photos": photos,
    }
    _write_json_file(batch_path, payload)
    _write_json_file(latest_path, payload)
    db_result = import_title_keyword_batch_file_db(repo_root, batch_path)
    return {
        "queued": len(photos),
        "photo_count": len(photos),
        "batch_id": batch_id,
        "path": batch_path.relative_to(repo_root).as_posix(),
        "latest_path": latest_path.relative_to(repo_root).as_posix(),
        "source_root": str(source_root) if source_root else "",
        "skipped": skipped,
        "db": db_result.get("db", ""),
        "review_url": "./owner-review.html?view=title-keywords",
    }


def title_keyword_review_queue_payload(
    repo_root: Path,
    *,
    include_backlog: bool = True,
    run_maintenance: bool = True,
) -> dict:
    conn = owner_db_connect(repo_root)
    try:
        stale_cleanup = (
            _clear_stale_title_keyword_review_rows(repo_root, conn)
            if run_maintenance
            else {"blocked": 0, "not_found": 0}
        )
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
        backlog_photos, backlog_total_count = (
            _incomplete_title_keyword_backlog_photos(repo_root, conn, covered_ids)
            if include_backlog
            else ([], 0)
        )
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


def _normalize_title_keyword_approvals(repo_root: Path, batch_id: str, approvals: object) -> list[dict]:
    if not isinstance(approvals, list):
        raise ValueError("approvals must be a JSON list")
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
        normalized.append(
            {
                "photo_id": current_photo_id,
                "batch_id": _review_item_batch_id(item, batch_id),
                "approved": True,
                "title": title,
                "keywords": _review_keywords(repo_root, item.get("keywords")),
            }
        )
    return normalized


def _normalize_title_keyword_rejections(repo_root: Path, batch_id: str, rejections: object) -> list[dict]:
    if not isinstance(rejections, list):
        raise ValueError("rejections must be a JSON list")
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
    return normalized_rejections


def _pending_approved_title_keyword_approvals(repo_root: Path) -> list[dict]:
    conn = owner_db_connect(repo_root)
    try:
        rows = conn.execute(
            """
            SELECT q.media_id, q.latest_proposed_batch_id AS batch_id,
                   d.decided_title, d.decided_keywords
            FROM title_keyword_queue AS q
            JOIN title_keyword_decisions AS d
              ON d.media_id = q.media_id
             AND d.attempt = q.latest_attempt
            WHERE q.review_state = 'approved'
              AND d.decision_state = 'accepted'
              AND COALESCE(d.applied_at, '') = ''
            ORDER BY COALESCE(d.decided_at, q.reviewed_at, q.updated_at, ''), q.media_id
            """
        ).fetchall()
    finally:
        conn.close()
    approvals = []
    for row in rows:
        media_id = str(row["media_id"] or "").strip()
        if not media_id:
            continue
        title = str(row["decided_title"] or "").strip()
        if not title:
            raise ValueError(f"approved title must be non-empty for {media_id}")
        approvals.append(
            {
                "photo_id": media_id,
                "batch_id": str(row["batch_id"] or "approved-pending-auto-apply").strip() or "approved-pending-auto-apply",
                "approved": True,
                "title": title,
                "keywords": _review_keywords(repo_root, row["decided_keywords"]),
            }
        )
    return approvals


def _apply_title_keyword_review_approval_payload(
    repo_root: Path,
    *,
    action: str,
    batch_id: str,
    approvals: list[dict],
    rejections: list[dict],
    allow_empty: bool = False,
    fail_on_not_found: bool = False,
) -> dict:
    rejected_ids = {item["photo_id"] for item in rejections}
    normalized = [item for item in approvals if item["photo_id"] not in rejected_ids]
    if not normalized and not rejections:
        if allow_empty:
            return {
                "ok": True,
                "action": action,
                "batch_id": batch_id,
                "path": "",
                "paths": [],
                "db": "",
                "approved_count": 0,
                "rejected_count": 0,
                "blocked_count": 0,
                "applied_count": 0,
                "metadata_changed": 0,
                "not_found": [],
                "updated": [],
                "review_flag": TITLE_KEYWORD_REVIEW_FLAG,
                "proposal_state_flag": TITLE_KEYWORD_PROPOSED_FLAG,
                "rejection_flag": TITLE_KEYWORD_REJECTED_FLAG,
                "worker_catalog": {},
                "site": {},
            }
        raise ValueError("approvals must include at least one approved or rejected photo")

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
    pre_catalog_not_found = _pre_catalog_review_ready_ids(repo_root, not_found)
    hard_not_found = [media_id for media_id in not_found if media_id not in pre_catalog_not_found]
    if fail_on_not_found and hard_not_found:
        preview = ", ".join(hard_not_found[:10])
        suffix = "..." if len(hard_not_found) > 10 else ""
        raise ValueError(f"Could not auto-apply approved title/keyword rows because {len(hard_not_found)} photo(s) were not found: {preview}{suffix}")

    site_state = {}
    worker_catalog = {}
    if normalized and updated:
        site_state, worker_catalog = _write_catalog_state(repo_root, expo_groups, reserve_groups, hidden_groups)

    decided_at = datetime.now(timezone.utc).isoformat()
    not_found_records = _review_record_not_found(hard_not_found, normalized, batch_id)
    save_result = _save_title_keyword_review_records(
        repo_root,
        fallback_batch_id=batch_id,
        approvals=normalized,
        rejections=rejections,
        blocked=[],
        not_found=not_found_records,
        review_flag=TITLE_KEYWORD_REVIEW_FLAG,
        applied_at=decided_at if normalized else "",
        decided_at=decided_at,
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
        "hard_not_found": hard_not_found,
        "pre_catalog_not_found": sorted(pre_catalog_not_found),
        "updated": updated,
        "review_flag": TITLE_KEYWORD_REVIEW_FLAG,
        "proposal_state_flag": TITLE_KEYWORD_PROPOSED_FLAG,
        "rejection_flag": TITLE_KEYWORD_REJECTED_FLAG,
        "worker_catalog": worker_catalog,
        "site": site_state,
    }


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


def _set_photo_caption(photo: dict, caption: str) -> bool:
    caption = str(caption or "").strip()
    changed = str(photo.get("caption") or "") != caption
    photo["caption"] = caption
    changed = _set_metadata_value(photo, "Caption", caption) or changed
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


def _pre_catalog_review_ready_ids(repo_root: Path, media_ids: list[str]) -> set[str]:
    manifest_rows = _manifest_rows_by_media_id(repo_root, media_ids)
    if not manifest_rows:
        return set()
    r2_ready_ids = _current_public_preview_ready_ids(repo_root)
    return {media_id for media_id in manifest_rows if media_id in r2_ready_ids}


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

    upload_bridge_raw_start = len(raw_paths)
    if photo_id:
        for raw_path in _source_paths_from_upload_bridge_ledger(repo_root, photo_id):
            add_raw_path(raw_path)
    append_existing_paths(raw_paths[upload_bridge_raw_start:])
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


def _source_preview_public_fallback(repo_root: Path, photo: dict, media_id: str, media_type: str) -> dict | None:
    preview = photo.get("media", {}).get("publicPreview") if isinstance(photo.get("media"), dict) else {}
    if not isinstance(preview, dict) or preview.get("allowed") is False:
        return None
    key = str(preview.get("detailKey") or preview.get("galleryKey") or "").strip().lstrip("/")
    if not key or "\\" in key or ".." in key.split("/"):
        return None
    public_url = f"{PUBLIC_MEDIA_BASE_URL.rstrip('/')}/{key}"
    return {
        "ok": True,
        "mediaId": media_id,
        "mediaType": media_type,
        "sourceType": "public preview fallback",
        "sourceLabel": public_url,
        "previewUrl": public_url,
        "contentType": mimetypes.guess_type(key)[0] or ("video/mp4" if media_type == "video" else "image/jpeg"),
        "isOriginal": False,
    }


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
        fallback = _source_preview_public_fallback(repo_root, photo, clean_id, media_type)
        if fallback:
            return fallback
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


def _import_source_kind(value: object) -> str:
    kind = str(value or "expo").strip().lower().replace("-", "_")
    if kind in {"real_estate", "re"}:
        return "real_estate"
    if kind in {"", "expo"}:
        return "expo"
    raise ValueError("kind must be expo or real-estate")


def _import_source_history_path(value: object) -> str:
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("path is required")
    try:
        return str(Path(raw).expanduser().resolve())
    except OSError:
        return str(Path(raw).expanduser())


def _import_source_requires_review(repo_root: Path, kind: str, path: Path) -> bool:
    normalized_path = _import_source_history_path(path)
    conn = owner_db_connect(repo_root)
    try:
        _migrate_import_source_settings(repo_root, conn)
        row = conn.execute(
            "SELECT review_required, legacy_source FROM import_source_history WHERE source_kind = ? AND path = ?",
            (kind, normalized_path),
        ).fetchone()
    finally:
        conn.close()
    if row and "apple-photos" in str(row["legacy_source"] or ""):
        return False
    return bool(row and row["review_required"])


def _import_source_entry(
    path: Path,
    *,
    last_used_at: str = "",
    use_count: int = 0,
    discovered: bool = False,
    pinned: bool = False,
    review_required: bool = False,
    review_completed_at: str = "",
    removed_at: str = "",
    legacy_source: str = "",
) -> dict:
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
        "pinned": bool(pinned),
        "reviewRequired": bool(review_required),
        "reviewCompletedAt": str(review_completed_at or ""),
        "removedAt": str(removed_at or ""),
        "legacySource": str(legacy_source or ""),
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


def _read_legacy_import_source_setting(repo_root: Path, setting_key: str = IMPORT_SOURCE_SETTINGS_KEY) -> list[dict]:
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


def _migrate_import_source_settings(repo_root: Path, conn: sqlite3.Connection) -> None:
    marker = conn.execute(
        "SELECT setting_value FROM owner_settings WHERE setting_key = ?",
        ("import_source_history_migrated_v1",),
    ).fetchone()
    if marker:
        return
    now = datetime.now(timezone.utc).isoformat()
    for setting_key, source_kind in (
        (IMPORT_SOURCE_SETTINGS_KEY, "expo"),
        (REAL_ESTATE_IMPORT_SOURCE_SETTINGS_KEY, "real_estate"),
    ):
        row = conn.execute(
            "SELECT setting_value FROM owner_settings WHERE setting_key = ?",
            (setting_key,),
        ).fetchone()
        if not row:
            continue
        try:
            payload = json.loads(row["setting_value"] or "[]")
        except json.JSONDecodeError:
            payload = []
        if not isinstance(payload, list):
            continue
        for item in payload:
            if isinstance(item, str):
                path = item
                label = ""
                last_used_at = ""
                use_count = 0
            elif isinstance(item, dict):
                path = str(item.get("path") or "")
                label = str(item.get("label") or "")
                last_used_at = str(item.get("lastUsedAt") or "")
                use_count = int(item.get("useCount") or 0)
            else:
                continue
            path = path.strip()
            if not path:
                continue
            normalized_path = _import_source_history_path(path)
            conn.execute(
                """
                INSERT INTO import_source_history (
                  source_kind, path, label, pinned, removed_at, review_required,
                  review_completed_at, legacy_source, first_seen_at, last_used_at,
                  use_count, updated_at
                )
                VALUES (?, ?, ?, 0, NULL, 1, NULL, ?, ?, ?, ?, ?)
                ON CONFLICT(source_kind, path) DO UPDATE SET
                  label = COALESCE(NULLIF(import_source_history.label, ''), excluded.label),
                  review_required = CASE
                    WHEN import_source_history.review_completed_at IS NULL THEN 1
                    ELSE import_source_history.review_required
                  END,
                  legacy_source = COALESCE(import_source_history.legacy_source, excluded.legacy_source),
                  first_seen_at = COALESCE(import_source_history.first_seen_at, excluded.first_seen_at),
                  last_used_at = COALESCE(import_source_history.last_used_at, excluded.last_used_at),
                  use_count = MAX(import_source_history.use_count, excluded.use_count),
                  updated_at = excluded.updated_at
                """,
                (
                    source_kind,
                    normalized_path,
                    label or _import_source_label(Path(normalized_path)),
                    f"owner_settings:{setting_key}",
                    now,
                    last_used_at or None,
                    max(0, use_count),
                    now,
                ),
            )
    conn.execute(
        """
        INSERT INTO owner_settings (setting_key, setting_value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(setting_key) DO UPDATE SET
          setting_value = excluded.setting_value,
          updated_at = excluded.updated_at
        """,
        ("import_source_history_migrated_v1", "true", now),
    )


def _read_import_source_setting(repo_root: Path, setting_key: str = IMPORT_SOURCE_SETTINGS_KEY) -> list[dict]:
    kind = "real_estate" if setting_key == REAL_ESTATE_IMPORT_SOURCE_SETTINGS_KEY else "expo"
    conn = owner_db_connect(repo_root)
    try:
        _migrate_import_source_settings(repo_root, conn)
        conn.commit()
        rows = conn.execute(
            """
            SELECT source_kind, path, label, pinned, removed_at, review_required,
                   review_completed_at, legacy_source, first_seen_at, last_used_at,
                   use_count, updated_at
              FROM import_source_history
             WHERE source_kind = ?
               AND removed_at IS NULL
            """,
            (kind,),
        ).fetchall()
    finally:
        conn.close()
    entries: list[dict] = []
    for row in rows:
        entry = _import_source_entry(
            Path(row["path"]),
            last_used_at=str(row["last_used_at"] or ""),
            use_count=int(row["use_count"] or 0),
            pinned=bool(row["pinned"]),
            review_required=bool(row["review_required"]),
            review_completed_at=str(row["review_completed_at"] or ""),
            removed_at=str(row["removed_at"] or ""),
            legacy_source=str(row["legacy_source"] or ""),
        )
        if row["label"]:
            entry["label"] = str(row["label"])
        entries.append(entry)
    return entries


def _write_import_source_setting(repo_root: Path, entries: list[dict], setting_key: str = IMPORT_SOURCE_SETTINGS_KEY) -> None:
    now = datetime.now(timezone.utc).isoformat()
    kind = "real_estate" if setting_key == REAL_ESTATE_IMPORT_SOURCE_SETTINGS_KEY else "expo"
    conn = owner_db_connect(repo_root)
    try:
        _migrate_import_source_settings(repo_root, conn)
        for index, entry in enumerate(entries[:IMPORT_SOURCE_HISTORY_LIMIT]):
            if not entry.get("path"):
                continue
            path = _import_source_history_path(entry["path"])
            conn.execute(
                """
                INSERT INTO import_source_history (
                  source_kind, path, label, pinned, removed_at, review_required,
                  review_completed_at, legacy_source, first_seen_at, last_used_at,
                  use_count, updated_at
                )
                VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source_kind, path) DO UPDATE SET
                  label = excluded.label,
                  removed_at = NULL,
                  pinned = CASE
                    WHEN excluded.pinned = 1 THEN 1
                    ELSE import_source_history.pinned
                  END,
                  review_required = CASE
                    WHEN excluded.review_required = 1 THEN 1
                    ELSE import_source_history.review_required
                  END,
                  review_completed_at = CASE
                    WHEN excluded.review_required = 1 THEN NULL
                    ELSE COALESCE(excluded.review_completed_at, import_source_history.review_completed_at)
                  END,
                  legacy_source = COALESCE(import_source_history.legacy_source, excluded.legacy_source),
                  first_seen_at = COALESCE(import_source_history.first_seen_at, excluded.first_seen_at),
                  last_used_at = excluded.last_used_at,
                  use_count = excluded.use_count,
                  updated_at = excluded.updated_at
                """,
                (
                    kind,
                    path,
                    entry.get("label") or _import_source_label(Path(path)),
                    1 if entry.get("pinned") else 0,
                    1 if entry.get("reviewRequired") else 0,
                    entry.get("reviewCompletedAt") or None,
                    entry.get("legacySource") or None,
                    now,
                    entry.get("lastUsedAt") or None,
                    int(entry.get("useCount") or 0),
                    now,
                ),
            )
        conn.commit()
    finally:
        conn.close()


def _update_import_source_history(repo_root: Path, kind: str, path: str, action: str) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    conn = owner_db_connect(repo_root)
    try:
        _migrate_import_source_settings(repo_root, conn)
        row = conn.execute(
            "SELECT * FROM import_source_history WHERE source_kind = ? AND path = ?",
            (kind, path),
        ).fetchone()
        if not row:
            raise ValueError("import source is not remembered")
        if action == "remove":
            conn.execute(
                """
                UPDATE import_source_history
                   SET removed_at = ?, pinned = 0, updated_at = ?
                 WHERE source_kind = ? AND path = ?
                """,
                (now, now, kind, path),
            )
        elif action == "review":
            conn.execute(
                """
                UPDATE import_source_history
                   SET review_required = 0, review_completed_at = ?, updated_at = ?
                 WHERE source_kind = ? AND path = ?
                """,
                (now, now, kind, path),
            )
        else:
            conn.execute(
                """
                UPDATE import_source_history
                   SET pinned = ?, updated_at = ?
                 WHERE source_kind = ? AND path = ?
                """,
                (1 if action == "pin" else 0, now, kind, path),
            )
        conn.commit()
        updated = conn.execute(
            "SELECT * FROM import_source_history WHERE source_kind = ? AND path = ?",
            (kind, path),
        ).fetchone()
        entry = _import_source_entry(
            Path(updated["path"]),
            last_used_at=str(updated["last_used_at"] or ""),
            use_count=int(updated["use_count"] or 0),
            pinned=bool(updated["pinned"]),
            review_required=bool(updated["review_required"]),
            review_completed_at=str(updated["review_completed_at"] or ""),
            removed_at=str(updated["removed_at"] or ""),
            legacy_source=str(updated["legacy_source"] or ""),
        )
        if updated["label"]:
            entry["label"] = str(updated["label"])
        return entry
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
    pinned = sorted(
        (entry for entry in entries if entry.get("pinned")),
        key=lambda entry: (
            str(entry.get("label") or entry.get("path") or "").casefold(),
            str(entry.get("path") or ""),
        ),
    )
    recent = sorted(
        (entry for entry in entries if entry.get("lastUsedAt") and not entry.get("pinned")),
        key=lambda entry: str(entry.get("lastUsedAt") or ""),
        reverse=True,
    )
    discovered = sorted(
        (entry for entry in entries if not entry.get("lastUsedAt") and not entry.get("pinned")),
        key=lambda entry: str(entry.get("label") or entry.get("path") or "").casefold(),
    )
    return [*pinned, *recent, *discovered][:IMPORT_SOURCE_HISTORY_LIMIT]


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
    pinned = sorted(
        (entry for entry in entries if entry.get("pinned")),
        key=lambda entry: (
            str(entry.get("label") or entry.get("path") or "").casefold(),
            str(entry.get("path") or ""),
        ),
    )
    recent = sorted(
        (entry for entry in entries if entry.get("lastUsedAt") and not entry.get("pinned")),
        key=lambda entry: str(entry.get("lastUsedAt") or ""),
        reverse=True,
    )
    discovered = sorted(
        (entry for entry in entries if not entry.get("lastUsedAt") and not entry.get("pinned")),
        key=lambda entry: str(entry.get("label") or entry.get("path") or "").casefold(),
    )
    return [*pinned, *recent, *discovered][:IMPORT_SOURCE_HISTORY_LIMIT]


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
    return phase_key if phase_key in R2_SWEEP_PHASES else ""


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
    lifecycle = _lifecycle_blocked_sets_readonly(repo_root)
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
    current_phase = "preflight"
    _update_r2_task(
        task_id,
        state="running",
        started_at=datetime.now(timezone.utc).isoformat(),
        currentPhaseKey=current_phase,
    )
    log_path.parent.mkdir(parents=True, exist_ok=True)
    command = _cloud_media_sweep_command(source_root, source_select, skip_phases)
    with log_path.open("ab") as log:
        process = subprocess.run(command, cwd=repo_root, stdout=log, stderr=subprocess.STDOUT)
    coverage = _r2_coverage_summary(repo_root, resolve_sources=False, private_missing_limit=0, import_missing_limit=0)
    coverage_ok = bool(coverage.get("ok"))
    review_queue = {}
    review_queue_error = ""
    if source_root and process.returncode == 0:
        try:
            review_queue = queue_import_cache_title_keyword_review(
                repo_root,
                source_root=source_root,
                source_label=f"Import source: {source_root.name}",
            )
        except Exception as error:  # noqa: BLE001 - background task should surface queue failures in Owner.
            review_queue_error = str(error)
    errors = []
    failed = process.returncode != 0 or not coverage_ok or bool(review_queue_error)
    if process.returncode != 0:
        errors.append(f"cloud media sweep exited {process.returncode}")
    if review_queue_error:
        errors.append(f"title/keyword review queue failed: {review_queue_error}")
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
        task["title_keyword_review"] = review_queue
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
        "currentPhaseKey": "preflight",
        "phaseScopeKeys": (
            ["prepare", "preflight", "import-cache", "selected-folder", "catalog"]
            if source_root
            else ["prepare", "preflight", "discard-start", "import-cache", "camera", "apple-photo-albums", "leonardo", "catalog", "eligibility", "worker", "sidecar", "gap-fill", "discard-final", "storage", "test", "validate", "commit"]
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


def _apple_photos_payload_args(payload: dict, *, require_target: bool = True) -> list[str]:
    album_id = str(payload.get("albumLocalIdentifier") or payload.get("album_id") or payload.get("albumId") or "").strip()
    album_name = str(payload.get("albumName") or payload.get("album_name") or "").strip()
    if require_target and not album_id and not album_name:
        raise ValueError("Choose an Apple Photos album before preflight/import.")
    args: list[str] = []
    if album_id:
        args.extend(["--album-id", album_id])
    elif album_name:
        args.extend(["--album-name", album_name])
    try:
        limit = int(payload.get("limit") or 0)
    except (TypeError, ValueError) as error:
        raise ValueError("limit must be a number") from error
    if limit > 0:
        args.extend(["--limit", str(limit)])
    if _apple_photos_filter_bursts(payload):
        args.append("--filter-bursts")
    if _apple_photos_allow_icloud_downloads(payload):
        args.append("--allow-icloud-downloads")
    return args


def _apple_photos_allow_icloud_downloads(payload: dict) -> bool:
    for key in ("allowIcloudDownloads", "allow_icloud_downloads", "icloudDownloads", "icloud_downloads"):
        if key not in payload:
            continue
        value = payload.get(key)
        if isinstance(value, dict):
            value = value.get("enabled")
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value != 0
        text = str(value or "").strip().lower()
        if text in {"0", "false", "off", "no", "disabled"}:
            return False
        if text in {"1", "true", "on", "yes", "enabled"}:
            return True
    return False


def _apple_photos_filter_bursts(payload: dict) -> bool:
    for key in ("filterBursts", "filter_bursts", "burstFilter"):
        if key not in payload:
            continue
        value = payload.get(key)
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return value != 0
        text = str(value or "").strip().lower()
        if text in {"0", "false", "off", "no", "disabled"}:
            return False
        if text in {"1", "true", "on", "yes", "enabled"}:
            return True
    return True


def _clean_apple_photos_progress_id(value: object) -> str:
    text = str(value or "").strip()
    if not text or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,160}", text):
        return ""
    return text


def _apple_photos_progress_id(payload: dict) -> str:
    for key in ("progressId", "progress_id", "taskId", "task_id"):
        progress_id = _clean_apple_photos_progress_id(payload.get(key))
        if progress_id:
            return progress_id
    return ""


def _apple_photos_import_progress(progress_id: str) -> dict | None:
    if not progress_id:
        return None
    with APPLE_PHOTOS_IMPORT_PROGRESS_LOCK:
        progress = APPLE_PHOTOS_IMPORT_PROGRESS.get(progress_id)
        return copy.deepcopy(progress) if progress else None


def _latest_apple_photos_import_progress() -> dict | None:
    with APPLE_PHOTOS_IMPORT_PROGRESS_LOCK:
        progresses = [copy.deepcopy(progress) for progress in APPLE_PHOTOS_IMPORT_PROGRESS.values()]
    if not progresses:
        return None
    progresses.sort(
        key=lambda progress: (
            1 if str(progress.get("state") or "") == "running" else 0,
            str(progress.get("updatedAt") or progress.get("startedAt") or ""),
        ),
        reverse=True,
    )
    return progresses[0]


def _apple_photos_progress_album_payload(payload: dict) -> dict:
    album = payload.get("album") if isinstance(payload.get("album"), dict) else {}
    return {
        "albumLocalIdentifier": str(album.get("localIdentifier") or payload.get("albumLocalIdentifier") or "").strip(),
        "albumName": str(album.get("title") or payload.get("albumName") or "Apple Photos album").strip() or "Apple Photos album",
    }


def _start_apple_photos_import_progress(progress_id: str, albums: list[dict]) -> None:
    if not progress_id:
        return
    now = datetime.now(timezone.utc).isoformat()
    album_rows = []
    seen: set[str] = set()
    for payload in albums:
        album = _apple_photos_progress_album_payload(payload)
        album_id = album["albumLocalIdentifier"] or album["albumName"]
        if not album_id or album_id in seen:
            continue
        seen.add(album_id)
        album_rows.append({
            **album,
            "state": "queued",
            "importableCount": 0,
            "checkedCount": 0,
            "materializedCount": 0,
            "items": [],
        })
    with APPLE_PHOTOS_IMPORT_PROGRESS_LOCK:
        APPLE_PHOTOS_IMPORT_PROGRESS[progress_id] = {
            "id": progress_id,
            "state": "running",
            "message": "Preparing Apple Photos import...",
            "startedAt": now,
            "updatedAt": now,
            "totalAlbums": len(album_rows),
            "completedAlbums": 0,
            "importableCount": 0,
            "checkedCount": 0,
            "materializedCount": 0,
            "albums": album_rows,
        }


def _progress_event_album_key(event: dict) -> str:
    album = event.get("album") if isinstance(event.get("album"), dict) else {}
    return str(album.get("localIdentifier") or event.get("albumLocalIdentifier") or album.get("title") or event.get("albumName") or "").strip()


def _progress_event_album_title(event: dict) -> str:
    album = event.get("album") if isinstance(event.get("album"), dict) else {}
    return str(album.get("title") or event.get("albumName") or "Apple Photos album").strip() or "Apple Photos album"


def _progress_album_row(progress: dict, event: dict) -> dict:
    album_key = _progress_event_album_key(event)
    album_title = _progress_event_album_title(event)
    albums = progress.setdefault("albums", [])
    for row in albums:
        if str(row.get("albumLocalIdentifier") or row.get("albumName") or "") == album_key:
            return row
    row = {
        "albumLocalIdentifier": album_key,
        "albumName": album_title,
        "state": "queued",
        "importableCount": 0,
        "checkedCount": 0,
        "materializedCount": 0,
        "items": [],
    }
    albums.append(row)
    progress["totalAlbums"] = len(albums)
    return row


def _progress_item_from_event(event: dict, state: str) -> dict:
    progress_value = None
    try:
        progress_value = float(event.get("progress"))
    except (TypeError, ValueError):
        progress_value = None
    if progress_value is not None:
        progress_value = max(0.0, min(1.0, progress_value))
    try:
        progress_percent = int(event.get("progressPercent"))
    except (TypeError, ValueError):
        progress_percent = int(round(progress_value * 100)) if progress_value is not None else None
    if progress_percent is not None:
        progress_percent = max(0, min(100, progress_percent))
    item = {
        "localIdentifier": str(event.get("localIdentifier") or ""),
        "filename": str(event.get("filename") or "Apple Photos asset"),
        "index": int(event.get("index") or 0),
        "status": state,
        "reason": str(event.get("reason") or ""),
        "relativePath": str(event.get("relativePath") or ""),
        "path": str(event.get("path") or ""),
        "mediaType": str(event.get("mediaType") or ""),
        "exportStrategy": str(event.get("exportStrategy") or ""),
        "resourceFormat": str(event.get("resourceFormat") or ""),
        "preferredResourceFilename": str(event.get("preferredResourceFilename") or ""),
        "preferredResourceFormat": str(event.get("preferredResourceFormat") or ""),
        "fallbackResourceFilename": str(event.get("fallbackResourceFilename") or ""),
        "fallbackResourceFormat": str(event.get("fallbackResourceFormat") or ""),
        "localJPEGFallbackAvailable": bool(event.get("localJPEGFallbackAvailable") or False),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    resource_formats = event.get("resourceFormats")
    if isinstance(resource_formats, list):
        item["resourceFormats"] = [str(value) for value in resource_formats if str(value or "").strip()]
    try:
        elapsed_seconds = int(round(float(event.get("elapsedSeconds"))))
    except (TypeError, ValueError):
        elapsed_seconds = None
    if progress_value is not None:
        item["progress"] = progress_value
    if progress_percent is not None:
        item["progressPercent"] = progress_percent
    if elapsed_seconds is not None and elapsed_seconds >= 0:
        item["elapsedSeconds"] = elapsed_seconds
    return item


def _apple_photos_asset_progress_message(item: dict, album_name: str) -> str:
    filename = item.get("filename") or "Apple Photos asset"
    status = str(item.get("status") or "").strip()
    percent = item.get("progressPercent")
    elapsed = item.get("elapsedSeconds")
    resource_format = str(item.get("resourceFormat") or "").strip()
    format_suffix = f" ({resource_format})" if resource_format else ""
    elapsed_label = f" after {elapsed}s" if isinstance(elapsed, int) and elapsed > 0 else ""
    if status == "waiting_for_render":
        return f"Photos reports 100% for {filename}{format_suffix}; waiting{elapsed_label} for the rendered JPEG from {album_name}..."
    if status == "render_fallback":
        return f"Rendered JPEG stalled for {filename}{format_suffix}; trying the local source fallback from {album_name}..."
    if status == "exporting_local_resource":
        return f"Exporting the local source file for {filename}{format_suffix} from {album_name}..."
    if status == "waiting_for_local_resource":
        return f"Waiting{elapsed_label} for Photos to write the local source file for {filename}{format_suffix} from {album_name}..."
    if status == "converting_local_jpeg":
        return f"Converting the local source file to JPEG for {filename}{format_suffix} from {album_name}..."
    if status == "waiting_for_file":
        return f"Photos reports 100% for {filename}{format_suffix}; waiting{elapsed_label} for the exported file from {album_name}..."
    if status == "waiting_for_photos":
        return f"Waiting{elapsed_label} for Photos to provide {filename}{format_suffix} from {album_name}..."
    if status == "exporting_resource":
        return f"Photos is exporting {filename}{format_suffix} from {album_name}{elapsed_label}..."
    if status == "encoding_jpeg":
        return f"Encoding JPEG for {filename} from {album_name}..."
    if status == "writing_file":
        return f"Writing {filename} to the temporary import folder..."
    if percent is None:
        return f"Photos is exporting {filename} from {album_name}..."
    return f"Photos reports {percent}% for {filename}{format_suffix} from {album_name}..."


def _append_apple_photos_progress_item(album_row: dict, item: dict) -> None:
    item_key = item.get("localIdentifier") or f"{item.get('index')}:{item.get('filename')}"
    items = [
        existing for existing in album_row.get("items", [])
        if (existing.get("localIdentifier") or f"{existing.get('index')}:{existing.get('filename')}") != item_key
    ]
    album_row["items"] = [item, *items][:APPLE_PHOTOS_PROGRESS_ITEM_LIMIT]


def _recount_apple_photos_progress(progress: dict) -> None:
    albums = progress.get("albums") if isinstance(progress.get("albums"), list) else []
    progress["importableCount"] = sum(int(row.get("importableCount") or 0) for row in albums if isinstance(row, dict))
    progress["checkedCount"] = sum(int(row.get("checkedCount") or 0) for row in albums if isinstance(row, dict))
    progress["materializedCount"] = sum(int(row.get("materializedCount") or 0) for row in albums if isinstance(row, dict))
    progress["completedAlbums"] = sum(1 for row in albums if isinstance(row, dict) and str(row.get("state") or "") in {"done", "failed"})


def _update_apple_photos_import_progress_from_event(progress_id: str, event: dict) -> None:
    if not progress_id or not isinstance(event, dict):
        return
    event_name = str(event.get("event") or "").strip()
    now = datetime.now(timezone.utc).isoformat()
    with APPLE_PHOTOS_IMPORT_PROGRESS_LOCK:
        progress = APPLE_PHOTOS_IMPORT_PROGRESS.setdefault(progress_id, {
            "id": progress_id,
            "state": "running",
            "startedAt": now,
            "albums": [],
        })
        progress["state"] = "running"
        progress["updatedAt"] = now
        album_row = _progress_album_row(progress, event)
        album_row["albumName"] = _progress_event_album_title(event)
        album_row["importableCount"] = max(0, int(event.get("candidateCount") or album_row.get("importableCount") or 0))
        album_row["checkedCount"] = max(0, int(event.get("attemptedCount") or album_row.get("checkedCount") or 0))
        album_row["materializedCount"] = max(0, int(event.get("materializedCount") or album_row.get("materializedCount") or 0))
        if event_name == "materialize_start":
            album_row["state"] = "running"
            progress["currentAlbumLocalIdentifier"] = album_row.get("albumLocalIdentifier") or ""
            progress["message"] = f"Exporting {album_row['albumName']}..."
        elif event_name == "asset_start":
            item = _progress_item_from_event(event, "materializing")
            album_row["state"] = "running"
            album_row["currentItem"] = item
            progress["currentAlbumLocalIdentifier"] = album_row.get("albumLocalIdentifier") or ""
            progress["currentItem"] = item
            progress["message"] = f"Exporting {item['filename']} from {album_row['albumName']}..."
        elif event_name == "asset_progress":
            state = str(event.get("status") or "materializing")
            item = _progress_item_from_event(event, state)
            album_row["state"] = "running"
            album_row["currentItem"] = item
            progress["currentAlbumLocalIdentifier"] = album_row.get("albumLocalIdentifier") or ""
            progress["currentItem"] = item
            progress["message"] = _apple_photos_asset_progress_message(item, album_row["albumName"])
        elif event_name in {"asset_done", "asset_failed"}:
            state = "materialized" if event_name == "asset_done" else str(event.get("status") or "unavailable")
            item = _progress_item_from_event(event, state)
            current = album_row.get("currentItem") if isinstance(album_row.get("currentItem"), dict) else {}
            if current.get("localIdentifier") == item.get("localIdentifier"):
                album_row.pop("currentItem", None)
            _append_apple_photos_progress_item(album_row, item)
            progress["currentAlbumLocalIdentifier"] = album_row.get("albumLocalIdentifier") or ""
            progress["currentItem"] = item
            progress["message"] = (
                f"Exported {item['filename']}."
                if state == "materialized"
                else f"{item['filename']} was not exported: {item.get('reason') or 'Photos export failed'}"
            )
        elif event_name == "materialize_done":
            album_row["state"] = "done"
            album_row.pop("currentItem", None)
            progress["message"] = f"Finished exporting {album_row['albumName']}."
        _recount_apple_photos_progress(progress)


def _finish_apple_photos_import_progress(progress_id: str, state: str, result: dict | None = None) -> None:
    if not progress_id:
        return
    now = datetime.now(timezone.utc).isoformat()
    result = result if isinstance(result, dict) else {}
    with APPLE_PHOTOS_IMPORT_PROGRESS_LOCK:
        progress = APPLE_PHOTOS_IMPORT_PROGRESS.setdefault(progress_id, {
            "id": progress_id,
            "startedAt": now,
            "albums": [],
        })
        progress["state"] = state
        progress["updatedAt"] = now
        progress["completedAt"] = now
        if result.get("message"):
            progress["message"] = str(result.get("message") or "")
        elif result.get("error"):
            progress["message"] = str(result.get("error") or "")
            progress["error"] = str(result.get("error") or "")
        else:
            progress["message"] = "Apple Photos export finished." if state == "done" else "Apple Photos export failed."
        _recount_apple_photos_progress(progress)


def _run_apple_photos_bridge_streaming(repo_root: Path, command: list[str], progress_id: str) -> dict:
    try:
        process = subprocess.Popen(
            command,
            cwd=repo_root,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except FileNotFoundError as error:
        raise RuntimeError("Swift is required for the Apple Photos PhotoKit bridge. Install Xcode Command Line Tools.") from error
    stdout_chunks: list[str] = []
    stderr_lines: list[str] = []

    def read_stdout() -> None:
        if process.stdout is None:
            return
        stdout_chunks.append(process.stdout.read() or "")

    def read_stderr() -> None:
        if process.stderr is None:
            return
        for raw_line in process.stderr:
            line = raw_line.rstrip("\r\n")
            if line.startswith(APPLE_PHOTOS_PROGRESS_PREFIX):
                try:
                    event = json.loads(line[len(APPLE_PHOTOS_PROGRESS_PREFIX):])
                except json.JSONDecodeError:
                    stderr_lines.append(line)
                    continue
                _update_apple_photos_import_progress_from_event(progress_id, event)
            elif line.strip():
                stderr_lines.append(line)

    stdout_thread = threading.Thread(target=read_stdout, daemon=True)
    stderr_thread = threading.Thread(target=read_stderr, daemon=True)
    stdout_thread.start()
    stderr_thread.start()
    try:
        return_code = process.wait(timeout=900)
    except subprocess.TimeoutExpired:
        process.kill()
        return_code = process.wait(timeout=10)
        stdout_thread.join(timeout=2)
        stderr_thread.join(timeout=2)
        _finish_apple_photos_import_progress(progress_id, "failed", {
            "error": "Apple Photos bridge timed out while exporting assets.",
        })
        return {
            "ok": False,
            "error": "Apple Photos bridge timed out while exporting assets.",
            "code": "photos_bridge_timeout",
        }
    stdout_thread.join(timeout=5)
    stderr_thread.join(timeout=5)
    output = "".join(stdout_chunks).strip()
    payload = json.loads(output or "{}")
    stderr = "\n".join(stderr_lines).strip()
    if return_code != 0 and payload.get("ok") is not False:
        message = (stderr or output or f"Apple Photos bridge exited {return_code}").strip()
        return {"ok": False, "error": message, "code": "photos_bridge_error"}
    if stderr and payload.get("ok") is False:
        payload.setdefault("stderr", stderr)
    return payload


def _ensure_apple_photos_bridge_app(repo_root: Path) -> None:
    installer = repo_root / APPLE_PHOTOS_BRIDGE_APP_INSTALLER
    bridge_source = repo_root / APPLE_PHOTOS_BRIDGE
    if not installer.exists():
        raise RuntimeError(f"Photos Bridge app installer is missing: {installer}")
    if not bridge_source.exists():
        raise RuntimeError(f"Apple Photos bridge is missing: {bridge_source}")
    needs_build = not APPLE_PHOTOS_BRIDGE_APP_EXECUTABLE.exists()
    if not needs_build:
        try:
            installed_fingerprint = APPLE_PHOTOS_BRIDGE_APP_SOURCE_FINGERPRINT.read_text(
                encoding="utf-8"
            ).strip()
            source_fingerprint = hashlib.sha256(bridge_source.read_bytes()).hexdigest()
            needs_build = installed_fingerprint != source_fingerprint
        except OSError:
            needs_build = True
    if not needs_build:
        return
    result = subprocess.run(
        ["zsh", str(installer)],
        cwd=repo_root,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        message = (result.stderr or result.stdout or f"Photos Bridge installer exited {result.returncode}").strip()
        raise RuntimeError(message)


def _run_apple_photos_bridge(repo_root: Path, args: list[str], *, progress_id: str = "") -> dict:
    _ensure_apple_photos_bridge_app(repo_root)
    progress_id = _clean_apple_photos_progress_id(progress_id)
    with tempfile.TemporaryDirectory(prefix="pbe-photos-bridge-result-") as result_dir:
        result_path = Path(result_dir) / "result.json"
        command = [
            "open",
            "-W",
            "-n",
            str(APPLE_PHOTOS_BRIDGE_APP),
            "--args",
            *args,
            "--result-destination",
            str(result_path),
        ]
        try:
            result = subprocess.run(command, cwd=repo_root, text=True, capture_output=True, timeout=900, check=False)
        except FileNotFoundError as error:
            raise RuntimeError("macOS open is required to launch the bundled Apple Photos bridge.") from error
        except subprocess.TimeoutExpired:
            if progress_id:
                _finish_apple_photos_import_progress(progress_id, "failed", {
                    "error": "Photos Bridge app timed out while exporting assets.",
                })
            return {
                "ok": False,
                "error": "Photos Bridge app timed out while exporting assets.",
                "code": "photos_bridge_timeout",
            }
        output = ""
        if result_path.exists():
            output = result_path.read_text(encoding="utf-8").strip()
        elif result.stdout:
            output = result.stdout.strip()
    payload = json.loads(output or "{}")
    if result.returncode != 0 and payload.get("ok") is not False:
        message = (result.stderr or result.stdout or output or f"Photos Bridge app exited {result.returncode}").strip()
        return {"ok": False, "error": message, "code": "photos_bridge_error"}
    if result.stderr and payload.get("ok") is False:
        payload.setdefault("stderr", result.stderr.strip())
    if not payload and not output:
        return {
            "ok": False,
            "error": "Photos Bridge app did not write a result payload.",
            "code": "photos_bridge_empty_result",
        }
    return payload


def _cached_apple_photos_albums_payload() -> dict | None:
    now = time.time()
    with APPLE_PHOTOS_ALBUMS_CACHE_LOCK:
        payload = copy.deepcopy(APPLE_PHOTOS_ALBUMS_CACHE.get("payload"))
        loaded_at = float(APPLE_PHOTOS_ALBUMS_CACHE.get("loaded_at") or 0.0)
    if not isinstance(payload, dict) or loaded_at <= 0:
        return None
    age = max(0.0, now - loaded_at)
    if age > APPLE_PHOTOS_ALBUM_CACHE_TTL_SECONDS:
        return None
    payload["cached"] = True
    payload["cacheMiss"] = False
    payload["cacheAgeSeconds"] = round(age)
    payload["cacheTtlSeconds"] = APPLE_PHOTOS_ALBUM_CACHE_TTL_SECONDS
    return payload


def _store_apple_photos_albums_payload(payload: dict) -> None:
    with APPLE_PHOTOS_ALBUMS_CACHE_LOCK:
        APPLE_PHOTOS_ALBUMS_CACHE["payload"] = copy.deepcopy(payload)
        APPLE_PHOTOS_ALBUMS_CACHE["loaded_at"] = time.time()


def _apple_photos_preflight(repo_root: Path, payload: dict) -> dict:
    return _run_apple_photos_bridge(repo_root, ["preflight", *_apple_photos_payload_args(payload)])


def _apple_photos_nothing_materialized_message(payload: dict) -> str:
    if _apple_photos_allow_icloud_downloads(payload):
        return (
            "Apple Photos assets were selected, but Photos could not download or provide importable bytes. "
            "Confirm iCloud Photos is signed in and the assets can be opened in Photos, then retry."
        )
    return (
        "Apple Photos assets were selected, but none had locally available importable bytes. "
        "Open Photos and download originals, then retry."
    )


def _record_legacy_folder_import_operation(
    repo_root: Path,
    source_root: Path | None,
    source_select: str,
    task: dict | None,
) -> dict:
    if not task or task.get("operation") != "repair":
        return {}
    mode = "selected_folder" if source_root else "fixed_anchors"
    source = {
        "kind": "legacy_folder",
        "mode": mode,
        "sourceSelect": _effective_import_select(source_root, source_select),
        "canonicalSource": "apple_photos",
        "duplicateRisk": "folder media may already exist in Apple Photos",
    }
    if source_root:
        source["path"] = str(source_root)
    else:
        source["anchors"] = sorted(IMPORT_SOURCE_ROOTS)
    operation = record_import_operation_db(
        repo_root,
        {
            "label": f"Legacy folder -> expo: {source_root.name if source_root else 'fixed anchors'}",
            "state": "queued",
            "sourceKind": "legacy_folder",
            "source": source,
            "destinationKind": "expo",
            "destination": {"kind": "expo", "collectionHint": "infer", "publishMode": "public_catalog"},
            "filters": {
                "selectionPolicy": source["sourceSelect"],
                "skipDiscarded": True,
                "duplicatePolicy": "legacy_recovery_only",
            },
            "outputs": {
                "publicPreview": True,
                "privateMaster": True,
                "buyerRenders": "on_demand",
                "watermarkPublicPreviews": True,
            },
            "task": task,
        },
    )
    return operation


def _apple_photos_operation_source(payload: dict, preflight: dict | None = None) -> dict:
    album = preflight.get("album") if isinstance(preflight, dict) and isinstance(preflight.get("album"), dict) else {}
    album_id = str(
        payload.get("albumLocalIdentifier")
        or payload.get("album_id")
        or payload.get("albumId")
        or album.get("localIdentifier")
        or ""
    ).strip()
    album_name = str(payload.get("albumName") or payload.get("album_name") or album.get("title") or "").strip()
    try:
        limit = int(payload.get("limit") or 0)
    except (TypeError, ValueError):
        limit = 0
    selected_asset_ids = _apple_photos_selected_asset_ids(payload)
    return {
        "kind": "apple_photos",
        "mode": "selected_assets" if selected_asset_ids else "album",
        "albumLocalIdentifier": album_id,
        "albumName": album_name,
        "albumAssetCount": int(album.get("assetCount") or 0) if album else 0,
        "selectedAssetCount": len(selected_asset_ids),
        "limit": max(0, limit),
    }


def _apple_photos_selected_asset_ids(payload: dict) -> list[str]:
    """Return a bounded, de-duplicated list of explicitly selected Photos assets."""
    raw = payload.get("selectedAssetIds") or payload.get("selected_asset_ids") or []
    if raw is None or raw == "":
        return []
    if not isinstance(raw, list):
        raise ValueError("selectedAssetIds must be a list")
    result: list[str] = []
    seen: set[str] = set()
    for value in raw:
        asset_id = str(value or "").strip()
        if not asset_id:
            continue
        if len(asset_id) > 512 or any(ord(char) < 32 for char in asset_id):
            raise ValueError("selectedAssetIds contains an invalid Apple Photos identifier")
        if asset_id in seen:
            continue
        seen.add(asset_id)
        result.append(asset_id)
    if len(result) > 500:
        raise ValueError("Select no more than 500 Apple Photos assets at a time")
    return result


def _real_estate_intake_segment(value: object, label: str) -> str:
    """Validate a human-readable hierarchy segment before it becomes a folder."""
    segment = re.sub(r"\s+", " ", str(value or "").strip())
    if not segment:
        raise ValueError(f"{label} is required for Real Estate intake")
    if segment in {".", ".."} or "/" in segment or "\\" in segment:
        raise ValueError(f"{label} must be a single folder name")
    if len(segment) > 80 or any(ord(char) < 32 for char in segment):
        raise ValueError(f"{label} is not a valid Real Estate intake name")
    return segment


def _apple_photos_real_estate_assignment(payload: dict) -> dict | None:
    """Read and validate the local Track / Fixture / Project intake assignment."""
    destination_kind, destination = _apple_photos_operation_destination(payload)
    if destination_kind != "real_estate":
        return None
    assignment = payload.get("intakeAssignment")
    if not isinstance(assignment, dict):
        assignment = destination
    track = _real_estate_intake_segment(assignment.get("track") or "RE", "Track")
    if track.casefold() != "re":
        raise ValueError("The Real Estate intake track must be RE")
    return {
        "track": "RE",
        "fixture": _real_estate_intake_segment(
            assignment.get("fixture") or assignment.get("clientId"),
            "Fixture",
        ),
        "project": _real_estate_intake_segment(
            assignment.get("project") or assignment.get("property"),
            "Project",
        ),
    }


def _apple_photos_operation_destination(payload: dict) -> tuple[str, dict]:
    raw = str(payload.get("destinationKind") or payload.get("destination_kind") or "expo").strip().lower().replace("-", "_")
    if raw not in {"expo", "real_estate", "reserve"}:
        raise ValueError("destinationKind must be expo, real-estate, or reserve")
    destination = payload.get("destination") if isinstance(payload.get("destination"), dict) else {}
    if raw == "expo":
        return "expo", {
            "kind": "expo",
            "collectionHint": str(destination.get("collectionHint") or "infer"),
            "publishMode": str(destination.get("publishMode") or "public_catalog"),
        }
    if raw == "real_estate":
        assignment = payload.get("intakeAssignment") if isinstance(payload.get("intakeAssignment"), dict) else destination
        return "real_estate", {
            "kind": "real_estate",
            "clientId": str(destination.get("clientId") or ""),
            "property": str(destination.get("property") or ""),
            "track": str(assignment.get("track") or "RE"),
            "fixture": str(assignment.get("fixture") or destination.get("clientId") or ""),
            "project": str(assignment.get("project") or destination.get("property") or ""),
        }
    return "reserve", {
        "kind": "reserve",
        "reviewState": str(destination.get("reviewState") or "owner_review"),
    }


def _apple_photos_operation_blueprint(payload: dict, preflight: dict | None = None, *, state: str = "draft") -> dict:
    destination_kind, destination = _apple_photos_operation_destination(payload)
    if destination_kind == "real_estate":
        assignment = _apple_photos_real_estate_assignment(payload)
        destination.update(assignment or {})
    source = _apple_photos_operation_source(payload, preflight)
    album_label = source.get("albumName") or "album"
    return {
        "operationId": str(payload.get("operationId") or payload.get("operation_id") or "").strip(),
        "label": f"Apple Photos -> {destination_kind}: {album_label}",
        "state": state,
        "sourceKind": "apple_photos",
        "source": source,
        "destinationKind": destination_kind,
        "destination": destination,
        "filters": {
            "selectionPolicy": "album_membership",
            "mediaTypes": ["photo", "video"],
            "skipDiscarded": True,
            "stillImagePolicy": "render_photos_current_jpg",
            "icloudPolicy": "allow_photos_download" if _apple_photos_allow_icloud_downloads(payload) else "require_local_original_or_render",
            "icloudDownloadConsent": _apple_photos_allow_icloud_downloads(payload),
            "burstPolicy": "conservative_preconversion" if _apple_photos_filter_bursts(payload) else "off",
            "duplicatePolicy": "prefer_apple_photos_anchor",
        },
        "outputs": {
            "publicPreview": destination_kind == "expo",
            "privateMaster": True,
            "buyerRenders": "on_demand",
            "watermarkPublicPreviews": destination_kind == "expo",
        },
    }


def _record_apple_photos_import_operation(
    repo_root: Path,
    payload: dict,
    preflight: dict | None = None,
    *,
    state: str = "draft",
    task: dict | None = None,
    error: str = "",
) -> dict:
    operation = _apple_photos_operation_blueprint(payload, preflight, state=state)
    if preflight is not None:
        operation["preflight"] = preflight
    if task is not None:
        operation["task"] = task
    if error:
        operation["error"] = error
    return record_import_operation_db(repo_root, operation)


def _apple_photos_import_destination(repo_root: Path, album_label: str = "") -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe_label = re.sub(r"[^a-zA-Z0-9]+", "-", album_label).strip("-").lower()[:48] or "album"
    return repo_root / APPLE_PHOTOS_IMPORT_ROOT / f"{stamp}-{safe_label}"


def _apple_photos_intake_destination(repo_root: Path, payload: dict, album_label: str = "") -> tuple[Path, dict | None]:
    """Choose disposable Expo staging or a persistent, local-only RE intake folder."""
    assignment = _apple_photos_real_estate_assignment(payload)
    if not assignment:
        return _apple_photos_import_destination(repo_root, album_label), None
    intake_root = REAL_ESTATE_APPLE_PHOTOS_INTAKE_ROOT.expanduser().resolve()
    fixture_root = (intake_root / assignment["track"] / assignment["fixture"]).resolve()
    project_root = (fixture_root / assignment["project"]).resolve()
    if intake_root not in fixture_root.parents or fixture_root not in project_root.parents:
        raise ValueError("Real Estate intake assignment escaped the configured local intake root")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    safe_label = re.sub(r"[^a-zA-Z0-9]+", "-", album_label).strip("-").lower()[:48] or "photos"
    run_root = project_root / f"{stamp}-{safe_label}"
    run_root.mkdir(parents=True, exist_ok=False)
    return run_root, {
        **assignment,
        "intakeRoot": str(intake_root),
        "fixtureRoot": str(fixture_root),
        "projectRoot": str(project_root),
        "runRoot": str(run_root),
    }


def _remember_apple_photos_real_estate_source(repo_root: Path, routing: dict) -> dict:
    """Register a routed fixture as a selectable RE import source in Owner.sqlite."""
    fixture_root = Path(str(routing.get("fixtureRoot") or "")).expanduser().resolve()
    if not fixture_root.is_dir():
        raise ValueError("Real Estate intake fixture folder was not created")
    _remember_real_estate_import_source_root(repo_root, fixture_root)
    sources = _real_estate_import_source_history(repo_root)
    source = next((item for item in sources if item.get("path") == str(fixture_root)), None)
    if not source:
        source = _import_source_entry(fixture_root, last_used_at=datetime.now(timezone.utc).isoformat())
    return {
        **source,
        "label": f"{routing['track']} / {routing['fixture']}",
        "legacySource": "apple-photos-real-estate-intake",
        "intakeAssignment": {
            "track": routing["track"],
            "fixture": routing["fixture"],
            "project": routing["project"],
        },
    }


def _apple_photos_real_estate_stage(source_root: Path, routing: dict, materialized_count: int) -> dict:
    """Describe a completed local-only RE assignment without implying publication."""
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": f"apple-photos-re-intake-{uuid.uuid4().hex[:16]}",
        "kind": "apple-photos-real-estate-intake",
        "operation": "apple-photos-real-estate-intake",
        "state": "done",
        "queued_at": now,
        "started_at": now,
        "completed_at": now,
        "updated_at": now,
        "total": max(1, int(materialized_count or 0)),
        "completed": max(0, int(materialized_count or 0)),
        "failed": 0,
        "sourceKind": "apple-photos",
        "sourceRoot": str(source_root),
        "realEstateSourceRoot": str(routing["fixtureRoot"]),
        "reviewRequired": False,
        "published": False,
        "intakeAssignment": {
            "track": routing["track"],
            "fixture": routing["fixture"],
            "project": routing["project"],
        },
        "materializedCount": max(0, int(materialized_count or 0)),
    }


def _remember_apple_photos_review_source(repo_root: Path, source_root: Path, label: str) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    entry = _import_source_entry(
        source_root,
        last_used_at=now,
        use_count=0,
        review_required=False,
        legacy_source="apple-photos-stage",
    )
    entry["label"] = label
    entries = [item for item in _read_import_source_setting(repo_root) if item.get("path") != entry["path"]]
    _write_import_source_setting(repo_root, [entry, *entries])
    return entry


def _apple_photos_review_stage(source_root: Path, materialized_albums: list[dict], *, batch_sidecar: dict | None = None) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    album_rows = []
    for row in materialized_albums:
        preflight = row.get("preflight") if isinstance(row.get("preflight"), dict) else {}
        album = row.get("album") if isinstance(row.get("album"), dict) else preflight.get("album") if isinstance(preflight.get("album"), dict) else {}
        album_rows.append({
            "albumLocalIdentifier": str(album.get("localIdentifier") or ""),
            "albumName": str(album.get("title") or "Apple Photos album"),
            "importableCount": int(preflight.get("candidateCount") or row.get("count") or 0),
            "materializedCount": int(row.get("materializedCount") or 0),
            "destination": str(row.get("destination") or ""),
            "burstFilter": row.get("burstFilter") or preflight.get("burstFilter") or {},
            "icloudDownloads": row.get("icloudDownloads") or preflight.get("icloudDownloads") or {},
        })
    total = sum(int(row.get("materializedCount") or 0) for row in album_rows)
    return {
        "id": f"apple-photos-import-{uuid.uuid4().hex[:16]}",
        "kind": "apple-photos-stage",
        "operation": "apple-photos-import",
        "photo_id": "apple-photos-import",
        "state": "done",
        "queued_at": now,
        "started_at": now,
        "completed_at": now,
        "updated_at": now,
        "total": max(1, len(album_rows)),
        "completed": len(album_rows),
        "failed": 0,
        "bytes_total": 0,
        "bytes_done": 0,
        "sourceKind": "apple-photos",
        "sourceRoot": str(source_root),
        "sourceSelect": "all",
        "reviewRequired": False,
        "batchSidecar": batch_sidecar or {},
        "applePhotosAlbums": album_rows,
        "materializedCount": total,
    }


def _json_dict_from_text(value: object) -> dict:
    try:
        payload = json.loads(str(value or "{}"))
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _apple_photos_album_import_stats(repo_root: Path) -> dict[str, dict]:
    stats: dict[str, dict] = {}
    try:
        conn = owner_db_connect(repo_root)
    except sqlite3.Error:
        return stats
    try:
        rows = conn.execute(
            """
            SELECT state, source_json, preflight_json, task_json, updated_at
            FROM import_operations
            WHERE source_kind = 'apple_photos'
            """
        ).fetchall()
    except sqlite3.Error:
        return stats
    finally:
        conn.close()
    for row in rows:
        state = str(row["state"] or "")
        if state not in {"queued", "running", "done"}:
            continue
        source = _json_dict_from_text(row["source_json"])
        album_id = str(source.get("albumLocalIdentifier") or "").strip()
        if not album_id:
            continue
        preflight = _json_dict_from_text(row["preflight_json"])
        task = _json_dict_from_text(row["task_json"])
        imported_count = int(preflight.get("candidateCount") or source.get("albumAssetCount") or 0)
        task_albums = task.get("applePhotosAlbums") if isinstance(task.get("applePhotosAlbums"), list) else []
        for task_album in task_albums:
            if not isinstance(task_album, dict):
                continue
            if str(task_album.get("albumLocalIdentifier") or "").strip() != album_id:
                continue
            imported_count = int(task_album.get("materializedCount") or imported_count)
            break
        current = stats.setdefault(album_id, {
            "importedCount": 0,
            "lastImportState": "",
            "lastImportAt": "",
            "lastTaskId": "",
        })
        current["importedCount"] = max(int(current.get("importedCount") or 0), max(0, imported_count))
        updated_at = str(row["updated_at"] or "")
        if updated_at >= str(current.get("lastImportAt") or ""):
            current["lastImportAt"] = updated_at
            current["lastImportState"] = state
            current["lastTaskId"] = str(task.get("id") or "")
    return stats


def _with_apple_photos_import_stats(repo_root: Path, payload: dict) -> dict:
    albums = payload.get("albums")
    if not isinstance(albums, list) or not albums:
        return payload
    stats = _apple_photos_album_import_stats(repo_root)
    annotated_albums = []
    for album in albums:
        if not isinstance(album, dict):
            annotated_albums.append(album)
            continue
        album_id = str(album.get("localIdentifier") or "").strip()
        stat = stats.get(album_id) or {}
        imported_count = max(0, int(stat.get("importedCount") or 0))
        asset_count = int(album.get("assetCount") or 0)
        if asset_count > 0:
            imported_count = min(imported_count, asset_count)
        annotated_albums.append({
            **album,
            "importedCount": imported_count,
            "lastImportState": str(stat.get("lastImportState") or ""),
            "lastImportAt": str(stat.get("lastImportAt") or ""),
        })
    return {**payload, "albums": annotated_albums, "importStatsLoaded": True}


def _apple_photos_album_batch_payloads(payload: dict) -> list[dict]:
    albums = payload.get("albums")
    if not isinstance(albums, list):
        return []
    base_payload = {key: value for key, value in payload.items() if key != "albums"}
    payloads: list[dict] = []
    seen: set[str] = set()
    for item in albums:
        if not isinstance(item, dict):
            continue
        album_payload = {**base_payload, **item}
        album_id = str(
            album_payload.get("albumLocalIdentifier")
            or album_payload.get("album_id")
            or album_payload.get("albumId")
            or ""
        ).strip()
        album_name = str(album_payload.get("albumName") or album_payload.get("album_name") or "").strip()
        key = album_id or album_name.casefold()
        if not key or key in seen:
            continue
        seen.add(key)
        payloads.append(album_payload)
    return payloads


def _active_apple_photos_import_task(repo_root: Path) -> dict | None:
    external = _external_cloud_media_sweep_task(repo_root)
    if external:
        return external
    return _active_r2_work_task()


def _apple_photos_import_busy_response(repo_root: Path) -> dict:
    return {
        "ok": False,
        "error": "Another import or maintenance task is already running. Wait for it to finish, then retry Apple Photos import.",
        "code": "import_busy",
        "task": _active_apple_photos_import_task(repo_root),
    }


def _apple_photos_batch_album_dir(index: int, album_label: str) -> str:
    safe_label = re.sub(r"[^a-zA-Z0-9]+", "-", album_label).strip("-").lower()[:48] or "album"
    return f"{index:03d}-{safe_label}"


def _safe_relative_path(value: object) -> Path | None:
    text = str(value or "").strip()
    if not text:
        return None
    path = Path(text)
    if path.is_absolute() or ".." in path.parts:
        return None
    return path


def _merge_apple_photos_batch_sidecars(batch_root: Path, materialized_albums: list[dict]) -> dict:
    assets: list[dict] = []
    albums: list[dict] = []
    seen_anchor_paths: set[str] = set()
    duplicate_count = 0
    skipped_count = 0
    batch_root.mkdir(parents=True, exist_ok=True)
    resolved_batch_root = batch_root.resolve()
    for export_result in materialized_albums:
        destination = Path(str(export_result.get("destination") or ""))
        sidecar = Path(str(export_result.get("sidecar") or (destination / APPLE_PHOTOS_SOURCE_ANCHORS)))
        try:
            subdir = destination.resolve().relative_to(resolved_batch_root).as_posix()
        except (OSError, ValueError):
            subdir = destination.name
        try:
            payload = json.loads(sidecar.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            skipped_count += 1
            continue
        album = payload.get("album") if isinstance(payload.get("album"), dict) else export_result.get("album")
        if isinstance(album, dict):
            albums.append(album)
        for item in payload.get("assets") or []:
            if not isinstance(item, dict):
                continue
            relative = _safe_relative_path(item.get("relative_path") or item.get("relativePath"))
            anchor = item.get("source_anchor") or item.get("sourceAnchor")
            if relative is None or not isinstance(anchor, dict):
                skipped_count += 1
                continue
            anchor_path = str(anchor.get("path") or "").strip()
            prefixed_relative = (Path(subdir) / relative).as_posix()
            if anchor_path and anchor_path in seen_anchor_paths:
                duplicate_count += 1
                duplicate_path = batch_root / prefixed_relative
                try:
                    if duplicate_path.resolve().is_relative_to(resolved_batch_root) and duplicate_path.is_file():
                        duplicate_path.unlink()
                except OSError:
                    pass
                continue
            if anchor_path:
                seen_anchor_paths.add(anchor_path)
            assets.append({**item, "relative_path": prefixed_relative})
    sidecar_payload = {
        "schema": "photosbyelie.apple-photos-source-anchors.v1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "batch": True,
        "albums": albums,
        "duplicateCount": duplicate_count,
        "skippedCount": skipped_count,
        "assets": assets,
    }
    sidecar_path = batch_root / APPLE_PHOTOS_SOURCE_ANCHORS
    sidecar_path.write_text(json.dumps(sidecar_payload, indent=2, sort_keys=True), encoding="utf-8")
    return {
        "sidecar": str(sidecar_path),
        "assetCount": len(assets),
        "duplicateCount": duplicate_count,
        "skippedCount": skipped_count,
    }


def _start_apple_photos_batch_import(repo_root: Path, payload: dict, album_payloads: list[dict]) -> dict:
    preflight_only = bool(payload.get("dryRun") or payload.get("dry_run"))
    if not preflight_only and _active_apple_photos_import_task(repo_root):
        return _apple_photos_import_busy_response(repo_root)
    progress_id = "" if preflight_only else _apple_photos_progress_id(payload)
    if progress_id:
        _start_apple_photos_import_progress(progress_id, album_payloads)
    preflight_rows: list[dict] = []
    operation_rows: list[dict] = []
    failed_albums: list[dict] = []
    prepared_rows: list[tuple[int, dict, dict, dict]] = []
    for index, album_payload in enumerate(album_payloads, start=1):
        try:
            preflight = _apple_photos_preflight(repo_root, album_payload)
        except (OSError, RuntimeError, json.JSONDecodeError) as error:
            album = {
                "localIdentifier": str(album_payload.get("albumLocalIdentifier") or ""),
                "title": str(album_payload.get("albumName") or "Apple Photos album"),
            }
            failed_albums.append({"album": album, "error": str(error)})
            continue
        state = "preflighted" if preflight.get("ok") else "failed"
        operation = _record_apple_photos_import_operation(
            repo_root,
            album_payload,
            preflight,
            state=state,
            error=str(preflight.get("error") or ""),
        )
        operation_rows.append(operation)
        preflight_rows.append(preflight)
        album_payload = {**album_payload, "operationId": operation.get("operationId") or album_payload.get("operationId")}
        if not preflight.get("ok"):
            failed_albums.append({
                "album": preflight.get("album") or {},
                "error": str(preflight.get("error") or "Apple Photos dry run failed."),
            })
            continue
        if int(preflight.get("candidateCount") or 0) <= 0:
            failed_albums.append({
                "album": preflight.get("album") or {},
                "error": "No eligible local assets are available in this album.",
                "code": "no_eligible_assets",
            })
            continue
        prepared_rows.append((index, album_payload, preflight, operation))
    if preflight_only:
        return {
            "ok": any(bool(row.get("ok")) for row in preflight_rows),
            "batch": True,
            "dryRun": True,
            "preflights": preflight_rows,
            "operations": operation_rows,
            "failedAlbums": failed_albums,
        }
    if not prepared_rows:
        result = {
            "ok": False,
            "batch": True,
            "error": "No selected Apple Photos albums have eligible local assets to import.",
            "code": "no_eligible_assets",
            "preflights": preflight_rows,
            "operations": operation_rows,
            "failedAlbums": failed_albums,
        }
        _finish_apple_photos_import_progress(progress_id, "failed", result)
        return result
    batch_root, intake_routing = _apple_photos_intake_destination(repo_root, payload, "batch")
    materialized_albums: list[dict] = []
    for index, album_payload, preflight, operation in prepared_rows:
        album = preflight.get("album") if isinstance(preflight.get("album"), dict) else {}
        destination = batch_root / _apple_photos_batch_album_dir(index, str(album.get("title") or "album"))
        export_result = _run_apple_photos_bridge(
            repo_root,
            ["export", *_apple_photos_payload_args(album_payload), "--destination", str(destination)],
            progress_id=progress_id,
        )
        if not export_result.get("ok"):
            operation = update_import_operation_db(
                repo_root,
                str(operation.get("operationId") or ""),
                state="failed",
                error=str(export_result.get("error") or "Apple Photos export failed"),
            )
            failed_albums.append({**export_result, "album": album, "operation": operation})
            continue
        materialized = int(export_result.get("materializedCount") or 0)
        if materialized <= 0:
            nothing_message = _apple_photos_nothing_materialized_message(album_payload)
            operation = update_import_operation_db(
                repo_root,
                str(operation.get("operationId") or ""),
                state="failed",
                error=nothing_message,
            )
            failed_albums.append({
                **export_result,
                "ok": False,
                "album": album,
                "operation": operation,
                "error": nothing_message,
                "code": "nothing_materialized",
            })
            continue
        materialized_albums.append({**export_result, "preflight": preflight, "operation": operation})
    if not materialized_albums:
        nothing_message = _apple_photos_nothing_materialized_message({
            "allowIcloudDownloads": any(_apple_photos_allow_icloud_downloads(album_payload) for _, album_payload, _, _ in prepared_rows),
        })
        result = {
            "ok": False,
            "batch": True,
            "error": nothing_message,
            "code": "nothing_materialized",
            "preflights": preflight_rows,
            "operations": operation_rows,
            "failedAlbums": failed_albums,
        }
        _finish_apple_photos_import_progress(progress_id, "failed", result)
        return result
    batch_sidecar = _merge_apple_photos_batch_sidecars(batch_root, materialized_albums)
    unique_materialized = int(batch_sidecar.get("assetCount") or 0)
    if unique_materialized <= 0:
        result = {
            "ok": False,
            "batch": True,
            "error": "The selected albums only produced duplicate or invalid temporary assets.",
            "code": "nothing_materialized",
            "preflights": preflight_rows,
            "operations": operation_rows,
            "materializedAlbums": materialized_albums,
            "failedAlbums": failed_albums,
            "batchSidecar": batch_sidecar,
        }
        _finish_apple_photos_import_progress(progress_id, "failed", result)
        return result
    if intake_routing:
        review_source = _remember_apple_photos_real_estate_source(repo_root, intake_routing)
        review_stage = _apple_photos_real_estate_stage(batch_root, intake_routing, unique_materialized)
        review_stage["batchSidecar"] = batch_sidecar
    else:
        review_source = _remember_apple_photos_review_source(
            repo_root,
            batch_root,
            f"Apple Photos import: {len(materialized_albums):,} album(s)",
        )
        review_stage = _apple_photos_review_stage(batch_root, materialized_albums, batch_sidecar=batch_sidecar)
    updated_operations: list[dict] = []
    for row in materialized_albums:
        operation = row.get("operation") if isinstance(row.get("operation"), dict) else {}
        updated = update_import_operation_db(
            repo_root,
            str(operation.get("operationId") or ""),
            state="done",
            task=review_stage,
        )
        row["operation"] = updated
        updated_operations.append(updated)
    result = {
        "ok": True,
        "batch": True,
        "preflights": preflight_rows,
        "materializedAlbums": materialized_albums,
        "failedAlbums": failed_albums,
        "batchSidecar": batch_sidecar,
        "reviewStage": review_stage,
        "reviewSource": review_source,
        "intakeAssignment": review_stage.get("intakeAssignment") or {},
        "destinationKind": "real_estate" if intake_routing else "expo",
        "operations": updated_operations,
        "message": (
            (
                f"Apple Photos assigned {unique_materialized:,} unique asset(s) to "
                f"{intake_routing['track']} / {intake_routing['fixture']} / {intake_routing['project']}. "
                "The local fixture is registered for RE import; nothing was published."
            )
            if intake_routing
            else (
                f"Apple Photos exported {unique_materialized:,} unique asset(s)"
                f" from {len(materialized_albums):,} album(s) to a temporary import folder. Starting Expo import next."
            )
        ),
    }
    _finish_apple_photos_import_progress(progress_id, "done", result)
    return result


def _start_apple_photos_selected_asset_import(
    repo_root: Path,
    payload: dict,
    album_payloads: list[dict],
    selected_asset_ids: list[str],
) -> dict:
    """Materialize only checked PhotoKit assets and route them through the chosen intake lane."""
    if _active_apple_photos_import_task(repo_root):
        return _apple_photos_import_busy_response(repo_root)
    if not album_payloads:
        album_payloads = [payload]
    preflights: list[dict] = []
    allowed_asset_ids: set[str] = set()
    for album_payload in album_payloads:
        preflight = _apple_photos_preflight(repo_root, album_payload)
        preflights.append(preflight)
        for item in preflight.get("items") or []:
            if not isinstance(item, dict):
                continue
            if str(item.get("status") or "") not in {"candidate", "materialized"}:
                continue
            asset_id = str(item.get("localIdentifier") or "").strip()
            if asset_id:
                allowed_asset_ids.add(asset_id)
    unknown = [asset_id for asset_id in selected_asset_ids if asset_id not in allowed_asset_ids]
    if unknown:
        raise ValueError("Selected Apple Photos assets must belong to the selected albums and pass dry run")

    destination, intake_routing = _apple_photos_intake_destination(repo_root, payload, "selected-assets")
    materialized_rows: list[dict] = []
    failures: list[dict] = []
    for index, asset_id in enumerate(selected_asset_ids, start=1):
        asset_root = destination / f"{index:04d}-{hashlib.sha256(asset_id.encode('utf-8')).hexdigest()[:10]}"
        args = ["materialize-one", "--asset-id", asset_id, "--destination", str(asset_root)]
        if _apple_photos_allow_icloud_downloads(payload):
            args.append("--allow-icloud-downloads")
        export_result = _run_apple_photos_bridge(repo_root, args)
        if export_result.get("ok") and int(export_result.get("materializedCount") or 0) > 0:
            materialized_rows.append(export_result)
        else:
            failures.append({
                "assetLocalIdentifier": asset_id,
                "error": str(export_result.get("error") or "Apple Photos asset was not materialized"),
            })
    if not materialized_rows:
        return {
            "ok": False,
            "batch": True,
            "code": "nothing_materialized",
            "error": _apple_photos_nothing_materialized_message(payload),
            "preflights": preflights,
            "failedAssets": failures,
        }

    batch_sidecar = _merge_apple_photos_batch_sidecars(destination, materialized_rows)
    materialized_count = int(batch_sidecar.get("assetCount") or 0)
    if materialized_count <= 0:
        return {
            "ok": False,
            "batch": True,
            "code": "nothing_materialized",
            "error": "The selected Apple Photos assets only produced duplicate or invalid local files.",
            "preflights": preflights,
            "failedAssets": failures,
        }

    operation_payload = {**payload, "selectedAssetIds": selected_asset_ids}
    synthetic_preflight = {
        "ok": True,
        "candidateCount": len(selected_asset_ids),
        "count": sum(int(row.get("count") or 0) for row in preflights),
        "items": [
            item
            for row in preflights
            for item in (row.get("items") or [])
            if isinstance(item, dict) and str(item.get("localIdentifier") or "") in set(selected_asset_ids)
        ],
    }
    operation = _record_apple_photos_import_operation(
        repo_root,
        operation_payload,
        synthetic_preflight,
        state="done",
    )
    if intake_routing:
        review_source = _remember_apple_photos_real_estate_source(repo_root, intake_routing)
        review_stage = _apple_photos_real_estate_stage(destination, intake_routing, materialized_count)
        message = (
            f"Apple Photos assigned {materialized_count:,} selected asset(s) to "
            f"{intake_routing['track']} / {intake_routing['fixture']} / {intake_routing['project']}. "
            "The local fixture is registered for RE import; nothing was published."
        )
    else:
        review_source = _remember_apple_photos_review_source(
            repo_root,
            destination,
            f"Apple Photos selection: {materialized_count:,} asset(s)",
        )
        review_stage = _apple_photos_review_stage(destination, materialized_rows, batch_sidecar=batch_sidecar)
        message = (
            f"Apple Photos exported {materialized_count:,} selected asset(s) to a temporary import folder. "
            "Starting Expo import next."
        )
    review_stage["batchSidecar"] = batch_sidecar
    operation = update_import_operation_db(
        repo_root,
        str(operation.get("operationId") or ""),
        state="done",
        task=review_stage,
    )
    return {
        "ok": True,
        "batch": True,
        "selectedAssets": True,
        "preflights": preflights,
        "materializedAlbums": materialized_rows,
        "failedAssets": failures,
        "batchSidecar": batch_sidecar,
        "reviewStage": review_stage,
        "reviewSource": review_source,
        "intakeAssignment": review_stage.get("intakeAssignment") or {},
        "destinationKind": "real_estate" if intake_routing else "expo",
        "operations": [operation],
        "message": message,
    }


def _start_apple_photos_import(repo_root: Path, payload: dict) -> dict:
    album_payloads = _apple_photos_album_batch_payloads(payload)
    selected_asset_ids = _apple_photos_selected_asset_ids(payload)
    preflight_only = bool(payload.get("dryRun") or payload.get("dry_run"))
    if selected_asset_ids and not preflight_only:
        return _start_apple_photos_selected_asset_import(
            repo_root,
            payload,
            album_payloads,
            selected_asset_ids,
        )
    if album_payloads:
        return _start_apple_photos_batch_import(repo_root, payload, album_payloads)
    if not preflight_only and _active_apple_photos_import_task(repo_root):
        return _apple_photos_import_busy_response(repo_root)
    progress_id = "" if preflight_only else _apple_photos_progress_id(payload)
    if progress_id:
        _start_apple_photos_import_progress(progress_id, [payload])
    preflight = _apple_photos_preflight(repo_root, payload)
    if not preflight.get("ok"):
        operation = _record_apple_photos_import_operation(
            repo_root,
            payload,
            preflight,
            state="failed",
            error=str(preflight.get("error") or ""),
        )
        result = {**preflight, "operation": operation}
        _finish_apple_photos_import_progress(progress_id, "failed", result)
        return result
    operation = _record_apple_photos_import_operation(repo_root, payload, preflight, state="preflighted")
    payload = {**payload, "operationId": operation.get("operationId") or payload.get("operationId")}
    if preflight_only:
        return {**preflight, "dryRun": True, "operation": operation}
    candidate_count = int(preflight.get("candidateCount") or 0)
    if candidate_count <= 0:
        operation = update_import_operation_db(
            repo_root,
            str(operation.get("operationId") or ""),
            state="failed",
            error="No eligible Apple Photos assets are available to import.",
        )
        result = {
            **preflight,
            "ok": False,
            "error": "No eligible Apple Photos assets are available to import.",
            "code": "no_eligible_assets",
            "operation": operation,
        }
        _finish_apple_photos_import_progress(progress_id, "failed", result)
        return result
    album = preflight.get("album") if isinstance(preflight.get("album"), dict) else {}
    destination, intake_routing = _apple_photos_intake_destination(
        repo_root,
        payload,
        str(album.get("title") or "album"),
    )
    export_result = _run_apple_photos_bridge(
        repo_root,
        ["export", *_apple_photos_payload_args(payload), "--destination", str(destination)],
        progress_id=progress_id,
    )
    if not export_result.get("ok"):
        operation = update_import_operation_db(
            repo_root,
            str(operation.get("operationId") or ""),
            state="failed",
            error=str(export_result.get("error") or "Apple Photos export failed"),
        )
        result = {**export_result, "operation": operation}
        _finish_apple_photos_import_progress(progress_id, "failed", result)
        return result
    materialized = int(export_result.get("materializedCount") or 0)
    if materialized <= 0:
        nothing_message = _apple_photos_nothing_materialized_message(payload)
        operation = update_import_operation_db(
            repo_root,
            str(operation.get("operationId") or ""),
            state="failed",
            error=nothing_message,
        )
        result = {
            **export_result,
            "ok": False,
            "error": nothing_message,
            "code": "nothing_materialized",
            "operation": operation,
        }
        _finish_apple_photos_import_progress(progress_id, "failed", result)
        return result
    if intake_routing:
        review_source = _remember_apple_photos_real_estate_source(repo_root, intake_routing)
        review_stage = _apple_photos_real_estate_stage(destination, intake_routing, materialized)
    else:
        review_source = _remember_apple_photos_review_source(
            repo_root,
            destination,
            f"Apple Photos import: {album.get('title') or payload.get('albumName') or 'album'}",
        )
        review_stage = _apple_photos_review_stage(destination, [{**export_result, "preflight": preflight}])
    operation = update_import_operation_db(
        repo_root,
        str(operation.get("operationId") or ""),
        state="done",
        task=review_stage,
    )
    result = {
        "ok": True,
        "preflight": preflight,
        "materialized": export_result,
        "reviewStage": review_stage,
        "reviewSource": review_source,
        "intakeAssignment": review_stage.get("intakeAssignment") or {},
        "destinationKind": "real_estate" if intake_routing else "expo",
        "operation": operation,
        "message": (
            (
                f"Apple Photos assigned {materialized:,} asset(s) to "
                f"{intake_routing['track']} / {intake_routing['fixture']} / {intake_routing['project']}. "
                "The local fixture is registered for RE import; nothing was published."
            )
            if intake_routing
            else f"Apple Photos exported {materialized:,} asset(s) to a temporary import folder. Starting Expo import next."
        ),
    }
    _finish_apple_photos_import_progress(progress_id, "done", result)
    return result


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


def _access_user_kv_key(email: str) -> str:
    return f"{ACCESS_USER_KV_PREFIX}:access-users:{email}"


def _access_users_counts(users: list[dict]) -> dict:
    counts = {"total": len(users), "owners": 0, "realEstateClients": 0, "pending": 0, "failed": 0}
    for user in users:
        if user.get("tier") == "owner":
            counts["owners"] += 1
        if user.get("tier") == "re_client" or user.get("realEstateClients"):
            counts["realEstateClients"] += 1
        if user.get("publishStatus") == "pending":
            counts["pending"] += 1
        if user.get("publishStatus") == "failed":
            counts["failed"] += 1
    return counts


def owner_access_users_summary(repo_root: Path) -> dict:
    users = list_access_users_db(repo_root)
    return {
        "ok": True,
        "admin": True,
        "adminEmail": OWNER_ADMIN_EMAIL,
        "machineNames": _local_machine_names(),
        "path": str(OWNER_ACTION_ROOT / "Owner.sqlite"),
        "kv": {
            "binding": ACCESS_USER_KV_BINDING,
            "prefix": ACCESS_USER_KV_PREFIX,
            "remote": True,
            "keyPattern": f"{ACCESS_USER_KV_PREFIX}:access-users:<email>",
        },
        "counts": _access_users_counts(users),
        "users": users,
    }


def _access_user_payload_from_request(payload: dict) -> dict:
    source = payload.get("user") if isinstance(payload.get("user"), dict) else payload
    if not isinstance(source, dict):
        raise ValueError("user payload is required")
    user = {
        "email": source.get("email"),
        "tier": source.get("tier") or "user",
        "realEstateClients": source.get("realEstateClients") or source.get("realEstateGalleries") or source.get("galleryKeys") or [],
        "displayName": source.get("displayName") or source.get("display_name") or "",
        "notes": source.get("notes") or "",
        "grantedBy": source.get("grantedBy") or OWNER_ADMIN_EMAIL,
    }
    if source.get("grantedAt"):
        user["grantedAt"] = source.get("grantedAt")
    return user


def _find_access_user(repo_root: Path, email: str) -> dict:
    target = str(email or "").strip().lower()
    for user in list_access_users_db(repo_root):
        if user.get("email") == target:
            return user
    raise ValueError("access user was not found")


def _publish_access_user_to_worker_kv(repo_root: Path, user: dict) -> dict:
    record = user.get("kvRecord") if isinstance(user.get("kvRecord"), dict) else user
    email = str(record.get("email") or user.get("email") or "").strip().lower()
    if not email:
        raise ValueError("valid email is required")
    record = {
        "schema": "photosbyelie.accessUser.v1",
        "email": email,
        "tier": str(record.get("tier") or user.get("tier") or "user").strip().lower(),
        "realEstateClients": record.get("realEstateClients") or user.get("realEstateClients") or [],
        "grantedBy": str(record.get("grantedBy") or user.get("grantedBy") or OWNER_ADMIN_EMAIL).strip(),
        "grantedAt": record.get("grantedAt") or user.get("grantedAt") or None,
        "updatedAt": record.get("updatedAt") or user.get("updatedAt") or datetime.now(timezone.utc).isoformat(),
    }
    key = _access_user_kv_key(email)
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            prefix="pbe-access-user-",
            suffix=".json",
            delete=False,
        ) as tmp:
            tmp.write(json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
            tmp_path = Path(tmp.name)
        command = [
            "npx",
            "wrangler",
            "kv",
            "key",
            "put",
            key,
            "--path",
            str(tmp_path),
            "--binding",
            ACCESS_USER_KV_BINDING,
            "--remote",
        ]
        result = subprocess.run(command, cwd=repo_root, check=False, capture_output=True, text=True, timeout=120)
        output = ((result.stdout or "") + (("\n" + result.stderr) if result.stderr else "")).strip()
        if result.returncode != 0:
            raise RuntimeError(output[-2000:] or "wrangler kv key put failed")
        return {
            "ok": True,
            "key": key,
            "binding": ACCESS_USER_KV_BINDING,
            "output": output[-2000:],
        }
    finally:
        if tmp_path:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass


def _publish_and_mark_access_user(repo_root: Path, user: dict) -> tuple[dict, dict]:
    try:
        publish = _publish_access_user_to_worker_kv(repo_root, user)
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        updated = mark_access_user_published_db(repo_root, user.get("email") or "", ok=False, error=str(error))
        return updated, {"ok": False, "error": str(error)}
    updated = mark_access_user_published_db(repo_root, user.get("email") or "", ok=True)
    return updated, publish


def apply_owner_access_user_action(repo_root: Path, payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("JSON payload is required")
    action = str(payload.get("action") or "save-user").strip()
    publish_requested = bool(payload.get("publish"))
    publish_result: dict | None = None

    if action in {"list-users", "list"}:
        return owner_access_users_summary(repo_root)
    if action in {"save-user", "save"}:
        user = upsert_access_user_db(repo_root, _access_user_payload_from_request(payload))
        if publish_requested:
            user, publish_result = _publish_and_mark_access_user(repo_root, user)
    elif action in {"publish-user", "publish"}:
        if isinstance(payload.get("user"), dict):
            user = upsert_access_user_db(repo_root, _access_user_payload_from_request(payload))
        else:
            user = _find_access_user(repo_root, str(payload.get("email") or ""))
        user, publish_result = _publish_and_mark_access_user(repo_root, user)
    else:
        raise ValueError(f"unsupported access user action: {action}")

    summary = owner_access_users_summary(repo_root)
    summary["action"] = action
    summary["user"] = user
    if publish_result is not None:
        summary["publish"] = publish_result
    return summary


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
    client = _normalize_real_estate_client(incoming, clients_by_id.get(client_id), require_password=False)
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
        if key in {"name", "username", "email"}
    }
    public_manifest.pop("auth", None)
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


def apply_public_photo_moderation(repo_root: Path, payload: dict) -> dict:
    """Apply a supported public Owner action through the local connector.

    GitHub Pages cannot be mutated by the Max connector. Public Owner culling
    therefore records the durable lifecycle decision immediately; the normal
    catalog publication pipeline consumes that state on its next publish.
    """
    operation = str(payload.get("operation") or payload.get("action") or "").strip().lower()
    photo_ids = _normalized_photo_ids(payload.get("photo_ids") or payload.get("photoIds") or payload.get("photo_id"))
    if operation == "save-keyword-blacklist":
        result = apply_photo_action(repo_root, {
            "action": operation,
            "keywords": payload.get("keywords") or [],
            "mode": payload.get("mode") or "replace",
        })
        return {**result, "catalog_publish_pending": True}
    if operation in {
        "save-title-keyword-review-approvals",
        "apply-title-keyword-review-approvals",
        "apply-approved-title-keyword-review-approvals",
    }:
        result = apply_photo_action(repo_root, {
            "action": operation,
            "batch_id": payload.get("batch_id"),
            "approvals": payload.get("approvals") or [],
            "rejections": payload.get("rejections") or [],
            "blocked": payload.get("blocked") or [],
            "reason": payload.get("reason") or "native-backstage",
        })
        return {**result, "catalog_publish_pending": True}
    if operation == "update-photo-metadata":
        if len(photo_ids) != 1:
            raise ValueError("public metadata update requires exactly one photo id")
        result = apply_photo_action(repo_root, {
            "action": operation,
            "photo_id": photo_ids[0],
            "title": payload.get("title"),
            "caption": payload.get("caption"),
            "keywords": payload.get("keywords") or [],
        })
        return {**result, "catalog_publish_pending": True}
    if operation == "discard":
        if len(photo_ids) != 1:
            raise ValueError("public discard requires exactly one photo id")
        result = apply_photo_action(repo_root, {
            "action": operation,
            "photo_id": photo_ids[0],
        })
        hidden_ids = sorted(_lifecycle_hidden_ids(repo_root))
        return {**result, "hidden_ids": hidden_ids, "catalog_publish_pending": True}
    if operation not in {"hide", "hide-many", "undo-hide", "undo-hide-many"}:
        raise ValueError("unsupported public photo moderation operation")
    if not photo_ids or len(photo_ids) > 500:
        raise ValueError("public photo moderation requires 1 to 500 photo ids")

    hidden_before = _lifecycle_hidden_ids(repo_root)
    if operation in {"hide", "hide-many"}:
        hidden_at = datetime.now(timezone.utc).isoformat()
        entries = []
        already_hidden = []
        not_found = []
        manifest_source_paths = _source_paths_from_manifest_rows_for_ids(repo_root, set(photo_ids))
        for photo_id in photo_ids:
            if photo_id in hidden_before:
                already_hidden.append(photo_id)
                continue
            fallback = _catalog_photo_for_hidden(repo_root, photo_id)
            if not fallback:
                not_found.append(photo_id)
                continue
            source_slug, source_photo = fallback
            entries.append(
                _hidden_lifecycle_entry(
                    repo_root,
                    source_photo,
                    photo_id,
                    "expo",
                    source_slug,
                    hidden_at,
                    manifest_source_paths.get(photo_id, []),
                )
            )
        if not entries and not already_hidden:
            raise ValueError(f"photo not found in SQLite catalog: {photo_ids[0]}")
        lifecycle = _record_hidden_lifecycle(repo_root, entries)
        hidden_ids = sorted(hidden_before | {entry["id"] for entry in entries})
        return {
            "ok": True,
            "action": operation,
            "photo_ids": photo_ids,
            "hidden_ids": hidden_ids,
            "already_hidden": already_hidden,
            "not_found": not_found,
            "lifecycle": lifecycle,
            "catalog_publish_pending": True,
        }

    restored_ids = [photo_id for photo_id in photo_ids if photo_id in hidden_before]
    already_active = [photo_id for photo_id in photo_ids if photo_id not in hidden_before]
    lifecycle = record_media_lifecycle_restored_db(repo_root, restored_ids) if restored_ids else {
        "active": 0,
        "title_restored": 0,
        "skipped_discarded": 0,
    }
    return {
        "ok": True,
        "action": operation,
        "photo_ids": photo_ids,
        "restored_ids": restored_ids,
        "already_active": already_active,
        "hidden_ids": sorted(hidden_before - set(restored_ids)),
        "lifecycle": lifecycle,
        "catalog_publish_pending": True,
    }


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
        "queue-import-cache-title-keyword-review",
        "queue-title-keyword-review",
        "queue-title-keyword-review-many",
        "apply-title-keyword-review-approvals",
        "apply-approved-title-keyword-review-approvals",
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
        "queue-import-cache-title-keyword-review",
        "queue-title-keyword-review-many",
        "sync-country-keywords",
        "remove-collection-keyword",
        "publish-hidden-blacklist",
        "wipe-hidden-r2",
        "save-title-keyword-review-approvals",
        "apply-title-keyword-review-approvals",
        "apply-approved-title-keyword-review-approvals",
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

    if action == "queue-import-cache-title-keyword-review":
        source_root_text = str(payload.get("source_root") or payload.get("sourceRoot") or "").strip()
        source_root = Path(source_root_text).expanduser() if source_root_text else None
        try:
            limit = int(payload.get("limit") or 0)
        except (TypeError, ValueError) as error:
            raise ValueError("limit must be a number") from error
        queue_result = queue_import_cache_title_keyword_review(
            repo_root,
            source_root=source_root,
            source_label=str(payload.get("source_label") or payload.get("sourceLabel") or ""),
            limit=limit,
        )
        return {
            "ok": True,
            "action": action,
            **queue_result,
        }

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
        pre_catalog_not_found = _pre_catalog_review_ready_ids(repo_root, not_found)
        hard_not_found = [media_id for media_id in not_found if media_id not in pre_catalog_not_found]
        not_found_records = _review_record_not_found(hard_not_found, normalized, batch_id)
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
            "hard_not_found": hard_not_found,
            "pre_catalog_not_found": sorted(pre_catalog_not_found),
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
        caption = str(payload.get("caption") or "").strip()
        keywords = _unique_keywords(_split_keyword_text(payload.get("keywords")))
        catalog_update = _update_public_catalog_metadata(repo_root, photo_id, title, caption, keywords)
        if int(catalog_update.get("updated") or 0) > 0:
            worker_catalog = _write_worker_catalog(repo_root)
            return {
                "ok": True,
                "action": action,
                "photo_id": photo_id,
                "updated": [{"state": "catalog", "slug": "", "id": photo_id}],
                "metadata_changed": 1,
                "file_updates": {
                    "updated": 0,
                    "skipped": 0,
                    "error_count": 0,
                    "errors": [],
                    "state": "sqlite-catalog",
                },
                "metadata": {
                    "photo_id": photo_id,
                    "title": title,
                    "caption": caption,
                    "keywords": keywords,
                },
                "previous_metadata": catalog_update.get("previous") or {},
                "catalog": catalog_update,
                "worker_catalog": worker_catalog,
            }
        matches = (
            [("expo", *item) for item in _matching_photos(expo_groups, photo_id)]
            + [("reserve", *item) for item in _matching_photos(reserve_groups, photo_id)]
            + [("hidden", *item) for item in _matching_photos(hidden_groups, photo_id)]
        )
        if not matches:
            raise ValueError(f"photo not found: {photo_id}")
        previous_photo = matches[0][2]
        previous_metadata = {
            "photo_id": photo_id,
            "title": str(previous_photo.get("title") or "").strip(),
            "caption": str(previous_photo.get("caption") or _metadata_label_value(previous_photo, "Caption") or "").strip(),
            "keywords": _unique_keywords(
                previous_photo.get("keywords")
                or _split_keyword_text(_metadata_label_value(previous_photo, "Keywords"))
            ),
        }
        metadata_changed = 0
        for _state, _slug, photo in matches:
            title_changed = _set_photo_title(photo, title)
            caption_changed = _set_photo_caption(photo, caption)
            keywords_changed = _set_photo_keywords(photo, keywords)
            if title_changed or caption_changed or keywords_changed:
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
                "caption": caption,
                "keywords": keywords,
            },
            "previous_metadata": previous_metadata,
            "worker_catalog": worker_catalog,
            "site": site_state,
        }

    if action == "apply-title-keyword-review-approvals":
        batch_id = str(payload.get("batch_id") or "").strip()
        if not batch_id:
            raise ValueError("batch_id must be a non-empty string")
        return _apply_title_keyword_review_approval_payload(
            repo_root,
            action=action,
            batch_id=batch_id,
            approvals=_normalize_title_keyword_approvals(repo_root, batch_id, payload.get("approvals")),
            rejections=_normalize_title_keyword_rejections(repo_root, batch_id, payload.get("rejections") or []),
        )

    if action == "apply-approved-title-keyword-review-approvals":
        batch_id = "approved-pending-auto-apply"
        approvals = _pending_approved_title_keyword_approvals(repo_root)
        result = _apply_title_keyword_review_approval_payload(
            repo_root,
            action=action,
            batch_id=batch_id,
            approvals=approvals,
            rejections=[],
            allow_empty=True,
            fail_on_not_found=True,
        )
        result["pending_count"] = len(approvals)
        result["auto_apply_reason"] = str(payload.get("reason") or "review-exit")
        return result

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
