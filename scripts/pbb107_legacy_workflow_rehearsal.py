#!/usr/bin/env python3
"""Transactionally rehearse PBB-107 dispositions on an exact Owner.sqlite copy."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from pbb107_legacy_workflow_audit import (
    _has_durable_identity,
    _photos_report,
    _upload_report,
)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _bridge_items_digest(connection: sqlite3.Connection) -> str:
    columns = [
        str(row[1])
        for row in connection.execute(
            "PRAGMA table_info(sidecar_upload_bridge_run_items)"
        ).fetchall()
    ]
    quoted = ", ".join(f'"{column}"' for column in columns)
    rows = connection.execute(
        f"SELECT {quoted} FROM sidecar_upload_bridge_run_items ORDER BY run_id, rowid"
    ).fetchall()
    digest = hashlib.sha256()
    for row in rows:
        digest.update(
            json.dumps(list(row), ensure_ascii=False, separators=(",", ":")).encode(
                "utf-8"
            )
        )
        digest.update(b"\n")
    return digest.hexdigest()


def _classify_photos(connection: sqlite3.Connection) -> dict[str, list[str]]:
    classes: dict[str, list[str]] = defaultdict(list)
    rows = connection.execute(
        """
        SELECT run_id, status, stage, scanned_count, worker_pid, worker_token,
               lease_expires_at, recovery_state
        FROM photos_sync_runs
        WHERE status = 'running'
        """
    ).fetchall()
    for row in rows:
        legacy_review = (
            row["recovery_state"] == "needs-review"
            and not _has_durable_identity(row)
        )
        if legacy_review and int(row["scanned_count"] or 0) == 0:
            classification = (
                "cancelledBeforeScan"
                if row["stage"] == "Queued"
                else "interruptedBeforeCheckpoint"
            )
        else:
            classification = "manualReviewRequired"
        classes[classification].append(str(row["run_id"]))
    return classes


def _classify_uploads(connection: sqlite3.Connection) -> dict[str, list[str]]:
    classes: dict[str, list[str]] = defaultdict(list)
    runs = connection.execute(
        """
        SELECT run_id, status, worker_pid, worker_token, lease_expires_at,
               recovery_state
        FROM sidecar_upload_bridge_runs
        WHERE status = 'running'
        """
    ).fetchall()
    for run in runs:
        items = connection.execute(
            """
            SELECT status, export_status, upload_status, export_bytes,
                   upload_keys_json
            FROM sidecar_upload_bridge_run_items
            WHERE run_id = ?
            """,
            (run["run_id"],),
        ).fetchall()
        legacy_review = (
            run["recovery_state"] == "needs-review"
            and not _has_durable_identity(run)
        )
        uploaded = sum(
            1
            for item in items
            if item["status"] == "uploaded"
            and item["upload_status"] == "uploaded"
            and len(json.loads(item["upload_keys_json"] or "[]")) > 0
        )
        untouched = sum(
            1
            for item in items
            if item["status"] == "planned"
            and item["export_status"] == "planned"
            and item["upload_status"] == "not_requested"
            and int(item["export_bytes"] or 0) == 0
            and len(json.loads(item["upload_keys_json"] or "[]")) == 0
        )
        if legacy_review and items and untouched == len(items):
            classification = "cancelledBeforeExport"
        elif legacy_review and uploaded > 0 and uploaded + untouched == len(items):
            classification = "interruptedPartial"
        else:
            classification = "manualReviewRequired"
        classes[classification].append(str(run["run_id"]))
    return classes


def _update_each(
    connection: sqlite3.Connection,
    *,
    table: str,
    run_ids: list[str],
    sql: str,
    values: tuple[object, ...],
) -> int:
    changed = 0
    for run_id in run_ids:
        cursor = connection.execute(sql.format(table=table), (*values, run_id))
        if cursor.rowcount != 1:
            raise RuntimeError(
                f"Copy-only rehearsal lost its guarded {table} row before update"
            )
        changed += cursor.rowcount
    return changed


def rehearse(
    source_database: Path,
    copied_database: Path,
    *,
    timestamp: str | None = None,
) -> dict[str, object]:
    source = source_database.expanduser().resolve(strict=True)
    copied = copied_database.expanduser().resolve(strict=True)
    if source == copied or source.samefile(copied):
        raise ValueError("The rehearsal database must be a distinct copied file")

    source_hash_before = _sha256(source)
    if _sha256(copied) != source_hash_before:
        raise ValueError("The rehearsal database is not an exact source-file copy")

    checked_at = timestamp or datetime.now(timezone.utc).isoformat().replace(
        "+00:00", "Z"
    )
    connection = sqlite3.connect(copied)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("BEGIN IMMEDIATE")
        photos_before = _photos_report(connection)
        uploads_before = _upload_report(connection)
        photos = _classify_photos(connection)
        uploads = _classify_uploads(connection)
        manual_review = len(photos["manualReviewRequired"]) + len(
            uploads["manualReviewRequired"]
        )
        if manual_review:
            raise RuntimeError(
                "Copy-only rehearsal refused an unproven legacy disposition shape"
            )

        items_before = _bridge_items_digest(connection)
        photos_cancelled = _update_each(
            connection,
            table="photos_sync_runs",
            run_ids=photos["cancelledBeforeScan"],
            sql="""
                UPDATE {table}
                SET status = 'cancelled', stage = 'Cancelled after legacy review',
                    error_text = COALESCE(NULLIF(error_text, ''), ?),
                    completed_at = COALESCE(completed_at, ?), updated_at = ?,
                    lease_expires_at = NULL, recovery_state = 'recovered',
                    recovery_reason = ?, recovery_checked_at = ?
                WHERE run_id = ? AND status = 'running'
                  AND recovery_state = 'needs-review'
            """,
            values=(
                "Legacy Photos sync was queued but never scanned an item.",
                checked_at,
                checked_at,
                "Operator-reviewed copy rehearsal: cancelled before scan.",
                checked_at,
            ),
        )
        photos_failed = _update_each(
            connection,
            table="photos_sync_runs",
            run_ids=photos["interruptedBeforeCheckpoint"],
            sql="""
                UPDATE {table}
                SET status = 'failed', stage = 'Failed after legacy review',
                    error_text = COALESCE(NULLIF(error_text, ''), ?),
                    completed_at = COALESCE(completed_at, ?), updated_at = ?,
                    lease_expires_at = NULL, recovery_state = 'recovered',
                    recovery_reason = ?, recovery_checked_at = ?
                WHERE run_id = ? AND status = 'running'
                  AND recovery_state = 'needs-review'
            """,
            values=(
                "Legacy Photos sync entered a read stage without a durable checkpoint.",
                checked_at,
                checked_at,
                "Operator-reviewed copy rehearsal: failed before checkpoint.",
                checked_at,
            ),
        )
        uploads_cancelled = _update_each(
            connection,
            table="sidecar_upload_bridge_runs",
            run_ids=uploads["cancelledBeforeExport"],
            sql="""
                UPDATE {table}
                SET status = 'cancelled',
                    error_text = COALESCE(NULLIF(error_text, ''), ?),
                    completed_at = COALESCE(completed_at, ?), updated_at = ?,
                    lease_expires_at = NULL, recovery_state = 'recovered',
                    recovery_reason = ?, recovery_checked_at = ?
                WHERE run_id = ? AND status = 'running'
                  AND recovery_state = 'needs-review'
            """,
            values=(
                "Legacy Upload Bridge run ended before any export began.",
                checked_at,
                checked_at,
                "Operator-reviewed copy rehearsal: cancelled before export.",
                checked_at,
            ),
        )
        uploads_interrupted = _update_each(
            connection,
            table="sidecar_upload_bridge_runs",
            run_ids=uploads["interruptedPartial"],
            sql="""
                UPDATE {table}
                SET status = 'interrupted',
                    error_text = COALESCE(NULLIF(error_text, ''), ?),
                    completed_at = COALESCE(completed_at, ?), updated_at = ?,
                    lease_expires_at = NULL, recovery_state = 'recovered',
                    recovery_reason = ?, recovery_checked_at = ?
                WHERE run_id = ? AND status = 'running'
                  AND recovery_state = 'needs-review'
            """,
            values=(
                "Legacy Upload Bridge run ended after a partial durable upload receipt.",
                checked_at,
                checked_at,
                "Operator-reviewed copy rehearsal: interrupted; durable uploads preserved.",
                checked_at,
            ),
        )

        if connection.execute(
            "SELECT COUNT(*) FROM photos_sync_runs WHERE status = 'running'"
        ).fetchone()[0]:
            raise RuntimeError("A Photos sync row remained running in the rehearsal copy")
        if connection.execute(
            "SELECT COUNT(*) FROM sidecar_upload_bridge_runs WHERE status = 'running'"
        ).fetchone()[0]:
            raise RuntimeError("An Upload Bridge row remained running in the rehearsal copy")
        items_after = _bridge_items_digest(connection)
        if items_before != items_after:
            raise RuntimeError("Upload Bridge item receipts changed during rehearsal")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()

    source_hash_after = _sha256(source)
    return {
        "mode": "copy-only-transaction",
        "containsRowIdentifiers": False,
        "copyStartedIdenticalToSource": True,
        "canonicalDatabaseUnchanged": source_hash_before == source_hash_after,
        "canonicalMutationPerformed": False,
        "mutationPerformedOnCopy": True,
        "manualReviewRequired": 0,
        "photosSync": {
            "runningRowsBefore": photos_before["runningRows"],
            "cancelledBeforeScan": photos_cancelled,
            "failedBeforeCheckpoint": photos_failed,
            "runningRowsAfter": 0,
        },
        "uploadBridge": {
            "runningRowsBefore": uploads_before["runningRows"],
            "cancelledBeforeExport": uploads_cancelled,
            "interruptedPartial": uploads_interrupted,
            "runningRowsAfter": 0,
            "uploadedItemsPreserved": uploads_before["uploadedItemsToPreserve"],
            "untouchedItemsPreserved": uploads_before["untouchedItems"],
            "allItemRowsValueEquivalent": items_before == items_after,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-database", type=Path, required=True)
    parser.add_argument("--copied-database", type=Path, required=True)
    parser.add_argument("--timestamp")
    args = parser.parse_args()
    report = rehearse(
        args.source_database,
        args.copied_database,
        timestamp=args.timestamp,
    )
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["canonicalDatabaseUnchanged"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
