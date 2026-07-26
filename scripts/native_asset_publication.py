#!/usr/bin/env python3
"""Execute one native Backstage upload run and publish verified assets."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from apple_photos_metadata_writer import SignedPhotosBridgeAdapter, commit_writeback  # noqa: E402
from native_publication_pipeline import run_upload_batch, upload_run_status  # noqa: E402
from sidecar_state_db import (  # noqa: E402
    execute_upload_bridge_batch_item,
    finish_upload_bridge_execute_batch,
    prepare_upload_bridge_execute_batch,
    queue_upload_bridge,
)


def execute_native_publication_run(repo_root: Path, run_id: str) -> dict[str, Any]:
    status = upload_run_status(repo_root, run_id)
    asset_ids = [
        str(item.get("asset_id") or item.get("assetId") or "")
        for item in status.get("items") or []
        if str(item.get("status") or "") in {"queued", "uploading"}
    ]
    asset_ids = [item for item in asset_ids if item]
    if not asset_ids:
        return status

    queue_upload_bridge(repo_root, asset_ids=asset_ids, limit=len(asset_ids))
    bridge = prepare_upload_bridge_execute_batch(
        repo_root,
        limit=len(asset_ids),
        asset_ids=asset_ids,
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
            raise RuntimeError(
                "No uploadable R2 work was prepared for this asset. "
                "Use verified-run adoption for already-covered objects."
            )
        executed = execute_upload_bridge_batch_item(
            repo_root,
            run_id=bridge_run_id,
            run_root=bridge_run_root,
            export_root=bridge_export_root,
            item=item,
        )
        row = (executed.get("items") or [{}])[0]
        return list((row.get("upload") or {}).get("keys") or [])

    completed = run_upload_batch(repo_root, run_id, upload)
    bridge_failed = int(completed.get("failed") or 0)
    finish_upload_bridge_execute_batch(
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
