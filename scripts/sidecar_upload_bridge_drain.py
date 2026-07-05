#!/usr/bin/env python3
"""Drain the Sidecar Upload Bridge through the fast local helper endpoint."""

from __future__ import annotations

import argparse
from datetime import datetime
import json
from pathlib import Path
import sys
import time
from typing import Any
import urllib.request

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from sidecar_state_db import upload_plan  # noqa: E402


def stamp() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")


def bridge_counts(repo_root: Path) -> dict[str, int]:
    plan = upload_plan(repo_root, limit=10)
    summary = plan.get("uploadBridgeSummary") or {}
    return {
        "queued": int(summary.get("bridgeQueuedCount") or 0),
        "uploadable": int(summary.get("uploadableItemCount") or 0),
        "covered": int(summary.get("fullyCoveredItemCount") or 0),
        "blocked": int(summary.get("blockedExportFailureCount") or 0),
        "missingKeys": int(summary.get("missingKeyCount") or 0),
    }


def post_batch(endpoint: str, batch_index: int, count: int, checkpoint_every: int, timeout: int) -> dict[str, Any]:
    upload_id = f"codex-drain-{datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}-{batch_index:03d}"
    payload = json.dumps({"count": count, "uploadId": upload_id}).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started = time.time()
    completed = 0
    print(f"{stamp()} batch {batch_index} start uploadId={upload_id} requested={count}", flush=True)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        for raw in response:
            event = json.loads(raw.decode("utf-8"))
            kind = event.get("event")
            if kind == "planned":
                summary = event.get("summary") or {}
                print(
                    f"{stamp()} batch {batch_index} planned selected={event.get('count')} "
                    f"scanned={summary.get('scannedCount')} skippedCovered={summary.get('skippedCoveredCount')} "
                    f"planning={summary.get('planningSeconds')}s runId={event.get('runId')}",
                    flush=True,
                )
            elif kind == "item-complete":
                totals = event.get("totals") or {}
                completed = int(totals.get("completedCount") or completed)
                if completed % checkpoint_every == 0 or completed == count:
                    elapsed = time.time() - started
                    item = event.get("item") or {}
                    print(
                        f"{stamp()} batch {batch_index} checkpoint {completed}/{count}: "
                        f"elapsed={elapsed:.1f}s avg={elapsed / max(completed, 1):.1f}s/item "
                        f"uploadedItems={totals.get('uploadedItemCount', 0)} "
                        f"uploadedKeys={totals.get('uploadedKeyCount', 0)} "
                        f"collisionKeys={totals.get('skippedCollisionCount', 0)} "
                        f"failedItems={totals.get('failedItemCount', 0)} "
                        f"failedKeys={totals.get('failedUploadCount', 0)} "
                        f"lastTiming={item.get('timings') or {}}",
                        flush=True,
                    )
            elif kind == "error":
                print(f"{stamp()} batch {batch_index} ERROR {event.get('error')}", flush=True)
            elif kind == "cancelled":
                print(f"{stamp()} batch {batch_index} CANCELLED totals={event.get('totals')}", flush=True)
            elif kind == "done":
                elapsed = time.time() - started
                print(
                    f"{stamp()} batch {batch_index} done status={event.get('status')} "
                    f"elapsed={elapsed:.1f}s totals={event.get('totals')} message={event.get('message')}",
                    flush=True,
                )
                return event
    return {"event": "stream-ended", "status": "unknown"}


def main() -> int:
    parser = argparse.ArgumentParser(description="Drain Upload Bridge rows through the optimized Sidecar helper endpoint.")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--checkpoint-every", type=int, default=25)
    parser.add_argument("--timeout", type=int, default=7200)
    parser.add_argument("--sleep-between-batches", type=float, default=5.0)
    parser.add_argument("--endpoint", default="http://127.0.0.1:8011/__sidecar/upload-bridge-execute")
    args = parser.parse_args()

    batch_size = max(1, min(int(args.batch_size or 500), 500))
    checkpoint_every = max(1, int(args.checkpoint_every or 25))
    print(f"{stamp()} drain started batchSize={batch_size}", flush=True)

    batch_index = 1
    while True:
        counts = bridge_counts(REPO_ROOT)
        print(f"{stamp()} counts before batch {batch_index}: {counts}", flush=True)
        uploadable = counts["uploadable"]
        if uploadable <= 0:
            print(f"{stamp()} drain complete: no uploadable items remain", flush=True)
            break
        count = min(batch_size, uploadable)
        try:
            done = post_batch(args.endpoint, batch_index, count, checkpoint_every, args.timeout)
        except KeyboardInterrupt:
            print(f"{stamp()} drain interrupted by signal", flush=True)
            raise
        except Exception as exc:  # noqa: BLE001 - durable log should preserve the failure.
            print(f"{stamp()} drain failed batch {batch_index}: {exc}", flush=True)
            return 1
        status = str((done or {}).get("status") or "")
        totals = (done or {}).get("totals") or {}
        if status not in {"completed", "completed_with_failures"}:
            print(f"{stamp()} drain stopping after batch {batch_index}: status={status}", flush=True)
            break
        if int(totals.get("failedUploadCount") or 0) > 0:
            print(f"{stamp()} drain stopping after R2 upload failure in batch {batch_index}", flush=True)
            break
        batch_index += 1
        time.sleep(float(args.sleep_between_batches or 0))

    print(f"{stamp()} drain exiting", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
