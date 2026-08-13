#!/usr/bin/env python3
"""Fail-closed, memory-only lease for Backstage-hosted PBE Owner sessions."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
import json
from pathlib import Path
import secrets
import sqlite3
import threading
import time
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


DEFAULT_CLOUD_SESSION_URL = "https://auth.photos-by-elie.com/api/v1/pbe-owner/session"
DEFAULT_LOCAL_LEASE_SECONDS = 90
REQUIRED_CAPABILITIES = frozenset(
    {"gallery.read", "waste-basket.x", "waste-basket.restore"}
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


def repository_readiness(repo_root: Path) -> dict:
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
    readiness_identity = "pbe-readiness:sha256:" + hashlib.sha256(
        f"{source_identity}\n{catalog_identity}".encode("utf-8")
    ).hexdigest()
    return {
        "ready": True,
        "sourceIdentity": source_identity,
        "catalogIdentity": catalog_identity,
        "readinessIdentity": readiness_identity,
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
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
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
        for field in ("sourceIdentity", "catalogIdentity", "readinessIdentity"):
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
            _clean(readiness.get("lifecycleWriter")),
        )
        actual = (
            lease.source_identity,
            lease.catalog_identity,
            lease.readiness_identity,
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
            "capabilities": list(lease.capabilities),
            "lifecycleWriter": "pbb-79-waste-basket",
            "expiresAt": datetime.fromtimestamp(lease.cloud_expires_at, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "leaseExpiresAt": datetime.fromtimestamp(lease.lease_expires_at, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        }
