#!/usr/bin/env python3
"""Finish one verified Upload Bridge item through its fixture and Photos."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from apple_photos_metadata_writer import (
    ApplePhotosAdapter,
    PhotosMetadataAccess,
    commit_writeback,
    writeback_plan,
)
from fixture_pipeline import adopt_upload_run


def finalize_streamed_upload(
    repo_root: Path,
    *,
    run_id: str,
    fixture_id: str,
    asset_id: str,
    adapter: PhotosMetadataAccess | None = None,
) -> dict[str, Any]:
    """Adopt one verified R2 item, then write and verify its Photos metadata."""
    adoption = adopt_upload_run(
        repo_root,
        run_id,
        fixture_id,
        asset_ids=[asset_id],
    )
    photos_adapter = adapter or ApplePhotosAdapter()
    preflight = writeback_plan(
        repo_root,
        fixture_id,
        [asset_id],
        adapter=photos_adapter,
    )
    read_errors = [item for item in preflight["items"] if item.get("currentReadError")]
    if preflight["blockedCount"] or preflight["count"] != 1 or read_errors:
        detail = preflight["blocked"] or read_errors or [{"reason": "expected exactly one Photos item"}]
        raise RuntimeError(f"Apple Photos give-back preflight failed: {detail}")
    photos = commit_writeback(
        repo_root,
        fixture_id,
        [asset_id],
        adapter=photos_adapter,
    )
    blocked = photos.get("blocked") or []
    return {
        "ok": bool(photos.get("ok")) and not blocked and photos.get("writtenCount") == 1,
        "assetId": asset_id,
        "fixtureId": fixture_id,
        "r2ReceiptCount": int(adoption.get("r2ReceiptCount") or 0),
        "photosWrittenCount": int(photos.get("writtenCount") or 0),
        "photosFailedCount": int(photos.get("failedCount") or 0),
        "photosBlockedCount": len(blocked),
        "photosPreflightCount": int(preflight.get("count") or 0),
        "photos": photos,
    }
