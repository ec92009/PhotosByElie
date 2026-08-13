#!/usr/bin/env python3
"""Inventory legacy PhotoKit-local Sidecar tombstones for PBB-78 redesign.

The former ``--apply`` path is intentionally retired. Sidecar is not a
lifecycle authority, and this script must never write tombstones locally or to
cloud state. A future PBB-78 migration requires its own canonical PBB-79
gateway contract and receipt-backed deployed deny projection.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
import sqlite3
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OWNER_DB = REPO_ROOT / "assets/owner-actions/Owner.sqlite"
DEFAULT_MAPPING = REPO_ROOT / "tmp/sidecar-cloud-id-map/max-local-to-cloud.jsonl"
DEFAULT_REPORT = REPO_ROOT / "tmp/sidecar-tombstone-audit/cloud-migration-report.json"


@dataclass(frozen=True)
class MigrationRow:
    local_identifier: str
    cloud_identifier: str
    reason: str
    tombstoned_at: str


def load_mapping(path: Path) -> dict[str, str]:
    mapping: dict[str, str] = {}
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get("ok") and row.get("localIdentifier") and row.get("cloudIdentifier"):
                mapping[str(row["localIdentifier"])] = str(row["cloudIdentifier"])
    return mapping


def migration_plan(owner_db: Path, mapping: dict[str, str]) -> tuple[list[MigrationRow], list[str], set[str]]:
    conn = sqlite3.connect(f"{owner_db.resolve().as_uri()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        legacy_rows = conn.execute(
            """
            SELECT t.asset_id, t.reason, t.tombstoned_at
            FROM sidecar_tombstones AS t
            JOIN sidecar_assets AS a ON a.asset_id = t.asset_id
            WHERE t.tombstone_state = 'active'
              AND instr(t.asset_id, ':') = 0
              AND a.missing_at IS NOT NULL
              AND a.missing_at <> ''
            ORDER BY t.asset_id
            """
        ).fetchall()
        current_cloud_ids = {
            str(row[0])
            for row in conn.execute(
                """
                SELECT asset_id
                FROM sidecar_assets
                WHERE instr(asset_id, ':') > 0
                  AND (missing_at IS NULL OR missing_at = '')
                """
            )
        }
    finally:
        conn.close()

    rows: list[MigrationRow] = []
    unmapped: list[str] = []
    for row in legacy_rows:
        local_identifier = str(row["asset_id"])
        cloud_identifier = mapping.get(local_identifier, "")
        if not cloud_identifier:
            unmapped.append(local_identifier)
            continue
        rows.append(MigrationRow(
            local_identifier=local_identifier,
            cloud_identifier=cloud_identifier,
            reason=str(row["reason"] or "legacy Sidecar tombstone"),
            tombstoned_at=str(row["tombstoned_at"] or ""),
        ))
    return rows, unmapped, current_cloud_ids


def write_report(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner-db", type=Path, default=DEFAULT_OWNER_DB)
    parser.add_argument("--mapping", type=Path, default=DEFAULT_MAPPING)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Retired: exits before reading inputs and never writes lifecycle state.",
    )
    args = parser.parse_args()
    if args.apply:
        parser.error(
            "--apply is retired: Sidecar cannot write lifecycle state. "
            "PBB-78 requires a separately designed canonical PBB-79 gateway migration."
        )

    mapping = load_mapping(args.mapping)
    rows, unmapped, current_cloud_ids = migration_plan(args.owner_db, mapping)
    plan = {
        "ok": not unmapped,
        "mode": "inventory-only",
        "legacyTombstoneCount": len(rows) + len(unmapped),
        "mappedCount": len(rows),
        "unmappedCount": len(unmapped),
        "uniqueCloudTargetCount": len({row.cloud_identifier for row in rows}),
        "currentIndexTargetCount": sum(row.cloud_identifier in current_cloud_ids for row in rows),
        "absentCurrentIndexTargetCount": sum(row.cloud_identifier not in current_cloud_ids for row in rows),
        "unmappedLocalIdentifiers": unmapped,
    }
    write_report(args.report, plan)
    print(json.dumps(plan, indent=2))
    return 0 if not unmapped else 2


if __name__ == "__main__":
    raise SystemExit(main())
