#!/usr/bin/env python3
from __future__ import annotations

import argparse
import fcntl
import json
import mimetypes
import os
import random
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from media_policy import private_master_allowed, public_preview_allowed

DEFAULT_PUBLIC_BUCKET = "photosbyelie-public"
DEFAULT_PRIVATE_BUCKET = "photosbyelie-private"
DEFAULT_PUBLIC_PREFIX = "expo"
DEFAULT_PRIVATE_PREFIX = "masters"
DEFAULT_UPLOAD_STATE = Path(".review-logs/r2-upload-state.jsonl")
DEFAULT_DELETE_STATE = Path(".review-logs/r2-delete-state.jsonl")
DEFAULT_THROTTLE_FILE = Path(".review-logs/r2-upload-throttle.lock")
DEFAULT_SOURCE_ROOT_CANDIDATES = [
    Path("/Volumes/Saturn/Pictures/LR/Camera"),
    Path("/Volumes/Saturn-1/Pictures/LR/Camera"),
    Path("/Volumes/Saturn/Pictures/LR/_All Leonardo"),
    Path("/Volumes/Saturn-1/Pictures/LR/_All Leonardo"),
    Path.home() / "Pictures/LR/Camera",
    Path.home() / "Pictures/LR/_All Leonardo",
]


def wrangler_command() -> list[str]:
    configured = os.environ.get("WRANGLER_BIN")
    if configured:
        return [configured]
    local = shutil.which("wrangler")
    if local:
        return [local]
    cached = sorted(Path.home().glob(".npm/_npx/*/node_modules/.bin/wrangler"), key=lambda path: path.stat().st_mtime, reverse=True)
    if cached:
        return [str(cached[0])]
    return ["npx", "wrangler"]


@dataclass(frozen=True)
class UploadItem:
    bucket: str
    key: str
    path: Path
    content_type: str
    cache_control: str = ""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build, upload, or delete Photos By Elie public previews and private developed masters in Cloudflare R2."
    )
    parser.add_argument("--scope", choices=("public", "private", "both"), default="both")
    parser.add_argument("--public-bucket", default=DEFAULT_PUBLIC_BUCKET)
    parser.add_argument("--private-bucket", default=DEFAULT_PRIVATE_BUCKET)
    parser.add_argument("--public-prefix", default=DEFAULT_PUBLIC_PREFIX)
    parser.add_argument("--private-prefix", default=DEFAULT_PRIVATE_PREFIX)
    parser.add_argument("--include-reserve", action="store_true", help="Include Reserve previews in the public upload set.")
    parser.add_argument("--source-root", action="append", type=Path, default=[], help="Additional source roots for private masters.")
    parser.add_argument("--limit", type=int, default=0, help="Limit upload items for testing.")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--retries", type=int, default=8)
    parser.add_argument("--request-min-interval", type=float, default=float(os.environ.get("PBE_R2_REQUEST_MIN_INTERVAL", "0.75")), help="Minimum seconds between Wrangler write requests across concurrent sync processes.")
    parser.add_argument("--throttle-file", type=Path, default=DEFAULT_THROTTLE_FILE, help="Shared lock/timestamp file used to throttle parallel public/private syncs.")
    parser.add_argument("--retry-max-delay", type=float, default=float(os.environ.get("PBE_R2_RETRY_MAX_DELAY", "900")), help="Maximum seconds to wait before retrying a transient Wrangler failure.")
    parser.add_argument("--state-file", type=Path, default=DEFAULT_UPLOAD_STATE)
    parser.add_argument("--delete-state-file", type=Path, default=DEFAULT_DELETE_STATE)
    parser.add_argument("--no-resume", action="store_true", help="Ignore the local upload success journal.")
    parser.add_argument("--upload", action="store_true", help="Actually upload. Without this, only prints a dry-run inventory.")
    parser.add_argument("--delete", action="store_true", help="Delete the inventoried objects from R2.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable inventory summary.")
    args = parser.parse_args()
    if args.upload and args.delete:
        parser.error("--upload and --delete cannot be used together")
    return args


