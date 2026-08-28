#!/usr/bin/env python3
"""Backfill reviewed legacy public-catalog lineage into Owner.sqlite.

Report mode is read-only and creates a private, deterministic migration plan.
Apply mode requires that exact reviewed plan, a new backup path, explicit
acknowledgement of unresolved legacy rows, and the PBE-173 policy identifier.
It never edits the public catalog.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from typing import Any


REPORT_FORMAT = "photosbyelie-owner-catalog-migration.v1"
SCHEMA_VERSION = 1
APPROVED_POLICY = "PBE-173"
PUBLIC_CATALOG_URL = "https://photos-by-elie.com/assets/catalog/photosbyelie.sqlite"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temp_path = Path(temp_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def _resolve_database(path: Path, *, label: str, reject_wal: bool = False) -> Path:
    if not path.is_absolute():
        raise RuntimeError(f"{label} path must be absolute")
    try:
        resolved = path.resolve(strict=True)
    except FileNotFoundError as error:
        raise RuntimeError(f"{label} does not exist: {path}") from error
    if not resolved.is_file():
        raise RuntimeError(f"{label} is not a file: {resolved}")
    if reject_wal:
        wal_path = Path(f"{resolved}-wal")
        if wal_path.exists() and wal_path.stat().st_size:
            raise RuntimeError(
                f"{label} has an uncheckpointed WAL; provide a checkpointed reviewed database"
            )
    return resolved


def _open_read_only(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"{path.as_uri()}?mode=ro&immutable=1", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    return conn


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone() is not None


def _require_tables(conn: sqlite3.Connection, tables: tuple[str, ...], *, label: str) -> None:
    missing = [table for table in tables if not _table_exists(conn, table)]
    if missing:
        raise RuntimeError(f"{label} is missing required tables: {', '.join(missing)}")


def _integrity(conn: sqlite3.Connection, *, label: str) -> None:
    result = str(conn.execute("PRAGMA integrity_check").fetchone()[0])
    if result != "ok":
        raise RuntimeError(f"{label} failed integrity_check: {result}")


def _canonical_aliases(conn: sqlite3.Connection) -> dict[str, str]:
    aliases = {
        str(row[0]).strip(): str(row[1]).strip()
        for row in conn.execute(
            "SELECT legacy_asset_id, canonical_asset_id FROM owner_asset_identity_aliases"
        )
        if str(row[0] or "").strip() and str(row[1] or "").strip()
    }

    def resolve(value: str) -> str:
        current = value
        seen: set[str] = set()
        while current in aliases:
            if current in seen:
                raise RuntimeError("Owner authority contains an asset identity alias cycle")
            seen.add(current)
            current = aliases[current]
        return current

    return {legacy: resolve(legacy) for legacy in aliases}


def _latest_publications(conn: sqlite3.Connection) -> dict[str, dict[str, str]]:
    rows = conn.execute(
        """
        SELECT asset_id, source_version_hash, media_id, state, public_url,
               catalog_sha256, error_text, created_at, verified_at, updated_at
        FROM (
          SELECT *, row_number() OVER (
            PARTITION BY media_id ORDER BY updated_at DESC, source_version_hash DESC
          ) AS row_rank
          FROM public_catalog_publications
          WHERE trim(media_id) <> ''
        )
        WHERE row_rank = 1
        """
    ).fetchall()
    return {
        str(row["media_id"]).strip(): {
            key: str(row[key] or "")
            for key in (
                "asset_id",
                "source_version_hash",
                "state",
                "public_url",
                "catalog_sha256",
                "error_text",
                "created_at",
                "verified_at",
                "updated_at",
            )
        }
        for row in rows
    }


def _owner_evidence(
    conn: sqlite3.Connection,
) -> tuple[dict[str, set[str]], dict[tuple[str, str], set[str]], set[str]]:
    aliases = _canonical_aliases(conn)

    def canonical(value: str) -> str:
        return aliases.get(value, value)

    candidates: dict[str, set[str]] = defaultdict(set)
    editorial_hashes: dict[tuple[str, str], set[str]] = defaultdict(set)
    for row in conn.execute(
        """
        SELECT photo_id, asset_id, editorial_version_hash
        FROM sidecar_upload_bridge_run_items
        WHERE trim(photo_id) <> '' AND trim(asset_id) <> ''
        """
    ):
        media_id = str(row["photo_id"]).strip()
        asset_id = canonical(str(row["asset_id"]).strip())
        candidates[media_id].add(asset_id)
        version_hash = str(row["editorial_version_hash"] or "").strip()
        if version_hash:
            editorial_hashes[(media_id, asset_id)].add(version_hash)
    for row in conn.execute(
        """
        SELECT media_id, asset_id
        FROM country_assignments
        WHERE identity_status = 'mapped'
          AND trim(COALESCE(media_id, '')) <> ''
          AND trim(COALESCE(asset_id, '')) <> ''
        """
    ):
        candidates[str(row["media_id"]).strip()].add(
            canonical(str(row["asset_id"]).strip())
        )
    sidecar_assets = {
        str(row[0]).strip()
        for row in conn.execute("SELECT asset_id FROM sidecar_assets")
        if str(row[0] or "").strip()
    }
    return candidates, editorial_hashes, sidecar_assets


def build_plan(
    *,
    owner_db: Path,
    production_catalog: Path,
    generated_at: str | None = None,
) -> dict[str, Any]:
    owner_path = _resolve_database(owner_db, label="Owner authority", reject_wal=True)
    catalog_path = _resolve_database(production_catalog, label="Production catalog")
    owner_sha = sha256_file(owner_path)
    catalog_sha = sha256_file(catalog_path)

    owner = _open_read_only(owner_path)
    catalog = _open_read_only(catalog_path)
    try:
        _require_tables(
            owner,
            (
                "public_catalog_publications",
                "sidecar_upload_bridge_run_items",
                "country_assignments",
                "owner_asset_identity_aliases",
                "sidecar_assets",
            ),
            label="Owner authority",
        )
        _require_tables(catalog, ("media_items",), label="Production catalog")
        _integrity(owner, label="Owner authority")
        _integrity(catalog, label="Production catalog")
        publications = _latest_publications(owner)
        candidates, editorial_hashes, sidecar_assets = _owner_evidence(owner)
        media_ids = [
            str(row[0]).strip()
            for row in catalog.execute("SELECT media_id FROM media_items ORDER BY media_id")
            if str(row[0] or "").strip()
        ]
    finally:
        catalog.close()
        owner.close()

    rows: list[dict[str, Any]] = []
    seen_assets: dict[str, str] = {}
    for media_id in media_ids:
        current = publications.get(media_id)
        candidate_assets = sorted(candidates.get(media_id, set()))
        if current is not None:
            disagreement = bool(set(candidate_assets) - {current["asset_id"]})
            rows.append(
                {
                    "mediaId": media_id,
                    "state": "authoritative",
                    "assetId": current["asset_id"],
                    "sourceVersionHash": current["source_version_hash"],
                    "publicationState": current["state"],
                    "receiptDisagreement": disagreement,
                    "reason": "existing public_catalog_publications record is authoritative",
                }
            )
            continue

        if not candidate_assets:
            rows.append(
                {
                    "mediaId": media_id,
                    "state": "unresolved",
                    "assetId": "",
                    "sourceVersionHash": "",
                    "publicationState": "",
                    "receiptDisagreement": False,
                    "reason": "no exact durable Owner asset receipt",
                }
            )
            continue

        if len(candidate_assets) != 1:
            rows.append(
                {
                    "mediaId": media_id,
                    "state": "conflict",
                    "assetId": "",
                    "sourceVersionHash": "",
                    "publicationState": "",
                    "receiptDisagreement": False,
                    "reason": "durable receipts identify multiple Owner assets",
                }
            )
            continue

        asset_id = candidate_assets[0]
        version_hashes = sorted(editorial_hashes.get((media_id, asset_id), set()))
        reason = ""
        if asset_id not in sidecar_assets:
            reason = "exact receipt target is absent from sidecar_assets"
        elif len(version_hashes) != 1:
            reason = "exact asset mapping lacks one unique editorial version receipt"
        elif asset_id in seen_assets:
            reason = "Owner asset is claimed by multiple legacy public rows"
        if reason:
            rows.append(
                {
                    "mediaId": media_id,
                    "state": "conflict",
                    "assetId": "",
                    "sourceVersionHash": "",
                    "publicationState": "",
                    "receiptDisagreement": False,
                    "reason": reason,
                }
            )
            continue
        seen_assets[asset_id] = media_id
        rows.append(
            {
                "mediaId": media_id,
                "state": "backfill",
                "assetId": asset_id,
                "sourceVersionHash": version_hashes[0],
                "publicationState": "live",
                "receiptDisagreement": False,
                "reason": "one exact Owner asset and editorial-version receipt",
            }
        )

    counts = Counter(row["state"] for row in rows)
    plan_basis = {
        "format": REPORT_FORMAT,
        "schemaVersion": SCHEMA_VERSION,
        "ownerDbSha256": owner_sha,
        "productionCatalogSha256": catalog_sha,
        "rows": rows,
    }
    return {
        "format": REPORT_FORMAT,
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": generated_at or now_iso(),
        "mode": "private-read-only-reviewed-plan",
        "privacy": "contains private media and asset identifiers; do not publish",
        "planHash": canonical_sha256(plan_basis),
        "source": {
            "ownerDbSha256": owner_sha,
            "productionCatalogSha256": catalog_sha,
        },
        "summary": {
            "productionCount": len(rows),
            "authoritativeCount": counts["authoritative"],
            "backfillCount": counts["backfill"],
            "unresolvedCount": counts["unresolved"],
            "conflictCount": counts["conflict"],
            "historicalReceiptDisagreementCount": sum(
                bool(row["receiptDisagreement"]) for row in rows
            ),
        },
        "applyGate": {
            "conflictFree": counts["conflict"] == 0,
            "requiresReviewedPlan": True,
            "requiresBackup": True,
            "requiresApprovedPolicy": APPROVED_POLICY,
            "requiresExplicitUnresolvedAcknowledgement": counts["unresolved"] > 0,
        },
        "rows": rows,
    }


def validate_plan(report: dict[str, Any]) -> None:
    if report.get("format") != REPORT_FORMAT or report.get("schemaVersion") != SCHEMA_VERSION:
        raise RuntimeError("Reviewed plan has an unsupported format or schema version")
    rows = report.get("rows")
    summary = report.get("summary")
    source = report.get("source")
    if not isinstance(rows, list) or not isinstance(summary, dict) or not isinstance(source, dict):
        raise RuntimeError("Reviewed plan is missing rows, summary, or source evidence")
    allowed = {"authoritative", "backfill", "unresolved", "conflict"}
    if any(not isinstance(row, dict) or row.get("state") not in allowed for row in rows):
        raise RuntimeError("Reviewed plan contains an invalid row state")
    counts = Counter(row["state"] for row in rows)
    expected = {
        "productionCount": len(rows),
        "authoritativeCount": counts["authoritative"],
        "backfillCount": counts["backfill"],
        "unresolvedCount": counts["unresolved"],
        "conflictCount": counts["conflict"],
        "historicalReceiptDisagreementCount": sum(
            bool(row.get("receiptDisagreement")) for row in rows
        ),
    }
    if any(int(summary.get(key, -1)) != value for key, value in expected.items()):
        raise RuntimeError("Reviewed plan summary does not match its rows")
    basis = {
        "format": REPORT_FORMAT,
        "schemaVersion": SCHEMA_VERSION,
        "ownerDbSha256": str(source.get("ownerDbSha256") or ""),
        "productionCatalogSha256": str(source.get("productionCatalogSha256") or ""),
        "rows": rows,
    }
    if canonical_sha256(basis) != report.get("planHash"):
        raise RuntimeError("Reviewed planHash does not match its contents")


def backup_database(source_path: Path, backup_path: Path) -> None:
    if backup_path.exists():
        raise RuntimeError(f"Refusing to overwrite existing backup: {backup_path}")
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    source = sqlite3.connect(source_path)
    destination = sqlite3.connect(backup_path)
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()


def _create_receipt_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS owner_catalog_reconciliation_migrations (
          migration_id TEXT PRIMARY KEY CHECK (trim(migration_id) <> ''),
          plan_hash TEXT NOT NULL UNIQUE CHECK (trim(plan_hash) <> ''),
          approved_policy TEXT NOT NULL,
          source_owner_sha256 TEXT NOT NULL,
          production_catalog_sha256 TEXT NOT NULL,
          production_count INTEGER NOT NULL,
          authoritative_count INTEGER NOT NULL,
          backfilled_count INTEGER NOT NULL,
          unresolved_count INTEGER NOT NULL,
          disagreement_count INTEGER NOT NULL,
          applied_at TEXT NOT NULL
        ) WITHOUT ROWID
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS owner_catalog_reconciliation_rows (
          migration_id TEXT NOT NULL,
          media_id TEXT NOT NULL,
          migration_state TEXT NOT NULL
            CHECK (migration_state IN ('authoritative', 'backfill', 'unresolved')),
          asset_id TEXT,
          source_version_hash TEXT,
          publication_state TEXT NOT NULL DEFAULT '',
          receipt_disagreement INTEGER NOT NULL DEFAULT 0
            CHECK (receipt_disagreement IN (0, 1)),
          reason TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          PRIMARY KEY (migration_id, media_id),
          FOREIGN KEY (migration_id)
            REFERENCES owner_catalog_reconciliation_migrations(migration_id)
        ) WITHOUT ROWID
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_owner_catalog_reconciliation_rows_state
          ON owner_catalog_reconciliation_rows(migration_state, media_id)
        """
    )


