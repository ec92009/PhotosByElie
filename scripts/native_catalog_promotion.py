#!/usr/bin/env python3
"""Promote verified native Backstage uploads into the public catalog.

R2 visibility and public-catalog visibility are deliberately separate.  This
module records the second transition, keeps it idempotent, and leaves an
explicit audit row until the deployed catalog has been checked.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import tempfile
import threading
import time
from typing import Any, Callable, Iterable
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fixture_pipeline import connect, now_iso
from fixture_policy import effective_fixture_policy, policy_allows_catalog
from import_source_anchor import photo_id_for_source_path
from owner_catalog_projection import (
    APPROVED_POLICY as OWNER_PROJECTION_POLICY,
    ensure_projection_schema,
    projection_snapshot,
    store_projection,
)


PUBLIC_CATALOG_PATH = Path("assets/catalog/photosbyelie.sqlite")
PRODUCT_PRICING_PATH = Path("assets/catalog/product-pricing.json")
PUBLIC_CATALOG_URL = "https://photos-by-elie.com/assets/catalog/photosbyelie.sqlite"
NOMINATIM_SEARCH_URL = os.environ.get(
    "PBE_NOMINATIM_SEARCH_URL",
    "https://nominatim.openstreetmap.org/search",
)
NOMINATIM_USER_AGENT = os.environ.get(
    "PBE_NOMINATIM_USER_AGENT",
    "PhotosByElie Backstage catalog resolver (https://photos-by-elie.com/)",
)
COLLECTION_COUNTRY_CODES = {
    "fr": "france",
    "it": "italy",
    "mx": "mexico",
    "pt": "portugal",
    "sk": "slovakia",
    "es": "spain",
    "us": "usa",
}
_CATALOG_LOCK = threading.RLock()
_NOMINATIM_LOCK = threading.Lock()
_NOMINATIM_LAST_REQUEST_AT = 0.0
_NOMINATIM_RESULTS_CACHE: dict[str, dict[str, Any]] = {}


class CatalogPromotionError(RuntimeError):
    """Raised when a verified upload cannot be represented in the catalog."""


def retired_storefront_media_types(repo_root: Path) -> set[str]:
    """Return media types that are intentionally excluded from sales."""
    path = repo_root / PRODUCT_PRICING_PATH
    try:
        pricing = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        return set()
    values = (pricing.get("storefrontPolicy") or {}).get("retiredMediaTypes") or []
    return {str(value).strip().casefold() for value in values if str(value).strip()}


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _read_json(value: Any, fallback: Any) -> Any:
    try:
        parsed = json.loads(str(value or ""))
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback
    return parsed


def _scale_to_max(width: int, height: int, maximum: int) -> tuple[int, int]:
    scale = min(maximum / max(width, 1), maximum / max(height, 1), 1)
    return max(1, round(width * scale)), max(1, round(height * scale))


def _scale_to_megapixels(width: int, height: int, target: float) -> tuple[int, int]:
    current = (width * height) / 1_000_000
    scale = min((target / max(current, 0.000001)) ** 0.5, 1)
    return max(1, round(width * scale)), max(1, round(height * scale))


def _catalog_id(conn: sqlite3.Connection, table: str, column: str, where: str, value: str) -> int:
    row = conn.execute(f"SELECT {column} FROM {table} WHERE {where} = ?", (value,)).fetchone()
    if row is None:
        raise CatalogPromotionError(f"missing catalog {table}.{where}={value!r}")
    return int(row[column])


def _ensure_keyword_ids(conn: sqlite3.Connection, keywords: Iterable[Any]) -> str:
    ids: list[str] = []
    for value in keywords:
        keyword = str(value or "").strip()
        if not keyword:
            continue
        row = conn.execute("SELECT keyword_id FROM keyword_terms WHERE keyword = ?", (keyword,)).fetchone()
        if row is None:
            keyword_id = int(conn.execute("SELECT COALESCE(MAX(keyword_id), 0) + 1 FROM keyword_terms").fetchone()[0])
            conn.execute("INSERT INTO keyword_terms(keyword_id, keyword) VALUES (?, ?)", (keyword_id, keyword))
        else:
            keyword_id = int(row["keyword_id"])
        ids.append(str(keyword_id))
    return ",".join(ids)


def _ensure_source_file(conn: sqlite3.Connection, filename: str, extension: str) -> int:
    folder = "Apple Photos Sidecar Uploads"
    folder_row = conn.execute("SELECT source_folder_id FROM source_folders WHERE source_folder = ?", (folder,)).fetchone()
    if folder_row is None:
        folder_id = int(conn.execute("SELECT COALESCE(MAX(source_folder_id), 0) + 1 FROM source_folders").fetchone()[0])
        conn.execute("INSERT INTO source_folders(source_folder_id, source_folder) VALUES (?, ?)", (folder_id, folder))
    else:
        folder_id = int(folder_row["source_folder_id"])
    format_row = conn.execute("SELECT format_id FROM formats WHERE extension = ?", (extension,)).fetchone()
    if format_row is None:
        raise CatalogPromotionError(f"unsupported source extension {extension!r}")
    file_row = conn.execute(
        "SELECT source_file_id FROM source_files WHERE source_folder_id = ? AND filename = ?",
        (folder_id, filename or "native-upload"),
    ).fetchone()
    if file_row is not None:
        return int(file_row["source_file_id"])
    source_file_id = int(conn.execute("SELECT COALESCE(MAX(source_file_id), 0) + 1 FROM source_files").fetchone()[0])
    conn.execute(
        "INSERT INTO source_files(source_file_id, source_folder_id, filename, format_id) VALUES (?, ?, ?, ?)",
        (source_file_id, folder_id, filename or "native-upload", int(format_row["format_id"])),
    )
    return source_file_id


def _extension(value: Any, fallback: str = "jpg") -> str:
    suffix = Path(str(value or "")).suffix.lower().lstrip(".")
    if suffix in {"jpeg", "jpe"}:
        return "jpg"
    if suffix == "tiff":
        return "tif"
    if suffix == "m4v":
        return "mp4"
    return suffix if suffix in {"jpg", "tif", "png", "heic", "mp4", "mov"} else fallback


def _metadata_search_text(row: sqlite3.Row) -> str:
    text = " ".join(
        str(row[key] or "")
        for key in ("location_label", "location_keywords_json", "keywords_json", "title", "filename")
    ).casefold()
    return text


def _static_collection_resolution(row: sqlite3.Row) -> dict[str, Any]:
    """Resolve well-known collection aliases from the approved asset metadata."""
    explicit_country = str(
        row["approved_country_slug"] if "approved_country_slug" in row.keys() else ""
    ).strip().casefold()
    if explicit_country in set(COLLECTION_COUNTRY_CODES.values()):
        return {
            "collection": explicit_country,
            "city": "",
            "countryCode": next(
                code for code, slug in COLLECTION_COUNTRY_CODES.items() if slug == explicit_country
            ),
            "provider": "owner-country-assignment",
            "query": explicit_country,
            "confidence": 1.0,
            "response": {},
        }
    text = _metadata_search_text(row)
    terms = {
        "italy": ("italy", "florence", "tuscany"),
        "france": ("france", "paris", "versailles", "rueil", "malmaison"),
        "spain": (
            "spain", "barcelona", "malaga", "málaga", "andalusia", "andalucía",
            "benalmadena", "fuengirola", "nerja", "ronda", "mijas", "marbella",
            "bilbao", "cordoba", "córdoba", "granada", "valencia", "valència", "seville", "sevilla",
        ),
        "portugal": ("portugal", "lisbon", "lisboa"),
        "usa": ("usa", "united states", "san diego"),
        "mexico": ("mexico",),
        "slovakia": ("slovakia",),
    }
    for slug, values in terms.items():
        match = next((value for value in values if value in text), "")
        if match:
            return {
                "collection": slug,
                "city": match,
                "countryCode": next(
                    (code for code, candidate in COLLECTION_COUNTRY_CODES.items() if candidate == slug),
                    "",
                ),
                "provider": "static-alias",
                "query": match,
                "confidence": 1.0,
                "response": {},
            }
    return {
        "collection": "unknown",
        "city": "",
        "countryCode": "",
        "provider": "static-alias",
        "query": "",
        "confidence": 0.0,
        "response": {"reason": "no static collection alias matched"},
    }


def _gallery_slug(row: sqlite3.Row) -> str:
    """Return the collection selected by the local alias map, if any."""
    return str(_static_collection_resolution(row).get("collection") or "unknown")


def _resolution_queries(row: sqlite3.Row) -> list[str]:
    """Build bounded geocoder queries from approved metadata, in priority order."""
    values: list[Any] = [row["location_label"]]
    location_keywords = _read_json(row["location_keywords_json"], [])
    keywords = _read_json(row["keywords_json"], [])
    if isinstance(location_keywords, list):
        values.extend(location_keywords)
    values.append(row["title"])
    if isinstance(keywords, list):
        values.extend(keywords)
    queries: list[str] = []
    seen: set[str] = set()
    for value in values:
        query = re.sub(r"\s+", " ", str(value or "").strip())[:160]
        key = query.casefold()
        if len(query) < 2 or key in seen:
            continue
        seen.add(key)
        queries.append(query)
    return queries[:8]


def _compact_nominatim_results(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep only stable, non-sensitive geocoder evidence in the Owner audit."""
    compact: list[dict[str, Any]] = []
    for result in results[:5]:
        address = result.get("address") if isinstance(result.get("address"), dict) else {}
        compact.append({
            "displayName": str(result.get("display_name") or "")[:320],
            "city": str(
                address.get("city")
                or address.get("town")
                or address.get("village")
                or address.get("municipality")
                or ""
            )[:120],
            "countryCode": str(address.get("country_code") or "").casefold(),
            "importance": result.get("importance"),
            "placeRank": result.get("place_rank"),
        })
    return compact


