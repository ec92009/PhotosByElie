#!/usr/bin/env python3
"""Audit and delete R2 catalog-prefix objects that no active source references.

The public catalog and active Owner/Sidecar state are the keep set. Dry-run is
the default. Commit mode records candidates in Owner.sqlite, uses R2 batch
delete, verifies absence, and records confirmed deletions.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import gzip
import json
from pathlib import Path
import sqlite3
import tempfile
from typing import Any, Iterable
import xml.etree.ElementTree as ET

from owner_state_db import connect, upsert_r2_object_state
from sync_r2_media import (
    DEFAULT_THROTTLE_FILE,
    UploadItem,
    item_batches_by_bucket,
    s3_config_complete,
    s3_config_from_env,
    s3_delete_objects,
    s3_signed_request,
)


PUBLIC_BUCKET = "photosbyelie-public"
PRIVATE_BUCKET = "photosbyelie-private"
SCOPES = ((PUBLIC_BUCKET, "expo/"), (PRIVATE_BUCKET, "masters/"), (PRIVATE_BUCKET, "renders/"))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--commit", action="store_true", help="Delete verified candidates. Dry-run is the default.")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--limit", type=int, default=0, help="Limit commit candidates for a bounded canary run.")
    parser.add_argument("--retries", type=int, default=5)
    parser.add_argument("--request-min-interval", type=float, default=0.15)
    parser.add_argument("--retry-max-delay", type=float, default=30.0)
    parser.add_argument("--report", type=Path, default=Path(".review-logs/r2-unreferenced-cleanup-report.json"))
    parser.add_argument("--manifest", type=Path, default=Path(".review-logs/r2-unreferenced-cleanup-manifest.json.gz"))
    return parser.parse_args()


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def child_text(node: ET.Element, name: str) -> str:
    for child in node:
        if local_name(child.tag) == name:
            return child.text or ""
    return ""


def list_r2_prefix(bucket: str, prefix: str, config: dict[str, str]) -> list[dict[str, Any]]:
    """List one complete R2 prefix through signed, paginated S3 requests."""
    objects: list[dict[str, Any]] = []
    token = ""
    with tempfile.TemporaryDirectory(prefix="pbe-r2-list-") as temp_dir:
        page = 0
        while True:
            page += 1
            target = Path(temp_dir) / f"page-{page}.xml"
            params = [("list-type", "2"), ("max-keys", "1000"), ("prefix", prefix)]
            if token:
                params.append(("continuation-token", token))
            ok, status, detail = s3_signed_request(
                "GET",
                bucket,
                params,
                b"",
                config["account_id"],
                config["access_key_id"],
                config["secret_access_key"],
                config.get("endpoint") or "",
                timeout=120,
                download_path=target,
            )
            if not ok:
                raise RuntimeError(f"R2 listing failed for {bucket}/{prefix}: HTTP {status} {detail}")
            root = ET.parse(target).getroot()
            for node in root.iter():
                if local_name(node.tag) != "Contents":
                    continue
                key = child_text(node, "Key")
                if key:
                    objects.append({"bucket": bucket, "key": key, "bytes": int(child_text(node, "Size") or 0)})
            token = next((node.text or "" for node in root.iter() if local_name(node.tag) == "NextContinuationToken"), "")
            if not token:
                break
    return objects


def media_id_from_key(key: str) -> str:
    """Return the stable media id from current flat or retired nested key shapes."""
    if key.startswith("expo/"):
        rest = key.removeprefix("expo/")
        if "/" in rest:
            return rest.split("/", 1)[0]
        for suffix in ("_short_5s_720p.mp4", "_1800.jpg", "_900.jpg"):
            if rest.lower().endswith(suffix):
                return rest[: -len(suffix)]
        return ""
    if key.startswith("masters/"):
        rest = key.removeprefix("masters/")
        if "/" in rest:
            return rest.split("/", 1)[0]
        return rest.rsplit(".", 1)[0] if "." in rest else ""
    if key.startswith("renders/"):
        rest = key.removeprefix("renders/")
        if "/" in rest:
            return rest.split("/", 1)[0]
        lower = rest.lower()
        for suffix in ("_1mp.jpg", "_3mp.jpg", "_6mp.jpg"):
            if lower.endswith(suffix):
                return rest[: -len(suffix)]
    return ""


def read_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def catalog_keep_state(repo_root: Path) -> dict[str, Any]:
    sidecar = read_json(repo_root / "assets/media-sidecar.json", {})
    photos = sidecar.get("photos") if isinstance(sidecar, dict) else {}
    photos = photos if isinstance(photos, dict) else {}
    expected: dict[str, set[str]] = {PUBLIC_BUCKET: set(), PRIVATE_BUCKET: set()}
    master_by_id: dict[str, str] = {}
    for media_id, photo in photos.items():
        if not isinstance(photo, dict):
            continue
        previews = photo.get("publicPreview") if isinstance(photo.get("publicPreview"), dict) else {}
        delivery = photo.get("privateDelivery") if isinstance(photo.get("privateDelivery"), dict) else {}
        for key in (previews.get("galleryKey"), previews.get("detailKey")):
            if isinstance(key, str) and key:
                expected[PUBLIC_BUCKET].add(key)
        master = delivery.get("masterKey")
        if isinstance(master, str) and master:
            expected[PRIVATE_BUCKET].add(master)
            master_by_id[str(media_id)] = master
        render_keys = delivery.get("renderKeys") if isinstance(delivery.get("renderKeys"), dict) else {}
        for key in render_keys.values():
            if isinstance(key, str) and key:
                expected[PRIVATE_BUCKET].add(key)
    return {"catalog_ids": set(map(str, photos)), "expected": expected, "master_by_id": master_by_id}


def protected_non_catalog_ids(repo_root: Path) -> dict[str, set[str]]:
    """Protect active uploads and reversible hidden/active lifecycle rows."""
    protected: dict[str, set[str]] = {"sidecar": set(), "lifecycle": set(), "hidden_data": set()}
    hidden = read_json(repo_root / "assets/hidden/hidden-data.json", {})
    if isinstance(hidden, dict):
        for collection in hidden.values():
            if not isinstance(collection, dict):
                continue
            for photo in collection.get("photos") or []:
                if isinstance(photo, dict) and str(photo.get("id") or "").strip():
                    protected["hidden_data"].add(str(photo["id"]))
    with connect(repo_root) as conn:
        protected["lifecycle"].update(
            str(row[0])
            for row in conn.execute("SELECT media_id FROM media_lifecycle WHERE lifecycle_state IN ('active', 'hidden')")
            if str(row[0] or "").strip()
        )
        protected["sidecar"].update(
            str(row[0])
            for row in conn.execute(
                """
                SELECT DISTINCT i.photo_id
                FROM sidecar_upload_bridge_run_items AS i
                JOIN sidecar_upload_bridge_runs AS r ON r.run_id = i.run_id
                JOIN sidecar_decisions AS d ON d.asset_id = i.asset_id
                WHERE r.execute_upload = 1
                  AND i.status = 'uploaded'
                  AND i.upload_status IN ('uploaded', 'uploaded_with_skips')
                  AND d.pick_state = 'picked'
                  AND d.metadata_state = 'approved'
                  AND NOT EXISTS (
                    SELECT 1 FROM sidecar_tombstones AS t
                    WHERE t.asset_id = i.asset_id AND t.tombstone_state = 'active'
                  )
                """
            )
            if str(row[0] or "").strip()
        )
    return protected


def classify_object(
    item: dict[str, Any],
    *,
    catalog_ids: set[str],
    expected_keys: set[str],
    protected_ids: set[str],
    available_keys: set[str],
    master_by_id: dict[str, str],
) -> tuple[str, str]:
    key = str(item.get("key") or "")
    if key in expected_keys:
        return "keep", "current-catalog-key"
    media_id = media_id_from_key(key)
    if not media_id:
        return "keep", "unclassified-fail-closed"
    if media_id in catalog_ids:
        if key.startswith("masters/") and master_by_id.get(media_id) not in available_keys:
            return "keep", "fallback-master-for-current-catalog"
        return "delete", "redundant-key-for-current-catalog"
    if media_id in protected_ids:
        return "keep", "protected-active-or-hidden-id"
    return "delete", "unreferenced-non-catalog-id"


def write_outputs(report_path: Path, manifest_path: Path, report: dict[str, Any], candidates: list[dict[str, Any]]) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    with gzip.open(manifest_path, "wt", encoding="utf-8") as output:
        json.dump({"schema": "photosbyelie.r2-unreferenced-cleanup.v1", "objects": candidates}, output, separators=(",", ":"))
        output.write("\n")


def summarize(objects: Iterable[dict[str, Any]]) -> dict[str, Any]:
    rows = list(objects)
    by_bucket: dict[str, dict[str, int]] = {}
    by_reason: dict[str, dict[str, int]] = {}
    for row in rows:
        bucket = str(row["bucket"])
        reason = str(row.get("reason") or "")
        bucket_stats = by_bucket.setdefault(bucket, {"objects": 0, "bytes": 0})
        reason_stats = by_reason.setdefault(reason, {"objects": 0, "bytes": 0})
        for stats in (bucket_stats, reason_stats):
            stats["objects"] += 1
            stats["bytes"] += int(row.get("bytes") or 0)
    return {"objects": len(rows), "bytes": sum(int(row.get("bytes") or 0) for row in rows), "byBucket": by_bucket, "byReason": by_reason}


def record_states(repo_root: Path, objects: list[dict[str, Any]], state: str, source: str) -> None:
    with connect(repo_root) as conn:
        stamp = now_iso()
        for item in objects:
            upsert_r2_object_state(
                conn,
                bucket=str(item["bucket"]),
                object_key=str(item["key"]),
                lifecycle_state=state,
                photo_id=str(item.get("mediaId") or ""),
                source=source,
                bytes_value=int(item.get("bytes") or 0),
                timestamp=stamp,
            )
        conn.commit()


def delete_candidates(args: argparse.Namespace, candidates: list[dict[str, Any]], config: dict[str, str]) -> list[dict[str, Any]]:
    upload_items = [
        UploadItem(str(row["bucket"]), str(row["key"]), Path(), "application/octet-stream")
        for row in candidates
    ]
    batches = item_batches_by_bucket(upload_items, batch_size=1000)
    results: list[tuple[UploadItem, bool, str]] = []
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, len(batches)))) as executor:
        futures = [
            executor.submit(
                s3_delete_objects,
                batch,
                args.retries,
                args.repo_root / DEFAULT_THROTTLE_FILE,
                args.request_min_interval,
                args.retry_max_delay,
                config["account_id"],
                config["access_key_id"],
                config["secret_access_key"],
                config.get("endpoint") or "",
            )
            for batch in batches
        ]
        completed = 0
        for future in as_completed(futures):
            batch_results = future.result()
            results.extend(batch_results)
            completed += len(batch_results)
            if completed == len(candidates) or completed % 10_000 < len(batch_results):
                print(f"R2 cleanup progress: {completed}/{len(candidates)} delete results")
    candidate_by_key = {(str(row["bucket"]), str(row["key"])): row for row in candidates}
    failed: list[dict[str, Any]] = []
    succeeded: list[dict[str, Any]] = []
    for item, ok, detail in results:
        row = candidate_by_key[(item.bucket, item.key)]
        if ok:
            succeeded.append(row)
        else:
            failed.append({**row, "error": detail[-1000:]})
    record_states(args.repo_root, succeeded, "deleted_confirmed", "cleanup-unreferenced-catalog-r2")
    return failed


def main() -> int:
    args = parse_args()
    args.repo_root = args.repo_root.resolve()
    report_path = args.report if args.report.is_absolute() else args.repo_root / args.report
    manifest_path = args.manifest if args.manifest.is_absolute() else args.repo_root / args.manifest
    config = s3_config_from_env()
    if not s3_config_complete(config):
        raise SystemExit("R2 S3 credentials are required for live inventory and cleanup.")

    keep_state = catalog_keep_state(args.repo_root)
    protected_sources = protected_non_catalog_ids(args.repo_root)
    protected_ids = set().union(*protected_sources.values()) - keep_state["catalog_ids"]
    listings: list[dict[str, Any]] = []
    for bucket, prefix in SCOPES:
        rows = list_r2_prefix(bucket, prefix, config)
        listings.extend(rows)
        print(f"Listed {len(rows)} objects from {bucket}/{prefix}")
    available_by_bucket = {
        bucket: {str(row["key"]) for row in listings if row["bucket"] == bucket}
        for bucket in (PUBLIC_BUCKET, PRIVATE_BUCKET)
    }

    candidates: list[dict[str, Any]] = []
    preserved: list[dict[str, Any]] = []
    for row in listings:
        action, reason = classify_object(
            row,
            catalog_ids=keep_state["catalog_ids"],
            expected_keys=keep_state["expected"][str(row["bucket"])],
            protected_ids=protected_ids,
            available_keys=available_by_bucket[str(row["bucket"])],
            master_by_id=keep_state["master_by_id"],
        )
        enriched = {**row, "mediaId": media_id_from_key(str(row["key"])), "reason": reason}
        (candidates if action == "delete" else preserved).append(enriched)

    missing_before = {
        bucket: sorted(keep_state["expected"][bucket] - available_by_bucket[bucket])
        for bucket in (PUBLIC_BUCKET, PRIVATE_BUCKET)
    }
    report: dict[str, Any] = {
        "schema": "photosbyelie.r2-unreferenced-cleanup-report.v1",
        "generatedAt": now_iso(),
        "mode": "commit" if args.commit else "dry-run",
        "catalogItems": len(keep_state["catalog_ids"]),
        "protectedNonCatalogIds": {name: len(ids - keep_state["catalog_ids"]) for name, ids in protected_sources.items()},
        "inventory": summarize(listings),
        "candidates": summarize(candidates),
        "preserved": summarize(preserved),
        "missingExpectedBefore": {bucket: len(keys) for bucket, keys in missing_before.items()},
        "missingExpectedBeforeSample": {bucket: keys[:20] for bucket, keys in missing_before.items()},
        "failed": [],
    }
    selected = candidates[: args.limit] if args.limit > 0 else candidates
    report["selected"] = summarize(selected)
    write_outputs(report_path, manifest_path, report, selected)
    print(f"Cleanup {'commit' if args.commit else 'dry-run'}: {len(candidates)} candidates, {report['candidates']['bytes']} bytes")
    if len(selected) != len(candidates):
        print(f"Bounded selection: {len(selected)}/{len(candidates)} candidates")
    print(f"Report: {report_path}")
    print(f"Manifest: {manifest_path}")
    if not args.commit:
        return 0

    record_states(args.repo_root, selected, "marked_for_delete", "cleanup-unreferenced-catalog-r2")
    failed = delete_candidates(args, selected, config)
    after_rows: list[dict[str, Any]] = []
    for bucket, prefix in SCOPES:
        after_rows.extend(list_r2_prefix(bucket, prefix, config))
    after_keys = {(str(row["bucket"]), str(row["key"])) for row in after_rows}
    remaining = [row for row in selected if (str(row["bucket"]), str(row["key"])) in after_keys]
    after_by_bucket = {
        bucket: {str(row["key"]) for row in after_rows if row["bucket"] == bucket}
        for bucket in (PUBLIC_BUCKET, PRIVATE_BUCKET)
    }
    missing_after = {
        bucket: sorted(keep_state["expected"][bucket] - after_by_bucket[bucket])
        for bucket in (PUBLIC_BUCKET, PRIVATE_BUCKET)
    }
    report.update(
        completedAt=now_iso(),
        deleted=summarize(row for row in selected if (str(row["bucket"]), str(row["key"])) not in after_keys),
        failed=failed,
        remainingCandidates=len(remaining),
        missingExpectedAfter={bucket: len(keys) for bucket, keys in missing_after.items()},
        missingExpectedAfterSample={bucket: keys[:20] for bucket, keys in missing_after.items()},
        inventoryAfter=summarize(after_rows),
    )
    write_outputs(report_path, manifest_path, report, selected)
    if failed or remaining or missing_after != missing_before:
        raise SystemExit(
            f"Cleanup verification failed: request failures={len(failed)}, remaining={len(remaining)}, "
            f"expected-key drift={missing_after != missing_before}"
        )
    print(f"Cleanup verified: deleted {report['deleted']['objects']} objects; all candidates absent.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
