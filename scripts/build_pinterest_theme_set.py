#!/usr/bin/env python3
"""Build Pinterest-ready artifacts from catalog search terms.

The script reads assets/catalog/photos.tsv, finds public catalog rows matching
all query terms, downloads a still public preview image, and writes a dated
artifact package under socials/Pinterest.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import textwrap
import urllib.request
from urllib.error import HTTPError, URLError
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


R2_BASE_URL = "https://pub-a6e07fdd880f4869b4be0e9346cabdc2.r2.dev/"


def rx(pattern: str, value: str) -> str:
    match = re.search(pattern, value)
    return match.group(1) if match else ""


def crop_to_ratio(image: Image.Image, ratio: float) -> Image.Image:
    width, height = image.size
    current = width / height
    if current > ratio:
        new_width = int(height * ratio)
        left = (width - new_width) // 2
        return image.crop((left, 0, left + new_width, height))
    if current < ratio:
        new_height = int(width / ratio)
        top = (height - new_height) // 2
        return image.crop((0, top, width, top + new_height))
    return image


def cap_size(image: Image.Image, max_edge: int = 1800) -> Image.Image:
    width, height = image.size
    longest = max(width, height)
    if longest <= max_edge:
        return image
    scale = max_edge / longest
    return image.resize((int(width * scale), int(height * scale)), Image.Resampling.LANCZOS)


def download(url: str, path: Path) -> None:
    if path.exists():
        return
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        path.write_bytes(response.read())


def contact_sheet(paths: list[Path], output: Path, label_prefix: str) -> None:
    tiles = []
    for index, path in enumerate(paths, 1):
        image = Image.open(path).convert("RGB")
        thumb = ImageOps.contain(image, (230, 300), Image.Resampling.LANCZOS)
        tile = Image.new("RGB", (270, 370), "white")
        tile.paste(thumb, ((270 - thumb.width) // 2, 8))
        draw = ImageDraw.Draw(tile)
        draw.text((8, 318), f"{index}. {label_prefix}", fill=(0, 0, 0))
        draw.text((8, 340), path.name[:38], fill=(70, 70, 70))
        tiles.append(tile)

    columns = min(5, max(1, len(tiles)))
    rows = (len(tiles) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * 270, rows * 370), (230, 230, 230))
    for index, tile in enumerate(tiles):
        sheet.paste(tile, ((index % columns) * 270, (index // columns) * 370))
    sheet.save(output, quality=90)


def read_catalog(path: Path, terms: list[str]) -> list[dict[str, str]]:
    results = []
    with path.open(newline="") as file:
        for row in csv.DictReader(file, delimiter="\t"):
            blob = " ".join(
                [
                    row.get("title", ""),
                    row.get("caption", ""),
                    row.get("metadata_json", ""),
                    row.get("sourceFiles_json", ""),
                ]
            ).lower()
            if not all(term.lower() in blob for term in terms):
                continue
            media_json = row.get("media_json", "")
            source_files_json = row.get("sourceFiles_json", "")
            gallery_key = rx(r'galleryKey\\":\\"([^\\]+)', media_json)
            detail_key = rx(r'detailKey\\":\\"([^\\]+)', media_json)
            if not detail_key:
                continue
            is_video = detail_key.lower().endswith(".mp4") or bool(
                re.search(r'\.(mov|mp4|m4v)(\\"|$)', source_files_json, re.IGNORECASE)
                or re.search(r'type\\":\\"(MOV|MP4|M4V)', source_files_json, re.IGNORECASE)
                or re.search(r'"type"\s*:\s*"(MOV|MP4|M4V)', source_files_json, re.IGNORECASE)
            )
            preview_key = gallery_key if is_video and gallery_key else detail_key
            preview = rx(r'Preview file\\",\\"value\\":\\"([^\\]+)', row.get("metadata_json", ""))
            captured = rx(r'Captured\\",\\"value\\":\\"([^\\]+)', row.get("metadata_json", ""))
            source = rx(r'path\\":\\"([^\\]+)', source_files_json)
            results.append(
                {
                    "id": row["id"],
                    "title": row["title"],
                    "caption": row["caption"],
                    "media_type": "video" if is_video else "photo",
                    "preview_key": preview_key,
                    "gallery_key": gallery_key,
                    "detail_key": detail_key,
                    "preview": preview,
                    "captured": captured,
                    "source": source,
                }
            )
    return results


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", required=True)
    parser.add_argument("--slug", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--description", required=True)
    parser.add_argument("--alt", required=True)
    parser.add_argument("--board", default="Spain Travel Photography")
    parser.add_argument("--terms", nargs="+", required=True)
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()

    root = Path.cwd()
    package_dir = root / "socials" / "Pinterest" / args.date / args.slug
    source_dir = package_dir / "source-previews"
    square_dir = package_dir / "images-square"
    portrait_dir = package_dir / "images-2x3"
    for directory in (source_dir, square_dir, portrait_dir):
        directory.mkdir(parents=True, exist_ok=True)

    matches = read_catalog(root / "assets/catalog/photos.tsv", args.terms)[: args.limit]
    if not matches:
        raise SystemExit("No matching catalog rows found.")

    square_paths = []
    portrait_paths = []
    package_items = []
    skipped_items = []
    for index, item in enumerate(matches, 1):
        base_name = f"{index:02d}-{item['id']}"
        source_path = source_dir / f"{base_name}-source.jpg"
        source_url = R2_BASE_URL + item["preview_key"]
        try:
            download(source_url, source_path)
        except HTTPError as error:
            skipped_items.append(
                {
                    "id": item["id"],
                    "title": item["title"],
                    "preview_key": item["preview_key"],
                    "source_url": source_url,
                    "reason": f"HTTP {error.code}",
                }
            )
            continue
        except URLError as error:
            skipped_items.append(
                {
                    "id": item["id"],
                    "title": item["title"],
                    "preview_key": item["preview_key"],
                    "source_url": source_url,
                    "reason": str(error.reason),
                }
            )
            continue

        try:
            source = Image.open(source_path).convert("RGB")
        except OSError as error:
            skipped_items.append(
                {
                    "id": item["id"],
                    "title": item["title"],
                    "preview_key": item["preview_key"],
                    "source_url": source_url,
                    "reason": f"not a readable still image: {error}",
                }
            )
            continue
        square = cap_size(crop_to_ratio(source, 1.0))
        portrait = cap_size(crop_to_ratio(source, 2 / 3))

        square_path = square_dir / f"{base_name}-square.jpg"
        portrait_path = portrait_dir / f"{base_name}-2x3.jpg"
        square.save(square_path, quality=92, optimize=True)
        portrait.save(portrait_path, quality=92, optimize=True)
        square_paths.append(square_path)
        portrait_paths.append(portrait_path)

        item["source_preview"] = str(source_path.relative_to(package_dir))
        item["square_image"] = str(square_path.relative_to(package_dir))
        item["portrait_image"] = str(portrait_path.relative_to(package_dir))
        item["source_url"] = source_url
        package_items.append(item)

    if not package_items:
        raise SystemExit("No downloadable public previews found for matching catalog rows.")

    contact_sheet(square_paths, package_dir / "contact-sheet-square.jpg", "square")
    contact_sheet(portrait_paths, package_dir / "contact-sheet-2x3.jpg", "2x3")

    manifest = {
        "date": args.date,
        "platform": "Pinterest",
        "status": "artifact_set_ready",
        "account": "@photosbyelie",
        "board": args.board,
        "title": args.title,
        "description": args.description,
        "alt_text": args.alt,
        "terms": args.terms,
        "recommended_upload_set": "images-square",
        "available_count": len(package_items),
        "skipped_count": len(skipped_items),
        "notes": [
            "Square set is recommended for this mixed landscape/portrait aquarium sequence.",
            "2x3 set is included for standard tall Pin variants.",
            "Skipped items are catalog matches whose public preview could not be fetched.",
        ],
        "items": package_items,
        "skipped_items": skipped_items,
    }
    (package_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    readme = f"""# Pinterest Work Artifacts - {args.date} - {args.title}

## Post

- Account: `@photosbyelie`
- Board: `{args.board}`
- Status: Artifact set ready, not posted.

## Copy

Title:

```text
{args.title}
```

Description:

```text
{args.description}
```

Alt text:

```text
{args.alt}
```

## Files

- `images-square/`: recommended carousel upload set for this theme.
- `images-2x3/`: tall Pin variants.
- `source-previews/`: downloaded public previews used as source material.
- `contact-sheet-square.jpg`: review sheet for recommended square images.
- `contact-sheet-2x3.jpg`: review sheet for tall variants.
- `manifest.json`: machine-readable package details.

## Automation Notes

Generated with:

```sh
python3 scripts/build_pinterest_theme_set.py --date {args.date} --slug {args.slug} --title "{args.title}" --description "{args.description}" --alt "{args.alt}" --board "{args.board}" --terms {" ".join(args.terms)}
```
"""
    (package_dir / "README.md").write_text(textwrap.dedent(readme))
    print(package_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
