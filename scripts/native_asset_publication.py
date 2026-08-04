#!/usr/bin/env python3
"""Execute one native Backstage upload run and publish verified assets."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sqlite3
import sys
import time
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from apple_photos_metadata_writer import SignedPhotosBridgeAdapter, commit_writeback  # noqa: E402
from native_catalog_promotion import refresh_public_catalog_artifacts  # noqa: E402
from native_publication_pipeline import run_upload_batch, upload_run_status  # noqa: E402
from sidecar_state_db import (  # noqa: E402
    _planned_r2_keys,
    _upload_bridge_rows,
    connect as connect_owner,
    execute_upload_bridge_batch_item,
    finish_upload_bridge_execute_batch,
    prepare_upload_bridge_execute_batch,
    queue_upload_bridge,
)

SQLITE_LOCK_RETRY_DELAYS = (0.5, 1.0, 2.0, 4.0, 8.0, 12.0)


def retry_sqlite_lock(operation, *, delays=SQLITE_LOCK_RETRY_DELAYS):
    """Retry one idempotent publication step while another Owner writer drains."""
    for delay in (*delays, None):
        try:
            return operation()
        except sqlite3.OperationalError as error:
            if "database is locked" not in str(error).casefold() or delay is None:
                raise
            time.sleep(delay)


def reset_upload_run_for_retry(repo_root: Path, run_id: str) -> dict[str, Any]:
    """Return interrupted or failed items in one explicit run to its durable queue."""
    timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with connect_owner(repo_root) as conn:
        retryable = conn.execute(
            """
            SELECT asset_id
            FROM asset_upload_run_items
            WHERE run_id = ? AND status IN ('failed', 'uploading')
            """,
            (run_id,),
        ).fetchall()
        asset_ids = [str(row["asset_id"]) for row in retryable]
        if not asset_ids:
            return {"ok": True, "runId": run_id, "resetCount": 0}
        conn.execute(
            """
            UPDATE asset_upload_run_items
            SET status = 'queued', source_version_hash = '',
                object_keys_json = '[]', error_text = '',
                started_at = NULL, completed_at = NULL, updated_at = ?
            WHERE run_id = ? AND status IN ('failed', 'uploading')
            """,
            (timestamp, run_id),
        )
        placeholders = ",".join("?" for _ in asset_ids)
        conn.execute(
            f"""
            UPDATE asset_delivery_state
            SET delivery_state = 'needs-upload', last_error = '', updated_at = ?
            WHERE asset_id IN ({placeholders})
              AND delivery_state IN ('failed', 'uploading')
            """,
            (timestamp, *asset_ids),
        )
        summary = conn.execute(
            """
            SELECT count(*) total,
                   sum(CASE WHEN status IN ('live', 'failed', 'skipped') THEN 1 ELSE 0 END) processed,
                   sum(CASE WHEN status = 'live' THEN 1 ELSE 0 END) live,
                   sum(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) failed
            FROM asset_upload_run_items
            WHERE run_id = ?
            """,
            (run_id,),
        ).fetchone()
        total = int(summary["total"] or 0)
        processed = int(summary["processed"] or 0)
        conn.execute(
            """
            UPDATE asset_upload_runs
            SET status = 'queued', processed_count = ?, live_count = ?,
                failed_count = ?, remaining_count = ?, last_error = '',
                completed_at = NULL, updated_at = ?
            WHERE run_id = ?
            """,
            (
                processed,
                int(summary["live"] or 0),
                int(summary["failed"] or 0),
                max(0, total - processed),
                timestamp,
                run_id,
            ),
        )
        conn.commit()
    return {"ok": True, "runId": run_id, "resetCount": len(asset_ids)}


def verified_covered_r2_results(repo_root: Path, asset_id: str) -> list[dict[str, Any]]:
    """Recover exact planned objects from current R2 inventory and verified receipts."""
    with connect_owner(repo_root) as conn:
        rows = _upload_bridge_rows(
            conn,
            asset_ids=[asset_id],
            fixture_authorized_asset_ids=[asset_id],
        )
        row = next((item for item in rows if str(item["asset_id"]) == asset_id), None)
        if row is None:
            return []
        _, planned_keys = _planned_r2_keys(row)
        recovered: list[dict[str, Any]] = []
        for planned in planned_keys:
            bucket = str(planned["bucket"])
            object_key = str(planned["key"])
            current = conn.execute(
                """
                SELECT bytes
                FROM r2_objects
                WHERE bucket = ? AND object_key = ? AND lifecycle_state = 'current'
                """,
                (bucket, object_key),
            ).fetchone()
            if current is None:
                return []
            receipt = conn.execute(
                """
                SELECT checksum_sha256, verification_json
                FROM fixture_delivery_receipts
                WHERE asset_id = ? AND destination = 'r2'
                  AND status = 'verified' AND object_key = ?
                ORDER BY COALESCE(verified_at, updated_at) DESC, receipt_id DESC
                LIMIT 1
                """,
                (asset_id, object_key),
            ).fetchone()
            if receipt is None or not str(receipt["checksum_sha256"] or ""):
                return []
            try:
                verification = json.loads(str(receipt["verification_json"] or "{}"))
            except json.JSONDecodeError:
                return []
            recorded_bucket = str(verification.get("bucket") or "")
            if recorded_bucket and recorded_bucket != bucket:
                return []
            checksum = str(receipt["checksum_sha256"])
            recovered.append(
                {
                    "status": "uploaded",
                    "bucket": bucket,
                    "key": object_key,
                    "kind": str(planned.get("kind") or ""),
                    "objectKind": str(planned.get("kind") or ""),
                    "checksumSha256": checksum,
                    "remoteChecksumSha256": checksum,
                    "remoteVerified": True,
                    "bytes": int(
                        verification.get("bytes")
                        if verification.get("bytes") is not None
                        else current["bytes"] or 0
                    ),
                    "contentType": str(verification.get("contentType") or ""),
                    "verificationMethod": "existing-verified-receipt",
                }
            )
        return recovered


def execute_native_publication_run(repo_root: Path, run_id: str) -> dict[str, Any]:
    retry_sqlite_lock(lambda: reset_upload_run_for_retry(repo_root, run_id))
    status = retry_sqlite_lock(lambda: upload_run_status(repo_root, run_id))
    asset_ids = [
        str(item.get("asset_id") or item.get("assetId") or "")
        for item in status.get("items") or []
        if str(item.get("status") or "") in {"queued", "uploading"}
    ]
    asset_ids = [item for item in asset_ids if item]
    if not asset_ids:
        return status

    retry_sqlite_lock(
        lambda: queue_upload_bridge(
            repo_root,
            asset_ids=asset_ids,
            limit=len(asset_ids),
            fixture_authorized_asset_ids=asset_ids,
        )
    )
    bridge = retry_sqlite_lock(
        lambda: prepare_upload_bridge_execute_batch(
            repo_root,
            limit=len(asset_ids),
            asset_ids=asset_ids,
            fixture_authorized_asset_ids=asset_ids,
        )
    )
    bridge_items = {
        str(item.get("assetId") or ""): item
        for item in bridge.get("items") or []
        if str(item.get("assetId") or "")
    }
    bridge_run_id = str(bridge.get("runId") or "")
    bridge_run_root = Path(str(bridge.get("spoolRoot") or ""))
    bridge_export_root = Path(str(bridge.get("exportRoot") or ""))

    def upload(asset_id: str) -> list[dict[str, Any]]:
        item = bridge_items.get(asset_id)
        if not item:
            covered = retry_sqlite_lock(
                lambda: verified_covered_r2_results(repo_root, asset_id)
            )
            if covered:
                return covered
            raise RuntimeError(
                "No uploadable R2 work or exact verified R2 receipt was prepared "
                "for this asset."
            )
        executed = retry_sqlite_lock(
            lambda: execute_upload_bridge_batch_item(
                repo_root,
                run_id=bridge_run_id,
                run_root=bridge_run_root,
                export_root=bridge_export_root,
                item=item,
            )
        )
        row = (executed.get("items") or [{}])[0]
        return list((row.get("upload") or {}).get("keys") or [])

    completed = retry_sqlite_lock(lambda: run_upload_batch(repo_root, run_id, upload))
    catalog_items = [
        item for item in completed.get("items") or []
        if str(item.get("catalog_state") or "") == "local"
    ]
    if catalog_items:
        artifacts = retry_sqlite_lock(
            lambda: refresh_public_catalog_artifacts(repo_root)
        )
        completed["publicCatalogArtifacts"] = artifacts
        if not artifacts.get("ok"):
            completed["ok"] = False
    bridge_failed = int(completed.get("failed") or 0)
    if str(bridge.get("status") or "") == "running":
        retry_sqlite_lock(
            lambda: finish_upload_bridge_execute_batch(
                repo_root,
                run_id=bridge_run_id,
                status="completed" if not bridge_failed else "failed",
                summary={
                    "requestedCount": len(asset_ids),
                    "processedCount": int(completed.get("processed") or 0),
                    "uploadedCount": int(completed.get("live") or 0),
                    "failedCount": bridge_failed,
                    "nativePublicationRunId": run_id,
                },
                error_text="" if not bridge_failed else "one or more native publication uploads failed",
            )
        )

    live_ids = [
        str(item.get("asset_id") or item.get("assetId") or "")
        for item in completed.get("items") or []
        if str(item.get("status") or "") == "live"
    ]
    photos = (
        commit_writeback(
            repo_root,
            "",
            live_ids,
            adapter=SignedPhotosBridgeAdapter(repo_root),
        )
        if live_ids
        else {
            "ok": True,
            "writtenCount": 0,
            "failedCount": 0,
            "blocked": [],
        }
    )
    return {**completed, "photosGiveBack": photos}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=REPO_ROOT)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    try:
        result = execute_native_publication_run(args.repo_root.resolve(), args.run_id)
    except Exception as error:  # noqa: BLE001 - background runner needs a durable error envelope.
        result = {"ok": False, "runId": args.run_id, "error": str(error)}
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
