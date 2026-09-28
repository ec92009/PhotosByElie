"""Bounded, GET-only evidence for exact legacy R2 photo recovery.

No upload, URL signing, original file output, redirect, or provider-body logging.
The native recovery command uses the existing R2 environment credentials.
"""

from __future__ import annotations

import hashlib
import hmac
import http.client
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import quote

CATALOG_HOST = "photos-by-elie.com"
CATALOG_PATH = "/assets/catalog/photosbyelie.sqlite"
MAX_CATALOG = 64 * 1024 * 1024
MAX_OBJECT = 256 * 1024 * 1024


class RecoveryError(ValueError):
    """Secret-free recovery dependency; no upstream response is included."""


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def stamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def jpeg_dimensions(header: bytes) -> tuple[int, int]:
    """Read a bounded JPEG SOF header; this is not a full pixel decoder."""
    position = 2
    while position + 4 <= len(header):
        if header[position] != 255:
            break
        while position < len(header) and header[position] == 255:
            position += 1
        if position + 3 > len(header):
            break
        marker = header[position]
        size = int.from_bytes(header[position + 1:position + 3], "big")
        if size < 2:
            break
        if marker in {0xC0, 0xC1, 0xC2} and position + 8 <= len(header):
            height = int.from_bytes(header[position + 4:position + 6], "big")
            width = int.from_bytes(header[position + 6:position + 8], "big")
            if 0 < width <= 65535 and 0 < height <= 65535:
                return width, height
            break
        if marker in {0xDA, 0xD9}:
            break
        position += 1 + size
    raise RecoveryError("jpeg_dimensions_unavailable")


def get_catalog() -> bytes:
    """Read the fixed public catalog with no redirect or unbounded buffering."""
    conn = http.client.HTTPSConnection(CATALOG_HOST, timeout=20)
    try:
        conn.request("GET", CATALOG_PATH, headers={"Accept-Encoding": "identity"})
        response = conn.getresponse()
        if response.status != 200:
            raise RecoveryError("public_catalog_unavailable")
        data = response.read(MAX_CATALOG + 1)
        if not data.startswith(b"SQLite format 3\x00") or len(data) > MAX_CATALOG:
            raise RecoveryError("public_catalog_invalid")
        return data
    except RecoveryError:
        raise
    except Exception:
        raise RecoveryError("public_catalog_read_failed") from None
    finally:
        conn.close()


def read_object(bucket: str, key: str) -> dict:
    """Hash one exact canonical JPEG object, without persisting its contents."""
    match = re.fullmatch(r"(?:masters/([a-z0-9][a-z0-9._-]{0,127})\.jpg|expo/([a-z0-9][a-z0-9._-]{0,127})_(900|1800)\.jpg)", key)
    private = bucket == "photosbyelie-private"
    if not match or bucket not in {"photosbyelie-private", "photosbyelie-public"} or private != bool(match[1]):
        raise RecoveryError("object_scope_invalid")
    account = os.environ.get("R2_ACCOUNT_ID") or os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
    access = os.environ.get("R2_ACCESS_KEY_ID") or os.environ.get("AWS_ACCESS_KEY_ID", "")
    secret = os.environ.get("R2_SECRET_ACCESS_KEY") or os.environ.get("AWS_SECRET_ACCESS_KEY", "")
    if not re.fullmatch(r"[a-f0-9]{32}", account) or not access or not secret:
        raise RecoveryError("r2_credentials_unavailable")
    host = account + ".r2.cloudflarestorage.com"
    if os.environ.get("R2_S3_ENDPOINT", "") not in {"", host, "https://" + host}:
        raise RecoveryError("r2_origin_mismatch")
    target = "/" + bucket + "/" + quote(key, safe="/-_.~")
    date = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    names, empty = "host;x-amz-content-sha256;x-amz-date", sha256(b"")
    headers = f"host:{host}\nx-amz-content-sha256:{empty}\nx-amz-date:{date}\n"
    canonical = "\n".join(("GET", target, "", headers, names, empty))
    scope = date[:8] + "/auto/s3/aws4_request"
    signing = ("AWS4" + secret).encode()
    for value in (date[:8], "auto", "s3", "aws4_request"):
        signing = hmac.new(signing, value.encode(), hashlib.sha256).digest()
    signature = hmac.new(signing, "\n".join(("AWS4-HMAC-SHA256", date, scope, sha256(canonical.encode()))).encode(), hashlib.sha256).hexdigest()
    conn = http.client.HTTPSConnection(host, timeout=20)
    try:
        conn.request("GET", target, headers={"x-amz-content-sha256": empty, "x-amz-date": date,
            "Accept-Encoding": "identity",
            "Authorization": f"AWS4-HMAC-SHA256 Credential={access}/{scope}, SignedHeaders={names}, Signature={signature}"})
        response = conn.getresponse()
        length = response.getheader("Content-Length", "")
        if response.status != 200 or not length.isdecimal() or not 0 < int(length) <= MAX_OBJECT:
            raise RecoveryError("r2_object_unavailable")
        digest, size, header, tail = hashlib.sha256(), 0, b"", b""
        deadline = time.monotonic() + 60
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            header += chunk[:max(0, 1024 * 1024 - len(header))]
            tail = chunk[-2:]
            size += len(chunk)
            if size > int(length) or time.monotonic() > deadline:
                raise RecoveryError("r2_object_size_changed")
            digest.update(chunk)
        if size != int(length) or header[:3] != b"\xff\xd8\xff" or tail != b"\xff\xd9":
            raise RecoveryError("r2_object_not_exact_jpeg")
        width, height = jpeg_dimensions(header)
        return {"bucket": bucket, "key": key, "sha256": digest.hexdigest(), "bytes": size,
                "width": width, "height": height, "contentType": "image/jpeg", "checkedAt": stamp(),
                "method": "authenticated-full-get-sha256"}
    except RecoveryError:
        raise
    except Exception:
        raise RecoveryError("r2_read_failed") from None
    finally:
        conn.close()
