#!/usr/bin/env python3
"""Bounded client for Backstage-owned local Photos preview IPC."""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import re
import socket
import stat
import struct
import tempfile
import time
import unicodedata
import uuid


SCHEMA_VERSION = 1
OPERATION = "photos.preview"
MIN_MAX_PIXEL = 256
MAX_MAX_PIXEL = 1_800
MAX_ASSET_ID_BYTES = 2_048
MAX_DESCRIPTOR_BYTES = 16_384
MAX_REQUEST_BYTES = 16_384
MAX_PREVIEW_BYTES = 8 * 1_024 * 1_024
MAX_RESPONSE_BYTES = 12 * 1_024 * 1_024
DEFAULT_TIMEOUT_SECONDS = 60.0
DEFAULT_DESCRIPTOR_PATH = (
    Path.home()
    / "Library"
    / "Application Support"
    / "PhotosByElie Backstage"
    / "photos-preview-ipc.json"
)
TOKEN_PATTERN = re.compile(r"[0-9a-f]{64}\Z")


class BackstagePhotosClientError(RuntimeError):
    """A fail-closed local IPC or response-validation error."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code

    def as_payload(self) -> dict:
        return {"ok": False, "mode": "preview", "code": self.code, "error": str(self)}


def request_preview(
    asset_id: str,
    destination: Path,
    max_pixel: int,
    *,
    descriptor_path: Path = DEFAULT_DESCRIPTOR_PATH,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> dict:
    """Request one JPEG preview and atomically replace ``destination``."""

    _validate_request_arguments(asset_id, max_pixel, timeout)
    descriptor = _read_descriptor(Path(descriptor_path))
    request_id = str(uuid.uuid4())
    request = {
        "requestId": request_id,
        "operation": OPERATION,
        "authorization": f"Bearer {descriptor['bearerToken']}",
        "assetId": asset_id,
        "maxPixel": max_pixel,
    }
    request_data = json.dumps(request, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(request_data) > MAX_REQUEST_BYTES:
        raise BackstagePhotosClientError("request_oversized", "The Backstage preview request is too large.")

    deadline = time.monotonic() + timeout
    try:
        with socket.create_connection(
            (descriptor["host"], descriptor["port"]),
            timeout=_remaining(deadline),
        ) as connection:
            connection.settimeout(_remaining(deadline))
            connection.sendall(struct.pack("!I", len(request_data)) + request_data)
            response_length = struct.unpack("!I", _read_exact(connection, 4, deadline))[0]
            if response_length == 0 or response_length > MAX_RESPONSE_BYTES:
                raise BackstagePhotosClientError(
                    "response_oversized",
                    "The Backstage preview response exceeds the allowed size.",
                )
            response_data = _read_exact(connection, response_length, deadline)
    except BackstagePhotosClientError:
        raise
    except (ConnectionError, OSError, TimeoutError) as error:
        code = "ipc_timeout" if isinstance(error, (socket.timeout, TimeoutError)) else "ipc_unavailable"
        raise BackstagePhotosClientError(
            code,
            "The running Backstage app did not answer the Photos preview request.",
        ) from error

    response = _decode_response(response_data, request_id, asset_id, max_pixel)
    jpeg_data = response.pop("jpegData")
    destination = Path(destination)
    _atomic_write(destination, jpeg_data)
    return {
        "ok": True,
        "mode": "preview",
        "destination": str(destination),
        "bytes": len(jpeg_data),
        "pixelWidth": response["pixelWidth"],
        "pixelHeight": response["pixelHeight"],
    }


def _validate_request_arguments(asset_id: str, max_pixel: int, timeout: float) -> None:
    if not isinstance(asset_id, str) or not asset_id or asset_id.strip() != asset_id:
        raise BackstagePhotosClientError("invalid_asset_id", "A non-empty Photos asset ID is required.")
    if len(asset_id.encode("utf-8")) > MAX_ASSET_ID_BYTES or any(
        unicodedata.category(char) == "Cc" for char in asset_id
    ):
        raise BackstagePhotosClientError("invalid_asset_id", "The Photos asset ID exceeds the allowed size.")
    if not isinstance(max_pixel, int) or not MIN_MAX_PIXEL <= max_pixel <= MAX_MAX_PIXEL:
        raise BackstagePhotosClientError("invalid_max_pixel", "maxPixel must be between 256 and 1800.")
    if not isinstance(timeout, (int, float)) or not 0 < float(timeout) <= DEFAULT_TIMEOUT_SECONDS:
        raise BackstagePhotosClientError("invalid_timeout", "The preview timeout must be between 0 and 60 seconds.")


def _read_descriptor(descriptor_path: Path) -> dict:
    parent_info = _safe_lstat(descriptor_path.parent, "descriptor_directory_missing")
    if (
        not stat.S_ISDIR(parent_info.st_mode)
        or parent_info.st_uid != os.getuid()
        or stat.S_IMODE(parent_info.st_mode) & 0o077
    ):
        raise BackstagePhotosClientError(
            "unsafe_descriptor_directory",
            "The Backstage IPC descriptor directory is not owner-only.",
        )

    descriptor_info = _safe_lstat(descriptor_path, "backstage_not_running")
    if (
        not stat.S_ISREG(descriptor_info.st_mode)
        or descriptor_info.st_uid != os.getuid()
        or stat.S_IMODE(descriptor_info.st_mode) & 0o077
        or descriptor_info.st_nlink != 1
        or descriptor_info.st_size <= 0
        or descriptor_info.st_size > MAX_DESCRIPTOR_BYTES
    ):
        raise BackstagePhotosClientError(
            "unsafe_descriptor",
            "The Backstage IPC descriptor is not a safe owner-only regular file.",
        )

    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        file_descriptor = os.open(descriptor_path, flags)
    except OSError as error:
        raise BackstagePhotosClientError("unsafe_descriptor", "The Backstage IPC descriptor could not be opened safely.") from error
    try:
        opened_info = os.fstat(file_descriptor)
        if (opened_info.st_dev, opened_info.st_ino) != (descriptor_info.st_dev, descriptor_info.st_ino):
            raise BackstagePhotosClientError("unsafe_descriptor", "The Backstage IPC descriptor changed while opening.")
        raw = os.read(file_descriptor, MAX_DESCRIPTOR_BYTES + 1)
    finally:
        os.close(file_descriptor)
    if len(raw) > MAX_DESCRIPTOR_BYTES:
        raise BackstagePhotosClientError("unsafe_descriptor", "The Backstage IPC descriptor is oversized.")
    try:
        descriptor = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise BackstagePhotosClientError("invalid_descriptor", "The Backstage IPC descriptor is malformed.") from error
    if not isinstance(descriptor, dict):
        raise BackstagePhotosClientError("invalid_descriptor", "The Backstage IPC descriptor is malformed.")

    if descriptor.get("schemaVersion") != SCHEMA_VERSION or descriptor.get("host") != "127.0.0.1":
        raise BackstagePhotosClientError("invalid_descriptor", "The Backstage IPC descriptor has an unsupported endpoint.")
    port = descriptor.get("port")
    pid = descriptor.get("pid")
    token = descriptor.get("bearerToken")
    started_at = descriptor.get("startedAtEpoch")
    if (
        not isinstance(port, int)
        or not 1 <= port <= 65_535
        or not isinstance(pid, int)
        or pid <= 1
        or not isinstance(token, str)
        or not TOKEN_PATTERN.fullmatch(token)
        or not isinstance(started_at, (int, float))
        or started_at <= 0
        or started_at > time.time() + 60
    ):
        raise BackstagePhotosClientError("invalid_descriptor", "The Backstage IPC descriptor contains invalid fields.")
    try:
        os.kill(pid, 0)
    except (ProcessLookupError, PermissionError, OSError) as error:
        raise BackstagePhotosClientError("stale_descriptor", "The Backstage IPC descriptor belongs to a dead or inaccessible process.") from error
    return descriptor


def _safe_lstat(file_path: Path, missing_code: str) -> os.stat_result:
    try:
        return os.lstat(file_path)
    except FileNotFoundError as error:
        raise BackstagePhotosClientError(missing_code, "The running Backstage preview endpoint is unavailable.") from error
    except OSError as error:
        raise BackstagePhotosClientError("unsafe_descriptor", "The Backstage IPC descriptor could not be inspected safely.") from error


def _read_exact(connection: socket.socket, count: int, deadline: float) -> bytes:
    chunks: list[bytes] = []
    remaining_count = count
    while remaining_count:
        connection.settimeout(_remaining(deadline))
        chunk = connection.recv(remaining_count)
        if not chunk:
            raise BackstagePhotosClientError("ipc_truncated", "Backstage closed the IPC response early.")
        chunks.append(chunk)
        remaining_count -= len(chunk)
    return b"".join(chunks)


def _remaining(deadline: float) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError("IPC deadline exceeded")
    return remaining


def _decode_response(response_data: bytes, request_id: str, asset_id: str, max_pixel: int) -> dict:
    try:
        response = json.loads(response_data)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise BackstagePhotosClientError("invalid_response", "Backstage returned malformed JSON.") from error
    if not isinstance(response, dict) or response.get("requestId") != request_id:
        raise BackstagePhotosClientError("invalid_response", "Backstage returned a mismatched request ID.")
    if response.get("ok") is not True:
        error_payload = response.get("error") if isinstance(response.get("error"), dict) else {}
        code = str(error_payload.get("code") or "preview_failed")
        message = str(error_payload.get("message") or "Backstage could not prepare the preview.")
        raise BackstagePhotosClientError(code, message)
    if response.get("mode") != "preview" or response.get("assetId") != asset_id or response.get("mimeType") != "image/jpeg":
        raise BackstagePhotosClientError("invalid_response", "Backstage returned the wrong preview response.")
    width = response.get("pixelWidth")
    height = response.get("pixelHeight")
    byte_count = response.get("bytes")
    encoded = response.get("dataBase64")
    if (
        not isinstance(width, int)
        or not isinstance(height, int)
        or not 0 < width <= max_pixel
        or not 0 < height <= max_pixel
        or not isinstance(byte_count, int)
        or not 0 < byte_count <= MAX_PREVIEW_BYTES
        or not isinstance(encoded, str)
    ):
        raise BackstagePhotosClientError("invalid_response", "Backstage returned invalid preview metadata.")
    try:
        jpeg_data = base64.b64decode(encoded, validate=True)
    except (ValueError, base64.binascii.Error) as error:
        raise BackstagePhotosClientError("invalid_response", "Backstage returned invalid preview bytes.") from error
    if (
        len(jpeg_data) != byte_count
        or len(jpeg_data) > MAX_PREVIEW_BYTES
        or not jpeg_data.startswith(b"\xff\xd8")
        or not jpeg_data.endswith(b"\xff\xd9")
    ):
        raise BackstagePhotosClientError("invalid_response", "Backstage returned malformed JPEG preview bytes.")
    response["jpegData"] = jpeg_data
    return response


def _atomic_write(destination: Path, data: bytes) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.name}.",
        suffix=".tmp",
        dir=destination.parent,
    )
    temporary = Path(temporary_name)
    try:
        os.fchmod(file_descriptor, 0o600)
        with os.fdopen(file_descriptor, "wb", closefd=True) as handle:
            file_descriptor = -1
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, destination)
        directory_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        directory_descriptor = os.open(destination.parent, directory_flags)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        if file_descriptor >= 0:
            os.close(file_descriptor)
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
