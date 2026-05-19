#!/usr/bin/env python3
"""SQLite-backed local Owner state with JSON compatibility exports."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import sqlite3
import uuid
from pathlib import Path
from typing import Any, Iterable


DEFAULT_DB = Path("assets/owner-actions/Owner.sqlite")
OWNER_ACTION_ROOT = Path("assets/owner-actions")
KEYWORD_BLACKLIST_PATH = OWNER_ACTION_ROOT / "keyword-blacklist.json"
COUNTRY_ASSIGNMENT_LOG = OWNER_ACTION_ROOT / "country-assignments.jsonl"
COUNTRY_ASSIGNMENT_INDEX = OWNER_ACTION_ROOT / "country-assignments.json"
TITLE_KEYWORD_REVIEW_ROOT = OWNER_ACTION_ROOT / "title-keyword-review-queue"
DISCARDED_MEDIA_MANIFEST_PATH = Path("assets/discarded-media-manifest.json")
TITLE_KEYWORDS_PROPOSED_FLAG = "Title_Keywords_Proposed"
TITLE_KEYWORDS_REJECTED_FLAG = "Title_Keywords_Rejected"
TITLE_KEYWORDS_PARKED_FLAG = "Title_Keywords_Parked"
TITLE_KEYWORDS_REVIEWED_FLAG = "Title_Keywords_Reviewed"
TITLE_KEYWORD_PARK_REJECTED_COUNT = 10


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return fallback


def _read_json_text(value: str, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _split_keyword_text(value: Any) -> list[str]:
    if isinstance(value, list):
        keywords: list[str] = []
        for item in value:
            keywords.extend(_split_keyword_text(item))
        return keywords
    return [part.strip() for part in str(value or "").replace(";", ",").split(",") if part.strip()]


def _db_path(repo_root: Path, db_path: Path | None = None) -> Path:
    path = db_path or DEFAULT_DB
    return path if path.is_absolute() else repo_root / path


def connect(repo_root: Path, db_path: Path | None = None) -> sqlite3.Connection:
    path = _db_path(repo_root, db_path)
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

        CREATE TABLE IF NOT EXISTS owner_settings (
          setting_key   TEXT PRIMARY KEY,
          setting_value TEXT NOT NULL,
          updated_at    TEXT
        ) WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS keyword_blacklist (
          keyword    TEXT PRIMARY KEY CHECK (trim(keyword) <> ''),
          reason     TEXT,
          created_at TEXT,
          updated_at TEXT
        ) WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS country_assignments (
          media_id      TEXT PRIMARY KEY,
          country_slug  TEXT NOT NULL CHECK (trim(country_slug) <> ''),
          source_slug   TEXT,
          batch_id      TEXT,
          assigned_at   TEXT,
          updated_at    TEXT
        ) WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS title_keyword_batches (
          batch_id             TEXT PRIMARY KEY,
          generated_at         TEXT NOT NULL,
          total_count          INTEGER NOT NULL CHECK (total_count >= 0),
          ordinary_new_count   INTEGER NOT NULL CHECK (ordinary_new_count >= 0),
          rework_count         INTEGER NOT NULL CHECK (rework_count >= 0),
          parked_count         INTEGER NOT NULL DEFAULT 0 CHECK (parked_count >= 0),
          ordinary_new_limit   INTEGER CHECK (ordinary_new_limit IS NULL OR ordinary_new_limit >= 0),
          candidate_count      INTEGER CHECK (candidate_count IS NULL OR candidate_count >= 0),
          newest_capture_at    TEXT,
          oldest_capture_at    TEXT,
          notes                TEXT
        ) WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS title_keyword_queue (
          media_id                 TEXT PRIMARY KEY,
          review_state             TEXT NOT NULL CHECK (review_state IN ('proposed', 'approved', 'applied', 'rejected', 'parked', 'blocked')),
          latest_attempt           INTEGER NOT NULL CHECK (latest_attempt > 0),
          first_proposed_batch_id  TEXT,
          latest_proposed_batch_id TEXT,
          first_proposed_at        TEXT,
          latest_proposed_at       TEXT,
          reviewed_at              TEXT,
          applied_at               TEXT,
          rework_priority          INTEGER NOT NULL DEFAULT 0 CHECK (rework_priority IN (0, 1)),
          rejected_count           INTEGER NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
          owner_comment            TEXT,
          updated_at               TEXT,
          FOREIGN KEY (first_proposed_batch_id) REFERENCES title_keyword_batches(batch_id),
          FOREIGN KEY (latest_proposed_batch_id) REFERENCES title_keyword_batches(batch_id)
        ) WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS title_keyword_proposals (
          media_id             TEXT NOT NULL,
          attempt              INTEGER NOT NULL CHECK (attempt > 0),
          batch_id             TEXT NOT NULL,
          previous_title       TEXT,
          previous_keywords    TEXT,
          proposed_title       TEXT,
          proposed_keywords    TEXT,
          proposal_status      TEXT,
          confidence           TEXT CHECK (confidence IS NULL OR confidence IN ('low', 'medium', 'high')),
          needs_owner_context  INTEGER NOT NULL DEFAULT 0 CHECK (needs_owner_context IN (0, 1)),
          proposal_reason      TEXT,
          removed_blacklisted  TEXT,
          keyword_target       INTEGER CHECK (keyword_target IS NULL OR keyword_target >= 0),
          keyword_target_met   INTEGER CHECK (keyword_target_met IS NULL OR keyword_target_met IN (0, 1)),
          generator_model      TEXT,
          generator_model_level INTEGER,
          generator_model_maxed INTEGER NOT NULL DEFAULT 0,
          model_ladder         TEXT,
          proposed_at          TEXT NOT NULL,
          PRIMARY KEY (media_id, attempt),
          FOREIGN KEY (batch_id) REFERENCES title_keyword_batches(batch_id)
        ) WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS title_keyword_decisions (
          media_id          TEXT NOT NULL,
          attempt           INTEGER NOT NULL CHECK (attempt > 0),
          decision_state    TEXT NOT NULL CHECK (decision_state IN ('accepted', 'rejected', 'parked', 'blocked', 'not_found')),
          decided_title     TEXT,
          decided_keywords  TEXT,
          owner_comment     TEXT,
          decided_at        TEXT NOT NULL,
          applied_at        TEXT,
          PRIMARY KEY (media_id, attempt),
          FOREIGN KEY (media_id, attempt) REFERENCES title_keyword_proposals(media_id, attempt) ON DELETE CASCADE
        ) WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS r2_objects (
          bucket                TEXT NOT NULL,
          object_key            TEXT NOT NULL,
          photo_id              TEXT,
          object_kind           TEXT,
          lifecycle_state       TEXT NOT NULL CHECK (lifecycle_state IN ('current', 'marked_for_delete', 'deleted_confirmed')),
          first_seen_at         TEXT,
          last_seen_at          TEXT,
          marked_for_delete_at  TEXT,
          deleted_confirmed_at  TEXT,
          last_checked_at       TEXT,
          source                TEXT,
          bytes                 INTEGER CHECK (bytes IS NULL OR bytes >= 0),
          updated_at            TEXT,
          PRIMARY KEY (bucket, object_key)
        ) WITHOUT ROWID;

        CREATE INDEX IF NOT EXISTS idx_title_keyword_batches_generated_at ON title_keyword_batches(generated_at);
        CREATE INDEX IF NOT EXISTS idx_title_keyword_queue_state_priority ON title_keyword_queue(review_state, rework_priority, latest_proposed_at);
        CREATE INDEX IF NOT EXISTS idx_title_keyword_queue_latest_batch ON title_keyword_queue(latest_proposed_batch_id, review_state);
        CREATE INDEX IF NOT EXISTS idx_title_keyword_queue_first_batch ON title_keyword_queue(first_proposed_batch_id);
        CREATE INDEX IF NOT EXISTS idx_title_keyword_queue_reviewed_at ON title_keyword_queue(reviewed_at);
        CREATE INDEX IF NOT EXISTS idx_title_keyword_queue_applied_at ON title_keyword_queue(applied_at);
        CREATE INDEX IF NOT EXISTS idx_title_keyword_proposals_batch ON title_keyword_proposals(batch_id, proposed_at);
        CREATE INDEX IF NOT EXISTS idx_title_keyword_proposals_confidence_context ON title_keyword_proposals(confidence, needs_owner_context);
        CREATE INDEX IF NOT EXISTS idx_title_keyword_proposals_status ON title_keyword_proposals(proposal_status, proposed_at);
        CREATE INDEX IF NOT EXISTS idx_title_keyword_decisions_state_time ON title_keyword_decisions(decision_state, decided_at);
        CREATE INDEX IF NOT EXISTS idx_title_keyword_decisions_applied_at ON title_keyword_decisions(applied_at);
        CREATE INDEX IF NOT EXISTS idx_country_assignments_country ON country_assignments(country_slug, media_id);
        CREATE INDEX IF NOT EXISTS idx_country_assignments_batch ON country_assignments(batch_id);
        CREATE INDEX IF NOT EXISTS idx_keyword_blacklist_updated_at ON keyword_blacklist(updated_at);
        CREATE INDEX IF NOT EXISTS idx_r2_objects_state_bucket ON r2_objects(lifecycle_state, bucket);
        CREATE INDEX IF NOT EXISTS idx_r2_objects_photo ON r2_objects(photo_id, lifecycle_state);
        """
    )
    for column, ddl in {
        "generator_model": "ALTER TABLE title_keyword_proposals ADD COLUMN generator_model TEXT",
        "generator_model_level": "ALTER TABLE title_keyword_proposals ADD COLUMN generator_model_level INTEGER",
        "generator_model_maxed": "ALTER TABLE title_keyword_proposals ADD COLUMN generator_model_maxed INTEGER NOT NULL DEFAULT 0",
        "model_ladder": "ALTER TABLE title_keyword_proposals ADD COLUMN model_ladder TEXT",
    }.items():
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(title_keyword_proposals)")}
        if column not in existing:
            conn.execute(ddl)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_title_keyword_proposals_generator_model ON title_keyword_proposals(generator_model, generator_model_level)"
    )


