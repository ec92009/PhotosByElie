import hashlib
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
MATERIALIZER = REPO_ROOT / "scripts" / "owner_connector_runtime.py"
REQUIRED_FIXTURE_SCRIPTS = {
    "backstage_photos_client.py",
    "fixture_pipeline.py",
    "local_server.py",
    "new_owner_connector.py",
    "new_owner_connector_launch_agent.plist.in",
    "owner_connector_runtime.py",
    "pbe_owner_host_tracked_paths.txt",
    "pbe_owner_session.py",
    "requested_ai_proposal_pass.py",
    "sidecar_server.py",
    "sidecar_state_db.py",
    "waste_basket_gateway.py",
}


class OwnerConnectorRuntimeInstallationTest(unittest.TestCase):
    @staticmethod
    def _git(source_root: Path, *arguments: str) -> subprocess.CompletedProcess[bytes]:
        return subprocess.run(
            ["git", "-C", str(source_root), *arguments],
            check=True,
            capture_output=True,
        )

    def _fixture_head(self, source_root: Path) -> str:
        return self._git(source_root, "rev-parse", "HEAD").stdout.decode().strip()

    def _make_source_fixture(self, fixture_root: Path) -> Path:
        source_root = fixture_root / "ephemeral-source"
        scripts_root = source_root / "scripts"
        scripts_root.mkdir(parents=True)
        for name in sorted(REQUIRED_FIXTURE_SCRIPTS):
            source = REPO_ROOT / "scripts" / name
            destination = scripts_root / name
            if name == "pbe_owner_host_tracked_paths.txt":
                destination.write_text(
                    ":(glob)scripts/**/*.py\ngallery.html\ngallery-commands.js\n",
                    encoding="utf-8",
                )
            elif name in {
                "new_owner_connector.py",
                "new_owner_connector_launch_agent.plist.in",
                "owner_connector_runtime.py",
            }:
                shutil.copy2(source, destination)
            else:
                destination.write_text(f'"""Disposable fixture for {name}."""\n', encoding="utf-8")
        (source_root / "gallery.html").write_text(
            "<!doctype html><title>Runtime fixture</title>\n",
            encoding="utf-8",
        )
        (source_root / "gallery-commands.js").write_text(
            "window.photosByElieGalleryCommands = { fixture: true };\n",
            encoding="utf-8",
        )
        subprocess.run(["git", "init", "-q", str(source_root)], check=True)
        subprocess.run(
            ["git", "-C", str(source_root), "add", "--", "scripts", "gallery.html", "gallery-commands.js"],
            check=True,
        )
        subprocess.run(
            [
                "git",
                "-C",
                str(source_root),
                "-c",
                "user.name=Runtime Fixture",
                "-c",
                "user.email=runtime-fixture@photosbyelie.invalid",
                "commit",
                "-qm",
                "fixture runtime",
            ],
            check=True,
        )
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
            "PBE_CONNECTOR_RUNTIME_REVISION": "HEAD",
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

    def _run_materializer(
        self,
        source_root: Path,
        destination: Path,
        revision: str,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(MATERIALIZER),
                "materialize",
                "--source",
                str(source_root),
                "--destination",
                str(destination),
                f"--revision={revision}",
            ],
            text=True,
            capture_output=True,
            timeout=10,
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
            expected_revision = self._fixture_head(source_root)
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
                        self.assertTrue(stat.S_ISREG(path.lstat().st_mode))
                        self.assertFalse(path.stat().st_mode & 0o222)
                        self.assertNotIn(source_bytes, path.read_bytes())
                    elif path.is_dir():
                        self.assertFalse(path.stat().st_mode & 0o222)

                shutil.rmtree(source_root)
                self.assertFalse(source_root.exists())
                self.assertTrue((runtime_root / "scripts" / "new_owner_connector.py").is_file())
                self.assertTrue((runtime_root / "gallery.html").is_file())
                runtime_manifest = json.loads(
                    (runtime_root / "connector-runtime-manifest.json").read_text(encoding="utf-8")
                )
                self.assertEqual(runtime_manifest["schemaVersion"], 2)
                self.assertIn("gallery.html", runtime_manifest["pbeOwnerHost"]["files"])
                self.assertIn("gallery-commands.js", runtime_manifest["pbeOwnerHost"]["files"])
                gallery_commands = runtime_root / "gallery-commands.js"
                gallery_commands_entry = next(
                    entry for entry in runtime_manifest["files"] if entry["path"] == "gallery-commands.js"
                )
                self.assertEqual(gallery_commands_entry["size"], gallery_commands.stat().st_size)
                self.assertEqual(
                    gallery_commands_entry["sha256"],
                    hashlib.sha256(gallery_commands.read_bytes()).hexdigest(),
                )

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
                        self.assertEqual(status["connector"]["runtime"]["revision"], expected_revision)
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

    def test_installer_renames_a_sealed_runtime_on_bsd_mv(self):
        with TemporaryDirectory() as temporary_directory:
            fixture_root = Path(temporary_directory)
            source_root = self._make_source_fixture(fixture_root)
            data_root = fixture_root / "stable-data"
            data_root.mkdir()
            env = self._installer_environment(fixture_root, data_root)
            guard_bin = fixture_root / "guard-bin"
            guard_bin.mkdir()
            guarded_mv = guard_bin / "mv"
            guarded_mv.write_text(
                "#!/bin/sh\n"
                "if [ -d \"$1\" ] && [ ! -w \"$1\" ]; then\n"
                "  echo 'guarded mv rejected read-only source' >&2\n"
                "  exit 73\n"
                "fi\n"
                "exec /bin/mv \"$@\"\n",
                encoding="utf-8",
            )
            guarded_mv.chmod(0o755)
            env["PATH"] = f"{guard_bin}:{env['PATH']}"
            runtime_root = Path(env["PBE_CONNECTOR_RUNTIME_PARENT"]) / env["PBE_CONNECTOR_RUNTIME_NAME"]
            try:
                installed = self._run_installer(source_root, env)
                self.assertEqual(installed.returncode, 0, installed.stderr or installed.stdout)
                self.assertEqual(stat.S_IMODE(runtime_root.stat().st_mode), 0o555)
            finally:
                self._make_tree_writable(runtime_root)

    def test_installer_uses_only_head_bytes_despite_dirty_index_and_worktree(self):
        mutations = {
            "unstaged": ("requested_ai_proposal_pass.py", "unstaged runtime shadow\n"),
            "staged-materializer": ("owner_connector_runtime.py", "raise RuntimeError('staged shadow')\n"),
            "deleted": ("local_server.py", None),
            "untracked-shadow": ("sidecar_server.py", "untracked runtime shadow\n"),
        }
        for mutation, (name, shadow_text) in mutations.items():
            with self.subTest(mutation=mutation), TemporaryDirectory() as temporary_directory:
                fixture_root = Path(temporary_directory)
                source_root = self._make_source_fixture(fixture_root)
                data_root = fixture_root / "stable-data"
                data_root.mkdir()
                expected_revision = self._fixture_head(source_root)
                relative = f"scripts/{name}"
                expected_bytes = self._git(source_root, "show", f"HEAD:{relative}").stdout
                target = source_root / relative

                if mutation == "deleted":
                    target.unlink()
                elif mutation == "untracked-shadow":
                    self._git(source_root, "rm", "--cached", "--", relative)
                    target.write_text(shadow_text or "", encoding="utf-8")
                else:
                    target.write_text(shadow_text or "", encoding="utf-8")
                    if mutation == "staged-materializer":
                        self._git(source_root, "add", "--", relative)

                env = self._installer_environment(fixture_root, data_root)
                runtime_root = Path(env["PBE_CONNECTOR_RUNTIME_PARENT"]) / env["PBE_CONNECTOR_RUNTIME_NAME"]
                try:
                    installed = self._run_installer(source_root, env)

                    self.assertEqual(installed.returncode, 0, installed.stderr or installed.stdout)
                    self.assertEqual((runtime_root / relative).read_bytes(), expected_bytes)
                    manifest = json.loads(
                        (runtime_root / "connector-runtime-manifest.json").read_text(encoding="utf-8")
                    )
                    self.assertEqual(manifest["sourceRevision"], expected_revision)
                    manifest_entry = next(entry for entry in manifest["files"] if entry["path"] == relative)
                    self.assertEqual(manifest_entry["size"], len(expected_bytes))
                finally:
                    self._make_tree_writable(runtime_root)

    def test_materializer_rejects_unresolvable_and_noncommit_revisions(self):
        with TemporaryDirectory() as temporary_directory:
            fixture_root = Path(temporary_directory)
            source_root = self._make_source_fixture(fixture_root)
            tree_object = self._git(source_root, "rev-parse", "HEAD^{tree}").stdout.decode().strip()
            for label, revision in (
                ("missing", "not-a-runtime-ref"),
                ("leading-dash", "--help"),
                ("tree", tree_object),
            ):
                with self.subTest(label=label):
                    destination = fixture_root / f"runtime-{label}"
                    materialized = self._run_materializer(source_root, destination, revision)

                    self.assertNotEqual(materialized.returncode, 0)
                    self.assertIn("provenance", materialized.stderr.lower())
                    self.assertFalse(destination.exists())

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
                subprocess.run(
                    [
                        "git",
                        "-C",
                        str(source_root),
                        "-c",
                        "user.name=Runtime Fixture",
                        "-c",
                        "user.email=runtime-fixture@photosbyelie.invalid",
                        "commit",
                        "-qm",
                        f"fixture {symlink_kind} symlink",
                    ],
                    check=True,
                )
                env = self._installer_environment(fixture_root, data_root)

                installed = self._run_installer(source_root, env)

                self.assertNotEqual(installed.returncode, 0)
                self.assertIn("not a regular file", (installed.stderr + installed.stdout).lower())
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
