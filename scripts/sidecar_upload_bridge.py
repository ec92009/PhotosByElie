#!/usr/bin/env python3
"""Dry-run the Sidecar Upload Bridge queue.

The first bridge slice is intentionally read-only: it reports which
Sidecar-approved Photos items are queued for Owner-style materialization and
which R2 keys would be involved. The actual Apple Photos export, R2 upload, and
Owner registration steps will build on this manifest.
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

from sidecar_state_db import upload_bridge_plan  # noqa: E402


def human_report(plan: dict[str, Any]) -> str:
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Dry-run queued Sidecar Upload Bridge rows.")
    parser.add_argument("--limit", type=int, default=500, help="Maximum queued rows to include in the report.")
    parser.add_argument("--json", action="store_true", help="Print the full JSON manifest instead of a text summary.")
    parser.add_argument("--output", type=Path, help="Write the full JSON manifest to this path.")
    args = parser.parse_args()

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
