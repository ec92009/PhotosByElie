#!/usr/bin/env python3
"""Launch the local Photos By Elie Owner helper and open Owner in Safari."""

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
HELPER = REPO_ROOT / "scripts" / "local_server.py"
APPLE_PHOTOS_BRIDGE = REPO_ROOT / "scripts" / "apple_photos_bridge.swift"
LOG_DIR = Path.home() / "Library" / "Logs" / "PhotosByElie"
LOG_PATH = LOG_DIR / "owner-helper.log"
PORT_START = 8000
PORT_LIMIT = 8100
OWNER_PATH = os.environ.get("PBE_OWNER_PATH", "owner.html?tab=imports")
PREFER_OWN_HELPER = os.environ.get("PBE_OWNER_PREFER_OWN_HELPER", "").lower() in {"1", "true", "yes"}
CLEAN_START = os.environ.get("PBE_OWNER_CLEAN_START", "1").lower() not in {"0", "false", "no", "off"}
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
    deduped = list(dict.fromkeys(parts))
    env["PATH"] = os.pathsep.join(deduped)
    return env


def helper_ready(port: int) -> bool:
    try:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/__photosbyelie/owner-session",
            timeout=0.5,
        ) as response:
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


def owner_helper_listener_pids() -> set[int]:
    pids: set[int] = set()
    for port in range(PORT_START, PORT_LIMIT):
        if not helper_ready(port):
            continue
        result = subprocess.run(
            ["lsof", f"-tiTCP:{port}", "-sTCP:LISTEN"],
            capture_output=True,
            text=True,
            check=False,
        )
        for line in result.stdout.splitlines():
            try:
                pids.add(int(line.strip()))
            except ValueError:
                continue
    return pids


def owner_helper_command_pids() -> set[int]:
    pids: set[int] = set()
    helper_path = str(HELPER)
    result = subprocess.run(
        ["ps", "-axo", "pid=,command="],
        capture_output=True,
        text=True,
        check=False,
    )
    for line in result.stdout.splitlines():
        row = line.strip()
        if not row:
            continue
        try:
            pid_text, command = row.split(maxsplit=1)
            pid = int(pid_text)
        except ValueError:
            continue
        if pid == os.getpid():
            continue
        if helper_path in command:
            pids.add(pid)
    return pids


def apple_photos_bridge_pids() -> set[int]:
    pids: set[int] = set()
    bridge_path = str(APPLE_PHOTOS_BRIDGE)
    result = subprocess.run(
        ["ps", "-axo", "pid=,command="],
        capture_output=True,
        text=True,
        check=False,
    )
    for line in result.stdout.splitlines():
        row = line.strip()
        if not row:
            continue
        try:
            pid_text, command = row.split(maxsplit=1)
            pid = int(pid_text)
        except ValueError:
            continue
        if pid == os.getpid():
            continue
        if bridge_path in command:
            pids.add(pid)
    return pids


def terminate_pids(pids: set[int], log, reason: str) -> None:
    pids.discard(os.getpid())
    if not pids:
        return
    ordered = sorted(pids)
    log.write(f"Clean start: stopping {reason}: {', '.join(str(pid) for pid in ordered)}\n")
    log.flush()
    for pid in ordered:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            continue
        except PermissionError as error:
            log.write(f"Clean start: could not terminate pid {pid}: {error}\n")
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        alive = [pid for pid in ordered if process_alive(pid)]
        if not alive:
            return
        time.sleep(0.1)
    for pid in ordered:
        if not process_alive(pid):
            continue
        try:
            os.kill(pid, signal.SIGKILL)
            log.write(f"Clean start: force-killed pid {pid}.\n")
        except ProcessLookupError:
            continue
        except PermissionError as error:
            log.write(f"Clean start: could not force-kill pid {pid}: {error}\n")
    log.flush()


def clean_start(log) -> None:
    helper_pids = owner_helper_listener_pids() | owner_helper_command_pids()
    bridge_pids = apple_photos_bridge_pids()
    terminate_pids(bridge_pids, log, "Apple Photos bridge process")
    terminate_pids(helper_pids, log, "stale Owner helper")


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
    url = f"http://localhost:{port}/{OWNER_PATH.lstrip('/')}"
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
        notify("Photos By Elie Owner", f"Missing helper script: {HELPER}")
        return 1

    signal.signal(signal.SIGTERM, terminate_server)
    signal.signal(signal.SIGINT, terminate_server)

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    with LOG_PATH.open("a", encoding="utf-8") as log:
        log.write(f"\n--- Photos By Elie Owner launch {time.strftime('%Y-%m-%d %H:%M:%S')} ---\n")
        if not PREFER_OWN_HELPER:
            for port in range(PORT_START, PORT_LIMIT):
                if helper_ready(port):
                    log.write(f"Opened existing Owner helper at http://localhost:{port}/owner.html\n")
                    log.flush()
                    open_safari(port)
                    return 0
        else:
            log.write("Dock launcher requested its own helper; skipping existing helper reuse.\n")
            if CLEAN_START:
                clean_start(log)

        for port in range(PORT_START, PORT_LIMIT):
            server = launch_helper(port, log)
            for _attempt in range(40):
                if server.poll() is not None:
                    break
                if helper_ready(port):
                    log.write(f"Opened Owner at http://localhost:{port}/owner.html\n")
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

        notify("Photos By Elie Owner", "Could not start the local helper on ports 8000-8099.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
