#!/usr/bin/env python3
"""Deploy the exact Owner-approved public catalog and verify website parity."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import tempfile
import time
from typing import Any, Callable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen

from owner_catalog_projection import (
    PUBLIC_CATALOG_URL,
    catalog_media_ids,
    projection_snapshot,
    validate_catalog_bytes,
    verify_deployed_projection,
)


PUBLIC_CATALOG_PATH = Path("assets/catalog/photosbyelie.sqlite")
PRODUCT_PRICING_PATH = Path("assets/catalog/product-pricing.json")
PHOTOS_DATA_PATH = Path("photos-data.js")
HOME_DATA_PATH = Path("home-data.js")
MEDIA_SIDECAR_PATH = Path("assets/media-sidecar.json")
BOOTSTRAP_GENERATOR_PATH = Path("scripts/write_catalog_tsv.cjs")
MEDIA_SIDECAR_GENERATOR_PATH = Path("scripts/write_media_sidecar.mjs")
ALLOWED_DEPLOY_PATHS = frozenset(
    {
        PUBLIC_CATALOG_PATH.as_posix(),
        PHOTOS_DATA_PATH.as_posix(),
        HOME_DATA_PATH.as_posix(),
        MEDIA_SIDECAR_PATH.as_posix(),
    }
)


class PublicCatalogDeploymentError(RuntimeError):
    """Raised when a guarded catalog deployment cannot complete safely."""


def _resolve_node_executable() -> str:
    """Resolve a working Node executable even under a minimal GUI launch PATH."""
    for candidate in (shutil.which("node"), "/opt/homebrew/bin/node", "/usr/local/bin/node"):
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    raise PublicCatalogDeploymentError(
        "Node.js is required to regenerate public catalog bootstrap and media index artifacts"
    )


def _run(
    command: list[str],
    *,
    cwd: Path,
    timeout: int = 180,
    strip_output: bool = True,
) -> str:
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    first = str(command[0] or "")
    if "/" in first:
        parent = str(Path(first).parent)
        if parent and parent not in env.get("PATH", "").split(":"):
            env["PATH"] = f"{parent}:{env.get('PATH', '')}" if env.get("PATH") else parent
    completed = subprocess.run(
        command,
        cwd=cwd,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
        env=env,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip()
        raise PublicCatalogDeploymentError(
            detail or f"{' '.join(command)} exited {completed.returncode}"
        )
    stdout = completed.stdout or ""
    return stdout.strip() if strip_output else stdout


def _catalog_collection_counts(catalog_path: Path) -> dict[str, int]:
    connection = sqlite3.connect(catalog_path.as_uri() + "?mode=ro", uri=True)
    try:
        rows = connection.execute(
            """
            SELECT col.slug, COUNT(media.media_id)
            FROM collections AS col
            LEFT JOIN media_items AS media ON media.collection_id = col.collection_id
            GROUP BY col.slug
            ORDER BY col.slug
            """
        ).fetchall()
        return {str(slug): int(count) for slug, count in rows}
    finally:
        connection.close()


def _regenerate_derived_artifacts(worktree: Path) -> None:
    """Regenerate checksum-bound bootstrap, home, and media-index artifacts in place."""
    needs_bootstrap = (worktree / PHOTOS_DATA_PATH).exists() or (worktree / HOME_DATA_PATH).exists()
    needs_sidecar = (worktree / MEDIA_SIDECAR_PATH).exists()
    if not needs_bootstrap and not needs_sidecar:
        return
    node = _resolve_node_executable()
    if needs_bootstrap:
        generator = worktree / BOOTSTRAP_GENERATOR_PATH
        if not generator.is_file():
            raise PublicCatalogDeploymentError(
                f"missing required bootstrap generator: {BOOTSTRAP_GENERATOR_PATH.as_posix()}"
            )
        _run([node, BOOTSTRAP_GENERATOR_PATH.as_posix(), "--bootstrap-only"], cwd=worktree)
    if needs_sidecar:
        generator = worktree / MEDIA_SIDECAR_GENERATOR_PATH
        if not generator.is_file():
            raise PublicCatalogDeploymentError(
                f"missing required media index generator: {MEDIA_SIDECAR_GENERATOR_PATH.as_posix()}"
            )
        _run([node, MEDIA_SIDECAR_GENERATOR_PATH.as_posix()], cwd=worktree)


def _validate_derived_artifacts(
    worktree: Path,
    *,
    projection_payload: bytes,
    projection_sha256: str,
    expected_media_count: int,
    initial_pricing_bytes: bytes | None,
) -> None:
    """Verify every derived public artifact matches the exact approved SQLite before push."""
    destination = worktree / PUBLIC_CATALOG_PATH
    written = validate_catalog_bytes(destination.read_bytes())
    if written["sha256"] != projection_sha256:
        raise PublicCatalogDeploymentError(
            "isolated catalog bytes differ from the approved Owner projection after artifact regeneration"
        )
    pricing_path = worktree / PRODUCT_PRICING_PATH
    if initial_pricing_bytes is not None:
        if not pricing_path.is_file() or pricing_path.read_bytes() != initial_pricing_bytes:
            raise PublicCatalogDeploymentError(
                "isolated catalog deployment unexpectedly modified product-pricing.json"
            )
    photos_data = worktree / PHOTOS_DATA_PATH
    if photos_data.exists():
        text = photos_data.read_text(encoding="utf-8")
        match = re.search(
            r"const\s+catalogGeneration\s*=\s*Object\.freeze\((\{.*?\})\);",
            text,
            re.DOTALL,
        )
        if not match:
            raise PublicCatalogDeploymentError(
                "photos-data.js is missing its frozen catalogGeneration binding"
            )
        try:
            generation = json.loads(match.group(1))
        except json.JSONDecodeError as error:
            raise PublicCatalogDeploymentError(
                f"photos-data.js catalogGeneration JSON is invalid: {error}"
            ) from None
        if generation.get("sha256") != projection_sha256 or generation.get("bytes") != len(projection_payload):
            raise PublicCatalogDeploymentError(
                "photos-data.js catalogGeneration does not match the approved SQLite checksum/size"
            )
        if initial_pricing_bytes is not None:
            pricing_gen = generation.get("pricing") or {}
            expected_pricing_sha = hashlib.sha256(initial_pricing_bytes).hexdigest()
            if (
                pricing_gen.get("sha256") != expected_pricing_sha
                or pricing_gen.get("bytes") != len(initial_pricing_bytes)
            ):
                raise PublicCatalogDeploymentError(
                    "photos-data.js pricing binding does not match product-pricing.json"
                )
    home_data = worktree / HOME_DATA_PATH
    if home_data.exists():
        text = home_data.read_text(encoding="utf-8")
        match = re.search(
            r"window\.photosByElieHomeData\s*=\s*(\{.*\});",
            text,
            re.DOTALL,
        )
        if not match:
            raise PublicCatalogDeploymentError("home-data.js is missing photosByElieHomeData")
        try:
            home_payload = json.loads(match.group(1))
        except json.JSONDecodeError as error:
            raise PublicCatalogDeploymentError(f"home-data.js JSON is invalid: {error}") from None
        if not isinstance(home_payload, dict):
            raise PublicCatalogDeploymentError("home-data.js payload is not a JSON object")
        actual_counts = {
            str(slug): int((entry or {}).get("count", -1))
            for slug, entry in home_payload.items()
        }
        expected_counts = _catalog_collection_counts(destination)
        if actual_counts != expected_counts:
            raise PublicCatalogDeploymentError(
                "home-data.js collection counts do not match the approved SQLite catalog"
            )
    media_sidecar = worktree / MEDIA_SIDECAR_PATH
    if media_sidecar.exists():
        try:
            sidecar_payload = json.loads(media_sidecar.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise PublicCatalogDeploymentError(
                f"assets/media-sidecar.json is invalid: {error}"
            ) from None
        photos_map = sidecar_payload.get("photos") if isinstance(sidecar_payload, dict) else None
        if (
            not isinstance(sidecar_payload, dict)
            or sidecar_payload.get("schema") != "photosbyelie.media-sidecar.v1"
            or not isinstance(photos_map, dict)
            or int(sidecar_payload.get("photosCount", -1)) != len(photos_map)
            or len(photos_map) != expected_media_count
        ):
            raise PublicCatalogDeploymentError(
                "assets/media-sidecar.json count or schema does not match the approved SQLite catalog"
            )
        expected_ids = set(catalog_media_ids(projection_payload))
        if set(photos_map.keys()) != expected_ids:
            raise PublicCatalogDeploymentError(
                "assets/media-sidecar.json media IDs do not match the approved SQLite catalog"
            )


def _cache_busted_url(url: str, deployment_sha256: str, attempt: int) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["pbe-deploy"] = deployment_sha256[:16]
    query["attempt"] = str(attempt)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def _fetch_public_catalog(
    url: str,
    *,
    deployment_sha256: str,
    attempt: int,
) -> tuple[int, bytes]:
    request = Request(
        _cache_busted_url(url, deployment_sha256, attempt),
        headers={
            "User-Agent": "PhotosByElie Backstage catalog deploy verifier",
            "Cache-Control": "no-cache",
        },
    )
    with urlopen(request, timeout=30) as response:
        return int(response.status), response.read()


def _current_projection(repo_root: Path) -> dict[str, Any]:
    owner_database = repo_root / "assets" / "owner-actions" / "Owner.sqlite"
    connection = sqlite3.connect(owner_database)
    connection.row_factory = sqlite3.Row
    try:
        snapshot = projection_snapshot(connection)
    finally:
        connection.close()
    if snapshot is None:
        raise PublicCatalogDeploymentError(
            "Owner public catalog projection has not been initialized"
        )
    return snapshot


def _record_deployment_with_retry(
    owner_database: Path,
    *,
    public_url: str,
    status: int,
    payload: bytes,
    sleep: Callable[[float], None],
) -> dict[str, Any]:
    delays = (0.0, 0.25, 0.5, 1.0, 2.0)
    for index, delay in enumerate(delays):
        if delay:
            sleep(delay)
        try:
            return verify_deployed_projection(
                owner_database,
                public_url=public_url,
                fetch=lambda _url: (status, payload),
            )
        except sqlite3.OperationalError as error:
            if "locked" not in str(error).casefold() or index == len(delays) - 1:
                raise
    raise PublicCatalogDeploymentError("catalog deployment receipt could not be recorded")


def deploy_public_catalog(
    repo_root: Path,
    *,
    public_url: str = PUBLIC_CATALOG_URL,
    verify_timeout_seconds: float = 10 * 60,
    poll_interval_seconds: float = 5,
    fetch: Callable[[str, str, int], tuple[int, bytes]] | None = None,
    sleep: Callable[[float], None] = time.sleep,
    before_publish: Callable[[], None] | None = None,
    regenerate_derived: Callable[[Path], None] | None = None,
) -> dict[str, Any]:
    """Publish one immutable Owner projection from an isolated git worktree.

    The mutable data checkout may contain unrelated work. Only the approved
    catalog bytes and their validated derived public artifacts are written into
    a detached ``origin/main`` worktree, and the push is rejected normally if
    main moved underneath this operation.
    """
    root = repo_root.resolve(strict=True)
    owner_database = root / "assets" / "owner-actions" / "Owner.sqlite"
    projection = _current_projection(root)
    projection_payload = bytes(projection["payload"])
    projection_sha256 = str(projection["sha256"])
    projection_revision = int(projection["revision"])
    validate_catalog_bytes(projection_payload)

    _run(["git", "fetch", "origin", "main"], cwd=root)
    base_revision = _run(["git", "rev-parse", "origin/main"], cwd=root)
    temporary_root = Path(tempfile.mkdtemp(prefix="pbe-catalog-deploy-"))
    worktree = temporary_root / "checkout"
    pushed = False
    commit_sha = base_revision
    changed_paths: list[str] = []
    try:
        _run(
            ["git", "worktree", "add", "--detach", str(worktree), base_revision],
            cwd=root,
        )
        pricing_path = worktree / PRODUCT_PRICING_PATH
        initial_pricing_bytes = pricing_path.read_bytes() if pricing_path.is_file() else None
        destination = worktree / PUBLIC_CATALOG_PATH
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(projection_payload)
        written = validate_catalog_bytes(destination.read_bytes())
        if written["sha256"] != projection_sha256:
            raise PublicCatalogDeploymentError(
                "isolated catalog bytes differ from the approved Owner projection"
            )
        (regenerate_derived or _regenerate_derived_artifacts)(worktree)
        _validate_derived_artifacts(
            worktree,
            projection_payload=projection_payload,
            projection_sha256=projection_sha256,
            expected_media_count=int(written["mediaCount"]),
            initial_pricing_bytes=initial_pricing_bytes,
        )

        status_lines = [
            line
            for line in _run(
                ["git", "status", "--porcelain=v1", "--untracked-files=all"],
                cwd=worktree,
                strip_output=False,
            ).splitlines()
            if line.strip()
        ]
        unexpected = []
        for line in status_lines:
            path = line[3:] if len(line) >= 4 and line[2] == " " else ""
            if path in ALLOWED_DEPLOY_PATHS:
                changed_paths.append(path)
            else:
                unexpected.append(line)
        if unexpected:
            raise PublicCatalogDeploymentError(
                "isolated catalog deployment contains unexpected changed files: "
                + ", ".join(unexpected)
            )
        if changed_paths:
            latest = _current_projection(root)
            if str(latest["sha256"]) != projection_sha256:
                raise PublicCatalogDeploymentError(
                    "Owner catalog projection changed before deployment; reload and retry"
                )
            _run(["git", "add", "--", *sorted(changed_paths)], cwd=worktree)
            _run(
                [
                    "git",
                    "commit",
                    "-m",
                    f"photosbyelie: publish Owner catalog revision {projection_revision}",
                ],
                cwd=worktree,
            )
            commit_sha = _run(["git", "rev-parse", "HEAD"], cwd=worktree)
            if before_publish:
                before_publish()
            _run(["git", "push", "origin", "HEAD:main"], cwd=worktree)
            pushed = True

        deadline = time.monotonic() + max(0, verify_timeout_seconds)
        attempt = 0
        last_status = 0
        last_payload = b""
        while True:
            if before_publish:
                before_publish()
            attempt += 1
            try:
                if fetch is None:
                    last_status, last_payload = _fetch_public_catalog(
                        public_url,
                        deployment_sha256=projection_sha256,
                        attempt=attempt,
                    )
                else:
                    last_status, last_payload = fetch(
                        public_url,
                        projection_sha256,
                        attempt,
                    )
                remote_sha256 = hashlib.sha256(last_payload).hexdigest()
                if last_status == 200 and remote_sha256 == projection_sha256:
                    receipt = _record_deployment_with_retry(
                        owner_database,
                        public_url=public_url,
                        status=last_status,
                        payload=last_payload,
                        sleep=sleep,
                    )
                    return {
                        "ok": receipt["state"] == "verified",
                        "state": receipt["state"],
                        "pushed": pushed,
                        "commitSha": commit_sha,
                        "changedPaths": sorted(changed_paths),
                        "attempts": attempt,
                        **receipt,
                    }
            except Exception:  # transient website or CDN failure; retry until deadline
                last_status, last_payload = 0, b""
            if time.monotonic() >= deadline:
                break
            sleep(max(0, poll_interval_seconds))

        receipt = _record_deployment_with_retry(
            owner_database,
            public_url=public_url,
            status=last_status,
            payload=last_payload,
            sleep=sleep,
        )
        return {
            "ok": False,
            "state": "failed",
            "pushed": pushed,
            "commitSha": commit_sha,
            "changedPaths": sorted(changed_paths),
            "attempts": attempt,
            **receipt,
        }
    finally:
        if worktree.exists():
            subprocess.run(
                ["git", "worktree", "remove", "--force", str(worktree)],
                cwd=root,
                text=True,
                capture_output=True,
                check=False,
            )
        shutil.rmtree(temporary_root, ignore_errors=True)