def _keywords_text(value: Any) -> str:
    if isinstance(value, list):
        return ", ".join(str(item).strip() for item in value if str(item).strip())
    return str(value or "").strip()


def _normalized_keywords(value: Any) -> list[str]:
    source = value if isinstance(value, list) else str(value or "").replace(";", ",").split(",")
    seen: set[str] = set()
    keywords: list[str] = []
    for item in source:
        keyword = str(item or "").strip()
        key = keyword.casefold()
        if not keyword or key in seen:
            continue
        seen.add(key)
        keywords.append(keyword)
    return keywords


def _truthy(value: Any) -> int:
    return 1 if value is True or str(value).strip().lower() in {"1", "true", "yes"} else 0


def _optional_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _photo_id_from_r2_key(object_key: str) -> str:
    value = str(object_key or "")
    if value.startswith("RE/"):
        name = Path(value).stem
        return name.removesuffix("_900").removesuffix("_1800")
    if value.startswith("expo/"):
        return value.split("/", 1)[1].rsplit("_", 1)[0]
    if value.startswith("masters/"):
        rest = value.removeprefix("masters/")
        return rest.split("/", 1)[0] if "/" in rest else rest.rsplit(".", 1)[0]
    if value.startswith("renders/"):
        rest = value.removeprefix("renders/")
        return rest.split("/", 1)[0] if "/" in rest else rest.rsplit("_", 1)[0]
    return ""


def _r2_object_kind(bucket: str, object_key: str) -> str:
    key = str(object_key or "")
    if key.startswith("RE/") and "/masters/" in key:
        return "real-estate-master"
    if key.startswith("RE/") and "/previews/" in key:
        return "real-estate-preview"
    if key.startswith("expo/") and key.endswith(".mp4"):
        return "public-preview-video"
    if key.startswith("expo/"):
        return "public-preview"
    if key.startswith("masters/"):
        return "private-master"
    if key.startswith("renders/"):
        return "private-render"
    return "unknown"


def backfill_r2_object_metadata(conn: sqlite3.Connection) -> int:
    """Infer photo id/object kind for older R2 rows that were recorded before metadata existed."""
    rows = conn.execute(
        """
        SELECT bucket, object_key, photo_id, object_kind
        FROM r2_objects
        WHERE COALESCE(photo_id, '') = ''
           OR COALESCE(object_kind, '') = ''
           OR object_kind = 'unknown'
        """
    ).fetchall()
    updated = 0
    for row in rows:
        photo_id = str(row["photo_id"] or "") or _photo_id_from_r2_key(str(row["object_key"] or ""))
        existing_kind = str(row["object_kind"] or "")
        object_kind = "" if existing_kind == "unknown" else existing_kind
        object_kind = object_kind or _r2_object_kind(str(row["bucket"] or ""), str(row["object_key"] or ""))
        if not photo_id and not object_kind:
            continue
        conn.execute(
            """
            UPDATE r2_objects
            SET photo_id = COALESCE(NULLIF(?, ''), photo_id),
                object_kind = CASE
                  WHEN COALESCE(NULLIF(?, ''), '') <> '' AND COALESCE(object_kind, '') IN ('', 'unknown') THEN ?
                  ELSE object_kind
                END,
                updated_at = ?
            WHERE bucket = ? AND object_key = ?
            """,
            (photo_id, object_kind, object_kind, now_iso(), row["bucket"], row["object_key"]),
        )
        updated += 1
    return updated


def _set_setting(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        """
        INSERT INTO owner_settings (setting_key, setting_value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(setting_key) DO UPDATE SET
          setting_value = excluded.setting_value,
          updated_at = excluded.updated_at
        """,
        (key, value, now_iso()),
    )


def import_keyword_blacklist(repo_root: Path, conn: sqlite3.Connection | None = None, *, force: bool = False) -> None:
    owns_conn = conn is None
    conn = conn or connect(repo_root)
    try:
        if force:
            conn.execute("DELETE FROM keyword_blacklist")
        elif conn.execute("SELECT count(*) FROM keyword_blacklist").fetchone()[0]:
            return
        payload = _read_json(repo_root / KEYWORD_BLACKLIST_PATH, {})
        updated_at = str(payload.get("updated_at") or now_iso()) if isinstance(payload, dict) else now_iso()
        for keyword in _normalized_keywords(payload.get("keywords") if isinstance(payload, dict) else []):
            conn.execute(
                """
                INSERT INTO keyword_blacklist (keyword, reason, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(keyword) DO UPDATE SET updated_at = excluded.updated_at
                """,
                (keyword, "owner metadata blacklist", updated_at, updated_at),
            )
        _set_setting(conn, "keyword_blacklist_json", KEYWORD_BLACKLIST_PATH.as_posix())
        conn.commit()
    finally:
        if owns_conn:
            conn.close()


