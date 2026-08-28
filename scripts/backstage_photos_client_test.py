import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
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
import sidecar_maintenance
import sidecar_state_db
from backstage_photos_client import (
    BackstagePhotosClientError,
    request_identity_mapping,
    request_library_index,
    request_export_original,
    request_metadata_apply_many,
    request_metadata_read_many,
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
            while True:
                try:
                    connection, _ = self.socket.accept()
                except socket.timeout:
                    return
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


def success_identity_mapping_response(request: dict) -> dict:
    items = [
        {
            "localIdentifier": local_identifier,
            "cloudIdentifier": f"cloud-{index}",
            "status": "source-tied",
        }
        for index, local_identifier in enumerate(request["localIdentifiers"])
    ]
    return {
        "ok": True,
        "requestId": request["requestId"],
        "mode": "identity-map",
        "count": len(items),
        "items": items,
    }


def success_metadata_response(request: dict) -> dict:
    operation = request["operation"]
    items = []
    for item in request["requests"]:
        row = {
            "assetId": item["assetId"],
            "title": item.get("title", "Read title"),
            "caption": item.get("caption", ""),
            "keywords": item.get("keywords", ["Spain"]),
        }
        if operation == "photos.metadata-apply-many":
            row.update({
                "before": {"title": "Old", "caption": "", "keywords": []},
                "after": row.copy(),
            })
        items.append(row)
    return {
        "ok": True,
        "requestId": request["requestId"],
        "mode": operation,
        "count": len(items),
        "items": items,
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

    def test_authenticated_identity_mapping_preserves_exact_order(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            local_identifiers = ["local-a", "local-b"]
            with FakeBackstagePreviewServer(root, success_identity_mapping_response) as server:
                result = request_identity_mapping(
                    local_identifiers,
                    descriptor_path=server.descriptor,
                    timeout=1,
                )

            self.assertEqual(
                [item["localIdentifier"] for item in result["items"]],
                local_identifiers,
            )
            self.assertEqual(result["count"], 2)

    def test_authenticated_metadata_read_and_apply_batches(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            asset_ids = [f"asset-{index}" for index in range(3)]
            with FakeBackstagePreviewServer(root, success_metadata_response) as server:
                read_rows = request_metadata_read_many(
                    asset_ids,
                    descriptor_path=server.descriptor,
                    timeout=1,
                )

            self.assertEqual([row["assetId"] for row in read_rows], asset_ids)

            with TemporaryDirectory() as apply_directory:
                apply_root = Path(apply_directory)
                with FakeBackstagePreviewServer(apply_root, success_metadata_response) as server:
                    apply_rows = request_metadata_apply_many(
                        [
                            {
                                "assetId": asset_ids[0],
                                "title": "Updated",
                                "caption": "A caption",
                                "keywords": ["Spain"],
                                "managedKeywords": ["PBE:Approved"],
                            }
                        ],
                        descriptor_path=server.descriptor,
                        timeout=1,
                    )

            self.assertEqual(apply_rows[0]["assetId"], asset_ids[0])

    def test_metadata_batch_splits_at_the_authenticated_ipc_request_limit(self):
        observed = []

        def responder(request):
            observed.append(request)
            return success_metadata_response(request)

        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            requests = [
                {"assetId": f"asset-{index}", "title": "x" * 1_000}
                for index in range(20)
            ]
            with FakeBackstagePreviewServer(root, responder) as server:
                rows = request_metadata_apply_many(
                    requests,
                    descriptor_path=server.descriptor,
                    timeout=1,
                )

            self.assertEqual(len(rows), len(requests))
            self.assertGreater(len(observed), 1)
            self.assertTrue(all(len(json.dumps(request).encode("utf-8")) <= 16 * 1_024 for request in observed))

    def test_metadata_read_splits_more_than_64_items_without_reordering(self):
        observed = []

        def responder(request):
            observed.append(request)
            return success_metadata_response(request)

        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            asset_ids = [f"asset-{index}" for index in range(130)]
            with FakeBackstagePreviewServer(root, responder) as server:
                rows = request_metadata_read_many(
                    asset_ids,
                    descriptor_path=server.descriptor,
                    timeout=1,
                )

        self.assertEqual([len(request["requests"]) for request in observed], [64, 64, 2])
        self.assertEqual([row["assetId"] for row in rows], asset_ids)

    def test_metadata_apply_splits_more_than_64_items_without_reordering(self):
        observed = []

        def responder(request):
            observed.append(request)
            return success_metadata_response(request)

        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            requests = [
                {
                    "assetId": f"asset-{index}",
                    "title": f"Title {index}",
                    "caption": "",
                    "keywords": [],
                    "managedKeywords": ["PBE:Approved"],
                }
                for index in range(130)
            ]
            with FakeBackstagePreviewServer(root, responder) as server:
                rows = request_metadata_apply_many(
                    requests,
                    descriptor_path=server.descriptor,
                    timeout=1,
                )

        self.assertEqual([len(request["requests"]) for request in observed], [64, 64, 2])
        self.assertEqual(
            [row["assetId"] for row in rows],
            [request["assetId"] for request in requests],
        )

    def test_metadata_apply_isolates_invalid_item_without_poisoning_valid_batches(self):
        observed = []

        def responder(request):
            observed.append(request)
            return success_metadata_response(request)

        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            requests = [
                {
                    "assetId": f"asset-{index}",
                    "title": f"Title {index}",
                    "caption": "",
                    "keywords": ["Spain"],
                    "managedKeywords": ["PBE:Approved"],
                }
                for index in range(130)
            ]
            requests[65]["keywords"] = ["invalid\u0000keyword"]
            with FakeBackstagePreviewServer(root, responder) as server:
                rows = request_metadata_apply_many(
                    requests,
                    descriptor_path=server.descriptor,
                    timeout=1,
                )

        self.assertEqual([len(request["requests"]) for request in observed], [64, 64, 1])
        self.assertEqual([row["assetId"] for row in rows], [request["assetId"] for request in requests])
        self.assertIn("invalid_metadata_request", rows[65]["error"])
        self.assertNotIn(
            "asset-65",
            [item["assetId"] for request in observed for item in request["requests"]],
        )
        self.assertTrue(all("error" not in row for index, row in enumerate(rows) if index != 65))

    def test_authenticated_original_export_copies_and_cleans_private_staging(self):
        original = b"owner-only-original-bytes"
        observed_requests = []

        def export_response(request):
            observed_requests.append(request)
            export_root = root / "PhotosByElie Backstage" / "exports"
            export_root.mkdir(mode=0o700)
            export_root.chmod(0o700)
            staging = export_root / request["requestId"]
            staging.mkdir(parents=True, mode=0o700)
            staging.chmod(0o700)
            source = staging / "IMG_0001.JPG"
            source.write_bytes(original)
            source.chmod(0o600)
            return {
                "ok": True,
                "requestId": request["requestId"],
                "mode": "export-original",
                "assetId": request["assetId"],
                "filename": source.name,
                "originalFilename": source.name,
                "relativePath": f"{request['requestId']}/{source.name}",
                "uniformTypeIdentifier": "public.jpeg",
                "bytes": len(original),
                "checksumSHA256": hashlib.sha256(original).hexdigest(),
            }

        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            destination = root / "spool"
            with FakeBackstagePreviewServer(root, export_response) as server:
                result = request_export_original(
                    "asset-1",
                    destination,
                    allow_icloud_downloads=False,
                    descriptor_path=server.descriptor,
                    timeout=1,
                )

            target = destination / "IMG_0001.JPG"
            self.assertEqual(target.read_bytes(), original)
            self.assertEqual(oct(target.stat().st_mode & 0o777), "0o600")
            self.assertEqual(result["mode"], "materialize-one")
            self.assertEqual(result["materializedCount"], 1)
            self.assertEqual(result["items"][0]["path"], str(target))
            self.assertEqual(len(observed_requests), 1)
            self.assertEqual(observed_requests[0]["operation"], "photos.export-original")
            self.assertFalse(observed_requests[0]["allowICloudDownloads"])
            self.assertFalse(
                (
                    root
                    / "PhotosByElie Backstage"
                    / "exports"
                    / observed_requests[0]["requestId"]
                ).exists()
            )

    def test_original_export_rejects_unsafe_staging_path(self):
        def unsafe_response(request):
            return {
                "ok": True,
                "requestId": request["requestId"],
                "mode": "export-original",
                "assetId": request["assetId"],
                "filename": "photo.jpg",
                "originalFilename": "photo.jpg",
                "relativePath": "../photo.jpg",
                "uniformTypeIdentifier": "public.jpeg",
                "bytes": 1,
                "checksumSHA256": "0" * 64,
            }

        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            with FakeBackstagePreviewServer(root, unsafe_response) as server:
                with self.assertRaises(BackstagePhotosClientError) as raised:
                    request_export_original(
                        "asset-1",
                        root / "spool",
                        descriptor_path=server.descriptor,
                        timeout=1,
                    )
            self.assertEqual(raised.exception.code, "unsafe_export_source")

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

    def test_sidecar_materialization_uses_backstage_ipc_without_bridge_fallback(self):
        source = (ROOT / "scripts" / "sidecar_state_db.py").read_text(encoding="utf-8")
        self.assertIn("request_export_original", source)
        self.assertIn("_run_backstage_photos_materialize_one", source)
        self.assertNotIn("PhotosByElie Photos Bridge.app", source)
        self.assertNotIn("apple_photos_bridge.swift", source)

    def test_scheduled_ai_preview_export_uses_backstage_ipc(self):
        source = (ROOT / "scripts" / "sidecar_maintenance.py").read_text(encoding="utf-8")
        self.assertIn("request_preview", source)
        self.assertNotIn("PhotosByElie Photos Bridge.app", source)
        self.assertNotIn("_ensure_apple_photos_bridge_app", source)

        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            destination = root / "previews" / "001-photo-900.jpg"
            args = type("Args", (), {
                "repo_root": root,
                "limit": 1,
                "preview_root": root / "previews",
                "max_pixel": 900,
                "timeout": 90,
                "output": None,
            })()

            def fake_preview(_asset_id, target, _max_pixel, *, timeout):
                self.assertEqual(timeout, 60.0)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(JPEG)
                return {"ok": True, "mode": "preview"}

            with patch.object(
                sidecar_maintenance,
                "ai_metadata_plan",
                return_value={"count": 1, "items": [{"assetId": "asset-1", "filename": "photo.jpg"}]},
            ), patch.object(sidecar_maintenance, "request_preview", side_effect=fake_preview) as preview:
                exit_code = sidecar_maintenance.picked_ai_preview_export(args)

            self.assertEqual(exit_code, 0)
            preview.assert_called_once_with("asset-1", destination, 900, timeout=60.0)

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

    def test_photos_discovery_window_resumes_from_latest_index_with_overlap(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            with sidecar_state_db.connect(root) as connection:
                connection.execute(
                    """
                    INSERT INTO sidecar_assets (asset_id, source_anchor, captured_at)
                    VALUES (?, ?, ?)
                    """,
                    ("asset-newest", "photos://asset-newest", "2026-08-20T12:30:00Z"),
                )

            policy = sidecar_state_db.photos_discovery_window(
                root,
                now=datetime(2026, 8, 23, 18, 0, tzinfo=timezone.utc),
            )

            self.assertEqual(policy["mode"], "incremental")
            self.assertEqual(policy["source"], "indexed")
            self.assertEqual(policy["dateFrom"], "2026-08-13T12:30:00Z")
            self.assertEqual(policy["checkpoint"]["assetId"], "asset-newest")

    def test_photos_discovery_checkpoint_is_durable_and_never_regresses(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            with sidecar_state_db.connect(root) as connection:
                connection.execute(
                    """
                    INSERT INTO sidecar_assets (asset_id, source_anchor, captured_at)
                    VALUES (?, ?, ?)
                    """,
                    ("asset-newest", "photos://asset-newest", "2026-08-22T09:00:00Z"),
                )

            first = sidecar_state_db.record_photos_discovery_checkpoint(
                root,
                mode="incremental",
                date_from="2026-08-15T09:00:00Z",
                date_to="",
                imported_count=1,
                completed_at="2026-08-23T18:00:00Z",
            )
            with sidecar_state_db.connect(root) as connection:
                connection.execute(
                    "UPDATE sidecar_assets SET captured_at = ? WHERE asset_id = ?",
                    ("2026-08-01T09:00:00Z", "asset-newest"),
                )
            second = sidecar_state_db.record_photos_discovery_checkpoint(
                root,
                mode="incremental",
                date_from="2026-07-25T09:00:00Z",
                date_to="",
                imported_count=1,
                completed_at="2026-08-23T18:05:00Z",
            )

            self.assertEqual(first["captureDate"], "2026-08-22T09:00:00Z")
            self.assertEqual(second["captureDate"], first["captureDate"])
            resumed = sidecar_state_db.photos_discovery_window(
                root,
                now=datetime(2026, 8, 23, 19, 0, tzinfo=timezone.utc),
            )
            self.assertEqual(resumed["source"], "stored")
            self.assertEqual(resumed["dateFrom"], "2026-08-15T09:00:00Z")

    def test_incremental_index_advances_checkpoint_only_after_success(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            checkpoint = {"captureDate": "2026-08-22T09:00:00Z", "assetId": "asset-newest"}
            with patch.object(sidecar_server, "mark_invalid_source_assets_missing", return_value=0), patch.object(
                sidecar_server,
                "_write_backstage_library_index",
                return_value={"ok": True, "count": 2, "totalCount": 2},
            ), patch.object(sidecar_server, "_import_index_jsonl", return_value=(2, 0)) as importer, patch.object(
                sidecar_server,
                "record_photos_discovery_checkpoint",
                return_value=checkpoint,
            ) as record, patch.object(sidecar_server, "_summary_snapshot", return_value={"indexedCount": 2}):
                sidecar_server._run_index_job(
                    root,
                    "job-success",
                    "2026-08-15T09:00:00Z",
                    "",
                    mode="incremental",
                )

            self.assertFalse(importer.call_args.kwargs["prune_missing"])
            record.assert_called_once()
            self.assertEqual(sidecar_server.INDEX_JOB["status"], "done")
            self.assertEqual(sidecar_server.INDEX_JOB["discoveryCheckpoint"], checkpoint)

            with patch.object(sidecar_server, "mark_invalid_source_assets_missing", return_value=0), patch.object(
                sidecar_server,
                "_write_backstage_library_index",
                side_effect=RuntimeError("synthetic scan failure"),
            ), patch.object(sidecar_server, "record_photos_discovery_checkpoint") as failed_record:
                sidecar_server._run_index_job(
                    root,
                    "job-failure",
                    "2026-08-15T09:00:00Z",
                    "",
                    mode="incremental",
                )

            failed_record.assert_not_called()
            self.assertEqual(sidecar_server.INDEX_JOB["status"], "failed")
            self.assertIn("synthetic scan failure", sidecar_server.INDEX_JOB["error"])

    def test_loopback_index_start_defaults_to_incremental_and_full_is_explicit(self):
        with TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            policy = {"dateFrom": "2026-08-15T09:00:00Z"}
            with patch.object(sidecar_server, "photos_discovery_window", return_value=policy), patch.object(
                sidecar_server.threading,
                "Thread",
            ) as thread:
                sidecar_server._start_index_job(root)
            self.assertEqual(thread.call_args.kwargs["target"], sidecar_server._run_index_job)
            self.assertEqual(
                thread.call_args.kwargs["args"][2:],
                ("2026-08-15T09:00:00Z", ""),
            )
            self.assertEqual(thread.call_args.kwargs["kwargs"], {"mode": "incremental"})

            sidecar_server.INDEX_JOB["status"] = "done"
            with patch.object(sidecar_server.threading, "Thread") as thread:
                sidecar_server._start_index_job(root, full_library=True)
            self.assertEqual(thread.call_args.kwargs["args"][2:], ("", ""))
            self.assertEqual(thread.call_args.kwargs["kwargs"], {"mode": "full"})

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
