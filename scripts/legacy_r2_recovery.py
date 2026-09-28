"""Reviewable exact-one registration of an approved, already-listed legacy JPEG.

Never reconstructs PhotoKit lineage. Never uploads, changes public catalog
bytes, registers cloud lifecycle bindings, or asserts whole-subject readiness.
The plan binds the unchanged catalog, selected original and explicit owner
recovery decision. Apply re-reads every source and policy under a write fence.
"""

from __future__ import annotations

import argparse
from contextlib import closing
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import tempfile

from legacy_r2_evidence import RecoveryError, get_catalog, read_object, sha256, stamp

SCHEMA = "photosbyelie.legacy-r2-recovery.v1"
REQUEST_FIELDS = {"mediaId", "fixtureId", "originalSha256", "originalBytes", "selectionSha256",
                  "selectionApproval", "recoveryApproval"}


def canonical(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value) -> str:
    return sha256(canonical(value).encode())


def validate_request(request: dict) -> None:
    """Require an exact source and both distinct, durable approval references."""
    if not isinstance(request, dict) or set(request) != REQUEST_FIELDS:
        raise RecoveryError("request_shape_invalid")
    if not isinstance(request["mediaId"], str) or not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,127}", request["mediaId"]):
        raise RecoveryError("media_id_invalid")
    for key in ("originalSha256", "selectionSha256"):
        if not isinstance(request[key], str) or not re.fullmatch(r"[a-f0-9]{64}", request[key]):
            raise RecoveryError("approved_checksum_invalid")
    if type(request["originalBytes"]) is not int or not 0 < request["originalBytes"] <= 256 * 1024 * 1024:
        raise RecoveryError("approved_original_size_invalid")
    for key in ("fixtureId", "selectionApproval", "recoveryApproval"):
        if not isinstance(request[key], str) or not 1 <= len(request[key]) <= 200 or any(ord(c) < 32 for c in request[key]):
            raise RecoveryError("approval_or_fixture_invalid")
    if request["selectionApproval"] == request["recoveryApproval"]:
        raise RecoveryError("distinct_recovery_approval_required")


def _owner(root: Path, mode: str = "ro") -> sqlite3.Connection:
    path = root.resolve() / "assets/owner-actions/Owner.sqlite"
    if not path.is_file() or path.is_symlink():
        raise RecoveryError("owner_database_unavailable")
    conn = sqlite3.connect(path.as_uri() + "?mode=" + mode, uri=True, timeout=2)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    if mode == "ro":
        conn.execute("PRAGMA query_only=ON")
    return conn


def catalog_metadata(payload: bytes, media: str) -> dict:
    """Read the actual immutable catalog row, not caller-supplied public copy."""
    with tempfile.NamedTemporaryFile(suffix=".sqlite", prefix="pbe-legacy-catalog-") as file:
        file.write(payload)
        file.flush()
        db = sqlite3.connect(Path(file.name).as_uri() + "?mode=ro&immutable=1", uri=True)
        db.row_factory = sqlite3.Row
        try:
            if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RecoveryError("catalog_integrity_failed")
            row = db.execute("SELECT * FROM media_items WHERE media_id=?", (media,)).fetchone()
            if row is None:
                raise RecoveryError("legacy_media_not_already_listed")
            row = dict(row)
            kind = db.execute("SELECT code FROM media_types WHERE media_type_id=?", (row["media_type_id"],)).fetchone()
            if kind is None or kind[0] != "photo":
                raise RecoveryError("catalog_media_not_photo")
            objects = []
            for code, bucket, key in (("full", "photosbyelie-private", f"masters/{media}.jpg"),
                    ("still_900", "photosbyelie-public", f"expo/{media}_900.jpg"),
                    ("still_1800", "photosbyelie-public", f"expo/{media}_1800.jpg")):
                assets = db.execute("""SELECT ma.width,ma.height,ma.bytes,f.extension AS format
                    FROM media_assets ma JOIN asset_types t USING(asset_type_id)
                    JOIN formats f USING(format_id) WHERE ma.media_id=? AND t.code=?""", (media, code)).fetchall()
                if (len(assets) != 1 or assets[0]["format"] not in {"jpg", "jpeg"}
                        or any(type(assets[0][k]) is not int or assets[0][k] <= 0 for k in ("width", "height"))
                        or (assets[0]["bytes"] is not None and (type(assets[0]["bytes"]) is not int or assets[0]["bytes"] <= 0))
                        or (code != "full" and max(assets[0]["width"], assets[0]["height"]) > int(code.split("_")[1]))):
                    raise RecoveryError("catalog_photo_assets_invalid")
                objects.append({"bucket": bucket, "key": key,
                                **{k: assets[0][k] for k in ("width", "height", "bytes")}})
            keywords = []
            for value in str(row["keyword_ids"] or "").split(","):
                if not value:
                    continue
                keyword = db.execute("SELECT keyword FROM keyword_terms WHERE keyword_id=?", (int(value),)).fetchone()
                if keyword is None:
                    raise RecoveryError("catalog_keyword_missing")
                keywords.append(keyword[0])
            return {"title": row["title"], "caption": row.get("description") or "", "keywords": keywords,
                    "capturedAt": row.get("captured_at") or "", "rowSha256": digest(row), "objects": objects}
        finally:
            db.close()


