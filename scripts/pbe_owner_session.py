#!/usr/bin/env python3
"""Fail-closed, memory-only lease for Backstage-hosted PBE Owner sessions."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
import json
from pathlib import Path
import re
import secrets
import sqlite3
import stat
import subprocess
import threading
import time
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

try:
    from .owner_connector_runtime import (
        MANIFEST_NAME as CONNECTOR_RUNTIME_MANIFEST,
        ConnectorRuntimeError,
        validate_runtime,
    )
except ImportError:
    from owner_connector_runtime import (  # type: ignore
        MANIFEST_NAME as CONNECTOR_RUNTIME_MANIFEST,
        ConnectorRuntimeError,
        validate_runtime,
    )


DEFAULT_CLOUD_SESSION_URL = "https://auth.photos-by-elie.com/api/v1/pbe-owner/session"
PBE_OWNER_VERIFIER_USER_AGENT = "PhotosByElie-PBE-Owner-Host/1.0"
DEFAULT_LOCAL_LEASE_SECONDS = 90
REQUIRED_CAPABILITIES = frozenset(
    {"gallery.read", "waste-basket.x", "waste-basket.restore"}
)
PBE_OWNER_HOST_SCOPE_MANIFEST = "scripts/pbe_owner_host_tracked_paths.txt"
PBE_OWNER_HOST_REQUIRED_PATHS = (
    PBE_OWNER_HOST_SCOPE_MANIFEST,
    "scripts/local_server.py",
    "scripts/pbe_owner_session.py",
    "scripts/waste_basket_gateway.py",
)
PBE_OWNER_PYTHON_IMPORT_EXTENSIONS = frozenset(
    {".bundle", ".dylib", ".pth", ".py", ".pyc", ".pyo", ".so"}
)


def _git(repo_root: Path, *arguments: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", str(repo_root), *arguments],
        check=check,
        capture_output=True,
    )


def _host_scope_pathspecs(repo_root: Path) -> tuple[str, ...]:
    manifest_path = repo_root / PBE_OWNER_HOST_SCOPE_MANIFEST
    try:
        lines = manifest_path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise PBEOwnerSessionError(
            "PBE Owner host cannot read its tracked checkout scope.",
            code="pbe_owner_checkout_identity_unavailable",
            status=503,
        ) from error
    pathspecs = list(PBE_OWNER_HOST_REQUIRED_PATHS)
    for line in lines:
        value = line.strip()
        if value and not value.startswith("#") and value not in pathspecs:
            pathspecs.append(value)
    return tuple(pathspecs)


def _assert_no_stray_python_host_content(
    repo_root: Path,
    tracked_scripts: set[str],
) -> None:
    """Reject untracked content that Python could execute from ``scripts/``."""

    scripts_root = repo_root / "scripts"
    try:
        candidates = tuple(scripts_root.rglob("*"))
        for candidate in candidates:
            relative = candidate.relative_to(repo_root).as_posix()
            if relative in tracked_scripts:
                continue
            metadata = candidate.lstat()
            if stat.S_ISDIR(metadata.st_mode):
                continue
            suffix = candidate.suffix.lower()
            cache_bytecode = (
                "__pycache__" in candidate.relative_to(scripts_root).parts
                and suffix in {".pyc", ".pyo"}
                and stat.S_ISREG(metadata.st_mode)
            )
            if cache_bytecode:
                continue
            if (
                not stat.S_ISREG(metadata.st_mode)
                or suffix in PBE_OWNER_PYTHON_IMPORT_EXTENSIONS
                or metadata.st_mode & 0o111
            ):
                raise PBEOwnerSessionError(
                    "PBE Owner requires a scripts import scope without stray executable content.",
                    code="pbe_owner_checkout_stray_import",
                    status=409,
                )
    except PBEOwnerSessionError:
        raise
    except (OSError, RuntimeError, ValueError) as error:
        raise PBEOwnerSessionError(
            "PBE Owner host cannot verify its Python import scope.",
            code="pbe_owner_checkout_identity_unavailable",
            status=503,
        ) from error


def _verified_host_tree(repo_root: Path, pathspecs: tuple[str, ...]) -> tuple[str, str]:
    try:
        top_level = _git(repo_root, "rev-parse", "--show-toplevel").stdout.decode("utf-8").strip()
        if Path(top_level).resolve() != repo_root:
            raise ValueError("repository root mismatch")
        revision = _git(repo_root, "rev-parse", "--verify", "HEAD^{commit}").stdout.decode("ascii").strip().lower()
        if not re.fullmatch(r"[0-9a-f]{40,64}", revision):
            raise ValueError("invalid revision")
        tracked = {
            value.decode("utf-8")
            for value in _git(repo_root, "ls-files", "-z", "--", *pathspecs).stdout.split(b"\0")
            if value
        }
        if not set(PBE_OWNER_HOST_REQUIRED_PATHS).issubset(tracked):
            raise ValueError("required host files are not tracked")
        tracked_scripts = {
            value.decode("utf-8")
            for value in _git(repo_root, "ls-files", "-z", "--", "scripts").stdout.split(b"\0")
            if value
        }
        _assert_no_stray_python_host_content(repo_root, tracked_scripts)
        dirty = _git(
            repo_root,
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=no",
            "--",
            *pathspecs,
        ).stdout
        if dirty:
            raise PBEOwnerSessionError(
                "PBE Owner requires a clean tracked host checkout.",
                code="pbe_owner_checkout_dirty",
                status=409,
            )
        tree_output = _git(repo_root, "ls-tree", "-r", "-z", "HEAD", "--", *sorted(tracked)).stdout
        entries: dict[str, tuple[str, str]] = {}
        for raw_entry in tree_output.split(b"\0"):
            if not raw_entry:
                continue
            metadata, raw_path = raw_entry.split(b"\t", 1)
            mode, object_type, object_id = metadata.decode("ascii").split(" ", 2)
            path = raw_path.decode("utf-8")
            if object_type != "blob":
                raise ValueError("host scope contains a non-blob entry")
            entries[path] = (mode, object_id)
        if not set(PBE_OWNER_HOST_REQUIRED_PATHS).issubset(entries):
            raise ValueError("required host files are absent from HEAD")
        paths = sorted(entries)
        actual_hashes = _git(repo_root, "hash-object", "--", *paths).stdout.decode("ascii").splitlines()
        if len(actual_hashes) != len(paths):
            raise ValueError("host content hash count mismatch")
        for path, actual_hash in zip(paths, actual_hashes, strict=True):
            if not hmac.compare_digest(entries[path][1], actual_hash.strip().lower()):
                raise PBEOwnerSessionError(
                    "PBE Owner host files do not match the verified commit.",
                    code="pbe_owner_checkout_content_mismatch",
                    status=409,
                )
    except PBEOwnerSessionError:
        raise
    except (OSError, UnicodeError, ValueError, subprocess.CalledProcessError) as error:
        raise PBEOwnerSessionError(
            "PBE Owner host cannot verify the tracked checkout.",
            code="pbe_owner_checkout_identity_unavailable",
            status=503,
        ) from error
    digest = hashlib.sha256()
    for path in sorted(entries):
        mode, object_id = entries[path]
        digest.update(path.encode("utf-8"))
        digest.update(b"\0")
        digest.update(mode.encode("ascii"))
        digest.update(b"\0")
        digest.update(object_id.encode("ascii"))
        digest.update(b"\n")
    return revision, digest.hexdigest()


def checkout_identity(repo_root: Path) -> str:
    root = repo_root.resolve()
    runtime_manifest = root / CONNECTOR_RUNTIME_MANIFEST
    if runtime_manifest.exists() or runtime_manifest.is_symlink():
        return _runtime_checkout_identity(root)
    revision, tree_digest = _verified_host_tree(root, _host_scope_pathspecs(root))
    return f"git:{revision}:pbe-host-sha256:{tree_digest}"


def _runtime_checkout_identity(runtime_root: Path) -> str:
    try:
        verification = validate_runtime(runtime_root)
        manifest = json.loads(
            (runtime_root / CONNECTOR_RUNTIME_MANIFEST).read_text(encoding="utf-8")
        )
        raw_entries = manifest.get("files")
        raw_owner_host = manifest.get("pbeOwnerHost")
        if not isinstance(raw_entries, list) or not isinstance(raw_owner_host, dict):
            raise ValueError("runtime host attestation is missing")
        entries = {
            str(entry.get("path") or ""): entry
            for entry in raw_entries
            if isinstance(entry, dict)
        }
        raw_host_paths = raw_owner_host.get("files")
        if not isinstance(raw_host_paths, list) or not raw_host_paths:
            raise ValueError("runtime host scope is empty")
        host_paths = sorted(str(path or "") for path in raw_host_paths)
        if len(set(host_paths)) != len(host_paths):
            raise ValueError("runtime host scope contains duplicate paths")
        digest = hashlib.sha256()
        for path in host_paths:
            entry = entries.get(path)
            if not entry:
                raise ValueError("runtime host scope references an unmanifested file")
            mode = str(entry.get("mode") or "")
            sha256 = str(entry.get("sha256") or "").lower()
            if mode not in {"0444", "0555"} or not re.fullmatch(r"[0-9a-f]{64}", sha256):
                raise ValueError("runtime host entry is malformed")
            digest.update(path.encode("utf-8"))
            digest.update(b"\0")
            digest.update(mode.encode("ascii"))
            digest.update(b"\0")
            digest.update(sha256.encode("ascii"))
            digest.update(b"\n")
        return (
            f"runtime:{verification.revision}:"
            f"pbe-host-sha256:{digest.hexdigest()}"
        )
    except (ConnectorRuntimeError, OSError, UnicodeError, ValueError, json.JSONDecodeError) as error:
        raise PBEOwnerSessionError(
            "PBE Owner host cannot verify the installed runtime.",
            code="pbe_owner_runtime_identity_unavailable",
            status=503,
        ) from error


class PBEOwnerHostAuthenticator:
    """One-use Backstage bootstrap followed by a memory-only host capability."""

    def __init__(self, bootstrap_secret: str, checkout: str) -> None:
        self._lock = threading.Lock()
        self._bootstrap_hash = self._hash(_clean(bootstrap_secret)) if _clean(bootstrap_secret) else ""
        self._host_hash = ""
        self.checkout_identity = _clean(checkout)

    @staticmethod
    def _hash(value: str) -> str:
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    @property
    def configured(self) -> bool:
        return bool(self._bootstrap_hash and self.checkout_identity)

    def bootstrap(self, secret: str, expected_checkout_identity: str) -> str:
        host_authorization = secrets.token_urlsafe(32)
        with self._lock:
            if not self._bootstrap_hash:
                raise PBEOwnerSessionError(
                    "The Backstage host bootstrap is unavailable or already consumed.",
                    code="pbe_owner_host_bootstrap_invalid",
                    status=401,
                )
            if not hmac.compare_digest(self._bootstrap_hash, self._hash(_clean(secret))):
                raise PBEOwnerSessionError(
                    "The Backstage host bootstrap secret is invalid.",
                    code="pbe_owner_host_bootstrap_invalid",
                    status=401,
                )
            if not hmac.compare_digest(self.checkout_identity, _clean(expected_checkout_identity)):
                raise PBEOwnerSessionError(
                    "The launched PBE host checkout does not match Backstage.",
                    code="pbe_owner_checkout_identity_mismatch",
                    status=409,
                )
            self._bootstrap_hash = ""
            self._host_hash = self._hash(host_authorization)
        return host_authorization

    def authorize(self, host_authorization: str) -> None:
        with self._lock:
            if not self._host_hash or not hmac.compare_digest(
                self._host_hash,
                self._hash(_clean(host_authorization)),
            ):
                raise PBEOwnerSessionError(
                    "This PBE host was not authenticated by Backstage.",
                    code="pbe_owner_host_authorization_required",
                    status=401,
                )


class PBEOwnerSessionError(ValueError):
    """A deterministic session failure safe to return to a loopback client."""

    def __init__(self, message: str, *, code: str, status: int) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def _clean(value: object) -> str:
    return str(value or "").strip()


def _sqlite_identity(
    path: Path,
    *,
    required_tables: tuple[str, ...],
    bind_file_object: bool,
) -> str:
    """Identify a validated SQLite source without binding to mutable rows."""

    resolved = path.resolve(strict=True)
    stat = resolved.stat()
    try:
        connection = sqlite3.connect(
            f"file:{quote(str(resolved), safe='/')}?mode=ro",
            uri=True,
        )
        try:
            rows = connection.execute(
                """
                SELECT name, COALESCE(sql, '')
                FROM sqlite_master
                WHERE type = 'table' AND name IN ({})
                ORDER BY name
                """.format(",".join("?" for _ in required_tables)),
                required_tables,
            ).fetchall()
        finally:
            connection.close()
    except sqlite3.Error as error:
        raise PBEOwnerSessionError(
            "PBE Owner host is unavailable because a required SQLite source is unreadable.",
            code="pbe_owner_host_not_ready",
            status=503,
        ) from error
    found = {str(row[0]) for row in rows}
    if found != set(required_tables):
        raise PBEOwnerSessionError(
            "PBE Owner host is unavailable because a required SQLite schema is incomplete.",
            code="pbe_owner_host_not_ready",
            status=503,
        )
    payload = json.dumps(
        {
            **({"device": stat.st_dev, "inode": stat.st_ino} if bind_file_object else {}),
            "path": str(resolved),
            "schema": rows,
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _fixture_revision(owner_path: Path, fixture_id: str) -> str:
    """Hash canonical fixture membership/content, excluding lifecycle fields."""

    clean_fixture_id = _clean(fixture_id)
    if not clean_fixture_id:
        raise PBEOwnerSessionError(
            "PBE Owner readiness requires an explicit fixture.",
            code="pbe_owner_fixture_required",
            status=400,
        )
    try:
        connection = sqlite3.connect(f"file:{quote(str(owner_path.resolve()), safe='/')}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        try:
            fixture = connection.execute(
                """
                SELECT fixture_id, parent_fixture_id, name, slug, template_key,
                       tags_json, destination_defaults_json, access_gallery_key,
                       archived_at
                FROM fixtures WHERE fixture_id = ?
                """,
                (clean_fixture_id,),
            ).fetchone()
            if not fixture or _clean(fixture["archived_at"]):
                raise PBEOwnerSessionError(
                    "The requested PBE Owner fixture is missing or archived.",
                    code="pbe_owner_fixture_unavailable",
                    status=409,
                )
            rows = connection.execute(
                """
                SELECT d.asset_id, d.placement_state, d.eligibility_state, d.source,
                       a.source_anchor, a.media_type, a.filename, a.captured_at,
                       a.modified_at, a.pixel_width, a.pixel_height, a.duration,
                       a.photos_title, a.photos_keywords_json, a.location_label,
                       a.location_keywords_json, a.metadata_seed_title,
                       a.metadata_seed_keywords_json, a.missing_at
                FROM fixture_asset_decisions AS d
                JOIN sidecar_assets AS a ON a.asset_id = d.asset_id
                WHERE d.fixture_id = ?
                ORDER BY d.asset_id
                """,
                (clean_fixture_id,),
            ).fetchall()
            versions = connection.execute(
                """
                SELECT v.asset_id, v.version_id, v.metadata_fingerprint,
                       v.rendered_fingerprint, v.source_exists, v.state
                FROM asset_source_versions AS v
                JOIN fixture_asset_decisions AS d ON d.asset_id = v.asset_id
                WHERE d.fixture_id = ?
                ORDER BY v.asset_id, v.version_id
                """,
                (clean_fixture_id,),
            ).fetchall()
        finally:
            connection.close()
    except PBEOwnerSessionError:
        raise
    except sqlite3.Error as error:
        raise PBEOwnerSessionError(
            "PBE Owner host cannot verify the selected fixture revision.",
            code="pbe_owner_host_not_ready",
            status=503,
        ) from error
    payload = {
        "fixture": dict(fixture),
        "members": [dict(row) for row in rows],
        "sourceVersions": [dict(row) for row in versions],
    }
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return f"fixture-revision:sha256:{digest}"


def repository_readiness(repo_root: Path, fixture_id: str) -> dict:
    """Return opaque source/catalog identities without disclosing local paths."""

    owner_path = repo_root / "assets/owner-actions/Owner.sqlite"
    catalog_path = repo_root / "assets/catalog/photosbyelie.sqlite"
    missing = [label for label, path in (("Owner.sqlite", owner_path), ("public catalog", catalog_path)) if not path.is_file()]
    if missing:
        raise PBEOwnerSessionError(
            f"PBE Owner host is unavailable because {', '.join(missing)} is missing.",
            code="pbe_owner_host_not_ready",
            status=503,
        )
    # Owner.sqlite is the lifecycle writer's mutable source. Bind the lease to
    # the same opaque file object so an authorized X/restore does not revoke
    # itself; replacing that database still changes this identity. The public
    # catalog is a generated derivative that X may rebuild atomically, so bind
    # its validated canonical slot and schema rather than a transient inode.
    source_identity = "owner-sqlite:sha256:" + _sqlite_identity(
        owner_path,
        required_tables=("media_lifecycle", "owner_settings"),
        bind_file_object=True,
    )
    catalog_identity = "catalog-sqlite:sha256:" + _sqlite_identity(
        catalog_path,
        required_tables=("collections", "media_items"),
        bind_file_object=False,
    )
    fixture_revision = _fixture_revision(owner_path, fixture_id)
    readiness_identity = "pbe-readiness:sha256:" + hashlib.sha256(
        f"{source_identity}\n{catalog_identity}\n{fixture_revision}".encode("utf-8")
    ).hexdigest()
    return {
        "ready": True,
        "sourceIdentity": source_identity,
        "catalogIdentity": catalog_identity,
        "readinessIdentity": readiness_identity,
        "fixtureRevision": fixture_revision,
        "lifecycleWriter": "pbb-79-waste-basket",
        "capabilities": ["gallery.read", "waste-basket.x", "waste-basket.restore"],
    }


class CloudPBEOwnerSessionVerifier:
    """Validates a short-lived session with the Worker; never persists the token."""

    def __init__(
        self,
        endpoint: str = DEFAULT_CLOUD_SESSION_URL,
        *,
        opener: Callable = urlopen,
        timeout: float = 5.0,
    ) -> None:
        self.endpoint = endpoint
        self.opener = opener
        self.timeout = timeout

    def verify(self, token: str) -> dict:
        if not _clean(token):
            raise PBEOwnerSessionError(
                "A Backstage-minted PBE Owner session is required.",
                code="pbe_owner_session_required",
                status=401,
            )
        request = Request(
            self.endpoint,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "User-Agent": PBE_OWNER_VERIFIER_USER_AGENT,
            },
        )
        try:
            with self.opener(request, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            try:
                payload = json.loads(error.read().decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                payload = {}
            detail = payload.get("error") if isinstance(payload, dict) else {}
            raise PBEOwnerSessionError(
                _clean(detail.get("message") if isinstance(detail, dict) else "")
                or "The PBE Owner session was rejected.",
                code=_clean(detail.get("code") if isinstance(detail, dict) else "")
                or "pbe_owner_session_rejected",
                status=error.code,
            ) from None
        except (URLError, TimeoutError, OSError) as error:
            raise PBEOwnerSessionError(
                "PBE Owner authentication is unavailable; actions are disabled.",
                code="pbe_owner_auth_unavailable",
                status=503,
            ) from error
        session = payload.get("session") if isinstance(payload, dict) else None
        if not isinstance(session, dict):
            raise PBEOwnerSessionError(
                "PBE Owner authentication returned an invalid session contract.",
                code="pbe_owner_session_invalid",
                status=502,
            )
        return session


@dataclass(frozen=True)
class _Lease:
    session_id: str
    token_hash: str
    fixture_id: str
    fixture_breadcrumb: str
    source_identity: str
    catalog_identity: str
    readiness_identity: str
    fixture_revision: str
    capabilities: tuple[str, ...]
    cloud_expires_at: float
    lease_expires_at: float


class PBEOwnerSessionStore:
    """Holds one fixture-frozen local session; only credential digests are retained."""

    def __init__(
        self,
        *,
        now: Callable[[], float] = time.time,
        lease_seconds: int = DEFAULT_LOCAL_LEASE_SECONDS,
    ) -> None:
        self._now = now
        self._lease_seconds = max(15, min(300, int(lease_seconds)))
        self._lock = threading.Lock()
        self._lease: _Lease | None = None
        self._browser_ticket_hash = ""
        self._browser_session_hash = ""

    @staticmethod
    def _token_hash(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    @staticmethod
    def _timestamp(value: object) -> float:
        try:
            return datetime.fromisoformat(_clean(value).replace("Z", "+00:00")).timestamp()
        except ValueError as error:
            raise PBEOwnerSessionError(
                "The PBE Owner session expiry is invalid.",
                code="pbe_owner_session_invalid",
                status=502,
            ) from error

    def _validated_contract(self, session: dict, readiness: dict) -> tuple:
        fields = {
            name: _clean(session.get(name))
            for name in (
                "id",
                "fixtureId",
                "fixtureBreadcrumb",
                "sourceIdentity",
                "catalogIdentity",
                "readinessIdentity",
                "fixtureRevision",
                "expiresAt",
            )
        }
        if any(not value for value in fields.values()):
            raise PBEOwnerSessionError(
                "The PBE Owner session is missing a required fixture or identity binding.",
                code="pbe_owner_session_invalid",
                status=502,
            )
        if _clean(session.get("state")) != "ready":
            raise PBEOwnerSessionError(
                "The PBE Owner session is not ready for actions.",
                code="pbe_owner_session_inactive",
                status=401,
            )
        expected_writer = _clean(readiness.get("lifecycleWriter"))
        if (
            expected_writer != "pbb-79-waste-basket"
            or _clean(session.get("lifecycleWriter")) != expected_writer
        ):
            raise PBEOwnerSessionError(
                "The PBE Owner session is not bound to the guarded Waste Basket writer.",
                code="pbe_owner_writer_mismatch",
                status=409,
            )
        capabilities = tuple(sorted({_clean(value) for value in session.get("capabilities", []) if _clean(value)}))
        if not REQUIRED_CAPABILITIES.issubset(capabilities):
            raise PBEOwnerSessionError(
                "The PBE Owner session lacks the guarded gallery capabilities.",
                code="pbe_owner_capability_missing",
                status=403,
            )
        for field in ("sourceIdentity", "catalogIdentity", "readinessIdentity", "fixtureRevision"):
            if fields[field] != _clean(readiness.get(field)):
                raise PBEOwnerSessionError(
                    "The local PBE host no longer matches the source/catalog lease minted by Backstage.",
                    code="pbe_owner_identity_mismatch",
                    status=409,
                )
        cloud_expires_at = self._timestamp(fields["expiresAt"])
        if cloud_expires_at <= self._now():
            raise PBEOwnerSessionError(
                "The PBE Owner session has expired.",
                code="pbe_owner_session_expired",
                status=401,
            )
        return fields, capabilities, cloud_expires_at

    def start(self, token: str, session: dict, readiness: dict) -> dict:
        fields, capabilities, cloud_expires_at = self._validated_contract(session, readiness)
        now = self._now()
        lease = _Lease(
            session_id=fields["id"],
            token_hash=self._token_hash(token),
            fixture_id=fields["fixtureId"],
            fixture_breadcrumb=fields["fixtureBreadcrumb"],
            source_identity=fields["sourceIdentity"],
            catalog_identity=fields["catalogIdentity"],
            readiness_identity=fields["readinessIdentity"],
            fixture_revision=fields["fixtureRevision"],
            capabilities=capabilities,
            cloud_expires_at=cloud_expires_at,
            lease_expires_at=min(cloud_expires_at, now + self._lease_seconds),
        )
        with self._lock:
            if self._lease and self._lease.session_id != lease.session_id and self._lease.lease_expires_at > now:
                raise PBEOwnerSessionError(
                    "Another PBE Owner session is already attached to this local host.",
                    code="pbe_owner_session_conflict",
                    status=409,
                )
            self._lease = lease
            self._browser_ticket_hash = ""
            self._browser_session_hash = ""
        return self._public(lease)

    def issue_browser_handoff(self, token: str) -> str:
        """Issue one opaque, single-use handoff without exposing the cloud token."""

        ticket = secrets.token_urlsafe(32)
        now = self._now()
        with self._lock:
            lease = self._lease
            if (
                not lease
                or lease.lease_expires_at <= now
                or not hmac.compare_digest(lease.token_hash, self._token_hash(token))
            ):
                raise PBEOwnerSessionError(
                    "The PBE Owner session is not active on this host.",
                    code="pbe_owner_session_inactive",
                    status=401,
                )
            self._browser_ticket_hash = self._token_hash(ticket)
            self._browser_session_hash = ""
        return ticket

    def bootstrap_browser(self, ticket: str, readiness: dict) -> tuple[str, dict]:
        """Consume one handoff and return an unrelated browser-session secret."""

        browser_session = secrets.token_urlsafe(32)
        now = self._now()
        with self._lock:
            lease = self._lease
            if not lease or lease.lease_expires_at <= now:
                self._lease = None
                self._browser_ticket_hash = ""
                self._browser_session_hash = ""
                raise PBEOwnerSessionError(
                    "The local PBE Owner fixture lease has expired.",
                    code="pbe_owner_session_expired",
                    status=401,
                )
            if not self._browser_ticket_hash or not hmac.compare_digest(
                self._browser_ticket_hash,
                self._token_hash(ticket),
            ):
                raise PBEOwnerSessionError(
                    "The PBE Owner browser handoff is invalid or has already been used.",
                    code="pbe_owner_browser_handoff_invalid",
                    status=401,
                )
            self._assert_readiness(lease, readiness)
            self._browser_ticket_hash = ""
            self._browser_session_hash = self._token_hash(browser_session)
            return browser_session, self._public(lease)

    def authorize_browser(self, browser_session: str, readiness: dict) -> dict:
        """Authorize a loopback browser without receiving the cloud credential."""

        now = self._now()
        with self._lock:
            lease = self._lease
            if not lease or lease.lease_expires_at <= now or lease.cloud_expires_at <= now:
                self._lease = None
                self._browser_ticket_hash = ""
                self._browser_session_hash = ""
                raise PBEOwnerSessionError(
                    "The local PBE Owner fixture lease has expired.",
                    code="pbe_owner_session_expired",
                    status=401,
                )
            if not self._browser_session_hash or not hmac.compare_digest(
                self._browser_session_hash,
                self._token_hash(browser_session),
            ):
                raise PBEOwnerSessionError(
                    "The PBE Owner browser session is not active on this host.",
                    code="pbe_owner_session_inactive",
                    status=401,
                )
            self._assert_readiness(lease, readiness)
            return self._public(lease)

    @staticmethod
    def _assert_readiness(lease: _Lease, readiness: dict) -> None:
        expected = (
            _clean(readiness.get("sourceIdentity")),
            _clean(readiness.get("catalogIdentity")),
            _clean(readiness.get("readinessIdentity")),
            _clean(readiness.get("fixtureRevision")),
            _clean(readiness.get("lifecycleWriter")),
        )
        actual = (
            lease.source_identity,
            lease.catalog_identity,
            lease.readiness_identity,
            lease.fixture_revision,
            "pbb-79-waste-basket",
        )
        if expected != actual:
            raise PBEOwnerSessionError(
                "The local PBE host no longer matches the source/catalog lease minted by Backstage.",
                code="pbe_owner_identity_mismatch",
                status=409,
            )

    def authorize(self, token: str, cloud_session: dict, readiness: dict, *, heartbeat: bool = False) -> dict:
        fields, capabilities, cloud_expires_at = self._validated_contract(cloud_session, readiness)
        now = self._now()
        with self._lock:
            lease = self._lease
            if not lease:
                raise PBEOwnerSessionError(
                    "No PBE Owner session is attached to this host.",
                    code="pbe_owner_session_inactive",
                    status=401,
                )
            if lease.lease_expires_at <= now or lease.cloud_expires_at <= now:
                self._lease = None
                self._browser_ticket_hash = ""
                self._browser_session_hash = ""
                raise PBEOwnerSessionError(
                    "The local PBE Owner fixture lease has expired.",
                    code="pbe_owner_session_expired",
                    status=401,
                )
            if not hmac.compare_digest(lease.token_hash, self._token_hash(token)):
                raise PBEOwnerSessionError(
                    "The PBE Owner session token does not match this host lease.",
                    code="pbe_owner_session_mismatch",
                    status=409,
                )
            if fields["id"] != lease.session_id or fields["fixtureId"] != lease.fixture_id:
                raise PBEOwnerSessionError(
                    "The PBE Owner session fixture does not match this host lease.",
                    code="pbe_owner_session_mismatch",
                    status=409,
                )
            if fields["fixtureBreadcrumb"] != lease.fixture_breadcrumb:
                raise PBEOwnerSessionError(
                    "The PBE Owner session breadcrumb changed after launch.",
                    code="pbe_owner_session_mismatch",
                    status=409,
                )
            if tuple(capabilities) != lease.capabilities:
                raise PBEOwnerSessionError(
                    "The PBE Owner session capabilities changed after launch.",
                    code="pbe_owner_session_mismatch",
                    status=409,
                )
            if heartbeat:
                lease = _Lease(
                    **{
                        **lease.__dict__,
                        "cloud_expires_at": cloud_expires_at,
                        "lease_expires_at": min(cloud_expires_at, now + self._lease_seconds),
                    }
                )
                self._lease = lease
            return self._public(lease)

    def close_browser(self, browser_session: str) -> dict:
        with self._lock:
            lease = self._lease
            if not lease or not self._browser_session_hash or not hmac.compare_digest(
                self._browser_session_hash,
                self._token_hash(browser_session),
            ):
                raise PBEOwnerSessionError(
                    "The PBE Owner browser session is not active on this host.",
                    code="pbe_owner_session_inactive",
                    status=401,
                )
            self._lease = None
            self._browser_ticket_hash = ""
            self._browser_session_hash = ""
        result = self._public(lease)
        result["state"] = "closed"
        return result

    def close(self, token: str) -> dict:
        with self._lock:
            lease = self._lease
            if not lease or not hmac.compare_digest(lease.token_hash, self._token_hash(token)):
                raise PBEOwnerSessionError(
                    "The PBE Owner session is not active on this host.",
                    code="pbe_owner_session_inactive",
                    status=401,
                )
            self._lease = None
            self._browser_ticket_hash = ""
            self._browser_session_hash = ""
        result = self._public(lease)
        result["state"] = "closed"
        return result

    def _public(self, lease: _Lease) -> dict:
        return {
            "id": lease.session_id,
            "state": "ready",
            "fixtureId": lease.fixture_id,
            "fixtureBreadcrumb": lease.fixture_breadcrumb,
            "sourceIdentity": lease.source_identity,
            "catalogIdentity": lease.catalog_identity,
            "readinessIdentity": lease.readiness_identity,
            "fixtureRevision": lease.fixture_revision,
            "capabilities": list(lease.capabilities),
            "lifecycleWriter": "pbb-79-waste-basket",
            "expiresAt": datetime.fromtimestamp(lease.cloud_expires_at, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "leaseExpiresAt": datetime.fromtimestamp(lease.lease_expires_at, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        }

    def active_fixture_id(self) -> str:
        with self._lock:
            return self._lease.fixture_id if self._lease else ""
