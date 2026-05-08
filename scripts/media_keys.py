from __future__ import annotations

from pathlib import Path


DEFAULT_PUBLIC_PREFIX = "expo"


def prefixed_key(prefix: str, *parts: str) -> str:
    clean = [str(part).strip("/") for part in [prefix, *parts] if str(part or "").strip("/")]
    return "/".join(clean)


def public_preview_key(public_prefix: str, photo_id: str, derivative: str) -> str:
    suffix = "900" if derivative == "gallery" else "1800"
    return prefixed_key(public_prefix, f"{photo_id}_{suffix}.jpg")


def public_preview_key_for_reference(public_prefix: str, photo_id: str, reference: str | Path | None) -> str:
    name = Path(str(reference or "")).name.lower()
    derivative = "gallery" if name.endswith("_900.jpg") else "detail"
    return public_preview_key(public_prefix, photo_id, derivative)


def legacy_public_preview_key(public_prefix: str, reference: str | Path | None) -> str:
    clean = str(reference or "").removeprefix("./")
    parts = clean.split("/")
    if len(parts) >= 4 and parts[0] == "assets" and parts[1] in {"expo", "reserve"}:
        return prefixed_key(public_prefix, *parts[2:])
    return clean
