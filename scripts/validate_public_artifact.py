"""Validate a staged customer artifact without creating or changing Owner state."""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import subprocess
import xml.etree.ElementTree as ET
from contextlib import closing
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit

from scripts.public_artifact_policy import (
    CATALOG,
    IDENTITY,
    NEGATIVE_PATHS,
    RECEIPT,
    public_path,
    regular_file,
    release_identity,
    sha256,
    source_files,
)


class PageReferences(HTMLParser):
    """Collect browser-loaded resources and navigable links from static markup."""

    def __init__(self) -> None:
        super().__init__()
        self.references: list[str] = []
        self.scripts: list[str] = []
        self.indexable = True

    def handle_starttag(self, tag: str, attributes: list[tuple[str, str | None]]) -> None:
        attrs = dict(attributes)
        if tag == "script" and attrs.get("src"):
            self.scripts.append(attrs["src"])
        self.references.extend(
            value for name, value in attributes if name in {"src", "href", "poster"} and value
        )
        if attrs.get("srcset"):
            self.references.extend(part.strip().split()[0] for part in attrs["srcset"].split(","))
        if tag == "meta" and attrs.get("name", "").lower() == "robots":
            self.indexable = "noindex" not in attrs.get("content", "").lower()


def local_reference(page: str, reference: str) -> str | None:
    """Resolve relative browser references using URL semantics, including nested pages."""
    parsed = urlsplit(reference)
    if (parsed.scheme or parsed.netloc) and parsed.netloc not in {
        "photos-by-elie.com",
        "www.photos-by-elie.com",
    }:
        return None
    if not parsed.path:
        return None
    value = unquote(parsed.path)
    if "\\" in value:
        raise ValueError(f"ambiguous browser reference in {page}: {reference}")
    parts: list[str] = []
    parent = "" if value.startswith("/") else str(PurePosixPath(page).parent)
    for part in (parent + "/" + value).split("/"):
        if part == "..":
            if not parts:
                raise ValueError(f"browser reference escapes artifact in {page}: {reference}")
            parts.pop()
        elif part not in {"", "."}:
            parts.append(part)
    resolved = "/".join(parts)
    if value.endswith("/") or not resolved:
        resolved += "/index.html" if resolved else "index.html"
    return resolved


def check_references(site: Path, paths: set[str], version: str) -> int:
    """Reject missing resources, accidental prototype robots policy, and version drift."""
    checked = 0
    for name in sorted(paths):
        file = site / name
        references: list[str] = []
        if file.suffix == ".html":
            markup = file.read_text(encoding="utf-8")
            parser = PageReferences()
            parser.feed(markup)
            references = parser.references
            entity = name.startswith(("photo--", "gallery--"))
            scripts = [local_reference(name, reference) for reference in parser.scripts]
            initializers = [
                index
                for index, script in enumerate(scripts)
                if script in {"photos.js", "landing-concept/landing.js"}
            ]
            if "theme-preference.js" in paths and initializers:
                if "theme-preference.js" not in scripts or scripts.index(
                    "theme-preference.js"
                ) > min(initializers):
                    raise ValueError(
                        f"theme preference must load before customer initialization: {name}"
                    )
            if "customer-recovery.js" in paths and (
                entity or name in {"gallery.html", "photo.html", "basket.html"}
            ):
                if "customer-recovery.js" not in scripts or (
                    initializers and scripts.index("customer-recovery.js") > min(initializers)
                ):
                    raise ValueError(
                        f"customer recovery must load before customer initialization: {name}"
                    )
            if (
                entity or name in {"index.html", "gallery.html", "photo.html", "campaign.html"}
            ) and not parser.indexable:
                raise ValueError(f"customer discovery page contains prototype noindex: {name}")
            if entity or name in {
                "index.html",
                "gallery.html",
                "photo.html",
                "basket.html",
                "liked.html",
                "order.html",
                "support.html",
                "owner.html",
            }:
                versions = set(re.findall(r"[?&]v=([0-9.]+)", markup))
                if versions != {version}:
                    raise ValueError(
                        f"visible/cache version differs from VERSION in {name}: {versions}"
                    )
        elif file.suffix == ".css":
            references = re.findall(r"url\(\s*['\"]?([^)'\"\s]+)", file.read_text(encoding="utf-8"))
        elif file.suffix in {".js", ".mjs"}:
            references = re.findall(
                r"(?:\bimport\s*\(\s*|\bfrom\s*)['\"](\.{1,2}/[^'\"]+)['\"]",
                file.read_text(encoding="utf-8"),
            )
        elif name == "site.webmanifest":
            references = [item["src"] for item in json.loads(file.read_text())["icons"]]
        for reference in references:
            target = local_reference(name, reference)
            if target is not None and target not in paths:
                raise ValueError(f"missing public dependency in {name}: {reference} -> {target}")
            checked += target is not None
    campaign_index = json.loads((site / "assets/campaigns/index.json").read_text())
    for campaign in campaign_index["campaigns"]:
        identifier = campaign["id"]
        if (
            not re.fullmatch(r"[a-z0-9-]+", identifier)
            or f"assets/campaigns/{identifier}.json" not in paths
        ):
            raise ValueError(
                f"campaign index refers to an unapproved/missing campaign: {identifier}"
            )
    entities = {name for name in paths if name.startswith(("photo--", "gallery--"))}
    if entities:
        sitemap = ET.parse(site / "sitemap.xml")
        listed = set()
        for element in sitemap.iter():
            if element.tag.rsplit("}", 1)[-1] != "loc":
                continue
            url = urlsplit(element.text or "")
            target = local_reference("index.html", element.text or "")
            if (
                url.scheme != "https"
                or url.netloc != "photos-by-elie.com"
                or url.query
                or url.fragment
                or target not in paths
            ):
                raise ValueError(
                    f"generated sitemap URL is outside the staged customer artifact: {element.text}"
                )
            listed.add(target)
        if not entities.issubset(listed):
            raise ValueError("generated sitemap omits eligible entity HTML")
    return checked


