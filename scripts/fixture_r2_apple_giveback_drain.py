#!/usr/bin/env python3
"""Resume verified Expo R2 uploads through fixture adoption and Apple Photos.

The drain is intentionally one asset at a time so the Apple Photos smart album
reflects verified progress immediately.  Historical uploads are accepted only
when their recorded upload result proves an exact remote checksum match and a
fresh signed HEAD confirms that every immutable R2 object still exists.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time
from typing import Any

from apple_photos_metadata_writer import BackstagePhotosMetadataAdapter, commit_writeback, writeback_plan
from fixture_pipeline import adopt_upload_run, editorial_version_hash, plan_upload_run_adoption
from sidecar_state_db import connect
from sync_r2_media import s3_signed_request


DEFAULT_FIXTURE_ID = "fixture-expo"


def stamp() -> str:
    """Return a compact local timestamp for durable progress output."""
    return datetime.now().astimezone().isoformat(timespec="seconds")


def append_event(log_path: Path, event: dict[str, Any]) -> None:
    """Append one durable JSON event without rewriting prior progress."""
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"at": stamp(), **event}, ensure_ascii=False, sort_keys=True) + "\n")


def candidate_rows(repo_root: Path, fixture_id: str, limit: int = 0) -> list[dict[str, Any]]:
    """Return approved uploaded assets not yet verified back into Photos."""
    with connect(repo_root) as conn:
        rows = conn.execute(
            """
            WITH successful_uploads AS (
              SELECT i.run_id, i.run_item_id, i.asset_id, i.photo_id, i.filename,
                     i.upload_keys_json, i.updated_at
              FROM sidecar_upload_bridge_run_items i
              JOIN sidecar_upload_bridge_runs r ON r.run_id = i.run_id
              WHERE r.execute_upload = 1
                AND i.status = 'uploaded'
                AND i.export_status = 'materialized'
                AND i.upload_status IN ('uploaded', 'uploaded_with_skips')
            )
            SELECT u.run_id, u.run_item_id, u.asset_id, u.photo_id, u.filename,
                   u.upload_keys_json,
                   EXISTS(
                     SELECT 1 FROM fixture_asset_placements p
                     WHERE p.asset_id = u.asset_id AND p.fixture_id = ? AND p.state = 'active'
                   ) AS already_placed
            FROM successful_uploads u
            JOIN sidecar_decisions d ON d.asset_id = u.asset_id
            WHERE d.pick_state = 'picked'
              AND d.metadata_state = 'approved'
              AND NOT EXISTS (
                SELECT 1 FROM json_each(d.keywords_json) AS keyword
                WHERE lower(trim(keyword.value)) LIKE 'ai generated%'
                   OR lower(trim(keyword.value)) IN ('generative ai', 'ai artwork')
                   OR lower(trim(keyword.value)) LIKE 'stained%'
              )
              AND NOT EXISTS(
                SELECT 1 FROM sidecar_tombstones t
                WHERE t.asset_id = u.asset_id AND t.tombstone_state = 'active'
              )
              AND (
                EXISTS(
                  SELECT 1 FROM fixture_asset_placements p
                  WHERE p.asset_id = u.asset_id AND p.fixture_id = ? AND p.state = 'active'
                )
                OR NOT EXISTS(
                  SELECT 1 FROM fixture_asset_placements p
                  WHERE p.asset_id = u.asset_id AND p.state = 'active'
                )
              )
            ORDER BY u.asset_id, u.updated_at DESC, u.run_item_id DESC
            """,
            (fixture_id, fixture_id),
        ).fetchall()
        candidates: list[dict[str, Any]] = []
        selected_assets: set[str] = set()
        for row in rows:
            if row["asset_id"] in selected_assets:
                continue
            upload_results = json.loads(row["upload_keys_json"] or "[]")
            if not (
                is_expo_upload(upload_results)
                and (
                    recorded_results_are_verified(upload_results)
                    or results_can_be_revalidated(upload_results)
                )
            ):
                continue
            version_hash = editorial_version_hash(conn, row["asset_id"])
            verified = conn.execute(
                """SELECT 1 FROM fixture_delivery_receipts
                   WHERE fixture_id = ? AND asset_id = ? AND destination = 'apple_photos'
                     AND version_hash = ? AND status = 'verified' LIMIT 1""",
                (fixture_id, row["asset_id"], version_hash),
            ).fetchone()
            if verified:
                selected_assets.add(row["asset_id"])
                continue
            candidates.append(
                {
                    "runId": row["run_id"],
                    "runItemId": row["run_item_id"],
                    "assetId": row["asset_id"],
                    "photoId": row["photo_id"] or "",
                    "filename": row["filename"] or "",
                    "uploadResults": upload_results,
                    "alreadyPlaced": bool(row["already_placed"]),
                    "versionHash": version_hash,
                }
            )
            selected_assets.add(row["asset_id"])
            if limit and len(candidates) >= limit:
                break
        return candidates


def recorded_results_are_verified(results: list[dict[str, Any]]) -> bool:
    """Require exact remote checksum evidence for every recorded R2 object."""
    if not results:
        return False
    for item in results:
        sha_verified = bool(
            item.get("checksumSha256")
            and item.get("checksumSha256") == item.get("remoteChecksumSha256")
        )
        etag_verified = bool(
            item.get("verificationMethod") == "etag-md5-content-length"
            and item.get("checksumSha256")
            and item.get("checksumMd5")
            and str(item.get("checksumMd5")).lower() == str(item.get("remoteEtagMd5") or "").lower()
        )
        if not (
            str(item.get("status") or "") == "uploaded"
            and bool(item.get("remoteVerified"))
            and (sha_verified or etag_verified)
            and bool(item.get("bucket"))
            and bool(item.get("key"))
        ):
            return False
    return True


def is_expo_upload(results: list[dict[str, Any]]) -> bool:
    """Keep this recovery drain strictly on the public Expo upload contract."""
    public_keys = [
        str(item.get("key") or "")
        for item in results
        if str(item.get("bucket") or "") == "photosbyelie-public"
    ]
    allowed = all(
        (
            str(item.get("bucket") or "") == "photosbyelie-public"
            and str(item.get("key") or "").startswith("expo/")
        )
        or (
            str(item.get("bucket") or "") == "photosbyelie-private"
            and str(item.get("key") or "").startswith("masters/")
        )
        for item in results
    )
    return bool(public_keys) and allowed


def results_can_be_revalidated(results: list[dict[str, Any]]) -> bool:
    """Return whether every legacy result still has its exact local upload artifact."""
    return bool(results) and all(
        str(item.get("status") or "") == "uploaded"
        and bool(item.get("bucket"))
        and bool(item.get("key"))
        and Path(str(item.get("sourcePath") or "")).is_file()
        for item in results
    )


def file_hashes(source_path: Path) -> tuple[str, str, int]:
    """Stream SHA-256 and MD5 together without loading a master into memory."""
    sha256 = hashlib.sha256()
    md5 = hashlib.md5(usedforsecurity=False)
    size = 0
    with source_path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            sha256.update(chunk)
            md5.update(chunk)
            size += len(chunk)
    return sha256.hexdigest(), md5.hexdigest(), size


def r2_presence_check(result: dict[str, Any], *, attempts: int = 3) -> dict[str, Any]:
    """Match a live R2 object to the exact local artifact used for its upload."""
    account_id = os.environ.get("R2_ACCOUNT_ID") or os.environ.get("CLOUDFLARE_ACCOUNT_ID") or ""
    access_key_id = os.environ.get("R2_ACCESS_KEY_ID") or os.environ.get("AWS_ACCESS_KEY_ID") or ""
    secret_access_key = os.environ.get("R2_SECRET_ACCESS_KEY") or os.environ.get("AWS_SECRET_ACCESS_KEY") or ""
    endpoint = os.environ.get("R2_S3_ENDPOINT", "")
    if not account_id or not access_key_id or not secret_access_key:
        raise RuntimeError("R2 S3 credentials are required for live presence verification")
    bucket = str(result.get("bucket") or "")
    key = str(result.get("key") or "")
    source_path = Path(str(result.get("sourcePath") or ""))
    if not source_path.is_file():
        raise RuntimeError(f"local upload artifact is missing for {bucket}/{key}")
    checksum_sha256, checksum_md5, local_size = file_hashes(source_path)
    output = ""
    for attempt in range(max(1, attempts)):
        headers: dict[str, str] = {}
        ok, status, output = s3_signed_request(
            "HEAD",
            f"{bucket}/{key}",
            [],
            b"",
            account_id,
            access_key_id,
            secret_access_key,
            endpoint,
            timeout=30.0,
            response_headers=headers,
        )
        if ok:
            remote_size = int(headers.get("content-length") or 0)
            remote_etag = headers.get("etag", "").strip().strip('"').lower()
            if remote_size != local_size:
                raise RuntimeError(
                    f"R2 size mismatch for {bucket}/{key}: local={local_size} remote={remote_size}"
                )
            if remote_etag and "-" not in remote_etag and remote_etag == checksum_md5:
                return {
                    **result,
                    "checksumSha256": checksum_sha256,
                    "remoteChecksumSha256": "",
                    "checksumMd5": checksum_md5,
                    "remoteEtagMd5": remote_etag,
                    "remoteVerified": True,
                    "verificationMethod": "etag-md5-content-length",
                    "verifiedAt": stamp(),
                    "remoteStatus": status,
                }
            with tempfile.TemporaryDirectory(prefix="pbe-r2-revalidate-") as temp_dir:
                download_path = Path(temp_dir) / "object"
                downloaded, download_status, download_output = s3_signed_request(
                    "GET",
                    f"{bucket}/{key}",
                    [],
                    b"",
                    account_id,
                    access_key_id,
                    secret_access_key,
                    endpoint,
                    timeout=180.0,
                    download_path=download_path,
                )
                if not downloaded:
                    raise RuntimeError(
                        f"R2 checksum download failed for {bucket}/{key}: "
                        f"HTTP {download_status} {download_output}"
                    )
                remote_sha256, _, downloaded_size = file_hashes(download_path)
                if remote_sha256 != checksum_sha256 or downloaded_size != local_size:
                    raise RuntimeError(f"R2 SHA-256 mismatch for {bucket}/{key}")
                return {
                    **result,
                    "checksumSha256": checksum_sha256,
                    "remoteChecksumSha256": remote_sha256,
                    "checksumMd5": checksum_md5,
                    "remoteEtagMd5": remote_etag,
                    "remoteVerified": True,
                    "verificationMethod": "sha256-download",
                    "verifiedAt": stamp(),
                    "remoteStatus": status,
                }
        if attempt + 1 < attempts:
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"R2 object presence check failed for {bucket}/{key}: {output or 'request failed'}")


def revalidate_r2_results(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Verify all objects for one asset concurrently to limit per-photo latency."""
    if not results_can_be_revalidated(results):
        raise RuntimeError("one or more local upload artifacts are unavailable")
    with ThreadPoolExecutor(max_workers=min(3, len(results))) as executor:
        return list(executor.map(r2_presence_check, results))


