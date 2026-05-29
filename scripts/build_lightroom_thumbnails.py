#!/usr/bin/env python3
"""
Build watermarked web previews from Lightroom-selected developed exports.

The script is intentionally interrupt/resume friendly:
- source files are tracked by their path relative to --source-root
- metadata checkpoints are appended to JSONL as each batch finishes
- derivative files are written atomically and skipped when present
- reruns can use a different --source-root, such as a local external drive

Developed JPG/TIFF photo sources and MOV/MP4/M4V video sources can be imported
into a disposable local import cache. RAW/DNG/NEF files are owner-local source
material only; their embedded previews are not imported, published, or uploaded.
Expo is filled later by the review/export scripts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from media_keys import DEFAULT_PUBLIC_PREFIX, private_master_key, private_render_key, public_preview_key, public_preview_key_for_reference
from media_policy import DEVELOPED_IMAGE_EXTENSIONS, DEVELOPED_VIDEO_EXTENSIONS, RAW_IMAGE_EXTENSIONS
from import_eligibility import green_selected, lightroom_selected, normalize_rating
from owner_state_db import connect as owner_db_connect, keyword_blacklist_terms as owner_keyword_blacklist_terms, upsert_r2_object_state
from sync_r2_media import DEFAULT_THROTTLE_FILE, UploadItem, append_upload_state, first_env, s3_put, wrangler_command
from update_caption_colors import caption_color


IMAGE_EXTENSIONS = DEVELOPED_IMAGE_EXTENSIONS
VIDEO_EXTENSIONS = DEVELOPED_VIDEO_EXTENSIONS

DEFAULT_SOURCE_ROOT_CANDIDATES = [
    Path("/Volumes/Saturn/Pictures/LR/Camera"),
    Path("/Volumes/Saturn-1/Pictures/LR/Camera"),
    Path.home() / "Pictures/LR/Camera",
    Path.home() / "Pictures/LR/2024",
]
DEFAULT_SOURCE_ROOT = DEFAULT_SOURCE_ROOT_CANDIDATES[0]
DEFAULT_OUTPUT_ROOT = Path("tmp/import-cache")
DEFAULT_WATERMARK = "PhotosByElie Preview - Not Licensed"
DEFAULT_GALLERY_MAX = 900
DEFAULT_DETAIL_MAX = 1800
DEFAULT_VIDEO_PREVIEW_SECONDS = 5
DEFAULT_VIDEO_POSTER_FRACTION = 0.10
DEFAULT_VIDEO_PREVIEW_MAX = 720
DEFAULT_BATCH_SIZE = 50
SCHEMA_VERSION = 5
DEFAULT_PUBLIC_BUCKET = "photosbyelie-public"
DEFAULT_PRIVATE_BUCKET = "photosbyelie-private"
DEFAULT_PRIVATE_PREFIX = "masters"
DEFAULT_R2_UPLOAD_STATE = Path(".review-logs/r2-upload-state.jsonl")
DEFAULT_PRIVATE_DELIVERY_STATE = Path(".review-logs/private-deliverable-sync-state.jsonl")
DEFAULT_PRIVATE_DELIVERY_MANIFEST = Path("assets/private-delivery-manifest.json")
DEFAULT_PUBLIC_PREVIEW_IDS = Path(".review-logs/r2-public-preview-ids.json")
DEFAULT_PRIVATE_INVENTORY = Path(".review-logs/r2-private-inventory.json")
DEFAULT_KEYWORD_BLACKLIST = Path("assets/owner-actions/keyword-blacklist.json")
LOCAL_TOOL_DIRS = (
    Path("/opt/homebrew/bin"),
    Path("/usr/local/bin"),
    Path("/opt/homebrew/sbin"),
    Path("/usr/local/sbin"),
)
PRIVATE_RENDER_PRODUCTS = {
    "jpg-6mp": 6,
    "jpg-3mp": 3,
    "jpg-1mp": 1,
}
R2_COVERED_KEYS_CACHE: set[str] | None = None
R2_UPLOAD_STATE_LOCK = threading.Lock()
IMPORT_STATE_LOCK = threading.Lock()
COUNTRY_ALIASES = {
    "fr": ("france", "France"),
    "france": ("france", "France"),
    "usa": ("usa", "United States"),
    "us": ("usa", "United States"),
    "u.s.": ("usa", "United States"),
    "u.s.a.": ("usa", "United States"),
    "united states": ("usa", "United States"),
    "united states of america": ("usa", "United States"),
    "america": ("usa", "United States"),
    "spain": ("spain", "Spain"),
    "es": ("spain", "Spain"),
    "espana": ("spain", "Spain"),
    "españa": ("spain", "Spain"),
    "mexico": ("mexico", "Mexico"),
    "mx": ("mexico", "Mexico"),
    "méxico": ("mexico", "Mexico"),
    "portugal": ("portugal", "Portugal"),
    "pt": ("portugal", "Portugal"),
    "italy": ("italy", "Italy"),
    "italia": ("italy", "Italy"),
    "canada": ("canada", "Canada"),
    "united kingdom": ("uk", "United Kingdom"),
    "uk": ("uk", "United Kingdom"),
    "england": ("uk", "United Kingdom"),
    "slovakia": ("slovakia", "Slovakia"),
    "slovak republic": ("slovakia", "Slovakia"),
    "sk": ("slovakia", "Slovakia"),
    "ai": ("ai", "AI"),
    "leonardo": ("ai", "AI"),
    "leonardo ai": ("ai", "AI"),
}
COUNTRY_HINTS = {
    "california": ("usa", "United States"),
    "carlsbad": ("usa", "United States"),
    "lake arrowhead": ("usa", "United States"),
    "lake forest": ("usa", "United States"),
    "san bernardino": ("usa", "United States"),
    "san diego": ("usa", "United States"),
    "encinitas": ("usa", "United States"),
    "new york": ("usa", "United States"),
    "florida": ("usa", "United States"),
    "paris": ("france", "France"),
    "versailles": ("france", "France"),
    "madrid": ("spain", "Spain"),
    "barcelona": ("spain", "Spain"),
    "bilbao": ("spain", "Spain"),
    "cadiz": ("spain", "Spain"),
    "cordoba": ("spain", "Spain"),
    "córdoba": ("spain", "Spain"),
    "basque country": ("spain", "Spain"),
    "euzkadi": ("spain", "Spain"),
    "pays basque": ("spain", "Spain"),
    "malaga": ("spain", "Spain"),
    "málaga": ("spain", "Spain"),
    "nerja": ("spain", "Spain"),
    "puerto vallarta": ("mexico", "Mexico"),
    "ronda": ("spain", "Spain"),
    "seville": ("spain", "Spain"),
    "sevilla": ("spain", "Spain"),
    "bratislava": ("slovakia", "Slovakia"),
    "valencia": ("spain", "Spain"),
    "florence": ("italy", "Italy"),
    "firenze": ("italy", "Italy"),
    "pisa": ("italy", "Italy"),
    "san gimignano": ("italy", "Italy"),
    "tuscany": ("italy", "Italy"),
}
GPS_COUNTRY_BOUNDS = {
    "usa": ((24.0, 49.5), (-125.0, -66.0), "United States"),
    "mexico": ((14.0, 33.5), (-118.5, -86.0), "Mexico"),
    "spain": ((27.0, 44.5), (-18.5, 4.9), "Spain"),
    "portugal": ((30.0, 42.5), (-10.5, -6.0), "Portugal"),
    "france": ((41.0, 51.8), (-5.7, 9.8), "France"),
    "italy": ((35.4, 47.2), (6.6, 18.8), "Italy"),
    "slovakia": ((47.5, 49.7), (16.8, 22.7), "Slovakia"),
}
PRIVATE_KEYWORD_PATTERN = re.compile(
    r"(^_|family|friends\+family|notmyphoto|onhotel|published adobe)",
    re.IGNORECASE,
)
DISPLAY_SOURCE_TAGS = [
    "FileType",
    "MIMEType",
    "ImageWidth",
    "ImageHeight",
    "Megapixels",
    "Make",
    "Model",
    "Lens",
    "LensModel",
    "ExposureTime",
    "FNumber",
    "ISO",
    "FocalLength",
    "FocalLengthIn35mmFormat",
    "DateTimeOriginal",
    "CreateDate",
    "Software",
    "ColorSpace",
    "ProfileDescription",
    "Orientation",
    "Rotation",
    "Duration",
    "MediaDuration",
]
DISPLAY_LIGHTROOM_TAGS = [
    "Rating",
    "Label",
    "ColorLabel",
    "Title",
    "Description",
    "Caption-Abstract",
    "Subject",
    "Keywords",
    "City",
    "State",
    "Province-State",
    "Country",
    "Country-PrimaryLocationName",
    "Location",
]
FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
]
FFMPEG_FILTERS: set[str] | None = None


def default_import_workers() -> int:
    configured = os.environ.get("PBE_IMPORT_WORKERS")
    if configured:
        try:
            return max(1, int(configured))
        except ValueError:
            pass
    return max(1, (os.cpu_count() or 2) // 2)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create watermarked import previews from developed photo/video exports."
    )
    parser.add_argument(
        "--source-root",
        type=Path,
        default=None,
        help="Lightroom Camera source root. Defaults to the first available Saturn/local Camera folder.",
    )
    parser.add_argument(
        "--developed-root",
        type=Path,
        default=None,
        help="Deprecated no-op. The importer now scans developed photo/video source files directly.",
    )
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--label", default="green", help="Lightroom color label to include.")
    parser.add_argument("--min-rating", type=float, default=4)
    parser.add_argument(
        "--select",
        choices=("lightroom", "green", "all"),
        default="lightroom",
        help="Require Green + rating metadata, require Green label only, or select every developed photo/video file.",
    )
    parser.add_argument(
        "--force-country",
        default="",
        help="Force all derivatives into a gallery country bucket, e.g. ai for Leonardo images.",
    )
    parser.add_argument("--gallery-max", type=int, default=DEFAULT_GALLERY_MAX)
    parser.add_argument("--detail-max", type=int, default=DEFAULT_DETAIL_MAX)
    parser.add_argument("--watermark", default=DEFAULT_WATERMARK)
    parser.add_argument("--developed-detail-suffix", default="_1800.jpg")
    parser.add_argument("--developed-gallery-suffix", default="_900.jpg")
    parser.add_argument(
        "--years",
        default="",
        help="Only scan one year (YYYY) or an inclusive year range (YYYY-YYYY), based on relative path.",
    )
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--limit", type=int, default=0, help="Stop after N selected media rows; useful for tests.")
    parser.add_argument(
        "--workers",
        type=int,
        default=default_import_workers(),
        help="Parallel render/upload workers. Defaults to half the logical CPU count.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Scan and checkpoint, but do not render files.")
    parser.add_argument("--force", action="store_true", help="Ignore checkpoints and rebuild existing derivatives.")
    parser.add_argument("--clean-missing", action="store_true", help="Drop manifest rows whose derivatives are missing.")
    parser.add_argument(
        "--r2-upload",
        choices=("none", "public", "private", "both"),
        default="none",
        help="Upload rendered public previews and/or developed source masters directly to Cloudflare R2.",
    )
    parser.add_argument("--r2-public-bucket", default=DEFAULT_PUBLIC_BUCKET)
    parser.add_argument("--r2-private-bucket", default=DEFAULT_PRIVATE_BUCKET)
    parser.add_argument("--r2-public-prefix", default=DEFAULT_PUBLIC_PREFIX)
    parser.add_argument("--r2-private-prefix", default=DEFAULT_PRIVATE_PREFIX)
    parser.add_argument("--r2-retries", type=int, default=2)
    parser.add_argument("--r2-force-upload", action="store_true", help="Ignore local R2 coverage records and upload every planned object.")
    default_r2_backend = os.environ.get("PBE_R2_BACKEND") or (
        "s3"
        if first_env("R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID")
        and first_env("R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID")
        and first_env("R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY")
        else "wrangler"
    )
    parser.add_argument("--r2-backend", choices=("wrangler", "s3"), default=default_r2_backend)
    parser.add_argument("--r2-s3-account-id", default=first_env("R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID"))
    parser.add_argument("--r2-s3-access-key-id", default=first_env("R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"))
    parser.add_argument("--r2-s3-secret-access-key", default=first_env("R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"))
    parser.add_argument("--r2-s3-endpoint", default=os.environ.get("R2_S3_ENDPOINT", ""))
    parser.add_argument("--r2-request-min-interval", type=float, default=float(os.environ.get("PBE_R2_REQUEST_MIN_INTERVAL", "0.75")))
    parser.add_argument("--r2-retry-max-delay", type=float, default=float(os.environ.get("PBE_R2_RETRY_MAX_DELAY", "900")))
    parser.add_argument(
        "--r2-private-renders",
        action="store_true",
        help="When private R2 upload is enabled, also render/upload unwatermarked photo JPG 6/3/1 MP buyer deliverables under private renders/ keys.",
    )
    parser.add_argument(
        "--keep-uploaded-tmp",
        action="store_true",
        help="Keep tmp/import-cache preview media after confirmed public R2 upload. By default, uploaded preview media files are removed from the disposable tmp workspace.",
    )
    parser.add_argument(
        "--include-private-keywords",
        action="store_true",
        help="Compatibility flag; private keywords are included by default.",
    )
    parser.add_argument(
        "--include-gps",
        action="store_true",
        help="Compatibility flag; GPS is extracted by default into gps-metadata.json.",
    )
    parser.add_argument(
        "--redact-private-keywords",
        action="store_true",
        help="Exclude family/private-looking Lightroom keywords from the manifest.",
    )
    parser.add_argument(
        "--redact-gps",
        action="store_true",
        help="Do not write exact GPS tags to the separate gps-metadata.json file.",
    )
    parser.add_argument(
        "--hidden-blacklist",
        type=Path,
        default=Path("assets/hidden/hidden-blacklist.json"),
        help="Owner blocked tombstones. Matching photo ids are skipped before render/upload.",
    )
    parser.add_argument(
        "--discarded-tombstone",
        type=Path,
        default=Path("assets/discarded/discarded-photo-ids.json"),
        help="Owner discard tombstones. Matching photo ids are skipped before render/upload.",
    )
    parser.add_argument(
        "--keyword-blacklist",
        type=Path,
        default=DEFAULT_KEYWORD_BLACKLIST,
        help="Owner metadata keywords to omit from generated manifests and keyword indexes.",
    )
    return parser.parse_args()


def resolve_source_root(source_root: Path | None) -> Path:
    if source_root:
        return source_root.expanduser().resolve()
    for candidate in DEFAULT_SOURCE_ROOT_CANDIDATES:
        expanded = candidate.expanduser()
        if expanded.exists():
            return expanded.resolve()
    candidates = ", ".join(str(path) for path in DEFAULT_SOURCE_ROOT_CANDIDATES)
    raise SystemExit(f"Source root does not exist. Tried: {candidates}")


def parse_year_filter(value: str) -> tuple[int, int] | None:
    value = value.strip()
    if not value:
        return None
    single = re.fullmatch(r"(\d{4})", value)
    if single:
        year = int(single.group(1))
        return year, year
    ranged = re.fullmatch(r"(\d{4})-(\d{4})", value)
    if ranged:
        start, end = int(ranged.group(1)), int(ranged.group(2))
        return min(start, end), max(start, end)
    raise SystemExit(f"Invalid --years value: {value}. Use YYYY or YYYY-YYYY.")


def require_tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        for tool_dir in LOCAL_TOOL_DIRS:
            candidate = tool_dir / name
            if candidate.exists() and os.access(candidate, os.X_OK):
                os.environ["PATH"] = f"{tool_dir}{os.pathsep}{os.environ.get('PATH', '')}"
                return str(candidate)
        raise SystemExit(f"Missing required tool: {name}")
    return path


def require_python_package(module_name: str, package_name: str) -> None:
    try:
        __import__(module_name)
    except ImportError as exc:
        raise SystemExit(
            f"Missing required Python package: {package_name} for {sys.executable}. "
            f"Install it for this interpreter or set PBE_SWEEP_PYTHON to a Python that has it."
        ) from exc


def choose_font() -> str:
    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            return candidate
    raise SystemExit("No usable system font found for ffmpeg drawtext watermark.")


def is_image(path: Path) -> bool:
    return path.suffix.lower() in IMAGE_EXTENSIONS


def is_video(path: Path) -> bool:
    return path.suffix.lower() in VIDEO_EXTENSIONS


def is_importable_media(path: Path) -> bool:
    return is_image(path) or is_video(path)


def is_raw_image(path: Path) -> bool:
    return path.suffix.lower() in RAW_IMAGE_EXTENSIONS


def sidecar_for(image: Path) -> Path | None:
    candidates = [
        Path(str(image) + ".xmp"),
        image.with_suffix(".xmp"),
        image.with_suffix(image.suffix + ".xmp"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def rel_key(path: Path, source_root: Path) -> str:
    return path.relative_to(source_root).as_posix()


def year_from_relative_path(relative_path: str) -> int | None:
    for part in Path(relative_path).parts:
        match = re.match(r"^(\d{4})", part)
        if match:
            return int(match.group(1))
    return None


def matches_year_filter(relative_path: str, year_filter: tuple[int, int] | None) -> bool:
    if not year_filter:
        return True
    wanted_start, wanted_end = year_filter
    exact_years = []
    range_matches = []
    for part in Path(relative_path).parts:
        ranged = re.match(r"^(\d{4})-(\d{4})$", part)
        if ranged:
            part_start, part_end = int(ranged.group(1)), int(ranged.group(2))
            part_start, part_end = min(part_start, part_end), max(part_start, part_end)
            range_matches.append(part_start <= wanted_end and wanted_start <= part_end)
            continue
        single = re.match(r"^(\d{4})", part)
        if single:
            exact_years.append(int(single.group(1)))
    if exact_years:
        return any(wanted_start <= year <= wanted_end for year in exact_years)
    return any(range_matches)


def path_could_contain_year(relative_path: str, year_filter: tuple[int, int] | None) -> bool:
    if not year_filter or not relative_path:
        return True
    wanted_start, wanted_end = year_filter
    for part in Path(relative_path).parts:
        ranged = re.match(r"^(\d{4})-(\d{4})$", part)
        if ranged:
            part_start, part_end = int(ranged.group(1)), int(ranged.group(2))
            part_start, part_end = min(part_start, part_end), max(part_start, part_end)
            return part_start <= wanted_end and wanted_start <= part_end
        single = re.match(r"^(\d{4})", part)
        if single:
            year = int(single.group(1))
            return wanted_start <= year <= wanted_end
    return True


def file_stamp(path: Path | None) -> dict[str, Any] | None:
    if not path or not path.exists():
        return None
    stat = path.stat()
    return {"mtime_ns": stat.st_mtime_ns, "size": stat.st_size}


def checkpoint_key(image: Path, sidecar: Path | None) -> str:
    payload = {
        "schema_version": SCHEMA_VERSION,
        "source": file_stamp(image),
        "metadata": file_stamp(sidecar or image),
    }
    return hashlib.sha1(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def load_latest_state(path: Path) -> dict[str, dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    if not path.exists():
        return latest
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            key = row.get("relative_path")
            if key:
                latest[key] = row
    return latest


def append_state(path: Path, row: dict[str, Any]) -> None:
    with IMPORT_STATE_LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        row = {"updated_at": now_iso(), **row}
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
            handle.flush()
            os.fsync(handle.fileno())


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def emit_import_event(kind: str, **payload: Any) -> None:
    print(f"PBE_IMPORT_{kind} {json.dumps(payload, sort_keys=True)}", flush=True)


def emit_import_step(row: dict[str, Any], step: str, status: str = "done", **payload: Any) -> None:
    emit_import_event(
        "STEP",
        photoId=str(row.get("id") or ""),
        relativePath=str(row.get("relative_path") or ""),
        sourcePath=str(row.get("source_path_hint") or ""),
        mediaType=str(row.get("media_type") or ""),
        step=step,
        status=status,
        **payload,
    )


def record_r2_object_current(item: UploadItem, source: str) -> None:
    with R2_UPLOAD_STATE_LOCK:
        repo_root = Path.cwd()
        conn = owner_db_connect(repo_root)
        try:
            upsert_r2_object_state(
                conn,
                bucket=item.bucket,
                object_key=item.key,
                lifecycle_state="current",
                source=source,
                bytes_value=item.path.stat().st_size if item.path.exists() else None,
            )
            conn.commit()
        finally:
            conn.close()


def record_r2_upload_success(item: UploadItem, source: str) -> None:
    append_upload_state(DEFAULT_R2_UPLOAD_STATE, item, R2_UPLOAD_STATE_LOCK)
    record_r2_object_current(item, source)


def slug_for(relative_path: str) -> str:
    path = Path(relative_path)
    base = re.sub(r"[^a-zA-Z0-9]+", "-", path.stem).strip("-").lower() or "photo"
    digest = hashlib.sha1(relative_path.encode("utf-8")).hexdigest()[:10]
    return f"{base}-{digest}"


def run_exiftool(targets: list[Path]) -> list[dict[str, Any]]:
    if not targets:
        return []
    cmd = [
        "exiftool",
        "-json",
        "-Rating",
        "-Label",
        "-ColorLabel",
        "-Title",
        "-Description",
        "-Subject",
        "-DateTimeOriginal",
        "-CreateDate",
        "-ImageWidth",
        "-ImageHeight",
        "-Megapixels",
        *[str(path) for path in targets],
    ]
    result = subprocess.run(cmd, text=True, capture_output=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "exiftool failed")
    return json.loads(result.stdout or "[]")


def run_exiftool_tags(target: Path, tags: list[str]) -> dict[str, Any]:
    cmd = ["exiftool", "-json", *[f"-{tag}" for tag in tags], str(target)]
    result = subprocess.run(cmd, text=True, capture_output=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"exiftool failed for {target}")
    rows = json.loads(result.stdout or "[]")
    return rows[0] if rows else {}


def selected_by_args(meta: dict[str, Any], args: argparse.Namespace) -> bool:
    if args.select == "all":
        return True
    if args.select == "green":
        return green_selected(meta, args.label, args.min_rating)
    return lightroom_selected(meta, args.label, args.min_rating)


def compact_metadata(meta: dict[str, Any]) -> dict[str, Any]:
    keys = [
        "Rating",
        "Label",
        "ColorLabel",
        "Title",
        "Description",
        "Subject",
        "DateTimeOriginal",
        "CreateDate",
        "ImageWidth",
        "ImageHeight",
        "Megapixels",
    ]
    return {key: meta[key] for key in keys if key in meta}


def source_file_facts(path: Path) -> dict[str, Any]:
    stat = path.stat()
    return {
        "name": path.name,
        "extension": path.suffix.lower().lstrip("."),
        "bytes": stat.st_size,
        "mtime": datetime.fromtimestamp(stat.st_mtime, timezone.utc).replace(microsecond=0).isoformat(),
    }


def list_value(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [part.strip() for part in str(value).split(",") if part.strip()]


def load_keyword_blacklist(path: Path | None) -> set[str]:
    del path
    repo_root = Path(__file__).resolve().parents[1]
    return {keyword.casefold() for keyword in owner_keyword_blacklist_terms(repo_root)}


def cleaned_keywords(meta: dict[str, Any], include_private: bool, keyword_blacklist: set[str] | None = None) -> list[str]:
    keyword_blacklist = keyword_blacklist or set()
    values: list[str] = []
    for key in ("Subject", "Keywords"):
        values.extend(list_value(meta.get(key)))
    deduped: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = value.casefold()
        if normalized in seen:
            continue
        seen.add(normalized)
        if normalized in keyword_blacklist:
            continue
        if not include_private and PRIVATE_KEYWORD_PATTERN.search(value):
            continue
        deduped.append(value)
    return deduped


def filter_keywords(values: Any, keyword_blacklist: set[str]) -> list[str]:
    if not keyword_blacklist:
        return list_value(values)
    filtered: list[str] = []
    seen: set[str] = set()
    for value in list_value(values):
        normalized = value.casefold()
        if normalized in seen or normalized in keyword_blacklist:
            continue
        seen.add(normalized)
        filtered.append(value)
    return filtered


def sanitize_manifest_keywords(manifest: dict[str, dict[str, Any]], keyword_blacklist: set[str]) -> None:
    if not keyword_blacklist:
        return
    for photo in manifest.values():
        if "keywords" in photo:
            photo["keywords"] = filter_keywords(photo.get("keywords"), keyword_blacklist)
        for item in photo.get("metadata", []) or []:
            if item.get("label") == "Keywords":
                item["value"] = ", ".join(filter_keywords(item.get("value"), keyword_blacklist))


def metadata_value(meta: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = meta.get(key)
        if value not in (None, ""):
            return value
    return None


def normalize_country(value: Any) -> tuple[str, str] | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    key = text.casefold()
    if key in COUNTRY_ALIASES:
        return COUNTRY_ALIASES[key]
    slug = re.sub(r"[^a-z0-9]+", "-", key).strip("-")
    return (slug or "unknown", text)


def infer_gallery_country(location: dict[str, Any], keywords: list[str], path_hints: list[str] | None = None) -> dict[str, str]:
    explicit = normalize_country(location.get("country"))
    if explicit:
        slug, label = explicit
        return {"slug": slug, "label": label, "source": "country"}
    for keyword in keywords:
        normalized = normalize_country(keyword)
        if normalized and normalized[0] in {value[0] for value in COUNTRY_ALIASES.values()}:
            slug, label = normalized
            return {"slug": slug, "label": label, "source": "keyword"}
    for value in [location.get("region"), location.get("city"), location.get("location"), *keywords]:
        if not value:
            continue
        text = str(value).casefold()
        for hint, country in COUNTRY_HINTS.items():
            if hint in text:
                slug, label = country
                return {"slug": slug, "label": label, "source": "location_hint"}
    for value in path_hints or []:
        if not value:
            continue
        text = str(value).casefold()
        for hint, country in COUNTRY_HINTS.items():
            if hint in text:
                slug, label = country
                return {"slug": slug, "label": label, "source": "path_hint"}
    return {"slug": "unknown", "label": "Unknown", "source": "unresolved"}


def dms_to_decimal(value: Any) -> float | None:
    text = str(value or "").strip()
    match = re.match(r'^(\d+) deg (\d+)\' ([\d.]+)" ([NSEW])$', text)
    if not match:
        return None
    degrees, minutes, seconds, hemisphere = match.groups()
    decimal = int(degrees) + int(minutes) / 60 + float(seconds) / 3600
    if hemisphere in {"S", "W"}:
        decimal *= -1
    return decimal


def infer_gallery_country_from_gps(gps: dict[str, Any]) -> dict[str, str] | None:
    latitude = dms_to_decimal(gps.get("GPSLatitude"))
    longitude = dms_to_decimal(gps.get("GPSLongitude"))
    if latitude is None or longitude is None:
        return None
    matches = []
    for slug, ((min_lat, max_lat), (min_lon, max_lon), label) in GPS_COUNTRY_BOUNDS.items():
        if min_lat <= latitude <= max_lat and min_lon <= longitude <= max_lon:
            matches.append((slug, label))
    if len(matches) != 1:
        return None
    slug, label = matches[0]
    return {"slug": slug, "label": label, "source": "gps_hint"}


def forced_gallery_country(value: str) -> dict[str, str] | None:
    if not value:
        return None
    normalized = normalize_country(value)
    if normalized:
        slug, label = normalized
    else:
        slug = re.sub(r"[^a-z0-9]+", "-", value.strip().casefold()).strip("-") or "forced"
        label = value.strip() or slug.title()
    return {"slug": slug, "label": label, "source": "forced"}


def parse_exif_datetime(value: Any) -> dict[str, Any]:
    if not value:
        return {}
    text = str(value)
    match = re.match(r"^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})", text)
    if not match:
        return {"raw": text}
    year, month, day, hour, minute, second = (int(part) for part in match.groups())
    return {
        "raw": text,
        "year": year,
        "month": month,
        "day": day,
        "date": f"{year:04d}-{month:02d}-{day:02d}",
        "time": f"{hour:02d}:{minute:02d}:{second:02d}",
        "sort": f"{year:04d}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}:{second:02d}",
    }


def number_value(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def duration_seconds(value: Any) -> float | None:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    numeric = re.match(r"^([\d.]+)\s*s(?:ec(?:onds?)?)?$", text, re.IGNORECASE)
    if numeric:
        return float(numeric.group(1))
    parts = text.split(":")
    if len(parts) in {2, 3}:
        try:
            values = [float(part) for part in parts]
        except ValueError:
            return None
        if len(values) == 2:
            minutes, seconds = values
            return minutes * 60 + seconds
        hours, minutes, seconds = values
        return hours * 3600 + minutes * 60 + seconds
    return None


def dimension_facts(meta: dict[str, Any]) -> dict[str, Any]:
    width = number_value(metadata_value(meta, "ImageWidth"))
    height = number_value(metadata_value(meta, "ImageHeight"))
    orientation = metadata_value(meta, "Orientation", "Rotation")
    if width and height and orientation_rotates_sideways(orientation):
        width, height = height, width
    facts: dict[str, Any] = {}
    if width and height:
        facts["width"] = int(width)
        facts["height"] = int(height)
        facts["aspect_ratio"] = round(width / height, 4)
        if width > height:
            facts["orientation"] = "landscape"
        elif height > width:
            facts["orientation"] = "portrait"
        else:
            facts["orientation"] = "square"
    megapixels = number_value(metadata_value(meta, "Megapixels"))
    if megapixels is not None:
        facts["megapixels"] = megapixels
    elif width and height:
        facts["megapixels"] = round(width * height / 1000000, 1)
    duration = duration_seconds(metadata_value(meta, "Duration", "MediaDuration"))
    if duration is not None:
        facts["duration_seconds"] = round(duration, 3)
    return facts


def merged_selected_metadata(source: Path, metadata_path: Path, args: argparse.Namespace, relative_path: str = "") -> dict[str, Any]:
    extract_gps = args.include_gps or not args.redact_gps
    include_private_keywords = args.include_private_keywords or not args.redact_private_keywords
    gps_tags = ["GPSLatitude", "GPSLongitude", "GPSAltitude", "GPSPosition"]
    source_tags = DISPLAY_SOURCE_TAGS + (gps_tags if extract_gps else [])
    source_meta = run_exiftool_tags(source, source_tags)
    lightroom_meta = run_exiftool_tags(metadata_path, DISPLAY_LIGHTROOM_TAGS)
    merged = {**source_meta, **{key: value for key, value in lightroom_meta.items() if value not in (None, "")}}
    merged.pop("SourceFile", None)
    gps = {key: merged.pop(key) for key in gps_tags if key in merged}
    keywords = cleaned_keywords(merged, include_private_keywords, args.keyword_blacklist_values)
    capture = parse_exif_datetime(metadata_value(merged, "DateTimeOriginal", "CreateDate"))
    dimensions = dimension_facts(merged)
    display = []
    display_specs = [
        ("Metadata title", metadata_value(merged, "Title")),
        ("Description", metadata_value(merged, "Description", "Caption-Abstract")),
        ("Keywords", ", ".join(keywords) if keywords else None),
        ("Captured", metadata_value(merged, "DateTimeOriginal", "CreateDate")),
        ("Camera", " ".join(str(part) for part in [metadata_value(merged, "Make"), metadata_value(merged, "Model")] if part)),
        ("Lens", metadata_value(merged, "Lens", "LensModel")),
        ("Exposure", exposure_label(merged)),
        ("Focal length", focal_length_label(merged)),
        ("Duration", metadata_value(merged, "Duration", "MediaDuration")),
        ("Location", location_label(merged)),
        ("Software", metadata_value(merged, "Software")),
        ("Color profile", metadata_value(merged, "ProfileDescription", "ColorSpace")),
        ("Original file", source.name),
        ("Original size", original_size_label(merged)),
    ]
    for label, value in display_specs:
        if value:
            display.append({"label": label, "value": str(value)})
    location = {
        "country": metadata_value(merged, "Country", "Country-PrimaryLocationName"),
        "region": metadata_value(merged, "State", "Province-State"),
        "city": metadata_value(merged, "City"),
        "location": metadata_value(merged, "Location"),
    }
    gallery_country = (
        forced_gallery_country(args.force_country)
        or infer_gallery_country(location, keywords, [relative_path, *Path(relative_path).parts])
    )
    if gallery_country["slug"] == "unknown" and gps:
        gallery_country = infer_gallery_country_from_gps(gps) or gallery_country
    return {
        "rating": normalize_rating(merged.get("Rating")),
        "label": metadata_value(merged, "Label", "ColorLabel"),
        "keywords": keywords,
        "capture": capture,
        "dimensions": dimensions,
        "location": location,
        "gallery_country": gallery_country,
        "raw": merged,
        "gps": gps,
        "display": display,
    }


def exposure_label(meta: dict[str, Any]) -> str | None:
    parts = []
    if meta.get("ExposureTime"):
        parts.append(str(meta["ExposureTime"]))
    if meta.get("FNumber"):
        parts.append(f"f/{meta['FNumber']}")
    if meta.get("ISO"):
        parts.append(f"ISO {meta['ISO']}")
    return ", ".join(parts) if parts else None


def focal_length_label(meta: dict[str, Any]) -> str | None:
    focal = metadata_value(meta, "FocalLength")
    equivalent = metadata_value(meta, "FocalLengthIn35mmFormat")
    if focal and equivalent:
        return f"{focal} / {equivalent} equivalent"
    return str(focal or equivalent) if focal or equivalent else None


def location_label(meta: dict[str, Any]) -> str | None:
    values = [
        metadata_value(meta, "Location"),
        metadata_value(meta, "City"),
        metadata_value(meta, "State", "Province-State"),
        metadata_value(meta, "Country", "Country-PrimaryLocationName"),
    ]
    deduped = []
    seen = set()
    for value in values:
        if not value:
            continue
        text = str(value)
        key = text.casefold()
        if key not in seen:
            seen.add(key)
            deduped.append(text)
    return ", ".join(deduped) if deduped else None


def original_size_label(meta: dict[str, Any]) -> str | None:
    width = metadata_value(meta, "ImageWidth")
    height = metadata_value(meta, "ImageHeight")
    megapixels = metadata_value(meta, "Megapixels")
    file_type = metadata_value(meta, "FileType")
    size = f"{width} x {height}" if width and height else None
    parts = [str(part) for part in [file_type, size, f"{megapixels} MP" if megapixels else None] if part]
    return " / ".join(parts) if parts else None


def ffmpeg_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def orientation_rotation_degrees(value: Any) -> int:
    if value in {3, "3"}:
        return 180
    if value in {6, "6"}:
        return -90
    if value in {8, "8"}:
        return 90
    text = str(value or "").casefold()
    if "90" in text and "270" not in text:
        return -90
    if "270" in text:
        return 90
    if "180" in text:
        return 180
    return 0


def orientation_rotates_sideways(value: Any) -> bool:
    return abs(orientation_rotation_degrees(value)) in {90, 270}


def normalize_jpeg_orientation(path: Path, orientation: Any) -> None:
    rotation = orientation_rotation_degrees(orientation)
    if not rotation:
        return
    try:
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError(
            "Pillow is required to normalize rotated source photos. Run `python3 -m pip install --user pillow`."
        ) from exc

    with Image.open(path) as image:
        normalized = image.convert("RGB").rotate(rotation, expand=True)
        normalized.save(path, format="JPEG", quality=95)


def ffmpeg_has_filter(name: str) -> bool:
    global FFMPEG_FILTERS
    if FFMPEG_FILTERS is None:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-filters"],
            text=True,
            capture_output=True,
            check=False,
        )
        FFMPEG_FILTERS = set(re.findall(r"^\s*[TSC.]+\s+(\S+)", result.stdout, re.MULTILINE))
    return name in FFMPEG_FILTERS


def apply_pillow_watermark(source: Path, output: Path, watermark: str, font: str, font_size: int, border_width: int, margin: int) -> None:
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError as exc:
        raise RuntimeError(
            "Pillow is required for baked preview watermarking. Run `python3 -m pip install --user pillow`."
        ) from exc

    with Image.open(source) as image:
        image = image.convert("RGB")
        overlay = Image.new("RGBA", image.size, (255, 255, 255, 0))
        watermark_text = (watermark or DEFAULT_WATERMARK).strip()
        repeat_text = watermark_text.upper()
        repeat_font = ImageFont.truetype(font, max(34, round(font_size * 2.35)))
        repeat_stroke = max(2, round(border_width * 2.2))
        repeat_draw = ImageDraw.Draw(overlay)
        bbox = repeat_draw.textbbox((0, 0), repeat_text, font=repeat_font, stroke_width=repeat_stroke)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        tile_padding = max(80, round(min(image.size) * 0.22))
        tile = Image.new("RGBA", (text_width + tile_padding * 2, text_height + tile_padding * 2), (255, 255, 255, 0))
        tile_draw = ImageDraw.Draw(tile)
        tile_draw.text(
            (tile_padding, tile_padding),
            repeat_text,
            font=repeat_font,
            fill=(255, 255, 255, 43),
            stroke_width=repeat_stroke,
            stroke_fill=(0, 0, 0, 33),
        )
        rotated = tile.rotate(-28, expand=True, resample=Image.Resampling.BICUBIC)
        step_x = max(220, round(rotated.width * 0.78))
        step_y = max(180, round(rotated.height * 0.72))
        for y in range(-rotated.height, image.height + rotated.height, step_y):
            row_offset = 0 if (y // step_y) % 2 == 0 else -(step_x // 2)
            for x in range(-rotated.width + row_offset, image.width + rotated.width, step_x):
                overlay.alpha_composite(rotated, (x, y))

        corner_font = ImageFont.truetype(font, font_size)
        corner_stroke = max(1, border_width)
        corner_draw = ImageDraw.Draw(overlay)
        corner_bbox = corner_draw.textbbox((0, 0), "PhotosByElie", font=corner_font, stroke_width=corner_stroke)
        corner_width = corner_bbox[2] - corner_bbox[0]
        corner_height = corner_bbox[3] - corner_bbox[1]
        corner_position = (
            max(margin, image.width - corner_width - margin),
            max(margin, image.height - corner_height - margin),
        )
        corner_draw.text(
            corner_position,
            "PhotosByElie",
            font=corner_font,
            fill=(255, 255, 255, 185),
            stroke_width=corner_stroke,
            stroke_fill=(0, 0, 0, 122),
        )
        watermarked = Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")
        watermarked.save(output, format="JPEG", quality=88, optimize=True)


def write_watermark_overlay(output: Path, width: int, height: int, watermark: str, font: str) -> None:
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError as exc:
        raise RuntimeError(
            "Pillow is required for baked preview watermarking. Run `python3 -m pip install --user pillow`."
        ) from exc

    overlay = Image.new("RGBA", (width, height), (255, 255, 255, 0))
    watermark_text = (watermark or DEFAULT_WATERMARK).strip()
    repeat_font = ImageFont.truetype(font, max(22, round(min(width, height) / 18)))
    repeat_stroke = max(1, round(min(width, height) / 260))
    draw = ImageDraw.Draw(overlay)
    bbox = draw.textbbox((0, 0), watermark_text.upper(), font=repeat_font, stroke_width=repeat_stroke)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    tile_padding = max(54, round(min(width, height) * 0.18))
    tile = Image.new("RGBA", (text_width + tile_padding * 2, text_height + tile_padding * 2), (255, 255, 255, 0))
    tile_draw = ImageDraw.Draw(tile)
    tile_draw.text(
        (tile_padding, tile_padding),
        watermark_text.upper(),
        font=repeat_font,
        fill=(255, 255, 255, 38),
        stroke_width=repeat_stroke,
        stroke_fill=(0, 0, 0, 32),
    )
    rotated = tile.rotate(-28, expand=True, resample=Image.Resampling.BICUBIC)
    step_x = max(180, round(rotated.width * 0.78))
    step_y = max(150, round(rotated.height * 0.72))
    for y in range(-rotated.height, height + rotated.height, step_y):
        row_offset = 0 if (y // step_y) % 2 == 0 else -(step_x // 2)
        for x in range(-rotated.width + row_offset, width + rotated.width, step_x):
            overlay.alpha_composite(rotated, (x, y))

    corner_font = ImageFont.truetype(font, max(18, round(min(width, height) / 24)))
    corner_stroke = max(1, round(min(width, height) / 360))
    corner_bbox = draw.textbbox((0, 0), "PhotosByElie", font=corner_font, stroke_width=corner_stroke)
    margin = max(18, round(min(width, height) / 36))
    corner_position = (
        max(margin, width - (corner_bbox[2] - corner_bbox[0]) - margin),
        max(margin, height - (corner_bbox[3] - corner_bbox[1]) - margin),
    )
    draw.text(
        corner_position,
        "PhotosByElie",
        font=corner_font,
        fill=(255, 255, 255, 185),
        stroke_width=corner_stroke,
        stroke_fill=(0, 0, 0, 122),
    )
    overlay.save(output)


def render_derivative(
    source: Path,
    output: Path,
    max_px: int,
    watermark: str,
    font: str,
    force: bool,
    orientation: Any = None,
) -> bool:
    if output.exists() and not force:
        return False
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="photosbyelie-render-") as temp_dir:
        temp_jpg = Path(temp_dir) / "base.jpg"
        temp_out = Path(temp_dir) / "watermarked.jpg"
        source_size = image_size(source)
        source_max = max(source_size.get("width") or 0, source_size.get("height") or 0)
        effective_max_px = min(max_px, source_max) if source_max else max_px
        subprocess.run(
            [
                "sips",
                "-s",
                "format",
                "jpeg",
                "--resampleHeightWidthMax",
                str(effective_max_px),
                str(source),
                "--out",
                str(temp_jpg),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        normalize_jpeg_orientation(temp_jpg, orientation)
        font_size = max(18, round(max_px / 45))
        border_width = max(1, round(font_size / 14))
        margin = max(18, round(max_px / 36))
        apply_pillow_watermark(temp_jpg, temp_out, watermark, font, font_size, border_width, margin)
        temp_out.replace(output)
    return True


def image_size(path: Path) -> dict[str, Any]:
    result = subprocess.run(
        ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        return {}
    width_match = re.search(r"pixelWidth:\s*(\d+)", result.stdout)
    height_match = re.search(r"pixelHeight:\s*(\d+)", result.stdout)
    if not width_match or not height_match:
        return {}
    width = int(width_match.group(1))
    height = int(height_match.group(1))
    return {
        "width": width,
        "height": height,
        "aspect_ratio": round(width / height, 4) if height else None,
        "bytes": path.stat().st_size if path.exists() else 0,
    }


def ffprobe_facts(path: Path) -> dict[str, Any]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height:format=duration",
            "-of",
            "json",
            str(path),
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        return {}
    try:
        payload = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        return {}
    stream = (payload.get("streams") or [{}])[0]
    width = int(stream.get("width") or 0)
    height = int(stream.get("height") or 0)
    duration = duration_seconds((payload.get("format") or {}).get("duration"))
    facts: dict[str, Any] = {
        "bytes": path.stat().st_size if path.exists() else 0,
    }
    if width and height:
        facts.update({
            "width": width,
            "height": height,
            "aspect_ratio": round(width / height, 4),
        })
    if duration is not None:
        facts["duration_seconds"] = round(duration, 3)
    return facts


def derivative_facts(output_root: Path, relative_path: str) -> dict[str, Any]:
    path = output_root / relative_path
    facts = ffprobe_facts(path) if path.suffix.lower() in VIDEO_EXTENSIONS else image_size(path)
    facts["path"] = relative_path
    facts["format"] = "MP4" if path.suffix.lower() in VIDEO_EXTENSIONS else "JPG"
    return facts


def video_poster_time(source: Path) -> float:
    facts = ffprobe_facts(source)
    duration = facts.get("duration_seconds")
    if not duration:
        return 0.0
    return max(0.0, min(float(duration) * DEFAULT_VIDEO_POSTER_FRACTION, max(0.0, float(duration) - 0.1)))


def video_scale_filter(max_px: int) -> str:
    return (
        "scale="
        f"'if(gte(iw,ih),-2,min({max_px},iw))':"
        f"'if(gte(iw,ih),min({max_px},ih),-2)'"
    )


def render_video_poster(source: Path, output: Path, watermark: str, font: str, force: bool) -> bool:
    if output.exists() and not force:
        return False
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="photosbyelie-video-poster-") as temp_dir:
        base = Path(temp_dir) / "poster.jpg"
        watermarked = Path(temp_dir) / "poster-watermarked.jpg"
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-ss",
                f"{video_poster_time(source):.3f}",
                "-i",
                str(source),
                "-frames:v",
                "1",
                "-vf",
                video_scale_filter(DEFAULT_GALLERY_MAX),
                "-q:v",
                "3",
                str(base),
            ],
            check=True,
        )
        apply_pillow_watermark(
            base,
            watermarked,
            watermark,
            font,
            max(18, round(DEFAULT_GALLERY_MAX / 45)),
            max(1, round(DEFAULT_GALLERY_MAX / 630)),
            max(18, round(DEFAULT_GALLERY_MAX / 36)),
        )
        watermarked.replace(output)
    return True


def render_video_preview(source: Path, output: Path, watermark: str, font: str, force: bool) -> bool:
    if output.exists() and not force:
        return False
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="photosbyelie-video-preview-") as temp_dir:
        base = Path(temp_dir) / "base.mp4"
        overlay = Path(temp_dir) / "watermark.png"
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(source),
                "-t",
                str(DEFAULT_VIDEO_PREVIEW_SECONDS),
                "-vf",
                video_scale_filter(DEFAULT_VIDEO_PREVIEW_MAX),
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "28",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                str(base),
            ],
            check=True,
        )
        facts = ffprobe_facts(base)
        width = int(facts.get("width") or 0)
        height = int(facts.get("height") or 0)
        if not width or not height:
            raise RuntimeError(f"Could not read generated video preview dimensions for {source}")
        write_watermark_overlay(overlay, width, height, watermark, font)
        subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(base),
                "-loop",
                "1",
                "-i",
                str(overlay),
                "-filter_complex",
                "[0:v][1:v]overlay=0:0:format=auto",
                "-t",
                str(DEFAULT_VIDEO_PREVIEW_SECONDS),
                "-shortest",
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "28",
                "-pix_fmt",
                "yuv420p",
                "-movflags",
                "+faststart",
                str(output),
            ],
            check=True,
        )
    return True


def r2_upload_enabled(args: argparse.Namespace, scope: str) -> bool:
    return args.r2_upload == "both" or args.r2_upload == scope


def r2_covered_keys() -> set[str]:
    global R2_COVERED_KEYS_CACHE
    if R2_COVERED_KEYS_CACHE is not None:
        return R2_COVERED_KEYS_CACHE

    covered: set[str] = set()

    if DEFAULT_R2_UPLOAD_STATE.exists():
        with DEFAULT_R2_UPLOAD_STATE.open("r", encoding="utf-8") as handle:
            for line in handle:
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not row.get("ok"):
                    continue
                if row.get("id"):
                    covered.add(str(row["id"]))
                if row.get("bucket") and row.get("key"):
                    covered.add(f"{row['bucket']}/{row['key']}")

    if DEFAULT_PRIVATE_DELIVERY_STATE.exists():
        with DEFAULT_PRIVATE_DELIVERY_STATE.open("r", encoding="utf-8") as handle:
            for line in handle:
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if row.get("status") != "uploaded":
                    continue
                for key in row.get("keys") or []:
                    if key:
                        covered.add(f"{DEFAULT_PRIVATE_BUCKET}/{key}")

    if DEFAULT_PRIVATE_DELIVERY_MANIFEST.exists():
        try:
            payload = json.loads(DEFAULT_PRIVATE_DELIVERY_MANIFEST.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            payload = {}
        private_bucket = str(payload.get("privateBucket") or DEFAULT_PRIVATE_BUCKET)
        records = payload.get("records") if isinstance(payload, dict) else {}
        if isinstance(records, dict):
            for record in records.values():
                if not isinstance(record, dict):
                    continue
                master = record.get("privateMaster") or {}
                if master.get("present") and master.get("key"):
                    covered.add(f"{private_bucket}/{master['key']}")
                renders = record.get("privateRenders") or {}
                if isinstance(renders, dict):
                    for render in renders.values():
                        if isinstance(render, dict) and render.get("present") and render.get("key"):
                            covered.add(f"{private_bucket}/{render['key']}")

    if DEFAULT_PUBLIC_PREVIEW_IDS.exists():
        try:
            payload = json.loads(DEFAULT_PUBLIC_PREVIEW_IDS.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            payload = {}
        public_bucket = str(payload.get("bucket") or DEFAULT_PUBLIC_BUCKET)
        for photo_id in payload.get("complete_pairs") or []:
            if not photo_id:
                continue
            covered.add(f"{public_bucket}/{public_preview_key(DEFAULT_PUBLIC_PREFIX, str(photo_id), 'gallery')}")
            covered.add(f"{public_bucket}/{public_preview_key(DEFAULT_PUBLIC_PREFIX, str(photo_id), 'detail')}")
            covered.add(f"{public_bucket}/{public_preview_key(DEFAULT_PUBLIC_PREFIX, str(photo_id), 'detail', 'video')}")

    if DEFAULT_PRIVATE_INVENTORY.exists():
        try:
            payload = json.loads(DEFAULT_PRIVATE_INVENTORY.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            payload = {}
        private_bucket = str(payload.get("bucket") or DEFAULT_PRIVATE_BUCKET)
        for key in (payload.get("masterKeys") or []) + (payload.get("renderKeys") or []):
            if key:
                covered.add(f"{private_bucket}/{key}")

    try:
        conn = owner_db_connect(Path.cwd())
        try:
            for row in conn.execute(
                "SELECT bucket, object_key FROM r2_objects WHERE lifecycle_state = 'current'"
            ):
                if row["bucket"] and row["object_key"]:
                    covered.add(f"{row['bucket']}/{row['object_key']}")
        finally:
            conn.close()
    except Exception:
        pass

    R2_COVERED_KEYS_CACHE = covered
    return covered


def r2_key_covered(args: argparse.Namespace, bucket: str, key: str) -> bool:
    return not getattr(args, "r2_force_upload", False) and f"{bucket}/{key}" in r2_covered_keys()


def artifact_plan_for_source(args: argparse.Namespace, photo_id: str, source_path: Path) -> dict[str, Any]:
    media_type = "video" if is_video(source_path) else "photo"
    plan: dict[str, Any] = {
        "photoId": photo_id,
        "mediaType": media_type,
        "privateMaster": None,
        "privateRenders": [],
        "publicPreviews": [],
    }
    if r2_upload_enabled(args, "private"):
        master_key = private_master_key(args.r2_private_prefix, photo_id, source_path)
        plan["privateMaster"] = {
            "bucket": args.r2_private_bucket,
            "key": master_key,
            "covered": r2_key_covered(args, args.r2_private_bucket, master_key),
        }
        if args.r2_private_renders and source_path.suffix.lower() in {".jpg", ".jpeg"}:
            for product_id in PRIVATE_RENDER_PRODUCTS:
                key = private_render_key(photo_id, product_id)
                plan["privateRenders"].append({
                    "productId": product_id,
                    "bucket": args.r2_private_bucket,
                    "key": key,
                    "covered": r2_key_covered(args, args.r2_private_bucket, key),
                })
        elif args.r2_private_renders:
            plan["privateRendersSkippedReason"] = "not a JPEG source"
        else:
            plan["privateRendersSkippedReason"] = "private renders disabled"
    if r2_upload_enabled(args, "public"):
        for derivative in ("gallery", "detail"):
            key = public_preview_key(args.r2_public_prefix, photo_id, derivative, media_type)
            plan["publicPreviews"].append({
                "derivative": derivative,
                "bucket": args.r2_public_bucket,
                "key": key,
                "covered": r2_key_covered(args, args.r2_public_bucket, key),
            })
    plan["needsMaster"] = bool(plan["privateMaster"] and not plan["privateMaster"]["covered"])
    plan["needsRenders"] = [item for item in plan["privateRenders"] if not item["covered"]]
    plan["needsPreviews"] = [item for item in plan["publicPreviews"] if not item["covered"]]
    plan["complete"] = not plan["needsMaster"] and not plan["needsRenders"] and not plan["needsPreviews"]
    return plan


def plan_asset(bucket: str, key: str, path: Path | None = None, content_type: str = "") -> dict[str, Any]:
    asset = {"bucket": bucket, "key": key}
    if path is not None:
        asset["path"] = str(path)
        if path.exists():
            asset["bytes"] = path.stat().st_size
    if content_type:
        asset["content_type"] = content_type
    return asset


def plan_r2_assets(plan: dict[str, Any], source_path: Path, preview_paths: dict[str, Path] | None = None) -> dict[str, Any]:
    assets: dict[str, Any] = {}
    master = plan.get("privateMaster")
    if master:
        assets["private_master"] = plan_asset(
            str(master["bucket"]),
            str(master["key"]),
            source_path,
            mimetypes.guess_type(source_path.name)[0] or "application/octet-stream",
        )
    renders = []
    for render in plan.get("privateRenders") or []:
        renders.append(plan_asset(str(render["bucket"]), str(render["key"]), None, "image/jpeg"))
    if renders:
        assets["private_renders"] = renders
    previews = []
    preview_paths = preview_paths or {}
    for preview in plan.get("publicPreviews") or []:
        derivative = str(preview.get("derivative") or "")
        path = preview_paths.get(derivative)
        content_type = "video/mp4" if derivative == "detail" and plan.get("mediaType") == "video" else "image/jpeg"
        previews.append(plan_asset(str(preview["bucket"]), str(preview["key"]), path, content_type))
    if previews:
        assets["public_previews"] = previews
    return assets


def force_artifact_plan_reimport(plan: dict[str, Any]) -> None:
    master = plan.get("privateMaster")
    if isinstance(master, dict):
        master["covered"] = False
    for key in ("privateRenders", "publicPreviews"):
        for item in plan.get(key) or []:
            if isinstance(item, dict):
                item["covered"] = False
    plan["needsMaster"] = bool(plan.get("privateMaster"))
    plan["needsRenders"] = list(plan.get("privateRenders") or [])
    plan["needsPreviews"] = list(plan.get("publicPreviews") or [])
    plan["complete"] = False


def emit_import_plan_steps(row: dict[str, Any], plan: dict[str, Any]) -> None:
    master = plan.get("privateMaster")
    if master:
        emit_import_step(
            row,
            "master_uploaded",
            status="done" if master.get("covered") else "pending",
            total=1,
            completed=1 if master.get("covered") else 0,
        )
    else:
        emit_import_step(row, "master_uploaded", status="skipped", reason="private upload disabled")

    renders = plan.get("privateRenders") or []
    if renders:
        covered = sum(1 for item in renders if item.get("covered"))
        status = "done" if covered >= len(renders) else "pending"
        emit_import_step(row, "triplets_created", status=status, total=len(renders), completed=covered)
        emit_import_step(row, "triplets_uploaded", status=status, total=len(renders), completed=covered)
    else:
        reason = str(plan.get("privateRendersSkippedReason") or "private renders disabled")
        emit_import_step(row, "triplets_created", status="skipped", reason=reason)
        emit_import_step(row, "triplets_uploaded", status="skipped", reason=reason)

    previews = plan.get("publicPreviews") or []
    if previews:
        covered = sum(1 for item in previews if item.get("covered"))
        status = "done" if covered >= len(previews) else "pending"
        emit_import_step(row, "previews_created", status=status, total=len(previews), completed=covered)
        emit_import_step(row, "previews_uploaded", status=status, total=len(previews), completed=covered)
    else:
        emit_import_step(row, "previews_created", status="skipped", reason="public upload disabled")
        emit_import_step(row, "previews_uploaded", status="skipped", reason="public upload disabled")


def r2_put_file(
    args: argparse.Namespace,
    bucket: str,
    key: str,
    path: Path,
    content_type: str,
    retries: int,
    cache_control: str | None = None,
    force_upload: bool = False,
) -> dict[str, Any]:
    item = UploadItem(bucket=bucket, key=key, path=path, content_type=content_type, cache_control=cache_control or "")
    if not force_upload and not getattr(args, "r2_force_upload", False) and f"{bucket}/{key}" in r2_covered_keys():
        record_r2_object_current(item, "build_lightroom_thumbnails-covered")
        return {
            "bucket": bucket,
            "key": key,
            "path": str(path),
            "bytes": path.stat().st_size,
            "content_type": content_type,
        }

    if args.r2_backend == "s3":
        missing = [
            name
            for name, value in (
                ("R2_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID", args.r2_s3_account_id),
                ("R2_ACCESS_KEY_ID or AWS_ACCESS_KEY_ID", args.r2_s3_access_key_id),
                ("R2_SECRET_ACCESS_KEY or AWS_SECRET_ACCESS_KEY", args.r2_s3_secret_access_key),
            )
            if not value
        ]
        if missing:
            raise RuntimeError(f"Missing S3 backend credential(s): {', '.join(missing)}")
        _, ok, output = s3_put(
            item,
            retries,
            DEFAULT_THROTTLE_FILE,
            args.r2_request_min_interval,
            args.r2_retry_max_delay,
            args.r2_s3_account_id,
            args.r2_s3_access_key_id,
            args.r2_s3_secret_access_key,
            args.r2_s3_endpoint,
        )
        if not ok:
            raise RuntimeError(f"R2 upload failed for {bucket}/{key}: {output}")
        record_r2_upload_success(item, "build_lightroom_thumbnails")
        return {
            "bucket": bucket,
            "key": key,
            "path": str(path),
            "bytes": path.stat().st_size,
            "content_type": content_type,
        }

    command = [
        *wrangler_command(),
        "r2",
        "object",
        "put",
        f"{bucket}/{key}",
        "--file",
        str(path),
        "--content-type",
        content_type,
        "--remote",
    ]
    if cache_control:
        command.extend(["--cache-control", cache_control])
    output = ""
    for attempt in range(retries + 1):
        result = subprocess.run(command, text=True, capture_output=True, check=False)
        output = (result.stdout or result.stderr).strip()
        if result.returncode == 0:
            record_r2_upload_success(item, "build_lightroom_thumbnails")
            return {
                "bucket": bucket,
                "key": key,
                "path": str(path),
                "bytes": path.stat().st_size,
                "content_type": content_type,
            }
        if attempt < retries:
            time.sleep(min(30, 2 ** attempt))
    raise RuntimeError(f"R2 upload failed for {bucket}/{key}: {output}")


def r2_public_key(args: argparse.Namespace, row: dict[str, Any], path: Path) -> str:
    return public_preview_key_for_reference(args.r2_public_prefix, str(row.get("id") or path.stem), path)


def r2_private_key(args: argparse.Namespace, row: dict[str, Any], source_path: Path) -> str:
    return private_master_key(args.r2_private_prefix, str(row.get("id") or source_path.stem), source_path)


def r2_private_render_key(row: dict[str, Any], source_path: Path, product_id: str) -> str:
    photo_id = str(row.get("id") or source_path.stem)
    return private_render_key(photo_id, product_id)


def long_edge_for_megapixels(size: dict[str, Any], megapixels: int) -> int:
    width = int(size.get("width") or 0)
    height = int(size.get("height") or 0)
    if not width or not height:
        return 0
    source_pixels = width * height
    target_pixels = megapixels * 1_000_000
    if target_pixels >= source_pixels:
        return max(width, height)
    return max(1, round(max(width, height) * (target_pixels / source_pixels) ** 0.5))


def render_private_deliverable(source_path: Path, output_path: Path, long_edge: int, force: bool) -> bool:
    if output_path.exists() and not force:
        return False
    output_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "sips",
            "-s",
            "format",
            "jpeg",
            "-s",
            "formatOptions",
            "90",
            "-Z",
            str(long_edge),
            str(source_path),
            "--out",
            str(output_path),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    return True


def upload_r2_assets(
    args: argparse.Namespace,
    row: dict[str, Any],
    gallery_path: Path,
    detail_path: Path,
    source_path: Path,
    plan: dict[str, Any],
) -> dict[str, Any]:
    preview_paths = {"gallery": gallery_path, "detail": detail_path}
    uploaded = plan_r2_assets(plan, source_path, preview_paths)
    force_reimport = bool(row.get("_force_reimport"))

    master = plan.get("privateMaster")
    if master and (force_reimport or not master.get("covered")):
        uploaded["private_master"] = r2_put_file(
            args,
            str(master["bucket"]),
            str(master["key"]),
            source_path,
            mimetypes.guess_type(source_path.name)[0] or "application/octet-stream",
            args.r2_retries,
            force_upload=force_reimport,
        )
        master["covered"] = True
        emit_import_step(row, "master_uploaded", status="done", total=1, completed=1)

    render_specs = plan.get("privateRenders") or []
    missing_renders = [item for item in render_specs if force_reimport or not item.get("covered")]
    if missing_renders:
        source_size = image_size(source_path)
        render_root = Path(tempfile.gettempdir()) / "photosbyelie-private-renders" / str(row.get("id") or source_path.stem)
        covered_count = len(render_specs) - len(missing_renders)
        rendered_count = 0
        uploaded_renders = [item for item in uploaded.get("private_renders") or [] if item.get("key") not in {spec["key"] for spec in missing_renders}]
        try:
            for spec in missing_renders:
                product_id = str(spec["productId"])
                long_edge = long_edge_for_megapixels(source_size, PRIVATE_RENDER_PRODUCTS[product_id])
                if not long_edge:
                    continue
                render_path = render_root / f"{product_id}.jpg"
                render_private_deliverable(source_path, render_path, long_edge, args.force or force_reimport)
                rendered_count += 1
                emit_import_step(row, "triplets_created", total=len(render_specs), completed=covered_count + rendered_count)
            uploaded_count = 0
            for spec in missing_renders:
                render_path = render_root / f"{spec['productId']}.jpg"
                if not render_path.exists():
                    continue
                uploaded_renders.append(
                    r2_put_file(
                        args,
                        str(spec["bucket"]),
                        str(spec["key"]),
                        render_path,
                        "image/jpeg",
                        args.r2_retries,
                        force_upload=force_reimport,
                    )
                )
                spec["covered"] = True
                uploaded_count += 1
                emit_import_step(row, "triplets_uploaded", total=len(render_specs), completed=covered_count + uploaded_count)
            if uploaded_renders:
                uploaded["private_renders"] = uploaded_renders
        finally:
            shutil.rmtree(render_root, ignore_errors=True)

    preview_specs = plan.get("publicPreviews") or []
    missing_previews = [item for item in preview_specs if force_reimport or not item.get("covered")]
    if missing_previews:
        covered_count = len(preview_specs) - len(missing_previews)
        created_count = 0
        source_orientation = row.get("_source_orientation")
        for spec in missing_previews:
            derivative = str(spec["derivative"])
            output = preview_paths[derivative]
            if row.get("media_type") == "video":
                if derivative == "gallery":
                    render_video_poster(source_path, output, args.watermark, row["_font"], args.force or force_reimport)
                else:
                    render_video_preview(source_path, output, args.watermark, row["_font"], args.force or force_reimport)
            else:
                max_px = args.gallery_max if derivative == "gallery" else args.detail_max
                render_derivative(source_path, output, max_px, args.watermark, row["_font"], args.force or force_reimport, source_orientation)
            created_count += 1
            emit_import_step(row, "previews_created", total=len(preview_specs), completed=covered_count + created_count)

        public_previews = [item for item in uploaded.get("public_previews") or [] if item.get("key") not in {spec["key"] for spec in missing_previews}]
        uploaded_count = 0
        for spec in missing_previews:
            derivative = str(spec["derivative"])
            path = preview_paths[derivative]
            content_type = "video/mp4" if (row.get("media_type") == "video" and derivative == "detail") else "image/jpeg"
            public_previews.append(
                r2_put_file(
                    args,
                    str(spec["bucket"]),
                    str(spec["key"]),
                    path,
                    content_type,
                    args.r2_retries,
                    cache_control="public, max-age=31536000, immutable",
                    force_upload=force_reimport,
                )
            )
            spec["covered"] = True
            uploaded_count += 1
            emit_import_step(row, "previews_uploaded", total=len(preview_specs), completed=covered_count + uploaded_count)
        if public_previews:
            uploaded["public_previews"] = public_previews
    return uploaded


def cleanup_uploaded_tmp_previews(args: argparse.Namespace, r2_assets: dict[str, Any], paths: list[Path]) -> list[str]:
    if args.keep_uploaded_tmp:
        return []
    public_previews = r2_assets.get("public_previews") or []
    if len(public_previews) < len(paths):
        return []
    removed: list[str] = []
    for path in paths:
        try:
            path.unlink(missing_ok=True)
            removed.append(str(path))
        except OSError:
            pass
    return removed


def load_manifest(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    try:
        rows = json.loads(path.read_text(encoding="utf-8")).get("photos", [])
    except json.JSONDecodeError:
        return {}
    return {row["relative_path"]: row for row in rows if "relative_path" in row}


def manifest_years(rows: dict[str, dict[str, Any]]) -> list[int]:
    years = {
        int(year)
        for row in rows.values()
        for year in [row.get("capture", {}).get("year")]
        if isinstance(year, int) or (isinstance(year, str) and year.isdigit())
    }
    return sorted(years)


def requested_years(value: str) -> list[int]:
    parsed = parse_year_filter(value)
    if not parsed:
        return []
    start, end = parsed
    return list(range(start, end + 1))


def run_filter(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "select": args.select,
        "label": args.label,
        "min_rating": args.min_rating,
        "years": args.years or None,
        "force_country": args.force_country or None,
    }


def write_manifest(path: Path, rows: dict[str, dict[str, Any]], args: argparse.Namespace) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    years = requested_years(args.years) or manifest_years(rows)
    payload = {
        "generated_at": now_iso(),
        "schema_version": SCHEMA_VERSION,
        "source_root_hint": str(args.source_root),
        "selection": {
            "select": args.select,
            "label": args.label,
            "min_rating": args.min_rating,
            "years": years,
            "force_country": args.force_country or None,
        },
        "last_run": {
            "source_root_hint": str(args.source_root),
            "filter": run_filter(args),
        },
        "derivatives": {
            "gallery_max": args.gallery_max,
            "detail_max": args.detail_max,
            "watermark": args.watermark,
            "watermark_policy": "baked-repeating-preview",
        },
        "photos": sorted(rows.values(), key=lambda row: row["relative_path"]),
    }
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def load_gps_manifest(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    try:
        rows = json.loads(path.read_text(encoding="utf-8")).get("photos", [])
    except json.JSONDecodeError:
        return {}
    return {row["relative_path"]: row for row in rows if "relative_path" in row}


def load_failures(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    try:
        rows = json.loads(path.read_text(encoding="utf-8")).get("photos", [])
    except json.JSONDecodeError:
        return {}
    return {row["relative_path"]: row for row in rows if "relative_path" in row}


def load_discarded_photo_ids(path: Path) -> set[str]:
    if not path.exists():
        return set()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return set()
    values = []
    if isinstance(payload, dict):
        values = (payload.get("photo_ids") or []) + (payload.get("discardedPhotoIds") or [])
        values += [photo.get("id") for photo in payload.get("photos") or [] if isinstance(photo, dict)]
    return {value for value in values or [] if isinstance(value, str) and value}


def normalize_source_path_value(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    try:
        return Path(text).expanduser().resolve(strict=False).as_posix()
    except OSError:
        return Path(text).expanduser().as_posix()


def source_path_values_from_object(value: Any) -> set[str]:
    paths: set[str] = set()
    if isinstance(value, dict):
        for key in ("source_path_hint", "sourcePath", "source_path", "sourceFile", "path"):
            normalized = normalize_source_path_value(value.get(key))
            if normalized:
                paths.add(normalized)
        for key in ("source_paths", "sourcePaths"):
            paths.update(source_path_values_from_object(value.get(key)))
        for key in ("sourceFiles", "source_files"):
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


def load_discarded_source_paths(path: Path) -> set[str]:
    if not path.exists():
        return set()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return set()
    return source_path_values_from_object(payload)


def source_paths_from_manifest_rows(rows: Any, blocked_photo_ids: set[str]) -> set[str]:
    paths: set[str] = set()
    if not blocked_photo_ids:
        return paths
    if isinstance(rows, dict):
        iterable = rows.values()
    elif isinstance(rows, list):
        iterable = rows
    else:
        return paths
    for row in iterable:
        if not isinstance(row, dict):
            continue
        photo_id = str(row.get("id") or "")
        if photo_id and photo_id in blocked_photo_ids:
            paths.update(source_path_values_from_object(row))
    return paths


def load_manifest_source_paths_for_ids(path: Path, blocked_photo_ids: set[str]) -> set[str]:
    if not path.exists() or not blocked_photo_ids:
        return set()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return set()
    if isinstance(payload, dict):
        return source_paths_from_manifest_rows(payload.get("photos") or [], blocked_photo_ids)
    return set()


def load_historical_discarded_source_paths(blocked_photo_ids: set[str]) -> set[str]:
    paths: set[str] = set()
    if not blocked_photo_ids:
        return paths
    tmp_root = Path("tmp")
    if not tmp_root.exists():
        return paths
    for manifest_path in tmp_root.glob("**/manifest.json"):
        paths.update(load_manifest_source_paths_for_ids(manifest_path, blocked_photo_ids))
    return paths


def discarded_source_suffixes(paths: set[str]) -> set[str]:
    suffixes = set()
    for value in paths:
        path = PurePosixPath(value)
        text = path.as_posix().strip("/")
        if "/" in text:
            suffixes.add(text)
    return suffixes


def source_path_is_discarded(source_path: Path, args: argparse.Namespace) -> bool:
    normalized = normalize_source_path_value(str(source_path))
    if not normalized:
        return False
    blocked_paths = getattr(args, "discarded_source_paths", set())
    if normalized in blocked_paths:
        return True
    candidate = PurePosixPath(normalized).as_posix().strip("/")
    for suffix in getattr(args, "discarded_source_suffixes", set()):
        if candidate.endswith(f"/{suffix}") or candidate == suffix:
            return True
    return False


def write_gps_manifest(path: Path, rows: dict[str, dict[str, Any]], args: argparse.Namespace) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": now_iso(),
        "schema_version": SCHEMA_VERSION,
        "source_root_hint": str(args.source_root),
        "private": True,
        "note": "Exact GPS metadata kept outside manifest.json so this file can stay untracked.",
        "photos": sorted(rows.values(), key=lambda row: row["relative_path"]),
    }
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def write_failures(path: Path, rows: dict[str, dict[str, Any]], args: argparse.Namespace) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": now_iso(),
        "schema_version": SCHEMA_VERSION,
        "source_root_hint": str(args.source_root),
        "count": len(rows),
        "photos": sorted(rows.values(), key=lambda row: row["relative_path"]),
    }
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def add_index_value(index: dict[str, dict[str, Any]], key: Any, photo_id: str, relative_path: str) -> None:
    if key in (None, ""):
        return
    text = str(key)
    row = index.setdefault(text, {"value": text, "count": 0, "photos": []})
    row["count"] += 1
    row["photos"].append({"id": photo_id, "relative_path": relative_path})


def write_keyword_index(path: Path, manifest: dict[str, dict[str, Any]]) -> None:
    index: dict[str, dict[str, Any]] = {}
    for photo in manifest.values():
        for keyword in photo.get("keywords", []):
            add_index_value(index, keyword, photo["id"], photo["relative_path"])
    payload = {
        "generated_at": now_iso(),
        "schema_version": SCHEMA_VERSION,
        "photos_count": len(manifest),
        "keywords": sorted(index.values(), key=lambda row: (-row["count"], row["value"].casefold())),
    }
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def write_collection_index(path: Path, manifest: dict[str, dict[str, Any]]) -> None:
    indexes = {
        "years": {},
        "countries": {},
        "gallery_countries": {},
        "regions": {},
        "cities": {},
        "orientations": {},
        "formats": {},
    }
    for photo in manifest.values():
        capture = photo.get("capture", {})
        location = photo.get("location", {})
        gallery_country = photo.get("gallery_country", {})
        dimensions = photo.get("dimensions", {})
        source = photo.get("source_file", {})
        add_index_value(indexes["years"], capture.get("year"), photo["id"], photo["relative_path"])
        add_index_value(indexes["countries"], location.get("country"), photo["id"], photo["relative_path"])
        add_index_value(indexes["gallery_countries"], gallery_country.get("slug"), photo["id"], photo["relative_path"])
        add_index_value(indexes["regions"], location.get("region"), photo["id"], photo["relative_path"])
        add_index_value(indexes["cities"], location.get("city"), photo["id"], photo["relative_path"])
        add_index_value(indexes["orientations"], dimensions.get("orientation"), photo["id"], photo["relative_path"])
        add_index_value(indexes["formats"], source.get("extension"), photo["id"], photo["relative_path"])
    payload = {
        "generated_at": now_iso(),
        "schema_version": SCHEMA_VERSION,
        "photos_count": len(manifest),
        "collections": {
            name: sorted(rows.values(), key=lambda row: (-row["count"], row["value"].casefold()))
            for name, rows in indexes.items()
        },
    }
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def derivative_paths(output_root: Path, country_slug: str, slug: str, media_type: str = "photo") -> tuple[Path, Path]:
    gallery = output_root / country_slug / f"{slug}_900.jpg"
    if media_type == "video":
        return gallery, output_root / country_slug / f"{slug}_short_5s_720p.mp4"
    return gallery, output_root / country_slug / f"{slug}_1800.jpg"


def extract_raw_preview(source: Path, output: Path) -> dict[str, Any]:
    attempted = []
    for tag in ("PreviewImage", "JpgFromRaw", "ThumbnailImage"):
        attempted.append(tag)
        with output.open("wb") as handle:
            result = subprocess.run(
                ["exiftool", "-b", f"-{tag}", str(source)],
                stdout=handle,
                stderr=subprocess.PIPE,
                check=False,
            )
        if result.returncode == 0 and output.exists() and output.stat().st_size > 0:
            facts = image_size(output)
            if facts.get("width") and facts.get("height"):
                return {
                    "path": output.name,
                    "method": f"exiftool -b -{tag}",
                    "tag": tag,
                    "width": facts["width"],
                    "height": facts["height"],
                    "bytes": output.stat().st_size,
                    "attempted": attempted,
                }
        output.unlink(missing_ok=True)
    raise RuntimeError(f"No embedded RAW preview found with {', '.join(attempted)}")


def render_sources_for(
    source: Path,
    args: argparse.Namespace,
    temp_dir: Path,
) -> tuple[Path, Path, dict[str, Any] | None, Any]:
    if is_raw_image(source):
        raise ValueError(f"{source} is a RAW file; export a developed still image before importing.")
    return source, source, None, None


def should_skip_metadata(row: dict[str, Any] | None, stamp: str, force: bool) -> bool:
    if force or not row:
        return False
    return row.get("checkpoint") == stamp


def manifest_derivatives_exist(output_root: Path, row: dict[str, Any] | None) -> bool:
    if not row:
        return False
    derivatives = row.get("derivatives", {})
    return bool(derivatives) and all((output_root / rel_path).exists() for rel_path in derivatives.values())


def discover_images(source_root: Path, year_filter: tuple[int, int] | None = None) -> Any:
    for root, dirs, files in os.walk(source_root):
        dirs[:] = sorted(
            (
                name
                for name in dirs
                if not name.startswith(".")
                and path_could_contain_year(rel_key(Path(root) / name, source_root), year_filter)
            ),
            reverse=True,
        )
        for name in sorted(files, reverse=True):
            path = Path(root) / name
            if is_importable_media(path):
                yield path


def apply_import_result(
    result: dict[str, Any],
    manifest: dict[str, dict[str, Any]],
    gps_manifest: dict[str, dict[str, Any]],
    failures: dict[str, dict[str, Any]],
) -> None:
    for relative_path in result.get("discarded") or []:
        manifest.pop(relative_path, None)
        gps_manifest.pop(relative_path, None)
        failures.pop(relative_path, None)
    for relative_path, row in (result.get("manifest") or {}).items():
        manifest[relative_path] = row
    for relative_path, row in (result.get("gps_manifest") or {}).items():
        gps_manifest[relative_path] = row
    for relative_path in result.get("clear_failures") or []:
        failures.pop(relative_path, None)
    for relative_path, row in (result.get("failures") or {}).items():
        failures[relative_path] = row


def process_import_item(
    item: dict[str, Any],
    args: argparse.Namespace,
    state_path: Path,
    font: str,
    item_index: int,
) -> dict[str, Any]:
    relative_path = item["relative_path"]
    source = item["source_path"]
    metadata_path = item["metadata_path"]
    meta = item.get("metadata")
    if not isinstance(meta, dict):
        metadata_rows = run_exiftool([metadata_path])
        meta = metadata_rows[0] if metadata_rows else {}
    base_state = {
        "relative_path": relative_path,
        "checkpoint": item["checkpoint"],
        "source_path_hint": str(source),
        "metadata_path_hint": str(metadata_path),
    }
    result: dict[str, Any] = {
        "completed": 0,
        "failed": 0,
        "rendered": 0,
        "manifest": {},
        "gps_manifest": {},
        "failures": {},
        "discarded": [],
        "clear_failures": [],
    }

    slug = slug_for(relative_path)
    if source_path_is_discarded(source, args):
        result["discarded"].append(relative_path)
        append_state(state_path, {**base_state, "status": "discarded", "reason": "discarded source path"})
        emit_import_event("PHOTO_DONE", photoId=slug, relativePath=relative_path, sourcePath=str(source), status="done")
        result["completed"] = 1
        return result
    if not selected_by_args(meta, args):
        append_state(state_path, {**base_state, "status": "skipped"})
        emit_import_event("PHOTO_DONE", photoId=slug, relativePath=relative_path, sourcePath=str(source), status="done")
        result["completed"] = 1
        return result

    try:
        if slug in getattr(args, "discarded_photo_ids", set()):
            result["discarded"].append(relative_path)
            append_state(state_path, {**base_state, "status": "discarded"})
            emit_import_event("PHOTO_DONE", photoId=slug, relativePath=relative_path, sourcePath=str(source), status="done")
            result["completed"] = 1
            return result
        selected_metadata = merged_selected_metadata(source, metadata_path, args, relative_path)
        gallery_country = selected_metadata["gallery_country"]
        media_type = "video" if is_video(source) else "photo"
        gallery_path, detail_path = derivative_paths(args.output_root, gallery_country["slug"], slug, media_type)
        artifact_plan = item.get("artifact_plan") if isinstance(item.get("artifact_plan"), dict) else artifact_plan_for_source(args, slug, source)
        row = {
            "id": slug,
            "relative_path": relative_path,
            "media_type": media_type,
            "source_path_hint": str(source),
            "metadata_path_hint": str(metadata_path),
            "source_checkpoint": item["checkpoint"],
            "gallery_country": gallery_country,
            "derivatives": {
                "gallery": gallery_path.relative_to(args.output_root).as_posix(),
                "detail": detail_path.relative_to(args.output_root).as_posix(),
            },
        }
        row["rating"] = selected_metadata["rating"]
        row["label"] = selected_metadata["label"]
        row["keywords"] = selected_metadata["keywords"]
        row["capture"] = selected_metadata["capture"]
        row["dimensions"] = selected_metadata["dimensions"]
        row["location"] = selected_metadata["location"]
        row["source_file"] = source_file_facts(source)
        row["metadata"] = selected_metadata["display"]
        row["raw_metadata"] = selected_metadata["raw"]
        row["selection_metadata"] = compact_metadata(meta)
        if item.get("source_changed"):
            row["_force_reimport"] = True
            force_artifact_plan_reimport(artifact_plan)
        print(f"START {item_index}: {slug} {gallery_country['slug']} {relative_path}", flush=True)
        emit_import_event(
            "PHOTO",
            index=item_index,
            photoId=slug,
            relativePath=relative_path,
            sourcePath=str(source),
            country=gallery_country["slug"],
            mediaType=media_type,
            status="running",
        )
        emit_import_plan_steps(row, artifact_plan)
        if selected_metadata["gps"]:
            result["gps_manifest"][relative_path] = {
                "id": slug,
                "relative_path": relative_path,
                "source_path_hint": str(source),
                "gps": selected_metadata["gps"],
            }
        if not args.dry_run:
            source_orientation = selected_metadata["raw"].get("Orientation")
            row["_font"] = font
            row["_source_orientation"] = source_orientation
            row["derivative_files"] = {
                "gallery": derivative_facts(args.output_root, row["derivatives"]["gallery"]),
                "detail": derivative_facts(args.output_root, row["derivatives"]["detail"]),
                "generated_at": now_iso(),
            }
            r2_assets = upload_r2_assets(args, row, gallery_path, detail_path, source, artifact_plan)
            if gallery_path.exists():
                color = caption_color(gallery_path)
                if color:
                    row["caption_color"] = color
            if r2_assets:
                removed_tmp = cleanup_uploaded_tmp_previews(args, r2_assets, [gallery_path, detail_path])
                row["r2"] = {
                    "uploaded_at": now_iso(),
                    **r2_assets,
                }
                if removed_tmp:
                    row["tmp_removed_after_upload"] = removed_tmp
            row.pop("_font", None)
            row.pop("_source_orientation", None)
            row.pop("_force_reimport", None)
            row["derivative_files"] = {
                "gallery": derivative_facts(args.output_root, row["derivatives"]["gallery"]),
                "detail": derivative_facts(args.output_root, row["derivatives"]["detail"]),
                "generated_at": now_iso(),
            }
        row.pop("_force_reimport", None)
        result["manifest"][relative_path] = row
        result["clear_failures"].append(relative_path)
        append_state(state_path, {**base_state, "status": "rendered" if not args.dry_run else "selected"})
        result["completed"] = 1
        result["rendered"] = 1
        if args.dry_run:
            print(f"{item_index}: {slug} selected {gallery_country['slug']}", flush=True)
        else:
            public_count = len((row.get("r2") or {}).get("public_previews") or [])
            private_render_count = len((row.get("r2") or {}).get("private_renders") or [])
            print(
                f"{item_index}: {slug} rendered {gallery_country['slug']} "
                f"public {public_count} private-renders {private_render_count}",
                flush=True,
            )
        emit_import_event("PHOTO_DONE", photoId=slug, relativePath=relative_path, sourcePath=str(source), status="done")
    except Exception as exc:
        result["failures"][relative_path] = {
            **base_state,
            "status": "error",
            "error": str(exc),
            "failed_at": now_iso(),
        }
        append_state(state_path, {**base_state, "status": "error", "error": str(exc)})
        emit_import_event("PHOTO_DONE", photoId=slug, relativePath=relative_path, sourcePath=str(source), status="error", error=str(exc))
        result["completed"] = 1
        result["failed"] = 1
        print(f"ERROR {relative_path}: {exc}", file=sys.stderr)
    return result


def process_batch(
    batch: list[dict[str, Any]],
    args: argparse.Namespace,
    state_path: Path,
    manifest: dict[str, dict[str, Any]],
    gps_manifest: dict[str, dict[str, Any]],
    failures: dict[str, dict[str, Any]],
    font: str,
    selection_limit: int | None = None,
    index_offset: int = 0,
) -> int:
    rendered_count = 0
    for item in batch:
        item_index = int(item.get("queue_index") or (index_offset + rendered_count + 1))
        result = process_import_item(item, args, state_path, font, item_index)
        apply_import_result(result, manifest, gps_manifest, failures)
        rendered_count += int(result.get("rendered") or 0)
        if selection_limit and rendered_count >= selection_limit:
            break
    return rendered_count


def select_batch(
    batch: list[dict[str, Any]],
    args: argparse.Namespace,
    state_path: Path,
    manifest: dict[str, dict[str, Any]],
    gps_manifest: dict[str, dict[str, Any]],
    failures: dict[str, dict[str, Any]],
    selection_limit: int | None = None,
    data_lock: threading.Lock | None = None,
) -> list[dict[str, Any]]:
    metadata_rows = run_exiftool([item["metadata_path"] for item in batch])
    by_source = {Path(row.get("SourceFile", "")).resolve(): row for row in metadata_rows}
    selected: list[dict[str, Any]] = []
    for item in batch:
        relative_path = item["relative_path"]
        source = item["source_path"]
        metadata_path = item["metadata_path"]
        meta = by_source.get(metadata_path.resolve(), {})
        base_state = {
            "relative_path": relative_path,
            "checkpoint": item["checkpoint"],
            "source_path_hint": str(source),
            "metadata_path_hint": str(metadata_path),
        }
        if not selected_by_args(meta, args):
            append_state(state_path, {**base_state, "status": "skipped"})
            continue
        slug = slug_for(relative_path)
        if slug in getattr(args, "discarded_photo_ids", set()) or source_path_is_discarded(source, args):
            if data_lock:
                with data_lock:
                    manifest.pop(relative_path, None)
                    gps_manifest.pop(relative_path, None)
                    failures.pop(relative_path, None)
            else:
                manifest.pop(relative_path, None)
                gps_manifest.pop(relative_path, None)
                failures.pop(relative_path, None)
            append_state(state_path, {**base_state, "status": "discarded"})
            continue
        selected.append({**item, "metadata": meta})
        if selection_limit and len(selected) >= selection_limit:
            break
    return selected


def write_import_outputs(
    args: argparse.Namespace,
    manifest_path: Path,
    keywords_path: Path,
    collections_path: Path,
    failures_path: Path,
    gps_manifest_path: Path,
    manifest: dict[str, dict[str, Any]],
    gps_manifest: dict[str, dict[str, Any]],
    failures: dict[str, dict[str, Any]],
) -> None:
    write_manifest(manifest_path, manifest, args)
    write_keyword_index(keywords_path, manifest)
    write_collection_index(collections_path, manifest)
    write_failures(failures_path, failures, args)
    if not args.redact_gps:
        write_gps_manifest(gps_manifest_path, gps_manifest, args)


def main() -> int:
    args = parse_args()
    args.workers = max(1, int(args.workers or 1))
    source_root = resolve_source_root(args.source_root)
    args.source_root = source_root
    args.developed_root = args.developed_root.expanduser().resolve() if args.developed_root else None
    args.output_root = args.output_root.expanduser()
    args.keyword_blacklist = args.keyword_blacklist.expanduser()
    args.keyword_blacklist_values = load_keyword_blacklist(args.keyword_blacklist)
    args.discarded_photo_ids = (
        load_discarded_photo_ids(args.hidden_blacklist.expanduser())
        | load_discarded_photo_ids(args.discarded_tombstone.expanduser())
        | load_discarded_photo_ids(Path("assets/discarded-media-manifest.json"))
    )
    args.discarded_source_paths = (
        load_discarded_source_paths(args.hidden_blacklist.expanduser())
        | load_discarded_source_paths(args.discarded_tombstone.expanduser())
        | load_discarded_source_paths(Path("assets/discarded-media-manifest.json"))
        | load_historical_discarded_source_paths(args.discarded_photo_ids)
    )
    args.discarded_source_suffixes = discarded_source_suffixes(args.discarded_source_paths)
    year_filter = parse_year_filter(args.years)
    if not source_root.exists():
        raise SystemExit(f"Source root does not exist: {source_root}")
    require_python_package("PIL", "Pillow")
    require_tool("exiftool")
    require_tool("sips")
    require_tool("ffmpeg")
    require_tool("ffprobe")
    font = choose_font()

    manifest_path = args.output_root / "manifest.json"
    gps_manifest_path = args.output_root / "gps-metadata.json"
    keywords_path = args.output_root / "keywords.json"
    collections_path = args.output_root / "collections.json"
    failures_path = args.output_root / "failures.json"
    state_path = args.output_root / ".build-state.jsonl"
    args.output_root.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest(manifest_path)
    sanitize_manifest_keywords(manifest, args.keyword_blacklist_values)
    gps_manifest = load_gps_manifest(gps_manifest_path) if not args.redact_gps else {}
    failures = load_failures(failures_path)
    state = load_latest_state(state_path) if not args.force else {}

    if args.clean_missing:
        manifest = {
            rel: row
            for rel, row in manifest.items()
            if all((args.output_root / path).exists() for path in row.get("derivatives", {}).values())
        }

    plan_queue: queue.Queue[list[dict[str, Any]] | None] = queue.Queue()
    work_queue: queue.Queue[dict[str, Any] | None] = queue.Queue()
    counters = {
        "seen": 0,
        "inspected": 0,
        "queued": 0,
        "alreadySelected": 0,
        "processed": 0,
        "succeeded": 0,
        "failed": 0,
        "active": 0,
        "plannerActive": 0,
    }
    counters_lock = threading.Lock()
    data_lock = threading.Lock()
    scan_errors: list[BaseException] = []
    worker_errors: list[BaseException] = []
    worker_count = args.workers

    def counter_snapshot() -> dict[str, int]:
        with counters_lock:
            return dict(counters)

    def add_counter(name: str, amount: int = 1) -> int:
        with counters_lock:
            counters[name] += amount
            return counters[name]

    def selected_limit_reached() -> bool:
        if not args.limit:
            return False
        snapshot = counter_snapshot()
        return snapshot["alreadySelected"] + snapshot["queued"] >= args.limit

    def wait_for_planner_limit() -> None:
        while args.limit and not selected_limit_reached() and (plan_queue.qsize() > 0 or counter_snapshot()["plannerActive"]):
            time.sleep(0.1)

    def emit_queue_event(kind: str) -> None:
        payload = counter_snapshot()
        payload["queueDepth"] = max(0, payload["queued"] - payload["processed"] - payload["active"])
        payload["planQueueDepth"] = plan_queue.qsize()
        payload["workers"] = worker_count
        emit_import_event(kind, **payload)

    def queue_scan_batch(batch_items: list[dict[str, Any]]) -> None:
        if not batch_items:
            return
        plan_queue.put(list(batch_items))
        emit_queue_event("SCAN_PROGRESS")

    def plan_selected_batch(batch_items: list[dict[str, Any]]) -> None:
        add_counter("inspected", len(batch_items))
        snapshot = counter_snapshot()
        print(
            f"Planning batch after {snapshot['seen']} files; "
            f"inspected {snapshot['inspected']}, queued {snapshot['queued']}",
            flush=True,
        )
        remaining = None
        if args.limit:
            remaining = max(0, args.limit - snapshot["alreadySelected"] - snapshot["queued"])
            if remaining <= 0:
                emit_queue_event("SCAN_PROGRESS")
                return
        selected_items = select_batch(
            batch_items,
            args,
            state_path,
            manifest,
            gps_manifest,
            failures,
            remaining,
            data_lock,
        )
        for selected_item in selected_items:
            relative_path = str(selected_item.get("relative_path") or "")
            source_path = selected_item.get("source_path")
            if not isinstance(source_path, Path):
                continue
            photo_id = slug_for(relative_path)
            plan = artifact_plan_for_source(args, photo_id, source_path)
            if selected_item.get("source_changed"):
                force_artifact_plan_reimport(plan)
            selected_item["artifact_plan"] = plan
            queued_index = add_counter("queued")
            selected_item["queue_index"] = queued_index
            plan_row = {
                "id": photo_id,
                "relative_path": relative_path,
                "media_type": plan.get("mediaType") or ("video" if is_video(source_path) else "photo"),
            }
            emit_import_event(
                "PHOTO",
                index=queued_index,
                photoId=photo_id,
                relativePath=relative_path,
                sourcePath=str(source_path),
                mediaType=plan_row["media_type"],
                status="queued",
            )
            emit_import_plan_steps(plan_row, plan)
            with data_lock:
                manifest_has_row = relative_path in manifest
            if plan.get("complete") and manifest_has_row:
                emit_import_event("PHOTO_DONE", photoId=photo_id, relativePath=relative_path, status="done")
                add_counter("processed")
                emit_queue_event("QUEUE_PROGRESS")
                continue
            work_queue.put(selected_item)
        emit_queue_event("SCAN_PROGRESS")

    def plan_sources() -> None:
        try:
            while True:
                batch_items = plan_queue.get()
                if batch_items is None:
                    break
                add_counter("plannerActive")
                try:
                    plan_selected_batch(batch_items)
                finally:
                    add_counter("plannerActive", -1)
                    emit_queue_event("SCAN_PROGRESS")
        except BaseException as error:  # noqa: BLE001 - report planner failure to the consumer.
            scan_errors.append(error)
            print(f"ERROR planner: {error}", file=sys.stderr, flush=True)
        finally:
            for _ in range(worker_count):
                work_queue.put(None)

    def scan_sources() -> None:
        batch: list[dict[str, Any]] = []
        try:
            for source in discover_images(source_root, year_filter):
                if selected_limit_reached():
                    break
                relative_path = rel_key(source, source_root)
                if not matches_year_filter(relative_path, year_filter):
                    continue
                add_counter("seen")
                sidecar = sidecar_for(source)
                metadata_path = sidecar or source
                stamp = checkpoint_key(source, sidecar)
                if source_path_is_discarded(source, args):
                    append_state(
                        state_path,
                        {
                            "relative_path": relative_path,
                            "checkpoint": stamp,
                            "source_path_hint": str(source),
                            "metadata_path_hint": str(metadata_path),
                            "status": "discarded",
                            "reason": "discarded source path",
                        },
                    )
                    with data_lock:
                        manifest.pop(relative_path, None)
                        gps_manifest.pop(relative_path, None)
                        failures.pop(relative_path, None)
                    continue
                if source.stat().st_size == 0:
                    append_state(
                        state_path,
                        {
                            "relative_path": relative_path,
                            "checkpoint": stamp,
                            "source_path_hint": str(source),
                            "metadata_path_hint": str(metadata_path),
                            "status": "skipped",
                            "reason": "empty source file",
                        },
                    )
                    continue
                prior = state.get(relative_path)
                with data_lock:
                    manifest_entry = manifest.get(relative_path)
                    manifest_row = manifest_entry if isinstance(manifest_entry, dict) else None
                    manifest_has_row = relative_path in manifest
                prior_matches = should_skip_metadata(prior, stamp, args.force)
                manifest_checkpoint = manifest_row.get("source_checkpoint") if manifest_row else None
                manifest_matches = bool(manifest_checkpoint and manifest_checkpoint == stamp)
                source_known_current = bool(prior_matches or manifest_matches)
                source_changed = bool(
                    (
                        (prior is not None and not prior_matches)
                        or (manifest_checkpoint and not manifest_matches)
                    )
                    and not source_known_current
                    and not args.force
                )
                if not args.force and manifest_has_row and not source_changed:
                    coverage_plan = artifact_plan_for_source(args, slug_for(relative_path), source)
                    if coverage_plan.get("complete"):
                        add_counter("alreadySelected")
                        if args.limit and counter_snapshot()["alreadySelected"] >= args.limit:
                            break
                        continue
                if prior_matches:
                    prior_status = prior.get("status")
                    if prior_status == "skipped":
                        continue
                    if prior_status in {"rendered", "selected"}:
                        if manifest_has_row:
                            coverage_plan = artifact_plan_for_source(args, slug_for(relative_path), source)
                            if args.dry_run or manifest_derivatives_exist(args.output_root, manifest_row) or coverage_plan.get("complete"):
                                add_counter("alreadySelected")
                                if args.limit and counter_snapshot()["alreadySelected"] >= args.limit:
                                    break
                                continue
                        # Metadata is known, but the manifest row or a derivative is missing. Rebuild from the original.
                    elif prior_status == "error":
                        pass
                    else:
                        continue
                batch.append(
                    {
                        "relative_path": relative_path,
                        "source_path": source,
                        "metadata_path": metadata_path,
                        "checkpoint": stamp,
                        "source_changed": source_changed,
                    }
                )
                if len(batch) >= args.batch_size:
                    queue_scan_batch(batch)
                    batch = []
                    if args.limit:
                        wait_for_planner_limit()
                        if selected_limit_reached():
                            break
            if batch and (not args.limit or not selected_limit_reached()):
                queue_scan_batch(batch)
                if args.limit:
                    wait_for_planner_limit()
            emit_queue_event("SCAN_DONE")
            snapshot = counter_snapshot()
            print(
                f"Scan done. Saw {snapshot['seen']} media files, inspected {snapshot['inspected']}, "
                f"queued {snapshot['queued']} selected photos.",
                flush=True,
            )
        except BaseException as error:  # noqa: BLE001 - report scanner failure to the consumer.
            scan_errors.append(error)
            print(f"ERROR scanner: {error}", file=sys.stderr, flush=True)
        finally:
            plan_queue.put(None)

    def process_work_item(item: dict[str, Any]) -> None:
        item_index = int(item.get("queue_index") or 0)
        add_counter("active")
        emit_queue_event("QUEUE_PROGRESS")
        snapshot = counter_snapshot()
        print(
            f"Processing queued photo {item_index or snapshot['processed'] + 1}; "
            f"queue depth {max(0, snapshot['queued'] - snapshot['processed'] - snapshot['active'])}",
            flush=True,
        )
        try:
            result = process_import_item(
                item,
                args,
                state_path,
                font,
                item_index or snapshot["processed"] + 1,
            )
            with data_lock:
                apply_import_result(result, manifest, gps_manifest, failures)
                write_import_outputs(
                    args,
                    manifest_path,
                    keywords_path,
                    collections_path,
                    failures_path,
                    gps_manifest_path,
                    manifest,
                    gps_manifest,
                    failures,
                )
            add_counter("processed", int(result.get("completed") or 0))
            add_counter("succeeded", int(result.get("rendered") or 0))
            add_counter("failed", int(result.get("failed") or 0))
        finally:
            add_counter("active", -1)
            emit_queue_event("QUEUE_PROGRESS")

    def render_worker(worker_index: int) -> None:
        try:
            while True:
                item = work_queue.get()
                try:
                    if item is None:
                        return
                    process_work_item(item)
                finally:
                    work_queue.task_done()
        except BaseException as error:  # noqa: BLE001 - report worker failure after the queue drains.
            worker_errors.append(error)
            print(f"ERROR worker {worker_index}: {error}", file=sys.stderr, flush=True)

    scanner = threading.Thread(target=scan_sources, name="source-scan", daemon=True)
    planner = threading.Thread(target=plan_sources, name="source-plan", daemon=True)
    workers = [
        threading.Thread(target=render_worker, args=(index + 1,), name=f"source-render-{index + 1}", daemon=True)
        for index in range(worker_count)
    ]
    scanner.start()
    planner.start()
    for worker in workers:
        worker.start()
    print(
        f"Pipeline started: scanner feeds planner; planner feeds {worker_count} parallel render/upload worker"
        f"{'' if worker_count == 1 else 's'}.",
        flush=True,
    )
    emit_queue_event("QUEUE_START")
    work_queue.join()

    scanner.join()
    planner.join()
    for worker in workers:
        worker.join()
    if scan_errors:
        raise scan_errors[0]
    if worker_errors:
        raise worker_errors[0]

    write_import_outputs(
        args,
        manifest_path,
        keywords_path,
        collections_path,
        failures_path,
        gps_manifest_path,
        manifest,
        gps_manifest,
        failures,
    )
    snapshot = counter_snapshot()
    print(f"Done. Saw {snapshot['seen']} media files, inspected {snapshot['inspected']}, manifest contains {len(manifest)} selected rows.")
    print(f"Manifest: {manifest_path}")
    print(f"Keyword index: {keywords_path}")
    print(f"Collection index: {collections_path}")
    print(f"Failures: {failures_path}")
    if not args.redact_gps:
        print(f"Private GPS metadata: {gps_manifest_path}")
    print(f"Checkpoint: {state_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
