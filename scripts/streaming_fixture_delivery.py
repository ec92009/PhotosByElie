#!/usr/bin/env python3
"""Finish one verified Upload Bridge item through its fixture and Photos."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from apple_photos_metadata_writer import (
    PhotosMetadataAccess,
    BackstagePhotosMetadataAdapter,
    commit_writeback,
)
from fixture_pipeline import adopt_upload_run


def _unique_asset_ids(asset_ids: list[str]) -> list[str]:
    return list(dict.fromkeys(str(asset_id).strip() for asset_id in asset_ids if str(asset_id).strip()))


def finalize_streamed_upload_batch(
    repo_root: Path,
    *,
    run_id: str,
    fixture_id: str,
    asset_ids: list[str],
    adapter: PhotosMetadataAccess | None = None,
) -> dict[str, Any]:
    """Adopt verified R2 items and give metadata back to Photos in one batch."""
    selected_ids = _unique_asset_ids(asset_ids)
    if not selected_ids:
        return {
            "ok": True,
            "fixtureId": fixture_id,
            "assetCount": 0,
            "r2ReceiptCount": 0,
            "photosWrittenCount": 0,
            "photosFailedCount": 0,
            "photosBlockedCount": 0,
            "items": [],
        }
    adoption = adopt_upload_run(
        repo_root,
        run_id,
        fixture_id,
        asset_ids=selected_ids,
    )
    photos_adapter = adapter or BackstagePhotosMetadataAdapter(repo_root)
    photos = commit_writeback(
        repo_root,
        fixture_id,
        selected_ids,
        adapter=photos_adapter,
    )
    written = {str(item.get("assetId") or "") for item in photos.get("written") or []}
    failed = {
        str(item.get("assetId") or ""): str(item.get("error") or "Apple Photos write failed")
        for item in photos.get("failed") or []
    }
    blocked: dict[str, list[str]] = {}
    for item in photos.get("blocked") or []:
        blocked.setdefault(str(item.get("assetId") or ""), []).append(str(item.get("reason") or "blocked"))
    items = []
    for asset_id in selected_ids:
        item_blocked = blocked.get(asset_id, [])
        item_error = failed.get(asset_id, "")
        items.append({
            "ok": asset_id in written and not item_error and not item_blocked,
            "assetId": asset_id,
            "fixtureId": fixture_id,
            "photosWrittenCount": 1 if asset_id in written else 0,
            "photosFailedCount": 1 if item_error else 0,
            "photosBlockedCount": len(item_blocked),
            **({"error": item_error} if item_error else {}),
            **({"blockedReasons": item_blocked} if item_blocked else {}),
        })
    return {
        "ok": bool(photos.get("ok")) and all(item["ok"] for item in items),
        "fixtureId": fixture_id,
        "assetCount": len(selected_ids),
        "r2ReceiptCount": int(adoption.get("r2ReceiptCount") or 0),
        "photosWrittenCount": int(photos.get("writtenCount") or 0),
        "photosFailedCount": int(photos.get("failedCount") or 0),
        "photosBlockedCount": len(photos.get("blocked") or []),
        "items": items,
        "photos": photos,
    }


def finalize_streamed_upload(
    repo_root: Path,
    *,
    run_id: str,
    fixture_id: str,
    asset_id: str,
    adapter: PhotosMetadataAccess | None = None,
) -> dict[str, Any]:
    """Adopt one verified R2 item, then write and verify its Photos metadata."""
    batch = finalize_streamed_upload_batch(
        repo_root,
        run_id=run_id,
        fixture_id=fixture_id,
        asset_ids=[asset_id],
        adapter=adapter,
    )
    item = (batch.get("items") or [{}])[0]
    return {
        **item,
        "r2ReceiptCount": int(batch.get("r2ReceiptCount") or 0),
        "photos": batch.get("photos") or {},
    }