def _verify_existing_receipt(
    conn: sqlite3.Connection, report: dict[str, Any], migration_id: str
) -> None:
    summary = report["summary"]
    row = conn.execute(
        """
        SELECT production_count, authoritative_count, backfilled_count,
               unresolved_count, disagreement_count, approved_policy
        FROM owner_catalog_reconciliation_migrations
        WHERE migration_id = ? AND plan_hash = ?
        """,
        (migration_id, report["planHash"]),
    ).fetchone()
    expected = (
        int(summary["productionCount"]),
        int(summary["authoritativeCount"]),
        int(summary["backfillCount"]),
        int(summary["unresolvedCount"]),
        int(summary["historicalReceiptDisagreementCount"]),
        APPROVED_POLICY,
    )
    if row is None or tuple(row) != expected:
        raise RuntimeError("Existing reconciliation receipt does not match the reviewed plan")
    receipt_count = int(
        conn.execute(
            "SELECT count(*) FROM owner_catalog_reconciliation_rows WHERE migration_id = ?",
            (migration_id,),
        ).fetchone()[0]
    )
    if receipt_count != expected[0]:
        raise RuntimeError("Existing reconciliation row receipts are incomplete")
    for planned in report["rows"]:
        if planned["state"] != "backfill":
            continue
        found = conn.execute(
            """
            SELECT media_id, state, catalog_sha256
            FROM public_catalog_publications
            WHERE asset_id = ? AND source_version_hash = ?
            """,
            (planned["assetId"], planned["sourceVersionHash"]),
        ).fetchone()
        if found is None or tuple(found) != (
            planned["mediaId"],
            "live",
            report["source"]["productionCatalogSha256"],
        ):
            raise RuntimeError("Existing reconciliation publication backfill is incomplete")
    _integrity(conn, label="Owner authority")


