#!/usr/bin/env python3
"""Local-only Sidecar helper for Apple Photos triage."""

from __future__ import annotations

import argparse
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
from urllib.parse import parse_qs, unquote, urlparse

from sidecar_state_db import (
    ai_metadata_plan,
    apply_ai_metadata_proposals,
    commit_plan,
    empty_wastebasket,
    indexed_library_window,
    mark_missing_assets,
    merge_state,
    mock_upload,
    execute_upload_bridge_batch_item,
    finish_upload_bridge_execute_batch,
    prepare_upload_bridge_execute_batch,
    queue_upload_bridge,
    record_decision,
    record_decisions,
    sidecar_sync_status,
    summary,
    upload_bridge_plan,
    upload_plan,
    upsert_assets,
)


APPLE_PHOTOS_BRIDGE = Path("scripts/apple_photos_bridge.swift")
APPLE_PHOTOS_BRIDGE_APP_INSTALLER = Path("scripts/install_sidecar_photos_bridge_app.zsh")
APPLE_PHOTOS_BRIDGE_APP = Path.home() / "Applications" / "PhotosByElie Photos Bridge.app"
APPLE_PHOTOS_BRIDGE_APP_EXECUTABLE = APPLE_PHOTOS_BRIDGE_APP / "Contents" / "MacOS" / "PhotosByElie Photos Bridge"
SIDECAR_VERSION_FILE = Path("SIDECAR_VERSION")
SIDECAR_DEFAULT_VERSION = "125.2"
SIDECAR_PREVIEW_ROOT = Path("tmp/sidecar-previews")
SIDECAR_PREVIEW_CACHE_VERSION = "v3"
SIDECAR_VIDEO_ROOT = Path("tmp/sidecar-videos")
SIDECAR_VIDEO_CACHE_VERSION = "v1"
SIDECAR_LIBRARY_PATH = "/__sidecar/library"
SIDECAR_INDEX_WINDOW_PATH = "/__sidecar/index-window"
SIDECAR_INDEX_REFRESH_PATH = "/__sidecar/index-refresh"
SIDECAR_INDEX_STATUS_PATH = "/__sidecar/index-status"
SIDECAR_PREVIEW_PATH = "/__sidecar/preview/"
SIDECAR_VIDEO_PATH = "/__sidecar/video/"
SIDECAR_DECISION_PATH = "/__sidecar/decision"
SIDECAR_DECISIONS_PATH = "/__sidecar/decisions"
SIDECAR_SUMMARY_PATH = "/__sidecar/summary"
SIDECAR_UPLOAD_PLAN_PATH = "/__sidecar/upload-plan"
SIDECAR_AI_PLAN_PATH = "/__sidecar/ai-plan"
SIDECAR_AI_PROPOSE_PATH = "/__sidecar/ai-propose"
SIDECAR_SYNC_STATUS_PATH = "/__sidecar/sync-status"
SIDECAR_MOCK_UPLOAD_PATH = "/__sidecar/mock-upload"
SIDECAR_UPLOAD_BRIDGE_PATH = "/__sidecar/upload-bridge"
SIDECAR_UPLOAD_BRIDGE_EXECUTE_PATH = "/__sidecar/upload-bridge-execute"
SIDECAR_UPLOAD_BRIDGE_CANCEL_PATH = "/__sidecar/upload-bridge-cancel"
SIDECAR_UPLOAD_BRIDGE_PLAN_PATH = "/__sidecar/upload-bridge-plan"
SIDECAR_COMMIT_PLAN_PATH = "/__sidecar/commit-plan"
SIDECAR_VERSION_PATH = "/__sidecar/version"
SIDECAR_EMPTY_WASTEBASKET_PATH = "/__sidecar/empty-wastebasket"
SIDECAR_INDEX_ROOT = Path("tmp/sidecar-index")
SIDECAR_UPLOAD_BRIDGE_EXECUTE_LIMIT = 500
APPLE_PHOTOS_PROGRESS_PREFIX = "PBE_APPLE_PHOTOS_PROGRESS "
UPLOAD_BRIDGE_CANCEL_LOCK = threading.Lock()
UPLOAD_BRIDGE_CANCEL_REQUESTS: set[str] = set()
INDEX_JOB_LOCK = threading.Lock()
INDEX_JOB: dict = {
    "ok": True,
    "status": "idle",
    "stage": "idle",
    "jobId": "",
    "indexedCount": 0,
    "importedCount": 0,
    "totalCount": 0,
    "progress": 0,
    "error": "",
    "updatedAt": "",
}


def _set_upload_bridge_cancel_requested(upload_id: str) -> None:
    if not upload_id:
        return
    with UPLOAD_BRIDGE_CANCEL_LOCK:
        UPLOAD_BRIDGE_CANCEL_REQUESTS.add(upload_id)


def _clear_upload_bridge_cancel_requested(upload_id: str) -> None:
    if not upload_id:
        return
    with UPLOAD_BRIDGE_CANCEL_LOCK:
        UPLOAD_BRIDGE_CANCEL_REQUESTS.discard(upload_id)


def _upload_bridge_cancel_requested(upload_id: str) -> bool:
    if not upload_id:
        return False
    with UPLOAD_BRIDGE_CANCEL_LOCK:
        return upload_id in UPLOAD_BRIDGE_CANCEL_REQUESTS


