#!/usr/bin/env python3
"""Retire an explicit metadata-defined asset family from Expo, R2, and Photos approval.

Dry-run is the default. Commit uses R2 DeleteObjects batches, verifies every
recorded key is absent, removes managed Expo approval keywords from Apple
Photos in direct-ID batches, and only then retires the local fixture state.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import json
from pathlib import Path
from typing import Any

from apple_photos_metadata_writer import _run_jxa
from owner_state_db import upsert_r2_object_state
from sidecar_state_db import connect
from sync_r2_media import (
    DEFAULT_THROTTLE_FILE,
    UploadItem,
    item_batches_by_bucket,
    s3_config_complete,
    s3_config_from_env,
    s3_delete_objects,
    s3_signed_request,
)


FIXTURE_ID = "fixture-expo"
PUBLIC_BUCKET = "photosbyelie-public"
PRIVATE_BUCKET = "photosbyelie-private"
ALLOWED_PREFIXES = {
    PUBLIC_BUCKET: ("expo/",),
    PRIVATE_BUCKET: ("masters/", "renders/"),
}
AI_SQL = """
EXISTS (
  SELECT 1 FROM json_each(d.keywords_json) AS keyword
  WHERE lower(trim(keyword.value)) LIKE 'ai generated%'
     OR lower(trim(keyword.value)) IN ('generative ai', 'ai artwork')
)
"""
STAINED_GLASS_DELTA_SQL = f"""
EXISTS (
  SELECT 1 FROM json_each(d.keywords_json) AS keyword
  WHERE lower(trim(keyword.value)) LIKE 'stained glass%'
)
AND NOT ({AI_SQL})
"""
STAINED_DELTA_SQL = f"""
EXISTS (
  SELECT 1 FROM json_each(d.keywords_json) AS keyword
  WHERE lower(trim(keyword.value)) LIKE 'stained%'
)
AND NOT (({AI_SQL}) OR ({STAINED_GLASS_DELTA_SQL}))
"""
SELECTIONS = {
    "ai": {
        "sql": AI_SQL,
        "policy": "Explicit AI metadata: keyword starts with 'AI generated' or equals 'Generative AI'/'AI artwork'.",
        "source": "ai-expo-retirement",
    },
    "stained-glass": {
        "sql": STAINED_GLASS_DELTA_SQL,
        "policy": "Stained-glass keyword family (prefix 'Stained glass'), excluding the explicit AI set already retired.",
        "source": "stained-glass-expo-retirement",
    },
    "stained": {
        "sql": STAINED_DELTA_SQL,
        "policy": "Stained keyword family (prefix 'Stained'), excluding AI and stained-glass sets already retired.",
        "source": "stained-expo-retirement",
    },
}


def stamp() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def selected_assets(repo_root: Path, selection: str) -> list[dict[str, Any]]:
    policy = SELECTIONS[selection]
    with connect(repo_root) as conn:
        rows = conn.execute(
            f"""
            SELECT a.asset_id, a.filename, a.raw_json, d.keywords_json
            FROM sidecar_assets AS a
            JOIN sidecar_decisions AS d ON d.asset_id = a.asset_id
            WHERE {policy['sql']}
            ORDER BY a.asset_id
            """
        ).fetchall()
    output = []
    for row in rows:
        raw = json.loads(row["raw_json"] or "{}")
        output.append(
            {
                "assetId": row["asset_id"],
                "photosAssetId": str(raw.get("localIdentifier") or row["asset_id"]),
                "filename": row["filename"] or "",
                "matchedKeywords": [
                    str(value)
                    for value in json.loads(row["keywords_json"] or "[]")
                    if (
                        selection == "ai"
                        and (
                            str(value).strip().casefold().startswith("ai generated")
                            or str(value).strip().casefold() in {"generative ai", "ai artwork"}
                        )
                    )
                    or (
                        selection in {"stained-glass", "stained"}
                        and str(value).strip().casefold().startswith(
                            "stained glass" if selection == "stained-glass" else "stained"
                        )
                    )
                ],
            }
        )
    return output


def _safe_r2_key(bucket: str, key: str) -> bool:
    return bucket in ALLOWED_PREFIXES and any(key.startswith(prefix) for prefix in ALLOWED_PREFIXES[bucket])


def r2_objects(repo_root: Path, asset_ids: set[str]) -> list[dict[str, Any]]:
    if not asset_ids:
        return []
    keys: dict[tuple[str, str], dict[str, Any]] = {}
    with connect(repo_root) as conn:
        placeholders = ",".join("?" for _ in asset_ids)
        rows = conn.execute(
            f"""
            SELECT i.asset_id, i.photo_id, i.upload_keys_json
            FROM sidecar_upload_bridge_run_items AS i
            WHERE i.asset_id IN ({placeholders})
              AND i.status = 'uploaded'
            """,
            sorted(asset_ids),
        ).fetchall()
        photo_ids: set[str] = set()
        for row in rows:
            photo_ids.add(str(row["photo_id"] or ""))
            for item in json.loads(row["upload_keys_json"] or "[]"):
                bucket = str(item.get("bucket") or "")
                key = str(item.get("key") or "")
                if bucket and key:
                    keys[(bucket, key)] = {
                        "bucket": bucket,
                        "key": key,
                        "assetId": row["asset_id"],
                        "photoId": row["photo_id"] or "",
                        "kind": item.get("kind") or "",
                        "bytes": int(item.get("bytes") or 0),
                        "sources": ["upload-bridge"],
                    }
        receipt_rows = conn.execute(
            f"""
            SELECT asset_id, object_key, verification_json
            FROM fixture_delivery_receipts
            WHERE asset_id IN ({placeholders}) AND destination = 'r2'
            """,
            sorted(asset_ids),
        ).fetchall()
        for row in receipt_rows:
            verification = json.loads(row["verification_json"] or "{}")
            bucket = str(verification.get("bucket") or "")
            key = str(row["object_key"] or "")
            if bucket and key:
                entry = keys.setdefault(
                    (bucket, key),
                    {"bucket": bucket, "key": key, "assetId": row["asset_id"], "photoId": "", "kind": "", "bytes": int(verification.get("bytes") or 0), "sources": []},
                )
                if "delivery-receipt" not in entry["sources"]:
                    entry["sources"].append("delivery-receipt")
        clean_photo_ids = sorted(value for value in photo_ids if value)
        if clean_photo_ids:
            photo_placeholders = ",".join("?" for _ in clean_photo_ids)
            ledger_rows = conn.execute(
                f"""
                SELECT bucket, object_key, photo_id, object_kind, bytes
                FROM r2_objects
                WHERE photo_id IN ({photo_placeholders})
                  AND lifecycle_state IN ('current', 'marked_for_delete')
                """,
                clean_photo_ids,
            ).fetchall()
            for row in ledger_rows:
                bucket = str(row["bucket"] or "")
                key = str(row["object_key"] or "")
                entry = keys.setdefault(
                    (bucket, key),
                    {"bucket": bucket, "key": key, "assetId": "", "photoId": row["photo_id"] or "", "kind": row["object_kind"] or "", "bytes": int(row["bytes"] or 0), "sources": []},
                )
                if "r2-ledger" not in entry["sources"]:
                    entry["sources"].append("r2-ledger")
    unsafe = [item for item in keys.values() if not _safe_r2_key(item["bucket"], item["key"])]
    if unsafe:
        raise RuntimeError(f"refusing unexpected R2 key families: {unsafe[:5]}")
    return sorted(keys.values(), key=lambda item: (item["bucket"], item["key"]))


def write_plan(
    path: Path,
    assets: list[dict[str, Any]],
    objects: list[dict[str, Any]],
    *,
    selection: str,
) -> dict[str, Any]:
    by_bucket: dict[str, int] = {}
    for item in objects:
        by_bucket[item["bucket"]] = by_bucket.get(item["bucket"], 0) + 1
    payload = {
        "schema": "photosbyelie.expo-asset-retirement.v2",
        "createdAt": stamp(),
        "selection": selection,
        "policy": SELECTIONS[selection]["policy"],
        "fixtureId": FIXTURE_ID,
        "assetCount": len(assets),
        "r2ObjectCount": len(objects),
        "r2ByBucket": by_bucket,
        "assets": assets,
        "r2Objects": objects,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return payload


def delete_r2(objects: list[dict[str, Any]], config: dict[str, str]) -> list[dict[str, Any]]:
    items = [
        UploadItem(
            bucket=item["bucket"],
            key=item["key"],
            path=Path("/dev/null"),
            content_type="application/octet-stream",
        )
        for item in objects
    ]
    results: list[tuple[UploadItem, bool, str]] = []
    batches = item_batches_by_bucket(items, batch_size=1000)
    for index, batch in enumerate(batches, 1):
        results.extend(
            s3_delete_objects(
                batch,
                retries=3,
                throttle_file=DEFAULT_THROTTLE_FILE,
                request_min_interval=0.25,
                retry_max_delay=30,
                account_id=config["account_id"],
                access_key_id=config["access_key_id"],
                secret_access_key=config["secret_access_key"],
                endpoint=config.get("endpoint") or "",
            )
        )
        print(f"{stamp()} R2 delete batch {index}/{len(batches)} ({len(batch)} objects)", flush=True)
    failed = [{"bucket": item.bucket, "key": item.key, "error": output} for item, ok, output in results if not ok]
    if failed:
        raise RuntimeError(f"R2 batch deletion failed for {len(failed)} objects: {failed[:5]}")
    return [{"bucket": item.bucket, "key": item.key} for item, ok, _ in results if ok]


def verify_r2_absent(objects: list[dict[str, Any]], config: dict[str, str], workers: int) -> None:
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
        if not ok and status == 404:
            return None
        return {"bucket": item["bucket"], "key": item["key"], "status": status, "output": output}

    failures: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        for index, result in enumerate(executor.map(check, objects), 1):
            if result:
                failures.append(result)
            if index % 500 == 0 or index == len(objects):
                print(f"{stamp()} R2 absence verified {index}/{len(objects)} failures={len(failures)}", flush=True)
    if failures:
        raise RuntimeError(f"R2 post-delete verification failed for {len(failures)} objects: {failures[:5]}")


REVOKE_JXA = r"""
function run(argv) {
  const photos = Application('Photos');
  const requests = JSON.parse(String(argv[0] || '[]'));
  return JSON.stringify(requests.map(payload => {
    const id = String(payload.photosAssetId || '');
    try {
      const item = photos.mediaItems.byId(id);
      if (item.id() !== id) throw new Error(`Apple Photos asset not found: ${id}`);
      const before = (item.keywords() || []).map(String);
      const after = before.filter(value => {
        const folded = String(value).trim().toLocaleLowerCase();
        return folded !== 'pbe-approved' && folded !== 'pbe-fixture-id:fixture-expo';
      });
      if (after.length !== before.length) item.keywords = after;
      const verified = (item.keywords() || []).map(value => String(value).trim().toLocaleLowerCase());
      return {
        assetId: String(payload.assetId || ''),
        photosAssetId: id,
        changed: after.length !== before.length,
        verified: verified.indexOf('pbe-approved') < 0 && verified.indexOf('pbe-fixture-id:fixture-expo') < 0,
      };
    } catch (error) {
      return {assetId: String(payload.assetId || ''), photosAssetId: id, error: String(error)};
    }
  }));
}
"""


def revoke_photos(assets: list[dict[str, Any]], batch_size: int) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for start in range(0, len(assets), batch_size):
        batch = assets[start:start + batch_size]
        rows = json.loads(
            _run_jxa(REVOKE_JXA, json.dumps(batch, ensure_ascii=False), timeout=max(60, len(batch) * 3)) or "[]"
        )
        results.extend(rows)
        failures = [row for row in results if row.get("error") or not row.get("verified")]
        print(
            f"{stamp()} Apple approval revoked {len(results)}/{len(assets)} "
            f"failures={len(failures)}",
            flush=True,
        )
    failures = [row for row in results if row.get("error") or not row.get("verified")]
    if failures:
        raise RuntimeError(f"Apple Photos revocation failed for {len(failures)} assets: {failures[:5]}")
    return results


def finalize_local_state(
    repo_root: Path,
    assets: list[dict[str, Any]],
    objects: list[dict[str, Any]],
    *,
    source: str,
) -> None:
    asset_ids = [item["assetId"] for item in assets]
    timestamp = stamp()
    with connect(repo_root) as conn:
        for item in objects:
            upsert_r2_object_state(
                conn,
                bucket=item["bucket"],
                object_key=item["key"],
                lifecycle_state="deleted_confirmed",
                photo_id=item.get("photoId") or "",
                object_kind=item.get("kind") or "",
                source=source,
                bytes_value=item.get("bytes") or None,
                timestamp=timestamp,
            )
        for start in range(0, len(asset_ids), 500):
            chunk = asset_ids[start:start + 500]
            placeholders = ",".join("?" for _ in chunk)
            conn.execute(
                f"""UPDATE fixture_asset_placements
                    SET state = 'removed', removed_at = ?, updated_at = ?
                    WHERE fixture_id = ? AND state = 'active' AND asset_id IN ({placeholders})""",
                [timestamp, timestamp, FIXTURE_ID, *chunk],
            )
            conn.execute(
                f"DELETE FROM fixture_asset_destinations WHERE fixture_id = ? AND asset_id IN ({placeholders})",
                [FIXTURE_ID, *chunk],
            )
            conn.execute(
                f"DELETE FROM fixture_delivery_receipts WHERE fixture_id = ? AND asset_id IN ({placeholders})",
                [FIXTURE_ID, *chunk],
            )
            conn.execute(
                f"UPDATE sidecar_mock_uploads SET mock_state = 'cleared', updated_at = ? WHERE asset_id IN ({placeholders})",
                [timestamp, *chunk],
            )
        conn.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path)
    parser.add_argument("--commit", action="store_true")
    parser.add_argument("--selection", choices=sorted(SELECTIONS), default="ai")
    parser.add_argument("--photos-batch-size", type=int, default=100)
    parser.add_argument("--verify-workers", type=int, default=32)
    args = parser.parse_args()
    repo_root = args.repo_root.resolve()
    output = args.output or repo_root / ".review-logs" / f"{args.selection}-expo-retirement-{datetime.now().strftime('%Y%m%dT%H%M%S')}.json"
    assets = selected_assets(repo_root, args.selection)
    objects = r2_objects(repo_root, {item["assetId"] for item in assets})
    payload = write_plan(output, assets, objects, selection=args.selection)
    print(
        f"{args.selection} Expo retirement {'commit' if args.commit else 'dry-run'}: "
        f"assets={payload['assetCount']} R2={payload['r2ObjectCount']} "
        f"buckets={payload['r2ByBucket']} plan={output}",
        flush=True,
    )
    if not args.commit:
        return 0
    config = s3_config_from_env()
    if not s3_config_complete(config):
        raise RuntimeError("complete R2 S3 credentials are required")
    delete_r2(objects, config)
    verify_r2_absent(objects, config, args.verify_workers)
    photos_results = revoke_photos(assets, max(1, args.photos_batch_size))
    finalize_local_state(
        repo_root,
        assets,
        objects,
        source=SELECTIONS[args.selection]["source"],
    )
    result = {
        "schema": "photosbyelie.expo-asset-retirement-result.v2",
        "completedAt": stamp(),
        "selection": args.selection,
        "assetCount": len(assets),
        "r2DeletedAndAbsent": len(objects),
        "appleApprovalRevoked": len(photos_results),
        "appleChanged": sum(bool(item.get("changed")) for item in photos_results),
        "fixtureId": FIXTURE_ID,
    }
    result_path = output.with_name(output.stem + "-result.json")
    result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False), flush=True)
    print(f"Result: {result_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
