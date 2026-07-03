#!/usr/bin/env python3
"""Plan, dry-run, or execute the Sidecar Upload Bridge queue.

Bridge plan mode is read-only: it reports which Sidecar-approved Photos items
are queued for Owner-style materialization and which R2 keys would be involved.
Export dry-run mode materializes one queued asset from Apple Photos into a local
spool and records a run ledger. Execute mode keeps the same one-item scope, then
uploads the private master plus watermarked public previews to R2.
"""

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

from sidecar_state_db import run_upload_bridge_export_dry_run, upload_bridge_plan  # noqa: E402


def human_report(plan: dict[str, Any]) -> str:
    if plan.get("mode") == "export-dry-run":
        return human_export_report(plan)
    queued = int(plan.get("bridgeQueuedCount") or 0)
    shown = int(plan.get("count") or 0)
    collisions = int(plan.get("collisionCount") or 0)
    covered = int(plan.get("coveredKeyCount") or 0)
    planned_keys = int(plan.get("plannedKeyCount") or 0)
    lines = [
        "Sidecar Upload Bridge dry run",
        f"Queued items: {queued:,}",
        f"Shown in this report: {shown:,}",
        f"Planned R2 keys: {planned_keys:,}",
        f"Items with current R2 collisions: {collisions:,}",
        f"Existing covered keys: {covered:,}",
        "",
        "No Apple Photos exports or R2 writes were performed.",
    ]
    if not shown:
        lines.append("No queued bridge items found. Queue approved picks from the Sidecar Upload Bridge rail first.")
        return "\n".join(lines)
    lines.append("")
    for item in plan.get("items", [])[:20]:
        filename = item.get("filename") or item.get("assetId") or "(unnamed)"
        media_type = item.get("mediaType") or "media"
        collision_count = int(item.get("collisionCount") or 0)
        lines.append(f"- {filename} ({media_type}) -> {item.get('photoId') or 'unknown-id'}")
        for key in item.get("plannedKeys") or []:
            marker = "exists" if key.get("exists") else "missing"
            lines.append(f"  {marker}: {key.get('bucket')}/{key.get('key')} [{key.get('kind')}]")
        if collision_count:
            lines.append(f"  warning: {collision_count} planned key(s) already exist in Owner R2/bridge ledger state")
    if shown > 20:
        lines.append(f"... {shown - 20:,} more item(s) omitted from text output. Use --json for the full manifest.")
    return "\n".join(lines)


def human_export_report(plan: dict[str, Any]) -> str:
    status = str(plan.get("status") or "")
    is_execute = bool(plan.get("executeUpload"))
    summary = plan.get("summary") or {}
    lines = [
        "Sidecar Upload Bridge execute run" if is_execute else "Sidecar Upload Bridge export dry run",
        f"Run: {plan.get('runId') or '(none)'}",
        f"Status: {status}",
        f"Spool: {plan.get('spoolRoot') or '(none)'}",
        "",
        (
            "R2 upload was attempted for the exported item. Owner catalog registration was not performed."
            if is_execute
            else "No R2 writes or Owner catalog registration were performed."
        ),
    ]
    if is_execute:
        lines.extend([
            f"Uploaded keys: {int(summary.get('uploadedKeyCount') or 0):,}",
            f"Skipped collisions: {int(summary.get('skippedCollisionCount') or 0):,}",
            f"Failed uploads: {int(summary.get('failedUploadCount') or 0):,}",
        ])
    items = plan.get("items") or []
    if not items:
        lines.append("No queued bridge items found.")
        return "\n".join(lines)
    item = items[0]
    export = item.get("export") or {}
    filename = item.get("filename") or item.get("assetId") or "(unnamed)"
    lines.extend([
        "",
        f"- {filename} -> {item.get('photoId') or 'unknown-id'}",
        f"  export: {export.get('status') or item.get('status')}",
    ])
    if export.get("path"):
        bytes_value = export.get("bytes")
        suffix = f" ({int(bytes_value):,} bytes)" if isinstance(bytes_value, int) else ""
        lines.append(f"  file: {export.get('path')}{suffix}")
    if export.get("error"):
        lines.append(f"  error: {export.get('error')}")
    upload = item.get("upload") or {}
    upload_keys = upload.get("keys") or []
    if upload_keys:
        lines.append(f"  upload: {upload.get('status') or 'unknown'}")
        for uploaded in upload_keys:
            marker = uploaded.get("status") or "unknown"
            lines.append(f"  {marker}: {uploaded.get('bucket')}/{uploaded.get('key')} [{uploaded.get('kind')}]")
            if uploaded.get("error") and marker != "uploaded":
                lines.append(f"    warning: {uploaded.get('error')}")
    elif is_execute and upload.get("error"):
        lines.append(f"  upload error: {upload.get('error')}")
    for key in item.get("plannedKeys") or []:
        marker = "exists" if key.get("exists") else "missing"
        lines.append(f"  {marker}: {key.get('bucket')}/{key.get('key')} [{key.get('kind')}]")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Plan or dry-run queued Sidecar Upload Bridge rows.")
    parser.add_argument("--limit", type=int, default=500, help="Maximum queued rows to include in the report.")
    parser.add_argument("--export-one", action="store_true", help="Materialize one queued asset from Apple Photos into a local spool.")
    parser.add_argument("--no-icloud-downloads", action="store_true", help="Do not let Photos download the queued asset during --export-one.")
    parser.add_argument("--execute", action="store_true", help="Materialize one queued asset and upload planned private/public R2 objects.")
    parser.add_argument("--allow-r2-overwrite", action="store_true", help="Upload even when a planned R2 key already exists in Owner R2 state.")
    parser.add_argument("--backend", choices=("wrangler", "s3"), default=None, help="R2 upload backend for --execute. Defaults to PBE_R2_BACKEND, S3 env credentials, then Wrangler.")
    parser.add_argument("--retries", type=int, default=2, help="Upload retry count for --execute.")
    parser.add_argument("--request-min-interval", type=float, default=0.75, help="Minimum seconds between R2 write requests.")
    parser.add_argument("--retry-max-delay", type=float, default=900.0, help="Maximum seconds between R2 upload retries.")
    parser.add_argument("--json", action="store_true", help="Print the full JSON manifest instead of a text summary.")
    parser.add_argument("--output", type=Path, help="Write the full JSON manifest to this path.")
    args = parser.parse_args()

    if args.export_one or args.execute:
        plan = run_upload_bridge_export_dry_run(
            REPO_ROOT,
            limit=args.limit,
            allow_icloud_downloads=not args.no_icloud_downloads,
            execute_upload=args.execute,
            allow_r2_overwrite=args.allow_r2_overwrite,
            r2_backend=args.backend,
            r2_retries=args.retries,
            r2_request_min_interval=args.request_min_interval,
            r2_retry_max_delay=args.retry_max_delay,
        )
    else:
        plan = upload_bridge_plan(REPO_ROOT, limit=args.limit)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(plan, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if args.json:
        print(json.dumps(plan, indent=2, ensure_ascii=False))
    else:
        print(human_report(plan))


if __name__ == "__main__":
    main()
