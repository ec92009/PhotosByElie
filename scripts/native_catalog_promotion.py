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
from pathlib import Path
import re
import sqlite3
import subprocess
import tempfile
import threading
from typing import Any, Callable, Iterable
from urllib.request import Request, urlopen

from fixture_pipeline import connect, now_iso
from fixture_policy import effective_fixture_policy, policy_allows_catalog
from import_source_anchor import photo_id_for_source_path


PUBLIC_CATALOG_PATH = Path("assets/catalog/photosbyelie.sqlite")
PRODUCT_PRICING_PATH = Path("assets/catalog/product-pricing.json")
PUBLIC_CATALOG_URL = "https://photos-by-elie.com/assets/catalog/photosbyelie.sqlite"
_CATALOG_LOCK = threading.RLock()


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


def _gallery_slug(row: sqlite3.Row) -> str:
    text = " ".join(
        str(row[key] or "")
        for key in ("location_label", "location_keywords_json", "keywords_json", "title", "filename")
    ).casefold()
    terms = {
        "italy": ("italy", "florence", "tuscany"),
        "france": ("france", "paris", "versailles", "rueil", "malmaison"),
        "spain": ("spain", "malaga", "málaga", "andalusia", "andalucía", "benalmadena", "fuengirola", "nerja", "ronda", "mijas", "marbella", "cordoba", "granada"),
        "portugal": ("portugal", "lisbon", "lisboa"),
        "usa": ("usa", "united states", "san diego"),
        "mexico": ("mexico",),
        "slovakia": ("slovakia",),
        "ai": ("ai generated", "generative ai", "stained glass"),
    }
    for slug, values in terms.items():
        if any(value in text for value in values):
            return slug
    return "unknown"


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
    return conn.execute(
        """
        SELECT a.*, d.title, d.caption, d.keywords_json, e.editorial_state
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
    return {
        "eligible": True,
        "asset": row,
        "mediaType": media_type,
        "mediaId": str(objects["mediaId"]["value"]),
        "objects": objects,
        "fixtureIds": public_fixture_ids,
        "collection": _gallery_slug(row),
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
              public_url = excluded.public_url, catalog_sha256 = excluded.catalog_sha256,
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
    if not path.exists():
        raise CatalogPromotionError(f"missing public catalog database: {path}")
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
        catalog = sqlite3.connect(path, timeout=30)
        catalog.row_factory = sqlite3.Row
        catalog.execute("PRAGMA foreign_keys = ON")
        try:
            catalog.execute("BEGIN IMMEDIATE")
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
            return {"mediaId": media_id, "registered": existing is None, "catalogPath": str(path)}
        except Exception:
            catalog.rollback()
            raise
        finally:
            catalog.close()


def promote_verified_asset(
    repo_root: Path,
    asset_id: str,
    source_version_hash: str,
    upload_results: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    """Write one verified asset to the local catalog and audit the handoff."""
    results = [dict(item) for item in upload_results]
    with connect(repo_root) as conn:
        candidate = catalog_candidate(repo_root, conn, asset_id, results)
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
        return {"state": "local", "mediaId": media_id, "fixtureIds": candidate["fixtureIds"], **registration, "catalogSha256": checksum}
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
    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
