"""Separate legacy R2 provenance from PhotoKit capabilities, without writes."""

from __future__ import annotations

import hashlib
import json
import sqlite3


def is_legacy_source(anchor, raw=None) -> bool:
    """Untrusted markers may deny Photos capability, never grant scan immunity."""
    return str(anchor or "").lower().startswith("legacy-r2:") or (
        isinstance(raw, dict) and str(raw.get("sourceKind", "")).lower() == "legacy_r2")


def verified_legacy_source(conn, asset_id: str) -> bool:
    """Require the native recovery's exact immutable batch and original binding."""
    try:
        row = conn.execute("SELECT source_anchor,raw_json,media_type FROM sidecar_assets WHERE asset_id=?", (asset_id,)).fetchone()
        if row is None or row["media_type"] != "photo":
            return False
        raw = json.loads(row["raw_json"])
        if not isinstance(raw, dict) or any(raw.get(key) for key in ("localIdentifier", "cloudIdentifier", "photosAssetId", "photoLibraryIdentifier")):
            return False
        batch = conn.execute("SELECT source_identity,provenance_json FROM fixture_source_batches WHERE batch_id=? AND source_kind='legacy_r2'",
                             (raw.get("recoveryOperation", ""),)).fetchone()
        if not batch:
            return False
        plan = json.loads(batch["provenance_json"])
        body = {key: plan[key] for key in ("schema", "request", "owner", "objects")}
        checksum = hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True,
                                             separators=(",", ":"), allow_nan=False).encode()).hexdigest()
        request = plan["request"]
        expected = f"legacy-r2://photosbyelie-private/masters/{asset_id}.jpg#sha256={request['originalSha256']}"
        return (plan["schema"] == "photosbyelie.legacy-r2-recovery.v1"
                and checksum == plan["planSha256"] and raw["recoveryOperation"] == "legacy-r2-" + checksum
                and raw["sourceKind"] == "legacy_r2" and raw["assetId"] == request["mediaId"] == asset_id
                and batch["source_identity"] == row["source_anchor"] == raw["sourceAnchor"] == expected
                and raw["sourceSha256"] == request["originalSha256"] == plan["objects"][0]["sha256"]
                and raw["sourceBytes"] == request["originalBytes"] == plan["objects"][0]["bytes"]
                and raw["selectionApproval"] == request["selectionApproval"]
                and raw["recoveryApproval"] == request["recoveryApproval"])
    except (KeyError, TypeError, ValueError, AttributeError, IndexError, sqlite3.Error):
        return False


def reject_legacy_photos(conn, asset_id: str) -> None:
    """Block before any queue/ledger/export/writeback side effect."""
    row = conn.execute("SELECT source_anchor,raw_json FROM sidecar_assets WHERE asset_id=?", (asset_id,)).fetchone()
    if row and is_legacy_source(row["source_anchor"], json.loads(row["raw_json"] or "{}")):
        raise ValueError("legacy_r2_source_has_no_photos_capability")


def reject_legacy_photos_at_root(root, asset_ids) -> None:
    """Read existing Owner state only, with no schema initializer."""
    path = root.resolve() / "assets/owner-actions/Owner.sqlite"
    if not path.exists():
        return
    conn = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        for asset_id in asset_ids:
            reject_legacy_photos(conn, asset_id)
    finally:
        conn.close()


def replay_result(conn, plan: dict):
    """Reconcile an existing atomic registration; never reinstate denied state."""
    batch = conn.execute("SELECT provenance_json FROM fixture_source_batches WHERE batch_id=?",
                         ("legacy-r2-" + plan["planSha256"],)).fetchone()
    if batch is None:
        return None
    from legacy_r2_evidence import RecoveryError
    recorded = json.loads(batch["provenance_json"])
    if (any(recorded[key] != plan[key] for key in ("schema", "request", "owner", "objects"))
            or not verified_legacy_source(conn, plan["request"]["mediaId"])):
        raise RecoveryError("registered_legacy_provenance_changed")
    return {"ok": True, "state": "already_registered_requires_current_readiness",
            "assetId": plan["request"]["mediaId"], "operationId": "legacy-r2-" + plan["planSha256"],
            "changed": False, "wholeSubjectReady": False}
