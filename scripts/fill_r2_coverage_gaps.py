#!/usr/bin/env python3
"""Fill current R2 coverage gaps one photo at a time."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import mimetypes
from pathlib import Path
import shutil
import sys
import tempfile
from types import SimpleNamespace
from typing import Any
import uuid

SCRIPT_ROOT = Path(__file__).resolve().parent
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from build_lightroom_thumbnails import (  # noqa: E402
    DEFAULT_GALLERY_MAX,
    DEFAULT_DETAIL_MAX,
    DEFAULT_PRIVATE_BUCKET,
    DEFAULT_PRIVATE_PREFIX,
    DEFAULT_PUBLIC_BUCKET,
    DEFAULT_WATERMARK,
    PRIVATE_RENDER_PRODUCTS,
    choose_font,
    derivative_paths,
    emit_import_event,
    emit_import_step,
    image_size,
    long_edge_for_megapixels,
    render_derivative,
    render_private_deliverable,
    render_video_poster,
    render_video_preview,
    r2_put_file,
)
from local_server import _r2_coverage_summary  # noqa: E402
from media_keys import DEFAULT_PUBLIC_PREFIX, private_master_key, private_render_key, public_preview_key  # noqa: E402
from sync_r2_media import first_env  # noqa: E402


MANIFEST_PATH = Path("assets/private-delivery-manifest.json")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--output-root", type=Path, default=Path("tmp/r2-gap-fill"))
    parser.add_argument("--manifest", type=Path, default=MANIFEST_PATH)
    parser.add_argument("--r2-public-bucket", default=DEFAULT_PUBLIC_BUCKET)
    parser.add_argument("--r2-private-bucket", default=DEFAULT_PRIVATE_BUCKET)
    parser.add_argument("--r2-public-prefix", default=DEFAULT_PUBLIC_PREFIX)
    parser.add_argument("--r2-private-prefix", default=DEFAULT_PRIVATE_PREFIX)
    parser.add_argument("--r2-retries", type=int, default=2)
    default_r2_backend = "s3" if (
        first_env("R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID")
        and first_env("R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID")
        and first_env("R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY")
    ) else "wrangler"
    parser.add_argument("--r2-backend", choices=("wrangler", "s3"), default=default_r2_backend)
    parser.add_argument("--r2-s3-account-id", default=first_env("R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID"))
    parser.add_argument("--r2-s3-access-key-id", default=first_env("R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"))
    parser.add_argument("--r2-s3-secret-access-key", default=first_env("R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"))
    parser.add_argument("--r2-s3-endpoint", default="")
    parser.add_argument("--r2-request-min-interval", type=float, default=0.75)
    parser.add_argument("--r2-retry-max-delay", type=float, default=900)
    parser.add_argument("--gallery-max", type=int, default=DEFAULT_GALLERY_MAX)
    parser.add_argument("--detail-max", type=int, default=DEFAULT_DETAIL_MAX)
    parser.add_argument("--watermark", default=DEFAULT_WATERMARK)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def recompute_manifest_counts(manifest: dict[str, Any]) -> None:
    records = manifest.get("records") if isinstance(manifest.get("records"), dict) else {}
    manifest["updatedAt"] = now_iso()
    manifest["catalogPhotos"] = len(records)
    manifest["privateMasterPhotoIds"] = sum(
        1
        for record in records.values()
        if isinstance(record, dict) and record.get("privateMaster", {}).get("present") is True
    )
    manifest["privateRenderTripletPhotoIds"] = sum(
        1
        for record in records.values()
        if isinstance(record, dict)
        and isinstance(record.get("privateRenders"), dict)
        and record.get("privateRenders")
        and all(
            isinstance(record["privateRenders"].get(product_id), dict)
            and record["privateRenders"][product_id].get("present") is True
            for product_id in PRIVATE_RENDER_PRODUCTS
        )
    )


def save_manifest(manifest_path: Path, manifest: dict[str, Any]) -> None:
    recompute_manifest_counts(manifest)
    write_json(manifest_path, manifest)


def step_pending(item: dict[str, Any], step: str) -> bool:
    return item.get("steps", {}).get(step, {}).get("status") == "pending"


def completed_or_total(item: dict[str, Any], step: str, default_total: int) -> tuple[int, int]:
    payload = item.get("steps", {}).get(step, {})
    total = int(payload.get("total") or default_total)
    completed = int(payload.get("completed") or 0)
    return completed, total


def upload_args(args: argparse.Namespace) -> SimpleNamespace:
    return SimpleNamespace(
        r2_backend=args.r2_backend,
        r2_s3_account_id=args.r2_s3_account_id,
        r2_s3_access_key_id=args.r2_s3_access_key_id,
        r2_s3_secret_access_key=args.r2_s3_secret_access_key,
        r2_s3_endpoint=args.r2_s3_endpoint,
        r2_request_min_interval=args.r2_request_min_interval,
        r2_retry_max_delay=args.r2_retry_max_delay,
        r2_force_upload=True,
    )


def upload_file(
    args: argparse.Namespace,
    bucket: str,
    key: str,
    path: Path,
    content_type: str,
    cache_control: str = "",
) -> dict[str, Any]:
    upload = upload_args(args)
    return r2_put_file(upload, bucket, key, path, content_type, args.r2_retries, cache_control or None)


def fill_one_photo(args: argparse.Namespace, manifest: dict[str, Any], item: dict[str, Any], font: str) -> bool:
    photo_id = str(item.get("photoId") or "")
    source_file = Path(str(item.get("sourceFile") or ""))
    relative_path = str(item.get("relativePath") or "")
    collection_key = str(item.get("collectionKey") or "unknown")
    media_type = str(item.get("mediaType") or "photo")
    record = manifest.get("records", {}).get(photo_id)
    if not photo_id or not isinstance(record, dict):
        return False

    row = {
        "id": photo_id,
        "relative_path": relative_path,
        "media_type": media_type,
    }
    emit_import_event(
        "PHOTO",
        index=int(item.get("index") or 0),
        photoId=photo_id,
        relativePath=relative_path,
        country=collection_key,
        mediaType=media_type,
    )
    if not source_file.is_file():
        emit_import_event("PHOTO_DONE", photoId=photo_id, relativePath=relative_path, status="error", error="source file not found")
        return False

    if step_pending(item, "master_uploaded"):
        master_key = private_master_key(args.r2_private_prefix, photo_id, source_file)
        upload_file(
            args,
            args.r2_private_bucket,
            master_key,
            source_file,
            mimetypes.guess_type(source_file.name)[0] or "application/octet-stream",
        )
        record.setdefault("privateMaster", {})["present"] = True
        record["privateMaster"]["key"] = master_key
        emit_import_step(row, "master_uploaded", total=1, completed=1)
    else:
        completed, total = completed_or_total(item, "master_uploaded", 1)
        emit_import_step(row, "master_uploaded", total=total, completed=completed)

    if step_pending(item, "triplets_created") or step_pending(item, "triplets_uploaded"):
        if source_file.suffix.lower() not in {".jpg", ".jpeg"}:
            emit_import_step(row, "triplets_created", status="skipped", reason="not a JPEG source")
            emit_import_step(row, "triplets_uploaded", status="skipped", reason="not a JPEG source")
        else:
            source_size = image_size(source_file)
            render_root = Path(tempfile.mkdtemp(prefix="pbe-gap-renders-"))
            rendered = 0
            uploaded = 0
            try:
                for product_id, megapixels in PRIVATE_RENDER_PRODUCTS.items():
                    render_record = record.setdefault("privateRenders", {}).setdefault(product_id, {})
                    if render_record.get("present") is True:
                        rendered += 1
                        uploaded += 1
                        continue
                    long_edge = long_edge_for_megapixels(source_size, megapixels)
                    if not long_edge:
                        continue
                    output_path = render_root / f"{product_id}.jpg"
                    render_private_deliverable(source_file, output_path, long_edge, args.force)
                    rendered += 1
                    emit_import_step(row, "triplets_created", total=len(PRIVATE_RENDER_PRODUCTS), completed=rendered)
                    render_key = private_render_key(photo_id, product_id)
                    upload_file(args, args.r2_private_bucket, render_key, output_path, "image/jpeg")
                    uploaded += 1
                    render_record["present"] = True
                    render_record["key"] = render_key
                    emit_import_step(row, "triplets_uploaded", total=len(PRIVATE_RENDER_PRODUCTS), completed=uploaded)
            finally:
                shutil.rmtree(render_root, ignore_errors=True)
            emit_import_step(row, "triplets_created", total=len(PRIVATE_RENDER_PRODUCTS), completed=rendered)
            emit_import_step(row, "triplets_uploaded", total=len(PRIVATE_RENDER_PRODUCTS), completed=uploaded)
    else:
        completed, total = completed_or_total(item, "triplets_created", 3)
        emit_import_step(row, "triplets_created", total=total, completed=completed)
        completed, total = completed_or_total(item, "triplets_uploaded", 3)
        emit_import_step(row, "triplets_uploaded", total=total, completed=completed)

    if step_pending(item, "previews_created") or step_pending(item, "previews_uploaded"):
        gallery_path, detail_path = derivative_paths(args.output_root, collection_key, photo_id, media_type)
        if media_type == "video":
            render_video_poster(source_file, gallery_path, args.watermark, font, args.force)
            render_video_preview(source_file, detail_path, args.watermark, font, args.force)
        else:
            render_derivative(source_file, gallery_path, args.gallery_max, args.watermark, font, args.force)
            render_derivative(source_file, detail_path, args.detail_max, args.watermark, font, args.force)
        emit_import_step(row, "previews_created", total=2, completed=2)
        gallery_key = public_preview_key(args.r2_public_prefix, photo_id, "gallery")
        detail_key = public_preview_key(args.r2_public_prefix, photo_id, "detail", media_type)
        upload_file(args, args.r2_public_bucket, gallery_key, gallery_path, "image/jpeg", "public, max-age=31536000, immutable")
        emit_import_step(row, "previews_uploaded", total=2, completed=1)
        detail_content_type = "video/mp4" if media_type == "video" else "image/jpeg"
        upload_file(args, args.r2_public_bucket, detail_key, detail_path, detail_content_type, "public, max-age=31536000, immutable")
        record.setdefault("publicPreviews", {})["present"] = True
        emit_import_step(row, "previews_uploaded", total=2, completed=2)
    else:
        completed, total = completed_or_total(item, "previews_created", 2)
        emit_import_step(row, "previews_created", total=total, completed=completed)
        completed, total = completed_or_total(item, "previews_uploaded", 2)
        emit_import_step(row, "previews_uploaded", total=total, completed=completed)

    emit_import_event("PHOTO_DONE", photoId=photo_id, relativePath=relative_path, status="done")
    return True


def main() -> int:
    args = parse_args()
    args.output_root.mkdir(parents=True, exist_ok=True)
    print("SWEEP_PHASE gap-fill Fill in gaps", flush=True)
    emit_import_event("SCAN_PROGRESS", seen=0, inspected=0, queued=0, processed=0, active=0, queueDepth=0)
    for tool in ("sips", "ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            raise SystemExit(f"Missing required tool: {tool}")
    font = choose_font()
    repo_root = Path.cwd()
    coverage = _r2_coverage_summary(repo_root, private_missing_limit=0, import_missing_limit=0)
    items = list(coverage.get("missingImportPhotos") or [])
    if args.limit:
        items = items[:args.limit]
    emit_import_event("PLAN", total=len(items))
    manifest_path = args.manifest if args.manifest.is_absolute() else repo_root / args.manifest
    manifest = read_json(manifest_path, {})
    completed = 0
    failed = 0
    for index, item in enumerate(items, start=1):
        item["index"] = index
        try:
            if fill_one_photo(args, manifest, item, font):
                completed += 1
                save_manifest(manifest_path, manifest)
            else:
                failed += 1
        except Exception as error:  # noqa: BLE001 - keep going and surface per-photo failures.
            failed += 1
            emit_import_event(
                "PHOTO_DONE",
                photoId=str(item.get("photoId") or ""),
                relativePath=str(item.get("relativePath") or ""),
                status="error",
                error=str(error),
            )
            print(f"ERROR {item.get('photoId') or item.get('relativePath')}: {error}", file=sys.stderr, flush=True)
    save_manifest(manifest_path, manifest)
    print("SWEEP_DONE gap-fill", flush=True)
    emit_import_event("DONE", completed=completed, failed=failed, total=len(items))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
