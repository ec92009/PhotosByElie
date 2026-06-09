#!/usr/bin/env python3
"""Re-render wide public still previews by target height and optionally upload them."""

from __future__ import annotations

import argparse
import mimetypes
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from build_lightroom_thumbnails import DEFAULT_WATERMARK, image_size, render_derivative
from sync_r2_media import (
    DEFAULT_PUBLIC_BUCKET,
    DEFAULT_THROTTLE_FILE,
    UploadItem,
    first_env,
    upload,
)


DEFAULT_DB = Path("assets/catalog/photosbyelie.sqlite")
DEFAULT_OUTPUT_ROOT = Path("tmp/pano-public-preview-reprocess")
DEFAULT_SOURCE_ROOTS = [
    Path("/Volumes/Saturn/Pictures/LR/Camera"),
    Path("/Volumes/Saturn-1/Pictures/LR/Camera"),
    Path("/Volumes/Saturn/Pictures/LR/_All Leonardo"),
    Path("/Volumes/Saturn-1/Pictures/LR/_All Leonardo"),
    Path("/Volumes/Saturn/Pictures/LR/Apple Photo Albums"),
    Path("/Volumes/Saturn/Pictures/LR/Apple Photo Albums/2023"),
    Path("/Volumes/Saturn-1/Pictures/LR/Apple Photo Albums"),
    Path("/Volumes/Saturn-1/Pictures/LR/Apple Photo Albums/2023"),
    Path.home() / "Pictures/LR/Camera",
    Path.home() / "Pictures/LR/_All Leonardo",
    Path.home() / "Pictures/LR/Apple Photo Albums",
    Path.home() / "Pictures/LR/Apple Photo Albums/2023",
]
DEFAULT_FONT_CANDIDATES = [
    Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
    Path("/System/Library/Fonts/Helvetica.ttc"),
    Path("/Library/Fonts/Arial.ttf"),
]


@dataclass(frozen=True)
class PanoPreviewRow:
    media_id: str
    collection: str
    title: str
    full_width: int
    full_height: int
    source_folder: str
    filename: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--source-root", action="append", type=Path, default=[])
    parser.add_argument("--ratio-threshold", type=float, default=2.0)
    parser.add_argument("--watermark", default=DEFAULT_WATERMARK)
    parser.add_argument("--font", type=Path, default=None)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--upload", action="store_true")
    parser.add_argument("--update-catalog", action="store_true")
    parser.add_argument("--public-bucket", default=DEFAULT_PUBLIC_BUCKET)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--backend", choices=("wrangler", "s3"), default="s3")
    parser.add_argument("--state-file", type=Path, default=Path(".review-logs/pano-public-preview-upload-state.jsonl"))
    parser.add_argument("--throttle-file", type=Path, default=DEFAULT_THROTTLE_FILE)
    parser.add_argument("--request-min-interval", type=float, default=0.25)
    parser.add_argument("--retry-max-delay", type=float, default=60.0)
    parser.add_argument("--s3-account-id", default=first_env("R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID"))
    parser.add_argument("--s3-access-key-id", default=first_env("R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"))
    parser.add_argument("--s3-secret-access-key", default=first_env("R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"))
    parser.add_argument("--s3-endpoint", default="")
    parser.add_argument("--limit", type=int, default=0)
    return parser.parse_args()


def choose_font(configured: Path | None) -> Path:
    if configured:
        if configured.exists():
            return configured
        raise FileNotFoundError(configured)
    for candidate in DEFAULT_FONT_CANDIDATES:
        if candidate.exists():
            return candidate
    raise FileNotFoundError("No default watermark font found")


