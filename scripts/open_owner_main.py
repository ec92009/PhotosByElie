#!/usr/bin/env python3
"""Launch the local Photos By Elie Owner helper and open Owner in Safari."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
HELPER = REPO_ROOT / "scripts" / "local_server.py"
LOG_DIR = Path.home() / "Library" / "Logs" / "PhotosByElie"
LOG_PATH = LOG_DIR / "owner-helper.log"
PORT_START = 8000
PORT_LIMIT = 8100


server: subprocess.Popen[str] | None = None


def notify(title: str, message: str) -> None:
    script = f'display alert {title!r} message {message!r} as warning'
    subprocess.run(["osascript", "-e", script], check=False)


def helper_ready(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/__photosbyelie/owner-session", timeout=0.5) as response:
            return 200 <= response.status < 500
    except (OSError, urllib.error.URLError):
        return False


def launch_helper(port: int, log) -> subprocess.Popen[str]:
    env = {**os.environ, "PYTHONUNBUFFERED": "1"}
    return subprocess.Popen(
        [sys.executable, str(HELPER), str(port)],
        cwd=REPO_ROOT,
        stdout=log,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
    )


def open_safari(port: int) -> None:
    url = f"http://localhost:{port}/owner.html"
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
        for port in range(PORT_START, PORT_LIMIT):
            if helper_ready(port):
                log.write(f"Opened existing Owner helper at http://localhost:{port}/owner.html\n")
                log.flush()
                open_safari(port)
                return 0

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
