#!/usr/bin/env python3
"""Apply approved PBB-107 dispositions after creating a verified SQLite backup."""

from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from pbb107_legacy_workflow_rehearsal import apply_in_open_transaction


def apply_canonical(
    database_path: Path,
    backup_path: Path,
    *,
    timestamp: str | None = None,
) -> dict[str, object]:
    database = database_path.expanduser().resolve(strict=True)
    backup = backup_path.expanduser().resolve(strict=False)
    if backup.exists():
        raise ValueError("The rollback backup target already exists")
    if database == backup:
        raise ValueError("The rollback backup must be distinct from Owner.sqlite")
    backup.parent.mkdir(parents=True, exist_ok=True)

    checked_at = timestamp or datetime.now(timezone.utc).isoformat().replace(
        "+00:00", "Z"
    )
    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        data_version_before = connection.execute("PRAGMA data_version").fetchone()[0]

        backup_connection = sqlite3.connect(backup)
        try:
            connection.backup(backup_connection)
            integrity = backup_connection.execute("PRAGMA integrity_check").fetchone()[0]
        finally:
            backup_connection.close()
        if integrity != "ok":
            raise RuntimeError("Rollback backup integrity check failed")

        connection.execute("BEGIN IMMEDIATE")
        data_version_after = connection.execute("PRAGMA data_version").fetchone()[0]
        if data_version_before != data_version_after:
            raise RuntimeError(
                "Owner.sqlite changed while its rollback backup was being created"
            )
        result = apply_in_open_transaction(connection, checked_at=checked_at)
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Owner.sqlite integrity check failed before commit")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()

    return {
        "mode": "approved-canonical-transaction",
        "containsRowIdentifiers": False,
        "canonicalMutationPerformed": True,
        "rollbackBackupCreated": True,
        "rollbackBackupIntegrity": "ok",
        **result,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--backup", type=Path, required=True)
    parser.add_argument("--timestamp")
    args = parser.parse_args()
    report = apply_canonical(
        args.database,
        args.backup,
        timestamp=args.timestamp,
    )
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