def _resolution_from_nominatim(query: str, payload: Any) -> dict[str, Any]:
    """Turn Nominatim results into a conservative supported collection result."""
    results = payload if isinstance(payload, list) else []
    valid: list[tuple[str, dict[str, Any]]] = []
    for result in results[:5]:
        if not isinstance(result, dict):
            continue
        address = result.get("address") if isinstance(result.get("address"), dict) else {}
        collection = COLLECTION_COUNTRY_CODES.get(str(address.get("country_code") or "").casefold())
        if collection:
            valid.append((collection, result))
    collections = sorted({collection for collection, _result in valid})
    response = {"results": _compact_nominatim_results([result for _collection, result in valid])}
    if not valid:
        response["reason"] = "no supported country result"
        return {
            "collection": "unknown",
            "city": "",
            "countryCode": "",
            "provider": "nominatim",
            "query": query,
            "confidence": 0.0,
            "response": response,
        }
    if len(collections) != 1:
        response["reason"] = f"ambiguous supported countries: {', '.join(collections)}"
        return {
            "collection": "unknown",
            "city": "",
            "countryCode": "",
            "provider": "nominatim",
            "query": query,
            "confidence": 0.0,
            "response": response,
        }
    collection, top = valid[0]
    address = top.get("address") if isinstance(top.get("address"), dict) else {}
    return {
        "collection": collection,
        "city": str(
            address.get("city")
            or address.get("town")
            or address.get("village")
            or address.get("municipality")
            or ""
        ).strip(),
        "countryCode": next(
            (code for code, candidate in COLLECTION_COUNTRY_CODES.items() if candidate == collection),
            "",
        ),
        "provider": "nominatim",
        "query": query,
        "confidence": 0.9 if len(valid) > 1 else 0.8,
        "response": response,
    }


