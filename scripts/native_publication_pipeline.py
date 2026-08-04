#!/usr/bin/env python3
"""Versioned Photos sync, immediate publication, and guarded R2 reconciliation."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
from typing import Any, Callable, Iterable
import uuid

from fixture_pipeline import connect, editorial_version_hash, now_iso, record_delivery_receipt
from fixture_policy import (
    effective_fixture_policy,
    policy_allows_cloud,
    policy_allows_r2_result,
)
from native_catalog_promotion import (
    catalog_candidate,
    promote_verified_asset,
    record_catalog_pending,
    retired_storefront_media_types,
)


MANAGED_PREFIXES = (
    "PBE:Rating:",
    "PBE:Color:",
    "PBE-Rating-",
    "PBE-Color-",
    "PBE-Fixture-ID:",
)
MANAGED_EXACT = {"PBE:Approved", "PBE:Tombstone", "PBE-Approved"}
PUBLICATION_BATCH_LIMIT = 50
DEFAULT_UPLOAD_CONCURRENCY = 4
QUARANTINE_DAYS = 30


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _read_json(value: Any, fallback: Any) -> Any:
    try:
        return json.loads(str(value or ""))
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback


def _clean(values: Iterable[Any]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = str(value or "").strip()
        key = text.casefold()
        if text and key not in seen:
            seen.add(key)
            result.append(text)
    return result


def _is_managed_keyword(value: str) -> bool:
    return value in MANAGED_EXACT or value.startswith(MANAGED_PREFIXES)


def _photos_metadata(values: dict[str, Any]) -> tuple[str, str, list[str], int, str]:
    title = str(values.get("title") or "").strip()
    caption = str(values.get("caption") or "").strip()
    keywords = _clean(values.get("keywords") or [])
    rating = 0
    color = ""
    canonical: list[str] = []
    for keyword in keywords:
        if keyword.startswith("PBE:Rating:"):
            try:
                candidate = int(keyword.rsplit(":", 1)[-1])
                if 1 <= candidate <= 5:
                    rating = candidate
            except ValueError:
                pass
        elif keyword.startswith("PBE:Color:"):
            candidate = keyword.rsplit(":", 1)[-1].strip().casefold()
            if candidate in {"red", "yellow", "green", "blue"}:
                color = candidate
        elif not _is_managed_keyword(keyword):
            canonical.append(keyword)
    return title, caption, canonical, rating, color


def metadata_fingerprint(
    title: str,
    caption: str,
    keywords: Iterable[Any],
) -> str:
    payload = {
        "title": str(title or ""),
        "caption": str(caption or ""),
        "keywords": _clean(keywords),
    }
    return hashlib.sha256(_json(payload).encode("utf-8")).hexdigest()


def source_version_id(
    asset_id: str,
    metadata_sha256: str,
    rendered_sha256: str,
) -> str:
    digest = hashlib.sha256(
        f"{asset_id}\0{metadata_sha256}\0{rendered_sha256}".encode("utf-8")
    ).hexdigest()
    return f"srcv-{digest[:32]}"


def _parse_timestamp(value: str) -> datetime:
    text = str(value or "").strip().replace("Z", "+00:00")
    parsed = datetime.fromisoformat(text)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _effective_fixture_ids(conn, asset_id: str) -> list[str]:
    rows = conn.execute(
        """
        SELECT decision.fixture_id
        FROM fixture_asset_decisions AS decision
        JOIN fixtures AS fixture ON fixture.fixture_id = decision.fixture_id
        WHERE decision.asset_id = ?
          AND decision.eligibility_state = 'active'
          AND decision.placement_state = 'picked'
          AND fixture.archived_at IS NULL
        ORDER BY decision.fixture_id
        """,
        (asset_id,),
    ).fetchall()
    return [str(row["fixture_id"]) for row in rows]


def upload_eligibility_plan(
    repo_root: Path,
    *,
    fixture_id: str,
    offset: int = 0,
    limit: int = 200,
    order: str = "oldest",
) -> dict[str, Any]:
    """Return a read-only fixture-scoped view of approved assets awaiting publication."""
    clean_fixture_id = str(fixture_id or "").strip()
    if not clean_fixture_id:
        raise ValueError("fixture ID is required")
    safe_offset = max(0, int(offset or 0))
    safe_limit = max(1, min(500, int(limit or 200)))
    clean_order = "recent" if str(order or "").strip().casefold() == "recent" else "oldest"
    order_sql = (
        "ORDER BY delivery.updated_at DESC, decision.asset_id DESC"
        if clean_order == "recent"
        else "ORDER BY delivery.updated_at, decision.asset_id"
    )
    with connect(repo_root) as conn:
        retired_media_types = retired_storefront_media_types(repo_root)
        retired_media_filter = ""
        retired_media_params: dict[str, str] = {}
        if retired_media_types:
            names = []
            for index, media_type in enumerate(sorted(retired_media_types)):
                name = f"retired_media_type_{index}"
                names.append(f":{name}")
                retired_media_params[name] = media_type
            retired_media_filter = (
                " AND LOWER(COALESCE(asset.media_type, 'photo')) NOT IN ("
                + ", ".join(names)
                + ")"
            )
        fixture = conn.execute(
            """
            SELECT fixture_id, name
            FROM fixtures
            WHERE fixture_id = ? AND archived_at IS NULL
            """,
            (clean_fixture_id,),
        ).fetchone()
        if not fixture:
            raise ValueError("fixture does not exist or is archived")
        policy = effective_fixture_policy(
            repo_root,
            clean_fixture_id,
            conn=conn,
        )["effective"]
        cloud_allowed = policy_allows_cloud(policy)
        summary = conn.execute(
            f"""
            SELECT
              count(*) AS picked_count,
              sum(CASE WHEN editorial.editorial_state = 'approved' THEN 1 ELSE 0 END)
                AS approved_count,
              sum(CASE WHEN editorial.editorial_state != 'approved' THEN 1 ELSE 0 END)
                AS needs_review_count,
              sum(CASE WHEN editorial.editorial_state = 'approved'
                        AND delivery.delivery_state IN ('needs-upload', 'failed')
                        {retired_media_filter}
                       THEN 1 ELSE 0 END)
                AS needs_upload_count,
              sum(CASE WHEN editorial.editorial_state = 'approved'
                        AND delivery.delivery_state = 'live'
                        {retired_media_filter}
                       THEN 1 ELSE 0 END)
                AS live_count
            FROM fixture_asset_decisions AS decision
            JOIN sidecar_assets AS asset ON asset.asset_id = decision.asset_id
            JOIN asset_editorial_state AS editorial ON editorial.asset_id = decision.asset_id
            JOIN asset_delivery_state AS delivery ON delivery.asset_id = decision.asset_id
            WHERE decision.fixture_id = :fixture_id
              AND decision.eligibility_state = 'active'
              AND decision.placement_state = 'picked'
              AND (asset.missing_at IS NULL OR asset.missing_at = '')
              AND NOT EXISTS (
                SELECT 1 FROM sidecar_tombstones AS tombstone
                WHERE tombstone.asset_id = decision.asset_id
                  AND tombstone.tombstone_state = 'active'
              )
            """,
            {"fixture_id": clean_fixture_id, **retired_media_params},
        ).fetchone()
        items: list[dict[str, Any]] = []
        if cloud_allowed:
            rows = conn.execute(
                f"""
                SELECT decision.asset_id,
                       asset.source_anchor,
                       asset.raw_json,
                       COALESCE(NULLIF(global_decision.title, ''),
                                NULLIF(asset.photos_title, ''),
                                asset.filename,
                                decision.asset_id) AS title,
                       COALESCE(global_decision.keywords_json, '[]') AS keywords_json,
                       COALESCE(asset.filename, '') AS filename,
                       COALESCE(asset.captured_at, '') AS captured_at,
                       delivery.delivery_state,
                       delivery.last_error
                FROM fixture_asset_decisions AS decision
                JOIN sidecar_assets AS asset ON asset.asset_id = decision.asset_id
                JOIN asset_editorial_state AS editorial ON editorial.asset_id = decision.asset_id
                JOIN asset_delivery_state AS delivery ON delivery.asset_id = decision.asset_id
                LEFT JOIN sidecar_decisions AS global_decision
                  ON global_decision.asset_id = decision.asset_id
                WHERE decision.fixture_id = :fixture_id
                  AND decision.eligibility_state = 'active'
                  AND decision.placement_state = 'picked'
                  AND editorial.editorial_state = 'approved'
                  AND delivery.delivery_state IN ('needs-upload', 'failed')
                  AND (asset.missing_at IS NULL OR asset.missing_at = '')
                  AND NOT EXISTS (
                    SELECT 1 FROM sidecar_tombstones AS tombstone
                    WHERE tombstone.asset_id = decision.asset_id
                      AND tombstone.tombstone_state = 'active'
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM asset_source_versions AS source
                    WHERE source.asset_id = decision.asset_id
                      AND source.state = 'source-missing'
                      AND source.source_exists = 0
                  )
                  {retired_media_filter}
                  {order_sql}
                LIMIT :limit OFFSET :offset
                """,
                {
                    "fixture_id": clean_fixture_id,
                    "limit": safe_limit,
                    "offset": safe_offset,
                    **retired_media_params,
                },
            ).fetchall()
            items = [
                {
                    "assetId": str(row["asset_id"]),
                    "photoLibraryIdentifier": (
                        str(_read_json(row["raw_json"], {}).get("localIdentifier") or "")
                        or str(row["source_anchor"] or "").removeprefix("apple-photos://")
                        or str(row["asset_id"])
                    ),
                    "title": str(row["title"] or ""),
                    "keywords": _read_json(row["keywords_json"], []),
                    "filename": str(row["filename"] or ""),
                    "capturedAt": str(row["captured_at"] or ""),
                    "deliveryState": str(row["delivery_state"] or "needs-upload"),
                    "errorText": str(row["last_error"] or ""),
                }
                for row in rows
            ]
    needs_upload_count = int(summary["needs_upload_count"] or 0) if cloud_allowed else 0
    return {
        "ok": True,
        "readOnly": True,
        "fixtureId": clean_fixture_id,
        "fixtureName": str(fixture["name"] or clean_fixture_id),
        "cloudAllowed": cloud_allowed,
        "pickedCount": int(summary["picked_count"] or 0),
        "approvedCount": int(summary["approved_count"] or 0),
        "needsReviewCount": int(summary["needs_review_count"] or 0),
        "needsUploadCount": needs_upload_count,
        "liveCount": int(summary["live_count"] or 0),
        "offset": safe_offset,
        "limit": safe_limit,
        "order": clean_order,
        "count": len(items),
        "hasNext": safe_offset + len(items) < needs_upload_count,
        "items": items,
    }


def _upsert_source_version(
    conn,
    asset_id: str,
    metadata_sha256: str,
    rendered_sha256: str,
    state: str,
    timestamp: str,
    *,
    source_exists: bool = True,
) -> str:
    version_id = source_version_id(asset_id, metadata_sha256, rendered_sha256)
    conn.execute(
        """
        INSERT INTO asset_source_versions (
          version_id, asset_id, metadata_fingerprint, rendered_fingerprint,
          source_exists, state, created_at, approved_at, live_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(version_id) DO UPDATE SET
          source_exists = excluded.source_exists,
          state = CASE
            WHEN asset_source_versions.state = 'live' AND excluded.state != 'source-missing'
              THEN 'live'
            ELSE excluded.state
          END
        """,
        (
            version_id,
            asset_id,
            metadata_sha256,
            rendered_sha256,
            1 if source_exists else 0,
            state,
            timestamp,
            timestamp if state in {"approved", "live"} else None,
            timestamp if state == "live" else None,
        ),
    )
    return version_id


def record_photos_sync_snapshot(
    repo_root: Path,
    items: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    """Import an incremental PhotoKit snapshot without disturbing live versions."""
    timestamp = now_iso()
    changes = {
        "baseline": 0,
        "unchanged": 0,
        "metadataOnly": 0,
        "appearance": 0,
        "sourceMissing": 0,
        "sourceReturned": 0,
    }
    rows_out: list[dict[str, Any]] = []
    retired_media_types = retired_storefront_media_types(repo_root)
    with connect(repo_root) as conn:
        for item in items:
            asset_id = str(item.get("assetId") or "").strip()
            if not asset_id:
                raise ValueError("sync items require assetId")
            asset = conn.execute(
                "SELECT asset_id, missing_at, media_type FROM sidecar_assets WHERE asset_id = ?",
                (asset_id,),
            ).fetchone()
            if not asset:
                raise ValueError(f"sync asset is not indexed: {asset_id}")
            retired_media = str(asset["media_type"] or "photo").casefold() in retired_media_types
            photos_asset_id = str(item.get("photosAssetId") or asset_id).strip()
            source_exists = bool(item.get("sourceExists", True))
            title, caption, keywords, rating, color = _photos_metadata(item)
            metadata_sha256 = metadata_fingerprint(title, caption, item.get("keywords") or [])
            rendered_sha256 = str(item.get("renderedFingerprint") or "").strip()
            previous = conn.execute(
                "SELECT * FROM asset_sync_state WHERE asset_id = ?",
                (asset_id,),
            ).fetchone()
            editorial = conn.execute(
                "SELECT editorial_state FROM asset_editorial_state WHERE asset_id = ?",
                (asset_id,),
            ).fetchone()
            approved = bool(editorial and editorial["editorial_state"] == "approved")
            delivery = conn.execute(
                "SELECT delivery_state FROM asset_delivery_state WHERE asset_id = ?",
                (asset_id,),
            ).fetchone()
            delivery_state = str(delivery["delivery_state"] or "not-ready") if delivery else "not-ready"
            kind = "unchanged"

            if not source_exists:
                kind = "sourceMissing"
                _upsert_source_version(
                    conn,
                    asset_id,
                    metadata_sha256,
                    rendered_sha256 or (str(previous["rendered_fingerprint"]) if previous else ""),
                    "source-missing",
                    timestamp,
                    source_exists=False,
                )
                conn.execute(
                    "UPDATE sidecar_assets SET missing_at = ?, updated_at = ? WHERE asset_id = ?",
                    (timestamp, timestamp, asset_id),
                )
                conn.execute(
                    """
                    UPDATE asset_publications
                    SET state = 'withdrawn', withdrawn_at = ?, updated_at = ?
                    WHERE asset_id = ? AND state = 'live'
                    """,
                    (timestamp, timestamp, asset_id),
                )
                conn.execute(
                    """
                    UPDATE asset_delivery_state
                    SET delivery_state = 'not-ready',
                        last_error = 'Apple Photos source is missing',
                        updated_at = ?
                    WHERE asset_id = ?
                    """,
                    (timestamp, asset_id),
                )
            elif previous is None:
                kind = "baseline"
                initial_state = (
                    "live"
                    if delivery_state == "live"
                    else ("approved" if approved else "candidate")
                )
                _upsert_source_version(
                    conn,
                    asset_id,
                    metadata_sha256,
                    rendered_sha256,
                    initial_state,
                    timestamp,
                )
                conn.execute(
                    "UPDATE sidecar_assets SET missing_at = NULL, updated_at = ? WHERE asset_id = ?",
                    (timestamp, asset_id),
                )
            else:
                was_missing = bool(asset["missing_at"])
                if was_missing:
                    changes["sourceReturned"] += 1
                    conn.execute(
                        "UPDATE sidecar_assets SET missing_at = NULL, updated_at = ? WHERE asset_id = ?",
                        (timestamp, asset_id),
                    )
                old_metadata = str(previous["metadata_fingerprint"] or "")
                old_rendered = str(previous["rendered_fingerprint"] or "")
                appearance_changed = bool(
                    old_rendered
                    and rendered_sha256
                    and old_rendered != rendered_sha256
                )
                metadata_changed = bool(
                    old_metadata and old_metadata != metadata_sha256
                )
                giveback_echo = bool(
                    metadata_changed
                    and str(previous["last_giveback_fingerprint"] or "")
                    == metadata_sha256
                )
                if appearance_changed:
                    kind = "appearance"
                    _upsert_source_version(
                        conn,
                        asset_id,
                        metadata_sha256,
                        rendered_sha256,
                        "candidate",
                        timestamp,
                    )
                    conn.execute(
                        """
                        UPDATE asset_editorial_state
                        SET editorial_state = 'unreviewed', approved_at = NULL,
                            updated_at = ?
                        WHERE asset_id = ?
                        """,
                        (timestamp, asset_id),
                    )
                    conn.execute(
                        """
                        UPDATE sidecar_decisions
                        SET metadata_state = 'unreviewed', title = ?, caption = ?,
                            keywords_json = ?, rating = ?, color = ?,
                            last_action = 'photos-appearance-change', updated_at = ?
                        WHERE asset_id = ?
                        """,
                        (
                            title,
                            caption,
                            _json(keywords),
                            rating,
                            color,
                            timestamp,
                            asset_id,
                        ),
                    )
                    conn.execute(
                        """
                        UPDATE asset_delivery_state
                        SET delivery_state = 'not-ready', last_error = '',
                            updated_at = ?
                        WHERE asset_id = ?
                        """,
                        (timestamp, asset_id),
                    )
                elif metadata_changed and not giveback_echo:
                    kind = "metadataOnly"
                    conn.execute(
                        """
                        UPDATE sidecar_decisions
                        SET title = ?, caption = ?, keywords_json = ?,
                            rating = ?, color = ?,
                            last_action = 'photos-metadata-change', updated_at = ?
                        WHERE asset_id = ?
                        """,
                        (
                            title,
                            caption,
                            _json(keywords),
                            rating,
                            color,
                            timestamp,
                            asset_id,
                        ),
                    )
                    if approved:
                        conn.execute(
                            """
                            UPDATE asset_delivery_state
                            SET delivery_state = 'needs-upload', last_error = '',
                                updated_at = ?
                            WHERE asset_id = ?
                            """,
                            (timestamp, asset_id),
                        )
                    _upsert_source_version(
                        conn,
                        asset_id,
                        metadata_sha256,
                        rendered_sha256 or old_rendered,
                        "approved" if approved else "candidate",
                        timestamp,
                    )
                elif giveback_echo:
                    kind = "unchanged"

            if retired_media:
                conn.execute(
                    """
                    UPDATE asset_publications
                    SET state = 'withdrawn', withdrawn_at = COALESCE(withdrawn_at, ?), updated_at = ?
                    WHERE asset_id = ? AND state = 'live'
                    """,
                    (timestamp, timestamp, asset_id),
                )
                conn.execute(
                    """
                    UPDATE asset_delivery_state
                    SET delivery_state = 'not-ready',
                        last_error = 'Media type retired from sales',
                        updated_at = ?
                    WHERE asset_id = ?
                    """,
                    (timestamp, asset_id),
                )

            conn.execute(
                """
                INSERT INTO asset_sync_state (
                  asset_id, photos_asset_id, metadata_fingerprint,
                  rendered_fingerprint, last_scanned_at, last_error,
                  created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, '', ?, ?)
                ON CONFLICT(asset_id) DO UPDATE SET
                  photos_asset_id = excluded.photos_asset_id,
                  metadata_fingerprint = excluded.metadata_fingerprint,
                  rendered_fingerprint = CASE
                    WHEN excluded.rendered_fingerprint = ''
                      THEN asset_sync_state.rendered_fingerprint
                    ELSE excluded.rendered_fingerprint
                  END,
                  last_scanned_at = excluded.last_scanned_at,
                  last_error = '',
                  updated_at = excluded.updated_at
                """,
                (
                    asset_id,
                    photos_asset_id,
                    metadata_sha256,
                    rendered_sha256,
                    timestamp,
                    timestamp,
                    timestamp,
                ),
            )
            changes[kind] += 1
            rows_out.append({"assetId": asset_id, "change": kind})
        conn.commit()
    return {
        "ok": True,
        "count": len(rows_out),
        "changes": changes,
        "items": rows_out,
        "scannedAt": timestamp,
    }


def _verified_results(upload_results: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    results = [dict(item) for item in upload_results if isinstance(item, dict)]
    if not results:
        raise ValueError("upload results are empty")
    for result in results:
        checksum = str(result.get("checksumSha256") or "")
        remote = str(result.get("remoteChecksumSha256") or "")
        if (
            str(result.get("status") or "") != "uploaded"
            or not result.get("remoteVerified")
            or not checksum
            or checksum != remote
            or not str(result.get("key") or "")
            or not str(result.get("bucket") or "")
        ):
            raise ValueError("every upload object must be checksum-verified")
    return results


def publish_verified_asset(
    repo_root: Path,
    asset_id: str,
    upload_results: Iterable[dict[str, Any]],
    *,
    collection_resolver: Callable[[str], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Atomically make one verified object set live in every effective fixture."""
    results = _verified_results(upload_results)
    timestamp = now_iso()
    with connect(repo_root) as conn:
        media_row = conn.execute(
            "SELECT media_type FROM sidecar_assets WHERE asset_id = ?",
            (asset_id,),
        ).fetchone()
        media_type = str(media_row["media_type"] or "photo").casefold() if media_row else "photo"
        if media_type in retired_storefront_media_types(repo_root):
            return {
                "ok": True,
                "published": False,
                "assetId": asset_id,
                "sourceVersionHash": "",
                "fixtureIds": [],
                "skippedFixtureIds": [],
                "fixturePolicies": {},
                "objectCount": len(results),
                "objectKeys": [
                    {"bucket": str(item["bucket"]), "key": str(item["key"])}
                    for item in results
                ],
                "catalogState": "not-applicable",
                "publicCatalog": {"state": "not-applicable", "reason": "retired_media_type"},
                "reason": "retired_media_type",
            }
        editorial = conn.execute(
            "SELECT editorial_state FROM asset_editorial_state WHERE asset_id = ?",
            (asset_id,),
        ).fetchone()
        if not editorial or editorial["editorial_state"] != "approved":
            raise ValueError("only globally approved assets can be published")
        if conn.execute(
            """
            SELECT 1 FROM sidecar_tombstones
            WHERE asset_id = ? AND tombstone_state = 'active'
            """,
            (asset_id,),
        ).fetchone():
            raise ValueError("tombstoned assets cannot be published")
        source = conn.execute(
            """
            SELECT * FROM asset_source_versions
            WHERE asset_id = ? AND source_exists = 1
            ORDER BY
              CASE state WHEN 'candidate' THEN 0 WHEN 'approved' THEN 1
                WHEN 'live' THEN 2 ELSE 3 END,
              created_at DESC
            LIMIT 1
            """,
            (asset_id,),
        ).fetchone()
        if source:
            version_hash = str(source["version_id"])
        else:
            sync = conn.execute(
                "SELECT metadata_fingerprint, rendered_fingerprint FROM asset_sync_state WHERE asset_id = ?",
                (asset_id,),
            ).fetchone()
            metadata_sha256 = (
                str(sync["metadata_fingerprint"] or "")
                if sync
                else editorial_version_hash(conn, asset_id)
            )
            rendered_sha256 = str(sync["rendered_fingerprint"] or "") if sync else ""
            version_hash = _upsert_source_version(
                conn,
                asset_id,
                metadata_sha256,
                rendered_sha256,
                "approved",
                timestamp,
            )
        fixture_ids = _effective_fixture_ids(conn, asset_id)
        fixture_policies = {
            fixture_id: effective_fixture_policy(
                repo_root,
                fixture_id,
                conn=conn,
            )["effective"]
            for fixture_id in fixture_ids
        }
        fixture_results = {
            fixture_id: [
                result
                for result in results
                if policy_allows_r2_result(policy, result)
            ]
            for fixture_id, policy in fixture_policies.items()
        }
        publishable_fixture_ids = [
            fixture_id
            for fixture_id in fixture_ids
            if fixture_results[fixture_id]
        ]
        if not publishable_fixture_ids:
            raise ValueError(
                "no effective fixture policy permits cloud publication for this asset"
            )

        for result in results:
            conn.execute(
                """
                INSERT INTO r2_objects (
                  bucket, object_key, photo_id, object_kind, lifecycle_state,
                  first_seen_at, last_seen_at, last_checked_at, source, bytes,
                  updated_at
                ) VALUES (?, ?, ?, ?, 'current', ?, ?, ?, 'native-publication', ?, ?)
                ON CONFLICT(bucket, object_key) DO UPDATE SET
                  photo_id = excluded.photo_id,
                  object_kind = excluded.object_kind,
                  lifecycle_state = 'current',
                  last_seen_at = excluded.last_seen_at,
                  last_checked_at = excluded.last_checked_at,
                  marked_for_delete_at = NULL,
                  deleted_confirmed_at = NULL,
                  source = excluded.source,
                  bytes = excluded.bytes,
                  updated_at = excluded.updated_at
                """,
                (
                    str(result["bucket"]),
                    str(result["key"]),
                    asset_id,
                    str(result.get("objectKind") or result.get("kind") or ""),
                    timestamp,
                    timestamp,
                    timestamp,
                    int(result.get("bytes") or 0),
                    timestamp,
                ),
            )
        conn.execute(
            """
            UPDATE asset_publications
            SET state = 'superseded', withdrawn_at = ?, updated_at = ?
            WHERE asset_id = ? AND state = 'live'
            """,
            (timestamp, timestamp, asset_id),
        )
        for fixture_id in publishable_fixture_ids:
            conn.execute(
                """
                INSERT INTO asset_publications (
                  asset_id, fixture_id, source_version_hash, state,
                  published_at, updated_at
                ) VALUES (?, ?, ?, 'live', ?, ?)
                ON CONFLICT(asset_id, fixture_id, source_version_hash) DO UPDATE SET
                  state = 'live', withdrawn_at = NULL, updated_at = excluded.updated_at
                """,
                (asset_id, fixture_id, version_hash, timestamp, timestamp),
            )
            for result in fixture_results[fixture_id]:
                record_delivery_receipt(
                    repo_root,
                    fixture_id=fixture_id,
                    asset_id=asset_id,
                    destination="r2",
                    version_hash=version_hash,
                    status="verified",
                    object_key=str(result["key"]),
                    checksum_sha256=str(result["checksumSha256"]),
                    visibility_policy=(
                        "public"
                        if str(result["bucket"]).endswith("public")
                        else "private"
                    ),
                    verification={
                        "bucket": result["bucket"],
                        "bytes": result.get("bytes"),
                        "remoteVerified": True,
                        "remoteChecksumSha256": result["remoteChecksumSha256"],
                    },
                    conn=conn,
                )
        conn.execute(
            """
            UPDATE asset_source_versions
            SET state = 'superseded', superseded_at = ?
            WHERE asset_id = ? AND state = 'live' AND version_id != ?
            """,
            (timestamp, asset_id, version_hash),
        )
        conn.execute(
            """
            UPDATE asset_source_versions
            SET state = 'live', source_exists = 1, live_at = ?,
                superseded_at = NULL
            WHERE version_id = ?
            """,
            (timestamp, version_hash),
        )
        conn.execute(
            """
            UPDATE asset_delivery_state
            SET delivery_state = 'live', source_version_hash = ?,
                last_error = '', updated_at = ?
            WHERE asset_id = ?
            """,
            (version_hash, timestamp, asset_id),
        )
        catalog_plan = catalog_candidate(
            repo_root,
            conn,
            asset_id,
            results,
            source_version_hash=version_hash,
            collection_resolver=collection_resolver,
        )
        if catalog_plan.get("eligible"):
            record_catalog_pending(
                conn,
                asset_id=asset_id,
                source_version_hash=version_hash,
                media_id=str(catalog_plan["mediaId"]),
                timestamp=timestamp,
            )
        conn.commit()
    catalog_result = {
        "state": "not-applicable",
        "reason": catalog_plan.get("reason", "not-eligible"),
        "error": catalog_plan.get("error", ""),
    }
    if catalog_plan.get("eligible"):
        catalog_result = promote_verified_asset(
            repo_root,
            asset_id,
            version_hash,
            results,
            collection_resolver=collection_resolver,
        )
    return {
        "ok": True,
        "assetId": asset_id,
        "sourceVersionHash": version_hash,
        "fixtureIds": publishable_fixture_ids,
        "skippedFixtureIds": sorted(set(fixture_ids) - set(publishable_fixture_ids)),
        "fixturePolicies": fixture_policies,
        "objectCount": len(results),
        "objectKeys": [
            {"bucket": str(item["bucket"]), "key": str(item["key"])}
            for item in results
        ],
        "catalogState": str(catalog_result.get("state") or "not-applicable"),
        "publicCatalog": catalog_result,
        "publishedAt": timestamp,
    }


def create_upload_run(
    repo_root: Path,
    asset_ids: Iterable[str] = (),
    *,
    limit: int = PUBLICATION_BATCH_LIMIT,
    concurrency: int = DEFAULT_UPLOAD_CONCURRENCY,
) -> dict[str, Any]:
    safe_limit = max(1, min(PUBLICATION_BATCH_LIMIT, int(limit or PUBLICATION_BATCH_LIMIT)))
    safe_concurrency = max(1, min(8, int(concurrency or DEFAULT_UPLOAD_CONCURRENCY)))
    requested = _clean(asset_ids)
    timestamp = now_iso()
    run_id = f"uplrun-{uuid.uuid4().hex[:16]}"
    with connect(repo_root) as conn:
        retired_media_types = retired_storefront_media_types(repo_root)
        params: list[Any] = []
        requested_filter = ""
        if requested:
            requested_filter = f" AND delivery.asset_id IN ({','.join('?' for _ in requested)})"
            params.extend(requested)
        retired_media_filter = ""
        if retired_media_types:
            retired_media_filter = (
                " AND LOWER(COALESCE(asset.media_type, 'photo')) NOT IN ("
                + ", ".join("?" for _ in retired_media_types)
                + ")"
            )
            params.extend(sorted(retired_media_types))
        rows = conn.execute(
            f"""
            SELECT delivery.asset_id
            FROM asset_delivery_state AS delivery
            JOIN sidecar_assets AS asset
              ON asset.asset_id = delivery.asset_id
            JOIN asset_editorial_state AS editorial
              ON editorial.asset_id = delivery.asset_id
            WHERE delivery.delivery_state IN ('needs-upload', 'failed')
              AND editorial.editorial_state = 'approved'
              AND NOT EXISTS (
                SELECT 1 FROM sidecar_tombstones AS tombstone
                WHERE tombstone.asset_id = delivery.asset_id
                  AND tombstone.tombstone_state = 'active'
              )
              AND NOT EXISTS (
                SELECT 1 FROM asset_source_versions AS source
                WHERE source.asset_id = delivery.asset_id
                  AND source.state = 'source-missing'
                  AND source.source_exists = 0
              )
              {requested_filter}
              {retired_media_filter}
            ORDER BY delivery.updated_at, delivery.asset_id
            LIMIT ?
            """,
            [*params, max(safe_limit, min(1000, safe_limit * 20))],
        ).fetchall()
        selected: list[str] = []
        for row in rows:
            asset_id = str(row["asset_id"])
            fixture_ids = _effective_fixture_ids(conn, asset_id)
            if any(
                policy_allows_cloud(
                    effective_fixture_policy(repo_root, fixture_id, conn=conn)["effective"]
                )
                for fixture_id in fixture_ids
            ):
                selected.append(asset_id)
            if len(selected) >= safe_limit:
                break
        conn.execute(
            """
            INSERT INTO asset_upload_runs (
              run_id, status, requested_count, remaining_count, concurrency,
              created_at, updated_at
            ) VALUES (?, 'queued', ?, ?, ?, ?, ?)
            """,
            (
                run_id,
                len(selected),
                len(selected),
                safe_concurrency,
                timestamp,
                timestamp,
            ),
        )
        conn.executemany(
            """
            INSERT INTO asset_upload_run_items (
              run_id, asset_id, status, updated_at
            ) VALUES (?, ?, 'queued', ?)
            """,
            [(run_id, asset_id, timestamp) for asset_id in selected],
        )
        conn.commit()
    return {
        "ok": True,
        "runId": run_id,
        "status": "queued",
        "count": len(selected),
        "assetIds": selected,
        "limit": safe_limit,
        "concurrency": safe_concurrency,
    }


def run_upload_batch(
    repo_root: Path,
    run_id: str,
    upload: Callable[[str], Iterable[dict[str, Any]]],
    *,
    progress: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, Any]:
    """Upload one <=50 item run concurrently; publish verified items independently."""
    started_at = now_iso()
    with connect(repo_root) as conn:
        run = conn.execute(
            "SELECT * FROM asset_upload_runs WHERE run_id = ?",
            (run_id,),
        ).fetchone()
        if not run:
            raise ValueError("upload run does not exist")
        if run["status"] not in {"queued", "running"}:
            return upload_run_status(repo_root, run_id)
        rows = conn.execute(
            """
            SELECT asset_id FROM asset_upload_run_items
            WHERE run_id = ? AND status IN ('queued', 'uploading')
            ORDER BY asset_id
            """,
            (run_id,),
        ).fetchall()
        asset_ids = [str(row["asset_id"]) for row in rows]
        concurrency = int(run["concurrency"] or 1)
        conn.execute(
            "UPDATE asset_upload_runs SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE run_id = ?",
            (started_at, started_at, run_id),
        )
        conn.executemany(
            "UPDATE asset_upload_run_items SET status = 'uploading', started_at = COALESCE(started_at, ?), updated_at = ? WHERE run_id = ? AND asset_id = ?",
            [(started_at, started_at, run_id, asset_id) for asset_id in asset_ids],
        )
        conn.commit()

    def worker(asset_id: str) -> tuple[str, dict[str, Any] | None, str]:
        try:
            result = publish_verified_asset(repo_root, asset_id, upload(asset_id))
            return asset_id, result, ""
        except Exception as error:  # noqa: BLE001 - failures are isolated per asset.
            return asset_id, None, str(error)

    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = {executor.submit(worker, asset_id): asset_id for asset_id in asset_ids}
        for future in as_completed(futures):
            asset_id, result, error_text = future.result()
            timestamp = now_iso()
            with connect(repo_root) as conn:
                if not result:
                    status = "failed"
                elif not result.get("published", True):
                    status = "skipped"
                elif str(result.get("catalogState") or "") == "live":
                    status = "live"
                else:
                    status = "verified"
                conn.execute(
                    """
                    UPDATE asset_upload_run_items
                    SET status = ?, source_version_hash = ?, object_keys_json = ?,
                        error_text = ?, completed_at = ?, updated_at = ?
                    WHERE run_id = ? AND asset_id = ?
                    """,
                    (
                        status,
                        str(result.get("sourceVersionHash") or "") if result else "",
                        _json(result.get("objectKeys") or []) if result else _json([]),
                        error_text,
                        timestamp,
                        timestamp,
                        run_id,
                        asset_id,
                    ),
                )
                if error_text:
                    conn.execute(
                        """
                        UPDATE asset_delivery_state
                        SET delivery_state = 'failed', last_error = ?, updated_at = ?
                        WHERE asset_id = ?
                        """,
                        (error_text, timestamp, asset_id),
                    )
                elif result and not result.get("published", True):
                    conn.execute(
                        """
                        UPDATE asset_delivery_state
                        SET delivery_state = 'not-ready', last_error = ?, updated_at = ?
                        WHERE asset_id = ?
                        """,
                        (str(result.get("reason") or "retired from sales"), timestamp, asset_id),
                    )
                summary = conn.execute(
                    """
                    SELECT count(*) total,
                           sum(CASE WHEN status IN ('verified', 'live', 'failed', 'skipped') THEN 1 ELSE 0 END) processed,
                           sum(CASE WHEN status = 'live' THEN 1 ELSE 0 END) live,
                           sum(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) failed
                    FROM asset_upload_run_items WHERE run_id = ?
                    """,
                    (run_id,),
                ).fetchone()
                processed = int(summary["processed"] or 0)
                total = int(summary["total"] or 0)
                conn.execute(
                    """
                    UPDATE asset_upload_runs
                    SET processed_count = ?, live_count = ?, failed_count = ?,
                        remaining_count = ?, updated_at = ?
                    WHERE run_id = ?
                    """,
                    (
                        processed,
                        int(summary["live"] or 0),
                        int(summary["failed"] or 0),
                        max(0, total - processed),
                        timestamp,
                        run_id,
                    ),
                )
                conn.commit()
            if progress:
                progress(upload_run_status(repo_root, run_id))
    completed_at = now_iso()
    with connect(repo_root) as conn:
        summary = conn.execute(
            "SELECT failed_count FROM asset_upload_runs WHERE run_id = ?",
            (run_id,),
        ).fetchone()
        final_status = "completed-with-errors" if int(summary["failed_count"] or 0) else "completed"
        conn.execute(
            """
            UPDATE asset_upload_runs
            SET status = ?, completed_at = ?, updated_at = ?
            WHERE run_id = ?
            """,
            (final_status, completed_at, completed_at, run_id),
        )
        conn.commit()
    return upload_run_status(repo_root, run_id)


def upload_run_status(repo_root: Path, run_id: str) -> dict[str, Any]:
    with connect(repo_root) as conn:
        row = conn.execute(
            "SELECT * FROM asset_upload_runs WHERE run_id = ?",
            (run_id,),
        ).fetchone()
        if not row:
            raise ValueError("upload run does not exist")
        items = conn.execute(
            """
            SELECT item.asset_id, item.source_version_hash, item.status, item.error_text,
                   item.updated_at,
                   COALESCE(catalog.state, 'not-applicable') AS catalog_state
            FROM asset_upload_run_items AS item
            LEFT JOIN public_catalog_publications AS catalog
              ON catalog.asset_id = item.asset_id
             AND catalog.source_version_hash = item.source_version_hash
            WHERE item.run_id = ? ORDER BY item.asset_id
            """,
            (run_id,),
        ).fetchall()
    return {
        "ok": True,
        "runId": run_id,
        "status": str(row["status"]),
        "requested": int(row["requested_count"] or 0),
        "processed": int(row["processed_count"] or 0),
        "live": int(row["live_count"] or 0),
        "failed": int(row["failed_count"] or 0),
        "remaining": int(row["remaining_count"] or 0),
        "concurrency": int(row["concurrency"] or 1),
        "startedAt": str(row["started_at"] or ""),
        "completedAt": str(row["completed_at"] or ""),
        "items": [dict(item) for item in items],
    }


def record_sale_reference(
    repo_root: Path,
    *,
    order_id: str,
    asset_id: str,
    source_version_hash: str,
    checksum_sha256: str,
    master_key: str,
    derivative_keys: Iterable[str] = (),
) -> dict[str, Any]:
    values = {
        "orderId": str(order_id or "").strip(),
        "assetId": str(asset_id or "").strip(),
        "sourceVersionHash": str(source_version_hash or "").strip(),
        "checksumSha256": str(checksum_sha256 or "").strip(),
        "masterKey": str(master_key or "").strip(),
        "derivativeKeys": _clean(derivative_keys),
    }
    if not all(values[key] for key in ("orderId", "assetId", "sourceVersionHash", "checksumSha256", "masterKey")):
        raise ValueError("sale references require order, asset, source version, checksum, and master key")
    timestamp = now_iso()
    with connect(repo_root) as conn:
        conn.execute(
            """
            INSERT INTO asset_sale_references (
              order_id, asset_id, source_version_hash, checksum_sha256,
              master_key, derivative_keys_json, recorded_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(order_id, asset_id, source_version_hash) DO UPDATE SET
              checksum_sha256 = excluded.checksum_sha256,
              master_key = excluded.master_key,
              derivative_keys_json = excluded.derivative_keys_json
            """,
            (
                values["orderId"],
                values["assetId"],
                values["sourceVersionHash"],
                values["checksumSha256"],
                values["masterKey"],
                _json(values["derivativeKeys"]),
                timestamp,
            ),
        )
        conn.commit()
    return {"ok": True, **values, "recordedAt": timestamp}


def reconcile_r2_objects(
    repo_root: Path,
    *,
    commit: bool = False,
    now: str | None = None,
    delete_object: Callable[[str, str], None] | None = None,
    exceptional_sold_purge: bool = False,
) -> dict[str, Any]:
    """Two-pass quarantine. Sold keys are immutable absent exceptional workflow."""
    timestamp = now or now_iso()
    current_time = _parse_timestamp(timestamp)
    run_id = f"r2rec-{uuid.uuid4().hex[:16]}"
    mode = "exceptional-sold-purge" if exceptional_sold_purge else ("commit" if commit else "plan")
    actions: list[dict[str, Any]] = []
    with connect(repo_root) as conn:
        sale_rows = conn.execute(
            "SELECT master_key, derivative_keys_json FROM asset_sale_references"
        ).fetchall()
        sold_keys: set[str] = set()
        for row in sale_rows:
            sold_keys.add(str(row["master_key"]))
            sold_keys.update(_clean(_read_json(row["derivative_keys_json"], [])))
        live_rows = conn.execute(
            """
            SELECT DISTINCT receipt.object_key
            FROM asset_publications AS publication
            JOIN fixture_delivery_receipts AS receipt
              ON receipt.fixture_id = publication.fixture_id
             AND receipt.asset_id = publication.asset_id
             AND receipt.version_hash = publication.source_version_hash
            WHERE publication.state = 'live'
              AND receipt.destination = 'r2'
              AND receipt.status = 'verified'
              AND COALESCE(receipt.object_key, '') != ''
            """
        ).fetchall()
        live_keys = {str(row["object_key"]) for row in live_rows}
        referenced_keys = live_keys | sold_keys
        objects = conn.execute(
            """
            SELECT bucket, object_key, COALESCE(photo_id, '') photo_id,
                   lifecycle_state
            FROM r2_objects
            WHERE lifecycle_state != 'deleted_confirmed'
            ORDER BY bucket, object_key
            """
        ).fetchall()
        conn.execute(
            """
            INSERT INTO r2_reconciliation_runs (
              run_id, mode, status, created_at, updated_at
            ) VALUES (?, ?, 'running', ?, ?)
            """,
            (run_id, mode, timestamp, timestamp),
        )
        counts = {
            "scanned": len(objects),
            "protected": 0,
            "quarantined": 0,
            "restored": 0,
            "eligibleDelete": 0,
            "deleted": 0,
        }
        for obj in objects:
            bucket = str(obj["bucket"])
            key = str(obj["object_key"])
            sold = key in sold_keys
            referenced = key in referenced_keys
            quarantine = conn.execute(
                "SELECT * FROM r2_quarantine WHERE bucket = ? AND object_key = ?",
                (bucket, key),
            ).fetchone()
            if sold and not exceptional_sold_purge:
                action = "protected"
                counts["protected"] += 1
            elif referenced:
                action = "restored" if quarantine and quarantine["state"] in {"quarantined", "eligible-delete"} else "current"
                if action == "restored":
                    counts["restored"] += 1
            elif not quarantine or quarantine["state"] in {"restored", "protected"}:
                action = "quarantine"
                counts["quarantined"] += 1
            elif quarantine["state"] == "quarantined" and current_time >= _parse_timestamp(str(quarantine["delete_after"])):
                action = "eligible-delete"
                counts["eligibleDelete"] += 1
            else:
                action = "waiting"
            actions.append(
                {
                    "bucket": bucket,
                    "key": key,
                    "assetId": str(obj["photo_id"] or ""),
                    "sold": sold,
                    "referenced": referenced,
                    "action": action,
                }
            )
            if not commit:
                continue
            if action == "protected":
                conn.execute(
                    """
                    INSERT INTO r2_quarantine (
                      bucket, object_key, asset_id, reason, state,
                      first_reconciled_at, delete_after, last_run_id, updated_at
                    ) VALUES (?, ?, ?, 'sold-order-reference', 'protected', ?, ?, ?, ?)
                    ON CONFLICT(bucket, object_key) DO UPDATE SET
                      state = 'protected', reason = 'sold-order-reference',
                      last_run_id = excluded.last_run_id, updated_at = excluded.updated_at
                    """,
                    (
                        bucket,
                        key,
                        str(obj["photo_id"] or ""),
                        timestamp,
                        timestamp,
                        run_id,
                        timestamp,
                    ),
                )
            elif action == "restored":
                conn.execute(
                    """
                    UPDATE r2_quarantine
                    SET state = 'restored', restored_at = ?, last_run_id = ?,
                        updated_at = ?
                    WHERE bucket = ? AND object_key = ?
                    """,
                    (timestamp, run_id, timestamp, bucket, key),
                )
                conn.execute(
                    """
                    UPDATE r2_objects
                    SET lifecycle_state = 'current', marked_for_delete_at = NULL,
                        deleted_confirmed_at = NULL, updated_at = ?
                    WHERE bucket = ? AND object_key = ?
                    """,
                    (timestamp, bucket, key),
                )
            elif action == "quarantine":
                delete_after = (
                    current_time + timedelta(days=QUARANTINE_DAYS)
                ).isoformat().replace("+00:00", "Z")
                conn.execute(
                    """
                    INSERT INTO r2_quarantine (
                      bucket, object_key, asset_id, reason, state,
                      first_reconciled_at, delete_after, last_run_id, updated_at
                    ) VALUES (?, ?, ?, 'unreferenced', 'quarantined', ?, ?, ?, ?)
                    ON CONFLICT(bucket, object_key) DO UPDATE SET
                      state = 'quarantined', reason = 'unreferenced',
                      first_reconciled_at = excluded.first_reconciled_at,
                      second_reconciled_at = NULL,
                      delete_after = excluded.delete_after,
                      restored_at = NULL, deleted_at = NULL,
                      last_run_id = excluded.last_run_id,
                      updated_at = excluded.updated_at
                    """,
                    (
                        bucket,
                        key,
                        str(obj["photo_id"] or ""),
                        timestamp,
                        delete_after,
                        run_id,
                        timestamp,
                    ),
                )
                conn.execute(
                    """
                    UPDATE r2_objects
                    SET lifecycle_state = 'marked_for_delete',
                        marked_for_delete_at = ?, updated_at = ?
                    WHERE bucket = ? AND object_key = ?
                    """,
                    (timestamp, timestamp, bucket, key),
                )
            elif action == "eligible-delete":
                conn.execute(
                    """
                    UPDATE r2_quarantine
                    SET state = 'eligible-delete', second_reconciled_at = ?,
                        last_run_id = ?, updated_at = ?
                    WHERE bucket = ? AND object_key = ?
                    """,
                    (timestamp, run_id, timestamp, bucket, key),
                )
                if delete_object:
                    delete_object(bucket, key)
                    conn.execute(
                        """
                        UPDATE r2_quarantine
                        SET state = 'deleted', deleted_at = ?, updated_at = ?
                        WHERE bucket = ? AND object_key = ?
                        """,
                        (timestamp, timestamp, bucket, key),
                    )
                    conn.execute(
                        """
                        UPDATE r2_objects
                        SET lifecycle_state = 'deleted_confirmed',
                            deleted_confirmed_at = ?, updated_at = ?
                        WHERE bucket = ? AND object_key = ?
                        """,
                        (timestamp, timestamp, bucket, key),
                    )
                    counts["deleted"] += 1
        completed_at = now_iso()
        conn.execute(
            """
            UPDATE r2_reconciliation_runs
            SET status = 'completed', scanned_count = ?, protected_count = ?,
                quarantined_count = ?, restored_count = ?,
                eligible_delete_count = ?, deleted_count = ?,
                completed_at = ?, updated_at = ?
            WHERE run_id = ?
            """,
            (
                counts["scanned"],
                counts["protected"],
                counts["quarantined"],
                counts["restored"],
                counts["eligibleDelete"],
                counts["deleted"],
                completed_at,
                completed_at,
                run_id,
            ),
        )
        conn.commit()
    return {
        "ok": True,
        "mode": mode,
        "runId": run_id,
        "committed": commit,
        **counts,
        "actions": actions,
    }
