#!/usr/bin/env python3
"""SQLite-backed local Owner state with JSON compatibility exports."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import re
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
HIDDEN_DATA_PATH = Path("assets/hidden/hidden-data.json")
HIDDEN_BLACKLIST_PATH = Path("assets/hidden/hidden-blacklist.json")
DISCARDED_TOMBSTONE_PATH = Path("assets/discarded/discarded-photo-ids.json")
DISCARDED_MEDIA_MANIFEST_PATH = Path("assets/discarded-media-manifest.json")
TITLE_KEYWORDS_PROPOSED_FLAG = "Title_Keywords_Proposed"
TITLE_KEYWORDS_REJECTED_FLAG = "Title_Keywords_Rejected"
TITLE_KEYWORDS_PARKED_FLAG = "Title_Keywords_Parked"
TITLE_KEYWORDS_REVIEWED_FLAG = "Title_Keywords_Reviewed"
TITLE_KEYWORD_PARK_REJECTED_COUNT = 10
TITLE_KEYWORD_STATE_FLAGS = {
    TITLE_KEYWORDS_PROPOSED_FLAG.casefold(),
    TITLE_KEYWORDS_REJECTED_FLAG.casefold(),
    TITLE_KEYWORDS_PARKED_FLAG.casefold(),
    TITLE_KEYWORDS_REVIEWED_FLAG.casefold(),
}
TITLE_KEYWORD_APPROVED_STATES = {"approved", "applied"}
TITLE_KEYWORD_ACTIVE_REVIEW_STATES = {"proposed", "rejected"}


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
          review_requested_at      TEXT,
          review_requested_by      TEXT,
          review_request_source    TEXT,
          review_request_context   TEXT,
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

        CREATE TABLE IF NOT EXISTS media_lifecycle (
          media_id                 TEXT PRIMARY KEY CHECK (trim(media_id) <> ''),
          lifecycle_state          TEXT NOT NULL CHECK (lifecycle_state IN ('active', 'hidden', 'discarded')),
          previous_state           TEXT,
          previous_slug            TEXT,
          source_slug              TEXT,
          title                    TEXT,
          media_type               TEXT,
          hidden_at                TEXT,
          discarded_at             TEXT,
          restored_at              TEXT,
          source_paths_json        TEXT NOT NULL DEFAULT '[]',
          public_preview_keys_json TEXT NOT NULL DEFAULT '[]',
          private_keys_json        TEXT NOT NULL DEFAULT '[]',
          tombstone_json           TEXT,
          updated_at               TEXT
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
        CREATE INDEX IF NOT EXISTS idx_media_lifecycle_state ON media_lifecycle(lifecycle_state, updated_at);
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
    for column, ddl in {
        "review_requested_at": "ALTER TABLE title_keyword_queue ADD COLUMN review_requested_at TEXT",
        "review_requested_by": "ALTER TABLE title_keyword_queue ADD COLUMN review_requested_by TEXT",
        "review_request_source": "ALTER TABLE title_keyword_queue ADD COLUMN review_request_source TEXT",
        "review_request_context": "ALTER TABLE title_keyword_queue ADD COLUMN review_request_context TEXT",
    }.items():
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(title_keyword_queue)")}
        if column not in existing:
            conn.execute(ddl)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_title_keyword_proposals_generator_model ON title_keyword_proposals(generator_model, generator_model_level)"
    )


def _keywords_text(value: Any) -> str:
    if isinstance(value, list):
        return ", ".join(str(item).strip() for item in value if str(item).strip())
    return str(value or "").strip()


REJECTED_PROPOSAL_COMMENT_MARKER = "Rejected proposal:"


def _strip_rejected_proposal_comment_context(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    marker = f"\n\n{REJECTED_PROPOSAL_COMMENT_MARKER}".casefold()
    index = text.casefold().find(marker)
    return (text[:index] if index >= 0 else text).strip()


def _rejection_comment_with_proposal_context(comment: Any, title: Any, keywords: Any) -> str:
    owner_comment = _strip_rejected_proposal_comment_context(comment)
    if not owner_comment:
        return ""
    clean_title = str(title or "").strip()
    clean_keywords = _normalized_keywords(keywords)
    if not clean_title and not clean_keywords:
        return owner_comment
    return "\n".join([
        owner_comment,
        "",
        REJECTED_PROPOSAL_COMMENT_MARKER,
        f"Title: {clean_title or '(blank)'}",
        f"Keywords: {', '.join(clean_keywords) if clean_keywords else '(none)'}",
    ])


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


def _keyword_tokens(value: Any) -> list[str]:
    text = str(value or "").strip()
    text = re.sub(r"\.[a-z0-9]{2,5}$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"[_-]+", " ", text)
    return [token for token in re.split(r"[^a-z0-9]+", text.casefold()) if token]


def _keyword_blacklist_rules(conn: sqlite3.Connection) -> list[tuple[str, list[str]]]:
    rows = conn.execute("SELECT keyword FROM keyword_blacklist ORDER BY keyword COLLATE NOCASE").fetchall()
    rules: list[tuple[str, list[str]]] = []
    for row in rows:
        keyword = str(row["keyword"] or "").strip()
        tokens = _keyword_tokens(keyword)
        if keyword and tokens:
            rules.append((keyword, tokens))
    return rules


def _has_token_sequence(tokens: list[str], blocked_tokens: list[str]) -> bool:
    if not blocked_tokens or len(blocked_tokens) > len(tokens):
        return False
    for index in range(0, len(tokens) - len(blocked_tokens) + 1):
        if tokens[index:index + len(blocked_tokens)] == blocked_tokens:
            return True
    return False


def _has_blacklisted_term(keyword: str, rules: list[tuple[str, list[str]]]) -> bool:
    tokens = _keyword_tokens(keyword)
    if not tokens:
        return False
    return any(_has_token_sequence(tokens, blocked_tokens) for _, blocked_tokens in rules)


def _reviewable_keywords(value: Any, rules: list[tuple[str, list[str]]], removed: Any = ()) -> list[str]:
    removed_set = {keyword.casefold() for keyword in _normalized_keywords(removed)}
    return [
        keyword
        for keyword in _normalized_keywords(value)
        if keyword.casefold() not in TITLE_KEYWORD_STATE_FLAGS
        and keyword.casefold() not in removed_set
        and not _has_blacklisted_term(keyword, rules)
    ]


def _proposal_keywords_with_floor(
    previous: Any,
    proposed: Any,
    rules: list[tuple[str, list[str]]],
    removed_blacklisted: Any = (),
) -> list[str]:
    proposed_keywords = _reviewable_keywords(proposed, rules, removed_blacklisted)
    floor_keywords = _reviewable_keywords(previous, rules, removed_blacklisted)
    if len(proposed_keywords) >= len(floor_keywords):
        return proposed_keywords
    return _reviewable_keywords([*floor_keywords, *proposed_keywords], rules, removed_blacklisted)


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


def _unique_texts(values: Iterable[Any]) -> list[str]:
    seen: set[str] = set()
    cleaned: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if not text or text in seen:
            continue
        cleaned.append(text)
        seen.add(text)
    return cleaned


def _json_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return _unique_texts(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return []
        return _json_list(parsed)
    return []


def _json_list_text(values: Iterable[Any]) -> str:
    return json.dumps(_unique_texts(values), ensure_ascii=False, separators=(",", ":"))


def _media_id_from_entry(entry: dict[str, Any] | str) -> str:
    if isinstance(entry, dict):
        return str(entry.get("media_id") or entry.get("photo_id") or entry.get("id") or "").strip()
    return str(entry or "").strip()


def _media_type_from_entry(entry: dict[str, Any]) -> str:
    media = entry.get("media") if isinstance(entry.get("media"), dict) else {}
    return str(
        entry.get("media_type")
        or entry.get("mediaType")
        or media.get("type")
        or entry.get("type")
        or ""
    ).strip().lower()


def normalize_source_path_value(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    try:
        return Path(text).expanduser().resolve(strict=False).as_posix()
    except OSError:
        return Path(text).expanduser().as_posix()


def source_path_values_from_object(value: Any) -> set[str]:
    paths: set[str] = set()
    if isinstance(value, dict):
        for key in ("source_path_hint", "sourcePath", "source_path", "sourceFile", "path"):
            normalized = normalize_source_path_value(value.get(key))
            if normalized:
                paths.add(normalized)
        for key in ("source_paths", "sourcePaths", "sourceFiles", "source_files"):
            paths.update(source_path_values_from_object(value.get(key)))
        source_file = value.get("source_file")
        if isinstance(source_file, dict):
            paths.update(source_path_values_from_object(source_file))
    elif isinstance(value, list):
        for item in value:
            paths.update(source_path_values_from_object(item))
    elif isinstance(value, str):
        normalized = normalize_source_path_value(value)
        if normalized:
            paths.add(normalized)
    return paths


def _ids_from_payload(payload: Any) -> set[str]:
    if not isinstance(payload, dict):
        return set()
    ids: set[str] = set()
    for key in ("photo_ids", "hidden_ids", "discardedPhotoIds"):
        values = payload.get(key)
        if isinstance(values, list):
            ids.update(str(value).strip() for value in values if str(value or "").strip())
    photos = payload.get("photos")
    if isinstance(photos, list):
        for photo in photos:
            if isinstance(photo, dict):
                media_id = _media_id_from_entry(photo)
            else:
                media_id = str(photo or "").strip()
            if media_id:
                ids.add(media_id)
    return ids


def _keys_from_payload(payload: Any, *keys: str) -> set[str]:
    if not isinstance(payload, dict):
        return set()
    values: set[str] = set()
    for key in keys:
        item = payload.get(key)
        if isinstance(item, list):
            values.update(str(value).strip() for value in item if str(value or "").strip())
    return values


def _photo_entries_by_id(payload: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("photos"), list):
        return {}
    entries: dict[str, dict[str, Any]] = {}
    for photo in payload["photos"]:
        if not isinstance(photo, dict):
            continue
        media_id = _media_id_from_entry(photo)
        if media_id:
            entries[media_id] = photo
    return entries


def _hidden_data_entries(repo_root: Path) -> dict[str, dict[str, Any]]:
    payload = _read_json(repo_root / HIDDEN_DATA_PATH, {})
    if not isinstance(payload, dict):
        return {}
    entries: dict[str, dict[str, Any]] = {}
    for slug, collection in payload.items():
        if not isinstance(collection, dict):
            continue
        for photo in collection.get("photos") or []:
            if not isinstance(photo, dict):
                continue
            media_id = _media_id_from_entry(photo)
            if not media_id:
                continue
            entries[media_id] = {**photo, "from_slug": slug}
    return entries


def _compat_lifecycle_sets(repo_root: Path) -> dict[str, set[str]]:
    hidden_blacklist = _read_json(repo_root / HIDDEN_BLACKLIST_PATH, {})
    hidden_data = _read_json(repo_root / HIDDEN_DATA_PATH, {})
    discarded_tombstone = _read_json(repo_root / DISCARDED_TOMBSTONE_PATH, {})
    discarded_manifest = _read_json(repo_root / DISCARDED_MEDIA_MANIFEST_PATH, {})

    hidden_ids = _ids_from_payload(hidden_blacklist)
    hidden_source_paths = source_path_values_from_object(hidden_blacklist)
    if isinstance(hidden_data, dict):
        for collection in hidden_data.values():
            if not isinstance(collection, dict):
                continue
            for photo in collection.get("photos") or []:
                if not isinstance(photo, dict):
                    continue
                media_id = _media_id_from_entry(photo)
                if media_id:
                    hidden_ids.add(media_id)
                hidden_source_paths.update(source_path_values_from_object(photo))

    discarded_ids = _ids_from_payload(discarded_tombstone) | _ids_from_payload(discarded_manifest)
    discarded_source_paths = source_path_values_from_object(discarded_tombstone) | source_path_values_from_object(discarded_manifest)
    public_preview_keys = (
        _keys_from_payload(hidden_blacklist, "public_preview_keys", "publicKeys")
        | _keys_from_payload(discarded_tombstone, "public_preview_keys", "publicKeys")
        | _keys_from_payload(discarded_manifest, "public_preview_keys", "publicKeys")
    )
    private_keys = (
        _keys_from_payload(hidden_blacklist, "private_keys", "privateKeys")
        | _keys_from_payload(discarded_tombstone, "private_keys", "privateKeys")
        | _keys_from_payload(discarded_manifest, "private_keys", "privateKeys")
    )
    return {
        "hidden_ids": hidden_ids - discarded_ids,
        "discarded_ids": discarded_ids,
        "hidden_source_paths": hidden_source_paths,
        "discarded_source_paths": discarded_source_paths,
        "public_preview_keys": public_preview_keys,
        "private_keys": private_keys,
    }


def _upsert_media_lifecycle(
    conn: sqlite3.Connection,
    entry: dict[str, Any],
    lifecycle_state: str,
    timestamp: str,
) -> bool:
    media_id = _media_id_from_entry(entry)
    if not media_id:
        return False
    if lifecycle_state not in {"active", "hidden", "discarded"}:
        raise ValueError(f"unsupported media lifecycle state: {lifecycle_state}")

    existing = conn.execute("SELECT * FROM media_lifecycle WHERE media_id = ?", (media_id,)).fetchone()
    source_paths = source_path_values_from_object(entry)
    public_preview_keys = _unique_texts(entry.get("public_preview_keys") or entry.get("publicPreviewKeys") or [])
    private_keys = _unique_texts(entry.get("private_keys") or entry.get("privateKeys") or [])
    if existing:
        source_paths.update(_json_list(existing["source_paths_json"]))
        public_preview_keys = _unique_texts([*public_preview_keys, *_json_list(existing["public_preview_keys_json"])])
        private_keys = _unique_texts([*private_keys, *_json_list(existing["private_keys_json"])])

    hidden_at = str(entry.get("hidden_at") or entry.get("hiddenAt") or "").strip()
    discarded_at = str(entry.get("discarded_at") or entry.get("discardedAt") or "").strip()
    restored_at = str(entry.get("restored_at") or entry.get("restoredAt") or "").strip()
    if lifecycle_state == "hidden":
        hidden_at = hidden_at or timestamp
    elif lifecycle_state == "discarded":
        discarded_at = discarded_at or timestamp
    elif lifecycle_state == "active":
        restored_at = restored_at or timestamp

    tombstone_json = ""
    if lifecycle_state == "discarded":
        tombstone_json = json.dumps(entry, ensure_ascii=False, separators=(",", ":"))
    elif existing:
        tombstone_json = str(existing["tombstone_json"] or "")

    conn.execute(
        """
        INSERT INTO media_lifecycle (
          media_id, lifecycle_state, previous_state, previous_slug, source_slug,
          title, media_type, hidden_at, discarded_at, restored_at, source_paths_json,
          public_preview_keys_json, private_keys_json, tombstone_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(media_id) DO UPDATE SET
          lifecycle_state = excluded.lifecycle_state,
          previous_state = COALESCE(NULLIF(excluded.previous_state, ''), media_lifecycle.previous_state),
          previous_slug = COALESCE(NULLIF(excluded.previous_slug, ''), media_lifecycle.previous_slug),
          source_slug = COALESCE(NULLIF(excluded.source_slug, ''), media_lifecycle.source_slug),
          title = COALESCE(NULLIF(excluded.title, ''), media_lifecycle.title),
          media_type = COALESCE(NULLIF(excluded.media_type, ''), media_lifecycle.media_type),
          hidden_at = COALESCE(NULLIF(excluded.hidden_at, ''), media_lifecycle.hidden_at),
          discarded_at = COALESCE(NULLIF(excluded.discarded_at, ''), media_lifecycle.discarded_at),
          restored_at = COALESCE(NULLIF(excluded.restored_at, ''), media_lifecycle.restored_at),
          source_paths_json = excluded.source_paths_json,
          public_preview_keys_json = excluded.public_preview_keys_json,
          private_keys_json = excluded.private_keys_json,
          tombstone_json = COALESCE(NULLIF(excluded.tombstone_json, ''), media_lifecycle.tombstone_json),
          updated_at = excluded.updated_at
        """,
        (
            media_id,
            lifecycle_state,
            str(entry.get("from_state") or entry.get("previous_state") or entry.get("hiddenFromState") or "").strip(),
            str(entry.get("from_slug") or entry.get("previous_slug") or entry.get("hiddenFromSlug") or "").strip(),
            str(entry.get("source_slug") or entry.get("sourceSlug") or "").strip(),
            str(entry.get("title") or "").strip(),
            _media_type_from_entry(entry),
            hidden_at,
            discarded_at,
            restored_at,
            _json_list_text(sorted(source_paths)),
            _json_list_text(public_preview_keys),
            _json_list_text(private_keys),
            tombstone_json,
            timestamp,
        ),
    )
    return True


def sync_media_lifecycle_from_compat(
    repo_root: Path,
    conn: sqlite3.Connection | None = None,
    *,
    db_path: Path | None = None,
) -> dict[str, Any]:
    owns_conn = conn is None
    conn = conn or connect(repo_root, db_path)
    timestamp = now_iso()
    try:
        hidden_blacklist = _read_json(repo_root / HIDDEN_BLACKLIST_PATH, {})
        hidden_entries = _hidden_data_entries(repo_root)
        discarded_tombstone = _read_json(repo_root / DISCARDED_TOMBSTONE_PATH, {})
        discarded_manifest = _read_json(repo_root / DISCARDED_MEDIA_MANIFEST_PATH, {})
        discarded_entries = _photo_entries_by_id(discarded_tombstone)
        discarded_ids = _ids_from_payload(discarded_tombstone) | _ids_from_payload(discarded_manifest)
        hidden_ids = (_ids_from_payload(hidden_blacklist) | set(hidden_entries)) - discarded_ids

        discarded_count = 0
        for media_id in sorted(discarded_ids):
            entry = discarded_entries.get(media_id, {"id": media_id})
            if _upsert_media_lifecycle(conn, entry, "discarded", timestamp):
                discarded_count += 1

        hidden_count = 0
        for media_id in sorted(hidden_ids):
            existing = conn.execute("SELECT lifecycle_state FROM media_lifecycle WHERE media_id = ?", (media_id,)).fetchone()
            if existing and existing["lifecycle_state"] == "active":
                continue
            entry = hidden_entries.get(media_id, {"id": media_id})
            if _upsert_media_lifecycle(conn, entry, "hidden", timestamp):
                hidden_count += 1

        _set_setting(conn, "media_lifecycle_compat_json", "true")
        conn.commit()
        return {"db": (db_path or DEFAULT_DB).as_posix(), "hidden": hidden_count, "discarded": discarded_count}
    finally:
        if owns_conn:
            conn.close()


def record_media_lifecycle_entries(
    repo_root: Path,
    entries: Iterable[dict[str, Any]],
    lifecycle_state: str,
    db_path: Path | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    owns_conn = conn is None
    conn = conn or connect(repo_root, db_path)
    timestamp = now_iso()
    count = 0
    try:
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            if _upsert_media_lifecycle(conn, entry, lifecycle_state, timestamp):
                count += 1
        _set_setting(conn, "media_lifecycle_sqlite", "true")
        conn.commit()
        return {"db": (db_path or DEFAULT_DB).as_posix(), lifecycle_state: count}
    finally:
        if owns_conn:
            conn.close()


def record_media_lifecycle_hidden(
    repo_root: Path,
    entries: Iterable[dict[str, Any]],
    db_path: Path | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    return record_media_lifecycle_entries(repo_root, entries, "hidden", db_path, conn)


def record_media_lifecycle_discarded(
    repo_root: Path,
    entries: Iterable[dict[str, Any]],
    db_path: Path | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    return record_media_lifecycle_entries(repo_root, entries, "discarded", db_path, conn)


def record_media_lifecycle_active(
    repo_root: Path,
    media_ids: Iterable[str],
    db_path: Path | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    owns_conn = conn is None
    conn = conn or connect(repo_root, db_path)
    timestamp = now_iso()
    normalized = _unique_texts(media_ids)
    restored = 0
    skipped_discarded = 0
    try:
        for media_id in normalized:
            existing = conn.execute("SELECT lifecycle_state FROM media_lifecycle WHERE media_id = ?", (media_id,)).fetchone()
            if existing and existing["lifecycle_state"] == "discarded":
                skipped_discarded += 1
                continue
            entry = {"id": media_id, "restored_at": timestamp}
            if _upsert_media_lifecycle(conn, entry, "active", timestamp):
                restored += 1
        _set_setting(conn, "media_lifecycle_sqlite", "true")
        conn.commit()
        return {
            "db": (db_path or DEFAULT_DB).as_posix(),
            "active": restored,
            "skipped_discarded": skipped_discarded,
        }
    finally:
        if owns_conn:
            conn.close()


def media_lifecycle_snapshot(
    repo_root: Path,
    db_path: Path | None = None,
    conn: sqlite3.Connection | None = None,
    *,
    sync_compat: bool = True,
) -> dict[str, Any]:
    owns_conn = conn is None
    conn = conn or connect(repo_root, db_path)
    try:
        if sync_compat:
            sync_media_lifecycle_from_compat(repo_root, conn=conn, db_path=db_path)
        rows = conn.execute(
            """
            SELECT media_id, lifecycle_state, source_paths_json,
                   public_preview_keys_json, private_keys_json, hidden_at,
                   discarded_at, restored_at, updated_at
            FROM media_lifecycle
            ORDER BY lifecycle_state, media_id
            """
        ).fetchall()
        compat = _compat_lifecycle_sets(repo_root)
        hidden_ids = set(compat["hidden_ids"])
        discarded_ids = set(compat["discarded_ids"])
        hidden_source_paths = set(compat["hidden_source_paths"])
        discarded_source_paths = set(compat["discarded_source_paths"])
        public_preview_keys = set(compat["public_preview_keys"])
        private_keys = set(compat["private_keys"])
        active_ids: set[str] = set()
        active_source_paths: set[str] = set()
        states: list[dict[str, Any]] = []
        for row in rows:
            media_id = str(row["media_id"] or "")
            state = str(row["lifecycle_state"] or "")
            row_source_paths = set(_json_list(row["source_paths_json"]))
            row_public_keys = set(_json_list(row["public_preview_keys_json"]))
            row_private_keys = set(_json_list(row["private_keys_json"]))
            if state == "hidden":
                hidden_ids.add(media_id)
                hidden_source_paths.update(row_source_paths)
            elif state == "discarded":
                discarded_ids.add(media_id)
                discarded_source_paths.update(row_source_paths)
            elif state == "active":
                active_ids.add(media_id)
                active_source_paths.update(row_source_paths)
            public_preview_keys.update(row_public_keys)
            private_keys.update(row_private_keys)
            states.append({
                "media_id": media_id,
                "lifecycle_state": state,
                "hidden_at": row["hidden_at"] or "",
                "discarded_at": row["discarded_at"] or "",
                "restored_at": row["restored_at"] or "",
                "updated_at": row["updated_at"] or "",
            })

        hidden_ids -= discarded_ids | active_ids
        hidden_source_paths -= active_source_paths
        blocked_ids = hidden_ids | discarded_ids
        blocked_source_paths = hidden_source_paths | discarded_source_paths
        return {
            "format": "photosbyelie-media-lifecycle",
            "schema_version": 1,
            "source_of_truth": (db_path or DEFAULT_DB).as_posix(),
            "hiddenPhotoIds": sorted(hidden_ids),
            "discardedPhotoIds": sorted(discarded_ids),
            "blockedPhotoIds": sorted(blocked_ids),
            "hiddenSourcePaths": sorted(hidden_source_paths),
            "discardedSourcePaths": sorted(discarded_source_paths),
            "blockedSourcePaths": sorted(blocked_source_paths),
            "publicPreviewKeys": sorted(public_preview_keys),
            "privateKeys": sorted(private_keys),
            "states": states,
        }
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
          generated_at = CASE
            WHEN excluded.total_count = 0 AND title_keyword_batches.total_count > 0 THEN title_keyword_batches.generated_at
            ELSE excluded.generated_at
          END,
          total_count = CASE
            WHEN excluded.total_count = 0 AND title_keyword_batches.total_count > 0 THEN title_keyword_batches.total_count
            ELSE excluded.total_count
          END,
          ordinary_new_count = CASE
            WHEN excluded.total_count = 0 AND title_keyword_batches.total_count > 0 THEN title_keyword_batches.ordinary_new_count
            ELSE excluded.ordinary_new_count
          END,
          rework_count = CASE
            WHEN excluded.total_count = 0 AND title_keyword_batches.total_count > 0 THEN title_keyword_batches.rework_count
            ELSE excluded.rework_count
          END,
          parked_count = CASE
            WHEN excluded.total_count = 0 AND title_keyword_batches.total_count > 0 THEN title_keyword_batches.parked_count
            ELSE excluded.parked_count
          END,
          ordinary_new_limit = COALESCE(excluded.ordinary_new_limit, title_keyword_batches.ordinary_new_limit),
          candidate_count = COALESCE(excluded.candidate_count, title_keyword_batches.candidate_count),
          newest_capture_at = COALESCE(NULLIF(excluded.newest_capture_at, ''), title_keyword_batches.newest_capture_at),
          oldest_capture_at = COALESCE(NULLIF(excluded.oldest_capture_at, ''), title_keyword_batches.oldest_capture_at),
          notes = CASE
            WHEN excluded.total_count = 0 AND title_keyword_batches.total_count > 0 THEN title_keyword_batches.notes
            ELSE excluded.notes
          END
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


def _ensure_placeholder_proposal(
    conn: sqlite3.Connection,
    media_id: str,
    attempt: int,
    batch_id: str,
    proposed_at: str,
    title: Any = "",
    keywords: Any = "",
    status: str = "compatibility-placeholder",
) -> None:
    if batch_id and not conn.execute("SELECT 1 FROM title_keyword_batches WHERE batch_id = ?", (batch_id,)).fetchone():
        _upsert_batch(conn, {"batch_id": batch_id, "generated_at": proposed_at, "selection": {"total_count": 0}}, "placeholder")
    existing = conn.execute(
        "SELECT 1 FROM title_keyword_proposals WHERE media_id = ? AND attempt = ?",
        (media_id, attempt),
    ).fetchone()
    if existing:
        return
    clean_title = str(title or "").strip()
    clean_keywords = _keywords_text(_normalized_keywords(keywords))
    has_review_context = bool(clean_title or clean_keywords)
    conn.execute(
        """
        INSERT INTO title_keyword_proposals
          (media_id, attempt, batch_id, previous_title, previous_keywords, proposed_title,
           proposed_keywords, proposal_status, confidence, needs_owner_context,
           proposal_reason, removed_blacklisted, keyword_target, keyword_target_met,
           generator_model, generator_model_level, generator_model_maxed, model_ladder,
           proposed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', NULL, NULL,
                ?, NULL, 0, ?, ?)
        """,
        (
            media_id,
            attempt,
            batch_id,
            clean_title,
            clean_keywords,
            clean_title,
            clean_keywords,
            status if has_review_context else "compatibility-placeholder",
            "medium" if has_review_context else "low",
            0 if has_review_context else 1,
            "Created from Owner review decision context." if has_review_context else "",
            "owner-review-decision" if has_review_context else "legacy-json-import",
            json.dumps(["owner-review-decision"] if has_review_context else [], ensure_ascii=False),
            proposed_at,
        ),
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
    review_requested_at: str = "",
    review_requested_by: str = "",
    review_request_source: str = "",
    review_request_context: Any = None,
    allow_approved_reentry: bool = False,
) -> None:
    existing = conn.execute("SELECT * FROM title_keyword_queue WHERE media_id = ?", (media_id,)).fetchone()
    if (
        existing
        and str(existing["review_state"] or "") in TITLE_KEYWORD_APPROVED_STATES
        and review_state in TITLE_KEYWORD_ACTIVE_REVIEW_STATES
        and not allow_approved_reentry
    ):
        return
    first_batch = existing["first_proposed_batch_id"] if existing else batch_id
    first_at = existing["first_proposed_at"] if existing else proposed_at
    if isinstance(review_request_context, (dict, list)):
        review_request_context_text = json.dumps(review_request_context, ensure_ascii=False, sort_keys=True)
    else:
        review_request_context_text = str(review_request_context or "").strip()
    conn.execute(
        """
        INSERT INTO title_keyword_queue (
          media_id, review_state, latest_attempt, first_proposed_batch_id,
          latest_proposed_batch_id, first_proposed_at, latest_proposed_at,
          reviewed_at, applied_at, rework_priority, rejected_count,
          owner_comment, review_requested_at, review_requested_by,
          review_request_source, review_request_context, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(media_id) DO UPDATE SET
          review_state = CASE
            WHEN title_keyword_queue.review_state = 'parked' AND excluded.review_state = 'rejected' THEN 'parked'
            ELSE excluded.review_state
          END,
          latest_attempt = max(title_keyword_queue.latest_attempt, excluded.latest_attempt),
          latest_proposed_batch_id = COALESCE(NULLIF(excluded.latest_proposed_batch_id, ''), title_keyword_queue.latest_proposed_batch_id),
          latest_proposed_at = COALESCE(NULLIF(excluded.latest_proposed_at, ''), title_keyword_queue.latest_proposed_at),
          reviewed_at = CASE
            WHEN excluded.review_state = 'proposed' THEN NULL
            ELSE COALESCE(NULLIF(excluded.reviewed_at, ''), title_keyword_queue.reviewed_at)
          END,
          applied_at = CASE
            WHEN excluded.review_state = 'proposed' THEN NULL
            ELSE COALESCE(NULLIF(excluded.applied_at, ''), title_keyword_queue.applied_at)
          END,
          rework_priority = CASE
            WHEN title_keyword_queue.review_state = 'parked' AND excluded.review_state = 'rejected' THEN 0
            ELSE excluded.rework_priority
          END,
          rejected_count = max(title_keyword_queue.rejected_count, excluded.rejected_count),
          owner_comment = COALESCE(NULLIF(excluded.owner_comment, ''), title_keyword_queue.owner_comment),
          review_requested_at = CASE
            WHEN NULLIF(excluded.review_requested_at, '') IS NOT NULL THEN excluded.review_requested_at
            ELSE title_keyword_queue.review_requested_at
          END,
          review_requested_by = CASE
            WHEN NULLIF(excluded.review_requested_by, '') IS NOT NULL THEN excluded.review_requested_by
            ELSE title_keyword_queue.review_requested_by
          END,
          review_request_source = CASE
            WHEN NULLIF(excluded.review_request_source, '') IS NOT NULL THEN excluded.review_request_source
            ELSE title_keyword_queue.review_request_source
          END,
          review_request_context = CASE
            WHEN NULLIF(excluded.review_request_context, '') IS NOT NULL THEN excluded.review_request_context
            ELSE title_keyword_queue.review_request_context
          END,
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
            review_requested_at or "",
            review_requested_by or "",
            review_request_source or "",
            review_request_context_text,
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
    blacklist_rules = _keyword_blacklist_rules(conn)
    _upsert_batch(conn, payload, relative_path)
    for item in payload.get("photos") or []:
        if not isinstance(item, dict):
            continue
        media_id = str(item.get("photo_id") or item.get("photoId") or "").strip()
        if not media_id:
            continue
        existing_queue = conn.execute(
            "SELECT review_state FROM title_keyword_queue WHERE media_id = ?",
            (media_id,),
        ).fetchone()
        if existing_queue and str(existing_queue["review_state"] or "") in TITLE_KEYWORD_APPROVED_STATES:
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
        generator_model_level = _optional_int(
            generator.get("model_level")
            if generator.get("model_level") is not None
            else proposed.get("generator_model_level")
        )
        generator_model_maxed = _truthy(generator.get("model_maxed") or proposed.get("generator_model_maxed"))
        model_ladder = generator.get("model_ladder") or proposed.get("model_ladder") or []
        removed_blacklisted = changes.get("removed_blacklisted") or []
        previous_keywords = _reviewable_keywords(
            current.get("keywords") or current.get("keywords_raw") or "",
            blacklist_rules,
            removed_blacklisted,
        )
        proposed_keywords = _proposal_keywords_with_floor(
            previous_keywords,
            proposed.get("keywords") or "",
            blacklist_rules,
            removed_blacklisted,
        )
        keyword_target = _optional_int(changes.get("keyword_target"))
        keyword_target_met = _truthy(changes.get("keyword_target_met"))
        if keyword_target is not None and len(proposed_keywords) >= keyword_target:
            keyword_target_met = 1
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
                _keywords_text(previous_keywords),
                str(proposed.get("title") or ""),
                _keywords_text(proposed_keywords),
                str(proposed.get("status") or ""),
                str(proposed.get("confidence") or "") or None,
                1 if str(proposed.get("status") or "") == "needs_owner_context" else 0,
                str(proposed.get("reason") or ""),
                json.dumps(removed_blacklisted, ensure_ascii=False),
                keyword_target,
                keyword_target_met,
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


def _catalog_keyword_lookup(catalog_conn: sqlite3.Connection) -> dict[int, str]:
    return {
        int(row["keyword_id"]): str(row["keyword"])
        for row in catalog_conn.execute("SELECT keyword_id, keyword FROM keyword_terms")
    }


def _catalog_keywords(keyword_ids: Any, keyword_lookup: dict[int, str]) -> list[str]:
    keywords: list[str] = []
    for item in str(keyword_ids or "").split(","):
        try:
            keyword_id = int(item.strip())
        except ValueError:
            continue
        keyword = keyword_lookup.get(keyword_id)
        if keyword:
            keywords.append(keyword)
    return keywords


def _catalog_keywords_by_media_id(repo_root: Path, media_ids: list[str]) -> dict[str, list[str]]:
    clean_ids = [str(media_id or "").strip() for media_id in media_ids if str(media_id or "").strip()]
    if not clean_ids:
        return {}
    catalog_path = repo_root / "assets/catalog/photosbyelie.sqlite"
    if not catalog_path.exists():
        return {}
    catalog_conn = sqlite3.connect(catalog_path)
    catalog_conn.row_factory = sqlite3.Row
    try:
        keyword_lookup = _catalog_keyword_lookup(catalog_conn)
        result: dict[str, list[str]] = {}
        for index in range(0, len(clean_ids), 500):
            chunk = clean_ids[index:index + 500]
            placeholders = ",".join("?" for _ in chunk)
            rows = catalog_conn.execute(
                f"SELECT media_id, keyword_ids FROM media_items WHERE media_id IN ({placeholders})",
                chunk,
            ).fetchall()
            for row in rows:
                result[str(row["media_id"])] = _catalog_keywords(row["keyword_ids"], keyword_lookup)
        return result
    finally:
        catalog_conn.close()


def _catalog_title_keyword_metadata(repo_root: Path, media_id: str) -> dict[str, Any]:
    media_id = str(media_id or "").strip()
    if not media_id:
        raise ValueError("media_id must be a non-empty string")
    catalog_path = repo_root / "assets/catalog/photosbyelie.sqlite"
    if not catalog_path.exists():
        raise FileNotFoundError(f"missing public catalog: {catalog_path}")
    catalog_conn = sqlite3.connect(catalog_path)
    catalog_conn.row_factory = sqlite3.Row
    try:
        keyword_lookup = _catalog_keyword_lookup(catalog_conn)
        row = catalog_conn.execute(
            """
            SELECT media_id, title, keyword_ids, captured_at
            FROM media_items
            WHERE media_id = ?
            """,
            (media_id,),
        ).fetchone()
        if not row:
            raise ValueError(f"photo not found in current catalog: {media_id}")
        return {
            "media_id": str(row["media_id"] or ""),
            "title": str(row["title"] or "").strip() or media_id,
            "keywords": _catalog_keywords(row["keyword_ids"], keyword_lookup),
            "captured_at": str(row["captured_at"] or ""),
        }
    finally:
        catalog_conn.close()


def queue_title_keyword_review_photo(
    repo_root: Path,
    media_id: str,
    db_path: Path | None = None,
    *,
    requested_by: str = "owner",
    source: str = "owner-gallery-r",
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Queue a catalog photo for manual title/keyword review from Owner mode."""
    media_id = str(media_id or "").strip()
    if not media_id:
        raise ValueError("media_id must be a non-empty string")
    catalog = _catalog_title_keyword_metadata(repo_root, media_id)
    conn = connect(repo_root, db_path)
    proposed_at = now_iso()
    batch_id = f"manual-title-keyword-review-{proposed_at[:10]}"
    requested_by = str(requested_by or "owner").strip() or "owner"
    source = str(source or "owner-gallery-r").strip() or "owner-gallery-r"
    context_payload = {
        **(context if isinstance(context, dict) else {}),
        "source": source,
        "requested_by": requested_by,
        "requested_at": proposed_at,
    }
    owner_note = f"Queued for Owner re-review from {source}."
    try:
        existing_queue = conn.execute(
            """
            SELECT review_state, latest_attempt, latest_proposed_batch_id, rejected_count
            FROM title_keyword_queue
            WHERE media_id = ?
            """,
            (media_id,),
        ).fetchone()
        if existing_queue and existing_queue["review_state"] == "proposed":
            attempt = int(existing_queue["latest_attempt"] or 1)
            existing_batch_id = str(existing_queue["latest_proposed_batch_id"] or "")
            if conn.execute(
                "SELECT 1 FROM title_keyword_proposals WHERE media_id = ? AND attempt = ?",
                (media_id, attempt),
            ).fetchone():
                return {
                    "db": (db_path or DEFAULT_DB).as_posix(),
                    "photo_id": media_id,
                    "batch_id": existing_batch_id,
                    "attempt": attempt,
                    "queued": False,
                    "already_pending": True,
                    "review_request_source": source,
                    "review_request_context": context_payload,
                    "title": catalog["title"],
                    "keywords": catalog["keywords"],
                }
            batch_id = existing_batch_id or batch_id
        else:
            proposal_row = conn.execute(
                "SELECT max(attempt) FROM title_keyword_proposals WHERE media_id = ?",
                (media_id,),
            ).fetchone()
            latest_proposal_attempt = int(proposal_row[0] or 0) if proposal_row else 0
            latest_queue_attempt = int(existing_queue["latest_attempt"] or 0) if existing_queue else 0
            attempt = max(latest_proposal_attempt, latest_queue_attempt) + 1
            if attempt <= 1 and not latest_proposal_attempt and not latest_queue_attempt:
                attempt = 1

        rules = _keyword_blacklist_rules(conn)
        source_keywords = _normalized_keywords(catalog["keywords"])
        review_keywords = _reviewable_keywords(source_keywords, rules)
        review_keys = {keyword.casefold() for keyword in review_keywords}
        removed_blacklisted = [
            keyword
            for keyword in source_keywords
            if keyword.casefold() not in review_keys
            and keyword.casefold() not in TITLE_KEYWORD_STATE_FLAGS
        ]
        capture_at = str(catalog.get("captured_at") or "")
        _upsert_batch(
            conn,
            {
                "batch_id": batch_id,
                "generated_at": proposed_at,
                "selection": {
                    "total_count": 1,
                    "ordinary_new_count": 1,
                    "rework_count": 0,
                    "parked_count": 0,
                    "candidate_count": 1,
                },
                "range": {"newest": capture_at, "oldest": capture_at},
            },
            "manual-owner-shortcut",
        )
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
                catalog["title"],
                _keywords_text(review_keywords),
                catalog["title"],
                _keywords_text(review_keywords),
                "manual-owner-review",
                "medium",
                0,
                owner_note,
                json.dumps(removed_blacklisted, ensure_ascii=False),
                None,
                None,
                source,
                None,
                0,
                json.dumps([source], ensure_ascii=False),
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
            rejected_count=int(existing_queue["rejected_count"] or 0) if existing_queue else 0,
            owner_comment=owner_note,
            review_requested_at=proposed_at,
            review_requested_by=requested_by,
            review_request_source=source,
            review_request_context=context_payload,
            allow_approved_reentry=True,
        )
        conn.execute(
            """
            UPDATE title_keyword_queue
            SET review_state = 'proposed',
                latest_attempt = ?,
                latest_proposed_batch_id = ?,
                latest_proposed_at = ?,
                reviewed_at = NULL,
                applied_at = NULL,
                rework_priority = 0,
                owner_comment = ?,
                review_requested_at = ?,
                review_requested_by = ?,
                review_request_source = ?,
                review_request_context = ?,
                updated_at = ?
            WHERE media_id = ?
            """,
            (
                attempt,
                batch_id,
                proposed_at,
                owner_note,
                proposed_at,
                requested_by,
                source,
                json.dumps(context_payload, ensure_ascii=False, sort_keys=True),
                proposed_at,
                media_id,
            ),
        )
        pending_count = int(conn.execute(
            """
            SELECT COUNT(*)
            FROM title_keyword_queue
            WHERE review_state = 'proposed'
              AND latest_proposed_batch_id = ?
            """,
            (batch_id,),
        ).fetchone()[0] or 0)
        conn.execute(
            """
            UPDATE title_keyword_batches
            SET total_count = ?,
                ordinary_new_count = ?,
                candidate_count = ?,
                newest_capture_at = COALESCE(NULLIF(?, ''), newest_capture_at),
                oldest_capture_at = COALESCE(NULLIF(?, ''), oldest_capture_at)
            WHERE batch_id = ?
            """,
            (pending_count, pending_count, pending_count, capture_at, capture_at, batch_id),
        )
        _set_setting(conn, "title_keyword_review_dir", TITLE_KEYWORD_REVIEW_ROOT.as_posix())
        conn.commit()
        return {
            "db": (db_path or DEFAULT_DB).as_posix(),
            "photo_id": media_id,
            "batch_id": batch_id,
            "attempt": attempt,
            "queued": True,
            "already_pending": False,
            "pending_count": pending_count,
            "review_requested_at": proposed_at,
            "review_requested_by": requested_by,
            "review_request_source": source,
            "review_request_context": context_payload,
            "title": catalog["title"],
            "keywords": review_keywords,
        }
    finally:
        conn.close()


def queue_title_keyword_review_photos(
    repo_root: Path,
    media_ids: Iterable[str],
    db_path: Path | None = None,
    *,
    requested_by: str = "owner",
    source: str = "owner-gallery-review-all-visible",
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Queue multiple catalog photos for explicit Owner title/keyword re-review."""
    normalized_ids: list[str] = []
    seen: set[str] = set()
    for media_id in media_ids:
        clean_id = str(media_id or "").strip()
        if not clean_id or clean_id in seen:
            continue
        seen.add(clean_id)
        normalized_ids.append(clean_id)
    if not normalized_ids:
        raise ValueError("media_ids must include at least one photo id")
    operation_id = str((context or {}).get("operation_id") or uuid.uuid4())
    batch_context = {
        **(context if isinstance(context, dict) else {}),
        "operation_id": operation_id,
        "affected_count": len(normalized_ids),
    }
    queued = 0
    already_pending = 0
    failed: list[dict[str, str]] = []
    batch_ids: set[str] = set()
    for media_id in normalized_ids:
        try:
            result = queue_title_keyword_review_photo(
                repo_root,
                media_id,
                db_path,
                requested_by=requested_by,
                source=source,
                context=batch_context,
            )
        except Exception as error:  # noqa: BLE001 - caller needs per-row failures in the local helper response.
            failed.append({"photo_id": media_id, "error": str(error)})
            continue
        if result.get("queued"):
            queued += 1
        if result.get("already_pending"):
            already_pending += 1
        if result.get("batch_id"):
            batch_ids.add(str(result["batch_id"]))
    return {
        "db": (db_path or DEFAULT_DB).as_posix(),
        "requested_count": len(normalized_ids),
        "queued_count": queued,
        "already_pending_count": already_pending,
        "failed_count": len(failed),
        "failed": failed,
        "batch_ids": sorted(batch_ids),
        "operation_id": operation_id,
        "review_request_source": source,
        "review_request_context": batch_context,
    }


def repair_title_keyword_proposal_keywords(repo_root: Path, db_path: Path | None = None) -> dict[str, Any]:
    """Ensure active proposals do not drop existing non-blacklisted catalog keywords."""
    conn = connect(repo_root, db_path)
    try:
        rules = _keyword_blacklist_rules(conn)
        rows = conn.execute(
            """
            SELECT q.media_id, q.latest_attempt,
                   p.previous_keywords, p.proposed_keywords,
                   p.removed_blacklisted, p.keyword_target, p.keyword_target_met
            FROM title_keyword_queue AS q
            JOIN title_keyword_proposals AS p
              ON p.media_id = q.media_id
             AND p.attempt = q.latest_attempt
            WHERE q.review_state = 'proposed'
            ORDER BY q.latest_proposed_at DESC, q.media_id
            """
        ).fetchall()
        catalog_keywords = _catalog_keywords_by_media_id(repo_root, [str(row["media_id"] or "") for row in rows])
        repaired = 0
        previous_repaired = 0
        proposed_repaired = 0
        for row in rows:
            media_id = str(row["media_id"] or "")
            attempt = int(row["latest_attempt"] or 1)
            removed_blacklisted = _read_json_text(str(row["removed_blacklisted"] or ""), [])
            previous_sources = [
                *_split_keyword_text(row["previous_keywords"] or ""),
                *catalog_keywords.get(media_id, []),
            ]
            previous_keywords = _reviewable_keywords(previous_sources, rules, removed_blacklisted)
            proposed_keywords = _proposal_keywords_with_floor(
                previous_keywords,
                row["proposed_keywords"] or "",
                rules,
                removed_blacklisted,
            )
            next_previous = _keywords_text(previous_keywords)
            next_proposed = _keywords_text(proposed_keywords)
            current_previous = _keywords_text(_reviewable_keywords(row["previous_keywords"] or "", rules, removed_blacklisted))
            current_proposed = _keywords_text(_reviewable_keywords(row["proposed_keywords"] or "", rules, removed_blacklisted))
            target = _optional_int(row["keyword_target"])
            target_met = row["keyword_target_met"]
            if target is not None:
                target_met = 1 if len(proposed_keywords) >= target else 0
            if next_previous == current_previous and next_proposed == current_proposed and target_met == row["keyword_target_met"]:
                continue
            conn.execute(
                """
                UPDATE title_keyword_proposals
                SET previous_keywords = ?,
                    proposed_keywords = ?,
                    keyword_target_met = ?
                WHERE media_id = ? AND attempt = ?
                """,
                (next_previous, next_proposed, target_met, media_id, attempt),
            )
            repaired += 1
            if next_previous != current_previous:
                previous_repaired += 1
            if next_proposed != current_proposed:
                proposed_repaired += 1
        conn.commit()
        return {
            "db": (db_path or DEFAULT_DB).as_posix(),
            "inspected": len(rows),
            "repaired": repaired,
            "previous_repaired": previous_repaired,
            "proposed_repaired": proposed_repaired,
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
                review_state="approved",
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
            _ensure_placeholder_proposal(
                conn,
                media_id,
                attempt,
                batch_id,
                decided_at,
                title,
                keywords,
                f"owner-review-{state}",
            )
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
            elif state == "not_found":
                queue_state = "blocked"
            else:
                queue_state = "approved" if state == "accepted" else state
            _upsert_queue(
                conn,
                media_id=media_id,
                review_state=queue_state if queue_state != "accepted" else "approved",
                latest_attempt=attempt,
                batch_id=batch_id,
                reviewed_at=decided_at,
                applied_at=applied_at if state == "accepted" else "",
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
                rejected_title = str(item.get("title") or "")
                rejected_keywords = item.get("keywords") or ""
                insert_decision(
                    str(item.get("photo_id") or ""),
                    "rejected",
                    rejected_title,
                    rejected_keywords,
                    _rejection_comment_with_proposal_context(
                        item.get("comment"),
                        rejected_title,
                        rejected_keywords,
                    ),
                )
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


def clear_title_keyword_review_blocks(
    repo_root: Path,
    batch_id: str,
    photo_ids: list[str],
    *,
    decided_at: str = "",
    db_path: Path | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    owns_conn = conn is None
    conn = conn or connect(repo_root, db_path)
    decided_at = decided_at or now_iso()
    normalized_ids: list[str] = []
    for photo_id in photo_ids:
        media_id = str(photo_id or "").strip()
        if media_id and media_id not in normalized_ids:
            normalized_ids.append(media_id)
    try:
        unblocked = 0
        missing = 0
        skipped = 0
        decisions_deleted = 0
        for media_id in normalized_ids:
            row = conn.execute(
                "SELECT review_state, latest_attempt FROM title_keyword_queue WHERE media_id = ?",
                (media_id,),
            ).fetchone()
            if not row:
                missing += 1
                continue
            if row["review_state"] != "blocked":
                skipped += 1
                continue
            attempt = max(1, int(row["latest_attempt"] or 1))
            result = conn.execute(
                """
                DELETE FROM title_keyword_decisions
                WHERE media_id = ?
                  AND attempt = ?
                  AND decision_state = 'blocked'
                """,
                (media_id, attempt),
            )
            decisions_deleted += result.rowcount if result.rowcount is not None else 0
            conn.execute(
                """
                UPDATE title_keyword_queue
                SET review_state = 'proposed',
                    reviewed_at = NULL,
                    applied_at = NULL,
                    rework_priority = 0,
                    owner_comment = '',
                    updated_at = ?
                WHERE media_id = ?
                """,
                (decided_at, media_id),
            )
            unblocked += 1
        _set_setting(conn, "title_keyword_review_dir", TITLE_KEYWORD_REVIEW_ROOT.as_posix())
        conn.commit()
        return {
            "db": (db_path or DEFAULT_DB).as_posix(),
            "batch_id": batch_id,
            "unblocked": unblocked,
            "missing": missing,
            "skipped": skipped,
            "decisions_deleted": decisions_deleted,
        }
    finally:
        if owns_conn:
            conn.close()


def import_owner_actions(repo_root: Path, db_path: Path | None = None, *, force: bool = False) -> None:
    conn = connect(repo_root, db_path)
    try:
        import_keyword_blacklist(repo_root, conn, force=force)
        import_country_assignments(repo_root, conn, force=force)
        import_title_keyword_review(repo_root, conn, force=force)
        sync_media_lifecycle_from_compat(repo_root, conn=conn, db_path=db_path)
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
        counts = {
            "accepted": 0,
            "approved": 0,
            "submitted_unchecked": 0,
            "rejected": 0,
            "parked": 0,
            "blocked": 0,
        }
        for row in rows:
            state = row["review_state"]
            count = int(row["count"])
            if state in TITLE_KEYWORD_APPROVED_STATES:
                counts["approved"] += count
            elif state == "proposed" and row["rework_priority"]:
                counts["rejected"] += count
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
                   p.model_ladder AS latest_model_ladder,
                   p.proposed_title AS latest_proposal_title,
                   p.proposed_keywords AS latest_proposal_keywords,
                   p.proposal_status AS latest_proposal_status,
                   p.proposal_reason AS latest_proposal_reason
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
                "latest_proposal_title": row["latest_proposal_title"] or "",
                "latest_proposal_keywords": _split_keyword_text(row["latest_proposal_keywords"] or ""),
                "latest_proposal_status": row["latest_proposal_status"] or "",
                "latest_proposal_reason": row["latest_proposal_reason"] or "",
                "review_requested_at": row["review_requested_at"] or "",
                "review_requested_by": row["review_requested_by"] or "",
                "review_request_source": row["review_request_source"] or "",
                "review_request_context": _read_json_text(row["review_request_context"] or "", {}),
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
    parser.add_argument("--repair-title-keyword-proposal-keywords", action="store_true")
    parser.add_argument("--title-keyword-generator-state-json", action="store_true")
    parser.add_argument("--park-retry-exhausted", action="store_true")
    parser.add_argument("--park-twice-rejected", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--import-keyword-blacklist", action="store_true")
    parser.add_argument("--export-keyword-blacklist", action="store_true")
    parser.add_argument("--import-discarded-r2-manifest", action="store_true")
    parser.add_argument("--sync-media-lifecycle", action="store_true")
    parser.add_argument("--media-lifecycle-json", action="store_true")
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
    elif args.media_lifecycle_json:
        print(json.dumps(media_lifecycle_snapshot(repo_root, args.db), ensure_ascii=False))
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
            if args.sync_media_lifecycle:
                sync_media_lifecycle_from_compat(repo_root, conn=conn, db_path=args.db)
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
            if args.repair_title_keyword_proposal_keywords:
                conn.close()
                result = repair_title_keyword_proposal_keywords(repo_root, args.db)
                print(
                    "title_keyword_proposals "
                    f"keywords_repaired={result['repaired']} "
                    f"previous_repaired={result['previous_repaired']} "
                    f"proposed_repaired={result['proposed_repaired']} "
                    f"inspected={result['inspected']}"
                )
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
            f"active {counts['submitted_unchecked'] + counts['rejected']} / "
            f"approved {counts['approved']} / "
            f"submitted-unchecked {counts['submitted_unchecked']} / "
            f"rejected {counts['rejected']} / "
            f"parked {counts['parked']}"
        )
    else:
        conn = connect(repo_root, args.db)
        try:
            tables = ["keyword_blacklist", "country_assignments", "title_keyword_batches", "title_keyword_queue", "title_keyword_proposals", "title_keyword_decisions", "r2_objects", "media_lifecycle"]
            print(", ".join(f"{table}={conn.execute(f'SELECT count(*) FROM {table}').fetchone()[0]}" for table in tables))
        finally:
            conn.close()


if __name__ == "__main__":
    main()
