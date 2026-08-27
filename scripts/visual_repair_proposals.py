#!/usr/bin/env python3
"""Local, draft-only visual repair proposals for the RE review subtree.

This module deliberately stores references and provenance, never image bytes.
The only generator accepted here is an explicitly enabled synthetic test
generator; production image generation remains an open configuration gate.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from typing import Any, Iterable
import uuid

from fixture_pipeline import connect as fixture_connect
from fixture_pipeline import connect_read_only as fixture_connect_read_only
from owner_state_db import (
    DEFAULT_TITLE_KEYWORD_MODEL_LADDER,
    TITLE_KEYWORD_MODEL_LADDER_SETTING,
    normalize_title_keyword_model_ladder,
)


VISUAL_REPAIR_CATEGORIES = (
    "lighting-exposure",
    "contrast",
    "white-balance-color",
    "perspective-geometry",
    "distracting-items",
)
VISUAL_REPAIR_CATEGORY_LABELS = {
    "lighting-exposure": "Lighting / exposure",
    "contrast": "Contrast",
    "white-balance-color": "White balance / color",
    "perspective-geometry": "Perspective / geometry",
    "distracting-items": "Distracting items",
}
VISUAL_REPAIR_STATUSES = {"draft", "accepted", "rejected", "superseded"}
VISUAL_REPAIR_ACTIONS = {"accept", "reject", "regenerate"}
VISUAL_REPAIR_SCHEMA_VERSION = 2
SYNTHETIC_GENERATOR = "synthetic"
SYNTHETIC_GENERATOR_ENV = "PBE_ENABLE_SYNTHETIC_VISUAL_REPAIR"
SYNTHETIC_OPENAI_PROVIDER_PREFIX = "openai-synthetic://"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _read_json(value: Any, fallback: Any) -> Any:
    try:
        parsed = json.loads(str(value or ""))
    except json.JSONDecodeError:
        return fallback
    return parsed


def _row_value(row: sqlite3.Row, name: str, fallback: Any = "") -> Any:
    return row[name] if name in row.keys() else fallback


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS visual_repair_proposals (
          proposal_id TEXT PRIMARY KEY CHECK (trim(proposal_id) <> ''),
          fixture_id TEXT NOT NULL CHECK (trim(fixture_id) <> ''),
          asset_id TEXT NOT NULL CHECK (trim(asset_id) <> ''),
          source_version_id TEXT NOT NULL CHECK (trim(source_version_id) <> ''),
          defect_categories_json TEXT NOT NULL,
          ladder_rung INTEGER NOT NULL CHECK (ladder_rung >= 1),
          model_ladder_json TEXT NOT NULL,
          requested_generator_model TEXT NOT NULL,
          resolved_model TEXT NOT NULL,
          reasoning_effort TEXT NOT NULL,
          vision INTEGER NOT NULL DEFAULT 1 CHECK (vision = 1),
          attempt INTEGER NOT NULL CHECK (attempt >= 1),
          status TEXT NOT NULL CHECK (status IN ('draft', 'accepted', 'rejected', 'superseded')),
          original_reference TEXT NOT NULL,
          derived_reference TEXT NOT NULL,
          derived_available INTEGER NOT NULL DEFAULT 1 CHECK (derived_available IN (0, 1)),
          generator_reference TEXT NOT NULL,
          request_fingerprint TEXT NOT NULL,
          idempotency_key TEXT NOT NULL UNIQUE,
          previous_proposal_id TEXT,
          decision_reason TEXT NOT NULL DEFAULT '',
          generated_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          decided_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_visual_repair_proposals_scope
          ON visual_repair_proposals(fixture_id, asset_id, status, attempt DESC);
        CREATE INDEX IF NOT EXISTS idx_visual_repair_proposals_source
          ON visual_repair_proposals(source_version_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS visual_repair_events (
          event_id TEXT PRIMARY KEY CHECK (trim(event_id) <> ''),
          proposal_id TEXT NOT NULL,
          action TEXT NOT NULL,
          before_status TEXT NOT NULL DEFAULT '',
          after_status TEXT NOT NULL DEFAULT '',
          related_proposal_id TEXT NOT NULL DEFAULT '',
          idempotency_key TEXT NOT NULL UNIQUE,
          reason TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          FOREIGN KEY (proposal_id) REFERENCES visual_repair_proposals(proposal_id)
        );
        CREATE INDEX IF NOT EXISTS idx_visual_repair_events_proposal
          ON visual_repair_events(proposal_id, created_at, event_id);
        """
    )
    columns = {
        str(row["name"])
        for row in conn.execute("PRAGMA table_info(visual_repair_proposals)").fetchall()
    }
    additions = {
        "original_preview_reference": "TEXT NOT NULL DEFAULT ''",
        "original_preview_sha256": "TEXT NOT NULL DEFAULT ''",
        "derived_sha256": "TEXT NOT NULL DEFAULT ''",
        "materialized_at": "TEXT",
    }
    for name, declaration in additions.items():
        if name not in columns:
            conn.execute(
                f"ALTER TABLE visual_repair_proposals ADD COLUMN {name} {declaration}"
            )


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    return bool(conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone())