def sidecar_version(repo_root: Path) -> str:
    try:
        value = (repo_root / SIDECAR_VERSION_FILE).read_text(encoding="utf-8").strip()
    except OSError:
        value = ""
    return value or SIDECAR_DEFAULT_VERSION


def _utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _set_index_job(**updates: object) -> dict:
    with INDEX_JOB_LOCK:
        INDEX_JOB.update(updates)
        INDEX_JOB["updatedAt"] = _utc_now()
        return dict(INDEX_JOB)


def _index_job_snapshot(repo_root: Path) -> dict:
    with INDEX_JOB_LOCK:
        payload = dict(INDEX_JOB)
    try:
        payload["sidecarSummary"] = summary(repo_root)
    except sqlite3.Error as error:
        payload["summaryError"] = str(error)
    payload["version"] = sidecar_version(repo_root)
    return payload


def _run_apple_photos_bridge(repo_root: Path, args: list[str], timeout: int = 900) -> dict:
    command = _apple_photos_bridge_command(repo_root, args)
    try:
        result = subprocess.run(
            command,
            cwd=repo_root,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as error:
        raise RuntimeError("Swift is required for the Apple Photos PhotoKit bridge. Install Xcode Command Line Tools.") from error
    output = (result.stdout or "").strip()
    try:
        payload = json.loads(output or "{}")
    except json.JSONDecodeError as error:
        raise RuntimeError((result.stderr or output or "Apple Photos bridge returned invalid JSON.").strip()) from error
    if result.returncode != 0 and payload.get("ok") is not False:
        return {
            "ok": False,
            "code": "photos_bridge_error",
            "error": (result.stderr or output or f"Apple Photos bridge exited {result.returncode}").strip(),
        }
    if result.stderr and payload.get("ok") is False:
        payload.setdefault("stderr", result.stderr.strip())
    return payload


def _run_apple_photos_bridge_stream(
    repo_root: Path,
    args: list[str],
    progress_handler,
) -> dict:
    command = _apple_photos_bridge_command(repo_root, args)
    try:
        process = subprocess.Popen(
            command,
            cwd=repo_root,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except FileNotFoundError as error:
        raise RuntimeError("Swift is required for the Apple Photos PhotoKit bridge. Install Xcode Command Line Tools.") from error
    stderr_lines: list[str] = []
    assert process.stderr is not None
    for line in process.stderr:
        clean = line.strip()
        if clean.startswith(APPLE_PHOTOS_PROGRESS_PREFIX):
            try:
                progress_handler(json.loads(clean[len(APPLE_PHOTOS_PROGRESS_PREFIX):]))
            except json.JSONDecodeError:
                stderr_lines.append(clean)
        elif clean:
            stderr_lines.append(clean)
    stdout = process.stdout.read() if process.stdout is not None else ""
    returncode = process.wait()
    output = (stdout or "").strip()
    try:
        payload = json.loads(output or "{}")
    except json.JSONDecodeError as error:
        raise RuntimeError(("\n".join(stderr_lines) or output or "Apple Photos bridge returned invalid JSON.").strip()) from error
    if returncode != 0 or payload.get("ok") is False:
        message = payload.get("error") or "\n".join(stderr_lines) or f"Apple Photos bridge exited {returncode}"
        raise RuntimeError(str(message).strip())
    if stderr_lines:
        payload["stderr"] = "\n".join(stderr_lines)
    return payload


def _run_apple_photos_bridge_app_index(repo_root: Path, args: list[str], destination: Path, timeout: int = 900) -> dict:
    _ensure_apple_photos_bridge_app(repo_root)
    try:
        result = subprocess.run(
            ["open", "-W", "-n", str(APPLE_PHOTOS_BRIDGE_APP), "--args", *args],
            cwd=repo_root,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as error:
        raise RuntimeError("macOS open is required to launch the bundled Apple Photos bridge.") from error
    if result.returncode != 0:
        message = (result.stderr or result.stdout or f"Apple Photos bridge app exited {result.returncode}").strip()
        raise RuntimeError(message)
    if not destination.exists() or destination.stat().st_size == 0:
        raise RuntimeError(
            "Apple Photos bridge app did not write the index file. "
            "Confirm PhotosByElie Photos Bridge has Full Access in System Settings > Privacy & Security > Photos, then retry."
        )
    total_count = 0
    with destination.open("r", encoding="utf-8") as handle:
        for total_count, _line in enumerate(handle, start=1):
            pass
    _handle_index_progress({
        "event": "library_index_done",
        "indexedCount": total_count,
        "totalCount": total_count,
        "progress": 1,
    })
    return {
        "ok": True,
        "mode": "library-index-file",
        "destination": str(destination),
        "count": total_count,
        "totalCount": total_count,
    }


def _run_apple_photos_bridge_app_task(repo_root: Path, args: list[str], timeout: int = 900) -> dict:
    _ensure_apple_photos_bridge_app(repo_root)
    result_destination = repo_root / "tmp" / "sidecar-bridge-results" / f"{uuid.uuid4().hex}.json"
    result_destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        result = subprocess.run(
            [
                "open", "-W", "-n", str(APPLE_PHOTOS_BRIDGE_APP), "--args", *args,
                "--result-destination", str(result_destination),
            ],
            cwd=repo_root,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError as error:
        raise RuntimeError("macOS open is required to launch the bundled Apple Photos bridge.") from error
    if result.returncode != 0:
        return {
            "ok": False,
            "code": "photos_bridge_app_error",
            "error": (result.stderr or result.stdout or f"Apple Photos bridge app exited {result.returncode}").strip(),
        }
    try:
        payload = json.loads(result_destination.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {
            "ok": False,
            "code": "photos_bridge_result_missing",
            "error": "Photos Bridge app exited without writing its result. Retry the preview.",
        }
    except (OSError, json.JSONDecodeError) as error:
        return {
            "ok": False,
            "code": "photos_bridge_result_invalid",
            "error": f"Photos Bridge app wrote an unreadable result: {error}",
        }
    finally:
        try:
            result_destination.unlink()
        except FileNotFoundError:
            pass
    if not isinstance(payload, dict):
        return {
            "ok": False,
            "code": "photos_bridge_result_invalid",
            "error": "Photos Bridge app returned an invalid result payload.",
        }
    if payload.get("ok") is False:
        return payload
    return payload if payload.get("ok") is True else {
        "ok": False,
        "code": "photos_bridge_result_invalid",
        "error": "Photos Bridge app returned a result without an outcome.",
    }


def _ensure_apple_photos_bridge_app(repo_root: Path) -> None:
    installer = repo_root / APPLE_PHOTOS_BRIDGE_APP_INSTALLER
    bridge_source = repo_root / APPLE_PHOTOS_BRIDGE
    if not installer.exists():
        raise RuntimeError(f"Photos Bridge app installer is missing: {installer}")
    needs_build = not APPLE_PHOTOS_BRIDGE_APP_EXECUTABLE.exists()
    if not needs_build:
        try:
            needs_build = bridge_source.stat().st_mtime > APPLE_PHOTOS_BRIDGE_APP_EXECUTABLE.stat().st_mtime
        except OSError:
            needs_build = True
    if not needs_build:
        return
    result = subprocess.run(
        ["zsh", str(installer)],
        cwd=repo_root,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        message = (result.stderr or result.stdout or f"Photos Bridge installer exited {result.returncode}").strip()
        raise RuntimeError(message)


def _apple_photos_bridge_command(repo_root: Path, args: list[str]) -> list[str]:
    override = os.environ.get("PBE_APPLE_PHOTOS_BRIDGE_EXECUTABLE", "").strip()
    if override:
        executable = Path(override).expanduser()
        if not executable.exists():
            raise RuntimeError(f"Configured Apple Photos bridge executable is missing: {executable}")
        return [str(executable), *args]

    bridge = repo_root / APPLE_PHOTOS_BRIDGE
    if not bridge.exists():
        raise RuntimeError(f"Apple Photos bridge is missing: {bridge}")
    return ["swift", str(bridge), *args]


def _int_query(query: dict[str, list[str]], name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int((query.get(name) or [""])[0] or default)
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


def _text_query(query: dict[str, list[str]], *names: str) -> str:
    for name in names:
        value = str((query.get(name) or [""])[0] or "").strip()
        if value:
            return value
    return ""


def _list_query(query: dict[str, list[str]], *names: str) -> list[str]:
    values: list[str] = []
    for name in names:
        for value in query.get(name) or []:
            values.extend(part.strip() for part in str(value or "").split(",") if part.strip())
    return values


def _asset_id_from_row(row: dict) -> str:
    return str(row.get("localIdentifier") or row.get("asset_id") or row.get("assetId") or "").strip()


def _handle_index_progress(payload: dict) -> None:
    event = str(payload.get("event") or "")
    total = int(payload.get("totalCount") or 0)
    indexed = int(payload.get("indexedCount") or 0)
    progress = float(payload.get("progress") or (indexed / total if total else 0))
    if event == "library_index_start":
        _set_index_job(
            status="running",
            stage="Scanning Apple Photos metadata",
            indexedCount=0,
            totalCount=total,
            progress=0,
            error="",
        )
    elif event == "library_index_progress":
        _set_index_job(
            status="running",
            stage="Scanning Apple Photos metadata",
            indexedCount=indexed,
            totalCount=total,
            progress=max(0, min(1, progress)),
        )
    elif event == "library_index_done":
        _set_index_job(
            status="running",
            stage="Importing metadata into Sidecar",
            indexedCount=indexed,
            totalCount=total,
            progress=1,
        )


def _import_index_jsonl(repo_root: Path, path: Path, total_count: int, prune_missing: bool) -> tuple[int, int]:
    imported = 0
    present_ids: list[str] = []
    batch: list[dict] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            clean = line.strip()
            if not clean:
                continue
            row = json.loads(clean)
            if not isinstance(row, dict):
                continue
            asset_id = _asset_id_from_row(row)
            if asset_id:
                present_ids.append(asset_id)
            batch.append(row)
            if len(batch) >= 500:
                upsert_assets(repo_root, batch)
                imported += len(batch)
                batch = []
                _set_index_job(
                    status="running",
                    stage="Importing metadata into Sidecar",
                    importedCount=imported,
                    totalCount=total_count,
                    progress=(imported / total_count if total_count else 1),
                )
        if batch:
            upsert_assets(repo_root, batch)
            imported += len(batch)
            _set_index_job(
                status="running",
                stage="Importing metadata into Sidecar",
                importedCount=imported,
                totalCount=total_count,
                progress=(imported / total_count if total_count else 1),
            )
    missing_count = mark_missing_assets(repo_root, present_ids) if prune_missing and present_ids else 0
    return imported, missing_count


def _run_index_job(repo_root: Path, job_id: str, date_from: str = "", date_to: str = "") -> None:
    index_dir = repo_root / SIDECAR_INDEX_ROOT
    index_path = index_dir / f"photos-index-{int(time.time())}-{job_id}.jsonl"
    try:
        _set_index_job(
            ok=True,
            status="running",
            stage="Starting Apple Photos metadata scan",
            jobId=job_id,
            indexedCount=0,
            importedCount=0,
            totalCount=0,
            progress=0,
            error="",
            destination=str(index_path),
            startedAt=_utc_now(),
            completedAt="",
            missingMarkedCount=0,
        )
        args = [
            "library-index-file",
            "--destination",
            str(index_path),
            "--progress-every",
            "100",
        ]
        if date_from:
            args.extend(["--date-from", date_from])
        if date_to:
            args.extend(["--date-to", date_to])
        bridge_payload = _run_apple_photos_bridge_app_index(repo_root, args, index_path)
        total_count = int(bridge_payload.get("totalCount") or bridge_payload.get("count") or 0)
        imported, missing_count = _import_index_jsonl(repo_root, index_path, total_count, prune_missing=not date_from and not date_to)
        _set_index_job(
            ok=True,
            status="done",
            stage="Complete",
            indexedCount=int(bridge_payload.get("count") or imported),
            importedCount=imported,
            totalCount=total_count,
            progress=1,
            completedAt=_utc_now(),
            missingMarkedCount=missing_count,
            sidecarSummary=summary(repo_root),
        )
    except Exception as error:
        _set_index_job(
            ok=True,
            status="failed",
            stage="Failed",
            error=str(error),
            completedAt=_utc_now(),
        )


def _start_index_job(repo_root: Path, date_from: str = "", date_to: str = "") -> dict:
    with INDEX_JOB_LOCK:
        if INDEX_JOB.get("status") == "running":
            return dict(INDEX_JOB)
    job_id = uuid.uuid4().hex[:12]
    _set_index_job(
        ok=True,
        status="running",
        stage="Queued Apple Photos metadata scan",
        jobId=job_id,
        indexedCount=0,
        importedCount=0,
        totalCount=0,
        progress=0,
        error="",
        startedAt=_utc_now(),
        completedAt="",
    )
    thread = threading.Thread(target=_run_index_job, args=(repo_root, job_id, date_from, date_to), daemon=True)
    thread.start()
    return _index_job_snapshot(repo_root)


def _preview_cache_path(repo_root: Path, asset_id: str, max_pixel: int) -> Path:
    digest = hashlib.sha256(asset_id.encode("utf-8")).hexdigest()[:24]
    return repo_root / SIDECAR_PREVIEW_ROOT / f"{digest}_{max_pixel}_{SIDECAR_PREVIEW_CACHE_VERSION}.jpg"


def _video_cache_stem(repo_root: Path, asset_id: str) -> Path:
    digest = hashlib.sha256(asset_id.encode("utf-8")).hexdigest()[:24]
    return repo_root / SIDECAR_VIDEO_ROOT / f"{digest}_{SIDECAR_VIDEO_CACHE_VERSION}"


def _video_cache_candidates(stem: Path) -> list[Path]:
    return sorted(path for path in stem.parent.glob(f"{stem.name}.*") if path.is_file())


class SidecarHandler(SimpleHTTPRequestHandler):
    server_version = "PhotosByElieSidecar/0.1"

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == SIDECAR_VERSION_PATH:
            self._handle_version()
            return
        if path == SIDECAR_SUMMARY_PATH:
            self._handle_summary()
            return
        if path == SIDECAR_INDEX_STATUS_PATH:
            self._handle_index_status()
            return
        if path == SIDECAR_INDEX_WINDOW_PATH:
            self._handle_index_window()
            return
        if path == SIDECAR_LIBRARY_PATH:
            self._handle_library()
            return
        if path.startswith(SIDECAR_PREVIEW_PATH):
            self._handle_preview(path)
            return
        if path.startswith(SIDECAR_VIDEO_PATH):
            self._handle_video(path)
            return
        if path == SIDECAR_UPLOAD_PLAN_PATH:
            self._handle_upload_plan()
            return
        if path == SIDECAR_UPLOAD_BRIDGE_PLAN_PATH:
            self._handle_upload_bridge_plan()
            return
        if path == SIDECAR_AI_PLAN_PATH:
            self._handle_ai_plan()
            return
        if path == SIDECAR_SYNC_STATUS_PATH:
            self._handle_sync_status()
            return
        if path == SIDECAR_COMMIT_PLAN_PATH:
            self._handle_commit_plan()
            return
        super().do_GET()

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == SIDECAR_DECISION_PATH:
            self._handle_decision()
            return
        if path == SIDECAR_DECISIONS_PATH:
            self._handle_decisions()
            return
        if path == SIDECAR_EMPTY_WASTEBASKET_PATH:
            self._handle_empty_wastebasket()
            return
        if path in {SIDECAR_MOCK_UPLOAD_PATH, SIDECAR_UPLOAD_BRIDGE_PATH}:
            self._handle_upload_bridge()
            return
        if path == SIDECAR_UPLOAD_BRIDGE_EXECUTE_PATH:
            self._handle_upload_bridge_execute()
            return
        if path == SIDECAR_UPLOAD_BRIDGE_CANCEL_PATH:
            self._handle_upload_bridge_cancel()
            return
        if path == SIDECAR_INDEX_REFRESH_PATH:
            self._handle_index_refresh()
            return
        if path == SIDECAR_AI_PROPOSE_PATH:
            self._handle_ai_propose()
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def end_headers(self) -> None:
        path = self.path.split("?", 1)[0]
        if path in {"", "/", "/sidecar.html"} or path.startswith("/__sidecar/"):
            self.send_header("Cache-Control", "no-cache, max-age=0, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def _is_loopback_request(self) -> bool:
        host = self.client_address[0]
        return host in {"127.0.0.1", "::1"} or host == "localhost"

    def _send_json(self, status: HTTPStatus, payload: dict) -> None:
        data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json_body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            length = 0
        raw = self.rfile.read(max(0, length))
        if not raw:
            return {}
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as error:
            raise ValueError("Request body must be JSON.") from error
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        return payload

    def _include_summary(self, payload: dict | None = None) -> bool:
        query = parse_qs(urlparse(self.path).query)
        raw_values = query.get("summary") or query.get("includeSummary") or query.get("include_summary") or []
        raw = raw_values[0] if raw_values else None
        if raw is None and payload is not None:
            raw = payload.get("includeSummary", payload.get("include_summary", True))
        return str(raw).strip().lower() not in {"0", "false", "no", "off"}

    def _handle_version(self) -> None:
        self._send_json(HTTPStatus.OK, {"ok": True, "version": sidecar_version(Path.cwd())})

    def _handle_summary(self) -> None:
        try:
            payload = {**summary(Path.cwd()), "version": sidecar_version(Path.cwd())}
        except sqlite3.Error as error:  # type: ignore[name-defined]
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, payload)

    def _handle_index_status(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        self._send_json(HTTPStatus.OK, _index_job_snapshot(Path.cwd()))

    def _handle_index_refresh(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = self._read_json_body()
            date_from = str(payload.get("dateFrom") or payload.get("date_from") or "").strip()
            date_to = str(payload.get("dateTo") or payload.get("date_to") or "").strip()
            result = _start_index_job(Path.cwd(), date_from=date_from, date_to=date_to)
        except Exception as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, result)

    def _handle_index_window(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        query = parse_qs(urlparse(self.path).query)
        limit = _int_query(query, "limit", 120, 1, 5000)
        offset = _int_query(query, "offset", 0, 0, 1_000_000)
        date_from = _text_query(query, "dateFrom", "date_from", "from")
        date_to = _text_query(query, "dateTo", "date_to", "to")
        ratings = _list_query(query, "rating", "ratings")
        colors = _list_query(query, "color", "colors")
        pick_states = _list_query(query, "pickState", "pick_state", "pickStates", "pick_states")
        media_types = _list_query(query, "mediaType", "media_type", "mediaTypes", "media_types")
        search = _text_query(query, "q", "search", "query")
        try:
            payload = indexed_library_window(
                Path.cwd(),
                offset=offset,
                limit=limit,
                date_from=date_from,
                date_to=date_to,
                ratings=ratings,
                colors=colors,
                pick_states=pick_states,
                media_types=media_types,
                search=search,
            )
            payload["version"] = sidecar_version(Path.cwd())
            payload["indexStatus"] = _index_job_snapshot(Path.cwd())
        except Exception as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, payload)

    def _handle_library(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        query = parse_qs(urlparse(self.path).query)
        limit = _int_query(query, "limit", 120, 1, 1000)
        offset = _int_query(query, "offset", 0, 0, 1_000_000)
        args = ["library-index", "--limit", str(limit), "--offset", str(offset)]
        date_from = _text_query(query, "dateFrom", "date_from", "from")
        date_to = _text_query(query, "dateTo", "date_to", "to")
        if date_from:
            args.extend(["--date-from", date_from])
        if date_to:
            args.extend(["--date-to", date_to])
        try:
            payload = _run_apple_photos_bridge(Path.cwd(), args)
            if payload.get("ok"):
                rows = [row for row in payload.get("items") or [] if isinstance(row, dict)]
                upsert_assets(Path.cwd(), rows)
                payload["items"] = merge_state(Path.cwd(), rows)
                payload["sidecarSummary"] = summary(Path.cwd())
                payload["version"] = sidecar_version(Path.cwd())
        except Exception as error:
            self._send_json(HTTPStatus.BAD_GATEWAY, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK if payload.get("ok") else HTTPStatus.BAD_GATEWAY, payload)

    def _handle_preview(self, path: str) -> None:
        if not self._is_loopback_request():
            self.send_error(HTTPStatus.FORBIDDEN, "localhost-only endpoint")
            return
        query = parse_qs(urlparse(self.path).query)
        max_pixel = _int_query(query, "maxPixel", 900, 256, 1800)
        asset_id = unquote(path[len(SIDECAR_PREVIEW_PATH):])
        if not asset_id:
            self.send_error(HTTPStatus.BAD_REQUEST, "missing asset id")
            return
        cache_path = _preview_cache_path(Path.cwd(), asset_id, max_pixel)
        if not cache_path.exists():
            payload = _run_apple_photos_bridge_app_task(
                Path.cwd(),
                ["preview", "--asset-id", asset_id, "--destination", str(cache_path), "--max-pixel", str(max_pixel)],
                timeout=60,
            )
            if not payload.get("ok"):
                self._send_json(HTTPStatus.BAD_GATEWAY, payload)
                return
            if not cache_path.exists():
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {
                    "ok": False,
                    "code": "preview_cache_missing",
                    "error": "Photos Bridge app did not create the preview cache file.",
                })
                return
        try:
            data = cache_path.read_bytes()
        except OSError as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _handle_video(self, path: str) -> None:
        if not self._is_loopback_request():
            self.send_error(HTTPStatus.FORBIDDEN, "localhost-only endpoint")
            return
        asset_id = unquote(path[len(SIDECAR_VIDEO_PATH):])
        if not asset_id:
            self.send_error(HTTPStatus.BAD_REQUEST, "missing asset id")
            return
        stem = _video_cache_stem(Path.cwd(), asset_id)
        candidates = _video_cache_candidates(stem)
        video_path = candidates[0] if candidates else None
        payload: dict = {}
        if video_path is None:
            payload = _run_apple_photos_bridge_app_task(
                Path.cwd(),
                ["video", "--asset-id", asset_id, "--destination", str(stem)],
                timeout=120,
            )
            if not payload.get("ok"):
                self._send_json(HTTPStatus.BAD_GATEWAY, payload)
                return
            candidates = _video_cache_candidates(stem)
            video_path = candidates[0] if candidates else None
        if video_path is None or not video_path.exists():
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": "Video cache file was not created."})
            return
        content_type = str(payload.get("mimeType") or mimetypes.guess_type(video_path.name)[0] or "application/octet-stream")
        self._send_ranged_file(video_path, content_type)

    def _send_ranged_file(self, path: Path, content_type: str) -> None:
        size = path.stat().st_size
        start = 0
        end = size - 1
        range_header = self.headers.get("Range") or ""
        status = HTTPStatus.OK
        if range_header.startswith("bytes="):
            spec = range_header.removeprefix("bytes=").split(",", 1)[0].strip()
            if "-" in spec:
                left, right = spec.split("-", 1)
                try:
                    if left:
                        start = int(left)
                        end = int(right) if right else end
                    elif right:
                        suffix = int(right)
                        start = max(0, size - suffix)
                except ValueError:
                    self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                    return
                start = max(0, min(start, size - 1))
                end = max(start, min(end, size - 1))
                status = HTTPStatus.PARTIAL_CONTENT
        length = max(0, end - start + 1)
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        with path.open("rb") as handle:
            handle.seek(start)
            remaining = length
            while remaining > 0:
                chunk = handle.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def _handle_decision(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = self._read_json_body()
            result = record_decision(Path.cwd(), payload)
            if self._include_summary(payload):
                result["summary"] = summary(Path.cwd())
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        except Exception as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, result)

    def _handle_decisions(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = self._read_json_body()
            decisions = payload.get("decisions") or []
            if not isinstance(decisions, list):
                raise ValueError("decisions must be a JSON array.")
            if len(decisions) > 500:
                raise ValueError("Sidecar batch decisions are limited to 500 rows.")
            result = record_decisions(Path.cwd(), decisions)
            if self._include_summary(payload):
                result["summary"] = summary(Path.cwd())
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        except Exception as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, result)

    def _handle_empty_wastebasket(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            result = empty_wastebasket(Path.cwd())
        except Exception as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, result)

    def _handle_upload_plan(self) -> None:
        query = parse_qs(urlparse(self.path).query)
        limit = _int_query(query, "limit", 500, 1, 5000)
        try:
            result = upload_plan(Path.cwd(), limit=limit)
        except Exception as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, result)

    def _handle_upload_bridge_plan(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        query = parse_qs(urlparse(self.path).query)
        limit = _int_query(query, "limit", 500, 1, 5000)
        try:
            result = upload_bridge_plan(Path.cwd(), limit=limit)
        except Exception as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, result)

    def _handle_ai_plan(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        query = parse_qs(urlparse(self.path).query)
        limit = _int_query(query, "limit", 200, 1, 5000)
        try:
            result = ai_metadata_plan(Path.cwd(), limit=limit)
            result["version"] = sidecar_version(Path.cwd())
        except Exception as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, result)

    def _handle_ai_propose(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = self._read_json_body()
            asset_ids = payload.get("assetIds") or payload.get("asset_ids") or []
            if not isinstance(asset_ids, list):
                raise ValueError("assetIds must be a JSON array.")
            if len(asset_ids) > 500:
                raise ValueError("Foreground AI proposal batches are limited to 500 rows.")
            limit = int(payload.get("limit") or len(asset_ids) or 20)
            max_rung = str(payload.get("maxRung") or payload.get("max_rung") or "filename-gps").strip()
            result = apply_ai_metadata_proposals(Path.cwd(), limit=limit, max_rung=max_rung, asset_ids=asset_ids)
            result["version"] = sidecar_version(Path.cwd())
            if self._include_summary(payload):
                result["summary"] = summary(Path.cwd())
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        except Exception as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, result)

    def _handle_sync_status(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        query = parse_qs(urlparse(self.path).query)
        limit = _int_query(query, "limit", 80, 1, 500)
        try:
            result = sidecar_sync_status(Path.cwd(), limit=limit)
            result["version"] = sidecar_version(Path.cwd())
        except Exception as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, result)

    def _handle_upload_bridge(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = self._read_json_body()
            asset_ids = payload.get("assetIds") or []
            if not isinstance(asset_ids, list):
                raise ValueError("assetIds must be a JSON array.")
            limit = int(payload.get("limit") or 500)
            if self.path.split("?", 1)[0] == SIDECAR_MOCK_UPLOAD_PATH:
                result = mock_upload(Path.cwd(), asset_ids=asset_ids, limit=limit)
            else:
                result = queue_upload_bridge(Path.cwd(), asset_ids=asset_ids, limit=limit)
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        except Exception as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, result)

    def _write_ndjson_event(self, payload: dict) -> None:
        self.wfile.write((json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))
        self.wfile.flush()

    def _handle_upload_bridge_execute(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = self._read_json_body()
            requested_count = int(payload.get("count") or payload.get("limit") or 1)
            requested_count = max(1, min(requested_count, SIDECAR_UPLOAD_BRIDGE_EXECUTE_LIMIT))
            upload_id = str(payload.get("uploadId") or payload.get("upload_id") or uuid.uuid4().hex)
            allow_overwrite = bool(payload.get("allowR2Overwrite") or payload.get("allow_r2_overwrite"))
            allow_icloud_downloads = payload.get("allowIcloudDownloads", payload.get("allow_icloud_downloads", True)) is not False
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        except Exception as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-cache, max-age=0, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.end_headers()

        totals = {
            "requestedCount": requested_count,
            "completedCount": 0,
            "uploadedItemCount": 0,
            "failedItemCount": 0,
            "uploadedKeyCount": 0,
            "skippedCollisionCount": 0,
            "failedUploadCount": 0,
        }
        _clear_upload_bridge_cancel_requested(upload_id)
        self._write_ndjson_event({
            "ok": True,
            "event": "start",
            "uploadId": upload_id,
            "count": requested_count,
            "message": f"Starting Upload Bridge real upload for up to {requested_count} item(s).",
        })
        self._write_ndjson_event({
            "ok": True,
            "event": "planning",
            "uploadId": upload_id,
            "count": requested_count,
            "message": "Planning Upload Bridge batch and checking R2 coverage once.",
        })
        try:
            batch = prepare_upload_bridge_execute_batch(
                Path.cwd(),
                limit=requested_count,
                allow_r2_overwrite=allow_overwrite,
            )
        except Exception as error:  # noqa: BLE001 - stream setup failure to the UI.
            totals["failedItemCount"] += 1
            self._write_ndjson_event({
                "ok": False,
                "event": "error",
                "uploadId": upload_id,
                "index": 0,
                "count": requested_count,
                "error": str(error),
                "totals": totals,
            })
            self._write_ndjson_event({
                "ok": False,
                "event": "done",
                "uploadId": upload_id,
                "status": "failed",
                "cancelled": False,
                "totals": totals,
                "message": f"Upload Bridge failed during batch planning: {error}",
            })
            _clear_upload_bridge_cancel_requested(upload_id)
            return

        batch_items = batch.get("items") or []
        batch_summary = batch.get("summary") or {}
        batch_run_id = str(batch.get("runId") or "")
        totals["requestedCount"] = len(batch_items) if batch_items else requested_count
        self._write_ndjson_event({
            "ok": bool(batch.get("ok")),
            "event": "planned",
            "uploadId": upload_id,
            "runId": batch_run_id,
            "count": len(batch_items),
            "requestedCount": requested_count,
            "summary": batch_summary,
            "message": batch.get("message") or "",
        })
        if not batch_items:
            try:
                plan = upload_plan(Path.cwd(), limit=500)
            except Exception as error:  # noqa: BLE001
                plan = {"ok": False, "error": str(error)}
            self._write_ndjson_event({
                "ok": True,
                "event": "done",
                "uploadId": upload_id,
                "runId": batch_run_id,
                "status": str(batch.get("status") or "done"),
                "cancelled": False,
                "totals": totals,
                "uploadPlan": plan,
                "message": batch.get("message") or "No Upload Bridge rows were available.",
            })
            _clear_upload_bridge_cancel_requested(upload_id)
            return

        canceled = False
        terminal_error = ""
        for index, planned_item in enumerate(batch_items):
            if _upload_bridge_cancel_requested(upload_id):
                canceled = True
                self._write_ndjson_event({
                    "ok": True,
                    "event": "cancelled",
                    "uploadId": upload_id,
                    "index": index + 1,
                    "count": len(batch_items),
                    "totals": totals,
                    "message": "Upload Bridge interrupt requested; stopped before starting the next item.",
                })
                break
            self._write_ndjson_event({
                "ok": True,
                "event": "item-start",
                "uploadId": upload_id,
                "index": index + 1,
                "count": len(batch_items),
                "item": {
                    "assetId": planned_item.get("assetId") or "",
                    "photoId": planned_item.get("photoId") or "",
                    "filename": planned_item.get("filename") or "",
                    "mediaType": planned_item.get("mediaType") or "",
                },
                "message": f"Uploading item {index + 1} of {len(batch_items)}.",
            })
            try:
                result = execute_upload_bridge_batch_item(
                    Path.cwd(),
                    run_id=batch_run_id,
                    run_root=Path(str(batch.get("spoolRoot") or "")),
                    export_root=Path(str(batch.get("exportRoot") or "")),
                    item=planned_item,
                    allow_icloud_downloads=allow_icloud_downloads,
                    allow_r2_overwrite=allow_overwrite,
                )
            except Exception as error:  # noqa: BLE001 - stream the failure to the UI.
                totals["failedItemCount"] += 1
                totals["failedUploadCount"] += 1
                terminal_error = str(error)
                self._write_ndjson_event({
                    "ok": False,
                    "event": "error",
                    "uploadId": upload_id,
                    "index": index + 1,
                    "count": len(batch_items),
                    "error": str(error),
                    "totals": totals,
                })
                break

            summary_payload = result.get("summary") or {}
            item = (result.get("items") or [{}])[0] if result.get("items") else {}
            uploaded_keys = int(summary_payload.get("uploadedKeyCount") or 0)
            skipped_keys = int(summary_payload.get("skippedCollisionCount") or 0)
            failed_keys = int(summary_payload.get("failedUploadCount") or 0)
            failed_items = int(summary_payload.get("failedCount") or 0)
            status = str(result.get("status") or "")
            item_failed = bool(item) and (failed_items > 0 or status in {"export_failed", "upload_failed"} or not result.get("ok"))
            item_uploaded = bool(item) and status in {"uploaded", "uploaded_with_skips"} and not item_failed
            totals["completedCount"] += 1 if item else 0
            totals["uploadedItemCount"] += 1 if item_uploaded else 0
            totals["failedItemCount"] += 1 if item_failed else 0
            totals["uploadedKeyCount"] += uploaded_keys
            totals["skippedCollisionCount"] += skipped_keys
            totals["failedUploadCount"] += failed_keys
            self._write_ndjson_event({
                "ok": bool(result.get("ok")),
                "event": "item-complete",
                "uploadId": upload_id,
                "index": index + 1,
                "count": len(batch_items),
                "status": status,
                "runId": result.get("runId") or "",
                "item": {
                    "assetId": item.get("assetId") or "",
                    "photoId": item.get("photoId") or "",
                    "filename": item.get("filename") or "",
                    "mediaType": item.get("mediaType") or "",
                    "status": item.get("status") or status,
                    "export": item.get("export") or {},
                    "upload": item.get("upload") or {},
                    "timings": item.get("timings") or {},
                },
                "summary": summary_payload,
                "totals": totals,
                "message": result.get("message") or "",
            })
            if status == "upload_failed" or failed_keys:
                terminal_error = str((item.get("upload") or {}).get("error") or "Upload Bridge R2 upload failed.")
                break
            if not result.get("ok") and status != "export_failed":
                terminal_error = result.get("message") or f"Upload Bridge item failed with status {status}."
                break

        try:
            plan = upload_plan(Path.cwd(), limit=500)
        except Exception as error:  # noqa: BLE001 - progress is more important than final plan refresh.
            plan = {"ok": False, "error": str(error)}
        final_verb = "interrupted" if canceled else "finished"
        batch_status = "cancelled" if canceled else ("completed_with_failures" if terminal_error or totals["failedItemCount"] else "completed")
        final_summary = {
            **batch_summary,
            **totals,
            "uploadId": upload_id,
            "cancelled": canceled,
            "terminalError": terminal_error,
        }
        if batch_run_id:
            try:
                finish_upload_bridge_execute_batch(
                    Path.cwd(),
                    run_id=batch_run_id,
                    status=batch_status,
                    summary=final_summary,
                    error_text=terminal_error,
                )
            except Exception as error:  # noqa: BLE001 - do not hide upload results behind finalization.
                final_summary["finalizeError"] = str(error)
        final_message = (
            f"Upload Bridge {final_verb}: {totals['completedCount']} processed item(s), "
            f"{totals['uploadedItemCount']} uploaded item(s), "
            f"{totals['uploadedKeyCount']} uploaded key(s), "
            f"{totals['skippedCollisionCount']} skipped collision key(s), "
            f"{totals['failedItemCount']} failed item(s), "
            f"{totals['failedUploadCount']} failed key(s)."
        )
        self._write_ndjson_event({
            "ok": canceled or not terminal_error,
            "event": "done",
            "uploadId": upload_id,
            "runId": batch_run_id,
            "status": batch_status,
            "cancelled": canceled,
            "totals": totals,
            "summary": final_summary,
            "uploadPlan": plan,
            "message": final_message,
        })
        _clear_upload_bridge_cancel_requested(upload_id)

    def _handle_upload_bridge_cancel(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = self._read_json_body()
            upload_id = str(payload.get("uploadId") or payload.get("upload_id") or "").strip()
            if not upload_id:
                raise ValueError("uploadId is required.")
            _set_upload_bridge_cancel_requested(upload_id)
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        except Exception as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, {
            "ok": True,
            "uploadId": upload_id,
            "message": "Upload Bridge interrupt requested. The current item will finish before the run stops.",
        })

    def _handle_commit_plan(self) -> None:
        query = parse_qs(urlparse(self.path).query)
        limit = _int_query(query, "limit", 500, 1, 5000)
        try:
            result = commit_plan(Path.cwd(), limit=limit)
        except Exception as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, result)

def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the local Photos By Elie Sidecar prototype.")
    parser.add_argument("port", type=int, nargs="?", default=8011)
    parser.add_argument("--bind", default="127.0.0.1")
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.bind, args.port), SidecarHandler)
    print(f"Photos By Elie Sidecar v{sidecar_version(Path.cwd())}: http://{args.bind}:{args.port}/sidecar.html")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nSidecar stopped.", file=sys.stderr)


if __name__ == "__main__":
    main()
