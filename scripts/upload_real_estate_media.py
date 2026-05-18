#!/usr/bin/env python3
"""Upload Real Estate masters and unwatermarked public previews to R2."""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
from pathlib import Path
from typing import Any

from sync_r2_media import (
    DEFAULT_PRIVATE_BUCKET,
    DEFAULT_PUBLIC_BUCKET,
    DEFAULT_THROTTLE_FILE,
    UploadItem,
    load_upload_state,
    upload,
    upload_id,
)
from owner_state_db import connect as owner_db_connect, upsert_r2_object_state


DEFAULT_MANIFEST = Path("tmp/real-estate-import/corine/manifest.json")
DEFAULT_STATE_FILE = Path(".review-logs/real-estate-r2-upload-state.jsonl")


def first_env(*names: str) -> str:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return ""


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def emit_import_event(enabled: bool, kind: str, **payload: Any) -> None:
    if enabled:
        print(f"PBE_IMPORT_{kind} {json.dumps(payload, sort_keys=True)}", flush=True)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def record_r2_object_current(root: Path, item: UploadItem, source: str) -> None:
    conn = owner_db_connect(root)
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


def record_current_items(root: Path, items: list[UploadItem], uploaded_ids: set[str], source: str) -> None:
    for item in items:
        if upload_id(item) in uploaded_ids:
            record_r2_object_current(root, item, source)


def resolve_output_path(root: Path, output_root: Path, value: str) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return root / output_root / path


def item_for(
    *,
    bucket: str,
    key: str,
    path: Path,
    public: bool,
) -> UploadItem:
    return UploadItem(
        bucket=bucket,
        key=key,
        path=path,
        content_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream",
        cache_control="public, max-age=31536000, immutable" if public else "",
    )


def build_photo_upload_groups(root: Path, manifest: dict[str, Any], scope: str, public_bucket: str, private_bucket: str) -> tuple[list[dict[str, Any]], list[str]]:
    output_root = Path(str(manifest.get("outputRoot") or ""))
    photos = [photo for photo in manifest.get("photos", []) if isinstance(photo, dict)]
    groups: list[dict[str, Any]] = []
    errors: list[str] = []
    seen: set[str] = set()

    def add_group_item(group: dict[str, Any], step: str, item: UploadItem) -> None:
        identifier = upload_id(item)
        if identifier in seen:
            return
        seen.add(identifier)
        group[step].append(item)

    for photo in photos:
        photo_id = str(photo.get("id") or "")
        real_estate = photo.get("realEstate") if isinstance(photo.get("realEstate"), dict) else {}
        public_preview = ((photo.get("media") or {}).get("publicPreview") or {}) if isinstance(photo.get("media"), dict) else {}
        group = {
            "photoId": photo_id,
            "relativePath": "/".join(part for part in [str(photo.get("album") or ""), str(photo.get("full") or "")] if part),
            "mediaType": str((photo.get("media") or {}).get("type") or "photo") if isinstance(photo.get("media"), dict) else "photo",
            "master": [],
            "previews": [],
        }

        if scope in {"private", "both"}:
            source_path = Path(str(real_estate.get("sourcePath") or ""))
            private_key = str(real_estate.get("privateMasterKey") or "")
            if not source_path.exists():
                errors.append(f"{photo_id}: missing private master source {source_path}")
            elif not private_key:
                errors.append(f"{photo_id}: missing private master key")
            else:
                add_group_item(group, "master", item_for(bucket=private_bucket, key=private_key, path=source_path, public=False))

        if scope in {"public", "both"}:
            for size, src_field, key_field in (
                ("900", "gallerySrc", "galleryKey"),
                ("1800", "imageSrc", "detailKey"),
            ):
                path = resolve_output_path(root, output_root, str(photo.get(src_field) or ""))
                key = str(public_preview.get(key_field) or "")
                if not path.exists():
                    errors.append(f"{photo_id}: missing public preview {size} at {path}")
                elif not key:
                    errors.append(f"{photo_id}: missing public preview {size} key")
                else:
                    add_group_item(group, "previews", item_for(bucket=public_bucket, key=key, path=path, public=True))

        if group["master"] or group["previews"]:
            groups.append(group)

    return groups, errors


def build_items(root: Path, manifest: dict[str, Any], scope: str, public_bucket: str, private_bucket: str) -> tuple[list[UploadItem], list[str]]:
    groups, errors = build_photo_upload_groups(root, manifest, scope, public_bucket, private_bucket)
    return [item for group in groups for item in [*group["master"], *group["previews"]]], errors


