#!/usr/bin/env python3
"""Checkpointed, explicit-request-only AI Country/title/keyword proposal pass."""

from __future__ import annotations

import argparse
from collections.abc import Callable
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import uuid
from typing import Any

from fixture_pipeline import OWNER_DB, ai_run_status, connect as ensure_owner_schema, now_iso
from owner_state_db import (
    COUNTRY_ASSIGNMENT_TARGETS,
    DEFAULT_TITLE_KEYWORD_MODEL_LADDER,
    country_review_context,
    country_review_write_capability,
    title_keyword_model_ladder,
)
from requested_ai_previews import capture_requested_ai_previews


DEFAULT_MODEL = DEFAULT_TITLE_KEYWORD_MODEL_LADDER[0]["model"]
DEFAULT_MODEL_REASONING_EFFORT = DEFAULT_TITLE_KEYWORD_MODEL_LADDER[0]["effort"]
DEFAULT_MODEL_VISION = True
DESKTOP_CODEX_BINARY = Path("/Applications/ChatGPT.app/Contents/Resources/codex")
DEFAULT_TIMEOUT_SECONDS = max(
    30,
    int(os.environ.get("PBE_REQUESTED_AI_TIMEOUT_SECONDS", "300")),
)
ProposalFunction = Callable[[dict[str, Any]], dict[str, Any]]
PreviewPreparer = Callable[[Path, list[str]], dict[str, Any]]


def _codex_binary() -> str:
    configured = os.environ.get("PBE_REQUESTED_AI_CODEX_BIN", "").strip()
    if configured:
        return configured
    if DESKTOP_CODEX_BINARY.is_file():
        return str(DESKTOP_CODEX_BINARY)
    return "codex"


@contextmanager
def _runtime_connection(repo_root: Path):
    """Use the already-migrated Owner database without repeating schema setup."""
    path = OWNER_DB if OWNER_DB.is_absolute() else repo_root / OWNER_DB
    connection = sqlite3.connect(path, timeout=15)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout = 15000")
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _read_json(value: Any, fallback: Any) -> Any:
    try:
        return json.loads(str(value or ""))
    except json.JSONDecodeError:
        return fallback


def _schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "title",
            "keywords",
            "country",
            "confidence",
            "reason",
            "needs_owner_context",
        ],
        "properties": {
            "title": {"type": "string", "minLength": 1},
            "keywords": {
                "type": "array",
                "minItems": 1,
                "items": {"type": "string", "minLength": 1},
            },
            "country": {
                "type": "string",
                "enum": ["", *sorted(COUNTRY_ASSIGNMENT_TARGETS)],
            },
            "confidence": {
                "type": "string",
                "enum": ["low", "medium", "high"],
            },
            "reason": {"type": "string"},
            "needs_owner_context": {"type": "boolean"},
        },
    }


def _prompt(item: dict[str, Any]) -> str:
    context = {
        "asset_id": item["assetId"],
        "filename": item["filename"],
        "captured_at": item["capturedAt"],
        "location": item["locationLabel"],
        "current_title": item["currentTitle"],
        "current_keywords": item["currentKeywords"],
        "current_country": item["currentCountry"],
        "suggested_country": item["suggestedCountry"],
        "country_suggestion_source": item["countrySuggestionSource"],
        "country_proposal_enabled": item["countryProposalEnabled"],
        "prior_proposal_title": item["priorProposalTitle"],
        "prior_proposal_keywords": item["priorProposalKeywords"],
        "prior_proposal_country": item["priorProposalCountry"],
        "prior_proposal_reason": item["priorProposalReason"],
        "request_reasons": item["requestReasons"],
        "owner_note": item["requestNote"],
    }
    return "\n".join([
        "Generate one Photos By Elie Country, title, and keyword proposal for the attached bounded JPEG preview.",
        "Return JSON only and follow the supplied schema.",
        "Do not approve, publish, upload, edit Apple Photos, or modify canonical metadata.",
        "Use the pixels as primary evidence and the context only as supporting evidence.",
        "Treat current_title and current_keywords as canonical owner metadata.",
        "Treat current_country as accepted owner metadata and suggested_country only as supporting evidence.",
        "Return an empty country when country_proposal_enabled is false or the evidence does not support one of the allowed country slugs.",
        "Never infer Country from stereotypes or weak visual similarity.",
        "Treat prior_proposal_* only as the previous AI draft under review; preserve useful clues from it but correct it according to the owner's reasons and note.",
        "Write a concise human-readable title and useful searchable keywords.",
        "Make sure the location/place appears in the title.",
        "Apply that title requirement only when the supplied context contains reliable, non-conflicting location or place evidence.",
        "When location evidence is absent or conflicting, do not invent a place; use needs_owner_context when owner guidance is required.",
        "Do not include workflow keywords beginning with PBE:.",
        "Honor the owner's request reasons and note.",
        "",
        json.dumps(context, ensure_ascii=False, indent=2),
    ])