def _fixture_chain(conn: sqlite3.Connection, fixture_id: str) -> list[sqlite3.Row]:
    chain: list[sqlite3.Row] = []
    seen: set[str] = set()
    current = str(fixture_id or "").strip()
    while current:
        if current in seen:
            raise ValueError("fixture tree contains a cycle")
        seen.add(current)
        row = conn.execute(
            "SELECT * FROM fixtures WHERE fixture_id = ?",
            (current,),
        ).fetchone()
        if not row:
            raise ValueError("fixture does not exist")
        chain.append(row)
        current = str(row["parent_fixture_id"] or "").strip()
    return list(reversed(chain))


def _require_re_scope(conn: sqlite3.Connection, fixture_id: str) -> list[sqlite3.Row]:
    chain = _fixture_chain(conn, fixture_id)
    root = chain[0]
    template = str(root["template_key"] or "").strip().casefold().replace("_", "-")
    name = str(root["name"] or "").strip().casefold()
    tags = {
        str(item).strip().casefold().replace("_", "-")
        for item in _read_json(root["tags_json"], [])
        if str(item).strip()
    }
    explicit_re = template in {"re", "real-estate", "real estate"}
    legacy_re = name in {"re", "real estate"}
    tagged_re = bool(tags & {"re", "real-estate", "real estate"})
    if not (explicit_re or legacy_re or tagged_re):
        raise ValueError("visual repair proposals are limited to the RE fixture subtree")
    return chain


def _normalize_categories(categories: Iterable[Any]) -> list[str]:
    requested = {str(item or "").strip().casefold() for item in categories}
    unknown = sorted(requested - set(VISUAL_REPAIR_CATEGORIES))
    if unknown:
        raise ValueError(f"unsupported visual repair category: {unknown[0]}")
    normalized = [item for item in VISUAL_REPAIR_CATEGORIES if item in requested]
    if not normalized:
        raise ValueError("choose at least one visual repair category")
    return normalized