def nominatim_collection_lookup(query: str) -> dict[str, Any]:
    """Resolve one approved metadata clue through the rate-limited Nominatim API."""
    global _NOMINATIM_LAST_REQUEST_AT
    clean_query = re.sub(r"\s+", " ", str(query or "").strip())[:160]
    if not clean_query:
        return {
            "collection": "unknown",
            "provider": "nominatim",
            "query": "",
            "confidence": 0.0,
            "response": {"reason": "empty query"},
        }
    cache_key = clean_query.casefold()
    with _NOMINATIM_LOCK:
        cached = _NOMINATIM_RESULTS_CACHE.get(cache_key)
        if cached is not None:
            return dict(cached)
        wait_for = max(0.0, 1.0 - (time.monotonic() - _NOMINATIM_LAST_REQUEST_AT))
        if wait_for:
            time.sleep(wait_for)
        request_params = urlencode({
            'q': clean_query,
            'format': 'jsonv2',
            'addressdetails': '1',
            'limit': '5',
        })
        request_url = f"{NOMINATIM_SEARCH_URL}?{request_params}"
        request = Request(request_url, headers={"User-Agent": NOMINATIM_USER_AGENT})
        _NOMINATIM_LAST_REQUEST_AT = time.monotonic()
        try:
            with urlopen(request, timeout=15) as response:
                payload = json.loads(response.read().decode("utf-8"))
            result = _resolution_from_nominatim(clean_query, payload)
        except Exception as error:  # noqa: BLE001 - an unresolved location remains retryable.
            result = {
                "collection": "unknown",
                "city": "",
                "countryCode": "",
                "provider": "nominatim",
                "query": clean_query,
                "confidence": 0.0,
                "response": {"reason": "lookup failed", "error": str(error)[:320]},
            }
        _NOMINATIM_RESULTS_CACHE[cache_key] = dict(result)
        return result


def _record_collection_resolution(
    conn: sqlite3.Connection,
    *,
    asset_id: str,
    source_version_hash: str,
    resolution: dict[str, Any],
) -> None:
    """Persist the collection decision and its provider evidence in Owner.sqlite."""
    conn.execute(
        """
        INSERT INTO catalog_collection_resolutions (
          asset_id, source_version_hash, collection_slug, city, country_code,
          provider, query_text, confidence, response_json, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(asset_id, source_version_hash) DO UPDATE SET
          collection_slug = excluded.collection_slug,
          city = excluded.city,
          country_code = excluded.country_code,
          provider = excluded.provider,
          query_text = excluded.query_text,
          confidence = excluded.confidence,
          response_json = excluded.response_json,
          resolved_at = excluded.resolved_at
        """,
        (
            asset_id,
            source_version_hash,
            str(resolution.get("collection") or "unknown"),
            str(resolution.get("city") or ""),
            str(resolution.get("countryCode") or ""),
            str(resolution.get("provider") or "unknown"),
            str(resolution.get("query") or ""),
            float(resolution.get("confidence") or 0),
            _json(resolution.get("response") or {}),
            now_iso(),
        ),
    )


def _cached_collection_resolution(
    conn: sqlite3.Connection,
    *,
    asset_id: str,
    source_version_hash: str,
) -> dict[str, Any] | None:
    row = conn.execute(
        """
        SELECT collection_slug, city, country_code, provider, query_text,
               confidence, response_json, resolved_at
        FROM catalog_collection_resolutions
        WHERE asset_id = ? AND source_version_hash = ?
        """,
        (asset_id, source_version_hash),
    ).fetchone()
    if row is None:
        return None
    return {
        "collection": str(row["collection_slug"] or "unknown"),
        "city": str(row["city"] or ""),
        "countryCode": str(row["country_code"] or ""),
        "provider": str(row["provider"] or "unknown"),
        "query": str(row["query_text"] or ""),
        "confidence": float(row["confidence"] or 0),
        "response": _read_json(row["response_json"], {}),
        "resolvedAt": str(row["resolved_at"] or ""),
    }


