#!/usr/bin/env python3
"""Report and rehearse legacy Country assignment identity migration.

Report mode is read-only. Apply mode is deliberately gated by a previously
reviewed report, an explicit backup path, and acknowledgement of any unmapped
rows. It is intended for a disposable Owner.sqlite copy until PBE-154 receives
an apply review.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile
from typing import Any, Iterable
import uuid


REPORT_FORMAT = "photosbyelie-country-identity-migration.v1"
COMPATIBILITY_FORMAT = "photosbyelie-country-assignments"
SCHEMA_VERSION = 2
ALLOWED_REVIEWED_EVIDENCE = {
    "canonical-id-receipt",
    "owner-reviewed-receipt",
    "publication-receipt",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
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


def open_read_only(path: Path) -> sqlite3.Connection:
    if not path.is_file():
        raise RuntimeError(f"SQLite database does not exist: {path}")
    conn = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    return conn


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone() is not None


def table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    if not table_exists(conn, table):
        return set()
    return {str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})")}


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _legacy_row(media_id: str, record: dict[str, Any], origin: str) -> dict[str, Any]:
    country_slug = _clean_text(
        record.get("gallery_key")
        or record.get("country_slug")
        or record.get("to_slug")
    )
    if not media_id or not country_slug:
        raise RuntimeError(f"Invalid Country assignment in {origin}: {media_id!r}")
    return {
        "legacyMediaId": media_id,
        "countrySlug": country_slug,
        "sourceSlug": _clean_text(record.get("from_slug") or record.get("source_slug")),
        "batchId": _clean_text(record.get("batch_id")),
        "assignedAt": _clean_text(record.get("assigned_at")),
        "updatedAt": _clean_text(record.get("updated_at")),
        "sourceOrigins": [origin],
        "sourceConflict": "",
    }


def load_legacy_index(path: Path) -> tuple[dict[str, dict[str, Any]], str]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Could not read Country assignment index {path}: {error}") from error
    photos = payload.get("photos") if isinstance(payload, dict) else None
    if not isinstance(photos, dict):
        raise RuntimeError(f"Country assignment index has no photos object: {path}")
    rows: dict[str, dict[str, Any]] = {}
    for raw_id, raw_record in photos.items():
        media_id = _clean_text(raw_id)
        if not isinstance(raw_record, dict):
            raise RuntimeError(f"Country assignment row is not an object: {media_id}")
        rows[media_id] = _legacy_row(media_id, raw_record, "legacy-index")
    return rows, sha256_file(path)


def load_owner_assignments(conn: sqlite3.Connection) -> dict[str, dict[str, Any]]:
    columns = table_columns(conn, "country_assignments")
    if not columns or "media_id" not in columns:
        return {}
    selected = [
        column
        for column in (
            "media_id",
            "asset_id",
            "country_slug",
            "source_slug",
            "batch_id",
            "assigned_at",
            "updated_at",
            "identity_status",
            "identity_source",
            "identity_evidence_json",
        )
        if column in columns
    ]
    rows: dict[str, dict[str, Any]] = {}
    for row in conn.execute(
        f"SELECT {', '.join(selected)} FROM country_assignments WHERE media_id IS NOT NULL ORDER BY media_id"
    ):
        media_id = _clean_text(row["media_id"])
        if not media_id:
            continue
        record = {key: row[key] for key in row.keys()}
        item = _legacy_row(media_id, record, "owner-sqlite")
        asset_id = _clean_text(record.get("asset_id"))
        if asset_id:
            item["existingAssetId"] = asset_id
            item["existingIdentityStatus"] = _clean_text(record.get("identity_status"))
            item["existingIdentitySource"] = _clean_text(record.get("identity_source"))
            item["existingIdentityEvidenceJson"] = _clean_text(record.get("identity_evidence_json"))
        rows[media_id] = item
    return rows


def merge_source_assignments(
    legacy_rows: dict[str, dict[str, Any]],
    owner_rows: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    merged = {media_id: dict(row) for media_id, row in legacy_rows.items()}
    for media_id, owner_row in owner_rows.items():
        current = merged.get(media_id)
        if current is None:
            merged[media_id] = dict(owner_row)
            continue
        current["sourceOrigins"] = sorted(set(current["sourceOrigins"] + owner_row["sourceOrigins"]))
        if current["countrySlug"] != owner_row["countrySlug"]:
            current["sourceConflict"] = (
                f"legacy index says {current['countrySlug']}; Owner.sqlite says {owner_row['countrySlug']}"
            )
        for key in (
            "sourceSlug",
            "batchId",
            "assignedAt",
            "updatedAt",
            "existingAssetId",
            "existingIdentityStatus",
            "existingIdentitySource",
            "existingIdentityEvidenceJson",
        ):
            if not current.get(key) and owner_row.get(key):
                current[key] = owner_row[key]
    return merged


def _reviewed_mapping_rows(payload: Any) -> Iterable[dict[str, Any]]:
    if isinstance(payload, list):
        yield from (row for row in payload if isinstance(row, dict))
        return
    if isinstance(payload, dict):
        rows = payload.get("mappings")
        if isinstance(rows, list):
            yield from (row for row in rows if isinstance(row, dict))
            return
    raise RuntimeError("Reviewed identity map must be a JSON array or an object with a mappings array.")


def load_reviewed_map(path: Path | None) -> tuple[dict[str, list[dict[str, str]]], list[str], str]:
    if path is None:
        return {}, [], ""
    try:
        if path.suffix.lower() == ".jsonl":
            payload: Any = [
                json.loads(line)
                for line in path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
        else:
            payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Could not read reviewed identity map {path}: {error}") from error

    mappings: dict[str, list[dict[str, str]]] = defaultdict(list)
    errors: list[str] = []
    for index, row in enumerate(_reviewed_mapping_rows(payload), start=1):
        media_id = _clean_text(row.get("legacyMediaId"))
        asset_id = _clean_text(row.get("assetId"))
        evidence_type = _clean_text(row.get("evidenceType"))
        evidence_ref = _clean_text(row.get("evidenceRef"))
        reviewed_by = _clean_text(row.get("reviewedBy"))
        reviewed_at = _clean_text(row.get("reviewedAt"))
        if not media_id or not asset_id:
            errors.append(f"row {index}: legacyMediaId and assetId are required")
            continue
        if evidence_type not in ALLOWED_REVIEWED_EVIDENCE:
            errors.append(f"row {index}: unsupported evidenceType {evidence_type!r}")
            continue
        if not evidence_ref or not reviewed_by or not reviewed_at:
            errors.append(f"row {index}: evidenceRef, reviewedBy, and reviewedAt are required")
            continue
        mappings[media_id].append({
            "assetId": asset_id,
            "type": evidence_type,
            "reference": evidence_ref,
            "reviewedBy": reviewed_by,
            "reviewedAt": reviewed_at,
        })
    return dict(mappings), errors, sha256_file(path)


def load_native_evidence(
    conn: sqlite3.Connection,
) -> tuple[set[str], dict[str, list[dict[str, str]]], int]:
    sidecar_ids: set[str] = set()
    if table_exists(conn, "sidecar_assets"):
        sidecar_ids = {
            _clean_text(row[0])
            for row in conn.execute("SELECT asset_id FROM sidecar_assets")
            if _clean_text(row[0])
        }

    publications: dict[str, list[dict[str, str]]] = defaultdict(list)
    publication_count = 0
    if table_exists(conn, "public_catalog_publications"):
        for row in conn.execute(
            """
            SELECT media_id, asset_id, source_version_hash, state
            FROM public_catalog_publications
            ORDER BY media_id, asset_id, source_version_hash
            """
        ):
            publication_count += 1
            media_id = _clean_text(row["media_id"])
            asset_id = _clean_text(row["asset_id"])
            if not media_id or not asset_id:
                continue
            publications[media_id].append({
                "assetId": asset_id,
                "type": "public-catalog-publication",
                "reference": f"{_clean_text(row['source_version_hash'])}:{_clean_text(row['state'])}",
            })
    return sidecar_ids, dict(publications), publication_count


def load_catalog_ids(path: Path | None) -> tuple[set[str], str]:
    if path is None:
        return set(), ""
    conn = open_read_only(path)
    try:
        if not table_exists(conn, "media_items"):
            raise RuntimeError(f"Public catalog has no media_items table: {path}")
        ids = {_clean_text(row[0]) for row in conn.execute("SELECT media_id FROM media_items")}
    finally:
        conn.close()
    return ids, sha256_file(path)


def _deduplicate_evidence(rows: Iterable[dict[str, str]]) -> list[dict[str, str]]:
    unique: dict[tuple[str, str, str], dict[str, str]] = {}
    for row in rows:
        key = (
            _clean_text(row.get("assetId")),
            _clean_text(row.get("type")),
            _clean_text(row.get("reference")),
        )
        if key[0]:
            unique[key] = dict(row)
    return [unique[key] for key in sorted(unique)]


def build_report(
    *,
    legacy_index: Path,
    owner_db: Path,
    catalog_db: Path | None = None,
    reviewed_map: Path | None = None,
    generated_at: str | None = None,
) -> dict[str, Any]:
    legacy_rows, legacy_sha = load_legacy_index(legacy_index)
    conn = open_read_only(owner_db)
    try:
        owner_rows = load_owner_assignments(conn)
        sidecar_ids, publication_map, publication_count = load_native_evidence(conn)
    finally:
        conn.close()
    source_rows = merge_source_assignments(legacy_rows, owner_rows)
    reviewed_mappings, reviewed_errors, reviewed_sha = load_reviewed_map(reviewed_map)
    catalog_ids, catalog_sha = load_catalog_ids(catalog_db)

    report_rows: list[dict[str, Any]] = []
    for media_id in sorted(source_rows):
        source = source_rows[media_id]
        evidence: list[dict[str, str]] = []
        existing_asset_id = _clean_text(source.get("existingAssetId"))
        if existing_asset_id:
            try:
                existing_evidence = json.loads(
                    _clean_text(source.get("existingIdentityEvidenceJson")) or "[]"
                )
            except json.JSONDecodeError:
                existing_evidence = []
            if isinstance(existing_evidence, list) and existing_evidence:
                evidence.extend(
                    dict(item)
                    for item in existing_evidence
                    if isinstance(item, dict) and _clean_text(item.get("assetId"))
                )
            else:
                evidence.append({
                    "assetId": existing_asset_id,
                    "type": "existing-country-assignment",
                    "reference": _clean_text(source.get("existingIdentitySource")) or "Owner.sqlite",
                })
        if media_id in sidecar_ids:
            evidence.append({
                "assetId": media_id,
                "type": "direct-native-asset-id",
                "reference": "sidecar_assets.asset_id",
            })
        evidence.extend(publication_map.get(media_id, []))
        evidence.extend(reviewed_mappings.get(media_id, []))
        evidence = _deduplicate_evidence(evidence)

        invalid_targets = sorted({row["assetId"] for row in evidence if row["assetId"] not in sidecar_ids})
        target_ids = sorted({row["assetId"] for row in evidence if row["assetId"] in sidecar_ids})
        status = "mapped"
        reason = "one explicit native asset identity target"
        asset_id = target_ids[0] if len(target_ids) == 1 else ""
        if source.get("sourceConflict"):
            status = "conflict"
            reason = _clean_text(source["sourceConflict"])
            asset_id = ""
        elif invalid_targets:
            status = "conflict"
            reason = f"identity evidence targets missing Sidecar assets: {', '.join(invalid_targets)}"
            asset_id = ""
        elif len(target_ids) > 1:
            status = "conflict"
            reason = "identity evidence names multiple native assets"
            asset_id = ""
        elif not target_ids:
            status = "unmapped"
            reason = "no explicit native asset identity evidence"

        report_rows.append({
            "legacyMediaId": media_id,
            "countrySlug": source["countrySlug"],
            "sourceSlug": source.get("sourceSlug", ""),
            "batchId": source.get("batchId", ""),
            "assignedAt": source.get("assignedAt", ""),
            "updatedAt": source.get("updatedAt", ""),
            "sourceOrigins": source.get("sourceOrigins", []),
            "status": status,
            "assetId": asset_id,
            "reason": reason,
            "evidence": evidence,
            "legacyCatalogPresent": media_id in catalog_ids,
        })

    by_asset: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in report_rows:
        if row["status"] == "mapped":
            by_asset[row["assetId"]].append(row)
    for asset_id, rows in by_asset.items():
        if len(rows) <= 1:
            continue
        legacy_ids = ", ".join(sorted(row["legacyMediaId"] for row in rows))
        for row in rows:
            row["status"] = "conflict"
            row["assetId"] = ""
            row["reason"] = f"native asset target is claimed by multiple legacy IDs: {legacy_ids}"

    status_counts = {
        status: sum(row["status"] == status for row in report_rows)
        for status in ("mapped", "unmapped", "conflict")
    }
    country_counts: dict[str, int] = defaultdict(int)
    for row in report_rows:
        country_counts[row["countrySlug"]] += 1

    plan_basis = {
        "format": REPORT_FORMAT,
        "schemaVersion": SCHEMA_VERSION,
        "legacyIndexSha256": legacy_sha,
        "reviewedMapSha256": reviewed_sha,
        "rows": [
            {
                key: row[key]
                for key in (
                    "legacyMediaId",
                    "countrySlug",
                    "sourceSlug",
                    "batchId",
                    "assignedAt",
                    "updatedAt",
                    "status",
                    "assetId",
                    "reason",
                    "evidence",
                )
            }
            for row in report_rows
        ],
    }
    summary = {
        "sourceAssignmentCount": len(report_rows),
        "legacyIndexCount": len(legacy_rows),
        "ownerSqliteLegacyCount": len(owner_rows),
        "accountedCount": sum(status_counts.values()),
        "mappedCount": status_counts["mapped"],
        "unmappedCount": status_counts["unmapped"],
        "conflictCount": status_counts["conflict"],
        "legacyCatalogPresenceCount": sum(row["legacyCatalogPresent"] for row in report_rows),
        "directNativeIdMatchCount": sum(
            any(item["type"] == "direct-native-asset-id" for item in row["evidence"])
            for row in report_rows
        ),
        "publicationReceiptMatchCount": sum(
            any(item["type"] == "public-catalog-publication" for item in row["evidence"])
            for row in report_rows
        ),
        "reviewedMapMatchCount": sum(
            any(item["type"] in ALLOWED_REVIEWED_EVIDENCE for item in row["evidence"])
            for row in report_rows
        ),
        "countryCounts": dict(sorted(country_counts.items())),
    }
    return {
        "format": REPORT_FORMAT,
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": generated_at or now_iso(),
        "mode": "read-only-report",
        "planHash": canonical_sha256(plan_basis),
        "source": {
            "legacyIndexSha256": legacy_sha,
            "ownerDbSha256": sha256_file(owner_db),
            "catalogDbSha256": catalog_sha,
            "reviewedMapSha256": reviewed_sha,
            "sidecarAssetCount": len(sidecar_ids),
            "publicationReceiptCount": publication_count,
            "reviewedMapErrorCount": len(reviewed_errors),
            "reviewedMapErrors": reviewed_errors,
        },
        "summary": summary,
        "applyGate": {
            "conflictFree": status_counts["conflict"] == 0 and not reviewed_errors,
            "hasUnmappedRows": status_counts["unmapped"] > 0,
            "requiresReviewedReport": True,
            "requiresBackup": True,
            "requiresExplicitUnmappedAcknowledgement": status_counts["unmapped"] > 0,
        },
        "rows": report_rows,
    }


def validate_report(report: dict[str, Any]) -> None:
    if report.get("format") != REPORT_FORMAT or report.get("schemaVersion") != SCHEMA_VERSION:
        raise RuntimeError("Reviewed report has an unsupported format or schema version.")
    rows = report.get("rows")
    summary = report.get("summary")
    if not isinstance(rows, list) or not isinstance(summary, dict):
        raise RuntimeError("Reviewed report is missing rows or summary.")
    statuses = {"mapped", "unmapped", "conflict"}
    if any(not isinstance(row, dict) or row.get("status") not in statuses for row in rows):
        raise RuntimeError("Reviewed report contains an invalid row status.")
    if len(rows) != int(summary.get("sourceAssignmentCount") or -1):
        raise RuntimeError("Reviewed report source count does not match its rows.")
    if sum(int(summary.get(f"{status}Count") or 0) for status in statuses) != len(rows):
        raise RuntimeError("Reviewed report status counts do not account for every row.")
    basis = {
        "format": REPORT_FORMAT,
        "schemaVersion": SCHEMA_VERSION,
        "legacyIndexSha256": report.get("source", {}).get("legacyIndexSha256", ""),
        "reviewedMapSha256": report.get("source", {}).get("reviewedMapSha256", ""),
        "rows": [
            {
                key: row.get(key, "" if key != "evidence" else [])
                for key in (
                    "legacyMediaId",
                    "countrySlug",
                    "sourceSlug",
                    "batchId",
                    "assignedAt",
                    "updatedAt",
                    "status",
                    "assetId",
                    "reason",
                    "evidence",
                )
            }
            for row in rows
        ],
    }
    if canonical_sha256(basis) != report.get("planHash"):
        raise RuntimeError("Reviewed report planHash does not match its contents.")


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


def compatibility_payload(report: dict[str, Any], migration_id: str, applied_at: str) -> dict[str, Any]:
    photos: dict[str, Any] = {}
    native_assets: dict[str, Any] = {}
    for row in report["rows"]:
        record = {
            "gallery_key": row["countrySlug"],
            "state": "reserve",
            "from_state": "reserve",
            "from_slug": row.get("sourceSlug", ""),
            "assigned_at": row.get("assignedAt", ""),
            "batch_id": row.get("batchId", ""),
            "identity_status": row["status"],
            "asset_id": row.get("assetId", ""),
            "assets": {},
        }
        photos[row["legacyMediaId"]] = record
        if row["status"] == "mapped":
            native_assets[row["assetId"]] = {
                **record,
                "legacy_media_id": row["legacyMediaId"],
            }
    return {
        "format": COMPATIBILITY_FORMAT,
        "schema_version": SCHEMA_VERSION,
        "updated_at": applied_at,
        "latest_batch_id": "",
        "migration": {
            "migration_id": migration_id,
            "plan_hash": report["planHash"],
            "mapped_count": report["summary"]["mappedCount"],
            "unmapped_count": report["summary"]["unmappedCount"],
        },
        "photos": photos,
        "native_assets": native_assets,
    }


def _create_v2_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE country_assignments_v2 (
          assignment_id          TEXT PRIMARY KEY CHECK (trim(assignment_id) <> ''),
          asset_id               TEXT UNIQUE,
          media_id               TEXT UNIQUE,
          country_slug           TEXT NOT NULL CHECK (trim(country_slug) <> ''),
          source_slug            TEXT,
          batch_id               TEXT,
          assigned_at            TEXT,
          updated_at             TEXT,
          identity_status        TEXT NOT NULL CHECK (identity_status IN ('mapped', 'unmapped')),
          identity_source        TEXT NOT NULL DEFAULT '',
          identity_evidence_json TEXT NOT NULL DEFAULT '[]',
          migration_id           TEXT NOT NULL,
          migrated_at            TEXT NOT NULL,
          CHECK (asset_id IS NOT NULL OR media_id IS NOT NULL),
          CHECK (identity_status <> 'mapped' OR asset_id IS NOT NULL),
          CHECK (identity_status <> 'unmapped' OR asset_id IS NULL)
        ) WITHOUT ROWID
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS country_assignment_identity_migrations (
          migration_id   TEXT PRIMARY KEY,
          plan_hash      TEXT NOT NULL UNIQUE,
          source_count   INTEGER NOT NULL,
          mapped_count   INTEGER NOT NULL,
          unmapped_count INTEGER NOT NULL,
          applied_at     TEXT NOT NULL
        ) WITHOUT ROWID
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS country_assignment_identity_migration_rows (
          migration_id    TEXT NOT NULL,
          legacy_media_id TEXT NOT NULL,
          country_slug    TEXT NOT NULL,
          migration_state TEXT NOT NULL CHECK (migration_state IN ('mapped', 'unmapped')),
          asset_id        TEXT,
          evidence_json   TEXT NOT NULL DEFAULT '[]',
          reason           TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (migration_id, legacy_media_id),
          FOREIGN KEY (migration_id) REFERENCES country_assignment_identity_migrations(migration_id)
        ) WITHOUT ROWID
        """
    )


