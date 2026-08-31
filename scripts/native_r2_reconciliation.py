#!/usr/bin/env python3
"""Detached, receipt-backed worker for one guarded R2 reconciliation run."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sqlite3
import time

from native_publication_pipeline import (
    reconcile_r2_objects,
    record_r2_reconciliation_failure,
    register_r2_reconciliation_worker,
)
from sync_r2_media import UploadItem, wrangler_delete


def _delete_object(bucket: str, key: str) -> None:
    item = UploadItem(bucket=bucket, key=key, path=Path("/dev/null"), content_type="")
    _item, ok, output = wrangler_delete(item, retries=3)
    if not ok:
        raise RuntimeError(output or f"R2 deletion failed for {bucket}/{key}")


def _record_failure_with_retry(repo_root: Path, run_id: str, error: Exception) -> dict:
    for index, delay in enumerate((0.0, 0.25, 0.5, 1.0, 2.0)):
        if delay:
            time.sleep(delay)
        try:
            return record_r2_reconciliation_failure(repo_root, run_id, str(error))
        except sqlite3.OperationalError as write_error:
            if "locked" not in str(write_error).casefold() or index == 4:
                raise
    raise RuntimeError("R2 reconciliation failure receipt could not be recorded")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--worker-token", required=True)
    parser.add_argument("--commit", action="store_true")
    args = parser.parse_args()
    root = args.repo_root.expanduser().resolve(strict=True)
    try:
        register_r2_reconciliation_worker(
            root,
            args.run_id,
            worker_pid=os.getpid(),
            worker_token=args.worker_token,
        )
        result = reconcile_r2_objects(
            root,
            commit=args.commit,
            delete_object=_delete_object if args.commit else None,
            run_id=args.run_id,
        )
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:  # noqa: BLE001 - the durable failure receipt is the contract.
        try:
            receipt = _record_failure_with_retry(root, args.run_id, error)
        except Exception as receipt_error:  # noqa: BLE001 - preserve both failures in the worker log.
            print(json.dumps({
                "ok": False,
                "runId": args.run_id,
                "error": str(error),
                "receiptError": str(receipt_error),
            }, sort_keys=True))
            return 2
        print(json.dumps({"ok": False, **receipt}, sort_keys=True))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
