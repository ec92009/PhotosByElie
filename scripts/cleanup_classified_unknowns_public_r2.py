#!/usr/bin/env python3
"""Move already-uploaded Unknown public R2 previews after country classification.

The normal public sync now skips hidden entries and writes classified photos to
their final country prefix. This utility is for the recovery case where Unknown
preview objects already exist in the public bucket and a review log records the
target country keys. It uploads the target key first, then deletes the old
Unknown key, recording resumable state in `.review-logs/`.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import json
import mimetypes
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict
from pathlib import Path
from typing import Any

import fcntl

import sync_r2_media


DEFAULT_REVIEW_LOG = Path(".review-logs/unknown-country-classification-20260506T223844Z.json")
DEFAULT_BUCKET = "photosbyelie-public"
DEFAULT_THROTTLE_FILE = Path(".review-logs/r2-upload-throttle.lock")
S3_REGION = "auto"
S3_SERVICE = "s3"


def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def detect_active_r2_writer_processes() -> tuple[bool, list[str], str]:
    """
    Best-effort check for concurrent R2 writers.

    Returns:
      (running, matches, note)
    """
    command = ["ps", "aux"]
    try:
        result = subprocess.run(command, text=True, capture_output=True, check=False)
    except Exception as exc:  # pragma: no cover - platform/sandbox dependent
        return False, [], f"process-scan-unavailable: {exc}"
    if result.returncode != 0:
        output = "\n".join(part.strip() for part in (result.stdout, result.stderr) if part and part.strip())
        return False, [], f"process-scan-failed rc={result.returncode}: {output}"
    matches = []
    for line in (result.stdout or "").splitlines():
        if "scripts/sync_r2_media.py" in line or "wrangler r2 object" in line:
            matches.append(line.strip())
    return bool(matches), matches, "ok"


def throttle_lock_is_held(throttle_file: Path) -> tuple[bool, str]:
    throttle_file.parent.mkdir(parents=True, exist_ok=True)
    with throttle_file.open("a+", encoding="utf-8") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True, "throttle-lock-held"
        finally:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            except OSError:
                pass
    return False, "throttle-lock-free"


def load_state(state_log: Path) -> dict[str, dict[str, Any]]:
    state: dict[str, dict[str, Any]] = {}
    if not state_log.exists():
        return state
    with state_log.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            move_id = str(row.get("id") or "")
            if not move_id:
                continue
            state[move_id] = row
    return state


def append_state(state_log: Path, payload: dict[str, Any]) -> None:
    state_log.parent.mkdir(parents=True, exist_ok=True)
    with state_log.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, sort_keys=True) + "\n")


def move_id(from_key: str, to_key: str) -> str:
    return f"{from_key} -> {to_key}"


def upload_item(bucket: str, key: str, path: Path) -> sync_r2_media.UploadItem:
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    cache_control = "public, max-age=31536000, immutable"
    return sync_r2_media.UploadItem(bucket=bucket, key=key, path=path, content_type=content_type, cache_control=cache_control)


def upload_item_payload(item: sync_r2_media.UploadItem) -> dict[str, Any]:
    payload = asdict(item)
    payload["path"] = str(item.path)
    return payload


def first_env(*names: str) -> str:
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return ""


def quote_s3_path(path: str) -> str:
    return "/" + "/".join(urllib.parse.quote(part, safe="-_.~") for part in path.split("/"))


def signing_key(secret_key: str, datestamp: str) -> bytes:
    date_key = hmac.new(("AWS4" + secret_key).encode("utf-8"), datestamp.encode("utf-8"), hashlib.sha256).digest()
    region_key = hmac.new(date_key, S3_REGION.encode("utf-8"), hashlib.sha256).digest()
    service_key = hmac.new(region_key, S3_SERVICE.encode("utf-8"), hashlib.sha256).digest()
    return hmac.new(service_key, b"aws4_request", hashlib.sha256).digest()


def s3_request(
    method: str,
    item: sync_r2_media.UploadItem,
    body: bytes,
    account_id: str,
    access_key_id: str,
    secret_access_key: str,
    endpoint: str,
    timeout: float = 120.0,
) -> tuple[bool, str]:
    host = endpoint or f"{account_id}.r2.cloudflarestorage.com"
    url = f"https://{host}{quote_s3_path(item.bucket + '/' + item.key)}"
    payload_hash = hashlib.sha256(body).hexdigest()
    now = dt.datetime.now(dt.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    datestamp = now.strftime("%Y%m%d")

    headers = {
        "host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
    }
    if method == "PUT":
        headers["cache-control"] = item.cache_control
        headers["content-type"] = item.content_type

    signed_header_names = sorted(headers)
    canonical_headers = "".join(f"{name}:{headers[name].strip()}\n" for name in signed_header_names)
    signed_headers = ";".join(signed_header_names)
    canonical_request = "\n".join(
        [
            method,
            quote_s3_path(item.bucket + "/" + item.key),
            "",
            canonical_headers,
            signed_headers,
            payload_hash,
        ]
    )
    credential_scope = f"{datestamp}/{S3_REGION}/{S3_SERVICE}/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )
    signature = hmac.new(signing_key(secret_access_key, datestamp), string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    request_headers = {name: value for name, value in headers.items() if name != "host"}
    request_headers["Authorization"] = (
        "AWS4-HMAC-SHA256 "
        f"Credential={access_key_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, "
        f"Signature={signature}"
    )
    try:
        request = urllib.request.Request(url, data=body if method == "PUT" else None, headers=request_headers, method=method)
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response_body = response.read(4096).decode("utf-8", errors="replace")
            return 200 <= response.status < 300, f"{method} {item.bucket}/{item.key}: HTTP {response.status} {response_body}".strip()
    except urllib.error.HTTPError as exc:
        response_body = exc.read(4096).decode("utf-8", errors="replace")
        return False, f"{method} {item.bucket}/{item.key}: HTTP {exc.code} {response_body}".strip()
    except urllib.error.URLError as exc:
        return False, f"{method} {item.bucket}/{item.key}: URL error {exc.reason}"
    except (OSError, UnicodeError) as exc:
        return False, f"{method} {item.bucket}/{item.key}: OS error {exc}"


def s3_put(
    item: sync_r2_media.UploadItem,
    retries: int,
    throttle_file: Path,
    request_min_interval: float,
    account_id: str,
    access_key_id: str,
    secret_access_key: str,
    endpoint: str,
) -> tuple[sync_r2_media.UploadItem, bool, str]:
    body = item.path.read_bytes()
    output = ""
    for attempt in range(retries + 1):
        sync_r2_media.throttle_wrangler_request(throttle_file, request_min_interval)
        ok, output = s3_request("PUT", item, body, account_id, access_key_id, secret_access_key, endpoint)
        if ok:
            return item, True, output
        if attempt < retries:
            time.sleep(min(60.0, 4.0 * (attempt + 1)))
    return item, False, output


def s3_delete(
    item: sync_r2_media.UploadItem,
    retries: int,
    throttle_file: Path,
    request_min_interval: float,
    account_id: str,
    access_key_id: str,
    secret_access_key: str,
    endpoint: str,
) -> tuple[sync_r2_media.UploadItem, bool, str]:
    output = ""
    for attempt in range(retries + 1):
        sync_r2_media.throttle_wrangler_request(throttle_file, request_min_interval)
        ok, output = s3_request("DELETE", item, b"", account_id, access_key_id, secret_access_key, endpoint)
        if ok:
            return item, True, output
        if attempt < retries:
            time.sleep(min(60.0, 4.0 * (attempt + 1)))
    return item, False, output


def s3_auth_error(output: str) -> bool:
    return any(pattern in output for pattern in ("HTTP 401", "HTTP 403", "InvalidAccessKeyId", "SignatureDoesNotMatch", "AccessDenied"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Move classified Unknown public R2 keys to their target folders.")
    parser.add_argument("--review-log", type=Path, default=DEFAULT_REVIEW_LOG)
    parser.add_argument("--bucket", default=DEFAULT_BUCKET)
    parser.add_argument("--state-log", type=Path, default=Path(".review-logs/public-r2-unknowns-cleanup-state.jsonl"))
    parser.add_argument("--throttle-file", type=Path, default=DEFAULT_THROTTLE_FILE)
    parser.add_argument("--request-min-interval", type=float, default=float(os.getenv("PBE_R2_REQUEST_MIN_INTERVAL", "3.0")))
    parser.add_argument("--retries", type=int, default=6)
    parser.add_argument("--backend", choices=["wrangler", "s3"], default=os.getenv("PBE_R2_BACKEND", "wrangler"))
    parser.add_argument("--s3-account-id", default=first_env("R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID"))
    parser.add_argument("--s3-access-key-id", default=first_env("R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"))
    parser.add_argument("--s3-secret-access-key", default=first_env("R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"))
    parser.add_argument("--s3-endpoint", default=os.getenv("R2_S3_ENDPOINT", ""))
    parser.add_argument("--s3-probe", action="store_true", help="Upload a small probe object through the S3 backend and exit.")
    parser.add_argument("--s3-probe-file", type=Path, default=Path("VERSION"))
    parser.add_argument("--s3-probe-key", default="test/codex-r2-s3-probe.txt")
    parser.add_argument("--skip-process-check", action="store_true", help="Skip process scan and rely on throttle lock only.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.request_min_interval < 3.0:
        print(f"Refusing to run: request-min-interval must be >= 3.0 (got {args.request_min_interval})", file=sys.stderr)
        return 2

    if not args.review_log.exists():
        print(f"Missing review log: {args.review_log}", file=sys.stderr)
        return 2

    if args.backend == "s3":
        missing = [
            name
            for name, value in (
                ("R2_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID", args.s3_account_id),
                ("R2_ACCESS_KEY_ID or AWS_ACCESS_KEY_ID", args.s3_access_key_id),
                ("R2_SECRET_ACCESS_KEY or AWS_SECRET_ACCESS_KEY", args.s3_secret_access_key),
            )
            if not value
        ]
        if missing and (not args.dry_run or args.s3_probe):
            print(f"Missing S3 backend credential(s): {', '.join(missing)}", file=sys.stderr)
            return 2

    if args.s3_probe:
        if args.backend != "s3":
            print("Use --backend s3 with --s3-probe.", file=sys.stderr)
            return 2
        if not args.s3_probe_file.exists():
            print(f"Missing S3 probe file: {args.s3_probe_file}", file=sys.stderr)
            return 2
        item = upload_item(args.bucket, args.s3_probe_key, args.s3_probe_file)
        _, ok, output = s3_put(
            item,
            args.retries,
            args.throttle_file,
            args.request_min_interval,
            args.s3_account_id,
            args.s3_access_key_id,
            args.s3_secret_access_key,
            args.s3_endpoint,
        )
        print(json.dumps({"ok": ok, "bucket": args.bucket, "key": args.s3_probe_key, "output": output}, indent=2, sort_keys=True))
        return 0 if ok else 1

    if not args.skip_process_check:
        running, matches, note = detect_active_r2_writer_processes()
        if note != "ok":
            print(
                "ERROR: unable to scan for concurrent R2 writers; refusing to run cleanup.\n"
                f"  detail: {note}\n"
                "  override: pass --skip-process-check (NOT recommended) if you have independently confirmed no R2 writer is active.",
                file=sys.stderr,
            )
            return 3
        if running:
            print("Active R2 writer detected; aborting cleanup:", file=sys.stderr)
            for line in matches:
                print(f"  {line}", file=sys.stderr)
            return 3

    held, held_note = throttle_lock_is_held(args.throttle_file)
    if held:
        print(f"Throttle lock indicates an active R2 writer ({held_note}); aborting cleanup.", file=sys.stderr)
        return 3

    payload = load_json(args.review_log)
    moves = payload.get("r2_moves") or []
    if not isinstance(moves, list):
        print("Invalid review log: r2_moves is not a list", file=sys.stderr)
        return 2

    state = load_state(args.state_log)
    moved = 0
    skipped = 0
    failed = 0
    auth_blocked = 0
    missing_local = 0
    already_done = 0

    for index, row in enumerate(moves, start=1):
        from_key = str(row.get("from_key") or "")
        to_key = str(row.get("to_key") or "")
        local_to = Path(str(row.get("local_to") or ""))
        if not from_key or not to_key or not str(local_to):
            failed += 1
            append_state(
                args.state_log,
                {"ts": utc_now_iso(), "ok": False, "stage": "validate", "id": move_id(from_key, to_key), "row": row, "error": "missing-required-fields"},
            )
            continue

        mid = move_id(from_key, to_key)
        prev = state.get(mid) or {}
        if prev.get("stage") == "done" and prev.get("ok"):
            already_done += 1
            continue

        if not local_to.exists():
            missing_local += 1
            failed += 1
            append_state(
                args.state_log,
                {
                    "ts": utc_now_iso(),
                    "ok": False,
                    "stage": "local-missing",
                    "id": mid,
                    "from_key": from_key,
                    "to_key": to_key,
                    "local_to": str(local_to),
                },
            )
            continue

        to_item = upload_item(args.bucket, to_key, local_to)
        from_item = upload_item(args.bucket, from_key, local_to)

        if args.dry_run:
            print(f"[dry-run] {index}/{len(moves)} PUT {args.bucket}/{to_key} (from {local_to}) then DELETE {args.bucket}/{from_key}")
            skipped += 1
            continue

        if prev.get("uploaded_ok"):
            upload_ok = True
            upload_output = "resumed: upload already recorded ok"
        elif args.backend == "s3":
            _, upload_ok, upload_output = s3_put(
                to_item,
                args.retries,
                args.throttle_file,
                args.request_min_interval,
                args.s3_account_id,
                args.s3_access_key_id,
                args.s3_secret_access_key,
                args.s3_endpoint,
            )
            append_state(
                args.state_log,
                {
                    "ts": utc_now_iso(),
                    "ok": upload_ok,
                    "stage": "upload",
                    "backend": args.backend,
                    "id": mid,
                    "from_key": from_key,
                    "to_key": to_key,
                    "local_to": str(local_to),
                    "request_min_interval": args.request_min_interval,
                    "bucket": args.bucket,
                    "put_item": upload_item_payload(to_item),
                    "output": upload_output,
                    "uploaded_ok": upload_ok,
                },
            )
        else:
            _, upload_ok, upload_output = sync_r2_media.wrangler_put(
                to_item,
                args.retries,
                throttle_file=args.throttle_file,
                request_min_interval=args.request_min_interval,
            )
            append_state(
                args.state_log,
                {
                    "ts": utc_now_iso(),
                    "ok": upload_ok,
                    "stage": "upload",
                    "backend": args.backend,
                    "id": mid,
                    "from_key": from_key,
                    "to_key": to_key,
                    "local_to": str(local_to),
                    "request_min_interval": args.request_min_interval,
                    "bucket": args.bucket,
                    "put_item": upload_item_payload(to_item),
                    "output": upload_output,
                    "uploaded_ok": upload_ok,
                },
            )

        if not upload_ok:
            failed += 1
            if sync_r2_media.terminal_auth_error(upload_output) or (args.backend == "s3" and s3_auth_error(upload_output)):
                auth_blocked += 1
            continue

        if args.backend == "s3":
            _, delete_ok, delete_output = s3_delete(
                from_item,
                args.retries,
                args.throttle_file,
                args.request_min_interval,
                args.s3_account_id,
                args.s3_access_key_id,
                args.s3_secret_access_key,
                args.s3_endpoint,
            )
        else:
            _, delete_ok, delete_output = sync_r2_media.wrangler_delete(
                from_item,
                args.retries,
                throttle_file=args.throttle_file,
                request_min_interval=args.request_min_interval,
            )
        append_state(
            args.state_log,
            {
                "ts": utc_now_iso(),
                "ok": delete_ok,
                "stage": "delete",
                "backend": args.backend,
                "id": mid,
                "from_key": from_key,
                "to_key": to_key,
                "local_to": str(local_to),
                "bucket": args.bucket,
                "delete_item": upload_item_payload(from_item),
                "output": delete_output,
                "uploaded_ok": True,
                "deleted_ok": delete_ok,
            },
        )
        if not delete_ok:
            failed += 1
            if sync_r2_media.terminal_auth_error(delete_output) or (args.backend == "s3" and s3_auth_error(delete_output)):
                auth_blocked += 1
            continue

        moved += 1
        append_state(
            args.state_log,
            {"ts": utc_now_iso(), "ok": True, "stage": "done", "id": mid, "from_key": from_key, "to_key": to_key, "local_to": str(local_to)},
        )
        if moved % 10 == 0 or moved == len(moves):
            print(f"progress moved={moved} failed={failed} already_done={already_done}", flush=True)

    print(
        json.dumps(
            {
                "ts": utc_now_iso(),
                "review_log": str(args.review_log),
                "bucket": args.bucket,
                "backend": args.backend,
                "moves_total": len(moves),
                "moved": moved,
                "already_done": already_done,
                "skipped": skipped,
                "failed": failed,
                "missing_local": missing_local,
                "auth_blocked": auth_blocked,
                "state_log": str(args.state_log),
            },
            indent=2,
            sort_keys=True,
        )
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
