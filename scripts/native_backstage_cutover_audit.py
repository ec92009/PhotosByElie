#!/usr/bin/env python3
"""Audit the native-only PhotosByElie operator cutover without mutating state."""

from __future__ import annotations

import argparse
import json
import plistlib
import re
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


BACKSTAGE_APP = "PhotosByElie Backstage.app"
BRIDGE_APP = "PhotosByElie Photos Bridge.app"
RETIRED_RUNTIME_FILES = (
    "scripts/apple_photos_bridge.swift",
    "scripts/install_sidecar_photos_bridge_app.zsh",
)
LEGACY_APPS = ("PhotosByElie Owner.app", "PhotosByElie Sidecar.app")
REQUIRED_LAUNCH_AGENT = "com.photosbyelie.owner-connector.plist"
INSTALLER_STAGING_PATTERN = re.compile(
    r"^\.PhotosByElie Backstage\.install-"
    r"[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-"
    r"[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\.app$"
)
INSTALLER_STALE_SECONDS = 15 * 60


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
        "version": info.get("CFBundleShortVersionString"),
        "build": info.get("CFBundleVersion"),
        "headless": bool(info.get("LSUIElement", False)),
    }


def _codesign_valid(app: Path) -> bool:
    """Verify one app without printing signer details or changing the bundle."""
    result = subprocess.run(
        ["/usr/bin/codesign", "--verify", "--deep", "--strict", str(app)],
        check=False,
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


def _installer_staging_info(app: Path, *, now: float) -> dict[str, Any]:
    """Classify one exact installer-shaped bundle without removing it."""
    info = _app_info(app)
    age_seconds = max(0, int(now - app.stat().st_mtime))
    identifier = info.get("bundleIdentifier")
    signature_valid = bool(info.get("validBundle")) and _codesign_valid(app)
    if identifier != "com.photosbyelie.backstage" or not signature_valid:
        state = "unsafe"
        detail = "Retained: bundle identity or signature is not verified Backstage."
    elif age_seconds < INSTALLER_STALE_SECONDS:
        state = "active"
        detail = "Retained: recent verified staging may belong to an active install."
    else:
        state = "staleVerified"
        detail = "Verified installer-owned stale staging; reconcile before another install."
    return {
        "path": str(app),
        "ageSeconds": age_seconds,
        "bundleIdentifier": identifier,
        "version": info.get("version"),
        "build": info.get("build"),
        "signatureValid": signature_valid,
        "state": state,
        "detail": detail,
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
    applications_directory: Path = Path("/Applications"),
    live_probes: bool = True,
    connector_url: str = "http://127.0.0.1:8766/photosbyelie/connector-status",
    legacy_route_url: str = "http://127.0.0.1:8766/photosbyelie/open-sidecar",
    now: float | None = None,
) -> dict[str, Any]:
    """Collect the operator-app, service and compatibility-route inventory."""
    legacy_applications = home / "Applications"
    launch_agents = home / "Library" / "LaunchAgents"
    app_state = {
        BACKSTAGE_APP: _app_info(applications_directory / BACKSTAGE_APP),
        BRIDGE_APP: _app_info(legacy_applications / BRIDGE_APP),
        **{
            name: _app_info(legacy_applications / name)
            for name in LEGACY_APPS
        },
    }
    launch_agent_names = sorted(
        path.name
        for path in launch_agents.glob("*photosbyelie*.plist")
        if path.is_file()
    )
    inventory_time = time.time() if now is None else now
    installer_staging = [
        _installer_staging_info(path, now=inventory_time)
        for path in sorted(applications_directory.iterdir())
        if INSTALLER_STAGING_PATTERN.fullmatch(path.name)
    ] if applications_directory.is_dir() else []

    runtime_roots = [
        applications_directory
        / BACKSTAGE_APP
        / "Contents"
        / "Resources"
        / "OwnerRuntime",
    ]
    connector_config = home / ".config" / "photosbyelie" / "connector.json"
    if connector_config.is_file():
        try:
            connector_payload = json.loads(connector_config.read_text(encoding="utf-8"))
            runtime_root = connector_payload.get("runtimeRoot")
            if isinstance(runtime_root, str) and runtime_root:
                runtime_roots.append(Path(runtime_root).expanduser())
        except (OSError, TypeError, json.JSONDecodeError):
            pass
    retired_runtime_artifacts = sorted(
        str(root / relative)
        for root in runtime_roots
        for relative in RETIRED_RUNTIME_FILES
        if (root / relative).exists()
    )
    checks = {
        "backstageInstalled": app_state[BACKSTAGE_APP]["installed"],
        "photosBridgeAbsent": not app_state[BRIDGE_APP]["installed"],
        "retiredRuntimeArtifactsAbsent": not retired_runtime_artifacts,
        "legacyOperatorAppsAbsent": not any(
            app_state[name]["installed"] for name in LEGACY_APPS
        ),
        "ownerLaunchAgentAbsent": REQUIRED_LAUNCH_AGENT not in launch_agent_names,
        "installerStagingAbsent": not installer_staging,
    }
    services: dict[str, Any] = {"liveProbes": live_probes}
    if live_probes:
        services["connector"] = _http_probe(connector_url)
        services["legacyRoute"] = _http_probe(legacy_route_url)
        services["sidecarListenerPids"] = _listening_pids(8011)
        checks.update(
            {
                "legacyConnectorAbsent": services["connector"].get("status") != 200,
                "legacyRouteDisabled": services["legacyRoute"].get("status") in {None, 410},
                "sidecarListenerAbsent": not services["sidecarListenerPids"],
            }
        )
    return {
        "schema": "photosbyelie.native-backstage-cutover-audit.v3",
        "home": str(home),
        "applicationsDirectory": str(applications_directory),
        "legacyApplicationsDirectory": str(legacy_applications),
        "applications": app_state,
        "launchAgents": launch_agent_names,
        "services": services,
        "retiredRuntimeArtifacts": retired_runtime_artifacts,
        "installerStagingBundles": installer_staging,
        "checks": checks,
        "ok": all(checks.values()),
    }


def main() -> int:
    """Run the audit and print machine-readable evidence."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=Path.home())
    parser.add_argument(
        "--applications-directory",
        type=Path,
        default=Path("/Applications"),
        help="Canonical system Applications directory containing Backstage.",
    )
    parser.add_argument("--skip-live-probes", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    payload = collect_inventory(
        args.home,
        applications_directory=args.applications_directory,
        live_probes=not args.skip_live_probes,
    )
    rendered = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
