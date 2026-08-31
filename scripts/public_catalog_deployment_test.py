import hashlib
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))

from owner_catalog_projection import import_projection
from public_catalog_deployment import deploy_public_catalog


ROOT = Path(__file__).resolve().parents[1]


class PublicCatalogDeploymentTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.remote = self.base / "remote.git"
        self.repo = self.base / "data"
        subprocess.run(
            ["git", "init", "--bare", "--initial-branch=main", str(self.remote)],
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            ["git", "clone", str(self.remote), str(self.repo)],
            check=True,
            capture_output=True,
            text=True,
        )
        self._git("config", "user.name", "Catalog Test")
        self._git("config", "user.email", "catalog-test@example.invalid")
        catalog = self.repo / "assets" / "catalog" / "photosbyelie.sqlite"
        catalog.parent.mkdir(parents=True)
        shutil.copy2(ROOT / "assets" / "catalog" / "photosbyelie.sqlite", catalog)
        self._git("add", "assets/catalog/photosbyelie.sqlite")
        self._git("commit", "-m", "initial catalog")
        self._git("push", "-u", "origin", "main")

        reviewed = self.base / "reviewed.sqlite"
        shutil.copy2(catalog, reviewed)
        with sqlite3.connect(reviewed) as connection:
            connection.execute(
                "UPDATE media_items SET title = title || ' deployment-test' "
                "WHERE media_id = (SELECT media_id FROM media_items ORDER BY media_id LIMIT 1)"
            )
            connection.commit()
        owner = self.repo / "assets" / "owner-actions" / "Owner.sqlite"
        owner.parent.mkdir(parents=True)
        imported = import_projection(owner, reviewed, approved_policy="PBE-173")
        self.payload = reviewed.read_bytes()
        self.projection_sha256 = imported["sha256"]

    def tearDown(self):
        self.temp.cleanup()

    def _git(self, *arguments: str) -> str:
        completed = subprocess.run(
            ["git", *arguments],
            cwd=self.repo,
            check=True,
            capture_output=True,
            text=True,
        )
        return completed.stdout.strip()

    def test_deploys_only_catalog_then_records_exact_live_parity(self):
        fetches = []

        def fetch(url, expected_sha256, attempt):
            fetches.append((url, expected_sha256, attempt))
            return 200, self.payload

        first = deploy_public_catalog(
            self.repo,
            public_url="https://example.invalid/catalog.sqlite",
            verify_timeout_seconds=0,
            poll_interval_seconds=0,
            fetch=fetch,
        )
        self.assertTrue(first["ok"])
        self.assertTrue(first["pushed"])
        self.assertEqual(first["state"], "verified")
        self.assertEqual(first["projectionSha256"], self.projection_sha256)
        self.assertEqual(fetches[0][1], self.projection_sha256)

        checkout = self.base / "verify"
        subprocess.run(
            ["git", "clone", str(self.remote), str(checkout)],
            check=True,
            capture_output=True,
            text=True,
        )
        deployed = (checkout / "assets" / "catalog" / "photosbyelie.sqlite").read_bytes()
        self.assertEqual(hashlib.sha256(deployed).hexdigest(), self.projection_sha256)
        changed = subprocess.run(
            ["git", "show", "--name-only", "--format=", "HEAD"],
            cwd=checkout,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.splitlines()
        self.assertEqual(changed, ["assets/catalog/photosbyelie.sqlite"])

        second = deploy_public_catalog(
            self.repo,
            public_url="https://example.invalid/catalog.sqlite",
            verify_timeout_seconds=0,
            poll_interval_seconds=0,
            fetch=fetch,
        )
        self.assertTrue(second["ok"])
        self.assertFalse(second["pushed"])


if __name__ == "__main__":
    unittest.main()
