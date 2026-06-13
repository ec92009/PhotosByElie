from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def normalize_import_source_path(value: object) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return Path(text).expanduser().resolve(strict=False).as_posix()
    except OSError:
        return Path(text).expanduser().as_posix()


def import_anchor_for_path(path: Path) -> dict[str, Any]:
    stat = path.stat()
    return {
        "path": normalize_import_source_path(path),
        "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).replace(microsecond=0).isoformat(),
        "modified_ns": stat.st_mtime_ns,
    }


def photo_id_for_source_path(path: Path | str) -> str:
    normalized = normalize_import_source_path(path) or str(path)
    stem = Path(normalized).stem
    base = re.sub(r"[^a-zA-Z0-9]+", "-", stem).strip("-").lower() or "photo"
    digest = hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:10]
    return f"{base}-{digest}"


def _int_value(value: object) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _iso_to_ns(value: object) -> int | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp() * 1_000_000_000)


def source_paths_from_row(row: dict[str, Any]) -> set[str]:
    paths: set[str] = set()
    anchor = row.get("source_anchor")
    if isinstance(anchor, dict):
        normalized = normalize_import_source_path(anchor.get("path"))
        if normalized:
            paths.add(normalized)
    for key in ("source_path_hint", "sourcePath", "source_path"):
        normalized = normalize_import_source_path(row.get(key))
        if normalized:
            paths.add(normalized)
    source_file = row.get("source_file")
    if isinstance(source_file, dict):
        normalized = normalize_import_source_path(source_file.get("path"))
        if normalized:
            paths.add(normalized)
    for key in ("sourceFiles", "source_files"):
        values = row.get(key)
        if not isinstance(values, list):
            continue
        for value in values:
            if isinstance(value, dict):
                normalized = normalize_import_source_path(value.get("path"))
            else:
                normalized = normalize_import_source_path(value)
            if normalized:
                paths.add(normalized)
    return paths


def row_source_modified_ns(row: dict[str, Any]) -> int | None:
    anchor = row.get("source_anchor")
    if isinstance(anchor, dict):
        value = _int_value(anchor.get("modified_ns") or anchor.get("modifiedNs"))
        if value is not None:
            return value
        value = _iso_to_ns(anchor.get("modified_at") or anchor.get("modifiedAt"))
        if value is not None:
            return value
    source_file = row.get("source_file")
    if isinstance(source_file, dict):
        value = _int_value(source_file.get("mtime_ns") or source_file.get("modified_ns") or source_file.get("modifiedNs"))
        if value is not None:
            return value
        value = _iso_to_ns(source_file.get("mtime") or source_file.get("modified_at") or source_file.get("modifiedAt"))
        if value is not None:
            return value
    return _int_value(row.get("source_modified_ns") or row.get("sourceModifiedNs"))


def row_freshness_key(row: dict[str, Any]) -> tuple[int, str, str, str]:
    return (
        row_source_modified_ns(row) or -1,
        str(row.get("source_checkpoint") or ""),
        str(row.get("id") or ""),
        str(row.get("relative_path") or row.get("relativePath") or ""),
    )