def apply_reviewed_plan(
    *,
    owner_db: Path,
    production_catalog: Path,
    report: dict[str, Any],
    backup_path: Path,
    allow_unresolved: bool,
    approved_policy: str,
    applied_at: str | None = None,
    fail_after_publications: int | None = None,
) -> dict[str, Any]:
    validate_plan(report)
    owner_path = _resolve_database(owner_db, label="Owner authority", reject_wal=True)
    catalog_path = _resolve_database(production_catalog, label="Production catalog")
    summary = report["summary"]
    if int(summary["conflictCount"]):
        raise RuntimeError("Refusing migration because the reviewed plan contains conflicts")
    if int(summary["unresolvedCount"]) and not allow_unresolved:
        raise RuntimeError("Refusing migration with unresolved rows unless --allow-unresolved is explicit")
    if approved_policy != APPROVED_POLICY:
        raise RuntimeError(f"Refusing migration without --approved-policy {APPROVED_POLICY}")
    if sha256_file(catalog_path) != report["source"]["productionCatalogSha256"]:
        raise RuntimeError("Production catalog changed after the reviewed plan was generated")

    migration_id = f"owner-catalog-{report['planHash'][:24]}"
    conn = sqlite3.connect(owner_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        if _table_exists(conn, "owner_catalog_reconciliation_migrations"):
            existing = conn.execute(
                "SELECT migration_id FROM owner_catalog_reconciliation_migrations WHERE plan_hash = ?",
                (report["planHash"],),
            ).fetchone()
            if existing:
                existing_id = str(existing["migration_id"])
                _verify_existing_receipt(conn, report, existing_id)
                return {
                    "ok": True,
                    "applied": False,
                    "noOp": True,
                    "migrationId": existing_id,
                    "planHash": report["planHash"],
                    **summary,
                }
    finally:
        conn.close()

    if sha256_file(owner_path) != report["source"]["ownerDbSha256"]:
        raise RuntimeError("Owner.sqlite changed after the reviewed plan was generated")
    backup_database(owner_path, backup_path)
    timestamp = applied_at or now_iso()

    conn = sqlite3.connect(owner_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    publication_count = 0
    try:
        conn.execute("BEGIN IMMEDIATE")
        _create_receipt_schema(conn)
        conn.execute(
            """
            INSERT INTO owner_catalog_reconciliation_migrations (
              migration_id, plan_hash, approved_policy, source_owner_sha256,
              production_catalog_sha256, production_count, authoritative_count,
              backfilled_count, unresolved_count, disagreement_count, applied_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                migration_id,
                report["planHash"],
                APPROVED_POLICY,
                report["source"]["ownerDbSha256"],
                report["source"]["productionCatalogSha256"],
                int(summary["productionCount"]),
                int(summary["authoritativeCount"]),
                int(summary["backfillCount"]),
                int(summary["unresolvedCount"]),
                int(summary["historicalReceiptDisagreementCount"]),
                timestamp,
            ),
        )
        for planned in report["rows"]:
            state = str(planned["state"])
            if state == "backfill":
                conn.execute(
                    """
                    INSERT INTO public_catalog_publications (
                      asset_id, source_version_hash, media_id, state, public_url,
                      catalog_sha256, error_text, created_at, verified_at, updated_at
                    ) VALUES (?, ?, ?, 'live', ?, ?, '', ?, ?, ?)
                    """,
                    (
                        planned["assetId"],
                        planned["sourceVersionHash"],
                        planned["mediaId"],
                        PUBLIC_CATALOG_URL,
                        report["source"]["productionCatalogSha256"],
                        timestamp,
                        timestamp,
                        timestamp,
                    ),
                )
                publication_count += 1
                if (
                    fail_after_publications is not None
                    and publication_count >= fail_after_publications
                ):
                    raise RuntimeError("injected reconciliation failure")
            conn.execute(
                """
                INSERT INTO owner_catalog_reconciliation_rows (
                  migration_id, media_id, migration_state, asset_id,
                  source_version_hash, publication_state, receipt_disagreement,
                  reason, recorded_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    migration_id,
                    planned["mediaId"],
                    state,
                    planned["assetId"] or None,
                    planned["sourceVersionHash"] or None,
                    planned["publicationState"],
                    int(bool(planned["receiptDisagreement"])),
                    planned["reason"],
                    timestamp,
                ),
            )
        _verify_existing_receipt(conn, report, migration_id)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return {
        "ok": True,
        "applied": True,
        "noOp": False,
        "migrationId": migration_id,
        "planHash": report["planHash"],
        "backup": str(backup_path),
        **summary,
    }


def load_plan(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Could not read reviewed plan {path}: {error}") from error
    if not isinstance(payload, dict):
        raise RuntimeError("Reviewed plan must be a JSON object")
    validate_plan(payload)
    return payload


def summary_output(report: dict[str, Any]) -> dict[str, Any]:
    return {
        "format": report["format"],
        "generatedAt": report["generatedAt"],
        "mode": report["mode"],
        "planHash": report["planHash"],
        "summary": report["summary"],
        "applyGate": report["applyGate"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner-db", type=Path, required=True)
    parser.add_argument("--production-catalog", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--apply-reviewed-report", type=Path)
    parser.add_argument("--backup", type=Path)
    parser.add_argument("--allow-unresolved", action="store_true")
    parser.add_argument("--approved-policy", default="")
    args = parser.parse_args()

    if args.apply_reviewed_report is None:
        report = build_plan(
            owner_db=args.owner_db,
            production_catalog=args.production_catalog,
        )
        atomic_write_json(args.report, report)
        print(json.dumps(summary_output(report), ensure_ascii=False, indent=2))
        return 0

    if args.backup is None:
        raise RuntimeError("--backup is required in apply mode")
    reviewed = load_plan(args.apply_reviewed_report)
    result = apply_reviewed_plan(
        owner_db=args.owner_db,
        production_catalog=args.production_catalog,
        report=reviewed,
        backup_path=args.backup,
        allow_unresolved=args.allow_unresolved,
        approved_policy=args.approved_policy,
    )
    atomic_write_json(args.report, result)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
