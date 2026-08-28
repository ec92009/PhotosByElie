#!/usr/bin/env python3

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.prepare_cloudflare_static_prototype import (
    MARKER,
    PUBLIC_FILES,
    PUBLIC_TREES,
    ROOT_FILES,
    prepare,
)


class PrepareCloudflareStaticPrototypeTest(unittest.TestCase):
    def test_stages_only_allowlisted_public_files_and_exact_catalog(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "repo"
            output = Path(directory) / "dist"
            root.mkdir()
            for value in (*ROOT_FILES, *PUBLIC_FILES):
                path = root / value
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"SQLite format 3\0" if value.endswith("photosbyelie.sqlite") else value.encode())
            for value in PUBLIC_TREES:
                path = root / value / "sample.txt"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(value, encoding="utf-8")
            private = root / "assets/owner-actions/Owner.sqlite"
            private.parent.mkdir(parents=True)
            private.write_text("private", encoding="utf-8")

            report = prepare(root, output)

            self.assertEqual(report["forbiddenPathCount"], 0)
            self.assertFalse((output / "assets/owner-actions/Owner.sqlite").exists())
            self.assertEqual(
                (output / "assets/catalog/photosbyelie.sqlite").read_bytes(),
                b"SQLite format 3\0",
            )
            self.assertIn("X-Robots-Tag: noindex", (output / "_headers").read_text())
            self.assertIn(MARKER, (output / ".assetsignore").read_text())

    def test_replace_requires_generated_marker(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "dist"
            output.mkdir()
            with self.assertRaisesRegex(ValueError, "approved generated marker"):
                prepare(root, output, replace=True)
            (output / MARKER).write_text("ok")
            with self.assertRaises(FileNotFoundError):
                prepare(root, output, replace=True)


if __name__ == "__main__":
    unittest.main()
