#!/usr/bin/env python3
"""Mac connector for cloud Owner actions.

The supported Backstage path launches this process with ``--once`` for a
bounded drain. The legacy long-running mode remains only for rollback and
must not be used by the on-demand launch contract.
"""

from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
import fcntl
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
from contextlib import contextmanager
from urllib.parse import parse_qs, urlparse
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

try:
    from .owner_connector_runtime import ConnectorRuntimeError, validate_runtime
except ImportError:
    from owner_connector_runtime import ConnectorRuntimeError, validate_runtime


DEFAULT_CONFIG_PATH = Path.home() / ".config" / "photosbyelie" / "connector.json"
CONNECTOR_VERSION = "1.5"
DEFAULT_INTERVAL_SECONDS = 5
DEFAULT_IDLE_MAX_INTERVAL_SECONDS = 60
INTERACTIVE_POLL_INTERVAL_SECONDS = 5
INTERACTIVE_POLL_LEASE_SECONDS = 15
MAX_PREVIEW_BYTES = 250_000
DEFAULT_LOCAL_STATUS_PORT = 8766
ON_DEMAND_CONNECTOR_LOCK_NAME = ".owner-connector-on-demand.lock"
LOCAL_STATUS_PATH = "/photosbyelie/connector-status"
LOCAL_SIDECAR_OPEN_PATH = "/photosbyelie/open-sidecar"
LOCAL_SIDECAR_STATUS_PATH = "/photosbyelie/open-sidecar/status"
LOCAL_WASTE_BASKET_OPEN_PATH = "/photosbyelie/open-wastebasket"
LOCAL_ACTION_WAKE_PATH = "/photosbyelie/wake-owner-action"
LOCAL_TITLE_KEYWORD_REVIEW_PATH = "/photosbyelie/title-keyword-review-queue"
LOCAL_REVIEW_ACTION_PATH = "/photosbyelie/review-action"
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
ACTION_MUTATION_LOCK = threading.Lock()
ACTION_LOCKS_GUARD = threading.Lock()
ACTION_LOCKS: dict[str, tuple[threading.Lock, int]] = {}
ACTION_WAKE_GUARD = threading.Lock()
ACTION_WAKE_ACTIVE: set[str] = set()
READ_ONLY_FIXTURE_MODES = {
    "asset-upload-plan",
    "fixture-access-effective",
    "fixture-ai-proposals-ready",
    "fixture-ai-status",
    "fixture-candidate-universe",
    "fixture-configuration-get",
    "fixture-culling-window",
    "fixture-deliverable-list",
    "fixture-delivery-plan",
    "fixture-lifecycle-list",
    "fixture-placement-list",
    "fixture-policy-migration-plan",
    "fixture-pool-list",
    "fixture-pool-open",
    "fixture-pool-refresh-preview",
    "fixture-publication-plan",
    "fixture-review-window",
    "fixture-search",
    "fixture-state-migration-plan",
    "fixture-tree-list",
    "fixture-upload-health",
    "r2-reconciliation-plan",
}
LEGACY_SIDECAR_ENABLED = os.environ.get("PBE_ENABLE_LEGACY_SIDECAR", "").strip() == "1"
LEGACY_CONNECTOR_DAEMON_ENABLED = (
    os.environ.get("PBE_ENABLE_LEGACY_CONNECTOR_DAEMON", "").strip() == "1"
)


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


ACTION_TIMING_SCHEMA = "photosbyelie.ownerActionTiming.v1"


def _new_action_timing(action_id: str = "") -> dict[str, Any]:
    return {
        "schema": ACTION_TIMING_SCHEMA,
        "actionId": str(action_id or ""),
        "startedAt": _utc_iso_now(),
        "phases": {},
    }


@contextmanager
def _timed_phase(timing: dict[str, Any] | None, name: str):
    """Record one wall-clock and monotonic duration without changing control flow."""
    if timing is None:
        yield
        return
    phase: dict[str, Any] = {"startedAt": _utc_iso_now()}
    timing.setdefault("phases", {})[name] = phase
    started = time.perf_counter()
    try:
        yield
    except BaseException as error:
        phase["outcome"] = "error"
        phase["errorType"] = type(error).__name__
        raise
    else:
        phase["outcome"] = "ok"
    finally:
        phase["endedAt"] = _utc_iso_now()
        phase["elapsedMs"] = round((time.perf_counter() - started) * 1000, 1)


def _finish_action_timing(
    timing: dict[str, Any],
    started: float,
    *,
    outcome: str,
    error: BaseException | None = None,
) -> dict[str, Any]:
    timing["endedAt"] = _utc_iso_now()
    timing["elapsedMs"] = round((time.perf_counter() - started) * 1000, 1)
    timing["outcome"] = outcome
    if error is not None:
        timing["errorType"] = type(error).__name__
    return timing


@dataclass(frozen=True)
class ConnectorConfig:
    worker_base: str
    connector_id: str
    token: str
    repo_root: Path
    interval_seconds: int = DEFAULT_INTERVAL_SECONDS
    local_status_port: int = DEFAULT_LOCAL_STATUS_PORT
    runtime_root: Path | None = None
    runtime_revision: str = ""
    runtime_file_count: int = 0
    runtime_manifest_sha256: str = ""

    @property
    def code_root(self) -> Path:
        return self.runtime_root or self.repo_root


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


@contextmanager
def _action_lock(action_id: str):
    """Serialize duplicate wake/poll attempts without blocking unrelated reads."""
    with ACTION_LOCKS_GUARD:
        lock, users = ACTION_LOCKS.get(action_id, (threading.Lock(), 0))
        ACTION_LOCKS[action_id] = (lock, users + 1)
    lock.acquire()
    try:
        yield
    finally:
        lock.release()
        with ACTION_LOCKS_GUARD:
            current_lock, current_users = ACTION_LOCKS.get(action_id, (lock, 1))
            if current_lock is lock and current_users <= 1:
                ACTION_LOCKS.pop(action_id, None)
            elif current_lock is lock:
                ACTION_LOCKS[action_id] = (lock, current_users - 1)


