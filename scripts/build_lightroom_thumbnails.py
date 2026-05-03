#!/usr/bin/env python3
"""
Build watermarked web thumbnails from Lightroom-rated originals.

The script is intentionally interrupt/resume friendly:
- source files are tracked by their path relative to --source-root
- metadata checkpoints are appended to JSONL as each batch finishes
- derivative files are written atomically and skipped when present
- reruns can use a different --source-root, such as a local external drive

Default selection is Lightroom green label with rating >= 4.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".tif",
    ".tiff",
    ".dng",
    ".cr2",
    ".cr3",
    ".nef",
    ".arw",
    ".raf",
    ".orf",
    ".rw2",
}

DEFAULT_SOURCE_ROOT = Path("/Volumes/Saturn-1/Pictures/LR/Camera")
DEFAULT_OUTPUT_ROOT = Path("assets/lightroom")
DEFAULT_WATERMARK = "PhotosByElie"
DEFAULT_GALLERY_MAX = 900
DEFAULT_DETAIL_MAX = 1800
DEFAULT_BATCH_SIZE = 200
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create watermarked gallery/detail thumbnails from green 4+ Lightroom photos."
    )
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--label", default="green", help="Lightroom color label to include.")
    parser.add_argument("--min-rating", type=float, default=4)
    parser.add_argument("--gallery-max", type=int, default=DEFAULT_GALLERY_MAX)
    parser.add_argument("--detail-max", type=int, default=DEFAULT_DETAIL_MAX)
    parser.add_argument("--watermark", default=DEFAULT_WATERMARK)
    parser.add_argument(
        "--years",
        default="",
        help="Only scan one year (YYYY) or an inclusive year range (YYYY-YYYY), based on relative path.",
    )
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--limit", type=int, default=0, help="Stop after N selected photos; useful for tests.")
    parser.add_argument("--dry-run", action="store_true", help="Scan and checkpoint, but do not render files.")
    parser.add_argument("--force", action="store_true", help="Ignore checkpoints and rebuild existing derivatives.")
    parser.add_argument("--clean-missing", action="store_true", help="Drop manifest rows whose derivatives are missing.")
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
    return parser.parse_args()


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
        raise SystemExit(f"Missing required tool: {name}")
    return path


def choose_font() -> str:
    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            return candidate
    raise SystemExit("No usable system font found for ffmpeg drawtext watermark.")


def is_image(path: Path) -> bool:
    return path.suffix.lower() in IMAGE_EXTENSIONS


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
    year = year_from_relative_path(relative_path)
    return year is not None and year_filter[0] <= year <= year_filter[1]


def file_stamp(path: Path | None) -> dict[str, Any] | None:
    if not path or not path.exists():
        return None
    stat = path.stat()
    return {"mtime_ns": stat.st_mtime_ns, "size": stat.st_size}


def checkpoint_key(image: Path, sidecar: Path | None) -> str:
    payload = {
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
    path.parent.mkdir(parents=True, exist_ok=True)
    row = {"updated_at": now_iso(), **row}
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


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


def normalize_rating(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def metadata_label(meta: dict[str, Any]) -> str:
    return str(meta.get("Label") or meta.get("ColorLabel") or "").strip().lower()


def is_selected(meta: dict[str, Any], expected_label: str, min_rating: float) -> bool:
    return normalize_rating(meta.get("Rating")) >= min_rating and metadata_label(meta) == expected_label.lower()


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


def list_value(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [part.strip() for part in str(value).split(",") if part.strip()]


def cleaned_keywords(meta: dict[str, Any], include_private: bool) -> list[str]:
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
        if not include_private and PRIVATE_KEYWORD_PATTERN.search(value):
            continue
        deduped.append(value)
    return deduped


def metadata_value(meta: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = meta.get(key)
        if value not in (None, ""):
            return value
    return None


def merged_selected_metadata(source: Path, metadata_path: Path, args: argparse.Namespace) -> dict[str, Any]:
    extract_gps = args.include_gps or not args.redact_gps
    include_private_keywords = args.include_private_keywords or not args.redact_private_keywords
    gps_tags = ["GPSLatitude", "GPSLongitude", "GPSAltitude", "GPSPosition"]
    source_tags = DISPLAY_SOURCE_TAGS + (gps_tags if extract_gps else [])
    source_meta = run_exiftool_tags(source, source_tags)
    lightroom_meta = run_exiftool_tags(metadata_path, DISPLAY_LIGHTROOM_TAGS)
    merged = {**source_meta, **{key: value for key, value in lightroom_meta.items() if value not in (None, "")}}
    merged.pop("SourceFile", None)
    gps = {key: merged.pop(key) for key in gps_tags if key in merged}
    keywords = cleaned_keywords(merged, include_private_keywords)
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
        ("Location", location_label(merged)),
        ("Software", metadata_value(merged, "Software")),
        ("Color profile", metadata_value(merged, "ProfileDescription", "ColorSpace")),
        ("Original file", source.name),
        ("Original size", original_size_label(merged)),
    ]
    for label, value in display_specs:
        if value:
            display.append({"label": label, "value": str(value)})
    return {
        "rating": normalize_rating(merged.get("Rating")),
        "label": metadata_value(merged, "Label", "ColorLabel"),
        "keywords": keywords,
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


def render_derivative(
    source: Path,
    output: Path,
    max_px: int,
    watermark: str,
    font: str,
    force: bool,
) -> bool:
    if output.exists() and not force:
        return False
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="photosbyelie-render-") as temp_dir:
        temp_jpg = Path(temp_dir) / "base.jpg"
        temp_out = Path(temp_dir) / "watermarked.jpg"
        subprocess.run(
            [
                "sips",
                "-s",
                "format",
                "jpeg",
                "--resampleHeightWidthMax",
                str(max_px),
                str(source),
                "--out",
                str(temp_jpg),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        font_size = max(18, round(max_px / 45))
        border_width = max(1, round(font_size / 14))
        margin = max(18, round(max_px / 36))
        watermark_filter = (
            f"drawtext=fontfile='{ffmpeg_escape(font)}':"
            f"text='{ffmpeg_escape(watermark)}':"
            "fontcolor=white@0.58:"
            f"fontsize={font_size}:"
            f"borderw={border_width}:"
            "bordercolor=black@0.36:"
            f"x=w-tw-{margin}:"
            f"y=h-th-{margin}"
        )
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(temp_jpg),
                "-vf",
                watermark_filter,
                "-q:v",
                "3",
                str(temp_out),
            ],
            check=True,
        )
        temp_out.replace(output)
    return True


def load_manifest(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    try:
        rows = json.loads(path.read_text(encoding="utf-8")).get("photos", [])
    except json.JSONDecodeError:
        return {}
    return {row["relative_path"]: row for row in rows if "relative_path" in row}


def write_manifest(path: Path, rows: dict[str, dict[str, Any]], args: argparse.Namespace) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": now_iso(),
        "source_root_hint": str(args.source_root),
        "selection": {"label": args.label, "min_rating": args.min_rating, "years": args.years or None},
        "derivatives": {
            "gallery_max": args.gallery_max,
            "detail_max": args.detail_max,
            "watermark": args.watermark,
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


def write_gps_manifest(path: Path, rows: dict[str, dict[str, Any]], args: argparse.Namespace) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": now_iso(),
        "source_root_hint": str(args.source_root),
        "private": True,
        "note": "Exact GPS metadata kept outside manifest.json so this file can stay untracked.",
        "photos": sorted(rows.values(), key=lambda row: row["relative_path"]),
    }
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def derivative_paths(output_root: Path, slug: str) -> tuple[Path, Path]:
    return output_root / "gallery" / f"{slug}.jpg", output_root / "detail" / f"{slug}.jpg"


def should_skip_metadata(row: dict[str, Any] | None, stamp: str, force: bool) -> bool:
    if force or not row:
        return False
    return row.get("checkpoint") == stamp


def manifest_derivatives_exist(output_root: Path, row: dict[str, Any] | None) -> bool:
    if not row:
        return False
    derivatives = row.get("derivatives", {})
    return bool(derivatives) and all((output_root / rel_path).exists() for rel_path in derivatives.values())


def discover_images(source_root: Path) -> Any:
    for root, dirs, files in os.walk(source_root):
        dirs[:] = sorted((name for name in dirs if not name.startswith(".")), reverse=True)
        for name in sorted(files, reverse=True):
            path = Path(root) / name
            if is_image(path):
                yield path


def process_batch(
    batch: list[dict[str, Any]],
    args: argparse.Namespace,
    state_path: Path,
    manifest: dict[str, dict[str, Any]],
    gps_manifest: dict[str, dict[str, Any]],
    font: str,
) -> int:
    metadata_rows = run_exiftool([item["metadata_path"] for item in batch])
    by_source = {Path(row.get("SourceFile", "")).resolve(): row for row in metadata_rows}
    selected_count = 0
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
        if not is_selected(meta, args.label, args.min_rating):
            append_state(state_path, {**base_state, "status": "skipped"})
            continue

        selected_count += 1
        slug = slug_for(relative_path)
        gallery_path, detail_path = derivative_paths(args.output_root, slug)
        row = {
            "id": slug,
            "relative_path": relative_path,
            "source_path_hint": str(source),
            "metadata_path_hint": str(metadata_path),
            "derivatives": {
                "gallery": gallery_path.relative_to(args.output_root).as_posix(),
                "detail": detail_path.relative_to(args.output_root).as_posix(),
            },
        }
        try:
            selected_metadata = merged_selected_metadata(source, metadata_path, args)
            row["rating"] = selected_metadata["rating"]
            row["label"] = selected_metadata["label"]
            row["keywords"] = selected_metadata["keywords"]
            row["metadata"] = selected_metadata["display"]
            row["raw_metadata"] = selected_metadata["raw"]
            row["selection_metadata"] = compact_metadata(meta)
            if selected_metadata["gps"]:
                gps_manifest[relative_path] = {
                    "id": slug,
                    "relative_path": relative_path,
                    "source_path_hint": str(source),
                    "gps": selected_metadata["gps"],
                }
            if not args.dry_run:
                render_derivative(source, gallery_path, args.gallery_max, args.watermark, font, args.force)
                render_derivative(source, detail_path, args.detail_max, args.watermark, font, args.force)
            manifest[relative_path] = row
            append_state(state_path, {**base_state, "status": "rendered" if not args.dry_run else "selected"})
        except Exception as exc:
            append_state(state_path, {**base_state, "status": "error", "error": str(exc)})
            print(f"ERROR {relative_path}: {exc}", file=sys.stderr)
    return selected_count


def main() -> int:
    args = parse_args()
    source_root = args.source_root.expanduser().resolve()
    args.output_root = args.output_root.expanduser()
    year_filter = parse_year_filter(args.years)
    if not source_root.exists():
        raise SystemExit(f"Source root does not exist: {source_root}")
    require_tool("exiftool")
    require_tool("sips")
    require_tool("ffmpeg")
    font = choose_font()

    manifest_path = args.output_root / "manifest.json"
    gps_manifest_path = args.output_root / "gps-metadata.json"
    state_path = args.output_root / ".build-state.jsonl"
    args.output_root.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest(manifest_path)
    gps_manifest = load_gps_manifest(gps_manifest_path) if not args.redact_gps else {}
    state = load_latest_state(state_path) if not args.force else {}

    if args.clean_missing:
        manifest = {
            rel: row
            for rel, row in manifest.items()
            if all((args.output_root / path).exists() for path in row.get("derivatives", {}).values())
        }

    seen = selected = inspected = 0
    batch: list[dict[str, Any]] = []
    for source in discover_images(source_root):
        relative_path = rel_key(source, source_root)
        if not matches_year_filter(relative_path, year_filter):
            continue
        seen += 1
        sidecar = sidecar_for(source)
        metadata_path = sidecar or source
        stamp = checkpoint_key(source, sidecar)
        prior = state.get(relative_path)
        if should_skip_metadata(prior, stamp, args.force):
            prior_status = prior.get("status")
            if prior_status == "skipped":
                continue
            if prior_status in {"rendered", "selected"} and relative_path in manifest:
                if args.dry_run or manifest_derivatives_exist(args.output_root, manifest.get(relative_path)):
                    selected += 1
                    continue
                # Metadata is known, but a derivative is missing. Re-render from the original.
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
            }
        )
        if len(batch) >= args.batch_size:
            inspected += len(batch)
            selected += process_batch(batch, args, state_path, manifest, gps_manifest, font)
            write_manifest(manifest_path, manifest, args)
            if not args.redact_gps:
                write_gps_manifest(gps_manifest_path, gps_manifest, args)
            batch = []
            print(f"Scanned {seen} files, inspected {inspected}, selected {selected}", flush=True)
            if args.limit and selected >= args.limit:
                break
    if batch and (not args.limit or selected < args.limit):
        inspected += len(batch)
        selected += process_batch(batch, args, state_path, manifest, gps_manifest, font)
        write_manifest(manifest_path, manifest, args)
        if not args.redact_gps:
            write_gps_manifest(gps_manifest_path, gps_manifest, args)

    write_manifest(manifest_path, manifest, args)
    if not args.redact_gps:
        write_gps_manifest(gps_manifest_path, gps_manifest, args)
    print(f"Done. Saw {seen} images, inspected {inspected}, manifest contains {len(manifest)} selected photos.")
    print(f"Manifest: {manifest_path}")
    if not args.redact_gps:
        print(f"Private GPS metadata: {gps_manifest_path}")
    print(f"Checkpoint: {state_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
