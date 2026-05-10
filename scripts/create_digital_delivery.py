#!/usr/bin/env python3
"""Create a digital delivery ZIP from a Photos By Elie order email."""

from __future__ import annotations

import argparse
import math
import os
import re
import shutil
import subprocess
import sys
import textwrap
import zipfile
from dataclasses import dataclass, field
from pathlib import Path


DEFAULT_SOURCE_ROOT_CANDIDATES = [
    Path("/Volumes/Saturn/Pictures/LR/Camera"),
    Path("/Volumes/Saturn-1/Pictures/LR/Camera"),
    Path.home() / "Pictures/LR/Camera",
    Path.home() / "Pictures/LR/2024",
    Path.home() / "Pictures/LR",
]
DEFAULT_OUTPUT_DIR = Path("deliveries")
RAW_IMAGE_EXTENSIONS = {
    ".dng",
    ".cr2",
    ".cr3",
    ".nef",
    ".arw",
    ".raf",
    ".orf",
    ".rw2",
    ".raw",
    ".pef",
    ".srw",
    ".rwl",
}
DIGITAL_MEGAPIXELS = {
    "jpg-6mp": 6,
    "jpg-3mp": 3,
    "jpg-1mp": 1,
}


@dataclass
class Product:
    label: str
    quantity: int
    product_id: str
    megapixels: int | None = None


@dataclass
class PhotoOrder:
    index: int
    title: str
    photo_id: str = ""
    collection: str = ""
    original: str = ""
    products: list[Product] = field(default_factory=list)


@dataclass
class Order:
    order_id: str
    zip_name: str
    photos: list[PhotoOrder]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description="Create a customer delivery ZIP from a prepared Photos By Elie order email.",
        epilog=textwrap.dedent(
            """\
            Examples:
              python3 scripts/create_digital_delivery.py order-email.txt
              pbpaste | python3 scripts/create_digital_delivery.py -
              python3 scripts/create_digital_delivery.py order-email.txt --source-root /Volumes/Saturn/Pictures/LR/Camera
            """
        ),
    )
    parser.add_argument(
        "order_email",
        nargs="?",
        default="-",
        help="Text file containing the prepared order email. Use - or omit to read stdin.",
    )
    parser.add_argument(
        "--source-root",
        action="append",
        type=Path,
        default=[],
        help="Root folder for original source files. Can be passed more than once.",
    )
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--quality", type=int, default=90, help="JPEG quality from 1 to 100.")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing order folder/ZIP.")
    parser.add_argument("--dry-run", action="store_true", help="Parse and resolve sources without rendering.")
    return parser.parse_args()


def read_order_text(path_value: str) -> str:
    if path_value == "-":
        text = sys.stdin.read()
    else:
        text = Path(path_value).read_text(encoding="utf-8")
    if text.startswith("Subject:"):
        text = re.sub(r"\ASubject:.*?\n\n", "", text, count=1, flags=re.DOTALL)
    return text


def parse_product(label: str, quantity: int) -> Product | None:
    normalized = label.strip().lower()
    if "full resolution" in normalized:
        return Product(label=label.strip(), quantity=quantity, product_id="full")
    mp_match = re.search(r"\bjpg\s+([136])\s*mp\b", normalized, flags=re.IGNORECASE)
    if not mp_match:
        return None
    megapixels = int(mp_match.group(1))
    product_id = f"jpg-{megapixels}mp"
    return Product(label=label.strip(), quantity=quantity, product_id=product_id, megapixels=megapixels)


def parse_order(text: str) -> Order:
    order_match = re.search(r"^Order ID:\s*(\S+)\s*$", text, flags=re.MULTILINE)
    if not order_match:
        raise ValueError("Could not find an 'Order ID:' line in the email.")
    order_id = order_match.group(1)

    zip_match = re.search(r"^Delivery ZIP:\s*(\S+\.zip)\s*$", text, flags=re.MULTILINE)
    zip_name = zip_match.group(1) if zip_match else f"photosbyelie-order-{order_id}.zip"

    photos: list[PhotoOrder] = []
    current: PhotoOrder | None = None
    in_products = False
    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        photo_match = re.match(r"^(\d+)\.\s+(.+)$", line)
        if photo_match:
            current = PhotoOrder(index=int(photo_match.group(1)), title=photo_match.group(2).strip())
            photos.append(current)
            in_products = False
            continue
        if current is None:
            continue
        if line.startswith("Photo ID:"):
            current.photo_id = line.split(":", 1)[1].strip()
        elif line.startswith("Collection:"):
            current.collection = line.split(":", 1)[1].strip()
        elif line.startswith("Original:"):
            original = line.split(":", 1)[1].strip()
            current.original = re.sub(r"\s+\([^)]+\)\s*$", "", original)
        elif line == "Selected products:":
            in_products = True
        elif in_products and line.startswith("- "):
            product_match = re.match(r"^-\s+\[([^\]]+)\]\s+(.+?)\s+x\s+(\d+):", line)
            if not product_match:
                continue
            product_type = product_match.group(1).strip().lower()
            if product_type != "digital":
                continue
            product = parse_product(product_match.group(2), int(product_match.group(3)))
            if product:
                current.products.append(product)
        elif in_products and line.startswith("Photo subtotal:"):
            in_products = False

    photos = [photo for photo in photos if photo.products]
    if not photos:
        raise ValueError("The order email did not contain any supported digital products.")
    for photo in photos:
        if not photo.photo_id:
            raise ValueError(f"Missing Photo ID for photo #{photo.index}: {photo.title}")
        if not photo.original:
            raise ValueError(f"Missing Original for photo #{photo.index}: {photo.title}")
    return Order(order_id=order_id, zip_name=zip_name, photos=photos)


