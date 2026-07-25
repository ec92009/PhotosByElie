#!/usr/bin/env python3
"""Background Mac connector for cloud Owner actions.

The connector does not serve a local web UI. It polls the authenticated Worker
queue, performs the small set of hardware/local-file tasks this Mac supports,
and posts results back to the cloud Owner action ledger.
"""

from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
import html
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import platform
import shutil
import shlex
import socket
import sqlite3
import subprocess
import sys
import threading
import time
from typing import Any
import uuid
from urllib.parse import parse_qs, urlparse
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


DEFAULT_CONFIG_PATH = Path.home() / ".config" / "photosbyelie" / "connector.json"
CONNECTOR_VERSION = "1.5"
DEFAULT_INTERVAL_SECONDS = 5
DEFAULT_IDLE_MAX_INTERVAL_SECONDS = 60
INTERACTIVE_POLL_INTERVAL_SECONDS = 5
INTERACTIVE_POLL_LEASE_SECONDS = 15
MAX_PREVIEW_BYTES = 250_000
DEFAULT_LOCAL_STATUS_PORT = 8766
LOCAL_STATUS_PATH = "/photosbyelie/connector-status"
LOCAL_SIDECAR_OPEN_PATH = "/photosbyelie/open-sidecar"
LOCAL_SIDECAR_STATUS_PATH = "/photosbyelie/open-sidecar/status"
LOCAL_WASTE_BASKET_OPEN_PATH = "/photosbyelie/open-wastebasket"
LOCAL_ACTION_WAKE_PATH = "/photosbyelie/wake-owner-action"
OWNER_HELPER_PORT_START = 8000
OWNER_HELPER_PORT_LIMIT = 8100
SIDECAR_HELPER_PORT_START = 8011
SIDECAR_HELPER_PORT_LIMIT = 8111
PATH_PREFIXES = (
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
)
ALLOWED_LOCAL_STATUS_ORIGINS = {
    "https://photos-by-elie.com",
    "https://www.photos-by-elie.com",
    "https://ec92009.github.io",
}
ACTION_EXECUTION_LOCK = threading.Lock()


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class ConnectorConfig:
    worker_base: str
    connector_id: str
    token: str
    repo_root: Path
    interval_seconds: int = DEFAULT_INTERVAL_SECONDS
    local_status_port: int = DEFAULT_LOCAL_STATUS_PORT


