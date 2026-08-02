#!/usr/bin/env python3
"""Migrate local Sidecar decision cache rows into cloud Owner Sidecar state."""

from __future__ import annotations

import argparse
from collections.abc import Iterable
import json
from pathlib import Path
import signal
import sqlite3
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_CONNECTOR_CONFIG = Path.home() / ".config" / "photosbyelie" / "connector.json"
DEFAULT_DB_PATH = Path("assets/owner-actions/Owner.sqlite")


def _json_load(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Could not read JSON file {path}: {error}") from error
    if not isinstance(payload, dict):
        raise RuntimeError(f"Expected a JSON object in {path}.")
    return payload


def _read_connector_config(path: Path) -> dict[str, str]:
    payload = _json_load(path)
    worker_base = str(payload.get("workerBase") or "").strip().rstrip("/")
    token = str(payload.get("token") or "").strip()
    connector_id = str(payload.get("connectorId") or "").strip()
    if not worker_base or not token:
        raise RuntimeError(f"Connector config is missing workerBase or token: {path}")
    return {"workerBase": worker_base, "token": token, "connectorId": connector_id}


def _first_text(row: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = row.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def _mapping_status(row: dict[str, Any]) -> str:
    status = _first_text(row, "status", "state", "result").lower()
    if status:
        return status
    if row.get("ok") is True:
        return "ok"
    if row.get("ok") is False:
        return "failed"
    return "ok"


def load_cloud_map(path: Path) -> tuple[dict[str, str], list[dict[str, Any]]]:
    mapping: dict[str, str] = {}
    failures: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            text = line.strip()
            if not text:
                continue
            try:
                row = json.loads(text)
            except json.JSONDecodeError as error:
                failures.append({"line": line_number, "error": str(error)})
                continue
            if not isinstance(row, dict):
                failures.append({"line": line_number, "error": "row is not an object"})
                continue
            local_id = _first_text(
                row,
                "localIdentifier",
                "localId",
                "assetId",
                "maxLocalIdentifier",
                "maxAssetId",
                "sourceAssetId",
            )
            cloud_id = _first_text(
                row,
                "cloudIdentifier",
                "cloudId",
                "phCloudIdentifier",
                "cloudIdentifierString",
                "targetAssetId",
            )
            status = _mapping_status(row)
            if local_id and cloud_id and status not in {"failed", "error", "not_found", "missing"}:
                mapping[local_id] = cloud_id
            else:
                failures.append({
                    "line": line_number,
                    "localIdentifier": local_id,
                    "status": status,
                    "error": _first_text(row, "error", "message", "localizedDescription"),
                })
    return mapping, failures


def _read_json(value: str | None, fallback: Any) -> Any:
    if value in (None, ""):
        return fallback
    try:
        return json.loads(str(value))
    except json.JSONDecodeError:
        return fallback


def _decision_state(row: sqlite3.Row, cloud_asset_id: str) -> dict[str, Any]:
    columns = set(row.keys())
    attempt_count = row["metadata_ai_attempt_count"] if "metadata_ai_attempt_count" in columns else 0
    last_error = row["metadata_ai_last_error"] if "metadata_ai_last_error" in columns else ""
    last_attempt_at = row["metadata_ai_last_attempt_at"] if "metadata_ai_last_attempt_at" in columns else ""
    return {
        "assetId": cloud_asset_id,
        "rating": int(row["rating"] or 0),
        "color": row["color"] or "",
        "pickState": row["pick_state"] or "undecided",
        "metadataState": row["metadata_state"] or "unreviewed",
        "title": row["title"] or "",
        "keywords": _read_json(row["keywords_json"], []),
        "reworkCategory": row["rework_category"] or "",
        "reworkComment": row["rework_comment"] or "",
        "metadataAiRung": row["metadata_ai_rung"] or "",
        "metadataAiEvidence": _read_json(row["metadata_ai_evidence_json"], []),
        "metadataAiNote": row["metadata_ai_note"] or "",
        "metadataAiAttemptCount": int(attempt_count or 0),
        "metadataAiLastError": last_error or "",
        "metadataAiLastAttemptAt": last_attempt_at or "",
        "lastAction": row["last_action"] or "",
        "updatedAt": row["updated_at"] or "",
        "tombstoneState": row["tombstone_state"] or "",
        "tombstoneReason": row["tombstone_reason"] or "",
        "tombstonedAt": row["tombstoned_at"] or "",
        "pendingSyncCount": int(row["pending_sync_count"] or 0),
    }


def load_local_decisions(db_path: Path, mapping: dict[str, str], limit: int = 0) -> tuple[list[dict[str, Any]], list[str]]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT
              d.*,
              COALESCE(t.tombstone_state, '') AS tombstone_state,
              COALESCE(t.reason, '') AS tombstone_reason,
              COALESCE(t.tombstoned_at, '') AS tombstoned_at,
              COALESCE((
                SELECT count(*)
                FROM sidecar_pending_sync AS p
                WHERE p.asset_id = d.asset_id AND p.status = 'pending'
              ), 0) AS pending_sync_count
            FROM sidecar_decisions AS d
            LEFT JOIN sidecar_tombstones AS t ON t.asset_id = d.asset_id AND t.tombstone_state = 'active'
            ORDER BY d.updated_at, d.asset_id
            """
        ).fetchall()
    finally:
        conn.close()
    decisions: list[dict[str, Any]] = []
    unmapped: list[str] = []
    for row in rows:
        local_id = str(row["asset_id"] or "").strip()
        cloud_id = mapping.get(local_id)
        if not cloud_id:
            unmapped.append(local_id)
            continue
        decisions.append(_decision_state(row, cloud_id))
        if limit and len(decisions) >= limit:
            break
    return decisions, unmapped


def _chunks(items: list[dict[str, Any]], size: int) -> Iterable[list[dict[str, Any]]]:
    for index in range(0, len(items), size):
        yield items[index:index + size]


def _timeout_handler(signum: int, frame: Any) -> None:
    raise TimeoutError("request timed out")


def worker_request(worker_base: str, token: str, path: str, payload: dict[str, Any], timeout: int = 30) -> dict[str, Any]:
    request = Request(
        f"{worker_base.rstrip('/')}{path}",
        data=json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "PhotosByElie-Sidecar-Cloud-Migration/1.0",
        },
    )
    previous_handler = signal.signal(signal.SIGALRM, _timeout_handler)
    signal.alarm(max(1, int(timeout)))
    try:
        with urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8") or "{}")
    except HTTPError as error:
        try:
            detail = json.loads(error.read().decode("utf-8") or "{}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            detail = {}
        message = detail.get("error", {}).get("message") if isinstance(detail.get("error"), dict) else detail.get("error")
        raise RuntimeError(message or f"Worker returned HTTP {error.code} for {path}.") from error
    except (TimeoutError, URLError, OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Worker request failed for {path}: {error}") from error
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous_handler)
    if body.get("ok") is False or body.get("error"):
        error = body.get("error")
        message = error.get("message") if isinstance(error, dict) else str(error)
        raise RuntimeError(message or "Worker request failed.")
    return body


def worker_request_with_retries(
    worker_base: str,
    token: str,
    path: str,
    payload: dict[str, Any],
    *,
    timeout: int,
    retries: int,
) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(1, max(1, retries) + 2):
        try:
            return worker_request(worker_base, token, path, payload, timeout=timeout)
        except RuntimeError as error:
            last_error = error
            if attempt > retries:
                break
            delay = min(8.0, 0.75 * attempt)
            print(f"batch request failed on attempt {attempt}; retrying in {delay:.1f}s: {error}", file=sys.stderr, flush=True)
            time.sleep(delay)
    raise RuntimeError(str(last_error) if last_error else "Worker request failed.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mapping", type=Path, required=True, help="Max local-ID to PHCloudIdentifier JSONL file.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="Local Owner.sqlite cache to migrate from.")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONNECTOR_CONFIG, help="Mac connector config with Worker base/token.")
    parser.add_argument("--worker-base", default="", help="Override Worker base URL.")
    parser.add_argument("--token", default="", help="Override connector token. Prefer --config.")
    parser.add_argument("--batch-size", type=int, default=250)
    parser.add_argument("--request-timeout", type=int, default=25, help="Hard timeout in seconds for each Worker request.")
    parser.add_argument("--retries", type=int, default=3, help="Retries per failed batch request.")
    parser.add_argument("--limit", type=int, default=0, help="Limit migrated decisions for testing.")
    parser.add_argument("--dry-run", action="store_true", help="Plan only; do not write to the Worker.")
    parser.add_argument("--report", type=Path, default=Path("tmp/sidecar-cloud-migration-report.json"))
    args = parser.parse_args()

    mapping, mapping_failures = load_cloud_map(args.mapping)
    decisions, unmapped = load_local_decisions(args.db, mapping, limit=max(0, args.limit))
    config = _read_connector_config(args.config.expanduser()) if not (args.worker_base and args.token) else {}
    worker_base = args.worker_base.strip() or config.get("workerBase", "")
    token = args.token.strip() or config.get("token", "")
    report = {
        "ok": True,
        "mappingRows": len(mapping) + len(mapping_failures),
        "mappedCount": len(mapping),
        "mappingFailureCount": len(mapping_failures),
        "localDecisionCount": len(decisions) + len(unmapped),
        "migratableDecisionCount": len(decisions),
        "unmappedDecisionCount": len(unmapped),
        "dryRun": bool(args.dry_run),
        "workerBase": worker_base,
        "batches": [],
        "mappingFailuresSample": mapping_failures[:20],
        "unmappedSample": unmapped[:20],
    }
    if not args.dry_run:
        if not worker_base or not token:
            raise RuntimeError("Worker base and connector token are required for a non-dry-run migration.")
        batch_size = max(1, min(500, args.batch_size))
        migrated = 0
        batches = list(_chunks(decisions, batch_size))
        for batch_index, batch in enumerate(batches, start=1):
            print(
                f"uploading batch {batch_index}/{len(batches)} ({len(batch)} decisions; {migrated}/{len(decisions)} written)",
                file=sys.stderr,
                flush=True,
            )
            body = worker_request_with_retries(
                worker_base,
                token,
                "/api/v1/sidecar/decisions/upsert",
                {"decisions": batch},
                timeout=max(1, args.request_timeout),
                retries=max(0, args.retries),
            )
            migrated += int(body.get("count") or len(batch))
            report["batches"].append({"requested": len(batch), "written": int(body.get("count") or 0)})
            args.report.parent.mkdir(parents=True, exist_ok=True)
            progress_report = dict(report)
            progress_report["ok"] = False
            progress_report["inProgress"] = True
            progress_report["cloudWrittenCount"] = migrated
            progress_report["lastCompletedBatch"] = batch_index
            progress_report["totalBatches"] = len(batches)
            args.report.write_text(json.dumps(progress_report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        report["cloudWrittenCount"] = migrated
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
