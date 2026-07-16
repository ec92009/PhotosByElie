#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


SCRIPT_ROOT = Path(__file__).resolve().parent
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

import import_real_estate_gallery


class RealEstateDisplayOverrideTests(unittest.TestCase):
    def _build_manifest(self, root: Path) -> tuple[dict, Path, Path, Path]:
        source_root = root / "source"
        album = source_root / "Apartment 1"
        album.mkdir(parents=True)
        original = album / "living-room.jpg"
        Image.new("RGB", (120, 80), (240, 20, 20)).save(original, "JPEG")

        approved_dir = source_root / "approved"
        approved_dir.mkdir()
        override = approved_dir / "living-room-reworked.png"
        Image.new("RGB", (40, 120), (10, 30, 240)).save(override, "PNG")
        (source_root / import_real_estate_gallery.DISPLAY_OVERRIDE_SIDECAR).write_text(
            json.dumps({"Apartment 1": {"living-room": {"path": "approved/living-room-reworked.png"}}}),
            encoding="utf-8",
        )

        output_dir = root / "output"
        overrides = import_real_estate_gallery.load_display_overrides(source_root)
        manifest = import_real_estate_gallery.build_manifest(
            repo_root=root,
            source_root=source_root,
            output_dir=output_dir,
            customer="Test Client",
            username="test-client",
            email="",
            access_code="",
            access_code_salt="",
            gallery_key="test-client-real-estate",
            gallery_title="Test Client Real Estate",
            public_key_prefix="real-estate/test-client/previews",
            private_key_prefix="real-estate/test-client/masters",
            albums=[album],
            preview_900_max_edge=900,
            preview_1800_max_edge=1800,
            preview_900_quality=84,
            preview_1800_quality=88,
            force=False,
            display_overrides=overrides,
        )
        return manifest, original, override, output_dir

    def test_previews_use_override_while_private_source_remains_original(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            manifest, original, override, output_dir = self._build_manifest(Path(temp_dir))
            photo = manifest["photos"][0]
            preview_900 = output_dir / photo["gallerySrc"]
            preview_1800 = output_dir / photo["imageSrc"]

            self.assertEqual(photo["displayVariant"], "approved-rework")
            self.assertEqual(photo["realEstate"]["sourcePath"], str(original))
            self.assertEqual(photo["realEstate"]["sourceDimensions"], {"width": 120, "height": 80})
            self.assertTrue(photo["realEstate"]["privateMasterKey"].endswith("living-room.jpg"))
            with Image.open(preview_900) as gallery_image:
                self.assertEqual(gallery_image.size, (40, 120))
                red, _green, blue = gallery_image.convert("RGB").getpixel((20, 60))
            with Image.open(preview_1800) as detail_image:
                self.assertEqual(detail_image.size, (40, 120))
            self.assertLess(red, 40)
            self.assertGreater(blue, 200)
            self.assertNotIn(str(override), json.dumps(manifest))

    def test_override_loader_rejects_missing_and_non_image_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source_root = Path(temp_dir)
            sidecar = source_root / import_real_estate_gallery.DISPLAY_OVERRIDE_SIDECAR
            sidecar.write_text(json.dumps({"Apartment 1/photo.jpg": "missing.jpg"}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "does not exist"):
                import_real_estate_gallery.load_display_overrides(source_root)

            fake_image = source_root / "not-an-image.jpg"
            fake_image.write_text("not image data", encoding="utf-8")
            sidecar.write_text(json.dumps({"Apartment 1/photo.jpg": fake_image.name}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "not a readable image"):
                import_real_estate_gallery.load_display_overrides(source_root)

    def test_gallery_wide_basename_override_is_supported(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source_root = Path(temp_dir)
            override = source_root / "approved.png"
            Image.new("RGB", (20, 30), (10, 20, 30)).save(override, "PNG")
            (source_root / import_real_estate_gallery.DISPLAY_OVERRIDE_SIDECAR).write_text(
                json.dumps({"living-room": override.name}),
                encoding="utf-8",
            )

            overrides = import_real_estate_gallery.load_display_overrides(source_root)

            self.assertEqual(
                import_real_estate_gallery.display_override_for(
                    overrides,
                    "Apartment 1",
                    source_root / "Apartment 1" / "living-room.jpg",
                ),
                override.resolve(),
            )

    def test_public_app_context_keeps_marker_but_strips_filesystem_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest, original, override, output_dir = self._build_manifest(root)

            context_path = import_real_estate_gallery.write_app_context(manifest, output_dir)
            context = context_path.read_text(encoding="utf-8")

            self.assertIn('"displayVariant": "approved-rework"', context)
            self.assertNotIn(str(root), context)
            self.assertNotIn(str(original), context)
            self.assertNotIn(str(override), context)
            self.assertNotIn('"sourceRoot"', context)
            self.assertNotIn('"sourcePath"', context)
            self.assertNotIn('"preview900Path"', context)
            self.assertNotIn('"preview1800Path"', context)
            self.assertEqual(manifest["photos"][0]["realEstate"]["sourcePath"], str(original))


if __name__ == "__main__":
    unittest.main()
