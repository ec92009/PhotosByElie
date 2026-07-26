#!/usr/bin/env python3
"""Checkpointed, explicit-request-only AI title/keyword proposal pass."""

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

from fixture_pipeline import OWNER_DB, ai_run_status, now_iso


DEFAULT_MODEL = os.environ.get("PBE_REQUESTED_AI_MODEL", "gpt-5.4-mini")
DEFAULT_TIMEOUT_SECONDS = max(
    30,
    int(os.environ.get("PBE_REQUESTED_AI_TIMEOUT_SECONDS", "300")),
)
ProposalFunction = Callable[[dict[str, Any]], dict[str, Any]]


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
        "request_reasons": item["requestReasons"],
        "owner_note": item["requestNote"],
    }
    return "\n".join([
        "Generate one Photos By Elie title and keyword proposal for the attached bounded JPEG preview.",
        "Return JSON only and follow the supplied schema.",
        "Do not approve, publish, upload, edit Apple Photos, or modify canonical metadata.",
        "Use the pixels as primary evidence and the context only as supporting evidence.",
        "Write a concise human-readable title and useful searchable keywords.",
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
            os.environ.get("PBE_REQUESTED_AI_CODEX_BIN", "codex"),
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
            DEFAULT_MODEL,
            "-c",
            'model_reasoning_effort="low"',
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
    sql = """
        SELECT asset.asset_id, asset.filename, asset.captured_at, asset.location_label,
               editorial.ai_reasons_json, editorial.ai_note,
               editorial.ai_attempt_count, editorial.ai_preview_path,
               editorial.ai_preview_sha256,
               COALESCE(decision.title, '') current_title,
               COALESCE(decision.keywords_json, '[]') current_keywords_json
        FROM asset_editorial_state AS editorial
        JOIN sidecar_assets AS asset ON asset.asset_id = editorial.asset_id
        LEFT JOIN sidecar_decisions AS decision ON decision.asset_id = asset.asset_id
        WHERE editorial.editorial_state = 'requesting-ai'
        ORDER BY COALESCE(editorial.requested_at, editorial.updated_at), asset.asset_id
    """
    params: list[Any] = []
    if limit is not None:
        sql += " LIMIT ?"
        params.append(max(1, int(limit)))
    rows = conn.execute(sql, params).fetchall()
    return [{
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
    } for row in rows]


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
    return {
        "title": title,
        "keywords": keywords,
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
    limit: int | None = None,
    proposer: ProposalFunction = codex_proposer,
    progress: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """Run or attach to one durable pass; make at most one attempt per item."""
    repo_root = repo_root.resolve()
    if trigger not in {"scheduled", "manual", "test"}:
        raise ValueError("AI pass trigger is invalid")
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
              run_id, asset_id, status, attempt
            ) VALUES (?, ?, 'queued', ?)
            """,
            [(run_id, item["assetId"], item["attempt"]) for item in candidates],
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
                          proposed_title, proposed_keywords_json,
                          confidence, reason, needs_owner_context,
                          request_reasons_json, request_note, preview_sha256,
                          generator, generator_model, created_at
                        ) VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'codex', ?, ?)
                        """,
                        (
                            proposal_id,
                            item["assetId"],
                            run_id,
                            item["attempt"],
                            item["currentTitle"],
                            _json(item["currentKeywords"]),
                            proposal["title"],
                            _json(proposal["keywords"]),
                            proposal["confidence"],
                            proposal["reason"],
                            int(proposal["needsOwnerContext"]),
                            _json(item["requestReasons"]),
                            item["requestNote"],
                            item["previewSha256"],
                            DEFAULT_MODEL,
                            timestamp,
                        ),
                    )
                    conn.execute(
                        """
                        UPDATE asset_editorial_state
                        SET editorial_state = 'proposed', proposed_at = ?,
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
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--trigger", choices=("scheduled", "manual"), default="manual")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--status", action="store_true")
    args = parser.parse_args()

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
        limit=args.limit,
        progress=emit,
    )
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")), flush=True)
    return 0 if result.get("ok") or result.get("attached") else 1


if __name__ == "__main__":
    raise SystemExit(main())