def keyword_blacklist_terms(repo_root: Path, db_path: Path | None = None, conn: sqlite3.Connection | None = None) -> list[str]:
    owns_conn = conn is None
    conn = conn or connect(repo_root, db_path)
    try:
        rows = conn.execute("SELECT keyword FROM keyword_blacklist ORDER BY keyword COLLATE NOCASE").fetchall()
        return [str(row["keyword"]) for row in rows]
    finally:
        if owns_conn:
            conn.close()


def export_keyword_blacklist(repo_root: Path, conn: sqlite3.Connection | None = None) -> None:
    owns_conn = conn is None
    conn = conn or connect(repo_root)
    try:
        rows = conn.execute("SELECT keyword FROM keyword_blacklist ORDER BY keyword COLLATE NOCASE").fetchall()
        keywords = [str(row["keyword"]) for row in rows]
        updated = conn.execute("SELECT max(updated_at) FROM keyword_blacklist").fetchone()[0] or now_iso()
        _write_json(repo_root / KEYWORD_BLACKLIST_PATH, {
            "format": "photosbyelie-keyword-blacklist",
            "schema_version": 1,
            "updated_at": str(updated),
            "keywords": keywords,
        })
    finally:
        if owns_conn:
            conn.close()


def record_keyword_blacklist(repo_root: Path, keywords: Iterable[str], db_path: Path | None = None) -> dict[str, Any]:
    conn = connect(repo_root, db_path)
    try:
        updated_at = now_iso()
        normalized = _normalized_keywords(list(keywords))
        conn.execute("DELETE FROM keyword_blacklist")
        for keyword in normalized:
            conn.execute(
                "INSERT INTO keyword_blacklist (keyword, reason, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (keyword, "owner metadata blacklist", updated_at, updated_at),
            )
        _set_setting(conn, "keyword_blacklist_json", KEYWORD_BLACKLIST_PATH.as_posix())
        conn.commit()
        export_keyword_blacklist(repo_root, conn)
        return {"db": (db_path or DEFAULT_DB).as_posix(), "keyword_count": len(normalized)}
    finally:
        conn.close()


def _assignment_row(photo_id: str, record: dict[str, Any], fallback_batch_id: str = "", fallback_at: str = "") -> tuple[Any, ...] | None:
    clean_id = str(photo_id or record.get("id") or record.get("photo_id") or "").strip()
    country_slug = str(record.get("gallery_key") or record.get("country_slug") or record.get("to_slug") or "").strip()
    if not clean_id or not country_slug:
        return None
    assigned_at = str(record.get("assigned_at") or fallback_at or now_iso()).strip()
    batch_id = str(record.get("batch_id") or fallback_batch_id or "").strip()
    return (
        clean_id,
        country_slug,
        str(record.get("from_slug") or record.get("source_slug") or "").strip(),
        batch_id,
        assigned_at,
        now_iso(),
    )


