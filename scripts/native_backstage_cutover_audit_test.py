"""Tests for the read-only native Backstage cutover inventory."""

from __future__ import annotations

import plistlib
import tempfile
import unittest
from pathlib import Path

from scripts.native_backstage_cutover_audit import (
    BACKSTAGE_APP,
    BRIDGE_APP,
    LEGACY_APPS,
    REQUIRED_LAUNCH_AGENT,
    collect_inventory,
)


def _make_app(home: Path, name: str, identifier: str, *, headless: bool = False) -> None:
    contents = home / "Applications" / name / "Contents"
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
            _make_app(home, BACKSTAGE_APP, "com.photosbyelie.backstage")
            agents = home / "Library" / "LaunchAgents"
            agents.mkdir(parents=True)
            (agents / REQUIRED_LAUNCH_AGENT).write_text("test", encoding="utf-8")

            payload = collect_inventory(home, live_probes=False)

            self.assertTrue(payload["ok"])
            self.assertTrue(payload["checks"]["legacyOperatorAppsAbsent"])
            self.assertTrue(payload["checks"]["photosBridgeAbsent"])
            self.assertTrue(payload["checks"]["retiredRuntimeArtifactsAbsent"])

    def test_visible_legacy_app_fails_inventory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            _make_app(home, BACKSTAGE_APP, "com.photosbyelie.backstage")
            _make_app(home, LEGACY_APPS[0], "com.photosbyelie.owner")
            agents = home / "Library" / "LaunchAgents"
            agents.mkdir(parents=True)
            (agents / REQUIRED_LAUNCH_AGENT).write_text("test", encoding="utf-8")

            payload = collect_inventory(home, live_probes=False)

            self.assertFalse(payload["ok"])
            self.assertFalse(payload["checks"]["legacyOperatorAppsAbsent"])

    def test_live_bridge_and_packaged_source_fail_inventory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            _make_app(home, BACKSTAGE_APP, "com.photosbyelie.backstage")
            _make_app(home, BRIDGE_APP, "com.photosbyelie.photos-bridge", headless=True)
            runtime_scripts = (
                home
                / "Applications"
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
            agents = home / "Library" / "LaunchAgents"
            agents.mkdir(parents=True)
            (agents / REQUIRED_LAUNCH_AGENT).write_text("test", encoding="utf-8")

            payload = collect_inventory(home, live_probes=False)

            self.assertFalse(payload["ok"])
            self.assertFalse(payload["checks"]["photosBridgeAbsent"])
            self.assertFalse(payload["checks"]["retiredRuntimeArtifactsAbsent"])


if __name__ == "__main__":
    unittest.main()
