#!/usr/bin/env python3
"""Execute one native Backstage upload run and publish verified assets."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sqlite3
import sys
import time
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = Path(
    os.environ.get("PBE_CONNECTOR_DATA_ROOT", str(SCRIPT_DIR.parent))
).expanduser().resolve()
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from apple_photos_metadata_writer import BackstagePhotosMetadataAdapter, commit_writeback  # noqa: E402
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
FAILURE_RECORD_RETRY_DELAYS = (0.5, 1.0, 2.0, 4.0, 8.0, 15.0, 30.0, 60.0)


def retry_sqlite_lock(operation, *, delays=SQLITE_LOCK_RETRY_DELAYS):
    """Retry one idempotent publication step while another Owner writer drains."""
    for delay in (*delays, None):
        try:
            return operation()
        except sqlite3.OperationalError as error:
            if "database is locked" not in str(error).casefold() or delay is None:
                raise
            time.sleep(delay)


def claim_upload_run_start(
    repo_root: Path,
    run_id: str,
    *,
    retry_failed: bool = False,
) -> dict[str, Any]:
    """Claim one new or failed run before spawning its detached worker."""
    timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with connect_owner(repo_root) as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT status FROM asset_upload_runs WHERE run_id = ?",
            (run_id,),
        ).fetchone()
        if row is None:
            raise ValueError("upload run does not exist")
        status = str(row["status"] or "")
        if status == "running":
            conn.commit()
            return {
                "ok": True,
                "runId": run_id,
                "claimed": False,
                "attached": True,
                "status": status,
            }
        expected = "failed" if retry_failed else "queued"
        if status != expected:
            conn.rollback()
            raise ValueError(
                f"upload run cannot {'retry' if retry_failed else 'start'} from {status or 'unknown'}"
            )
        updated = conn.execute(
            """
            UPDATE asset_upload_runs
            SET status = 'running', last_error = '', completed_at = NULL,
                updated_at = ?
            WHERE run_id = ? AND status = ?
            """,
            (timestamp, run_id, expected),
        ).rowcount
        if updated != 1:
            conn.rollback()
            return {
                "ok": True,
                "runId": run_id,
                "claimed": False,
                "attached": True,
                "status": status,
            }
        conn.commit()
    return {
        "ok": True,
        "runId": run_id,
        "claimed": True,
        "attached": False,
        "status": "running",
    }


def record_upload_run_failure(repo_root: Path, run_id: str, error_text: str) -> dict[str, Any]:
    """Persist a terminal runner failure after other Owner writers drain."""
    timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    def record() -> dict[str, Any]:
        with connect_owner(repo_root) as conn:
            row = conn.execute(
                "SELECT status FROM asset_upload_runs WHERE run_id = ?",
                (run_id,),
            ).fetchone()
            if row is None:
                raise ValueError("upload run does not exist")
            status = str(row["status"] or "")
            if status in {"completed", "completed-with-errors", "cancelled"}:
                return {"ok": True, "runId": run_id, "status": status, "recorded": False}
            conn.execute(
                """
                UPDATE asset_upload_runs
                SET status = 'failed', last_error = ?, completed_at = ?, updated_at = ?
                WHERE run_id = ?
                """,
                (error_text, timestamp, timestamp, run_id),
            )
            conn.commit()
        return {"ok": True, "runId": run_id, "status": "failed", "recorded": True}

    return retry_sqlite_lock(record, delays=FAILURE_RECORD_RETRY_DELAYS)


def _terminal_upload_error_from_log(repo_root: Path, run_id: str) -> str:
    log_root = (repo_root / ".review-logs" / "native-publication-runs").resolve()
    log_path = log_root / f"{run_id}.log"
    try:
        if log_path.is_symlink() or not log_path.is_file():
            return ""
        resolved = log_path.resolve(strict=True)
        if resolved.parent != log_root or resolved.stat().st_size > 1_048_576:
            return ""
        lines = resolved.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        return ""
    for line in reversed(lines):
        try:
            receipt = json.loads(line)
        except json.JSONDecodeError:
            continue
        if (
            isinstance(receipt, dict)
            and str(receipt.get("runId") or "") == run_id
            and receipt.get("ok") is False
        ):
            return str(receipt.get("error") or "Upload worker failed without an error detail.")
    return ""


def reconcile_upload_run_receipts(repo_root: Path) -> dict[str, Any]:
    """Reconcile only zero-work runs and exact terminal worker receipts."""
    with connect_owner(repo_root) as conn:
        rows = conn.execute(
            """
            SELECT run.run_id, run.status, run.requested_count,
                   count(item.asset_id) AS item_count
            FROM asset_upload_runs AS run
            LEFT JOIN asset_upload_run_items AS item ON item.run_id = run.run_id
            WHERE run.status IN ('queued', 'running')
            GROUP BY run.run_id, run.status, run.requested_count
            ORDER BY run.created_at, run.run_id
            """
        ).fetchall()

    completed_zero: list[str] = []
    failed_receipts: list[str] = []
    needs_review: list[str] = []
    for row in rows:
        run_id = str(row["run_id"])
        if int(row["requested_count"] or 0) == 0 and int(row["item_count"] or 0) == 0:
            timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

            def finish_zero() -> None:
                with connect_owner(repo_root) as conn:
                    conn.execute(
                        """
                        UPDATE asset_upload_runs
                        SET status = 'completed', remaining_count = 0,
                            last_error = '', completed_at = ?, updated_at = ?
                        WHERE run_id = ?
                          AND status IN ('queued', 'running')
                          AND requested_count = 0
                          AND NOT EXISTS (
                            SELECT 1 FROM asset_upload_run_items WHERE run_id = ?
                          )
                        """,
                        (timestamp, timestamp, run_id, run_id),
                    )
                    conn.commit()

            retry_sqlite_lock(finish_zero)
            completed_zero.append(run_id)
            continue
        error_text = _terminal_upload_error_from_log(repo_root, run_id)
        if error_text:
            record_upload_run_failure(repo_root, run_id, error_text)
            failed_receipts.append(run_id)
        else:
            needs_review.append(run_id)

    latest_failed: dict[str, Any] | None = None
    with connect_owner(repo_root) as conn:
        latest = conn.execute(
            """
            SELECT run_id
            FROM asset_upload_runs
            WHERE status = 'failed' AND remaining_count > 0
            ORDER BY updated_at DESC, created_at DESC, run_id DESC
            LIMIT 1
            """
        ).fetchone()
    if latest is not None:
        latest_failed = retry_sqlite_lock(
            lambda: upload_run_status(repo_root, str(latest["run_id"]))
        )
    return {
        "ok": True,
        "completedZeroCount": len(completed_zero),
        "failedReceiptCount": len(failed_receipts),
        "needsReviewCount": len(needs_review),
        "completedZeroRunIds": completed_zero,
        "failedReceiptRunIds": failed_receipts,
        "needsReviewRunIds": needs_review,
        "latestFailedRun": latest_failed,
    }


def reset_upload_run_for_retry(repo_root: Path, run_id: str) -> dict[str, Any]:
    """Return interrupted or failed items in one explicit run to its durable queue."""
    timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with connect_owner(repo_root) as conn:
        run = conn.execute(
            "SELECT status FROM asset_upload_runs WHERE run_id = ?",
            (run_id,),
        ).fetchone()
        if run is None:
            raise ValueError("upload run does not exist")
        run_status = str(run["status"] or "")
        if run_status not in {"queued", "running", "failed"}:
            return {"ok": True, "runId": run_id, "resetCount": 0}
        retryable = conn.execute(
            """
            SELECT asset_id
            FROM asset_upload_run_items
            WHERE run_id = ? AND status IN ('failed', 'uploading')
            """,
            (run_id,),
        ).fetchall()
        asset_ids = [str(row["asset_id"]) for row in retryable]
        if asset_ids:
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
                   sum(CASE WHEN status IN ('verified', 'live', 'failed', 'skipped') THEN 1 ELSE 0 END) processed,
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
            SET status = ?, processed_count = ?, live_count = ?,
                failed_count = ?, remaining_count = ?, last_error = '',
                completed_at = NULL, updated_at = ?
            WHERE run_id = ? AND status IN ('queued', 'running', 'failed')
            """,
            (
                "running" if run_status == "running" else "queued",
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
        receipt_asset_ids = [asset_id]
        row_keys = set(row.keys()) if hasattr(row, "keys") else set()
        r2_source_anchor = str(
            row["r2_source_anchor"] if "r2_source_anchor" in row_keys else ""
        ).strip()
        legacy_prefix = "apple-photos://"
        if r2_source_anchor.startswith(legacy_prefix):
            legacy_asset_id = r2_source_anchor[len(legacy_prefix):].strip()
            if legacy_asset_id and legacy_asset_id not in receipt_asset_ids:
                receipt_asset_ids.append(legacy_asset_id)
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
            receipt = None
            for receipt_asset_id in receipt_asset_ids:
                receipt = conn.execute(
                    """
                    SELECT checksum_sha256, verification_json
                    FROM fixture_delivery_receipts
                    WHERE asset_id = ? AND destination = 'r2'
                      AND status = 'verified' AND object_key = ?
                    ORDER BY COALESCE(verified_at, updated_at) DESC, receipt_id DESC
                    LIMIT 1
                    """,
                    (receipt_asset_id, object_key),
                ).fetchone()
                if receipt is not None:
                    break
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
    # The launcher has already claimed this exact run as `running`. Reset only
    # retryable item state while preserving that durable single-flight claim.
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
                    "uploadedCount": sum(
                        str(item.get("status") or "") in {"verified", "live"}
                        for item in completed.get("items") or []
                    ),
                    "failedCount": bridge_failed,
                    "nativePublicationRunId": run_id,
                },
                error_text="" if not bridge_failed else "one or more native publication uploads failed",
            )
        )

    giveback_ids = [
        str(item.get("asset_id") or item.get("assetId") or "")
        for item in completed.get("items") or []
        if str(item.get("status") or "") in {"verified", "live"}
    ]
    photos = (
        commit_writeback(
            repo_root,
            "",
            giveback_ids,
            adapter=BackstagePhotosMetadataAdapter(repo_root),
        )
        if giveback_ids
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
        error_text = str(error)
        try:
            failure = record_upload_run_failure(
                args.repo_root.resolve(),
                args.run_id,
                error_text,
            )
        except Exception as persistence_error:  # noqa: BLE001 - preserve both terminal failures.
            result = {
                "ok": False,
                "runId": args.run_id,
                "error": error_text,
                "failurePersistenceError": str(persistence_error),
            }
        else:
            result = {"ok": False, "runId": args.run_id, "error": error_text, "failure": failure}
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
