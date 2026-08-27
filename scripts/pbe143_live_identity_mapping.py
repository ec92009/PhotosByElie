#!/usr/bin/env python3
"""Collect a private, source-tied PhotoKit identity map through Backstage IPC.

Raw Apple identifiers are written only to an owner-only JSONL file. Console
output is deliberately limited to counts and a digest so the collection can be
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
    request_library_index,
)


MAX_LIBRARY_ASSETS = 1_000_000


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


def _validated_page(payload: dict, *, offset: int, page_size: int, expected_total: int | None) -> tuple[list[dict], int]:
    """Validate snapshot continuity before any page is committed to disk."""

    rows = payload.get("items")
    total = payload.get("fetchedCount")
    skipped = payload.get("skippedCount")
    if (
        payload.get("ok") is not True
        or payload.get("mode") != "library-index"
        or payload.get("offset") != offset
        or payload.get("limit") != page_size
        or not isinstance(rows, list)
        or payload.get("count") != len(rows)
        or not isinstance(total, int)
        or total < 0
        or total > MAX_LIBRARY_ASSETS
        or skipped != min(offset, total)
        or (expected_total is not None and total != expected_total)
    ):
        raise IdentityCollectionError("library-snapshot-changed-or-invalid")
    expected_count = min(page_size, max(0, total - offset))
    if len(rows) != expected_count:
        raise IdentityCollectionError("library-page-incomplete")
    if any(not isinstance(row, dict) for row in rows):
        raise IdentityCollectionError("library-row-invalid")
    return rows, total


def collect_identity_mapping(
    destination: Path,
    *,
    page_size: int = 1_000,
    descriptor_path: Path = DEFAULT_DESCRIPTOR_PATH,
    timeout: float = DEFAULT_LIBRARY_INDEX_TIMEOUT_SECONDS,
    fetch_page: Callable[..., dict] = request_library_index,
) -> dict:
    """Collect and atomically publish a private local-to-cloud identity map."""

    if not isinstance(page_size, int) or not 1 <= page_size <= 1_000:
        raise IdentityCollectionError("page-size-out-of-bounds")
    destination = Path(os.path.abspath(Path(destination).expanduser()))
    _private_parent(destination)

    temporary_path: Path | None = None
    output_stream = None
    digest = hashlib.sha256(b"pbe143-live-identity-map\0")
    total: int | None = None
    offset = 0
    page_count = 0
    mapped_count = 0
    missing_cloud_count = 0
    try:
        file_descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{destination.name}.", suffix=".tmp", dir=destination.parent
        )
        temporary_path = Path(temporary_name)
        os.fchmod(file_descriptor, 0o600)
        output_stream = os.fdopen(file_descriptor, "w", encoding="utf-8")

        while total is None or offset < total:
            payload = fetch_page(
                page_size,
                offset,
                descriptor_path=Path(descriptor_path),
                timeout=timeout,
            )
            rows, page_total = _validated_page(
                payload,
                offset=offset,
                page_size=page_size,
                expected_total=total,
            )
            if total is None:
                total = page_total
            for row in rows:
                local_identifier = row.get("localIdentifier")
                cloud_identifier = row.get("cloudIdentifier")
                if not isinstance(local_identifier, str) or not local_identifier:
                    raise IdentityCollectionError("library-row-missing-local-identity")
                if not isinstance(cloud_identifier, str):
                    raise IdentityCollectionError("library-row-invalid-cloud-identity")
                mapping_row = {
                    "localIdentifier": local_identifier,
                    "cloudIdentifier": cloud_identifier,
                    "status": "source-tied" if cloud_identifier else "missing",
                }
                encoded = json.dumps(mapping_row, ensure_ascii=False, separators=(",", ":"))
                output_stream.write(encoded + "\n")
                digest.update(encoded.encode("utf-8") + b"\n")
                if cloud_identifier:
                    mapped_count += 1
                else:
                    missing_cloud_count += 1
            offset += len(rows)
            page_count += 1

        total = total or 0
        if offset != total or mapped_count + missing_cloud_count != total:
            raise IdentityCollectionError("library-snapshot-incomplete")
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
        "sourceRowCount": total,
        "mappedCount": mapped_count,
        "missingCloudCount": missing_cloud_count,
        "pageCount": page_count,
        "mappingDigest": digest.hexdigest(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--page-size", type=int, default=1_000)
    parser.add_argument("--descriptor", type=Path, default=DEFAULT_DESCRIPTOR_PATH)
    parser.add_argument("--timeout", type=float, default=DEFAULT_LIBRARY_INDEX_TIMEOUT_SECONDS)
    arguments = parser.parse_args()
    try:
        summary = collect_identity_mapping(
            arguments.output,
            page_size=arguments.page_size,
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
