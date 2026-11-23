"""Exact existing-listing metadata repair through the guarded catalog authority.

This changes only three existing media_assets rows (dimensions and byte counts).
It cannot add listings, change editorial/commerce data, deploy or mark Live.
"""

from __future__ import annotations

from contextlib import closing
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import tempfile

from legacy_r2_evidence import RecoveryError, get_catalog, read_object, sha256, stamp
from legacy_r2_recovery import _owner, canonical, digest, catalog_metadata
from legacy_r2_source import verified_legacy_source


def _current(conn, plan):
    """Check current approval, fixture, version and receipt authority read-only."""
    from fixture_policy import template_policy, _legacy_template_key, _validate_policy, policy_allows_catalog
    from native_publication_pipeline import source_version_id, metadata_fingerprint
    request = plan["request"]
    media, fixture = request["mediaId"], request["fixtureId"]
    metadata = plan["owner"]["metadata"]
    version = source_version_id(media, metadata_fingerprint(metadata["title"], metadata["caption"], metadata["keywords"]), request["originalSha256"])
    if not verified_legacy_source(conn, media):
        raise RecoveryError("registered_legacy_provenance_changed")
    if conn.execute("SELECT 1 FROM sidecar_tombstones WHERE asset_id=? AND tombstone_state='active'", (media,)).fetchone():
        raise RecoveryError("legacy_tombstoned")
    if conn.execute("SELECT 1 FROM media_lifecycle WHERE media_id=? AND lifecycle_state<>'active'", (media,)).fetchone():
        raise RecoveryError("legacy_lifecycle_denied")
    asset = conn.execute("""SELECT a.missing_at,e.editorial_state,d.source_version_hash,d.delivery_state,
        s.title,s.caption,s.keywords_json FROM sidecar_assets a JOIN asset_editorial_state e USING(asset_id)
        JOIN asset_delivery_state d USING(asset_id) JOIN sidecar_decisions s USING(asset_id) WHERE a.asset_id=?""", (media,)).fetchone()
    if (asset is None or asset["missing_at"] is not None or asset["editorial_state"] != "approved"
            or asset["source_version_hash"] != version or asset["delivery_state"] != "live"
            or metadata_fingerprint(asset["title"], asset["caption"], json.loads(asset["keywords_json"])) !=
               metadata_fingerprint(metadata["title"], metadata["caption"], metadata["keywords"])):
        raise RecoveryError("legacy_approval_or_version_changed")
    latest = conn.execute("SELECT * FROM asset_source_versions WHERE asset_id=? ORDER BY created_at DESC,version_id DESC LIMIT 1", (media,)).fetchone()
    if latest is None or latest["version_id"] != version or latest["state"] != "live" or not latest["source_exists"] or latest["superseded_at"]:
        raise RecoveryError("legacy_source_version_changed")
    row = conn.execute("SELECT * FROM fixtures WHERE fixture_id=? AND archived_at IS NULL", (fixture,)).fetchone()
    if row is None or row["parent_fixture_id"] is not None or digest(dict(row)) != plan["owner"]["fixtureSha256"]:
        raise RecoveryError("legacy_fixture_changed")
    policy = _validate_policy({**template_policy(_legacy_template_key(row)),
                              **_validate_policy(json.loads(row["policy_overrides_json"]), partial=True)}, partial=False)
    if not policy_allows_catalog(policy):
        raise RecoveryError("legacy_fixture_not_public")
    placed = conn.execute("SELECT 1 FROM fixture_asset_decisions WHERE fixture_id=? AND asset_id=? AND placement_state='picked' AND eligibility_state='active'", (fixture, media)).fetchone()
    published = conn.execute("SELECT 1 FROM asset_publications WHERE fixture_id=? AND asset_id=? AND source_version_hash=? AND state='live' AND withdrawn_at IS NULL", (fixture, media, version)).fetchone()
    if not placed or not published:
        raise RecoveryError("legacy_publication_changed")
    for obj in plan["objects"]:
        receipt = conn.execute("""SELECT * FROM fixture_delivery_receipts WHERE fixture_id=? AND asset_id=?
            AND destination='r2' AND version_hash=? AND object_key=? ORDER BY created_at DESC LIMIT 1""",
            (fixture, media, version, obj["key"])).fetchone()
        inventory = conn.execute("SELECT photo_id,lifecycle_state,bytes FROM r2_objects WHERE bucket=? AND object_key=?", (obj["bucket"], obj["key"])).fetchone()
        if (receipt is None or receipt["status"] != "verified" or receipt["checksum_sha256"] != obj["sha256"]
                or inventory is None or tuple(inventory) != (media, "current", obj["bytes"])):
            raise RecoveryError("legacy_delivery_proof_changed")
        try:
            verified = datetime.fromisoformat(receipt["verified_at"].replace("Z", "+00:00"))
            if (verified.tzinfo is None or verified > datetime.now(timezone.utc)
                    or receipt["visibility_policy"] != ("private" if obj["bucket"] == "photosbyelie-private" else "public")):
                raise ValueError()
        except (TypeError, ValueError, AttributeError):
            raise RecoveryError("legacy_delivery_proof_changed") from None
        proof = json.loads(receipt["verification_json"])
        if proof.get("bucket") != obj["bucket"] or proof.get("bytes") != obj["bytes"] or proof.get("remoteVerified") is not True or proof.get("remoteChecksumSha256") != obj["sha256"]:
            raise RecoveryError("legacy_delivery_proof_changed")
    return version


