#!/usr/bin/env python3
"""Remove duplicate R2 families created by legacy/cloud Photos identities.

Dry-run is the default.  A commit keeps the established catalog/legacy R2
family, deletes only unreferenced duplicate keys, verifies their absence, and
rebinds the current Photos identity to the retained immutable objects.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import json
from pathlib import Path
import sqlite3
from typing import Any

from fixture_pipeline import editorial_version_hash, record_delivery_receipt
from owner_state_db import upsert_r2_object_state
from retire_ai_expo_assets import delete_r2, verify_r2_absent
from sidecar_state_db import connect
from sync_r2_media import s3_config_complete, s3_config_from_env, s3_signed_request


FIXTURE_ID = "fixture-expo"
PUBLIC_BUCKET = "photosbyelie-public"
PRIVATE_BUCKET = "photosbyelie-private"


def stamp() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def read_json(value: str | None, fallback: Any) -> Any:
    try:
        return json.loads(value or "")
    except (json.JSONDecodeError, TypeError):
        return fallback


def uploaded_results(value: str | None) -> list[dict[str, Any]]:
    rows = read_json(value, [])
    return [dict(row) for row in rows if isinstance(row, dict) and row.get("status") == "uploaded"]


def catalog_ids(repo_root: Path) -> set[str]:
    path = repo_root / "assets/catalog/photosbyelie.sqlite"
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as conn:
        return {str(row[0]) for row in conn.execute("SELECT media_id FROM media_items")}


def manifest_ids(repo_root: Path) -> set[str]:
    payload = read_json((repo_root / "assets/expo-manifest.json").read_text(encoding="utf-8"), {})
    return {
        str(row.get("id") or "")
        for row in payload.get("photos") or []
        if isinstance(row, dict) and str(row.get("id") or "").strip()
    }


def latest_uploaded_rows(repo_root: Path) -> list[dict[str, Any]]:
    with connect(repo_root) as conn:
        rows = conn.execute(
            """
            WITH ranked AS (
              SELECT a.asset_id, a.source_anchor, a.raw_json, a.missing_at,
                     a.indexed_at, a.updated_at AS asset_updated_at,
                     d.title, d.keywords_json,
                     i.run_item_id, i.photo_id, i.upload_keys_json, i.updated_at AS uploaded_at,
                     ROW_NUMBER() OVER (
                       PARTITION BY a.asset_id
                       ORDER BY i.updated_at DESC, i.run_item_id DESC
                     ) AS upload_rank
              FROM sidecar_assets AS a
              JOIN sidecar_decisions AS d ON d.asset_id = a.asset_id
              JOIN sidecar_upload_bridge_run_items AS i ON i.asset_id = a.asset_id
              JOIN sidecar_upload_bridge_runs AS r ON r.run_id = i.run_id
              WHERE d.pick_state = 'picked' AND d.metadata_state = 'approved'
                AND r.execute_upload = 1
                AND i.status = 'uploaded'
                AND i.upload_status IN ('uploaded', 'uploaded_with_skips')
                AND NOT EXISTS (
                  SELECT 1 FROM sidecar_tombstones AS t
                  WHERE t.asset_id = a.asset_id AND t.tombstone_state = 'active'
                )
                AND NOT EXISTS (
                  SELECT 1 FROM json_each(d.keywords_json) AS keyword
                  WHERE lower(trim(keyword.value)) LIKE 'ai generated%'
                     OR lower(trim(keyword.value)) IN ('generative ai', 'ai artwork')
                     OR lower(trim(keyword.value)) LIKE 'stained%'
                )
            )
            SELECT * FROM ranked WHERE upload_rank = 1 ORDER BY asset_id
            """
        ).fetchall()
    output: list[dict[str, Any]] = []
    for row in rows:
        raw = read_json(row["raw_json"], {})
        local_identifier = str(raw.get("localIdentifier") or row["asset_id"]).strip()
        results = uploaded_results(row["upload_keys_json"])
        output.append(
            {
                **dict(row),
                "localIdentifier": local_identifier,
                "results": results,
                "active": not str(row["missing_at"] or "").strip(),
            }
        )
    return output


def safe_result(item: dict[str, Any]) -> bool:
    bucket = str(item.get("bucket") or "")
    key = str(item.get("key") or "")
    if bucket == PUBLIC_BUCKET:
        return key.startswith("expo/") and key.count("/") == 1
    if bucket == PRIVATE_BUCKET:
        return key.startswith("masters/") and key.count("/") == 1
    return False


def choose_keep(rows: list[dict[str, Any]], published_ids: set[str]) -> dict[str, Any]:
    identity = rows[0]["localIdentifier"]
    return max(
        rows,
        key=lambda row: (
            int(row["photo_id"] in published_ids),
            int(row["asset_id"] == identity),
            int(str(row["source_anchor"] or "").startswith("apple-photos://")),
            -len(str(row["photo_id"] or "")),
            str(row["uploaded_at"] or ""),
        ),
    )


def choose_owner(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return max(
        rows,
        key=lambda row: (
            int(bool(row["active"])),
            str(row["indexed_at"] or ""),
            str(row["asset_updated_at"] or ""),
            str(row["asset_id"]),
        ),
    )


def build_plan(repo_root: Path) -> dict[str, Any]:
    catalog = catalog_ids(repo_root)
    manifest = manifest_ids(repo_root)
    published = catalog | manifest
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in latest_uploaded_rows(repo_root):
        grouped.setdefault(row["localIdentifier"], []).append(row)

    groups: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    objects: dict[tuple[str, str], dict[str, Any]] = {}
    for identity, rows in sorted(grouped.items()):
        distinct_families = {str(row["photo_id"] or "") for row in rows if row["results"]}
        if len(rows) < 2 or len(distinct_families) < 2:
            continue
        keep = choose_keep(rows, published)
        owner = choose_owner(rows)
        redundant = [row for row in rows if row is not keep]
        referenced_redundant = [row["photo_id"] for row in redundant if row["photo_id"] in published]
        keep_results = keep["results"]
        unsafe = [item for row in redundant for item in row["results"] if not safe_result(item)]
        if referenced_redundant or len(keep_results) < 3 or unsafe:
            skipped.append(
                {
                    "localIdentifier": identity,
                    "reason": "referenced-redundant" if referenced_redundant else "unsafe-or-incomplete-family",
                    "referencedRedundant": referenced_redundant,
                    "unsafe": unsafe[:5],
                }
            )
            continue
        redundant_keys = {(item["bucket"], item["key"]) for row in redundant for item in row["results"]}
        keep_keys = {(item["bucket"], item["key"]) for item in keep_results}
        if redundant_keys & keep_keys:
            skipped.append({"localIdentifier": identity, "reason": "shared-r2-key"})
            continue
        for row in redundant:
            for item in row["results"]:
                objects[(item["bucket"], item["key"])] = {
                    "bucket": item["bucket"],
                    "key": item["key"],
                    "photoId": row["photo_id"],
                    "kind": item.get("kind") or "",
                    "bytes": item.get("bytes"),
                    "assetId": row["asset_id"],
                }
        groups.append(
            {
                "localIdentifier": identity,
                "ownerCanonicalAssetId": owner["asset_id"],
                "keptAssetId": keep["asset_id"],
                "keptPhotoId": keep["photo_id"],
                "keptResults": keep_results,
                "redundant": [
                    {"assetId": row["asset_id"], "photoId": row["photo_id"], "results": row["results"]}
                    for row in redundant
                ],
            }
        )

    by_bucket: dict[str, int] = {}
    bytes_by_bucket: dict[str, int] = {}
    for item in objects.values():
        by_bucket[item["bucket"]] = by_bucket.get(item["bucket"], 0) + 1
        bytes_by_bucket[item["bucket"]] = bytes_by_bucket.get(item["bucket"], 0) + int(item.get("bytes") or 0)
    return {
        "schema": "photosbyelie.apple-photos-r2-dedupe.v1",
        "createdAt": stamp(),
        "mode": "dry-run",
        "groupCount": len(groups),
        "redundantIdentityCount": sum(len(group["redundant"]) for group in groups),
        "r2ObjectCount": len(objects),
        "r2ByBucket": by_bucket,
        "bytesByBucket": bytes_by_bucket,
        "skippedCount": len(skipped),
        "skipped": skipped,
        "groups": groups,
        "r2Objects": sorted(objects.values(), key=lambda row: (row["bucket"], row["key"])),
    }


def retained_objects(plan: dict[str, Any]) -> list[dict[str, Any]]:
    objects: dict[tuple[str, str], dict[str, Any]] = {}
    for group in plan["groups"]:
        for item in group["keptResults"]:
            objects[(str(item["bucket"]), str(item["key"]))] = {
                "bucket": str(item["bucket"]),
                "key": str(item["key"]),
                "photoId": str(group["keptPhotoId"]),
            }
    return sorted(objects.values(), key=lambda row: (row["bucket"], row["key"]))


def verify_r2_present(objects: list[dict[str, Any]], config: dict[str, str], workers: int) -> None:
    """Refuse deletion unless every retained canonical object exists live."""

    def check(item: dict[str, Any]) -> dict[str, Any] | None:
        ok, status, output = s3_signed_request(
            "HEAD",
            f"{item['bucket']}/{item['key']}",
            [],
            b"",
            config["account_id"],
            config["access_key_id"],
            config["secret_access_key"],
            config.get("endpoint") or "",
            timeout=30,
        )
        if ok and status == 200:
            return None
        return {"bucket": item["bucket"], "key": item["key"], "status": status, "output": output}

    failures: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        for index, result in enumerate(executor.map(check, objects), 1):
            if result:
                failures.append(result)
            if index % 500 == 0 or index == len(objects):
                print(
                    f"{stamp()} R2 retained-object presence verified "
                    f"{index}/{len(objects)} failures={len(failures)}",
                    flush=True,
                )
    if failures:
        raise RuntimeError(f"R2 pre-delete presence check failed for {len(failures)} objects: {failures[:5]}")


def _copy_kept_receipts(conn: sqlite3.Connection, repo_root: Path, group: dict[str, Any]) -> None:
    asset_id = group["ownerCanonicalAssetId"]
    version_hash = editorial_version_hash(conn, asset_id)
    now = stamp()
    destination = conn.execute(
        "SELECT destinations_json FROM fixture_asset_destinations WHERE fixture_id = ? AND asset_id = ?",
        (FIXTURE_ID, asset_id),
    ).fetchone()
    destinations = set(read_json(destination["destinations_json"], []) if destination else [])
    destinations.update({"r2", "apple_photos"})
    conn.execute(
        """INSERT INTO fixture_asset_destinations
             (fixture_id, asset_id, destinations_json, version_hash, configured_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(fixture_id, asset_id) DO UPDATE SET
             destinations_json=excluded.destinations_json,
             version_hash=excluded.version_hash,
             updated_at=excluded.updated_at""",
        (FIXTURE_ID, asset_id, json.dumps(sorted(destinations)), version_hash, now, now),
    )
    for item in group["keptResults"]:
        record_delivery_receipt(
            repo_root,
            fixture_id=FIXTURE_ID,
            asset_id=asset_id,
            destination="r2",
            version_hash=version_hash,
            status="verified",
            object_key=str(item["key"]),
            checksum_sha256=str(item.get("checksumSha256") or item.get("remoteChecksumSha256") or "verified-r2-object"),
            visibility_policy="public" if item["bucket"] == PUBLIC_BUCKET else "private",
            verification={**item, "deduplicatedFromAssetId": group["keptAssetId"]},
            conn=conn,
        )


def finalize_local(repo_root: Path, plan: dict[str, Any]) -> None:
    now = stamp()
    deleted_pairs = {(row["bucket"], row["key"]): row for row in plan["r2Objects"]}
    with connect(repo_root) as conn:
        for row in plan["r2Objects"]:
            upsert_r2_object_state(
                conn,
                bucket=row["bucket"],
                object_key=row["key"],
                lifecycle_state="deleted_confirmed",
                photo_id=row["photoId"],
                object_kind=row["kind"],
                source="apple-photos-identity-dedupe",
                bytes_value=row.get("bytes"),
                timestamp=now,
            )
        for group in plan["groups"]:
            _copy_kept_receipts(conn, repo_root, group)
            owner_id = group["ownerCanonicalAssetId"]
            aliases = [row["assetId"] for row in group["redundant"] if row["assetId"] != owner_id]
            if group["keptAssetId"] != owner_id:
                aliases.append(group["keptAssetId"])
            aliases = sorted(set(aliases))
            if aliases:
                placeholders = ",".join("?" for _ in aliases)
                conn.execute(
                    f"UPDATE sidecar_mock_uploads SET mock_state='cleared', updated_at=? WHERE asset_id IN ({placeholders})",
                    [now, *aliases],
                )
                conn.execute(
                    f"""UPDATE fixture_asset_placements
                        SET state='removed', removed_at=?, updated_at=?
                        WHERE fixture_id=? AND state='active' AND asset_id IN ({placeholders})""",
                    [now, now, FIXTURE_ID, *aliases],
                )
        rows = conn.execute(
            "SELECT run_item_id, upload_keys_json FROM sidecar_upload_bridge_run_items WHERE upload_keys_json <> '[]'"
        ).fetchall()
        for row in rows:
            values = read_json(row["upload_keys_json"], [])
            changed = False
            for item in values if isinstance(values, list) else []:
                pair = (str(item.get("bucket") or ""), str(item.get("key") or ""))
                if pair not in deleted_pairs:
                    continue
                item["status"] = "deleted_deduplicated"
                item["remoteVerified"] = False
                item["deletedAt"] = now
                item["dedupeReason"] = "duplicate Apple Photos identity"
                changed = True
            if changed:
                conn.execute(
                    "UPDATE sidecar_upload_bridge_run_items SET upload_keys_json=?, updated_at=? WHERE run_item_id=?",
                    (json.dumps(values, ensure_ascii=False, sort_keys=True), now, row["run_item_id"]),
                )
        conn.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path)
    parser.add_argument("--commit", action="store_true")
    parser.add_argument("--verify-workers", type=int, default=32)
    args = parser.parse_args()
    repo_root = args.repo_root.resolve()
    output = args.output or repo_root / ".review-logs" / f"apple-photos-r2-dedupe-{datetime.now().strftime('%Y%m%dT%H%M%S')}.json"
    plan = build_plan(repo_root)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"Apple Photos/R2 dedupe {'commit' if args.commit else 'dry-run'}: "
        f"groups={plan['groupCount']} redundant={plan['redundantIdentityCount']} "
        f"objects={plan['r2ObjectCount']} skipped={plan['skippedCount']} plan={output}",
        flush=True,
    )
    if not args.commit:
        return 0
    if plan["skippedCount"]:
        raise RuntimeError(f"refusing commit with {plan['skippedCount']} unsafe groups")
    config = s3_config_from_env()
    if not s3_config_complete(config):
        raise RuntimeError("complete R2 S3 credentials are required")
    kept_objects = retained_objects(plan)
    print(f"{stamp()} Verifying {len(kept_objects)} retained R2 objects before deletion", flush=True)
    verify_r2_present(kept_objects, config, max(1, args.verify_workers))
    delete_r2(plan["r2Objects"], config)
    verify_r2_absent(plan["r2Objects"], config, max(1, args.verify_workers))
    finalize_local(repo_root, plan)
    result = {
        "schema": "photosbyelie.apple-photos-r2-dedupe-result.v1",
        "completedAt": stamp(),
        "groupCount": plan["groupCount"],
        "redundantIdentityCount": plan["redundantIdentityCount"],
        "r2DeletedAndAbsent": plan["r2ObjectCount"],
        "bytesDeleted": sum(plan["bytesByBucket"].values()),
    }
    result_path = output.with_name(output.stem + "-result.json")
    result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False), flush=True)
    print(f"Result: {result_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
