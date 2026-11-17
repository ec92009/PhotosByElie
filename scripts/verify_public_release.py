"""Read-only verification of exact deployed identity and private-path denial on each origin."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from scripts.public_artifact_policy import CATALOG, IDENTITY, NEGATIVE_PATHS


def probe(
    origin: str, name: str, *, method: str = "GET", read_body: bool = True
) -> tuple[int, bytes]:
    """Preserve genuine HTTP status and fail on network errors or unexpected success."""
    request = Request(
        f"{origin.rstrip('/')}/{name}", method=method, headers={"Cache-Control": "no-cache"}
    )
    try:
        with urlopen(request, timeout=20) as response:
            return response.status, response.read() if method == "GET" and read_body else b""
    except HTTPError as error:
        with error:
            return error.code, b""


def verify_origins(receipt: dict, origins: list[str]) -> list[dict]:
    """Require each active public origin to serve tested bytes and deny private artifacts."""
    results = []
    for origin in origins:
        parsed = urlsplit(origin)
        if parsed.scheme != "https" and not (
            parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"}
        ):
            raise ValueError("public origin requires HTTPS (loopback HTTP is test-only)")
        if (
            parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
            or not parsed.hostname
        ):
            raise ValueError("public origin must have no credentials, query, or fragment")
        status, body = probe(origin, IDENTITY)
        if status != 200 or json.loads(body) != receipt["identity"]:
            raise ValueError(f"deployed identity differs from the tested artifact at {origin}")
        for name in (
            "index.html",
            "gallery.html",
            "photo.html",
            "basket.html",
            "liked.html",
            "order.html",
            "media-config.js",
            "photos-data.js",
            "catalog-sqlite.js",
            CATALOG,
        ):
            status, body = probe(origin, name)
            if status != 200 or hashlib.sha256(body).hexdigest() != receipt["files"][name]:
                raise ValueError(f"deployed public bytes differ at {origin}/{name}, HTTP {status}")
        for name in NEGATIVE_PATHS:
            for method in ("HEAD", "GET"):
                status, _ = probe(origin, name, method=method, read_body=False)
                if status not in {403, 404}:
                    raise ValueError(
                        f"negative-path check failed at {origin}/{name}, {method} HTTP {status}"
                    )
        results.append(
            {
                "origin": origin,
                "commit": receipt["identity"]["commit"],
                "version": receipt["identity"]["version"],
                "negativePathCount": len(NEGATIVE_PATHS),
                "status": "verified",
            }
        )
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--receipt", type=Path, default=Path("tmp/public-release/receipt.json"))
    parser.add_argument("--origin", action="append", required=True)
    args = parser.parse_args()
    print(json.dumps(verify_origins(json.loads(args.receipt.read_text()), args.origin), indent=2))


if __name__ == "__main__":
    main()
