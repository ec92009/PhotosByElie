from __future__ import annotations

from pathlib import Path


DEFAULT_PUBLIC_PREFIX = "expo"


def prefixed_key(prefix: str, *parts: str) -> str:
    clean = [str(part).strip("/") for part in [prefix, *parts] if str(part or "").strip("/")]
    return "/".join(clean)


def public_preview_key(public_prefix: str, photo_id: str, derivative: str, media_type: str = "photo") -> str:
    if derivative == "gallery":
        return prefixed_key(public_prefix, f"{photo_id}_900.jpg")
    if str(media_type).lower() == "video":
        return prefixed_key(public_prefix, f"{photo_id}_short_5s_720p.mp4")
    return prefixed_key(public_prefix, f"{photo_id}_1800.jpg")


def public_preview_key_for_reference(public_prefix: str, photo_id: str, reference: str | Path | None) -> str:
    name = Path(str(reference or "")).name.lower()
    if name.endswith("_900.jpg"):
        return public_preview_key(public_prefix, photo_id, "gallery")
    if name.endswith("_short_5s_720p.mp4"):
        return public_preview_key(public_prefix, photo_id, "detail", "video")
    return public_preview_key(public_prefix, photo_id, "detail")


def legacy_public_preview_key(public_prefix: str, reference: str | Path | None) -> str:
    clean = str(reference or "").removeprefix("./")
    parts = clean.split("/")
    if len(parts) >= 4 and parts[0] == "assets" and parts[1] in {"expo", "reserve"}:
        return prefixed_key(public_prefix, *parts[2:])
    return clean
