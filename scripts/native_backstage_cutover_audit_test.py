"""Tests for the read-only native Backstage cutover inventory."""

from __future__ import annotations

import plistlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.native_backstage_cutover_audit import (
    BACKSTAGE_APP,
    BRIDGE_APP,
    LEGACY_APPS,
    REQUIRED_LAUNCH_AGENT,
    collect_inventory,
)


def _make_app(
    applications: Path,
    name: str,
    identifier: str,
    *,
    headless: bool = False,
) -> None:
    contents = applications / name / "Contents"
    contents.mkdir(parents=True)
    with (contents / "Info.plist").open("wb") as handle:
        plistlib.dump(
            {
                "CFBundleIdentifier": identifier,
                **({"LSUIElement": True} if headless else {}),
            },
            handle,
        )


class NativeBackstageCutoverAuditTests(unittest.TestCase):
    def test_clean_native_only_inventory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            applications = home / "System Applications"
            _make_app(applications, BACKSTAGE_APP, "com.photosbyelie.backstage")

            payload = collect_inventory(
                home,
                applications_directory=applications,
                live_probes=False,
            )

            self.assertTrue(payload["ok"])
            self.assertEqual(payload["applicationsDirectory"], str(applications))
            self.assertTrue(payload["checks"]["legacyOperatorAppsAbsent"])
            self.assertTrue(payload["checks"]["photosBridgeAbsent"])
            self.assertTrue(payload["checks"]["retiredRuntimeArtifactsAbsent"])
            self.assertTrue(payload["checks"]["ownerLaunchAgentAbsent"])

    def test_legacy_owner_launchagent_fails_inventory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            applications = home / "System Applications"
            _make_app(applications, BACKSTAGE_APP, "com.photosbyelie.backstage")
            agents = home / "Library" / "LaunchAgents"
            agents.mkdir(parents=True)
            (agents / REQUIRED_LAUNCH_AGENT).write_text("rollback only", encoding="utf-8")

            payload = collect_inventory(
                home,
                applications_directory=applications,
                live_probes=False,
            )

            self.assertFalse(payload["ok"])
            self.assertFalse(payload["checks"]["ownerLaunchAgentAbsent"])

    def test_on_demand_live_boundary_accepts_closed_legacy_ports(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            applications = home / "System Applications"
            _make_app(applications, BACKSTAGE_APP, "com.photosbyelie.backstage")
            with (
                patch(
                    "scripts.native_backstage_cutover_audit._http_probe",
                    side_effect=[
                        {"reachable": False, "status": None},
                        {"reachable": True, "status": 410},
                    ],
                ),
                patch("scripts.native_backstage_cutover_audit._listening_pids", return_value=[]),
            ):
                payload = collect_inventory(
                    home,
                    applications_directory=applications,
                    live_probes=True,
                )

            self.assertTrue(payload["ok"])
            self.assertTrue(payload["checks"]["legacyConnectorAbsent"])
            self.assertTrue(payload["checks"]["legacyRouteDisabled"])

    def test_visible_legacy_app_fails_inventory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            applications = home / "System Applications"
            _make_app(applications, BACKSTAGE_APP, "com.photosbyelie.backstage")
            _make_app(
                home / "Applications",
                LEGACY_APPS[0],
                "com.photosbyelie.owner",
            )

            payload = collect_inventory(
                home,
                applications_directory=applications,
                live_probes=False,
            )

            self.assertFalse(payload["ok"])
            self.assertFalse(payload["checks"]["legacyOperatorAppsAbsent"])

    def test_live_bridge_and_packaged_source_fail_inventory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            applications = home / "System Applications"
            _make_app(applications, BACKSTAGE_APP, "com.photosbyelie.backstage")
            _make_app(
                home / "Applications",
                BRIDGE_APP,
                "com.photosbyelie.photos-bridge",
                headless=True,
            )
            runtime_scripts = (
                applications
                / BACKSTAGE_APP
                / "Contents"
                / "Resources"
                / "OwnerRuntime"
                / "scripts"
            )
            runtime_scripts.mkdir(parents=True)
            (runtime_scripts / "apple_photos_bridge.swift").write_text(
                "retired\n",
                encoding="utf-8",
            )
            payload = collect_inventory(
                home,
                applications_directory=applications,
                live_probes=False,
            )

            self.assertFalse(payload["ok"])
            self.assertFalse(payload["checks"]["photosBridgeAbsent"])
            self.assertFalse(payload["checks"]["retiredRuntimeArtifactsAbsent"])

    def test_user_applications_backstage_is_not_canonical(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            applications = home / "System Applications"
            _make_app(
                home / "Applications",
                BACKSTAGE_APP,
                "com.photosbyelie.backstage",
            )

            payload = collect_inventory(
                home,
                applications_directory=applications,
                live_probes=False,
            )

            self.assertFalse(payload["ok"])
            self.assertFalse(payload["checks"]["backstageInstalled"])


if __name__ == "__main__":
    unittest.main()