def owner_snapshot(conn: sqlite3.Connection, request: dict) -> dict:
    """Fail closed on denial, identity collision, changed policy or projection."""
    from fixture_policy import _legacy_template_key, _validate_policy, template_policy, policy_allows_catalog
    media, fixture = request["mediaId"], request["fixtureId"]
    if conn.execute("SELECT 1 FROM sidecar_assets WHERE asset_id=?", (media,)).fetchone():
        raise RecoveryError("legacy_asset_already_registered")
    aliases_exist = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='owner_asset_identity_aliases'").fetchone()
    if aliases_exist and conn.execute("SELECT 1 FROM owner_asset_identity_aliases WHERE legacy_asset_id=? OR canonical_asset_id=?", (media, media)).fetchone():
        raise RecoveryError("legacy_identity_conflict")
    if conn.execute("SELECT 1 FROM public_catalog_publications WHERE asset_id=? OR media_id=?", (media, media)).fetchone():
        raise RecoveryError("legacy_publication_conflict")
    if conn.execute("SELECT 1 FROM sidecar_tombstones WHERE asset_id=? AND tombstone_state='active'", (media,)).fetchone():
        raise RecoveryError("legacy_tombstoned")
    if conn.execute("SELECT 1 FROM media_lifecycle WHERE media_id=? AND lifecycle_state<>'active'", (media,)).fetchone():
        raise RecoveryError("legacy_lifecycle_denied")
    # Denied historical review is never overridden by a weekly selection.
    denied = conn.execute("SELECT review_state FROM title_keyword_queue WHERE media_id=?", (media,)).fetchone()
    if denied and denied[0] not in {"approved", "applied"}:
        raise RecoveryError("legacy_review_not_approved")
    f = conn.execute("SELECT * FROM fixtures WHERE fixture_id=? AND archived_at IS NULL", (fixture,)).fetchone()
    if f is None or f["parent_fixture_id"] is not None:
        raise RecoveryError("recovery_requires_existing_public_root_fixture")
    # The normal UI policy helper initializes schema and commits. Recovery must
    # instead evaluate this existing root with pure functions under our fence.
    overrides = json.loads(f["policy_overrides_json"] or "{}")
    if not isinstance(overrides, dict):
        raise RecoveryError("fixture_policy_invalid")
    policy = _validate_policy({**template_policy(_legacy_template_key(f)),
                               **_validate_policy(overrides, partial=True)}, partial=False)
    if not policy_allows_catalog(policy):
        raise RecoveryError("fixture_not_public_catalog_eligible")
    projection = conn.execute("SELECT revision,catalog_blob,catalog_sha256,approved_policy FROM owner_public_catalog_projections WHERE projection_id='public-catalog'").fetchone()
    if projection is None or projection["approved_policy"] != "PBE-173" or sha256(projection["catalog_blob"]) != projection["catalog_sha256"]:
        raise RecoveryError("owner_projection_invalid")
    enrollment = conn.execute("SELECT publisher_id,generation,projection_revision,catalog_sha256,state FROM owner_public_catalog_authority_enrollment WHERE projection_id='public-catalog'").fetchone()
    if enrollment is None or enrollment["state"] != "verified" or enrollment["projection_revision"] != projection["revision"] or enrollment["catalog_sha256"] != projection["catalog_sha256"]:
        raise RecoveryError("catalog_authority_not_current")
    # No existing R2 inventory may belong to another identity or deletion state.
    keys = [("photosbyelie-private", f"masters/{media}.jpg"), *[("photosbyelie-public", f"expo/{media}_{s}.jpg") for s in (900, 1800)]]
    for bucket, key in keys:
        row = conn.execute("SELECT photo_id,lifecycle_state FROM r2_objects WHERE bucket=? AND object_key=?", (bucket, key)).fetchone()
        if row and (row["photo_id"] != media or row["lifecycle_state"] != "current"):
            raise RecoveryError("r2_inventory_conflict")
    return {"revision": projection["revision"], "catalogSha256": projection["catalog_sha256"],
            "authority": dict(enrollment), "fixtureSha256": digest(dict(f)), "policy": policy,
            "metadata": catalog_metadata(projection["catalog_blob"], media)}


