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
TITLE_KEYWORD_PROPOSED_STATE = TITLE_KEYWORD_REVIEW_ROOT / "proposed-state.json"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


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
        """
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
           proposed_at)
        VALUES (?, ?, ?, '', '', '', '', 'compatibility-placeholder', 'low', 1, '', '[]', NULL, NULL, ?)
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
          review_state = excluded.review_state,
          latest_attempt = max(title_keyword_queue.latest_attempt, excluded.latest_attempt),
          latest_proposed_batch_id = COALESCE(NULLIF(excluded.latest_proposed_batch_id, ''), title_keyword_queue.latest_proposed_batch_id),
          latest_proposed_at = COALESCE(NULLIF(excluded.latest_proposed_at, ''), title_keyword_queue.latest_proposed_at),
          reviewed_at = COALESCE(NULLIF(excluded.reviewed_at, ''), title_keyword_queue.reviewed_at),
          applied_at = COALESCE(NULLIF(excluded.applied_at, ''), title_keyword_queue.applied_at),
          rework_priority = excluded.rework_priority,
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
        conn.execute(
            """
            INSERT INTO title_keyword_proposals (
              media_id, attempt, batch_id, previous_title, previous_keywords,
              proposed_title, proposed_keywords, proposal_status, confidence,
              needs_owner_context, proposal_reason, removed_blacklisted,
              keyword_target, keyword_target_met, proposed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            rework_priority=state.get("rework_requested") is True,
            rejected_count=max(0, attempt - 1),
            owner_comment=str(state.get("rework_comment") or ""),
        )


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

        state = _read_json(repo_root / TITLE_KEYWORD_PROPOSED_STATE, {})
        if isinstance(state, dict):
            for batch in state.get("batches") or []:
                if isinstance(batch, dict):
                    _upsert_batch(
                        conn,
                        {
                            "batch_id": batch.get("batch_id"),
                            "generated_at": batch.get("generated_at") or now_iso(),
                            "selection": {"total_count": batch.get("photo_count") or 0},
                            "photos": [None] * int(batch.get("photo_count") or 0),
                        },
                        "proposed-state",
                    )
            for item in state.get("photos") or []:
                if not isinstance(item, dict):
                    continue
                media_id = str(item.get("photo_id") or "").strip()
                if not media_id:
                    continue
                review_state = str(item.get("review_state") or "proposed")
                if review_state not in {"proposed", "approved", "applied", "rejected", "parked", "blocked"}:
                    review_state = "proposed"
                attempt = max(1, _latest_attempt(conn, media_id), int(item.get("latest_attempt") or 0))
                batch_id = str(item.get("latest_proposed_batch_id") or item.get("latest_rejected_batch_id") or "").strip()
                if batch_id:
                    _ensure_placeholder_proposal(conn, media_id, attempt, batch_id, str(item.get("latest_proposed_at") or item.get("latest_rejected_at") or now_iso()))
                _upsert_queue(
                    conn,
                    media_id=media_id,
                    review_state=review_state,
                    latest_attempt=attempt,
                    batch_id=batch_id,
                    proposed_at=str(item.get("latest_proposed_at") or ""),
                    rework_priority=item.get("rework_priority") is True,
                    rejected_count=int(item.get("rejected_count") or 0),
                    owner_comment=str(item.get("rejection_comment") or ""),
                )

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
            queue_state = "applied" if state == "accepted" and applied_at else ("approved" if state == "accepted" else state)
            _upsert_queue(
                conn,
                media_id=media_id,
                review_state=queue_state if queue_state != "accepted" else "approved",
                latest_attempt=attempt,
                batch_id=batch_id,
                reviewed_at=decided_at,
                applied_at=applied_at,
                rework_priority=state == "rejected",
                rejected_count=1 if state == "rejected" else 0,
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
            elif state == "rejected" or row["rework_priority"]:
                counts["rejected"] += count
            elif state == "parked":
                counts["parked"] += count
            elif state == "blocked":
                counts["blocked"] += count
        return counts
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
    parser.add_argument("--import-keyword-blacklist", action="store_true")
    parser.add_argument("--review-counts", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    repo_root = args.repo_root.resolve()
    if args.import_owner_actions:
        import_owner_actions(repo_root, args.db, force=args.force)
    else:
        conn = connect(repo_root, args.db)
        try:
            if args.import_keyword_blacklist:
                import_keyword_blacklist(repo_root, conn, force=args.force)
            if args.import_country_assignments:
                import_country_assignments(repo_root, conn, force=args.force)
            if args.export_country_assignments:
                export_country_assignments(repo_root, conn)
            if args.import_title_keyword_review:
                import_title_keyword_review(repo_root, conn, force=args.force)
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
            tables = ["keyword_blacklist", "country_assignments", "title_keyword_batches", "title_keyword_queue", "title_keyword_proposals", "title_keyword_decisions"]
            print(", ".join(f"{table}={conn.execute(f'SELECT count(*) FROM {table}').fetchone()[0]}" for table in tables))
        finally:
            conn.close()


if __name__ == "__main__":
    main()
