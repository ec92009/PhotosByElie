#!/usr/bin/env python3
"""Local Sidecar workflow state stored inside the Owner SQLite database."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import sqlite3
import uuid
from pathlib import Path
from typing import Any, Iterable

try:
    from import_source_anchor import photo_id_for_source_path
    from media_keys import DEFAULT_PUBLIC_PREFIX, private_master_key, private_render_key, public_preview_key
except ModuleNotFoundError:  # pragma: no cover - supports package-style test imports.
    from scripts.import_source_anchor import photo_id_for_source_path
    from scripts.media_keys import DEFAULT_PUBLIC_PREFIX, private_master_key, private_render_key, public_preview_key


DEFAULT_DB = Path("assets/owner-actions/Owner.sqlite")
KEYWORD_BLACKLIST_JSON = Path("assets/owner-actions/keyword-blacklist.json")
DEFAULT_PUBLIC_BUCKET = "photosbyelie-public"
DEFAULT_PRIVATE_BUCKET = "photosbyelie-private"
DEFAULT_PRIVATE_PREFIX = "masters"
PRIVATE_RENDER_PRODUCTS = ("jpg-6mp", "jpg-3mp", "jpg-1mp")
RATING_VALUES = {0, 1, 2, 3, 4, 5}
COLOR_VALUES = {"", "red", "yellow", "green", "blue", "purple"}
PICK_STATES = {"undecided", "picked", "rejected", "hidden"}
METADATA_STATES = {"unreviewed", "proposed", "approved", "rework", "blocked"}
REWORK_CATEGORIES = {"", "incorrect", "generic", "placeholder", "keywords", "detail", "shoot", "other"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _read_json_text(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def connect(repo_root: Path, db_path: Path | None = None) -> sqlite3.Connection:
    path = db_path or DEFAULT_DB
    if not path.is_absolute():
        path = repo_root / path
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    ensure_schema(conn)
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS sidecar_assets (
          asset_id       TEXT PRIMARY KEY CHECK (trim(asset_id) <> ''),
          source_anchor  TEXT NOT NULL CHECK (trim(source_anchor) <> ''),
          media_type     TEXT,
          filename       TEXT,
          captured_at    TEXT,
          modified_at    TEXT,
          pixel_width    INTEGER,
          pixel_height   INTEGER,
          duration       REAL,
          favorite       INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
          hidden         INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
          raw_json       TEXT NOT NULL DEFAULT '{}',
          indexed_at     TEXT,
          updated_at     TEXT
        ) WITHOUT ROWID;

        CREATE INDEX IF NOT EXISTS idx_sidecar_assets_captured ON sidecar_assets(captured_at, asset_id);
        CREATE INDEX IF NOT EXISTS idx_sidecar_assets_media_type ON sidecar_assets(media_type, captured_at);

        CREATE TABLE IF NOT EXISTS sidecar_decisions (
          asset_id       TEXT PRIMARY KEY CHECK (trim(asset_id) <> ''),
          rating         INTEGER NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
          color          TEXT NOT NULL DEFAULT '' CHECK (color IN ('', 'red', 'yellow', 'green', 'blue', 'purple')),
          pick_state     TEXT NOT NULL DEFAULT 'undecided' CHECK (pick_state IN ('undecided', 'picked', 'rejected', 'hidden')),
          metadata_state TEXT NOT NULL DEFAULT 'unreviewed' CHECK (metadata_state IN ('unreviewed', 'proposed', 'approved', 'rework', 'blocked')),
          title          TEXT,
          keywords_json  TEXT NOT NULL DEFAULT '[]',
          rework_category TEXT NOT NULL DEFAULT '',
          rework_comment TEXT,
          last_action    TEXT,
          created_at     TEXT,
          updated_at     TEXT,
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id) ON DELETE CASCADE
        ) WITHOUT ROWID;

        CREATE INDEX IF NOT EXISTS idx_sidecar_decisions_pick ON sidecar_decisions(pick_state, metadata_state, updated_at);
        CREATE INDEX IF NOT EXISTS idx_sidecar_decisions_rating ON sidecar_decisions(rating, color, updated_at);

        CREATE TABLE IF NOT EXISTS sidecar_pending_sync (
          sync_id        TEXT PRIMARY KEY CHECK (trim(sync_id) <> ''),
          asset_id       TEXT NOT NULL CHECK (trim(asset_id) <> ''),
          field_family   TEXT NOT NULL CHECK (trim(field_family) <> ''),
          old_value_json TEXT NOT NULL DEFAULT '{}',
          new_value_json TEXT NOT NULL DEFAULT '{}',
          status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'committed', 'conflict', 'failed')),
          error_text     TEXT,
          created_at     TEXT,
          updated_at     TEXT,
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_sidecar_pending_status ON sidecar_pending_sync(status, updated_at);
        CREATE INDEX IF NOT EXISTS idx_sidecar_pending_asset ON sidecar_pending_sync(asset_id, status);

        CREATE TABLE IF NOT EXISTS sidecar_tombstones (
          asset_id        TEXT PRIMARY KEY CHECK (trim(asset_id) <> ''),
          tombstone_state TEXT NOT NULL DEFAULT 'active' CHECK (tombstone_state IN ('active', 'restored')),
          reason          TEXT,
          tombstoned_at   TEXT,
          updated_at      TEXT,
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id) ON DELETE CASCADE
        ) WITHOUT ROWID;

        CREATE INDEX IF NOT EXISTS idx_sidecar_tombstones_state ON sidecar_tombstones(tombstone_state, updated_at);

        CREATE TABLE IF NOT EXISTS sidecar_mock_uploads (
          asset_id      TEXT PRIMARY KEY CHECK (trim(asset_id) <> ''),
          mock_state    TEXT NOT NULL DEFAULT 'active' CHECK (mock_state IN ('active', 'cleared')),
          mock_run_id   TEXT,
          uploaded_at   TEXT,
          updated_at    TEXT,
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id) ON DELETE CASCADE
        ) WITHOUT ROWID;

        CREATE INDEX IF NOT EXISTS idx_sidecar_mock_uploads_state ON sidecar_mock_uploads(mock_state, updated_at);
        """
    )
    decision_columns = {
        str(row["name"])
        for row in conn.execute("PRAGMA table_info(sidecar_decisions)").fetchall()
    }
    if "rework_category" not in decision_columns:
        conn.execute("ALTER TABLE sidecar_decisions ADD COLUMN rework_category TEXT NOT NULL DEFAULT ''")
    if "rework_comment" not in decision_columns:
        conn.execute("ALTER TABLE sidecar_decisions ADD COLUMN rework_comment TEXT")


