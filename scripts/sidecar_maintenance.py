#!/usr/bin/env python3
"""Non-UI Sidecar maintenance tasks for schedulers."""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path

try:
    from sidecar_server import _index_job_snapshot, _run_index_job
    from sidecar_state_db import ai_metadata_plan, apply_ai_metadata_proposals, now_iso, sidecar_sync_status
except ModuleNotFoundError:  # pragma: no cover - supports package-style imports.
    from scripts.sidecar_server import _index_job_snapshot, _run_index_job
    from scripts.sidecar_state_db import ai_metadata_plan, apply_ai_metadata_proposals, now_iso, sidecar_sync_status


DEFAULT_AI_PLAN_PATH = Path("assets/owner-actions/sidecar-ai-metadata-plan.json")
DEFAULT_SYNC_STATUS_PATH = Path("assets/owner-actions/sidecar-photos-sync-status.json")


def _write_json(repo_root: Path, path: Path, payload: dict) -> None:
    target = path if path.is_absolute() else repo_root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _print_json(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


def photos_index_sync(args: argparse.Namespace) -> int:
    repo_root = args.repo_root.resolve()
    job_id = f"scheduled-{uuid.uuid4().hex[:12]}"
    _run_index_job(repo_root, job_id)
    payload = {
        "ok": True,
        "task": "sidecar-photos-index-sync",
        "generatedAt": now_iso(),
        "job": _index_job_snapshot(repo_root),
        "sync": sidecar_sync_status(repo_root, limit=args.limit),
    }
    job_status = str(payload["job"].get("status") or "")
    if job_status != "done":
        payload["ok"] = False
    if args.output:
        _write_json(repo_root, args.output, payload)
    _print_json(payload)
    return 0 if payload["ok"] else 1


def picked_ai_plan(args: argparse.Namespace) -> int:
    repo_root = args.repo_root.resolve()
    payload = {
        "ok": True,
        "task": "sidecar-picked-ai-metadata-plan",
        "generatedAt": now_iso(),
        "plan": ai_metadata_plan(repo_root, limit=args.limit),
    }
    if args.output:
        _write_json(repo_root, args.output, payload)
    _print_json(payload)
    return 0


def picked_ai_propose(args: argparse.Namespace) -> int:
    repo_root = args.repo_root.resolve()
    payload = {
        "ok": True,
        "task": "sidecar-picked-ai-metadata-propose",
        "generatedAt": now_iso(),
        "result": apply_ai_metadata_proposals(repo_root, limit=args.limit),
    }
    if args.output:
        _write_json(repo_root, args.output, payload)
    _print_json(payload)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run scheduled Sidecar maintenance tasks without opening the Sidecar UI.")
    parser.add_argument("--repo-root", type=Path, default=Path.cwd(), help="PhotosByElie repo root. Defaults to the current directory.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    photos = subparsers.add_parser("photos-index-sync", help="Refresh the local Apple Photos metadata index.")
    photos.add_argument("--limit", type=int, default=80, help="Number of rows to include in the written sync status artifact.")
    photos.add_argument("--output", type=Path, default=DEFAULT_SYNC_STATUS_PATH, help="JSON artifact path for the scheduler result.")
    photos.set_defaults(func=photos_index_sync)

    ai = subparsers.add_parser("picked-ai-plan", help="Write the picked-only AI metadata planning queue.")
    ai.add_argument("--limit", type=int, default=500, help="Maximum picked rows to include in the planning artifact.")
    ai.add_argument("--output", type=Path, default=DEFAULT_AI_PLAN_PATH, help="JSON artifact path for the scheduler result.")
    ai.set_defaults(func=picked_ai_plan)

    propose = subparsers.add_parser("picked-ai-propose", help="Write bounded picked-only metadata proposals into Sidecar Review.")
    propose.add_argument("--limit", type=int, default=20, help="Maximum picked rows to convert from safe plan seeds into Review proposals.")
    propose.add_argument("--output", type=Path, help="Optional JSON artifact path for the proposal result.")
    propose.set_defaults(func=picked_ai_propose)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except Exception as error:
        payload = {
            "ok": False,
            "task": args.command,
            "generatedAt": now_iso(),
            "error": str(error),
        }
        _print_json(payload)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