def codex_proposer(item: dict[str, Any]) -> dict[str, Any]:
    preview = Path(item["previewPath"])
    if not preview.is_file():
        raise RuntimeError("bounded AI preview is missing")
    with tempfile.TemporaryDirectory(prefix="pbe-requested-ai-") as temp_dir:
        schema_path = Path(temp_dir) / "schema.json"
        output_path = Path(temp_dir) / "proposal.json"
        schema_path.write_text(json.dumps(_schema(), indent=2) + "\n", encoding="utf-8")
        command = [
            _codex_binary(),
            "-a",
            "never",
            "exec",
            "--ephemeral",
            "--ignore-user-config",
            "--sandbox",
            "read-only",
            "-C",
            item["repoRoot"],
            "--output-schema",
            str(schema_path),
            "--output-last-message",
            str(output_path),
            "-m",
            str(item.get("requestedModel") or DEFAULT_MODEL),
            "-c",
            f'model_reasoning_effort="{item.get("requestedEffort") or DEFAULT_MODEL_REASONING_EFFORT}"',
            "--image",
            str(preview),
            "-",
        ]
        completed = subprocess.run(
            command,
            cwd=item["repoRoot"],
            input=_prompt(item),
            text=True,
            capture_output=True,
            timeout=DEFAULT_TIMEOUT_SECONDS,
            check=False,
        )
        if completed.returncode != 0:
            message = (
                completed.stderr
                or completed.stdout
                or f"codex exec exited {completed.returncode}"
            ).strip()
            raise RuntimeError(message)
        raw = output_path.read_text(encoding="utf-8") if output_path.exists() else completed.stdout
    return json.loads(raw)