def load_rows(db_path: Path, ratio_threshold: float) -> list[PanoPreviewRow]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        WITH full AS (
          SELECT media_id, width, height, width * 1.0 / height AS ratio
          FROM media_assets
          WHERE asset_type_id = (SELECT asset_type_id FROM asset_types WHERE code = 'full')
        )
        SELECT c.slug AS collection, mi.media_id, mi.title, full.width AS full_width, full.height AS full_height,
               sf.source_folder, sfile.filename
        FROM media_items mi
        JOIN media_types mt ON mt.media_type_id = mi.media_type_id
        JOIN collections c ON c.collection_id = mi.collection_id
        JOIN source_files sfile ON sfile.source_file_id = mi.source_file_id
        JOIN source_folders sf ON sf.source_folder_id = sfile.source_folder_id
        JOIN full ON full.media_id = mi.media_id
        WHERE mt.code = 'photo' AND full.ratio > ?
        ORDER BY c.slug, mi.media_id
        """,
        (ratio_threshold,),
    ).fetchall()
    conn.close()
    return [
        PanoPreviewRow(
            media_id=str(row["media_id"]),
            collection=str(row["collection"]),
            title=str(row["title"]),
            full_width=int(row["full_width"]),
            full_height=int(row["full_height"]),
            source_folder=str(row["source_folder"] or ""),
            filename=str(row["filename"] or ""),
        )
        for row in rows
    ]


def source_roots(args: argparse.Namespace) -> list[Path]:
    roots = [*(args.source_root or []), *DEFAULT_SOURCE_ROOTS]
    unique: list[Path] = []
    seen: set[Path] = set()
    for root in roots:
        expanded = root.expanduser()
        if not expanded.exists():
            continue
        resolved = expanded.resolve()
        if resolved in seen:
            continue
        unique.append(resolved)
        seen.add(resolved)
    return unique


def catalog_relative_path(row: PanoPreviewRow) -> Path:
    filename = row.filename.lstrip("/")
    if Path(filename).is_absolute():
        return Path(filename)
    folder = row.source_folder.strip("/")
    return Path(folder) / filename if folder else Path(filename)


def resolve_source(row: PanoPreviewRow, roots: list[Path]) -> Path | None:
    relative = catalog_relative_path(row)
    if relative.is_absolute() and relative.exists():
        return relative.resolve()
    for root in roots:
        candidate = root / relative
        if candidate.exists():
            return candidate.resolve()
    filename = Path(row.filename).name
    for root in roots:
        if "Apple Photo Albums" not in str(root):
            continue
        matches = list(root.rglob(filename))
        if matches:
            return matches[0].resolve()
    return None


def target_dimensions(width: int, height: int, target_height: int) -> tuple[int, int]:
    actual_height = min(target_height, height)
    return max(1, round(width * actual_height / height)), actual_height


def update_catalog_dimensions(db_path: Path, rows: list[PanoPreviewRow]) -> None:
    conn = sqlite3.connect(db_path)
    try:
        asset_ids = dict(conn.execute("SELECT code, asset_type_id FROM asset_types"))
        updates: list[tuple[int, int, str, int]] = []
        for row in rows:
            for code, target in (("still_900", 900), ("still_1800", 1800)):
                width, height = target_dimensions(row.full_width, row.full_height, target)
                updates.append((width, height, row.media_id, int(asset_ids[code])))
        conn.executemany(
            """
            UPDATE media_assets
            SET width = ?, height = ?
            WHERE media_id = ? AND asset_type_id = ?
            """,
            updates,
        )
        conn.commit()
    finally:
        conn.close()


def render_rows(args: argparse.Namespace, rows: list[PanoPreviewRow], roots: list[Path], font: Path) -> tuple[list[UploadItem], list[dict[str, Any]]]:
    items: list[UploadItem] = []
    failures: list[dict[str, Any]] = []
    for index, row in enumerate(rows, start=1):
        source = resolve_source(row, roots)
        if not source:
            failures.append({"id": row.media_id, "reason": "missing-source", "path": str(catalog_relative_path(row))})
            continue
        for suffix, target in (("900", 900), ("1800", 1800)):
            output = args.output_root / "expo" / f"{row.media_id}_{suffix}.jpg"
            render_derivative(source, output, target, args.watermark, str(font), args.force, None)
            facts = image_size(output)
            expected_width, expected_height = target_dimensions(row.full_width, row.full_height, target)
            if int(facts.get("height") or 0) != expected_height:
                failures.append({
                    "id": row.media_id,
                    "reason": "unexpected-render-size",
                    "target": suffix,
                    "expected": f"{expected_width}x{expected_height}",
                    "actual": f"{facts.get('width')}x{facts.get('height')}",
                })
                continue
            items.append(UploadItem(
                bucket=args.public_bucket,
                key=f"expo/{row.media_id}_{suffix}.jpg",
                path=output,
                content_type=mimetypes.guess_type(output.name)[0] or "image/jpeg",
                cache_control="public, max-age=31536000, immutable",
            ))
        if index % 25 == 0 or index == len(rows):
            print(f"Rendered {index} / {len(rows)} pano preview rows")
    return items, failures


def main() -> int:
    args = parse_args()
    rows = load_rows(args.db, args.ratio_threshold)
    if args.limit:
        rows = rows[:args.limit]
    roots = source_roots(args)
    font = choose_font(args.font)
    print(f"Found {len(rows)} still photos wider than {args.ratio_threshold}:1")
    print(f"Using {len(roots)} source roots")
    items, failures = render_rows(args, rows, roots, font)
    if failures:
        for failure in failures[:20]:
            print(f"FAILED {failure}", flush=True)
        print(f"{len(failures)} render/source failures")
        return 1
    print(f"Prepared {len(items)} public preview uploads")
    if args.upload:
        if args.backend == "s3" and not (args.s3_account_id and args.s3_access_key_id and args.s3_secret_access_key):
            raise RuntimeError("S3 backend selected but R2 S3 credentials are incomplete")
        failed = upload(
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
        )
        if failed:
            return 1
    if args.upload or args.update_catalog:
        update_catalog_dimensions(args.db, rows)
        print(f"Updated catalog dimensions for {len(rows)} pano preview rows")
    else:
        print("Dry run complete; catalog dimensions were not updated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