class InteractivePollingLease:
    """Wake idle polling and hold the short cadence while an Owner UI is active."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._active_until = 0.0
        self._wakeup = threading.Event()

    def touch(self, duration_seconds: int = INTERACTIVE_POLL_LEASE_SECONDS) -> None:
        now = time.monotonic()
        with self._lock:
            was_active = now < self._active_until
            self._active_until = max(self._active_until, now + max(1, duration_seconds))
        if not was_active:
            self._wakeup.set()

    def active(self) -> bool:
        with self._lock:
            return time.monotonic() < self._active_until

    def wait(self, timeout_seconds: int) -> None:
        self._wakeup.wait(max(0, timeout_seconds))
        self._wakeup.clear()


def _clean_connector_id(value: object) -> str:
    cleaned = "".join(character if character.isalnum() or character in "._-" else "-" for character in str(value or "").strip().lower())
    return cleaned.strip("-")[:80]


def load_config(path: Path) -> ConnectorConfig:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise RuntimeError(f"Connector config is missing: {path}") from error
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Connector config is unreadable: {path}: {error}") from error
    worker_base = str(payload.get("workerBase") or "").strip().rstrip("/")
    connector_id = _clean_connector_id(payload.get("connectorId"))
    token = str(payload.get("token") or "").strip()
    repo_root = Path(str(payload.get("repoRoot") or "")).expanduser().resolve()
    interval = max(2, min(300, int(payload.get("intervalSeconds") or DEFAULT_INTERVAL_SECONDS)))
    local_status_port = max(0, min(65535, int(payload.get("localStatusPort") or DEFAULT_LOCAL_STATUS_PORT)))
    if not worker_base.startswith("https://"):
        raise RuntimeError("Connector workerBase must use HTTPS.")
    if not connector_id:
        raise RuntimeError("Connector connectorId is required.")
    if len(token) < 24:
        raise RuntimeError("Connector token is missing or too short.")
    if not (repo_root / "scripts" / "sidecar_state_db.py").exists():
        raise RuntimeError(f"PhotosByElie repoRoot is invalid: {repo_root}")
    return ConnectorConfig(worker_base, connector_id, token, repo_root, interval, local_status_port)


def _local_status_payload(config: ConnectorConfig) -> dict:
    return {
        "ok": True,
        "schema": "photosbyelie.localOwnerConnector.v1",
        "connectorId": config.connector_id,
        "hostname": socket.gethostname(),
        "platform": f"{platform.system()} {platform.machine()}",
        "version": CONNECTOR_VERSION,
    }


def _local_sidecar_open_action(config: ConnectorConfig, job_id: str) -> dict:
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return {
        "id": job_id,
        "type": "sidecar-culling-review",
        "state": "claimed",
        "claim": {
            "connectorId": config.connector_id,
            "claimedAt": now,
            "source": "local-mac-bridge",
        },
        "payload": {
            "surface": "new-owner",
            "workflow": "sidecar-culling",
            "connectorRequired": True,
            "localFilesRequired": True,
            "manifest": {
                "mode": "local-sidecar-workspace",
                "source": "owner-sqlite",
                "limit": 24,
                "includePreviews": False,
                "launchWorkspace": False,
            },
            "queuedAt": now,
            "localBridge": True,
        },
    }


def _sidecar_helper_url(port: int) -> str:
    return f"http://127.0.0.1:{port}/sidecar.html"


def _owner_waste_basket_url(port: int) -> str:
    return f"http://127.0.0.1:{port}/owner-review.html?view=blocked"


def _owner_helper_ready(port: int) -> bool:
    try:
        with urlopen(f"http://127.0.0.1:{port}/__photosbyelie/owner-session", timeout=0.5) as response:
            return 200 <= response.status < 500
    except (OSError, URLError):
        return False


def _running_owner_helper() -> dict:
    for port in range(OWNER_HELPER_PORT_START, OWNER_HELPER_PORT_LIMIT):
        if _owner_helper_ready(port):
            return {"url": _owner_waste_basket_url(port), "port": port, "reused": True}
    return {}


def _sidecar_helper_ready(port: int) -> bool:
    try:
        with urlopen(f"http://127.0.0.1:{port}/__sidecar/version", timeout=0.5) as response:
            return 200 <= response.status < 500
    except (OSError, URLError):
        return False


def _running_sidecar_helper() -> dict:
    for port in range(SIDECAR_HELPER_PORT_START, SIDECAR_HELPER_PORT_LIMIT):
        if _sidecar_helper_ready(port):
            return {"url": _sidecar_helper_url(port), "port": port, "reused": True}
    return {}


def _sidecar_helper_env(config: ConnectorConfig | None = None) -> dict[str, str]:
    env = {**os.environ, "PYTHONUNBUFFERED": "1"}
    current_path = env.get("PATH", "")
    parts = [part for part in (*PATH_PREFIXES, *current_path.split(os.pathsep)) if part]
    env["PATH"] = os.pathsep.join(dict.fromkeys(part for part in parts if part))
    if config:
        env["PBE_OWNER_WORKER_BASE"] = config.worker_base
        env["PBE_OWNER_CONNECTOR_ID"] = config.connector_id
        env["PBE_OWNER_CONNECTOR_TOKEN"] = config.token
    return env


def _launch_sidecar_for_browser(config: ConnectorConfig) -> dict:
    """Start the local Sidecar helper and return the URL for this browser."""
    existing = _running_sidecar_helper()
    if existing:
        return existing

    helper = config.repo_root / "scripts" / "sidecar_server.py"
    if not helper.exists():
        raise RuntimeError(f"Sidecar helper is missing: {helper}")

    log_dir = Path.home() / "Library" / "Logs" / "PhotosByElie"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "new-owner-sidecar-browser.log"
    env = _sidecar_helper_env(config)
    python = shutil.which("python3", path=env["PATH"]) or sys.executable

    for port in range(SIDECAR_HELPER_PORT_START, SIDECAR_HELPER_PORT_LIMIT):
        with log_path.open("a", encoding="utf-8") as log:
            log.write(f"\n--- New Owner local Sidecar browser launch {time.strftime('%Y-%m-%d %H:%M:%S')} port {port} ---\n")
            log.flush()
            process = subprocess.Popen(
                [python, str(helper), str(port)],
                cwd=config.repo_root,
                stdout=log,
                stderr=subprocess.STDOUT,
                text=True,
                env=env,
                start_new_session=True,
            )
        for _attempt in range(40):
            if process.poll() is not None:
                break
            if _sidecar_helper_ready(port):
                return {"url": _sidecar_helper_url(port), "port": port, "reused": False}
            time.sleep(0.25)
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()

    raise RuntimeError("Could not start the local Sidecar helper on ports 8011-8110.")


def _launch_waste_basket_for_browser(config: ConnectorConfig) -> dict:
    """Start the local Owner helper and return its Waste Basket URL."""
    existing = _running_owner_helper()
    if existing:
        return existing

    helper = config.repo_root / "scripts" / "local_server.py"
    if not helper.exists():
        raise RuntimeError(f"Owner helper is missing: {helper}")

    log_dir = Path.home() / "Library" / "Logs" / "PhotosByElie"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "new-owner-waste-basket-browser.log"
    env = _sidecar_helper_env(config)
    python = shutil.which("python3", path=env["PATH"]) or sys.executable

    for port in range(OWNER_HELPER_PORT_START, OWNER_HELPER_PORT_LIMIT):
        with log_path.open("a", encoding="utf-8") as log:
            log.write(f"\n--- New Owner Waste Basket launch {time.strftime('%Y-%m-%d %H:%M:%S')} port {port} ---\n")
            log.flush()
            process = subprocess.Popen(
                [python, str(helper), str(port)],
                cwd=config.repo_root,
                stdout=log,
                stderr=subprocess.STDOUT,
                text=True,
                env=env,
                start_new_session=True,
            )
        for _attempt in range(40):
            if process.poll() is not None:
                break
            if _owner_helper_ready(port):
                return {"url": _owner_waste_basket_url(port), "port": port, "reused": False}
            time.sleep(0.25)
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()

    raise RuntimeError("Could not start the local Owner helper on ports 8000-8099.")


def _sidecar_job_public_payload(config: ConnectorConfig, job_id: str, job: dict) -> dict:
    result = job.get("result") if isinstance(job.get("result"), dict) else {}
    workspace = result.get("workspace") if isinstance(result.get("workspace"), dict) else {}
    return {
        "ok": job.get("state") != "failed",
        "jobId": job_id,
        "state": job.get("state") or "missing",
        "message": job.get("message") or "",
        "error": job.get("error") or "",
        "url": workspace.get("url") or "",
        "connector": _local_status_payload(config),
        "recordsPrepared": result.get("recordsPrepared"),
        "candidateCount": result.get("candidateCount"),
        "pendingSyncCount": result.get("pendingSyncCount"),
        "startedAt": job.get("startedAt") or "",
        "completedAt": job.get("completedAt") or "",
    }


def _local_sidecar_progress_html(job_id: str) -> bytes:
    escaped_job = html.escape(job_id)
    status_url = f"{LOCAL_SIDECAR_STATUS_PATH}?job={quote(job_id, safe='')}"
    body = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>Opening Sidecar · Photos By Elie</title>
  <style>
    :root {{
      color-scheme: light dark;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
      background: #101313;
      color: #f7f7f2;
    }}
    body {{
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      background:
        radial-gradient(circle at 20% 20%, rgba(205, 185, 137, .18), transparent 34rem),
        linear-gradient(135deg, #0b0d0d, #1f2424);
    }}
    main {{
      width: min(720px, 100%);
      border: 1px solid rgba(255, 255, 255, .22);
      border-radius: 28px;
      padding: clamp(24px, 5vw, 48px);
      background: rgba(255, 255, 255, .08);
      box-shadow: 0 24px 80px rgba(0, 0, 0, .36);
      backdrop-filter: blur(18px);
    }}
    p {{ color: rgba(247, 247, 242, .78); font-size: 1.08rem; line-height: 1.45; }}
    .eyebrow {{ text-transform: uppercase; letter-spacing: .18em; font-weight: 800; font-size: .78rem; }}
    h1 {{ margin: .25rem 0 1rem; font-size: clamp(2rem, 8vw, 4rem); line-height: .95; }}
    a, button {{
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-top: 1rem;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,.32);
      padding: .9rem 1.25rem;
      color: inherit;
      text-decoration: none;
      font-weight: 800;
      background: rgba(255,255,255,.08);
    }}
    .status {{
      margin-top: 1.5rem;
      border-radius: 20px;
      border: 1px solid rgba(255,255,255,.18);
      padding: 1rem;
      background: rgba(0,0,0,.18);
      font-weight: 700;
    }}
    small {{ display: block; margin-top: .8rem; opacity: .72; }}
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">Photos By Elie · Local Mac bridge</div>
    <h1>Opening Culling</h1>
    <p>The local bridge is preparing this Mac’s real Sidecar workspace: same Culling gallery, keyboard shortcuts, Quick Look, and <kbd>C</kbd> switch into Title/Keywords review.</p>
    <div class="status" id="status" aria-live="polite">Starting bridge job {escaped_job}…</div>
    <a href="https://photos-by-elie.com/owner.html">Back to Owner</a>
    <a id="sidecar-link" href="#" hidden>Open Sidecar now</a>
    <small>If this page does not move on after a few seconds, make sure the Photos By Elie Mac connector is running on this Mac.</small>
  </main>
  <script>
    const statusNode = document.getElementById("status");
    const sidecarLink = document.getElementById("sidecar-link");
    const statusUrl = {json.dumps(status_url)};
    let redirected = false;
    async function poll() {{
      try {{
        const response = await fetch(statusUrl, {{ cache: "no-store" }});
        const body = await response.json();
        const counts = body.recordsPrepared ? ` Prepared ${{body.recordsPrepared.toLocaleString()}} item${{body.recordsPrepared === 1 ? "" : "s"}}.` : "";
        statusNode.textContent = `${{body.message || body.state || "Working..."}}${{counts}}`;
        if (body.state === "completed" && body.url) {{
          sidecarLink.href = body.url;
          sidecarLink.hidden = false;
          sidecarLink.textContent = "Open Sidecar now";
          if (!redirected) {{
            redirected = true;
            window.setTimeout(() => window.location.replace(body.url), 650);
          }}
          return;
        }}
        if (body.state === "failed") {{
          statusNode.textContent = body.error || body.message || "The local bridge could not open Sidecar.";
          return;
        }}
      }} catch (error) {{
        statusNode.textContent = "Waiting for the local bridge…";
      }}
      window.setTimeout(poll, 900);
    }}
    poll();
  </script>
</body>
</html>
"""
    return body.encode("utf-8")


