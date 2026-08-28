#!/usr/bin/env python3
"""Benchmark public storefront/catalog hosting without inspecting catalog rows."""

from __future__ import annotations

import argparse
import json
import math
import statistics
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


SCHEMA = "photosbyelie.public-host-benchmark.v1"
WRITE_OUT = "\t".join(
    [
        "%{http_code}",
        "%{http_version}",
        "%{size_download}",
        "%{time_namelookup}",
        "%{time_connect}",
        "%{time_appconnect}",
        "%{time_starttransfer}",
        "%{time_total}",
        "%{speed_download}",
    ]
)
SAFE_RESPONSE_HEADERS = (
    "cache-control",
    "etag",
    "last-modified",
    "age",
    "cf-cache-status",
    "server",
    "via",
)


def _with_probe(url: str, token: str) -> str:
    parts = urlsplit(url)
    query = parse_qsl(parts.query, keep_blank_values=True)
    query.append(("pbe174", token))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def _parse_headers(text: str) -> dict[str, str]:
    blocks = [block for block in text.replace("\r\n", "\n").split("\n\n") if block.strip()]
    for block in reversed(blocks):
        lines = block.splitlines()
        if not lines or not lines[0].startswith("HTTP/"):
            continue
        headers: dict[str, str] = {}
        for line in lines[1:]:
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            headers[key.strip().casefold()] = value.strip()
        return {key: headers[key] for key in SAFE_RESPONSE_HEADERS if key in headers}
    return {}


def _parse_metrics(text: str) -> dict[str, Any]:
    fields = text.strip().split("\t")
    if len(fields) != 9:
        raise ValueError(f"curl metrics returned {len(fields)} fields instead of 9")
    status, http_version, size, dns, connect, appconnect, start, total, speed = fields
    values = {
        "status": int(status),
        "httpVersion": http_version,
        "bytes": int(float(size)),
        "dnsMs": round(float(dns) * 1000, 6),
        "connectMs": round(max(0.0, (float(connect) - float(dns)) * 1000), 6),
        "tlsMs": round(max(0.0, (float(appconnect) - float(connect)) * 1000), 6),
        "ttfbMs": round(float(start) * 1000, 6),
        "downloadMs": round(max(0.0, (float(total) - float(start)) * 1000), 6),
        "totalMs": round(float(total) * 1000, 6),
        "bytesPerSecond": int(float(speed)),
    }
    return values


def curl_probe(url: str) -> dict[str, Any]:
    with tempfile.NamedTemporaryFile(prefix="pbe174-headers-", suffix=".txt") as headers:
        completed = subprocess.run(
            [
                "curl",
                "--fail",
                "--silent",
                "--show-error",
                "--location",
                "--output",
                "/dev/null",
                "--dump-header",
                headers.name,
                "--write-out",
                WRITE_OUT,
                url,
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if completed.returncode:
            raise RuntimeError(completed.stderr.strip() or f"curl failed with {completed.returncode}")
        headers.seek(0)
        header_text = headers.read().decode("utf-8", errors="replace")
    metrics = _parse_metrics(completed.stdout)
    metrics["headers"] = _parse_headers(header_text)
    return metrics


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil(percentile * len(ordered)) - 1))
    return ordered[index]


def _summary(samples: list[dict[str, Any]]) -> dict[str, Any]:
    metrics = ("dnsMs", "connectMs", "tlsMs", "ttfbMs", "downloadMs", "totalMs")
    timing: dict[str, dict[str, float]] = {}
    for metric in metrics:
        values = [float(sample[metric]) for sample in samples]
        timing[metric] = {
            "min": round(min(values), 3),
            "median": round(statistics.median(values), 3),
            "p95": round(_percentile(values, 0.95), 3),
            "max": round(max(values), 3),
        }
    return {
        "requests": len(samples),
        "statuses": dict(sorted({str(sample["status"]): sum(1 for row in samples if row["status"] == sample["status"]) for sample in samples} .items())),
        "httpVersions": sorted({sample["httpVersion"] for sample in samples}),
        "bytes": sorted({sample["bytes"] for sample in samples}),
        "responseHeaders": samples[-1]["headers"],
        "timingMs": timing,
    }


def benchmark_target(
    url: str,
    *,
    cold_requests: int,
    warm_requests: int,
    probe: Callable[[str], dict[str, Any]] = curl_probe,
) -> dict[str, Any]:
    if cold_requests < 1 or warm_requests < 1:
        raise ValueError("cold and warm request counts must both be positive")
    run_id = uuid.uuid4().hex
    cold = [probe(_with_probe(url, f"{run_id}-cold-{index}")) for index in range(cold_requests)]
    warm_url = _with_probe(url, f"{run_id}-warm")
    probe(warm_url)  # Prime the exact warm URL; exclude the priming request.
    warm = [probe(warm_url) for _ in range(warm_requests)]
    return {
        "url": url,
        "cold": _summary(cold),
        "warm": _summary(warm),
    }


def benchmark(
    urls: list[str],
    *,
    cold_requests: int,
    warm_requests: int,
    probe: Callable[[str], dict[str, Any]] = curl_probe,
) -> dict[str, Any]:
    return {
        "schema": SCHEMA,
        "scope": "host transport only; excludes SQLite parse, query, image fetch, and render time",
        "privacy": "aggregate response timings and public cache headers only",
        "coldDefinition": "unique query URL per measured request",
        "warmDefinition": "one unmeasured prime followed by repeated requests to the exact same URL",
        "targets": [
            benchmark_target(
                url,
                cold_requests=cold_requests,
                warm_requests=warm_requests,
                probe=probe,
            )
            for url in urls
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", nargs="+")
    parser.add_argument("--cold", type=int, default=5)
    parser.add_argument("--warm", type=int, default=5)
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()
    print(
        json.dumps(
            benchmark(args.url, cold_requests=args.cold, warm_requests=args.warm),
            indent=2 if args.pretty else None,
            sort_keys=args.pretty,
        )
    )


if __name__ == "__main__":
    main()