def source_roots(extra_roots: list[Path]) -> list[Path]:
    roots: list[Path] = []
    for root in [*extra_roots, *DEFAULT_SOURCE_ROOT_CANDIDATES]:
        expanded = root.expanduser()
        if expanded not in roots:
            roots.append(expanded)
    return roots


def resolve_original(original: str, roots: list[Path]) -> Path | None:
    original_path = Path(original).expanduser()
    if original_path.is_absolute() and original_path.exists():
        return original_path
    for root in roots:
        candidate = root / original
        if candidate.exists():
            return candidate
    return None


def sips_dimensions(path: Path) -> tuple[int, int]:
    completed = subprocess.run(
        ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    width_match = re.search(r"pixelWidth:\s*(\d+)", completed.stdout)
    height_match = re.search(r"pixelHeight:\s*(\d+)", completed.stdout)
    if not width_match or not height_match:
        raise RuntimeError(f"Could not read dimensions for {path}")
    return int(width_match.group(1)), int(height_match.group(1))


def long_edge_for_megapixels(width: int, height: int, megapixels: int) -> int:
    source_pixels = width * height
    target_pixels = megapixels * 1_000_000
    if target_pixels >= source_pixels:
        return max(width, height)
    scale = math.sqrt(target_pixels / source_pixels)
    return max(1, round(max(width, height) * scale))


def safe_name(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-._")
    return cleaned[:120] or fallback


def unique_products(products: list[Product]) -> list[Product]:
    seen: set[str] = set()
    unique: list[Product] = []
    for product in products:
        if product.product_id in seen:
            continue
        seen.add(product.product_id)
        unique.append(product)
    return unique


def render_jpeg(source: Path, destination: Path, quality: int, megapixels: int | None) -> None:
    if source.suffix.lower() in RAW_IMAGE_EXTENSIONS:
        raise RuntimeError(
            f"{source} is a RAW file. Refusing to fulfill it with sips because macOS may export only "
            "the embedded preview. Use a Lightroom-exported JPG/TIFF master or install a real RAW "
            "converter path before creating customer delivery files."
        )
    destination.parent.mkdir(parents=True, exist_ok=True)
    command = ["sips", "-s", "format", "jpeg", "-s", "formatOptions", str(quality)]
    if megapixels:
        width, height = sips_dimensions(source)
        command.extend(["-Z", str(long_edge_for_megapixels(width, height, megapixels))])
    command.extend([str(source), "--out", str(destination)])
    subprocess.run(command, check=True, capture_output=True, text=True)


def write_manifest(order: Order, staging_dir: Path, rendered: list[tuple[PhotoOrder, Product, Path, Path]]) -> None:
    lines = [
        "Photos By Elie digital delivery",
        "",
        f"Order ID: {order.order_id}",
        f"Delivery ZIP: {order.zip_name}",
        "",
    ]
    for photo, product, source, output in rendered:
        lines.extend(
            [
                f"Photo ID: {photo.photo_id}",
                f"Title: {photo.title}",
                f"Collection: {photo.collection}",
                f"Original: {photo.original}",
                f"Resolved source: {source}",
                f"Delivered file: {output.relative_to(staging_dir)}",
                f"Product: {product.label}",
                "",
            ]
        )
    (staging_dir / "ORDER.txt").write_text("\n".join(lines), encoding="utf-8")


def create_zip(staging_dir: Path, zip_path: Path) -> None:
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(staging_dir.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(staging_dir))


def main() -> int:
    args = parse_args()
    if not 1 <= args.quality <= 100:
        print("--quality must be between 1 and 100", file=sys.stderr)
        return 2
    if not shutil.which("sips"):
        print("This script needs macOS sips on PATH.", file=sys.stderr)
        return 2

    order = parse_order(read_order_text(args.order_email))
    roots = source_roots(args.source_root)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    staging_dir = args.output_dir / order.zip_name.removesuffix(".zip")
    zip_path = args.output_dir / order.zip_name
    if (staging_dir.exists() or zip_path.exists()) and not args.force:
        print(f"{staging_dir} or {zip_path} already exists. Re-run with --force to overwrite.", file=sys.stderr)
        return 2
    if args.force:
        shutil.rmtree(staging_dir, ignore_errors=True)
        zip_path.unlink(missing_ok=True)
    staging_dir.mkdir(parents=True, exist_ok=True)

    rendered: list[tuple[PhotoOrder, Product, Path, Path]] = []
    missing: list[PhotoOrder] = []
    failed: list[str] = []
    for photo in order.photos:
        source = resolve_original(photo.original, roots)
        if not source:
            missing.append(photo)
            continue
        for product in unique_products(photo.products):
            output = staging_dir / f"{safe_name(photo.photo_id, 'photo')}-{product.product_id}.jpg"
            if args.dry_run:
                print(f"DRY RUN {source} -> {output}")
            else:
                try:
                    render_jpeg(source, output, args.quality, product.megapixels)
                except RuntimeError as exc:
                    failed.append(f"{photo.photo_id} / {product.label}: {exc}")
                    continue
            rendered.append((photo, product, source, output))

    if missing:
        for photo in missing:
            print(f"Missing source for {photo.photo_id}: {photo.original}", file=sys.stderr)
        return 1
    if failed:
        for message in failed:
            print(message, file=sys.stderr)
        return 1
    if not rendered:
        print("No files were rendered.", file=sys.stderr)
        return 1

    if not args.dry_run:
        write_manifest(order, staging_dir, rendered)
        create_zip(staging_dir, zip_path)
        print(f"Created {zip_path}")
        print(f"Staging folder: {staging_dir}")
        print(f"Rendered {len(rendered)} JPG file(s) from {len(order.photos)} photo(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
