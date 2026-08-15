import base64
import json
import os
from pathlib import Path
import socket
import struct
import sys
import threading
import time
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import backstage_photos_client
from backstage_photos_client import (
    BackstagePhotosClientError,
    request_library_index,
    request_preview,
)
import sidecar_server


JPEG = b"\xff\xd8bounded-preview\xff\xd9"


class FakeBackstagePreviewServer:
    def __init__(self, root: Path, responder):
        self.root = root
        self.responder = responder
        self.token = "a" * 64
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.socket.bind(("127.0.0.1", 0))
        self.socket.listen(1)
        self.socket.settimeout(1)
        self.port = self.socket.getsockname()[1]
        self.descriptor_directory = root / "PhotosByElie Backstage"
        self.descriptor = self.descriptor_directory / "photos-preview-ipc.json"
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.error = None

    def __enter__(self):
        self.descriptor_directory.mkdir(mode=0o700)
        self.descriptor.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "host": "127.0.0.1",
                    "port": self.port,
                    "pid": os.getpid(),
                    "bearerToken": self.token,
                    "startedAtEpoch": time.time(),
                }
            ),
            encoding="utf-8",
        )
        self.descriptor.chmod(0o600)
        self.thread.start()
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.socket.close()
        self.thread.join(timeout=1)
        if self.error is not None and exc_type is None:
            raise self.error

    @staticmethod
    def _read_exact(connection: socket.socket, count: int) -> bytes:
        data = b""
        while len(data) < count:
            chunk = connection.recv(count - len(data))
            if not chunk:
                raise RuntimeError("client closed request early")
            data += chunk
        return data

    def _serve(self):
        try:
            connection, _ = self.socket.accept()
            with connection:
                length = struct.unpack("!I", self._read_exact(connection, 4))[0]
                request = json.loads(self._read_exact(connection, length))
                response = self.responder(request)
                if isinstance(response, tuple):
                    declared_length, payload = response
                else:
                    payload = json.dumps(response, separators=(",", ":")).encode("utf-8")
                    declared_length = len(payload)
                connection.sendall(struct.pack("!I", declared_length) + payload)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        except Exception as error:  # pragma: no cover - surfaced by __exit__
            self.error = error


def success_response(request: dict) -> dict:
    return {
        "ok": True,
        "requestId": request["requestId"],
        "mode": "preview",
        "assetId": request["assetId"],
        "bytes": len(JPEG),
        "pixelWidth": 900,
        "pixelHeight": 600,
        "mimeType": "image/jpeg",
        "dataBase64": base64.b64encode(JPEG).decode("ascii"),
    }


def success_library_response(request: dict) -> dict:
    return {
        "ok": True,
        "requestId": request["requestId"],
        "mode": "library-index",
        "limit": request["limit"],
        "offset": request["offset"],
        "count": 1,
        "fetchedCount": request["offset"] + 1,
        "skippedCount": request["offset"],
        "items": [{"assetId": "asset-1", "mediaType": "photo", "filename": "one.jpg"}],
    }


