"""Read-only authority and exact-byte plans for existing public preview repair.

No source adoption, uploads, approval changes, new listings or object-key changes.
Only an already-verified SHA256 may authorize a corrected preview byte count.
"""
from contextlib import closing
import json
import re

from legacy_r2_evidence import RecoveryError, get_catalog, read_object, sha256, stamp
from legacy_r2_recovery import _owner, canonical, digest, catalog_metadata

SCHEMA = "photosbyelie.verified-preview-metadata.v1"


def validate_request(request):
    """Bound the explicit media set and durable owner repair authorization."""
    if not isinstance(request, dict) or set(request) != {"mediaIds", "authorization"}:
        raise RecoveryError("repair_request_invalid")
    ids = request["mediaIds"]
    if (not isinstance(ids, list) or not 1 <= len(ids) <= 20
            or any(not isinstance(x, str) or not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,127}", x) for x in ids)
            or ids != sorted(set(ids))):
        raise RecoveryError("repair_media_scope_invalid")
    auth = request["authorization"]
    if not isinstance(auth, str) or not 1 <= len(auth) <= 300 or any(ord(c) < 32 for c in auth):
        raise RecoveryError("repair_authorization_required")


def _rows(conn, query, args=()):
    return [dict(row) for row in conn.execute(query, args)]


def _policy(conn, fixture):
    """Resolve existing policies without schema creation or implicit commits."""
    from fixture_policy import template_policy, _legacy_template_key, _validate_policy, policy_allows_catalog
    chain, seen = [], set()
    while fixture:
        if fixture in seen or len(seen) >= 32:
            raise RecoveryError("fixture_policy_cycle")
        seen.add(fixture)
        rows = _rows(conn, "SELECT * FROM fixtures WHERE fixture_id=? AND archived_at IS NULL", (fixture,))
        if len(rows) != 1:
            raise RecoveryError("fixture_unavailable")
        chain.append(rows[0])
        fixture = rows[0]["parent_fixture_id"]
    chain.reverse()
    policy = template_policy(_legacy_template_key(chain[0]))
    for row in chain:
        policy.update(_validate_policy(json.loads(row["policy_overrides_json"]), partial=True))
    policy = _validate_policy(policy, partial=False)
    if not policy_allows_catalog(policy) or policy["retention"] != "public-preview":
        raise RecoveryError("fixture_not_public")
    return chain


