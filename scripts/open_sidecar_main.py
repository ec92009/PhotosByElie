#!/usr/bin/env python3
"""Launch the local Photos By Elie Sidecar helper and open Sidecar in Safari."""

from __future__ import annotations

import json
import os
import signal
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
HELPER = REPO_ROOT / "scripts" / "sidecar_server.py"
LOG_DIR = Path.home() / "Library" / "Logs" / "PhotosByElie"
LOG_PATH = LOG_DIR / "sidecar-helper.log"
PORT_START = 8011
PORT_LIMIT = 8111
SIDECAR_PATH = os.environ.get("PBE_SIDECAR_PATH", "sidecar.html")
PATH_PREFIXES = (
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
)


server: subprocess.Popen[str] | None = None


def notify(title: str, message: str) -> None:
    script = f"display alert {json.dumps(title)} message {json.dumps(message)} as warning"
    subprocess.run(["osascript", "-e", script], check=False)


def helper_env() -> dict[str, str]:
    env = {**os.environ, "PYTHONUNBUFFERED": "1"}
    current_path = env.get("PATH", "")
    parts = [part for part in (*PATH_PREFIXES, *current_path.split(os.pathsep)) if part]
    env["PATH"] = os.pathsep.join(dict.fromkeys(part for part in parts if part))
    return env


def helper_ready(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/__sidecar/version", timeout=0.5) as response:
            return 200 <= response.status < 500
    except (OSError, urllib.error.URLError):
        return False


def process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def sidecar_helper_pids() -> set[int]:
    pids: set[int] = set()
    helper_path = str(HELPER)
    result = subprocess.run(["ps", "-axo", "pid=,command="], capture_output=True, text=True, check=False)
    for line in result.stdout.splitlines():
        row = line.strip()
        if not row:
            continue
        try:
            pid_text, command = row.split(maxsplit=1)
            pid = int(pid_text)
        except ValueError:
            continue
        if pid != os.getpid() and helper_path in command:
            pids.add(pid)
    return pids


def terminate_pids(pids: set[int], log) -> None:
    pids.discard(os.getpid())
    if not pids:
        return
    ordered = sorted(pids)
    log.write(f"Clean start: stopping stale Sidecar helpers: {', '.join(str(pid) for pid in ordered)}\n")
    log.flush()
    for pid in ordered:
        try:
            os.kill(pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            continue
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        if not any(process_alive(pid) for pid in ordered):
            return
        time.sleep(0.1)
    for pid in ordered:
        if process_alive(pid):
            try:
                os.kill(pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                continue


def launch_helper(port: int, log) -> subprocess.Popen[str]:
    env = helper_env()
    python = shutil.which("python3", path=env["PATH"]) or sys.executable
    return subprocess.Popen(
        [python, str(HELPER), str(port)],
        cwd=REPO_ROOT,
        stdout=log,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
        start_new_session=True,
    )


def open_safari(port: int) -> None:
    url = f"http://localhost:{port}/{SIDECAR_PATH.lstrip('/')}"
    result = subprocess.run(["open", "-a", "Safari", url], check=False)
    if result.returncode != 0:
        subprocess.run(["open", url], check=False)


def terminate_server(*_args) -> None:
    if server and server.poll() is None:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
    raise SystemExit(0)


def main() -> int:
    global server
    if not HELPER.exists():
        notify("Photos By Elie Sidecar", f"Missing helper script: {HELPER}")
        return 1

    signal.signal(signal.SIGTERM, terminate_server)
    signal.signal(signal.SIGINT, terminate_server)

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as log:
        log.write(f"\n--- Photos By Elie Sidecar launch {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n")
        terminate_pids(sidecar_helper_pids(), log)
        for port in range(PORT_START, PORT_LIMIT):
            server = launch_helper(port, log)
            for _attempt in range(40):
                if server.poll() is not None:
                    break
                if helper_ready(port):
                    log.write(f"Opened Sidecar at http://localhost:{port}/sidecar.html\n")
                    log.flush()
                    open_safari(port)
                    return 0
                time.sleep(0.25)
            if server.poll() is None:
                server.terminate()
                try:
                    server.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    server.kill()

        notify("Photos By Elie Sidecar", "Could not start the local helper on ports 8011-8110.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