def _asset_id(row: dict[str, Any]) -> str:
    return str(row.get("localIdentifier") or row.get("asset_id") or row.get("assetId") or "").strip()


def upsert_assets(repo_root: Path, rows: Iterable[dict[str, Any]]) -> int:
    now = now_iso()
    count = 0
    with connect(repo_root) as conn:
        for row in rows:
            asset_id = _asset_id(row)
            if not asset_id:
                continue
            conn.execute(
                """
                INSERT INTO sidecar_assets (
                  asset_id, source_anchor, media_type, filename, captured_at, modified_at,
                  pixel_width, pixel_height, duration, favorite, hidden, raw_json, indexed_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(asset_id) DO UPDATE SET
                  source_anchor = excluded.source_anchor,
                  media_type = excluded.media_type,
                  filename = excluded.filename,
                  captured_at = excluded.captured_at,
                  modified_at = excluded.modified_at,
                  pixel_width = excluded.pixel_width,
                  pixel_height = excluded.pixel_height,
                  duration = excluded.duration,
                  favorite = excluded.favorite,
                  hidden = excluded.hidden,
                  raw_json = excluded.raw_json,
                  indexed_at = excluded.indexed_at,
                  updated_at = excluded.updated_at
                """,
                (
                    asset_id,
                    str(row.get("sourceAnchor") or f"apple-photos://{asset_id}"),
                    str(row.get("mediaType") or ""),
                    str(row.get("filename") or ""),
                    str(row.get("creationDate") or ""),
                    str(row.get("modificationDate") or ""),
                    int(row.get("pixelWidth") or 0),
                    int(row.get("pixelHeight") or 0),
                    float(row.get("duration") or 0),
                    1 if row.get("favorite") else 0,
                    1 if row.get("hidden") else 0,
                    _json_text(row),
                    now,
                    now,
                ),
            )
            conn.execute(
                """
                INSERT OR IGNORE INTO sidecar_decisions (asset_id, created_at, updated_at)
                VALUES (?, ?, ?)
                """,
                (asset_id, now, now),
            )
            count += 1
    return count


