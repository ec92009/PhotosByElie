#!/usr/bin/env python3
"""Deploy the exact Owner-approved public catalog and verify website parity."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
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
    projection_snapshot,
    validate_catalog_bytes,
    verify_deployed_projection,
)


PUBLIC_CATALOG_PATH = Path("assets/catalog/photosbyelie.sqlite")


class PublicCatalogDeploymentError(RuntimeError):
    """Raised when a guarded catalog deployment cannot complete safely."""


def _run(
    command: list[str],
    *,
    cwd: Path,
    timeout: int = 180,
) -> str:
    completed = subprocess.run(
        command,
        cwd=cwd,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip()
        raise PublicCatalogDeploymentError(
            detail or f"{' '.join(command)} exited {completed.returncode}"
        )
    return (completed.stdout or "").strip()


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
) -> dict[str, Any]:
    """Publish one immutable Owner projection from an isolated git worktree.

    The mutable data checkout may contain unrelated work. Only the approved
    catalog bytes are copied into a detached ``origin/main`` worktree, and the
    push is rejected normally if main moved underneath this operation.
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
    try:
        _run(
            ["git", "worktree", "add", "--detach", str(worktree), base_revision],
            cwd=root,
        )
        destination = worktree / PUBLIC_CATALOG_PATH
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(projection_payload)
        written = validate_catalog_bytes(destination.read_bytes())
        if written["sha256"] != projection_sha256:
            raise PublicCatalogDeploymentError(
                "isolated catalog bytes differ from the approved Owner projection"
            )

        changed_paths = [
            line
            for line in _run(["git", "status", "--short"], cwd=worktree).splitlines()
            if line.strip()
        ]
        unexpected = []
        for line in changed_paths:
            parts = line.lstrip().split(maxsplit=1)
            path = parts[1].strip() if len(parts) == 2 else ""
            if path != PUBLIC_CATALOG_PATH.as_posix():
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
            _run(["git", "add", "--", PUBLIC_CATALOG_PATH.as_posix()], cwd=worktree)
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
            _run(["git", "push", "origin", "HEAD:main"], cwd=worktree)
            pushed = True

        deadline = time.monotonic() + max(0, verify_timeout_seconds)
        attempt = 0
        last_status = 0
        last_payload = b""
        while True:
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
