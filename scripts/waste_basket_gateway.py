"""Authoritative, local Owner SQLite lifecycle gateway for PBB-79.

The gateway is deliberately small and boring at its boundary:

* ``move_to_waste_basket`` is the only normal X writer.
* ``restore_from_waste_basket`` restores the pre-X state from an immutable
  SQLite provenance snapshot.
* ``empty_waste_basket`` is the only normal transition to an active global
  tombstone and requires both explicit confirmation and a confirmation token.
* ``restore_tombstone`` is a separate, auditable operation.

JSON columns in the existing Owner database are retained as embedded row
values, but JSON files are never used as lifecycle authority.  The gateway
does not delete source media, R2 objects, catalog rows, or history.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
from typing import Any, Callable, Iterable
import uuid

import fixture_pipeline
import owner_state_db
import sidecar_state_db


DEFAULT_DB = sidecar_state_db.DEFAULT_DB
EMPTY_CONFIRMATION_TOKEN = "EMPTY_WASTE_BASKET"
MAX_ASSET_IDS = 500
MAX_HOSTED_LIFECYCLE_ATTEMPTS = 3

NORMAL_SOURCES = {
    "backstage-culling",
    "backstage-review",
    "owner-web",
    "owner-gallery",
    "backstage-waste-basket",
}
OWNER_GALLERY_SOURCES = {"owner-gallery"}
PROVENANCE_TABLES = (
    "sidecar_assets",
    "sidecar_decisions",
    "sidecar_tombstones",
    "sidecar_pending_sync",
    "sidecar_mock_uploads",
    "sidecar_upload_bridge_run_items",
    "fixture_pool_assets",
    "fixture_asset_placements",
    "fixture_asset_decisions",
    "fixture_asset_decision_events",
    "asset_editorial_state",
    "asset_delivery_state",
    "r2_objects",
    "asset_source_versions",
    "asset_sync_state",
    "asset_publications",
    "public_catalog_publications",
    "catalog_collection_resolutions",
    "asset_sale_references",
    "r2_quarantine",
    "fixture_asset_destinations",
    "fixture_delivery_receipts",
    "asset_editorial_events",
    "fixture_placement_events",
    "asset_ai_proposals",
    "asset_ai_run_items",
    "asset_upload_run_items",
    "media_lifecycle",
)
RESTORE_STATE_TABLES = (
    "sidecar_assets",
    "sidecar_decisions",
    "sidecar_tombstones",
    "media_lifecycle",
)


class WasteBasketError(ValueError):
    """A rejected lifecycle request that must not mutate Owner state."""


class OwnerAuthorizationError(WasteBasketError):
    """The Owner-mode gallery seam was called without explicit authorization."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def _hash(value: Any) -> str:
    return hashlib.sha256(_json(value).encode("utf-8")).hexdigest()


def _unique_ids(values: Iterable[Any]) -> list[str]:
    result: list[str] = []
    for value in values:
        item = str(value or "").strip()
        if item and item not in result:
            result.append(item)
    return sorted(result)


def _db_path(repo_root: Path, db_path: Path | None) -> Path:
    selected = db_path or DEFAULT_DB
    return selected if selected.is_absolute() else repo_root / selected


_HOT_PATH_REQUIRED_TABLES = frozenset({
    "sidecar_assets",
    "sidecar_decisions",
    "sidecar_tombstones",
    "sidecar_pending_sync",
    "sidecar_upload_bridge_run_items",
    "fixture_pool_assets",
    "fixture_asset_placements",
    "fixture_asset_decisions",
    "asset_editorial_state",
    "asset_delivery_state",
    "r2_objects",
    "asset_publications",
    "public_catalog_publications",
    "asset_sale_references",
    "r2_quarantine",
    "fixture_delivery_receipts",
    "asset_upload_run_items",
    "media_lifecycle",
    "owner_waste_basket_entries",
    "owner_waste_basket_provenance",
    "owner_waste_basket_operations",
    "owner_waste_basket_receipts",
    "owner_lifecycle_operations",
    "owner_lifecycle_outbox",
    "owner_hosted_lifecycle_requests",
})


def _hot_path_schema_is_ready(connection: sqlite3.Connection) -> bool:
    """Recognize the complete lifecycle schema without running migrations.

    Action-scoped connectors are short-lived processes, so module-level schema
    caches cannot protect their hot path.  This bounded catalog check keeps
    normal X/Restore work local-fast while incomplete or older databases still
    take the full idempotent migration path below.
    """
    tables = {
        str(row["name"])
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    }
    if not _HOT_PATH_REQUIRED_TABLES.issubset(tables):
        return False
    hosted_columns = {
        str(row["name"])
        for row in connection.execute(
            "PRAGMA table_info(owner_hosted_lifecycle_requests)"
        ).fetchall()
    }
    return {"disposition", "blocked_at"}.issubset(hosted_columns)


