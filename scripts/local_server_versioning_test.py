import tempfile
import unittest
from datetime import date
from pathlib import Path

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


class RetiredApplePhotosImportTests(unittest.TestCase):
    def test_local_server_has_no_standalone_bridge_lifecycle(self):
        source = Path(__file__).with_name("local_server.py").read_text(encoding="utf-8")

        self.assertIn("_apple_photos_backstage_required", source)
        self.assertNotIn("PhotosByElie Photos Bridge.app", source)
        self.assertNotIn("_ensure_apple_photos_bridge_app", source)
        self.assertNotIn("_run_apple_photos_bridge", source)
        self.assertNotIn("apple_photos_bridge.swift", source)

    def test_normal_installers_do_not_package_or_launch_standalone_bridge(self):
        root = Path(__file__).resolve().parents[1]
        sources = {
            "connector_installer": (
                root / "scripts" / "install_new_owner_connector.zsh"
            ).read_text(encoding="utf-8"),
            "connector_package_builder": (
                root / "scripts" / "build_new_owner_connector_package.zsh"
            ).read_text(encoding="utf-8"),
            "connector_package_command": (
                root
                / "assets"
                / "connector-package"
                / "Install PhotosByElie Connector.command"
            ).read_text(encoding="utf-8"),
            "scheduled_tasks": (
                root / "scripts" / "install_sidecar_scheduled_tasks.zsh"
            ).read_text(encoding="utf-8"),
        }

        for name, source in sources.items():
            with self.subTest(name=name):
                self.assertNotIn("PBE_SKIP_BRIDGE_BUILD", source)
                self.assertNotIn("install_sidecar_photos_bridge_app.zsh", source)
                self.assertNotIn("PhotosByElie Photos Bridge.app", source)

        package_readme = (
            root / "assets" / "connector-package" / "README.txt"
        ).read_text(encoding="utf-8")
        self.assertIn("does not install a second Photos helper", package_readme)


if __name__ == "__main__":
    unittest.main()
