#!/usr/bin/env python3
"""Import private real-estate JPG exports for a client gallery/cloud-PDF workflow."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import re
import sys
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps


RAW_EXTENSIONS = {".raw", ".dng", ".nef", ".cr2", ".cr3", ".arw", ".orf", ".raf", ".rw2"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg"}
DEFAULT_SOURCE_ROOT = Path("/Volumes/Saturn/Pictures/RE/Corine")
DEFAULT_OUTPUT_ROOT = Path("tmp/real-estate-import")


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "item"


def display_album_title(album: str) -> str:
    return re.sub(r"^RE\s+\d{4}\s+", "", album, flags=re.IGNORECASE).strip() or album


def image_dimensions(path: Path) -> dict[str, int]:
    with Image.open(path) as image:
        return {"width": int(image.width), "height": int(image.height)}


def render_derivative(source: Path, destination: Path, max_edge: int, quality: int, force: bool) -> dict[str, Any]:
    if (
        destination.exists()
        and not force
        and destination.stat().st_mtime >= source.stat().st_mtime
    ):
        dimensions = image_dimensions(destination)
        return {
            "path": destination,
            "width": dimensions["width"],
            "height": dimensions["height"],
            "bytes": destination.stat().st_size,
            "rendered": False,
        }

    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image)
        image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        if image.mode not in {"RGB", "L"}:
            image = image.convert("RGB")
        if image.mode == "L":
            image = image.convert("RGB")
        image.save(destination, "JPEG", quality=quality, optimize=True, progressive=True)

    dimensions = image_dimensions(destination)
    return {
        "path": destination,
        "width": dimensions["width"],
        "height": dimensions["height"],
        "bytes": destination.stat().st_size,
        "rendered": True,
    }


def repo_relative(path: Path, repo_root: Path) -> str:
    try:
        return path.resolve().relative_to(repo_root.resolve()).as_posix()
    except ValueError:
        return str(path)


def output_relative(path: Path, output_dir: Path) -> str:
    return path.resolve().relative_to(output_dir.resolve()).as_posix()


def scan_album_files(album_dir: Path) -> list[Path]:
    return sorted(
        path
        for path in album_dir.iterdir()
        if path.is_file() and path.name != ".DS_Store" and path.suffix.lower() in IMAGE_EXTENSIONS
    )


def raw_files(root: Path) -> list[Path]:
    return sorted(
        path
        for path in root.rglob("*")
        if path.is_file() and path.suffix.lower() in RAW_EXTENSIONS
    )


def album_dirs(source_root: Path, requested_albums: list[str]) -> list[Path]:
    if requested_albums:
        return [source_root / album for album in requested_albums]
    return sorted(path for path in source_root.iterdir() if path.is_dir())


def write_app_context(manifest: dict[str, Any], output_dir: Path) -> Path:
    payload = json.dumps(manifest, indent=2, sort_keys=True)
    context = f"""(() => {{
  const payload = {payload};
  const script = document.currentScript;
  const base = script?.src ? new URL("./", script.src) : new URL("./", window.location.href);
  const absoluteUrl = (value) => {{
    if (!value || /^(https?:|data:|blob:|\\/)/i.test(value)) return value || "";
    return new URL(value, base).href;
  }};
  const photos = (payload.photos || []).map((photo) => {{
    const publicPreview = photo.media?.publicPreview || {{}};
    const pdfSource = photo.cloudPdfSource || {{}};
    return {{
      ...photo,
      media: {{
        ...(photo.media || {{}}),
        publicPreview: {{
          ...publicPreview,
          galleryUrl: absoluteUrl(publicPreview.galleryUrl || photo.gallerySrc),
          detailUrl: absoluteUrl(publicPreview.detailUrl || photo.imageSrc),
          previewUrl: absoluteUrl(publicPreview.previewUrl || photo.imageSrc),
          thumbnailUrl: absoluteUrl(publicPreview.thumbnailUrl || photo.gallerySrc),
        }},
      }},
      cloudPdfSource: {{
        ...pdfSource,
        imageUrl: absoluteUrl(pdfSource.imageUrl),
      }},
    }};
  }});
  const gallery = {{
    ...(payload.gallery || {{}}),
    photos,
  }};
  window.photosByElieRealEstateImport = {{
    ...payload,
    gallery,
    photos,
  }};
  window.photosByElieRealEstateGalleryKey = gallery.key;
  window.photosByElieData = {{
    ...(window.photosByElieData || {{}}),
    [gallery.key]: gallery,
  }};
}})();
"""
    path = output_dir / "app-context.js"
    path.write_text(context, encoding="utf-8")
    return path


def build_manifest(
    *,
    repo_root: Path,
    source_root: Path,
    output_dir: Path,
    customer: str,
    gallery_key: str,
    gallery_title: str,
    albums: list[Path],
    gallery_max_edge: int,
    pdf_source_max_edge: int,
    gallery_quality: int,
    pdf_source_quality: int,
    force: bool,
) -> dict[str, Any]:
    photos: list[dict[str, Any]] = []
    album_entries: list[dict[str, Any]] = []
    total_source_bytes = 0
    total_gallery_bytes = 0
    total_pdf_source_bytes = 0
    rendered_gallery = 0
    rendered_pdf_source = 0

    for album_index, album_dir in enumerate(albums, start=1):
        if not album_dir.exists() or not album_dir.is_dir():
            raise FileNotFoundError(f"Album folder not found: {album_dir}")

        album_name = album_dir.name
        album_slug = slugify(album_name)
        album_title = display_album_title(album_name)
        sources = scan_album_files(album_dir)
        album_entries.append({
            "title": album_name,
            "displayTitle": album_title,
            "slug": album_slug,
            "sourcePath": str(album_dir),
            "photoCount": len(sources),
            "sortIndex": album_index,
        })

        for photo_index, source in enumerate(sources, start=1):
            source_bytes = source.stat().st_size
            total_source_bytes += source_bytes
            file_slug = slugify(source.stem)
            photo_id = f"{slugify(customer)}-{album_slug}-{file_slug}"
            default_title = f"{album_title} - {photo_index:02d}"
            gallery_path = output_dir / "gallery" / album_slug / f"{photo_id}_gallery.jpg"
            pdf_source_path = output_dir / "pdf-source" / album_slug / f"{photo_id}_pdf_source.jpg"
            gallery_render = render_derivative(source, gallery_path, gallery_max_edge, gallery_quality, force)
            pdf_source_render = render_derivative(source, pdf_source_path, pdf_source_max_edge, pdf_source_quality, force)
            rendered_gallery += 1 if gallery_render["rendered"] else 0
            rendered_pdf_source += 1 if pdf_source_render["rendered"] else 0
            total_gallery_bytes += int(gallery_render["bytes"])
            total_pdf_source_bytes += int(pdf_source_render["bytes"])

            original_dimensions = image_dimensions(source)
            gallery_rel = output_relative(gallery_path, output_dir)
            pdf_source_rel = output_relative(pdf_source_path, output_dir)
            photos.append({
                "id": photo_id,
                "title": default_title,
                "editableTitle": default_title,
                "caption": album_title,
                "className": "real-estate-photo",
                "full": source.name,
                "gallerySrc": gallery_rel,
                "imageSrc": pdf_source_rel,
                "album": album_name,
                "albumSlug": album_slug,
                "albumTitle": album_title,
                "sortIndex": len(photos) + 1,
                "metadata": [
                    {"label": "Client", "value": customer},
                    {"label": "Album", "value": album_name},
                    {"label": "Original file", "value": source.name},
                    {"label": "Original size", "value": f"{original_dimensions['width']} x {original_dimensions['height']}"},
                    {"label": "Gallery derivative", "value": f"{gallery_render['width']} x {gallery_render['height']}"},
                    {"label": "Cloud PDF source", "value": f"{pdf_source_render['width']} x {pdf_source_render['height']}"},
                ],
                "media": {
                    "type": "photo",
                    "publicPreview": {
                        "allowed": True,
                        "galleryUrl": gallery_rel,
                        "thumbnailUrl": gallery_rel,
                        "detailUrl": pdf_source_rel,
                        "previewUrl": pdf_source_rel,
                        "dimensions": {
                            "width": int(gallery_render["width"]),
                            "height": int(gallery_render["height"]),
                        },
                    },
                },
                "cloudPdfSource": {
                    "title": default_title,
                    "imageUrl": pdf_source_rel,
                    "maxEdge": pdf_source_max_edge,
                    "dimensions": {
                        "width": int(pdf_source_render["width"]),
                        "height": int(pdf_source_render["height"]),
                    },
                    "bytes": int(pdf_source_render["bytes"]),
                },
                "realEstate": {
                    "customer": customer,
                    "sourcePath": str(source),
                    "sourceBytes": source_bytes,
                    "sourceDimensions": original_dimensions,
                    "galleryPath": repo_relative(gallery_path, repo_root),
                    "cloudPdfSourcePath": repo_relative(pdf_source_path, repo_root),
                },
            })

    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    return {
        "schema": "photosbyelie.realEstateImport.v1",
        "generatedAt": generated_at,
        "customer": {
            "name": customer,
            "username": customer,
        },
        "sourceRoot": str(source_root),
        "outputRoot": repo_relative(output_dir, repo_root),
        "gallery": {
            "key": gallery_key,
            "title": gallery_title,
            "description": "Private real-estate selection gallery for cloud PDF assembly.",
            "accent": "spain",
            "photos": photos,
        },
        "albums": album_entries,
        "photos": photos,
        "cloudPdfWorkflow": {
            "titleField": "editableTitle",
            "selectionStoreKey": f"photosbyelie-real-estate-liked-{gallery_key}",
            "titleStoreKey": f"photosbyelie-real-estate-titles-{gallery_key}",
            "imageField": "cloudPdfSource.imageUrl",
            "mode": "one-photo-per-page",
            "assembly": "Cloud service receives liked photo ids plus edited titles, then generates the final PDF on demand.",
            "largeFileMitigation": "Importer prepares cloud PDF source JPGs instead of final PDFs; final PDF assembly/download belongs to the cloud path so the browser does not build one huge Blob locally.",
        },
        "stats": {
            "albumCount": len(album_entries),
            "photoCount": len(photos),
            "sourceBytes": total_source_bytes,
            "galleryBytes": total_gallery_bytes,
            "pdfSourceBytes": total_pdf_source_bytes,
            "galleryRendered": rendered_gallery,
            "pdfSourceRendered": rendered_pdf_source,
            "galleryMaxEdge": gallery_max_edge,
            "pdfSourceMaxEdge": pdf_source_max_edge,
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build ignored Real Estate gallery/cloud-PDF source assets from JPG customer exports."
    )
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--customer", default="Corine")
    parser.add_argument("--gallery-key", default="")
    parser.add_argument("--gallery-title", default="")
    parser.add_argument("--album", action="append", default=[], help="Album folder name to import. Repeatable.")
    parser.add_argument("--gallery-max-edge", type=int, default=1400)
    parser.add_argument("--pdf-source-max-edge", "--pdf-max-edge", dest="pdf_source_max_edge", type=int, default=2200)
    parser.add_argument("--gallery-quality", type=int, default=84)
    parser.add_argument("--pdf-source-quality", "--pdf-quality", dest="pdf_source_quality", type=int, default=88)
    parser.add_argument("--force", action="store_true", help="Re-render existing derivatives.")
    parser.add_argument("--allow-raw-present", action="store_true", help="Do not fail when RAW/DNG/NEF files are present near the source JPGs.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = Path.cwd()
    source_root = args.source_root.expanduser()
    if not source_root.exists() or not source_root.is_dir():
        print(f"Source root not found: {source_root}", file=sys.stderr)
        return 1

    raw_hits = raw_files(source_root)
    if raw_hits and not args.allow_raw_present:
        print("RAW/DNG/NEF files are present; refusing to import until the customer export is JPG-only.", file=sys.stderr)
        for path in raw_hits[:25]:
            print(f"  {path}", file=sys.stderr)
        if len(raw_hits) > 25:
            print(f"  ... and {len(raw_hits) - 25} more", file=sys.stderr)
        return 1

    customer_slug = slugify(args.customer)
    gallery_key = args.gallery_key or f"{customer_slug}-real-estate"
    gallery_title = args.gallery_title or f"{args.customer} Real Estate"
    output_dir = args.output_root / customer_slug
    output_dir.mkdir(parents=True, exist_ok=True)

    albums = album_dirs(source_root, args.album)
    if not albums:
        print(f"No album folders found in {source_root}", file=sys.stderr)
        return 1

    manifest = build_manifest(
        repo_root=repo_root,
        source_root=source_root,
        output_dir=output_dir,
        customer=args.customer,
        gallery_key=gallery_key,
        gallery_title=gallery_title,
        albums=albums,
        gallery_max_edge=args.gallery_max_edge,
        pdf_source_max_edge=args.pdf_source_max_edge,
        gallery_quality=args.gallery_quality,
        pdf_source_quality=args.pdf_source_quality,
        force=args.force,
    )

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    app_context_path = write_app_context(manifest, output_dir)
    summary_path = output_dir / "summary.json"
    summary_path.write_text(json.dumps({
        "generatedAt": manifest["generatedAt"],
        "customer": manifest["customer"]["name"],
        "sourceRoot": manifest["sourceRoot"],
        "outputRoot": manifest["outputRoot"],
        "albums": manifest["albums"],
        "stats": manifest["stats"],
        "manifestPath": repo_relative(manifest_path, repo_root),
        "appContextPath": repo_relative(app_context_path, repo_root),
    }, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    stats = manifest["stats"]
    print(f"Imported {stats['photoCount']} photos across {stats['albumCount']} albums for {args.customer}.")
    print(f"Gallery derivatives: {stats['galleryRendered']} rendered, {stats['galleryBytes']} bytes total.")
    print(f"Cloud PDF source images: {stats['pdfSourceRendered']} rendered, {stats['pdfSourceBytes']} bytes total.")
    print(f"Manifest: {repo_relative(manifest_path, repo_root)}")
    print(f"App context: {repo_relative(app_context_path, repo_root)}")
    print(f"Summary: {repo_relative(summary_path, repo_root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
