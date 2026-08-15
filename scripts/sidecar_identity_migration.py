#!/usr/bin/env python3
"""Dry-run and synthetic-only rehearsal for PBE-143 identity migration.

The migration boundary is deliberately narrow: a source-tied local-to-cloud
mapping is classified without exposing identifiers, and an apply rehearsal is
performed only on a temporary copy of synthetic data.  There is no live Owner
writer or Photos/connector dependency in this module.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
from typing import Any, Iterable, Mapping, Sequence
from urllib.parse import quote


SCHEMA_VERSION = 2
FAILURE_STATUSES = {"failed", "error", "not_found", "missing", "unsupported"}
SAFE_MAPPING_STATUSES = {"ok", "mapped", "collision-existing-canonical", "resolved", "source-tied"}
QUARANTINE_CLASSES = {
    "unmapped",
    "ambiguous",
    "duplicate-local",
    "duplicate-canonical",
    "missing-identity",
}


class MigrationSafetyError(RuntimeError):
    """Raised when a migration cannot be proven safe."""


@dataclass(frozen=True)
class Resolution:
    """One eligible source asset rewrite, kept internal to avoid raw-ID output."""

    source_asset_id: str
    target_asset_id: str
    cloud_identifier: str
    classification: str


# Every persisted Owner reference surface must be named here.  A new table or
# asset-looking column therefore blocks the rehearsal until its semantics are
# reviewed instead of being rewritten accidentally.
DIRECT_REFERENCE_COLUMNS: dict[tuple[str, str], str] = {
    ("sidecar_assets", "asset_id"): "identity-key",
    ("sidecar_decisions", "asset_id"): "state-key",
    ("sidecar_pending_sync", "asset_id"): "state-key",
    ("sidecar_tombstones", "asset_id"): "tombstone-key",
    ("sidecar_mock_uploads", "asset_id"): "state-key",
    ("sidecar_upload_bridge_run_items", "asset_id"): "lineage-reference",
    ("sidecar_upload_bridge_asset_blocks", "asset_id"): "state-key",
    ("fixture_pool_assets", "asset_id"): "fixture-history-reference",
    ("fixture_asset_placements", "asset_id"): "fixture-history-reference",
    ("fixture_asset_decisions", "asset_id"): "fixture-decision-key",
    ("fixture_asset_decision_events", "asset_id"): "fixture-history-reference",
    ("asset_editorial_state", "asset_id"): "editorial-state-key",
    ("asset_delivery_state", "asset_id"): "delivery-state-key",
    ("asset_source_versions", "asset_id"): "preview-version-key",
    ("asset_sync_state", "asset_id"): "sync-state-key",
    # This is a persisted PhotoKit-local value, not an Owner asset FK.  It is
    # intentionally preserved and never rewritten to a cloud identifier.
    ("asset_sync_state", "photos_asset_id"): "source-local-preserve",
    ("asset_publications", "asset_id"): "publication-lineage-reference",
    ("public_catalog_publications", "asset_id"): "publication-lineage-reference",
    ("catalog_collection_resolutions", "asset_id"): "publication-lineage-reference",
    ("asset_sale_references", "asset_id"): "sale-lineage-reference",
    ("r2_quarantine", "asset_id"): "delivery-lineage-reference",
    ("asset_upload_run_items", "asset_id"): "delivery-lineage-reference",
    ("asset_editorial_events", "asset_id"): "editorial-history-reference",
    ("asset_ai_proposals", "asset_id"): "editorial-history-reference",
    ("asset_ai_run_items", "asset_id"): "editorial-history-reference",
    ("fixture_review_operations", "anchor_asset_id"): "review-history-reference",
    ("fixture_placement_events", "asset_id"): "fixture-history-reference",
    ("fixture_asset_destinations", "asset_id"): "delivery-config-reference",
    ("fixture_delivery_receipts", "asset_id"): "delivery-receipt-reference",
}

JSON_REFERENCE_COLUMNS: dict[tuple[str, str], str] = {
    # This is a reviewed list of Owner asset references.  before_json and
    # after_json remain immutable audit snapshots and are not rewritten.
    ("fixture_review_operations", "asset_ids_json"): "review-history-id-list",
}

STATE_DEFAULTS: dict[tuple[str, str], Any] = {
    ("sidecar_decisions", "rating"): 0,
    ("sidecar_decisions", "color"): "",
    ("sidecar_decisions", "pick_state"): "undecided",
    ("sidecar_decisions", "metadata_state"): "unreviewed",
    ("sidecar_decisions", "title"): "",
    ("sidecar_decisions", "caption"): "",
    ("sidecar_decisions", "keywords_json"): "[]",
    ("sidecar_decisions", "rework_category"): "",
    ("sidecar_decisions", "rework_comment"): "",
    ("sidecar_decisions", "metadata_ai_rung"): "",
    ("sidecar_decisions", "metadata_ai_evidence_json"): "[]",
    ("sidecar_decisions", "metadata_ai_note"): "",
    ("sidecar_decisions", "metadata_ai_attempt_count"): 0,
    ("sidecar_decisions", "metadata_ai_last_error"): "",
    ("sidecar_decisions", "metadata_ai_last_attempt_at"): "",
    ("sidecar_decisions", "last_action"): "",
    ("fixture_asset_decisions", "placement_state"): "undecided",
    ("fixture_asset_decisions", "eligibility_state"): "active",
    ("fixture_asset_decisions", "source"): "native",
    ("fixture_asset_decisions", "last_action"): "",
    ("asset_editorial_state", "editorial_state"): "unreviewed",
    ("asset_editorial_state", "ai_reasons_json"): "[]",
    ("asset_editorial_state", "ai_note"): "",
    ("asset_editorial_state", "ai_attempt_count"): 0,
    ("asset_editorial_state", "ai_last_error"): "",
    ("asset_delivery_state", "delivery_state"): "not-ready",
    ("asset_delivery_state", "source_version_hash"): "",
    ("asset_delivery_state", "last_error"): "",
    ("asset_sync_state", "photos_asset_id"): "",
    ("asset_sync_state", "metadata_fingerprint"): "",
    ("asset_sync_state", "rendered_fingerprint"): "",
    ("asset_sync_state", "last_giveback_fingerprint"): "",
    ("asset_sync_state", "last_error"): "",
    ("sidecar_tombstones", "tombstone_state"): "restored",
    ("sidecar_tombstones", "reason"): "",
    ("sidecar_mock_uploads", "mock_state"): "cleared",
}

LOGICAL_KEY_COLUMNS: dict[str, tuple[str, ...]] = {
    "sidecar_decisions": ("asset_id",),
    "sidecar_pending_sync": ("sync_id",),
    "sidecar_tombstones": ("asset_id",),
    "sidecar_mock_uploads": ("asset_id",),
    "sidecar_upload_bridge_run_items": ("run_item_id",),
    "sidecar_upload_bridge_asset_blocks": ("asset_id",),
    "fixture_pool_assets": ("pool_id", "asset_id"),
    "fixture_asset_placements": ("placement_id",),
    "fixture_asset_decisions": ("fixture_id", "asset_id"),
    "fixture_asset_decision_events": ("event_id",),
    "asset_editorial_state": ("asset_id",),
    "asset_delivery_state": ("asset_id",),
    "asset_source_versions": ("asset_id", "metadata_fingerprint", "rendered_fingerprint"),
    "asset_sync_state": ("asset_id",),
    "asset_publications": ("asset_id", "fixture_id", "source_version_hash"),
    "public_catalog_publications": ("asset_id", "source_version_hash"),
    "catalog_collection_resolutions": ("asset_id", "source_version_hash"),
    "asset_sale_references": ("order_id", "asset_id", "source_version_hash"),
    "r2_quarantine": ("bucket", "object_key"),
    "asset_upload_run_items": ("run_id", "asset_id"),
    "asset_editorial_events": ("event_id",),
    "asset_ai_proposals": ("proposal_id",),
    "asset_ai_run_items": ("run_id", "asset_id"),
    "fixture_review_operations": ("operation_id",),
    "fixture_placement_events": ("event_id",),
    "fixture_asset_destinations": ("fixture_id", "asset_id"),
    "fixture_delivery_receipts": ("receipt_id",),
}

INVARIANT_TABLES = tuple(LOGICAL_KEY_COLUMNS)


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _normalise_cloud(value: Any) -> str:
    text = _text(value)
    if text.startswith("apple-photos-cloud://"):
        return text.removeprefix("apple-photos-cloud://")
    return text


def _anchor_value(value: Any, prefix: str) -> str:
    text = _text(value)
    marker = f"{prefix}://"
    return text[len(marker):] if text.startswith(marker) else ""


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not _text(value):
        return {}
    try:
        parsed = json.loads(_text(value))
    except json.JSONDecodeError as error:
        raise MigrationSafetyError("malformed JSON identity payload") from error
    if not isinstance(parsed, dict):
        raise MigrationSafetyError("identity payload is not a JSON object")
    return parsed


def _json_value(value: Any, fallback: Any = None) -> Any:
    if value is None or value == "":
        return fallback
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(str(value))
    except json.JSONDecodeError as error:
        raise MigrationSafetyError("malformed JSON state value") from error


def _json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _digest(value: Any) -> str:
    return hashlib.sha256(("pbe143\0" + _text(value)).encode("utf-8")).hexdigest()


def _digest_values(values: Iterable[Any]) -> str:
    clean = sorted({_text(value) for value in values if _text(value)})
    return _digest("\n".join(clean))


def _identity(row: Mapping[str, Any]) -> dict[str, str]:
    raw = _json_object(row.get("raw_json", "{}"))
    cloud = ""
    for key in ("cloudIdentifier", "cloudId", "phCloudIdentifier", "cloudIdentifierString"):
        cloud = _normalise_cloud(raw.get(key))
        if cloud:
            break
    if not cloud:
        cloud = _anchor_value(row.get("source_anchor"), "apple-photos-cloud")
    if not cloud:
        cloud = _normalise_cloud(row.get("asset_id")) if _text(row.get("asset_id")).startswith("apple-photos-cloud://") else ""

    local = ""
    for key in ("localIdentifier", "localId"):
        local = _text(raw.get(key))
        if local:
            break
    if not local:
        local = _anchor_value(raw.get("localSourceAnchor"), "apple-photos")
    if not local:
        local = _anchor_value(row.get("source_anchor"), "apple-photos")
    return {
        "asset_id": _text(row.get("asset_id")),
        "cloud": cloud,
        "local": local,
    }


def _mapping_status(row: Mapping[str, Any]) -> str:
    status = _text(row.get("status") or row.get("state") or row.get("result")).casefold()
    if status:
        return status
    if row.get("ok") is False:
        return "failed"
    return "ok"


def _read_only_connection(path: Path) -> sqlite3.Connection:
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise MigrationSafetyError("Owner database does not exist")
    uri = f"file:{quote(str(resolved), safe='/')}?mode=ro&immutable=1"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    return connection


def _open_connection(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(path), timeout=15)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 15000")
    return connection


def _table_names(connection: sqlite3.Connection) -> list[str]:
    return [
        _text(row[0])
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]


def _table_columns(connection: sqlite3.Connection, table: str) -> list[str]:
    quoted = '"' + table.replace('"', '""') + '"'
    return [_text(row[1]) for row in connection.execute(f"PRAGMA table_info({quoted})")]


def _quoted(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def inspect_schema(connection: sqlite3.Connection) -> dict[str, Any]:
    """Return the reviewed reference surface and unknown blockers."""
    unknown: list[dict[str, str]] = []
    surfaces: list[dict[str, str]] = []
    for table in _table_names(connection):
        for column in _table_columns(connection, table):
            lower = column.casefold()
            looks_like_reference = (
                "asset_id" in lower or lower == "asset_ids_json" or lower.endswith("assetids_json")
            )
            if not looks_like_reference:
                continue
            policy = DIRECT_REFERENCE_COLUMNS.get((table, column))
            json_policy = JSON_REFERENCE_COLUMNS.get((table, column))
            if policy:
                surfaces.append({"table": table, "column": column, "policy": policy})
            elif json_policy:
                surfaces.append({"table": table, "column": column, "policy": json_policy})
            else:
                unknown.append({"table": table, "column": column})
    return {
        "surfaceCount": len(surfaces),
        "surfaces": surfaces,
        "unknownSurfaceCount": len(unknown),
        "unknownSurfaces": unknown,
        "schemaDigest": _digest_values(
            f"{table}:{column}" for table in _table_names(connection) for column in _table_columns(connection, table)
        ),
    }


def _read_owner_rows(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    required = {"asset_id", "source_anchor", "raw_json"}
    columns = set(_table_columns(connection, "sidecar_assets")) if "sidecar_assets" in _table_names(connection) else set()
    if not required.issubset(columns):
        raise MigrationSafetyError("sidecar_assets identity schema is incomplete")
    return [dict(row) for row in connection.execute("SELECT * FROM sidecar_assets ORDER BY asset_id")]


def _load_mapping_rows(mapping: Path | Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    rows: list[Mapping[str, Any]] = []
    malformed = 0
    if isinstance(mapping, Path):
        with mapping.expanduser().open("r", encoding="utf-8") as handle:
            for line in handle:
                text = line.strip()
                if not text:
                    continue
                try:
                    parsed = json.loads(text)
                except json.JSONDecodeError:
                    malformed += 1
                    continue
                if isinstance(parsed, dict):
                    rows.append(parsed)
                else:
                    malformed += 1
    else:
        rows = list(mapping)

    candidates: defaultdict[str, set[str]] = defaultdict(set)
    exact_pairs: Counter[tuple[str, str]] = Counter()
    status_counts: Counter[str] = Counter()
    failed_count = 0
    missing_field_count = 0
    ineligible_status_count = 0
    for row in rows:
        status = _mapping_status(row)
        status_counts[status] += 1
        local = _text(
            row.get("localIdentifier")
            or row.get("localId")
            or row.get("assetId")
            or row.get("sourceAssetId")
        )
        cloud = _normalise_cloud(
            row.get("cloudIdentifier")
            or row.get("cloudId")
            or row.get("phCloudIdentifier")
            or row.get("cloudIdentifierString")
            or row.get("targetAssetId")
        )
        if status in FAILURE_STATUSES:
            failed_count += 1
            continue
        if status not in SAFE_MAPPING_STATUSES:
            ineligible_status_count += 1
            continue
        if not local or not cloud:
            missing_field_count += 1
            continue
        candidates[local].add(cloud)
        exact_pairs[(local, cloud)] += 1
    return {
        "inputRowCount": len(rows) + malformed,
        "validPairCount": len(exact_pairs),
        "duplicatePairCount": sum(1 for count in exact_pairs.values() if count > 1),
        "malformedCount": malformed,
        "failedCount": failed_count,
        "missingFieldCount": missing_field_count,
        "ineligibleStatusCount": ineligible_status_count,
        "statusCounts": dict(sorted(status_counts.items())),
        "candidates": candidates,
    }


def _quarantine_entry(row: Mapping[str, Any], classification: str, candidates: Sequence[str]) -> dict[str, Any]:
    ident = _identity(row)
    return {
        "rowDigest": _digest("|".join((ident["asset_id"], ident["local"], *sorted(candidates)))),
        "assetIdDigest": _digest(ident["asset_id"]),
        "localIdentifierDigest": _digest(ident["local"]) if ident["local"] else "",
        "candidateCloudDigest": _digest_values(candidates),
        "classification": classification,
        "candidateCount": len(candidates),
    }


def classify_owner_rows(owner_rows: Sequence[Mapping[str, Any]], mapping: Path | Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    """Classify identities and return an internal resolution list plus safe report."""
    mapping_data = _load_mapping_rows(mapping)
    candidates: Mapping[str, set[str]] = mapping_data["candidates"]
    identities = [_identity(row) for row in owner_rows]
    canonical_by_cloud: defaultdict[str, list[str]] = defaultdict(list)
    local_only_by_local: defaultdict[str, list[str]] = defaultdict(list)
    for identity in identities:
        if identity["cloud"]:
            canonical_by_cloud[identity["cloud"]].append(identity["asset_id"])
        elif identity["local"]:
            local_only_by_local[identity["local"]].append(identity["asset_id"])

    candidate_sources_by_cloud: defaultdict[str, list[str]] = defaultdict(list)
    for identity in identities:
        if identity["cloud"] or not identity["local"]:
            continue
        options = sorted(candidates.get(identity["local"], set()))
        if len(options) == 1 and len(local_only_by_local[identity["local"]]) == 1:
            candidate_sources_by_cloud[options[0]].append(identity["asset_id"])

    counts: Counter[str] = Counter()
    identity_counts: Counter[str] = Counter()
    resolutions: list[Resolution] = []
    quarantine: list[dict[str, Any]] = []
    for row, identity in zip(owner_rows, identities):
        if identity["cloud"]:
            identity_counts["canonical"] += 1
            if len(canonical_by_cloud[identity["cloud"]]) > 1:
                classification = "duplicate-canonical"
            else:
                classification = "canonical"
            options: list[str] = []
        elif identity["local"]:
            identity_counts["local-only"] += 1
            options = sorted(candidates.get(identity["local"], set()))
            if len(local_only_by_local[identity["local"]]) > 1:
                classification = "duplicate-local"
            elif not options:
                classification = "unmapped"
            elif len(options) > 1:
                classification = "ambiguous"
            elif len(candidate_sources_by_cloud[options[0]]) > 1:
                classification = "duplicate-canonical"
            elif options[0] in canonical_by_cloud:
                classification = (
                    "duplicate-canonical"
                    if len(canonical_by_cloud[options[0]]) > 1
                    else "collision-existing-canonical"
                )
            else:
                classification = "local-only"
        else:
            identity_counts["missing-identity"] += 1
            options = []
            classification = "missing-identity"

        counts[classification] += 1
        if classification in {"local-only", "collision-existing-canonical"}:
            target = options[0]
            target_asset = canonical_by_cloud[target][0] if target in canonical_by_cloud else target
            resolutions.append(Resolution(identity["asset_id"], target_asset, target, classification))
        elif classification in QUARANTINE_CLASSES:
            quarantine.append(_quarantine_entry(row, classification, options))

    for key in ("canonical", "local-only", "collision-existing-canonical", "unmapped", "ambiguous", "duplicate-local", "duplicate-canonical", "missing-identity"):
        counts.setdefault(key, 0)
    for key in ("canonical", "local-only", "missing-identity"):
        identity_counts.setdefault(key, 0)

    return {
        "mapping": {
            key: value
            for key, value in mapping_data.items()
            if key != "candidates"
        },
        "identityCounts": dict(sorted(identity_counts.items())),
        "classificationCounts": dict(sorted(counts.items())),
        "eligibleResolutionCount": len(resolutions),
        "eligibleTargetCloudDigest": _digest_values(resolution.cloud_identifier for resolution in resolutions),
        "quarantine": {
            "schemaVersion": SCHEMA_VERSION,
            "privacy": {
                "rawIdentifiersIncluded": False,
                "representation": "salted-sha256-digest-and-counts",
            },
            "entryCount": len(quarantine),
            "entries": quarantine,
        },
        "resolutions": resolutions,
    }


def _quick_check(connection: sqlite3.Connection) -> list[str]:
    return [_text(row[0]) for row in connection.execute("PRAGMA quick_check")]


def _foreign_key_errors(connection: sqlite3.Connection) -> list[list[str]]:
    return [[_text(value) for value in row] for row in connection.execute("PRAGMA foreign_key_check")]


def _canonical_identity_state(connection: sqlite3.Connection) -> dict[str, Any]:
    rows = _read_owner_rows(connection)
    identities = [_identity(row) for row in rows]
    clouds = [identity["cloud"] for identity in identities if identity["cloud"]]
    duplicates = sum(count - 1 for count in Counter(clouds).values() if count > 1)
    return {
        "assetRowCount": len(rows),
        "canonicalCount": len(clouds),
        "localOnlyCount": sum(bool(identity["local"]) and not identity["cloud"] for identity in identities),
        "missingIdentityCount": sum(not identity["cloud"] and not identity["local"] for identity in identities),
        "duplicateCanonicalExtraRows": duplicates,
        "canonicalDigest": _digest_values(clouds),
    }


def _scalar_reference_columns(table: str, columns: Sequence[str]) -> list[str]:
    return [
        column
        for column in columns
        if (table, column) in DIRECT_REFERENCE_COLUMNS
        and DIRECT_REFERENCE_COLUMNS[(table, column)] != "identity-key"
        and DIRECT_REFERENCE_COLUMNS[(table, column)] != "source-local-preserve"
    ]


def _json_contains(value: Any, source: str) -> bool:
    if isinstance(value, str):
        return value == source
    if isinstance(value, list):
        return any(_json_contains(item, source) for item in value)
    if isinstance(value, dict):
        return any(_json_contains(item, source) for item in value.values())
    return False


def _rewrite_json(value: Any, source: str, target: str) -> Any:
    if isinstance(value, str):
        return target if value == source else value
    if isinstance(value, list):
        result: list[Any] = []
        for item in value:
            rewritten = _rewrite_json(item, source, target)
            if rewritten not in result:
                result.append(rewritten)
        return result
    if isinstance(value, dict):
        return {key: _rewrite_json(item, source, target) for key, item in value.items()}
    return value


def _empty(value: Any, default: Any = None) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and not value.strip():
        return True
    if default is not None and value == default:
        return True
    return False


def _merge_json_values(table: str, column: str, target: Any, source: Any) -> Any:
    target_value = _json_value(target, [] if column.endswith("_json") else {})
    source_value = _json_value(source, [] if column.endswith("_json") else {})
    if target_value == source_value:
        return _json_dump(target_value)
    if not target_value:
        return _json_dump(source_value)
    if not source_value:
        return _json_dump(target_value)
    if isinstance(target_value, list) and isinstance(source_value, list):
        combined = list(target_value)
        for item in source_value:
            if item not in combined:
                combined.append(item)
        return _json_dump(combined)
    if isinstance(target_value, dict) and isinstance(source_value, dict):
        combined = dict(target_value)
        for key, value in source_value.items():
            if key not in combined or _empty(combined[key]):
                combined[key] = value
            elif not _empty(value) and combined[key] != value:
                raise MigrationSafetyError(f"conflicting non-empty JSON field {table}.{column}")
        return _json_dump(combined)
    raise MigrationSafetyError(f"conflicting JSON field {table}.{column}")


def _merge_field(table: str, column: str, target: Any, source: Any) -> Any:
    if target == source:
        return target
    default = STATE_DEFAULTS.get((table, column))
    if _empty(target, default):
        return source
    if _empty(source, default):
        return target
    if column.endswith("_json"):
        return _merge_json_values(table, column, target, source)
    if column in {"favorite", "hidden"}:
        return max(int(target or 0), int(source or 0))
    if column.endswith("_count"):
        return max(int(target or 0), int(source or 0))
    if column == "created_at":
        return min(_text(target), _text(source))
    if column == "updated_at" or column.endswith("_at"):
        return max(_text(target), _text(source))
    raise MigrationSafetyError(f"conflicting non-empty field {table}.{column}")


def _merge_raw_json(target_raw: Any, source_raw: Any, target_cloud: str) -> str:
    target = _json_object(target_raw)
    source = _json_object(source_raw)
    for key in ("cloudIdentifier", "cloudId", "phCloudIdentifier", "cloudIdentifierString"):
        source_cloud = _normalise_cloud(source.get(key))
        if source_cloud and source_cloud != target_cloud:
            raise MigrationSafetyError("conflicting cloud identity in raw_json")

    merged = dict(target)
    target_legacy = target.get("legacyLocalIdentifiers", [])
    source_legacy = source.get("legacyLocalIdentifiers", [])
    if isinstance(target_legacy, str):
        target_legacy = [target_legacy]
    if isinstance(source_legacy, str):
        source_legacy = [source_legacy]
    local_values = {
        _text(target.get("localIdentifier")),
        _text(source.get("localIdentifier")),
        *(_text(value) for value in target_legacy if _text(value)),
        *(_text(value) for value in source_legacy if _text(value)),
    }
    local_values.discard("")
    for key, value in source.items():
        if key in {"cloudIdentifier", "cloudId", "phCloudIdentifier", "cloudIdentifierString", "localIdentifier", "legacyLocalIdentifiers"}:
            continue
        if key not in merged or _empty(merged[key]):
            merged[key] = value
        elif not _empty(value) and merged[key] != value:
            raise MigrationSafetyError(f"conflicting non-empty raw_json field {key}")
    if local_values:
        # Keep the current canonical local fallback, while retaining the old
        # source-local namespace as audit/provenance rather than overwriting it.
        current_local = _text(target.get("localIdentifier")) or sorted(local_values)[0]
        merged["localIdentifier"] = current_local
        merged["legacyLocalIdentifiers"] = sorted(local_values - {current_local})
    merged["cloudIdentifier"] = target_cloud
    return _json_dump(merged)


def _primary_key_columns(connection: sqlite3.Connection, table: str) -> list[str]:
    rows = connection.execute(f"PRAGMA table_info({_quoted(table)})").fetchall()
    return [
        _text(row[1])
        for row in sorted(rows, key=lambda row: int(row[5] or 0))
        if int(row[5] or 0) > 0
    ]


def _unique_index_columns(connection: sqlite3.Connection, table: str) -> list[list[str]]:
    indexes: list[list[str]] = []
    for row in connection.execute(f"PRAGMA index_list({_quoted(table)})").fetchall():
        if not int(row[2] or 0) or int(row[4] or 0):
            continue
        name = _text(row[1])
        columns = [
            _text(index_row[2])
            for index_row in connection.execute(f"PRAGMA index_info({_quoted(name)})")
            if _text(index_row[2])
        ]
        if columns:
            indexes.append(columns)
    primary = _primary_key_columns(connection, table)
    if primary and primary not in indexes:
        indexes.append(primary)
    return indexes


def _where_for_values(columns: Sequence[str], values: Mapping[str, Any]) -> tuple[str, list[Any]]:
    if isinstance(values, sqlite3.Row):
        values = dict(values)
    predicates: list[str] = []
    params: list[Any] = []
    for column in columns:
        value = values.get(column)
        if value is None:
            predicates.append(f"{_quoted(column)} IS NULL")
        else:
            predicates.append(f"{_quoted(column)} = ?")
            params.append(value)
    return " AND ".join(predicates), params


def _row_identity(row: Mapping[str, Any], columns: Sequence[str]) -> tuple[Any, ...]:
    return tuple(row[column] for column in columns)


def _update_row(connection: sqlite3.Connection, table: str, before: Mapping[str, Any], after: Mapping[str, Any]) -> None:
    if isinstance(before, sqlite3.Row):
        before = dict(before)
    if isinstance(after, sqlite3.Row):
        after = dict(after)
    columns = _table_columns(connection, table)
    primary = _primary_key_columns(connection, table)
    if primary:
        where_columns = primary
    else:
        where_columns = ["rowid"]
        if "rowid" not in before:
            raise MigrationSafetyError(f"table {table} has no stable key")
    # Primary-key fields are included because rewrite-only references change
    # asset_id in the key itself.  Collision merges pass an already-canonical
    # target row, so its key remains unchanged.
    changed = [column for column in columns if before.get(column) != after.get(column)]
    if not changed:
        return
    assignments = ", ".join(f"{_quoted(column)} = ?" for column in changed)
    where, params = _where_for_values(where_columns, before)
    connection.execute(
        f"UPDATE {_quoted(table)} SET {assignments} WHERE {where}",
        [after.get(column) for column in changed] + params,
    )


def _delete_row(connection: sqlite3.Connection, table: str, row: Mapping[str, Any]) -> None:
    primary = _primary_key_columns(connection, table)
    if not primary:
        raise MigrationSafetyError(f"table {table} has no stable key")
    where, params = _where_for_values(primary, row)
    connection.execute(f"DELETE FROM {_quoted(table)} WHERE {where}", params)


def _rewrite_reference_row(table: str, row: Mapping[str, Any], source: str, target: str) -> dict[str, Any]:
    result = dict(row)
    columns = list(row)
    for column in _scalar_reference_columns(table, columns):
        if result.get(column) == source:
            result[column] = target
    for column in columns:
        if (table, column) not in JSON_REFERENCE_COLUMNS:
            continue
        parsed = _json_value(result.get(column), [])
        result[column] = _json_dump(_rewrite_json(parsed, source, target))
    return result


def _row_references_source(table: str, row: Mapping[str, Any], source: str) -> bool:
    for column in _scalar_reference_columns(table, row):
        if row.get(column) == source:
            return True
    for column in row:
        if (table, column) in JSON_REFERENCE_COLUMNS and _json_contains(_json_value(row.get(column), []), source):
            return True
    return False


def _merge_reference_rows(
    connection: sqlite3.Connection,
    table: str,
    target: Mapping[str, Any],
    source: Mapping[str, Any],
) -> dict[str, Any]:
    result = dict(target)
    primary_columns = set(_primary_key_columns(connection, table))
    for column in _table_columns_from_rows(target, source):
        if column in primary_columns:
            continue
        if column in _scalar_reference_columns(table, list(result)):
            if result.get(column) != source.get(column) and not _empty(result.get(column)) and not _empty(source.get(column)):
                raise MigrationSafetyError(f"conflicting reference field {table}.{column}")
            if _empty(result.get(column)):
                result[column] = source.get(column)
            continue
        if (table, column) in JSON_REFERENCE_COLUMNS:
            result[column] = _merge_json_values(table, column, result.get(column), source.get(column))
            continue
        result[column] = _merge_field(table, column, result.get(column), source.get(column))
    return result


def _table_columns_from_rows(*rows: Mapping[str, Any]) -> list[str]:
    columns: list[str] = []
    for row in rows:
        for column in row:
            if column not in columns:
                columns.append(column)
    return columns


def _find_unique_collision(
    connection: sqlite3.Connection,
    table: str,
    candidate: Mapping[str, Any],
    original: Mapping[str, Any],
) -> sqlite3.Row | None:
    primary = _primary_key_columns(connection, table)
    for unique_columns in _unique_index_columns(connection, table):
        values = {column: candidate.get(column) for column in unique_columns}
        where, params = _where_for_values(unique_columns, values)
        rows = connection.execute(f"SELECT * FROM {_quoted(table)} WHERE {where}", params).fetchall()
        for row in rows:
            if primary and _row_identity(row, primary) == _row_identity(original, primary):
                continue
            return row
    return None


def _rewrite_references(connection: sqlite3.Connection, source: str, target: str) -> int:
    changed = 0
    for table in _table_names(connection):
        if table == "sidecar_assets":
            continue
        columns = _table_columns(connection, table)
        if not any((table, column) in DIRECT_REFERENCE_COLUMNS or (table, column) in JSON_REFERENCE_COLUMNS for column in columns):
            continue
        rows = [dict(row) for row in connection.execute(f"SELECT * FROM {_quoted(table)}")]
        for row in rows:
            if not _row_references_source(table, row, source):
                continue
            candidate = _rewrite_reference_row(table, row, source, target)
            collision = _find_unique_collision(connection, table, candidate, row)
            if collision is not None:
                merged = _merge_reference_rows(connection, table, dict(collision), candidate)
                _update_row(connection, table, collision, merged)
                _delete_row(connection, table, row)
            else:
                _update_row(connection, table, row, candidate)
            changed += 1
    return changed


def _merge_asset_rows(connection: sqlite3.Connection, source: str, target: str, target_cloud: str) -> None:
    source_row = connection.execute("SELECT * FROM sidecar_assets WHERE asset_id = ?", (source,)).fetchone()
    target_row = connection.execute("SELECT * FROM sidecar_assets WHERE asset_id = ?", (target,)).fetchone()
    if not source_row or not target_row:
        raise MigrationSafetyError("asset merge source or target is missing")
    source_data = dict(source_row)
    target_data = dict(target_row)
    merged = dict(target_data)
    for column in _table_columns(connection, "sidecar_assets"):
        if column == "asset_id":
            continue
        if column == "source_anchor":
            # The canonical cloud anchor is the persisted cross-Mac identity.
            merged[column] = f"apple-photos-cloud://{target_cloud}"
            continue
        if column == "raw_json":
            merged[column] = _merge_raw_json(target_data[column], source_data[column], target_cloud)
            continue
        merged[column] = _merge_field("sidecar_assets", column, target_data[column], source_data[column])
    _update_row(connection, "sidecar_assets", target_data, merged)


def _rewrite_asset_only(connection: sqlite3.Connection, source: str, target: str, target_cloud: str) -> None:
    source_row = connection.execute("SELECT * FROM sidecar_assets WHERE asset_id = ?", (source,)).fetchone()
    if not source_row:
        raise MigrationSafetyError("asset rewrite source is missing")
    data = dict(source_row)
    if connection.execute("SELECT 1 FROM sidecar_assets WHERE asset_id = ?", (target,)).fetchone():
        raise MigrationSafetyError("rewrite target unexpectedly exists")
    data["asset_id"] = target
    data["source_anchor"] = f"apple-photos-cloud://{target_cloud}"
    data["raw_json"] = _merge_raw_json("{}", data["raw_json"], target_cloud)
    connection.execute(
        "UPDATE sidecar_assets SET asset_id = ?, source_anchor = ?, raw_json = ? WHERE asset_id = ?",
        (target, data["source_anchor"], data["raw_json"], source),
    )


def _logical_keys(connection: sqlite3.Connection, table: str, resolutions: Mapping[str, str]) -> set[str]:
    if table not in _table_names(connection):
        return set()
    columns = _table_columns(connection, table)
    key_columns = LOGICAL_KEY_COLUMNS.get(table) or tuple(_primary_key_columns(connection, table))
    if not key_columns or not set(key_columns).issubset(columns):
        return set()
    result: set[str] = set()
    for row in connection.execute(f"SELECT * FROM {_quoted(table)}"):
        values: list[Any] = []
        for column in key_columns:
            value = row[column]
            if column in _scalar_reference_columns(table, columns):
                value = resolutions.get(_text(value), _text(value))
            values.append(value)
        result.add(_json_dump(values))
    return result


def _dedupe_keys(connection: sqlite3.Connection, resolutions: Mapping[str, str]) -> set[str]:
    keys: set[str] = set()
    if "sidecar_assets" in _table_names(connection):
        for row in connection.execute("SELECT asset_id, raw_json FROM sidecar_assets"):
            raw = _json_object(row[1])
            checksum = _text(raw.get("checksumSha256") or raw.get("sha256"))
            if checksum:
                asset = resolutions.get(_text(row[0]), _text(row[0]))
                keys.add(_json_dump([asset, "checksumSha256", checksum]))
    if "asset_source_versions" in _table_names(connection):
        for row in connection.execute(
            "SELECT asset_id, metadata_fingerprint, rendered_fingerprint FROM asset_source_versions"
        ):
            asset = resolutions.get(_text(row[0]), _text(row[0]))
            keys.add(_json_dump([asset, "source-version", _text(row[1]), _text(row[2])]))
    return keys


def _domain_snapshot(connection: sqlite3.Connection, resolutions: Mapping[str, str]) -> dict[str, Any]:
    tables = {table: _logical_keys(connection, table, resolutions) for table in INVARIANT_TABLES}
    return {
        "fixtureCount": int(connection.execute("SELECT count(*) FROM fixtures").fetchone()[0]) if "fixtures" in _table_names(connection) else 0,
        "tableKeyCounts": {table: len(keys) for table, keys in tables.items()},
        "tableKeyDigests": {table: _digest_values(keys) for table, keys in tables.items()},
        "exactDedupeKeyCount": len(_dedupe_keys(connection, resolutions)),
        "exactDedupeKeyDigest": _digest_values(_dedupe_keys(connection, resolutions)),
    }


def _verify_invariants(
    connection: sqlite3.Connection,
    before_domain: Mapping[str, Any],
    resolutions: Mapping[str, str],
) -> dict[str, Any]:
    quick = _quick_check(connection)
    foreign_keys = _foreign_key_errors(connection)
    identity = _canonical_identity_state(connection)
    after_domain = _domain_snapshot(connection, {})
    table_results = {
        table: (
            before_domain["tableKeyCounts"].get(table, 0) == after_domain["tableKeyCounts"].get(table, 0)
            and before_domain["tableKeyDigests"].get(table, "") == after_domain["tableKeyDigests"].get(table, "")
        )
        for table in INVARIANT_TABLES
    }
    result = {
        "quickCheckOk": quick == ["ok"],
        "quickCheck": quick,
        "foreignKeysOk": not foreign_keys,
        "foreignKeyErrorCount": len(foreign_keys),
        "canonicalUnique": identity["duplicateCanonicalExtraRows"] == 0,
        "canonicalIdentity": identity,
        "noLegacyLocalOnlyRows": identity["localOnlyCount"] == 0,
        "fixtureCountPreserved": before_domain["fixtureCount"] == after_domain["fixtureCount"],
        "tableKeyResults": table_results,
        "fixtureDecisionHistoryPreserved": all(
            table_results.get(table, True)
            for table in ("fixture_asset_decisions", "fixture_asset_decision_events", "fixture_review_operations")
        ),
        "tombstonesPreserved": table_results.get("sidecar_tombstones", True),
        "deliveryLineagePreserved": all(
            table_results.get(table, True)
            for table in ("asset_delivery_state", "fixture_delivery_receipts", "asset_sale_references")
        ),
        "publicationLineagePreserved": all(
            table_results.get(table, True)
            for table in ("asset_publications", "public_catalog_publications", "catalog_collection_resolutions")
        ),
        "previewsAndVersionsPreserved": table_results.get("asset_source_versions", True),
        "exactDedupeKeysPreserved": (
            before_domain["exactDedupeKeyCount"] == after_domain["exactDedupeKeyCount"]
            and before_domain["exactDedupeKeyDigest"] == after_domain["exactDedupeKeyDigest"]
        ),
    }
    result["allPassed"] = all(
        value
        for key, value in result.items()
        if isinstance(value, bool) and key != "allPassed"
    )
    if not result["allPassed"]:
        raise MigrationSafetyError("post-migration invariant failed")
    return result


def _logical_database_digest(path: Path) -> str:
    connection = _read_only_connection(path)
    try:
        parts: list[str] = []
        for table in _table_names(connection):
            columns = _table_columns(connection, table)
            parts.append(_json_dump([table, columns]))
            for row in connection.execute(f"SELECT * FROM {_quoted(table)}"):
                parts.append(_json_dump([row[column] for column in columns]))
        return _digest("\n".join(parts))
    finally:
        connection.close()


def _copy_sqlite_database(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        destination.unlink()
    source_conn = _read_only_connection(source)
    destination_conn = sqlite3.connect(str(destination))
    try:
        source_conn.backup(destination_conn)
        destination_conn.commit()
    finally:
        destination_conn.close()
        source_conn.close()


def build_dry_run(owner_db: Path, mapping: Path | Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    """Build a safe report; no output contains a raw Apple identifier."""
    connection = _read_only_connection(owner_db)
    try:
        schema = inspect_schema(connection)
        owner_rows = _read_owner_rows(connection)
        classified = classify_owner_rows(owner_rows, mapping)
        resolutions = classified.pop("resolutions")
        blocked = list()
        if schema["unknownSurfaceCount"]:
            blocked.append("unknown-schema-or-reference-surface")
        if classified["quarantine"]["entryCount"]:
            blocked.append("unresolved-or-ambiguous-identities-quarantined")
        if classified["mapping"]["malformedCount"] or classified["mapping"]["missingFieldCount"]:
            blocked.append("invalid-source-mapping-input")
        if classified["mapping"]["failedCount"]:
            blocked.append("failed-source-mapping-rows")
        if classified["mapping"]["ineligibleStatusCount"]:
            blocked.append("ineligible-source-mapping-status")
        if not owner_rows:
            blocked.append("empty-owner-inventory")
        report = {
            "schemaVersion": SCHEMA_VERSION,
            "mode": "dry-run",
            "readOnly": True,
            "database": {"pathDigest": _digest(str(owner_db.expanduser().resolve()))},
            "schema": schema,
            "owner": {
                "assetRowCount": len(owner_rows),
                "identityCounts": classified["identityCounts"],
            },
            "mapping": classified["mapping"],
            "mappingContract": {
                "sourceTiedRequired": True,
                "acceptedPairFields": ["localIdentifier", "cloudIdentifier"],
                "acceptedStatuses": sorted(SAFE_MAPPING_STATUSES),
                "filenameDateInference": False,
                "ineligibleRows": "block before transaction",
            },
            "mergeSemantics": {
                "identity": {
                    "survivor": "verified canonical cloud-ID row",
                    "rewriteOnlyTarget": "canonical cloud identifier becomes the Owner asset key",
                    "localIdentifier": "preserved only as current-source fallback/provenance",
                },
                "scalarReferences": {
                    "knownSurfacesOnly": True,
                    "rewrite": "source Owner asset references become the canonical target",
                    "unknownSurface": "fail closed before transaction",
                },
                "fieldRules": {
                    "nonEmptyConflict": "fail closed",
                    "orderedJsonLists": "stable union without duplicates",
                    "timestamps": "earliest created/requested and latest updated/completed",
                    "attemptCounters": "maximum value",
                    "favoriteOrHiddenFlags": "preserve a positive value",
                    "rawJson": "canonical cloud ID plus legacy local provenance; exact checksum/preview conflicts fail closed",
                },
                "preservedLineage": [
                    "editorial state and proposal history",
                    "fixture pools, placements, decisions, and decision history",
                    "tombstones",
                    "delivery state, previews, source versions, and receipts",
                    "publication, catalog, sale, and exact-dedupe references",
                ],
            },
            "classificationCounts": classified["classificationCounts"],
            "resolution": {
                "eligibleCount": len(resolutions),
                "targetCloudDigest": classified["eligibleTargetCloudDigest"],
            },
            "quarantine": classified["quarantine"],
            "safety": {
                "applyPerformed": False,
                "fixtureMutationPerformed": False,
                "publicationMutationPerformed": False,
                "sourceDeletionPerformed": False,
                "blockedReasons": blocked,
                "applyReady": not blocked,
            },
        }
        return {"report": report, "resolutions": resolutions}
    finally:
        connection.close()


def _apply_transaction(
    working_db: Path,
    resolutions: Sequence[Resolution],
    failure_stage: str = "",
) -> tuple[dict[str, Any], dict[str, Any]]:
    connection = _open_connection(working_db)
    resolution_map = {resolution.source_asset_id: resolution.target_asset_id for resolution in resolutions}
    try:
        preflight = inspect_schema(connection)
        if preflight["unknownSurfaceCount"]:
            raise MigrationSafetyError("unknown schema/reference surface")
        if _quick_check(connection) != ["ok"] or _foreign_key_errors(connection):
            raise MigrationSafetyError("pre-migration SQLite invariant failed")
        before_domain = _domain_snapshot(connection, resolution_map)
        before_logical_digest = _logical_database_digest(working_db)
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("PRAGMA defer_foreign_keys = ON")
        merged_count = 0
        rewrite_count = 0
        reference_count = 0
        for index, resolution in enumerate(resolutions, start=1):
            source_exists = connection.execute(
                "SELECT 1 FROM sidecar_assets WHERE asset_id = ?", (resolution.source_asset_id,)
            ).fetchone()
            if not source_exists:
                continue
            target_exists = connection.execute(
                "SELECT 1 FROM sidecar_assets WHERE asset_id = ?", (resolution.target_asset_id,)
            ).fetchone()
            if target_exists:
                reference_count += _rewrite_references(
                    connection, resolution.source_asset_id, resolution.target_asset_id
                )
                _merge_asset_rows(
                    connection,
                    resolution.source_asset_id,
                    resolution.target_asset_id,
                    resolution.cloud_identifier,
                )
                connection.execute(
                    "DELETE FROM sidecar_assets WHERE asset_id = ?", (resolution.source_asset_id,)
                )
                merged_count += 1
            else:
                _rewrite_asset_only(
                    connection,
                    resolution.source_asset_id,
                    resolution.target_asset_id,
                    resolution.cloud_identifier,
                )
                reference_count += _rewrite_references(
                    connection, resolution.source_asset_id, resolution.target_asset_id
                )
                rewrite_count += 1
            if failure_stage == "after-first-reference" and index == 1:
                raise MigrationSafetyError("injected rehearsal failure after first reference rewrite")
        if failure_stage == "invariant":
            if "fixtures" not in _table_names(connection):
                raise MigrationSafetyError("injected invariant failure")
            if connection.execute("SELECT 1 FROM fixtures LIMIT 1").fetchone() is None:
                raise MigrationSafetyError("injected invariant failure")
            connection.execute("DELETE FROM fixtures")
        invariants = _verify_invariants(connection, before_domain, resolution_map)
        connection.commit()
        return (
            {
                "mergedCount": merged_count,
                "rewriteOnlyCount": rewrite_count,
                "referenceRewriteCount": reference_count,
                "sourceDeletionPerformed": bool(merged_count),
                "fixtureMutationPerformed": False,
                "publicationMutationPerformed": False,
            },
            {
                "invariants": invariants,
                "beforeLogicalDigest": before_logical_digest,
            },
        )
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def rehearse_synthetic(
    owner_db: Path,
    mapping: Path | Iterable[Mapping[str, Any]],
    output_dir: Path,
    *,
    failure_stage: str = "",
) -> dict[str, Any]:
    """Rehearse on a temporary copy and return only privacy-safe evidence."""
    output_dir = output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    dry = build_dry_run(owner_db, mapping)
    report = dry["report"]
    quarantine_path = output_dir / "quarantine-manifest.json"
    report_path = output_dir / "migration-report.json"
    quarantine_path.write_text(_json_dump(report["quarantine"]) + "\n", encoding="utf-8")
    if not report["safety"]["applyReady"]:
        report["rehearsal"] = {
            "syntheticOnly": True,
            "applyPerformed": False,
            "blocked": True,
            "workingCopyCreated": False,
            "sourceReadOnly": True,
        }
        report_path.write_text(_json_dump(report) + "\n", encoding="utf-8")
        return report

    backup_path = output_dir / "backup.sqlite"
    working_path = output_dir / "working.sqlite"
    _copy_sqlite_database(owner_db, backup_path)
    _copy_sqlite_database(owner_db, working_path)
    backup_hash = hashlib.sha256(backup_path.read_bytes()).hexdigest()
    source_hash = hashlib.sha256(owner_db.expanduser().resolve().read_bytes()).hexdigest()
    before_logical_digest = _logical_database_digest(working_path)
    backup_manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "syntheticOnly": True,
        "sourcePathDigest": _digest(str(owner_db.expanduser().resolve())),
        "sourceSha256": source_hash,
        "backupSha256": backup_hash,
        "backupBytes": backup_path.stat().st_size,
        "workingCopySha256Before": hashlib.sha256(working_path.read_bytes()).hexdigest(),
    }
    (output_dir / "backup-manifest.json").write_text(_json_dump(backup_manifest) + "\n", encoding="utf-8")

    resolutions: Sequence[Resolution] = dry["resolutions"]
    try:
        stats, evidence = _apply_transaction(working_path, resolutions, failure_stage=failure_stage)
    except Exception as error:
        rollback_digest = _logical_database_digest(working_path)
        report["rehearsal"] = {
            "syntheticOnly": True,
            "applyPerformed": False,
            "blocked": True,
            "workingCopyCreated": True,
            "sourceReadOnly": True,
            "sourceUnchanged": source_hash == hashlib.sha256(owner_db.expanduser().resolve().read_bytes()).hexdigest(),
            "errorType": type(error).__name__,
            "error": str(error),
            "rollbackVerified": rollback_digest == before_logical_digest,
            "workingCopyLogicalDigestAfterRollback": rollback_digest,
            "backupLogicalDigest": before_logical_digest,
        }
        report_path.write_text(_json_dump(report) + "\n", encoding="utf-8")
        return report

    restored_path = output_dir / "rollback-restored.sqlite"
    shutil.copy2(backup_path, restored_path)
    restored_hash = hashlib.sha256(restored_path.read_bytes()).hexdigest()
    after_hash = hashlib.sha256(working_path.read_bytes()).hexdigest()
    second_before_hash = after_hash
    second_dry = build_dry_run(working_path, mapping)
    second_noop = not second_dry["resolutions"] and second_before_hash == hashlib.sha256(working_path.read_bytes()).hexdigest()
    report["rehearsal"] = {
        "syntheticOnly": True,
        "applyPerformed": True,
        "blocked": False,
        "workingCopyCreated": True,
        "backupSha256": backup_hash,
        "workingCopySha256After": after_hash,
        "rollbackRestoreSha256": restored_hash,
        "rollbackRestoreVerified": restored_hash == backup_hash,
        "secondRunNoOp": second_noop,
        "secondRunEligibleResolutionCount": len(second_dry["resolutions"]),
        "sourceReadOnly": True,
        "sourceUnchanged": source_hash == hashlib.sha256(owner_db.expanduser().resolve().read_bytes()).hexdigest(),
        **stats,
        **evidence,
    }
    report["safety"]["applyPerformed"] = True
    report["safety"]["sourceDeletionPerformed"] = stats["sourceDeletionPerformed"]
    report["safety"]["applyReady"] = False
    report_path.write_text(_json_dump(report) + "\n", encoding="utf-8")
    return report


def main(argv: Sequence[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    dry_parser = subparsers.add_parser("dry-run")
    dry_parser.add_argument("--owner-db", type=Path, required=True)
    dry_parser.add_argument("--mapping", type=Path, required=True)
    dry_parser.add_argument("--report", type=Path)
    rehearse_parser = subparsers.add_parser("rehearse-synthetic")
    rehearse_parser.add_argument("--synthetic-fixture", action="store_true", required=True)
    rehearse_parser.add_argument("--owner-db", type=Path, required=True)
    rehearse_parser.add_argument("--mapping", type=Path, required=True)
    rehearse_parser.add_argument("--output-dir", type=Path, required=True)
    rehearse_parser.add_argument("--failure-stage", default="")
    args = parser.parse_args(argv)
    if args.command == "dry-run":
        report = build_dry_run(args.owner_db, args.mapping)["report"]
        encoded = _json_dump(report)
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(encoded + "\n", encoding="utf-8")
        print(encoded)
        return 0
    report = rehearse_synthetic(
        args.owner_db,
        args.mapping,
        args.output_dir,
        failure_stage=args.failure_stage,
    )
    print(_json_dump(report))
    return 0 if report.get("rehearsal", {}).get("applyPerformed") else 2


if __name__ == "__main__":
    raise SystemExit(main())
