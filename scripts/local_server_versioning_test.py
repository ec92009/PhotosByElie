import os
import subprocess
import sys
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

    def test_launch_at_login_connector_distribution_is_retired(self):
        root = Path(__file__).resolve().parents[1]
        retired_paths = (
            root / "scripts" / "install_new_owner_connector.zsh",
            root / "scripts" / "build_new_owner_connector_package.zsh",
            root / "scripts" / "new_owner_connector_launch_agent.plist.in",
            root / "assets" / "connector-package" / "README.txt",
            root / "assets" / "connector-package" / "Install PhotosByElie Connector.command",
        )
        self.assertTrue(all(not path.exists() for path in retired_paths))

        scheduled_tasks = (root / "scripts" / "install_sidecar_scheduled_tasks.zsh").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("PhotosByElie Photos Bridge.app", scheduled_tasks)

    def test_retired_browser_owner_launcher_fails_closed_without_rollback_opt_in(self):
        root = Path(__file__).resolve().parents[1]
        installer_path = root / "scripts" / "install_owner_dock_app.zsh"
        launcher_path = root / "scripts" / "open_owner_main.py"
        installer = installer_path.read_text(encoding="utf-8")
        launcher = launcher_path.read_text(encoding="utf-8")

        for source in (installer, launcher):
            self.assertIn("PBE_ENABLE_LEGACY_BROWSER_OWNER", source)
        self.assertIn("export PBE_ENABLE_LEGACY_BROWSER_OWNER=1", installer)
        self.assertIn("exit 64", installer)
        self.assertIn("return 64", launcher)

        with tempfile.TemporaryDirectory() as directory:
            temporary_root = Path(directory)
            app_path = temporary_root / "PhotosByElie Owner.app"
            env = {**os.environ, "HOME": directory}
            env.pop("PBE_ENABLE_LEGACY_BROWSER_OWNER", None)

            install_result = subprocess.run(
                ["/bin/zsh", str(installer_path), "--app-dir", str(app_path)],
                cwd=root,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(install_result.returncode, 64)
            self.assertIn("Legacy browser Owner launcher installation is disabled", install_result.stderr)
            self.assertFalse(app_path.exists())

            launch_result = subprocess.run(
                [sys.executable, str(launcher_path)],
                cwd=root,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(launch_result.returncode, 64)
            self.assertIn("Legacy browser Owner launch is disabled", launch_result.stderr)
            self.assertFalse((temporary_root / "Library" / "Logs" / "PhotosByElie").exists())


if __name__ == "__main__":
    unittest.main()
