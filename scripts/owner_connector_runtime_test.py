import json
import os
from pathlib import Path
import plistlib
import shutil
import stat
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest


REPO_ROOT = Path(__file__).resolve().parents[1]
INSTALLER = REPO_ROOT / "scripts" / "install_new_owner_connector.zsh"
REQUIRED_FIXTURE_SCRIPTS = {
    "fixture_pipeline.py",
    "local_server.py",
    "new_owner_connector.py",
    "new_owner_connector_launch_agent.plist.in",
    "owner_connector_runtime.py",
    "requested_ai_proposal_pass.py",
    "sidecar_server.py",
    "sidecar_state_db.py",
}


class OwnerConnectorRuntimeInstallationTest(unittest.TestCase):
    def _make_source_fixture(self, fixture_root: Path) -> Path:
        source_root = fixture_root / "ephemeral-source"
        scripts_root = source_root / "scripts"
        scripts_root.mkdir(parents=True)
        for name in sorted(REQUIRED_FIXTURE_SCRIPTS):
            source = REPO_ROOT / "scripts" / name
            destination = scripts_root / name
            if name in {
                "new_owner_connector.py",
                "new_owner_connector_launch_agent.plist.in",
                "owner_connector_runtime.py",
            }:
                shutil.copy2(source, destination)
            else:
                destination.write_text(f'"""Disposable fixture for {name}."""\n', encoding="utf-8")
        subprocess.run(["git", "init", "-q", str(source_root)], check=True)
        subprocess.run(["git", "-C", str(source_root), "add", "--", "scripts"], check=True)
        return source_root

    def _installer_environment(self, fixture_root: Path, data_root: Path) -> dict[str, str]:
        home = fixture_root / "home"
        temporary = fixture_root / "tmp"
        home.mkdir()
        temporary.mkdir()
        return {
            "HOME": str(home),
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "PBE_CONNECTOR_CONFIG_DIR": str(fixture_root / "config"),
            "PBE_CONNECTOR_DATA_ROOT": str(data_root),
            "PBE_CONNECTOR_LAUNCH_AGENTS_DIR": str(fixture_root / "launch-agents"),
            "PBE_CONNECTOR_LOG_DIR": str(fixture_root / "logs"),
            "PBE_CONNECTOR_RUNTIME_NAME": "connector-runtime-fixture",
            "PBE_CONNECTOR_RUNTIME_PARENT": str(fixture_root / "application-support"),
            "PBE_CONNECTOR_RUNTIME_REVISION": "fixture-revision",
            "PBE_CONNECTOR_SKIP_ACTIVATION": "1",
            "PBE_CONNECTOR_TOKEN": "fixture-token-xxxxxxxxxxxxxxxxxxxxxxxx",
            "PBE_SKIP_BRIDGE_BUILD": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "TMPDIR": str(temporary),
        }

    def _run_installer(self, source_root: Path, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["/bin/zsh", str(INSTALLER), str(source_root), "fixture-max"],
            cwd=source_root,
            env=env,
            text=True,
            capture_output=True,
            timeout=30,
            check=False,
        )

    @staticmethod
    def _make_tree_writable(root: Path) -> None:
        if not root.exists():
            return
        for path in [root, *root.rglob("*")]:
            if path.is_symlink():
                continue
            mode = 0o700 if path.is_dir() else 0o600
            path.chmod(mode)

    def test_installed_copy_survives_source_removal_and_two_offline_status_starts(self):
        with TemporaryDirectory() as temporary_directory:
            fixture_root = Path(temporary_directory)
            source_root = self._make_source_fixture(fixture_root)
            data_root = fixture_root / "stable-data"
            data_root.mkdir()
            env = self._installer_environment(fixture_root, data_root)
            runtime_root = Path(env["PBE_CONNECTOR_RUNTIME_PARENT"]) / env["PBE_CONNECTOR_RUNTIME_NAME"]
            expected_data_root = data_root.resolve()
            try:
                installed = self._run_installer(source_root, env)
                self.assertEqual(installed.returncode, 0, installed.stderr or installed.stdout)
                runtime_root = runtime_root.resolve(strict=True)

                config_path = Path(env["PBE_CONNECTOR_CONFIG_DIR"]) / "connector.json"
                plist_path = Path(env["PBE_CONNECTOR_LAUNCH_AGENTS_DIR"]) / "com.photosbyelie.owner-connector.plist"
                config = json.loads(config_path.read_text(encoding="utf-8"))
                plist = plistlib.loads(plist_path.read_bytes())
                self.assertEqual(config["repoRoot"], str(expected_data_root))
                self.assertEqual(config["runtimeRoot"], str(runtime_root))
                self.assertEqual(plist["WorkingDirectory"], str(expected_data_root))
                self.assertEqual(
                    plist["ProgramArguments"][1],
                    str(runtime_root / "scripts" / "new_owner_connector.py"),
                )
                self.assertEqual(
                    plist["EnvironmentVariables"]["PBE_CONNECTOR_RUNTIME_ROOT"],
                    str(runtime_root),
                )

                source_bytes = str(source_root).encode()
                resolved_source_bytes = str(source_root.resolve()).encode()
                self.assertNotIn(source_bytes, config_path.read_bytes())
                self.assertNotIn(resolved_source_bytes, config_path.read_bytes())
                self.assertNotIn(source_bytes, plist_path.read_bytes())
                self.assertNotIn(resolved_source_bytes, plist_path.read_bytes())
                runtime_paths = [runtime_root, *runtime_root.rglob("*")]
                self.assertFalse(any(path.is_symlink() for path in runtime_paths))
                for path in runtime_paths:
                    if path.is_file():
                        self.assertTrue(stat.S_ISREG(path.stat(follow_symlinks=False).st_mode))
                        self.assertFalse(path.stat().st_mode & 0o222)
                        self.assertNotIn(source_bytes, path.read_bytes())
                    elif path.is_dir():
                        self.assertFalse(path.stat().st_mode & 0o222)

                shutil.rmtree(source_root)
                self.assertFalse(source_root.exists())
                self.assertTrue((runtime_root / "scripts" / "new_owner_connector.py").is_file())

                offline_status = """
import json
from pathlib import Path
import sys
sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])
import new_owner_connector as connector
def reject_network(*_args, **_kwargs):
    raise AssertionError("offline status attempted network access")
connector.urlopen = reject_network
sys.argv = ["new_owner_connector.py", "--config", sys.argv[2], "--status"]
raise SystemExit(connector.main())
"""
                status_env = {
                    "HOME": env["HOME"],
                    "PATH": env["PATH"],
                    "PYTHONDONTWRITEBYTECODE": "1",
                }
                for launch_number in (1, 2):
                    with self.subTest(launch_number=launch_number):
                        launched = subprocess.run(
                            [
                                sys.executable,
                                "-c",
                                offline_status,
                                str(runtime_root / "scripts"),
                                str(config_path),
                            ],
                            cwd=data_root,
                            env=status_env,
                            text=True,
                            capture_output=True,
                            timeout=10,
                            check=False,
                        )
                        self.assertEqual(launched.returncode, 0, launched.stderr or launched.stdout)
                        status = json.loads(launched.stdout)
                        self.assertTrue(status["ok"])
                        self.assertFalse(status["networkAttempted"])
                        self.assertTrue(status["connector"]["runtime"]["verified"])
                        self.assertEqual(status["connector"]["runtime"]["revision"], "fixture-revision")
                        self.assertNotIn(config["token"], launched.stdout)

                scripts_root = runtime_root / "scripts"
                scripts_root.chmod(0o755)
                leaked_file = scripts_root / "requested_ai_proposal_pass.py"
                leaked_file.chmod(0o644)
                leaked_file.unlink()
                leaked_file.symlink_to(fixture_root / "outside-runtime.py")
                rejected = subprocess.run(
                    [
                        sys.executable,
                        "-c",
                        offline_status,
                        str(scripts_root),
                        str(config_path),
                    ],
                    cwd=data_root,
                    env=status_env,
                    text=True,
                    capture_output=True,
                    timeout=10,
                    check=False,
                )
                self.assertNotEqual(rejected.returncode, 0)
                self.assertIn("runtime is invalid", rejected.stderr.lower())
            finally:
                self._make_tree_writable(runtime_root)

    def test_installer_rejects_external_and_broken_tracked_symlinks(self):
        for symlink_kind in ("external", "broken"):
            with self.subTest(symlink_kind=symlink_kind), TemporaryDirectory() as temporary_directory:
                fixture_root = Path(temporary_directory)
                source_root = self._make_source_fixture(fixture_root)
                data_root = fixture_root / "stable-data"
                data_root.mkdir()
                link = source_root / "scripts" / "requested_ai_proposal_pass.py"
                link.unlink()
                target = fixture_root / f"{symlink_kind}-target.py"
                if symlink_kind == "external":
                    target.write_text("raise RuntimeError('must never be installed')\n", encoding="utf-8")
                link.symlink_to(target)
                subprocess.run(
                    ["git", "-C", str(source_root), "add", "-f", "--", str(link.relative_to(source_root))],
                    check=True,
                )
                env = self._installer_environment(fixture_root, data_root)

                installed = self._run_installer(source_root, env)

                self.assertNotEqual(installed.returncode, 0)
                self.assertIn("source symlink", (installed.stderr + installed.stdout).lower())
                self.assertFalse(
                    (Path(env["PBE_CONNECTOR_RUNTIME_PARENT"]) / env["PBE_CONNECTOR_RUNTIME_NAME"]).exists()
                )
                self.assertFalse((Path(env["PBE_CONNECTOR_CONFIG_DIR"]) / "connector.json").exists())
                self.assertFalse(
                    (Path(env["PBE_CONNECTOR_LAUNCH_AGENTS_DIR"]) / "com.photosbyelie.owner-connector.plist").exists()
                )
                runtime_parent = Path(env["PBE_CONNECTOR_RUNTIME_PARENT"])
                self.assertEqual(list(runtime_parent.glob(".*.staging.*")), [])


if __name__ == "__main__":
    unittest.main()