def _run_local_action_wake(
    config: ConnectorConfig,
    client: "WorkerClient",
    action_id: str,
) -> None:
    """Run a direct wake off the HTTP handler so the UI never waits on X work."""
    with ACTION_WAKE_GUARD:
        if action_id in ACTION_WAKE_ACTIVE:
            return
        ACTION_WAKE_ACTIVE.add(action_id)
    try:
        process_exact_action(config, client, action_id, local_wake=True)
    except Exception as error:  # noqa: BLE001 - the durable action records failure.
        print(
            f"{action_id}: async local wake failed: {error}",
            file=sys.stderr,
            flush=True,
        )
    finally:
        with ACTION_WAKE_GUARD:
            ACTION_WAKE_ACTIVE.discard(action_id)


def _action_is_read_only(action: dict) -> bool:
    action_type = str(action.get("type") or "").strip()
    if action_type in {"owner-connector-check", "owner-hidden-metadata"}:
        return True
    if action_type != "sidecar-culling-review":
        return False
    payload = action.get("payload") if isinstance(action.get("payload"), dict) else {}
    manifest = payload.get("manifest") if isinstance(payload.get("manifest"), dict) else {}
    return str(manifest.get("mode") or "").strip() in READ_ONLY_FIXTURE_MODES


def _action_queue_sort_key(action: dict) -> tuple[int, float]:
    """Put interactive read-only work ahead of maintenance in a drain."""
    priority = 0 if _action_is_read_only(action) else 1
    raw_created_at = str(action.get("createdAt") or action.get("updatedAt") or "").strip()
    try:
        created_at = datetime.fromisoformat(raw_created_at.replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError, OverflowError):
        created_at = 0.0
    return priority, -created_at


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
    runtime_value = str(payload.get("runtimeRoot") or "").strip()
    interval = max(2, min(300, int(payload.get("intervalSeconds") or DEFAULT_INTERVAL_SECONDS)))
    local_status_port = max(0, min(65535, int(payload.get("localStatusPort") or DEFAULT_LOCAL_STATUS_PORT)))
    if not worker_base.startswith("https://"):
        raise RuntimeError("Connector workerBase must use HTTPS.")
    if not connector_id:
        raise RuntimeError("Connector connectorId is required.")
    if len(token) < 24:
        raise RuntimeError("Connector token is missing or too short.")
    if not repo_root.is_dir():
        raise RuntimeError(f"PhotosByElie repoRoot is invalid: {repo_root}")

    runtime_root: Path | None = None
    runtime_revision = ""
    runtime_file_count = 0
    runtime_manifest_sha256 = ""
    if runtime_value:
        runtime_root = Path(runtime_value).expanduser()
        try:
            verification = validate_runtime(runtime_root)
        except ConnectorRuntimeError as error:
            raise RuntimeError(f"Installed connector runtime is invalid: {error}") from error
        runtime_root = runtime_root.resolve(strict=True)
        runtime_revision = verification.revision
        runtime_file_count = verification.file_count
        runtime_manifest_sha256 = verification.manifest_sha256
    elif not (repo_root / "scripts" / "sidecar_state_db.py").exists():
        raise RuntimeError(f"PhotosByElie repoRoot is invalid: {repo_root}")
    return ConnectorConfig(
        worker_base,
        connector_id,
        token,
        repo_root,
        interval,
        local_status_port,
        runtime_root,
        runtime_revision,
        runtime_file_count,
        runtime_manifest_sha256,
    )


def _local_status_payload(config: ConnectorConfig) -> dict:
    return {
        "ok": True,
        "schema": "photosbyelie.localOwnerConnector.v1",
        "connectorId": config.connector_id,
        "hostname": socket.gethostname(),
        "platform": f"{platform.system()} {platform.machine()}",
        "version": CONNECTOR_VERSION,
        "runtime": {
            "selfContained": bool(config.runtime_root),
            "verified": bool(config.runtime_manifest_sha256),
            "revision": config.runtime_revision,
            "fileCount": config.runtime_file_count,
            "manifestSHA256": config.runtime_manifest_sha256,
        },
    }


def _runtime_file(config: ConnectorConfig, relative_path: str) -> Path:
    relative = Path(relative_path)
    if relative.is_absolute() or not relative.parts or relative.parts[0] != "scripts" or ".." in relative.parts:
        raise RuntimeError(f"Unsafe connector runtime path: {relative_path}")
    candidate = config.code_root.joinpath(*relative.parts)
    if candidate.is_symlink() or not candidate.is_file():
        raise RuntimeError(f"Connector runtime file is missing or unsafe: {relative_path}")
    return candidate


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
    env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONDONTWRITEBYTECODE": "1"}
    current_path = env.get("PATH", "")
    parts = [part for part in (*PATH_PREFIXES, *current_path.split(os.pathsep)) if part]
    env["PATH"] = os.pathsep.join(dict.fromkeys(part for part in parts if part))
    if config:
        env["PBE_OWNER_WORKER_BASE"] = config.worker_base
        env["PBE_OWNER_CONNECTOR_ID"] = config.connector_id
        env["PBE_OWNER_CONNECTOR_TOKEN"] = config.token
        env["PBE_CONNECTOR_DATA_ROOT"] = str(config.repo_root)
        env["PBE_CONNECTOR_RUNTIME_ROOT"] = str(config.code_root)
    return env


def _launch_sidecar_for_browser(config: ConnectorConfig) -> dict:
    """Start the local Sidecar helper and return the URL for this browser."""
    if not LEGACY_SIDECAR_ENABLED:
        raise RuntimeError(
            "Legacy Sidecar is disabled. Use native PhotosByElie Backstage, "
            "or set PBE_ENABLE_LEGACY_SIDECAR=1 for a deliberate rehearsal rollback."
        )
    existing = _running_sidecar_helper()
    if existing:
        return existing

    helper = _runtime_file(config, "scripts/sidecar_server.py")

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

    helper = _runtime_file(config, "scripts/local_server.py")

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


