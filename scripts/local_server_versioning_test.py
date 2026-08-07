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


if __name__ == "__main__":
    unittest.main()
