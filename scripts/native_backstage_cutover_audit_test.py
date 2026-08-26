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
    version: str = "239.1",
    build: str = "220",
) -> None:
    contents = applications / name / "Contents"
    contents.mkdir(parents=True)
    with (contents / "Info.plist").open("wb") as handle:
        plistlib.dump(
            {
                "CFBundleIdentifier": identifier,
                "CFBundleShortVersionString": version,
                "CFBundleVersion": build,
                **({"LSUIElement": True} if headless else {}),
            },
            handle,
        )


class NativeBackstageCutoverAuditTests(unittest.TestCase):
    def test_current_home_can_find_a_system_installed_backstage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory) / "home"
            system_applications = Path(directory) / "Applications"
            _make_app(system_applications, BACKSTAGE_APP, "com.photosbyelie.backstage")

            payload = collect_inventory(
                home,
                applications_directory=system_applications,
                live_probes=False,
            )

            self.assertTrue(payload["checks"]["backstageInstalled"])

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

    def test_stale_verified_installer_stage_is_reported_read_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            applications = home / "System Applications"
            _make_app(applications, BACKSTAGE_APP, "com.photosbyelie.backstage")
            staging = (
                applications
                / ".PhotosByElie Backstage.install-11111111-1111-1111-1111-111111111111.app"
            )
            _make_app(
                applications,
                staging.name,
                "com.photosbyelie.backstage",
                version="238.15",
                build="218",
            )
            staging.touch()
            with patch(
                "scripts.native_backstage_cutover_audit._codesign_valid",
                return_value=True,
            ):
                payload = collect_inventory(
                    home,
                    applications_directory=applications,
                    live_probes=False,
                    now=staging.stat().st_mtime + 3_600,
                )

            self.assertFalse(payload["ok"])
            self.assertFalse(payload["checks"]["installerStagingAbsent"])
            self.assertEqual(
                payload["installerStagingBundles"][0]["state"],
                "staleVerified",
            )
            self.assertTrue(staging.is_dir())

    def test_recent_and_wrong_identity_installer_stages_are_retained(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            applications = home / "System Applications"
            _make_app(applications, BACKSTAGE_APP, "com.photosbyelie.backstage")
            active = (
                applications
                / ".PhotosByElie Backstage.install-22222222-2222-2222-2222-222222222222.app"
            )
            unsafe = (
                applications
                / ".PhotosByElie Backstage.install-33333333-3333-3333-3333-333333333333.app"
            )
            _make_app(applications, active.name, "com.photosbyelie.backstage")
            _make_app(applications, unsafe.name, "com.example.not-backstage")
            with patch(
                "scripts.native_backstage_cutover_audit._codesign_valid",
                return_value=True,
            ):
                payload = collect_inventory(
                    home,
                    applications_directory=applications,
                    live_probes=False,
                    now=active.stat().st_mtime + 60,
                )

            states = {
                Path(item["path"]).name: item["state"]
                for item in payload["installerStagingBundles"]
            }
            self.assertEqual(states[active.name], "active")
            self.assertEqual(states[unsafe.name], "unsafe")
            self.assertTrue(active.is_dir())
            self.assertTrue(unsafe.is_dir())


if __name__ == "__main__":
    unittest.main()
