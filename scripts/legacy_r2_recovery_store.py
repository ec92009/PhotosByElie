"""Transactional native Owner registration for a verified legacy-source plan.

Called only after plan approval and fresh evidence, inside BEGIN IMMEDIATE.
These are real source/approval/observation events, never invented Photos or
upload events. Catalog deployment and cloud lifecycle verification stay separate.
"""

from __future__ import annotations

import json

from fixture_pipeline import record_delivery_receipt
from legacy_r2_evidence import stamp
from native_catalog_promotion import record_catalog_pending
from native_publication_pipeline import _upsert_source_version, metadata_fingerprint


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def register_exact_legacy(conn, plan: dict) -> dict:
    """Register one new exact source; caller owns validation, commit and rollback."""
    if not conn.in_transaction:
        raise ValueError("legacy registration requires a caller transaction")
    request, metadata = plan["request"], plan["owner"]["metadata"]
    media, fixture = request["mediaId"], request["fixtureId"]
    operation = "legacy-r2-" + plan["planSha256"]
    anchor = f"legacy-r2://photosbyelie-private/masters/{media}.jpg#sha256={request['originalSha256']}"
    at = stamp()
    raw = {"assetId": media, "sourceKind": "legacy_r2", "sourceAnchor": anchor,
           "sourceSha256": request["originalSha256"], "sourceBytes": request["originalBytes"],
           "filename": media + ".jpg", "mediaType": "photo", "recoveryOperation": operation,
           "selectionApproval": request["selectionApproval"], "recoveryApproval": request["recoveryApproval"]}
    conn.execute("""INSERT INTO sidecar_assets
        (asset_id,source_anchor,media_type,filename,captured_at,photos_title,photos_keywords_json,
         pixel_width,pixel_height,raw_json,indexed_at,updated_at)
        VALUES (?,?,'photo',?,?,?,?,?,?,?,?,?)""",
        (media, anchor, media + ".jpg", metadata["capturedAt"], metadata["title"],
         _json(metadata["keywords"]), plan["objects"][0].get("width", 0),
         plan["objects"][0].get("height", 0), _json(raw), at, at))
    conn.execute("""INSERT INTO sidecar_decisions
        (asset_id,pick_state,metadata_state,title,caption,keywords_json,last_action,created_at,updated_at)
        VALUES (?,'picked','approved',?,?,?,'legacy-r2-recovery',?,?)""",
        (media, metadata["title"], metadata["caption"], _json(metadata["keywords"]), at, at))
    conn.execute("""INSERT INTO asset_editorial_state
        (asset_id,editorial_state,approved_at,created_at,updated_at)
        VALUES (?,'approved',?,?,?)""", (media, at, at, at))
    conn.execute("""INSERT INTO asset_editorial_events
        (event_id,asset_id,fixture_id,action,before_state,after_state,before_json,after_json,actor,created_at)
        VALUES (?,?,?,'legacy-source-recovery','absent','approved','{}',?,'owner-approved-recovery',?)""",
        (operation + ":approval", media, fixture, _json({"metadata": metadata, "approval": request}), at))
    version = _upsert_source_version(conn, media,
        metadata_fingerprint(metadata["title"], metadata["caption"], metadata["keywords"]),
        request["originalSha256"], "live", at)
    conn.execute("""INSERT INTO asset_delivery_state
        (asset_id,delivery_state,source_version_hash,created_at,updated_at)
        VALUES (?,'live',?,?,?)""", (media, version, at, at))
    conn.execute("""INSERT INTO fixture_asset_decisions
        (fixture_id,asset_id,placement_state,eligibility_state,source,last_action,created_at,updated_at)
        VALUES (?,?,'picked','active','legacy-r2-recovery','register-approved-source',?,?)""",
        (fixture, media, at, at))
    conn.execute("""INSERT INTO fixture_asset_decision_events
        (event_id,fixture_id,asset_id,before_state,after_state,before_eligibility,after_eligibility,action,actor,reason,created_at)
        VALUES (?,?,?,'undecided','picked','dormant','active','legacy-source-recovery','owner-approved-recovery',?,?)""",
        (operation + ":placement", fixture, media, request["recoveryApproval"], at))
    conn.execute("""INSERT INTO asset_publications
        (asset_id,fixture_id,source_version_hash,state,published_at,updated_at)
        VALUES (?,?,?,'live',?,?)""", (media, fixture, version, at, at))
    receipts = []
    for obj, observed_at in zip(plan["objects"], plan["observedAt"]):
        private = obj["bucket"] == "photosbyelie-private"
        kind = "private-master" if private else "public-preview"
        conn.execute("""INSERT INTO r2_objects
            (bucket,object_key,photo_id,object_kind,lifecycle_state,first_seen_at,last_seen_at,last_checked_at,source,bytes,updated_at)
            VALUES (?,?,?,?,'current',?,?,?,'legacy-r2-observation',?,?)
            ON CONFLICT(bucket,object_key) DO UPDATE SET
              last_seen_at=excluded.last_seen_at,last_checked_at=excluded.last_checked_at,
              source=excluded.source,bytes=excluded.bytes,updated_at=excluded.updated_at""",
            (obj["bucket"], obj["key"], media, kind, at, at, at, obj["bytes"], at))
        receipts.append(record_delivery_receipt(
            None, fixture_id=fixture, asset_id=media, destination="r2", version_hash=version,
            status="verified", object_key=obj["key"], checksum_sha256=obj["sha256"],
            visibility_policy="private" if private else "public", conn=conn,
            verification={"bucket": obj["bucket"], "bytes": obj["bytes"], "remoteVerified": True,
                          "remoteChecksumSha256": obj["sha256"], "contentType": obj["contentType"],
                          "method": obj["method"], "observedAt": observed_at,
                          "newUpload": False, "operationId": operation}))
    record_catalog_pending(conn, asset_id=media, source_version_hash=version, media_id=media, timestamp=at)
    # Exact current bytes were independently read but no public-access/lifecycle
    # claim is made here. Existing native verifier must advance this separately.
    conn.execute("""UPDATE public_catalog_publications SET state='local',catalog_sha256=?
        WHERE asset_id=? AND source_version_hash=?""", (plan["owner"]["catalogSha256"], media, version))
    conn.execute("""INSERT INTO fixture_source_batches
        (batch_id,fixture_id,source_kind,source_identity,provenance_json,created_at)
        VALUES (?,?,'legacy_r2',?,?,?)""", (operation, fixture, anchor, _json(plan), at))
    return {"ok": True, "state": "registered_catalog_verification_pending", "assetId": media,
            "mediaId": media, "sourceVersionHash": version, "operationId": operation,
            "receiptCount": len(receipts), "checkedAt": at}
