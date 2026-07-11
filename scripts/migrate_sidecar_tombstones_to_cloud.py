#!/usr/bin/env python3
"""Migrate legacy PhotoKit-local Sidecar tombstones to Apple cloud IDs."""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import json
import os
from pathlib import Path
import sqlite3
import sys
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OWNER_DB = REPO_ROOT / "assets/owner-actions/Owner.sqlite"
DEFAULT_MAPPING = REPO_ROOT / "tmp/sidecar-cloud-id-map/max-local-to-cloud.jsonl"
DEFAULT_CONFIG = Path.home() / ".config/photosbyelie/connector.json"
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


def configure_cloud(config_path: Path) -> None:
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    os.environ["PBE_OWNER_WORKER_BASE"] = str(payload.get("workerBase") or "").rstrip("/")
    os.environ["PBE_OWNER_CONNECTOR_TOKEN"] = str(payload.get("token") or "")
    os.environ["PBE_OWNER_CONNECTOR_ID"] = str(payload.get("connectorId") or "")
    if not os.environ["PBE_OWNER_WORKER_BASE"] or not os.environ["PBE_OWNER_CONNECTOR_TOKEN"]:
        raise RuntimeError(f"Connector cloud credentials are incomplete: {config_path}")


def apply_migration(rows: list[MigrationRow], batch_size: int) -> tuple[list[dict[str, Any]], int]:
    sys.path.insert(0, str(REPO_ROOT / "scripts"))
    from sidecar_server import _sidecar_cloud_request  # pylint: disable=import-outside-toplevel
    from sidecar_state_db import mirror_cloud_decisions  # pylint: disable=import-outside-toplevel

    migrated: list[dict[str, Any]] = []
    already_active = 0
    for start in range(0, len(rows), batch_size):
        batch = rows[start:start + batch_size]
        query = _sidecar_cloud_request(
            "POST",
            "/owner/sidecar/decisions/query",
            {"assetIds": [row.cloud_identifier for row in batch]},
            timeout=60,
        )
        current = query.get("decisions") if isinstance(query.get("decisions"), dict) else {}
        active_states = [
            {"assetId": row.cloud_identifier, "state": current[row.cloud_identifier]}
            for row in batch
            if current.get(row.cloud_identifier, {}).get("tombstoneState") == "active"
        ]
        if active_states:
            mirror_cloud_decisions(REPO_ROOT, active_states)
        pending = [row for row in batch if current.get(row.cloud_identifier, {}).get("tombstoneState") != "active"]
        already_active += len(batch) - len(pending)
        if not pending:
            print(f"Checked {min(start + len(batch), len(rows))}/{len(rows)}: already protected", flush=True)
            continue
        applied = _sidecar_cloud_request(
            "POST",
            "/owner/sidecar/decisions/apply-batch",
            {
                "decisions": [
                    {
                        "assetId": row.cloud_identifier,
                        "action": "tombstone",
                        "reason": row.reason,
                    }
                    for row in pending
                ]
            },
            timeout=120,
        )
        states = [
            {"assetId": item.get("assetId"), "state": item.get("state")}
            for item in applied.get("items") or []
            if isinstance(item, dict) and item.get("assetId") and isinstance(item.get("state"), dict)
        ]
        if len(states) != len(pending):
            raise RuntimeError(f"Cloud batch returned {len(states)} states for {len(pending)} tombstones.")
        mirror_cloud_decisions(REPO_ROOT, states)
        migrated.extend(states)
        print(
            f"Migrated {len(migrated)}; checked {min(start + len(batch), len(rows))}/{len(rows)}; "
            f"already protected {already_active}",
            flush=True,
        )
    return migrated, already_active


def write_report(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner-db", type=Path, default=DEFAULT_OWNER_DB)
    parser.add_argument("--mapping", type=Path, default=DEFAULT_MAPPING)
    parser.add_argument("--connector-config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--batch-size", type=int, default=25)
    parser.add_argument("--apply", action="store_true", help="Write missing tombstones to cloud state.")
    args = parser.parse_args()

    mapping = load_mapping(args.mapping)
    rows, unmapped, current_cloud_ids = migration_plan(args.owner_db, mapping)
    plan = {
        "ok": not unmapped,
        "mode": "apply" if args.apply else "dry-run",
        "legacyTombstoneCount": len(rows) + len(unmapped),
        "mappedCount": len(rows),
        "unmappedCount": len(unmapped),
        "uniqueCloudTargetCount": len({row.cloud_identifier for row in rows}),
        "currentIndexTargetCount": sum(row.cloud_identifier in current_cloud_ids for row in rows),
        "absentCurrentIndexTargetCount": sum(row.cloud_identifier not in current_cloud_ids for row in rows),
        "unmappedLocalIdentifiers": unmapped,
    }
    if not args.apply:
        write_report(args.report, plan)
        print(json.dumps(plan, indent=2))
        return 0 if not unmapped else 2
    if unmapped:
        raise RuntimeError(f"Refusing migration with {len(unmapped)} unmapped legacy tombstones.")

    configure_cloud(args.connector_config)
    migrated, already_active = apply_migration(rows, max(1, min(args.batch_size, 100)))
    report = {
        **plan,
        "migratedCount": len(migrated),
        "alreadyCloudTombstonedCount": already_active,
        "migrated": [
            {
                "assetId": item["assetId"],
                "tombstoneState": item["state"].get("tombstoneState"),
                "updatedAt": item["state"].get("updatedAt"),
            }
            for item in migrated
        ],
        "sourceRows": [asdict(row) for row in rows],
    }
    write_report(args.report, report)
    print(json.dumps({key: value for key, value in report.items() if key not in {"migrated", "sourceRows"}}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
