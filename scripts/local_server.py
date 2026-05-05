#!/usr/bin/env python3
"""Local Photos By Elie preview server with owner-only helper endpoints."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


SAVE_CURATION_PATH = "/__photosbyelie/save-curation-pass"
PHOTO_ACTION_PATH = "/__photosbyelie/photo-action"
MAX_BODY_BYTES = 5 * 1024 * 1024
FILENAME_PATTERN = re.compile(r"^photosbyelie-[A-Za-z0-9_.:-]+\.pbe-curation$")
LOCAL_CLIENTS = {"127.0.0.1", "::1", "localhost"}
DERIVATIVES = (("gallery", "gallerySrc"), ("detail", "imageSrc"))
COUNTRY_ASSIGNMENT_TARGETS = {"france", "usa", "spain", "mexico", "portugal", "slovakia"}

SCRIPT_ROOT = Path(__file__).resolve().parent
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from apply_curation_pass import (  # noqa: E402
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


class PhotosByElieLocalHandler(SimpleHTTPRequestHandler):
    server_version = "PhotosByElieLocal/1.0"

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == PHOTO_ACTION_PATH:
            self._handle_photo_action()
            return
        if path != SAVE_CURATION_PATH:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return

        try:
            payload = self._read_json_body()
            filename = self._validated_filename(payload.get("filename"))
            text = self._validated_curation_text(payload.get("text"))
            destination = Path.home() / "Downloads" / filename
            destination.write_text(text, encoding="utf-8")
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        except OSError as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return

        self._send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "filename": filename,
                "path": str(destination),
                "bytes": len(text.encode("utf-8")),
            },
        )

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _handle_photo_action(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
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

    def _is_loopback_request(self) -> bool:
        host = self.headers.get("Host", "").split(":", 1)[0].strip("[]")
        client = self.client_address[0]
        if client.startswith("127.") or client == "::1":
            return host in LOCAL_CLIENTS or host.startswith("127.")
        return False

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

    @staticmethod
    def _validated_filename(value: object) -> str:
        if not isinstance(value, str):
            raise ValueError("filename must be a string")
        filename = Path(value).name
        if filename != value or not FILENAME_PATTERN.match(filename):
            raise ValueError("filename must be a Photos By Elie .pbe-curation file")
        return filename

    @staticmethod
    def _validated_curation_text(value: object) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("text must be a non-empty string")
        try:
            payload = json.loads(value)
        except json.JSONDecodeError as error:
            raise ValueError("curation text is not valid JSON") from error
        if not isinstance(payload, dict):
            raise ValueError("curation text must be a JSON object")
        if payload.get("format") != "photosbyelie-curation-pass":
            raise ValueError("curation text has the wrong format")
        return value

    def _send_json(self, status: HTTPStatus, payload: dict) -> None:
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve Photos By Elie locally with owner helper endpoints.")
    parser.add_argument("port", nargs="?", type=int, default=8000)
    parser.add_argument("--bind", default="127.0.0.1", help="Address to bind. Defaults to 127.0.0.1.")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.bind, args.port), PhotosByElieLocalHandler)
    url_host = "localhost" if args.bind in {"127.0.0.1", "::1"} else args.bind
    print(f"Serving Photos By Elie at http://{url_host}:{args.port}/")
    print(f"Owner helper endpoint: {SAVE_CURATION_PATH}")
    print(f"Live photo action endpoint: {PHOTO_ACTION_PATH}")
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


def _hidden_provenance(photo: dict, fallback_state: str, fallback_slug: str) -> tuple[str, str]:
    state = photo.get("hiddenFromState") or (photo.get("ownerState") or {}).get("hiddenFromState") or fallback_state
    slug = photo.get("hiddenFromSlug") or (photo.get("ownerState") or {}).get("hiddenFromSlug") or fallback_slug
    if state not in {"expo", "reserve"}:
        state = fallback_state
    if slug not in ORDER:
        slug = fallback_slug if fallback_slug in ORDER else "unknown"
    return state, slug


def _current_expo_cap(repo_root: Path, expo_groups: dict[str, list[dict]]) -> int:
    manifest_path = repo_root / EXPO_MANIFEST_PATH
    if manifest_path.exists():
        try:
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
            value = payload.get("expo_cap")
            if isinstance(value, int) and value > 0:
                return value
        except json.JSONDecodeError:
            pass
    return max(1, *(len(expo_groups.get(slug, [])) for slug in ORDER if slug != "unknown"))


def _write_state(repo_root: Path, expo_groups: dict[str, list[dict]], reserve_groups: dict[str, list[dict]], hidden_groups: dict[str, list[dict]]) -> dict:
    hidden_ids = {photo.get("id") for photos in hidden_groups.values() for photo in photos if photo.get("id")}
    write_photos_data_from_site(repo_root, expo_groups, reserve_groups)
    write_reserve_data_from_site(repo_root, reserve_groups)
    write_hidden_data_from_site(repo_root, hidden_groups)
    write_regular_manifest_from_site(
        repo_root,
        expo_groups,
        reserve_groups,
        _current_expo_cap(repo_root, expo_groups),
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


def _photo_file_paths(repo_root: Path, photo: dict, include_source: bool = True) -> list[Path]:
    paths = []
    for key in ("gallerySrc", "imageSrc"):
        rel = clean_site_src(photo.get(key))
        if not rel:
            continue
        path = repo_root / rel
        if path.exists():
            paths.append(path.resolve())
    if include_source:
        paths.extend(path for path in _source_paths(repo_root, photo) if path not in paths)
    return paths


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
    for path in _photo_file_paths(repo_root, photo):
        rel = path.relative_to(repo_root).as_posix() if path.is_relative_to(repo_root) else str(path)
        try:
            existing = _asset_keywords(path)
            if keyword.casefold() in {item.casefold() for item in existing}:
                skipped += 1
                continue
            _write_file_metadata(path, append_keyword=keyword)
            updated += 1
        except (OSError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
            errors.append(f"{rel}: {error}")
    return {"updated": updated, "skipped": skipped, "errors": errors}


def _sync_photo_metadata_files(repo_root: Path, photo: dict, title: str, keywords: list[str]) -> dict:
    updated = 0
    skipped = 0
    errors = []
    for path in _photo_file_paths(repo_root, photo):
        rel = path.relative_to(repo_root).as_posix() if path.is_relative_to(repo_root) else str(path)
        try:
            _write_file_metadata(path, title=title, keywords=keywords)
            updated += 1
        except (OSError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
            errors.append(f"{rel}: {error}")
    return {"updated": updated, "skipped": skipped, "errors": errors}


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
    return {
        "photos_seen": photos_seen,
        "metadata_changed": metadata_changed,
        "asset_updated": asset_updated,
        "asset_skipped": asset_skipped,
        "errors": errors[:20],
        "error_count": len(errors),
    }


def apply_photo_action(repo_root: Path, payload: dict) -> dict:
    action = payload.get("action")
    photo_id = payload.get("photo_id")
    if action not in {"hide", "undo-hide", "return-to-reserve", "assign-country", "sync-country-keywords", "update-photo-metadata"}:
        raise ValueError("unsupported photo action")
    if action not in {"assign-country", "sync-country-keywords"} and (not isinstance(photo_id, str) or not photo_id):
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
    moved = None

    if action == "sync-country-keywords":
        keyword_updates = _sync_collection_keywords(repo_root, expo_groups, reserve_groups, hidden_groups)
        return {
            "ok": True,
            "action": action,
            "keyword_updates": keyword_updates,
            "site": _write_state(repo_root, expo_groups, reserve_groups, hidden_groups),
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
        for _state, _slug, photo in matches:
            title_changed = _set_photo_title(photo, title)
            keywords_changed = _set_photo_keywords(photo, keywords)
            if title_changed or keywords_changed:
                metadata_changed += 1
            result = _sync_photo_metadata_files(repo_root, photo, title, keywords)
            file_updates["updated"] += result.get("updated", 0)
            file_updates["skipped"] += result.get("skipped", 0)
            file_updates["errors"].extend(result.get("errors", []))
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
            "site": _write_state(repo_root, expo_groups, reserve_groups, hidden_groups),
        }

    if action == "assign-country":
        moved = []
        skipped = []
        keyword_updates = []
        for current_photo_id in photo_ids:
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
                    continue
                raise ValueError(f"unknown photo not found in Expo or Reserve: {current_photo_id}")
            source_slug, source_photo = found
            reserve_photo = _move_photo(repo_root, source_photo, "reserve", target_slug)
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
            })
        return {
            "ok": True,
            "action": action,
            "photo_ids": photo_ids,
            "moved": moved,
            "skipped": skipped,
            "keyword_updates": keyword_updates,
            "site": _write_state(repo_root, expo_groups, reserve_groups, hidden_groups),
        }

    if action == "hide":
        found = _find_and_remove(expo_groups, photo_id)
        source_state = "expo"
        if not found:
            found = _find_and_remove(reserve_groups, photo_id)
            source_state = "reserve"
        if not found:
            hidden_hit = next(
                ((slug, photo) for slug, photos in hidden_groups.items() for photo in photos if photo.get("id") == photo_id),
                None,
            )
            if hidden_hit:
                return {"ok": True, "action": action, "photo_id": photo_id, "message": "already hidden", "site": _write_state(repo_root, expo_groups, reserve_groups, hidden_groups)}
            raise ValueError(f"photo not found in Expo or Reserve: {photo_id}")
        source_slug, source_photo = found
        hidden_photo = _move_photo(repo_root, source_photo, "hidden", source_slug)
        hidden_photo["hiddenFromState"] = source_state
        hidden_photo["hiddenFromSlug"] = source_slug
        _remove_existing(hidden_groups, photo_id)
        hidden_groups[source_slug].append(hidden_photo)
        moved = {"from": source_state, "from_slug": source_slug, "to": "hidden", "to_slug": source_slug}

    elif action == "undo-hide":
        found = _find_and_remove(hidden_groups, photo_id)
        if not found:
            raise ValueError(f"photo not found in Hidden: {photo_id}")
        hidden_slug, hidden_photo = found
        target_state, target_slug = _hidden_provenance(hidden_photo, "expo", hidden_slug)
        target_groups = expo_groups if target_state == "expo" else reserve_groups
        restored = _move_photo(repo_root, hidden_photo, target_state, target_slug)
        restored.pop("hiddenFromState", None)
        restored.pop("hiddenFromSlug", None)
        _remove_existing(target_groups, photo_id)
        target_groups[target_slug].append(restored)
        moved = {"from": "hidden", "from_slug": hidden_slug, "to": target_state, "to_slug": target_slug}

    else:
        found = _find_and_remove(hidden_groups, photo_id)
        if not found:
            raise ValueError(f"photo not found in Hidden: {photo_id}")
        hidden_slug, hidden_photo = found
        _source_state, target_slug = _hidden_provenance(hidden_photo, "reserve", hidden_slug)
        reserve_photo = _move_photo(repo_root, hidden_photo, "reserve", target_slug)
        reserve_photo.pop("hiddenFromState", None)
        reserve_photo.pop("hiddenFromSlug", None)
        _remove_existing(reserve_groups, photo_id)
        reserve_groups[target_slug].append(reserve_photo)
        moved = {"from": "hidden", "from_slug": hidden_slug, "to": "reserve", "to_slug": target_slug}

    return {
        "ok": True,
        "action": action,
        "photo_id": photo_id,
        "moved": moved,
        "site": _write_state(repo_root, expo_groups, reserve_groups, hidden_groups),
    }


if __name__ == "__main__":
    raise SystemExit(main())
