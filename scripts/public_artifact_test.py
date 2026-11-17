"""Regressions for private-artifact exclusion and complete customer release staging."""

from __future__ import annotations

import functools
import json
import shutil
import subprocess
import tempfile
import threading
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from scripts.check_public_release import check_release
from scripts.prepare_public_artifact import prepare
from scripts.public_artifact_policy import CATALOG, NEGATIVE_PATHS, POLICY, release_identity, sha256
from scripts.validate_public_artifact import local_reference, validate_package
from scripts.verify_public_release import verify_origins


ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args) -> None:
        pass


class PublicArtifactTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "repo"
        self.output = Path(self.temp.name) / "candidate"
        self.root.mkdir()
        self.policy = json.loads((ROOT / POLICY).read_text())
        for name in self.policy["files"]:
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("// public fixture\n")
            if target.suffix == ".html":
                target.write_text(
                    '<!doctype html><html><link rel="stylesheet" href="/photos.css?v=241.0"><body>Customer page</body></html>'
                )
        for name in (CATALOG, "assets/catalog/product-pricing.json", "photos-data.js"):
            shutil.copyfile(ROOT / name, self.root / name)
        (self.root / "site.webmanifest").write_text('{"icons": []}')
        (self.root / "assets/campaigns/index.json").write_text('{"campaigns": []}')
        (self.root / "VERSION").write_text("241.0\n")
        (self.root / "package.json").write_text('{"private": true, "type": "commonjs"}')
        (self.root / POLICY).parent.mkdir(parents=True, exist_ok=True)
        for name in ("scripts/check_public_catalog.cjs", "scripts/catalog_tsv.cjs"):
            shutil.copyfile(ROOT / name, self.root / name)
        self.save_policy()
        self.git("init", "--quiet")
        self.git("add", ".")
        self.git(
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "core.hooksPath=/dev/null",
            "commit",
            "--quiet",
            "-m",
            "Fixture",
        )

    def git(self, *arguments: str) -> None:
        subprocess.run(["git", *arguments], cwd=self.root, check=True, capture_output=True)

    def save_policy(self) -> None:
        (self.root / POLICY).write_text(json.dumps(self.policy))

    def build(self) -> dict:
        return prepare(self.root, self.output)

    def seo_fixture(self) -> Path:
        seo = Path(self.temp.name) / "seo"
        generator = self.root / "scripts/build_public_seo.mjs"
        generator.write_text("""
import fs from 'node:fs';
import path from 'node:path';
export const loadSeo = () => ({entityPath: (kind, id) => `/${kind}--${id}.html`});
export const publicEntities = () => [{id: 'eligible-photo', collectionKey: 'france'}];
const args = process.argv.slice(2);
if (args.includes('--output')) {
  const output = args[args.indexOf('--output') + 1];
  const root = args[args.indexOf('--repo-root') + 1];
  fs.mkdirSync(output, {recursive: true});
  fs.writeFileSync(path.join(output, '.pbe-seo-generated'), 'photosbyelie.public-seo.v1\\n');
  for (const [kind, key] of [['photo', 'eligible-photo'], ['gallery', 'france']]) {
    const name = `${kind}--${key}.html`;
    const html = fs.readFileSync(path.join(root, `${kind}.html`), 'utf8');
    fs.writeFileSync(path.join(output, name), html.replace('<body>', `<link rel="canonical" href="https://photos-by-elie.com/${name}"><body>`));
  }
  fs.writeFileSync(path.join(output, 'robots.txt'), 'Sitemap: https://photos-by-elie.com/sitemap.xml\\n');
  fs.writeFileSync(path.join(output, 'sitemap.xml'), '<urlset><url><loc>https://photos-by-elie.com/photo--eligible-photo.html</loc></url><url><loc>https://photos-by-elie.com/gallery--france.html</loc></url></urlset>');
}
""")
        return seo

    def test_complete_customer_artifact_keeps_exact_public_catalog(self) -> None:
        catalog_hash = sha256(self.root / CATALOG)
        receipt = self.build()
        for name in (
            "basket.html",
            "basket.js",
            "liked.html",
            "liked.js",
            "order.html",
            "order.js",
            "real-estate.html",
            "shared-gallery-visibility.mjs",
            "owner.html",
            "backstage-provisioning.js",
        ):
            self.assertTrue((self.output / "site" / name).is_file(), name)
        self.assertEqual(catalog_hash, sha256(self.output / "site" / CATALOG))
        self.assertEqual(receipt["validation"], validate_package(self.root, self.output))
        self.assertFalse((self.output / "site/receipt.json").exists())

    def test_unlisted_private_and_new_files_never_enter_artifact(self) -> None:
        for name in NEGATIVE_PATHS:
            target = self.root / name
            if target.exists() or name.startswith(".git/"):
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("private sentinel")
        (self.root / "assets/branding/new-internal-notes.json").write_text("private sentinel")
        self.build()
        for name in NEGATIVE_PATHS:
            self.assertFalse((self.output / "site" / name).exists(), name)
        self.assertFalse((self.output / "site/assets/branding/new-internal-notes.json").exists())

    def test_forbidden_path_cannot_be_granted_by_manifest(self) -> None:
        for name in (
            "TIMELOG.md",
            "worker/photos-catalog.generated.mjs",
            "Worker/checkout-worker.mjs",
            "assets/private-delivery-manifest.json",
            "assets/branding/Owner.sqlite",
            "assets/branding/notes.md",
            "../secret.json",
            "assets//branding/leak.json",
            "assets/%2e%2e/leak.json",
        ):
            with self.subTest(name=name):
                original = list(self.policy["files"])
                self.policy["files"].append(name)
                self.save_policy()
                with self.assertRaises(ValueError):
                    self.build()
                self.assertFalse(self.output.exists())
                self.policy["files"] = original

    def test_missing_required_page_blocks_build(self) -> None:
        (self.root / "basket.html").unlink()
        with self.assertRaisesRegex(ValueError, "required regular public file"):
            self.build()
        self.assertFalse(self.output.exists())

    def test_integrated_customer_helpers_are_staged_before_initialization(self) -> None:
        for name in self.policy["integrationFiles"]:
            (self.root / name).write_text("// customer helper fixture")
        ordered = (
            '<script src="/theme-preference.js?v=241.0"></script>'
            '<script src="/customer-recovery.js?v=241.0"></script>'
            '<script src="/photos.js?v=241.0"></script>'
        )
        for name in ("index.html", "gallery.html", "photo.html", "basket.html"):
            file = self.root / name
            file.write_text(file.read_text().replace("<body>", ordered + "<body>"))
        self.build()
        for name in self.policy["integrationFiles"]:
            self.assertTrue((self.output / "site" / name).is_file())
        gallery = self.root / "gallery.html"
        good = gallery.read_text()
        for helper, message in (
            ("theme-preference.js", "theme preference"),
            ("customer-recovery.js", "customer recovery"),
        ):
            with self.subTest(helper=helper):
                script = f'<script src="/{helper}?v=241.0"></script>'
                gallery.write_text(good.replace(script, "").replace("<body>", script + "<body>"))
                with self.assertRaisesRegex(ValueError, message):
                    prepare(self.root, self.output, replace=True)

    def test_mixed_catalog_generation_blocks_staging_before_replacement(self) -> None:
        self.build()
        receipt = (self.output / "receipt.json").read_bytes()
        (self.root / "photos-data.js").write_text(
            'const catalogGeneration = Object.freeze({"schemaVersion":1,"sha256":"wrong"});\n'
            "window.photosByElieCatalogGeneration = catalogGeneration;\n"
        )
        with self.assertRaisesRegex(ValueError, "catalog generation check failed"):
            prepare(self.root, self.output, replace=True)
        self.assertEqual(receipt, (self.output / "receipt.json").read_bytes())

    def test_symlink_file_and_directory_block_build(self) -> None:
        asset = self.root / "assets/branding/photosbyelie-app-icon-192.png"
        asset.unlink()
        asset.symlink_to(self.root / "VERSION")
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.build()
        asset.unlink()
        asset.write_text("public")
        branding = self.root / "assets/branding"
        branding.rename(self.root / "saved-branding")
        branding.symlink_to(self.root / "saved-branding", target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.build()

    def test_extra_file_or_empty_directory_rejected_after_build(self) -> None:
        self.build()
        extra = self.output / "site/assets/branding/extra.json"
        extra.write_text("unapproved")
        with self.assertRaisesRegex(ValueError, "allowlist mismatch"):
            validate_package(self.root, self.output)
        extra.unlink()
        (self.output / "site/worker").mkdir()
        with self.assertRaisesRegex(ValueError, "unapproved directory"):
            validate_package(self.root, self.output)

    def test_site_root_symlink_is_rejected(self) -> None:
        self.build()
        site = self.output / "site"
        renamed = self.output / "saved-site"
        site.rename(renamed)
        site.symlink_to(renamed, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "site root must not be a symlink"):
            validate_package(self.root, self.output)

    def test_source_and_receipt_tampering_rejected(self) -> None:
        self.build()
        (self.output / "site/index.html").write_text("tampered")
        with self.assertRaisesRegex(ValueError, "bytes differ"):
            validate_package(self.root, self.output)
        shutil.copyfile(self.root / "index.html", self.output / "site/index.html")
        (self.output / "receipt.json").write_text("{}")
        with self.assertRaisesRegex(ValueError, "receipt differs"):
            validate_package(self.root, self.output)

    def test_broken_customer_link_or_import_blocks_build(self) -> None:
        for name, content in (
            ("index.html", '<script src="./missing.js?v=241.0"></script>'),
            ("basket.js", 'import("./missing.mjs")'),
        ):
            with self.subTest(name=name):
                original = (self.root / name).read_text()
                (self.root / name).write_text(content)
                with self.assertRaisesRegex(ValueError, "missing public dependency"):
                    self.build()
                (self.root / name).write_text(original)

    def test_prototype_noindex_and_version_mismatch_block_build(self) -> None:
        index = self.root / "index.html"
        original = index.read_text()
        index.write_text('<meta name="robots" content="noindex">' + original)
        with self.assertRaisesRegex(ValueError, "prototype noindex"):
            self.build()
        index.write_text(original.replace("241.0", "240.0"))
        with self.assertRaisesRegex(ValueError, "version differs"):
            self.build()

    def test_campaign_index_cannot_reference_unstaged_new_campaign(self) -> None:
        (self.root / "assets/campaigns/index.json").write_text(
            '{"campaigns": [{"id": "new-public-campaign"}]}'
        )
        with self.assertRaisesRegex(ValueError, "missing campaign"):
            self.build()

    def test_seo_hook_adds_only_catalog_bound_public_files(self) -> None:
        seo = self.seo_fixture()
        prepare(self.root, self.output, seo_root=seo)
        validate_package(self.root, self.output, seo_root=seo)
        self.assertTrue((self.output / "site/photo--eligible-photo.html").is_file())
        self.assertTrue((self.output / "site/gallery--france.html").is_file())
        self.assertFalse((self.output / "site/.pbe-seo-generated").exists())

    def test_seo_filename_glob_or_runtime_override_cannot_grant_publication(self) -> None:
        seo = self.seo_fixture()
        prepare(self.root, self.output, seo_root=seo)
        for name in (
            "photo--unknown-private-id.html",
            "gallery--ai.html",
            "photos-data.js",
            "docs.txt",
        ):
            with self.subTest(name=name):
                (seo / name).write_text("unapproved")
                with self.assertRaisesRegex(ValueError, "exactly eligible"):
                    validate_package(self.root, self.output, seo_root=seo)
                (seo / name).unlink()

    def test_available_seo_generator_is_mandatory_and_invoked_automatically(self) -> None:
        self.seo_fixture()
        self.build()
        self.assertTrue((self.root / "tmp/public-seo/photo--eligible-photo.html").is_file())
        self.assertTrue((self.output / "site/photo--eligible-photo.html").is_file())

    def test_canonical_runtime_requires_the_generator_and_overlay(self) -> None:
        (self.root / "photos.js").write_text("window.photosByElieSeo = { entityPath, };\n")
        with self.assertRaisesRegex(ValueError, "runtime requires the SEO generator"):
            self.build()

    def test_seo_generation_failure_preserves_previous_candidate(self) -> None:
        self.build()
        receipt = (self.output / "receipt.json").read_bytes()
        self.seo_fixture()
        (self.root / "scripts/build_public_seo.mjs").write_text(
            "throw new Error('broken generator');"
        )
        with self.assertRaises(subprocess.CalledProcessError):
            prepare(self.root, self.output, replace=True)
        self.assertEqual(receipt, (self.output / "receipt.json").read_bytes())

    def test_failed_rebuild_preserves_previous_candidate(self) -> None:
        self.build()
        receipt = (self.output / "receipt.json").read_bytes()
        (self.root / "basket.html").unlink()
        with self.assertRaises(ValueError):
            prepare(self.root, self.output, replace=True)
        self.assertEqual(receipt, (self.output / "receipt.json").read_bytes())

    def test_replacement_cannot_remove_source_or_unmarked_directory(self) -> None:
        self.output.mkdir()
        sentinel = self.output / "important.txt"
        sentinel.write_text("keep")
        with self.assertRaisesRegex(ValueError, "generated artifact marker"):
            prepare(self.root, self.output, replace=True)
        self.assertTrue(sentinel.exists())
        with self.assertRaisesRegex(ValueError, "repository"):
            prepare(self.root, self.root, replace=True)

    def test_failed_critical_test_prevents_release_package(self) -> None:
        owner = Path(self.temp.name) / "Owner.sqlite"
        owner.write_text("reviewed snapshot fixture")
        identity = release_identity(self.root)
        with (
            patch("scripts.check_public_release.release_identity", return_value=identity),
            patch(
                "scripts.check_public_release.subprocess.run",
                side_effect=subprocess.CalledProcessError(1, ["npm", "test"]),
            ) as commands,
        ):
            with self.assertRaises(subprocess.CalledProcessError):
                check_release(self.root, self.output, owner)
            commands.assert_called_once()
        self.assertFalse(self.output.exists())

    def test_available_sibling_tests_are_required_before_release(self) -> None:
        identity = release_identity(self.root)
        owner = Path(self.temp.name) / "Owner.sqlite"
        owner.write_text("reviewed snapshot fixture")
        tests = [
            "scripts/public_gallery_startup.test.mjs",
            "scripts/customer_resilience.test.mjs",
            "scripts/build_public_seo.test.mjs",
            "worker/paid-order-fulfillment.test.mjs",
        ]
        for name in [*tests, "scripts/build_public_seo.mjs"]:
            file = self.root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text("// integration fixture")
        outcomes = [
            subprocess.CompletedProcess(["npm", "run", "public:test"], 0),
            subprocess.CalledProcessError(1, ["node", "--test", *tests]),
        ]
        with (
            patch("scripts.check_public_release.release_identity", return_value=identity),
            patch("scripts.check_public_release.subprocess.run", side_effect=outcomes) as commands,
        ):
            with self.assertRaises(subprocess.CalledProcessError):
                check_release(self.root, self.output, owner)
        self.assertEqual(set(commands.call_args_list[1].args[0][2:]), set(tests))
        self.assertFalse(self.output.exists())

    def test_dirty_source_blocks_release(self) -> None:
        (self.root / "index.html").write_text("dirty")
        with self.assertRaisesRegex(ValueError, "clean committed"):
            check_release(self.root, self.output, self.root / "missing.sqlite")

    def test_missing_reviewed_authority_blocks_release(self) -> None:
        with self.assertRaisesRegex(ValueError, "absolute reviewed Owner.sqlite snapshot"):
            check_release(self.root, self.output, self.root / "missing.sqlite")

    def test_local_http_candidate_serves_customers_and_denies_private_paths(self) -> None:
        receipt = self.build()
        handler = functools.partial(QuietHandler, directory=str(self.output / "site"))
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            origin = f"http://127.0.0.1:{server.server_port}"
            self.assertEqual(verify_origins(receipt, [origin])[0]["status"], "verified")
            (self.output / "site/TIMELOG.md").write_text("leak")
            with self.assertRaisesRegex(ValueError, "negative-path check failed"):
                verify_origins(receipt, [origin])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_browser_reference_resolution(self) -> None:
        self.assertEqual(
            local_reference("collections/france/index.html", "../../gallery.html?v=241.0"),
            "gallery.html",
        )
        self.assertEqual(local_reference("index.html", "./"), "index.html")
        self.assertIsNone(local_reference("index.html", "https://example.com/photo.jpg"))
        with self.assertRaisesRegex(ValueError, "escapes"):
            local_reference("index.html", "../private.json")


if __name__ == "__main__":
    unittest.main()
