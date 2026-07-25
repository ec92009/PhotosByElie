#!/usr/bin/env python3
"""Run a reversible old/new Owner fixture parity rehearsal.

The rehearsal uses isolated temporary Owner databases.  It compares the legacy
direct fixture functions with the enrolled connector dispatch used by native
Backstage, proves failed operations are atomic, and proves a SQLite backup can
restore the native-path state.  Live Owner state and public/client artifacts
are hashed only; they are never opened for mutation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import fixture_pipeline
import local_server
import sidecar_state_db


PUBLIC_GUARD_PATHS = (
    "index.html",
    "gallery.html",
    "photo.html",
    "basket.html",
    "liked.html",
    "order.html",
    "real-estate.html",
    "shared-auth.js",
    "photo-gallery.js",
    "photo-detail.js",
    "photos-data.js",
    "assets/catalog/photosbyelie.sqlite",
    "worker/photos-catalog.generated.mjs",
)


def sha256_file(path: Path) -> str:
    """Return a stable SHA-256 or a missing marker."""
    if not path.exists():
        return "missing"
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def guarded_hashes(repo_root: Path) -> dict[str, str]:
    """Hash public/client artifacts and the live Owner database."""
    paths = [*PUBLIC_GUARD_PATHS, "assets/owner-actions/Owner.sqlite"]
    return {relative: sha256_file(repo_root / relative) for relative in paths}


def connector_action(mode: str, **manifest: Any) -> dict[str, Any]:
    """Build the claimed connector envelope used by native Backstage."""
    return {
        "connectorId": "parity-rehearsal",
        "action": {
            "id": f"parity-{mode}",
            "type": "sidecar-culling-review",
            "state": "claimed",
            "claim": {"connectorId": "parity-rehearsal"},
            "payload": {"manifest": {"mode": mode, **manifest}},
        },
    }


def run_connector(root: Path, mode: str, **manifest: Any) -> dict[str, Any]:
    """Execute one native-path operation through connector dispatch."""
    return local_server.new_owner_connector_result(
        root,
        connector_action(mode, **manifest),
    )["result"]


def seed_assets(root: Path) -> None:
    """Seed deterministic, non-real media rows for the isolated rehearsal."""
    sidecar_state_db.upsert_assets(
        root,
        [
            {
                "localIdentifier": "parity-asset-1",
                "filename": "Parity A.jpg",
                "mediaType": "photo",
                "creationDate": "2026-07-25T10:00:00Z",
            },
            {
                "localIdentifier": "parity-asset-2",
                "filename": "Parity B.jpg",
                "mediaType": "photo",
                "creationDate": "2026-07-25T10:01:00Z",
            },
        ],
    )


def fixture_paths(conn: sqlite3.Connection) -> dict[str, str]:
    """Resolve stable fixture IDs into human-comparable hierarchy paths."""
    rows = conn.execute(
        "SELECT fixture_id, parent_fixture_id, name FROM fixtures"
    ).fetchall()
    indexed = {row["fixture_id"]: row for row in rows}
    cache: dict[str, str] = {}

    def resolve(fixture_id: str) -> str:
        if fixture_id in cache:
            return cache[fixture_id]
        row = indexed[fixture_id]
        parent = row["parent_fixture_id"] or ""
        value = f"{resolve(parent)} / {row['name']}" if parent else row["name"]
        cache[fixture_id] = value
        return value

    for fixture_id in indexed:
        resolve(fixture_id)
    return cache


def normalized_snapshot(root: Path) -> dict[str, Any]:
    """Return semantic Owner state without random IDs or timestamps."""
    with fixture_pipeline.connect(root) as conn:
        paths = fixture_paths(conn)
        fixtures = [
            {
                "path": paths[row["fixture_id"]],
                "template": row["template_key"] or "",
                "archived": bool(row["archived_at"]),
                "destinations": json.loads(row["destination_defaults_json"]),
            }
            for row in conn.execute(
                "SELECT * FROM fixtures ORDER BY name COLLATE NOCASE"
            )
        ]
        placements = [
            {
                "path": paths[row["fixture_id"]],
                "assetId": row["asset_id"],
                "state": row["state"],
            }
            for row in conn.execute(
                "SELECT fixture_id, asset_id, state FROM fixture_asset_placements"
            )
        ]
        pools = []
        for row in conn.execute(
            "SELECT pool_id, fixture_id, name, criteria_json FROM fixture_culling_pools"
        ):
            assets = [
                item["asset_id"]
                for item in conn.execute(
                    """SELECT asset_id FROM fixture_pool_assets
                       WHERE pool_id = ? AND removed_at IS NULL
                       ORDER BY snapshot_position""",
                    (row["pool_id"],),
                )
            ]
            pools.append(
                {
                    "path": paths[row["fixture_id"]],
                    "name": row["name"],
                    "criteria": json.loads(row["criteria_json"]),
                    "assets": assets,
                }
            )
        destinations = [
            {
                "path": paths[row["fixture_id"]],
                "assetId": row["asset_id"],
                "destinations": json.loads(row["destinations_json"]),
            }
            for row in conn.execute(
                """SELECT fixture_id, asset_id, destinations_json
                   FROM fixture_asset_destinations"""
            )
        ]
        deliverables = [
            {
                "path": paths[row["fixture_id"]],
                "provider": row["provider"],
                "externalIdentity": row["external_identity"],
                "kind": row["kind"],
                "state": row["state"],
            }
            for row in conn.execute(
                """SELECT fixture_id, provider, external_identity, kind, state
                   FROM fixture_deliverables"""
            )
        ]
        events = [
            {
                "assetId": row["asset_id"],
                "action": row["action"],
                "from": paths.get(row["from_fixture_id"] or "", ""),
                "to": paths.get(row["to_fixture_id"] or "", ""),
            }
            for row in conn.execute(
                """SELECT asset_id, action, from_fixture_id, to_fixture_id
                   FROM fixture_placement_events"""
            )
        ]
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
    sort_key: Callable[[dict[str, Any]], str] = lambda item: json.dumps(
        item, sort_keys=True
    )
    return {
        "fixtures": sorted(fixtures, key=sort_key),
        "placements": sorted(placements, key=sort_key),
        "pools": sorted(pools, key=sort_key),
        "destinations": sorted(destinations, key=sort_key),
        "deliverables": sorted(deliverables, key=sort_key),
        "events": sorted(events, key=sort_key),
        "integrity": integrity,
    }


def direct_scenario(root: Path) -> dict[str, str]:
    """Exercise the existing direct Owner fixture implementation."""
    root_fixture = fixture_pipeline.create_fixture(root, "Parity Root")
    root_id = root_fixture["fixtureId"]
    child = fixture_pipeline.create_fixture(
        root, "Parity Child", parent_fixture_id=root_id
    )
    circle = fixture_pipeline.rename_fixture(
        root, child["fixtureId"], "Parity Circle"
    )
    destination = fixture_pipeline.create_fixture(
        root, "Parity Destination", parent_fixture_id=root_id
    )
    fixture_pipeline.archive_fixture(root, destination["fixtureId"])
    fixture_pipeline.reopen_fixture(root, destination["fixtureId"])
    pool = fixture_pipeline.create_pool(
        root,
        root_id,
        ["parity-asset-1", "parity-asset-2"],
        name="Parity pool",
        criteria={"query": "Parity"},
    )
    root_placements = fixture_pipeline.place_assets(
        root,
        root_id,
        ["parity-asset-1", "parity-asset-2"],
        source_pool_id=pool["poolId"],
        actor="legacy-web-owner",
        reason="parity rehearsal",
    )
    child_placement = fixture_pipeline.place_assets(
        root,
        circle["fixtureId"],
        ["parity-asset-1"],
        actor="legacy-web-owner",
        reason="parity rehearsal",
    )
    fixture_pipeline.move_placement(
        root,
        child_placement["placementIds"][0],
        destination["fixtureId"],
        actor="legacy-web-owner",
        reason="parity rehearsal",
    )
    fixture_pipeline.remove_placement(
        root,
        root_placements["placementIds"][1],
        actor="legacy-web-owner",
        reason="parity rehearsal",
    )
    fixture_pipeline.restore_placement(
        root,
        root_placements["placementIds"][1],
        actor="legacy-web-owner",
        reason="parity rehearsal",
    )
    fixture_pipeline.configure_asset_destinations(
        root, root_id, ["parity-asset-1", "parity-asset-2"], ["r2"]
    )
    fixture_pipeline.link_deliverable(
        root,
        root_id,
        provider="share-link",
        external_identity="https://example.invalid/parity.pdf",
        kind="pdf",
        state="ready",
    )
    return {"root": root_id, "destination": destination["fixtureId"]}


def connector_scenario(root: Path) -> dict[str, str]:
    """Exercise the same behavior through native connector dispatch."""
    root_fixture = run_connector(root, "fixture-create", name="Parity Root")[
        "fixture"
    ]
    root_id = root_fixture["fixtureId"]
    child = run_connector(
        root,
        "fixture-create",
        name="Parity Child",
        parentFixtureId=root_id,
    )["fixture"]
    circle = run_connector(
        root,
        "fixture-rename",
        fixtureId=child["fixtureId"],
        name="Parity Circle",
    )["fixture"]
    destination = run_connector(
        root,
        "fixture-create",
        name="Parity Destination",
        parentFixtureId=root_id,
    )["fixture"]
    run_connector(root, "fixture-archive", fixtureId=destination["fixtureId"])
    run_connector(root, "fixture-reopen", fixtureId=destination["fixtureId"])
    pool = run_connector(
        root,
        "fixture-pool-create",
        fixtureId=root_id,
        selectedAssetIds=["parity-asset-1", "parity-asset-2"],
        name="Parity pool",
        criteria={"query": "Parity"},
    )["pool"]
    child_placement = run_connector(
        root,
        "fixture-place",
        fixtureId=circle["fixtureId"],
        assetIds=["parity-asset-1"],
        reason="parity rehearsal",
    )["placement"]
    run_connector(
        root,
        "fixture-placement-move",
        placementId=child_placement["placementIds"][0],
        fixtureId=destination["fixtureId"],
        reason="parity rehearsal",
    )
    ledger = run_connector(
        root, "fixture-placement-list", fixtureId=root_id
    )["ledger"]
    root_asset_2 = next(
        item
        for item in ledger["items"]
        if item["assetId"] == "parity-asset-2" and item["state"] == "active"
    )
    run_connector(
        root,
        "fixture-placement-remove",
        placementId=root_asset_2["placementId"],
        reason="parity rehearsal",
    )
    run_connector(
        root,
        "fixture-placement-restore",
        placementId=root_asset_2["placementId"],
        reason="parity rehearsal",
    )
    run_connector(
        root,
        "fixture-destinations",
        fixtureId=root_id,
        assetIds=["parity-asset-1", "parity-asset-2"],
        destinations=["r2"],
    )
    run_connector(
        root,
        "fixture-deliverable-link",
        fixtureId=root_id,
        provider="share-link",
        externalIdentity="https://example.invalid/parity.pdf",
        kind="pdf",
        state="ready",
    )
    return {
        "root": root_id,
        "destination": destination["fixtureId"],
        "pool": pool["poolId"],
    }


def assert_failed_move_is_atomic(root: Path, ids: dict[str, str], native: bool) -> bool:
    """Prove a rejected hierarchy cycle leaves semantic state unchanged."""
    before = normalized_snapshot(root)
    try:
        if native:
            run_connector(
                root,
                "fixture-move",
                fixtureId=ids["root"],
                parentFixtureId=ids["destination"],
            )
        else:
            fixture_pipeline.move_fixture(
                root, ids["root"], ids["destination"]
            )
    except ValueError:
        pass
    else:
        raise AssertionError("invalid descendant move unexpectedly succeeded")
    return normalized_snapshot(root) == before


def prove_sqlite_recovery(root: Path, fixture_id: str) -> bool:
    """Mutate isolated state, restore a SQLite backup, and compare semantics."""
    before = normalized_snapshot(root)
    database = root / "assets/owner-actions/Owner.sqlite"
    backup = root / "assets/owner-actions/Owner.parity-backup.sqlite"
    with sqlite3.connect(database) as source, sqlite3.connect(backup) as target:
        source.backup(target)
    fixture_pipeline.rename_fixture(root, fixture_id, "Transient mutation")
    if normalized_snapshot(root) == before:
        raise AssertionError("recovery rehearsal mutation did not change state")
    with sqlite3.connect(backup) as source, sqlite3.connect(database) as target:
        source.backup(target)
    return normalized_snapshot(root) == before


def run_rehearsal(repo_root: Path) -> dict[str, Any]:
    """Run the complete isolated parity and safety rehearsal."""
    repo_root = repo_root.resolve()
    guard_before = guarded_hashes(repo_root)
    with tempfile.TemporaryDirectory(prefix="pbe-owner-parity-") as temp_dir:
        base = Path(temp_dir)
        legacy_root = base / "legacy"
        native_root = base / "native"
        seed_assets(legacy_root)
        seed_assets(native_root)
        legacy_ids = direct_scenario(legacy_root)
        native_ids = connector_scenario(native_root)
        legacy_atomic = assert_failed_move_is_atomic(
            legacy_root, legacy_ids, native=False
        )
        native_atomic = assert_failed_move_is_atomic(
            native_root, native_ids, native=True
        )
        legacy_state = normalized_snapshot(legacy_root)
        native_state = normalized_snapshot(native_root)
        parity = legacy_state == native_state
        recovery = prove_sqlite_recovery(
            native_root, native_ids["destination"]
        )
    guard_after = guarded_hashes(repo_root)
    guard_unchanged = guard_before == guard_after
    report = {
        "schema": "photosbyelie.ownerNativeParityRehearsal.v1",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace(
            "+00:00", "Z"
        ),
        "scenario": {
            "syntheticAssetCount": 2,
            "fixtureOperations": [
                "create",
                "rename",
                "archive",
                "reopen",
                "pool",
                "place",
                "move",
                "remove",
                "restore",
                "destinations",
                "deliverable",
            ],
        },
        "checks": {
            "semanticParity": parity,
            "legacyFailedMoveAtomic": legacy_atomic,
            "nativeFailedMoveAtomic": native_atomic,
            "nativeSqliteBackupRecovery": recovery,
            "liveOwnerDatabaseUnchanged": (
                guard_before["assets/owner-actions/Owner.sqlite"]
                == guard_after["assets/owner-actions/Owner.sqlite"]
            ),
            "publicClientArtifactsUnchanged": all(
                guard_before[path] == guard_after[path]
                for path in PUBLIC_GUARD_PATHS
            ),
            "allGuardedArtifactsUnchanged": guard_unchanged,
        },
        "guardedArtifacts": {
            "count": len(guard_before),
            "sha256Before": guard_before,
            "sha256After": guard_after,
        },
        "passed": all(
            (
                parity,
                legacy_atomic,
                native_atomic,
                recovery,
                guard_unchanged,
            )
        ),
    }
    if not report["passed"]:
        raise AssertionError(json.dumps(report["checks"], sort_keys=True))
    return report


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run the reversible native Owner parity rehearsal."
    )
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = run_rehearsal(args.repo_root)
    if args.report:
        report_path = (
            args.report
            if args.report.is_absolute()
            else args.repo_root / args.report
        )
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
