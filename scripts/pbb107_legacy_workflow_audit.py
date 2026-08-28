#!/usr/bin/env python3
"""Classify legacy Owner workflow rows without mutating Owner.sqlite."""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter
from contextlib import closing
from pathlib import Path


def _open_read_only(database_path: Path) -> sqlite3.Connection:
    resolved = database_path.expanduser().resolve(strict=True)
    connection = sqlite3.connect(f"{resolved.as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    return connection


def _has_durable_identity(row: sqlite3.Row) -> bool:
    return (
        int(row["worker_pid"] or 0) > 0
        and bool(str(row["worker_token"] or "").strip())
        and bool(str(row["lease_expires_at"] or "").strip())
    )


def _photos_report(connection: sqlite3.Connection) -> dict[str, object]:
    rows = connection.execute(
        """
        SELECT status, stage, scanned_count, worker_pid, worker_token,
               lease_expires_at, recovery_state
        FROM photos_sync_runs
        WHERE status = 'running'
        """
    ).fetchall()
    classes: Counter[str] = Counter()
    for row in rows:
        legacy_review = (
            row["recovery_state"] == "needs-review"
            and not _has_durable_identity(row)
        )
        if legacy_review and int(row["scanned_count"] or 0) == 0:
            if row["stage"] == "Queued":
                classes["cancelledBeforeScan"] += 1
            else:
                classes["interruptedBeforeCheckpoint"] += 1
        else:
            classes["manualReviewRequired"] += 1
    return {
        "runningRows": len(rows),
        "classes": {
            "cancelledBeforeScan": {
                "count": classes["cancelledBeforeScan"],
                "proposedStatus": "cancelled",
                "reason": "Queued with zero scanned items and no durable worker identity.",
            },
            "interruptedBeforeCheckpoint": {
                "count": classes["interruptedBeforeCheckpoint"],
                "proposedStatus": "failed",
                "reason": "Entered a read stage but persisted zero scanned items and no terminal receipt.",
            },
            "manualReviewRequired": {
                "count": classes["manualReviewRequired"],
                "proposedStatus": None,
                "reason": "The row does not match a proven legacy disposition shape.",
            },
        },
    }


def _upload_report(connection: sqlite3.Connection) -> dict[str, object]:
    runs = connection.execute(
        """
        SELECT run_id, status, worker_pid, worker_token, lease_expires_at,
               recovery_state
        FROM sidecar_upload_bridge_runs
        WHERE status = 'running'
        """
    ).fetchall()
    classes: Counter[str] = Counter()
    uploaded_items = 0
    untouched_items = 0
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
        uploaded_items += uploaded
        untouched_items += untouched
        if legacy_review and items and untouched == len(items):
            classes["cancelledBeforeExport"] += 1
        elif legacy_review and uploaded > 0 and uploaded + untouched == len(items):
            classes["interruptedPartial"] += 1
        else:
            classes["manualReviewRequired"] += 1
    return {
        "runningRows": len(runs),
        "uploadedItemsToPreserve": uploaded_items,
        "untouchedItems": untouched_items,
        "classes": {
            "cancelledBeforeExport": {
                "count": classes["cancelledBeforeExport"],
                "proposedStatus": "cancelled",
                "reason": "Every item remained planned with no export bytes or upload keys.",
            },
            "interruptedPartial": {
                "count": classes["interruptedPartial"],
                "proposedStatus": "interrupted",
                "reason": "Some uploads have durable keys while the remaining items were untouched.",
            },
            "manualReviewRequired": {
                "count": classes["manualReviewRequired"],
                "proposedStatus": None,
                "reason": "The run does not match a proven legacy disposition shape.",
            },
        },
    }


def build_report(database_path: Path) -> dict[str, object]:
    with closing(_open_read_only(database_path)) as connection:
        photos = _photos_report(connection)
        uploads = _upload_report(connection)
    manual_review = sum(
        int(section["classes"]["manualReviewRequired"]["count"])
        for section in (photos, uploads)
    )
    return {
        "mode": "read-only",
        "containsRowIdentifiers": False,
        "photosSync": photos,
        "uploadBridge": uploads,
        "manualReviewRequired": manual_review,
        "mutationPerformed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit 2 when any row does not match a proven classification.",
    )
    args = parser.parse_args()
    report = build_report(args.database)
    print(json.dumps(report, indent=2, sort_keys=True))
    if args.strict and report["manualReviewRequired"]:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