def _connect(repo_root: Path, db_path: Path | None = None) -> sqlite3.Connection:
    """Open the Owner DB and ensure every related schema is present."""
    path = _db_path(repo_root, db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=15)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout = 15000")
    connection.execute("PRAGMA foreign_keys = ON")
    if _hot_path_schema_is_ready(connection):
        return connection
    # These are the same SQLite file, but each historical module owns its
    # schema helper.  Calling them here makes the gateway safe for synthetic
    # fixtures and for a partially initialized local checkout.
    sidecar_state_db.ensure_schema(connection)
    owner_state_db.ensure_schema(connection)
    fixture_pipeline.ensure_schema(connection)
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS owner_waste_basket_entries (
          entry_id             TEXT PRIMARY KEY CHECK (trim(entry_id) <> ''),
          asset_id             TEXT NOT NULL CHECK (trim(asset_id) <> ''),
          state                TEXT NOT NULL CHECK (state IN ('recoverable', 'tombstoned', 'restored')),
          source               TEXT NOT NULL,
          actor                TEXT NOT NULL,
          fixture_id           TEXT NOT NULL DEFAULT '',
          gallery_id           TEXT NOT NULL DEFAULT '',
          reason               TEXT NOT NULL DEFAULT '',
          provenance_sha256    TEXT NOT NULL,
          captured_at          TEXT NOT NULL,
          created_at           TEXT NOT NULL,
          updated_at           TEXT NOT NULL,
          emptied_at           TEXT,
          restored_at          TEXT,
          tombstone_reason     TEXT,
          UNIQUE (asset_id, created_at)
        );
        CREATE INDEX IF NOT EXISTS idx_owner_waste_basket_entries_state
          ON owner_waste_basket_entries(state, updated_at, asset_id);
        CREATE INDEX IF NOT EXISTS idx_owner_waste_basket_entries_asset
          ON owner_waste_basket_entries(asset_id, state, created_at);

        CREATE TABLE IF NOT EXISTS owner_waste_basket_provenance (
          entry_id             TEXT NOT NULL,
          relation_name        TEXT NOT NULL,
          relation_key         TEXT NOT NULL,
          row_json             TEXT NOT NULL,
          row_sha256           TEXT NOT NULL,
          captured_at          TEXT NOT NULL,
          PRIMARY KEY (entry_id, relation_name, relation_key),
          FOREIGN KEY (entry_id) REFERENCES owner_waste_basket_entries(entry_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_owner_waste_basket_provenance_relation
          ON owner_waste_basket_provenance(relation_name, relation_key);
        CREATE TRIGGER IF NOT EXISTS owner_waste_basket_provenance_no_update
          BEFORE UPDATE ON owner_waste_basket_provenance
          BEGIN
            SELECT RAISE(ABORT, 'Waste Basket provenance is immutable');
          END;
        CREATE TRIGGER IF NOT EXISTS owner_waste_basket_provenance_no_delete
          BEFORE DELETE ON owner_waste_basket_provenance
          BEGIN
            SELECT RAISE(ABORT, 'Waste Basket provenance is immutable');
          END;
        CREATE TRIGGER IF NOT EXISTS owner_waste_basket_entries_no_delete
          BEFORE DELETE ON owner_waste_basket_entries
          BEGIN
            SELECT RAISE(ABORT, 'Waste Basket entries are auditable history');
          END;

        CREATE TABLE IF NOT EXISTS owner_waste_basket_operations (
          operation_id         TEXT PRIMARY KEY CHECK (trim(operation_id) <> ''),
          operation            TEXT NOT NULL CHECK (operation IN ('x', 'restore', 'empty', 'tombstone-restore')),
          request_key          TEXT NOT NULL UNIQUE,
          actor                TEXT NOT NULL,
          source               TEXT NOT NULL,
          authorization_json   TEXT NOT NULL DEFAULT '{}',
          confirmed            INTEGER NOT NULL DEFAULT 0 CHECK (confirmed IN (0, 1)),
          asset_ids_json       TEXT NOT NULL DEFAULT '[]',
          status               TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
          result_json          TEXT NOT NULL DEFAULT '{}',
          error_text           TEXT NOT NULL DEFAULT '',
          created_at           TEXT NOT NULL,
          updated_at           TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_owner_waste_basket_operations_status
          ON owner_waste_basket_operations(status, updated_at);

        CREATE TABLE IF NOT EXISTS owner_waste_basket_receipts (
          operation_id         TEXT NOT NULL,
          entry_id             TEXT NOT NULL,
          asset_id             TEXT NOT NULL,
          before_json          TEXT NOT NULL DEFAULT '{}',
          after_json           TEXT NOT NULL DEFAULT '{}',
          receipt_state        TEXT NOT NULL CHECK (receipt_state IN ('applied', 'already-applied', 'restored', 'tombstoned', 'conflict')),
          created_at           TEXT NOT NULL,
          updated_at           TEXT NOT NULL,
          PRIMARY KEY (operation_id, asset_id),
          FOREIGN KEY (operation_id) REFERENCES owner_waste_basket_operations(operation_id),
          FOREIGN KEY (entry_id) REFERENCES owner_waste_basket_entries(entry_id)
        );
        CREATE INDEX IF NOT EXISTS idx_owner_waste_basket_receipts_entry
          ON owner_waste_basket_receipts(entry_id, updated_at);

        CREATE TABLE IF NOT EXISTS owner_lifecycle_operations (
          operation_id         TEXT PRIMARY KEY,
          operation_digest     TEXT NOT NULL UNIQUE,
          operation            TEXT NOT NULL,
          revision             INTEGER NOT NULL CHECK (revision > 0),
          state                TEXT NOT NULL CHECK (state IN ('armed', 'locally_committed', 'deployed_applied', 'locally_acked', 'conflict', 'aborted')),
          member_count         INTEGER NOT NULL CHECK (member_count > 0),
          arm_receipt_json     TEXT NOT NULL,
          created_at           TEXT NOT NULL,
          updated_at           TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS owner_lifecycle_outbox (
          operation_id         TEXT NOT NULL,
          operation_digest     TEXT NOT NULL,
          canonical_media_id   TEXT NOT NULL,
          canonical_asset_id   TEXT NOT NULL,
          revision             INTEGER NOT NULL CHECK (revision > 0),
          denied               INTEGER NOT NULL CHECK (denied IN (0, 1)),
          lifecycle_state      TEXT NOT NULL,
          receipt_id           TEXT NOT NULL UNIQUE,
          payload_json         TEXT NOT NULL,
          state                TEXT NOT NULL CHECK (state IN ('locally_committed', 'deployed_applied', 'locally_acked', 'conflict')),
          created_at           TEXT NOT NULL,
          updated_at           TEXT NOT NULL,
          PRIMARY KEY (operation_id, canonical_media_id),
          FOREIGN KEY (operation_id) REFERENCES owner_lifecycle_operations(operation_id)
        );
        CREATE TRIGGER IF NOT EXISTS owner_lifecycle_outbox_immutable_payload
          BEFORE UPDATE ON owner_lifecycle_outbox
          WHEN OLD.operation_id <> NEW.operation_id
            OR OLD.operation_digest <> NEW.operation_digest
            OR OLD.canonical_media_id <> NEW.canonical_media_id
            OR OLD.canonical_asset_id <> NEW.canonical_asset_id
            OR OLD.revision <> NEW.revision
            OR OLD.denied <> NEW.denied
            OR OLD.lifecycle_state <> NEW.lifecycle_state
            OR OLD.receipt_id <> NEW.receipt_id
            OR OLD.payload_json <> NEW.payload_json
          BEGIN
            SELECT RAISE(ABORT, 'Lifecycle outbox payload is immutable');
          END;

        CREATE TABLE IF NOT EXISTS owner_hosted_lifecycle_requests (
          request_id           TEXT PRIMARY KEY CHECK (trim(request_id) <> ''),
          request_key_digest   TEXT NOT NULL UNIQUE CHECK (length(request_key_digest) = 64),
          session_id           TEXT NOT NULL CHECK (trim(session_id) <> ''),
          fixture_id           TEXT NOT NULL CHECK (trim(fixture_id) <> ''),
          operation            TEXT NOT NULL CHECK (operation IN ('waste-basket-x', 'waste-basket-x-many', 'waste-basket-restore')),
          asset_ids_json       TEXT NOT NULL,
          state                TEXT NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'failed')),
          result_json          TEXT NOT NULL DEFAULT '{}',
          error_text           TEXT NOT NULL DEFAULT '',
          attempt_count        INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
          disposition          TEXT NOT NULL DEFAULT '',
          created_at           TEXT NOT NULL,
          updated_at           TEXT NOT NULL,
          completed_at         TEXT,
          blocked_at           TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_owner_hosted_lifecycle_requests_state
          ON owner_hosted_lifecycle_requests(state, created_at, request_id);
        CREATE INDEX IF NOT EXISTS idx_owner_hosted_lifecycle_requests_session
          ON owner_hosted_lifecycle_requests(session_id, fixture_id, created_at, request_id);
        CREATE TRIGGER IF NOT EXISTS owner_hosted_lifecycle_request_identity_immutable
          BEFORE UPDATE ON owner_hosted_lifecycle_requests
          WHEN OLD.request_id <> NEW.request_id
            OR OLD.request_key_digest <> NEW.request_key_digest
            OR OLD.session_id <> NEW.session_id
            OR OLD.fixture_id <> NEW.fixture_id
            OR OLD.operation <> NEW.operation
            OR OLD.asset_ids_json <> NEW.asset_ids_json
          BEGIN
            SELECT RAISE(ABORT, 'Hosted lifecycle request identity is immutable');
          END;
        """
    )
    hosted_columns = _columns(connection, "owner_hosted_lifecycle_requests")
    if "disposition" not in hosted_columns:
        connection.execute(
            "ALTER TABLE owner_hosted_lifecycle_requests ADD COLUMN disposition TEXT NOT NULL DEFAULT ''"
        )
    if "blocked_at" not in hosted_columns:
        connection.execute(
            "ALTER TABLE owner_hosted_lifecycle_requests ADD COLUMN blocked_at TEXT"
        )
    connection.commit()
    return connection


def ensure_schema(repo_root: Path, db_path: Path | None = None) -> None:
    connection = _connect(repo_root, db_path)
    connection.close()


def _hosted_request_payload(row: sqlite3.Row) -> dict[str, Any]:
    storage_state = str(row["state"])
    disposition = str(row["disposition"] or "")
    state = "blocked" if storage_state == "failed" and disposition == "blocked" else storage_state
    error = str(row["error_text"] or "")
    next_action = ""
    if state == "blocked":
        next_action = (
            "Repair the canonical R2 mapping in Owner.sqlite, then submit a new Owner action."
            if _is_missing_canonical_r2_error(error)
            else "Inspect the recorded error, repair the cause, then submit a new Owner action."
        )
    return {
        "requestId": str(row["request_id"]),
        "sessionId": str(row["session_id"]),
        "fixtureId": str(row["fixture_id"]),
        "operation": str(row["operation"]),
        "assetIds": json.loads(str(row["asset_ids_json"])),
        "state": state,
        "storageState": storage_state,
        "disposition": disposition,
        "result": json.loads(str(row["result_json"] or "{}")),
        "error": error,
        "attemptCount": int(row["attempt_count"] or 0),
        "maxAttempts": MAX_HOSTED_LIFECYCLE_ATTEMPTS,
        "nextAction": next_action,
        "createdAt": str(row["created_at"]),
        "updatedAt": str(row["updated_at"]),
        "completedAt": str(row["completed_at"] or ""),
        "blockedAt": str(row["blocked_at"] or ""),
    }


def _is_missing_canonical_r2_error(error: str) -> bool:
    normalized = str(error or "").casefold()
    return (
        "canonical r2 mapping is missing" in normalized
        or "unsupported or incomplete r2 mapping" in normalized
        or "ambiguous canonical r2 mapping" in normalized
    )


def _blocked_hosted_lifecycle_error(error: str, attempt_count: int) -> str:
    base = str(error or "Hosted lifecycle request retry budget exhausted.").strip()
    if _is_missing_canonical_r2_error(base):
        action = "Repair the canonical R2 mapping in Owner.sqlite, then submit a new Owner action."
    else:
        action = "Inspect this error, repair the cause, then submit a new Owner action."
    return (
        f"{base} Automatic retries stopped after {attempt_count} attempts. "
        f"{action}"
    )[:1000]


def queue_hosted_lifecycle_request(
    repo_root: Path,
    *,
    operation: str,
    asset_ids: Iterable[Any],
    session_id: str,
    fixture_id: str,
    request_key: str,
    db_path: Path | None = None,
) -> dict[str, Any]:
    """Persist a browser-authorized intent without performing lifecycle work.

    The caller's idempotency key is retained only as a digest. Browser payload
    authorization, cloud credentials, lifecycle members, and fixture overrides
    have no representation in this durable queue.
    """
    normalized_operation = str(operation or "").strip().lower()
    if normalized_operation not in {
        "waste-basket-x", "waste-basket-x-many", "waste-basket-restore"
    }:
        raise WasteBasketError("unsupported hosted lifecycle operation")
    ids = _unique_ids(asset_ids)
    if not ids or len(ids) > MAX_ASSET_IDS:
        raise WasteBasketError("hosted lifecycle request requires 1 to 500 assets")
    clean_session = str(session_id or "").strip()
    clean_fixture = str(fixture_id or "").strip()
    clean_key = str(request_key or "").strip()
    if not clean_session or not clean_fixture or not clean_key:
        raise WasteBasketError("hosted lifecycle request identity is incomplete")
    key_digest = hashlib.sha256(clean_key.encode("utf-8")).hexdigest()
    ids_json = _json(ids)
    connection = _connect(repo_root, db_path)
    try:
        connection.execute("BEGIN IMMEDIATE")
        existing = connection.execute(
            "SELECT * FROM owner_hosted_lifecycle_requests WHERE request_key_digest = ?",
            (key_digest,),
        ).fetchone()
        if existing is not None:
            if (
                str(existing["session_id"]) != clean_session
                or str(existing["fixture_id"]) != clean_fixture
                or str(existing["operation"]) != normalized_operation
                or str(existing["asset_ids_json"]) != ids_json
            ):
                raise WasteBasketError("hosted lifecycle idempotency key conflicts with its durable intent")
            connection.rollback()
            return _hosted_request_payload(existing)
        active = connection.execute(
            """SELECT * FROM owner_hosted_lifecycle_requests
               WHERE session_id = ? AND fixture_id = ?
                 AND state IN ('queued', 'running')
               ORDER BY rowid DESC LIMIT 1""",
            (clean_session, clean_fixture),
        ).fetchone()
        if active is not None:
            # A browser can lose its same-tab cache or reload after its polling
            # window expires. Return the already-durable request instead of
            # accepting a second lifecycle intent for the frozen session.
            connection.rollback()
            payload = _hosted_request_payload(active)
            payload["resumedActive"] = True
            return payload
        now = _now()
        request_id = f"hlr-{uuid.uuid4().hex}"
        connection.execute(
            """INSERT INTO owner_hosted_lifecycle_requests
              (request_id, request_key_digest, session_id, fixture_id, operation,
               asset_ids_json, state, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)""",
            (request_id, key_digest, clean_session, clean_fixture, normalized_operation, ids_json, now, now),
        )
        row = connection.execute(
            "SELECT * FROM owner_hosted_lifecycle_requests WHERE request_id = ?", (request_id,)
        ).fetchone()
        connection.commit()
        return _hosted_request_payload(row)
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def hosted_lifecycle_request_status(
    repo_root: Path,
    request_id: str,
    *,
    session_id: str,
    fixture_id: str,
    db_path: Path | None = None,
) -> dict[str, Any]:
    connection = _connect(repo_root, db_path)
    try:
        row = connection.execute(
            """SELECT * FROM owner_hosted_lifecycle_requests
               WHERE request_id = ? AND session_id = ? AND fixture_id = ?""",
            (str(request_id or "").strip(), str(session_id or "").strip(), str(fixture_id or "").strip()),
        ).fetchone()
        if row is None:
            raise WasteBasketError("hosted lifecycle request is unavailable for this Owner session")
        return _hosted_request_payload(row)
    finally:
        connection.close()


def latest_hosted_lifecycle_request(
    repo_root: Path,
    *,
    session_id: str,
    fixture_id: str,
    db_path: Path | None = None,
) -> dict[str, Any] | None:
    """Return the newest durable request for one frozen Owner session.

    This is a read-only recovery seam for browser reload/storage-denial cases.
    Session and fixture identity remain mandatory so an opaque request can
    never be discovered across Owner leases.
    """
    normalized_session_id = str(session_id or "").strip()
    normalized_fixture_id = str(fixture_id or "").strip()
    if not normalized_session_id or not normalized_fixture_id:
        raise WasteBasketError("hosted lifecycle request identity is incomplete")
    connection = _connect(repo_root, db_path)
    try:
        row = connection.execute(
            """SELECT * FROM owner_hosted_lifecycle_requests
               WHERE session_id = ? AND fixture_id = ?
               ORDER BY rowid DESC LIMIT 1""",
            (normalized_session_id, normalized_fixture_id),
        ).fetchone()
        return _hosted_request_payload(row) if row is not None else None
    finally:
        connection.close()


def replace_completed_hosted_lifecycle_result(
    repo_root: Path,
    request_id: str,
    *,
    session_id: str,
    fixture_id: str,
    expected_result: dict[str, Any],
    result: dict[str, Any],
    db_path: Path | None = None,
) -> dict[str, Any]:
    """Replace one completed hosted result with optimistic concurrency.

    Projection retry is deliberately allowed to update only ``result_json``.
    The hosted request identity, authoritative lifecycle operation, and queue
    state remain immutable, and a concurrent or stale caller cannot overwrite
    a newer projection receipt.
    """

    normalized_request_id = str(request_id or "").strip()
    normalized_session_id = str(session_id or "").strip()
    normalized_fixture_id = str(fixture_id or "").strip()
    if not normalized_request_id or not normalized_session_id or not normalized_fixture_id:
        raise WasteBasketError("hosted lifecycle result identity is incomplete")
    if not isinstance(expected_result, dict) or not isinstance(result, dict):
        raise WasteBasketError("hosted lifecycle result replacement requires JSON objects")
    connection = _connect(repo_root, db_path)
    try:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            """SELECT * FROM owner_hosted_lifecycle_requests
               WHERE request_id = ? AND session_id = ? AND fixture_id = ?""",
            (normalized_request_id, normalized_session_id, normalized_fixture_id),
        ).fetchone()
        if row is None:
            raise WasteBasketError("hosted lifecycle request is unavailable for this Owner session")
        if str(row["state"]) != "completed":
            raise WasteBasketError("hosted lifecycle projection requires a completed authoritative request")
        current_result = json.loads(str(row["result_json"] or "{}"))
        if current_result != expected_result:
            raise WasteBasketError("hosted lifecycle projection result changed before retry")
        connection.execute(
            """UPDATE owner_hosted_lifecycle_requests
               SET result_json = ?, updated_at = ?
               WHERE request_id = ?""",
            (_json(result), _now(), normalized_request_id),
        )
        updated = connection.execute(
            "SELECT * FROM owner_hosted_lifecycle_requests WHERE request_id = ?",
            (normalized_request_id,),
        ).fetchone()
        connection.commit()
        return _hosted_request_payload(updated)
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def hosted_lifecycle_request_state_for_operation(
    repo_root: Path,
    operation_id: str,
    db_path: Path | None = None,
) -> str:
    """Return the durable hosted relay state associated with an operation ID."""
    prefix = "owner-action:hosted-lifecycle:"
    normalized = str(operation_id or "").strip()
    if not normalized.startswith(prefix):
        return ""
    request_id = normalized[len(prefix):]
    if not request_id:
        return ""
    connection = _connect(repo_root, db_path)
    try:
        row = connection.execute(
            "SELECT state FROM owner_hosted_lifecycle_requests WHERE request_id = ?",
            (request_id,),
        ).fetchone()
        return str(row["state"]) if row else ""
    finally:
        connection.close()


def pending_hosted_lifecycle_requests(
    repo_root: Path,
    *,
    limit: int = 20,
    db_path: Path | None = None,
) -> list[dict[str, Any]]:
    connection = _connect(repo_root, db_path)
    try:
        rows = connection.execute(
            """SELECT * FROM owner_hosted_lifecycle_requests
               WHERE state IN ('queued', 'running')
               ORDER BY created_at, request_id LIMIT ?""",
            (max(1, min(int(limit), 100)),),
        ).fetchall()
        return [_hosted_request_payload(row) for row in rows]
    finally:
        connection.close()


def claim_hosted_lifecycle_request(
    repo_root: Path,
    request_id: str,
    db_path: Path | None = None,
) -> dict[str, Any]:
    normalized_request_id = str(request_id or "").strip()
    connection = _connect(repo_root, db_path)
    try:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT * FROM owner_hosted_lifecycle_requests WHERE request_id = ?",
            (normalized_request_id,),
        ).fetchone()
        if row is None:
            raise WasteBasketError("hosted lifecycle request is not claimable")
        if str(row["state"]) not in {"queued", "running"}:
            raise WasteBasketError("hosted lifecycle request is not claimable")
        attempt_count = int(row["attempt_count"] or 0)
        if attempt_count >= MAX_HOSTED_LIFECYCLE_ATTEMPTS:
            now = _now()
            connection.execute(
                """UPDATE owner_hosted_lifecycle_requests
                   SET state = 'failed', disposition = 'blocked',
                       error_text = ?, updated_at = ?, completed_at = ?, blocked_at = ?
                   WHERE request_id = ? AND state IN ('queued', 'running')""",
                (
                    _blocked_hosted_lifecycle_error(
                        str(row["error_text"] or ""), attempt_count
                    ),
                    now,
                    now,
                    now,
                    normalized_request_id,
                ),
            )
            blocked = connection.execute(
                "SELECT * FROM owner_hosted_lifecycle_requests WHERE request_id = ?",
                (normalized_request_id,),
            ).fetchone()
            connection.commit()
            return _hosted_request_payload(blocked)
        connection.execute(
            """UPDATE owner_hosted_lifecycle_requests
               SET state = 'running', attempt_count = attempt_count + 1,
                   disposition = '', error_text = '', updated_at = ?,
                   completed_at = NULL, blocked_at = NULL
               WHERE request_id = ? AND state IN ('queued', 'running')""",
            (_now(), normalized_request_id),
        )
        claimed = connection.execute(
            "SELECT * FROM owner_hosted_lifecycle_requests WHERE request_id = ?",
            (normalized_request_id,),
        ).fetchone()
        if claimed is None or str(claimed["state"]) != "running":
            raise WasteBasketError("hosted lifecycle request is not claimable")
        connection.commit()
        return _hosted_request_payload(claimed)
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def finish_hosted_lifecycle_request(
    repo_root: Path,
    request_id: str,
    *,
    result: dict[str, Any] | None = None,
    error: str = "",
    retryable: bool = False,
    db_path: Path | None = None,
) -> dict[str, Any]:
    normalized_request_id = str(request_id or "").strip()
    connection = _connect(repo_root, db_path)
    try:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT * FROM owner_hosted_lifecycle_requests WHERE request_id = ?",
            (normalized_request_id,),
        ).fetchone()
        if row is None:
            raise WasteBasketError("hosted lifecycle request does not exist")
        if str(row["state"]) == "completed":
            connection.rollback()
            return _hosted_request_payload(row)
        if str(row["state"]) == "failed" and str(row["disposition"] or "") == "blocked":
            connection.rollback()
            return _hosted_request_payload(row)
        now = _now()
        attempt_count = int(row["attempt_count"] or 0)
        error_text = str(error or "").strip()
        blocked = bool(error_text and retryable and attempt_count >= MAX_HOSTED_LIFECYCLE_ATTEMPTS)
        state = "failed" if error_text and not retryable else "failed" if blocked else "queued" if error_text else "completed"
        disposition = "blocked" if blocked else ""
        stored_error = _blocked_hosted_lifecycle_error(error_text, attempt_count) if blocked else error_text[:1000]
        connection.execute(
            """UPDATE owner_hosted_lifecycle_requests
               SET state = ?, disposition = ?, result_json = ?, error_text = ?,
                   updated_at = ?, completed_at = ?, blocked_at = ?
               WHERE request_id = ?""",
            (
                state,
                disposition,
                _json(result or {}),
                stored_error,
                now,
                now if state in {"completed", "failed"} else None,
                now if blocked else None,
                normalized_request_id,
            ),
        )
        completed = connection.execute(
            "SELECT * FROM owner_hosted_lifecycle_requests WHERE request_id = ?",
            (normalized_request_id,),
        ).fetchone()
        connection.commit()
        return _hosted_request_payload(completed)
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _table_exists(connection: sqlite3.Connection, table: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    return row is not None


def _columns(connection: sqlite3.Connection, table: str) -> list[str]:
    return [str(row["name"]) for row in connection.execute(f"PRAGMA table_info({table})").fetchall()]


def _primary_key_columns(connection: sqlite3.Connection, table: str) -> list[str]:
    rows = connection.execute(f"PRAGMA table_info({table})").fetchall()
    return [str(row["name"]) for row in sorted(rows, key=lambda row: int(row["pk"] or 0)) if int(row["pk"] or 0)]


def _provenance_rows(connection: sqlite3.Connection, asset_id: str) -> list[tuple[str, str, dict[str, Any]]]:
    rows: list[tuple[str, str, dict[str, Any]]] = []
    for table in PROVENANCE_TABLES:
        if not _table_exists(connection, table):
            continue
        columns = _columns(connection, table)
        identity_column = (
            "asset_id"
            if "asset_id" in columns
            else "photo_id"
            if "photo_id" in columns
            else "media_id"
            if "media_id" in columns
            else None
        )
        if identity_column is None:
            continue
        table_rows = connection.execute(
            f"SELECT * FROM {table} WHERE {identity_column} = ?",
            (asset_id,),
        ).fetchall()
        primary_keys = _primary_key_columns(connection, table)
        for row in table_rows:
            payload = dict(row)
            key_values = {key: payload.get(key) for key in primary_keys} if primary_keys else payload
            rows.append((table, _json(key_values), payload))
    return rows


def _provenance_map(connection: sqlite3.Connection, entry_id: str, table: str) -> dict[str, dict[str, Any]]:
    return {
        str(row["relation_key"]): json.loads(str(row["row_json"]))
        for row in connection.execute(
            """
            SELECT relation_key, row_json
            FROM owner_waste_basket_provenance
            WHERE entry_id = ? AND relation_name = ?
            """,
            (entry_id, table),
        ).fetchall()
    }


def _snapshot(
    connection: sqlite3.Connection,
    entry_id: str,
    asset_id: str,
    captured_at: str,
) -> str:
    return _snapshot_payloads(
        connection,
        entry_id,
        captured_at,
        _provenance_rows(connection, asset_id),
    )


def _snapshot_payloads(
    connection: sqlite3.Connection,
    entry_id: str,
    captured_at: str,
    provenance_rows: list[tuple[str, str, dict[str, Any]]],
) -> str:
    digest_items: list[dict[str, Any]] = []
    for table, relation_key, payload in provenance_rows:
        row_json = _json(payload)
        row_hash = hashlib.sha256(row_json.encode("utf-8")).hexdigest()
        connection.execute(
            """
            INSERT INTO owner_waste_basket_provenance
              (entry_id, relation_name, relation_key, row_json, row_sha256, captured_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (entry_id, table, relation_key, row_json, row_hash, captured_at),
        )
        digest_items.append({"relation": table, "key": relation_key, "sha256": row_hash})
    return _hash(digest_items)


def _adopt_legacy_lifecycle_entries(
    connection: sqlite3.Connection,
    requested_ids: Iterable[Any],
    *,
    lifecycle_states: set[str],
) -> list[str]:
    """Adopt pre-gateway lifecycle rows at an explicit mutation boundary.

    Older Backstage/Sidecar paths wrote ``media_lifecycle`` directly. They
    remain visible in the private ledger, but have no immutable PBB-79 entry,
    which used to make an explicit Empty action fail before it reached the
    gateway. Adoption captures the exact existing rows as provenance; it does
    not change their lifecycle state or touch source/R2/catalog data.
    """
    states = sorted({state for state in lifecycle_states if state in {"hidden", "discarded"}})
    if not states or not _table_exists(connection, "media_lifecycle"):
        return []
    ids = _unique_ids(requested_ids)
    placeholders = ",".join("?" for _ in states)
    if ids:
        id_placeholders = ",".join("?" for _ in ids)
        rows = connection.execute(
            f"""SELECT * FROM media_lifecycle
                WHERE media_id IN ({id_placeholders})
                  AND lifecycle_state IN ({placeholders})
                ORDER BY media_id""",
            [*ids, *states],
        ).fetchall()
    else:
        rows = connection.execute(
            f"""SELECT * FROM media_lifecycle
                WHERE lifecycle_state IN ({placeholders})
                ORDER BY media_id""",
            states,
        ).fetchall()

    adopted: list[str] = []
    now = _now()
    for lifecycle_row in rows:
        asset_id = str(lifecycle_row["media_id"] or "").strip()
        if not asset_id:
            continue
        existing = connection.execute(
            "SELECT entry_id FROM owner_waste_basket_entries WHERE asset_id = ? ORDER BY created_at DESC LIMIT 1",
            (asset_id,),
        ).fetchone()
        if existing is not None:
            continue
        provenance_rows = _provenance_rows(connection, asset_id)
        captured_at = next(
            (
                str(lifecycle_row[name] or "").strip()
                for name in ("hidden_at", "discarded_at", "updated_at")
                if name in lifecycle_row.keys() and str(lifecycle_row[name] or "").strip()
            ),
            now,
        )
        entry_id = f"wbe-legacy-{hashlib.sha256(asset_id.encode('utf-8')).hexdigest()[:32]}"
        connection.execute(
            """INSERT INTO owner_waste_basket_entries
              (entry_id, asset_id, state, source, actor, fixture_id, gallery_id, reason,
               provenance_sha256, captured_at, created_at, updated_at)
              VALUES (?, ?, 'recoverable', 'legacy-media-lifecycle',
                      'legacy-lifecycle-adoption', ?, '', ?, ?, ?, ?, ?)""",
            (
                entry_id,
                asset_id,
                str(lifecycle_row["source_slug"] or lifecycle_row["previous_slug"] or "").strip(),
                "Adopted legacy media_lifecycle row before explicit Waste Basket mutation.",
                _hash([{"relation": table, "key": key, "row": row} for table, key, row in provenance_rows]),
                captured_at,
                now,
                now,
            ),
        )
        provenance_sha256 = _snapshot_payloads(
            connection,
            entry_id,
            captured_at,
            provenance_rows,
        )
        connection.execute(
            "UPDATE owner_waste_basket_entries SET provenance_sha256 = ? WHERE entry_id = ?",
            (provenance_sha256, entry_id),
        )
        adopted.append(asset_id)
    return adopted


def _adopt_legacy_lifecycle_for_operation(
    repo_root: Path,
    operation: str,
    requested_ids: Iterable[Any],
    db_path: Path | None = None,
) -> list[str]:
    states = {"discarded"} if operation == "tombstone-restore" else {"hidden"}
    connection = _connect(repo_root, db_path)
    try:
        connection.execute("BEGIN IMMEDIATE")
        adopted = _adopt_legacy_lifecycle_entries(
            connection,
            requested_ids,
            lifecycle_states=states,
        )
        if adopted:
            connection.commit()
        else:
            connection.rollback()
        return adopted
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _validate_source(
    source: str,
    *,
    owner_mode: bool,
    owner_authorized: bool,
) -> str:
    normalized = str(source or "").strip().casefold()
    if normalized not in NORMAL_SOURCES:
        raise WasteBasketError(f"unsupported Waste Basket source: {normalized or 'missing'}")
    if normalized in OWNER_GALLERY_SOURCES and (not owner_mode or not owner_authorized):
        raise OwnerAuthorizationError(
            "Owner-mode gallery Waste Basket actions require explicit Owner authorization"
        )
    return normalized


def _normalize_request_key(
    operation: str,
    asset_ids: list[str],
    source: str,
    request_key: str | None,
    context: dict[str, Any],
) -> str:
    explicit = str(request_key or "").strip()
    if explicit:
        return explicit
    return f"wbg:{operation}:{_hash({'assetIds': asset_ids, 'source': source, 'context': context})}"


def _existing_operation(connection: sqlite3.Connection, request_key: str) -> dict[str, Any] | None:
    row = connection.execute(
        "SELECT result_json, status, error_text FROM owner_waste_basket_operations WHERE request_key = ?",
        (request_key,),
    ).fetchone()
    if row is None:
        return None
    if row["status"] == "failed":
        raise WasteBasketError(str(row["error_text"] or "previous Waste Basket operation failed"))
    return json.loads(str(row["result_json"] or "{}"))


def _run_operation(
    repo_root: Path,
    *,
    operation: str,
    asset_ids: list[str],
    source: str,
    actor: str,
    request_key: str,
    authorization: dict[str, Any],
    confirmed: bool,
    db_path: Path | None,
    mutate: Callable[[sqlite3.Connection, str, str], dict[str, Any]],
    deployed_lifecycle: dict[str, Any] | None = None,
) -> dict[str, Any]:
    connection = _connect(repo_root, db_path)
    operation_id = str((deployed_lifecycle or {}).get("operationId") or f"wbo-{uuid.uuid4().hex}")
    if deployed_lifecycle and request_key != operation_id:
        connection.close()
        raise WasteBasketError("deployed lifecycle request key must equal its stable operation ID")
    now = _now()
    try:
        connection.execute("BEGIN IMMEDIATE")
        existing = _existing_operation(connection, request_key)
        if existing is not None:
            connection.rollback()
            return existing
        connection.execute(
            """
            INSERT INTO owner_waste_basket_operations
              (operation_id, operation, request_key, actor, source, authorization_json,
               confirmed, asset_ids_json, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)
            """,
            (
                operation_id,
                operation,
                request_key,
                actor,
                source,
                _json(authorization),
                int(confirmed),
                _json(asset_ids),
                now,
                now,
            ),
        )
        result = mutate(connection, operation_id, now)
        if deployed_lifecycle:
            _record_deployed_lifecycle_outbox(connection, operation, asset_ids, deployed_lifecycle, now)
        connection.execute(
            """
            UPDATE owner_waste_basket_operations
            SET status = 'completed', result_json = ?, updated_at = ?
            WHERE operation_id = ?
            """,
            (_json(result), _now(), operation_id),
        )
        connection.commit()
        return result
    except Exception as error:
        connection.rollback()
        try:
            connection.execute(
                """
                INSERT OR IGNORE INTO owner_waste_basket_operations
                  (operation_id, operation, request_key, actor, source, authorization_json,
                   confirmed, asset_ids_json, status, error_text, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'failed', ?, ?, ?)
                """,
                (
                    operation_id,
                    operation,
                    request_key,
                    actor,
                    source,
                    _json(authorization),
                    int(confirmed),
                    _json(asset_ids),
                    str(error),
                    now,
                    _now(),
                ),
            )
            connection.commit()
        finally:
            connection.close()
        raise
    finally:
        if connection:
            try:
                connection.close()
            except sqlite3.Error:
                pass


def _record_deployed_lifecycle_outbox(
    connection: sqlite3.Connection,
    operation: str,
    asset_ids: list[str],
    arm: dict[str, Any],
    now: str,
) -> None:
    operation_id = str(arm.get("operationId") or "").strip()
    operation_digest = str(arm.get("operationDigest") or "").strip()
    revision = int(arm.get("revision") or 0)
    denied = bool(arm.get("denied"))
    members = sorted(arm.get("members") or [], key=lambda item: str(item.get("canonicalMediaId") or ""))
    if not operation_id or not operation_digest or revision < 1 or len(members) != len(asset_ids):
        raise WasteBasketError("deployed lifecycle arm receipt is incomplete")
    member_assets = sorted(str(item.get("canonicalAssetId") or "").strip() for item in members)
    if member_assets != sorted(asset_ids) or any(int(item.get("revision") or 0) != revision for item in members):
        raise WasteBasketError("deployed lifecycle arm membership does not match the local mutation")
    expected_denied = operation not in {"restore", "tombstone-restore"}
    if denied != expected_denied:
        raise WasteBasketError("deployed lifecycle arm intent conflicts with the local operation")
    lifecycle_state = "restored" if not denied else "tombstoned" if operation == "empty" else "recoverable"
    existing = connection.execute(
        "SELECT operation_digest, revision, member_count FROM owner_lifecycle_operations WHERE operation_id = ?",
        (operation_id,),
    ).fetchone()
    if existing:
        if str(existing["operation_digest"]) != operation_digest or int(existing["revision"]) != revision or int(existing["member_count"]) != len(members):
            raise WasteBasketError("deployed lifecycle operation replay conflicts with the durable outbox")
        state = str(connection.execute(
            "SELECT state FROM owner_lifecycle_operations WHERE operation_id = ?", (operation_id,)
        ).fetchone()["state"])
        if state not in {"armed", "locally_committed"}:
            raise WasteBasketError("deployed lifecycle operation is not eligible for local commit")
        connection.execute(
            "UPDATE owner_lifecycle_operations SET state = 'locally_committed', updated_at = ? WHERE operation_id = ? AND state = 'armed'",
            (now, operation_id),
        )
    else:
        raise WasteBasketError("deployed lifecycle arm was not persisted before local mutation")
    for member in members:
        media_id = str(member.get("canonicalMediaId") or "").strip()
        asset_id = str(member.get("canonicalAssetId") or "").strip()
        receipt_id = f"lifecycle:{operation_id}:{media_id}:{revision}"
        payload = {
            "receiptId": receipt_id,
            "canonicalMediaId": media_id,
            "canonicalAssetId": asset_id,
            "revision": revision,
            "denied": denied,
            "lifecycleState": lifecycle_state,
        }
        connection.execute(
            """INSERT OR IGNORE INTO owner_lifecycle_outbox
              (operation_id, operation_digest, canonical_media_id, canonical_asset_id, revision,
               denied, lifecycle_state, receipt_id, payload_json, state, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'locally_committed', ?, ?)""",
            (operation_id, operation_digest, media_id, asset_id, revision, int(denied), lifecycle_state,
             receipt_id, _json(payload), now, now),
        )


def derive_deployed_lifecycle_members(
    repo_root: Path,
    asset_ids: Iterable[Any],
    db_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Derive canonical members only from durable Owner.sqlite R2 mappings."""
    ids = _unique_ids(asset_ids)
    if not ids:
        raise WasteBasketError("lifecycle member derivation requires at least one asset")
    connection = _connect(repo_root, db_path)
    bucket_names = {
        "photosbyelie-public": "public",
        "photosbyelie-private": "private",
        "public": "public",
        "private": "private",
    }
    try:
        members = []
        canonical_media_ids: set[str] = set()
        for asset_id in ids:
            canonical_media_id = asset_id
            rows = connection.execute(
                """SELECT bucket, object_key FROM r2_objects
                   WHERE photo_id = ? AND lifecycle_state <> 'deleted_confirmed'
                   ORDER BY bucket, object_key""",
                (asset_id,),
            ).fetchall()
            bindings: set[tuple[str, str]] = set()
            for row in rows:
                bucket = bucket_names.get(str(row["bucket"] or "").strip())
                object_key = str(row["object_key"] or "").strip()
                if not bucket or not object_key:
                    raise WasteBasketError(f"unsupported or incomplete R2 mapping for {asset_id}")
                bindings.add((bucket, object_key))
            if not bindings:
                provenance = connection.execute(
                    """SELECT p.row_json FROM owner_waste_basket_provenance p
                       JOIN owner_waste_basket_entries e ON e.entry_id = p.entry_id
                      WHERE e.asset_id = ? AND p.relation_name = 'r2_objects'
                      ORDER BY p.captured_at DESC""",
                    (asset_id,),
                ).fetchall()
                for row in provenance:
                    payload = json.loads(str(row["row_json"] or "{}"))
                    if str(payload.get("lifecycle_state") or "").strip() == "deleted_confirmed":
                        continue
                    bucket = bucket_names.get(str(payload.get("bucket") or "").strip())
                    object_key = str(payload.get("object_key") or "").strip()
                    if bucket and object_key:
                        bindings.add((bucket, object_key))
            if not bindings:
                legacy_media = connection.execute(
                    """SELECT public_preview_keys_json, private_keys_json
                       FROM media_lifecycle WHERE media_id = ?""",
                    (asset_id,),
                ).fetchone()
                if legacy_media is not None:
                    for bucket, column in (("public", "public_preview_keys_json"), ("private", "private_keys_json")):
                        try:
                            keys = json.loads(str(legacy_media[column] or "[]"))
                        except (TypeError, ValueError, json.JSONDecodeError):
                            keys = []
                        if isinstance(keys, list):
                            bindings.update(
                                (bucket, str(key).strip())
                                for key in keys
                                if str(key or "").strip()
                            )
            if not bindings:
                # A reindexed Photos row can retain its old local identifier in
                # raw_json. Trust that bridge only when a successful upload row
                # and current R2 ledger entries agree on one photo identity.
                upload_photo_ids = [
                    str(row["photo_id"])
                    for row in connection.execute(
                        """WITH requested_asset AS (
                             SELECT asset_id,
                                    NULLIF(
                                      json_extract(
                                        CASE WHEN json_valid(raw_json) THEN raw_json ELSE '{}' END,
                                        '$.localIdentifier'
                                      ),
                                      ''
                                    ) AS local_identifier
                               FROM sidecar_assets
                              WHERE asset_id = ?
                           )
                           SELECT DISTINCT bridge.photo_id
                             FROM requested_asset AS asset
                             JOIN sidecar_upload_bridge_run_items AS bridge
                               ON bridge.asset_id = asset.asset_id
                               OR bridge.asset_id = asset.local_identifier
                            WHERE bridge.status = 'uploaded'
                              AND bridge.upload_status IN ('uploaded', 'uploaded_with_skips')
                              AND COALESCE(bridge.photo_id, '') <> ''
                              AND EXISTS (
                                SELECT 1
                                  FROM r2_objects AS object
                                 WHERE object.photo_id = bridge.photo_id
                                   AND object.lifecycle_state <> 'deleted_confirmed'
                              )
                            ORDER BY bridge.photo_id""",
                        (asset_id,),
                    ).fetchall()
                ]
                if len(upload_photo_ids) > 1:
                    raise WasteBasketError(f"ambiguous canonical R2 mapping for {asset_id}")
                if upload_photo_ids:
                    canonical_media_id = upload_photo_ids[0]
                    rows = connection.execute(
                        """SELECT bucket, object_key FROM r2_objects
                           WHERE photo_id = ? AND lifecycle_state <> 'deleted_confirmed'
                           ORDER BY bucket, object_key""",
                        (canonical_media_id,),
                    ).fetchall()
                    for row in rows:
                        bucket = bucket_names.get(str(row["bucket"] or "").strip())
                        object_key = str(row["object_key"] or "").strip()
                        if not bucket or not object_key:
                            raise WasteBasketError(f"unsupported or incomplete R2 mapping for {asset_id}")
                        bindings.add((bucket, object_key))
            if not bindings:
                raise WasteBasketError(f"canonical R2 mapping is missing for {asset_id}")
            if canonical_media_id in canonical_media_ids:
                raise WasteBasketError(f"ambiguous canonical R2 mapping for {asset_id}")
            canonical_media_ids.add(canonical_media_id)
            members.append({
                "canonicalAssetId": asset_id,
                "canonicalMediaId": canonical_media_id,
                "bindings": [{"bucket": bucket, "objectKey": key} for bucket, key in sorted(bindings)],
            })
        return sorted(members, key=lambda item: item["canonicalMediaId"])
    finally:
        connection.close()


def classify_deployed_lifecycle_scope(
    repo_root: Path,
    asset_ids: Iterable[Any],
    db_path: Path | None = None,
) -> dict[str, Any]:
    """Separate manifest-backed media from Photos assets with no cloud exposure."""
    ids = _unique_ids(asset_ids)
    if not ids:
        raise WasteBasketError("lifecycle scope requires at least one asset")
    try:
        return {
            "scope": "deployed",
            "assetIds": ids,
            "members": derive_deployed_lifecycle_members(repo_root, ids, db_path),
        }
    except WasteBasketError as error:
        if not _is_missing_canonical_r2_error(str(error)):
            raise
        original_error = error

    connection = _connect(repo_root, db_path)
    try:
        local_only_ids = []
        for asset_id in ids:
            asset_exists = connection.execute(
                "SELECT 1 FROM sidecar_assets WHERE asset_id = ?",
                (asset_id,),
            ).fetchone()
            cloud_evidence = connection.execute(
                """SELECT 1
                     FROM (
                       SELECT 1 AS found FROM r2_objects
                        WHERE photo_id = ? AND lifecycle_state <> 'deleted_confirmed'
                       UNION ALL
                       SELECT 1 FROM public_catalog_publications WHERE asset_id = ?
                       UNION ALL
                       SELECT 1 FROM asset_publications
                        WHERE asset_id = ? AND state <> 'withdrawn'
                       UNION ALL
                       SELECT 1 FROM asset_delivery_state
                        WHERE asset_id = ? AND delivery_state IN ('uploading', 'live', 'failed')
                       UNION ALL
                       SELECT 1 FROM fixture_delivery_receipts
                        WHERE asset_id = ? AND destination = 'r2' AND status IN ('running', 'verified', 'failed')
                       UNION ALL
                       SELECT 1 FROM asset_sale_references WHERE asset_id = ?
                       UNION ALL
                       SELECT 1 FROM r2_quarantine
                        WHERE asset_id = ? AND state <> 'deleted'
                       UNION ALL
                       SELECT 1 FROM sidecar_upload_bridge_run_items
                        WHERE asset_id = ?
                          AND (
                            upload_status IN ('uploaded', 'uploaded_with_skips')
                            OR EXISTS (
                              SELECT 1 FROM json_each(
                                CASE WHEN json_valid(upload_keys_json) THEN upload_keys_json ELSE '[]' END
                              )
                            )
                          )
                       UNION ALL
                       SELECT 1 FROM asset_upload_run_items
                        WHERE asset_id = ?
                          AND (
                            status IN ('uploading', 'verified', 'live', 'failed')
                            OR EXISTS (
                              SELECT 1 FROM json_each(
                                CASE WHEN json_valid(object_keys_json) THEN object_keys_json ELSE '[]' END
                              )
                            )
                          )
                       UNION ALL
                       SELECT 1 FROM media_lifecycle
                        WHERE media_id = ?
                          AND (
                            EXISTS (
                              SELECT 1 FROM json_each(
                                CASE WHEN json_valid(public_preview_keys_json) THEN public_preview_keys_json ELSE '[]' END
                              )
                            )
                            OR EXISTS (
                              SELECT 1 FROM json_each(
                                CASE WHEN json_valid(private_keys_json) THEN private_keys_json ELSE '[]' END
                              )
                            )
                          )
                       UNION ALL
                       SELECT 1
                         FROM owner_waste_basket_provenance AS provenance
                         JOIN owner_waste_basket_entries AS entry
                           ON entry.entry_id = provenance.entry_id
                        WHERE entry.asset_id = ? AND provenance.relation_name = 'r2_objects'
                     )
                    LIMIT 1""",
                (asset_id,) * 11,
            ).fetchone()
            if asset_exists is not None and cloud_evidence is None:
                local_only_ids.append(asset_id)
    finally:
        connection.close()

    if len(local_only_ids) == len(ids):
        return {
            "scope": "local-only",
            "assetIds": ids,
            "members": [],
            "reason": "no-cloud-media-evidence",
        }
    if local_only_ids:
        deployed_ids = [asset_id for asset_id in ids if asset_id not in local_only_ids]
        return {
            "scope": "mixed",
            "assetIds": ids,
            "deployedAssetIds": deployed_ids,
            "localOnlyAssetIds": local_only_ids,
            "members": derive_deployed_lifecycle_members(repo_root, deployed_ids, db_path),
            "reason": "local-only-assets-have-no-cloud-media-evidence",
        }
    raise original_error


def resolve_deployed_lifecycle_asset_ids(
    repo_root: Path,
    operation: str,
    requested_ids: Iterable[Any] = (),
    db_path: Path | None = None,
) -> list[str]:
    """Resolve lifecycle targets to canonical local asset IDs from Owner.sqlite."""
    normalized_operation = str(operation or "").strip().lower()
    requested = _unique_ids(requested_ids)
    if normalized_operation in {"empty", "restore", "tombstone-restore"}:
        _adopt_legacy_lifecycle_for_operation(
            repo_root,
            normalized_operation,
            requested,
            db_path,
        )
    if normalized_operation == "empty" and not requested:
        connection = _connect(repo_root, db_path)
        try:
            requested = [
                str(row["asset_id"])
                for row in connection.execute(
                    "SELECT asset_id FROM owner_waste_basket_entries WHERE state = 'recoverable' ORDER BY asset_id"
                ).fetchall()
            ]
        finally:
            connection.close()
    if not requested:
        raise WasteBasketError("lifecycle operation has no authoritative local assets")
    if len(requested) > MAX_ASSET_IDS:
        raise WasteBasketError(f"lifecycle operation accepts at most {MAX_ASSET_IDS} assets")
    if normalized_operation == "x":
        return requested

    connection = _connect(repo_root, db_path)
    try:
        resolved: list[str] = []
        for identifier in requested:
            row = connection.execute(
                """SELECT asset_id FROM owner_waste_basket_entries
                   WHERE asset_id = ? OR entry_id = ?
                   ORDER BY created_at DESC LIMIT 1""",
                (identifier, identifier),
            ).fetchone()
            asset_id = str(row["asset_id"] if row else identifier).strip()
            if asset_id and asset_id not in resolved:
                resolved.append(asset_id)
        return sorted(resolved)
    finally:
        connection.close()


def record_deployed_lifecycle_arm(
    repo_root: Path,
    operation: str,
    asset_ids: Iterable[Any],
    arm: dict[str, Any],
    db_path: Path | None = None,
) -> dict[str, Any]:
    """Persist a remote arm before any authoritative local mutation."""
    ids = _unique_ids(asset_ids)
    operation_id = str(arm.get("operationId") or "").strip()
    digest = str(arm.get("operationDigest") or "").strip()
    revision = int(arm.get("revision") or 0)
    members = sorted(arm.get("members") or [], key=lambda item: str(item.get("canonicalMediaId") or ""))
    expected_operation = str(operation or "").strip().lower()
    if not operation_id or not digest or revision < 1 or len(members) != len(ids):
        raise WasteBasketError("remote lifecycle arm receipt is incomplete")
    if str(arm.get("operation") or "").strip().lower() != expected_operation:
        raise WasteBasketError("remote lifecycle arm operation does not match the local mutation")
    expected_denied = expected_operation not in {"restore", "tombstone-restore"}
    if bool(arm.get("denied")) != expected_denied:
        raise WasteBasketError("remote lifecycle arm intent does not match the local mutation")
    authoritative = derive_deployed_lifecycle_members(repo_root, ids, db_path)
    envelope = {
        "operationId": operation_id,
        "operation": expected_operation,
        "denied": expected_denied,
        "members": authoritative,
    }
    expected_digest = hashlib.sha256(
        json.dumps(envelope, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    if digest != expected_digest:
        raise WasteBasketError("remote lifecycle arm digest does not match authoritative local membership")
    expected_pairs = sorted(
        (str(item["canonicalAssetId"]), str(item["canonicalMediaId"]))
        for item in authoritative
    )
    received_pairs = sorted(
        (str(item.get("canonicalAssetId") or ""), str(item.get("canonicalMediaId") or ""))
        for item in members
    )
    if received_pairs != expected_pairs:
        raise WasteBasketError("remote lifecycle arm does not match authoritative local assets")
    if any(int(item.get("revision") or 0) != revision for item in members):
        raise WasteBasketError("remote lifecycle arm revisions are inconsistent")
    connection = _connect(repo_root, db_path)
    now = _now()
    try:
        connection.execute("BEGIN IMMEDIATE")
        existing = connection.execute(
            "SELECT operation_digest, revision, state FROM owner_lifecycle_operations WHERE operation_id = ?",
            (operation_id,),
        ).fetchone()
        if existing:
            if str(existing["operation_digest"]) != digest or int(existing["revision"]) != revision:
                raise WasteBasketError("remote lifecycle arm conflicts with durable local state")
        else:
            connection.execute(
                """INSERT INTO owner_lifecycle_operations
                  (operation_id, operation_digest, operation, revision, state, member_count, arm_receipt_json, created_at, updated_at)
                  VALUES (?, ?, ?, ?, 'armed', ?, ?, ?, ?)""",
                (operation_id, digest, operation, revision, len(members), _json(arm), now, now),
            )
        connection.commit()
        return {"operationId": operation_id, "operationDigest": digest, "state": str(existing["state"]) if existing else "armed"}
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def pending_deployed_lifecycle_operations(repo_root: Path, db_path: Path | None = None) -> list[dict[str, Any]]:
    connection = _connect(repo_root, db_path)
    try:
        rows = connection.execute(
            "SELECT operation_id, operation_digest, operation, state, arm_receipt_json FROM owner_lifecycle_operations WHERE state IN ('armed', 'locally_committed', 'deployed_applied') ORDER BY created_at"
        ).fetchall()
        return [{
            "operationId": str(row["operation_id"]),
            "operationDigest": str(row["operation_digest"]),
            "operation": str(row["operation"]),
            "state": str(row["state"]),
            "arm": json.loads(str(row["arm_receipt_json"])),
        } for row in rows]
    finally:
        connection.close()


def deployed_lifecycle_operation_state(
    repo_root: Path,
    operation_id: str,
    db_path: Path | None = None,
) -> str:
    connection = _connect(repo_root, db_path)
    try:
        row = connection.execute(
            "SELECT state FROM owner_lifecycle_operations WHERE operation_id = ?",
            (str(operation_id or "").strip(),),
        ).fetchone()
        return str(row["state"]) if row else ""
    finally:
        connection.close()


def deployed_lifecycle_local_result(
    repo_root: Path,
    operation_id: str,
    db_path: Path | None = None,
) -> dict[str, Any] | None:
    """Return the already-committed local gateway result for crash recovery."""
    connection = _connect(repo_root, db_path)
    try:
        row = connection.execute(
            """SELECT status, result_json FROM owner_waste_basket_operations
               WHERE operation_id = ?""",
            (str(operation_id or "").strip(),),
        ).fetchone()
        if row is None or str(row["status"]) != "completed":
            return None
        return json.loads(str(row["result_json"] or "{}"))
    finally:
        connection.close()


def abort_deployed_lifecycle_arm_locally(
    repo_root: Path,
    operation_id: str,
    operation_digest: str,
    db_path: Path | None = None,
) -> dict[str, Any]:
    connection = _connect(repo_root, db_path)
    try:
        connection.execute("BEGIN IMMEDIATE")
        mutation = connection.execute(
            "SELECT status FROM owner_waste_basket_operations WHERE operation_id = ?",
            (operation_id,),
        ).fetchone()
        if mutation and str(mutation["status"]) != "failed":
            raise WasteBasketError("cannot abort lifecycle arm while local mutation commit is possible")
        changed = connection.execute(
            "UPDATE owner_lifecycle_operations SET state = 'aborted', updated_at = ? WHERE operation_id = ? AND operation_digest = ? AND state = 'armed'",
            (_now(), operation_id, operation_digest),
        ).rowcount
        if changed != 1:
            raise WasteBasketError("local lifecycle arm is not abortable")
        connection.commit()
        return {"operationId": operation_id, "operationDigest": operation_digest, "state": "aborted"}
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def deployed_lifecycle_abort_proof(
    repo_root: Path,
    operation_id: str,
    operation_digest: str,
    db_path: Path | None = None,
) -> dict[str, Any] | None:
    """Return deterministic durable proof only when local commit is unambiguous."""
    connection = _connect(repo_root, db_path)
    try:
        operation = connection.execute(
            """SELECT operation_id, operation_digest, operation, state, arm_receipt_json
                 FROM owner_lifecycle_operations WHERE operation_id = ?""",
            (operation_id,),
        ).fetchone()
        if not operation or str(operation["operation_digest"]) != operation_digest:
            raise WasteBasketError("local lifecycle abort proof conflicts with durable arm state")
        if str(operation["state"]) != "armed":
            return None
        mutation = connection.execute(
            "SELECT status FROM owner_waste_basket_operations WHERE operation_id = ?",
            (operation_id,),
        ).fetchone()
        mutation_status = str(mutation["status"]) if mutation else "absent"
        if mutation_status not in {"absent", "failed"}:
            return None
        # The Worker validates the canonical arm receipt, not the full HTTP
        # response persisted by the connector. The response also contains
        # transport fields such as ``ok`` and therefore cannot be hashed
        # directly into an abort proof.
        stored_arm = json.loads(str(operation["arm_receipt_json"]))
        members = sorted(
            stored_arm.get("members") or [],
            key=lambda item: str(item.get("canonicalMediaId") or ""),
        )
        arm_receipt = {
            "operationId": str(operation["operation_id"]),
            "operationDigest": str(operation["operation_digest"]),
            "operation": str(operation["operation"]),
            "denied": bool(stored_arm.get("denied")),
            "revision": int(stored_arm.get("revision") or 0),
            "state": "armed",
            "members": [
                {
                    "canonicalMediaId": str(member.get("canonicalMediaId") or "").strip(),
                    "canonicalAssetId": str(member.get("canonicalAssetId") or "").strip(),
                    "revision": int(member.get("revision") or 0),
                }
                for member in members
            ],
        }
        proof_body = {
            "operationId": operation_id,
            "operationDigest": operation_digest,
            "operation": str(operation["operation"]),
            "localLifecycleState": "armed",
            "localMutationStatus": mutation_status,
            "armReceiptDigest": _hash(arm_receipt),
            "localMutationCommitted": False,
        }
        return {
            **proof_body,
            "kind": "owner-sqlite-no-local-commit-v1",
            "proofDigest": _hash(proof_body),
        }
    finally:
        connection.close()


def deployed_lifecycle_outbox(repo_root: Path, operation_id: str, db_path: Path | None = None) -> dict[str, Any]:
    connection = _connect(repo_root, db_path)
    try:
        operation = connection.execute(
            "SELECT * FROM owner_lifecycle_operations WHERE operation_id = ?", (operation_id,)
        ).fetchone()
        if not operation:
            raise WasteBasketError("local lifecycle outbox operation was not found")
        receipts = [
            json.loads(str(row["payload_json"]))
            for row in connection.execute(
                "SELECT payload_json FROM owner_lifecycle_outbox WHERE operation_id = ? ORDER BY canonical_media_id",
                (operation_id,),
            ).fetchall()
        ]
        if len(receipts) != int(operation["member_count"]):
            raise WasteBasketError("local lifecycle outbox membership is incomplete")
        return {
            "operationId": str(operation["operation_id"]),
            "operationDigest": str(operation["operation_digest"]),
            "operation": str(operation["operation"]),
            "revision": int(operation["revision"]),
            "state": str(operation["state"]),
            "receipts": receipts,
        }
    finally:
        connection.close()


def acknowledge_deployed_lifecycle(
    repo_root: Path,
    operation_id: str,
    operation_digest: str,
    *,
    state: str,
    db_path: Path | None = None,
) -> dict[str, Any]:
    if state not in {"deployed_applied", "locally_acked"}:
        raise WasteBasketError("invalid local lifecycle acknowledgement state")
    connection = _connect(repo_root, db_path)
    now = _now()
    try:
        connection.execute("BEGIN IMMEDIATE")
        operation = connection.execute(
            "SELECT operation_digest, state FROM owner_lifecycle_operations WHERE operation_id = ?",
            (operation_id,),
        ).fetchone()
        if not operation or str(operation["operation_digest"]) != operation_digest:
            raise WasteBasketError("local lifecycle acknowledgement conflicts with durable outbox")
        allowed = {"deployed_applied": {"locally_committed", "deployed_applied"}, "locally_acked": {"deployed_applied", "locally_acked"}}
        if str(operation["state"]) not in allowed[state]:
            raise WasteBasketError("local lifecycle acknowledgement is out of order")
        connection.execute(
            "UPDATE owner_lifecycle_operations SET state = ?, updated_at = ? WHERE operation_id = ?",
            (state, now, operation_id),
        )
        connection.execute(
            "UPDATE owner_lifecycle_outbox SET state = ?, updated_at = ? WHERE operation_id = ?",
            (state, now, operation_id),
        )
        connection.commit()
        return {"operationId": operation_id, "operationDigest": operation_digest, "state": state}
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _ensure_asset_rows(connection: sqlite3.Connection, asset_id: str, now: str) -> None:
    connection.execute(
        """
        INSERT OR IGNORE INTO sidecar_assets
          (asset_id, source_anchor, indexed_at, updated_at)
        VALUES (?, ?, ?, ?)
        """,
        (asset_id, f"owner://asset/{asset_id}", now, now),
    )
    connection.execute(
        """
        INSERT OR IGNORE INTO sidecar_decisions (asset_id, created_at, updated_at)
        VALUES (?, ?, ?)
        """,
        (asset_id, now, now),
    )


def _active_tombstone(connection: sqlite3.Connection, asset_id: str) -> bool:
    row = connection.execute(
        """
        SELECT 1 FROM sidecar_tombstones
        WHERE asset_id = ? AND tombstone_state = 'active'
        """,
        (asset_id,),
    ).fetchone()
    return row is not None


def is_globally_blocked(repo_root: Path, asset_id: str, db_path: Path | None = None) -> bool:
    """Return the fail-closed global eligibility decision from SQLite."""
    normalized = str(asset_id or "").strip()
    if not normalized:
        return True
    connection = _connect(repo_root, db_path)
    try:
        return _active_tombstone(connection, normalized) or bool(
            connection.execute(
                "SELECT 1 FROM media_lifecycle WHERE media_id = ? AND lifecycle_state = 'discarded'",
                (normalized,),
            ).fetchone()
        )
    finally:
        connection.close()


def is_globally_ineligible(repo_root: Path, asset_id: str, db_path: Path | None = None) -> bool:
    """Fail closed for public/search/delivery/commerce eligibility.

    Recoverable Waste Basket entries are intentionally not tombstones, but
    they are still excluded from every global eligibility surface until
    restored.  Active tombstones are covered by the same predicate.
    """
    normalized = str(asset_id or "").strip()
    if not normalized:
        return True
    connection = _connect(repo_root, db_path)
    try:
        return bool(
            connection.execute(
                """
                SELECT 1
                FROM sidecar_assets AS asset
                LEFT JOIN sidecar_decisions AS decision ON decision.asset_id = asset.asset_id
                LEFT JOIN media_lifecycle AS lifecycle ON lifecycle.media_id = asset.asset_id
                WHERE asset.asset_id = ?
                  AND (
                    COALESCE(decision.pick_state, '') = 'hidden'
                    OR COALESCE(lifecycle.lifecycle_state, '') IN ('hidden', 'discarded')
                    OR EXISTS (
                      SELECT 1 FROM sidecar_tombstones AS tombstone
                      WHERE tombstone.asset_id = asset.asset_id
                        AND tombstone.tombstone_state = 'active'
                    )
                  )
                """,
                (normalized,),
            ).fetchone()
        )
    finally:
        connection.close()


def active_global_tombstone_ids(repo_root: Path, db_path: Path | None = None) -> set[str]:
    connection = _connect(repo_root, db_path)
    try:
        return {
            str(row["asset_id"])
            for row in connection.execute(
                "SELECT asset_id FROM sidecar_tombstones WHERE tombstone_state = 'active'"
            ).fetchall()
        }
    finally:
        connection.close()


def _entry_for_asset(connection: sqlite3.Connection, asset_id: str) -> sqlite3.Row | None:
    return connection.execute(
        """
        SELECT * FROM owner_waste_basket_entries
        WHERE asset_id = ? AND state IN ('recoverable', 'tombstoned')
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (asset_id,),
    ).fetchone()


def _entry_payload(entry: sqlite3.Row, status: str) -> dict[str, Any]:
    return {
        "entryId": str(entry["entry_id"]),
        "assetId": str(entry["asset_id"]),
        "state": str(entry["state"]),
        "status": status,
        "source": str(entry["source"]),
        "fixtureId": str(entry["fixture_id"] or ""),
        "galleryId": str(entry["gallery_id"] or ""),
        "provenanceSha256": str(entry["provenance_sha256"]),
    }


def _receipt(
    connection: sqlite3.Connection,
    *,
    operation_id: str,
    entry: sqlite3.Row,
    before: dict[str, Any],
    after: dict[str, Any],
    state: str,
    now: str,
) -> None:
    connection.execute(
        """
        INSERT OR REPLACE INTO owner_waste_basket_receipts
          (operation_id, entry_id, asset_id, before_json, after_json, receipt_state, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM owner_waste_basket_receipts WHERE operation_id = ? AND asset_id = ?), ?), ?)
        """,
        (
            operation_id,
            str(entry["entry_id"]),
            str(entry["asset_id"]),
            _json(before),
            _json(after),
            state,
            operation_id,
            str(entry["asset_id"]),
            now,
            now,
        ),
    )


def _move_one(
    connection: sqlite3.Connection,
    *,
    operation_id: str,
    asset_id: str,
    source: str,
    actor: str,
    fixture_id: str,
    gallery_id: str,
    reason: str,
    now: str,
) -> dict[str, Any]:
    if _active_tombstone(connection, asset_id):
        raise WasteBasketError(
            f"{asset_id} has an active global tombstone; use explicit tombstone restore before X"
        )
    existing = _entry_for_asset(connection, asset_id)
    if existing is not None:
        if existing["state"] == "tombstoned":
            raise WasteBasketError(
                f"{asset_id} has an active global tombstone; use explicit tombstone restore before X"
            )
        payload = _entry_payload(existing, "already-recoverable")
        _receipt(
            connection,
            operation_id=operation_id,
            entry=existing,
            before={"state": "recoverable"},
            after=payload,
            state="already-applied",
            now=now,
        )
        return payload

    captured_at = now
    provenance_rows = _provenance_rows(connection, asset_id)
    entry_id = f"wbe-{uuid.uuid4().hex}"
    connection.execute(
        """
        INSERT INTO owner_waste_basket_entries
          (entry_id, asset_id, state, source, actor, fixture_id, gallery_id, reason,
           provenance_sha256, captured_at, created_at, updated_at)
        VALUES (?, ?, 'recoverable', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            entry_id,
            asset_id,
            source,
            actor,
            fixture_id,
            gallery_id,
            reason,
            _hash([{"relation": table, "key": key, "row": row} for table, key, row in provenance_rows]),
            captured_at,
            now,
            now,
        ),
    )
    provenance_sha256 = _snapshot(connection, entry_id, asset_id, captured_at)
    connection.execute(
        "UPDATE owner_waste_basket_entries SET provenance_sha256 = ? WHERE entry_id = ?",
        (provenance_sha256, entry_id),
    )
    _ensure_asset_rows(connection, asset_id, now)
    connection.execute(
        """
        UPDATE sidecar_assets
        SET hidden = 1, updated_at = ?
        WHERE asset_id = ?
        """,
        (now, asset_id),
    )
    connection.execute(
        """
        UPDATE sidecar_decisions
        SET pick_state = 'hidden', last_action = 'waste-basket-x', updated_at = ?
        WHERE asset_id = ?
        """,
        (now, asset_id),
    )
    media = connection.execute(
        "SELECT * FROM media_lifecycle WHERE media_id = ?",
        (asset_id,),
    ).fetchone()
    if media and str(media["lifecycle_state"] or "") == "discarded":
        raise WasteBasketError(f"{asset_id} is already globally discarded")
    if media:
        connection.execute(
            """
            UPDATE media_lifecycle
            SET previous_state = COALESCE(previous_state, lifecycle_state),
                lifecycle_state = 'hidden', hidden_at = ?, restored_at = NULL, updated_at = ?
            WHERE media_id = ?
            """,
            (now, now, asset_id),
        )
    else:
        title = connection.execute(
            "SELECT title FROM sidecar_decisions WHERE asset_id = ?",
            (asset_id,),
        ).fetchone()
        connection.execute(
            """
            INSERT INTO media_lifecycle
              (media_id, lifecycle_state, previous_state, source_slug, title, hidden_at, updated_at)
            VALUES (?, 'hidden', 'active', ?, ?, ?, ?)
            """,
            (asset_id, gallery_id or fixture_id, str(title["title"] if title else ""), now, now),
        )
    entry = connection.execute(
        "SELECT * FROM owner_waste_basket_entries WHERE entry_id = ?",
        (entry_id,),
    ).fetchone()
    payload = _entry_payload(entry, "applied")
    _receipt(
        connection,
        operation_id=operation_id,
        entry=entry,
        before={"provenanceSha256": provenance_sha256, "state": "pre-x"},
        after=payload,
        state="applied",
        now=now,
    )
    return payload


def move_to_waste_basket(
    repo_root: Path,
    asset_ids: Iterable[Any],
    *,
    source: str,
    actor: str = "owner",
    fixture_id: str = "",
    gallery_id: str = "",
    reason: str = "",
    request_key: str | None = None,
    owner_mode: bool = False,
    owner_authorized: bool = False,
    db_path: Path | None = None,
    deployed_lifecycle: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ids = _unique_ids(asset_ids)
    if not ids:
        raise WasteBasketError("Waste Basket X requires at least one asset")
    if len(ids) > MAX_ASSET_IDS:
        raise WasteBasketError(f"Waste Basket X accepts at most {MAX_ASSET_IDS} assets")
    normalized_source = _validate_source(source, owner_mode=owner_mode, owner_authorized=owner_authorized)
    actor = str(actor or "").strip()
    if not actor:
        raise WasteBasketError("Waste Basket actor is required")
    context = {"fixtureId": fixture_id, "galleryId": gallery_id, "reason": reason}
    key = _normalize_request_key("x", ids, normalized_source, request_key, context)

    def mutate(connection: sqlite3.Connection, operation_id: str, now: str) -> dict[str, Any]:
        items = [
            _move_one(
                connection,
                operation_id=operation_id,
                asset_id=asset_id,
                source=normalized_source,
                actor=actor,
                fixture_id=str(fixture_id or ""),
                gallery_id=str(gallery_id or ""),
                reason=str(reason or ""),
                now=now,
            )
            for asset_id in ids
        ]
        return {
            "ok": True,
            "operation": "x",
            "operationId": operation_id,
            "requestKey": key,
            "state": "recoverable",
            "items": items,
            "assetIds": ids,
        }

    return _run_operation(
        repo_root,
        operation="x",
        asset_ids=ids,
        source=normalized_source,
        actor=actor,
        request_key=key,
        authorization={"ownerMode": owner_mode, "ownerAuthorized": owner_authorized},
        confirmed=False,
        db_path=db_path,
        mutate=mutate,
        deployed_lifecycle=deployed_lifecycle,
    )


def _restore_rows(connection: sqlite3.Connection, entry_id: str, asset_id: str, now: str) -> None:
    snapshots = {table: _provenance_map(connection, entry_id, table) for table in RESTORE_STATE_TABLES}
    # Remove the rows created by X when they did not exist in the immutable
    # snapshot.  Foreign-key children are removed before sidecar_assets.
    for table in ("sidecar_tombstones", "sidecar_decisions"):
        if not snapshots[table]:
            connection.execute(f"DELETE FROM {table} WHERE asset_id = ?", (asset_id,))
    if not snapshots["media_lifecycle"]:
        connection.execute("DELETE FROM media_lifecycle WHERE media_id = ?", (asset_id,))
    if not snapshots["sidecar_assets"]:
        connection.execute("DELETE FROM sidecar_assets WHERE asset_id = ?", (asset_id,))

    for table in ("sidecar_assets", "media_lifecycle", "sidecar_decisions", "sidecar_tombstones"):
        for row in snapshots[table].values():
            names = [name for name in _columns(connection, table) if name in row]
            if not names:
                continue
            primary_keys = _primary_key_columns(connection, table)
            key_names = [name for name in primary_keys if name in row]
            key_values = [row[name] for name in key_names]
            existing = None
            if key_names:
                key_where = " AND ".join(f"{name} IS ?" for name in key_names)
                existing = connection.execute(
                    f"SELECT 1 FROM {table} WHERE {key_where}",
                    key_values,
                ).fetchone()
            update_names = [name for name in names if name not in key_names]
            if existing is not None and update_names:
                assignments = ",".join(f"{name} = ?" for name in update_names)
                connection.execute(
                    f"UPDATE {table} SET {assignments} WHERE {key_where}",
                    [row[name] for name in update_names] + key_values,
                )
                continue
            placeholders = ",".join("?" for _name in names)
            connection.execute(
                f"INSERT INTO {table} ({','.join(names)}) VALUES ({placeholders})",
                [row[name] for name in names],
            )

    # A restore is itself a new lifecycle event.  Keep the original row
    # values exact while ensuring a legacy active tombstone cannot stay active
    # after a successful explicit restore of this entry.
    connection.execute(
        "UPDATE sidecar_tombstones SET updated_at = ? WHERE asset_id = ? AND tombstone_state = 'restored'",
        (now, asset_id),
    )


def _resolve_entries(
    connection: sqlite3.Connection,
    asset_ids: list[str],
    *,
    include_restored: bool = False,
) -> list[sqlite3.Row]:
    if not asset_ids:
        return connection.execute(
            """
            SELECT * FROM owner_waste_basket_entries
            WHERE state IN ('recoverable', 'tombstoned')
            ORDER BY created_at, asset_id
            """
        ).fetchall()
    result: list[sqlite3.Row] = []
    states = "'recoverable', 'tombstoned', 'restored'" if include_restored else "'recoverable', 'tombstoned'"
    for value in asset_ids:
        row = connection.execute(
            f"""
            SELECT * FROM owner_waste_basket_entries
            WHERE (entry_id = ? OR asset_id = ?) AND state IN ({states})
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (value, value),
        ).fetchone()
        if row is not None:
            result.append(row)
    return result


def _assert_recoverable_fixture_scope(
    entries: list[sqlite3.Row],
    asset_ids: list[str],
    fixture_id: str,
    *,
    allow_restored: bool = False,
) -> None:
    expected_fixture = str(fixture_id or "").strip()
    if not expected_fixture:
        raise WasteBasketError("Waste Basket restore fixture is required")
    resolved = {
        value
        for entry in entries
        for value in (str(entry["asset_id"]), str(entry["entry_id"]))
    }
    missing = sorted(set(asset_ids) - resolved)
    if missing:
        raise WasteBasketError(f"No recoverable Waste Basket entry for: {', '.join(missing)}")
    allowed_states = {"recoverable", "restored"} if allow_restored else {"recoverable"}
    mismatched = sorted({
        str(entry["asset_id"])
        for entry in entries
        if str(entry["state"]) not in allowed_states
        or str(entry["fixture_id"] or "").strip() != expected_fixture
    })
    if mismatched:
        raise WasteBasketError(
            "Recoverable Waste Basket entries are outside the frozen fixture: "
            + ", ".join(mismatched)
        )


def assert_recoverable_entries_in_fixture(
    repo_root: Path,
    asset_ids: Iterable[Any],
    *,
    fixture_id: str,
    allow_restored: bool = False,
    db_path: Path | None = None,
) -> None:
    """Verify fixture-bound authoritative rows before a hosted-session restore.

    ``allow_restored`` is reserved for idempotent retry after an authoritative
    restore committed but its static projection or HTTP acknowledgement did not.
    """

    ids = _unique_ids(asset_ids)
    if not ids:
        raise WasteBasketError("Waste Basket restore requires at least one asset")
    connection = _connect(repo_root, db_path)
    try:
        _assert_recoverable_fixture_scope(
            _resolve_entries(connection, ids, include_restored=allow_restored),
            ids,
            fixture_id,
            allow_restored=allow_restored,
        )
    finally:
        connection.close()


def _restore_operation(
    repo_root: Path,
    asset_ids: Iterable[Any],
    *,
    operation: str,
    source: str,
    actor: str,
    request_key: str | None,
    owner_mode: bool,
    owner_authorized: bool,
    fixture_id: str = "",
    db_path: Path | None = None,
    deployed_lifecycle: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ids = _unique_ids(asset_ids)
    normalized_source = _validate_source(source, owner_mode=owner_mode, owner_authorized=owner_authorized)
    context = {"operation": operation, "fixtureId": str(fixture_id or "")}
    key = _normalize_request_key(operation, ids, normalized_source, request_key, context)
    if operation in {"restore", "tombstone-restore"}:
        _adopt_legacy_lifecycle_for_operation(repo_root, operation, ids, db_path)

    def mutate(connection: sqlite3.Connection, operation_id: str, now: str) -> dict[str, Any]:
        entries = _resolve_entries(
            connection,
            ids,
            include_restored=operation == "restore",
        )
        if ids and len(entries) != len(ids):
            missing = sorted(set(ids) - {str(row["asset_id"]) for row in entries} - {str(row["entry_id"]) for row in entries})
            raise WasteBasketError(f"No recoverable Waste Basket entry for: {', '.join(missing)}")
        if fixture_id:
            _assert_recoverable_fixture_scope(
                entries,
                ids,
                fixture_id,
                allow_restored=operation == "restore",
            )
        items: list[dict[str, Any]] = []
        for entry in entries:
            state = str(entry["state"])
            if operation == "restore" and state == "tombstoned":
                raise WasteBasketError(
                    f"{entry['asset_id']} is globally tombstoned; use explicit tombstone restore"
                )
            if state == "restored":
                item = _entry_payload(entry, "already-restored")
                _receipt(
                    connection,
                    operation_id=operation_id,
                    entry=entry,
                    before=item,
                    after=item,
                    state="already-applied",
                    now=now,
                )
                items.append(item)
                continue
            before = {"state": state, "entryId": str(entry["entry_id"])}
            _restore_rows(connection, str(entry["entry_id"]), str(entry["asset_id"]), now)
            next_state = "restored"
            connection.execute(
                """
                UPDATE owner_waste_basket_entries
                SET state = ?, restored_at = ?, updated_at = ?
                WHERE entry_id = ?
                """,
                (next_state, now, now, str(entry["entry_id"])),
            )
            refreshed = connection.execute(
                "SELECT * FROM owner_waste_basket_entries WHERE entry_id = ?",
                (str(entry["entry_id"]),),
            ).fetchone()
            item = _entry_payload(refreshed, "restored")
            _receipt(
                connection,
                operation_id=operation_id,
                entry=refreshed,
                before=before,
                after=item,
                state="restored",
                now=now,
            )
            items.append(item)
        return {
            "ok": True,
            "operation": operation,
            "operationId": operation_id,
            "requestKey": key,
            "state": "restored",
            "items": items,
            "assetIds": [str(item["assetId"]) for item in items],
        }

    return _run_operation(
        repo_root,
        operation=operation,
        asset_ids=ids,
        source=normalized_source,
        actor=actor,
        request_key=key,
        authorization={
            "ownerMode": owner_mode,
            "ownerAuthorized": owner_authorized,
            "fixtureId": str(fixture_id or ""),
        },
        confirmed=False,
        db_path=db_path,
        mutate=mutate,
        deployed_lifecycle=deployed_lifecycle,
    )


def restore_from_waste_basket(
    repo_root: Path,
    asset_ids: Iterable[Any],
    *,
    source: str = "backstage-waste-basket",
    actor: str = "owner",
    request_key: str | None = None,
    owner_mode: bool = False,
    owner_authorized: bool = False,
    fixture_id: str = "",
    db_path: Path | None = None,
    deployed_lifecycle: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return _restore_operation(
        repo_root,
        asset_ids,
        operation="restore",
        source=source,
        actor=actor,
        request_key=request_key,
        owner_mode=owner_mode,
        owner_authorized=owner_authorized,
        fixture_id=fixture_id,
        db_path=db_path,
        deployed_lifecycle=deployed_lifecycle,
    )


def _empty_one(
    connection: sqlite3.Connection,
    *,
    operation_id: str,
    entry: sqlite3.Row,
    reason: str,
    now: str,
) -> dict[str, Any]:
    asset_id = str(entry["asset_id"])
    if str(entry["state"]) == "tombstoned":
        item = _entry_payload(entry, "already-tombstoned")
        _receipt(connection, operation_id=operation_id, entry=entry, before=item, after=item, state="already-applied", now=now)
        return item
    # Legacy lifecycle adoption can produce a recoverable entry without the
    # newer sidecar asset/decision rows. Materialize those parent rows before
    # writing the FK-dependent decision and tombstone records.
    _ensure_asset_rows(connection, asset_id, now)
    connection.execute(
        """
        UPDATE sidecar_decisions
        SET pick_state = 'rejected', metadata_state = 'blocked', last_action = 'waste-basket-empty', updated_at = ?
        WHERE asset_id = ?
        """,
        (now, asset_id),
    )
    connection.execute(
        """
        INSERT INTO sidecar_tombstones (asset_id, tombstone_state, reason, tombstoned_at, updated_at)
        VALUES (?, 'active', ?, ?, ?)
        ON CONFLICT(asset_id) DO UPDATE SET
          tombstone_state = 'active', reason = excluded.reason,
          tombstoned_at = excluded.tombstoned_at, updated_at = excluded.updated_at
        """,
        (asset_id, reason or "empty waste basket", now, now),
    )
    connection.execute(
        """
        UPDATE media_lifecycle
        SET previous_state = lifecycle_state, lifecycle_state = 'discarded',
            discarded_at = ?, restored_at = NULL,
            tombstone_json = ?, updated_at = ?
        WHERE media_id = ?
        """,
        (_now(), _json({"entryId": str(entry["entry_id"]), "reason": reason}), now, asset_id),
    )
    connection.execute(
        """
        UPDATE owner_waste_basket_entries
        SET state = 'tombstoned', emptied_at = ?, tombstone_reason = ?, updated_at = ?
        WHERE entry_id = ?
        """,
        (now, reason or "empty waste basket", now, str(entry["entry_id"])),
    )
    refreshed = connection.execute(
        "SELECT * FROM owner_waste_basket_entries WHERE entry_id = ?",
        (str(entry["entry_id"]),),
    ).fetchone()
    item = _entry_payload(refreshed, "tombstoned")
    _receipt(
        connection,
        operation_id=operation_id,
        entry=refreshed,
        before={"state": "recoverable", "entryId": str(entry["entry_id"])},
        after=item,
        state="tombstoned",
        now=now,
    )
    return item


def empty_waste_basket(
    repo_root: Path,
    asset_ids: Iterable[Any] = (),
    *,
    confirmed: bool,
    confirmation_token: str,
    source: str = "backstage-waste-basket",
    actor: str = "owner",
    reason: str = "empty waste basket",
    request_key: str | None = None,
    owner_mode: bool = False,
    owner_authorized: bool = False,
    db_path: Path | None = None,
    deployed_lifecycle: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if confirmed is not True or str(confirmation_token or "") != EMPTY_CONFIRMATION_TOKEN:
        raise WasteBasketError(
            "Empty Waste Basket requires explicit confirmation token EMPTY_WASTE_BASKET"
        )
    ids = _unique_ids(asset_ids)
    if len(ids) > MAX_ASSET_IDS:
        raise WasteBasketError(f"Empty Waste Basket accepts at most {MAX_ASSET_IDS} assets")
    normalized_source = _validate_source(source, owner_mode=owner_mode, owner_authorized=owner_authorized)
    context = {"reason": reason, "confirmation": EMPTY_CONFIRMATION_TOKEN}
    key = _normalize_request_key("empty", ids, normalized_source, request_key, context)
    _adopt_legacy_lifecycle_for_operation(repo_root, "empty", ids, db_path)

    def mutate(connection: sqlite3.Connection, operation_id: str, now: str) -> dict[str, Any]:
        entries = _resolve_entries(connection, ids)
        if ids and len(entries) != len(ids):
            known = {str(row["asset_id"]) for row in entries} | {str(row["entry_id"]) for row in entries}
            raise WasteBasketError(f"No recoverable Waste Basket entry for: {', '.join(sorted(set(ids) - known))}")
        items = [
            _empty_one(connection, operation_id=operation_id, entry=entry, reason=reason, now=now)
            for entry in entries
        ]
        return {
            "ok": True,
            "operation": "empty",
            "operationId": operation_id,
            "requestKey": key,
            "state": "tombstoned",
            "confirmed": True,
            "items": items,
            "assetIds": [str(item["assetId"]) for item in items],
            "r2Deleted": False,
            "historyErased": False,
        }

    return _run_operation(
        repo_root,
        operation="empty",
        asset_ids=ids,
        source=normalized_source,
        actor=actor,
        request_key=key,
        authorization={"ownerMode": owner_mode, "ownerAuthorized": owner_authorized},
        confirmed=True,
        db_path=db_path,
        mutate=mutate,
        deployed_lifecycle=deployed_lifecycle,
    )


def restore_tombstone(
    repo_root: Path,
    asset_ids: Iterable[Any],
    *,
    source: str = "backstage-waste-basket",
    actor: str = "owner",
    request_key: str | None = None,
    owner_mode: bool = False,
    owner_authorized: bool = False,
    explicit_tombstone_restore: bool = False,
    db_path: Path | None = None,
    deployed_lifecycle: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if explicit_tombstone_restore is not True:
        raise WasteBasketError("Global tombstone restore requires explicit tombstone-restore authorization")
    return _restore_operation(
        repo_root,
        asset_ids,
        operation="tombstone-restore",
        source=source,
        actor=actor,
        request_key=request_key,
        owner_mode=owner_mode,
        owner_authorized=owner_authorized,
        db_path=db_path,
        deployed_lifecycle=deployed_lifecycle,
    )


def lifecycle_receipt_snapshot(
    repo_root: Path,
    *,
    operation_id: str,
    db_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Read-only audit helper used by tests and operator diagnostics."""
    connection = _connect(repo_root, db_path)
    try:
        return [
            dict(row)
            for row in connection.execute(
                """
                SELECT operation_id, entry_id, asset_id, before_json, after_json,
                       receipt_state, created_at, updated_at
                FROM owner_waste_basket_receipts
                WHERE operation_id = ?
                ORDER BY asset_id
                """,
                (operation_id,),
            ).fetchall()
        ]
    finally:
        connection.close()
