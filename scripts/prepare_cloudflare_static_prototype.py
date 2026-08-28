#!/usr/bin/env python3
"""Stage a privacy-safe representative storefront for the PBE-174 prototype."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path
from typing import Any


MARKER = ".pbe-174-generated"
DEFAULT_OUTPUT = Path("experiments/pbe-174-cloudflare-static-assets/dist")
ROOT_FILES = (
    "index.html",
    "gallery.html",
    "photo.html",
    "support.html",
    "privacy.html",
    "terms.html",
    "data-deletion.html",
    "site.webmanifest",
    "shared.css",
    "styles.css",
    "photos.css",
    "media-config.js",
    "photos.js",
    "site-version.js",
    "analytics.js",
    "catalog-sqlite.js",
    "photos-data.js",
    "shared-gallery-store.js",
    "reserve-store.js",
    "liked-store.js",
    "basket-store.js",
    "gallery-card.js",
    "gallery-layout.js",
    "gallery-hero.js",
    "gallery-date-picker.js",
    "gallery-commands.js",
    "photo-gallery.js",
    "photo-detail.js",
    "basket-rail.js",
)
PUBLIC_FILES = (
    "assets/catalog/photosbyelie.sqlite",
    "assets/catalog/product-pricing.json",
    "assets/apple-photos/2025-2026-app-contexts.js",
    "assets/apple-photos/2025/2025-cordoba-la-mezquita/app-context.js",
    "assets/apple-photos/2026/2026-malaga-museo-ruso/app-context.js",
    "assets/apple-photos/2026/2026-nerja-caves/app-context.js",
    "assets/video-trial/cordoba/app-context.js",
)
PUBLIC_TREES = (
    "assets/branding",
    "assets/gallery-heroes",
    "assets/backgrounds",
    "assets/usage-guide",
    "landing-concept",
)
FORBIDDEN_PARTS = {
    "owner-actions",
    "private",
    "masters",
    ".dev.vars",
    ".env",
    "node_modules",
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _copy(source_root: Path, output: Path, relative: Path) -> None:
    if FORBIDDEN_PARTS & set(relative.parts):
        raise ValueError(f"refusing forbidden prototype path: {relative}")
    source = source_root / relative
    if not source.is_file():
        raise FileNotFoundError(f"required public prototype file is missing: {relative}")
    target = output / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def prepare(source_root: Path, output: Path, *, replace: bool = False) -> dict[str, Any]:
    source_root = source_root.resolve(strict=True)
    output = output.resolve()
    if output.exists():
        marker = output / MARKER
        if not replace or not marker.is_file():
            raise ValueError(f"output already exists without an approved generated marker: {output}")
        shutil.rmtree(output)
    output.mkdir(parents=True)
    (output / MARKER).write_text("PBE-174 generated prototype\n", encoding="utf-8")

    for value in ROOT_FILES:
        _copy(source_root, output, Path(value))
    for value in PUBLIC_FILES:
        _copy(source_root, output, Path(value))
    for value in PUBLIC_TREES:
        tree = source_root / value
        if not tree.is_dir():
            raise FileNotFoundError(f"required public prototype tree is missing: {value}")
        for source in sorted(path for path in tree.rglob("*") if path.is_file()):
            _copy(source_root, output, source.relative_to(source_root))

    (output / "_headers").write_text(
        "/*\n  X-Robots-Tag: noindex\n\n"
        "/assets/catalog/photosbyelie.sqlite\n"
        "  Cache-Control: public, max-age=0, must-revalidate\n",
        encoding="utf-8",
    )
    (output / ".assetsignore").write_text(
        f"{MARKER}\n**/__pycache__/**\n*.pyc\n",
        encoding="utf-8",
    )
    files = sorted(path for path in output.rglob("*") if path.is_file())
    relative_files = [path.relative_to(output) for path in files]
    forbidden = [str(path) for path in relative_files if FORBIDDEN_PARTS & set(path.parts)]
    if forbidden:
        raise ValueError(f"forbidden paths reached prototype: {forbidden[:5]}")
    source_catalog = source_root / "assets/catalog/photosbyelie.sqlite"
    staged_catalog = output / "assets/catalog/photosbyelie.sqlite"
    if _sha256(source_catalog) != _sha256(staged_catalog):
        raise ValueError("staged catalog is not byte-identical to the tracked source catalog")
    report = {
        "schema": "photosbyelie.cloudflare-static-prototype.v1",
        "productionMutation": False,
        "routes": [],
        "customDomains": [],
        "robots": "noindex",
        "fileCount": len(files),
        "bytes": sum(path.stat().st_size for path in files),
        "largestFileBytes": max(path.stat().st_size for path in files),
        "catalogBytes": staged_catalog.stat().st_size,
        "catalogSha256": _sha256(staged_catalog),
        "forbiddenPathCount": 0,
    }
    print(json.dumps(report, indent=2, sort_keys=True))
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()
    output = args.output if args.output.is_absolute() else args.repo_root / args.output
    prepare(args.repo_root, output, replace=args.replace)


if __name__ == "__main__":
    main()
