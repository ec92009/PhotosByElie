#!/usr/bin/env python3
"""Merge an incremental Real Estate app-context into an existing client context.

This is for refreshes where the original client sources are no longer mounted but
their already-published R2 objects and metadata must remain available.  The base
context keeps its customer, access, workflow, and R2 configuration; albums and
photos from the incremental context are appended or replaced by stable slug/id.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


PAYLOAD_RE = re.compile(
    r"(?P<prefix>.*?const payload = )(?P<payload>\{.*?\n\});(?P<suffix>\n\s*const script.*)",
    re.DOTALL,
)


def read_context(path: Path) -> tuple[str, dict[str, Any], str]:
    text = path.read_text(encoding="utf-8")
    match = PAYLOAD_RE.fullmatch(text)
    if match is None:
        raise ValueError(f"Could not locate app-context payload in {path}")
    payload = json.loads(match.group("payload"))
    return match.group("prefix"), payload, match.group("suffix")


def merge_keyed(base: list[dict[str, Any]], additions: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    merged = [dict(item) for item in base]
    positions = {str(item.get(key) or ""): index for index, item in enumerate(merged)}
    for item in additions:
        clean = dict(item)
        identity = str(clean.get(key) or "")
        if identity and identity in positions:
            merged[positions[identity]] = clean
        else:
            positions[identity] = len(merged)
            merged.append(clean)
    return merged


def media_type(photo: dict[str, Any]) -> str:
    return str((photo.get("media") or {}).get("type") or "photo").lower()


def merge_payload(base: dict[str, Any], additions: dict[str, Any]) -> dict[str, Any]:
    merged = json.loads(json.dumps(base))

    albums = merge_keyed(base.get("albums") or [], additions.get("albums") or [], "slug")
    for index, album in enumerate(albums, start=1):
        album["sortIndex"] = index
    merged["albums"] = albums

    photos = merge_keyed(base.get("photos") or [], additions.get("photos") or [], "id")
    for index, photo in enumerate(photos, start=1):
        photo["sortIndex"] = index
    merged["photos"] = photos
    merged.setdefault("gallery", {})["photos"] = photos

    base_stats = base.get("stats") or {}
    addition_stats = additions.get("stats") or {}
    stats = dict(base_stats)
    stats["albumCount"] = len(albums)
    stats["photoCount"] = len(photos)
    stats["imageCount"] = sum(media_type(photo) != "video" for photo in photos)
    stats["videoCount"] = sum(media_type(photo) == "video" for photo in photos)
    for field in ("sourceBytes", "preview900Bytes", "preview1800Bytes"):
        stats[field] = int(base_stats.get(field) or 0) + int(addition_stats.get(field) or 0)
    for field in ("preview900Rendered", "preview1800Rendered"):
        stats[field] = int(base_stats.get(field) or 0) + int(addition_stats.get(field) or 0)
    merged["stats"] = stats
    merged["generatedAt"] = additions.get("generatedAt") or datetime.now(UTC).isoformat()
    return merged


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--additions", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    prefix, base, suffix = read_context(args.base)
    _addition_prefix, additions, _addition_suffix = read_context(args.additions)
    merged = merge_payload(base, additions)
    output = args.output or args.base
    output.write_text(
        prefix + json.dumps(merged, indent=2, sort_keys=True) + ";" + suffix,
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(output),
                "albums": len(merged.get("albums") or []),
                "photos": len(merged.get("photos") or []),
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
