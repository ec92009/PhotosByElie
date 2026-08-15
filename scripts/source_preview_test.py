import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

try:
    from .backstage_photos_client import BackstagePhotosClientError
except ImportError:
    from backstage_photos_client import BackstagePhotosClientError  # type: ignore
import scripts.local_server as local_server
from scripts.local_server import SOURCE_PREVIEW_PATH, _source_preview_for_media_id, _source_preview_media_id_from_path


class OwnerSourcePreviewTests(unittest.TestCase):
    def test_source_preview_path_preserves_encoded_trailing_slash(self) -> None:
        media_id = "cloud-id:001:fixture/"
        encoded_path = SOURCE_PREVIEW_PATH + "cloud-id%3A001%3Afixture%2F"

        self.assertEqual(_source_preview_media_id_from_path(encoded_path), media_id)

    def _write_owner_db(self, root: Path, *, asset_id: str, local_identifier: str) -> None:
        database = root / "assets/owner-actions/Owner.sqlite"
        database.parent.mkdir(parents=True)
        with sqlite3.connect(database) as connection:
            connection.execute(
                """
                CREATE TABLE sidecar_assets (
                    asset_id TEXT PRIMARY KEY,
                    source_anchor TEXT NOT NULL,
                    media_type TEXT,
                    filename TEXT,
                    photos_title TEXT,
                    metadata_seed_title TEXT,
                    raw_json TEXT NOT NULL DEFAULT '{}'
                )
                """
            )
            connection.execute(
                """
                INSERT INTO sidecar_assets (
                    asset_id, source_anchor, media_type, filename,
                    photos_title, metadata_seed_title, raw_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    asset_id,
                    "apple-photos://" + local_identifier,
                    "photo",
                    "IMG_4307.jpg",
                    "2026 Paris Musee D'Orsay",
                    "",
                    json.dumps({
                        "localIdentifier": local_identifier,
                        "preferredResourceFilename": "IMG_4307.HEIC",
                    }),
                ),
            )

    def test_owner_sidecar_preview_uses_backstage_preview_ipc(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            asset_id = "cloud-id:001:fixture"
            local_identifier = "A542DCF9-6A99-4579-8722-0D720724C310/L0/001"
            self._write_owner_db(root, asset_id=asset_id, local_identifier=local_identifier)

            def fake_preview(photo_id, destination, max_pixel, *, timeout):
                self.assertEqual(photo_id, local_identifier)
                self.assertEqual(max_pixel, 900)
                self.assertEqual(timeout, 60.0)
                destination.write_bytes(b"jpeg-preview")
                return {"ok": True, "mode": "preview"}

            with patch("scripts.local_server.request_preview", side_effect=fake_preview) as request:
                result = _source_preview_for_media_id(root, asset_id)

            self.assertTrue(result["ok"])
            self.assertEqual(result["sourceType"], "Apple Photos PhotoKit preview")
            self.assertEqual(Path(result["path"]).read_bytes(), b"jpeg-preview")
            request.assert_called_once()

    def test_owner_sidecar_preview_reports_backstage_ipc_failure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            asset_id = "cloud-id:001:fixture"
            self._write_owner_db(root, asset_id=asset_id, local_identifier="local-id")

            with patch(
                "scripts.local_server.request_preview",
                side_effect=BackstagePhotosClientError("ipc_unavailable", "Backstage is not running"),
            ):
                result = _source_preview_for_media_id(root, asset_id)

            self.assertFalse(result["ok"])
            self.assertEqual(result["status"], 502)
            self.assertIn("Backstage is not running", result["error"])

    def test_owner_sidecar_preview_reuses_cached_preview(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            asset_id = "cloud-id:001:fixture"
            self._write_owner_db(root, asset_id=asset_id, local_identifier="local-id")

            def fake_preview(_photo_id, destination, _max_pixel, **_kwargs):
                Path(destination).write_bytes(b"jpeg-preview")
                return {"ok": True, "mode": "preview"}

            with patch("scripts.local_server.request_preview", side_effect=fake_preview) as request:
                first = _source_preview_for_media_id(root, asset_id)
                second = _source_preview_for_media_id(root, asset_id)

            self.assertTrue(first["ok"])
            self.assertTrue(second["ok"])
            self.assertEqual(request.call_count, 1)

    def test_owner_sidecar_preview_rejects_control_character_asset_id(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            asset_id = "cloud-id:001:fixture"
            self._write_owner_db(root, asset_id=asset_id, local_identifier="local\x7f-id")

            result = _source_preview_for_media_id(root, asset_id)

            self.assertFalse(result["ok"])
            self.assertEqual(result["status"], 502)
            self.assertIn("asset ID", result["error"])
            cache_path = root / local_server.SOURCE_PREVIEW_CACHE_ROOT / (
                "apple-photos-" + hashlib.sha256(asset_id.encode()).hexdigest()[:32] + ".jpg"
            )
            self.assertFalse(cache_path.exists())

    def test_owner_source_preview_contains_no_standalone_bridge_fallback(self) -> None:
        source = Path(local_server.__file__).read_text(encoding="utf-8")
        start = source.index("def _apple_photos_source_preview")
        end = source.index("def _source_preview_public_fallback", start)
        source_preview = source[start:end]

        self.assertIn("request_preview", source_preview)
        self.assertNotIn("_run_apple_photos_bridge", source_preview)


if __name__ == "__main__":
    unittest.main()
