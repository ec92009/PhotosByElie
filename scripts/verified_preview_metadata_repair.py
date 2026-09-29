"""Installed Backstage command for exact existing-preview byte metadata repair.

Prepare is GET-only. Apply revalidates the approved plan and commits only receipt
and inventory size corrections, a guarded catalog projection, and an audit row.
It never uploads, approves, registers identities, deploys, or marks a subject done.
"""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import tempfile

from legacy_r2_evidence import RecoveryError, get_catalog, read_object, sha256, stamp
from legacy_r2_recovery import _owner, canonical, digest
from verified_preview_metadata import SCHEMA, build_plan, owner_snapshot


def candidate_catalog(payload, plan):
    """Only the existing still_900/still_1800 byte-count cells can change."""
    objects = {row["key"]: row for row in plan["objects"]}
    with tempfile.NamedTemporaryFile(prefix="pbe-preview-metadata-", suffix=".sqlite") as file:
        file.write(payload)
        file.flush()
        with closing(sqlite3.connect(file.name)) as conn, conn:
            for item in plan["owner"]["items"]:
                for size, preview in zip((900, 1800), item["previews"]):
                    old = preview["catalog"]
                    row = objects[old["key"]]
                    changed = conn.execute("""UPDATE media_assets SET bytes=? WHERE media_id=?
                        AND asset_type_id=(SELECT asset_type_id FROM asset_types WHERE code=?)
                        AND bytes IS ? AND width=? AND height=?""",
                        (row["bytes"], item["mediaId"], f"still_{size}", old["bytes"], old["width"], old["height"])).rowcount
                    if changed != 1:
                        raise RecoveryError("catalog_preview_row_changed")
            if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or conn.execute("PRAGMA foreign_key_check").fetchall():
                raise RecoveryError("candidate_catalog_invalid")
        return Path(file.name).read_bytes()


def _replay(conn, plan_hash):
    if conn.execute("SELECT 1 FROM sqlite_master WHERE name='verified_preview_metadata_repairs'").fetchone():
        row = conn.execute("SELECT receipt_json FROM verified_preview_metadata_repairs WHERE plan_sha256=?", (plan_hash,)).fetchone()
        if row:
            return {**json.loads(row[0]), "replayed": True}
    return None


