#!/usr/bin/env python3
"""SQLite-backed local Owner state with static JSON export compatibility."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import sqlite3
import uuid
from pathlib import Path
from typing import Any


DEFAULT_DB = Path("tmp/photo-state.sqlite")
OWNER_ACTION_ROOT = Path("assets/owner-actions")
COUNTRY_ASSIGNMENT_LOG = OWNER_ACTION_ROOT / "country-assignments.jsonl"
COUNTRY_ASSIGNMENT_INDEX = OWNER_ACTION_ROOT / "country-assignments.json"


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return fallback


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _db_path(repo_root: Path, db_path: Path | None = None) -> Path:
    path = db_path or DEFAULT_DB
    return path if path.is_absolute() else repo_root / path


def connect(repo_root: Path, db_path: Path | None = None) -> sqlite3.Connection:
    path = _db_path(repo_root, db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS owner_country_assignment_events (
          batch_id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          target_slug TEXT NOT NULL,
          action TEXT NOT NULL DEFAULT 'assign-country',
          moved_json TEXT NOT NULL DEFAULT '[]',
          skipped_json TEXT NOT NULL DEFAULT '[]',
          event_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS owner_country_assignments (
          photo_id TEXT PRIMARY KEY,
          gallery_key TEXT NOT NULL,
          state TEXT,
          from_state TEXT,
          from_slug TEXT,
          assigned_at TEXT NOT NULL,
          batch_id TEXT NOT NULL,
          assets_json TEXT NOT NULL DEFAULT '{}'
        );

        CREATE INDEX IF NOT EXISTS idx_owner_country_assignment_batch
          ON owner_country_assignments(batch_id);
        CREATE INDEX IF NOT EXISTS idx_owner_country_assignment_gallery
          ON owner_country_assignments(gallery_key);
        """
    )


def _assignment_from_moved(item: dict[str, Any], target_slug: str, created_at: str, batch_id: str) -> tuple[str, dict[str, Any]] | None:
    photo_id = str(item.get("id") or "").strip()
    if not photo_id:
        return None
    return photo_id, {
        "photo_id": photo_id,
        "gallery_key": str(item.get("to_slug") or target_slug),
        "state": str(item.get("to") or ""),
        "from_state": str(item.get("from") or ""),
        "from_slug": str(item.get("from_slug") or ""),
        "assigned_at": created_at,
        "batch_id": batch_id,
        "assets_json": json.dumps(item.get("assets") or {}, ensure_ascii=False, sort_keys=True),
    }


