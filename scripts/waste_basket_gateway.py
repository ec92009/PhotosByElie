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


def _connect(repo_root: Path, db_path: Path | None = None) -> sqlite3.Connection:
    """Open the Owner DB and ensure every related schema is present."""
    path = _db_path(repo_root, db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sidecar_state_db.connect(repo_root, path)
    # These are the same SQLite file, but each historical module owns its
    # schema helper.  Calling them here makes the gateway safe for synthetic
    # fixtures and for a partially initialized local checkout.
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
        """
    )
    connection.commit()
    return connection


def ensure_schema(repo_root: Path, db_path: Path | None = None) -> None:
    connection = _connect(repo_root, db_path)
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
    digest_items: list[dict[str, Any]] = []
    for table, relation_key, payload in _provenance_rows(connection, asset_id):
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
) -> dict[str, Any]:
    connection = _connect(repo_root, db_path)
    operation_id = f"wbo-{uuid.uuid4().hex}"
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
) -> dict[str, Any]:
    ids = _unique_ids(asset_ids)
    normalized_source = _validate_source(source, owner_mode=owner_mode, owner_authorized=owner_authorized)
    context = {"operation": operation, "fixtureId": str(fixture_id or "")}
    key = _normalize_request_key(operation, ids, normalized_source, request_key, context)

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
