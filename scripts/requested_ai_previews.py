#!/usr/bin/env python3
"""Prepare bounded PhotoKit previews for an explicit requested-AI batch."""

from __future__ import annotations

from collections.abc import Callable, Iterable
import hashlib
import time
from pathlib import Path
from typing import Any

from backstage_photos_client import BackstagePhotosClientError, request_preview
from fixture_pipeline import ai_preview_targets, record_ai_preview


REQUESTED_AI_PREVIEW_ROOT = Path(".review-logs/requested-ai-previews")
MAX_PREVIEW_PIXEL = 1_600
MAX_SINGLE_PREVIEW_TIMEOUT_SECONDS = 60.0
MIN_BATCH_TIMEOUT_SECONDS = 60.0
PREVIEW_TIMEOUT_BUDGET_PER_TARGET_SECONDS = 6.0
PreviewRunner = Callable[[str, Path, int, float], dict[str, Any]]


def _default_preview_runner(
    photo_library_identifier: str,
    destination: Path,
    max_pixel: int,
    timeout: float,
) -> dict[str, Any]:
    try:
        return request_preview(
            photo_library_identifier,
            destination,
            max_pixel,
            timeout=timeout,
        )
    except BackstagePhotosClientError as error:
        return error.as_payload()


def _preview_root(repo_root: Path) -> Path:
    resolved_repo_root = repo_root.resolve()
    preview_root = (resolved_repo_root / REQUESTED_AI_PREVIEW_ROOT).resolve()
    try:
        preview_root.relative_to(resolved_repo_root)
    except ValueError as error:
        raise ValueError("Requested AI preview path escapes the connector runtime.") from error
    preview_root.mkdir(parents=True, exist_ok=True)
    return preview_root


def _preview_destination(preview_root: Path, asset_id: str) -> Path:
    destination = preview_root / f"{hashlib.sha256(asset_id.encode()).hexdigest()[:24]}.jpg"
    try:
        destination.relative_to(preview_root)
    except ValueError as error:
        raise ValueError("Requested AI preview destination escapes the preview artifact root.") from error
    return destination


def _failure_message(payload: Any, default: str) -> str:
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            error = error.get("message") or error.get("code")
        if error:
            return str(error)
        if payload.get("code"):
            return str(payload["code"])
    return default


def capture_requested_ai_previews(
    repo_root: Path,
    asset_ids: Iterable[str],
    *,
    preview_runner: PreviewRunner = _default_preview_runner,
) -> dict[str, Any]:
    """Capture missing requested-AI previews through Backstage-owned one-preview IPC."""
    repo_root = repo_root.resolve()
    targets = ai_preview_targets(repo_root, asset_ids)
    if not targets:
        return {
            "requested": 0,
            "captured": 0,
            "failed": 0,
            "items": [],
            "failures": [],
        }

    preview_root = _preview_root(repo_root)
    destination_by_asset_id: dict[str, Path] = {}
    for target in targets:
        asset_id = str(target["assetId"])
        destination_by_asset_id[asset_id] = _preview_destination(preview_root, asset_id)

    batch_deadline = time.monotonic() + max(
        MIN_BATCH_TIMEOUT_SECONDS,
        len(targets) * PREVIEW_TIMEOUT_BUDGET_PER_TARGET_SECONDS,
    )
    captured: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    for target in targets:
        asset_id = str(target["assetId"])
        photo_id = str(target["photoLibraryIdentifier"])
        destination = destination_by_asset_id[asset_id]
        remaining = batch_deadline - time.monotonic()
        if remaining <= 0:
            payload: dict[str, Any] = {
                "ok": False,
                "code": "preview_batch_timeout",
                "error": "The requested AI preview batch exceeded its bounded timeout.",
            }
        else:
            try:
                payload = preview_runner(
                    photo_id,
                    destination,
                    MAX_PREVIEW_PIXEL,
                    min(MAX_SINGLE_PREVIEW_TIMEOUT_SECONDS, remaining),
                )
            except Exception as error:
                payload = {
                    "ok": False,
                    "code": "preview_failed",
                    "error": str(error) or error.__class__.__name__,
                }

        if destination.is_file():
            try:
                captured.append(record_ai_preview(repo_root, asset_id, destination))
            except Exception as error:
                failures.append({
                    "assetId": asset_id,
                    "error": str(error) or error.__class__.__name__,
                })
            continue
        failures.append({
            "assetId": asset_id,
            "error": _failure_message(
                payload,
                "Backstage did not create the requested AI preview.",
            ),
        })
    return {
        "requested": len(targets),
        "captured": len(captured),
        "failed": len(failures),
        "items": captured,
        "failures": failures,
    }
