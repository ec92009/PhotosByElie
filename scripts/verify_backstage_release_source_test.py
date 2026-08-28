#!/usr/bin/env python3
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
VERIFIER = ROOT / "scripts" / "verify_backstage_release_source.zsh"
CANONICAL_REF = "refs/heads/release/backstage"


class BackstageReleaseSourceTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.temporary.name)
        self.remote = root / "remote.git"
        self.repo = root / "repo"
        subprocess.run(["git", "init", "--bare", str(self.remote)], check=True, capture_output=True)
        subprocess.run(["git", "init", str(self.repo)], check=True, capture_output=True)
        self.git("config", "user.name", "Release Test")
        self.git("config", "user.email", "release-test@example.invalid")
        self.git("remote", "add", "origin", str(self.remote))

        (self.repo / "release.txt").write_text("first\n", encoding="utf-8")
        self.git("add", "release.txt")
        self.git("commit", "-m", "first")
        self.first = self.git("rev-parse", "HEAD").stdout.strip()
        self.git("push", "origin", f"{self.first}:{CANONICAL_REF}")

    def tearDown(self):
        self.temporary.cleanup()

    def git(self, *arguments):
        return subprocess.run(
            ["git", *arguments],
            cwd=self.repo,
            check=True,
            capture_output=True,
            text=True,
        )

    def verify(self, revision, canonical_ref=CANONICAL_REF):
        return subprocess.run(
            [
                str(VERIFIER),
                "--repo",
                str(self.repo),
                "--revision",
                revision,
                "--canonical-ref",
                canonical_ref,
            ],
            cwd=self.repo,
            capture_output=True,
            text=True,
        )

    def add_second_commit(self):
        (self.repo / "release.txt").write_text("second\n", encoding="utf-8")
        self.git("add", "release.txt")
        self.git("commit", "-m", "second")
        return self.git("rev-parse", "HEAD").stdout.strip()

    def test_commit_reachable_from_canonical_ref_passes(self):
        result = self.verify(self.first)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(self.first, result.stdout)
        self.assertIn(CANONICAL_REF, result.stdout)

    def test_unpushed_commit_fails_closed(self):
        second = self.add_second_commit()
        result = self.verify(second)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not reachable", result.stderr)

    def test_commit_on_another_remote_branch_still_fails(self):
        second = self.add_second_commit()
        self.git("push", "origin", f"{second}:refs/heads/not-release")
        result = self.verify(second)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not reachable", result.stderr)

    def test_fast_forwarded_canonical_ref_passes(self):
        second = self.add_second_commit()
        self.git("push", "origin", f"{second}:{CANONICAL_REF}")
        result = self.verify(second)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_malformed_or_non_branch_ref_is_rejected(self):
        for invalid_ref in ("release/backstage", "refs/tags/release", "refs/heads/release bad"):
            with self.subTest(invalid_ref=invalid_ref):
                result = self.verify(self.first, invalid_ref)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("valid full branch ref", result.stderr)


if __name__ == "__main__":
    unittest.main()