def _decision_payload(row: sqlite3.Row | None) -> dict[str, Any]:
    if row is None:
        return {
            "rating": 0,
            "color": "",
            "pickState": "undecided",
            "metadataState": "unreviewed",
            "title": "",
            "keywords": [],
            "reworkCategory": "",
            "reworkComment": "",
            "lastAction": "",
            "updatedAt": "",
        }
    return {
        "rating": int(row["rating"] or 0),
        "color": row["color"] or "",
        "pickState": row["pick_state"] or "undecided",
        "metadataState": row["metadata_state"] or "unreviewed",
        "title": row["title"] or "",
        "keywords": _read_json_text(row["keywords_json"], []),
        "reworkCategory": row["rework_category"] or "",
        "reworkComment": row["rework_comment"] or "",
        "lastAction": row["last_action"] or "",
        "updatedAt": row["updated_at"] or "",
    }


def merge_state(repo_root: Path, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    asset_ids = [_asset_id(row) for row in rows if _asset_id(row)]
    if not asset_ids:
        return rows
    placeholders = ",".join("?" for _ in asset_ids)
    with connect(repo_root) as conn:
        decision_rows = conn.execute(
            f"SELECT * FROM sidecar_decisions WHERE asset_id IN ({placeholders})",
            asset_ids,
        ).fetchall()
        decisions = {str(row["asset_id"]): _decision_payload(row) for row in decision_rows}
        pending_rows = conn.execute(
            f"""
            SELECT asset_id, count(*) AS pending_count
            FROM sidecar_pending_sync
            WHERE status = 'pending' AND asset_id IN ({placeholders})
            GROUP BY asset_id
            """,
            asset_ids,
        ).fetchall()
        pending = {str(row["asset_id"]): int(row["pending_count"] or 0) for row in pending_rows}
        tombstone_rows = conn.execute(
            f"""
            SELECT asset_id, tombstone_state
            FROM sidecar_tombstones
            WHERE tombstone_state = 'active' AND asset_id IN ({placeholders})
            """,
            asset_ids,
        ).fetchall()
        tombstones = {str(row["asset_id"]): str(row["tombstone_state"] or "") for row in tombstone_rows}
    merged = []
    for row in rows:
        asset_id = _asset_id(row)
        merged.append({
            **row,
            "sidecarState": decisions.get(asset_id, _decision_payload(None)),
            "pendingSyncCount": pending.get(asset_id, 0),
            "tombstoneState": tombstones.get(asset_id, ""),
        })
    return merged


def _current_decision(conn: sqlite3.Connection, asset_id: str) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM sidecar_decisions WHERE asset_id = ?", (asset_id,)).fetchone()
    return _decision_payload(row)


def _queue_pending_sync(
    conn: sqlite3.Connection,
    asset_id: str,
    field_family: str,
    old_value: Any,
    new_value: Any,
    now: str,
) -> None:
    conn.execute(
        "DELETE FROM sidecar_pending_sync WHERE asset_id = ? AND field_family = ? AND status = 'pending'",
        (asset_id, field_family),
    )
    conn.execute(
        """
        INSERT INTO sidecar_pending_sync (
          sync_id, asset_id, field_family, old_value_json, new_value_json, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
        """,
        (uuid.uuid4().hex, asset_id, field_family, _json_text(old_value), _json_text(new_value), now, now),
    )


def _pending_sync_count(conn: sqlite3.Connection, asset_id: str) -> int:
    row = conn.execute(
        """
        SELECT count(*) AS total
        FROM sidecar_pending_sync
        WHERE asset_id = ? AND status = 'pending'
        """,
        (asset_id,),
    ).fetchone()
    return int(row["total"] or 0)


def _active_tombstone_state(conn: sqlite3.Connection, asset_id: str) -> str:
    row = conn.execute(
        """
        SELECT tombstone_state
        FROM sidecar_tombstones
        WHERE asset_id = ? AND tombstone_state = 'active'
        """,
        (asset_id,),
    ).fetchone()
    return str(row["tombstone_state"] or "") if row else ""


def _normalize_rework_category(value: Any) -> str:
    category = str(value or "").strip().casefold()
    if category not in REWORK_CATEGORIES:
        raise ValueError("reworkCategory is invalid")
    return category


def _keyword_blacklist_json_fallback(repo_root: Path) -> set[str]:
    path = repo_root / KEYWORD_BLACKLIST_JSON
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return set()
    values = payload.get("keywords") if isinstance(payload, dict) else None
    if not isinstance(values, list):
        return set()
    return {str(keyword).strip().casefold() for keyword in values if str(keyword).strip()}


def _keyword_blacklist_set(conn: sqlite3.Connection, repo_root: Path) -> set[str]:
    try:
        rows = conn.execute("SELECT keyword FROM keyword_blacklist ORDER BY keyword COLLATE NOCASE").fetchall()
    except sqlite3.OperationalError:
        return _keyword_blacklist_json_fallback(repo_root)
    values = {str(row["keyword"] or "").strip().casefold() for row in rows if str(row["keyword"] or "").strip()}
    return values or _keyword_blacklist_json_fallback(repo_root)


def _clean_keywords(value: Any, keyword_blacklist: set[str]) -> list[str]:
    raw_keywords = value
    if isinstance(raw_keywords, str):
        raw_keywords = [part.strip() for part in raw_keywords.replace(";", ",").split(",")]
    elif not isinstance(raw_keywords, list):
        raw_keywords = []
    cleaned: list[str] = []
    seen: set[str] = set()
    for keyword in raw_keywords:
        clean = str(keyword).strip()
        normalized = clean.casefold()
        if not clean or normalized in seen or normalized in keyword_blacklist:
            continue
        seen.add(normalized)
        cleaned.append(clean)
    return cleaned


def _metadata_values_from_payload(
    payload: dict[str, Any],
    fallback_title: str,
    fallback_keywords: list[str],
    keyword_blacklist: set[str],
) -> tuple[str, list[str]]:
    title = fallback_title
    keywords = _clean_keywords(fallback_keywords, keyword_blacklist)
    if "title" in payload:
        title = str(payload.get("title") or "").strip()
    if "keywords" in payload:
        keywords = _clean_keywords(payload.get("keywords") or [], keyword_blacklist)
    return title, keywords


def record_decision(repo_root: Path, payload: dict[str, Any]) -> dict[str, Any]:
    asset_id = str(payload.get("assetId") or payload.get("asset_id") or payload.get("localIdentifier") or "").strip()
    if not asset_id:
        raise ValueError("assetId is required")
    action = str(payload.get("action") or "").strip().casefold()
    now = now_iso()
    with connect(repo_root) as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO sidecar_assets (asset_id, source_anchor, indexed_at, updated_at)
            VALUES (?, ?, ?, ?)
            """,
            (asset_id, f"apple-photos://{asset_id}", now, now),
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO sidecar_decisions (asset_id, created_at, updated_at)
            VALUES (?, ?, ?)
            """,
            (asset_id, now, now),
        )
        before = _current_decision(conn, asset_id)
        before_tombstone_state = _active_tombstone_state(conn, asset_id)
        before_for_sync = {**before, "tombstoneState": before_tombstone_state}
        rating = before["rating"]
        color = before["color"]
        pick_state = before["pickState"]
        metadata_state = before["metadataState"]
        title = before["title"]
        keywords = before["keywords"]
        rework_category = before["reworkCategory"]
        rework_comment = before["reworkComment"]
        keyword_blacklist = _keyword_blacklist_set(conn, repo_root)
        changed_families: set[str] = set()

        if action == "rating":
            rating = int(payload.get("rating") or payload.get("value") or 0)
            if rating not in RATING_VALUES:
                raise ValueError("rating must be between 0 and 5")
            changed_families.add("rating")
        elif action == "color":
            color = str(payload.get("color") or payload.get("value") or "").strip().casefold()
            if color not in COLOR_VALUES:
                raise ValueError("color must be red, yellow, green, blue, purple, or blank")
            changed_families.add("color")
        elif action == "pick":
            pick_state = "picked"
            changed_families.add("pick_state")
        elif action == "unpick":
            pick_state = "undecided"
            changed_families.add("pick_state")
        elif action == "restore":
            pick_state = "undecided"
            if metadata_state == "blocked":
                metadata_state = "unreviewed"
                changed_families.add("metadata")
            if before_tombstone_state == "active":
                changed_families.add("tombstone")
            changed_families.add("pick_state")
        elif action == "reject":
            pick_state = "rejected"
            changed_families.add("pick_state")
        elif action == "hide":
            pick_state = "hidden"
            changed_families.add("pick_state")
        elif action == "tombstone":
            pick_state = "rejected"
            metadata_state = "blocked"
            rework_category = ""
            rework_comment = ""
            changed_families.update({"metadata", "pick_state", "tombstone"})
        elif action == "approve":
            pick_state = "picked"
            metadata_state = "approved"
            title, keywords = _metadata_values_from_payload(payload, title, keywords, keyword_blacklist)
            rework_category = ""
            rework_comment = ""
            changed_families.update({"pick_state", "metadata"})
        elif action == "metadata":
            title, keywords = _metadata_values_from_payload(payload, title, keywords, keyword_blacklist)
            metadata_state = str(payload.get("metadataState") or "proposed").strip().casefold()
            if metadata_state not in METADATA_STATES:
                raise ValueError("metadataState is invalid")
            if metadata_state == "rework":
                rework_category = _normalize_rework_category(payload.get("reworkCategory") or payload.get("rework_category"))
                rework_comment = str(payload.get("reworkComment") or payload.get("rework_comment") or "").strip()
            elif metadata_state != "blocked":
                rework_category = ""
                rework_comment = ""
            changed_families.add("metadata")
        elif action == "metadata-rework":
            metadata_state = "rework"
            title, keywords = _metadata_values_from_payload(payload, title, keywords, keyword_blacklist)
            rework_category = _normalize_rework_category(payload.get("reworkCategory") or payload.get("rework_category"))
            rework_comment = str(payload.get("reworkComment") or payload.get("rework_comment") or "").strip()
            if rework_comment and not rework_category:
                rework_category = "other"
            changed_families.add("metadata")
        else:
            raise ValueError("Unsupported Sidecar action")

        if pick_state not in PICK_STATES:
            raise ValueError("pickState is invalid")
        conn.execute(
            """
            UPDATE sidecar_decisions
            SET rating = ?, color = ?, pick_state = ?, metadata_state = ?,
                title = ?, keywords_json = ?, rework_category = ?, rework_comment = ?,
                last_action = ?, updated_at = ?
            WHERE asset_id = ?
            """,
            (
                rating,
                color,
                pick_state,
                metadata_state,
                title,
                _json_text(keywords),
                rework_category,
                rework_comment,
                action,
                now,
                asset_id,
            ),
        )
        if action == "restore":
            conn.execute(
                """
                UPDATE sidecar_tombstones
                SET tombstone_state = 'restored', updated_at = ?
                WHERE asset_id = ? AND tombstone_state = 'active'
                """,
                (now, asset_id),
            )
        elif action == "tombstone":
            conn.execute(
                """
                INSERT INTO sidecar_tombstones (asset_id, tombstone_state, reason, tombstoned_at, updated_at)
                VALUES (?, 'active', ?, ?, ?)
                ON CONFLICT(asset_id) DO UPDATE SET
                  tombstone_state = 'active',
                  reason = excluded.reason,
                  tombstoned_at = excluded.tombstoned_at,
                  updated_at = excluded.updated_at
                """,
                (asset_id, str(payload.get("reason") or "").strip(), now, now),
            )
        after = _current_decision(conn, asset_id)
        after["tombstoneState"] = _active_tombstone_state(conn, asset_id)
        for family in sorted(changed_families):
            _queue_pending_sync(conn, asset_id, family, before_for_sync, after, now)
        pending_sync_count = _pending_sync_count(conn, asset_id)
        after["pendingSyncCount"] = pending_sync_count
    return {
        "ok": True,
        "assetId": asset_id,
        "state": after,
        "changedFamilies": sorted(changed_families),
        "pendingSyncCount": pending_sync_count,
    }


