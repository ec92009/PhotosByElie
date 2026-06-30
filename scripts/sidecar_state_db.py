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


DEFAULT_DB = Path("assets/owner-actions/Owner.sqlite")
RATING_VALUES = {0, 1, 2, 3, 4, 5}
COLOR_VALUES = {"", "red", "yellow", "green", "blue", "purple"}
PICK_STATES = {"undecided", "picked", "rejected", "hidden"}
METADATA_STATES = {"unreviewed", "proposed", "approved", "rework", "blocked"}


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
        """
    )


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
        rating = before["rating"]
        color = before["color"]
        pick_state = before["pickState"]
        metadata_state = before["metadataState"]
        title = before["title"]
        keywords = before["keywords"]
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
            changed_families.update({"metadata", "pick_state", "tombstone"})
        elif action == "approve":
            pick_state = "picked"
            metadata_state = "approved"
            changed_families.update({"pick_state", "metadata"})
        elif action == "metadata":
            title = str(payload.get("title") or "").strip()
            raw_keywords = payload.get("keywords") or []
            if isinstance(raw_keywords, str):
                raw_keywords = [part.strip() for part in raw_keywords.replace(";", ",").split(",")]
            keywords = [str(keyword).strip() for keyword in raw_keywords if str(keyword).strip()]
            metadata_state = str(payload.get("metadataState") or "proposed").strip().casefold()
            if metadata_state not in METADATA_STATES:
                raise ValueError("metadataState is invalid")
            changed_families.add("metadata")
        elif action == "metadata-rework":
            metadata_state = "rework"
            changed_families.add("metadata")
        else:
            raise ValueError("Unsupported Sidecar action")

        if pick_state not in PICK_STATES:
            raise ValueError("pickState is invalid")
        conn.execute(
            """
            UPDATE sidecar_decisions
            SET rating = ?, color = ?, pick_state = ?, metadata_state = ?,
                title = ?, keywords_json = ?, last_action = ?, updated_at = ?
            WHERE asset_id = ?
            """,
            (rating, color, pick_state, metadata_state, title, _json_text(keywords), action, now, asset_id),
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
        if action == "tombstone":
            after["tombstoneState"] = "active"
        for family in sorted(changed_families):
            _queue_pending_sync(conn, asset_id, family, before, after, now)
    return {"ok": True, "assetId": asset_id, "state": after, "changedFamilies": sorted(changed_families)}


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
    return {"ok": True, "count": len(items), "items": items}


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
    parser.add_argument("--commit-plan", action="store_true")
    parser.add_argument("--empty-wastebasket", action="store_true")
    args = parser.parse_args()
    repo_root = Path.cwd()
    if args.empty_wastebasket:
        print(json.dumps(empty_wastebasket(repo_root), indent=2))
    elif args.upload_plan:
        print(json.dumps(upload_plan(repo_root), indent=2))
    elif args.commit_plan:
        print(json.dumps(commit_plan(repo_root), indent=2))
    else:
        print(json.dumps(summary(repo_root), indent=2))


if __name__ == "__main__":
    main()
