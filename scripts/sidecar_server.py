#!/usr/bin/env python3
"""Local-only Sidecar helper for Apple Photos triage."""

from __future__ import annotations

import argparse
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
from urllib.parse import parse_qs, unquote, urlparse

from sidecar_state_db import commit_plan, merge_state, record_decision, summary, upload_plan, upsert_assets


APPLE_PHOTOS_BRIDGE = Path("scripts/apple_photos_bridge.swift")
SIDECAR_VERSION_FILE = Path("SIDECAR_VERSION")
SIDECAR_DEFAULT_VERSION = "121.0"
SIDECAR_PREVIEW_ROOT = Path("tmp/sidecar-previews")
SIDECAR_LIBRARY_PATH = "/__sidecar/library"
SIDECAR_PREVIEW_PATH = "/__sidecar/preview/"
SIDECAR_DECISION_PATH = "/__sidecar/decision"
SIDECAR_SUMMARY_PATH = "/__sidecar/summary"
SIDECAR_UPLOAD_PLAN_PATH = "/__sidecar/upload-plan"
SIDECAR_COMMIT_PLAN_PATH = "/__sidecar/commit-plan"
SIDECAR_VERSION_PATH = "/__sidecar/version"


def sidecar_version(repo_root: Path) -> str:
    try:
        value = (repo_root / SIDECAR_VERSION_FILE).read_text(encoding="utf-8").strip()
    except OSError:
        value = ""
    return value or SIDECAR_DEFAULT_VERSION