def record_decisions(repo_root: Path, payloads: Iterable[dict[str, Any]]) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for payload in payloads:
        if not isinstance(payload, dict):
            raise ValueError("Each Sidecar decision must be a JSON object.")
        items.append(record_decision(repo_root, payload))
    return {"ok": True, "count": len(items), "items": items}


def summary(repo_root: Path) -> dict[str, Any]:
    with connect(repo_root) as conn:
        rows = conn.execute(
            """
            SELECT pick_state, metadata_state, count(*) AS total
            FROM sidecar_decisions
            GROUP BY pick_state, metadata_state
            """
        ).fetchall()
        pending_count = conn.execute(
            "SELECT count(*) AS total FROM sidecar_pending_sync WHERE status = 'pending'"
        ).fetchone()["total"]
        indexed_count = conn.execute("SELECT count(*) AS total FROM sidecar_assets").fetchone()["total"]
        tombstone_count = conn.execute(
            "SELECT count(*) AS total FROM sidecar_tombstones WHERE tombstone_state = 'active'"
        ).fetchone()["total"]
    return {
        "ok": True,
        "indexedCount": int(indexed_count or 0),
        "pendingSyncCount": int(pending_count or 0),
        "tombstoneCount": int(tombstone_count or 0),
        "states": [
            {
                "pickState": row["pick_state"],
                "metadataState": row["metadata_state"],
                "count": int(row["total"] or 0),
            }
            for row in rows
        ],
    }