def apply_plan(root, plan, *, approved_plan_sha256, object_reader=read_object,
               catalog_reader=get_catalog, authority_client=None):
    """Atomic supported Owner writer; require the sealed runtime in production."""
    from legacy_r2_runtime import require_installed_runtime, CANONICAL_ROOT, RUNTIME
    from owner_catalog_projection import store_projection
    require_installed_runtime(root)
    target = root.resolve() / "assets/owner-actions/Owner.sqlite"
    canonical_owner = CANONICAL_ROOT / "assets/owner-actions/Owner.sqlite"
    if (root.resolve() == CANONICAL_ROOT or (target.exists() and canonical_owner.exists() and target.samefile(canonical_owner))) \
            and Path(__file__).resolve().parent != RUNTIME / "scripts":
        raise RecoveryError("installed_backstage_recovery_runtime_required")
    fields = {"schema", "request", "owner", "objects"}
    if (not isinstance(plan, dict) or set(plan) != fields | {"planSha256", "observedAt", "checkedAt", "state"}
            or plan["schema"] != SCHEMA or plan["planSha256"] != approved_plan_sha256
            or digest({k: plan[k] for k in fields}) != approved_plan_sha256):
        raise RecoveryError("reviewed_plan_required")
    with closing(_owner(root)) as conn:
        replay = _replay(conn, approved_plan_sha256)
        if replay:
            return replay  # Historical receipt only; never changes later policy.
    fresh = build_plan(root, plan["request"], object_reader=object_reader, catalog_reader=catalog_reader)
    if fresh["planSha256"] != approved_plan_sha256:
        raise RecoveryError("reviewed_plan_changed")
    measured = {obj["key"]: obj["bytes"] for obj in fresh["objects"]}
    if all(preview["catalog"]["bytes"] == preview["inventory"]["bytes"] == measured[preview["catalog"]["key"]]
           for item in fresh["owner"]["items"] for preview in item["previews"]):
        return {"ok": True, "state": "already_consistent", "planSha256": approved_plan_sha256,
                "uploaded": False, "addedListings": 0, "wholeSubjectReady": False, "checkedAt": stamp()}
    with closing(_owner(root)) as conn:
        _, payload = owner_snapshot(conn, plan["request"])
    if sha256(payload) != plan["owner"]["catalogSha256"]:
        raise RecoveryError("catalog_changed")
    candidate = candidate_catalog(payload, plan)
    with closing(_owner(root, "rw")) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        replay = _replay(conn, approved_plan_sha256)
        if replay:
            return replay
        current, _ = owner_snapshot(conn, plan["request"])
        if current != plan["owner"]:
            raise RecoveryError("owner_changed_before_repair")
        if any(not 0 <= (datetime.now(timezone.utc) - datetime.fromisoformat(at.replace("Z", "+00:00"))).total_seconds() <= 120 for at in fresh["observedAt"]):
            raise RecoveryError("object_evidence_expired")
        now = stamp()
        objects = {row["key"]: row for row in fresh["objects"]}
        for item in plan["owner"]["items"]:
            for preview in item["previews"]:
                key = preview["catalog"]["key"]
                measured = objects[key]
                for old in preview["receipts"]:
                    proof = json.loads(old["verification_json"])
                    proof.update(bytes=measured["bytes"], metadataRepair={"planSha256": approved_plan_sha256,
                        "previousBytes": proof["bytes"], "verifiedAt": now, "method": measured["method"]})
                    conn.execute("""UPDATE fixture_delivery_receipts SET verification_json=?, verified_at=?,updated_at=?
                        WHERE receipt_id=?""", (canonical(proof), now, now, old["receipt_id"]))
                conn.execute("""UPDATE r2_objects SET bytes=?,last_checked_at=?,updated_at=?
                    WHERE bucket='photosbyelie-public' AND object_key=?""", (measured["bytes"], now, now, key))
        projection = store_projection(conn, candidate, source_kind="verified-preview-byte-metadata-repair",
            expected_sha256=plan["owner"]["catalogSha256"], ensure_schema=False, authority_client=authority_client)
        for item in plan["owner"]["items"]:
            conn.execute("""UPDATE public_catalog_publications SET state='local',catalog_sha256=?,updated_at=?
                WHERE asset_id=? AND source_version_hash=? AND media_id=?""",
                (projection["sha256"], now, item["assetId"], item["version"], item["mediaId"]))
        result = {"ok": True, "state": "catalog_projection_prepared_not_deployed", "planSha256": approved_plan_sha256,
            "sha256": projection["sha256"], "revision": projection["revision"], "mediaCount": projection["mediaCount"],
            "previewCount": len(objects), "uploaded": False, "addedListings": 0, "wholeSubjectReady": False, "checkedAt": now}
        conn.execute("""CREATE TABLE IF NOT EXISTS verified_preview_metadata_repairs (
            plan_sha256 TEXT PRIMARY KEY, plan_json TEXT NOT NULL, receipt_json TEXT NOT NULL, applied_at TEXT NOT NULL)""")
        conn.execute("INSERT INTO verified_preview_metadata_repairs VALUES(?,?,?,?)",
            (approved_plan_sha256, canonical(plan), canonical(result), now))
    return result


def main():
    """Explicit read-only prepare or exact-approved-plan apply; JSON stdout only."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--request", type=Path)
    group.add_argument("--apply-plan", type=Path)
    parser.add_argument("--approved-plan-sha256")
    args = parser.parse_args()
    if args.request:
        result = build_plan(args.repo_root, json.loads(args.request.read_text()))
    else:
        result = apply_plan(args.repo_root, json.loads(args.apply_plan.read_text()), approved_plan_sha256=args.approved_plan_sha256)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