def import_country_assignments(repo_root: Path, conn: sqlite3.Connection | None = None, *, force: bool = False) -> None:
    owns_conn = conn is None
    conn = conn or connect(repo_root)
    try:
        if not force:
            existing = conn.execute("SELECT count(*) FROM owner_country_assignments").fetchone()[0]
            if existing:
                return

        if force:
            conn.execute("DELETE FROM owner_country_assignments")
            conn.execute("DELETE FROM owner_country_assignment_events")

        log_path = repo_root / COUNTRY_ASSIGNMENT_LOG
        if log_path.exists():
            with log_path.open(encoding="utf-8") as handle:
                for line in handle:
                    if not line.strip():
                        continue
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if not isinstance(event, dict):
                        continue
                    batch_id = str(event.get("batch_id") or "").strip()
                    created_at = str(event.get("created_at") or "").strip()
                    target_slug = str(event.get("target_slug") or "").strip()
                    if not batch_id or not created_at or not target_slug:
                        continue
                    moved = event.get("moved") if isinstance(event.get("moved"), list) else []
                    skipped = event.get("skipped") if isinstance(event.get("skipped"), list) else []
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO owner_country_assignment_events
                          (batch_id, created_at, target_slug, action, moved_json, skipped_json, event_json)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            batch_id,
                            created_at,
                            target_slug,
                            str(event.get("action") or "assign-country"),
                            json.dumps(moved, ensure_ascii=False, sort_keys=True),
                            json.dumps(skipped, ensure_ascii=False, sort_keys=True),
                            json.dumps(event, ensure_ascii=False, sort_keys=True),
                        ),
                    )
                    for item in moved:
                        if not isinstance(item, dict):
                            continue
                        assignment = _assignment_from_moved(item, target_slug, created_at, batch_id)
                        if not assignment:
                            continue
                        conn.execute(
                            """
                            INSERT OR REPLACE INTO owner_country_assignments
                              (photo_id, gallery_key, state, from_state, from_slug, assigned_at, batch_id, assets_json)
                            VALUES
                              (:photo_id, :gallery_key, :state, :from_state, :from_slug, :assigned_at, :batch_id, :assets_json)
                            """,
                            assignment[1],
                        )

        index = _read_json(repo_root / COUNTRY_ASSIGNMENT_INDEX, {})
        photos = index.get("photos") if isinstance(index, dict) else {}
        if isinstance(photos, dict):
            for photo_id, record in photos.items():
                if not isinstance(record, dict):
                    continue
                clean_id = str(photo_id or "").strip()
                gallery_key = str(record.get("gallery_key") or "").strip()
                assigned_at = str(record.get("assigned_at") or "").strip()
                batch_id = str(record.get("batch_id") or "").strip()
                if not clean_id or not gallery_key or not assigned_at or not batch_id:
                    continue
                conn.execute(
                    """
                    INSERT OR REPLACE INTO owner_country_assignments
                      (photo_id, gallery_key, state, from_state, from_slug, assigned_at, batch_id, assets_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        clean_id,
                        gallery_key,
                        str(record.get("state") or ""),
                        str(record.get("from_state") or ""),
                        str(record.get("from_slug") or ""),
                        assigned_at,
                        batch_id,
                        json.dumps(record.get("assets") or {}, ensure_ascii=False, sort_keys=True),
                    ),
                )
        conn.commit()
    finally:
        if owns_conn:
            conn.close()


def record_country_assignments(
    repo_root: Path,
    target_slug: str,
    moved: list[dict[str, Any]],
    skipped: list[dict[str, Any]],
    db_path: Path | None = None,
) -> dict[str, str]:
    if not moved and not skipped:
        return {}

    conn = connect(repo_root, db_path)
    try:
        import_country_assignments(repo_root, conn)
        created_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        batch_id = f"{created_at}-{uuid.uuid4().hex[:8]}"
        event = {
            "batch_id": batch_id,
            "created_at": created_at,
            "action": "assign-country",
            "target_slug": target_slug,
            "moved": moved,
            "skipped": skipped,
        }
        conn.execute(
            """
            INSERT INTO owner_country_assignment_events
              (batch_id, created_at, target_slug, action, moved_json, skipped_json, event_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                batch_id,
                created_at,
                target_slug,
                "assign-country",
                json.dumps(moved, ensure_ascii=False, sort_keys=True),
                json.dumps(skipped, ensure_ascii=False, sort_keys=True),
                json.dumps(event, ensure_ascii=False, sort_keys=True),
            ),
        )
        for item in moved:
            assignment = _assignment_from_moved(item, target_slug, created_at, batch_id)
            if not assignment:
                continue
            conn.execute(
                """
                INSERT OR REPLACE INTO owner_country_assignments
                  (photo_id, gallery_key, state, from_state, from_slug, assigned_at, batch_id, assets_json)
                VALUES
                  (:photo_id, :gallery_key, :state, :from_state, :from_slug, :assigned_at, :batch_id, :assets_json)
                """,
                assignment[1],
            )
        conn.commit()
        export_country_assignments(repo_root, conn)
    finally:
        conn.close()

    return {
        "log": COUNTRY_ASSIGNMENT_LOG.as_posix(),
        "index": COUNTRY_ASSIGNMENT_INDEX.as_posix(),
        "db": DEFAULT_DB.as_posix(),
        "batch_id": batch_id,
    }


def export_country_assignments(repo_root: Path, conn: sqlite3.Connection | None = None) -> None:
    owns_conn = conn is None
    conn = conn or connect(repo_root)
    try:
        events = conn.execute(
            """
            SELECT event_json
            FROM owner_country_assignment_events
            ORDER BY created_at, batch_id
            """
        ).fetchall()
        log_path = repo_root / COUNTRY_ASSIGNMENT_LOG
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("w", encoding="utf-8") as handle:
            for row in events:
                handle.write(json.dumps(json.loads(row["event_json"]), ensure_ascii=False, sort_keys=True) + "\n")

        rows = conn.execute(
            """
            SELECT *
            FROM owner_country_assignments
            ORDER BY assigned_at, photo_id
            """
        ).fetchall()
        photos: dict[str, Any] = {}
        latest_batch_id = ""
        updated_at = ""
        for row in rows:
            latest_batch_id = row["batch_id"] or latest_batch_id
            updated_at = row["assigned_at"] or updated_at
            photos[row["photo_id"]] = {
                "gallery_key": row["gallery_key"],
                "state": row["state"],
                "from_state": row["from_state"],
                "from_slug": row["from_slug"],
                "assigned_at": row["assigned_at"],
                "batch_id": row["batch_id"],
                "assets": json.loads(row["assets_json"] or "{}"),
            }
        _write_json(repo_root / COUNTRY_ASSIGNMENT_INDEX, {
            "format": "photosbyelie-country-assignments",
            "updated_at": updated_at,
            "latest_batch_id": latest_batch_id,
            "photos": photos,
        })
    finally:
        if owns_conn:
            conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--import-country-assignments", action="store_true")
    parser.add_argument("--export-country-assignments", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    repo_root = args.repo_root.resolve()
    conn = connect(repo_root, args.db)
    try:
        if args.import_country_assignments:
            import_country_assignments(repo_root, conn, force=args.force)
        if args.export_country_assignments:
            export_country_assignments(repo_root, conn)
        count = conn.execute("SELECT count(*) FROM owner_country_assignments").fetchone()[0]
    finally:
        conn.close()
    print(f"Owner country assignments in SQLite: {count}")


if __name__ == "__main__":
    main()