def limited_groups(groups: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    if not limit:
        return groups
    remaining = limit
    limited: list[dict[str, Any]] = []
    for group in groups:
        if remaining <= 0:
            break
        row = {**group, "master": [], "previews": []}
        for step in ("master", "previews"):
            selected = group[step][:remaining]
            row[step] = selected
            remaining -= len(selected)
            if remaining <= 0:
                break
        if row["master"] or row["previews"]:
            limited.append(row)
    return limited


def group_items(group: dict[str, Any]) -> list[UploadItem]:
    return [*group["master"], *group["previews"]]


def summarize(items: list[UploadItem]) -> dict[str, Any]:
    by_bucket: dict[str, dict[str, int]] = {}
    for item in items:
        row = by_bucket.setdefault(item.bucket, {"files": 0, "bytes": 0})
        row["files"] += 1
        row["bytes"] += item.path.stat().st_size
    return {
        "items": len(items),
        "byBucket": by_bucket,
        "sample": [
            {"bucket": item.bucket, "key": item.key, "path": str(item.path)}
            for item in items[:8]
        ],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Upload Real Estate masters and public previews to R2.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--scope", choices=("public", "private", "both"), default="both")
    parser.add_argument("--public-bucket", default=DEFAULT_PUBLIC_BUCKET)
    parser.add_argument("--private-bucket", default=DEFAULT_PRIVATE_BUCKET)
    parser.add_argument("--state-file", type=Path, default=DEFAULT_STATE_FILE)
    parser.add_argument("--backend", choices=("wrangler", "s3"), default=os.environ.get("PBE_R2_BACKEND", "wrangler"))
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--retries", type=int, default=8)
    parser.add_argument("--request-min-interval", type=float, default=float(os.environ.get("PBE_R2_REQUEST_MIN_INTERVAL", "0.25")))
    parser.add_argument("--retry-max-delay", type=float, default=float(os.environ.get("PBE_R2_RETRY_MAX_DELAY", "900")))
    parser.add_argument("--throttle-file", type=Path, default=DEFAULT_THROTTLE_FILE)
    parser.add_argument("--s3-account-id", default=first_env("R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID"))
    parser.add_argument("--s3-access-key-id", default=first_env("R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"))
    parser.add_argument("--s3-secret-access-key", default=first_env("R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"))
    parser.add_argument("--s3-endpoint", default=os.environ.get("R2_S3_ENDPOINT", ""))
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--no-resume", action="store_true")
    parser.add_argument("--upload", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--progress-json", action="store_true", help="Emit PBE_IMPORT_* progress events for the Owner import matrix.")
    return parser.parse_args()


def emit_photo(enabled: bool, index: int, group: dict[str, Any], status: str) -> None:
    emit_import_event(
        enabled,
        "PHOTO",
        index=index,
        photoId=str(group.get("photoId") or ""),
        relativePath=str(group.get("relativePath") or ""),
        mediaType=str(group.get("mediaType") or "photo"),
        status=status,
    )


def emit_step(enabled: bool, group: dict[str, Any], step: str, total: int = 0, completed: int = 0, status: str = "done", reason: str = "") -> None:
    payload = {
        "photoId": str(group.get("photoId") or ""),
        "relativePath": str(group.get("relativePath") or ""),
        "mediaType": str(group.get("mediaType") or "photo"),
        "step": step,
        "status": status,
    }
    if total:
        payload["total"] = total
        payload["completed"] = completed
    if reason:
        payload["reason"] = reason
    emit_import_event(enabled, "STEP", **payload)


def upload_grouped(args: argparse.Namespace, root: Path, groups: list[dict[str, Any]], resumed_count: int) -> int:
    uploaded_ids = load_upload_state(args.state_file) if not args.no_resume else set()
    total_photos = len(groups)
    processed_photos = 0
    emit_import_event(args.progress_json, "QUEUE_START", seen=total_photos, inspected=total_photos, queued=total_photos, alreadySelected=resumed_count, processed=0, active=0, queueDepth=total_photos)
    for index, group in enumerate(groups, start=1):
        emit_photo(args.progress_json, index, group, "queued")
    emit_import_event(args.progress_json, "SCAN_DONE", seen=total_photos, inspected=total_photos, queued=total_photos, alreadySelected=resumed_count, processed=0, active=0, queueDepth=total_photos)

    failed = 0
    for index, group in enumerate(groups, start=1):
        emit_import_event(args.progress_json, "QUEUE_PROGRESS", seen=total_photos, inspected=total_photos, queued=total_photos, alreadySelected=resumed_count, processed=processed_photos, active=1, queueDepth=max(0, total_photos - processed_photos - 1))
        emit_photo(args.progress_json, index, group, "running")

        master_items = [item for item in group["master"] if args.no_resume or upload_id(item) not in uploaded_ids]
        if master_items:
            failed += upload(
                master_items,
                1,
                args.retries,
                args.state_file,
                args.throttle_file,
                args.request_min_interval,
                args.retry_max_delay,
                args.backend,
                args.s3_account_id,
                args.s3_access_key_id,
                args.s3_secret_access_key,
                args.s3_endpoint,
                clean_uploaded_tmp=False,
            )
            uploaded_ids = load_upload_state(args.state_file)
        record_current_items(root, group["master"], uploaded_ids, "upload_real_estate_media")
        emit_step(args.progress_json, group, "master_uploaded", total=max(1, len(group["master"])), completed=sum(1 for item in group["master"] if upload_id(item) in uploaded_ids))
        emit_step(args.progress_json, group, "triplets_created", status="skipped", reason="Real Estate lane does not create private JPG triplets")
        emit_step(args.progress_json, group, "triplets_uploaded", status="skipped", reason="Real Estate lane does not upload private JPG triplets")
        emit_step(args.progress_json, group, "previews_created", total=max(1, len(group["previews"])), completed=len(group["previews"]))

        preview_items = [item for item in group["previews"] if args.no_resume or upload_id(item) not in uploaded_ids]
        if preview_items:
            failed += upload(
                preview_items,
                args.workers,
                args.retries,
                args.state_file,
                args.throttle_file,
                args.request_min_interval,
                args.retry_max_delay,
                args.backend,
                args.s3_account_id,
                args.s3_access_key_id,
                args.s3_secret_access_key,
                args.s3_endpoint,
                clean_uploaded_tmp=False,
            )
            uploaded_ids = load_upload_state(args.state_file)
        record_current_items(root, group["previews"], uploaded_ids, "upload_real_estate_media")
        emit_step(args.progress_json, group, "previews_uploaded", total=max(1, len(group["previews"])), completed=sum(1 for item in group["previews"] if upload_id(item) in uploaded_ids))
        processed_photos += 1
        emit_import_event(args.progress_json, "QUEUE_PROGRESS", seen=total_photos, inspected=total_photos, queued=total_photos, alreadySelected=resumed_count, processed=processed_photos, active=0, queueDepth=max(0, total_photos - processed_photos))
        emit_import_event(args.progress_json, "PHOTO_DONE", photoId=str(group.get("photoId") or ""), status="done" if failed == 0 else "error")
        if failed:
            break
    return failed


def main() -> int:
    args = parse_args()
    root = repo_root()
    manifest_path = args.manifest if args.manifest.is_absolute() else root / args.manifest
    manifest = load_json(manifest_path)
    public_bucket = str((manifest.get("r2") or {}).get("publicBucket") or args.public_bucket)
    private_bucket = str((manifest.get("r2") or {}).get("privateBucket") or args.private_bucket)
    groups, errors = build_photo_upload_groups(root, manifest, args.scope, public_bucket, private_bucket)

    if errors:
        for error in errors[:25]:
            print(error)
        if len(errors) > 25:
            print(f"... and {len(errors) - 25} more inventory errors")
        return 1

    groups = limited_groups(groups, args.limit)
    items = [item for group in groups for item in group_items(group)]

    resumed_count = 0
    if args.upload and not args.no_resume:
        uploaded_ids = load_upload_state(args.state_file)
        before = len(items)
        resumed_count = sum(1 for item in items if upload_id(item) in uploaded_ids)
        if not args.progress_json:
            items = [item for item in items if upload_id(item) not in uploaded_ids]
        else:
            record_current_items(root, items, uploaded_ids, "upload_real_estate_media-resume")
        if resumed_count != before - len(items) and not args.progress_json:
            resumed_count = before - len(items)

    summary = summarize(items)
    if args.json:
        print(json.dumps({**summary, "alreadyUploaded": resumed_count}, indent=2, sort_keys=True))
    else:
        action = "Upload" if args.upload else "Upload dry run"
        print(f"{action}: {summary['items']} files")
        for bucket, row in summary["byBucket"].items():
            print(f"- {bucket}: {row['files']} files, {row['bytes']} bytes")
        if resumed_count:
            print(f"Already uploaded in local state: {resumed_count}")
        if not args.upload:
            print("Dry run only. Add --upload to write to R2.")

    if not args.upload:
        return 0

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
        if missing:
            print(f"Missing S3 backend credential(s): {', '.join(missing)}")
            return 2

    if args.progress_json:
        return 1 if upload_grouped(args, root, groups, resumed_count) else 0

    return 1 if upload(
        items,
        args.workers,
        args.retries,
        args.state_file,
        args.throttle_file,
        args.request_min_interval,
        args.retry_max_delay,
        args.backend,
        args.s3_account_id,
        args.s3_access_key_id,
        args.s3_secret_access_key,
        args.s3_endpoint,
        clean_uploaded_tmp=False,
    ) else 0


if __name__ == "__main__":
    raise SystemExit(main())
