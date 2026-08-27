#!/usr/bin/env python3
"""Resolve only Owner's local-only PhotoKit identities through Backstage IPC.

Raw Apple identifiers are written only to an owner-only JSONL file. Console
output is deliberately limited to counts and digests so the collection can be
audited without exposing library identities.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
from typing import Callable

from backstage_photos_client import (
    DEFAULT_DESCRIPTOR_PATH,
    DEFAULT_LIBRARY_INDEX_TIMEOUT_SECONDS,
    MAX_IDENTITY_MAP_ITEMS,
    request_identity_mapping,
)
from sidecar_identity_migration import owner_local_identifiers_for_mapping


class IdentityCollectionError(RuntimeError):
    """A privacy-safe, fail-closed identity collection error."""


def _private_parent(destination: Path) -> None:
    """Require an existing owner-only directory and a new destination path."""

    try:
        parent = os.lstat(destination.parent)
    except OSError as error:
        raise IdentityCollectionError("private-output-directory-unavailable") from error
    if (
        not stat.S_ISDIR(parent.st_mode)
        or parent.st_uid != os.getuid()
        or stat.S_IMODE(parent.st_mode) & 0o077
    ):
        raise IdentityCollectionError("private-output-directory-required")
    try:
        os.lstat(destination)
    except FileNotFoundError:
        return
    except OSError as error:
        raise IdentityCollectionError("output-path-unavailable") from error
    raise IdentityCollectionError("output-path-must-be-new")


def _validate_mapping_response(payload: dict, requested: list[str]) -> list[dict]:
    """Require an exact ordered response for the requested local IDs."""

    rows = payload.get("items")
    if (
        payload.get("ok") is not True
        or payload.get("mode") != "identity-map"
        or not isinstance(rows, list)
        or payload.get("count") != len(rows)
        or len(rows) != len(requested)
    ):
        raise IdentityCollectionError("identity-map-response-invalid")
    for expected, row in zip(requested, rows, strict=True):
        if (
            not isinstance(row, dict)
            or row.get("localIdentifier") != expected
            or not isinstance(row.get("cloudIdentifier"), str)
            or row.get("status") not in {"source-tied", "missing"}
            or (row.get("status") == "source-tied") != bool(row.get("cloudIdentifier"))
        ):
            raise IdentityCollectionError("identity-map-row-invalid")
    return rows


def collect_identity_mapping(
    destination: Path,
    owner_db: Path,
    *,
    batch_size: int = MAX_IDENTITY_MAP_ITEMS,
    descriptor_path: Path = DEFAULT_DESCRIPTOR_PATH,
    timeout: float = DEFAULT_LIBRARY_INDEX_TIMEOUT_SECONDS,
    fetch_mapping: Callable[..., dict] = request_identity_mapping,
    load_local_identifiers: Callable[[Path], list[str]] = owner_local_identifiers_for_mapping,
) -> dict:
    """Resolve Owner's exact local-only IDs and atomically publish a private map."""

    if not isinstance(batch_size, int) or not 1 <= batch_size <= MAX_IDENTITY_MAP_ITEMS:
        raise IdentityCollectionError("batch-size-out-of-bounds")
    destination = Path(os.path.abspath(Path(destination).expanduser()))
    owner_db = Path(owner_db).expanduser()
    _private_parent(destination)
    local_identifiers = load_local_identifiers(owner_db)
    if (
        not isinstance(local_identifiers, list)
        or any(not isinstance(value, str) or not value for value in local_identifiers)
        or local_identifiers != sorted(set(local_identifiers))
    ):
        raise IdentityCollectionError("owner-local-identity-snapshot-invalid")

    temporary_path: Path | None = None
    output_stream = None
    mapping_digest = hashlib.sha256(b"pbe143-live-identity-map\0")
    owner_digest = hashlib.sha256(b"pbe143-owner-local-identities\0")
    for local_identifier in local_identifiers:
        owner_digest.update(local_identifier.encode("utf-8") + b"\n")
    mapped_count = 0
    missing_cloud_count = 0
    batch_count = 0
    try:
        file_descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent
        )
        temporary_path = Path(temporary_name)
        os.fchmod(file_descriptor, 0o600)
        output_stream = os.fdopen(file_descriptor, "w", encoding="utf-8")

        for start in range(0, len(local_identifiers), batch_size):
            requested = local_identifiers[start:start + batch_size]
            payload = fetch_mapping(
                requested,
                descriptor_path=Path(descriptor_path),
                timeout=timeout,
            )
            rows = _validate_mapping_response(payload, requested)
            for row in rows:
                mapping_row = {
                    "localIdentifier": row["localIdentifier"],
                    "cloudIdentifier": row["cloudIdentifier"],
                    "status": row["status"],
                }
                encoded = json.dumps(mapping_row, ensure_ascii=False, separators=(",", ":"))
                output_stream.write(encoded + "\n")
                mapping_digest.update(encoded.encode("utf-8") + b"\n")
                if row["status"] == "source-tied":
                    mapped_count += 1
                else:
                    missing_cloud_count += 1
            batch_count += 1

        if mapped_count + missing_cloud_count != len(local_identifiers):
            raise IdentityCollectionError("owner-identity-snapshot-incomplete")
        output_stream.flush()
        os.fsync(output_stream.fileno())
        output_stream.close()
        output_stream = None
        os.replace(temporary_path, destination)
        temporary_path = None
        os.chmod(destination, 0o600)
        directory_descriptor = os.open(destination.parent, os.O_RDONLY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    except BaseException:
        if output_stream is not None:
            try:
                output_stream.close()
            except OSError:
                pass
        if temporary_path is not None:
            try:
                temporary_path.unlink()
            except FileNotFoundError:
                pass
        raise

    return {
        "ok": True,
        "mode": "pbe143-live-identity-mapping",
        "readOnlySource": True,
        "privateOutput": True,
        "ownerLocalOnlyCount": len(local_identifiers),
        "mappedCount": mapped_count,
        "missingCloudCount": missing_cloud_count,
        "batchCount": batch_count,
        "ownerLocalIdentifierDigest": owner_digest.hexdigest(),
        "mappingDigest": mapping_digest.hexdigest(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--owner-db", required=True, type=Path)
    parser.add_argument("--batch-size", type=int, default=MAX_IDENTITY_MAP_ITEMS)
    parser.add_argument("--descriptor", type=Path, default=DEFAULT_DESCRIPTOR_PATH)
    parser.add_argument("--timeout", type=float, default=DEFAULT_LIBRARY_INDEX_TIMEOUT_SECONDS)
    arguments = parser.parse_args()
    try:
        summary = collect_identity_mapping(
            arguments.output,
            arguments.owner_db,
            batch_size=arguments.batch_size,
            descriptor_path=arguments.descriptor,
            timeout=arguments.timeout,
        )
    except Exception as error:
        code = str(error) if isinstance(error, IdentityCollectionError) else "identity-collection-failed"
        print(json.dumps({"ok": False, "mode": "pbe143-live-identity-mapping", "code": code}, sort_keys=True))
        return 1
    print(json.dumps(summary, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