def _run_local_sidecar_job(config: ConnectorConfig, jobs: dict[str, dict], jobs_lock: threading.Lock, job_id: str) -> None:
    def update(**values: Any) -> None:
        with jobs_lock:
            jobs.setdefault(job_id, {}).update(values)

    update(state="running", message="Starting the local Sidecar helper…")
    try:
        workspace = _launch_sidecar_for_browser(config)
        result = {
            "connectorId": config.connector_id,
            "type": "sidecar-culling-review",
            "readOnly": False,
            "workspace": {"launched": True, "surface": "sidecar.html", "connectorId": config.connector_id, **workspace},
        }
        update(
            state="completed",
            message="Sidecar is ready; opening the Culling workspace…",
            result=result,
            completedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )
    except Exception as error:  # noqa: BLE001 - surface any local bridge issue in the browser.
        update(
            state="failed",
            message="The local bridge could not open Sidecar.",
            error=str(error),
            completedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )


def _allowed_local_status_origin(origin: str) -> str:
    parsed = urlparse(origin)
    if origin in ALLOWED_LOCAL_STATUS_ORIGINS:
        return origin
    if parsed.scheme in {"http", "https"} and parsed.hostname in {"localhost", "127.0.0.1", "::1"}:
        return origin
    return ""


def start_local_status_server(
    config: ConnectorConfig,
    polling_lease: InteractivePollingLease,
    client: "WorkerClient",
) -> None:
    """Expose this Mac's connector id to the local browser only."""
    if config.local_status_port <= 0:
        return
    sidecar_jobs: dict[str, dict] = {}
    sidecar_jobs_lock = threading.Lock()

    class LocalStatusHandler(BaseHTTPRequestHandler):
        server_version = f"PhotosByElieLocalConnector/{CONNECTOR_VERSION}"

        def log_message(self, _format: str, *_args: Any) -> None:
            return

        def _allowed_origin(self) -> str:
            origin = self.headers.get("Origin", "")
            return _allowed_local_status_origin(origin)

        def _send_cors_headers(self) -> None:
            allowed_origin = self._allowed_origin()
            if allowed_origin:
                self.send_header("Access-Control-Allow-Origin", allowed_origin)
                self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Cache-Control", "no-store")

        def do_OPTIONS(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API.
            parsed = urlparse(self.path)
            if parsed.path not in {
                LOCAL_STATUS_PATH,
                LOCAL_SIDECAR_OPEN_PATH,
                LOCAL_SIDECAR_STATUS_PATH,
                LOCAL_WASTE_BASKET_OPEN_PATH,
                LOCAL_ACTION_WAKE_PATH,
            }:
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(204)
            self._send_cors_headers()
            self.end_headers()

        def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API.
            parsed = urlparse(self.path)
            if parsed.path != LOCAL_ACTION_WAKE_PATH:
                self.send_response(404)
                self.end_headers()
                return
            if not self._allowed_origin():
                self.send_response(403)
                self._send_cors_headers()
                self.end_headers()
                return
            try:
                content_length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                content_length = 0
            if content_length <= 0 or content_length > 512:
                self.send_response(400)
                self._send_cors_headers()
                self.end_headers()
                return
            try:
                wake_started = time.perf_counter()
                payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
                if not isinstance(payload, dict) or set(payload) != {"actionId"}:
                    raise ValueError("Only actionId is accepted.")
                action_id = str(payload.get("actionId") or "").strip()
                if not action_id.startswith("owner-action-") or len(action_id) > 96:
                    raise ValueError("A valid opaque actionId is required.")
                action, _processed = process_exact_action(config, client, action_id, local_wake=True)
                body = json.dumps({
                    "ok": True,
                    "action": action,
                    "diagnostics": {
                        "fastPath": True,
                        "localWakeMs": round((time.perf_counter() - wake_started) * 1000, 1),
                    },
                }, separators=(",", ":")).encode("utf-8")
                status = 200
            except ValueError as error:
                body = json.dumps({"ok": False, "error": str(error)}, separators=(",", ":")).encode("utf-8")
                status = 400
            except Exception as error:  # noqa: BLE001 - cloud ledger records the durable failure.
                body = json.dumps({"ok": False, "error": str(error)}, separators=(",", ":")).encode("utf-8")
                status = 502
            self.send_response(status)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API.
            parsed = urlparse(self.path)
            if parsed.path == LOCAL_WASTE_BASKET_OPEN_PATH:
                try:
                    workspace = _launch_waste_basket_for_browser(config)
                    self.send_response(302)
                    self.send_header("Location", str(workspace["url"]))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                except Exception as error:  # noqa: BLE001 - surface launch failure in the browser.
                    body = f"Could not open the local Waste Basket: {error}".encode("utf-8")
                    self.send_response(500)
                    self.send_header("Content-Type", "text/plain; charset=utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(body)
                return
            if parsed.path == LOCAL_SIDECAR_OPEN_PATH:
                job_id = f"local-sidecar-{int(time.time() * 1000)}"
                with sidecar_jobs_lock:
                    sidecar_jobs[job_id] = {
                        "state": "queued",
                        "message": "Queued on this Mac’s local bridge…",
                        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    }
                thread = threading.Thread(
                    target=_run_local_sidecar_job,
                    args=(config, sidecar_jobs, sidecar_jobs_lock, job_id),
                    name="pbe-local-sidecar-open",
                    daemon=True,
                )
                thread.start()
                body = _local_sidecar_progress_html(job_id)
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
                return
            if parsed.path == LOCAL_SIDECAR_STATUS_PATH:
                job_id = str(parse_qs(parsed.query).get("job", [""])[0])
                with sidecar_jobs_lock:
                    job = dict(sidecar_jobs.get(job_id) or {"state": "missing", "message": "Sidecar job not found."})
                body = json.dumps(_sidecar_job_public_payload(config, job_id, job), separators=(",", ":")).encode("utf-8")
                self.send_response(200)
                self._send_cors_headers()
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if parsed.path != LOCAL_STATUS_PATH:
                self.send_response(404)
                self.end_headers()
                return
            body = json.dumps({
                **_local_status_payload(config),
                "interactivePolling": polling_lease.active(),
            }, separators=(",", ":")).encode("utf-8")
            self.send_response(200)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    class LocalStatusHTTPServer(ThreadingHTTPServer):
        allow_reuse_address = True

    def serve_forever_with_retry() -> None:
        while True:
            server = None
            try:
                server = LocalStatusHTTPServer(("127.0.0.1", config.local_status_port), LocalStatusHandler)
                print(
                    f"Local connector identity server listening on 127.0.0.1:{config.local_status_port}",
                    flush=True,
                )
                server.serve_forever()
            except OSError as error:
                print(
                    f"Local connector identity server unavailable: {error}; retrying in 10s",
                    file=sys.stderr,
                    flush=True,
                )
            except Exception as error:  # noqa: BLE001 - keep the connector's local browser bridge self-healing.
                print(
                    f"Local connector identity server stopped unexpectedly: {error}; retrying in 10s",
                    file=sys.stderr,
                    flush=True,
                )
            finally:
                if server is not None:
                    server.server_close()
            time.sleep(10)

    thread = threading.Thread(target=serve_forever_with_retry, name="pbe-local-connector-status", daemon=True)
    thread.start()


class WorkerClient:
    def __init__(self, config: ConnectorConfig):
        self.config = config

    def request(self, method: str, path: str, payload: dict | None = None) -> dict:
        data = None if payload is None else json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        mutation_headers = (
            {"Idempotency-Key": f"connector-{self.config.connector_id}-{uuid.uuid4().hex}"}
            if method.upper() not in {"GET", "HEAD", "OPTIONS"} and path.startswith("/api/v1/")
            else {}
        )
        request = Request(
            f"{self.config.worker_base}{path}",
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self.config.token}",
                "Accept": "application/json",
                "User-Agent": f"PhotosByElie-Mac-Connector/{CONNECTOR_VERSION}",
                **({"Content-Type": "application/json"} if data is not None else {}),
                **mutation_headers,
            },
        )
        try:
            with urlopen(request, timeout=60) as response:
                body = json.loads(response.read().decode("utf-8") or "{}")
        except HTTPError as error:
            try:
                detail = json.loads(error.read().decode("utf-8") or "{}")
            except (json.JSONDecodeError, UnicodeDecodeError):
                detail = {}
            message = detail.get("error", {}).get("message") if isinstance(detail.get("error"), dict) else detail.get("error")
            raise RuntimeError(message or f"Worker returned HTTP {error.code} for {path}.") from error
        except (URLError, OSError, json.JSONDecodeError) as error:
            raise RuntimeError(f"Worker request failed for {path}: {error}") from error
        if body.get("ok") is False or body.get("error"):
            error = body.get("error")
            message = error.get("message") if isinstance(error, dict) else str(error)
            raise RuntimeError(message or "Worker request failed.")
        return body

    def heartbeat(self) -> dict:
        return self.request("POST", "/api/v1/connectors/heartbeat", {
            "hostname": socket.gethostname(),
            "platform": f"{platform.system()} {platform.machine()}",
            "version": CONNECTOR_VERSION,
            "capabilities": ["apple-photos", "photos-index-sync", "sidecar", "owner-sqlite", "catalog-registration"],
        })

    def actions(self) -> list[dict]:
        body = self.request("GET", "/api/v1/connectors/actions")
        return [action for action in body.get("actions", []) if isinstance(action, dict)]

    def action(self, action_id: str) -> dict:
        body = self.request("GET", f"/api/v1/connectors/actions/{quote(action_id, safe='')}")
        action = body.get("action")
        if not isinstance(action, dict):
            raise RuntimeError("Worker did not return the requested Owner action.")
        return action

    def interactive(self) -> bool:
        body = self.request("GET", "/api/v1/connectors/interactive")
        return bool(body.get("interactivePolling"))

    def transition(self, action_id: str, transition: str, payload: dict | None = None) -> dict:
        return self.request(
            "POST",
            f"/api/v1/connectors/actions/{quote(action_id, safe='')}/{transition}",
            payload or {},
        )


