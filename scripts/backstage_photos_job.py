#!/usr/bin/env python3
"""Private capability handoff and planning for Backstage-owned Photos jobs.

The planner has no Photos authority. Backstage passes its accepted action over
stdin, validates the returned plan, and gives the execution child a fresh
capability over a different anonymous pipe. Nothing secret is saved to disk.
"""
from __future__ import annotations

import base64
from contextlib import closing
import hashlib
import hmac
import json
import os
from pathlib import Path
import sqlite3
import sys
import time

_CREDENTIAL: dict | None = None


def initialize() -> None:
    """Read the one-use bootstrap pipe before spawning any child process."""
    global _CREDENTIAL
    if os.environ.pop("PBE_PHOTOS_JOB_STDIN", "") != "1":
        return
    raw = sys.stdin.buffer.readline(65_537)
    if len(raw) > 65_536:
        raise ValueError("Photos job bootstrap exceeds its size limit")
    value = json.loads(raw)
    if not isinstance(value, dict) or not isinstance(value.get("secret"), str):
        raise ValueError("Photos job bootstrap is invalid")
    if len(base64.b64decode(value["secret"], validate=True)) != 32:
        raise ValueError("Photos job key is invalid")
    _CREDENTIAL = value


def credential_input() -> str | None:
    """Re-deliver authority only to a trusted, synchronous runtime child."""
    return json.dumps(_CREDENTIAL, separators=(",", ":")) + "\n" if _CREDENTIAL else None


def credential() -> dict | None:
    return dict(_CREDENTIAL) if _CREDENTIAL else None


def envelope(request_data: bytes) -> bytes:
    """Bind every request byte to the private job and a fresh request ID."""
    if not _CREDENTIAL:
        # Transport-only compatibility: the real server rejects bare requests.
        # Keeping the old framing lets old clients receive an actionable denial.
        return request_data
    if float(_CREDENTIAL["expiresAt"]) <= time.time():
        raise ValueError("Photos job authority expired; restart the job in Backstage")
    signature = hmac.new(base64.b64decode(_CREDENTIAL["secret"], validate=True),
                         request_data, hashlib.sha256).digest()
    return json.dumps({"jobID": _CREDENTIAL["jobID"],
                       "request": base64.b64encode(request_data).decode("ascii"),
                       "signature": base64.b64encode(signature).decode("ascii")},
                      separators=(",", ":")).encode()


def _rows(root: Path, sql: str, params=()) -> list[sqlite3.Row]:
    db = root / "assets/owner-actions/Owner.sqlite"
    # Open an existing database with WAL sidecar creation available. SQLite's
    # macOS VFS can reject a fresh WAL database in mode=ro before its sidecars
    # exist. query_only keeps the scope query unable to mutate Owner records.
    with closing(sqlite3.connect(db.resolve().as_uri() + "?mode=rw", uri=True)) as conn:
        conn.execute("PRAGMA query_only = ON")
        conn.row_factory = sqlite3.Row
        return conn.execute(sql, params).fetchall()


def _photos_ids(rows) -> list[str]:
    return sorted({str(json.loads(row["raw_json"] or "{}").get("localIdentifier") or row["asset_id"])
                   for row in rows})


