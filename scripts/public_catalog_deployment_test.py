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
from public_catalog_deployment import (
    PublicCatalogDeploymentError,
    deploy_public_catalog,
)


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

    def test_changed_run_authority_stops_before_push(self):
        before=self._git('ls-remote','origin','refs/heads/main')
        def withdrawn():
            raise ValueError('approval withdrawn or run cancelled')
        with self.assertRaisesRegex(ValueError,'approval withdrawn'):
            deploy_public_catalog(self.repo,before_publish=withdrawn,
                fetch=lambda *_:self.fail('No website read before the guarded push'))
        self.assertEqual(self._git('ls-remote','origin','refs/heads/main'),before)

    def _seed_derived_site_fixture(self):
        """Seed main with checksum-bound bootstrap, home, pricing, sidecar, and generators."""
        import json as _json

        pricing_path = self.repo / "assets" / "catalog" / "product-pricing.json"
        pricing_bytes = b'{"schemaVersion":1,"products":[{"id":"original","price":10}]}\n'
        pricing_path.write_bytes(pricing_bytes)
        (self.repo / "scripts").mkdir(parents=True, exist_ok=True)
        (self.repo / "scripts" / "write_catalog_tsv.cjs").write_text(
            """const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
if (!process.argv.includes("--bootstrap-only")) process.exit(2);
const root = path.resolve(__dirname, "..");
const readMeta = (rel) => {
  const bytes = fs.readFileSync(path.join(root, rel));
  return { path: "./" + rel, bytes: bytes.byteLength, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
};
const generation = { schemaVersion: 1, ...readMeta("assets/catalog/photosbyelie.sqlite"), pricing: readMeta("assets/catalog/product-pricing.json") };
fs.writeFileSync(path.join(root, "photos-data.js"), `(() => {\\n  const catalogGeneration = Object.freeze(${JSON.stringify(generation)});\\n})();\\n`);
const countsJson = childProcess.execFileSync("python3", ["-c",
  "import json,sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(json.dumps({s:{'count':n,'photos':[]} for s,n in c.execute('SELECT col.slug, COUNT(m.media_id) FROM collections col LEFT JOIN media_items m ON m.collection_id=col.collection_id GROUP BY col.slug ORDER BY col.slug')}))",
  path.join(root, "assets/catalog/photosbyelie.sqlite"),
], { encoding: "utf8" });
fs.writeFileSync(path.join(root, "home-data.js"), `window.photosByElieHomeData = ${countsJson.trim()};\\n`);
""",
            encoding="utf-8",
        )
        (self.repo / "scripts" / "write_media_sidecar.mjs").write_text(
            """import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
const root = path.resolve(new URL("..", import.meta.url).pathname);
const ids = JSON.parse(childProcess.execFileSync("python3", ["-c",
  "import json,sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(json.dumps([r[0] for r in c.execute('SELECT media_id FROM media_items ORDER BY media_id')]))",
  path.join(root, "assets/catalog/photosbyelie.sqlite"),
], { encoding: "utf8" }));
const photos = Object.fromEntries(ids.map((id) => [id, { id }]));
fs.writeFileSync(path.join(root, "assets/media-sidecar.json"), JSON.stringify({
  schema: "photosbyelie.media-sidecar.v1",
  photosCount: ids.length,
  photos,
}, null, 2) + "\\n");
""",
            encoding="utf-8",
        )
        subprocess.run(["node", "scripts/write_catalog_tsv.cjs", "--bootstrap-only"], cwd=self.repo, check=True)
        subprocess.run(["node", "scripts/write_media_sidecar.mjs"], cwd=self.repo, check=True)
        (self.repo / "README.md").write_text("unchanged-readme\n", encoding="utf-8")
        self._git(
            "add",
            "assets/catalog/product-pricing.json",
            "photos-data.js",
            "home-data.js",
            "assets/media-sidecar.json",
            "scripts/write_catalog_tsv.cjs",
            "scripts/write_media_sidecar.mjs",
            "README.md",
        )
        self._git("commit", "-m", "add checksum-bound derived public artifacts")
        self._git("push", "origin", "main")
        return pricing_bytes, _json

    def test_deploys_catalog_and_regenerates_derived_artifacts_preserving_pricing(self):
        pricing_bytes, _json = self._seed_derived_site_fixture()
        reviewed = self.base / "reviewed-added.sqlite"
        shutil.copy2(self.repo / "assets" / "catalog" / "photosbyelie.sqlite", reviewed)
        with sqlite3.connect(reviewed) as connection:
            sample = connection.execute(
                "SELECT collection_id, media_type_id, source_origin_id, source_file_id FROM media_items LIMIT 1"
            ).fetchone()
            connection.execute(
                """
                INSERT INTO media_items (
                  media_id, collection_id, sort_index, media_type_id, title, source_origin_id,
                  source_file_id, location, created_at, updated_at
                ) VALUES ('pbe227-added-photo', ?, 999999, ?, 'PBE-227 Test Photo', ?, ?, 'Spain', '2026-11-27T00:00:00Z', '2026-11-27T00:00:00Z')
                """,
                (sample[0], sample[1], sample[2], sample[3]),
            )
            connection.commit()
        owner = self.repo / "assets" / "owner-actions" / "Owner.sqlite"
        imported = import_projection(owner, reviewed, approved_policy="PBE-173")
        payload = reviewed.read_bytes()

        first = deploy_public_catalog(
            self.repo,
            public_url="https://example.invalid/catalog.sqlite",
            verify_timeout_seconds=0,
            poll_interval_seconds=0,
            fetch=lambda *_: (200, payload),
        )
        self.assertTrue(first["ok"], first)
        self.assertTrue(first["pushed"])
        self.assertEqual(
            first["changedPaths"],
            [
                "assets/catalog/photosbyelie.sqlite",
                "assets/media-sidecar.json",
                "home-data.js",
                "photos-data.js",
            ],
        )

        checkout = self.base / "verify-derived"
        subprocess.run(["git", "clone", str(self.remote), str(checkout)], check=True, capture_output=True, text=True)
        changed = sorted(
            subprocess.run(
                ["git", "show", "--name-only", "--format=", "HEAD"],
                cwd=checkout,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.splitlines()
        )
        self.assertEqual(changed, first["changedPaths"])
        self.assertEqual((checkout / "assets/catalog/product-pricing.json").read_bytes(), pricing_bytes)
        self.assertEqual((checkout / "README.md").read_text(encoding="utf-8"), "unchanged-readme\n")
        self.assertIn(imported["sha256"], (checkout / "photos-data.js").read_text(encoding="utf-8"))
        sidecar = _json.loads((checkout / "assets/media-sidecar.json").read_text(encoding="utf-8"))
        self.assertIn("pbe227-added-photo", sidecar["photos"])
        self.assertEqual(sidecar["photosCount"], imported["mediaCount"])

        # Unchanged replay must not create another commit or push.
        second = deploy_public_catalog(
            self.repo,
            public_url="https://example.invalid/catalog.sqlite",
            verify_timeout_seconds=0,
            poll_interval_seconds=0,
            fetch=lambda *_: (200, payload),
        )
        self.assertTrue(second["ok"])
        self.assertFalse(second["pushed"])
        self.assertEqual(second["changedPaths"], [])

    def test_stale_bootstrap_and_unexpected_files_fail_before_push(self):
        self._seed_derived_site_fixture()
        before = self._git("ls-remote", "origin", "refs/heads/main")
        with self.assertRaisesRegex(PublicCatalogDeploymentError, "photos-data.js"):
            deploy_public_catalog(
                self.repo,
                public_url="https://example.invalid/catalog.sqlite",
                verify_timeout_seconds=0,
                poll_interval_seconds=0,
                fetch=lambda *_: self.fail("must not fetch after failed derived validation"),
                regenerate_derived=lambda _wt: None,
            )
        self.assertEqual(self._git("ls-remote", "origin", "refs/heads/main"), before)

        def dirty_generator(worktree: Path) -> None:
            from public_catalog_deployment import _regenerate_derived_artifacts
            _regenerate_derived_artifacts(worktree)
            (worktree / "unexpected.txt").write_text("forbidden\n", encoding="utf-8")

        with self.assertRaisesRegex(PublicCatalogDeploymentError, "unexpected changed files"):
            deploy_public_catalog(
                self.repo,
                public_url="https://example.invalid/catalog.sqlite",
                verify_timeout_seconds=0,
                poll_interval_seconds=0,
                fetch=lambda *_: self.fail("must not fetch after allowlist rejection"),
                regenerate_derived=dirty_generator,
            )
        self.assertEqual(self._git("ls-remote", "origin", "refs/heads/main"), before)


if __name__ == "__main__":
    unittest.main()
