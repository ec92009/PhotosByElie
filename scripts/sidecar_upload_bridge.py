#!/usr/bin/env python3
"""Plan or dry-run the Sidecar Upload Bridge queue.

Bridge plan mode is read-only: it reports which Sidecar-approved Photos items
are queued for Owner-style materialization and which R2 keys would be involved.
Export dry-run mode materializes one queued asset from Apple Photos into a local
spool and records a run ledger, but still performs no R2 writes.
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
            lines.append(f"  warning: {collision_count} planned key(s) already exist in Owner R2 state")
    if shown > 20:
        lines.append(f"... {shown - 20:,} more item(s) omitted from text output. Use --json for the full manifest.")
    return "\n".join(lines)


def human_export_report(plan: dict[str, Any]) -> str:
    status = str(plan.get("status") or "")
    lines = [
        "Sidecar Upload Bridge export dry run",
        f"Run: {plan.get('runId') or '(none)'}",
        f"Status: {status}",
        f"Spool: {plan.get('spoolRoot') or '(none)'}",
        "",
        "No R2 writes or Owner catalog registration were performed.",
    ]
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
    for key in item.get("plannedKeys") or []:
        marker = "exists" if key.get("exists") else "missing"
        lines.append(f"  {marker}: {key.get('bucket')}/{key.get('key')} [{key.get('kind')}]")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Plan or dry-run queued Sidecar Upload Bridge rows.")
    parser.add_argument("--limit", type=int, default=500, help="Maximum queued rows to include in the report.")
    parser.add_argument("--export-one", action="store_true", help="Materialize one queued asset from Apple Photos into a local spool.")
    parser.add_argument("--no-icloud-downloads", action="store_true", help="Do not let Photos download the queued asset during --export-one.")
    parser.add_argument("--execute", action="store_true", help="Reserved for the future R2 upload execution path.")
    parser.add_argument("--json", action="store_true", help="Print the full JSON manifest instead of a text summary.")
    parser.add_argument("--output", type=Path, help="Write the full JSON manifest to this path.")
    args = parser.parse_args()

    if args.export_one and args.execute:
        parser.error("--execute is reserved for the future real R2 upload path; omit it for the export dry run.")
    if args.export_one:
        plan = run_upload_bridge_export_dry_run(
            REPO_ROOT,
            limit=args.limit,
            allow_icloud_downloads=not args.no_icloud_downloads,
            execute_upload=args.execute,
        )
    elif args.execute:
        parser.error("--execute is reserved for the future real R2 upload path. Use --export-one for the one-item Photos export dry run.")
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