def plan(root: Path, action: dict) -> dict:
    """Resolve exact Photos identities for one already accepted Owner action."""
    result = dict(operations=[], assetIDs=[], writes=[], preserveMetadataIDs=[],
                  dateFrom="", dateTo="", maxPixel=1800)
    payload = action.get("payload") or {}
    manifest = payload.get("manifest") or {}
    kind = action.get("actionKind") or action.get("type")
    mode = manifest.get("mode", "")
    if kind == "sidecar-photos-index-sync":
        from sidecar_state_db import photos_discovery_window
        full = bool(payload.get("fullLibrary")) or payload.get("mode") == "full"
        lower, upper = payload.get("dateFrom") or "", payload.get("dateTo") or ""
        if full and (lower or upper):
            raise ValueError("Full library reconciliation cannot have date bounds")
        if not full and not lower and not upper:
            lower = photos_discovery_window(root)["dateFrom"]
        result.update(operations=["photos.library-index"], dateFrom=lower, dateTo=upper)
    elif kind == "sidecar-culling-review" and mode in {"fixture-photos-writeback-plan", "fixture-photos-writeback-commit"}:
        from apple_photos_metadata_writer import writeback_plan
        planned = writeback_plan(root, str(manifest.get("fixtureId") or ""), manifest.get("assetIds") or [])
        result["operations"] = ["photos.metadata-read-many"]
        if mode.endswith("-commit"):
            result["operations"].append("photos.metadata-apply-many")
        for item in planned["items"]:
            photo_id = item["photosAssetId"]
            result["assetIDs"].append(photo_id)
            if item["tombstoned"]:
                result["preserveMetadataIDs"].append(photo_id)
            else:
                result["writes"].append(dict(assetId=photo_id, title=item["title"], caption=item["caption"],
                    keywords=item["keywords"], managedKeywords=item["managedKeywords"]))
    elif kind == "sidecar-culling-review" and mode in {"photos-sync-run", "photos-sync-run-start"}:
        limit = max(1, min(int(manifest.get("limit") or 50), 50))
        rows = _rows(root, """SELECT a.asset_id,a.raw_json FROM sidecar_assets a
            LEFT JOIN asset_sync_state s ON s.asset_id=a.asset_id
            ORDER BY CASE WHEN s.last_scanned_at IS NULL THEN 0 ELSE 1 END,
            s.last_scanned_at,a.captured_at DESC,a.asset_id LIMIT ?""", (limit,))
        result.update(operations=["photos.metadata-read-many", "photos.preview"], assetIDs=_photos_ids(rows))
    elif kind == "sidecar-culling-review" and mode == "fixture-ai-pass-start":
        rows = _rows(root, """SELECT a.asset_id,a.raw_json FROM sidecar_assets a
            JOIN asset_editorial_state e ON e.asset_id=a.asset_id
            WHERE e.editorial_state='requesting-ai'
            AND NOT EXISTS (SELECT 1 FROM external_edit_asset_locks l WHERE l.asset_id=a.asset_id)""")
        from fixture_pipeline import ai_preview_targets
        targets = ai_preview_targets(root, [row["asset_id"] for row in rows])
        result.update(operations=["photos.preview"],
                      assetIDs=sorted({item["photoLibraryIdentifier"] for item in targets}), maxPixel=1600)
    elif kind == "sidecar-culling-review" and mode in {"asset-upload-run-start", "asset-upload-run-resume"}:
        if manifest.get("prepareOnly") or str(manifest.get("runId") or "").startswith("catrec-"):
            return result
        run_id = str(manifest.get("runId") or "")
        if run_id:
            rows = _rows(root, """SELECT a.asset_id,a.raw_json FROM sidecar_assets a
                JOIN asset_upload_run_items i ON i.asset_id=a.asset_id
                WHERE i.run_id=? AND i.status IN ('queued','uploading','failed')""", (run_id,))
        else:
            ids = list(dict.fromkeys(manifest.get("assetIds") or []))
            if not 1 <= len(ids) <= 50:
                raise ValueError("Upload Photos authority requires an exact batch of 1–50 assets")
            placeholders = ",".join("?" for _ in ids)
            rows = _rows(root, f"SELECT asset_id,raw_json FROM sidecar_assets WHERE asset_id IN ({placeholders})", ids)
        if not rows:
            return result
        if len(rows) > 50:
            raise ValueError("Upload Photos authority exceeds the 50-asset batch limit")
        from apple_photos_metadata_writer import writeback_plan
        planned = writeback_plan(root, "", [row["asset_id"] for row in rows])
        result.update(operations=["photos.export-original", "photos.metadata-read-many", "photos.metadata-apply-many"],
                      assetIDs=sorted(set(_photos_ids(rows)) | {str(row["asset_id"]) for row in rows}))
        for item in planned["items"]:
            if item["tombstoned"]:
                result["preserveMetadataIDs"].append(item["photosAssetId"])
            else:
                result["writes"].append(dict(assetId=item["photosAssetId"], title=item["title"], caption=item["caption"],
                    keywords=item["keywords"], managedKeywords=item["managedKeywords"]))
    elif kind == "sidecar-upload-publish" and payload.get("workflow") in {"fixture-delivery", "fixture-publication"}:
        ids = payload.get("assetIds") or []
        if not 1 <= len(ids) <= 24 or not payload.get("fixtureId"):
            raise ValueError("Delivery Photos authority needs an exact fixture and 1–24 assets")
        placeholders = ",".join("?" for _ in ids)
        rows = _rows(root, f"""SELECT a.asset_id,a.raw_json FROM sidecar_assets a
            JOIN fixture_asset_decisions d ON d.asset_id=a.asset_id
            WHERE d.fixture_id=? AND a.asset_id IN ({placeholders})""", (payload["fixtureId"], *ids))
        result.update(operations=["photos.export-original"], assetIDs=_photos_ids(rows))
    return result


if __name__ == "__main__":
    raw = sys.stdin.buffer.read(2_000_001)
    if len(raw) > 2_000_000:
        raise ValueError("Photos job action exceeds its size limit")
    request = json.loads(raw)
    print(json.dumps(plan(Path(sys.argv[1]), request), separators=(",", ":")))