def _active_run(conn: sqlite3.Connection) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT * FROM asset_ai_runs
        WHERE status IN ('queued', 'running')
        ORDER BY created_at DESC LIMIT 1
        """
    ).fetchone()


def _candidate_rows(
    conn: sqlite3.Connection,
    repo_root: Path,
    limit: int | None,
) -> list[dict[str, Any]]:
    external_edit_lock_sql = ""
    if conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'external_edit_asset_locks'"
    ).fetchone() is not None:
        external_edit_lock_sql = """
          AND NOT EXISTS (
            SELECT 1 FROM external_edit_asset_locks AS edit_lock
            WHERE edit_lock.asset_id = editorial.asset_id
          )
        """
    sql = f"""
        SELECT asset.asset_id, asset.filename, asset.captured_at, asset.location_label,
               editorial.ai_reasons_json, editorial.ai_note,
               editorial.ai_attempt_count, editorial.ai_preview_path,
               editorial.ai_preview_sha256,
               COALESCE(
                 NULLIF(decision.title, ''),
                 NULLIF(asset.photos_title, ''),
                 ''
               ) current_title,
               CASE
                 WHEN decision.keywords_json IS NOT NULL
                  AND decision.keywords_json != '[]'
                 THEN decision.keywords_json
                 ELSE COALESCE(asset.photos_keywords_json, '[]')
               END current_keywords_json,
               COALESCE(prior.proposed_title, '') prior_proposal_title,
               COALESCE(prior.proposed_keywords_json, '[]') prior_proposal_keywords_json,
               COALESCE(prior.proposed_country, '') prior_proposal_country,
               COALESCE(prior.reason, '') prior_proposal_reason
        FROM asset_editorial_state AS editorial
        JOIN sidecar_assets AS asset ON asset.asset_id = editorial.asset_id
        LEFT JOIN sidecar_decisions AS decision ON decision.asset_id = asset.asset_id
        LEFT JOIN asset_ai_proposals AS prior
          ON prior.proposal_id = (
            SELECT proposal.proposal_id
            FROM asset_ai_proposals AS proposal
            WHERE proposal.asset_id = editorial.asset_id
              AND proposal.status = 'superseded'
              AND proposal.decided_at = editorial.requested_at
            ORDER BY proposal.attempt DESC, proposal.created_at DESC
            LIMIT 1
          )
        WHERE editorial.editorial_state = 'requesting-ai'
          {external_edit_lock_sql}
        ORDER BY COALESCE(editorial.requested_at, editorial.updated_at), asset.asset_id
    """
    params: list[Any] = []
    if limit is not None:
        sql += " LIMIT ?"
        params.append(max(1, int(limit)))
    rows = conn.execute(sql, params).fetchall()
    capability = country_review_write_capability(conn)
    items = []
    for row in rows:
        country_context = country_review_context(
            conn,
            str(row["asset_id"]),
            capability=capability,
        )
        items.append({
        "repoRoot": str(repo_root),
        "assetId": str(row["asset_id"]),
        "filename": str(row["filename"] or ""),
        "capturedAt": str(row["captured_at"] or ""),
        "locationLabel": str(row["location_label"] or ""),
        "requestReasons": _read_json(row["ai_reasons_json"], []),
        "requestNote": str(row["ai_note"] or ""),
        "attempt": int(row["ai_attempt_count"] or 0) + 1,
        "previewPath": str(row["ai_preview_path"] or ""),
        "previewSha256": str(row["ai_preview_sha256"] or ""),
        "currentTitle": str(row["current_title"] or ""),
        "currentKeywords": _read_json(row["current_keywords_json"], []),
        "currentCountry": str(country_context["country"]),
        "suggestedCountry": str(country_context["suggestedCountry"]),
        "countrySuggestionSource": str(country_context["countrySuggestionSource"]),
        "countryProposalEnabled": bool(capability["enabled"]),
        "priorProposalTitle": str(row["prior_proposal_title"] or ""),
        "priorProposalKeywords": _read_json(
            row["prior_proposal_keywords_json"],
            [],
        ),
        "priorProposalCountry": str(row["prior_proposal_country"] or ""),
        "priorProposalReason": str(row["prior_proposal_reason"] or ""),
        })
    return items


def _normalize_proposal(value: dict[str, Any]) -> dict[str, Any]:
    title = " ".join(str(value.get("title") or "").split())
    keywords: list[str] = []
    seen: set[str] = set()
    for raw in value.get("keywords") or []:
        keyword = " ".join(str(raw or "").split())
        if not keyword or keyword.casefold().startswith("pbe:"):
            continue
        folded = keyword.casefold()
        if folded not in seen:
            seen.add(folded)
            keywords.append(keyword)
    if not title:
        raise ValueError("proposal title is empty")
    if not keywords:
        raise ValueError("proposal keywords are empty")
    confidence = str(value.get("confidence") or "low").casefold()
    if confidence not in {"low", "medium", "high"}:
        confidence = "low"
    country = str(value.get("country") or "").strip().casefold()
    if country and country not in COUNTRY_ASSIGNMENT_TARGETS:
        raise ValueError("proposal country is unsupported")
    return {
        "title": title,
        "keywords": keywords,
        "country": country,
        "confidence": confidence,
        "reason": str(value.get("reason") or "").strip(),
        "needsOwnerContext": bool(value.get("needs_owner_context")),
    }


def _update_run_counts(conn: sqlite3.Connection, run_id: str) -> None:
    counts = {
        str(row["status"]): int(row["count"])
        for row in conn.execute(
            """
            SELECT status, count(*) count
            FROM asset_ai_run_items
            WHERE run_id = ?
            GROUP BY status
            """,
            (run_id,),
        ).fetchall()
    }
    processed = sum(counts.get(key, 0) for key in ("proposed", "skipped", "failed"))
    remaining = counts.get("queued", 0) + counts.get("running", 0)
    conn.execute(
        """
        UPDATE asset_ai_runs
        SET processed_count = ?, proposed_count = ?, skipped_count = ?,
            failed_count = ?, remaining_count = ?, updated_at = ?
        WHERE run_id = ?
        """,
        (
            processed,
            counts.get("proposed", 0),
            counts.get("skipped", 0),
            counts.get("failed", 0),
            remaining,
            now_iso(),
            run_id,
        ),
    )


def run_requested_ai_pass(
    repo_root: Path,
    *,
    trigger: str = "manual",
    prepared_asset_ids: list[str] | None = None,
    limit: int | None = None,
    proposer: ProposalFunction = codex_proposer,
    preview_preparer: PreviewPreparer = capture_requested_ai_previews,
    progress: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """Run or attach to one durable pass; make at most one attempt per item."""
    repo_root = repo_root.resolve()
    if trigger not in {"scheduled", "manual", "test"}:
        raise ValueError("AI pass trigger is invalid")
    # Migrate the shared Owner tables before the raw checkpoint connections
    # below write the per-proposal model/effort audit fields.
    schema_conn = ensure_owner_schema(repo_root)
    schema_conn.close()
    with _runtime_connection(repo_root) as conn:
        active = _active_run(conn)
        if active:
            return {
                "ok": True,
                "attached": True,
                "runId": str(active["run_id"]),
                "status": str(active["status"]),
            }
        candidates = _candidate_rows(conn, repo_root, limit)
    if prepared_asset_ids is not None:
        allowed_ids = set(prepared_asset_ids)
        candidates = [item for item in candidates if item["assetId"] in allowed_ids]
    model_ladder = title_keyword_model_ladder(repo_root)
    preview_receipt = {
        "requested": 0,
        "captured": 0,
        "failed": 0,
    }
    missing_preview_ids = [
        item["assetId"]
        for item in candidates
        if not Path(item["previewPath"]).is_file()
    ]
    if missing_preview_ids and prepared_asset_ids is None:
        preview_receipt = preview_preparer(repo_root, missing_preview_ids)
        with _runtime_connection(repo_root) as conn:
            candidates = _candidate_rows(conn, repo_root, limit)
    for item in candidates:
        rung = model_ladder[min(max(0, int(item["attempt"]) - 1), len(model_ladder) - 1)]
        item["requestedModel"] = rung["model"]
        item["requestedEffort"] = rung["effort"]
    with _runtime_connection(repo_root) as conn:
        run_id = f"airun-{uuid.uuid4().hex[:16]}"
        timestamp = now_iso()
        conn.execute(
            """
            INSERT INTO asset_ai_runs (
              run_id, trigger, status, requested_count, remaining_count,
              owner_pid, started_at, created_at, updated_at
            ) VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                trigger,
                len(candidates),
                len(candidates),
                os.getpid(),
                timestamp,
                timestamp,
                timestamp,
            ),
        )
        conn.executemany(
            """
            INSERT INTO asset_ai_run_items (
              run_id, asset_id, status, attempt,
              requested_generator_model, resolved_model, reasoning_effort,
              vision, model_ladder
            ) VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?)
            """,
            [(
                run_id,
                item["assetId"],
                item["attempt"],
                item["requestedModel"],
                item["requestedModel"],
                item["requestedEffort"],
                1,
                _json(model_ladder),
            ) for item in candidates],
        )
        conn.commit()

    for item in candidates:
        with _runtime_connection(repo_root) as conn:
            run = conn.execute(
                "SELECT cancel_requested FROM asset_ai_runs WHERE run_id = ?",
                (run_id,),
            ).fetchone()
            if run and run["cancel_requested"]:
                conn.execute(
                    """
                    UPDATE asset_ai_runs
                    SET status = 'cancelled', completed_at = ?, updated_at = ?
                    WHERE run_id = ?
                    """,
                    (now_iso(), now_iso(), run_id),
                )
                conn.commit()
                break
            conn.execute(
                """
                UPDATE asset_ai_run_items
                SET status = 'running', started_at = ?
                WHERE run_id = ? AND asset_id = ?
                """,
                (now_iso(), run_id, item["assetId"]),
            )
            conn.execute(
                """
                UPDATE asset_editorial_state
                SET ai_attempt_count = ?, ai_last_error = '', updated_at = ?
                WHERE asset_id = ? AND editorial_state = 'requesting-ai'
                """,
                (item["attempt"], now_iso(), item["assetId"]),
            )
            conn.commit()
        try:
            proposal = _normalize_proposal(proposer(item))
            if not item["countryProposalEnabled"]:
                proposal["country"] = ""
            timestamp = now_iso()
            with _runtime_connection(repo_root) as conn:
                state = conn.execute(
                    "SELECT editorial_state FROM asset_editorial_state WHERE asset_id = ?",
                    (item["assetId"],),
                ).fetchone()
                if not state or state["editorial_state"] != "requesting-ai":
                    conn.execute(
                        """
                        UPDATE asset_ai_run_items
                        SET status = 'skipped', error_text = 'request was cleared',
                            completed_at = ?
                        WHERE run_id = ? AND asset_id = ?
                        """,
                        (timestamp, run_id, item["assetId"]),
                    )
                else:
                    proposal_id = f"aip-{uuid.uuid4().hex[:16]}"
                    conn.execute(
                        """
                        INSERT INTO asset_ai_proposals (
                          proposal_id, asset_id, run_id, attempt, status,
                          previous_title, previous_keywords_json,
                          previous_country, proposed_title, proposed_keywords_json,
                          proposed_country, country_source,
                          confidence, reason, needs_owner_context,
                          request_reasons_json, request_note, preview_sha256,
                          generator, generator_model, requested_generator_model,
                          resolved_model, reasoning_effort, vision, model_ladder,
                          created_at
                        ) VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'codex', ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            proposal_id,
                            item["assetId"],
                            run_id,
                            item["attempt"],
                            item["currentTitle"],
                            _json(item["currentKeywords"]),
                            item["currentCountry"],
                            proposal["title"],
                            _json(proposal["keywords"]),
                            proposal["country"],
                            "ai-vision-context" if proposal["country"] else "",
                            proposal["confidence"],
                            proposal["reason"],
                            int(proposal["needsOwnerContext"]),
                            _json(item["requestReasons"]),
                            item["requestNote"],
                            item["previewSha256"],
                            item["requestedModel"],
                            item["requestedModel"],
                            item["requestedModel"],
                            item["requestedEffort"],
                            1,
                            _json(model_ladder),
                            timestamp,
                        ),
                    )
                    conn.execute(
                        """
                        UPDATE asset_editorial_state
                        SET editorial_state = 'proposed', proposed_at = ?,
                            ai_reasons_json = '[]', ai_note = '',
                            ai_last_error = '', updated_at = ?
                        WHERE asset_id = ?
                        """,
                        (timestamp, timestamp, item["assetId"]),
                    )
                    conn.execute(
                        """
                        UPDATE asset_ai_run_items
                        SET status = 'proposed', completed_at = ?
                        WHERE run_id = ? AND asset_id = ?
                        """,
                        (timestamp, run_id, item["assetId"]),
                    )
                _update_run_counts(conn, run_id)
                conn.commit()
        except Exception as error:  # noqa: BLE001 - each item is isolated and retried next pass.
            message = str(error).strip()[:2000] or error.__class__.__name__
            timestamp = now_iso()
            with _runtime_connection(repo_root) as conn:
                conn.execute(
                    """
                    UPDATE asset_ai_run_items
                    SET status = 'failed', error_text = ?, completed_at = ?
                    WHERE run_id = ? AND asset_id = ?
                    """,
                    (message, timestamp, run_id, item["assetId"]),
                )
                conn.execute(
                    """
                    UPDATE asset_editorial_state
                    SET ai_last_error = ?, updated_at = ?
                    WHERE asset_id = ? AND editorial_state = 'requesting-ai'
                    """,
                    (message, timestamp, item["assetId"]),
                )
                _update_run_counts(conn, run_id)
                conn.commit()
        if progress:
            with _runtime_connection(repo_root) as conn:
                progress(dict(conn.execute(
                    "SELECT * FROM asset_ai_runs WHERE run_id = ?",
                    (run_id,),
                ).fetchone()))

    with _runtime_connection(repo_root) as conn:
        run = conn.execute(
            "SELECT * FROM asset_ai_runs WHERE run_id = ?",
            (run_id,),
        ).fetchone()
        if run["status"] == "running":
            status = "completed-with-errors" if int(run["failed_count"]) else "completed"
            timestamp = now_iso()
            conn.execute(
                """
                UPDATE asset_ai_runs
                SET status = ?, completed_at = ?, updated_at = ?
                WHERE run_id = ?
                """,
                (status, timestamp, timestamp, run_id),
            )
            conn.commit()
        final = dict(conn.execute(
            "SELECT * FROM asset_ai_runs WHERE run_id = ?",
            (run_id,),
        ).fetchone())
    return {
        "ok": final["status"] in {"completed", "completed-with-errors"},
        "attached": False,
        "runId": run_id,
        "status": final["status"],
        "requested": int(final["requested_count"]),
        "processed": int(final["processed_count"]),
        "proposed": int(final["proposed_count"]),
        "skipped": int(final["skipped_count"]),
        "failed": int(final["failed_count"]),
        "remaining": int(final["remaining_count"]),
        "previewPreparation": {
            "requested": int(preview_receipt.get("requested") or 0),
            "captured": int(preview_receipt.get("captured") or 0),
            "failed": int(preview_receipt.get("failed") or 0),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--trigger", choices=("scheduled", "manual"), default="manual")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--prepared-assets-stdin", action="store_true")
    args = parser.parse_args()
    prepared = None
    if args.prepared_assets_stdin:
        raw = sys.stdin.buffer.read(16_000_001)
        if len(raw) > 16_000_000:
            raise ValueError("Prepared AI job is too large")
        prepared = json.loads(raw)
        if not isinstance(prepared, list) or any(not isinstance(item, str) for item in prepared):
            raise ValueError("Prepared AI assets must be an ID list")

    if args.status:
        print(json.dumps(
            ai_run_status(args.repo_root.resolve()),
            ensure_ascii=False,
            separators=(",", ":"),
        ))
        return 0

    def emit(row: dict[str, Any]) -> None:
        print(json.dumps({
            "runId": row["run_id"],
            "processed": row["processed_count"],
            "proposed": row["proposed_count"],
            "skipped": row["skipped_count"],
            "failed": row["failed_count"],
            "remaining": row["remaining_count"],
        }, separators=(",", ":")), flush=True)

    result = run_requested_ai_pass(
        args.repo_root,
        trigger=args.trigger,
        prepared_asset_ids=prepared,
        limit=args.limit,
        progress=emit,
    )
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")), flush=True)
    return 0 if result.get("ok") or result.get("attached") else 1


if __name__ == "__main__":
    raise SystemExit(main())
