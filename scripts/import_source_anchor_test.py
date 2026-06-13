#!/usr/bin/env python3
from __future__ import annotations

import unittest
import sys
from pathlib import Path

SCRIPT_ROOT = Path(__file__).resolve().parent
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from export_photos_data import dedupe_rows_by_source_anchor
from import_source_anchor import photo_id_for_source_path, source_paths_from_row
from build_lightroom_thumbnails import manifest_match_for_source, manifest_source_indexes, photo_id_for_import


class ImportSourceAnchorTest(unittest.TestCase):
    def test_photo_id_uses_full_source_path(self) -> None:
        first = photo_id_for_source_path("/Volumes/Saturn/Pictures/LR/Camera/Italy/IMG_1234.jpg")
        second = photo_id_for_source_path("/Volumes/Saturn/Pictures/LR/Camera/Spain/IMG_1234.jpg")

        self.assertNotEqual(first, second)
        self.assertTrue(first.startswith("img-1234-"))
        self.assertTrue(second.startswith("img-1234-"))

    def test_source_paths_include_anchor_and_source_file_path(self) -> None:
        row = {
            "source_anchor": {"path": "/Volumes/Saturn/Pictures/LR/Camera/Italy/IMG_1234.jpg"},
            "source_file": {"path": "/Volumes/Saturn/Pictures/LR/Camera/Italy/IMG_1234.jpg"},
        }

        self.assertEqual(
            source_paths_from_row(row),
            {"/Volumes/Saturn/Pictures/LR/Camera/Italy/IMG_1234.jpg"},
        )

    def test_dedupe_rows_by_source_anchor_keeps_newest_modified_date(self) -> None:
        old = {
            "id": "old-id",
            "relative_path": "Italy/IMG_1234.jpg",
            "source_anchor": {
                "path": "/Volumes/Saturn/Pictures/LR/Camera/Italy/IMG_1234.jpg",
                "modified_ns": 100,
            },
        }
        new = {
            "id": "new-id",
            "relative_path": "Selected/IMG_1234.jpg",
            "source_anchor": {
                "path": "/Volumes/Saturn/Pictures/LR/Camera/Italy/IMG_1234.jpg",
                "modified_ns": 200,
            },
        }

        self.assertEqual(dedupe_rows_by_source_anchor([old, new]), [new])

    def test_manifest_source_index_reuses_existing_id_for_new_relative_path(self) -> None:
        source_path = "/Volumes/Saturn/Pictures/LR/Apple Photo Albums/Shoot/IMG_1234.jpg"
        old = {
            "id": "old-id",
            "relative_path": "Shoot/IMG_1234.jpg",
            "source_anchor": {"path": source_path, "modified_ns": 100},
        }
        manifest = {"Shoot/IMG_1234.jpg": old}
        source_index, _keys_by_source_path = manifest_source_indexes(manifest)
        _matched_key, matched_row = manifest_match_for_source(
            manifest,
            source_index,
            "IMG_1234.jpg",
            Path(source_path),
        )

        self.assertEqual(matched_row, old)
        self.assertEqual(photo_id_for_import("IMG_1234.jpg", Path(source_path), matched_row), "old-id")


if __name__ == "__main__":
    unittest.main()