def load_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def clean_asset_ref(value: object) -> str:
    return str(value or "").removeprefix("./")


def country_slug(row: dict[str, Any]) -> str:
    gallery_country = row.get("gallery_country") or {}
    if isinstance(gallery_country, dict):
        return str(gallery_country.get("slug") or "unknown")
    return str(gallery_country or "unknown")


def public_key(public_prefix: str, derivative_path: Path) -> str:
    parts = derivative_path.as_posix().split("/")
    if len(parts) >= 4 and parts[0] == "assets" and parts[1] in {"expo", "reserve"}:
        return "/".join([public_prefix.strip("/"), *parts[2:]])
    return "/".join([public_prefix.strip("/"), *parts[-2:]])


def source_rows_by_id(repo_root: Path) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    reserve_payload = load_json(repo_root / "assets/reserve/manifest.json", {})
    reserve_rows = reserve_payload.get("photos") if isinstance(reserve_payload, dict) else []
    rows = [row for row in reserve_rows or [] if isinstance(row, dict)]
    return {row["id"]: row for row in rows if row.get("id")}, rows, reserve_payload


def expo_rows(repo_root: Path) -> list[dict[str, Any]]:
    payload = load_json(repo_root / "assets/expo-manifest.json", {})
    return [row for row in payload.get("photos", []) if isinstance(row, dict)]


def expo_derivative_path(repo_root: Path, expo_row: dict[str, Any], source_row: dict[str, Any], derivative: str) -> Path | None:
    """Resolve the selected Expo derivative even when assets/expo is metadata-only."""
    rel = clean_asset_ref((expo_row.get("derivatives") or {}).get(derivative))
    if rel:
        path = repo_root / rel
        if path.exists():
            return path

    source_rel = clean_asset_ref((source_row.get("derivatives") or {}).get(derivative))
    if source_rel:
        path = repo_root / "assets/reserve" / source_rel
        if path.exists():
            return path
        return path
    return None


def public_upload_items(repo_root: Path, args: argparse.Namespace, rows_by_id: dict[str, dict[str, Any]], reserve_rows: list[dict[str, Any]]) -> tuple[list[UploadItem], list[dict[str, str]]]:
    items: list[UploadItem] = []
    skipped: list[dict[str, str]] = []
    seen_keys: set[str] = set()

    candidates: list[tuple[dict[str, Any], Path]] = []
    for row in expo_rows(repo_root):
        source_row = rows_by_id.get(row.get("id"), row)
        for derivative in ("gallery", "detail"):
            path = expo_derivative_path(repo_root, row, source_row, derivative)
            if path:
                candidates.append((source_row, path))
    if args.include_reserve:
        for row in reserve_rows:
            for rel in (row.get("derivatives") or {}).values():
                candidates.append((row, repo_root / "assets/reserve" / clean_asset_ref(rel)))

    for row, path in candidates:
        if not public_preview_allowed(row):
            skipped.append({"id": str(row.get("id") or ""), "reason": "raw-or-unverified-source"})
            continue
        if not path.exists():
            skipped.append({"id": str(row.get("id") or ""), "reason": "missing-preview", "path": str(path)})
            continue
        key = public_key(args.public_prefix, path.relative_to(repo_root))
        if key in seen_keys:
            continue
        seen_keys.add(key)
        items.append(
            UploadItem(
                bucket=args.public_bucket,
                key=key,
                path=path,
                content_type="image/jpeg",
                cache_control="public, max-age=31536000, immutable",
            )
        )
    return items, skipped


def source_roots(args: argparse.Namespace, manifest_payload: dict[str, Any]) -> list[Path]:
    roots = []
    for value in [manifest_payload.get("source_root_hint"), *(args.source_root or []), *DEFAULT_SOURCE_ROOT_CANDIDATES]:
        if not value:
            continue
        path = Path(value).expanduser()
        if path.exists():
            roots.append(path.resolve())
    unique: list[Path] = []
    seen: set[Path] = set()
    for root in roots:
        if root in seen:
            continue
        unique.append(root)
        seen.add(root)
    return unique