def build_plan(root: Path, request: dict, *, object_reader=read_object, catalog_reader=get_catalog) -> dict:
    """Read-only exact-one plan, with full independent remote byte verification."""
    validate_request(request)
    with closing(_owner(root)) as conn:
        conn.execute("BEGIN")
        snapshot = owner_snapshot(conn, request)
    if sha256(catalog_reader()) != snapshot["catalogSha256"]:
        raise RecoveryError("public_catalog_parity_failed")
    media = request["mediaId"]
    objects = [object_reader("photosbyelie-private", f"masters/{media}.jpg")]
    objects += [object_reader("photosbyelie-public", f"expo/{media}_{size}.jpg") for size in (900, 1800)]
    if objects[0]["sha256"] != request["originalSha256"] or objects[0]["bytes"] != request["originalBytes"]:
        raise RecoveryError("approved_original_mismatch")
    for obj, metadata in zip(objects, snapshot["metadata"]["objects"]):
        if (obj["bucket"] != metadata["bucket"] or obj["key"] != metadata["key"]
                or any(type(obj[k]) is not int or obj[k] <= 0 for k in ("width", "height", "bytes"))
                or obj.get("contentType") != "image/jpeg"
                or obj.get("method") != "authenticated-full-get-sha256"
                or not re.fullmatch(r"[a-f0-9]{64}", obj.get("sha256", ""))):
            raise RecoveryError("object_catalog_mismatch")
        if obj["bucket"] == "photosbyelie-public" and max(obj["width"], obj["height"]) > int(obj["key"].rsplit("_", 1)[1].split(".")[0]):
            raise RecoveryError("preview_dimensions_outside_contract")
    observations = [obj["checkedAt"] for obj in objects]
    body = {"schema": SCHEMA, "request": request, "owner": snapshot,
            "objects": [{k: v for k, v in row.items() if k != "checkedAt"} for row in objects]}
    return {**body, "planSha256": digest(body), "checkedAt": stamp(),
            "observedAt": observations, "state": "reviewable_no_writes"}