def apply_reviewed_migration(
    *,
    owner_db: Path,
    report: dict[str, Any],
    backup_path: Path,
    compatibility_output: Path,
    allow_unmapped: bool,
    applied_at: str | None = None,
) -> dict[str, Any]:
    validate_report(report)
    if not owner_db.is_file():
        raise RuntimeError(f"Owner.sqlite does not exist: {owner_db}")
    summary = report["summary"]
    if int(summary["conflictCount"]):
        raise RuntimeError("Refusing migration because the reviewed report contains conflicts.")
    if int(report.get("source", {}).get("reviewedMapErrorCount") or 0):
        raise RuntimeError("Refusing migration because the reviewed map contains invalid rows.")
    if int(summary["unmappedCount"]) and not allow_unmapped:
        raise RuntimeError("Refusing migration with unmapped rows unless --allow-unmapped is explicit.")

    conn = sqlite3.connect(owner_db)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    columns = table_columns(conn, "country_assignments")
    if "assignment_id" in columns:
        existing = conn.execute(
            "SELECT migration_id, applied_at FROM country_assignment_identity_migrations WHERE plan_hash = ?",
            (report["planHash"],),
        ).fetchone()
        if not existing:
            conn.close()
            raise RuntimeError("Owner.sqlite already uses Country schema v2 with a different migration plan.")
        migration_id = str(existing["migration_id"])
        migrated_counts = conn.execute(
            """
            SELECT count(*) AS total,
                   sum(identity_status = 'mapped') AS mapped,
                   sum(identity_status = 'unmapped') AS unmapped
            FROM country_assignments
            WHERE migration_id = ?
            """,
            (migration_id,),
        ).fetchone()
        audit_count = conn.execute(
            "SELECT count(*) FROM country_assignment_identity_migration_rows WHERE migration_id = ?",
            (migration_id,),
        ).fetchone()[0]
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        expected_counts = (
            int(summary["sourceAssignmentCount"]),
            int(summary["mappedCount"]),
            int(summary["unmappedCount"]),
        )
        actual_counts = (
            int(migrated_counts["total"] or 0),
            int(migrated_counts["mapped"] or 0),
            int(migrated_counts["unmapped"] or 0),
        )
        if actual_counts != expected_counts or int(audit_count) != expected_counts[0]:
            conn.close()
            raise RuntimeError("Existing Country migration receipt does not match its migrated/audit rows.")
        if integrity != "ok":
            conn.close()
            raise RuntimeError(f"SQLite integrity_check failed: {integrity}")
        conn.close()
        return {
            "ok": True,
            "applied": False,
            "noOp": True,
            "migrationId": migration_id,
            "planHash": report["planHash"],
            **summary,
        }
    if columns != {"media_id", "country_slug", "source_slug", "batch_id", "assigned_at", "updated_at"}:
        conn.close()
        raise RuntimeError(f"Unexpected country_assignments schema: {sorted(columns)}")
    expected_owner_sha = _clean_text(report.get("source", {}).get("ownerDbSha256"))
    current_owner_sha = sha256_file(owner_db)
    if expected_owner_sha and current_owner_sha != expected_owner_sha:
        conn.close()
        raise RuntimeError("Owner.sqlite changed after the reviewed report was generated.")
    mapped_targets = {
        _clean_text(row.get("assetId"))
        for row in report["rows"]
        if row.get("status") == "mapped"
    }
    current_targets = {
        _clean_text(row[0])
        for row in conn.execute("SELECT asset_id FROM sidecar_assets")
    } if mapped_targets and table_exists(conn, "sidecar_assets") else set()
    missing_targets = sorted(mapped_targets - current_targets)
    if missing_targets:
        conn.close()
        raise RuntimeError(
            f"Reviewed migration targets are no longer present in sidecar_assets: {', '.join(missing_targets)}"
        )
    conn.close()

    backup_database(owner_db, backup_path)
    migration_id = f"country-identity-{uuid.uuid4()}"
    timestamp = applied_at or now_iso()
    conn = sqlite3.connect(owner_db)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DROP INDEX IF EXISTS idx_country_assignments_country")
        conn.execute("DROP INDEX IF EXISTS idx_country_assignments_batch")
        conn.execute("ALTER TABLE country_assignments RENAME TO country_assignments_v1")
        _create_v2_schema(conn)
        conn.execute(
            """
            INSERT INTO country_assignment_identity_migrations
              (migration_id, plan_hash, source_count, mapped_count, unmapped_count, applied_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                migration_id,
                report["planHash"],
                int(summary["sourceAssignmentCount"]),
                int(summary["mappedCount"]),
                int(summary["unmappedCount"]),
                timestamp,
            ),
        )
        for row in report["rows"]:
            status = str(row["status"])
            asset_id = _clean_text(row.get("assetId")) or None
            media_id = _clean_text(row["legacyMediaId"])
            assignment_id = f"asset:{asset_id}" if asset_id else f"legacy:{media_id}"
            evidence_json = json.dumps(row.get("evidence") or [], ensure_ascii=False, sort_keys=True)
            identity_source = ",".join(sorted({item["type"] for item in row.get("evidence") or []}))
            if not identity_source:
                identity_source = "unmapped-legacy"
            conn.execute(
                """
                INSERT INTO country_assignments_v2
                  (assignment_id, asset_id, media_id, country_slug, source_slug,
                   batch_id, assigned_at, updated_at, identity_status,
                   identity_source, identity_evidence_json, migration_id, migrated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    assignment_id,
                    asset_id,
                    media_id,
                    row["countrySlug"],
                    row.get("sourceSlug", ""),
                    row.get("batchId", ""),
                    row.get("assignedAt", ""),
                    row.get("updatedAt", ""),
                    status,
                    identity_source,
                    evidence_json,
                    migration_id,
                    timestamp,
                ),
            )
            conn.execute(
                """
                INSERT INTO country_assignment_identity_migration_rows
                  (migration_id, legacy_media_id, country_slug, migration_state,
                   asset_id, evidence_json, reason)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    migration_id,
                    media_id,
                    row["countrySlug"],
                    status,
                    asset_id,
                    evidence_json,
                    row.get("reason", ""),
                ),
            )
        conn.execute("DROP TABLE country_assignments_v1")
        conn.execute("ALTER TABLE country_assignments_v2 RENAME TO country_assignments")
        conn.execute(
            "CREATE INDEX idx_country_assignments_country ON country_assignments(country_slug, media_id)"
        )
        conn.execute(
            "CREATE INDEX idx_country_assignments_batch ON country_assignments(batch_id)"
        )
        conn.execute(
            "CREATE UNIQUE INDEX idx_country_assignments_asset ON country_assignments(asset_id) WHERE asset_id IS NOT NULL"
        )
        conn.execute(
            """
            INSERT INTO owner_settings (setting_key, setting_value, updated_at)
            VALUES ('country_assignment_identity_schema', '2', ?)
            ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at
            """,
            (timestamp,),
        )
        actual = conn.execute("SELECT count(*) FROM country_assignments").fetchone()[0]
        if actual != int(summary["sourceAssignmentCount"]):
            raise RuntimeError(f"Migrated row count {actual} does not match source {summary['sourceAssignmentCount']}.")
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"SQLite integrity_check failed: {integrity}")
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    atomic_write_json(compatibility_output, compatibility_payload(report, migration_id, timestamp))
    return {
        "ok": True,
        "applied": True,
        "noOp": False,
        "migrationId": migration_id,
        "planHash": report["planHash"],
        "backup": str(backup_path),
        "compatibilityOutput": str(compatibility_output),
        **summary,
    }


def load_report(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Could not read reviewed report {path}: {error}") from error
    if not isinstance(payload, dict):
        raise RuntimeError("Reviewed report must be a JSON object.")
    validate_report(payload)
    return payload


def summary_output(report: dict[str, Any]) -> dict[str, Any]:
    return {
        "format": report["format"],
        "generatedAt": report["generatedAt"],
        "planHash": report["planHash"],
        "summary": report["summary"],
        "applyGate": report["applyGate"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--legacy-index", type=Path, required=True)
    parser.add_argument("--owner-db", type=Path, required=True)
    parser.add_argument("--catalog-db", type=Path)
    parser.add_argument("--reviewed-map", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument(
        "--apply-reviewed-report",
        type=Path,
        help="Apply this exact reviewed report to --owner-db. Omit for read-only report mode.",
    )
    parser.add_argument("--backup", type=Path)
    parser.add_argument("--compatibility-output", type=Path)
    parser.add_argument("--allow-unmapped", action="store_true")
    args = parser.parse_args()

    current = build_report(
        legacy_index=args.legacy_index,
        owner_db=args.owner_db,
        catalog_db=args.catalog_db,
        reviewed_map=args.reviewed_map,
    )
    if args.apply_reviewed_report is None:
        atomic_write_json(args.report, current)
        print(json.dumps(summary_output(current), ensure_ascii=False, indent=2))
        return 0

    reviewed = load_report(args.apply_reviewed_report)
    if current["planHash"] != reviewed["planHash"]:
        raise RuntimeError("Current identity evidence does not match the reviewed report planHash.")
    if args.backup is None or args.compatibility_output is None:
        raise RuntimeError("Apply mode requires --backup and --compatibility-output.")
    result = apply_reviewed_migration(
        owner_db=args.owner_db,
        report=reviewed,
        backup_path=args.backup,
        compatibility_output=args.compatibility_output,
        allow_unmapped=args.allow_unmapped,
    )
    atomic_write_json(args.report, {**current, "applyResult": result})
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