def resolve_source_path(row: dict[str, Any], roots: list[Path]) -> Path | None:
    raw_hint = str(row.get("source_path_hint") or "")
    hinted = Path(raw_hint)
    if raw_hint and hinted.exists():
        return hinted.resolve()
    relative = Path(str(row.get("relative_path") or ""))
    if not str(relative):
        return None
    if relative.is_absolute():
        return relative.resolve() if relative.exists() else None
    for root in roots:
        candidate = root / relative
        if candidate.exists():
            return candidate.resolve()
    return None


def private_key(private_prefix: str, row: dict[str, Any], source_path: Path) -> str:
    photo_id = str(row.get("id") or source_path.stem)
    return "/".join([private_prefix.strip("/"), photo_id, source_path.name])


def private_upload_items(repo_root: Path, args: argparse.Namespace, rows: list[dict[str, Any]], manifest_payload: dict[str, Any]) -> tuple[list[UploadItem], list[dict[str, str]]]:
    roots = source_roots(args, manifest_payload)
    items: list[UploadItem] = []
    skipped: list[dict[str, str]] = []
    seen_paths: set[Path] = set()
    for row in rows:
        if not private_master_allowed(row):
            skipped.append({"id": str(row.get("id") or ""), "reason": "raw-or-unverified-source"})
            continue
        source_path = resolve_source_path(row, roots)
        if not source_path:
            skipped.append({"id": str(row.get("id") or ""), "reason": "missing-developed-master"})
            continue
        if source_path in seen_paths:
            continue
        seen_paths.add(source_path)
        content_type = mimetypes.guess_type(source_path.name)[0] or "application/octet-stream"
        items.append(
            UploadItem(
                bucket=args.private_bucket,
                key=private_key(args.private_prefix, row, source_path),
                path=source_path,
                content_type=content_type,
            )
        )
    return items, skipped


def upload_id(item: UploadItem) -> str:
    return f"{item.bucket}/{item.key}"


def load_upload_state(path: Path) -> set[str]:
    uploaded: set[str] = set()
    if not path.exists():
        return uploaded
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get("ok") and row.get("id"):
                uploaded.add(str(row["id"]))
    return uploaded