def _load_local_modules(repo_root: Path):
    scripts_path = str(repo_root / "scripts")
    if scripts_path not in sys.path:
        sys.path.insert(0, scripts_path)
    from local_server import apply_public_photo_moderation, new_owner_connector_result, new_owner_sidecar_decision_result
    from sidecar_server import _preview_cache_path, _run_apple_photos_bridge_app_task

    return new_owner_connector_result, new_owner_sidecar_decision_result, _preview_cache_path, _run_apple_photos_bridge_app_task, apply_public_photo_moderation


def _owner_hidden_metadata(repo_root: Path, photo_ids: list[str]) -> dict[str, dict[str, str]]:
    """Resolve Waste Basket display titles without republishing blocked catalog rows."""
    wanted = list(dict.fromkeys(str(value or "").strip() for value in photo_ids if str(value or "").strip()))[:500]
    if not wanted:
        return {}
    registration_path = repo_root / "assets" / "owner-actions" / "sidecar-register-uploaded-catalog-latest.json"
    database_path = repo_root / "assets" / "owner-actions" / "Owner.sqlite"
    if not database_path.exists():
        return {}
    wanted_set = set(wanted)
    result: dict[str, dict[str, str]] = {}

    connection = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
    try:
        placeholders = ",".join("?" for _value in wanted)
        try:
            lifecycle_rows = connection.execute(
                f"""
                SELECT media_id, title, COALESCE(NULLIF(TRIM(previous_slug), ''),
                                                 NULLIF(TRIM(source_slug), ''), 'Unknown')
                  FROM media_lifecycle
                 WHERE media_id IN ({placeholders})
                """,
                wanted,
            ).fetchall()
        except sqlite3.OperationalError:
            lifecycle_rows = []
        for photo_id, title, collection_title in lifecycle_rows:
            clean_title = str(title or "").strip()
            if clean_title:
                result[str(photo_id)] = {
                    "title": clean_title,
                    "collectionTitle": str(collection_title or "Unknown").strip() or "Unknown",
                }

        if not registration_path.exists():
            return result
        try:
            registration = json.loads(registration_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return result

        asset_by_photo: dict[str, str] = {}

        def visit(value: Any) -> None:
            if isinstance(value, dict):
                photo_id = str(value.get("photoId") or "").strip()
                asset_id = str(value.get("assetId") or "").strip()
                if photo_id in wanted_set and asset_id:
                    asset_by_photo[photo_id] = asset_id
                for child in value.values():
                    visit(child)
            elif isinstance(value, list):
                for child in value:
                    visit(child)

        visit(registration)
        if not asset_by_photo:
            return result
        photo_by_asset = {asset_id: photo_id for photo_id, asset_id in asset_by_photo.items()}
        asset_placeholders = ",".join("?" for _value in photo_by_asset)
        try:
            rows = connection.execute(
                f"""
                SELECT a.asset_id,
                       COALESCE(NULLIF(TRIM(d.title), ''), NULLIF(TRIM(a.photos_title), ''),
                                NULLIF(TRIM(a.metadata_seed_title), '')) AS display_title,
                       COALESCE(NULLIF(TRIM(a.location_label), ''), 'Unknown') AS collection_title
                  FROM sidecar_assets a
                  LEFT JOIN sidecar_decisions d USING(asset_id)
                 WHERE a.asset_id IN ({asset_placeholders})
                """,
                list(photo_by_asset),
            ).fetchall()
        except sqlite3.OperationalError:
            rows = []
        for asset_id, title, collection_title in rows:
            photo_id = photo_by_asset.get(str(asset_id))
            if not photo_id or not str(title or "").strip():
                continue
            result[photo_id] = {
                "title": str(title).strip(),
                "collectionTitle": str(collection_title or "Unknown").strip() or "Unknown",
            }
        return result
    finally:
        connection.close()


def _preview_data_url(repo_root: Path, item: dict, preview_cache_path, run_bridge_task) -> tuple[str, str]:
    asset_id = str(item.get("assetId") or "").strip()
    if not asset_id:
        return "", "missing asset id"
    destination = preview_cache_path(repo_root, asset_id, 480)
    if not destination.exists():
        payload = run_bridge_task(
            repo_root,
            ["preview", "--asset-id", asset_id, "--destination", str(destination), "--max-pixel", "480"],
            timeout=90,
        )
        if not payload.get("ok"):
            return "", str(payload.get("error") or payload.get("code") or "preview unavailable")
    try:
        data = destination.read_bytes()
    except OSError as error:
        return "", str(error)
    if not data:
        return "", "preview is empty"
    if len(data) > MAX_PREVIEW_BYTES:
        return "", f"preview exceeds {MAX_PREVIEW_BYTES} bytes"
    return f"data:image/jpeg;base64,{base64.b64encode(data).decode('ascii')}", ""


def _attach_previews(repo_root: Path, items: list[dict], preview_cache_path, run_bridge_task) -> tuple[list[dict], list[dict]]:
    enriched = [dict(item) for item in items]
    errors: list[dict] = []
    # PhotoKit is permission-identity sensitive and the bridge app serializes
    # resource callbacks more reliably than several simultaneous app launches.
    worker_count = 1
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = {
            executor.submit(_preview_data_url, repo_root, item, preview_cache_path, run_bridge_task): index
            for index, item in enumerate(enriched)
        }
        for future in as_completed(futures):
            index = futures[future]
            try:
                preview_url, error = future.result()
            except Exception as exception:  # noqa: BLE001 - one preview must not fail the action.
                preview_url, error = "", str(exception)
            if preview_url:
                enriched[index]["previewDataUrl"] = preview_url
            if error:
                enriched[index]["previewError"] = error
                errors.append({"assetId": enriched[index].get("assetId"), "error": error})
    return enriched, errors


def _run_repo_json(config: ConnectorConfig, arguments: list[str], timeout: int = 3600) -> dict:
    command = "cd " + shlex.quote(str(config.repo_root)) + " && " + " ".join(shlex.quote(item) for item in arguments)
    completed = subprocess.run(
        ["/bin/zsh", "-lic", command],
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    output = (completed.stdout or "").strip()
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or output or f"Command exited {completed.returncode}").strip())
    try:
        payload = json.loads(output or "{}")
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Connector command returned invalid JSON: {output[-500:]}") from error
    if payload.get("ok") is False:
        raise RuntimeError(str(payload.get("error") or payload.get("result") or "Connector command failed."))
    return payload


