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


def normalized_private_extension(value: str | Path | None) -> str:
    extension = str(value or "").strip().lower().removeprefix(".")
    if not extension:
        return "jpg"
    if extension in {"jpeg", "jpe"}:
        return "jpg"
    if extension in {"tiff"}:
        return "tif"
    if extension == "m4v":
        return "mp4"
    return extension


def private_master_key(private_prefix: str, media_id: str, source_path: str | Path) -> str:
    suffix = Path(str(source_path or "")).suffix
    return prefixed_key(private_prefix, f"{media_id}.{normalized_private_extension(suffix)}")


def legacy_private_master_key(private_prefix: str, media_id: str, source_path: str | Path) -> str:
    return prefixed_key(private_prefix, media_id, Path(str(source_path or "")).name)


def private_render_key(media_id: str, product_id: str) -> str:
    product = str(product_id or "").lower()
    suffix = product.replace("jpg-", "")
    return prefixed_key("renders", f"{media_id}_{suffix}.jpg")