def owner_snapshot(conn, request):
    """Fence the current, unambiguous native publication and every touched row."""
    validate_request(request)
    row = conn.execute("SELECT * FROM owner_public_catalog_projections WHERE projection_id='public-catalog'").fetchone()
    if row is None or row["approved_policy"] != "PBE-173" or sha256(bytes(row["catalog_blob"])) != row["catalog_sha256"]:
        raise RecoveryError("catalog_projection_unverified")
    payload = bytes(row["catalog_blob"])
    snapshot = {"catalogSha256": row["catalog_sha256"], "revision": row["revision"], "items": []}
    for media in request["mediaIds"]:
        pubs = _rows(conn, """SELECT c.* FROM public_catalog_publications c
            JOIN asset_editorial_state e USING(asset_id) JOIN asset_delivery_state d USING(asset_id)
            JOIN asset_source_versions v ON v.asset_id=c.asset_id AND v.version_id=c.source_version_hash
            JOIN sidecar_assets a USING(asset_id)
            WHERE c.media_id=? AND c.state='live' AND e.editorial_state='approved'
              AND d.delivery_state='live' AND d.source_version_hash=c.source_version_hash
              AND v.state='live' AND v.source_exists=1 AND v.superseded_at IS NULL
              AND a.missing_at IS NULL AND a.media_type='photo'""", (media,))
        if len(pubs) != 1:
            raise RecoveryError("current_publication_ambiguous_or_missing")
        pub = pubs[0]
        if (pub["public_url"] != "https://photos-by-elie.com/assets/catalog/photosbyelie.sqlite"
                or pub["catalog_sha256"] != snapshot["catalogSha256"]):
            raise RecoveryError("publication_catalog_changed")
        asset, version = pub["asset_id"], pub["source_version_hash"]
        if conn.execute("SELECT 1 FROM sidecar_tombstones WHERE asset_id=? AND tombstone_state='active'", (asset,)).fetchone():
            raise RecoveryError("asset_tombstoned")
        if conn.execute("SELECT 1 FROM media_lifecycle WHERE media_id IN (?,?) AND lifecycle_state<>'active'", (asset, media)).fetchone():
            raise RecoveryError("asset_lifecycle_denied")
        latest = _rows(conn, "SELECT * FROM asset_source_versions WHERE asset_id=? ORDER BY created_at DESC,version_id DESC LIMIT 1", (asset,))
        if not latest or latest[0]["version_id"] != version:
            raise RecoveryError("source_version_changed")
        fixtures = _rows(conn, """SELECT p.*, d.placement_state,d.eligibility_state FROM asset_publications p
            JOIN fixture_asset_decisions d ON d.asset_id=p.asset_id AND d.fixture_id=p.fixture_id
            WHERE p.asset_id=? AND p.source_version_hash=? AND p.state='live' AND p.withdrawn_at IS NULL
              AND d.placement_state='picked' AND d.eligibility_state='active' ORDER BY p.fixture_id""", (asset, version))
        if not fixtures:
            raise RecoveryError("fixture_publication_missing")
        item = {"mediaId": media, "assetId": asset, "version": version, "publication": pub,
                "source": latest, "editorial": _rows(conn, "SELECT * FROM asset_editorial_state WHERE asset_id=?", (asset,)),
                "fixtures": fixtures, "policies": [], "editions": [], "previews": []}
        for fixture in fixtures:
            fid = fixture["fixture_id"]
            item["policies"].append(_policy(conn, fid))
            if conn.execute("SELECT 1 FROM sqlite_master WHERE name='fixture_asset_editions'").fetchone():
                editions = _rows(conn, "SELECT * FROM fixture_asset_editions WHERE asset_id=? AND fixture_id=?", (asset, fid))
                if editions and (editions[0]["editorial_state"] != "approved" or editions[0]["source_version_id"] != version):
                    raise RecoveryError("fixture_edition_changed")
                item["editions"].extend(editions)
        metadata = catalog_metadata(payload, media)
        for size, old in zip((900, 1800), metadata["objects"][1:]):
            key = f"expo/{media}_{size}.jpg"
            inventories = _rows(conn, "SELECT * FROM r2_objects WHERE bucket='photosbyelie-public' AND object_key=?", (key,))
            if len(inventories) != 1 or inventories[0]["photo_id"] != asset or inventories[0]["lifecycle_state"] != "current":
                raise RecoveryError("preview_inventory_changed")
            receipts = []
            for fixture in fixtures:
                found = _rows(conn, """SELECT * FROM fixture_delivery_receipts WHERE asset_id=? AND fixture_id=?
                    AND version_hash=? AND destination='r2' AND object_key=?
                    ORDER BY COALESCE(verified_at,updated_at) DESC,receipt_id DESC LIMIT 1""", (asset, fixture["fixture_id"], version, key))
                if len(found) != 1:
                    raise RecoveryError("preview_receipt_missing")
                receipt = found[0]
                proof = json.loads(receipt["verification_json"])
                if (receipt["status"] != "verified" or receipt["visibility_policy"] != "public" or not receipt["verified_at"]
                        or not re.fullmatch(r"[a-f0-9]{64}", receipt["checksum_sha256"])
                        or proof.get("remoteVerified") is not True or proof.get("remoteChecksumSha256") != receipt["checksum_sha256"]
                        or proof.get("bucket") != "photosbyelie-public" or type(proof.get("bytes")) is not int
                        or proof["bytes"] <= 0 or proof["bytes"] != inventories[0]["bytes"]):
                    raise RecoveryError("preview_receipt_unverified")
                receipts.append(receipt)
            if len({r["checksum_sha256"] for r in receipts}) != 1:
                raise RecoveryError("preview_receipts_conflict")
            item["previews"].append({"catalog": old, "inventory": inventories[0], "receipts": receipts})
        snapshot["items"].append(item)
    return snapshot, payload


def build_plan(root, request, *, object_reader=read_object, catalog_reader=get_catalog):
    """GET exact preview bytes; changed hashes/dimensions never qualify as metadata repair."""
    with closing(_owner(root)) as conn:
        conn.execute("BEGIN")
        snapshot, payload = owner_snapshot(conn, request)
    if sha256(catalog_reader()) != sha256(payload):
        raise RecoveryError("catalog_not_deployed")
    objects, observations = [], []
    for item in snapshot["items"]:
        for preview in item["previews"]:
            old = preview["catalog"]
            obj = object_reader(old["bucket"], old["key"])
            if (obj["sha256"] != preview["receipts"][0]["checksum_sha256"]
                    or any(obj[k] != old[k] for k in ("bucket", "key", "width", "height"))
                    or obj.get("method") != "authenticated-full-get-sha256" or obj.get("contentType") != "image/jpeg"
                    or type(obj.get("bytes")) is not int or not 0 < obj["bytes"] <= 256 * 1024 * 1024):
                raise RecoveryError("preview_content_changed")
            observations.append(obj["checkedAt"])
            objects.append({k: v for k, v in obj.items() if k != "checkedAt"})
    body = {"schema": SCHEMA, "request": request, "owner": snapshot, "objects": objects}
    return {**body, "planSha256": digest(body), "observedAt": observations, "checkedAt": stamp(), "state": "reviewable_no_writes"}