def apply_plan(root: Path, plan: dict, *, approved_plan_sha256: str, backup_path: Path,
               object_reader=read_object, catalog_reader=get_catalog) -> dict:
    """Apply only a reverified reviewed plan; state mutation is one transaction."""
    from legacy_r2_runtime import require_installed_runtime
    require_installed_runtime(root)
    from legacy_r2_recovery_store import register_exact_legacy
    fields = {"schema", "request", "owner", "objects"}
    if (not isinstance(plan, dict) or set(plan) != fields | {"planSha256", "checkedAt", "observedAt", "state"}
            or plan.get("schema") != SCHEMA or plan.get("planSha256") != approved_plan_sha256
            or digest({key: plan[key] for key in fields}) != approved_plan_sha256):
        raise RecoveryError("reviewed_plan_required")
    from legacy_r2_source import replay_result
    with closing(_owner(root)) as existing:
        replay = replay_result(existing, plan)
        if replay:
            return replay
    fresh = build_plan(root, plan["request"], object_reader=object_reader, catalog_reader=catalog_reader)
    if fresh["planSha256"] != approved_plan_sha256:
        raise RecoveryError("reviewed_plan_changed")
    private_parent = root.resolve() / "assets/owner-actions"
    if (not backup_path.is_absolute() or backup_path.parent != private_parent
            or backup_path.parent.resolve() != private_parent or backup_path.exists() or backup_path.is_symlink()
            or backup_path.suffix != ".sqlite"):
        raise RecoveryError("new_absolute_private_backup_required")
    # The private backup precedes the write lock; registration rechecks its exact
    # owner snapshot under BEGIN IMMEDIATE before changing any row.
    import os
    descriptor = os.open(backup_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(descriptor)
    with closing(_owner(root)) as source, closing(sqlite3.connect(backup_path)) as backup:
        source.backup(backup)
    conn = _owner(root, "rw")
    try:
        conn.execute("BEGIN IMMEDIATE")
        if owner_snapshot(conn, plan["request"]) != plan["owner"]:
            raise RecoveryError("owner_changed_before_registration")
        from datetime import datetime, timezone
        if any(not 0 <= (datetime.now(timezone.utc) - datetime.fromisoformat(at.replace("Z", "+00:00"))).total_seconds() <= 120
               for at in fresh["observedAt"]):
            raise RecoveryError("object_evidence_expired")
        if not conn.in_transaction:
            raise RecoveryError("registration_fence_lost")
        result = register_exact_legacy(conn, fresh)
        conn.commit()
        return {**result, "backupPath": str(backup_path), "catalogChanged": False,
                "catalogMetadataRepairRequired": any(any(obj[k] != old[k] for k in ("width", "height", "bytes"))
                    for obj, old in zip(fresh["objects"], fresh["owner"]["metadata"]["objects"])),
                "uploaded": False, "cloudLifecycleRegistered": False, "wholeSubjectReady": False}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def main() -> int:
    """Explicit maintenance entry point; no write without exact plan approval."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--request", type=Path)
    group.add_argument("--apply-plan", type=Path)
    parser.add_argument("--approved-plan-sha256", default="")
    parser.add_argument("--backup", type=Path)
    parser.add_argument("--repair-catalog-metadata", action="store_true",
                        help="After registration only: prepare exact existing asset metadata via catalog authority; no deployment")
    args = parser.parse_args()
    try:
        if args.request:
            if args.repair_catalog_metadata:
                raise RecoveryError("registered_plan_required")
            result = build_plan(args.repo_root, json.loads(args.request.read_text()))
        else:
            if args.repair_catalog_metadata:
                from legacy_r2_catalog import repair_catalog_metadata
                result = repair_catalog_metadata(args.repo_root, json.loads(args.apply_plan.read_text()),
                                                  approved_plan_sha256=args.approved_plan_sha256)
            elif not args.backup:
                raise RecoveryError("private_backup_required")
            else:
                result = apply_plan(args.repo_root, json.loads(args.apply_plan.read_text()),
                    approved_plan_sha256=args.approved_plan_sha256, backup_path=args.backup)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        print(json.dumps({"ok": False, "code": str(error) if isinstance(error, RecoveryError) else "recovery_failed_no_provider_detail"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
