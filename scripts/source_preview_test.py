import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from scripts.local_server import _source_preview_for_media_id


class OwnerSourcePreviewTests(unittest.TestCase):
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

    def test_owner_sidecar_preview_uses_signed_photos_bridge(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            asset_id = "cloud-id:001:fixture"
            local_identifier = "A542DCF9-6A99-4579-8722-0D720724C310/L0/001"
            self._write_owner_db(root, asset_id=asset_id, local_identifier=local_identifier)

            def fake_bridge(_repo_root: Path, args: list[str], **_kwargs: object) -> dict:
                destination = Path(args[args.index("--destination") + 1])
                destination.write_bytes(b"jpeg-preview")
                return {"ok": True, "previewSource": "photokit_image_data"}

            with patch("scripts.local_server._run_apple_photos_bridge", side_effect=fake_bridge) as bridge:
                result = _source_preview_for_media_id(root, asset_id)

            self.assertTrue(result["ok"])
            self.assertEqual(result["sourceType"], "Apple Photos PhotoKit preview")
            self.assertEqual(Path(result["path"]).read_bytes(), b"jpeg-preview")
            bridge.assert_called_once()
            args = bridge.call_args.args[1]
            self.assertEqual(args[0:2], ["preview", "--asset-id"])
            self.assertEqual(args[2], local_identifier)

    def test_owner_sidecar_preview_reports_bridge_failure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            asset_id = "cloud-id:001:fixture"
            self._write_owner_db(root, asset_id=asset_id, local_identifier="local-id")

            with patch(
                "scripts.local_server._run_apple_photos_bridge",
                return_value={"ok": False, "error": "Photos access is not authorized"},
            ):
                result = _source_preview_for_media_id(root, asset_id)

            self.assertFalse(result["ok"])
            self.assertEqual(result["status"], 502)
            self.assertIn("Photos access is not authorized", result["error"])


if __name__ == "__main__":
    unittest.main()
