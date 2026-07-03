#!/usr/bin/env python3
"""Plan cleanup of private JPG render cache objects.

Private render triplets are now an on-demand Worker cache. This dry-run reports
which current `photosbyelie-private/renders/<media_id>_<size>mp.jpg` objects
could be deleted once sold-media protection has been loaded from the order
ledger. It never deletes R2 objects.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
OWNER_DB = REPO_ROOT / "assets/owner-actions/Owner.sqlite"
PRIVATE_BUCKET = "photosbyelie-private"
RENDER_RE = re.compile(r"^renders/(.+)_(1|3|6)mp\.jpg$")


def read_protected_ids(path: Path | None) -> set[str]:
    if not path:
        return set()
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return set()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return {line.strip() for line in text.splitlines() if line.strip()}
    if isinstance(data, list):
        return {str(value).strip() for value in data if str(value).strip()}
    if isinstance(data, dict):
        values = data.get("photoIds") or data.get("mediaIds") or data.get("ids") or []
        if isinstance(values, list):
            return {str(value).strip() for value in values if str(value).strip()}
    raise ValueError(f"Unsupported protected-id file shape: {path}")


def load_rows(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        """
        SELECT object_key, bytes, last_seen_at
        FROM r2_objects
        WHERE bucket = ?
          AND lifecycle_state = 'current'
          AND object_key LIKE 'renders/%'
        ORDER BY object_key
        """,
        (PRIVATE_BUCKET,),
    ).fetchall()
    masters = conn.execute(
        """
        SELECT object_key
        FROM r2_objects
        WHERE bucket = ?
          AND lifecycle_state = 'current'
          AND object_key LIKE 'masters/%'
        """,
        (PRIVATE_BUCKET,),
    ).fetchall()
    master_ids = {
        key.removeprefix("masters/").rsplit(".", 1)[0]
        for key in (str(row["object_key"] or "") for row in masters)
        if key.startswith("masters/") and "." in key
    }
    parsed: list[dict[str, Any]] = []
    for row in rows:
        key = str(row["object_key"] or "")
        match = RENDER_RE.match(key)
        if not match:
            continue
        media_id, size = match.groups()
        parsed.append({
            "mediaId": media_id,
            "size": f"{size}mp",
            "key": key,
            "bytes": int(row["bytes"]) if row["bytes"] is not None else None,
            "lastSeenAt": str(row["last_seen_at"] or ""),
            "hasPrivateMaster": media_id in master_ids,
        })
    return parsed


def main() -> None:
    parser = argparse.ArgumentParser(description="Dry-run private render cache pruning.")
    parser.add_argument("--protected-photo-id", action="append", default=[], help="Media/photo id to protect.")
    parser.add_argument("--protected-photo-ids-file", type=Path, help="JSON array or newline file of sold/protected media ids.")
    parser.add_argument("--json", action="store_true", help="Print full JSON report.")
    args = parser.parse_args()

    protected = {str(value).strip() for value in args.protected_photo_id if str(value).strip()}
    protected.update(read_protected_ids(args.protected_photo_ids_file))
    with sqlite3.connect(OWNER_DB) as conn:
        rows = load_rows(conn)
    protected_rows = [row for row in rows if row["mediaId"] in protected]
    candidates = [row for row in rows if row["mediaId"] not in protected]
    missing_master = [row for row in candidates if not row["hasPrivateMaster"]]
    candidate_bytes = sum(int(row["bytes"] or 0) for row in candidates)
    report = {
        "ok": True,
        "mode": "dry-run",
        "deleteImplemented": False,
        "privateRenderCount": len(rows),
        "protectedRenderCount": len(protected_rows),
        "candidateRenderCount": len(candidates),
        "candidateBytes": candidate_bytes,
        "candidateBytesMiB": round(candidate_bytes / 1024 / 1024, 2),
        "candidateRowsMissingPrivateMaster": len(missing_master),
        "protectionSource": "provided" if protected else "none",
        "warning": "" if protected else "No sold/protected media ids were provided; do not delete from this report yet.",
        "candidates": candidates[:500],
        "protected": protected_rows[:500],
        "missingPrivateMaster": missing_master[:500],
    }
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return
    print("Private render cache prune dry run")
    print(f"Private render objects: {report['privateRenderCount']:,}")
    print(f"Protected render objects: {report['protectedRenderCount']:,}")
    print(f"Delete candidates: {report['candidateRenderCount']:,}")
    print(f"Estimated bytes reclaimable: {report['candidateBytesMiB']:,} MiB")
    print(f"Candidate rows missing private master: {report['candidateRowsMissingPrivateMaster']:,}")
    if report["warning"]:
        print(f"Warning: {report['warning']}")


if __name__ == "__main__":
    main()
