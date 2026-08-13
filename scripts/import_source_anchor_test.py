#!/usr/bin/env python3
from __future__ import annotations

import unittest
import sys
import tempfile
from pathlib import Path

SCRIPT_ROOT = Path(__file__).resolve().parent
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

from export_photos_data import dedupe_rows_by_source_anchor
from import_source_anchor import photo_id_for_source_path, source_identity_from_row, source_paths_from_row
from build_lightroom_thumbnails import (
    infer_gallery_country,
    infer_gallery_country_from_gps,
    manifest_match_for_source,
    manifest_source_indexes,
    parse_exif_datetime,
    photo_id_for_import,
    source_file_facts_for_import,
)


class ImportSourceAnchorTest(unittest.TestCase):
    def test_photo_id_uses_full_source_path(self) -> None:
        first = photo_id_for_source_path("/Volumes/Saturn/Pictures/LR/Camera/Italy/IMG_1234.jpg")
        second = photo_id_for_source_path("/Volumes/Saturn/Pictures/LR/Camera/Spain/IMG_1234.jpg")

        self.assertNotEqual(first, second)
        self.assertTrue(first.startswith("img-1234-"))
        self.assertTrue(second.startswith("img-1234-"))

    def test_photo_id_preserves_uri_source_anchor(self) -> None:
        first = photo_id_for_source_path("apple-photos://A1B2/L0/001")
        second = photo_id_for_source_path("apple-photos://A1B2/L0/002")

        self.assertNotEqual(first, second)
        self.assertTrue(first.startswith("001-") or first.startswith("photo-"))

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

    def test_source_identity_prefers_stable_anchor_over_transient_path(self) -> None:
        row = {
            "source_anchor": {"path": "apple-photos://DD02402E-FBD9-4602-A4D6-8379A0AF7CAA/L0/001"},
            "source_path_hint": "/tmp/apple-photos-export/FullSizeRender.jpg",
            "source_file": {"path": "Apple Photos Sidecar Uploads/FullSizeRender.jpg"},
        }

        self.assertEqual(
            source_identity_from_row(row),
            "apple-photos://DD02402E-FBD9-4602-A4D6-8379A0AF7CAA/L0/001",
        )

    def test_dedupe_preserves_colliding_assets_with_distinct_stable_anchors(self) -> None:
        shared_metadata = {
            "title": "RE 2026 La Concha 2 Apt 8A5",
            "relative_path": "Apple Photos Sidecar Uploads/FullSizeRender.jpg",
            "source_path_hint": "/tmp/apple-photos-export/FullSizeRender.jpg",
            "source_file": {"path": "Apple Photos Sidecar Uploads/FullSizeRender.jpg"},
            "capture": {"date": "2026:05:13 13:49:44", "sort": "2026-05-13T13:49:44"},
        }
        first = {
            **shared_metadata,
            "id": "001-10325afd73",
            "source_anchor": {"path": "apple-photos://DD02402E-FBD9-4602-A4D6-8379A0AF7CAA/L0/001"},
        }
        second = {
            **shared_metadata,
            "id": "001-b32659c9f5",
            "source_anchor": {"path": "apple-photos://1FC0479F-34D3-481A-9FFE-92A615AB71FE/L0/001"},
        }

        self.assertEqual(dedupe_rows_by_source_anchor([first, second]), [first, second])

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

    def test_manifest_source_index_reuses_apple_photos_anchor(self) -> None:
        source_anchor = "apple-photos://A1B2/L0/001"
        old = {
            "id": "apple-id",
            "relative_path": "old-export/IMG_0001.jpeg",
            "source_anchor": {"path": source_anchor, "modified_ns": 100},
        }
        manifest = {"old-export/IMG_0001.jpeg": old}
        source_index, _keys_by_source_path = manifest_source_indexes(manifest)
        _matched_key, matched_row = manifest_match_for_source(
            manifest,
            source_index,
            "new-export/IMG_0001.jpeg",
            source_anchor,
        )

        self.assertEqual(matched_row, old)
        self.assertEqual(photo_id_for_import("new-export/IMG_0001.jpeg", source_anchor, matched_row), "apple-id")

    def test_apple_photos_override_preserves_album_and_decimal_gps(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "0001-IMG_4401.jpg"
            source.write_bytes(b"jpeg")
            override = {
                "album": {"title": "2023 Nerja", "kind": "album"},
                "source_anchor": {"path": "apple-photos://A1B2/L0/001"},
                "apple_photos": {
                    "filename": "IMG_4401.jpg",
                    "creationDate": "2023-06-04T12:00:00Z",
                    "location": {"latitude": 36.746, "longitude": -3.879},
                },
            }

            facts = source_file_facts_for_import(source, override)

        self.assertEqual(facts["apple_photos_album"]["title"], "2023 Nerja")
        self.assertEqual(facts["source_anchor_path"], "apple-photos://A1B2/L0/001")
        self.assertEqual(facts["gps"]["GPSLatitudeDecimal"], 36.746)
        self.assertEqual(facts["gps"]["GPSLongitudeDecimal"], -3.879)
        self.assertEqual(infer_gallery_country_from_gps(facts["gps"]), {"slug": "spain", "label": "Spain", "source": "gps_hint"})
        self.assertEqual(parse_exif_datetime("2023-06-04T12:00:00Z")["sort"], "2023-06-04T12:00:00")

    def test_apple_photos_album_country_name_infers_gallery_country(self) -> None:
        self.assertEqual(
            infer_gallery_country({}, [], ["003-fontainebleau-france", "Fontainebleau, France"]),
            {"slug": "france", "label": "France", "source": "path_hint"},
        )


if __name__ == "__main__":
    unittest.main()