def _run_apple_photos_bridge(repo_root: Path, args: list[str], timeout: int = 900) -> dict:
    bridge = repo_root / APPLE_PHOTOS_BRIDGE
    if not bridge.exists():
        raise RuntimeError(f"Apple Photos bridge is missing: {bridge}")
    try:
        result = subprocess.run(
            ["swift", str(bridge), *args],
            cwd=repo_root,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as error:
        raise RuntimeError("Swift is required for the Apple Photos PhotoKit bridge. Install Xcode Command Line Tools.") from error
    output = (result.stdout or "").strip()
    try:
        payload = json.loads(output or "{}")
    except json.JSONDecodeError as error:
        raise RuntimeError((result.stderr or output or "Apple Photos bridge returned invalid JSON.").strip()) from error
    if result.returncode != 0 and payload.get("ok") is not False:
        return {
            "ok": False,
            "code": "photos_bridge_error",
            "error": (result.stderr or output or f"Apple Photos bridge exited {result.returncode}").strip(),
        }
    if result.stderr and payload.get("ok") is False:
        payload.setdefault("stderr", result.stderr.strip())
    return payload


def _int_query(query: dict[str, list[str]], name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int((query.get(name) or [""])[0] or default)
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


def _text_query(query: dict[str, list[str]], *names: str) -> str:
    for name in names:
        value = str((query.get(name) or [""])[0] or "").strip()
        if value:
            return value
    return ""


def _preview_cache_path(repo_root: Path, asset_id: str, max_pixel: int) -> Path:
    digest = hashlib.sha256(asset_id.encode("utf-8")).hexdigest()[:24]
    return repo_root / SIDECAR_PREVIEW_ROOT / f"{digest}_{max_pixel}.jpg"


class SidecarHandler(SimpleHTTPRequestHandler):
    server_version = "PhotosByElieSidecar/0.1"

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == SIDECAR_VERSION_PATH:
            self._handle_version()
            return
        if path == SIDECAR_SUMMARY_PATH:
            self._handle_summary()
            return
        if path == SIDECAR_LIBRARY_PATH:
            self._handle_library()
            return
        if path.startswith(SIDECAR_PREVIEW_PATH):
            self._handle_preview(path)
            return
        if path == SIDECAR_UPLOAD_PLAN_PATH:
            self._handle_upload_plan()
            return
        if path == SIDECAR_COMMIT_PLAN_PATH:
            self._handle_commit_plan()
            return
        super().do_GET()

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == SIDECAR_DECISION_PATH:
            self._handle_decision()
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def end_headers(self) -> None:
        path = self.path.split("?", 1)[0]
        if path in {"", "/", "/sidecar.html"} or path.startswith("/__sidecar/"):
            self.send_header("Cache-Control", "no-cache, max-age=0, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def _is_loopback_request(self) -> bool:
        host = self.client_address[0]
        return host in {"127.0.0.1", "::1"} or host == "localhost"

    def _send_json(self, status: HTTPStatus, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json_body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            length = 0
        raw = self.rfile.read(max(0, length))
        if not raw:
            return {}
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as error:
            raise ValueError("Request body must be JSON.") from error
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        return payload

    def _handle_version(self) -> None:
        self._send_json(HTTPStatus.OK, {"ok": True, "version": sidecar_version(Path.cwd())})

    def _handle_summary(self) -> None:
        try:
            payload = {**summary(Path.cwd()), "version": sidecar_version(Path.cwd())}
        except sqlite3.Error as error:  # type: ignore[name-defined]
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, payload)

    def _handle_library(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        query = parse_qs(urlparse(self.path).query)
        limit = _int_query(query, "limit", 120, 1, 1000)
        offset = _int_query(query, "offset", 0, 0, 1_000_000)
        args = ["library-index", "--limit", str(limit), "--offset", str(offset)]
        date_from = _text_query(query, "dateFrom", "date_from", "from")
        date_to = _text_query(query, "dateTo", "date_to", "to")
        if date_from:
            args.extend(["--date-from", date_from])
        if date_to:
            args.extend(["--date-to", date_to])
        try:
            payload = _run_apple_photos_bridge(Path.cwd(), args)
            if payload.get("ok"):
                rows = [row for row in payload.get("items") or [] if isinstance(row, dict)]
                upsert_assets(Path.cwd(), rows)
                payload["items"] = merge_state(Path.cwd(), rows)
                payload["sidecarSummary"] = summary(Path.cwd())
                payload["version"] = sidecar_version(Path.cwd())
        except Exception as error:
            self._send_json(HTTPStatus.BAD_GATEWAY, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK if payload.get("ok") else HTTPStatus.BAD_GATEWAY, payload)

    def _handle_preview(self, path: str) -> None:
        if not self._is_loopback_request():
            self.send_error(HTTPStatus.FORBIDDEN, "localhost-only endpoint")
            return
        query = parse_qs(urlparse(self.path).query)
        max_pixel = _int_query(query, "maxPixel", 900, 256, 1800)
        asset_id = unquote(path[len(SIDECAR_PREVIEW_PATH):])
        if not asset_id:
            self.send_error(HTTPStatus.BAD_REQUEST, "missing asset id")
            return
        cache_path = _preview_cache_path(Path.cwd(), asset_id, max_pixel)
        if not cache_path.exists():
            payload = _run_apple_photos_bridge(
                Path.cwd(),
                ["preview", "--asset-id", asset_id, "--destination", str(cache_path), "--max-pixel", str(max_pixel)],
                timeout=60,
            )
            if not payload.get("ok"):
                self._send_json(HTTPStatus.BAD_GATEWAY, payload)
                return
        try:
            data = cache_path.read_bytes()
        except OSError as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _handle_decision(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = self._read_json_body()
            result = record_decision(Path.cwd(), payload)
            result["summary"] = summary(Path.cwd())
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        except Exception as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, result)

    def _handle_upload_plan(self) -> None:
        query = parse_qs(urlparse(self.path).query)
        limit = _int_query(query, "limit", 500, 1, 5000)
        try:
            result = upload_plan(Path.cwd(), limit=limit)
        except Exception as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, result)

    def _handle_commit_plan(self) -> None:
        query = parse_qs(urlparse(self.path).query)
        limit = _int_query(query, "limit", 500, 1, 5000)
        try:
            result = commit_plan(Path.cwd(), limit=limit)
        except Exception as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, result)


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the local Photos By Elie Sidecar prototype.")
    parser.add_argument("port", type=int, nargs="?", default=8011)
    parser.add_argument("--bind", default="127.0.0.1")
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.bind, args.port), SidecarHandler)
    print(f"Photos By Elie Sidecar v{sidecar_version(Path.cwd())}: http://{args.bind}:{args.port}/sidecar.html")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nSidecar stopped.", file=sys.stderr)


if __name__ == "__main__":
    main()
