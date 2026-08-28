#!/usr/bin/env python3
"""Produce an aggregate-only Owner/public-catalog reconciliation report.

The audit is deliberately read-only. It compares a deployed production catalog,
a candidate/local catalog, and the Owner publication ledger without emitting any
media identifiers or modifying any of the three databases.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from collections import Counter
from pathlib import Path
from typing import Any


SCHEMA = "photosbyelie.owner-catalog-reconciliation.v1"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _resolve_database(path: Path, *, label: str, reject_wal: bool = False) -> Path:
    if not path.is_absolute():
        raise ValueError(f"{label} path must be absolute")
    try:
        resolved = path.resolve(strict=True)
    except FileNotFoundError as error:
        raise FileNotFoundError(f"{label} does not exist: {path}") from error
    if not resolved.is_file():
        raise ValueError(f"{label} is not a file: {resolved}")
    if reject_wal:
        wal_path = Path(f"{resolved}-wal")
        if wal_path.exists() and wal_path.stat().st_size:
            raise ValueError(
                f"{label} has an uncheckpointed WAL; provide a checkpointed reviewed snapshot"
            )
    return resolved


def _connect_read_only(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"{path.as_uri()}?mode=ro&immutable=1", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    return conn


def _require_table(conn: sqlite3.Connection, table: str, *, label: str) -> None:
    found = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    if not found:
        raise ValueError(f"{label} is missing required table {table}")


def _integrity(conn: sqlite3.Connection, *, label: str) -> str:
    value = str(conn.execute("PRAGMA integrity_check").fetchone()[0])
    if value != "ok":
        raise ValueError(f"{label} failed integrity_check: {value}")
    return value


def _catalog_snapshot(path: Path, *, label: str) -> tuple[dict[str, Any], set[str]]:
    conn = _connect_read_only(path)
    try:
        _require_table(conn, "media_items", label=label)
        integrity = _integrity(conn, label=label)
        media_ids = {
            str(row[0]).strip()
            for row in conn.execute("SELECT media_id FROM media_items")
            if str(row[0] or "").strip()
        }
    finally:
        conn.close()
    return {
        "rows": len(media_ids),
        "bytes": path.stat().st_size,
        "sha256": _sha256(path),
        "integrity": integrity,
    }, media_ids


def _owner_publication_snapshot(
    path: Path,
) -> tuple[
    dict[str, Any],
    dict[str, dict[str, str]],
    dict[str, str],
    set[str],
    set[str],
    set[str],
]:
    conn = _connect_read_only(path)
    try:
        _require_table(conn, "public_catalog_publications", label="Owner authority")
        _require_table(conn, "sidecar_upload_bridge_run_items", label="Owner authority")
        _require_table(conn, "country_assignments", label="Owner authority")
        _require_table(conn, "owner_asset_identity_aliases", label="Owner authority")
        integrity = _integrity(conn, label="Owner authority")
        rows = conn.execute(
            """
            SELECT media_id, state, asset_id
            FROM (
              SELECT media_id, state, asset_id,
                     row_number() OVER (
                       PARTITION BY media_id
                       ORDER BY updated_at DESC, source_version_hash DESC
                     ) AS rank
              FROM public_catalog_publications
              WHERE trim(media_id) <> ''
            )
            WHERE rank = 1
            """
        ).fetchall()
        total_rows = int(
            conn.execute("SELECT count(*) FROM public_catalog_publications").fetchone()[0]
        )
        bridge_rows = conn.execute(
            """
            SELECT photo_id AS media_id, asset_id
            FROM sidecar_upload_bridge_run_items
            WHERE trim(photo_id) <> '' AND trim(asset_id) <> ''
            GROUP BY photo_id, asset_id
            """
        ).fetchall()
        country_rows = conn.execute(
            """
            SELECT media_id, asset_id
            FROM country_assignments
            WHERE identity_status = 'mapped'
              AND trim(COALESCE(media_id, '')) <> ''
              AND trim(COALESCE(asset_id, '')) <> ''
            """
        ).fetchall()
        alias_rows = conn.execute(
            "SELECT legacy_asset_id, canonical_asset_id FROM owner_asset_identity_aliases"
        ).fetchall()
        reconciliation_run = None
        approved_unresolved_ids: set[str] = set()
        if conn.execute(
            """
            SELECT 1 FROM sqlite_master
            WHERE type = 'table' AND name = 'owner_catalog_reconciliation_migrations'
            """
        ).fetchone():
            reconciliation_run = conn.execute(
                """
                SELECT migration_id, plan_hash, approved_policy, production_count,
                       authoritative_count, backfilled_count, unresolved_count,
                       disagreement_count, applied_at
                FROM owner_catalog_reconciliation_migrations
                ORDER BY applied_at DESC, plan_hash DESC
                LIMIT 1
                """
            ).fetchone()
            if reconciliation_run is not None:
                approved_unresolved_ids = {
                    str(row[0]).strip()
                    for row in conn.execute(
                        """
                        SELECT media_id FROM owner_catalog_reconciliation_rows
                        WHERE migration_id = ? AND migration_state = 'unresolved'
                        """,
                        (reconciliation_run["migration_id"],),
                    )
                    if str(row[0] or "").strip()
                }
    finally:
        conn.close()
    latest = {
        str(row["media_id"]).strip(): {
            "state": str(row["state"]).strip(),
            "assetId": str(row["asset_id"]).strip(),
        }
        for row in rows
    }
    aliases = {
        str(row["legacy_asset_id"]).strip(): str(row["canonical_asset_id"]).strip()
        for row in alias_rows
    }

    def canonical_asset_id(value: str) -> str:
        current = value
        seen: set[str] = set()
        while current in aliases:
            if current in seen:
                raise ValueError("Owner authority contains an asset identity alias cycle")
            seen.add(current)
            current = aliases[current]
        return current

    secondary_candidates: dict[str, set[str]] = {}
    for row in (*bridge_rows, *country_rows):
        media_id = str(row["media_id"]).strip()
        asset_id = str(row["asset_id"]).strip()
        secondary_candidates.setdefault(media_id, set()).add(canonical_asset_id(asset_id))
    exact_assets: dict[str, str] = {
        media_id: canonical_asset_id(record["assetId"])
        for media_id, record in latest.items()
    }
    receipt_disagreements = {
        media_id
        for media_id, record in latest.items()
        if secondary_candidates.get(media_id, set()) - {canonical_asset_id(record["assetId"])}
    }
    for media_id, asset_ids in secondary_candidates.items():
        if media_id not in latest and len(asset_ids) == 1:
            exact_assets[media_id] = next(iter(asset_ids))
    conflicting_ids = {
        media_id
        for media_id, asset_ids in secondary_candidates.items()
        if media_id not in latest and len(asset_ids) > 1
    }
    receipt_summary = {
        "present": reconciliation_run is not None,
        "approvedPolicy": str(reconciliation_run["approved_policy"]),
        "productionCount": int(reconciliation_run["production_count"]),
        "authoritativeCount": int(reconciliation_run["authoritative_count"]),
        "backfilledCount": int(reconciliation_run["backfilled_count"]),
        "unresolvedCount": int(reconciliation_run["unresolved_count"]),
        "disagreementCount": int(reconciliation_run["disagreement_count"]),
        "appliedAt": str(reconciliation_run["applied_at"]),
    } if reconciliation_run is not None else {"present": False}
    return {
        "publicationRows": total_rows,
        "distinctMediaIds": len(latest),
        "latestStateCounts": dict(sorted(Counter(record["state"] for record in latest.values()).items())),
        "uploadBridgeMediaIds": len({str(row["media_id"]).strip() for row in bridge_rows}),
        "mappedCountryMediaIds": len({str(row["media_id"]).strip() for row in country_rows}),
        "assetIdentityAliases": len(aliases),
        "exactDurableAssetMappings": len(exact_assets),
        "conflictingDurableAssetMappings": len(conflicting_ids),
        "historicalReceiptDisagreements": len(receipt_disagreements),
        "catalogReconciliationReceipt": receipt_summary,
        "bytes": path.stat().st_size,
        "sha256": _sha256(path),
        "integrity": integrity,
        "mode": "read-only-checkpointed-snapshot",
    }, latest, exact_assets, conflicting_ids, receipt_disagreements, approved_unresolved_ids


def _state_counts(media_ids: set[str], latest: dict[str, dict[str, str]]) -> dict[str, int]:
    return dict(sorted(Counter(latest[value]["state"] for value in media_ids if value in latest).items()))


def reconcile_catalogs(
    *,
    owner_db: Path,
    production_catalog: Path,
    candidate_catalog: Path,
) -> dict[str, Any]:
    owner_path = _resolve_database(owner_db, label="Owner authority", reject_wal=True)
    production_path = _resolve_database(production_catalog, label="Production catalog")
    candidate_path = _resolve_database(candidate_catalog, label="Candidate catalog")

    production, production_ids = _catalog_snapshot(production_path, label="Production catalog")
    candidate, candidate_ids = _catalog_snapshot(candidate_path, label="Candidate catalog")
    (
        owner,
        latest_publications,
        exact_assets,
        conflicting_asset_ids,
        receipt_disagreement_ids,
        approved_unresolved_ids,
    ) = _owner_publication_snapshot(owner_path)
    owner_ids = set(latest_publications)
    exact_asset_ids = set(exact_assets)

    common = production_ids & candidate_ids
    production_only = production_ids - candidate_ids
    candidate_only = candidate_ids - production_ids
    production_mapped = production_ids & owner_ids
    production_unmapped = production_ids - owner_ids
    production_approved_unresolved = production_unmapped & approved_unresolved_ids
    production_unapproved_unresolved = production_unmapped - approved_unresolved_ids
    candidate_only_mapped = candidate_only & owner_ids
    candidate_only_unmapped = candidate_only - owner_ids
    ledger_absent_both = owner_ids - (production_ids | candidate_ids)
    production_exact_assets = production_ids & exact_asset_ids
    production_asset_conflicts = production_ids & conflicting_asset_ids
    production_asset_unresolved = production_ids - exact_asset_ids - conflicting_asset_ids
    production_receipt_disagreements = production_ids & receipt_disagreement_ids
    legacy_exact_assets = production_unmapped & exact_asset_ids
    legacy_asset_conflicts = production_unmapped & conflicting_asset_ids
    legacy_asset_unresolved = production_unmapped - exact_asset_ids - conflicting_asset_ids
    candidate_exact_assets = candidate_ids & exact_asset_ids
    candidate_asset_conflicts = candidate_ids & conflicting_asset_ids
    candidate_asset_unresolved = candidate_ids - exact_asset_ids - conflicting_asset_ids
    candidate_receipt_disagreements = candidate_ids & receipt_disagreement_ids

    verdict = (
        "review-required"
        if production_unapproved_unresolved or production_only or candidate_only_unmapped
        else "ready-with-approved-exceptions"
        if production_approved_unresolved
        else "ready"
    )
    return {
        "schema": SCHEMA,
        "readOnly": True,
        "privacy": "aggregate-only; no media identifiers emitted",
        "verdict": verdict,
        "production": production,
        "candidate": candidate,
        "ownerAuthority": owner,
        "reconciliation": {
            "commonRows": len(common),
            "productionOnlyRows": len(production_only),
            "candidateOnlyRows": len(candidate_only),
            "productionMappedInOwnerLedger": len(production_mapped),
            "productionUnmappedLegacyRows": len(production_unmapped),
            "productionApprovedUnresolvedRows": len(production_approved_unresolved),
            "productionUnapprovedUnresolvedRows": len(production_unapproved_unresolved),
            "productionMappedByLatestState": _state_counts(production_mapped, latest_publications),
            "productionWithExactDurableOwnerAsset": len(production_exact_assets),
            "productionWithConflictingDurableOwnerAssets": len(production_asset_conflicts),
            "productionWithoutDurableOwnerAsset": len(production_asset_unresolved),
            "productionHistoricalReceiptDisagreements": len(production_receipt_disagreements),
            "unmappedLegacyWithExactDurableOwnerAsset": len(legacy_exact_assets),
            "unmappedLegacyWithConflictingDurableOwnerAssets": len(legacy_asset_conflicts),
            "unmappedLegacyWithoutDurableOwnerAsset": len(legacy_asset_unresolved),
            "candidateOnlyMappedInOwnerLedger": len(candidate_only_mapped),
            "candidateOnlyUnmappedRows": len(candidate_only_unmapped),
            "candidateOnlyMappedByLatestState": _state_counts(candidate_only_mapped, latest_publications),
            "candidateWithExactDurableOwnerAsset": len(candidate_exact_assets),
            "candidateWithConflictingDurableOwnerAssets": len(candidate_asset_conflicts),
            "candidateWithoutDurableOwnerAsset": len(candidate_asset_unresolved),
            "candidateHistoricalReceiptDisagreements": len(candidate_receipt_disagreements),
            "ownerLedgerMediaAbsentFromBothCatalogs": len(ledger_absent_both),
            "ownerLedgerAbsentByLatestState": _state_counts(ledger_absent_both, latest_publications),
        },
        "nextGate": (
            "Review and approve the one-time Owner import policy for legacy production rows; "
            "do not mutate Owner or production until that policy is accepted."
            if production_unapproved_unresolved
            else (
                "No legacy import policy gate remains; approved unresolved rows stay public and non-editable."
                if production_approved_unresolved
                else "No legacy import policy gate remains."
            )
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner-db", type=Path, required=True)
    parser.add_argument("--production-catalog", type=Path, required=True)
    parser.add_argument("--candidate-catalog", type=Path, required=True)
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()
    report = reconcile_catalogs(
        owner_db=args.owner_db,
        production_catalog=args.production_catalog,
        candidate_catalog=args.candidate_catalog,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2 if args.pretty else None, sort_keys=args.pretty))


if __name__ == "__main__":
    main()