def empty_wastebasket(repo_root: Path) -> dict[str, Any]:
    with connect(repo_root) as conn:
        rows = conn.execute(
            """
            SELECT d.asset_id
            FROM sidecar_decisions AS d
            WHERE d.pick_state IN ('rejected', 'hidden')
              AND NOT EXISTS (
                SELECT 1 FROM sidecar_tombstones AS t
                WHERE t.asset_id = d.asset_id AND t.tombstone_state = 'active'
              )
            ORDER BY d.updated_at, d.asset_id
            """
        ).fetchall()
    items = [
        record_decision(repo_root, {
            "assetId": row["asset_id"],
            "action": "tombstone",
            "reason": "empty wastebasket",
        })
        for row in rows
    ]
    return {"ok": True, "count": len(items), "items": items, "summary": summary(repo_root)}


def upload_plan(repo_root: Path, limit: int = 500) -> dict[str, Any]:
    safe_limit = max(1, min(int(limit or 500), 5000))
    with connect(repo_root) as conn:
        readiness = conn.execute(
            """
            SELECT
              COUNT(CASE WHEN d.pick_state = 'picked' THEN 1 END) AS picked_count,
              COUNT(CASE WHEN d.pick_state = 'picked' AND d.metadata_state = 'approved'
                AND NOT EXISTS (
                  SELECT 1 FROM sidecar_mock_uploads AS m
                  WHERE m.asset_id = d.asset_id AND m.mock_state = 'active'
                )
              THEN 1 END) AS approved_picked_count,
              COUNT(CASE WHEN d.pick_state = 'picked' AND d.metadata_state <> 'approved' THEN 1 END) AS picked_needs_review_count,
              COUNT(CASE WHEN d.pick_state = 'picked' AND d.metadata_state = 'unreviewed' THEN 1 END) AS picked_unreviewed_count,
              COUNT(CASE WHEN d.pick_state = 'picked' AND d.metadata_state = 'proposed' THEN 1 END) AS picked_proposed_count,
              COUNT(CASE WHEN d.pick_state = 'picked' AND d.metadata_state = 'rework' THEN 1 END) AS picked_rework_count,
              COUNT(CASE WHEN d.pick_state = 'picked' AND d.metadata_state = 'blocked' THEN 1 END) AS picked_blocked_count,
              COUNT(CASE WHEN d.pick_state = 'picked' AND d.metadata_state = 'approved'
                AND EXISTS (
                  SELECT 1 FROM sidecar_mock_uploads AS m
                  WHERE m.asset_id = d.asset_id AND m.mock_state = 'active'
                )
              THEN 1 END) AS mock_uploaded_count
            FROM sidecar_decisions AS d
            JOIN sidecar_assets AS a ON a.asset_id = d.asset_id
            WHERE NOT EXISTS (
              SELECT 1 FROM sidecar_tombstones AS t
              WHERE t.asset_id = d.asset_id AND t.tombstone_state = 'active'
            )
            """
        ).fetchone()
        rows = conn.execute(
            """
            SELECT a.*, d.rating, d.color, d.pick_state, d.metadata_state, d.title, d.keywords_json
            FROM sidecar_decisions AS d
            JOIN sidecar_assets AS a ON a.asset_id = d.asset_id
            WHERE d.pick_state = 'picked' AND d.metadata_state = 'approved'
              AND NOT EXISTS (
                SELECT 1 FROM sidecar_tombstones AS t
                WHERE t.asset_id = d.asset_id AND t.tombstone_state = 'active'
              )
              AND NOT EXISTS (
                SELECT 1 FROM sidecar_mock_uploads AS m
                WHERE m.asset_id = d.asset_id AND m.mock_state = 'active'
              )
            ORDER BY a.captured_at DESC, a.asset_id
            LIMIT ?
            """,
            (safe_limit,),
        ).fetchall()
    items = []
    for row in rows:
        items.append({
            "assetId": row["asset_id"],
            "sourceAnchor": row["source_anchor"],
            "filename": row["filename"] or "",
            "capturedAt": row["captured_at"] or "",
            "mediaType": row["media_type"] or "",
            "rating": int(row["rating"] or 0),
            "color": row["color"] or "",
            "title": row["title"] or "",
            "keywords": _read_json_text(row["keywords_json"], []),
            "eligibleReason": "picked and metadata approved",
        })
    return {
        "ok": True,
        "count": len(items),
        "items": items,
        "pickedCount": int(readiness["picked_count"] or 0),
        "approvedPickedCount": int(readiness["approved_picked_count"] or 0),
        "pickedNeedsReviewCount": int(readiness["picked_needs_review_count"] or 0),
        "pickedUnreviewedCount": int(readiness["picked_unreviewed_count"] or 0),
        "pickedProposedCount": int(readiness["picked_proposed_count"] or 0),
        "pickedReworkCount": int(readiness["picked_rework_count"] or 0),
        "pickedBlockedCount": int(readiness["picked_blocked_count"] or 0),
        "mockUploadedCount": int(readiness["mock_uploaded_count"] or 0),
    }