def save_revalidated_results(repo_root: Path, run_item_id: str, results: list[dict[str, Any]]) -> None:
    """Persist live evidence so adoption and future resumes use the same proof."""
    with connect(repo_root) as conn:
        conn.execute(
            """UPDATE sidecar_upload_bridge_run_items
               SET upload_keys_json = ?, updated_at = ? WHERE run_item_id = ?""",
            (json.dumps(results, ensure_ascii=False, sort_keys=True), stamp(), run_item_id),
        )
        conn.commit()


def global_verified_count(repo_root: Path) -> int:
    """Count distinct assets with a verified Apple Photos delivery receipt."""
    with connect(repo_root) as conn:
        row = conn.execute(
            """SELECT COUNT(DISTINCT asset_id) AS total FROM fixture_delivery_receipts
               WHERE destination = 'apple_photos' AND status = 'verified'"""
        ).fetchone()
    return int(row["total"] or 0)


def prepare_candidate(
    repo_root: Path,
    fixture_id: str,
    candidate: dict[str, Any],
) -> dict[str, Any]:
    """Complete one asset through R2 evidence and fixture adoption."""
    asset_id = candidate["assetId"]
    presence: list[dict[str, Any]] = []
    if not candidate["alreadyPlaced"]:
        presence = revalidate_r2_results(candidate["uploadResults"])
        save_revalidated_results(repo_root, candidate["runItemId"], presence)
        plan = plan_upload_run_adoption(
            repo_root,
            candidate["runId"],
            fixture_id,
            historical_backfill=True,
            revalidate_recorded_content=True,
            asset_ids=[asset_id],
        )
        if plan["eligibleCount"] != 1 or plan["blockedCount"]:
            raise RuntimeError(f"fixture adoption preflight blocked: {plan['blocked']}")
        adopt_upload_run(
            repo_root,
            candidate["runId"],
            fixture_id,
            historical_backfill=True,
            revalidate_recorded_content=True,
            asset_ids=[asset_id],
            actor="fixture-r2-apple-giveback-drain",
        )
    preflight = writeback_plan(repo_root, fixture_id, [asset_id])
    if preflight["count"] != 1 or preflight["blockedCount"]:
        raise RuntimeError(f"Apple Photos preflight blocked: {preflight['blocked']}")
    return {"assetId": asset_id, "r2Presence": presence}


