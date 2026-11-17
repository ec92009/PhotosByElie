"""Shared, positive publication policy for the customer static artifact."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path, PurePosixPath


CATALOG = "assets/catalog/photosbyelie.sqlite"
POLICY = "scripts/public-artifact-files.json"
RECEIPT = "receipt.json"
MARKER = ".pbe-public-artifact"
IDENTITY = "release.json"
SEO_GENERATOR = "scripts/build_public_seo.mjs"
SEO_MARKER = ".pbe-seo-generated"
SEO_ENTITY = r"(?:photo|gallery)--[A-Za-z0-9][A-Za-z0-9_-]{0,199}\.html"
NEGATIVE_PATHS = (
    "assets/private-delivery-manifest.json",
    "TIMELOG.md",
    "worker/photos-catalog.generated.mjs",
    "assets/owner-actions/Owner.sqlite",
    "assets/owner-actions/Owner.sqlite-wal",
    "assets/owner-actions/Owner.sqlite-shm",
    "assets/owner-actions/title-keyword-review-queue/latest.json",
    "assets/owner-actions/title-keyword-review-queue/proposed-state.json",
    "assets/owner-actions/real-estate-clients.local.json",
    "assets/catalog/photosbyelie.sqlite.br",
    "docs/audits/2026-11-15-project-audit.md",
    "scripts/prepare_public_artifact.py",
    "scripts/search_console_report.py",
    "scripts/search_console_report_test.py",
    "tmp/search-console/export.csv",
    "tmp/search-console/report.json",
    "native/PhotosByElieBackstage/Package.swift",
    "wrangler.toml",
    "package.json",
    "owner-review.html",
    "new-owner.html",
    "sidecar.html",
    "access-console.html",
    ".git/config",
    ".env",
    ".env.stripe-test.local",
    "worker/.dev.vars",
    "receipt.json",
    ".pbe-seo-generated",
    ".pbe-public-artifact",
)
FORBIDDEN_PARTS = {
    "docs",
    "scripts",
    "worker",
    "native",
    "experiments",
    "node_modules",
    "owner-actions",
    "private",
    "masters",
    "hidden",
    "reserve",
    "discarded",
    "__pycache__",
    "tmp",
    "output",
    ".github",
    ".git",
}
PUBLIC_SUFFIXES = {
    ".html",
    ".css",
    ".js",
    ".mjs",
    ".json",
    ".sqlite",
    ".png",
    ".jpg",
    ".webp",
    ".mp3",
    ".webmanifest",
    ".xml",
    ".txt",
}


def sha256(file: Path) -> str:
    """Fingerprint exact bytes without loading media files into memory."""
    digest = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def public_path(value: str) -> str:
    """Reject ambiguous paths and known private/source classes, even in a manifest."""
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_./-]+", value):
        raise ValueError(f"unsafe public path: {value!r}")
    path = PurePosixPath(value)
    if path.is_absolute() or str(path) != value or ".." in path.parts:
        raise ValueError(f"non-canonical public path: {value}")
    if value.casefold() in {
        name.casefold() for name in NEGATIVE_PATHS
    } or FORBIDDEN_PARTS.intersection(part.casefold() for part in path.parts):
        raise ValueError(f"forbidden public path: {value}")
    if path.suffix == ".sqlite" and value != CATALOG:
        raise ValueError(f"only the public catalog SQLite may deploy: {value}")
    if value in {".nojekyll", "CNAME", "robots.txt"}:
        return value
    if any(part.startswith(".") for part in path.parts) or path.suffix not in PUBLIC_SUFFIXES:
        raise ValueError(f"unsupported public file: {value}")
    if not re.fullmatch(SEO_ENTITY, value) and re.search(
        r"(?:^|[-_.])(?:private|manifest|secret|audit|test|local|generated|receipt)(?:[-_.]|$)",
        path.name,
        re.I,
    ):
        raise ValueError(f"internal artifact name: {value}")
    return value


def regular_file(root: Path, relative: str) -> Path:
    """Require regular files with no symlink component or escape from their root."""
    root = root.resolve(strict=True)
    target = root / relative
    for part in (target, *target.parents):
        if part == root:
            break
        if part.is_symlink():
            raise ValueError(f"symlink is forbidden in artifact input/output: {relative}")
    if not target.is_file() or target.resolve() != target.absolute():
        raise ValueError(f"required regular public file is missing: {relative}")
    return target


def load_policy(repo_root: Path) -> dict:
    """Read an exact-file allowlist. Directory walks and glob expansion never grant access."""
    policy = json.loads((repo_root / POLICY).read_text(encoding="utf-8"))
    if policy.get("schema") != "photosbyelie.public-artifact-files.v1":
        raise ValueError("unsupported public artifact policy")
    files = [public_path(name) for name in policy["files"]]
    integration_files = [public_path(name) for name in policy.get("integrationFiles", [])]
    all_files = files + integration_files
    if any(re.fullmatch(SEO_ENTITY, name) for name in all_files):
        raise ValueError("generated entity HTML requires catalog-derived SEO eligibility")
    if len(all_files) != len(set(all_files)) or not set(policy["pages"]).issubset(files):
        raise ValueError("public artifact policy has duplicate files or missing pages")
    required = {
        CATALOG,
        "index.html",
        "gallery.html",
        "photo.html",
        "basket.html",
        "liked.html",
        "order.html",
        "robots.txt",
        "sitemap.xml",
    }
    if not required.issubset(files):
        raise ValueError("public artifact policy omits a required customer surface")
    return policy


def source_files(repo_root: Path, seo_root: Path | None = None) -> dict[str, Path]:
    """Resolve approved source files and the bounded, catalog-bound SEO integration hook."""
    repo_root = repo_root.resolve(strict=True)
    policy = load_policy(repo_root)
    names = policy["files"] + [
        name for name in policy.get("integrationFiles", []) if (repo_root / name).exists()
    ]
    files = {name: regular_file(repo_root, name) for name in names}
    if not (repo_root / SEO_GENERATOR).exists() and seo_root is None:
        if re.search(r"\bentityPath\s*,", (repo_root / "photos.js").read_text()):
            raise ValueError("canonical entity runtime requires the SEO generator and overlay")
        return files
    seo_root = (seo_root or repo_root / "tmp/public-seo").resolve(strict=True)
    paths = eligible_seo_files(repo_root)
    actual = {item.relative_to(seo_root).as_posix() for item in seo_root.rglob("*")}
    if actual != paths | {SEO_MARKER}:
        raise ValueError(
            "SEO output must contain exactly eligible entity HTML, sitemap.xml, robots.txt and its excluded marker"
        )
    if regular_file(seo_root, SEO_MARKER).read_text() != "photosbyelie.public-seo.v1\n":
        raise ValueError("invalid SEO output ownership marker")
    for name in paths:
        public_path(name)
        files[name] = regular_file(seo_root, name)
    return files


def eligible_seo_files(repo_root: Path) -> set[str]:
    """Use PBE-218's public eligibility/policy reader to allow exact entity filenames."""
    regular_file(repo_root, SEO_GENERATOR)
    program = """
        const { pathToFileURL } = require('node:url');
        (async () => {
          const root = process.argv[1];
          const { loadSeo, publicEntities } = await import(pathToFileURL(root + '/scripts/build_public_seo.mjs'));
          const seo = loadSeo(root);
          const photos = publicEntities(root, root + '/assets/catalog/photosbyelie.sqlite', seo);
          const files = new Set(['robots.txt', 'sitemap.xml']);
          for (const photo of photos) {
            files.add(seo.entityPath('photo', photo.id).slice(1));
            files.add(seo.entityPath('gallery', photo.collectionKey).slice(1));
          }
          console.log(JSON.stringify([...files]));
        })().catch(error => { console.error(error.message); process.exit(1); });
    """
    paths = json.loads(
        subprocess.check_output(["node", "-e", program, str(repo_root)], cwd=repo_root, text=True)
    )
    for name in paths:
        if name not in {"robots.txt", "sitemap.xml"} and not re.fullmatch(SEO_ENTITY, name):
            raise ValueError(f"unsafe eligible SEO entity path: {name}")
    return set(paths)


def release_identity(repo_root: Path) -> dict:
    """Bind the served release to its source commit, visible version, and public catalog."""
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo_root, text=True).strip()
    dirty = subprocess.check_output(
        ["git", "status", "--porcelain", "--untracked-files=all"], cwd=repo_root, text=True
    )
    return {
        "schema": "photosbyelie.public-release.v1",
        "commit": commit,
        "version": (repo_root / "VERSION").read_text().strip(),
        "catalogSha256": sha256(repo_root / CATALOG),
        "policySha256": sha256(repo_root / POLICY),
        "sourceTreeDirty": bool(dirty),
    }
