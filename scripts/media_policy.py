#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from typing import Any

DEVELOPED_IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".tif",
    ".tiff",
}

DEVELOPED_VIDEO_EXTENSIONS = {
    ".mov",
    ".mp4",
    ".m4v",
}

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

DEVELOPED_SOURCE_TYPES = {
    extension.removeprefix(".").upper()
    for extension in DEVELOPED_IMAGE_EXTENSIONS | DEVELOPED_VIDEO_EXTENSIONS
}
RAW_SOURCE_TYPES = {extension.removeprefix(".").upper() for extension in RAW_IMAGE_EXTENSIONS}


def normalized_source_type(value: object) -> str:
    text = str(value or "").strip().upper().removeprefix(".")
    if text == "JPEG":
        return "JPG"
    if text == "TIFF":
        return "TIF"
    return text


def source_file_entries(row: dict[str, Any]) -> list[dict[str, Any]]:
    existing = row.get("sourceFiles")
    if isinstance(existing, list) and existing:
        return [
            {
                **entry,
                "type": normalized_source_type(entry.get("type") or Path(str(entry.get("path") or "")).suffix),
            }
            for entry in existing
            if isinstance(entry, dict)
        ]

    source = row.get("source_file") or {}
    if not isinstance(source, dict):
        source = {}
    source_type = normalized_source_type(source.get("extension") or Path(str(row.get("relative_path") or "")).suffix)
    if not source_type:
        return []
    return [
        {
            "path": row.get("relative_path"),
            "type": source_type,
            "bytes": source.get("bytes"),
        }
    ]


def source_types(row: dict[str, Any]) -> set[str]:
    return {
        normalized_source_type(entry.get("type") or Path(str(entry.get("path") or "")).suffix)
        for entry in source_file_entries(row)
        if normalized_source_type(entry.get("type") or Path(str(entry.get("path") or "")).suffix)
    }


def has_raw_source(row: dict[str, Any]) -> bool:
    return bool(source_types(row) & RAW_SOURCE_TYPES)


def has_developed_source(row: dict[str, Any]) -> bool:
    return bool(source_types(row) & DEVELOPED_SOURCE_TYPES)


def public_preview_allowed(row: dict[str, Any]) -> bool:
    return has_developed_source(row) and not has_raw_source(row)


def private_master_allowed(row: dict[str, Any]) -> bool:
    return has_developed_source(row) and not has_raw_source(row)


def media_source_policy(row: dict[str, Any]) -> str:
    if has_raw_source(row):
        return "raw-local-only"
    if has_developed_source(row):
        return "developed-master"
    return "unverified"
