import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.sync_r2_media import UploadItem, s3_get, wrangler_get


class _Response:
    status = 200

    def __init__(self, body: bytes):
        self.body = body
        self.offset = 0

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, size=-1):
        if self.offset >= len(self.body):
            return b""
        if size < 0:
            size = len(self.body) - self.offset
        result = self.body[self.offset:self.offset + size]
        self.offset += len(result)
        return result


class R2DownloadVerificationTest(unittest.TestCase):
    def test_s3_get_streams_remote_object_to_verification_file(self):
        body = b"verified remote bytes"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            item = UploadItem("test-bucket", "fixture/photo.jpg", root / "source.jpg", "image/jpeg")
            target = root / "download.jpg"
            with patch("scripts.sync_r2_media.urllib.request.urlopen", return_value=_Response(body)):
                _, ok, _ = s3_get(
                    item, target, 0, root / "throttle", 0, 0,
                    "account", "access", "secret", "account.r2.cloudflarestorage.com",
                )
            self.assertTrue(ok)
            self.assertEqual(hashlib.sha256(target.read_bytes()).hexdigest(), hashlib.sha256(body).hexdigest())

    def test_wrangler_get_requires_a_downloaded_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            item = UploadItem("test-bucket", "fixture/photo.jpg", root / "source.jpg", "image/jpeg")
            target = root / "download.jpg"

            def run(command, **_kwargs):
                target.write_bytes(b"remote")
                return type("Result", (), {"returncode": 0, "stdout": "downloaded", "stderr": ""})()

            with patch("scripts.sync_r2_media.wrangler_command", return_value=["wrangler"]), patch(
                "scripts.sync_r2_media.subprocess.run", side_effect=run
            ):
                _, ok, _ = wrangler_get(item, target, 0, root / "throttle", 0, 0)
            self.assertTrue(ok)
            self.assertEqual(target.read_bytes(), b"remote")


if __name__ == "__main__":
    unittest.main()