class BackstagePhotosClientTest(unittest.TestCase):
    def test_authenticated_preview_is_written_atomically(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            destination = root / "cache" / "preview.jpg"
            with FakeBackstagePreviewServer(root, success_response) as server:
                result = request_preview(
                    "asset-1",
                    destination,
                    900,
                    descriptor_path=server.descriptor,
                    timeout=1,
                )

            self.assertEqual(destination.read_bytes(), JPEG)
            self.assertEqual(result["bytes"], len(JPEG))
            self.assertEqual(result["pixelWidth"], 900)
            self.assertEqual(oct(destination.stat().st_mode & 0o777), "0o600")
            self.assertEqual(list(destination.parent.glob(".*.tmp")), [])

    def test_authenticated_library_index_returns_a_bounded_page(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            with FakeBackstagePreviewServer(root, success_library_response) as server:
                result = request_library_index(
                    2,
                    3,
                    date_from="2026-01-01",
                    date_to="2026-08-15",
                    descriptor_path=server.descriptor,
                    timeout=1,
                )

            self.assertTrue(result["ok"])
            self.assertEqual(result["mode"], "library-index")
            self.assertEqual(result["count"], 1)
            self.assertEqual(result["items"][0]["assetId"], "asset-1")

    def test_library_index_arguments_fail_closed_before_descriptor_access(self):
        with TemporaryDirectory() as temporary_directory:
            missing = Path(temporary_directory) / "missing.json"
            for arguments, expected_code in [
                ((0, 0), "invalid_library_limit"),
                ((1, -1), "invalid_library_offset"),
                ((1, 0), "invalid_library_date"),
            ]:
                with self.subTest(expected_code=expected_code):
                    kwargs = {"descriptor_path": missing, "timeout": 1}
                    if expected_code == "invalid_library_date":
                        kwargs["date_from"] = "bad\u0001date"
                    with self.assertRaises(BackstagePhotosClientError) as raised:
                        request_library_index(*arguments, **kwargs)
                    self.assertEqual(raised.exception.code, expected_code)

    def test_server_error_preserves_existing_destination(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            destination = root / "preview.jpg"
            destination.write_bytes(b"existing")

            def reject(request):
                return {
                    "ok": False,
                    "requestId": request["requestId"],
                    "mode": "preview",
                    "error": {"code": "preview_unavailable", "message": "Synthetic failure."},
                }

            with FakeBackstagePreviewServer(root, reject) as server:
                with self.assertRaises(BackstagePhotosClientError) as raised:
                    request_preview(
                        "asset-1",
                        destination,
                        900,
                        descriptor_path=server.descriptor,
                        timeout=1,
                    )

            self.assertEqual(raised.exception.code, "preview_unavailable")
            self.assertEqual(destination.read_bytes(), b"existing")

    def test_timeout_fails_closed_without_writing(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            destination = root / "preview.jpg"

            def slow_response(request):
                time.sleep(0.2)
                return success_response(request)

            with FakeBackstagePreviewServer(root, slow_response) as server:
                with self.assertRaises(BackstagePhotosClientError) as raised:
                    request_preview(
                        "asset-1",
                        destination,
                        900,
                        descriptor_path=server.descriptor,
                        timeout=0.03,
                    )

            self.assertEqual(raised.exception.code, "ipc_timeout")
            self.assertFalse(destination.exists())

    def test_oversized_and_mismatched_responses_are_rejected(self):
        cases = {
            "response_oversized": lambda request: (
                backstage_photos_client.MAX_RESPONSE_BYTES + 1,
                b"",
            ),
            "invalid_response": lambda request: {
                **success_response(request),
                "requestId": "00000000-0000-0000-0000-000000000000",
            },
        }
        for expected_code, responder in cases.items():
            with self.subTest(expected_code=expected_code), TemporaryDirectory() as temporary_directory:
                root = Path(temporary_directory)
                with FakeBackstagePreviewServer(root, responder) as server:
                    with self.assertRaises(BackstagePhotosClientError) as raised:
                        request_preview(
                            "asset-1",
                            root / "preview.jpg",
                            900,
                            descriptor_path=server.descriptor,
                            timeout=1,
                        )
                self.assertEqual(raised.exception.code, expected_code)

    def test_unsafe_descriptor_permissions_are_rejected_before_connecting(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            descriptor_directory = root / "PhotosByElie Backstage"
            descriptor_directory.mkdir(mode=0o700)
            descriptor = descriptor_directory / "photos-preview-ipc.json"
            descriptor.write_text("{}", encoding="utf-8")
            descriptor.chmod(0o644)

            with self.assertRaises(BackstagePhotosClientError) as raised:
                request_preview(
                    "asset-1",
                    root / "preview.jpg",
                    900,
                    descriptor_path=descriptor,
                    timeout=1,
                )

            self.assertEqual(raised.exception.code, "unsafe_descriptor")

    def test_control_characters_are_rejected_before_descriptor_access(self):
        with TemporaryDirectory() as temporary_directory:
            with self.assertRaises(BackstagePhotosClientError) as raised:
                request_preview(
                    "asset\u007f-one",
                    Path(temporary_directory) / "preview.jpg",
                    900,
                    descriptor_path=Path(temporary_directory) / "missing.json",
                    timeout=1,
                )

            self.assertEqual(raised.exception.code, "invalid_asset_id")

    def test_sidecar_preview_has_no_standalone_bridge_fallback(self):
        source = (ROOT / "scripts" / "sidecar_server.py").read_text(encoding="utf-8")
        preview_handler = source.split("    def _handle_preview", 1)[1].split(
            "    def _handle_video", 1
        )[0]
        self.assertIn("_run_backstage_photos_preview", preview_handler)
        self.assertNotIn("_run_apple_photos_bridge", preview_handler)

    def test_sidecar_library_uses_backstage_ipc_without_standalone_bridge_fallback(self):
        source = (ROOT / "scripts" / "sidecar_server.py").read_text(encoding="utf-8")
        library_handler = source.split("    def _handle_library", 1)[1].split(
            "    def _handle_preview", 1
        )[0]
        self.assertIn("_run_backstage_photos_library_index", library_handler)
        self.assertNotIn("_run_apple_photos_bridge", library_handler)

    def test_sidecar_source_video_route_is_retired_without_bridge_fallback(self):
        source = (ROOT / "scripts" / "sidecar_server.py").read_text(encoding="utf-8")
        get_handler = source.split("    def do_GET", 1)[1].split("    def do_POST", 1)[0]
        video_handler = source.split("    def _handle_video", 1)[1].split(
            "    def _handle_decision", 1
        )[0]
        self.assertIn("SIDECAR_VIDEO_PATH", get_handler)
        self.assertIn("HTTPStatus.GONE", video_handler)
        self.assertIn('"source_video_unsupported"', video_handler)
        self.assertNotIn("_run_apple_photos_bridge_app_task", video_handler)
        self.assertNotIn("_video_cache_", source)

    def test_background_index_streams_backstage_pages(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            destination = root / "index" / "photos.jsonl"
            responses = {
                0: {
                    "ok": True,
                    "items": [{"assetId": "asset-1"}, {"assetId": "asset-2"}],
                },
                2: {"ok": True, "items": [{"assetId": "asset-3"}]},
            }

            def page(_limit, offset, **_kwargs):
                return responses[offset]

            with patch.object(sidecar_server, "_run_backstage_photos_library_index", side_effect=page):
                result = sidecar_server._write_backstage_library_index(
                    root,
                    destination,
                    job_id="job-1",
                    page_size=2,
                )

            self.assertEqual(result["count"], 3)
            self.assertEqual(
                [json.loads(line)["assetId"] for line in destination.read_text(encoding="utf-8").splitlines()],
                ["asset-1", "asset-2", "asset-3"],
            )

    def test_background_index_job_has_no_standalone_library_bridge_path(self):
        source = (ROOT / "scripts" / "sidecar_server.py").read_text(encoding="utf-8")
        index_job = source.split("def _run_index_job", 1)[1].split("def _start_index_job", 1)[0]
        self.assertIn("_write_backstage_library_index", index_job)
        self.assertNotIn("_run_apple_photos_bridge", index_job)

    def test_connector_preview_task_adapts_to_backstage_ipc_inside_runtime(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            destination = root / "tmp" / "preview.jpg"
            with patch.object(
                sidecar_server,
                "_run_backstage_photos_preview",
                return_value={"ok": True, "mode": "preview"},
            ) as preview:
                result = sidecar_server._run_backstage_photos_preview_task(
                    root,
                    [
                        "preview",
                        "--asset-id",
                        "asset-1",
                        "--destination",
                        str(destination),
                        "--max-pixel",
                        "480",
                    ],
                    timeout=90,
                )

            self.assertEqual(result["ok"], True)
            preview.assert_called_once_with(
                "asset-1",
                destination.resolve(),
                480,
                timeout=60.0,
            )

    def test_connector_preview_task_rejects_bridge_arguments_and_escape_paths(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            with patch.object(sidecar_server, "_run_backstage_photos_preview") as preview:
                bridge_argument = sidecar_server._run_backstage_photos_preview_task(
                    root,
                    [
                        "preview",
                        "--asset-id",
                        "asset-1",
                        "--destination",
                        str(root / "preview.jpg"),
                        "--result-destination",
                        str(root / "result.json"),
                    ],
                )
                escaped = sidecar_server._run_backstage_photos_preview_task(
                    root,
                    [
                        "preview",
                        "--asset-id",
                        "asset-1",
                        "--destination",
                        str(root.parent / "outside.jpg"),
                        "--max-pixel",
                        "480",
                    ],
                )

            self.assertEqual(bridge_argument["code"], "invalid_preview_arguments")
            self.assertEqual(escaped["code"], "unsafe_preview_destination")
            preview.assert_not_called()

    def test_connector_loader_does_not_select_standalone_bridge_preview_task(self):
        source = (ROOT / "scripts" / "new_owner_connector.py").read_text(encoding="utf-8")
        loader = source.split("def _load_local_modules", 1)[1].split(
            "def _load_lifecycle_gateway", 1
        )[0]
        self.assertIn("_run_backstage_photos_preview_task", loader)
        self.assertNotIn("_run_apple_photos_bridge_app_task", loader)


if __name__ == "__main__":
    unittest.main()