def append_upload_state(path: Path, item: UploadItem, lock: threading.Lock) -> None:
    row = {
        "uploaded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "ok": True,
        "id": upload_id(item),
        "bucket": item.bucket,
        "key": item.key,
        "path": str(item.path),
        "bytes": item.path.stat().st_size,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with lock:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
            handle.flush()


def append_delete_state(path: Path, item: UploadItem, lock: threading.Lock) -> None:
    row = {
        "deleted_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "ok": True,
        "id": upload_id(item),
        "bucket": item.bucket,
        "key": item.key,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with lock:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
            handle.flush()


def throttle_wrangler_request(throttle_file: Path, min_interval: float) -> None:
    """Throttle Wrangler request starts across separate public/private sync processes."""
    if min_interval <= 0:
        return
    throttle_file.parent.mkdir(parents=True, exist_ok=True)
    with throttle_file.open("a+", encoding="utf-8") as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            handle.seek(0)
            raw = handle.read().strip()
            try:
                previous = float(raw) if raw else 0.0
            except ValueError:
                previous = 0.0
            now = time.monotonic()
            wait = previous + min_interval - now
            if wait > 0:
                time.sleep(wait)
                now = time.monotonic()
            handle.seek(0)
            handle.truncate()
            handle.write(f"{now:.6f}")
            handle.flush()
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def terminal_auth_error(output: str) -> bool:
    terminal_patterns = (
        "Invalid access token",
        "Failed to fetch auth token",
        "CLOUDFLARE_API_TOKEN",
        "non-interactive environment",
    )
    return any(pattern in output for pattern in terminal_patterns)


def transient_wrangler_error(output: str) -> bool:
    transient_patterns = (
        "429",
        "Too Many Requests",
        "Rate limited",
        "Failed to fetch",
        "fetch failed",
        "ECONNRESET",
        "ETIMEDOUT",
        "EAI_AGAIN",
        "ENOTFOUND",
        "Network",
        "401: Unauthorized",
        "403: Forbidden",
    )
    return any(pattern in output for pattern in transient_patterns)


def retry_delay(output: str, attempt: int, max_delay: float) -> float:
    if "429" in output or "Too Many Requests" in output or "Rate limited" in output:
        base = 60 * (attempt + 1)
    elif "401: Unauthorized" in output or "403: Forbidden" in output or "Failed to fetch" in output:
        base = 30 * (attempt + 1)
    else:
        base = 8 * (2 ** attempt)
    jitter = random.uniform(0, min(15, max(1, base * 0.15)))
    return min(max_delay, base + jitter)


def wrangler_put(
    item: UploadItem,
    retries: int,
    throttle_file: Path = DEFAULT_THROTTLE_FILE,
    request_min_interval: float = 0.75,
    retry_max_delay: float = 900,
) -> tuple[UploadItem, bool, str]:
    command = [
        *wrangler_command(),
        "r2",
        "object",
        "put",
        f"{item.bucket}/{item.key}",
        "--file",
        str(item.path),
        "--content-type",
        item.content_type,
        "--remote",
    ]
    if item.cache_control:
        command.extend(["--cache-control", item.cache_control])
    output = ""
    for attempt in range(retries + 1):
        throttle_wrangler_request(throttle_file, request_min_interval)
        result = subprocess.run(command, text=True, capture_output=True, check=False)
        output = "\n".join(part.strip() for part in (result.stdout, result.stderr) if part and part.strip())
        if result.returncode == 0:
            return item, True, output
        if terminal_auth_error(output):
            return item, False, output
        if attempt < retries:
            if transient_wrangler_error(output):
                time.sleep(retry_delay(output, attempt, retry_max_delay))
            else:
                time.sleep(min(retry_max_delay, 8 * (2 ** attempt)))
    return item, False, output


def wrangler_delete(
    item: UploadItem,
    retries: int,
    throttle_file: Path = DEFAULT_THROTTLE_FILE,
    request_min_interval: float = 0.75,
    retry_max_delay: float = 900,
) -> tuple[UploadItem, bool, str]:
    command = [
        *wrangler_command(),
        "r2",
        "object",
        "delete",
        f"{item.bucket}/{item.key}",
        "--remote",
    ]
    output = ""
    for attempt in range(retries + 1):
        throttle_wrangler_request(throttle_file, request_min_interval)
        result = subprocess.run(command, text=True, capture_output=True, check=False)
        output = "\n".join(part.strip() for part in (result.stdout, result.stderr) if part and part.strip())
        if result.returncode == 0:
            return item, True, output
        if terminal_auth_error(output):
            return item, False, output
        if attempt < retries:
            if transient_wrangler_error(output):
                time.sleep(retry_delay(output, attempt, retry_max_delay))
            else:
                time.sleep(min(retry_max_delay, 8 * (2 ** attempt)))
    return item, False, output


def upload(items: list[UploadItem], workers: int, retries: int, state_file: Path, throttle_file: Path, request_min_interval: float, retry_max_delay: float) -> int:
    failed = 0
    lock = threading.Lock()
    started = time.monotonic()
    uploaded_bytes = 0
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = [
            executor.submit(wrangler_put, item, retries, throttle_file, request_min_interval, retry_max_delay)
            for item in items
        ]
        for index, future in enumerate(as_completed(futures), start=1):
            item, ok, output = future.result()
            if not ok:
                failed += 1
                print(f"FAILED {item.bucket}/{item.key}: {output}", file=sys.stderr)
            else:
                uploaded_bytes += item.path.stat().st_size
                append_upload_state(state_file, item, lock)
            if index % 25 == 0 or index == len(items):
                elapsed = max(1, time.monotonic() - started)
                mib = uploaded_bytes / (1024 * 1024)
                print(f"progress {index}/{len(items)} failed={failed} uploaded={mib:.1f} MiB rate={mib / elapsed:.2f} MiB/s", flush=True)
    return failed


def delete_items(items: list[UploadItem], workers: int, retries: int, state_file: Path, throttle_file: Path, request_min_interval: float, retry_max_delay: float) -> int:
    failed = 0
    lock = threading.Lock()
    started = time.monotonic()
    deleted_bytes = 0
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = [
            executor.submit(wrangler_delete, item, retries, throttle_file, request_min_interval, retry_max_delay)
            for item in items
        ]
        for index, future in enumerate(as_completed(futures), start=1):
            item, ok, output = future.result()
            if not ok:
                failed += 1
                print(f"FAILED DELETE {item.bucket}/{item.key}: {output}", file=sys.stderr)
            else:
                deleted_bytes += item.path.stat().st_size if item.path.exists() else 0
                append_delete_state(state_file, item, lock)
            if index % 25 == 0 or index == len(items):
                elapsed = max(1, time.monotonic() - started)
                mib = deleted_bytes / (1024 * 1024)
                print(f"progress {index}/{len(items)} failed={failed} deleted={mib:.1f} MiB rate={mib / elapsed:.2f} MiB/s", flush=True)
    return failed


def summarize(items: list[UploadItem], skipped: list[dict[str, str]]) -> dict[str, Any]:
    by_bucket: dict[str, dict[str, Any]] = {}
    for item in items:
        row = by_bucket.setdefault(item.bucket, {"files": 0, "bytes": 0})
        row["files"] += 1
        row["bytes"] += item.path.stat().st_size
    skipped_reasons: dict[str, int] = {}
    for row in skipped:
        skipped_reasons[row["reason"]] = skipped_reasons.get(row["reason"], 0) + 1
    return {
        "items": len(items),
        "by_bucket": by_bucket,
        "skipped": len(skipped),
        "skipped_reasons": dict(sorted(skipped_reasons.items())),
        "sample": [
            {"bucket": item.bucket, "key": item.key, "path": str(item.path)}
            for item in items[:10]
        ],
    }


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[1]
    rows_by_id, reserve_rows, reserve_payload = source_rows_by_id(repo_root)
    items: list[UploadItem] = []
    skipped: list[dict[str, str]] = []

    if args.scope in {"public", "both"}:
        next_items, next_skipped = public_upload_items(repo_root, args, rows_by_id, reserve_rows)
        items.extend(next_items)
        skipped.extend(next_skipped)
    if args.scope in {"private", "both"}:
        next_items, next_skipped = private_upload_items(repo_root, args, reserve_rows, reserve_payload)
        items.extend(next_items)
        skipped.extend(next_skipped)

    if args.limit:
        items = items[: args.limit]

    resumed_count = 0
    if args.upload and not args.no_resume:
        uploaded_ids = load_upload_state(args.state_file)
        before = len(items)
        items = [item for item in items if upload_id(item) not in uploaded_ids]
        resumed_count = before - len(items)
    elif args.delete and not args.no_resume:
        deleted_ids = load_upload_state(args.delete_state_file)
        before = len(items)
        items = [item for item in items if upload_id(item) not in deleted_ids]
        resumed_count = before - len(items)

    summary = summarize(items, skipped)
    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print(f"{'Delete' if args.delete else 'Upload'} inventory: {summary['items']} files")
        for bucket, row in summary["by_bucket"].items():
            print(f"- {bucket}: {row['files']} files, {row['bytes']} bytes")
        print(f"Skipped: {summary['skipped']} ({summary['skipped_reasons']})")
        if resumed_count:
            print(f"Already {'deleted' if args.delete else 'uploaded'} in local state: {resumed_count}")
        if not args.upload and not args.delete:
            print("Dry run only. Add --upload to write to R2 or --delete to remove from R2.")

    if args.delete:
        return 1 if delete_items(
            items,
            args.workers,
            args.retries,
            args.delete_state_file,
            args.throttle_file,
            args.request_min_interval,
            args.retry_max_delay,
        ) else 0
    if not args.upload:
        return 0
    return 1 if upload(
        items,
        args.workers,
        args.retries,
        args.state_file,
        args.throttle_file,
        args.request_min_interval,
        args.retry_max_delay,
    ) else 0


if __name__ == "__main__":
    raise SystemExit(main())
