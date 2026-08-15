#!/usr/bin/env python3
"""Deliver exact, approved fixture assets to R2 and back to Apple Photos."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = Path(
    os.environ.get("PBE_CONNECTOR_DATA_ROOT", str(SCRIPT_DIR.parent))
).expanduser().resolve()
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from fixture_pipeline import configure_asset_destinations, delivery_plan  # noqa: E402
from sidecar_state_db import (  # noqa: E402
    execute_upload_bridge_batch_item,
    finish_upload_bridge_execute_batch,
    prepare_upload_bridge_execute_batch,
    queue_upload_bridge,
)
from streaming_fixture_delivery import finalize_streamed_upload_batch  # noqa: E402


def _unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(str(value or "").strip() for value in values if str(value or "").strip()))


def deliver_fixture_assets(
    repo_root: Path,
    *,
    fixture_id: str,
    asset_ids: list[str],
) -> dict[str, Any]:
    fixture = str(fixture_id or "").strip()
    selected_ids = _unique(asset_ids)
    if not fixture:
        raise ValueError("fixture id is required")
    if not selected_ids or len(selected_ids) > 24:
        raise ValueError("choose between 1 and 24 exact fixture assets")

    plan = delivery_plan(repo_root, fixture)
    by_id = {str(item["assetId"]): item for item in plan["items"]}
    blocked = []
    for asset_id in selected_ids:
        item = by_id.get(asset_id)
        if not item:
            blocked.append({"assetId": asset_id, "reason": "asset is not actively placed in this fixture"})
        elif not item.get("approved"):
            blocked.append({"assetId": asset_id, "reason": "asset is not both picked and metadata-approved"})
    if blocked:
        return {
            "ok": False,
            "fixtureId": fixture,
            "requestedCount": len(selected_ids),
            "blocked": blocked,
            "message": "Fixture delivery stopped before export because one or more exact assets are ineligible.",
        }

    configure_asset_destinations(
        repo_root,
        fixture,
        selected_ids,
        ["r2", "apple_photos"],
    )
    queue_upload_bridge(
        repo_root,
        asset_ids=selected_ids,
        limit=len(selected_ids),
        fixture_authorized_asset_ids=selected_ids,
    )
    batch = prepare_upload_bridge_execute_batch(
        repo_root,
        limit=len(selected_ids),
        asset_ids=selected_ids,
        fixture_authorized_asset_ids=selected_ids,
    )
    if not batch.get("items"):
        return {
            "ok": False,
            "fixtureId": fixture,
            "requestedCount": len(selected_ids),
            "runId": batch.get("runId") or "",
            "status": batch.get("status") or "no-uploadable-items",
            "blocked": [{
                "assetId": asset_id,
                "reason": "no missing R2 object was uploadable; adopt an existing verified run or retry after queue repair",
            } for asset_id in selected_ids],
        }

    run_id = str(batch["runId"])
    run_root = Path(str(batch["spoolRoot"]))
    export_root = Path(str(batch["exportRoot"]))
    results = []
    uploaded_ids = []
    for item in batch["items"]:
        result = execute_upload_bridge_batch_item(
            repo_root,
            run_id=run_id,
            run_root=run_root,
            export_root=export_root,
            item=item,
        )
        row = (result.get("items") or [{}])[0]
        results.append(row)
        if result.get("ok"):
            uploaded_ids.append(str(row.get("assetId") or ""))

    failed_count = sum(item.get("status") not in {"uploaded", "uploaded_with_skips"} for item in results)
    summary = {
        "requestedCount": len(selected_ids),
        "processedCount": len(results),
        "uploadedCount": len(uploaded_ids),
        "failedCount": failed_count,
    }
    finish_upload_bridge_execute_batch(
        repo_root,
        run_id=run_id,
        status="completed" if not failed_count else "failed",
        summary=summary,
        error_text="" if not failed_count else "one or more exact fixture uploads failed",
    )
    finalized = finalize_streamed_upload_batch(
        repo_root,
        run_id=run_id,
        fixture_id=fixture,
        asset_ids=uploaded_ids,
    ) if uploaded_ids else {
        "ok": False,
        "r2ReceiptCount": 0,
        "photosWrittenCount": 0,
        "photosFailedCount": 0,
        "photosBlockedCount": 0,
        "items": [],
    }
    return {
        "ok": not failed_count and bool(finalized.get("ok")),
        "fixtureId": fixture,
        "requestedCount": len(selected_ids),
        "runId": run_id,
        "status": "completed" if not failed_count else "failed",
        "summary": summary,
        "items": results,
        "finalization": finalized,
        "clientMessageSent": False,
        "published": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture-id", required=True)
    parser.add_argument("--asset-id", action="append", default=[])
    args = parser.parse_args()
    try:
        result = deliver_fixture_assets(
            REPO_ROOT,
            fixture_id=args.fixture_id,
            asset_ids=args.asset_id,
        )
    except Exception as error:  # noqa: BLE001 - connector needs a JSON failure envelope.
        result = {"ok": False, "error": str(error)}
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
