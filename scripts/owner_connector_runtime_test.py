import json
from pathlib import Path
import stat
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
MATERIALIZER = REPO_ROOT / "scripts" / "owner_connector_runtime.py"
REQUIRED_FIXTURE_SCRIPTS = {
    "backstage_photos_client.py",
    "fixture_pipeline.py",
    "local_server.py",
    "new_owner_connector.py",
    "owner_connector_runtime.py",
    "pbe_owner_host_tracked_paths.txt",
    "pbe_owner_web_bundle_paths.txt",
    "pbe_owner_session.py",
    "requested_ai_proposal_pass.py",
    "sidecar_server.py",
    "sidecar_state_db.py",
    "waste_basket_gateway.py",
}
FIXTURE_WEB_FILES = {
    "gallery-commands.js",
    "gallery.html",
    "pbe-owner-session.js",
    "photo.html",
    "photos.css",
    "shared.css",
    "styles.css",
}


class OwnerConnectorRuntimeTest(unittest.TestCase):
    @staticmethod
    def _git(source_root: Path, *arguments: str) -> subprocess.CompletedProcess[bytes]:
        return subprocess.run(
            ["git", "-C", str(source_root), *arguments],
            check=True,
            capture_output=True,
        )

    def _make_source_fixture(self, fixture_root: Path) -> Path:
        source_root = fixture_root / "source"
        scripts_root = source_root / "scripts"
        scripts_root.mkdir(parents=True)
        for name in sorted(REQUIRED_FIXTURE_SCRIPTS):
            destination = scripts_root / name
            if name == "pbe_owner_host_tracked_paths.txt":
                destination.write_text(
                    ":(glob)scripts/**/*.py\ngallery.html\ngallery-commands.js\n",
                    encoding="utf-8",
                )
            elif name == "pbe_owner_web_bundle_paths.txt":
                destination.write_text(
                    "\n".join(sorted(FIXTURE_WEB_FILES)) + "\n",
                    encoding="utf-8",
                )
            elif name in {"new_owner_connector.py", "owner_connector_runtime.py"}:
                destination.write_bytes((REPO_ROOT / "scripts" / name).read_bytes())
            else:
                destination.write_text(f'"""Fixture for {name}."""\n', encoding="utf-8")
        (scripts_root / "connector_runtime_test.py").write_text(
            "raise AssertionError('tests must not ship')\n",
            encoding="utf-8",
        )
        for name in sorted(FIXTURE_WEB_FILES):
            (source_root / name).write_text(
                "<!doctype html><title>Fixture</title>\n"
                if name.endswith(".html")
                else "/* fixture */\n",
                encoding="utf-8",
            )
        subprocess.run(["git", "init", "-q", str(source_root)], check=True)
        subprocess.run(["git", "-C", str(source_root), "add", "-A"], check=True)
        subprocess.run(
            [
                "git", "-C", str(source_root),
                "-c", "user.name=Runtime Fixture",
                "-c", "user.email=runtime-fixture@photosbyelie.invalid",
                "commit", "-qm", "fixture runtime",
            ],
            check=True,
        )
        return source_root

    def _run(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(MATERIALIZER), *arguments],
            text=True,
            capture_output=True,
            timeout=20,
            check=False,
        )

    def test_materializes_and_verifies_bounded_runtime_without_launch_agent_surface(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = self._make_source_fixture(root)
            runtime = root / "runtime"

            materialized = self._run(
                "materialize", "--source", str(source),
                "--destination", str(runtime), "--revision=HEAD",
            )
            self.assertEqual(materialized.returncode, 0, materialized.stderr)

            manifest = json.loads(
                (runtime / "connector-runtime-manifest.json").read_text(encoding="utf-8")
            )
            paths = {entry["path"] for entry in manifest["files"]}
            self.assertIn("scripts/new_owner_connector.py", paths)
            self.assertNotIn("scripts/new_owner_connector_launch_agent.plist.in", paths)
            self.assertNotIn("scripts/connector_runtime_test.py", paths)
            self.assertTrue(all(not path.is_symlink() for path in runtime.rglob("*")))
            self.assertTrue(
                all(not (path.stat().st_mode & stat.S_IWUSR) for path in runtime.rglob("*") if path.is_file())
            )

            verified = self._run("verify", "--runtime", str(runtime))
            self.assertEqual(verified.returncode, 0, verified.stderr)

    def test_rejects_missing_revision_and_tracked_symlink(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = self._make_source_fixture(root)
            missing = self._run(
                "materialize", "--source", str(source),
                "--destination", str(root / "missing"), "--revision=not-a-ref",
            )
            self.assertNotEqual(missing.returncode, 0)
            self.assertFalse((root / "missing").exists())

            link = source / "scripts" / "requested_ai_proposal_pass.py"
            link.unlink()
            link.symlink_to(root / "outside.py")
            self._git(source, "add", "-f", "--", "scripts/requested_ai_proposal_pass.py")
            subprocess.run(
                [
                    "git", "-C", str(source),
                    "-c", "user.name=Runtime Fixture",
                    "-c", "user.email=runtime-fixture@photosbyelie.invalid",
                    "commit", "-qm", "fixture symlink",
                ],
                check=True,
            )
            rejected = self._run(
                "materialize", "--source", str(source),
                "--destination", str(root / "symlink"), "--revision=HEAD",
            )
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn("not a regular file", (rejected.stdout + rejected.stderr).lower())
            self.assertFalse((root / "symlink").exists())


if __name__ == "__main__":
    unittest.main()