def import_country_assignments(repo_root: Path, conn: sqlite3.Connection | None = None, *, force: bool = False) -> None:
    owns_conn = conn is None
    conn = conn or connect(repo_root)
    try:
        if force:
            conn.execute("DELETE FROM country_assignments")
        elif conn.execute("SELECT count(*) FROM country_assignments").fetchone()[0]:
            return

        index = _read_json(repo_root / COUNTRY_ASSIGNMENT_INDEX, {})
        photos = index.get("photos") if isinstance(index, dict) else {}
        if isinstance(photos, dict):
            for photo_id, record in photos.items():
                if not isinstance(record, dict):
                    continue
                row = _assignment_row(photo_id, record)
                if row:
                    conn.execute(
                        """
                        INSERT OR REPLACE INTO country_assignments
                          (media_id, country_slug, source_slug, batch_id, assigned_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        row,
                    )

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
                    batch_id = str(event.get("batch_id") or "").strip()
                    created_at = str(event.get("created_at") or "").strip()
                    for item in event.get("moved") or []:
                        if not isinstance(item, dict):
                            continue
                        row = _assignment_row(str(item.get("id") or ""), item, batch_id, created_at)
                        if row:
                            conn.execute(
                                """
                                INSERT OR REPLACE INTO country_assignments
                                  (media_id, country_slug, source_slug, batch_id, assigned_at, updated_at)
                                VALUES (?, ?, ?, ?, ?, ?)
                                """,
                                row,
                            )
        _set_setting(conn, "country_assignments_json", COUNTRY_ASSIGNMENT_INDEX.as_posix())
        conn.commit()
    finally:
        if owns_conn:
            conn.close()


def export_country_assignments(repo_root: Path, conn: sqlite3.Connection | None = None) -> None:
    owns_conn = conn is None
    conn = conn or connect(repo_root)
    try:
        rows = conn.execute(
            """
            SELECT *
            FROM country_assignments
            ORDER BY assigned_at, media_id
            """
        ).fetchall()
        photos: dict[str, Any] = {}
        latest_batch_id = ""
        updated_at = ""
        for row in rows:
            latest_batch_id = row["batch_id"] or latest_batch_id
            updated_at = row["assigned_at"] or updated_at
            photos[row["media_id"]] = {
                "gallery_key": row["country_slug"],
                "state": "reserve",
                "from_state": "reserve",
                "from_slug": row["source_slug"] or "",
                "assigned_at": row["assigned_at"],
                "batch_id": row["batch_id"],
                "assets": {},
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
    created_at = now_iso()
    batch_id = f"{created_at}-{uuid.uuid4().hex[:8]}"
    event = {
        "batch_id": batch_id,
        "created_at": created_at,
        "action": "assign-country",
        "target_slug": target_slug,
        "moved": moved,
        "skipped": skipped,
    }
    try:
        import_country_assignments(repo_root, conn)
        for item in moved:
            if not isinstance(item, dict):
                continue
            row = _assignment_row(str(item.get("id") or ""), {**item, "gallery_key": item.get("to_slug") or target_slug}, batch_id, created_at)
            if row:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO country_assignments
                      (media_id, country_slug, source_slug, batch_id, assigned_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    row,
                )
        _set_setting(conn, "country_assignments_json", COUNTRY_ASSIGNMENT_INDEX.as_posix())
        conn.commit()
        export_country_assignments(repo_root, conn)
    finally:
        conn.close()

    log_path = repo_root / COUNTRY_ASSIGNMENT_LOG
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(event, ensure_ascii=False, sort_keys=True) + "\n")

    return {
        "log": COUNTRY_ASSIGNMENT_LOG.as_posix(),
        "index": COUNTRY_ASSIGNMENT_INDEX.as_posix(),
        "db": (db_path or DEFAULT_DB).as_posix(),
        "batch_id": batch_id,
    }


def _batch_files(repo_root: Path) -> list[Path]:
    root = repo_root / TITLE_KEYWORD_REVIEW_ROOT
    if not root.exists():
        return []
    return sorted(root.glob("batch-*.json"))


def _approval_files(repo_root: Path) -> list[Path]:
    root = repo_root / TITLE_KEYWORD_REVIEW_ROOT
    if not root.exists():
        return []
    return sorted(root.glob("approvals-*.json"))


def _upsert_batch(conn: sqlite3.Connection, payload: dict[str, Any], notes: str = "") -> None:
    batch_id = str(payload.get("batch_id") or "").strip()
    if not batch_id:
        return
    selection = payload.get("selection") if isinstance(payload.get("selection"), dict) else {}
    range_info = payload.get("range") if isinstance(payload.get("range"), dict) else {}
    generated_at = str(payload.get("generated_at") or now_iso())
    conn.execute(
        """
        INSERT INTO title_keyword_batches (
          batch_id, generated_at, total_count, ordinary_new_count, rework_count,
          parked_count, ordinary_new_limit, candidate_count, newest_capture_at,
          oldest_capture_at, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(batch_id) DO UPDATE SET
          generated_at = excluded.generated_at,
          total_count = excluded.total_count,
          ordinary_new_count = excluded.ordinary_new_count,
          rework_count = excluded.rework_count,
          parked_count = excluded.parked_count,
          ordinary_new_limit = excluded.ordinary_new_limit,
          candidate_count = excluded.candidate_count,
          newest_capture_at = excluded.newest_capture_at,
          oldest_capture_at = excluded.oldest_capture_at,
          notes = excluded.notes
        """,
        (
            batch_id,
            generated_at,
            int(selection.get("total_count") or len(payload.get("photos") or []) or 0),
            int(selection.get("ordinary_new_count") or 0),
            int(selection.get("rework_count") or 0),
            int(selection.get("parked_count") or 0),
            selection.get("ordinary_new_limit") or payload.get("ordinary_new_limit") or payload.get("limit"),
            selection.get("candidate_count"),
            range_info.get("newest") or "",
            range_info.get("oldest") or "",
            notes,
        ),
    )


def _latest_attempt(conn: sqlite3.Connection, media_id: str, batch_id: str = "") -> int:
    if batch_id:
        row = conn.execute(
            "SELECT max(attempt) FROM title_keyword_proposals WHERE media_id = ? AND batch_id = ?",
            (media_id, batch_id),
        ).fetchone()
        if row and row[0]:
            return int(row[0])
    row = conn.execute("SELECT max(attempt) FROM title_keyword_proposals WHERE media_id = ?", (media_id,)).fetchone()
    if row and row[0]:
        return int(row[0])
    queue = conn.execute("SELECT latest_attempt FROM title_keyword_queue WHERE media_id = ?", (media_id,)).fetchone()
    return int(queue["latest_attempt"]) if queue else 1


def _ensure_placeholder_proposal(conn: sqlite3.Connection, media_id: str, attempt: int, batch_id: str, proposed_at: str) -> None:
    if batch_id and not conn.execute("SELECT 1 FROM title_keyword_batches WHERE batch_id = ?", (batch_id,)).fetchone():
        _upsert_batch(conn, {"batch_id": batch_id, "generated_at": proposed_at, "selection": {"total_count": 0}}, "placeholder")
    existing = conn.execute(
        "SELECT 1 FROM title_keyword_proposals WHERE media_id = ? AND attempt = ?",
        (media_id, attempt),
    ).fetchone()
    if existing:
        return
    conn.execute(
        """
        INSERT INTO title_keyword_proposals
          (media_id, attempt, batch_id, previous_title, previous_keywords, proposed_title,
           proposed_keywords, proposal_status, confidence, needs_owner_context,
           proposal_reason, removed_blacklisted, keyword_target, keyword_target_met,
           generator_model, generator_model_level, generator_model_maxed, model_ladder,
           proposed_at)
        VALUES (?, ?, ?, '', '', '', '', 'compatibility-placeholder', 'low', 1, '', '[]', NULL, NULL,
                'legacy-json-import', NULL, 0, '[]', ?)
        """,
        (media_id, attempt, batch_id, proposed_at),
    )


def _upsert_queue(
    conn: sqlite3.Connection,
    *,
    media_id: str,
    review_state: str,
    latest_attempt: int,
    batch_id: str = "",
    proposed_at: str = "",
    reviewed_at: str = "",
    applied_at: str = "",
    rework_priority: bool = False,
    rejected_count: int = 0,
    owner_comment: str = "",
) -> None:
    existing = conn.execute("SELECT * FROM title_keyword_queue WHERE media_id = ?", (media_id,)).fetchone()
    first_batch = existing["first_proposed_batch_id"] if existing else batch_id
    first_at = existing["first_proposed_at"] if existing else proposed_at
    conn.execute(
        """
        INSERT INTO title_keyword_queue (
          media_id, review_state, latest_attempt, first_proposed_batch_id,
          latest_proposed_batch_id, first_proposed_at, latest_proposed_at,
          reviewed_at, applied_at, rework_priority, rejected_count,
          owner_comment, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(media_id) DO UPDATE SET
          review_state = CASE
            WHEN title_keyword_queue.review_state = 'parked' AND excluded.review_state = 'rejected' THEN 'parked'
            ELSE excluded.review_state
          END,
          latest_attempt = max(title_keyword_queue.latest_attempt, excluded.latest_attempt),
          latest_proposed_batch_id = COALESCE(NULLIF(excluded.latest_proposed_batch_id, ''), title_keyword_queue.latest_proposed_batch_id),
          latest_proposed_at = COALESCE(NULLIF(excluded.latest_proposed_at, ''), title_keyword_queue.latest_proposed_at),
          reviewed_at = COALESCE(NULLIF(excluded.reviewed_at, ''), title_keyword_queue.reviewed_at),
          applied_at = COALESCE(NULLIF(excluded.applied_at, ''), title_keyword_queue.applied_at),
          rework_priority = CASE
            WHEN title_keyword_queue.review_state = 'parked' AND excluded.review_state = 'rejected' THEN 0
            ELSE excluded.rework_priority
          END,
          rejected_count = max(title_keyword_queue.rejected_count, excluded.rejected_count),
          owner_comment = COALESCE(NULLIF(excluded.owner_comment, ''), title_keyword_queue.owner_comment),
          updated_at = excluded.updated_at
        """,
        (
            media_id,
            review_state,
            max(1, int(latest_attempt or 1)),
            first_batch or "",
            batch_id or "",
            first_at or "",
            proposed_at or "",
            reviewed_at or "",
            applied_at or "",
            1 if rework_priority else 0,
            max(0, int(rejected_count or 0)),
            owner_comment or "",
            now_iso(),
        ),
    )


def park_retry_exhausted_title_keywords(conn: sqlite3.Connection) -> int:
    """Move retry-exhausted title/keyword rows out of the active rework queue."""
    result = conn.execute(
        """
        UPDATE title_keyword_queue
        SET review_state = 'parked',
            rework_priority = 0,
            updated_at = ?
        WHERE review_state = 'rejected'
          AND rejected_count >= ?
        """,
        (now_iso(), TITLE_KEYWORD_PARK_REJECTED_COUNT),
    )
    return int(result.rowcount or 0)


def park_twice_rejected_title_keywords(conn: sqlite3.Connection) -> int:
    """Compatibility wrapper for the older CLI flag name."""
    return park_retry_exhausted_title_keywords(conn)


def _title_keyword_state_tags(review_state: str, rework_priority: bool = False) -> list[str]:
    if review_state in {"approved", "applied"}:
        return [TITLE_KEYWORDS_REVIEWED_FLAG]
    if review_state == "parked":
        return [TITLE_KEYWORDS_PARKED_FLAG]
    if review_state == "rejected" or rework_priority:
        return [TITLE_KEYWORDS_PROPOSED_FLAG, TITLE_KEYWORDS_REJECTED_FLAG]
    if review_state == "proposed":
        return [TITLE_KEYWORDS_PROPOSED_FLAG]
    return []


def _import_batch(conn: sqlite3.Connection, payload: dict[str, Any], relative_path: str) -> None:
    batch_id = str(payload.get("batch_id") or "").strip()
    if not batch_id:
        return
    proposed_at = str(payload.get("generated_at") or now_iso())
    _upsert_batch(conn, payload, relative_path)
    for item in payload.get("photos") or []:
        if not isinstance(item, dict):
            continue
        media_id = str(item.get("photo_id") or item.get("photoId") or "").strip()
        if not media_id:
            continue
        state = item.get("state") if isinstance(item.get("state"), dict) else {}
        attempt = int(state.get("proposal_attempt") or _latest_attempt(conn, media_id) or 1)
        current = item.get("current") if isinstance(item.get("current"), dict) else {}
        proposed = item.get("proposed") if isinstance(item.get("proposed"), dict) else {}
        changes = item.get("changes") if isinstance(item.get("changes"), dict) else {}
        generator = proposed.get("generator") if isinstance(proposed.get("generator"), dict) else {}
        if not generator and isinstance(item.get("generator"), dict):
            generator = item.get("generator")
        if not generator and isinstance(state.get("generator"), dict):
            generator = state.get("generator")
        generator_model = str(generator.get("model") or proposed.get("generator_model") or "").strip()
        generator_model_level = _optional_int(generator.get("model_level") or proposed.get("generator_model_level"))
        generator_model_maxed = _truthy(generator.get("model_maxed") or proposed.get("generator_model_maxed"))
        model_ladder = generator.get("model_ladder") or proposed.get("model_ladder") or []
        conn.execute(
            """
            INSERT INTO title_keyword_proposals (
              media_id, attempt, batch_id, previous_title, previous_keywords,
              proposed_title, proposed_keywords, proposal_status, confidence,
              needs_owner_context, proposal_reason, removed_blacklisted,
              keyword_target, keyword_target_met, generator_model, generator_model_level,
              generator_model_maxed, model_ladder, proposed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(media_id, attempt) DO UPDATE SET
              batch_id = excluded.batch_id,
              previous_title = excluded.previous_title,
              previous_keywords = excluded.previous_keywords,
              proposed_title = excluded.proposed_title,
              proposed_keywords = excluded.proposed_keywords,
              proposal_status = excluded.proposal_status,
              confidence = excluded.confidence,
              needs_owner_context = excluded.needs_owner_context,
              proposal_reason = excluded.proposal_reason,
              removed_blacklisted = excluded.removed_blacklisted,
              keyword_target = excluded.keyword_target,
              keyword_target_met = excluded.keyword_target_met,
              generator_model = excluded.generator_model,
              generator_model_level = excluded.generator_model_level,
              generator_model_maxed = excluded.generator_model_maxed,
              model_ladder = excluded.model_ladder,
              proposed_at = excluded.proposed_at
            """,
            (
                media_id,
                attempt,
                batch_id,
                str(current.get("title") or ""),
                _keywords_text(current.get("keywords") or current.get("keywords_raw") or ""),
                str(proposed.get("title") or ""),
                _keywords_text(proposed.get("keywords") or ""),
                str(proposed.get("status") or ""),
                str(proposed.get("confidence") or "") or None,
                1 if str(proposed.get("status") or "") == "needs_owner_context" else 0,
                str(proposed.get("reason") or ""),
                json.dumps(changes.get("removed_blacklisted") or [], ensure_ascii=False),
                changes.get("keyword_target"),
                _truthy(changes.get("keyword_target_met")),
                generator_model or None,
                generator_model_level,
                generator_model_maxed,
                json.dumps(model_ladder, ensure_ascii=False) if isinstance(model_ladder, list) else str(model_ladder or ""),
                proposed_at,
            ),
        )
        _upsert_queue(
            conn,
            media_id=media_id,
            review_state="proposed",
            latest_attempt=attempt,
            batch_id=batch_id,
            proposed_at=proposed_at,
            rework_priority=False,
            rejected_count=max(0, attempt - 1),
            owner_comment=str(state.get("rework_comment") or ""),
        )


def import_title_keyword_batch_file(repo_root: Path, batch_file: Path, db_path: Path | None = None) -> dict[str, Any]:
    absolute = batch_file if batch_file.is_absolute() else repo_root / batch_file
    payload = _read_json(absolute, {})
    if not isinstance(payload, dict):
        raise ValueError(f"invalid title/keyword batch JSON: {batch_file}")
    relative = absolute.relative_to(repo_root).as_posix() if absolute.is_relative_to(repo_root) else str(batch_file)
    conn = connect(repo_root, db_path)
    try:
        _import_batch(conn, payload, relative)
        _set_setting(conn, "title_keyword_latest_batch_json", relative)
        conn.commit()
        return {
            "db": (db_path or DEFAULT_DB).as_posix(),
            "batch_id": str(payload.get("batch_id") or ""),
            "photo_count": len(payload.get("photos") or []),
        }
    finally:
        conn.close()


def park_title_keyword_rows_file(repo_root: Path, rows_file: Path, db_path: Path | None = None) -> dict[str, Any]:
    absolute = rows_file if rows_file.is_absolute() else repo_root / rows_file
    payload = _read_json(absolute, [])
    if not isinstance(payload, list):
        raise ValueError(f"invalid parked title/keyword rows JSON: {rows_file}")
    conn = connect(repo_root, db_path)
    parked = 0
    try:
        for item in payload:
            if not isinstance(item, dict):
                continue
            media_id = str(item.get("photo_id") or item.get("photoId") or "").strip()
            if not media_id:
                continue
            batch_id = str(item.get("batch_id") or "").strip()
            timestamp = str(item.get("parked_at") or now_iso())
            if batch_id:
                _upsert_batch(conn, {"batch_id": batch_id, "generated_at": timestamp, "selection": {"total_count": 0}}, "parked-only")
            existing = conn.execute("SELECT latest_attempt, rejected_count FROM title_keyword_queue WHERE media_id = ?", (media_id,)).fetchone()
            latest_attempt = max(1, int(item.get("latest_attempt") or (existing["latest_attempt"] if existing else 1) or 1))
            rejected_count = max(0, int(item.get("rejected_count") or (existing["rejected_count"] if existing else 0) or 0))
            _upsert_queue(
                conn,
                media_id=media_id,
                review_state="parked",
                latest_attempt=latest_attempt,
                batch_id=batch_id,
                proposed_at=timestamp,
                rework_priority=False,
                rejected_count=rejected_count,
                owner_comment=str(item.get("reason") or item.get("rejection_comment") or ""),
            )
            parked += 1
        conn.commit()
        return {"db": (db_path or DEFAULT_DB).as_posix(), "parked": parked}
    finally:
        conn.close()


def mark_title_keyword_reviewed_file(repo_root: Path, rows_file: Path, db_path: Path | None = None) -> dict[str, Any]:
    absolute = rows_file if rows_file.is_absolute() else repo_root / rows_file
    payload = _read_json(absolute, [])
    if not isinstance(payload, list):
        raise ValueError(f"invalid reviewed title/keyword rows JSON: {rows_file}")
    conn = connect(repo_root, db_path)
    reviewed = 0
    try:
        for item in payload:
            if not isinstance(item, dict):
                continue
            media_id = str(item.get("photo_id") or item.get("photoId") or "").strip()
            if not media_id:
                continue
            batch_id = str(item.get("batch_id") or "").strip()
            timestamp = str(item.get("reviewed_at") or item.get("applied_at") or now_iso())
            if batch_id:
                _upsert_batch(conn, {"batch_id": batch_id, "generated_at": timestamp, "selection": {"total_count": 0}}, "no-change-reviewed")
            attempt = max(1, int(item.get("latest_attempt") or _latest_attempt(conn, media_id, batch_id) or 1))
            title = str(item.get("title") or "").strip()
            keywords = item.get("keywords") or ""
            generator = item.get("generator") if isinstance(item.get("generator"), dict) else {}
            model_ladder = generator.get("model_ladder") or []
            _ensure_placeholder_proposal(conn, media_id, attempt, batch_id, timestamp)
            conn.execute(
                """
                UPDATE title_keyword_proposals
                SET batch_id = ?,
                    previous_title = ?,
                    previous_keywords = ?,
                    proposed_title = ?,
                    proposed_keywords = ?,
                    proposal_status = 'no_change_needed',
                    confidence = 'high',
                    needs_owner_context = 0,
                    proposal_reason = ?,
                    removed_blacklisted = '[]',
                    keyword_target = ?,
                    keyword_target_met = 1,
                    generator_model = ?,
                    generator_model_level = ?,
                    generator_model_maxed = ?,
                    model_ladder = ?,
                    proposed_at = ?
                WHERE media_id = ? AND attempt = ?
                """,
                (
                    batch_id,
                    title,
                    _keywords_text(keywords),
                    title,
                    _keywords_text(keywords),
                    str(item.get("reason") or "Original title and keywords were already acceptable; marked reviewed without metadata changes."),
                    item.get("keyword_target"),
                    str(generator.get("model") or "existing-catalog-metadata"),
                    _optional_int(generator.get("model_level")),
                    _truthy(generator.get("model_maxed")),
                    json.dumps(model_ladder, ensure_ascii=False) if isinstance(model_ladder, list) else str(model_ladder or ""),
                    timestamp,
                    media_id,
                    attempt,
                ),
            )
            conn.execute(
                """
                INSERT INTO title_keyword_decisions
                  (media_id, attempt, decision_state, decided_title, decided_keywords, owner_comment, decided_at, applied_at)
                VALUES (?, ?, 'accepted', ?, ?, ?, ?, ?)
                ON CONFLICT(media_id, attempt) DO UPDATE SET
                  decision_state = excluded.decision_state,
                  decided_title = excluded.decided_title,
                  decided_keywords = excluded.decided_keywords,
                  owner_comment = excluded.owner_comment,
                  decided_at = excluded.decided_at,
                  applied_at = excluded.applied_at
                """,
                (
                    media_id,
                    attempt,
                    title,
                    _keywords_text(keywords),
                    str(item.get("reason") or "No title/keyword changes needed."),
                    timestamp,
                    timestamp,
                ),
            )
            _upsert_queue(
                conn,
                media_id=media_id,
                review_state="applied",
                latest_attempt=attempt,
                batch_id=batch_id,
                proposed_at=timestamp,
                reviewed_at=timestamp,
                applied_at=timestamp,
                rework_priority=False,
                rejected_count=0,
                owner_comment=str(item.get("reason") or "No title/keyword changes needed."),
            )
            reviewed += 1
        conn.commit()
        return {"db": (db_path or DEFAULT_DB).as_posix(), "reviewed": reviewed}
    finally:
        conn.close()


def import_title_keyword_review(repo_root: Path, conn: sqlite3.Connection | None = None, *, force: bool = False) -> None:
    owns_conn = conn is None
    conn = conn or connect(repo_root)
    try:
        if force:
            conn.execute("DELETE FROM title_keyword_decisions")
            conn.execute("DELETE FROM title_keyword_proposals")
            conn.execute("DELETE FROM title_keyword_queue")
            conn.execute("DELETE FROM title_keyword_batches")
        elif conn.execute("SELECT count(*) FROM title_keyword_queue").fetchone()[0]:
            return

        for path in _batch_files(repo_root):
            payload = _read_json(path, {})
            if isinstance(payload, dict):
                _import_batch(conn, payload, path.relative_to(repo_root).as_posix())

        for path in _approval_files(repo_root):
            payload = _read_json(path, {})
            if isinstance(payload, dict):
                record_title_keyword_review_decisions(
                    repo_root,
                    str(payload.get("batch_id") or path.stem.removeprefix("approvals-")),
                    payload.get("approvals") or [],
                    payload.get("rejections") or [],
                    payload.get("blocked") or [],
                    payload.get("not_found") or [],
                    applied_at=str(payload.get("applied_at") or ""),
                    decided_at=str(payload.get("updated_at") or now_iso()),
                    conn=conn,
                )
        _set_setting(conn, "title_keyword_review_dir", TITLE_KEYWORD_REVIEW_ROOT.as_posix())
        conn.commit()
    finally:
        if owns_conn:
            conn.close()


def record_title_keyword_review_decisions(
    repo_root: Path,
    batch_id: str,
    approvals: list[dict[str, Any]],
    rejections: list[dict[str, Any]],
    blocked: list[dict[str, Any]],
    not_found: list[Any],
    *,
    applied_at: str = "",
    decided_at: str = "",
    db_path: Path | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    owns_conn = conn is None
    conn = conn or connect(repo_root, db_path)
    decided_at = decided_at or now_iso()
    try:
        if not conn.execute("SELECT 1 FROM title_keyword_batches WHERE batch_id = ?", (batch_id,)).fetchone():
            _upsert_batch(conn, {"batch_id": batch_id, "generated_at": decided_at, "selection": {"total_count": 0}}, "decision-only")
        counts = {"accepted": 0, "rejected": 0, "blocked": 0, "not_found": 0}

        def insert_decision(media_id: str, state: str, title: str = "", keywords: Any = "", comment: str = "") -> None:
            if not media_id:
                return
            attempt = _latest_attempt(conn, media_id, batch_id)
            _ensure_placeholder_proposal(conn, media_id, attempt, batch_id, decided_at)
            conn.execute(
                """
                INSERT INTO title_keyword_decisions
                  (media_id, attempt, decision_state, decided_title, decided_keywords,
                   owner_comment, decided_at, applied_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(media_id, attempt) DO UPDATE SET
                  decision_state = excluded.decision_state,
                  decided_title = excluded.decided_title,
                  decided_keywords = excluded.decided_keywords,
                  owner_comment = excluded.owner_comment,
                  decided_at = excluded.decided_at,
                  applied_at = excluded.applied_at
                """,
                (media_id, attempt, state, title, _keywords_text(keywords), comment, decided_at, applied_at or None),
            )
            rejected_count = max(1, attempt) if state == "rejected" else 0
            if state == "rejected" and rejected_count >= TITLE_KEYWORD_PARK_REJECTED_COUNT:
                queue_state = "parked"
            else:
                queue_state = "applied" if state == "accepted" and applied_at else ("approved" if state == "accepted" else state)
            _upsert_queue(
                conn,
                media_id=media_id,
                review_state=queue_state if queue_state != "accepted" else "approved",
                latest_attempt=attempt,
                batch_id=batch_id,
                reviewed_at=decided_at,
                applied_at=applied_at,
                rework_priority=state == "rejected" and queue_state != "parked",
                rejected_count=rejected_count,
                owner_comment=comment,
            )
            counts[state if state in counts else "accepted"] += 1

        for item in approvals:
            if isinstance(item, dict):
                insert_decision(str(item.get("photo_id") or ""), "accepted", str(item.get("title") or ""), item.get("keywords") or "", "")
        for item in rejections:
            if isinstance(item, dict):
                insert_decision(str(item.get("photo_id") or ""), "rejected", str(item.get("title") or ""), item.get("keywords") or "", str(item.get("comment") or ""))
        for item in blocked:
            if isinstance(item, dict):
                insert_decision(str(item.get("photo_id") or ""), "blocked", "", "", "blocked by Owner review")
        for value in not_found:
            media_id = str(value.get("photo_id") if isinstance(value, dict) else value or "").strip()
            insert_decision(media_id, "not_found", "", "", "not found while applying review")
        _set_setting(conn, "title_keyword_review_dir", TITLE_KEYWORD_REVIEW_ROOT.as_posix())
        conn.commit()
        return {"db": (db_path or DEFAULT_DB).as_posix(), **counts}
    finally:
        if owns_conn:
            conn.close()


def import_owner_actions(repo_root: Path, db_path: Path | None = None, *, force: bool = False) -> None:
    conn = connect(repo_root, db_path)
    try:
        import_keyword_blacklist(repo_root, conn, force=force)
        import_country_assignments(repo_root, conn, force=force)
        import_title_keyword_review(repo_root, conn, force=force)
        _set_setting(conn, "imported_from_owner_action_json", "true")
        conn.commit()
    finally:
        conn.close()


def title_keyword_review_counts(repo_root: Path, db_path: Path | None = None) -> dict[str, int]:
    conn = connect(repo_root, db_path)
    try:
        rows = conn.execute(
            """
            SELECT review_state, rework_priority, count(*) AS count
            FROM title_keyword_queue
            GROUP BY review_state, rework_priority
            """
        ).fetchall()
        counts = {"accepted": 0, "submitted_unchecked": 0, "rejected": 0, "parked": 0, "blocked": 0}
        for row in rows:
            state = row["review_state"]
            count = int(row["count"])
            if state in {"approved", "applied"}:
                counts["accepted"] += count
            elif state == "proposed":
                counts["submitted_unchecked"] += count
            elif state == "parked":
                counts["parked"] += count
            elif state == "rejected" or row["rework_priority"]:
                counts["rejected"] += count
            elif state == "blocked":
                counts["blocked"] += count
        return counts
    finally:
        conn.close()


def title_keyword_generator_state(
    repo_root: Path,
    db_path: Path | None = None,
    *,
    park_retry_exhausted: bool = False,
) -> dict[str, Any]:
    conn = connect(repo_root, db_path)
    try:
        parked_now = park_retry_exhausted_title_keywords(conn) if park_retry_exhausted else 0
        if parked_now:
            conn.commit()
        rows = conn.execute(
            """
            SELECT q.*,
                   p.generator_model AS latest_generator_model,
                   p.generator_model_level AS latest_generator_model_level,
                   p.generator_model_maxed AS latest_generator_model_maxed,
                   p.model_ladder AS latest_model_ladder
            FROM title_keyword_queue AS q
            LEFT JOIN title_keyword_proposals AS p
              ON p.media_id = q.media_id
             AND p.attempt = q.latest_attempt
            ORDER BY q.media_id
            """
        ).fetchall()
        queue = []
        for row in rows:
            queue.append({
                "photo_id": row["media_id"],
                "review_state": row["review_state"],
                "rework_priority": bool(row["rework_priority"]),
                "rejected_count": int(row["rejected_count"] or 0),
                "owner_comment": row["owner_comment"] or "",
                "latest_attempt": int(row["latest_attempt"] or 1),
                "latest_proposed_batch_id": row["latest_proposed_batch_id"] or "",
                "latest_proposed_at": row["latest_proposed_at"] or "",
                "latest_generator_model": row["latest_generator_model"] or "",
                "latest_generator_model_level": row["latest_generator_model_level"],
                "latest_generator_model_maxed": bool(row["latest_generator_model_maxed"]),
                "latest_model_ladder": _read_json_text(row["latest_model_ladder"] or "", []),
                "state_tags": _title_keyword_state_tags(str(row["review_state"] or ""), bool(row["rework_priority"])),
            })
        counts = title_keyword_review_counts(repo_root, db_path)
        return {
            "format": "photosbyelie-title-keyword-generator-state",
            "schema_version": 1,
            "source_of_truth": (db_path or DEFAULT_DB).as_posix(),
            "park_retry_rejected_count": TITLE_KEYWORD_PARK_REJECTED_COUNT,
            "parked_retry_exhausted": parked_now,
            "parked_twice_rejected": parked_now,
            "keyword_blacklist": keyword_blacklist_terms(repo_root, db_path, conn),
            "counts": counts,
            "queue": queue,
        }
    finally:
        conn.close()


def _r2_entries_from_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for bucket, keys in (
        ("photosbyelie-public", payload.get("publicKeys") or []),
        ("photosbyelie-private", payload.get("privateKeys") or []),
    ):
        for key in keys:
            clean_key = str(key or "").strip()
            if not clean_key:
                continue
            entries.append({
                "bucket": bucket,
                "key": clean_key,
                "photo_id": _photo_id_from_r2_key(clean_key),
                "kind": _r2_object_kind(bucket, clean_key),
            })
    return entries


def _read_r2_entries_file(path: Path) -> list[dict[str, Any]]:
    payload = _read_json(path, {})
    source = payload.get("objects") if isinstance(payload, dict) else payload
    entries: list[dict[str, Any]] = []
    for item in source or []:
        if not isinstance(item, dict):
            continue
        bucket = str(item.get("bucket") or "").strip()
        key = str(item.get("key") or item.get("object_key") or "").strip()
        if not bucket or not key:
            continue
        entries.append({
            "bucket": bucket,
            "key": key,
            "photo_id": str(item.get("photo_id") or _photo_id_from_r2_key(key)),
            "kind": str(item.get("kind") or item.get("object_kind") or _r2_object_kind(bucket, key)),
            "bytes": item.get("bytes"),
        })
    return entries


def upsert_r2_object_state(
    conn: sqlite3.Connection,
    *,
    bucket: str,
    object_key: str,
    lifecycle_state: str,
    photo_id: str = "",
    object_kind: str = "",
    source: str = "",
    bytes_value: int | None = None,
    timestamp: str = "",
) -> None:
    timestamp = timestamp or now_iso()
    photo_id = str(photo_id or "") or _photo_id_from_r2_key(object_key)
    object_kind = str(object_kind or "") or _r2_object_kind(bucket, object_key)
    existing = conn.execute(
        "SELECT lifecycle_state, first_seen_at FROM r2_objects WHERE bucket = ? AND object_key = ?",
        (bucket, object_key),
    ).fetchone()
    first_seen_at = existing["first_seen_at"] if existing else (timestamp if lifecycle_state == "current" else None)
    if lifecycle_state == "current":
        marked_for_delete_at = None
        deleted_confirmed_at = None
        last_seen_at = timestamp
        last_checked_at = timestamp
    elif lifecycle_state == "marked_for_delete":
        marked_for_delete_at = timestamp
        deleted_confirmed_at = None
        last_seen_at = first_seen_at
        last_checked_at = timestamp
    else:
        marked_for_delete_at = timestamp
        deleted_confirmed_at = timestamp
        last_seen_at = first_seen_at
        last_checked_at = timestamp
    conn.execute(
        """
        INSERT INTO r2_objects (
          bucket, object_key, photo_id, object_kind, lifecycle_state,
          first_seen_at, last_seen_at, marked_for_delete_at, deleted_confirmed_at,
          last_checked_at, source, bytes, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(bucket, object_key) DO UPDATE SET
          photo_id = COALESCE(NULLIF(excluded.photo_id, ''), r2_objects.photo_id),
          object_kind = COALESCE(NULLIF(excluded.object_kind, ''), r2_objects.object_kind),
          lifecycle_state = excluded.lifecycle_state,
          first_seen_at = COALESCE(r2_objects.first_seen_at, excluded.first_seen_at),
          last_seen_at = COALESCE(excluded.last_seen_at, r2_objects.last_seen_at),
          marked_for_delete_at = CASE
            WHEN excluded.lifecycle_state = 'current' THEN NULL
            ELSE COALESCE(excluded.marked_for_delete_at, r2_objects.marked_for_delete_at)
          END,
          deleted_confirmed_at = CASE
            WHEN excluded.lifecycle_state = 'current' THEN NULL
            ELSE COALESCE(excluded.deleted_confirmed_at, r2_objects.deleted_confirmed_at)
          END,
          last_checked_at = excluded.last_checked_at,
          source = COALESCE(NULLIF(excluded.source, ''), r2_objects.source),
          bytes = COALESCE(excluded.bytes, r2_objects.bytes),
          updated_at = excluded.updated_at
        """,
        (
            bucket,
            object_key,
            photo_id,
            object_kind,
            lifecycle_state,
            first_seen_at,
            last_seen_at,
            marked_for_delete_at,
            deleted_confirmed_at,
            last_checked_at,
            source,
            bytes_value,
            timestamp,
        ),
    )


def record_r2_object_state_file(
    repo_root: Path,
    state_file: Path,
    lifecycle_state: str,
    db_path: Path | None = None,
    source: str = "r2-cleanup",
) -> dict[str, Any]:
    if lifecycle_state not in {"current", "marked_for_delete", "deleted_confirmed"}:
        raise ValueError(f"unsupported R2 object lifecycle state: {lifecycle_state}")
    entries = _read_r2_entries_file(state_file if state_file.is_absolute() else repo_root / state_file)
    conn = connect(repo_root, db_path)
    try:
        timestamp = now_iso()
        for entry in entries:
            upsert_r2_object_state(
                conn,
                bucket=entry["bucket"],
                object_key=entry["key"],
                lifecycle_state=lifecycle_state,
                photo_id=str(entry.get("photo_id") or ""),
                object_kind=str(entry.get("kind") or ""),
                source=source,
                bytes_value=entry.get("bytes") if isinstance(entry.get("bytes"), int) else None,
                timestamp=timestamp,
            )
        _set_setting(conn, f"r2_objects_last_{lifecycle_state}", timestamp)
        conn.commit()
        return {"db": (db_path or DEFAULT_DB).as_posix(), "state": lifecycle_state, "objects": len(entries)}
    finally:
        conn.close()


def import_discarded_r2_manifest(repo_root: Path, db_path: Path | None = None) -> dict[str, Any]:
    payload = _read_json(repo_root / DISCARDED_MEDIA_MANIFEST_PATH, {})
    entries = _r2_entries_from_payload(payload if isinstance(payload, dict) else {})
    conn = connect(repo_root, db_path)
    try:
        timestamp = str(payload.get("updatedAt") or now_iso()) if isinstance(payload, dict) else now_iso()
        for entry in entries:
            upsert_r2_object_state(
                conn,
                bucket=entry["bucket"],
                object_key=entry["key"],
                lifecycle_state="deleted_confirmed",
                photo_id=str(entry.get("photo_id") or ""),
                object_kind=str(entry.get("kind") or ""),
                source=DISCARDED_MEDIA_MANIFEST_PATH.as_posix(),
                timestamp=timestamp,
            )
        _set_setting(conn, "discarded_media_manifest_json", DISCARDED_MEDIA_MANIFEST_PATH.as_posix())
        conn.commit()
        return {"db": (db_path or DEFAULT_DB).as_posix(), "deleted_confirmed": len(entries)}
    finally:
        conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--import-owner-actions", action="store_true")
    parser.add_argument("--import-country-assignments", action="store_true")
    parser.add_argument("--export-country-assignments", action="store_true")
    parser.add_argument("--import-title-keyword-review", action="store_true")
    parser.add_argument("--import-title-keyword-batch-file", type=Path)
    parser.add_argument("--park-title-keyword-rows-file", type=Path)
    parser.add_argument("--mark-title-keyword-reviewed-file", type=Path)
    parser.add_argument("--title-keyword-generator-state-json", action="store_true")
    parser.add_argument("--park-retry-exhausted", action="store_true")
    parser.add_argument("--park-twice-rejected", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--import-keyword-blacklist", action="store_true")
    parser.add_argument("--export-keyword-blacklist", action="store_true")
    parser.add_argument("--import-discarded-r2-manifest", action="store_true")
    parser.add_argument("--r2-state-file", type=Path)
    parser.add_argument("--r2-state", choices=("current", "marked_for_delete", "deleted_confirmed"))
    parser.add_argument("--backfill-r2-metadata", action="store_true")
    parser.add_argument("--review-counts", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    repo_root = args.repo_root.resolve()
    park_retry_exhausted = args.park_retry_exhausted or args.park_twice_rejected
    if args.import_owner_actions:
        import_owner_actions(repo_root, args.db, force=args.force)
    elif args.title_keyword_generator_state_json:
        print(json.dumps(title_keyword_generator_state(repo_root, args.db, park_retry_exhausted=park_retry_exhausted), ensure_ascii=False))
        return
    else:
        conn = connect(repo_root, args.db)
        try:
            if args.import_keyword_blacklist:
                import_keyword_blacklist(repo_root, conn, force=args.force)
            if args.export_keyword_blacklist:
                export_keyword_blacklist(repo_root, conn)
            if args.import_country_assignments:
                import_country_assignments(repo_root, conn, force=args.force)
            if args.export_country_assignments:
                export_country_assignments(repo_root, conn)
            if args.import_title_keyword_review:
                import_title_keyword_review(repo_root, conn, force=args.force)
            if args.import_title_keyword_batch_file:
                conn.close()
                result = import_title_keyword_batch_file(repo_root, args.import_title_keyword_batch_file, args.db)
                print(f"title_keyword_batch {result['batch_id']}={result['photo_count']}")
                conn = connect(repo_root, args.db)
            if args.park_title_keyword_rows_file:
                conn.close()
                result = park_title_keyword_rows_file(repo_root, args.park_title_keyword_rows_file, args.db)
                print(f"title_keyword_rows_parked={result['parked']}")
                conn = connect(repo_root, args.db)
            if args.mark_title_keyword_reviewed_file:
                conn.close()
                result = mark_title_keyword_reviewed_file(repo_root, args.mark_title_keyword_reviewed_file, args.db)
                print(f"title_keyword_rows_reviewed={result['reviewed']}")
                conn = connect(repo_root, args.db)
            if park_retry_exhausted:
                parked = park_retry_exhausted_title_keywords(conn)
                conn.commit()
                print(f"title_keyword_queue parked_retry_exhausted={parked}")
            if args.import_discarded_r2_manifest:
                conn.close()
                result = import_discarded_r2_manifest(repo_root, args.db)
                print(f"r2_objects deleted_confirmed={result['deleted_confirmed']}")
                conn = connect(repo_root, args.db)
            if args.r2_state_file and args.r2_state:
                conn.close()
                result = record_r2_object_state_file(repo_root, args.r2_state_file, args.r2_state, args.db)
                print(f"r2_objects {result['state']}={result['objects']}")
                conn = connect(repo_root, args.db)
            if args.backfill_r2_metadata:
                updated = backfill_r2_object_metadata(conn)
                conn.commit()
                print(f"r2_objects metadata_backfilled={updated}")
        finally:
            conn.close()

    if args.review_counts:
        counts = title_keyword_review_counts(repo_root, args.db)
        print(
            "Owner review counts: "
            f"accepted {counts['accepted']} / "
            f"submitted-unchecked {counts['submitted_unchecked']} / "
            f"rejected {counts['rejected']} / "
            f"parked {counts['parked']}"
        )
    else:
        conn = connect(repo_root, args.db)
        try:
            tables = ["keyword_blacklist", "country_assignments", "title_keyword_batches", "title_keyword_queue", "title_keyword_proposals", "title_keyword_decisions", "r2_objects"]
            print(", ".join(f"{table}={conn.execute(f'SELECT count(*) FROM {table}').fetchone()[0]}" for table in tables))
        finally:
            conn.close()


if __name__ == "__main__":
    main()