def _model_ladder(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    if not _table_exists(conn, "owner_settings"):
        return [dict(item) for item in DEFAULT_TITLE_KEYWORD_MODEL_LADDER]
    row = conn.execute(
        "SELECT setting_value FROM owner_settings WHERE setting_key = ?",
        (TITLE_KEYWORD_MODEL_LADDER_SETTING,),
    ).fetchone()
    if not row:
        return [dict(item) for item in DEFAULT_TITLE_KEYWORD_MODEL_LADDER]
    try:
        value = _read_json(row["setting_value"], [])
        return normalize_title_keyword_model_ladder(value)
    except ValueError:
        return [dict(item) for item in DEFAULT_TITLE_KEYWORD_MODEL_LADDER]


def _review_asset_source(
    conn: sqlite3.Connection,
    fixture_chain: list[sqlite3.Row],
    asset_id: str,
    source_version_id: str,
) -> sqlite3.Row:
    asset = conn.execute(
        "SELECT asset_id FROM sidecar_assets WHERE asset_id = ?",
        (asset_id,),
    ).fetchone()
    if not asset:
        raise ValueError("asset is not present in the local Owner index")
    version = conn.execute(
        """
        SELECT *
        FROM asset_source_versions
        WHERE version_id = ? AND asset_id = ?
          AND source_exists = 1
          AND state != 'source-missing'
        """,
        (source_version_id, asset_id),
    ).fetchone()
    if not version:
        raise ValueError("source version is missing, mismatched, or unavailable")
    fixture_ids = [str(row["fixture_id"]) for row in fixture_chain]
    placeholders = ", ".join("?" for _ in fixture_ids)
    params = [*fixture_ids, asset_id]
    picked = conn.execute(
        f"""
        SELECT 1
        FROM fixture_asset_decisions
        WHERE fixture_id IN ({placeholders}) AND asset_id = ?
          AND placement_state = 'picked' AND eligibility_state = 'active'
        UNION ALL
        SELECT 1
        FROM fixture_asset_placements
        WHERE fixture_id IN ({placeholders}) AND asset_id = ? AND state = 'active'
        LIMIT 1
        """,
        [*params, *params],
    ).fetchone()
    if not picked:
        raise ValueError("asset is not an active picked item in the RE review subtree")
    return version


def _synthetic_gate(generator: str) -> None:
    if generator != SYNTHETIC_GENERATOR:
        raise ValueError(
            "production visual generation is not configured; only the explicit synthetic test generator is available"
        )
    if os.environ.get(SYNTHETIC_GENERATOR_ENV, "") != "1":
        raise ValueError(
            "synthetic visual generation is disabled outside an explicit test environment"
        )


def _request_fingerprint(
    fixture_id: str,
    asset_id: str,
    source_version_id: str,
    categories: list[str],
    ladder_rung: int,
    attempt: int,
) -> str:
    payload = {
        "fixtureId": fixture_id,
        "assetId": asset_id,
        "sourceVersionId": source_version_id,
        "defectCategories": categories,
        "ladderRung": ladder_rung,
        "attempt": attempt,
    }
    return hashlib.sha256(_json(payload).encode("utf-8")).hexdigest()


def _proposal_id(fingerprint: str, attempt: int) -> str:
    return f"visual-repair-{fingerprint[:20]}-{attempt}"


def _reference(prefix: str, proposal_id: str) -> str:
    digest = hashlib.sha256(proposal_id.encode("utf-8")).hexdigest()[:24]
    return f"synthetic://visual-repair/{prefix}/{digest}"


def _rendered_artifact(repo_root: Path, value: Path, label: str) -> tuple[str, str]:
    root = repo_root.expanduser().resolve()
    path = value.expanduser().resolve()
    try:
        path.relative_to(root)
    except ValueError as error:
        raise ValueError(f"{label} must be stored inside the bounded fixture root") from error
    if not path.is_file():
        raise ValueError(f"{label} is not a regular file")
    if path.suffix.casefold() not in {".jpg", ".jpeg", ".png", ".heic"}:
        raise ValueError(f"{label} must be a supported rendered image")
    payload = path.read_bytes()
    suffix = path.suffix.casefold()
    valid_signature = (
        (suffix == ".png" and payload.startswith(b"\x89PNG\r\n\x1a\n"))
        or (suffix in {".jpg", ".jpeg"} and payload.startswith(b"\xff\xd8\xff"))
        or (suffix == ".heic" and len(payload) >= 12 and payload[4:8] == b"ftyp")
    )
    if not valid_signature:
        raise ValueError(f"{label} does not contain a valid rendered image signature")
    return path.as_uri(), hashlib.sha256(payload).hexdigest()


def _proposal_json(row: sqlite3.Row, *, idempotent_replay: bool = False) -> dict[str, Any]:
    ladder = _read_json(row["model_ladder_json"], [])
    return {
        "proposalId": str(row["proposal_id"]),
        "fixtureId": str(row["fixture_id"]),
        "assetId": str(row["asset_id"]),
        "sourceVersionId": str(row["source_version_id"]),
        "defectCategories": _read_json(row["defect_categories_json"], []),
        "defectCategoryLabels": [
            VISUAL_REPAIR_CATEGORY_LABELS.get(item, item)
            for item in _read_json(row["defect_categories_json"], [])
        ],
        "ladderRung": int(row["ladder_rung"]),
        "modelLadder": ladder,
        "requestedGeneratorModel": str(row["requested_generator_model"]),
        "resolvedModel": str(row["resolved_model"]),
        "reasoningEffort": str(row["reasoning_effort"]),
        "vision": bool(row["vision"]),
        "attempt": int(row["attempt"]),
        "status": str(row["status"]),
        "originalReference": str(row["original_reference"]),
        "originalPreviewReference": str(_row_value(row, "original_preview_reference") or ""),
        "originalPreviewSha256": str(_row_value(row, "original_preview_sha256") or ""),
        "derivedReference": str(row["derived_reference"]),
        "derivedAvailable": bool(row["derived_available"]),
        "derivedSha256": str(_row_value(row, "derived_sha256") or ""),
        "generatorReference": str(row["generator_reference"]),
        "previousProposalId": str(row["previous_proposal_id"] or ""),
        "decisionReason": str(row["decision_reason"] or ""),
        "generatedAt": str(row["generated_at"]),
        "materializedAt": str(_row_value(row, "materialized_at") or ""),
        "createdAt": str(row["created_at"]),
        "updatedAt": str(row["updated_at"]),
        "decidedAt": str(row["decided_at"] or ""),
        "idempotentReplay": idempotent_replay,
        "readOnlyComparison": True,
    }


def materialize_visual_repair_proposal(
    repo_root: Path,
    proposal_id: str,
    original_preview_path: Path,
    derived_path: Path,
    *,
    provider_reference: str,
    idempotency_key: str = "",
    generated_at: str | None = None,
) -> dict[str, Any]:
    """Attach one approved synthetic before/after pair without invoking a provider."""
    _synthetic_gate(SYNTHETIC_GENERATOR)
    provider_reference = str(provider_reference or "").strip()
    if not provider_reference.startswith(SYNTHETIC_OPENAI_PROVIDER_PREFIX):
        raise ValueError("rendered synthetic artifacts require an OpenAI synthetic provider receipt")
    original_reference, original_sha256 = _rendered_artifact(
        repo_root, Path(original_preview_path), "original preview"
    )
    derived_reference, derived_sha256 = _rendered_artifact(
        repo_root, Path(derived_path), "derived proposal"
    )
    if original_sha256 == derived_sha256:
        raise ValueError("derived proposal must differ from the immutable original preview")
    with fixture_connect(repo_root) as conn:
        ensure_schema(conn)
        row = conn.execute(
            "SELECT * FROM visual_repair_proposals WHERE proposal_id = ?",
            (str(proposal_id or "").strip(),),
        ).fetchone()
        if not row:
            raise ValueError("visual repair proposal does not exist")
        chain = _require_re_scope(conn, str(row["fixture_id"]))
        _review_asset_source(conn, chain, str(row["asset_id"]), str(row["source_version_id"]))
        if str(row["status"]) != "draft":
            raise ValueError("only a draft visual repair proposal can receive a rendered artifact")
        key = str(idempotency_key or "").strip() or f"visual-materialize:{derived_sha256}"
        replay = _event_replay(conn, key)
        if replay:
            return _proposal_json(row, idempotent_replay=True)
        existing_original = str(row["original_preview_sha256"] or "")
        existing_derived = str(row["derived_sha256"] or "")
        if bool(row["derived_available"]):
            if existing_original == original_sha256 and existing_derived == derived_sha256:
                return _proposal_json(row, idempotent_replay=True)
            raise ValueError("rendered draft is already materialized and cannot be overwritten")
        timestamp = str(generated_at or now_iso())
        conn.execute(
            """
            UPDATE visual_repair_proposals
            SET original_preview_reference = ?, original_preview_sha256 = ?,
                derived_reference = ?, derived_sha256 = ?, derived_available = 1,
                generator_reference = ?, generated_at = ?, materialized_at = ?, updated_at = ?
            WHERE proposal_id = ?
            """,
            (
                original_reference,
                original_sha256,
                derived_reference,
                derived_sha256,
                provider_reference,
                timestamp,
                timestamp,
                timestamp,
                row["proposal_id"],
            ),
        )
        _record_event(
            conn,
            proposal_id=str(row["proposal_id"]),
            action="materialize",
            before_status="draft",
            after_status="draft",
            idempotency_key=key,
            reason="Attached one approved synthetic OpenAI before/after pair for read-only comparison.",
            created_at=timestamp,
        )
        conn.commit()
        updated = conn.execute(
            "SELECT * FROM visual_repair_proposals WHERE proposal_id = ?",
            (row["proposal_id"],),
        ).fetchone()
        return _proposal_json(updated)


def _event_replay(conn: sqlite3.Connection, idempotency_key: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM visual_repair_events WHERE idempotency_key = ?",
        (idempotency_key,),
    ).fetchone()


def _record_event(
    conn: sqlite3.Connection,
    *,
    proposal_id: str,
    action: str,
    before_status: str,
    after_status: str,
    related_proposal_id: str = "",
    idempotency_key: str,
    reason: str,
    created_at: str,
) -> None:
    conn.execute(
        """
        INSERT INTO visual_repair_events (
          event_id, proposal_id, action, before_status, after_status,
          related_proposal_id, idempotency_key, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            f"visual-event-{uuid.uuid4().hex}",
            proposal_id,
            action,
            before_status,
            after_status,
            related_proposal_id,
            idempotency_key,
            reason,
            created_at,
        ),
    )


def request_visual_repair_proposal(
    repo_root: Path,
    fixture_id: str,
    asset_id: str,
    source_version_id: str,
    defect_categories: Iterable[Any],
    *,
    generator: str = "",
    requested_generator_model: str = "",
    idempotency_key: str = "",
    generated_at: str | None = None,
) -> dict[str, Any]:
    _synthetic_gate(generator)
    fixture_id = str(fixture_id or "").strip()
    asset_id = str(asset_id or "").strip()
    source_version_id = str(source_version_id or "").strip()
    if not fixture_id or not asset_id or not source_version_id:
        raise ValueError("fixtureId, assetId, and sourceVersionId are required")
    categories = _normalize_categories(defect_categories)
    with fixture_connect(repo_root) as conn:
        ensure_schema(conn)
        chain = _require_re_scope(conn, fixture_id)
        _review_asset_source(conn, chain, asset_id, source_version_id)
        ladder = _model_ladder(conn)
        rung = 1
        if requested_generator_model:
            requested_generator_model = str(requested_generator_model).strip()
            matching = [index + 1 for index, item in enumerate(ladder) if item["model"] == requested_generator_model]
            if not matching:
                raise ValueError("requested visual generator model is not present in the configured ladder")
            rung = matching[0]
        selected = ladder[rung - 1]
        fingerprint = _request_fingerprint(
            fixture_id, asset_id, source_version_id, categories, rung, 1
        )
        key = str(idempotency_key or "").strip() or f"visual-request:{fingerprint}"
        replay = _event_replay(conn, f"{key}:request")
        if replay:
            row = conn.execute(
                "SELECT * FROM visual_repair_proposals WHERE proposal_id = ?",
                (replay["proposal_id"],),
            ).fetchone()
            if row:
                return _proposal_json(row, idempotent_replay=True)
        existing = conn.execute(
            "SELECT * FROM visual_repair_proposals WHERE idempotency_key = ?",
            (key,),
        ).fetchone()
        if existing:
            if str(existing["request_fingerprint"]) != fingerprint:
                raise ValueError("idempotency key was already used for a different visual repair request")
            return _proposal_json(existing, idempotent_replay=True)
        proposal_id = _proposal_id(fingerprint, 1)
        timestamp = str(generated_at or now_iso())
        conn.execute(
            """
            INSERT INTO visual_repair_proposals (
              proposal_id, fixture_id, asset_id, source_version_id,
              defect_categories_json, ladder_rung, model_ladder_json,
              requested_generator_model, resolved_model, reasoning_effort,
              vision, attempt, status, original_reference, derived_reference,
              derived_available, generator_reference, request_fingerprint,
              idempotency_key, generated_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'draft', ?, ?, 0, ?, ?, ?, ?, ?, ?)
            """,
            (
                proposal_id,
                fixture_id,
                asset_id,
                source_version_id,
                _json(categories),
                rung,
                _json(ladder),
                selected["model"],
                selected["model"],
                selected["effort"],
                f"immutable-source-version://{source_version_id}",
                _reference("derived", proposal_id),
                f"synthetic-generator://{SYNTHETIC_GENERATOR}",
                fingerprint,
                key,
                timestamp,
                timestamp,
                timestamp,
            ),
        )
        _record_event(
            conn,
            proposal_id=proposal_id,
            action="request",
            before_status="",
            after_status="draft",
            idempotency_key=f"{key}:request",
            reason="Synthetic visual repair draft requested; no image bytes were generated or retained.",
            created_at=timestamp,
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM visual_repair_proposals WHERE proposal_id = ?",
            (proposal_id,),
        ).fetchone()
        return _proposal_json(row)


def list_visual_repair_proposals(
    repo_root: Path,
    fixture_id: str,
    *,
    asset_ids: Iterable[Any] = (),
    include_history: bool = False,
) -> dict[str, Any]:
    fixture_id = str(fixture_id or "").strip()
    with fixture_connect_read_only(repo_root) as conn:
        chain = _require_re_scope(conn, fixture_id)
        if not _table_exists(conn, "visual_repair_proposals"):
            return {"fixtureId": fixture_id, "items": [], "count": 0, "readOnly": True}
        ids = [str(item or "").strip() for item in asset_ids if str(item or "").strip()]
        params: list[Any] = [fixture_id]
        scope_sql = "fixture_id = ?"
        if ids:
            placeholders = ", ".join("?" for _ in ids)
            scope_sql += f" AND asset_id IN ({placeholders})"
            params.extend(ids)
        if not include_history:
            scope_sql += " AND status != 'superseded'"
        rows = conn.execute(
            f"SELECT * FROM visual_repair_proposals WHERE {scope_sql} ORDER BY asset_id, attempt DESC, created_at DESC",
            params,
        ).fetchall()
        return {
            "fixtureId": fixture_id,
            "items": [_proposal_json(row) for row in rows],
            "count": len(rows),
            "readOnly": True,
            "scopeDepth": len(chain),
        }


def decide_visual_repair_proposal(
    repo_root: Path,
    proposal_id: str,
    action: str,
    *,
    fixture_id: str = "",
    reason: str = "",
    generator: str = "",
    idempotency_key: str = "",
    generated_at: str | None = None,
) -> dict[str, Any]:
    action = str(action or "").strip().casefold()
    if action not in VISUAL_REPAIR_ACTIONS:
        raise ValueError("visual repair decision must be accept, reject, or regenerate")
    with fixture_connect(repo_root) as conn:
        ensure_schema(conn)
        row = conn.execute(
            "SELECT * FROM visual_repair_proposals WHERE proposal_id = ?",
            (str(proposal_id or "").strip(),),
        ).fetchone()
        if not row:
            raise ValueError("visual repair proposal does not exist")
        actual_fixture_id = str(row["fixture_id"])
        if fixture_id and str(fixture_id).strip() != actual_fixture_id:
            raise ValueError("proposal fixture does not match the requested RE review scope")
        chain = _require_re_scope(conn, actual_fixture_id)
        _review_asset_source(conn, chain, str(row["asset_id"]), str(row["source_version_id"]))
        key = str(idempotency_key or "").strip() or f"visual-{action}:{row['proposal_id']}"
        replay = _event_replay(conn, key)
        if replay:
            replay_id = str(replay["related_proposal_id"] or replay["proposal_id"])
            replay_row = conn.execute(
                "SELECT * FROM visual_repair_proposals WHERE proposal_id = ?",
                (replay_id,),
            ).fetchone()
            if replay_row:
                return _proposal_json(replay_row, idempotent_replay=True)
        status = str(row["status"])
        if action in {"accept", "reject"}:
            if status == action + "ed":
                return _proposal_json(row, idempotent_replay=True)
            if status != "draft":
                raise ValueError(f"cannot {action} a visual repair proposal in {status} state")
            if action == "accept" and not bool(row["derived_available"]):
                raise ValueError("cannot accept a visual repair proposal without a rendered derived image")
            timestamp = str(generated_at or now_iso())
            derived_available = 1 if action == "accept" else 0
            conn.execute(
                """
                UPDATE visual_repair_proposals
                SET status = ?, derived_available = ?, decision_reason = ?,
                    decided_at = ?, updated_at = ?
                WHERE proposal_id = ?
                """,
                (
                    "accepted" if action == "accept" else "rejected",
                    derived_available,
                    str(reason or ""),
                    timestamp,
                    timestamp,
                    row["proposal_id"],
                ),
            )
            _record_event(
                conn,
                proposal_id=str(row["proposal_id"]),
                action=action,
                before_status=status,
                after_status="accepted" if action == "accept" else "rejected",
                idempotency_key=key,
                reason=str(reason or ""),
                created_at=timestamp,
            )
            conn.commit()
            updated = conn.execute(
                "SELECT * FROM visual_repair_proposals WHERE proposal_id = ?",
                (row["proposal_id"],),
            ).fetchone()
            return _proposal_json(updated)
        _synthetic_gate(generator)
        if status not in {"draft", "rejected"}:
            raise ValueError(f"cannot regenerate a visual repair proposal in {status} state")
        timestamp = str(generated_at or now_iso())
        count_row = conn.execute(
            """
            SELECT COALESCE(MAX(attempt), 0) AS latest_attempt
            FROM visual_repair_proposals
            WHERE fixture_id = ? AND asset_id = ? AND source_version_id = ?
              AND defect_categories_json = ?
            """,
            (
                row["fixture_id"],
                row["asset_id"],
                row["source_version_id"],
                row["defect_categories_json"],
            ),
        ).fetchone()
        attempt = int(count_row["latest_attempt"] or 0) + 1
        ladder = _model_ladder(conn)
        rung = min(int(row["ladder_rung"]) + 1, len(ladder))
        selected = ladder[rung - 1]
        fingerprint = _request_fingerprint(
            str(row["fixture_id"]),
            str(row["asset_id"]),
            str(row["source_version_id"]),
            _read_json(row["defect_categories_json"], []),
            rung,
            attempt,
        )
        proposal = _proposal_id(fingerprint, attempt)
        conn.execute(
            """
            UPDATE visual_repair_proposals
            SET status = 'superseded', derived_available = 0, updated_at = ?
            WHERE proposal_id = ?
            """,
            (timestamp, row["proposal_id"]),
        )
        conn.execute(
            """
            INSERT INTO visual_repair_proposals (
              proposal_id, fixture_id, asset_id, source_version_id,
              defect_categories_json, ladder_rung, model_ladder_json,
              requested_generator_model, resolved_model, reasoning_effort,
              vision, attempt, status, original_reference, derived_reference,
              derived_available, generator_reference, request_fingerprint,
              idempotency_key, previous_proposal_id, generated_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'draft', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                proposal,
                row["fixture_id"],
                row["asset_id"],
                row["source_version_id"],
                row["defect_categories_json"],
                rung,
                _json(ladder),
                selected["model"],
                selected["model"],
                selected["effort"],
                attempt,
                row["original_reference"],
                _reference("derived", proposal),
                f"synthetic-generator://{SYNTHETIC_GENERATOR}",
                fingerprint,
                key,
                row["proposal_id"],
                timestamp,
                timestamp,
                timestamp,
            ),
        )
        _record_event(
            conn,
            proposal_id=str(row["proposal_id"]),
            action="regenerate",
            before_status=status,
            after_status="draft",
            related_proposal_id=proposal,
            idempotency_key=key,
            reason=str(reason or "Regenerated as a new independent visual draft."),
            created_at=timestamp,
        )
        conn.commit()
        updated = conn.execute(
            "SELECT * FROM visual_repair_proposals WHERE proposal_id = ?",
            (proposal,),
        ).fetchone()
        return _proposal_json(updated)
