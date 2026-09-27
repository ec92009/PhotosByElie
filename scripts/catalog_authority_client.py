#!/usr/bin/env python3
"""Opt-in public-catalog authority protocol; no catalog bytes or arbitrary URLs.

Enrollment is an explicit operational step, not source activation. Do not run
it until the installed Backstage writer is proven to consume the guarded hooks.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import stat
from typing import Callable

ORIGIN = "https://auth.photos-by-elie.com"
AUTHORITY_PATH = "/api/v1/public-catalog/authority"
CANONICAL_REPO_ROOT = (Path.home() / "Dev" / "PhotosByElie").resolve()
CONFIG_PATH = Path.home() / ".config" / "photosbyelie" / "connector.json"
MAX_RESPONSE_BYTES = 32 * 1024
MAX_SAFE_INTEGER = 2**53 - 1
_HEX = re.compile(r"[a-f0-9]{64}")
_FIELDS = {"schema", "ok", "generation", "state", "operationId", "projectionRevision",
           "sha256", "publisherId", "checkedAt", "updatedAt"}


class AuthorityError(RuntimeError):
    """A secret-free dependency/conflict; reconcile before any retry."""


@dataclass(frozen=True)
class ConnectorCredential:
    token: str = field(repr=False)
    connector_id: str
    repo_root: Path = field(repr=False)


def load_credentials(path: Path | None = None) -> ConnectorCredential:
    """Read only the private, non-symlink enrolled connector pinned to this repo."""
    path = Path(path or CONFIG_PATH).expanduser().absolute()
    try:
        if any(part.is_symlink() for part in (path, *path.parents)):
            raise ValueError()
        parent = path.parent.stat()
        if parent.st_uid != os.getuid() or parent.st_mode & 0o022:
            raise ValueError()
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, "rb") as handle:
            info = os.fstat(handle.fileno())
            if (not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600
                    or info.st_uid != os.getuid() or info.st_size > 65536):
                raise ValueError()
            row = json.loads(handle.read(65537))
        if not isinstance(row, dict) or row.get("workerBase") not in {ORIGIN, ORIGIN + "/"}:
            raise ValueError()
        root = row.get("repoRoot")
        if (not isinstance(root, str) or not Path(root).expanduser().is_absolute()
                or Path(root).expanduser().resolve() != CANONICAL_REPO_ROOT):
            raise ValueError()
        token, connector_id = row.get("token"), row.get("connectorId")
        if (not isinstance(token, str) or not 24 <= len(token) <= 8192
                or any(not 33 <= ord(char) <= 126 for char in token)
                or not isinstance(connector_id, str)
                or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", connector_id)
                or len(connector_id) > 80):
            raise ValueError()
        return ConnectorCredential(token, connector_id, CANONICAL_REPO_ROOT)
    except (OSError, ValueError, TypeError):
        raise AuthorityError("Catalog authority connector configuration is unavailable or unverified") from None


def operation_id(revision: int, digest: str) -> str:
    """Deterministically bind the approved projection revision and full checksum."""
    if (type(revision) is not int or not 1 <= revision <= MAX_SAFE_INTEGER
            or not isinstance(digest, str) or not _HEX.fullmatch(digest)):
        raise AuthorityError("Catalog authority projection identity is invalid")
    return hashlib.sha256(f"public-catalog\n{revision}\n{digest}".encode("ascii")).hexdigest()


def _http_request(method: str, headers: dict, body: bytes | None) -> tuple[int, bytes]:
    """Fixed TLS origin/path, bounded response and timeout; never follow redirects."""
    connection = http.client.HTTPSConnection("auth.photos-by-elie.com", timeout=15)
    try:
        connection.request(method, AUTHORITY_PATH, body=body, headers=headers)
        response = connection.getresponse()
        payload = response.read(MAX_RESPONSE_BYTES + 1)
        if len(payload) > MAX_RESPONSE_BYTES:
            raise AuthorityError("Catalog authority response exceeds its bound")
        return response.status, payload
    except Exception:
        raise AuthorityError("Catalog authority request is uncertain; reconcile before retrying") from None
    finally:
        connection.close()


class CatalogAuthorityClient:
    """Compare-and-swap prepare/commit with exact, fresh and publisher-bound receipts."""

    def __init__(self, credential: ConnectorCredential, *, transport=None):
        self._credential = credential
        self.publisher_id = credential.connector_id
        self._transport = transport or _http_request

    def _request(self, method: str, body: dict | None = None) -> tuple[int, bytes]:
        try:
            status, payload = self._transport(
                method, {"Authorization": f"Bearer {self._credential.token}",
                         "Accept": "application/json", "Content-Type": "application/json"},
                None if body is None else json.dumps(body, sort_keys=True, separators=(",", ":")).encode(),
            )
            if type(status) is not int or not isinstance(payload, bytes) or len(payload) > MAX_RESPONSE_BYTES:
                raise ValueError()
            return status, payload
        except Exception:
            raise AuthorityError("Catalog authority request is uncertain; reconcile before retrying") from None

    def _receipt(self, status: int, payload: bytes) -> dict:
        try:
            row = json.loads(payload)
            if (status != 200 or not isinstance(row, dict) or set(row) != _FIELDS
                    or row["schema"] != "photosbyelie.publicCatalogAuthority.v1" or row["ok"] is not True
                    or type(row["generation"]) is not int or not 1 <= row["generation"] <= MAX_SAFE_INTEGER
                    or row["state"] not in {"pending", "verified"}
                    or row["publisherId"] != self.publisher_id
                    or row["operationId"] != operation_id(row["projectionRevision"], row["sha256"])):
                raise ValueError()
            times = [datetime.fromisoformat(row[key].replace("Z", "+00:00")) for key in ("checkedAt", "updatedAt")]
            if (any(value.tzinfo is None for value in times) or times[1] > times[0]
                    or not -5 <= (datetime.now(timezone.utc) - times[0]).total_seconds() <= 60):
                raise ValueError()
            return row
        except (ValueError, TypeError, KeyError, AttributeError, OverflowError, AuthorityError):
            raise AuthorityError("Catalog authority receipt is unavailable, stale or mismatched") from None

    def get(self) -> dict | None:
        """Explicit typed absence only; all other failures stay blocked."""
        status, payload = self._request("GET")
        if status == 404:
            try:
                row = json.loads(payload)
                if (isinstance(row, dict) and row.get("ok") is False
                        and isinstance(row.get("error"), dict)
                        and row["error"].get("code") == "public_catalog_authority_absent"):
                    return None
            except (ValueError, TypeError, AttributeError):
                pass
        return self._receipt(status, payload)

    def _transition(self, phase: str, generation: int, revision: int, digest: str) -> dict:
        if (phase not in {"prepare", "commit"} or type(generation) is not int
                or not (0 if phase == "prepare" else 1) <= generation <= MAX_SAFE_INTEGER
                or phase == "prepare" and generation == MAX_SAFE_INTEGER):
            raise AuthorityError("Catalog authority generation is invalid or exhausted")
        body = {"schema": "photosbyelie.publicCatalogTransition.v1", "phase": phase,
                "operationId": operation_id(revision, digest), "expectedGeneration": generation,
                "projectionRevision": revision, "sha256": digest}
        row = self._receipt(*self._request("POST", body))
        expected = {"operationId": body["operationId"], "projectionRevision": revision, "sha256": digest,
                    "generation": generation + 1 if phase == "prepare" else generation,
                    "state": "pending" if phase == "prepare" else "verified"}
        if any(row[key] != value for key, value in expected.items()):
            raise AuthorityError("Catalog authority transition returned a conflicting identity")
        return row

    def prepare(self, revision: int, digest: str, *, floor_generation: int = 0) -> dict:
        """Reconcile first; only the same immutable operation can replay a pending prepare."""
        if type(floor_generation) is not int or not 0 <= floor_generation <= MAX_SAFE_INTEGER:
            raise AuthorityError("Catalog authority generation floor is invalid")
        identity = operation_id(revision, digest)
        current = self.get()
        if current is None:
            if floor_generation:
                raise AuthorityError("Enrolled catalog authority disappeared")
        else:
            if current["generation"] < floor_generation:
                raise AuthorityError("Catalog authority generation moved backwards")
            if current["operationId"] == identity:
                return current
            if current["state"] == "pending" or current["projectionRevision"] >= revision:
                raise AuthorityError("Catalog authority has another pending or newer projection")
        return self._transition("prepare", current["generation"] if current else 0, revision, digest)

    def commit(self, prepared: dict, *, before_commit: Callable[[], None] = lambda: None) -> dict:
        """Commit the exact generation; even verified replay rechecks public parity server-side."""
        if (not isinstance(prepared, dict) or type(prepared.get("generation")) is not int
                or not 1 <= prepared["generation"] <= MAX_SAFE_INTEGER
                or prepared.get("publisherId") != self.publisher_id
                or prepared.get("operationId") != operation_id(prepared.get("projectionRevision"), prepared.get("sha256"))):
            raise AuthorityError("Catalog authority prepared identity is invalid")
        current = self.get()
        if current is None or any(current[key] != prepared.get(key) for key in (
            "generation", "operationId", "projectionRevision", "sha256", "publisherId",
        )):
            raise AuthorityError("Catalog authority changed before commit")
        before_commit()
        return self._transition("commit", current["generation"], current["projectionRevision"], current["sha256"])


def is_canonical_owner(owner_db: Path) -> bool:
    """Classify by the fixed resolved Owner path, never config, flags or basename.

    Resolve both sides so aliases cannot opt a production database out of the
    guard. Credential loading separately rejects an unsafe canonical target.
    """
    try:
        canonical = CANONICAL_REPO_ROOT / "assets/owner-actions/Owner.sqlite"
        return owner_db.resolve() == canonical.resolve()
    except (OSError, RuntimeError):
        raise AuthorityError("Catalog authority Owner path cannot be verified") from None


def client_for_owner(owner_db: Path) -> CatalogAuthorityClient:
    """Never point a production authority check at an alternate Owner database."""
    credential = load_credentials()
    if owner_db.is_symlink() or owner_db.resolve() != credential.repo_root / "assets/owner-actions/Owner.sqlite":
        raise AuthorityError("Catalog authority Owner database does not match the canonical connector root")
    return CatalogAuthorityClient(credential)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    enroll = subparsers.add_parser("enroll", help="explicitly enroll only after installed-writer hook verification")
    enroll.add_argument("--owner-db", type=Path, required=True)
    args = parser.parse_args()
    try:
        from owner_catalog_projection import enroll_catalog_authority
        result = enroll_catalog_authority(args.owner_db)
    except Exception:
        print(json.dumps({"ok": False, "error": "Catalog authority enrollment blocked; reconcile before retrying"}))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
