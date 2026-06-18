#!/usr/bin/env python3
"""Populate per-media caption colors in the public catalog SQLite database."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
import os
import sqlite3
from pathlib import Path
from typing import Iterable
from urllib.request import Request, urlopen

from PIL import Image, ImageOps


DEFAULT_CATALOG = Path("assets/catalog/photosbyelie.sqlite")
PUBLIC_MEDIA_BASE_URL = "https://download.photos-by-elie.com/media/"
DEFAULT_SOURCE_ROOTS = (
    Path("/Volumes/Saturn/Pictures/LR/Camera"),
    Path("/Volumes/Saturn/Pictures/LR/Apple Photo Albums"),
    Path("/Volumes/Saturn/Pictures/LR/_All Leonardo"),
    Path("/Volumes/Saturn/Pictures/LR"),
    Path("/Volumes/Saturn/Pictures"),
)


def source_roots() -> list[Path]:
    configured = [
        Path(item).expanduser()
        for item in os.environ.get("PBE_CAPTION_COLOR_SOURCE_ROOTS", "").split(os.pathsep)
        if item.strip()
    ]
    return configured + [root for root in DEFAULT_SOURCE_ROOTS if root.exists()]


def ensure_caption_color_column(conn: sqlite3.Connection) -> None:
    columns = {row[1] for row in conn.execute("PRAGMA table_info(media_items)")}
    if "caption_color" not in columns:
        conn.execute(
            "ALTER TABLE media_items ADD COLUMN caption_color TEXT CHECK (caption_color IS NULL OR caption_color GLOB '[0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]')"
        )


def candidate_paths(source_folder: str, filename: str, roots: Iterable[Path]) -> Iterable[Path]:
    relative = Path(source_folder or "") / filename
    if relative.is_absolute():
        yield relative
        return
    for root in roots:
        yield root / relative


def preview_url(media_id: str) -> str:
    return f"{PUBLIC_MEDIA_BASE_URL}/expo/{media_id}_900.jpg"


def caption_color_from_image(image: Image.Image, band_ratio: float = 0.22) -> str | None:
    image = ImageOps.exif_transpose(image).convert("RGB")
    width, height = image.size
    if width < 1 or height < 1:
        return None
    band_height = max(1, round(height * band_ratio))
    band = image.crop((0, height - band_height, width, height))
    band.thumbnail((72, 36))
    pixels = list(band.getdata())
    filtered = [
        (red, green, blue)
        for red, green, blue in pixels
        if max(red, green, blue) <= 246 and min(red, green, blue) >= 8
    ]
    if not filtered:
        filtered = pixels
    if not filtered:
        return None
    red = round(sum(pixel[0] for pixel in filtered) / len(filtered))
    green = round(sum(pixel[1] for pixel in filtered) / len(filtered))
    blue = round(sum(pixel[2] for pixel in filtered) / len(filtered))
    return f"{red:02X}{green:02X}{blue:02X}"


def caption_color(path: Path, band_ratio: float = 0.22) -> str | None:
    try:
        with Image.open(path) as image:
            return caption_color_from_image(image, band_ratio=band_ratio)
    except Exception:
        return None


def caption_color_from_url(url: str, band_ratio: float = 0.22) -> str | None:
    try:
        request = Request(url, headers={"User-Agent": "PhotosByElieCaptionColor/1.0"})
        with urlopen(request, timeout=20) as response:
            body = response.read()
        with Image.open(BytesIO(body)) as image:
            return caption_color_from_image(image, band_ratio=band_ratio)
    except Exception:
        return None


def caption_color_for_row(row: sqlite3.Row, roots: list[Path], *, prefer_previews: bool, previews_only: bool) -> tuple[str, str | None]:
    media_id = str(row["media_id"] or "")
    color = caption_color_from_url(preview_url(media_id)) if prefer_previews else None
    if not previews_only:
        for path in candidate_paths(str(row["source_folder"] or ""), str(row["filename"] or ""), roots):
            if not color and path.exists():
                color = caption_color(path)
                break
    return media_id, color


def update_caption_colors(
    catalog_path: Path,
    *,
    missing_only: bool = False,
    limit: int = 0,
    prefer_previews: bool = True,
    previews_only: bool = False,
    workers: int = 12,
) -> dict[str, int]:
    roots = source_roots()
    conn = sqlite3.connect(catalog_path)
    conn.row_factory = sqlite3.Row
    try:
        ensure_caption_color_column(conn)
        where = "WHERE mt.code = 'photo'"
        if missing_only:
            where += " AND (m.caption_color IS NULL OR m.caption_color = '')"
        rows = conn.execute(
            f"""
            SELECT m.media_id, sf.filename, sfo.source_folder
            FROM media_items AS m
            JOIN media_types AS mt ON mt.media_type_id = m.media_type_id
            JOIN source_files AS sf ON sf.source_file_id = m.source_file_id
            JOIN source_folders AS sfo ON sfo.source_folder_id = sf.source_folder_id
            {where}
            ORDER BY m.media_id
            """
        ).fetchall()
        if limit > 0:
            rows = rows[:limit]

        updated = 0
        missing = 0
        skipped = 0
        with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
            futures = [
                executor.submit(
                    caption_color_for_row,
                    row,
                    roots,
                    prefer_previews=prefer_previews,
                    previews_only=previews_only,
                )
                for row in rows
            ]
            for future in as_completed(futures):
                media_id, color = future.result()
                if color:
                    conn.execute(
                        "UPDATE media_items SET caption_color = ? WHERE media_id = ?",
                        (color, media_id),
                    )
                    updated += 1
                else:
                    missing += 1
                if updated and updated % 250 == 0:
                    conn.commit()
        conn.commit()
        skipped = len(rows) - updated - missing
        return {"updated": updated, "missing": missing, "skipped": skipped, "total": len(rows)}
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    parser.add_argument("--missing-only", action="store_true")
    parser.add_argument("--prefer-originals", action="store_true", help="Skip public previews and sample source files first.")
    parser.add_argument("--previews-only", action="store_true", help="Do not fall back to local source files when a preview is missing.")
    parser.add_argument("--workers", type=int, default=12, help="Number of parallel preview/source samplers.")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    result = update_caption_colors(
        args.catalog,
        missing_only=args.missing_only,
        limit=args.limit,
        prefer_previews=not args.prefer_originals,
        previews_only=args.previews_only,
        workers=args.workers,
    )
    print(
        "caption colors: "
        f"updated={result['updated']} missing={result['missing']} skipped={result['skipped']} total={result['total']}"
    )


if __name__ == "__main__":
    main()