def _upload_and_register(config: ConnectorConfig, action: dict) -> dict:
    payload = action.get("payload") if isinstance(action.get("payload"), dict) else {}
    requested = max(1, min(24, int(payload.get("limit") or 1)))
    runs = []
    uploaded_asset_ids: list[str] = []
    for _index in range(requested):
        run = _run_repo_json(config, [
            sys.executable,
            "scripts/sidecar_upload_bridge.py",
            "--execute",
            "--limit",
            "1",
            "--json",
        ])
        items = list(run.get("items") or [])
        if not items:
            break
        runs.append({
            "runId": run.get("runId"),
            "status": run.get("status"),
            "summary": run.get("summary") or {},
            "items": [{
                "assetId": item.get("assetId"),
                "photoId": item.get("photoId"),
                "filename": item.get("filename"),
                "status": item.get("status") or item.get("upload", {}).get("status"),
            } for item in items],
        })
        for item in items:
            asset_id = str(item.get("assetId") or "").strip()
            if asset_id and asset_id not in uploaded_asset_ids:
                uploaded_asset_ids.append(asset_id)
        if run.get("status") == "failed":
            break
    registration = {"result": {"candidateCount": 0, "registeredCount": 0, "skippedCount": 0}, "rebuild": {}}
    if uploaded_asset_ids:
        registration = _run_repo_json(config, [
            sys.executable,
            "scripts/sidecar_maintenance.py",
            "register-uploaded-catalog",
            *[argument for asset_id in uploaded_asset_ids for argument in ("--asset-id", asset_id)],
        ])
    return {
        "connectorId": config.connector_id,
        "type": "sidecar-upload-publish",
        "requestedCount": requested,
        "runCount": len(runs),
        "runs": runs,
        "registration": registration.get("result") or {},
        "rebuild": registration.get("rebuild") or {},
        "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def _launch_sidecar_workspace(config: ConnectorConfig) -> dict:
    """Open the canonical local Sidecar UI on this connector Mac."""
    launcher = config.repo_root / "scripts" / "open_sidecar_main.py"
    if not launcher.exists():
        raise RuntimeError(f"Sidecar launcher is missing: {launcher}")
    log_dir = Path.home() / "Library" / "Logs" / "PhotosByElie"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "new-owner-sidecar-launch.log"
    with log_path.open("a", encoding="utf-8") as log:
        subprocess.Popen(
            [sys.executable, str(launcher)],
            cwd=config.repo_root,
            stdout=log,
            stderr=subprocess.STDOUT,
            text=True,
            env=_sidecar_helper_env(config),
            start_new_session=True,
        )
    return {
        "launched": True,
        "surface": "sidecar.html",
        "connectorId": config.connector_id,
        "requestedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def execute_action(config: ConnectorConfig, action: dict) -> dict:
    action_type = str(action.get("type") or "").strip()
    if action_type == "owner-connector-check":
        return {
            "connectorId": config.connector_id,
            "type": action_type,
            "hostname": socket.gethostname(),
            "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    if action_type == "sidecar-photos-index-sync":
        indexed = _run_repo_json(config, [
            sys.executable,
            "scripts/sidecar_maintenance.py",
            "photos-index-sync",
            "--limit",
            "24",
        ])
        return {
            "connectorId": config.connector_id,
            "type": action_type,
            "job": indexed.get("job") or {},
            "sync": indexed.get("sync") or {},
            "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    if action_type == "owner-hidden-metadata":
        payload = action.get("payload") if isinstance(action.get("payload"), dict) else {}
        photo_ids = list(payload.get("photoIds") or [])
        if not photo_ids or len(photo_ids) > 500:
            raise RuntimeError("owner-hidden-metadata requires 1 to 500 photo IDs")
        return {
            "connectorId": config.connector_id,
            "type": action_type,
            "hiddenMetadata": _owner_hidden_metadata(config.repo_root, photo_ids),
            "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    connector_result, decision_result, preview_cache_path, run_bridge_task, apply_public_photo_moderation = _load_local_modules(config.repo_root)
    if action_type == "photo-moderation":
        payload = action.get("payload") if isinstance(action.get("payload"), dict) else {}
        operation = str(payload.get("operation") or "").strip().lower()
        photo_ids = []
        for value in payload.get("photoIds") or []:
            photo_id = str(value or "").strip()
            if photo_id and photo_id not in photo_ids:
                photo_ids.append(photo_id)
        single_photo_id = str(payload.get("photoId") or "").strip()
        if single_photo_id and single_photo_id not in photo_ids:
            photo_ids.insert(0, single_photo_id)
        photo_optional_operations = {"save-keyword-blacklist"}
        if (not photo_ids and operation not in photo_optional_operations) or len(photo_ids) > 500:
            raise RuntimeError("photo-moderation requires 1 to 500 photo IDs")
        moderation_payload = {
            "operation": operation,
            "photo_ids": photo_ids,
        }
        for key in ("title", "keywords", "mode", "restoreTitles"):
            if key in payload:
                moderation_payload[key] = payload[key]
        result = apply_public_photo_moderation(
            config.repo_root,
            moderation_payload,
        )
        return {
            "connectorId": config.connector_id,
            "type": action_type,
            "operation": operation,
            "photoIds": photo_ids,
            "result": result,
            "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    if action_type == "sidecar-culling-review":
        local = connector_result(config.repo_root, {"action": action, "connectorId": config.connector_id})
        manifest = action.get("payload", {}).get("manifest", {}) if isinstance(action.get("payload"), dict) else {}
        items = list(local.get("preview", {}).get("items") or [])
        preview_errors: list[dict] = []
        if manifest.get("includePreviews", True):
            items, preview_errors = _attach_previews(
                config.repo_root,
                items,
                preview_cache_path,
                run_bridge_task,
            )
        result = dict(local.get("result") or {})
        result["previewItems"] = items
        result["stateCounts"] = list(local.get("preview", {}).get("stateCounts") or [])
        result["previewErrors"] = preview_errors
        result["readOnly"] = False
        if manifest.get("launchWorkspace"):
            result["workspace"] = _launch_sidecar_workspace(config)
        return result
    if action_type == "sidecar-review-decision":
        payload = action.get("payload") if isinstance(action.get("payload"), dict) else {}
        decision = decision_result(config.repo_root, {
            "assetId": payload.get("assetId"),
            "action": payload.get("decision"),
            "rating": payload.get("rating"),
            "color": payload.get("color"),
            "title": payload.get("title"),
            "keywords": payload.get("keywords"),
            "metadataState": payload.get("metadataState"),
        })
        return {
            "connectorId": config.connector_id,
            "type": action_type,
            "sourceActionId": str(payload.get("sourceActionId") or ""),
            "decision": decision,
            "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    if action_type == "sidecar-upload-publish":
        return _upload_and_register(config, action)
    raise RuntimeError(f"Unsupported connector action: {action_type or 'missing'}")


def process_exact_action(
    config: ConnectorConfig,
    client: WorkerClient,
    action_id: str,
    *,
    local_wake: bool = False,
) -> tuple[dict, bool]:
    """Claim and execute one Worker-authorized action exactly once on this Mac."""
    with ACTION_EXECUTION_LOCK:
        action = client.action(action_id)
        if action.get("state") in {"completed", "failed", "cancelled"}:
            return action, False
        locally_awakened_at = _utc_iso_now() if local_wake else ""
        try:
            if action.get("state") == "queued":
                claim_payload = {"locallyAwakenedAt": locally_awakened_at} if locally_awakened_at else {}
                action = client.transition(action_id, "claim", claim_payload).get("action") or action
            if action.get("state") != "claimed":
                return action, False
            if action.get("claim", {}).get("connectorId") != config.connector_id:
                raise RuntimeError("Worker action is not claimed by this connector.")
            result = execute_action(config, action)
            executed_at = _utc_iso_now()
            completed = client.transition(
                action_id,
                "complete",
                {"result": result, "timing": {"executedAt": executed_at}},
            ).get("action") or action
            return completed, True
        except Exception as error:  # noqa: BLE001 - failure must be recorded in the cloud ledger.
            try:
                client.transition(action_id, "fail", {"message": str(error)[:500]})
            except Exception:
                pass
            print(f"{action_id}: {error}", file=sys.stderr, flush=True)
            raise


def process_once(config: ConnectorConfig, client: WorkerClient) -> int:
    client.heartbeat()
    processed = 0
    for action in client.actions():
        action_id = str(action.get("id") or "").strip()
        if not action_id:
            continue
        try:
            _action, did_process = process_exact_action(config, client, action_id)
            processed += int(did_process)
        except Exception:
            continue
    return processed


def next_poll_interval(base_interval: int, current_interval: int, processed: int, *, interactive: bool = False) -> int:
    """Back off while idle, but stay responsive during an interactive Owner lease."""
    base = max(2, min(300, int(base_interval)))
    if interactive:
        return min(base, INTERACTIVE_POLL_INTERVAL_SECONDS)
    if processed:
        return base
    return min(DEFAULT_IDLE_MAX_INTERVAL_SECONDS, max(base, int(current_interval) * 2))


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the PhotosByElie background Mac connector.")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    parser.add_argument("--once", action="store_true", help="Poll once and exit.")
    args = parser.parse_args()
    # launchd starts with a deliberately small PATH. Keep the normal local
    # toolchain discoverable to child Sidecar and maintenance processes.
    os.environ["PATH"] = _sidecar_helper_env()["PATH"]
    config = load_config(args.config.expanduser())
    client = WorkerClient(config)
    polling_lease = InteractivePollingLease()
    if not args.once:
        start_local_status_server(config, polling_lease, client)
    poll_interval = config.interval_seconds
    next_full_poll_at = 0.0
    while True:
        interactive = polling_lease.active()
        if not args.once and not interactive:
            try:
                if client.interactive():
                    polling_lease.touch()
                    interactive = True
            except Exception:
                pass
        if args.once or interactive or time.monotonic() >= next_full_poll_at:
            try:
                processed = process_once(config, client)
                if processed:
                    print(f"Processed {processed} Owner action(s).", flush=True)
                poll_interval = next_poll_interval(
                    config.interval_seconds,
                    poll_interval,
                    processed,
                    interactive=interactive,
                )
            except Exception as error:  # noqa: BLE001 - daemon retries transient network/auth failures.
                print(str(error), file=sys.stderr, flush=True)
                poll_interval = next_poll_interval(
                    config.interval_seconds,
                    poll_interval,
                    0,
                    interactive=interactive,
                )
                if args.once:
                    return 1
            next_full_poll_at = time.monotonic() + poll_interval
        if args.once:
            return 0
        wait_seconds = min(
            INTERACTIVE_POLL_INTERVAL_SECONDS,
            max(0.1, next_full_poll_at - time.monotonic()),
        )
        polling_lease.wait(wait_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