def _local_review_action_result(repo_root: Path, payload: dict) -> dict:
    """Apply one Backstage Review mutation without creating a cloud action."""
    operation = str(payload.get("operation") or "").strip().casefold()
    scripts_path = str(repo_root / "scripts")
    if scripts_path not in sys.path:
        sys.path.insert(0, scripts_path)
    from fixture_pipeline import apply_fixture_review_action, undo_fixture_review_action

    with ACTION_MUTATION_LOCK:
        if operation == "apply":
            asset_ids = payload.get("assetIds")
            if not isinstance(asset_ids, list) or not asset_ids or len(asset_ids) > 500:
                raise ValueError("Review apply requires 1 to 500 asset IDs")
            result = apply_fixture_review_action(
                repo_root,
                str(payload.get("fixtureId") or ""),
                asset_ids,
                str(payload.get("reviewAction") or ""),
                anchor_asset_id=str(payload.get("anchorAssetId") or ""),
                propagate=bool(payload.get("propagate")),
                title=payload.get("title") if "title" in payload else None,
                keywords=payload.get("keywords") if "keywords" in payload else None,
                proposal_id=str(payload.get("proposalId") or ""),
                ai_reasons=payload.get("aiReasons") or [],
                ai_note=str(payload.get("aiNote") or ""),
                actor="owner-backstage",
            )
            return {"ok": True, "source": "backstage-local", "reviewAction": result}
        if operation == "undo":
            result = undo_fixture_review_action(
                repo_root,
                str(payload.get("operationId") or ""),
                actor="owner-backstage",
            )
            return {"ok": True, "source": "backstage-local", "reviewUndo": result}
    raise ValueError("unsupported local Review operation")


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
                LOCAL_TITLE_KEYWORD_REVIEW_PATH,
                LOCAL_REVIEW_ACTION_PATH,
            }:
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(204)
            self._send_cors_headers()
            self.end_headers()

        def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API.
            parsed = urlparse(self.path)
            if parsed.path == LOCAL_REVIEW_ACTION_PATH:
                if not self._allowed_origin():
                    self.send_response(403)
                    self._send_cors_headers()
                    self.end_headers()
                    return
                try:
                    content_length = int(self.headers.get("Content-Length") or 0)
                except ValueError:
                    content_length = 0
                if content_length <= 0 or content_length > 512 * 1024:
                    self.send_response(400)
                    self._send_cors_headers()
                    self.end_headers()
                    return
                try:
                    payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
                    if not isinstance(payload, dict):
                        raise ValueError("Local Review request must be a JSON object.")
                    response_payload = _local_review_action_result(config.repo_root, payload)
                    body = json.dumps(response_payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                    status = 200
                except ValueError as error:
                    body = json.dumps({"ok": False, "error": str(error)}, separators=(",", ":")).encode("utf-8")
                    status = 400
                except Exception as error:  # noqa: BLE001 - return the local transaction failure to Backstage.
                    body = json.dumps({"ok": False, "error": str(error)}, separators=(",", ":")).encode("utf-8")
                    status = 500
                self.send_response(status)
                self._send_cors_headers()
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
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
                thread = threading.Thread(
                    target=_run_local_action_wake,
                    args=(config, client, action_id),
                    name=f"pbe-owner-action-wake-{action_id[-12:]}",
                    daemon=True,
                )
                thread.start()
                body = json.dumps({
                    "ok": True,
                    "action": None,
                    "diagnostics": {
                        "fastPath": True,
                        "accepted": True,
                        "localWakeMs": round((time.perf_counter() - wake_started) * 1000, 1),
                    },
                }, separators=(",", ":")).encode("utf-8")
                status = 202
            except ValueError as error:
                body = json.dumps({"ok": False, "error": str(error)}, separators=(",", ":")).encode("utf-8")
                status = 400
            except Exception as error:  # noqa: BLE001 - cloud ledger records the durable failure.
                body = json.dumps({"ok": False, "error": str(error)}, separators=(",", ":")).encode("utf-8")
                status = 502
            try:
                self.send_response(status)
                self._send_cors_headers()
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                # The browser/native wake is only an acceleration hint and may
                # stop waiting once the durable Worker action is complete,
                # including while the response headers are being flushed.
                pass

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
                if not LEGACY_SIDECAR_ENABLED:
                    body = (
                        "Legacy Sidecar is disabled. Use native PhotosByElie Backstage. "
                        "For a deliberate rehearsal rollback, restart the connector with "
                        "PBE_ENABLE_LEGACY_SIDECAR=1."
                    ).encode("utf-8")
                    self.send_response(410)
                    self.send_header("Content-Type", "text/plain; charset=utf-8")
                    self.send_header("Content-Length", str(len(body)))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(body)
                    return
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
            if parsed.path == LOCAL_TITLE_KEYWORD_REVIEW_PATH:
                try:
                    scripts_path = str(config.code_root / "scripts")
                    if scripts_path not in sys.path:
                        sys.path.insert(0, scripts_path)
                    from local_server import title_keyword_review_queue_payload

                    # The native proposal pane needs the actionable queue, not the
                    # browser review surface's expensive 500-item incomplete backlog
                    # synthesis or maintenance pass.
                    payload = title_keyword_review_queue_payload(
                        config.repo_root,
                        include_backlog=False,
                        run_maintenance=False,
                    )
                    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                    status = 200
                except Exception as error:  # noqa: BLE001 - native UI must receive the local read failure.
                    body = json.dumps({"ok": False, "error": str(error)}, separators=(",", ":")).encode("utf-8")
                    status = 500
                self.send_response(status)
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


class WorkerRequestError(RuntimeError):
    """A Worker response that includes an HTTP status and stable error code."""

    def __init__(self, message: str, *, status: int = 0, code: str = "") -> None:
        super().__init__(message)
        self.status = int(status)
        self.code = str(code or "").strip()


class WorkerClient:
    def __init__(self, config: ConnectorConfig):
        self.config = config

    def request(
        self,
        method: str,
        path: str,
        payload: dict | None = None,
        *,
        idempotency_key: str = "",
    ) -> dict:
        data = None if payload is None else json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        mutation_headers = (
            {"Idempotency-Key": idempotency_key or f"connector-{self.config.connector_id}-{uuid.uuid4().hex}"}
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
            remote_error = detail.get("error")
            message = remote_error.get("message") if isinstance(remote_error, dict) else remote_error
            code = remote_error.get("code") if isinstance(remote_error, dict) else ""
            raise WorkerRequestError(
                message or f"Worker returned HTTP {error.code} for {path}.",
                status=error.code,
                code=code,
            ) from error
        except (URLError, OSError, json.JSONDecodeError) as error:
            raise RuntimeError(f"Worker request failed for {path}: {error}") from error
        if body.get("ok") is False or body.get("error"):
            remote_error = body.get("error")
            message = remote_error.get("message") if isinstance(remote_error, dict) else str(remote_error)
            code = remote_error.get("code") if isinstance(remote_error, dict) else ""
            raise WorkerRequestError(message or "Worker request failed.", code=code)
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


def _load_local_modules(runtime_root: Path):
    scripts_root = (runtime_root / "scripts").resolve(strict=True)
    scripts_path = str(scripts_root)
    # The data checkout is deliberately the mutable Owner.sqlite root, not an
    # executable-code source.  A long-lived connector can nevertheless have
    # that checkout's scripts directory earlier in sys.path (or retain one of
    # its modules from an older action).  Make the installed runtime an
    # invariant instead of a best-effort path hint.
    sys.path[:] = [entry for entry in sys.path if str(Path(entry or ".").resolve()) != scripts_path]
    sys.path.insert(0, scripts_path)
    # Purge every runtime-owned module name, not just the two connector entry
    # points. Those entry points import a sizeable sibling graph (for example
    # import_source_anchor). Keeping one transitive sibling cached from the
    # mutable data checkout can make an otherwise attested runtime execute an
    # incompatible mix of revisions.
    runtime_module_names: set[str] = set()
    for source_path in scripts_root.rglob("*.py"):
        relative_path = source_path.relative_to(scripts_root)
        if relative_path.name == "__init__.py":
            if relative_path.parent.parts:
                runtime_module_names.add(".".join(relative_path.parent.parts))
        else:
            runtime_module_names.add(".".join(relative_path.with_suffix("").parts))
            runtime_module_names.add(source_path.stem)

    for module_name in sorted(runtime_module_names):
        loaded = sys.modules.get(module_name)
        loaded_file = getattr(loaded, "__file__", "") if loaded is not None else ""
        if loaded_file:
            try:
                Path(loaded_file).resolve().relative_to(scripts_root)
            except ValueError:
                sys.modules.pop(module_name, None)

    import local_server
    import sidecar_server

    for module_name, module in (("local_server", local_server), ("sidecar_server", sidecar_server)):
        loaded_file = Path(str(getattr(module, "__file__", ""))).resolve()
        try:
            loaded_file.relative_to(scripts_root)
        except ValueError as error:
            raise RuntimeError(
                f"Installed connector runtime did not supply {module_name}: {loaded_file}"
            ) from error

    for module_name in sorted(runtime_module_names):
        loaded = sys.modules.get(module_name)
        loaded_file = getattr(loaded, "__file__", "") if loaded is not None else ""
        if not loaded_file:
            continue
        try:
            Path(loaded_file).resolve().relative_to(scripts_root)
        except ValueError as error:
            raise RuntimeError(
                f"Installed connector runtime retained mutable sibling {module_name}: {loaded_file}"
            ) from error

    return (
        local_server.new_owner_connector_result,
        local_server.new_owner_sidecar_decision_result,
        sidecar_server._preview_cache_path,
        sidecar_server._run_backstage_photos_preview_task,
        local_server.apply_public_photo_moderation,
    )


def _load_lifecycle_gateway(repo_root: Path):
    scripts_path = str(repo_root / "scripts")
    if scripts_path not in sys.path:
        sys.path.insert(0, scripts_path)
    import waste_basket_gateway

    return waste_basket_gateway


def _lifecycle_phase_key(operation_id: str, phase: str) -> str:
    return f"connector-lifecycle:{operation_id}:{phase}"


def _lifecycle_request(
    client: WorkerClient,
    phase: str,
    operation_id: str,
    payload: dict[str, Any],
    *,
    action_timing: dict[str, Any] | None = None,
) -> dict:
    """Send one replay-safe lifecycle phase under a stable idempotency key."""
    with _timed_phase(
        action_timing,
        f"lifecycle.remote.{phase}.{operation_id}",
    ):
        return client.request(
            "POST",
            f"/api/v1/lifecycle/{phase}",
            payload,
            idempotency_key=_lifecycle_phase_key(operation_id, phase),
        )


def _lifecycle_arm_intent_database(config: ConnectorConfig) -> Path:
    return config.repo_root / "assets" / "owner-actions" / "Owner.sqlite"


def _ensure_lifecycle_arm_intent_schema(connection: sqlite3.Connection) -> None:
    connection.execute(
        """CREATE TABLE IF NOT EXISTS owner_connector_lifecycle_arm_intents (
          operation_id    TEXT PRIMARY KEY CHECK (trim(operation_id) <> ''),
          operation       TEXT NOT NULL CHECK (trim(operation) <> ''),
          denied          INTEGER NOT NULL CHECK (denied IN (0, 1)),
          asset_ids_json  TEXT NOT NULL,
          request_json    TEXT NOT NULL,
          created_at      TEXT NOT NULL,
          updated_at      TEXT NOT NULL
        )"""
    )


def _persist_lifecycle_arm_intent(
    config: ConnectorConfig,
    operation: str,
    asset_ids: list[str],
    request_payload: dict[str, Any],
) -> dict[str, Any]:
    """Persist the exact remote arm request before network I/O."""
    operation_id = str(request_payload.get("operationId") or "").strip()
    if not operation_id:
        raise RuntimeError("Lifecycle arm intent requires a durable operation ID")
    intent = {
        "operationId": operation_id,
        "operation": str(operation or "").strip().lower(),
        "denied": bool(request_payload.get("denied")),
        "assetIds": list(asset_ids),
        "request": request_payload,
    }
    database_path = _lifecycle_arm_intent_database(config)
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    now = _utc_iso_now()
    asset_ids_json = json.dumps(intent["assetIds"], ensure_ascii=False, separators=(",", ":"))
    request_json = json.dumps(request_payload, ensure_ascii=False, separators=(",", ":"))
    try:
        connection.execute("BEGIN IMMEDIATE")
        _ensure_lifecycle_arm_intent_schema(connection)
        existing = connection.execute(
            """SELECT operation, denied, asset_ids_json, request_json
                 FROM owner_connector_lifecycle_arm_intents WHERE operation_id = ?""",
            (operation_id,),
        ).fetchone()
        expected = (intent["operation"], int(intent["denied"]), asset_ids_json, request_json)
        if existing and tuple(existing) != expected:
            raise RuntimeError("Lifecycle arm intent conflicts with durable initiating intent")
        if not existing:
            connection.execute(
                """INSERT INTO owner_connector_lifecycle_arm_intents
                  (operation_id, operation, denied, asset_ids_json, request_json, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (operation_id, *expected, now, now),
            )
        connection.commit()
        return intent
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _pending_lifecycle_arm_intents(config: ConnectorConfig) -> list[dict[str, Any]]:
    database_path = _lifecycle_arm_intent_database(config)
    if not database_path.exists():
        return []
    connection = sqlite3.connect(database_path)
    try:
        _ensure_lifecycle_arm_intent_schema(connection)
        rows = connection.execute(
            """SELECT operation_id, operation, denied, asset_ids_json, request_json
                 FROM owner_connector_lifecycle_arm_intents ORDER BY created_at, operation_id"""
        ).fetchall()
        connection.commit()
        return [{
            "operationId": str(row[0]),
            "operation": str(row[1]),
            "denied": bool(row[2]),
            "assetIds": json.loads(str(row[3])),
            "request": json.loads(str(row[4])),
        } for row in rows]
    finally:
        connection.close()


def _clear_lifecycle_arm_intent(config: ConnectorConfig, intent: dict[str, Any]) -> None:
    database_path = _lifecycle_arm_intent_database(config)
    connection = sqlite3.connect(database_path)
    request_json = json.dumps(intent["request"], ensure_ascii=False, separators=(",", ":"))
    try:
        connection.execute("BEGIN IMMEDIATE")
        _ensure_lifecycle_arm_intent_schema(connection)
        changed = connection.execute(
            """DELETE FROM owner_connector_lifecycle_arm_intents
                 WHERE operation_id = ? AND request_json = ?""",
            (intent["operationId"], request_json),
        ).rowcount
        if changed != 1:
            raise RuntimeError("Lifecycle arm intent changed before receipt persistence")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _reconcile_lifecycle_arm_intent(
    config: ConnectorConfig,
    client: WorkerClient,
    gateway: Any,
    intent: dict[str, Any],
    *,
    action_timing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Replay an uncertain arm and clear intent only after its receipt is durable."""
    operation_id = intent["operationId"]
    try:
        arm = _lifecycle_request(
            client,
            "arm",
            operation_id,
            intent["request"],
            action_timing=action_timing,
        )
    except WorkerRequestError as error:
        # A deterministic identity rejection means the remote authority
        # explicitly refused to create a barrier. Nothing can be committed
        # locally, and retaining this initiating intent would make every
        # background poll replay the same permanent failure forever. Keep the
        # Owner action failure as the audit record, but retire only this
        # pre-mutation retry intent. Transport errors and 5xx/partial errors
        # remain durable for replay.
        if error.status == 409 and error.code == "lifecycle_identity_conflict":
            _clear_lifecycle_arm_intent(config, intent)
        raise
    gateway.record_deployed_lifecycle_arm(
        config.repo_root,
        intent["operation"],
        intent["assetIds"],
        arm,
    )
    _clear_lifecycle_arm_intent(config, intent)
    return arm


def drain_deployed_lifecycle_outbox(
    config: ConnectorConfig,
    client: WorkerClient,
    *,
    action_timing: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Replay durable lifecycle phases independently of cloud action state."""
    gateway = _load_lifecycle_gateway(config.repo_root)
    drained: list[dict[str, Any]] = []
    for intent in _pending_lifecycle_arm_intents(config):
        arm = _reconcile_lifecycle_arm_intent(
            config,
            client,
            gateway,
            intent,
            action_timing=action_timing,
        )
        drained.append({"operationId": intent["operationId"], "state": "armed", "remote": arm})
    for pending in gateway.pending_deployed_lifecycle_operations(config.repo_root):
        operation_id = pending["operationId"]
        digest = pending["operationDigest"]
        state = pending["state"]
        if state == "armed":
            hosted_state = gateway.hosted_lifecycle_request_state_for_operation(
                config.repo_root, operation_id
            )
            if hosted_state in {"queued", "running"}:
                drained.append({
                    "operationId": operation_id,
                    "state": "armed",
                    "hostedRequestState": hosted_state,
                })
                continue
            proof = gateway.deployed_lifecycle_abort_proof(
                config.repo_root, operation_id, digest
            )
            if proof is None:
                continue
            remote = _lifecycle_request(
                client,
                "abort",
                operation_id,
                {
                    "operationId": operation_id,
                    "operationDigest": digest,
                    "proof": proof,
                },
                action_timing=action_timing,
            )
            gateway.abort_deployed_lifecycle_arm_locally(
                config.repo_root, operation_id, digest
            )
            drained.append({"operationId": operation_id, "state": "aborted", "remote": remote})
            continue
        durable = gateway.deployed_lifecycle_outbox(config.repo_root, operation_id)
        if state == "locally_committed":
            _lifecycle_request(
                client,
                "local-commit",
                operation_id,
                {
                    "operationId": operation_id,
                    "operationDigest": digest,
                },
                action_timing=action_timing,
            )
            remote = _lifecycle_request(
                client,
                "apply",
                operation_id,
                durable,
                action_timing=action_timing,
            )
            gateway.acknowledge_deployed_lifecycle(
                config.repo_root,
                operation_id,
                digest,
                state="deployed_applied",
            )
            state = "deployed_applied"
            drained.append({"operationId": operation_id, "state": state, "remote": remote})
        if state == "deployed_applied":
            remote = _lifecycle_request(
                client,
                "ack",
                operation_id,
                {
                    "operationId": operation_id,
                    "operationDigest": digest,
                },
                action_timing=action_timing,
            )
            gateway.acknowledge_deployed_lifecycle(
                config.repo_root,
                operation_id,
                digest,
                state="locally_acked",
            )
            drained.append({"operationId": operation_id, "state": "locally_acked", "remote": remote})
    return drained


def drain_hosted_lifecycle_requests(
    config: ConnectorConfig,
    client: WorkerClient,
) -> list[dict[str, Any]]:
    """Execute durable hosted-browser intents through the trusted connector.

    This routine must be called while ``ACTION_MUTATION_LOCK`` is held. The
    browser-authenticated queue contains only fixture-bound intent; trusted
    actor/source/authorization context is synthesized here on the Mac.
    """
    gateway = _load_lifecycle_gateway(config.repo_root)
    drained: list[dict[str, Any]] = []
    for pending in gateway.pending_hosted_lifecycle_requests(config.repo_root):
        request_id = str(pending["requestId"])
        claimed = gateway.claim_hosted_lifecycle_request(config.repo_root, request_id)
        if claimed.get("state") != "running":
            drained.append({
                "requestId": request_id,
                "state": claimed.get("state") or "failed",
                **({"error": claimed["error"]} if claimed.get("error") else {}),
            })
            continue
        operation_id = f"owner-action:hosted-lifecycle:{request_id}"
        prior_result = gateway.deployed_lifecycle_local_result(
            config.repo_root, operation_id
        )
        if prior_result is not None:
            drain_deployed_lifecycle_outbox(config, client)
            completed = gateway.finish_hosted_lifecycle_request(
                config.repo_root, request_id, result=prior_result
            )
            drained.append({"requestId": request_id, "state": completed["state"]})
            continue
        action = {
            "id": f"hosted-lifecycle:{request_id}",
            "type": "photo-moderation",
            "payload": {
                "operation": claimed["operation"],
                "photoIds": list(claimed["assetIds"]),
                "source": "owner-gallery",
                "actor": f"backstage-pbe:{claimed['sessionId']}",
                "fixture_id": claimed["fixtureId"],
                "gallery_id": claimed["fixtureId"],
                "owner_mode": True,
                "owner_authorized": True,
            },
        }
        try:
            result = execute_action(config, action, lifecycle_client=client)
        except Exception as error:  # noqa: BLE001 - durable status must survive connector failures.
            local_state = gateway.deployed_lifecycle_operation_state(
                config.repo_root, operation_id
            )
            retryable = local_state not in {"armed", "aborted"}
            current = gateway.finish_hosted_lifecycle_request(
                config.repo_root,
                request_id,
                error=str(error),
                retryable=retryable,
            )
            drained.append({"requestId": request_id, "state": current["state"], "error": str(error)})
            continue
        completed = gateway.finish_hosted_lifecycle_request(
            config.repo_root,
            request_id,
            result=dict(result.get("result") or result),
        )
        drained.append({"requestId": request_id, "state": completed["state"]})
    return drained


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


def _preview_data_url(repo_root: Path, item: dict, preview_cache_path, run_preview_task) -> tuple[str, str]:
    asset_id = str(item.get("assetId") or "").strip()
    if not asset_id:
        return "", "missing asset id"
    destination = preview_cache_path(repo_root, asset_id, 480)
    if not destination.exists():
        payload = run_preview_task(
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


def _attach_previews(repo_root: Path, items: list[dict], preview_cache_path, run_preview_task) -> tuple[list[dict], list[dict]]:
    enriched = [dict(item) for item in items]
    errors: list[dict] = []
    # Keep requests serialized so one signed Backstage PhotoKit process owns
    # the local resource callbacks and connector errors stay per-item.
    worker_count = 1
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = {
            executor.submit(_preview_data_url, repo_root, item, preview_cache_path, run_preview_task): index
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
    runtime_arguments = list(arguments)
    if len(runtime_arguments) > 1 and runtime_arguments[1].startswith("scripts/"):
        runtime_arguments[1] = str(_runtime_file(config, runtime_arguments[1]))
    command = "cd " + shlex.quote(str(config.repo_root)) + " && " + " ".join(
        shlex.quote(item) for item in runtime_arguments
    )
    completed = subprocess.run(
        ["/bin/zsh", "-lic", command],
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
        env=_sidecar_helper_env(config),
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
    workflow = str(payload.get("workflow") or "").strip()
    if workflow in {"fixture-delivery", "fixture-publication"}:
        fixture_id = str(payload.get("fixtureId") or "").strip()
        asset_ids = list(dict.fromkeys(
            str(value or "").strip()
            for value in (payload.get("assetIds") or [])
            if str(value or "").strip()
        ))
        if not fixture_id:
            raise RuntimeError("fixture-scoped upload actions require fixtureId")
        if not asset_ids or len(asset_ids) > 24:
            raise RuntimeError("fixture-scoped upload actions require 1 to 24 exact assetIds")
        script = (
            "scripts/native_fixture_delivery.py"
            if workflow == "fixture-delivery"
            else "scripts/native_fixture_publication.py"
        )
        result = _run_repo_json(config, [
            sys.executable,
            script,
            "--fixture-id",
            fixture_id,
            *[argument for asset_id in asset_ids for argument in ("--asset-id", asset_id)],
        ])
        return {
            "connectorId": config.connector_id,
            "type": "sidecar-upload-publish",
            "workflow": workflow,
            "fixtureId": fixture_id,
            "assetIds": asset_ids,
            "result": result,
            "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
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
    if not LEGACY_SIDECAR_ENABLED:
        raise RuntimeError(
            "Legacy Sidecar is disabled. Use native PhotosByElie Backstage, "
            "or set PBE_ENABLE_LEGACY_SIDECAR=1 for a deliberate rehearsal rollback."
        )
    launcher = _runtime_file(config, "scripts/open_sidecar_main.py")
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


def execute_action(
    config: ConnectorConfig,
    action: dict,
    *,
    lifecycle_client: WorkerClient | None = None,
    action_timing: dict[str, Any] | None = None,
) -> dict:
    action_type = str(action.get("type") or "").strip()
    if action_type == "owner-connector-check":
        return {
            "connectorId": config.connector_id,
            "type": action_type,
            "hostname": socket.gethostname(),
            "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    if action_type == "sidecar-photos-index-sync":
        payload = action.get("payload") if isinstance(action.get("payload"), dict) else {}
        date_from = str(payload.get("dateFrom") or "").strip()
        date_to = str(payload.get("dateTo") or "").strip()
        for label, value in (("dateFrom", date_from), ("dateTo", date_to)):
            if not value:
                continue
            try:
                datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError as error:
                raise RuntimeError(f"{label} must be an ISO-8601 date") from error
        arguments = [
            sys.executable,
            "scripts/sidecar_maintenance.py",
            "photos-index-sync",
            "--limit",
            "24",
        ]
        if date_from:
            arguments.extend(["--date-from", date_from])
        if date_to:
            arguments.extend(["--date-to", date_to])
        indexed = _run_repo_json(config, [
            *arguments,
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
    connector_result, decision_result, preview_cache_path, run_preview_task, apply_public_photo_moderation = _load_local_modules(config.code_root)
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
        photo_optional_operations = {
            "save-keyword-blacklist",
            "save-title-keyword-model-ladder",
            "save-title-keyword-review-approvals",
            "apply-title-keyword-review-approvals",
            "apply-approved-title-keyword-review-approvals",
            "waste-basket-empty",
        }
        if (not photo_ids and operation not in photo_optional_operations) or len(photo_ids) > 500:
            raise RuntimeError("photo-moderation requires 1 to 500 photo IDs")
        moderation_payload = {
            "operation": operation,
            "photo_ids": photo_ids,
        }
        lifecycle_operations = {
            "waste-basket-x": ("x", True),
            "waste-basket-x-many": ("x", True),
            "waste-basket-empty": ("empty", True),
            "waste-basket-restore": ("restore", False),
            "waste-basket-tombstone-restore": ("tombstone-restore", False),
        }
        lifecycle_arm = None
        active_lifecycle_client = lifecycle_client
        if operation in lifecycle_operations:
            lifecycle_operation, denied = lifecycle_operations[operation]
            gateway = _load_lifecycle_gateway(config.repo_root)
            with _timed_phase(action_timing, "lifecycle.resolve.authoritative-ids"):
                authoritative_ids = gateway.resolve_deployed_lifecycle_asset_ids(
                    config.repo_root, lifecycle_operation, photo_ids
                )
            if len(authoritative_ids) > 100:
                raise RuntimeError("Lifecycle moderation accepts at most 100 authoritative assets per Owner action")
            with _timed_phase(action_timing, "lifecycle.resolve.members"):
                authoritative_members = gateway.derive_deployed_lifecycle_members(
                    config.repo_root, authoritative_ids
                )
            operation_id = f"owner-action:{str(action.get('id') or '').strip()}"
            if operation_id == "owner-action:":
                raise RuntimeError("Lifecycle moderation requires a durable Owner action ID")
            active_lifecycle_client = active_lifecycle_client or WorkerClient(config)
            arm_request = {
                "operationId": operation_id,
                "operation": lifecycle_operation,
                "denied": denied,
                "items": authoritative_members,
            }
            with _timed_phase(action_timing, "lifecycle.arm.intent-persist"):
                arm_intent = _persist_lifecycle_arm_intent(
                    config,
                    lifecycle_operation,
                    authoritative_ids,
                    arm_request,
                )
            with _timed_phase(action_timing, "lifecycle.arm.reconcile"):
                lifecycle_arm = _reconcile_lifecycle_arm_intent(
                    config,
                    active_lifecycle_client,
                    gateway,
                    arm_intent,
                    action_timing=action_timing,
                )
            photo_ids = authoritative_ids
            moderation_payload["photo_ids"] = authoritative_ids
            moderation_payload["request_key"] = operation_id
        for key in (
            "title",
            "caption",
            "keywords",
            "model_ladder",
            "mode",
            "restoreTitles",
            "batch_id",
            "approvals",
            "rejections",
            "blocked",
            "reason",
            "source",
            "actor",
            "fixture_id",
            "fixtureId",
            "gallery_id",
            "galleryId",
            "request_key",
            "requestKey",
            "owner_mode",
            "ownerMode",
            "owner_authorized",
            "ownerAuthorized",
            "confirmed",
            "confirmation_token",
            "confirmationToken",
            "explicit_tombstone_restore",
            "explicitTombstoneRestore",
        ):
            if key in payload:
                moderation_payload[key] = payload[key]
        if lifecycle_arm:
            moderation_payload.pop("requestKey", None)
            moderation_payload["request_key"] = lifecycle_arm["operationId"]
        if lifecycle_arm:
            with _timed_phase(action_timing, "lifecycle.local-moderation"):
                result = apply_public_photo_moderation(
                    config.repo_root,
                    moderation_payload,
                    trusted_deployed_lifecycle=lifecycle_arm,
                )
        else:
            result = apply_public_photo_moderation(config.repo_root, moderation_payload)
        lifecycle_result = None
        if lifecycle_arm and active_lifecycle_client:
            with _timed_phase(action_timing, "lifecycle.outbox.replay"):
                replay = drain_deployed_lifecycle_outbox(
                    config,
                    active_lifecycle_client,
                    action_timing=action_timing,
                )
            lifecycle_result = {"arm": lifecycle_arm, "replay": replay}
        result_payload = {
            "connectorId": config.connector_id,
            "type": action_type,
            "operation": operation,
            "photoIds": photo_ids,
            "result": result,
            "lifecycle": lifecycle_result,
            "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        if action_timing is not None:
            result_payload["timing"] = {"connector": action_timing}
        return result_payload
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
                run_preview_task,
            )
        result = dict(local.get("result") or {})
        result["previewItems"] = items
        result["stateCounts"] = list(local.get("preview", {}).get("stateCounts") or [])
        result["previewErrors"] = preview_errors
        result.setdefault("readOnly", False)
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
            "caption": payload.get("caption"),
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
    with _action_lock(action_id):
        timing = _new_action_timing(action_id)
        timing_started = time.perf_counter()
        try:
            with _timed_phase(timing, "action.fetch"):
                action = client.action(action_id)
        except Exception as error:
            _finish_action_timing(timing, timing_started, outcome="error", error=error)
            raise
        if action.get("state") in {"completed", "failed", "cancelled"}:
            return action, False
        locally_awakened_at = _utc_iso_now() if local_wake else ""
        try:
            with _timed_phase(timing, "action.claim"):
                if action.get("state") == "queued":
                    claim_payload = {"locallyAwakenedAt": locally_awakened_at} if locally_awakened_at else {}
                    action = client.transition(action_id, "claim", claim_payload).get("action") or action
            if action.get("state") != "claimed":
                _finish_action_timing(timing, timing_started, outcome="not-claimed")
                return action, False
            if action.get("claim", {}).get("connectorId") != config.connector_id:
                raise RuntimeError("Worker action is not claimed by this connector.")
            with _timed_phase(timing, "action.execute"):
                if _action_is_read_only(action):
                    result = execute_action(config, action, action_timing=timing)
                else:
                    with ACTION_MUTATION_LOCK:
                        result = execute_action(config, action, action_timing=timing)
            if isinstance(result, dict):
                result.setdefault("timing", {})["connector"] = timing
            executed_at = _utc_iso_now()
            if action.get("type") == "sidecar-culling-review" and isinstance(result, dict):
                phase_timing = dict(result.get("timing") or {})
                owner_timing = dict(action.get("timing") or {})
                owner_timing["executedAt"] = executed_at
                phase_timing["ownerAction"] = owner_timing
                result = {**result, "timing": phase_timing}
            complete_started_at = _utc_iso_now()
            timing.setdefault("phases", {})["action.complete"] = {
                "startedAt": complete_started_at,
                "endedAt": complete_started_at,
                "elapsedMs": 0.0,
                "outcome": "submitted",
            }
            _finish_action_timing(timing, timing_started, outcome="submitted")
            completed = client.transition(
                action_id,
                "complete",
                {
                    "result": result,
                    "timing": {
                        "executedAt": executed_at,
                        "connector": timing,
                    },
                },
            ).get("action") or action
            return completed, True
        except Exception as error:  # noqa: BLE001 - failure must be recorded in the cloud ledger.
            _finish_action_timing(timing, timing_started, outcome="error", error=error)
            try:
                client.transition(
                    action_id,
                    "fail",
                    {
                        "message": str(error)[:500],
                        "timing": {"connector": timing},
                    },
                )
            except Exception:
                pass
            print(f"{action_id}: {error}", file=sys.stderr, flush=True)
            raise


def process_once(config: ConnectorConfig, client: WorkerClient) -> int:
    with ACTION_MUTATION_LOCK:
        drain_deployed_lifecycle_outbox(config, client)
        hosted_before = drain_hosted_lifecycle_requests(config, client)
    client.heartbeat()
    processed = 0
    for action in sorted(client.actions(), key=_action_queue_sort_key):
        action_id = str(action.get("id") or "").strip()
        if not action_id:
            continue
        try:
            _action, did_process = process_exact_action(config, client, action_id)
            processed += int(did_process)
        except Exception:
            continue
    with ACTION_MUTATION_LOCK:
        drain_deployed_lifecycle_outbox(config, client)
        hosted_after = drain_hosted_lifecycle_requests(config, client)
    return processed + len([
        item for item in [*hosted_before, *hosted_after] if item.get("state") == "completed"
    ])


@contextmanager
def _connector_process_lock(config: ConnectorConfig):
    """Allow only one local connector process to drain Owner work at a time.

    Native Backstage and its hosted loopback Owner UI are separate launchers.
    The in-process locks above cannot serialize their child processes, so use a
    short-lived advisory lock in the mutable Owner data root. A second bounded
    wake exits without touching Worker or SQLite; the process holding the lock
    remains the sole drain owner.
    """
    lock_path = config.repo_root / "assets" / "owner-actions" / ON_DEMAND_CONNECTOR_LOCK_NAME
    try:
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        handle = lock_path.open("a+", encoding="utf-8")
    except OSError as error:
        raise RuntimeError(f"Could not prepare the local Owner connector lock: {error}") from error

    acquired = False
    try:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
        except BlockingIOError:
            yield False
            return
        try:
            os.fchmod(handle.fileno(), 0o600)
        except OSError:
            pass
        yield True
    finally:
        if acquired:
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            except OSError:
                pass
        handle.close()


def process_direct_action(config: ConnectorConfig, client: WorkerClient, action_id: str) -> int:
    """Execute one woken action, allowing read-only work beside maintenance."""
    action = client.action(action_id)
    if _action_is_read_only(action):
        _action, did_process = process_exact_action(config, client, action_id, local_wake=True)
        return int(did_process)

    with _connector_process_lock(config) as acquired:
        if not acquired:
            return 0
        _action, did_process = process_exact_action(config, client, action_id, local_wake=True)
        return int(did_process)


def next_poll_interval(base_interval: int, current_interval: int, processed: int, *, interactive: bool = False) -> int:
    """Back off while idle, but stay responsive during an interactive Owner lease."""
    base = max(2, min(300, int(base_interval)))
    if interactive:
        return min(base, INTERACTIVE_POLL_INTERVAL_SECONDS)
    if processed:
        return base
    return min(DEFAULT_IDLE_MAX_INTERVAL_SECONDS, max(base, int(current_interval) * 2))


def _run_connector(config: ConnectorConfig, *, once: bool, action_id: str = "") -> int:
    client = WorkerClient(config)
    if action_id:
        client.heartbeat()
        return process_direct_action(config, client, action_id)
    polling_lease = InteractivePollingLease()
    if not once:
        start_local_status_server(config, polling_lease, client)
    poll_interval = config.interval_seconds
    next_full_poll_at = 0.0
    while True:
        interactive = polling_lease.active()
        if not once and not interactive:
            try:
                if client.interactive():
                    polling_lease.touch()
                    interactive = True
            except Exception:
                pass
        if once or interactive or time.monotonic() >= next_full_poll_at:
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
                if once:
                    return 1
            next_full_poll_at = time.monotonic() + poll_interval
        if once:
            return 0
        wait_seconds = min(
            INTERACTIVE_POLL_INTERVAL_SECONDS,
            max(0.1, next_full_poll_at - time.monotonic()),
        )
        polling_lease.wait(wait_seconds)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the PhotosByElie background Mac connector.")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="Poll once and exit.")
    mode.add_argument(
        "--status",
        action="store_true",
        help="Verify config and installed runtime locally, print redacted JSON, and exit without network access.",
    )
    parser.add_argument(
        "--action-id",
        default="",
        help="Wake and execute one durable action instead of draining the queue.",
    )
    args = parser.parse_args()
    if (
        os.environ.get("PBE_ON_DEMAND_OWNER_CONNECTOR") == "1"
        and not args.once
        and not args.status
    ):
        raise SystemExit("On-demand Owner connector launches must use --once.")
    if args.action_id and not args.once:
        raise SystemExit("--action-id requires --once.")
    if (
        not args.once
        and not args.status
        and not args.action_id
        and not LEGACY_CONNECTOR_DAEMON_ENABLED
    ):
        print(
            "The always-on Owner connector daemon is retired. Use signed "
            "PhotosByElie Backstage for on-demand work, or set "
            "PBE_ENABLE_LEGACY_CONNECTOR_DAEMON=1 for a deliberate rollback rehearsal.",
            file=sys.stderr,
            flush=True,
        )
        return 64
    # launchd starts with a deliberately small PATH. Keep the normal local
    # toolchain discoverable to child Sidecar and maintenance processes.
    os.environ["PATH"] = _sidecar_helper_env()["PATH"]
    config = load_config(args.config.expanduser())
    if args.status:
        print(
            json.dumps(
                {
                    "ok": True,
                    "schema": "photosbyelie.localOwnerConnectorStatus.v1",
                    "connector": _local_status_payload(config),
                    "dataRootAvailable": config.repo_root.is_dir(),
                    "networkAttempted": False,
                },
                sort_keys=True,
            )
        )
        return 0
    if args.action_id:
        return _run_connector(config, once=True, action_id=args.action_id)
    with _connector_process_lock(config) as acquired:
        if not acquired:
            return 0
        return _run_connector(config, once=args.once)


if __name__ == "__main__":
    raise SystemExit(main())
