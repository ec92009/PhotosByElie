import plistlib
import subprocess
import tempfile
import unittest
from datetime import date
from pathlib import Path

from unittest.mock import patch

from scripts import local_server
from scripts.local_server import _bump_visible_version, _next_visible_version


class VisibleVersionBumpTests(unittest.TestCase):
    def test_uses_the_shared_calendar_version_epoch(self):
        self.assertEqual(_next_visible_version("217.2", date(2026, 8, 7)), "219.0")

    def test_updates_root_and_isolated_concept_version_surfaces(self):
        with tempfile.TemporaryDirectory() as directory:
            repo_root = Path(directory)
            (repo_root / "landing-concept").mkdir()
            (repo_root / "VERSION").write_text("999.1\n", encoding="utf-8")
            (repo_root / "README.md").write_text(
                "Current visible version: `v999.1`\n",
                encoding="utf-8",
            )
            (repo_root / "index.html").write_text(
                '<a href="gallery.html?gallery=france&amp;v=143.4">Gallery</a>'
                '<script src="site.js?v=999.1"></script><b>v999.1</b>',
                encoding="utf-8",
            )
            (repo_root / "landing-concept" / "index.html").write_text(
                '<a href="../gallery.html?v=143.4">Gallery</a><i>v143.4</i>',
                encoding="utf-8",
            )

            old_version, new_version, changed = _bump_visible_version(repo_root)

            self.assertEqual(old_version, "999.1")
            self.assertEqual(new_version, "999.2")
            self.assertIn("landing-concept/index.html", changed)
            self.assertNotIn("143.4", (repo_root / "index.html").read_text(encoding="utf-8"))
            self.assertNotIn(
                "143.4",
                (repo_root / "landing-concept" / "index.html").read_text(encoding="utf-8"),
            )
            self.assertIn("v999.2", (repo_root / "index.html").read_text(encoding="utf-8"))


class PhotosBridgeReleaseGuardTests(unittest.TestCase):
    @staticmethod
    def write_bundle_info(app: Path, identifier: str, version: str, build: str) -> None:
        info = app / "Contents" / "Info.plist"
        info.parent.mkdir(parents=True, exist_ok=True)
        with info.open("wb") as handle:
            plistlib.dump(
                {
                    "CFBundleIdentifier": identifier,
                    "CFBundleShortVersionString": version,
                    "CFBundleVersion": build,
                },
                handle,
            )

    def exercise_guard(self, bridge_version: str, bridge_build: str) -> int:
        with tempfile.TemporaryDirectory() as directory:
            repo_root = Path(directory)
            bridge_app = repo_root / "PhotosByElie Photos Bridge.app"
            backstage_app = repo_root / "PhotosByElie Backstage.app"
            executable = bridge_app / "Contents" / "MacOS" / "PhotosByElie Photos Bridge"
            fingerprint = bridge_app / "Contents" / "Resources" / "BridgeSource.sha256"
            source = repo_root / local_server.APPLE_PHOTOS_BRIDGE
            installer = repo_root / local_server.APPLE_PHOTOS_BRIDGE_APP_INSTALLER
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text("connector bridge source", encoding="utf-8")
            installer.write_text("#!/bin/zsh\n", encoding="utf-8")
            executable.parent.mkdir(parents=True, exist_ok=True)
            executable.write_text("binary", encoding="utf-8")
            fingerprint.parent.mkdir(parents=True, exist_ok=True)
            fingerprint.write_text("different", encoding="utf-8")
            self.write_bundle_info(
                bridge_app,
                "com.photosbyelie.photos-bridge",
                bridge_version,
                bridge_build,
            )
            self.write_bundle_info(backstage_app, "com.photosbyelie.backstage", "226.0", "88")

            with patch.object(local_server, "CONNECTOR_RUNTIME_ROOT", repo_root), \
                 patch.object(local_server, "APPLE_PHOTOS_BRIDGE_APP", bridge_app), \
                 patch.object(local_server, "BACKSTAGE_APP", backstage_app), \
                 patch.object(local_server, "APPLE_PHOTOS_BRIDGE_APP_EXECUTABLE", executable), \
                 patch.object(local_server, "APPLE_PHOTOS_BRIDGE_APP_SOURCE_FINGERPRINT", fingerprint), \
                 patch.object(local_server.subprocess, "run") as install:
                install.return_value = subprocess.CompletedProcess([], 0, "", "")
                local_server._ensure_apple_photos_bridge_app(repo_root)

            return install.call_count

    def test_matching_release_is_not_rebuilt_for_a_stale_fingerprint(self):
        self.assertEqual(self.exercise_guard("226.0", "88"), 0)

    def test_older_release_is_rebuilt(self):
        self.assertEqual(self.exercise_guard("141.10", "1"), 1)


if __name__ == "__main__":
    unittest.main()