def catalog_contract(site: Path) -> dict:
    """Check the public SQLite contract read-only, with no regeneration or sidecars."""
    catalog = site / CATALOG
    with closing(sqlite3.connect(f"{catalog.as_uri()}?mode=ro&immutable=1", uri=True)) as conn:
        if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("public catalog failed SQLite integrity_check")
        if conn.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise ValueError("public catalog failed SQLite foreign_key_check")
        media = conn.execute(
            "SELECT count(*), count(DISTINCT media_id) FROM media_items"
        ).fetchone()
        collections = conn.execute("SELECT count(*) FROM collections").fetchone()[0]
        products = conn.execute("SELECT count(*) FROM products").fetchone()[0]
    if not media[0] or media[0] != media[1] or not collections or not products:
        raise ValueError("public catalog is empty or violates identity/pricing contracts")
    pricing = json.loads((site / "assets/catalog/product-pricing.json").read_text())
    if pricing.get("schema") != "photosbyelie.product-pricing.v1":
        raise ValueError("unsupported public product pricing contract")
    return {
        "mediaCount": media[0],
        "collectionCount": collections,
        "productCount": products,
        "sha256": sha256(catalog),
    }


def validate_site(repo_root: Path, site: Path, *, seo_root: Path | None = None) -> dict:
    """Require exact allowlist membership and byte identity, then check customer contracts."""
    repo_root = repo_root.resolve(strict=True)
    if site.is_symlink():
        raise ValueError("public artifact site root must not be a symlink")
    site = site.resolve(strict=True)
    sources = source_files(repo_root, seo_root)
    expected = set(sources) | {IDENTITY}
    directories = {
        str(parent)
        for name in expected
        for parent in PurePosixPath(name).parents
        if str(parent) != "."
    }
    actual: set[str] = set()
    for file in site.rglob("*"):
        if file.is_symlink():
            raise ValueError(f"symlink reached public artifact: {file.relative_to(site)}")
        if file.is_dir():
            if file.relative_to(site).as_posix() not in directories:
                raise ValueError(
                    f"unapproved directory reached public artifact: {file.relative_to(site)}"
                )
            continue
        name = public_path(file.relative_to(site).as_posix())
        regular_file(site, name)
        actual.add(name)
    if actual != expected:
        raise ValueError(
            f"artifact allowlist mismatch, extra={sorted(actual - expected)[:5]}, missing={sorted(expected - actual)[:5]}"
        )
    for name, source in sources.items():
        if sha256(site / name) != sha256(source):
            raise ValueError(f"public artifact bytes differ from approved source: {name}")
    for name in NEGATIVE_PATHS:
        if (site / name).exists():
            raise ValueError(f"negative-path validation failed: {name}")
    version = (repo_root / "VERSION").read_text().strip()
    if not re.fullmatch(r"[0-9]+\.[0-9]+", version):
        raise ValueError("unsupported canonical VERSION value")
    if json.loads((site / IDENTITY).read_text()) != release_identity(repo_root):
        raise ValueError("served release identity differs from current source")
    return {
        "version": version,
        "fileCount": len(actual),
        "localReferenceCount": check_references(site, actual, version),
        "negativePathCount": len(NEGATIVE_PATHS),
        "catalog": catalog_contract(site),
    }


def validate_package(repo_root: Path, output: Path, *, seo_root: Path | None = None) -> dict:
    """Recheck the independently stored release receipt against current artifact bytes."""
    result = validate_site(repo_root, output / "site", seo_root=seo_root)
    receipt = json.loads((output / RECEIPT).read_text())
    names = set(source_files(repo_root, seo_root)) | {IDENTITY}
    hashes = {name: sha256(output / "site" / name) for name in names}
    identity = json.loads((output / "site" / IDENTITY).read_text())
    if (
        receipt.get("schema") != "photosbyelie.public-artifact-receipt.v1"
        or receipt.get("identity") != identity
        or receipt.get("files") != hashes
        or receipt.get("validation") != result
    ):
        raise ValueError("public artifact receipt differs from validated bytes")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, default=Path("tmp/public-release"))
    parser.add_argument("--seo-root", type=Path)
    args = parser.parse_args()
    print(
        json.dumps(validate_package(args.repo_root, args.output, seo_root=args.seo_root), indent=2)
    )
    subprocess.run(
        [
            "node",
            str(args.repo_root / "scripts/check_public_catalog.cjs"),
            str(args.output / "site"),
        ],
        check=True,
    )


if __name__ == "__main__":
    main()
