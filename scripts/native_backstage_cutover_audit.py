#!/usr/bin/env python3
"""Audit the native-only PhotosByElie operator cutover without mutating state."""

from __future__ import annotations

import argparse
import json
import plistlib
import subprocess
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


BACKSTAGE_APP = "PhotosByElie Backstage.app"
BRIDGE_APP = "PhotosByElie Photos Bridge.app"
LEGACY_APPS = ("PhotosByElie Owner.app", "PhotosByElie Sidecar.app")
REQUIRED_LAUNCH_AGENT = "com.photosbyelie.owner-connector.plist"


def _app_info(app: Path) -> dict[str, Any]:
    """Return the small identity subset needed by the retirement audit."""
    plist = app / "Contents" / "Info.plist"
    if not plist.is_file():
        return {"installed": app.is_dir(), "validBundle": False}
    with plist.open("rb") as handle:
        info = plistlib.load(handle)
    return {
        "installed": True,
        "validBundle": True,
        "bundleIdentifier": info.get("CFBundleIdentifier"),
        "headless": bool(info.get("LSUIElement", False)),
    }


def _http_probe(url: str) -> dict[str, Any]:
    """Fetch one local URL and retain only status and compact body evidence."""
    try:
        with urllib.request.urlopen(url, timeout=2) as response:
            body = response.read(1024).decode("utf-8", errors="replace")
            return {"reachable": True, "status": response.status, "body": body}
    except urllib.error.HTTPError as error:
        body = error.read(1024).decode("utf-8", errors="replace")
        return {"reachable": True, "status": error.code, "body": body}
    except (OSError, urllib.error.URLError) as error:
        return {"reachable": False, "status": None, "error": str(error)}


def _listening_pids(port: int) -> list[int]:
    """Return processes listening on one TCP port."""
    result = subprocess.run(
        ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
        check=False,
        capture_output=True,
        text=True,
    )
    return sorted(
        {
            int(line)
            for line in result.stdout.splitlines()
            if line.strip().isdigit()
        }
    )


def collect_inventory(
    home: Path,
    *,
    live_probes: bool = True,
    connector_url: str = "http://127.0.0.1:8766/photosbyelie/connector-status",
    legacy_route_url: str = "http://127.0.0.1:8766/photosbyelie/open-sidecar",
) -> dict[str, Any]:
    """Collect the operator-app, service and compatibility-route inventory."""
    applications = home / "Applications"
    launch_agents = home / "Library" / "LaunchAgents"
    app_state = {
        BACKSTAGE_APP: _app_info(applications / BACKSTAGE_APP),
        BRIDGE_APP: _app_info(applications / BRIDGE_APP),
        **{
            name: _app_info(applications / name)
            for name in LEGACY_APPS
        },
    }
    launch_agent_names = sorted(
        path.name
        for path in launch_agents.glob("*photosbyelie*.plist")
        if path.is_file()
    )
    checks = {
        "backstageInstalled": app_state[BACKSTAGE_APP]["installed"],
        "photosBridgeInstalled": app_state[BRIDGE_APP]["installed"],
        "photosBridgeHeadless": app_state[BRIDGE_APP].get("headless") is True,
        "legacyOperatorAppsAbsent": not any(
            app_state[name]["installed"] for name in LEGACY_APPS
        ),
        "onlyRequiredLaunchAgent": launch_agent_names == [REQUIRED_LAUNCH_AGENT],
    }
    services: dict[str, Any] = {"liveProbes": live_probes}
    if live_probes:
        services["connector"] = _http_probe(connector_url)
        services["legacyRoute"] = _http_probe(legacy_route_url)
        services["sidecarListenerPids"] = _listening_pids(8011)
        try:
            connector_payload = json.loads(services["connector"].get("body", ""))
        except (TypeError, json.JSONDecodeError):
            connector_payload = {}
        checks.update(
            {
                "connectorHealthy": (
                    services["connector"].get("status") == 200
                    and connector_payload.get("ok") is True
                ),
                "legacyRouteDisabled": services["legacyRoute"].get("status") == 410,
                "sidecarListenerAbsent": not services["sidecarListenerPids"],
            }
        )
    return {
        "schema": "photosbyelie.native-backstage-cutover-audit.v1",
        "home": str(home),
        "applications": app_state,
        "launchAgents": launch_agent_names,
        "services": services,
        "checks": checks,
        "ok": all(checks.values()),
    }


def main() -> int:
    """Run the audit and print machine-readable evidence."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=Path.home())
    parser.add_argument("--skip-live-probes", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    payload = collect_inventory(args.home, live_probes=not args.skip_live_probes)
    rendered = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