def _planned_r2_keys(row: sqlite3.Row) -> tuple[str, list[dict[str, str]]]:
    source_anchor = str(row["source_anchor"] or f"apple-photos://{row['asset_id']}")
    photo_id = photo_id_for_source_path(source_anchor)
    filename = str(row["filename"] or "")
    media_type = str(row["media_type"] or "").casefold()
    is_video = media_type == "video" or Path(filename).suffix.lower() in {".mov", ".mp4", ".m4v"}
    source_reference = filename or (f"{photo_id}.mp4" if is_video else f"{photo_id}.jpg")
    keys = [
        {
            "bucket": DEFAULT_PRIVATE_BUCKET,
            "key": private_master_key(DEFAULT_PRIVATE_PREFIX, photo_id, source_reference),
            "kind": "private-master",
        },
        {
            "bucket": DEFAULT_PUBLIC_BUCKET,
            "key": public_preview_key(DEFAULT_PUBLIC_PREFIX, photo_id, "gallery", "video" if is_video else "photo"),
            "kind": "public-preview",
        },
        {
            "bucket": DEFAULT_PUBLIC_BUCKET,
            "key": public_preview_key(DEFAULT_PUBLIC_PREFIX, photo_id, "detail", "video" if is_video else "photo"),
            "kind": "public-preview-video" if is_video else "public-preview",
        },
    ]
    if not is_video:
        keys.extend(
            {
                "bucket": DEFAULT_PRIVATE_BUCKET,
                "key": private_render_key(photo_id, product_id),
                "kind": "private-render",
            }
            for product_id in PRIVATE_RENDER_PRODUCTS
        )
    return photo_id, keys


