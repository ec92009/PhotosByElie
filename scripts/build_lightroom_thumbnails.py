#!/usr/bin/env python3
"""
Build watermarked web thumbnails from developed photo exports.

The script is intentionally interrupt/resume friendly:
- source files are tracked by their path relative to --source-root
- metadata checkpoints are appended to JSONL as each batch finishes
- derivative files are written atomically and skipped when present
- reruns can use a different --source-root, such as a local external drive

By default, developed JPG/TIFF sources are imported into Reserve only when
Lightroom marks them green with rating 4 or higher. Expo is filled later by the
curation/export scripts.
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
}

DEFAULT_SOURCE_ROOT_CANDIDATES = [
    Path("/Volumes/Saturn/Pictures/LR/Camera"),
    Path("/Volumes/Saturn-1/Pictures/LR/Camera"),
    Path.home() / "Pictures/LR/Camera",
    Path.home() / "Pictures/LR/2024",
]
DEFAULT_SOURCE_ROOT = DEFAULT_SOURCE_ROOT_CANDIDATES[0]
DEFAULT_OUTPUT_ROOT = Path("assets/reserve")
DEFAULT_WATERMARK = "PhotosByElie"
DEFAULT_GALLERY_MAX = 900
DEFAULT_DETAIL_MAX = 1800
DEFAULT_BATCH_SIZE = 50
SCHEMA_VERSION = 3
COUNTRY_ALIASES = {
    "fr": ("france", "France"),
    "france": ("france", "France"),
    "usa": ("usa", "United States"),
    "us": ("usa", "United States"),
    "u.s.": ("usa", "United States"),
    "u.s.a.": ("usa", "United States"),
    "united states": ("usa", "United States"),
    "united states of america": ("usa", "United States"),
    "america": ("usa", "United States"),
    "spain": ("spain", "Spain"),
    "es": ("spain", "Spain"),
    "espana": ("spain", "Spain"),
    "españa": ("spain", "Spain"),
    "mexico": ("mexico", "Mexico"),
    "mx": ("mexico", "Mexico"),
    "méxico": ("mexico", "Mexico"),
    "portugal": ("portugal", "Portugal"),
    "pt": ("portugal", "Portugal"),
    "italy": ("italy", "Italy"),
    "italia": ("italy", "Italy"),
    "canada": ("canada", "Canada"),
    "united kingdom": ("uk", "United Kingdom"),
    "uk": ("uk", "United Kingdom"),
    "england": ("uk", "United Kingdom"),
    "slovakia": ("slovakia", "Slovakia"),
    "slovak republic": ("slovakia", "Slovakia"),
    "sk": ("slovakia", "Slovakia"),
    "ai": ("ai", "AI"),
    "leonardo": ("ai", "AI"),
    "leonardo ai": ("ai", "AI"),
}
COUNTRY_HINTS = {
    "california": ("usa", "United States"),
    "carlsbad": ("usa", "United States"),
    "lake arrowhead": ("usa", "United States"),
    "lake forest": ("usa", "United States"),
    "san bernardino": ("usa", "United States"),
    "san diego": ("usa", "United States"),
    "encinitas": ("usa", "United States"),
    "new york": ("usa", "United States"),
    "florida": ("usa", "United States"),
    "paris": ("france", "France"),
    "versailles": ("france", "France"),
    "madrid": ("spain", "Spain"),
    "barcelona": ("spain", "Spain"),
    "bilbao": ("spain", "Spain"),
    "basque country": ("spain", "Spain"),
    "euzkadi": ("spain", "Spain"),
    "pays basque": ("spain", "Spain"),
    "puerto vallarta": ("mexico", "Mexico"),
    "bratislava": ("slovakia", "Slovakia"),
}
GPS_COUNTRY_BOUNDS = {
    "usa": ((24.0, 49.5), (-125.0, -66.0), "United States"),
    "mexico": ((14.0, 33.5), (-118.5, -86.0), "Mexico"),
    "spain": ((27.0, 44.5), (-18.5, 4.9), "Spain"),
    "portugal": ((30.0, 42.5), (-10.5, -6.0), "Portugal"),
    "france": ((41.0, 51.8), (-5.7, 9.8), "France"),
    "slovakia": ((47.5, 49.7), (16.8, 22.7), "Slovakia"),
}
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
FFMPEG_FILTERS: set[str] | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create watermarked Reserve thumbnails from developed JPG/TIFF photo exports."
    )
    parser.add_argument(
        "--source-root",
        type=Path,
        default=None,
        help="Lightroom Camera source root. Defaults to the first available Saturn/local Camera folder.",
    )
    parser.add_argument(
        "--developed-root",
        type=Path,
        default=None,
        help="Deprecated no-op. The importer now scans developed JPG/TIFF sources directly.",
    )
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--label", default="green", help="Lightroom color label to include.")
    parser.add_argument("--min-rating", type=float, default=4)
    parser.add_argument(
        "--select",
        choices=("lightroom", "all"),
        default="lightroom",
        help="Require Lightroom rating/label metadata, or select every developed image file.",
    )
    parser.add_argument(
        "--force-country",
        default="",
        help="Force all derivatives into a gallery country bucket, e.g. ai for Leonardo images.",
    )
    parser.add_argument("--gallery-max", type=int, default=DEFAULT_GALLERY_MAX)
    parser.add_argument("--detail-max", type=int, default=DEFAULT_DETAIL_MAX)
    parser.add_argument("--watermark", default=DEFAULT_WATERMARK)
    parser.add_argument("--developed-detail-suffix", default="_1800.jpg")
    parser.add_argument("--developed-gallery-suffix", default="_900.jpg")
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


def resolve_source_root(source_root: Path | None) -> Path:
    if source_root:
        return source_root.expanduser().resolve()
    for candidate in DEFAULT_SOURCE_ROOT_CANDIDATES:
        expanded = candidate.expanduser()
        if expanded.exists():
            return expanded.resolve()
    candidates = ", ".join(str(path) for path in DEFAULT_SOURCE_ROOT_CANDIDATES)
    raise SystemExit(f"Source root does not exist. Tried: {candidates}")


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
    wanted_start, wanted_end = year_filter
    exact_years = []
    range_matches = []
    for part in Path(relative_path).parts:
        ranged = re.match(r"^(\d{4})-(\d{4})$", part)
        if ranged:
            part_start, part_end = int(ranged.group(1)), int(ranged.group(2))
            part_start, part_end = min(part_start, part_end), max(part_start, part_end)
            range_matches.append(part_start <= wanted_end and wanted_start <= part_end)
            continue
        single = re.match(r"^(\d{4})", part)
        if single:
            exact_years.append(int(single.group(1)))
    if exact_years:
        return any(wanted_start <= year <= wanted_end for year in exact_years)
    return any(range_matches)


def path_could_contain_year(relative_path: str, year_filter: tuple[int, int] | None) -> bool:
    if not year_filter or not relative_path:
        return True
    wanted_start, wanted_end = year_filter
    for part in Path(relative_path).parts:
        ranged = re.match(r"^(\d{4})-(\d{4})$", part)
        if ranged:
            part_start, part_end = int(ranged.group(1)), int(ranged.group(2))
            part_start, part_end = min(part_start, part_end), max(part_start, part_end)
            return part_start <= wanted_end and wanted_start <= part_end
        single = re.match(r"^(\d{4})", part)
        if single:
            year = int(single.group(1))
            return wanted_start <= year <= wanted_end
    return True


def file_stamp(path: Path | None) -> dict[str, Any] | None:
    if not path or not path.exists():
        return None
    stat = path.stat()
    return {"mtime_ns": stat.st_mtime_ns, "size": stat.st_size}


def checkpoint_key(image: Path, sidecar: Path | None) -> str:
    payload = {
        "schema_version": SCHEMA_VERSION,
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


def selected_by_args(meta: dict[str, Any], args: argparse.Namespace) -> bool:
    if args.select == "all":
        return True
    return is_selected(meta, args.label, args.min_rating)


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


def source_file_facts(path: Path) -> dict[str, Any]:
    stat = path.stat()
    return {
        "name": path.name,
        "extension": path.suffix.lower().lstrip("."),
        "bytes": stat.st_size,
        "mtime": datetime.fromtimestamp(stat.st_mtime, timezone.utc).replace(microsecond=0).isoformat(),
    }


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


def normalize_country(value: Any) -> tuple[str, str] | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    key = text.casefold()
    if key in COUNTRY_ALIASES:
        return COUNTRY_ALIASES[key]
    slug = re.sub(r"[^a-z0-9]+", "-", key).strip("-")
    return (slug or "unknown", text)


def infer_gallery_country(location: dict[str, Any], keywords: list[str]) -> dict[str, str]:
    explicit = normalize_country(location.get("country"))
    if explicit:
        slug, label = explicit
        return {"slug": slug, "label": label, "source": "country"}
    for keyword in keywords:
        normalized = normalize_country(keyword)
        if normalized and normalized[0] in {value[0] for value in COUNTRY_ALIASES.values()}:
            slug, label = normalized
            return {"slug": slug, "label": label, "source": "keyword"}
    for value in [location.get("region"), location.get("city"), location.get("location"), *keywords]:
        if not value:
            continue
        text = str(value).casefold()
        for hint, country in COUNTRY_HINTS.items():
            if hint in text:
                slug, label = country
                return {"slug": slug, "label": label, "source": "location_hint"}
    return {"slug": "unknown", "label": "Unknown", "source": "unresolved"}


def dms_to_decimal(value: Any) -> float | None:
    text = str(value or "").strip()
    match = re.match(r'^(\d+) deg (\d+)\' ([\d.]+)" ([NSEW])$', text)
    if not match:
        return None
    degrees, minutes, seconds, hemisphere = match.groups()
    decimal = int(degrees) + int(minutes) / 60 + float(seconds) / 3600
    if hemisphere in {"S", "W"}:
        decimal *= -1
    return decimal


def infer_gallery_country_from_gps(gps: dict[str, Any]) -> dict[str, str] | None:
    latitude = dms_to_decimal(gps.get("GPSLatitude"))
    longitude = dms_to_decimal(gps.get("GPSLongitude"))
    if latitude is None or longitude is None:
        return None
    matches = []
    for slug, ((min_lat, max_lat), (min_lon, max_lon), label) in GPS_COUNTRY_BOUNDS.items():
        if min_lat <= latitude <= max_lat and min_lon <= longitude <= max_lon:
            matches.append((slug, label))
    if len(matches) != 1:
        return None
    slug, label = matches[0]
    return {"slug": slug, "label": label, "source": "gps_hint"}


def forced_gallery_country(value: str) -> dict[str, str] | None:
    if not value:
        return None
    normalized = normalize_country(value)
    if normalized:
        slug, label = normalized
    else:
        slug = re.sub(r"[^a-z0-9]+", "-", value.strip().casefold()).strip("-") or "forced"
        label = value.strip() or slug.title()
    return {"slug": slug, "label": label, "source": "forced"}


def parse_exif_datetime(value: Any) -> dict[str, Any]:
    if not value:
        return {}
    text = str(value)
    match = re.match(r"^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})", text)
    if not match:
        return {"raw": text}
    year, month, day, hour, minute, second = (int(part) for part in match.groups())
    return {
        "raw": text,
        "year": year,
        "month": month,
        "day": day,
        "date": f"{year:04d}-{month:02d}-{day:02d}",
        "time": f"{hour:02d}:{minute:02d}:{second:02d}",
        "sort": f"{year:04d}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}:{second:02d}",
    }


def number_value(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def dimension_facts(meta: dict[str, Any]) -> dict[str, Any]:
    width = number_value(metadata_value(meta, "ImageWidth"))
    height = number_value(metadata_value(meta, "ImageHeight"))
    orientation = metadata_value(meta, "Orientation")
    if width and height and orientation_rotates_sideways(orientation):
        width, height = height, width
    facts: dict[str, Any] = {}
    if width and height:
        facts["width"] = int(width)
        facts["height"] = int(height)
        facts["aspect_ratio"] = round(width / height, 4)
        if width > height:
            facts["orientation"] = "landscape"
        elif height > width:
            facts["orientation"] = "portrait"
        else:
            facts["orientation"] = "square"
    megapixels = number_value(metadata_value(meta, "Megapixels"))
    if megapixels is not None:
        facts["megapixels"] = megapixels
    elif width and height:
        facts["megapixels"] = round(width * height / 1000000, 1)
    return facts


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
    capture = parse_exif_datetime(metadata_value(merged, "DateTimeOriginal", "CreateDate"))
    dimensions = dimension_facts(merged)
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
    location = {
        "country": metadata_value(merged, "Country", "Country-PrimaryLocationName"),
        "region": metadata_value(merged, "State", "Province-State"),
        "city": metadata_value(merged, "City"),
        "location": metadata_value(merged, "Location"),
    }
    gallery_country = (
        forced_gallery_country(args.force_country)
        or infer_gallery_country(location, keywords)
    )
    if gallery_country["slug"] == "unknown" and gps:
        gallery_country = infer_gallery_country_from_gps(gps) or gallery_country
    return {
        "rating": normalize_rating(merged.get("Rating")),
        "label": metadata_value(merged, "Label", "ColorLabel"),
        "keywords": keywords,
        "capture": capture,
        "dimensions": dimensions,
        "location": location,
        "gallery_country": gallery_country,
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


def orientation_rotation_degrees(value: Any) -> int:
    text = str(value or "").casefold()
    if "90" in text and "270" not in text:
        return -90
    if "270" in text:
        return 90
    if "180" in text:
        return 180
    return 0


def orientation_rotates_sideways(value: Any) -> bool:
    return abs(orientation_rotation_degrees(value)) in {90, 270}


def normalize_jpeg_orientation(path: Path, orientation: Any) -> None:
    rotation = orientation_rotation_degrees(orientation)
    if not rotation:
        return
    try:
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError(
            "Pillow is required to normalize rotated source photos. Run `python3 -m pip install --user pillow`."
        ) from exc

    with Image.open(path) as image:
        normalized = image.convert("RGB").rotate(rotation, expand=True)
        normalized.save(path, format="JPEG", quality=95)


def ffmpeg_has_filter(name: str) -> bool:
    global FFMPEG_FILTERS
    if FFMPEG_FILTERS is None:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-filters"],
            text=True,
            capture_output=True,
            check=False,
        )
        FFMPEG_FILTERS = set(re.findall(r"^\s*[TSC.]+\s+(\S+)", result.stdout, re.MULTILINE))
    return name in FFMPEG_FILTERS


def apply_pillow_watermark(source: Path, output: Path, watermark: str, font: str, font_size: int, border_width: int, margin: int) -> None:
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError as exc:
        raise RuntimeError(
            "ffmpeg drawtext is unavailable and Pillow is not installed. Run `python3 -m pip install --user pillow`."
        ) from exc

    with Image.open(source) as image:
        image = image.convert("RGB")
        overlay = Image.new("RGBA", image.size, (255, 255, 255, 0))
        draw = ImageDraw.Draw(overlay)
        font_object = ImageFont.truetype(font, font_size)
        bbox = draw.textbbox((0, 0), watermark, font=font_object, stroke_width=border_width)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        position = (
            max(margin, image.width - text_width - margin),
            max(margin, image.height - text_height - margin),
        )
        draw.text(
            position,
            watermark,
            font=font_object,
            fill=(255, 255, 255, 148),
            stroke_width=border_width,
            stroke_fill=(0, 0, 0, 92),
        )
        watermarked = Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")
        watermarked.save(output, format="JPEG", quality=88, optimize=True)


def render_derivative(
    source: Path,
    output: Path,
    max_px: int,
    watermark: str,
    font: str,
    force: bool,
    orientation: Any = None,
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
        normalize_jpeg_orientation(temp_jpg, orientation)
        font_size = max(18, round(max_px / 45))
        border_width = max(1, round(font_size / 14))
        margin = max(18, round(max_px / 36))
        if ffmpeg_has_filter("drawtext"):
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
        else:
            apply_pillow_watermark(temp_jpg, temp_out, watermark, font, font_size, border_width, margin)
        temp_out.replace(output)
    return True


def image_size(path: Path) -> dict[str, Any]:
    result = subprocess.run(
        ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        return {}
    width_match = re.search(r"pixelWidth:\s*(\d+)", result.stdout)
    height_match = re.search(r"pixelHeight:\s*(\d+)", result.stdout)
    if not width_match or not height_match:
        return {}
    width = int(width_match.group(1))
    height = int(height_match.group(1))
    return {
        "width": width,
        "height": height,
        "aspect_ratio": round(width / height, 4) if height else None,
        "bytes": path.stat().st_size if path.exists() else 0,
    }


def derivative_facts(output_root: Path, relative_path: str) -> dict[str, Any]:
    path = output_root / relative_path
    facts = image_size(path)
    facts["path"] = relative_path
    return facts


def load_manifest(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    try:
        rows = json.loads(path.read_text(encoding="utf-8")).get("photos", [])
    except json.JSONDecodeError:
        return {}
    return {row["relative_path"]: row for row in rows if "relative_path" in row}


def manifest_years(rows: dict[str, dict[str, Any]]) -> list[int]:
    years = {
        int(year)
        for row in rows.values()
        for year in [row.get("capture", {}).get("year")]
        if isinstance(year, int) or (isinstance(year, str) and year.isdigit())
    }
    return sorted(years)


def requested_years(value: str) -> list[int]:
    parsed = parse_year_filter(value)
    if not parsed:
        return []
    start, end = parsed
    return list(range(start, end + 1))


def run_filter(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "select": args.select,
        "label": args.label,
        "min_rating": args.min_rating,
        "years": args.years or None,
        "force_country": args.force_country or None,
    }


def write_manifest(path: Path, rows: dict[str, dict[str, Any]], args: argparse.Namespace) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    years = requested_years(args.years) or manifest_years(rows)
    payload = {
        "generated_at": now_iso(),
        "schema_version": SCHEMA_VERSION,
        "source_root_hint": str(args.source_root),
        "selection": {
            "select": args.select,
            "label": args.label,
            "min_rating": args.min_rating,
            "years": years,
            "force_country": args.force_country or None,
        },
        "last_run": {
            "source_root_hint": str(args.source_root),
            "filter": run_filter(args),
        },
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


def load_failures(path: Path) -> dict[str, dict[str, Any]]:
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
        "schema_version": SCHEMA_VERSION,
        "source_root_hint": str(args.source_root),
        "private": True,
        "note": "Exact GPS metadata kept outside manifest.json so this file can stay untracked.",
        "photos": sorted(rows.values(), key=lambda row: row["relative_path"]),
    }
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def write_failures(path: Path, rows: dict[str, dict[str, Any]], args: argparse.Namespace) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": now_iso(),
        "schema_version": SCHEMA_VERSION,
        "source_root_hint": str(args.source_root),
        "count": len(rows),
        "photos": sorted(rows.values(), key=lambda row: row["relative_path"]),
    }
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def add_index_value(index: dict[str, dict[str, Any]], key: Any, photo_id: str, relative_path: str) -> None:
    if key in (None, ""):
        return
    text = str(key)
    row = index.setdefault(text, {"value": text, "count": 0, "photos": []})
    row["count"] += 1
    row["photos"].append({"id": photo_id, "relative_path": relative_path})


def write_keyword_index(path: Path, manifest: dict[str, dict[str, Any]]) -> None:
    index: dict[str, dict[str, Any]] = {}
    for photo in manifest.values():
        for keyword in photo.get("keywords", []):
            add_index_value(index, keyword, photo["id"], photo["relative_path"])
    payload = {
        "generated_at": now_iso(),
        "schema_version": SCHEMA_VERSION,
        "photos_count": len(manifest),
        "keywords": sorted(index.values(), key=lambda row: (-row["count"], row["value"].casefold())),
    }
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def write_collection_index(path: Path, manifest: dict[str, dict[str, Any]]) -> None:
    indexes = {
        "years": {},
        "countries": {},
        "gallery_countries": {},
        "regions": {},
        "cities": {},
        "orientations": {},
        "formats": {},
    }
    for photo in manifest.values():
        capture = photo.get("capture", {})
        location = photo.get("location", {})
        gallery_country = photo.get("gallery_country", {})
        dimensions = photo.get("dimensions", {})
        source = photo.get("source_file", {})
        add_index_value(indexes["years"], capture.get("year"), photo["id"], photo["relative_path"])
        add_index_value(indexes["countries"], location.get("country"), photo["id"], photo["relative_path"])
        add_index_value(indexes["gallery_countries"], gallery_country.get("slug"), photo["id"], photo["relative_path"])
        add_index_value(indexes["regions"], location.get("region"), photo["id"], photo["relative_path"])
        add_index_value(indexes["cities"], location.get("city"), photo["id"], photo["relative_path"])
        add_index_value(indexes["orientations"], dimensions.get("orientation"), photo["id"], photo["relative_path"])
        add_index_value(indexes["formats"], source.get("extension"), photo["id"], photo["relative_path"])
    payload = {
        "generated_at": now_iso(),
        "schema_version": SCHEMA_VERSION,
        "photos_count": len(manifest),
        "collections": {
            name: sorted(rows.values(), key=lambda row: (-row["count"], row["value"].casefold()))
            for name, rows in indexes.items()
        },
    }
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def derivative_paths(output_root: Path, country_slug: str, slug: str) -> tuple[Path, Path]:
    return output_root / country_slug / f"{slug}_900.jpg", output_root / country_slug / f"{slug}_1800.jpg"


def render_sources_for(
    source: Path,
    args: argparse.Namespace,
) -> tuple[Path, Path, dict[str, Any] | None, Any]:
    return source, source, None, None


def should_skip_metadata(row: dict[str, Any] | None, stamp: str, force: bool) -> bool:
    if force or not row:
        return False
    return row.get("checkpoint") == stamp


def manifest_derivatives_exist(output_root: Path, row: dict[str, Any] | None) -> bool:
    if not row:
        return False
    derivatives = row.get("derivatives", {})
    return bool(derivatives) and all((output_root / rel_path).exists() for rel_path in derivatives.values())


def discover_images(source_root: Path, year_filter: tuple[int, int] | None = None) -> Any:
    for root, dirs, files in os.walk(source_root):
        dirs[:] = sorted(
            (
                name
                for name in dirs
                if not name.startswith(".")
                and path_could_contain_year(rel_key(Path(root) / name, source_root), year_filter)
            ),
            reverse=True,
        )
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
    failures: dict[str, dict[str, Any]],
    font: str,
    selection_limit: int | None = None,
) -> int:
    metadata_rows = run_exiftool([item["metadata_path"] for item in batch])
    by_source = {Path(row.get("SourceFile", "")).resolve(): row for row in metadata_rows}
    rendered_count = 0
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
        if not selected_by_args(meta, args):
            append_state(state_path, {**base_state, "status": "skipped"})
            continue

        try:
            slug = slug_for(relative_path)
            selected_metadata = merged_selected_metadata(source, metadata_path, args)
            gallery_country = selected_metadata["gallery_country"]
            gallery_path, detail_path = derivative_paths(args.output_root, gallery_country["slug"], slug)
            row = {
                "id": slug,
                "relative_path": relative_path,
                "source_path_hint": str(source),
                "metadata_path_hint": str(metadata_path),
                "gallery_country": gallery_country,
                "derivatives": {
                    "gallery": gallery_path.relative_to(args.output_root).as_posix(),
                    "detail": detail_path.relative_to(args.output_root).as_posix(),
                },
            }
            row["rating"] = selected_metadata["rating"]
            row["label"] = selected_metadata["label"]
            row["keywords"] = selected_metadata["keywords"]
            row["capture"] = selected_metadata["capture"]
            row["dimensions"] = selected_metadata["dimensions"]
            row["location"] = selected_metadata["location"]
            row["source_file"] = source_file_facts(source)
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
                gallery_source, detail_source, developed_files, orientation_override = render_sources_for(source, args)
                source_orientation = orientation_override or selected_metadata["raw"].get("Orientation")
                render_derivative(gallery_source, gallery_path, args.gallery_max, args.watermark, font, args.force, source_orientation)
                render_derivative(detail_source, detail_path, args.detail_max, args.watermark, font, args.force, source_orientation)
                if developed_files:
                    row["developed_files"] = developed_files
                row["derivative_files"] = {
                    "gallery": derivative_facts(args.output_root, row["derivatives"]["gallery"]),
                    "detail": derivative_facts(args.output_root, row["derivatives"]["detail"]),
                    "generated_at": now_iso(),
                }
            manifest[relative_path] = row
            failures.pop(relative_path, None)
            append_state(state_path, {**base_state, "status": "rendered" if not args.dry_run else "selected"})
            rendered_count += 1
            if selection_limit and rendered_count >= selection_limit:
                break
        except Exception as exc:
            failures[relative_path] = {
                **base_state,
                "status": "error",
                "error": str(exc),
                "failed_at": now_iso(),
            }
            append_state(state_path, {**base_state, "status": "error", "error": str(exc)})
            print(f"ERROR {relative_path}: {exc}", file=sys.stderr)
    return rendered_count


def main() -> int:
    args = parse_args()
    source_root = resolve_source_root(args.source_root)
    args.source_root = source_root
    args.developed_root = args.developed_root.expanduser().resolve() if args.developed_root else None
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
    keywords_path = args.output_root / "keywords.json"
    collections_path = args.output_root / "collections.json"
    failures_path = args.output_root / "failures.json"
    state_path = args.output_root / ".build-state.jsonl"
    args.output_root.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest(manifest_path)
    gps_manifest = load_gps_manifest(gps_manifest_path) if not args.redact_gps else {}
    failures = load_failures(failures_path)
    state = load_latest_state(state_path) if not args.force else {}

    if args.clean_missing:
        manifest = {
            rel: row
            for rel, row in manifest.items()
            if all((args.output_root / path).exists() for path in row.get("derivatives", {}).values())
        }

    seen = selected = inspected = 0
    batch: list[dict[str, Any]] = []
    for source in discover_images(source_root, year_filter):
        relative_path = rel_key(source, source_root)
        if not matches_year_filter(relative_path, year_filter):
            continue
        seen += 1
        sidecar = sidecar_for(source)
        metadata_path = sidecar or source
        stamp = checkpoint_key(source, sidecar)
        if source.stat().st_size == 0:
            append_state(
                state_path,
                {
                    "relative_path": relative_path,
                    "checkpoint": stamp,
                    "source_path_hint": str(source),
                    "metadata_path_hint": str(metadata_path),
                    "status": "skipped",
                    "reason": "empty source file",
                },
            )
            continue
        prior = state.get(relative_path)
        if should_skip_metadata(prior, stamp, args.force):
            prior_status = prior.get("status")
            if prior_status == "skipped":
                continue
            if prior_status in {"rendered", "selected"} and relative_path in manifest:
                if args.dry_run or manifest_derivatives_exist(args.output_root, manifest.get(relative_path)):
                    selected += 1
                    if args.limit and selected >= args.limit:
                        break
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
            print(f"Processing batch after scanning {seen} files; inspected {inspected}, selected {selected}", flush=True)
            selection_limit = max(0, args.limit - selected) if args.limit else None
            selected += process_batch(batch, args, state_path, manifest, gps_manifest, failures, font, selection_limit)
            write_manifest(manifest_path, manifest, args)
            write_keyword_index(keywords_path, manifest)
            write_collection_index(collections_path, manifest)
            write_failures(failures_path, failures, args)
            if not args.redact_gps:
                write_gps_manifest(gps_manifest_path, gps_manifest, args)
            batch = []
            print(f"Scanned {seen} files, inspected {inspected}, selected {selected}", flush=True)
            if args.limit and selected >= args.limit:
                break
    if batch and (not args.limit or selected < args.limit):
        inspected += len(batch)
        print(f"Processing final batch after scanning {seen} files; inspected {inspected}, selected {selected}", flush=True)
        selection_limit = max(0, args.limit - selected) if args.limit else None
        selected += process_batch(batch, args, state_path, manifest, gps_manifest, failures, font, selection_limit)
        write_manifest(manifest_path, manifest, args)
        write_keyword_index(keywords_path, manifest)
        write_collection_index(collections_path, manifest)
        write_failures(failures_path, failures, args)
        if not args.redact_gps:
            write_gps_manifest(gps_manifest_path, gps_manifest, args)

    write_manifest(manifest_path, manifest, args)
    write_keyword_index(keywords_path, manifest)
    write_collection_index(collections_path, manifest)
    write_failures(failures_path, failures, args)
    if not args.redact_gps:
        write_gps_manifest(gps_manifest_path, gps_manifest, args)
    print(f"Done. Saw {seen} images, inspected {inspected}, manifest contains {len(manifest)} selected photos.")
    print(f"Manifest: {manifest_path}")
    print(f"Keyword index: {keywords_path}")
    print(f"Collection index: {collections_path}")
    print(f"Failures: {failures_path}")
    if not args.redact_gps:
        print(f"Private GPS metadata: {gps_manifest_path}")
    print(f"Checkpoint: {state_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