def _resolve_collection(
    conn: sqlite3.Connection,
    row: sqlite3.Row,
    *,
    source_version_hash: str,
    collection_resolver: Callable[[str], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Resolve approved metadata locally first, then through the configured geocoder."""
    static = _static_collection_resolution(row)
    asset_id = str(row["asset_id"] or "")
    if static["collection"] != "unknown":
        _record_collection_resolution(
            conn,
            asset_id=asset_id,
            source_version_hash=source_version_hash,
            resolution=static,
        )
        return static
    cached = _cached_collection_resolution(
        conn,
        asset_id=asset_id,
        source_version_hash=source_version_hash,
    )
    if cached and cached["collection"] != "unknown":
        return cached
    resolver = collection_resolver or nominatim_collection_lookup
    attempts: list[dict[str, Any]] = []
    for query in _resolution_queries(row):
        try:
            raw = resolver(query)
            resolution = dict(raw) if isinstance(raw, dict) else {}
        except Exception as error:  # noqa: BLE001 - retain an auditable retryable failure.
            resolution = {
                "collection": "unknown",
                "provider": getattr(resolver, "__name__", "resolver"),
                "query": query,
                "confidence": 0.0,
                "response": {"reason": "resolver raised", "error": str(error)[:320]},
            }
        collection = str(resolution.get("collection") or "unknown").casefold()
        if collection not in set(COLLECTION_COUNTRY_CODES.values()) | {"unknown"}:
            collection = "unknown"
        resolution["collection"] = collection
        resolution["query"] = str(resolution.get("query") or query)
        resolution.setdefault("provider", getattr(resolver, "__name__", "resolver"))
        resolution.setdefault("confidence", 0.0)
        resolution.setdefault("response", {})
        attempts.append({
            "query": query,
            "collection": collection,
            "provider": resolution["provider"],
            "confidence": resolution["confidence"],
        })
        if collection != "unknown":
            resolution["response"] = {
                "attempts": attempts,
                "providerResponse": resolution.get("response") or {},
            }
            _record_collection_resolution(
                conn,
                asset_id=asset_id,
                source_version_hash=source_version_hash,
                resolution=resolution,
            )
            return resolution
    unresolved = {
        "collection": "unknown",
        "city": "",
        "countryCode": "",
        "provider": getattr(resolver, "__name__", "resolver"),
        "query": attempts[-1]["query"] if attempts else "",
        "confidence": 0.0,
        "response": {"attempts": attempts, "reason": "no confident supported country result"},
    }
    _record_collection_resolution(
        conn,
        asset_id=asset_id,
        source_version_hash=source_version_hash,
        resolution=unresolved,
    )
    return unresolved


def _media_id_from_key(key: str) -> str:
    filename = Path(key).name
    match = re.match(r"^(.+?)(?:_900|_1800)\.jpg$", filename, re.IGNORECASE)
    if match:
        return match.group(1)
    match = re.match(r"^(.+?)_short_5s_720p\.mp4$", filename, re.IGNORECASE)
    return match.group(1) if match else ""


def _object_set(results: Iterable[dict[str, Any]], media_type: str) -> dict[str, dict[str, Any]]:
    objects: dict[str, dict[str, Any]] = {}
    media_ids: set[str] = set()
    for raw in results:
        item = dict(raw)
        key = str(item.get("key") or "")
        if not key or str(item.get("status") or "") != "uploaded":
            continue
        kind = str(item.get("kind") or item.get("objectKind") or "")
        if kind == "private-master" or key.startswith("masters/"):
            name = "private"
        elif key.endswith("_900.jpg"):
            name = "gallery"
        elif key.endswith("_1800.jpg"):
            name = "detail"
        elif key.endswith("_short_5s_720p.mp4"):
            name = "short"
        else:
            continue
        media_id = _media_id_from_key(key)
        if media_id:
            media_ids.add(media_id)
        objects[name] = item
    required = {"private", "gallery", "short"} if media_type == "video" else {"private", "gallery", "detail"}
    missing = sorted(required - set(objects))
    if missing:
        raise CatalogPromotionError(f"public catalog promotion is missing verified objects: {', '.join(missing)}")
    if len(media_ids) != 1:
        raise CatalogPromotionError("verified public objects do not share one media id")
    objects["mediaId"] = {"value": next(iter(media_ids))}
    return objects


def _asset_row(conn: sqlite3.Connection, asset_id: str) -> sqlite3.Row | None:
    country_columns = {
        str(row[1]) for row in conn.execute("PRAGMA table_info(country_assignments)").fetchall()
    }
    country_select = (
        "(SELECT country_slug FROM country_assignments WHERE asset_id = a.asset_id "
        "ORDER BY updated_at DESC, media_id LIMIT 1)"
        if "asset_id" in country_columns
        else "NULL"
    )
    return conn.execute(
        f"""
        SELECT a.*, d.title, d.caption, d.keywords_json, e.editorial_state,
               {country_select} AS approved_country_slug
        FROM sidecar_assets AS a
        LEFT JOIN sidecar_decisions AS d ON d.asset_id = a.asset_id
        LEFT JOIN asset_editorial_state AS e ON e.asset_id = a.asset_id
        WHERE a.asset_id = ?
        """,
        (asset_id,),
    ).fetchone()


def catalog_candidate(
    repo_root: Path,
    conn: sqlite3.Connection,
    asset_id: str,
    upload_results: Iterable[dict[str, Any]],
    *,
    source_version_hash: str = "",
    collection_resolver: Callable[[str], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Validate owner policy and verified derivatives before touching SQLite."""
    row = _asset_row(conn, asset_id)
    if row is None:
        return {"eligible": False, "reason": "asset_not_indexed"}
    if str(row["editorial_state"] or "") != "approved":
        return {"eligible": False, "reason": "asset_not_approved"}
    if row["missing_at"]:
        return {"eligible": False, "reason": "source_missing"}
    if conn.execute(
        "SELECT 1 FROM sidecar_tombstones WHERE asset_id = ? AND tombstone_state = 'active'",
        (asset_id,),
    ).fetchone():
        return {"eligible": False, "reason": "tombstoned"}
    fixture_rows = conn.execute(
        """
        SELECT d.fixture_id FROM fixture_asset_decisions AS d
        JOIN fixtures AS f ON f.fixture_id = d.fixture_id
        WHERE d.asset_id = ? AND d.eligibility_state = 'active'
          AND d.placement_state = 'picked' AND f.archived_at IS NULL
        ORDER BY d.fixture_id
        """,
        (asset_id,),
    ).fetchall()
    public_fixture_ids = [
        str(item["fixture_id"])
        for item in fixture_rows
        if policy_allows_catalog(effective_fixture_policy(repo_root, str(item["fixture_id"]), conn=conn)["effective"])
    ]
    if not public_fixture_ids:
        return {"eligible": False, "reason": "no_public_catalog_fixture"}
    media_type = str(row["media_type"] or "photo").casefold()
    if media_type not in {"photo", "video"}:
        return {"eligible": False, "reason": "unsupported_media_type"}
    if media_type in retired_storefront_media_types(repo_root):
        return {"eligible": False, "reason": "retired_media_type"}
    try:
        objects = _object_set(upload_results, media_type)
    except CatalogPromotionError as error:
        return {"eligible": False, "reason": "missing_verified_derivatives", "error": str(error)}
    resolution = _resolve_collection(
        conn,
        row,
        source_version_hash=source_version_hash,
        collection_resolver=collection_resolver,
    )
    return {
        "eligible": True,
        "asset": row,
        "mediaType": media_type,
        "mediaId": str(objects["mediaId"]["value"]),
        "objects": objects,
        "fixtureIds": public_fixture_ids,
        "collection": str(resolution.get("collection") or "unknown"),
        "collectionResolution": resolution,
    }


def record_catalog_pending(
    conn: sqlite3.Connection,
    *,
    asset_id: str,
    source_version_hash: str,
    media_id: str,
    timestamp: str,
) -> None:
    """Record the R2-to-catalog handoff before the catalog file is written."""
    conn.execute(
        """
        INSERT INTO public_catalog_publications (
          asset_id, source_version_hash, media_id, state, public_url,
          catalog_sha256, error_text, created_at, verified_at, updated_at
        ) VALUES (?, ?, ?, 'pending', ?, '', '', ?, NULL, ?)
        ON CONFLICT(asset_id, source_version_hash) DO UPDATE SET
          media_id = excluded.media_id, state = 'pending', error_text = '',
          updated_at = excluded.updated_at
        """,
        (asset_id, source_version_hash, media_id, PUBLIC_CATALOG_URL, timestamp, timestamp),
    )


def _update_catalog_audit(
    repo_root: Path,
    *,
    asset_id: str,
    source_version_hash: str,
    media_id: str,
    state: str,
    error_text: str = "",
    catalog_sha256: str = "",
    verified_at: str | None = None,
) -> None:
    timestamp = now_iso()
    with connect(repo_root) as conn:
        conn.execute(
            """
            INSERT INTO public_catalog_publications (
              asset_id, source_version_hash, media_id, state, public_url,
              catalog_sha256, error_text, created_at, verified_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(asset_id, source_version_hash) DO UPDATE SET
              media_id = excluded.media_id, state = excluded.state,
              public_url = excluded.public_url,
              catalog_sha256 = CASE
                WHEN excluded.catalog_sha256 <> '' THEN excluded.catalog_sha256
                ELSE public_catalog_publications.catalog_sha256
              END,
              error_text = excluded.error_text, verified_at = excluded.verified_at,
              updated_at = excluded.updated_at
            """,
            (
                asset_id,
                source_version_hash,
                media_id,
                state,
                PUBLIC_CATALOG_URL,
                catalog_sha256,
                error_text,
                timestamp,
                verified_at,
                timestamp,
            ),
        )
        if state == "live":
            conn.execute(
                """
                UPDATE asset_upload_run_items
                SET status = 'live', error_text = '', updated_at = ?
                WHERE asset_id = ? AND source_version_hash = ?
                  AND status = 'verified'
                """,
                (timestamp, asset_id, source_version_hash),
            )
        run_ids = [
            str(row["run_id"])
            for row in conn.execute(
                """
                SELECT DISTINCT run_id
                FROM asset_upload_run_items
                WHERE asset_id = ? AND source_version_hash = ?
                """,
                (asset_id, source_version_hash),
            ).fetchall()
        ]
        for run_id in run_ids:
            summary = conn.execute(
                """
                SELECT count(*) AS total,
                       sum(CASE WHEN status IN ('verified', 'live', 'failed', 'skipped') THEN 1 ELSE 0 END) AS processed,
                       sum(CASE WHEN status = 'live' THEN 1 ELSE 0 END) AS live,
                       sum(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
                FROM asset_upload_run_items
                WHERE run_id = ?
                """,
                (run_id,),
            ).fetchone()
            total = int(summary["total"] or 0)
            processed = int(summary["processed"] or 0)
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


def _catalog_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def refresh_public_catalog_artifacts(repo_root: Path) -> dict[str, Any]:
    """Refresh browser/home/sidecar/Worker projections after SQLite promotion."""
    commands = [
        ["node", "scripts/write_catalog_tsv.cjs", "--bootstrap-only"],
        ["node", "scripts/write_media_sidecar.mjs"],
        ["node", "scripts/write_worker_catalog.mjs"],
    ]
    steps: list[dict[str, Any]] = []
    for command in commands:
        completed = subprocess.run(
            command,
            cwd=repo_root,
            text=True,
            capture_output=True,
            check=False,
        )
        steps.append({
            "command": " ".join(command),
            "returnCode": completed.returncode,
            "stdout": (completed.stdout or "").strip(),
            "stderr": (completed.stderr or "").strip(),
        })
        if completed.returncode != 0:
            return {"ok": False, "steps": steps}
    return {"ok": True, "steps": steps}


def _write_catalog(repo_root: Path, candidate: dict[str, Any]) -> dict[str, Any]:
    path = repo_root / PUBLIC_CATALOG_PATH
    row = candidate["asset"]
    objects = candidate["objects"]
    media_id = candidate["mediaId"]
    media_type = candidate["mediaType"]
    width, height = int(row["pixel_width"] or 0), int(row["pixel_height"] or 0)
    duration = float(row["duration"] or 0) if media_type == "video" else None
    if width <= 0 or height <= 0 or (media_type == "video" and (duration is None or duration <= 0)):
        raise CatalogPromotionError("asset is missing catalog dimensions or video duration")
    now = now_iso()
    with _CATALOG_LOCK:
        owner = connect(repo_root)
        ensure_projection_schema(owner)
        owner.commit()
        authoritative = projection_snapshot(owner, ensure_schema=False)
        if authoritative is None:
            owner.close()
            raise CatalogPromotionError(
                "Owner public catalog projection is not initialized; import the reviewed projection under PBE-173"
            )
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, staged_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        staged_path = Path(staged_name)
        with os.fdopen(descriptor, "wb") as staged:
            staged.write(authoritative["payload"])
            staged.flush()
            os.fsync(staged.fileno())
        catalog = sqlite3.connect(staged_path, timeout=30)
        catalog.row_factory = sqlite3.Row
        catalog.execute("PRAGMA foreign_keys = ON")
        try:
            catalog.execute("BEGIN IMMEDIATE")
            if str(candidate.get("collection") or "unknown") == "unknown":
                resolution = candidate.get("collectionResolution") or {}
                reason = str(
                    (resolution.get("response") or {}).get("reason")
                    or "no confident supported country result"
                )
                raise CatalogPromotionError(
                    "collection unresolved after approved metadata: " + reason
                )
            collection = catalog.execute(
                "SELECT collection_id, title FROM collections WHERE slug = ?",
                (candidate["collection"],),
            ).fetchone()
            if collection is None:
                raise CatalogPromotionError(f"catalog collection is missing: {candidate['collection']}")
            media_type_id = _catalog_id(catalog, "media_types", "media_type_id", "code", media_type)
            camera_origin_id = _catalog_id(catalog, "source_origins", "source_origin_id", "code", "camera")
            asset_type_id = {code: _catalog_id(catalog, "asset_types", "asset_type_id", "code", code) for code in ("full", "still_900", "still_1800", "short_5s_720p", "jpeg_1mp", "jpeg_3mp", "jpeg_6mp")}
            formats = {code: _catalog_id(catalog, "formats", "format_id", "extension", code) for code in ("jpg", "mp4", "mov", "tif", "png", "heic")}
            private_key = str(objects["private"].get("key") or "")
            full_extension = _extension(private_key, _extension(row["filename"]))
            full_format = formats.get(full_extension, formats["jpg"])
            source_file_id = _ensure_source_file(catalog, str(row["filename"] or "native-upload"), full_extension)
            keywords = _read_json(row["keywords_json"], [])
            if not isinstance(keywords, list):
                keywords = []
            keyword_ids = _ensure_keyword_ids(catalog, keywords)
            title = str(row["title"] or row["photos_title"] or Path(str(row["filename"] or media_id)).stem or media_id).strip() or media_id
            location = str(row["location_label"] or collection["title"] or candidate["collection"]).strip()
            existing = catalog.execute("SELECT sort_index FROM media_items WHERE media_id = ?", (media_id,)).fetchone()
            sort_index = int(existing["sort_index"]) if existing else int(catalog.execute("SELECT COALESCE(MAX(sort_index), -1) + 1 FROM media_items WHERE collection_id = ?", (collection["collection_id"],)).fetchone()[0])
            catalog.execute(
                """
                INSERT INTO media_items (
                  media_id, collection_id, sort_index, media_type_id, camera_id, lens_id, title,
                  description, keyword_ids, source_origin_id, captured_at, exposure, focal_length,
                  source_file_id, location, gps_latitude, gps_longitude, created_at, updated_at, caption_color
                ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, ?, ?, NULL)
                ON CONFLICT(media_id) DO UPDATE SET
                  collection_id = excluded.collection_id, sort_index = excluded.sort_index,
                  media_type_id = excluded.media_type_id, title = excluded.title,
                  description = excluded.description, keyword_ids = excluded.keyword_ids,
                  source_origin_id = excluded.source_origin_id, captured_at = excluded.captured_at,
                  source_file_id = excluded.source_file_id, location = excluded.location,
                  updated_at = excluded.updated_at
                """,
                (media_id, collection["collection_id"], sort_index, media_type_id, title, str(row["caption"] or "") or None, keyword_ids or None, camera_origin_id, str(row["captured_at"] or "") or None, source_file_id, location, now, now),
            )
            gallery_dims = _scale_to_max(width, height, 900)
            detail_dims = _scale_to_max(width, height, 1800)
            rows = [
                (media_id, asset_type_id["full"], width, height, duration, int(objects["private"].get("bytes") or 0), full_format),
                (media_id, asset_type_id["still_900"], *gallery_dims, None, int(objects["gallery"].get("bytes") or 0), formats["jpg"]),
            ]
            if media_type == "photo":
                rows.extend([
                    (media_id, asset_type_id["still_1800"], *detail_dims, None, int(objects["detail"].get("bytes") or 0), formats["jpg"]),
                    (media_id, asset_type_id["jpeg_1mp"], *_scale_to_megapixels(width, height, 1), None, None, formats["jpg"]),
                    (media_id, asset_type_id["jpeg_3mp"], *_scale_to_megapixels(width, height, 3), None, None, formats["jpg"]),
                    (media_id, asset_type_id["jpeg_6mp"], *_scale_to_megapixels(width, height, 6), None, None, formats["jpg"]),
                ])
            else:
                rows.append((media_id, asset_type_id["short_5s_720p"], *_scale_to_max(width, height, 720), 5.0, int(objects["short"].get("bytes") or 0), formats["mp4"]))
            catalog.executemany(
                """
                INSERT INTO media_assets(media_id, asset_type_id, width, height, duration_seconds, bytes, format_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(media_id, asset_type_id) DO UPDATE SET
                  width = excluded.width, height = excluded.height,
                  duration_seconds = excluded.duration_seconds, bytes = excluded.bytes,
                  format_id = excluded.format_id
                """,
                rows,
            )
            integrity = catalog.execute("PRAGMA integrity_check").fetchone()[0]
            if integrity != "ok":
                raise CatalogPromotionError(f"catalog integrity_check failed: {integrity}")
            foreign_keys = catalog.execute("PRAGMA foreign_key_check").fetchall()
            if foreign_keys:
                raise CatalogPromotionError(f"catalog foreign_key_check failed: {foreign_keys[:5]}")
            catalog.commit()
            catalog.close()
            payload = staged_path.read_bytes()
            owner.execute("BEGIN IMMEDIATE")
            projection = store_projection(
                owner,
                payload,
                source_kind="native-approved-publication",
                approved_policy=OWNER_PROJECTION_POLICY,
                expected_sha256=authoritative["sha256"],
                ensure_schema=False,
            )
            owner.commit()
            descriptor, projected_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
            projected_path = Path(projected_name)
            try:
                with os.fdopen(descriptor, "wb") as projected:
                    projected.write(payload)
                    projected.flush()
                    os.fsync(projected.fileno())
                os.replace(projected_path, path)
            except Exception:
                projected_path.unlink(missing_ok=True)
                raise
            return {
                "mediaId": media_id,
                "registered": existing is None,
                "catalogPath": str(path),
                "projectionRevision": projection["revision"],
                "projectionSha256": projection["sha256"],
            }
        except Exception:
            if catalog.in_transaction:
                catalog.rollback()
            if owner.in_transaction:
                owner.rollback()
            raise
        finally:
            try:
                catalog.close()
            except sqlite3.Error:
                pass
            owner.close()
            staged_path.unlink(missing_ok=True)


def promote_verified_asset(
    repo_root: Path,
    asset_id: str,
    source_version_hash: str,
    upload_results: Iterable[dict[str, Any]],
    *,
    collection_resolver: Callable[[str], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Write one verified asset to the local catalog and audit the handoff."""
    results = [dict(item) for item in upload_results]
    with connect(repo_root) as conn:
        candidate = catalog_candidate(
            repo_root,
            conn,
            asset_id,
            results,
            source_version_hash=source_version_hash,
            collection_resolver=collection_resolver,
        )
    if not candidate.get("eligible"):
        return {"state": "not-applicable", "reason": candidate.get("reason", "not-eligible"), "error": candidate.get("error", "")}
    media_id = str(candidate["mediaId"])
    try:
        registration = _write_catalog(repo_root, candidate)
        checksum = _catalog_sha256(repo_root / PUBLIC_CATALOG_PATH)
        _update_catalog_audit(
            repo_root,
            asset_id=asset_id,
            source_version_hash=source_version_hash,
            media_id=media_id,
            state="local",
            catalog_sha256=checksum,
            verified_at=now_iso(),
        )
        with connect(repo_root) as conn:
            conn.execute(
                """
                UPDATE asset_delivery_state
                SET delivery_state = 'live', source_version_hash = ?,
                    last_error = '', updated_at = ?
                WHERE asset_id = ?
                """,
                (source_version_hash, now_iso(), asset_id),
            )
            conn.commit()
        return {
            "state": "local",
            "mediaId": media_id,
            "fixtureIds": candidate["fixtureIds"],
            "collection": candidate["collection"],
            "collectionResolution": candidate.get("collectionResolution") or {},
            **registration,
            "catalogSha256": checksum,
        }
    except Exception as error:
        _update_catalog_audit(
            repo_root,
            asset_id=asset_id,
            source_version_hash=source_version_hash,
            media_id=media_id,
            state="failed",
            error_text=str(error),
        )
        raise


def verify_public_catalog(
    repo_root: Path,
    asset_id: str,
    source_version_hash: str,
    *,
    fetch: Callable[[str], tuple[int, bytes, str]] | None = None,
) -> dict[str, Any]:
    """Verify that the deployed catalog contains the audited media id."""
    with connect(repo_root) as conn:
        audit = conn.execute(
            "SELECT media_id, public_url FROM public_catalog_publications WHERE asset_id = ? AND source_version_hash = ?",
            (asset_id, source_version_hash),
        ).fetchone()
    if audit is None:
        raise CatalogPromotionError("no local public-catalog audit exists for this source version")
    media_id = str(audit["media_id"] or "")
    url = str(audit["public_url"] or PUBLIC_CATALOG_URL)
    try:
        if fetch:
            status, payload, etag = fetch(url)
        else:
            response = urlopen(Request(url, headers={"User-Agent": "PhotosByElie catalog verifier"}), timeout=20)
            status, payload, etag = int(response.status), response.read(), str(response.headers.get("ETag") or "")
        if status != 200:
            raise CatalogPromotionError(f"public catalog returned HTTP {status}")
        with tempfile.NamedTemporaryFile(prefix="pbe-public-catalog-", suffix=".sqlite") as handle:
            handle.write(payload)
            handle.flush()
            remote = sqlite3.connect(handle.name)
            found = remote.execute("SELECT 1 FROM media_items WHERE media_id = ?", (media_id,)).fetchone()
            integrity = remote.execute("PRAGMA integrity_check").fetchone()[0]
            remote.close()
        if not found:
            raise CatalogPromotionError(f"deployed catalog does not contain media id {media_id}")
        if integrity != "ok":
            raise CatalogPromotionError(f"deployed catalog integrity_check failed: {integrity}")
        digest = hashlib.sha256(payload).hexdigest()
        _update_catalog_audit(repo_root, asset_id=asset_id, source_version_hash=source_version_hash, media_id=media_id, state="live", catalog_sha256=digest, verified_at=now_iso())
        return {"state": "live", "mediaId": media_id, "status": status, "etag": etag, "catalogSha256": digest}
    except Exception as error:
        _update_catalog_audit(repo_root, asset_id=asset_id, source_version_hash=source_version_hash, media_id=media_id, state="failed", error_text=str(error))
        raise


def reconcile_upload_run_catalog_states(repo_root: Path, run_id: str) -> dict[str, Any]:
    """Make upload-run status reflect the independently verified catalog audit."""
    timestamp = now_iso()
    with connect(repo_root) as conn:
        exists = conn.execute(
            "SELECT 1 FROM asset_upload_runs WHERE run_id = ?",
            (run_id,),
        ).fetchone()
        if exists is None:
            raise CatalogPromotionError("upload run does not exist")
        conn.execute(
            """
            UPDATE asset_upload_run_items
            SET status = CASE (
                    SELECT catalog.state
                    FROM public_catalog_publications AS catalog
                    WHERE catalog.asset_id = asset_upload_run_items.asset_id
                      AND catalog.source_version_hash = asset_upload_run_items.source_version_hash
                )
                WHEN 'live' THEN 'live'
                ELSE 'verified'
                END,
                error_text = '',
                updated_at = ?
            WHERE run_id = ?
              AND status NOT IN ('failed', 'skipped')
              AND EXISTS (
                SELECT 1
                FROM public_catalog_publications AS catalog
                WHERE catalog.asset_id = asset_upload_run_items.asset_id
                  AND catalog.source_version_hash = asset_upload_run_items.source_version_hash
              )
            """,
            (timestamp, run_id),
        )
        summary = conn.execute(
            """
            SELECT count(*) AS total,
                   sum(CASE WHEN item.status IN ('verified', 'live', 'failed', 'skipped') THEN 1 ELSE 0 END) AS processed,
                   sum(CASE WHEN item.status = 'live' THEN 1 ELSE 0 END) AS live,
                   sum(CASE WHEN item.status = 'verified' THEN 1 ELSE 0 END) AS verified,
                   sum(CASE WHEN item.status = 'failed' THEN 1 ELSE 0 END) AS failed,
                   sum(CASE WHEN catalog.state = 'failed' THEN 1 ELSE 0 END) AS catalog_failed
            FROM asset_upload_run_items AS item
            LEFT JOIN public_catalog_publications AS catalog
              ON catalog.asset_id = item.asset_id
             AND catalog.source_version_hash = item.source_version_hash
            WHERE item.run_id = ?
            """,
            (run_id,),
        ).fetchone()
        total = int(summary["total"] or 0)
        processed = int(summary["processed"] or 0)
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
    return {
        "runId": run_id,
        "total": total,
        "processed": processed,
        "live": int(summary["live"] or 0),
        "verified": int(summary["verified"] or 0),
        "failed": int(summary["failed"] or 0),
        "catalogFailed": int(summary["catalog_failed"] or 0),
        "remaining": max(0, total - processed),
    }


def verify_upload_run_catalog(
    repo_root: Path,
    run_id: str,
    *,
    fetch: Callable[[str], tuple[int, bytes, str]] | None = None,
) -> dict[str, Any]:
    """Verify every catalog-audited item in a run using a cached live catalog."""
    with connect(repo_root) as conn:
        rows = conn.execute(
            """
            SELECT item.asset_id, item.source_version_hash, catalog.public_url
            FROM asset_upload_run_items AS item
            JOIN public_catalog_publications AS catalog
              ON catalog.asset_id = item.asset_id
             AND catalog.source_version_hash = item.source_version_hash
            WHERE item.run_id = ?
            ORDER BY item.asset_id
            """,
            (run_id,),
        ).fetchall()
    cache: dict[str, tuple[int, bytes, str]] = {}

    def cached_fetch(url: str) -> tuple[int, bytes, str]:
        if url not in cache:
            if fetch:
                cache[url] = fetch(url)
            else:
                response = urlopen(
                    Request(url, headers={"User-Agent": "PhotosByElie catalog verifier"}),
                    timeout=20,
                )
                cache[url] = (
                    int(response.status),
                    response.read(),
                    str(response.headers.get("ETag") or ""),
                )
        return cache[url]

    outcomes: list[dict[str, Any]] = []
    for row in rows:
        asset_id = str(row["asset_id"])
        source_version_hash = str(row["source_version_hash"])
        try:
            result = verify_public_catalog(
                repo_root,
                asset_id,
                source_version_hash,
                fetch=cached_fetch,
            )
            outcomes.append({"assetId": asset_id, **result})
        except Exception as error:  # noqa: BLE001 - each catalog item is independently retryable.
            outcomes.append({"assetId": asset_id, "state": "failed", "error": str(error)})
    summary = reconcile_upload_run_catalog_states(repo_root, run_id)
    return {
        "ok": True,
        "task": "verify-upload-run-catalog",
        **summary,
        "items": outcomes,
    }


def _bridge_results(repo_root: Path, asset_id: str) -> list[dict[str, Any]]:
    with connect(repo_root) as conn:
        row = conn.execute(
            "SELECT upload_keys_json FROM sidecar_upload_bridge_run_items WHERE asset_id = ? AND status = 'uploaded' ORDER BY updated_at DESC LIMIT 1",
            (asset_id,),
        ).fetchone()
    values = _read_json(row["upload_keys_json"], []) if row else []
    return [dict(item) for item in values if isinstance(item, dict)] if isinstance(values, list) else []


def _promote_command(args: argparse.Namespace) -> int:
    repo_root = args.repo_root.resolve()
    with connect(repo_root) as conn:
        ids = args.asset_id or [str(row["asset_id"]) for row in conn.execute("SELECT asset_id FROM asset_upload_run_items WHERE run_id = ?", (args.run_id,)).fetchall()]
    outcomes = []
    for asset_id in ids:
        with connect(repo_root) as conn:
            version = conn.execute("SELECT source_version_hash FROM asset_delivery_state WHERE asset_id = ?", (asset_id,)).fetchone()
        outcomes.append({"assetId": asset_id, **promote_verified_asset(repo_root, asset_id, str(version["source_version_hash"] if version else ""), _bridge_results(repo_root, asset_id))})
    artifacts = refresh_public_catalog_artifacts(repo_root) if any(item.get("state") == "local" for item in outcomes) else {"ok": True, "steps": []}
    print(json.dumps({"ok": bool(artifacts.get("ok")), "task": "native-catalog-promotion", "items": outcomes, "publicCatalogArtifacts": artifacts}, ensure_ascii=False))
    return 0 if artifacts.get("ok") else 1


def _verify_command(args: argparse.Namespace) -> int:
    result = verify_public_catalog(
        args.repo_root.resolve(),
        args.asset_id,
        args.source_version_hash,
    )
    print(json.dumps({"ok": True, "task": "verify-public-catalog", **result}, ensure_ascii=False))
    return 0


def _verify_run_command(args: argparse.Namespace) -> int:
    result = verify_upload_run_catalog(args.repo_root.resolve(), args.run_id)
    print(json.dumps(result, ensure_ascii=False))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    subparsers = parser.add_subparsers(dest="command", required=True)
    promote = subparsers.add_parser("promote-verified")
    promote.add_argument("--asset-id", action="append", default=[])
    promote.add_argument("--run-id", default="")
    promote.set_defaults(func=_promote_command)
    verify = subparsers.add_parser("verify-public-catalog")
    verify.add_argument("--asset-id", required=True)
    verify.add_argument("--source-version-hash", required=True)
    verify.set_defaults(func=_verify_command)
    verify_run = subparsers.add_parser("verify-upload-run-catalog")
    verify_run.add_argument("--run-id", required=True)
    verify_run.set_defaults(func=_verify_run_command)
    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