def _current_r2_objects_for_plan(conn: sqlite3.Connection, planned_keys: list[dict[str, str]]) -> dict[tuple[str, str], dict[str, Any]]:
    if not planned_keys:
        return {}
    conditions = " OR ".join("(bucket = ? AND object_key = ?)" for _ in planned_keys)
    params: list[str] = []
    for item in planned_keys:
        params.extend([item["bucket"], item["key"]])
    try:
        rows = conn.execute(
            f"""
            SELECT bucket, object_key, photo_id, object_kind, lifecycle_state, bytes, last_seen_at
            FROM r2_objects
            WHERE lifecycle_state = 'current' AND ({conditions})
            """,
            params,
        ).fetchall()
    except sqlite3.OperationalError:
        return {}
    return {
        (str(row["bucket"] or ""), str(row["object_key"] or "")): {
            "photoId": str(row["photo_id"] or ""),
            "kind": str(row["object_kind"] or ""),
            "bytes": int(row["bytes"]) if row["bytes"] is not None else None,
            "lastSeenAt": str(row["last_seen_at"] or ""),
        }
        for row in rows
    }


def mock_upload(repo_root: Path, asset_ids: Iterable[str] | None = None, limit: int = 500) -> dict[str, Any]:
    safe_limit = max(1, min(int(limit or 500), 5000))
    requested_ids = [str(asset_id or "").strip() for asset_id in (asset_ids or []) if str(asset_id or "").strip()]
    now = now_iso()
    run_id = uuid.uuid4().hex
    with connect(repo_root) as conn:
        params: list[Any] = []
        asset_filter = ""
        if requested_ids:
            placeholders = ",".join("?" for _ in requested_ids)
            asset_filter = f"AND d.asset_id IN ({placeholders})"
            params.extend(requested_ids)
        params.append(safe_limit)
        rows = conn.execute(
            f"""
            SELECT a.asset_id, a.source_anchor, a.media_type, a.filename, a.captured_at
            FROM sidecar_decisions AS d
            JOIN sidecar_assets AS a ON a.asset_id = d.asset_id
            WHERE d.pick_state = 'picked' AND d.metadata_state = 'approved'
              {asset_filter}
              AND NOT EXISTS (
                SELECT 1 FROM sidecar_tombstones AS t
                WHERE t.asset_id = d.asset_id AND t.tombstone_state = 'active'
              )
              AND NOT EXISTS (
                SELECT 1 FROM sidecar_mock_uploads AS m
                WHERE m.asset_id = d.asset_id AND m.mock_state = 'active'
              )
            ORDER BY a.captured_at DESC, a.asset_id
            LIMIT ?
            """,
            params,
        ).fetchall()
        planned_key_sets: dict[str, list[dict[str, str]]] = {}
        photo_ids: dict[str, str] = {}
        all_planned_keys: list[dict[str, str]] = []
        for row in rows:
            photo_id, keys = _planned_r2_keys(row)
            photo_ids[str(row["asset_id"])] = photo_id
            planned_key_sets[str(row["asset_id"])] = keys
            all_planned_keys.extend(keys)
        current_r2 = _current_r2_objects_for_plan(conn, all_planned_keys)
        for row in rows:
            conn.execute(
                """
                INSERT INTO sidecar_mock_uploads (asset_id, mock_state, mock_run_id, uploaded_at, updated_at)
                VALUES (?, 'active', ?, ?, ?)
                ON CONFLICT(asset_id) DO UPDATE SET
                  mock_state = 'active',
                  mock_run_id = excluded.mock_run_id,
                  uploaded_at = excluded.uploaded_at,
                  updated_at = excluded.updated_at
                """,
                (row["asset_id"], run_id, now, now),
            )
    items = []
    collision_count = 0
    covered_key_count = 0
    for row in rows:
        asset_id = str(row["asset_id"])
        planned = []
        item_collision_count = 0
        for key in planned_key_sets.get(asset_id, []):
            current = current_r2.get((key["bucket"], key["key"]))
            exists = current is not None
            if exists:
                item_collision_count += 1
                covered_key_count += 1
            planned.append({
                **key,
                "exists": exists,
                **({"existing": current} if current else {}),
            })
        if item_collision_count:
            collision_count += 1
        items.append({
            "assetId": asset_id,
            "photoId": photo_ids.get(asset_id, ""),
            "filename": row["filename"] or "",
            "capturedAt": row["captured_at"] or "",
            "collisionCount": item_collision_count,
            "plannedKeys": planned,
        })
    return {
        "ok": True,
        "mockRunId": run_id,
        "mockUploadedCount": len(rows),
        "collisionCount": collision_count,
        "coveredKeyCount": covered_key_count,
        "items": items,
        "remainingPlan": upload_plan(repo_root, limit=safe_limit),
    }