def process_candidate(
    repo_root: Path,
    fixture_id: str,
    candidate: dict[str, Any],
    adapter: ApplePhotosAdapter,
) -> dict[str, Any]:
    """Complete one asset through R2 evidence, fixture adoption, and Photos reread."""
    prepared = prepare_candidate(repo_root, fixture_id, candidate)
    asset_id = candidate["assetId"]
    result = commit_writeback(repo_root, fixture_id, [asset_id], adapter=adapter)
    if not result["ok"] or result["writtenCount"] != 1:
        raise RuntimeError(f"Apple Photos give-back failed: {result['failed'] or result['blocked']}")
    return {**prepared, "photos": result["written"][0]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--fixture-id", default=DEFAULT_FIXTURE_ID)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--checkpoint-every", type=int, default=100)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument(
        "--global-checkpoint-every",
        type=int,
        default=0,
        help="Report when the repository-wide verified count reaches each multiple.",
    )
    parser.add_argument("--max-consecutive-failures", type=int, default=5)
    parser.add_argument("--commit", action="store_true")
    parser.add_argument("--log", type=Path)
    args = parser.parse_args()
    repo_root = args.repo_root.resolve()
    log_path = args.log or repo_root / ".review-logs" / f"fixture-r2-apple-giveback-{datetime.now().strftime('%Y%m%dT%H%M%S')}.jsonl"
    candidates = candidate_rows(repo_root, args.fixture_id, max(0, args.limit))
    baseline = global_verified_count(repo_root)
    print(
        f"{stamp()} give-back {'commit' if args.commit else 'dry-run'} "
        f"fixture={args.fixture_id} pending={len(candidates)} baselineVerified={baseline} log={log_path}",
        flush=True,
    )
    append_event(log_path, {"event": "start", "mode": "commit" if args.commit else "dry-run", "pending": len(candidates), "baselineVerified": baseline})
    if not args.commit:
        return 0
    adapter = BackstagePhotosMetadataAdapter(repo_root)
    completed = 0
    failed = 0
    consecutive_failures = 0
    checkpoint_every = max(1, args.checkpoint_every)
    global_checkpoint_every = max(0, args.global_checkpoint_every)
    next_global_checkpoint = (
        ((baseline // global_checkpoint_every) + 1) * global_checkpoint_every
        if global_checkpoint_every
        else 0
    )
    def checkpoint_if_needed() -> None:
        nonlocal next_global_checkpoint
        reached_local_checkpoint = completed and completed % checkpoint_every == 0
        reached_global_checkpoint = bool(
            global_checkpoint_every and baseline + completed >= next_global_checkpoint
        )
        if reached_local_checkpoint or reached_global_checkpoint:
            global_count = global_verified_count(repo_root)
            print(
                f"{stamp()} MILESTONE verified={completed}/{len(candidates)} "
                f"globalAppleVerified={global_count} failed={failed}",
                flush=True,
            )
            append_event(log_path, {"event": "milestone", "completed": completed, "pendingAtStart": len(candidates), "globalAppleVerified": global_count, "failed": failed})
            while global_checkpoint_every and next_global_checkpoint <= global_count:
                next_global_checkpoint += global_checkpoint_every

    batch_size = max(1, args.batch_size)
    index = 0
    while index < len(candidates):
        target_size = batch_size
        if global_checkpoint_every:
            target_size = min(target_size, max(1, next_global_checkpoint - (baseline + completed)))
        indexed_chunk = list(enumerate(candidates[index:index + target_size], index + 1))
        index += len(indexed_chunk)
        if batch_size > 1:
            prepared: list[tuple[int, dict[str, Any], dict[str, Any]]] = []
            for sequence, candidate in indexed_chunk:
                started = time.monotonic()
                try:
                    state = prepare_candidate(repo_root, args.fixture_id, candidate)
                    state["prepareElapsedSeconds"] = round(time.monotonic() - started, 3)
                    prepared.append((sequence, candidate, state))
                    consecutive_failures = 0
                except Exception as error:  # noqa: BLE001 - each item stays independently retryable.
                    failed += 1
                    consecutive_failures += 1
                    print(f"{stamp()} FAILED asset={candidate['assetId']} error={error}", flush=True)
                    append_event(log_path, {"event": "asset-failed", "sequence": sequence, "assetId": candidate["assetId"], "filename": candidate["filename"], "error": str(error)})
                    if consecutive_failures >= max(1, args.max_consecutive_failures):
                        break
            if consecutive_failures >= max(1, args.max_consecutive_failures):
                print(f"{stamp()} STOP consecutiveFailures={consecutive_failures}", flush=True)
                break
            if prepared:
                photos_started = time.monotonic()
                result = commit_writeback(
                    repo_root,
                    args.fixture_id,
                    [candidate["assetId"] for _, candidate, _ in prepared],
                    adapter=adapter,
                )
                photos_elapsed = round(time.monotonic() - photos_started, 3)
                written_by_asset = {item["assetId"]: item for item in result["written"]}
                failed_by_asset = {item["assetId"]: item for item in result["failed"]}
                for sequence, candidate, state in prepared:
                    photo = written_by_asset.get(candidate["assetId"])
                    if photo:
                        completed += 1
                        consecutive_failures = 0
                        append_event(
                            log_path,
                            {
                                "event": "asset-verified", "sequence": sequence, "completed": completed,
                                "assetId": candidate["assetId"], "filename": candidate["filename"],
                                "elapsedSeconds": state["prepareElapsedSeconds"],
                                "batchPhotosElapsedSeconds": photos_elapsed,
                                "result": {**state, "photos": photo},
                            },
                        )
                    else:
                        failed += 1
                        consecutive_failures += 1
                        error = (failed_by_asset.get(candidate["assetId"]) or {}).get("error") or "Apple Photos batch did not return a verified item"
                        print(f"{stamp()} FAILED asset={candidate['assetId']} error={error}", flush=True)
                        append_event(log_path, {"event": "asset-failed", "sequence": sequence, "assetId": candidate["assetId"], "filename": candidate["filename"], "error": str(error)})
                checkpoint_if_needed()
                if consecutive_failures >= max(1, args.max_consecutive_failures):
                    print(f"{stamp()} STOP consecutiveFailures={consecutive_failures}", flush=True)
                    break
            continue

        sequence, candidate = indexed_chunk[0]
        started = time.monotonic()
        try:
            result = process_candidate(repo_root, args.fixture_id, candidate, adapter)
            completed += 1
            consecutive_failures = 0
            append_event(
                log_path,
                {
                    "event": "asset-verified",
                    "sequence": sequence,
                    "completed": completed,
                    "assetId": candidate["assetId"],
                    "filename": candidate["filename"],
                    "elapsedSeconds": round(time.monotonic() - started, 3),
                    "result": result,
                },
            )
            checkpoint_if_needed()
        except Exception as error:  # noqa: BLE001 - preserve the failed asset and keep the drain resumable.
            failed += 1
            consecutive_failures += 1
            print(f"{stamp()} FAILED asset={candidate['assetId']} error={error}", flush=True)
            append_event(log_path, {"event": "asset-failed", "sequence": sequence, "assetId": candidate["assetId"], "filename": candidate["filename"], "error": str(error)})
            if consecutive_failures >= max(1, args.max_consecutive_failures):
                print(f"{stamp()} STOP consecutiveFailures={consecutive_failures}", flush=True)
                break
    global_count = global_verified_count(repo_root)
    remaining = len(candidate_rows(repo_root, args.fixture_id))
    print(
        f"{stamp()} DONE verified={completed} failed={failed} "
        f"globalAppleVerified={global_count} remaining={remaining}",
        flush=True,
    )
    append_event(log_path, {"event": "done", "completed": completed, "failed": failed, "globalAppleVerified": global_count, "remaining": remaining})
    return 0 if failed == 0 and remaining == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
