#!/usr/bin/env python3
"""Prepare bounded PhotoKit previews for an explicit requested-AI batch."""

from __future__ import annotations

from collections.abc import Callable, Iterable
import hashlib
import json
from pathlib import Path
import tempfile
from typing import Any

from fixture_pipeline import ai_preview_targets, record_ai_preview


REQUESTED_AI_PREVIEW_ROOT = Path(".review-logs/requested-ai-previews")
BridgeRunner = Callable[[Path, list[str], int], dict[str, Any]]


def _default_bridge_runner(
    repo_root: Path,
    args: list[str],
    timeout: int,
) -> dict[str, Any]:
    from sidecar_server import _run_apple_photos_bridge_app_task

    return _run_apple_photos_bridge_app_task(repo_root, args, timeout=timeout)


def capture_requested_ai_previews(
    repo_root: Path,
    asset_ids: Iterable[str],
    *,
    bridge_runner: BridgeRunner = _default_bridge_runner,
) -> dict[str, Any]:
    """Batch missing requested-AI previews through one signed Photos Bridge task."""
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

    root = repo_root / REQUESTED_AI_PREVIEW_ROOT
    root.mkdir(parents=True, exist_ok=True)
    destination_by_asset_id: dict[str, Path] = {}
    requests: list[dict[str, Any]] = []
    for target in targets:
        asset_id = str(target["assetId"])
        destination = root / f"{hashlib.sha256(asset_id.encode()).hexdigest()[:24]}.jpg"
        destination_by_asset_id[asset_id] = destination
        requests.append({
            "assetId": str(target["photoLibraryIdentifier"]),
            "destination": str(destination),
            "maxPixel": 1600,
        })

    with tempfile.TemporaryDirectory(prefix="pbe-requested-ai-previews-") as temp_dir:
        input_path = Path(temp_dir) / "preview-requests.json"
        input_path.write_text(
            json.dumps(requests, ensure_ascii=False),
            encoding="utf-8",
        )
        payload = bridge_runner(
            repo_root,
            ["preview-many", "--input", str(input_path)],
            max(60, len(requests) * 6),
        )

    item_errors = {
        str(item.get("assetId") or ""): str(item.get("error") or "")
        for item in payload.get("items") or []
        if isinstance(item, dict) and item.get("error")
    }
    captured: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    for target in targets:
        asset_id = str(target["assetId"])
        photo_id = str(target["photoLibraryIdentifier"])
        destination = destination_by_asset_id[asset_id]
        if destination.is_file():
            captured.append(record_ai_preview(repo_root, asset_id, destination))
            continue
        failures.append({
            "assetId": asset_id,
            "error": (
                item_errors.get(photo_id)
                or str(payload.get("error") or "")
                or "Photos Bridge did not create the requested AI preview."
            ),
        })
    return {
        "requested": len(targets),
        "captured": len(captured),
        "failed": len(failures),
        "items": captured,
        "failures": failures,
    }