def commit_plan(repo_root: Path, limit: int = 500) -> dict[str, Any]:
    safe_limit = max(1, min(int(limit or 500), 5000))
    with connect(repo_root) as conn:
        rows = conn.execute(
            """
            SELECT p.*, a.filename, a.captured_at
            FROM sidecar_pending_sync AS p
            LEFT JOIN sidecar_assets AS a ON a.asset_id = p.asset_id
            WHERE p.status = 'pending'
            ORDER BY p.created_at, p.sync_id
            LIMIT ?
            """,
            (safe_limit,),
        ).fetchall()
    items = []
    for row in rows:
        items.append({
            "syncId": row["sync_id"],
            "assetId": row["asset_id"],
            "fieldFamily": row["field_family"],
            "oldValue": _read_json_text(row["old_value_json"], {}),
            "newValue": _read_json_text(row["new_value_json"], {}),
            "filename": row["filename"] or "",
            "capturedAt": row["captured_at"] or "",
            "status": row["status"],
            "createdAt": row["created_at"] or "",
            "updatedAt": row["updated_at"] or "",
        })
    return {
        "ok": True,
        "count": len(items),
        "items": items,
        "writeBackImplemented": False,
        "message": "Sidecar write-back is staged. The next implementation slice will commit these pending PBE keywords/title changes to Apple Photos.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect Sidecar local workflow state.")
    parser.add_argument("--summary", action="store_true")
    parser.add_argument("--upload-plan", action="store_true")
    parser.add_argument("--mock-upload", action="store_true")
    parser.add_argument("--commit-plan", action="store_true")
    parser.add_argument("--empty-wastebasket", action="store_true")
    args = parser.parse_args()
    repo_root = Path.cwd()
    if args.empty_wastebasket:
        print(json.dumps(empty_wastebasket(repo_root), indent=2))
    elif args.mock_upload:
        print(json.dumps(mock_upload(repo_root), indent=2))
    elif args.upload_plan:
        print(json.dumps(upload_plan(repo_root), indent=2))
    elif args.commit_plan:
        print(json.dumps(commit_plan(repo_root), indent=2))
    else:
        print(json.dumps(summary(repo_root), indent=2))


if __name__ == "__main__":
    main()