def repaired_catalog(payload: bytes, plan: dict) -> bytes:
    """Patch only existing asset sizes/dimensions, keeping all other rows intact."""
    media = plan["request"]["mediaId"]
    before = catalog_metadata(payload, media)
    if before["rowSha256"] != plan["owner"]["metadata"]["rowSha256"]:
        raise RecoveryError("catalog_listing_changed")
    with tempfile.NamedTemporaryFile(prefix="pbe-legacy-public-metadata-", suffix=".sqlite") as file:
        file.write(payload)
        file.flush()
        with closing(sqlite3.connect(file.name)) as db, db:
            for code, obj in zip(("full", "still_900", "still_1800"), plan["objects"]):
                count = db.execute("""UPDATE media_assets SET width=?,height=?,bytes=? WHERE media_id=?
                    AND asset_type_id=(SELECT asset_type_id FROM asset_types WHERE code=?)""",
                    (obj["width"], obj["height"], obj["bytes"], media, code)).rowcount
                if count != 1:
                    raise RecoveryError("catalog_asset_row_changed")
            if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or db.execute("PRAGMA foreign_key_check").fetchall():
                raise RecoveryError("repaired_catalog_invalid")
        return Path(file.name).read_bytes()


def repair_catalog_metadata(root: Path, plan: dict, *, approved_plan_sha256: str,
                            object_reader=read_object, catalog_reader=get_catalog, authority_client=None) -> dict:
    """Reverify the registered exact source, then prepare one guarded projection."""
    from legacy_r2_runtime import require_installed_runtime
    require_installed_runtime(root)
    from owner_catalog_projection import store_projection
    fields = ("schema", "request", "owner", "objects")
    if plan.get("planSha256") != approved_plan_sha256 or digest({key: plan[key] for key in fields}) != approved_plan_sha256:
        raise RecoveryError("reviewed_plan_required")
    with closing(_owner(root)) as conn:
        version = _current(conn, plan)
        current = conn.execute("SELECT catalog_blob,catalog_sha256 FROM owner_public_catalog_projections WHERE projection_id='public-catalog'").fetchone()
        original, original_sha = bytes(current[0]), current[1]
    if original_sha != plan["owner"]["catalogSha256"] or sha256(catalog_reader()) != original_sha:
        raise RecoveryError("catalog_changed_or_not_deployed")
    observations = []
    for expected in plan["objects"]:
        observed = object_reader(expected["bucket"], expected["key"])
        if {k: v for k, v in observed.items() if k != "checkedAt"} != expected:
            raise RecoveryError("recovered_object_changed")
        observations.append(observed["checkedAt"])
    candidate = repaired_catalog(original, plan)
    with closing(_owner(root, "rw")) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        _current(conn, plan)
        if any(not 0 <= (datetime.now(timezone.utc) - datetime.fromisoformat(at.replace("Z", "+00:00"))).total_seconds() <= 120
               for at in observations):
            raise RecoveryError("object_evidence_expired")
        result = store_projection(conn, candidate, source_kind="legacy-r2-exact-asset-metadata",
                                  expected_sha256=original_sha, ensure_schema=False, authority_client=authority_client)
        conn.execute("UPDATE public_catalog_publications SET state='local',catalog_sha256=? WHERE asset_id=? AND source_version_hash=?",
                     (result["sha256"], plan["request"]["mediaId"], version))
    return {"ok": True, "state": "catalog_projection_prepared_not_deployed", "sha256": result["sha256"],
            "revision": result["revision"], "mediaCount": result["mediaCount"], "addedListings": 0,
            "wholeSubjectReady": False, "checkedAt": stamp()}
