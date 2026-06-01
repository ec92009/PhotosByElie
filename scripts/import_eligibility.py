from __future__ import annotations

from pathlib import Path
from typing import Any


DEFAULT_LABEL = "green"
DEFAULT_MIN_RATING = 4.0


def normalize_label(value: object) -> str:
    return str(value or "").strip().casefold()


def metadata_label(meta: dict[str, Any]) -> str:
    return normalize_label(meta.get("Label") or meta.get("ColorLabel") or meta.get("label"))


def normalize_rating(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def metadata_rating(meta: dict[str, Any]) -> float:
    return normalize_rating(meta.get("Rating") if "Rating" in meta else meta.get("rating"))


def lightroom_selected(meta: dict[str, Any], expected_label: str = DEFAULT_LABEL, min_rating: float = DEFAULT_MIN_RATING) -> bool:
    return metadata_rating(meta) >= min_rating and metadata_label(meta) == normalize_label(expected_label)


def green_selected(meta: dict[str, Any], expected_label: str = DEFAULT_LABEL, min_rating: float = DEFAULT_MIN_RATING) -> bool:
    if metadata_label(meta) != normalize_label(expected_label):
        return False
    rating = metadata_rating(meta)
    return rating <= 0 or rating >= min_rating


def path_text(value: object) -> str:
    return str(value or "").replace("\\", "/").casefold()


def source_kind_from_path(value: object) -> str:
    text = path_text(value)
    if not text:
        return ""
    if "apple photo albums" in text:
        return "apple-photo-albums"
    if "_all leonardo" in text or "leonardo" in text or "_seamless" in text:
        return "leonardo"
    parts = [part for part in text.split("/") if part]
    if "camera" in parts:
        return "camera"
    return ""


def source_paths_from_row(row: dict[str, Any]) -> list[str]:
    values: list[str] = []
    for key in ("source_path_hint", "sourcePath", "source_path", "path"):
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            values.append(value)
    source_file = row.get("sourceFile")
    if isinstance(source_file, dict):
        value = source_file.get("path")
        if isinstance(value, str) and value.strip():
            values.append(value)
    elif isinstance(source_file, str) and source_file.strip():
        values.append(source_file)
    source_files = row.get("sourceFiles")
    if isinstance(source_files, list):
        for source in source_files:
            if isinstance(source, dict):
                value = source.get("path")
                if isinstance(value, str) and value.strip():
                    values.append(value)
            elif isinstance(source, str) and source.strip():
                values.append(source)
    return values


def source_kind_from_row(row: dict[str, Any]) -> str:
    for value in source_paths_from_row(row):
        kind = source_kind_from_path(value)
        if kind:
            return kind
    relative_path = str(row.get("relative_path") or row.get("relativePath") or "")
    kind = source_kind_from_path(relative_path)
    if kind:
        return kind
    gallery_country = row.get("gallery_country") or row.get("galleryCountry") or {}
    slug = gallery_country.get("slug") if isinstance(gallery_country, dict) else gallery_country
    if str(slug or "").strip().casefold() == "ai":
        return "leonardo"
    source_origin = str(row.get("sourceOrigin") or row.get("source_origin") or row.get("source_mode") or "").casefold()
    if source_origin in {"ai", "leonardo"}:
        return "leonardo"
    return ""


def row_import_eligible(
    row: dict[str, Any],
    expected_label: str = DEFAULT_LABEL,
    min_rating: float = DEFAULT_MIN_RATING,
) -> tuple[bool, str, str]:
    kind = source_kind_from_row(row)
    if kind == "camera":
        if lightroom_selected(row, expected_label, min_rating):
            return True, kind, "Green and 4+ stars"
        return False, kind, "Camera source is not Green with 4+ stars"
    if kind == "apple-photo-albums":
        return True, kind, "apple photo album membership"
    if kind == "leonardo":
        return True, kind, "AI source allowed"
    return True, kind or "other", "no Lightroom selection policy"


def import_select_for_source_root(source_root: object) -> str:
    kind = source_kind_from_path(source_root)
    return "lightroom" if kind == "camera" else "all"


def photo_id_for_row(row: dict[str, Any]) -> str:
    return str(row.get("id") or row.get("photoId") or row.get("media_id") or "").strip()


def manifest_rows(payload: object) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    rows = payload.get("photos")
    if isinstance(rows, list):
        return [row for row in rows if isinstance(row, dict)]
    return [row for row in payload.values() if isinstance(row, dict)]


def source_filename(row: dict[str, Any]) -> str:
    for value in source_paths_from_row(row):
        name = Path(str(value)).name
        if name:
            return name
    relative = str(row.get("relative_path") or row.get("relativePath") or "")
    return Path(relative).name
