#!/usr/bin/env python3
"""Local Photos By Elie preview server with owner-only helper endpoints."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import os
import secrets
import json
import mimetypes
import re
import shutil
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
OWNER_SESSION_PATH = "/__photosbyelie/owner-session"
OWNER_LOGIN_PATH = "/__photosbyelie/owner-login"
OWNER_LOGOUT_PATH = "/__photosbyelie/owner-logout"
MAX_BODY_BYTES = 5 * 1024 * 1024
LOCAL_CLIENTS = {"127.0.0.1", "::1", "localhost"}
DERIVATIVES = (("gallery", "gallerySrc"), ("detail", "imageSrc"))
COUNTRY_ASSIGNMENT_TARGETS = {"france", "usa", "spain", "mexico", "portugal", "slovakia"}
OWNER_SESSION_COOKIE = "pbe_owner_session"
OWNER_SESSION_SECONDS = 12 * 60 * 60
OWNER_ACTION_ROOT = Path("assets/owner-actions")
COUNTRY_ASSIGNMENT_LOG = OWNER_ACTION_ROOT / "country-assignments.jsonl"
COUNTRY_ASSIGNMENT_INDEX = OWNER_ACTION_ROOT / "country-assignments.json"
ACTION_PROGRESS: dict[str, dict] = {}
R2_BACKGROUND_TASKS: dict[str, dict] = {}
R2_BACKGROUND_LOCK = threading.Lock()
OWNER_SESSIONS: dict[str, float] = {}
OWNER_SESSION_LOCK = threading.Lock()

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
    regular_asset_rel,
    reserve_return_rel,
    write_hidden_data_from_site,
    write_photos_data_from_site,
    write_regular_manifest_from_site,
    write_reserve_data_from_site,
)
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


COLLECTION_KEYWORD_TARGETS = {
    slug: label
    for slug, (_number, label, _accent, _description) in LABELS.items()
    if slug != "unknown"
}
SOURCE_ROOT_CANDIDATES = [
    Path("/Volumes/Saturn/Pictures/LR/Camera"),
    Path("/Volumes/Saturn/Pictures/LR/_All Leonardo"),
    Path("/Volumes/Saturn/Pictures/LR"),
    Path("/Volumes/Saturn"),
    Path.home() / "Pictures/LR/Camera",
    Path.home() / "Pictures/LR/_All Leonardo",
]
HIDDEN_BLACKLIST_PATH = HIDDEN_ASSET_ROOT / "hidden-blacklist.json"
HIDDEN_BLACKLIST_R2_KEY = "hidden-blacklist.json"


class PhotosByElieLocalHandler(SimpleHTTPRequestHandler):
    server_version = "PhotosByElieLocal/1.0"

    def translate_path(self, path: str) -> str:
        translated = Path(super().translate_path(path))
        request_path = urlparse(path).path
        if request_path.startswith("/assets/expo/") and not translated.exists():
            reserve_path = Path.cwd() / "assets/reserve" / request_path.removeprefix("/assets/expo/")
            if reserve_path.exists():
                return str(reserve_path)
        return str(translated)

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == OWNER_SESSION_PATH:
            self._handle_owner_session()
            return
        if path == PHOTO_ACTION_PROGRESS_PATH:
            self._handle_photo_action_progress()
            return
        if path == R2_PROGRESS_PATH:
            self._handle_r2_progress()
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
        if path == PHOTO_ACTION_PATH:
            self._handle_photo_action()
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _handle_photo_action(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        if not self._is_owner_authenticated():
            self._send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "owner login required"})
            return
        try:
            payload = self._read_json_body()
            result = apply_photo_action(Path.cwd(), payload)
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
        if not self._is_owner_authenticated():
            self._send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "owner login required"})
            return
        query = parse_qs(urlparse(self.path).query)
        operation_id = (query.get("operation_id") or [""])[0]
        progress = ACTION_PROGRESS.get(operation_id) if operation_id else None
        self._send_json(HTTPStatus.OK, {"ok": True, "progress": progress})

    def _handle_r2_progress(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        if not self._is_owner_authenticated():
            self._send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "owner login required"})
            return
        self._send_json(HTTPStatus.OK, {"ok": True, "tasks": _r2_task_snapshot()})

    def _handle_owner_session(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        self._send_json(HTTPStatus.OK, self._owner_session_payload())

    def _handle_owner_login(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = self._read_json_body()
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        password = str(payload.get("password") or "")
        expected_password = getattr(self.server, "owner_password", "")
        if not expected_password or not secrets.compare_digest(password, expected_password):
            self._send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "owner login failed"})
            return
        token = secrets.token_urlsafe(32)
        expires_at = time.time() + OWNER_SESSION_SECONDS
        with OWNER_SESSION_LOCK:
            OWNER_SESSIONS[token] = expires_at
        response = self._owner_session_payload(token=token)
        self._send_json(
            HTTPStatus.OK,
            response,
            extra_headers={
                "Set-Cookie": (
                    f"{OWNER_SESSION_COOKIE}={token}; Path=/; Max-Age={OWNER_SESSION_SECONDS}; "
                    "HttpOnly; SameSite=Strict"
                )
            },
        )

    def _handle_owner_logout(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        token = self._owner_session_token()
        if token:
            with OWNER_SESSION_LOCK:
                OWNER_SESSIONS.pop(token, None)
        self._send_json(
            HTTPStatus.OK,
            {"ok": True, "authenticated": False},
            extra_headers={
                "Set-Cookie": f"{OWNER_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict"
            },
        )

    def _is_loopback_request(self) -> bool:
        host = self.headers.get("Host", "").split(":", 1)[0].strip("[]")
        client = self.client_address[0]
        if client.startswith("127.") or client == "::1":
            return host in LOCAL_CLIENTS or host.startswith("127.")
        return False

    def _owner_session_payload(self, token: str | None = None) -> dict:
        return {
            "ok": True,
            "authenticated": self._is_owner_authenticated(token=token),
            "sessionSeconds": OWNER_SESSION_SECONDS,
            "passwordConfigured": getattr(self.server, "owner_password_source", "generated") != "generated",
            "passwordSource": getattr(self.server, "owner_password_source", "generated"),
        }

    def _owner_session_token(self) -> str | None:
        cookies = self.headers.get("Cookie", "")
        for part in cookies.split(";"):
            name, separator, value = part.strip().partition("=")
            if separator and name == OWNER_SESSION_COOKIE and value:
                return value
        return None

    def _is_owner_authenticated(self, token: str | None = None) -> bool:
        token = token or self._owner_session_token()
        if not token:
            return False
        now = time.time()
        with OWNER_SESSION_LOCK:
            expires_at = OWNER_SESSIONS.get(token)
            if not expires_at or expires_at <= now:
                OWNER_SESSIONS.pop(token, None)
                return False
            return True

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
    args = parser.parse_args()

    owner_password = (
        os.environ.get("PHOTOSBYELIE_OWNER_PASSWORD")
        or os.environ.get("PBE_OWNER_PASSWORD")
        or ""
    )
    owner_password_source = "PHOTOSBYELIE_OWNER_PASSWORD/PBE_OWNER_PASSWORD" if owner_password else "generated"
    if not owner_password:
        owner_password = secrets.token_urlsafe(12)

    server = ThreadingHTTPServer((args.bind, args.port), PhotosByElieLocalHandler)
    server.owner_password = owner_password
    server.owner_password_source = owner_password_source
    url_host = "localhost" if args.bind in {"127.0.0.1", "::1"} else args.bind
    print(f"Serving Photos By Elie at http://{url_host}:{args.port}/")
    print(f"Live photo action endpoint: {PHOTO_ACTION_PATH}")
    if owner_password_source == "generated":
        print(f"Owner login code for this server session: {owner_password}")
    else:
        print(f"Owner login password loaded from {owner_password_source}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        server.server_close()
    return 0


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
    if state == "expo":
        return regular_asset_rel(photo, derivative, slug)
    if state == "reserve":
        return reserve_return_rel(photo, derivative, slug)
    if state == "hidden":
        return hidden_asset_rel(photo, derivative, slug)
    raise ValueError(f"unsupported destination state: {state}")


def _move_photo(repo_root: Path, source_photo: dict, state: str, slug: str) -> dict:
    photo = copy_photo(source_photo)
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


def _hidden_review_photo(source_photo: dict, source_slug: str, source_state: str = "expo") -> dict:
    photo = copy_photo(source_photo)
    photo["hiddenFromState"] = source_state if source_state in {"expo", "reserve"} else "expo"
    photo["hiddenFromSlug"] = source_slug if source_slug in ORDER else "unknown"
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
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _record_country_assignments(repo_root: Path, target_slug: str, moved: list[dict], skipped: list[dict]) -> dict:
    if not moved and not skipped:
        return {}

    created_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    batch_id = f"{created_at}-{uuid.uuid4().hex[:8]}"
    event = {
        "batch_id": batch_id,
        "created_at": created_at,
        "action": "assign-country",
        "target_slug": target_slug,
        "moved": moved,
        "skipped": skipped,
    }

    log_path = repo_root / COUNTRY_ASSIGNMENT_LOG
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")

    index_path = repo_root / COUNTRY_ASSIGNMENT_INDEX
    index = _read_json_file(index_path, {"format": "photosbyelie-country-assignments", "photos": {}})
    if not isinstance(index, dict):
        index = {"format": "photosbyelie-country-assignments", "photos": {}}
    photos = index.get("photos")
    if not isinstance(photos, dict):
        photos = {}
        index["photos"] = photos
    index["format"] = "photosbyelie-country-assignments"
    index["updated_at"] = created_at
    index["latest_batch_id"] = batch_id
    for item in moved:
        photo_id = item.get("id")
        if not photo_id:
            continue
        photos[photo_id] = {
            "gallery_key": target_slug,
            "state": item.get("to"),
            "from_state": item.get("from"),
            "from_slug": item.get("from_slug"),
            "assigned_at": created_at,
            "batch_id": batch_id,
            "assets": item.get("assets") or {},
        }
    _write_json_file(index_path, index)

    return {
        "log": COUNTRY_ASSIGNMENT_LOG.as_posix(),
        "index": COUNTRY_ASSIGNMENT_INDEX.as_posix(),
        "batch_id": batch_id,
    }


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


def _write_state(repo_root: Path, expo_groups: dict[str, list[dict]], reserve_groups: dict[str, list[dict]], hidden_groups: dict[str, list[dict]]) -> dict:
    _repair_hidden_references(repo_root, hidden_groups, expo_groups, reserve_groups)
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


def _source_paths(repo_root: Path, photo: dict) -> list[Path]:
    paths = []
    for source in photo.get("sourceFiles") or []:
        raw_path = source.get("path")
        if not raw_path:
            continue
        rel = Path(str(raw_path))
        candidates = []
        if rel.is_absolute():
            candidates.append(rel)
        else:
            candidates.append(repo_root / rel)
            candidates.extend(root / rel for root in SOURCE_ROOT_CANDIDATES)
        for candidate in candidates:
            try:
                resolved = candidate.resolve()
            except OSError:
                resolved = candidate
            if candidate.exists() and resolved not in paths:
                paths.append(resolved)
    return paths


def _append_unique_path(paths: list[Path], path: Path) -> None:
    try:
        resolved = path.resolve()
    except OSError:
        resolved = path
    if resolved not in paths:
        paths.append(resolved)


def _site_asset_paths(repo_root: Path, rel: str) -> list[Path]:
    """Resolve a site asset reference, including localhost-only Expo-to-Reserve fallback."""
    paths: list[Path] = []
    if not rel:
        return paths
    direct = repo_root / rel
    if direct.exists():
        _append_unique_path(paths, direct)
    if rel.startswith("assets/expo/"):
        reserve_rel = "assets/reserve/" + rel.removeprefix("assets/expo/")
        reserve_path = repo_root / reserve_rel
        if reserve_path.exists():
            _append_unique_path(paths, reserve_path)
    elif rel.startswith("assets/reserve/"):
        expo_rel = "assets/expo/" + rel.removeprefix("assets/reserve/")
        expo_path = repo_root / expo_rel
        if expo_path.exists():
            _append_unique_path(paths, expo_path)
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
                key=r2_public_key(DEFAULT_PUBLIC_PREFIX, rel),
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


def _r2_task_snapshot() -> list[dict]:
    cutoff = time.time() - 60 * 60
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
        return sorted(
            [dict(task) for task in R2_BACKGROUND_TASKS.values()],
            key=lambda task: str(task.get("queued_at") or ""),
            reverse=True,
        )


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


def _sync_photo_metadata_files(repo_root: Path, photo: dict, title: str, keywords: list[str]) -> dict:
    updated = 0
    skipped = 0
    errors = []
    updated_paths = []
    for path in _photo_file_paths(repo_root, photo):
        rel = path.relative_to(repo_root).as_posix() if path.is_relative_to(repo_root) else str(path)
        try:
            _write_file_metadata(path, title=title, keywords=keywords)
            updated += 1
            updated_paths.append(str(path))
        except (OSError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
            errors.append(f"{rel}: {error}")
    return {"updated": updated, "skipped": skipped, "errors": errors, "updated_paths": updated_paths}


def _apply_collection_keyword(repo_root: Path, photo: dict, slug: str, sync_assets: bool = True) -> dict:
    keyword = COLLECTION_KEYWORD_TARGETS.get(slug)
    if not keyword:
        return {"keyword": "", "metadata_changed": False, "assets": {"updated": 0, "skipped": 0, "errors": []}}
    metadata_changed = _ensure_photo_keyword(photo, keyword)
    caption_changed = _ensure_country_caption(photo, slug)
    assets = _sync_asset_keyword(repo_root, photo, keyword) if sync_assets else {"updated": 0, "skipped": 0, "errors": []}
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
    r2_items: list[UploadItem] = []
    seen_r2_items: set[str] = set()
    for groups in state_groups:
        for slug, keyword in COLLECTION_KEYWORD_TARGETS.items():
            for photo in groups.get(slug, []):
                photos_seen += 1
                result = _apply_collection_keyword(repo_root, photo, slug)
                if result["metadata_changed"] or result["caption_changed"]:
                    metadata_changed += 1
                asset_updated += result["assets"].get("updated", 0)
                asset_skipped += result["assets"].get("skipped", 0)
                errors.extend(result["assets"].get("errors", []))
                updated_paths = [Path(item) for item in result["assets"].get("updated_paths", [])]
                for item in _metadata_upload_items_for_paths(repo_root, photo, updated_paths):
                    identifier = r2_upload_id(item)
                    if identifier in seen_r2_items:
                        continue
                    seen_r2_items.add(identifier)
                    r2_items.append(item)
    r2_task = _start_r2_upload_task("country-keywords", r2_items)
    return {
        "photos_seen": photos_seen,
        "metadata_changed": metadata_changed,
        "asset_updated": asset_updated,
        "asset_skipped": asset_skipped,
        "r2_upload_task": r2_task,
        "errors": errors[:20],
        "error_count": len(errors),
    }


def apply_photo_action(repo_root: Path, payload: dict) -> dict:
    action = payload.get("action")
    photo_id = payload.get("photo_id")
    if action not in {"hide", "undo-hide", "promote-hidden", "return-to-reserve", "assign-country", "sync-country-keywords", "update-photo-metadata", "publish-hidden-blacklist", "wipe-hidden-r2"}:
        raise ValueError("unsupported photo action")
    if action not in {"assign-country", "sync-country-keywords", "publish-hidden-blacklist", "wipe-hidden-r2"} and (not isinstance(photo_id, str) or not photo_id):
        raise ValueError("photo_id must be a non-empty string")
    if action == "assign-country":
        target_slug = payload.get("gallery_key") or payload.get("country")
        if target_slug not in COUNTRY_ASSIGNMENT_TARGETS:
            raise ValueError("gallery_key must be a country slug")
        photo_ids = _normalized_photo_ids(payload.get("photo_ids") or photo_id)
        if not photo_ids:
            raise ValueError("photo_ids must include at least one photo id")

    ensure_state_folders(repo_root / "assets/expo")
    ensure_state_folders(repo_root / "assets/reserve")
    ensure_state_folders(repo_root / HIDDEN_ASSET_ROOT)

    expo_groups, reserve_groups, hidden_groups = _state_groups(repo_root)
    _repair_hidden_references(repo_root, hidden_groups, expo_groups, reserve_groups)
    moved = None

    if action == "sync-country-keywords":
        keyword_updates = _sync_collection_keywords(repo_root, expo_groups, reserve_groups, hidden_groups)
        return {
            "ok": True,
            "action": action,
            "keyword_updates": keyword_updates,
            "site": _write_state(repo_root, expo_groups, reserve_groups, hidden_groups),
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
        site_state = _write_state(repo_root, expo_groups, reserve_groups, hidden_groups)
        r2_task = _start_r2_delete_task("hidden-public-previews", _hidden_public_delete_items(repo_root, hidden_groups))
        return {
            "ok": True,
            "action": action,
            "hidden_count": sum(len(photos) for photos in hidden_groups.values()),
            "r2_delete_task": r2_task,
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
        file_updates = {"updated": 0, "skipped": 0, "errors": []}
        r2_items: list[UploadItem] = []
        seen_r2_items: set[str] = set()
        for _state, _slug, photo in matches:
            title_changed = _set_photo_title(photo, title)
            keywords_changed = _set_photo_keywords(photo, keywords)
            if title_changed or keywords_changed:
                metadata_changed += 1
            result = _sync_photo_metadata_files(repo_root, photo, title, keywords)
            file_updates["updated"] += result.get("updated", 0)
            file_updates["skipped"] += result.get("skipped", 0)
            file_updates["errors"].extend(result.get("errors", []))
            updated_paths = [Path(item) for item in result.get("updated_paths", [])]
            for item in _metadata_upload_items_for_paths(repo_root, photo, updated_paths):
                identifier = r2_upload_id(item)
                if identifier in seen_r2_items:
                    continue
                seen_r2_items.add(identifier)
                r2_items.append(item)
        r2_task = _start_r2_upload_task(photo_id, r2_items)
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
                **file_updates,
                "error_count": len(file_updates["errors"]),
                "errors": file_updates["errors"][:20],
            },
            "r2_upload_task": r2_task,
            "site": _write_state(repo_root, expo_groups, reserve_groups, hidden_groups),
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
        site_state = _write_state(repo_root, expo_groups, reserve_groups, hidden_groups)
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
        hidden_photo = _hidden_review_photo(source_photo, source_slug, source_state)
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

    site_state = _write_state(repo_root, expo_groups, reserve_groups, hidden_groups)
    r2_task = _start_r2_upload_task("hidden-blacklist", [_hidden_blacklist_upload_item(repo_root)], "hidden-blacklist-upload")
    return {
        "ok": True,
        "action": action,
        "photo_id": photo_id,
        "moved": moved,
        "r2_blacklist_task": r2_task,
        "site": site_state,
    }


if __name__ == "__main__":
    raise SystemExit(main())
