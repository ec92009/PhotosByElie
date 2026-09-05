#!/usr/bin/env python3
"""Local-only Sidecar helper for Apple Photos triage."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import threading
import time
import uuid
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:
    from .local_http_security import LocalHttpSecurityMixin
except ImportError:
    from local_http_security import LocalHttpSecurityMixin

from backstage_photos_client import (
    BackstagePhotosClientError,
    request_library_index,
    request_preview,
)

from sidecar_state_db import (
    ai_metadata_plan,
    apply_ai_metadata_proposals,
    commit_plan,
    empty_wastebasket,
    indexed_library_window,
    mark_missing_assets,
    merge_state,
    mirror_cloud_decisions,
    mock_upload,
    execute_upload_bridge_batch_item,
    finish_upload_bridge_execute_batch,
    prepare_upload_bridge_execute_batch,
    queue_upload_bridge,
    record_decision,
    record_decisions,
    sidecar_sync_status,
    summary,
    is_jpeg_source_row,
    mark_invalid_source_assets_missing,
    photos_discovery_window,
    record_photos_discovery_checkpoint,
    upload_bridge_plan,
    upload_plan,
    upsert_assets,
)
from fixture_pipeline import get_pool, pool_asset_ids
from streaming_fixture_delivery import finalize_streamed_upload_batch


DEFAULT_CONNECTOR_CONFIG_PATH = Path.home() / ".config" / "photosbyelie" / "connector.json"
SIDECAR_VERSION_FILE = Path("SIDECAR_VERSION")
SIDECAR_DEFAULT_VERSION = "125.2"
SIDECAR_PREVIEW_ROOT = Path("tmp/sidecar-previews")
SIDECAR_PREVIEW_CACHE_VERSION = "v3"
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
UPLOAD_BRIDGE_CANCEL_LOCK = threading.Lock()
UPLOAD_BRIDGE_CANCEL_REQUESTS: set[str] = set()
SUMMARY_CACHE_LOCK = threading.Lock()
SUMMARY_CACHE_TTL_SECONDS = 60.0
SUMMARY_CACHE: dict[str, object] = {}
INDEX_JOB_LOCK = threading.Lock()
INDEX_JOB: dict = {
    "ok": True,
    "status": "idle",
    "stage": "idle",
    "jobId": "",
    "indexedCount": 0,
    "importedCount": 0,
    "totalCount": 0,
    "invalidSourceMarkedCount": 0,
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


def _invalidate_summary_cache() -> None:
    with SUMMARY_CACHE_LOCK:
        SUMMARY_CACHE.clear()


def _summary_snapshot(repo_root: Path, force: bool = False) -> dict:
    cache_key = str(repo_root.resolve())
    now = time.monotonic()
    with SUMMARY_CACHE_LOCK:
        cached = SUMMARY_CACHE.get("payload")
        if (
            not force
            and SUMMARY_CACHE.get("repoRoot") == cache_key
            and isinstance(cached, dict)
            and now - float(SUMMARY_CACHE.get("createdAt") or 0) < SUMMARY_CACHE_TTL_SECONDS
        ):
            return dict(cached)
        payload = summary(repo_root)
        SUMMARY_CACHE.update({"repoRoot": cache_key, "createdAt": now, "payload": dict(payload)})
        return payload


def _set_index_job(**updates: object) -> dict:
    with INDEX_JOB_LOCK:
        INDEX_JOB.update(updates)
        INDEX_JOB["updatedAt"] = _utc_now()
        return dict(INDEX_JOB)


def _index_job_snapshot(repo_root: Path) -> dict:
    with INDEX_JOB_LOCK:
        payload = dict(INDEX_JOB)
    try:
        sidecar_summary = _summary_snapshot(repo_root)
        payload["sidecarSummary"] = sidecar_summary
        if payload.get("status") != "running":
            payload["indexedCount"] = int(sidecar_summary.get("indexedCount") or 0)
            payload["importedCount"] = int(sidecar_summary.get("indexedCount") or 0)
            payload["totalCount"] = int(sidecar_summary.get("indexedCount") or 0)
            payload["progress"] = 1 if sidecar_summary.get("indexedCount") else 0
    except sqlite3.Error as error:
        payload["summaryError"] = str(error)
    payload["version"] = sidecar_version(repo_root)
    return payload


def _run_backstage_photos_preview(
    asset_id: str,
    destination: Path,
    max_pixel: int,
    timeout: float = 60,
) -> dict:
    """Request one still preview from the already-running Backstage app."""

    try:
        return request_preview(
            asset_id,
            destination,
            max_pixel,
            timeout=timeout,
        )
    except BackstagePhotosClientError as error:
        return error.as_payload()


def _run_backstage_photos_library_index(
    limit: int,
    offset: int,
    date_from: str = "",
    date_to: str = "",
    timeout: float = 300,
) -> dict:
    """Request one bounded PhotoKit index page from the running Backstage app."""

    try:
        return request_library_index(
            limit,
            offset,
            date_from=date_from or None,
            date_to=date_to or None,
            timeout=min(300.0, max(0.1, float(timeout))),
        )
    except BackstagePhotosClientError as error:
        return error.as_payload(mode="library-index")


def _run_backstage_photos_preview_task(
    repo_root: Path,
    args: list[str],
    timeout: int = 900,
) -> dict:
    """Adapt the legacy preview task shape to Backstage-owned Photos IPC.

    Connector callers still pass the historical ``preview`` argument shape,
    but this adapter deliberately accepts no Bridge-specific command or
    destination. The destination must remain inside the connector runtime so
    an IPC failure cannot turn an internal caller into an arbitrary file
    writer.
    """

    def failure(code: str, message: str) -> dict:
        return {"ok": False, "mode": "preview", "code": code, "error": message}

    if not args or args[0] != "preview" or len(args[1:]) % 2:
        return failure(
            "invalid_preview_arguments",
            "Backstage preview tasks require preview, --asset-id, --destination, and --max-pixel.",
        )

    values: dict[str, str] = {}
    allowed = {"--asset-id", "--destination", "--max-pixel"}
    for index in range(1, len(args), 2):
        name = args[index]
        value = args[index + 1]
        if name not in allowed or name in values or not value:
            return failure("invalid_preview_arguments", "Backstage preview task arguments are invalid.")
        values[name] = value

    asset_id = values.get("--asset-id", "")
    destination_text = values.get("--destination", "")
    max_pixel_text = values.get("--max-pixel", "")
    if not asset_id or not destination_text or not max_pixel_text:
        return failure(
            "invalid_preview_arguments",
            "Backstage preview tasks require an asset ID, destination, and max-pixel value.",
        )
    try:
        max_pixel = int(max_pixel_text)
    except ValueError:
        return failure("invalid_max_pixel", "Backstage preview max-pixel must be an integer.")
    if not 256 <= max_pixel <= 1_800:
        return failure("invalid_max_pixel", "Backstage preview max-pixel must be between 256 and 1800.")

    root = repo_root.expanduser().resolve()
    destination = Path(destination_text).expanduser()
    if not destination.is_absolute():
        destination = root / destination
    try:
        destination = destination.resolve()
        destination.relative_to(root)
    except (OSError, ValueError):
        return failure(
            "unsafe_preview_destination",
            "Backstage preview destinations must remain inside the connector runtime.",
        )

    return _run_backstage_photos_preview(
        asset_id,
        destination,
        max_pixel,
        timeout=min(60.0, max(0.1, float(timeout))),
    )


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
    return str(row.get("assetId") or row.get("cloudIdentifier") or row.get("asset_id") or row.get("localIdentifier") or "").strip()


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
            if not is_jpeg_source_row(row):
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


def _write_backstage_library_index(
    repo_root: Path,
    index_path: Path,
    *,
    date_from: str = "",
    date_to: str = "",
    job_id: str = "",
    page_size: int = 200,
) -> dict:
    """Stream bounded Backstage IPC pages into the existing JSONL importer."""

    if not 1 <= page_size <= 1_000:
        raise ValueError("Backstage library-index page size is out of bounds.")
    index_path.parent.mkdir(parents=True, exist_ok=True)
    offset = 0
    total_count = 0
    source_census: dict[str, Any] = {}
    with index_path.open("w", encoding="utf-8") as stream:
        while True:
            payload = _run_backstage_photos_library_index(
                page_size,
                offset,
                date_from=date_from,
                date_to=date_to,
                timeout=300,
            )
            if payload.get("ok") is not True:
                code = str(payload.get("code") or "library_index_failed")
                message = str(payload.get("error") or "Backstage could not index the Photos library.")
                raise RuntimeError(f"{code}: {message}")
            if not source_census:
                source_census = {
                    "photosMediaItemCount": int(payload.get("photosMediaItemCount") or 0),
                    "photosImageCount": int(payload.get("photosImageCount") or 0),
                    "photosVideoCount": int(payload.get("photosVideoCount") or 0),
                    "eligibleStillCount": int(payload.get("eligibleStillCount") or 0),
                    "excludedStillCount": int(payload.get("excludedStillCount") or 0),
                    "excludedStillFormatCounts": payload.get("excludedStillFormatCounts") or {},
                }
            rows = [
                row for row in payload.get("items") or []
                if isinstance(row, dict) and is_jpeg_source_row(row)
            ]
            for row in rows:
                stream.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
            stream.flush()
            total_count += len(rows)
            offset += len(rows)
            _set_index_job(
                status="running",
                stage=f"Indexing through Backstage ({total_count} assets)",
                jobId=job_id,
                indexedCount=total_count,
                importedCount=0,
                totalCount=total_count,
                progress=0,
                error="",
            )
            if not rows or len(rows) < page_size:
                break
            if offset >= 1_000_000:
                raise RuntimeError("Backstage library-index exceeded the safe offset limit.")
    return {
        "ok": True,
        "mode": "library-index",
        "count": total_count,
        "totalCount": total_count,
        **source_census,
    }


def _run_index_job(
    repo_root: Path,
    job_id: str,
    date_from: str = "",
    date_to: str = "",
    *,
    mode: str = "range",
) -> None:
    index_dir = repo_root / SIDECAR_INDEX_ROOT
    index_path = index_dir / f"photos-index-{int(time.time())}-{job_id}.jsonl"
    invalid_source_count = 0
    try:
        invalid_source_count = mark_invalid_source_assets_missing(repo_root)
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
            invalidSourceMarkedCount=invalid_source_count,
            mode=mode,
            dateFrom=date_from,
            dateTo=date_to,
        )
        index_payload = _write_backstage_library_index(
            repo_root,
            index_path,
            date_from=date_from,
            date_to=date_to,
            job_id=job_id,
        )
        total_count = int(index_payload.get("totalCount") or index_payload.get("count") or 0)
        imported, missing_count = _import_index_jsonl(repo_root, index_path, total_count, prune_missing=not date_from and not date_to)
        _invalidate_summary_cache()
        completed_at = _utc_now()
        checkpoint = (
            record_photos_discovery_checkpoint(
                repo_root,
                mode=mode,
                date_from=date_from,
                date_to=date_to,
                imported_count=imported,
                completed_at=completed_at,
            )
            if mode in {"incremental", "full"}
            else {}
        )
        _set_index_job(
            ok=True,
            status="done",
            stage="Complete",
            indexedCount=int(index_payload.get("count") or imported),
            importedCount=imported,
            totalCount=total_count,
            progress=1,
            completedAt=completed_at,
            missingMarkedCount=missing_count,
            invalidSourceMarkedCount=invalid_source_count,
            photosMediaItemCount=int(index_payload.get("photosMediaItemCount") or 0),
            photosImageCount=int(index_payload.get("photosImageCount") or 0),
            photosVideoCount=int(index_payload.get("photosVideoCount") or 0),
            eligibleStillCount=int(index_payload.get("eligibleStillCount") or total_count),
            excludedStillCount=int(index_payload.get("excludedStillCount") or 0),
            excludedStillFormatCounts=index_payload.get("excludedStillFormatCounts") or {},
            mode=mode,
            dateFrom=date_from,
            dateTo=date_to,
            discoveryCheckpoint=checkpoint,
            sidecarSummary=_summary_snapshot(repo_root, force=True),
        )
    except Exception as error:
        _set_index_job(
            ok=True,
            status="failed",
            stage="Failed",
            error=str(error),
            completedAt=_utc_now(),
            invalidSourceMarkedCount=invalid_source_count,
            mode=mode,
            dateFrom=date_from,
            dateTo=date_to,
        )


def _start_index_job(
    repo_root: Path,
    date_from: str = "",
    date_to: str = "",
    *,
    full_library: bool = False,
) -> dict:
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
    if full_library and (date_from or date_to):
        raise ValueError("full Photos reconciliation cannot include date bounds")
    if full_library:
        mode = "full"
    elif date_from or date_to:
        mode = "range"
    else:
        policy = photos_discovery_window(repo_root)
        mode = "incremental"
        date_from = str(policy["dateFrom"])
    thread = threading.Thread(
        target=_run_index_job,
        args=(repo_root, job_id, date_from, date_to),
        kwargs={"mode": mode},
        daemon=True,
    )
    thread.start()
    return _index_job_snapshot(repo_root)


def _preview_cache_path(repo_root: Path, asset_id: str, max_pixel: int) -> Path:
    digest = hashlib.sha256(asset_id.encode("utf-8")).hexdigest()[:24]
    return repo_root / SIDECAR_PREVIEW_ROOT / f"{digest}_{max_pixel}_{SIDECAR_PREVIEW_CACHE_VERSION}.jpg"


def _sidecar_cloud_config() -> dict[str, str]:
    worker_base = os.environ.get("PBE_OWNER_WORKER_BASE", "").strip().rstrip("/")
    token = os.environ.get("PBE_OWNER_CONNECTOR_TOKEN", "").strip()
    connector_id = os.environ.get("PBE_OWNER_CONNECTOR_ID", "").strip()
    config_path = Path(os.environ.get("PBE_OWNER_CONNECTOR_CONFIG", "") or DEFAULT_CONNECTOR_CONFIG_PATH).expanduser()
    if not (worker_base and token):
        try:
            payload = json.loads(config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            payload = {}
        worker_base = worker_base or str(payload.get("workerBase") or "").strip().rstrip("/")
        token = token or str(payload.get("token") or "").strip()
        connector_id = connector_id or str(payload.get("connectorId") or "").strip()
    if not worker_base or not token:
        return {}
    return {
        "workerBase": worker_base,
        "token": token,
        "connectorId": connector_id,
    }


def _sidecar_cloud_request(method: str, path: str, payload: dict | None = None, timeout: int = 30) -> dict:
    config = _sidecar_cloud_config()
    if not config:
        raise RuntimeError("Sidecar cloud decision state is not configured on this Mac connector.")
    data = None if payload is None else json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    mutation_headers = (
        {"Idempotency-Key": f"sidecar-{uuid.uuid4().hex}"}
        if method.upper() not in {"GET", "HEAD", "OPTIONS"} and path.startswith("/api/v1/")
        else {}
    )
    request = Request(
        f"{config['workerBase']}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {config['token']}",
            "Accept": "application/json",
            "User-Agent": f"PhotosByElie-Sidecar/{sidecar_version(Path.cwd())}",
            **({"Content-Type": "application/json"} if data is not None else {}),
            **mutation_headers,
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8") or "{}")
    except HTTPError as error:
        try:
            detail = json.loads(error.read().decode("utf-8") or "{}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            detail = {}
        message = detail.get("error", {}).get("message") if isinstance(detail.get("error"), dict) else detail.get("error")
        raise RuntimeError(message or f"Owner Worker returned HTTP {error.code} for {path}.") from error
    except (URLError, OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Owner Worker request failed for {path}: {error}") from error
    if body.get("ok") is False or body.get("error"):
        error = body.get("error")
        message = error.get("message") if isinstance(error, dict) else str(error)
        raise RuntimeError(message or "Owner Worker Sidecar request failed.")
    return body


def _sidecar_cloud_enabled() -> bool:
    return bool(_sidecar_cloud_config())


def _query_cloud_decisions(asset_ids: list[str]) -> dict[str, dict]:
    clean_ids = [str(asset_id or "").strip() for asset_id in asset_ids if str(asset_id or "").strip()]
    if not clean_ids or not _sidecar_cloud_enabled():
        return {}
    body = _sidecar_cloud_request("POST", "/api/v1/sidecar/decisions/query", {"assetIds": clean_ids})
    decisions = body.get("decisions") if isinstance(body.get("decisions"), dict) else {}
    return {str(asset_id): state for asset_id, state in decisions.items() if isinstance(state, dict)}


def _cloud_state_item(result: dict) -> dict:
    state = result.get("state") if isinstance(result.get("state"), dict) else {}
    before = result.get("before") if isinstance(result.get("before"), dict) else {}
    asset_id = str(result.get("assetId") or state.get("assetId") or "").strip()
    return {
        "ok": True,
        "assetId": asset_id,
        "state": state,
        "before": before,
        "changedFamilies": list(result.get("changedFamilies") or []),
        "pendingSyncCount": int(result.get("pendingSyncCount") or state.get("pendingSyncCount") or 0),
    }


def _sync_ai_proposal_states_to_cloud(repo_root: Path, result: dict) -> dict:
    """Keep cloud-canonical Sidecar state aligned with local AI proposal audit."""
    if not _sidecar_cloud_enabled():
        return {"ok": False, "configured": False}
    asset_ids = []
    for key in ("proposed", "skipped"):
        for item in result.get(key) or []:
            asset_id = str(item.get("assetId") or "").strip() if isinstance(item, dict) else ""
            if asset_id and asset_id not in asset_ids:
                asset_ids.append(asset_id)
    if not asset_ids:
        return {"ok": True, "configured": True, "count": 0}
    local_rows = merge_state(repo_root, [{"assetId": asset_id} for asset_id in asset_ids])
    decisions = []
    for row in local_rows:
        asset_id = str(row.get("assetId") or "").strip()
        if not asset_id:
            continue
        state = dict(row.get("sidecarState") or {})
        for field in (
            "tombstoneState", "tombstone_state", "tombstoneReason",
            "tombstone_reason", "tombstonedAt", "tombstoned_at",
        ):
            state.pop(field, None)
        decisions.append({"assetId": asset_id, "state": state})
    if not decisions:
        return {"ok": True, "configured": True, "count": 0}
    try:
        body = _sidecar_cloud_request(
            "POST",
            "/api/v1/sidecar/decisions/upsert",
            {"decisions": decisions},
            timeout=60,
        )
    except Exception as error:  # noqa: BLE001 - preserve local audit while surfacing cloud drift.
        return {"ok": False, "configured": True, "error": str(error)}
    mirrored_items = body.get("items") if isinstance(body.get("items"), list) else []
    if mirrored_items:
        mirror_cloud_decisions(
            repo_root,
            [
                {"assetId": item.get("assetId"), "state": item.get("state") or item}
                for item in mirrored_items
                if isinstance(item, dict) and item.get("assetId")
            ],
        )
    return {"ok": True, "configured": True, "count": len(decisions)}


def _overlay_cloud_decisions(repo_root: Path, payload: dict) -> dict:
    items = payload.get("items") if isinstance(payload.get("items"), list) else []
    if not items or not _sidecar_cloud_enabled():
        payload["sidecarCloud"] = {"ok": False, "configured": False}
        return payload
    asset_ids = [str(item.get("assetId") or item.get("localIdentifier") or "").strip() for item in items if isinstance(item, dict)]
    try:
        decisions = _query_cloud_decisions(asset_ids)
        mirror_error = ""
        if decisions:
            try:
                mirror_cloud_decisions(repo_root, decisions.values())
            except Exception as error:  # noqa: BLE001 - display should not depend on the cache write.
                mirror_error = str(error)
        for item in items:
            if not isinstance(item, dict):
                continue
            asset_id = str(item.get("assetId") or item.get("localIdentifier") or "").strip()
            state = decisions.get(asset_id)
            if not state:
                continue
            local_pending_count = int(
                item.get("pendingSyncCount")
                or (item.get("sidecarState") or {}).get("pendingSyncCount")
                or 0
            )
            item["sidecarState"] = {**state, "pendingSyncCount": local_pending_count}
            item["tombstoneState"] = str(state.get("tombstoneState") or "")
            item["pendingSyncCount"] = local_pending_count
        payload["sidecarCloud"] = {"ok": True, "configured": True, "count": len(decisions), **({"mirrorError": mirror_error} if mirror_error else {})}
    except Exception as error:  # noqa: BLE001 - window reads should still show the local index.
        payload["sidecarCloud"] = {"ok": False, "configured": True, "error": str(error)}
    return payload


class SidecarHandler(LocalHttpSecurityMixin, SimpleHTTPRequestHandler):
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
            self._send_json(HTTPStatus.FORBIDDEN, {
                "ok": False, "error": "Legacy library indexing is disabled; use Backstage.",
            })
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
        self._send_json(HTTPStatus.FORBIDDEN, {
            "ok": False, "error": "Legacy Sidecar HTTP mutations are disabled; use Backstage.",
        })

    def end_headers(self) -> None:
        path = self.path.split("?", 1)[0]
        immutable_media = path.startswith(SIDECAR_PREVIEW_PATH)
        if not immutable_media and (path in {"", "/", "/sidecar.html"} or path.startswith("/__sidecar/")):
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
            payload = {**_summary_snapshot(Path.cwd()), "version": sidecar_version(Path.cwd())}
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
            mode = str(payload.get("mode") or "").strip().casefold()
            full_library = bool(payload.get("fullLibrary") or payload.get("full_library")) or mode == "full"
            result = _start_index_job(
                Path.cwd(),
                date_from=date_from,
                date_to=date_to,
                full_library=full_library,
            )
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
        pool_id = _text_query(query, "poolId", "pool_id", "pool")
        try:
            fixture_scope = None
            scoped_asset_ids = None
            if pool_id:
                fixture_scope = get_pool(Path.cwd(), pool_id)
                scoped_asset_ids = pool_asset_ids(Path.cwd(), pool_id)
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
                asset_ids=scoped_asset_ids,
                include_summary=False,
            )
            payload = _overlay_cloud_decisions(Path.cwd(), payload)
            payload["sidecarSummary"] = _summary_snapshot(Path.cwd())
            payload["version"] = sidecar_version(Path.cwd())
            payload["indexStatus"] = _index_job_snapshot(Path.cwd())
            if fixture_scope:
                payload["fixtureScope"] = {
                    "poolId": fixture_scope["poolId"],
                    "fixtureId": fixture_scope["fixtureId"],
                    "name": fixture_scope["name"],
                    "breadcrumbs": fixture_scope["breadcrumbs"],
                    "snapshotAssetCount": fixture_scope["assetCount"],
                    "createdAt": fixture_scope["createdAt"],
                }
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
        date_from = _text_query(query, "dateFrom", "date_from", "from")
        date_to = _text_query(query, "dateTo", "date_to", "to")
        try:
            payload = _run_backstage_photos_library_index(
                limit,
                offset,
                date_from=date_from,
                date_to=date_to,
            )
            if payload.get("ok"):
                rows = [
                    row for row in payload.get("items") or []
                    if isinstance(row, dict) and is_jpeg_source_row(row)
                ]
                upsert_assets(Path.cwd(), rows)
                _invalidate_summary_cache()
                payload["items"] = merge_state(Path.cwd(), rows)
                payload = _overlay_cloud_decisions(Path.cwd(), payload)
                payload["sidecarSummary"] = _summary_snapshot(Path.cwd(), force=True)
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
            payload = _run_backstage_photos_preview(
                asset_id,
                cache_path,
                max_pixel,
                timeout=60,
            )
            if not payload.get("ok"):
                self._send_json(HTTPStatus.BAD_GATEWAY, payload)
                return
            if not cache_path.exists():
                self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {
                    "ok": False,
                    "code": "preview_cache_missing",
                    "error": "Backstage did not create the preview cache file.",
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
        self.send_header("Cache-Control", "private, max-age=31536000, immutable")
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
        self._send_json(HTTPStatus.GONE, {
            "ok": False,
            "code": "source_video_unsupported",
            "assetId": asset_id,
            "error": "Source videos are retired from the still-photo Sidecar workflow. Generated real-estate videos are downstream deliverables.",
        })

    def _handle_decision(self) -> None:
        if not self._is_loopback_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "localhost-only endpoint"})
            return
        try:
            payload = self._read_json_body()
            if str(payload.get("action") or payload.get("decision") or "").strip().casefold() == "tombstone":
                raise ValueError("Direct global tombstone writes are disabled; use the Waste Basket gateway.")
            if _sidecar_cloud_enabled():
                cloud = _sidecar_cloud_request("POST", "/api/v1/sidecar/decisions/apply", payload)
                result = _cloud_state_item(cloud)
                if result.get("before"):
                    mirror_cloud_decisions(Path.cwd(), [{"assetId": result["assetId"], "state": result["before"]}])
                local_result = record_decision(Path.cwd(), payload)
                pending_count = int(local_result.get("pendingSyncCount") or 0)
                result["pendingSyncCount"] = pending_count
                result["state"] = {**result["state"], "pendingSyncCount": pending_count}
                mirror_cloud_decisions(Path.cwd(), [{"assetId": result["assetId"], "state": result["state"]}])
                result["cloudSidecar"] = {"ok": True, "canonical": True}
            else:
                result = record_decision(Path.cwd(), payload)
                result["cloudSidecar"] = {"ok": False, "configured": False}
            _invalidate_summary_cache()
            if self._include_summary(payload):
                result["summary"] = _summary_snapshot(Path.cwd(), force=True)
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
            if any(
                isinstance(item, dict)
                and str(item.get("action") or item.get("decision") or "").strip().casefold() == "tombstone"
                for item in decisions
            ):
                raise ValueError("Direct global tombstone writes are disabled; use the Waste Basket gateway.")
            if _sidecar_cloud_enabled():
                cloud = _sidecar_cloud_request("POST", "/api/v1/sidecar/decisions/apply-batch", {"decisions": decisions}, timeout=60)
                items = [_cloud_state_item(item) for item in cloud.get("items") or [] if isinstance(item, dict)]
                before_states = [
                    {"assetId": item["assetId"], "state": item["before"]}
                    for item in items
                    if item.get("assetId") and item.get("before")
                ]
                if before_states:
                    mirror_cloud_decisions(Path.cwd(), before_states)
                local_result = record_decisions(Path.cwd(), decisions)
                pending_by_asset_id = {
                    str(item.get("assetId") or ""): int(item.get("pendingSyncCount") or 0)
                    for item in local_result.get("items") or []
                    if isinstance(item, dict)
                }
                for item in items:
                    pending_count = pending_by_asset_id.get(str(item.get("assetId") or ""), int(item.get("pendingSyncCount") or 0))
                    item["pendingSyncCount"] = pending_count
                    item["state"] = {**item.get("state", {}), "pendingSyncCount": pending_count}
                mirror_cloud_decisions(Path.cwd(), [{"assetId": item["assetId"], "state": item["state"]} for item in items])
                result = {
                    "ok": True,
                    "count": len(items),
                    "items": items,
                    "cloudSidecar": {"ok": True, "canonical": True},
                }
            else:
                result = record_decisions(Path.cwd(), decisions)
                result["cloudSidecar"] = {"ok": False, "configured": False}
            _invalidate_summary_cache()
            if self._include_summary(payload):
                result["summary"] = _summary_snapshot(Path.cwd(), force=True)
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
            payload = self._read_json_body()
            result = empty_wastebasket(
                Path.cwd(),
                confirmed=payload.get("confirmed") is True,
                confirmation_token=payload.get("confirmationToken") or payload.get("confirmation_token") or "",
                actor=payload.get("actor") or "legacy-sidecar",
                request_key=payload.get("requestKey") or payload.get("request_key") or "",
            )
            _invalidate_summary_cache()
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
            return
        except Exception as error:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": str(error)})
            return
        self._send_json(HTTPStatus.OK, result)

    def _handle_upload_plan(self) -> None:
        query = parse_qs(urlparse(self.path).query)
        limit = _int_query(query, "limit", 500, 1, 5000)
        try:
            pool_id = _text_query(query, "poolId", "pool_id", "pool")
            scoped_asset_ids = pool_asset_ids(Path.cwd(), pool_id) if pool_id else None
            result = upload_plan(Path.cwd(), limit=limit, asset_ids=scoped_asset_ids)
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
            pool_id = _text_query(query, "poolId", "pool_id", "pool")
            scoped_asset_ids = pool_asset_ids(Path.cwd(), pool_id) if pool_id else None
            result = upload_bridge_plan(Path.cwd(), limit=limit, asset_ids=scoped_asset_ids)
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
            result["cloudSidecar"] = _sync_ai_proposal_states_to_cloud(Path.cwd(), result)
            result["version"] = sidecar_version(Path.cwd())
            _invalidate_summary_cache()
            if self._include_summary(payload):
                result["summary"] = _summary_snapshot(Path.cwd(), force=True)
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
            allow_unscoped = bool(payload.get("allowUnscoped") or payload.get("allow_unscoped"))
            pool_id = str(payload.get("poolId") or payload.get("pool_id") or "").strip()
            fixture_id = str(payload.get("fixtureId") or payload.get("fixture_id") or "").strip()
            scoped_asset_ids = None
            if pool_id:
                pool = get_pool(Path.cwd(), pool_id)
                pool_fixture_id = str(pool.get("fixtureId") or "")
                if fixture_id and fixture_id != pool_fixture_id:
                    raise ValueError("fixtureId does not match the selected Sidecar pool.")
                fixture_id = pool_fixture_id
                scoped_asset_ids = pool_asset_ids(Path.cwd(), pool_id)
            elif not allow_unscoped:
                raise ValueError(
                    "This Sidecar page is stale or unscoped. Reopen the batch from Build a Fixture before starting a real upload."
                )
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
            "photosVerifiedCount": 0,
            "photosFailedCount": 0,
        }
        _clear_upload_bridge_cancel_requested(upload_id)
        self._write_ndjson_event({
            "ok": True,
            "event": "start",
            "uploadId": upload_id,
            "fixtureId": fixture_id,
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
                asset_ids=scoped_asset_ids,
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
        pending_giveback: list[dict] = []
        giveback_batch_size = 10

        def emit_item_complete(record: dict, fixture_delivery: dict | None = None) -> None:
            result = record["result"]
            item = record["item"]
            self._write_ndjson_event({
                "ok": bool(result.get("ok")),
                "event": "item-complete",
                "uploadId": upload_id,
                "index": record["index"] + 1,
                "count": len(batch_items),
                "status": record["status"],
                "runId": result.get("runId") or "",
                "item": {
                    "assetId": item.get("assetId") or "",
                    "photoId": item.get("photoId") or "",
                    "filename": item.get("filename") or "",
                    "mediaType": item.get("mediaType") or "",
                    "status": item.get("status") or record["status"],
                    "export": item.get("export") or {},
                    "upload": item.get("upload") or {},
                    "timings": item.get("timings") or {},
                    "fixtureDelivery": fixture_delivery or {},
                },
                "summary": record["summary"],
                "totals": totals,
                "message": result.get("message") or "",
            })

        def flush_giveback() -> None:
            nonlocal pending_giveback
            if not pending_giveback:
                return
            asset_ids = [str(record["item"].get("assetId") or "") for record in pending_giveback]
            try:
                batch_delivery = finalize_streamed_upload_batch(
                    Path.cwd(),
                    run_id=batch_run_id,
                    fixture_id=fixture_id,
                    asset_ids=asset_ids,
                )
                deliveries = {
                    str(item.get("assetId") or ""): item
                    for item in batch_delivery.get("items") or []
                }
            except Exception as error:  # noqa: BLE001 - R2 remains verified and Photos stays retryable.
                deliveries = {
                    asset_id: {
                        "ok": False,
                        "assetId": asset_id,
                        "fixtureId": fixture_id,
                        "photosWrittenCount": 0,
                        "photosFailedCount": 1,
                        "error": str(error),
                    }
                    for asset_id in asset_ids
                }
            for record in pending_giveback:
                item = record["item"]
                asset_id = str(item.get("assetId") or "")
                fixture_delivery = deliveries.get(asset_id) or {
                    "ok": False,
                    "assetId": asset_id,
                    "fixtureId": fixture_id,
                    "photosWrittenCount": 0,
                    "photosFailedCount": 1,
                    "error": "Apple Photos batch returned no result for this item.",
                }
                photos_verified = int(fixture_delivery.get("photosWrittenCount") or 0)
                photos_failed = max(
                    int(fixture_delivery.get("photosFailedCount") or 0),
                    int(fixture_delivery.get("photosBlockedCount") or 0),
                    0 if fixture_delivery.get("ok") else 1,
                )
                totals["photosVerifiedCount"] += photos_verified
                totals["photosFailedCount"] += photos_failed
                self._write_ndjson_event({
                    "ok": bool(fixture_delivery.get("ok")),
                    "event": "item-photos-complete",
                    "uploadId": upload_id,
                    "index": record["index"] + 1,
                    "count": len(batch_items),
                    "fixtureId": fixture_id,
                    "item": {"assetId": asset_id, "filename": item.get("filename") or ""},
                    "fixtureDelivery": fixture_delivery,
                    "totals": totals,
                    "message": (
                        f"Apple Photos verified item {record['index'] + 1} of {len(batch_items)}."
                        if fixture_delivery.get("ok")
                        else f"Apple Photos give-back needs attention for item {record['index'] + 1}; R2 is safe."
                    ),
                })
                emit_item_complete(record, fixture_delivery)
            pending_giveback = []

        def execute_one(index_and_item: tuple[int, dict]) -> dict:
            index, planned_item = index_and_item
            try:
                return {
                    "index": index,
                    "result": execute_upload_bridge_batch_item(
                        Path.cwd(),
                        run_id=batch_run_id,
                        run_root=Path(str(batch.get("spoolRoot") or "")),
                        export_root=Path(str(batch.get("exportRoot") or "")),
                        item=planned_item,
                        allow_icloud_downloads=allow_icloud_downloads,
                        allow_r2_overwrite=allow_overwrite,
                        r2_request_min_interval=0.25,
                    ),
                }
            except Exception as error:  # noqa: BLE001 - stream the failure to the UI.
                return {"index": index, "error": str(error)}

        with ThreadPoolExecutor(max_workers=2) as executor:
            for pair_start in range(0, len(batch_items), 2):
                if _upload_bridge_cancel_requested(upload_id):
                    flush_giveback()
                    canceled = True
                    self._write_ndjson_event({
                        "ok": True,
                        "event": "cancelled",
                        "uploadId": upload_id,
                        "index": pair_start + 1,
                        "count": len(batch_items),
                        "totals": totals,
                        "message": "Upload Bridge interrupt requested; stopped before starting the next worker pair.",
                    })
                    break
                pair = list(enumerate(batch_items[pair_start:pair_start + 2], start=pair_start))
                for index, planned_item in pair:
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
                        "message": f"Uploading item {index + 1} of {len(batch_items)} (two-wide pipeline).",
                    })
                for outcome in executor.map(execute_one, pair):
                    index = int(outcome["index"])
                    if outcome.get("error"):
                        totals["failedItemCount"] += 1
                        totals["failedUploadCount"] += 1
                        terminal_error = str(outcome["error"])
                        self._write_ndjson_event({
                            "ok": False,
                            "event": "error",
                            "uploadId": upload_id,
                            "index": index + 1,
                            "count": len(batch_items),
                            "error": terminal_error,
                            "totals": totals,
                        })
                        continue
                    result = outcome["result"]
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
                    record = {
                        "index": index,
                        "result": result,
                        "summary": summary_payload,
                        "item": item,
                        "status": status,
                    }
                    if item_uploaded and fixture_id:
                        self._write_ndjson_event({
                            "ok": True,
                            "event": "item-r2-verified",
                            "uploadId": upload_id,
                            "index": index + 1,
                            "count": len(batch_items),
                            "fixtureId": fixture_id,
                            "item": {"assetId": item.get("assetId") or "", "filename": item.get("filename") or ""},
                            "totals": totals,
                            "message": f"R2 verified for item {index + 1}; queued for batched Apple Photos give-back.",
                        })
                        pending_giveback.append(record)
                    else:
                        emit_item_complete(record)
                    if status == "upload_failed" or failed_keys:
                        terminal_error = str((item.get("upload") or {}).get("error") or "Upload Bridge R2 upload failed.")
                    elif not result.get("ok") and status != "export_failed":
                        terminal_error = result.get("message") or f"Upload Bridge item failed with status {status}."
                if len(pending_giveback) >= giveback_batch_size or terminal_error:
                    flush_giveback()
                if terminal_error:
                    break
        flush_giveback()

        try:
            plan = upload_plan(Path.cwd(), limit=500)
        except Exception as error:  # noqa: BLE001 - progress is more important than final plan refresh.
            plan = {"ok": False, "error": str(error)}
        final_verb = "interrupted" if canceled else "finished"
        batch_status = "cancelled" if canceled else (
            "completed_with_failures"
            if terminal_error or totals["failedItemCount"] or totals["photosFailedCount"]
            else "completed"
        )
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
            f"{totals['failedUploadCount']} failed key(s), "
            f"{totals['photosVerifiedCount']} Apple Photos item(s) verified, "
            f"{totals['photosFailedCount']} Apple Photos item(s) needing attention."
        )
        self._write_ndjson_event({
            "ok": canceled or (not terminal_error and not totals["photosFailedCount"]),
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
