#!/usr/bin/env python3
"""Non-UI Sidecar maintenance tasks for schedulers."""

from __future__ import annotations

import argparse
import json
import sqlite3
import subprocess
import sys
import uuid
from pathlib import Path

try:
    from sidecar_server import APPLE_PHOTOS_BRIDGE_APP, _ensure_apple_photos_bridge_app, _index_job_snapshot, _run_index_job
    from sidecar_state_db import ai_metadata_plan, apply_ai_metadata_proposals, apply_ai_metadata_vision_proposals, now_iso, sidecar_sync_status
except ModuleNotFoundError:  # pragma: no cover - supports package-style imports.
    from scripts.sidecar_server import APPLE_PHOTOS_BRIDGE_APP, _ensure_apple_photos_bridge_app, _index_job_snapshot, _run_index_job
    from scripts.sidecar_state_db import ai_metadata_plan, apply_ai_metadata_proposals, apply_ai_metadata_vision_proposals, now_iso, sidecar_sync_status


DEFAULT_AI_PLAN_PATH = Path("assets/owner-actions/sidecar-ai-metadata-plan.json")
DEFAULT_AI_PREVIEW_PATH = Path("assets/owner-actions/sidecar-ai-metadata-previews.json")
DEFAULT_AI_PREVIEW_ROOT = Path("tmp/sidecar-picked-ai-previews")
DEFAULT_AI_VISION_PROPOSAL_INPUT_PATH = Path("assets/owner-actions/sidecar-ai-metadata-vision-proposals-current.json")
DEFAULT_AI_VISION_PROPOSAL_RESULT_PATH = Path("assets/owner-actions/sidecar-ai-metadata-vision-propose-latest.json")
DEFAULT_SYNC_STATUS_PATH = Path("assets/owner-actions/sidecar-photos-sync-status.json")
DEFAULT_REGISTER_UPLOADED_CATALOG_PATH = Path("assets/owner-actions/sidecar-register-uploaded-catalog-latest.json")


def _json_text(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _write_json(repo_root: Path, path: Path, payload: dict) -> None:
    target = path if path.is_absolute() else repo_root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _print_json(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


def _read_json_text(value: object, fallback: object) -> object:
    if value in (None, ""):
        return fallback
    try:
        return json.loads(str(value))
    except json.JSONDecodeError:
        return fallback


def _scale_to_max(width: int, height: int, max_pixel: int) -> tuple[int, int]:
    if width <= 0 or height <= 0:
        return (1, 1)
    scale = min(max_pixel / width, max_pixel / height, 1)
    return (max(1, round(width * scale)), max(1, round(height * scale)))


def _scale_to_megapixels(width: int, height: int, target_mp: float) -> tuple[int, int]:
    if width <= 0 or height <= 0 or target_mp <= 0:
        return (1, 1)
    current_mp = (width * height) / 1_000_000
    scale = min((target_mp / current_mp) ** 0.5, 1)
    return (max(1, round(width * scale)), max(1, round(height * scale)))


def _image_dimensions(path: str) -> tuple[int, int] | None:
    if not path:
        return None
    try:
        from PIL import Image

        with Image.open(path) as image:
            return image.size
    except Exception:
        return None


def _catalog_id(conn: sqlite3.Connection, table: str, id_column: str, where_column: str, value: str) -> int | str:
    row = conn.execute(f"SELECT {id_column} FROM {table} WHERE {where_column} = ?", (value,)).fetchone()
    if row is None:
        raise ValueError(f"missing catalog {table}.{where_column}={value!r}")
    return row[id_column]


def _ensure_keyword_ids(conn: sqlite3.Connection, keywords: list[str]) -> str:
    ids: list[str] = []
    for keyword in keywords:
        clean = str(keyword or "").strip()
        if not clean:
            continue
        row = conn.execute("SELECT keyword_id FROM keyword_terms WHERE keyword = ?", (clean,)).fetchone()
        if row:
            keyword_id = int(row["keyword_id"])
        else:
            keyword_id = int(conn.execute("SELECT COALESCE(MAX(keyword_id), 0) + 1 FROM keyword_terms").fetchone()[0])
            conn.execute("INSERT INTO keyword_terms(keyword_id, keyword) VALUES (?, ?)", (keyword_id, clean))
        ids.append(str(keyword_id))
    return ",".join(ids)


def _ensure_source_file(conn: sqlite3.Connection, folder: str, filename: str, extension: str) -> int:
    folder = folder.strip("/") or "Apple Photos Sidecar Uploads"
    filename = filename.strip() or "sidecar-upload"
    extension = extension.strip(".").lower() or "mp4"
    folder_row = conn.execute("SELECT source_folder_id FROM source_folders WHERE source_folder = ?", (folder,)).fetchone()
    if folder_row:
        folder_id = int(folder_row["source_folder_id"])
    else:
        folder_id = int(conn.execute("SELECT COALESCE(MAX(source_folder_id), 0) + 1 FROM source_folders").fetchone()[0])
        conn.execute("INSERT INTO source_folders(source_folder_id, source_folder) VALUES (?, ?)", (folder_id, folder))
    format_id = _catalog_id(conn, "formats", "format_id", "extension", extension)
    file_row = conn.execute(
        """
        SELECT source_file_id FROM source_files
        WHERE source_folder_id = ? AND filename = ?
        """,
        (folder_id, filename),
    ).fetchone()
    if file_row:
        return int(file_row["source_file_id"])
    source_file_id = int(conn.execute("SELECT COALESCE(MAX(source_file_id), 0) + 1 FROM source_files").fetchone()[0])
    conn.execute(
        "INSERT INTO source_files(source_file_id, source_folder_id, filename, format_id) VALUES (?, ?, ?, ?)",
        (source_file_id, folder_id, filename, format_id),
    )
    return source_file_id


def _gallery_slug(row: sqlite3.Row) -> str:
    text = " ".join(
        [
            str(row["location_label"] or ""),
            str(row["location_keywords_json"] or ""),
            str(row["keywords_json"] or ""),
            str(row["title"] or ""),
            str(row["filename"] or ""),
        ]
    ).casefold()
    for slug, terms in {
        "italy": ["italy", "florence", "tuscany"],
        "france": ["france"],
        "spain": [
            "spain",
            "malaga",
            "málaga",
            "andalusia",
            "andalucía",
            "benalmadena",
            "benalmádena",
            "fuengirola",
            "nerja",
            "ronda",
            "mijas",
            "marbella",
            "cordoba",
            "córdoba",
            "granada",
            "la concha",
            "colleccion del museo ruso",
            "colección del museo ruso",
        ],
        "portugal": ["portugal"],
        "usa": ["usa", "united states"],
        "mexico": ["mexico"],
        "slovakia": ["slovakia"],
        "ai": ["ai generated", "generative ai", "stained glass"],
    }.items():
        if any(term in text for term in terms):
            return slug
    return "unknown"


def _uploaded_keys(row: sqlite3.Row) -> list[dict]:
    keys = _read_json_text(row["upload_keys_json"], [])
    if not isinstance(keys, list):
        return []
    return [item for item in keys if isinstance(item, dict) and item.get("status") == "uploaded"]


def _uploaded_key(keys: list[dict], kind: str, suffix: str | None = None) -> dict | None:
    for item in keys:
        if str(item.get("kind") or "") != kind:
            continue
        key = str(item.get("key") or "")
        if suffix is None or key.endswith(suffix):
            return item
    return None


def _extension_from_key_or_filename(key: object, filename: object) -> str:
    for value in [key, filename]:
        suffix = Path(str(value or "")).suffix.lower().lstrip(".")
        if suffix == "jpeg":
            return "jpg"
        if suffix in {"jpg", "tif", "png", "heic", "mp4", "mov"}:
            return suffix
    return "jpg"


def _register_uploaded_catalog_rows(
    repo_root: Path,
    *,
    asset_ids: list[str] | None = None,
    dry_run: bool = False,
) -> dict:
    owner_path = repo_root / "assets/owner-actions/Owner.sqlite"
    catalog_path = repo_root / "assets/catalog/photosbyelie.sqlite"
    if not owner_path.exists():
        raise FileNotFoundError(f"missing Owner database: {owner_path}")
    if not catalog_path.exists():
        raise FileNotFoundError(f"missing public catalog database: {catalog_path}")

    requested_ids = [str(item or "").strip() for item in (asset_ids or []) if str(item or "").strip()]
    owner = sqlite3.connect(owner_path)
    owner.row_factory = sqlite3.Row
    catalog = sqlite3.connect(catalog_path)
    catalog.row_factory = sqlite3.Row
    catalog.execute("PRAGMA foreign_keys = ON")
    try:
        filters = ["d.pick_state = 'picked'", "d.metadata_state = 'approved'", "i.upload_status = 'uploaded'"]
        params: list[str] = []
        if requested_ids:
            filters.append(f"d.asset_id IN ({','.join('?' for _ in requested_ids)})")
            params.extend(requested_ids)
        rows = owner.execute(
            f"""
            SELECT a.asset_id, a.source_anchor, a.raw_json, a.missing_at,
                   a.filename, a.media_type, a.captured_at, a.pixel_width, a.pixel_height,
                   a.duration, a.location_label, a.location_keywords_json,
                   d.title, d.keywords_json,
                   i.photo_id, i.upload_keys_json, i.updated_at
            FROM sidecar_decisions AS d
            JOIN sidecar_assets AS a ON a.asset_id = d.asset_id
            JOIN sidecar_upload_bridge_run_items AS i ON i.asset_id = d.asset_id
            WHERE {' AND '.join(filters)}
              AND COALESCE(i.photo_id, '') <> ''
              AND COALESCE(i.upload_keys_json, '') <> ''
              AND NOT EXISTS (
                SELECT 1 FROM sidecar_tombstones AS t
                WHERE t.asset_id = d.asset_id AND t.tombstone_state = 'active'
              )
            ORDER BY i.updated_at DESC
            """,
            params,
        ).fetchall()
        latest_by_asset: dict[str, sqlite3.Row] = {}
        for row in rows:
            latest_by_asset.setdefault(str(row["asset_id"]), row)

        tombstoned_identities: set[str] = set()
        for row in owner.execute(
            """
            SELECT a.asset_id, a.raw_json
            FROM sidecar_tombstones AS t
            JOIN sidecar_assets AS a ON a.asset_id = t.asset_id
            WHERE t.tombstone_state = 'active'
            """
        ).fetchall():
            raw = _read_json_text(row["raw_json"], {})
            local_identifier = str(raw.get("localIdentifier") or "").strip() if isinstance(raw, dict) else ""
            tombstoned_identities.add(local_identifier or str(row["asset_id"]))

        # One physical Photos item can have both a retired local identifier and
        # a current cloud identifier. Prefer an already-published media id, then
        # the stable local-identifier upload family, so registration never
        # creates a second public item for the same Photos asset.
        candidates_by_identity: dict[str, list[sqlite3.Row]] = {}
        for row in latest_by_asset.values():
            raw = _read_json_text(row["raw_json"], {})
            local_identifier = str(raw.get("localIdentifier") or "").strip() if isinstance(raw, dict) else ""
            identity = local_identifier or str(row["asset_id"])
            if identity in tombstoned_identities:
                continue
            candidates_by_identity.setdefault(identity, []).append(row)

        latest_by_identity: dict[str, sqlite3.Row] = {}
        for identity, candidates in candidates_by_identity.items():
            latest_by_identity[identity] = max(
                candidates,
                key=lambda row: (
                    int(bool(catalog.execute("SELECT 1 FROM media_items WHERE media_id = ?", (row["photo_id"],)).fetchone())),
                    int(str(row["asset_id"] or "") == identity),
                    int(str(row["source_anchor"] or "").startswith("apple-photos://")),
                    str(row["updated_at"] or ""),
                    str(row["asset_id"] or ""),
                ),
            )

        inserted: list[dict] = []
        skipped: list[dict] = []
        r2_upserts = 0
        now = now_iso()
        source_origin_backfill_count = int(
            catalog.execute("SELECT COUNT(*) FROM media_items WHERE source_origin_id IS NULL").fetchone()[0]
        )
        if source_origin_backfill_count and not dry_run:
            camera_origin_id = _catalog_id(catalog, "source_origins", "source_origin_id", "code", "camera")
            catalog.execute(
                "UPDATE media_items SET source_origin_id = ?, updated_at = ? WHERE source_origin_id IS NULL",
                (camera_origin_id, now),
            )

        blocked_media_ids: set[str] = set()
        lifecycle_blocked_media_ids = {
            str(row["media_id"])
            for row in owner.execute(
                """
                SELECT media_id
                FROM media_lifecycle
                WHERE lifecycle_state IN ('hidden', 'discarded')
                """
            ).fetchall()
        }
        blocked_media_ids.update(lifecycle_blocked_media_ids)
        if tombstoned_identities:
            for row in owner.execute(
                """
                SELECT a.asset_id, a.raw_json, i.photo_id
                FROM sidecar_assets AS a
                JOIN sidecar_upload_bridge_run_items AS i ON i.asset_id = a.asset_id
                WHERE COALESCE(i.photo_id, '') <> ''
                """
            ).fetchall():
                raw = _read_json_text(row["raw_json"], {})
                local_identifier = str(raw.get("localIdentifier") or "").strip() if isinstance(raw, dict) else ""
                identity = local_identifier or str(row["asset_id"])
                if identity in tombstoned_identities:
                    blocked_media_ids.add(str(row["photo_id"]))
        removed_blocked_ids = sorted(
            media_id
            for media_id in blocked_media_ids
            if catalog.execute("SELECT 1 FROM media_items WHERE media_id = ?", (media_id,)).fetchone()
        )
        if removed_blocked_ids and not dry_run:
            catalog.executemany("DELETE FROM media_items WHERE media_id = ?", [(media_id,) for media_id in removed_blocked_ids])
        for row in latest_by_identity.values():
            media_id = str(row["photo_id"] or "").strip()
            asset_id = str(row["asset_id"] or "").strip()
            if media_id in lifecycle_blocked_media_ids:
                skipped.append({"assetId": asset_id, "photoId": media_id, "reason": "hidden_or_discarded"})
                continue
            upload_keys = _uploaded_keys(row)
            media_type = str(row["media_type"] or "").strip().lower()
            if media_type not in {"photo", "video"}:
                skipped.append({"assetId": asset_id, "photoId": media_id, "reason": "unsupported_media_type", "mediaType": media_type})
                continue
            private_master = _uploaded_key(upload_keys, "private-master")
            still_900 = _uploaded_key(upload_keys, "public-preview", "_900.jpg")
            still_1800 = _uploaded_key(upload_keys, "public-preview", "_1800.jpg")
            short_video = _uploaded_key(upload_keys, "public-preview-video", "_short_5s_720p.mp4")
            missing = []
            if private_master is None:
                missing.append("private-master")
            if still_900 is None:
                missing.append("public-preview:_900")
            if media_type == "photo" and still_1800 is None:
                missing.append("public-preview:_1800")
            if media_type == "video" and short_video is None:
                missing.append("public-preview-video")
            if missing:
                skipped.append({"assetId": asset_id, "photoId": media_id, "reason": "missing_uploaded_keys", "missing": missing})
                continue
            if catalog.execute("SELECT 1 FROM media_items WHERE media_id = ?", (media_id,)).fetchone():
                skipped.append({"assetId": asset_id, "photoId": media_id, "reason": "already_in_catalog"})
                continue

            width = int(row["pixel_width"] or 0)
            height = int(row["pixel_height"] or 0)
            duration = float(row["duration"] or 0) if media_type == "video" else None
            if width <= 0 or height <= 0 or (media_type == "video" and (duration is None or duration <= 0)):
                skipped.append({"assetId": asset_id, "photoId": media_id, "reason": "missing_media_dimensions"})
                continue
            gallery_slug = _gallery_slug(row)
            collection_row = catalog.execute("SELECT collection_id, title FROM collections WHERE slug = ?", (gallery_slug,)).fetchone()
            if collection_row is None:
                skipped.append({"assetId": asset_id, "photoId": media_id, "reason": "unsupported_gallery", "collection": gallery_slug})
                continue
            collection_id = collection_row["collection_id"]
            full_extension = _extension_from_key_or_filename(private_master.get("key") if private_master else "", row["filename"])
            source_file_id = _ensure_source_file(catalog, "Apple Photos Sidecar Uploads", str(row["filename"] or ""), full_extension)
            keywords = _read_json_text(row["keywords_json"], [])
            if not isinstance(keywords, list):
                keywords = []
            keyword_ids = _ensure_keyword_ids(catalog, [str(item) for item in keywords])
            media_type_id = _catalog_id(catalog, "media_types", "media_type_id", "code", media_type)
            source_origin_id = _catalog_id(catalog, "source_origins", "source_origin_id", "code", "camera")
            full_format_id = _catalog_id(catalog, "formats", "format_id", "extension", full_extension)
            jpg_format_id = _catalog_id(catalog, "formats", "format_id", "extension", "jpg")
            mp4_format_id = _catalog_id(catalog, "formats", "format_id", "extension", "mp4")
            full_type_id = _catalog_id(catalog, "asset_types", "asset_type_id", "code", "full")
            still_type_id = _catalog_id(catalog, "asset_types", "asset_type_id", "code", "still_900")
            next_sort = int(
                catalog.execute(
                    "SELECT COALESCE(MAX(sort_index), -1) + 1 FROM media_items WHERE collection_id = ?",
                    (collection_id,),
                ).fetchone()[0]
            )
            title = str(row["title"] or media_id).strip() or media_id
            location = str(row["location_label"] or collection_row["title"] or gallery_slug).strip() or gallery_slug
            preview_dims = _image_dimensions(str(still_900.get("sourcePath") or "")) if still_900 else None
            preview_dims = preview_dims or _scale_to_max(width, height, 900)
            if not dry_run:
                catalog.execute(
                    """
                    INSERT INTO media_items (
                      media_id, collection_id, sort_index, media_type_id, camera_id, lens_id, title,
                      description, keyword_ids, source_origin_id, captured_at, exposure, focal_length,
                      source_file_id, location, gps_latitude, gps_longitude, created_at, updated_at, caption_color
                    ) VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, ?, ?, NULL)
                    """,
                    (
                        media_id,
                        collection_id,
                        next_sort,
                        media_type_id,
                        title,
                        keyword_ids or None,
                        source_origin_id,
                        str(row["captured_at"] or "") or None,
                        source_file_id,
                        location,
                        now,
                        now,
                    ),
                )
                catalog.executemany(
                    "INSERT INTO media_assets(media_id, asset_type_id, width, height, duration_seconds, bytes, format_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    [
                        (media_id, full_type_id, width, height, duration, int(private_master.get("bytes") or 0), full_format_id),
                        (media_id, still_type_id, preview_dims[0], preview_dims[1], None, int(still_900.get("bytes") or 0), jpg_format_id),
                    ]
                    + (
                        [
                            (
                                media_id,
                                _catalog_id(catalog, "asset_types", "asset_type_id", "code", "still_1800"),
                                *(_image_dimensions(str(still_1800.get("sourcePath") or "")) or _scale_to_max(width, height, 1800)),
                                None,
                                int(still_1800.get("bytes") or 0),
                                jpg_format_id,
                            ),
                            (
                                media_id,
                                _catalog_id(catalog, "asset_types", "asset_type_id", "code", "jpeg_1mp"),
                                *_scale_to_megapixels(width, height, 1),
                                None,
                                None,
                                jpg_format_id,
                            ),
                            (
                                media_id,
                                _catalog_id(catalog, "asset_types", "asset_type_id", "code", "jpeg_3mp"),
                                *_scale_to_megapixels(width, height, 3),
                                None,
                                None,
                                jpg_format_id,
                            ),
                            (
                                media_id,
                                _catalog_id(catalog, "asset_types", "asset_type_id", "code", "jpeg_6mp"),
                                *_scale_to_megapixels(width, height, 6),
                                None,
                                None,
                                jpg_format_id,
                            ),
                        ]
                        if media_type == "photo"
                        else [
                            (
                                media_id,
                                _catalog_id(catalog, "asset_types", "asset_type_id", "code", "short_5s_720p"),
                                *_scale_to_max(width, height, 720),
                                5.0,
                                int(short_video.get("bytes") or 0),
                                mp4_format_id,
                            )
                        ]
                    ),
                )
                for uploaded in upload_keys:
                    kind = str(uploaded.get("kind") or "")
                    bucket = str(uploaded.get("bucket") or "")
                    key = str(uploaded.get("key") or "")
                    if not bucket or not key:
                        continue
                    owner.execute(
                        """
                        INSERT INTO r2_objects (
                          bucket, object_key, photo_id, object_kind, lifecycle_state, first_seen_at,
                          last_seen_at, marked_for_delete_at, deleted_confirmed_at, last_checked_at,
                          source, bytes, updated_at
                        ) VALUES (?, ?, ?, ?, 'current', ?, ?, NULL, NULL, ?, 'sidecar-upload-bridge-ledger', ?, ?)
                        ON CONFLICT(bucket, object_key) DO UPDATE SET
                          photo_id = excluded.photo_id,
                          object_kind = excluded.object_kind,
                          lifecycle_state = 'current',
                          last_seen_at = excluded.last_seen_at,
                          last_checked_at = excluded.last_checked_at,
                          source = excluded.source,
                          bytes = excluded.bytes,
                          updated_at = excluded.updated_at
                        """,
                        (bucket, key, media_id, kind, now, now, now, int(uploaded.get("bytes") or 0), now),
                    )
                    r2_upserts += 1
            inserted.append({"assetId": asset_id, "photoId": media_id, "collection": gallery_slug, "title": title})
        if not dry_run:
            integrity = catalog.execute("PRAGMA integrity_check").fetchone()[0]
            if integrity != "ok":
                raise RuntimeError(f"catalog integrity_check failed: {integrity}")
            fk_violations = catalog.execute("PRAGMA foreign_key_check").fetchall()
            if fk_violations:
                raise RuntimeError(f"catalog foreign_key_check failed: {fk_violations[:5]}")
            catalog.commit()
            if removed_blocked_ids:
                # The catalog is a public downloadable artifact. Compact it
                # after lifecycle removals so deleted identifiers do not remain
                # recoverable from SQLite freelist pages.
                catalog.execute("VACUUM")
            owner.commit()
        else:
            catalog.rollback()
            owner.rollback()
        return {
            "ok": True,
            "mode": "sidecar-uploaded-catalog-registration",
            "dryRun": dry_run,
            "candidateCount": len(latest_by_identity),
            "registeredCount": len(inserted),
            "removedBlockedCount": len(removed_blocked_ids),
            "skippedCount": len(skipped),
            "sourceOriginBackfillCount": source_origin_backfill_count,
            "r2ObjectUpsertCount": r2_upserts,
            "registered": inserted,
            "removedBlocked": removed_blocked_ids,
            "skipped": skipped,
        }
    finally:
        catalog.close()
        owner.close()


def photos_index_sync(args: argparse.Namespace) -> int:
    repo_root = args.repo_root.resolve()
    job_id = f"scheduled-{uuid.uuid4().hex[:12]}"
    _run_index_job(repo_root, job_id)
    payload = {
        "ok": True,
        "task": "sidecar-photos-index-sync",
        "generatedAt": now_iso(),
        "job": _index_job_snapshot(repo_root),
        "sync": sidecar_sync_status(repo_root, limit=args.limit),
    }
    job_status = str(payload["job"].get("status") or "")
    if job_status != "done":
        payload["ok"] = False
    if args.output:
        _write_json(repo_root, args.output, payload)
    _print_json(payload)
    return 0 if payload["ok"] else 1


def picked_ai_plan(args: argparse.Namespace) -> int:
    repo_root = args.repo_root.resolve()
    payload = {
        "ok": True,
        "task": "sidecar-picked-ai-metadata-plan",
        "generatedAt": now_iso(),
        "plan": ai_metadata_plan(repo_root, limit=args.limit),
    }
    if args.output:
        _write_json(repo_root, args.output, payload)
    _print_json(payload)
    return 0


def _preview_filename(index: int, item: dict, max_pixel: int) -> str:
    filename = Path(str(item.get("filename") or "asset")).stem
    safe = "".join(char if char.isalnum() or char in {"-", "_"} else "-" for char in filename).strip("-_")
    safe = safe or "asset"
    return f"{index:03d}-{safe}-{max_pixel}.jpg"


def _write_contact_sheet(previews: list[dict], target: Path) -> str:
    usable = [item for item in previews if item.get("ok") and item.get("previewPath")]
    if not usable:
        return ""
    try:
        from PIL import Image, ImageDraw, ImageOps
    except Exception:
        return ""

    thumb_w = 220
    thumb_h = 170
    label_h = 42
    cols = 4
    rows = (len(usable) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * thumb_w, rows * (thumb_h + label_h)), "white")
    draw = ImageDraw.Draw(sheet)
    for index, item in enumerate(usable):
        path = Path(str(item["previewPath"]))
        try:
            with Image.open(path) as image:
                image = ImageOps.contain(image.convert("RGB"), (thumb_w, thumb_h))
        except Exception:
            continue
        x = (index % cols) * thumb_w
        y = (index // cols) * (thumb_h + label_h)
        sheet.paste(image, (x + (thumb_w - image.width) // 2, y + (thumb_h - image.height) // 2))
        label = f"{item.get('queueIndex', index + 1):02d} {item.get('filename', '')}"[:34]
        draw.text((x + 6, y + thumb_h + 5), label, fill=(20, 20, 20))
        draw.text((x + 6, y + thumb_h + 22), str(item.get("recommendedAiRung") or "")[:34], fill=(80, 80, 80))
    target.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(target, quality=88)
    return str(target)


def picked_ai_preview_export(args: argparse.Namespace) -> int:
    repo_root = args.repo_root.resolve()
    plan = ai_metadata_plan(repo_root, limit=args.limit)
    preview_root = args.preview_root if args.preview_root.is_absolute() else repo_root / args.preview_root
    preview_root.mkdir(parents=True, exist_ok=True)
    _ensure_apple_photos_bridge_app(repo_root)

    previews: list[dict] = []
    for index, item in enumerate(plan.get("items") or [], start=1):
        asset_id = str(item.get("assetId") or "").strip()
        if not asset_id:
            continue
        destination = preview_root / _preview_filename(index, item, args.max_pixel)
        command = [
            "open",
            "-W",
            "-n",
            str(APPLE_PHOTOS_BRIDGE_APP),
            "--args",
            "preview",
            "--asset-id",
            asset_id,
            "--destination",
            str(destination),
            "--max-pixel",
            str(args.max_pixel),
        ]
        try:
            result = subprocess.run(
                command,
                cwd=repo_root,
                text=True,
                capture_output=True,
                timeout=args.timeout,
                check=False,
            )
            return_code = result.returncode
            stdout = (result.stdout or "").strip()
            stderr = (result.stderr or "").strip()
            error = ""
        except FileNotFoundError:
            return_code = 127
            stdout = ""
            stderr = ""
            error = "macOS open is required to launch the Photos Bridge app bundle."
        except subprocess.TimeoutExpired:
            return_code = 124
            stdout = ""
            stderr = ""
            error = "Photos Bridge app timed out while exporting the preview."
        ok = return_code == 0 and destination.exists() and destination.stat().st_size > 0
        previews.append({
            "ok": ok,
            "queueIndex": index,
            "assetId": asset_id,
            "filename": str(item.get("filename") or ""),
            "mediaType": str(item.get("mediaType") or ""),
            "metadataState": str(item.get("metadataState") or ""),
            "recommendedAiRung": str(item.get("recommendedAiRung") or ""),
            "locationLabel": str(item.get("locationLabel") or ""),
            "previewPath": str(destination) if destination.exists() else "",
            "returnCode": return_code,
            "stdout": stdout,
            "stderr": stderr,
            **({} if ok else {"error": error or "Photos Bridge app did not create a preview image."}),
        })

    contact_sheet_path = preview_root / "contact-sheet.jpg"
    contact_sheet = _write_contact_sheet(previews, contact_sheet_path)
    failed_count = sum(1 for item in previews if not item.get("ok"))
    payload = {
        "ok": failed_count == 0,
        "task": "sidecar-picked-ai-metadata-preview-export",
        "generatedAt": now_iso(),
        "mode": "picked-only-ai-preview-export",
        "bridgeApp": str(APPLE_PHOTOS_BRIDGE_APP),
        "previewRoot": str(preview_root),
        "contactSheet": contact_sheet,
        "plannedCount": int(plan.get("count") or 0),
        "exportedCount": len(previews) - failed_count,
        "failedCount": failed_count,
        "items": previews,
        "message": "Preview export uses PhotosByElie Photos Bridge.app through LaunchServices; do not replace this with raw Swift.",
    }
    if args.output:
        _write_json(repo_root, args.output, payload)
    _print_json(payload)
    return 0 if payload["ok"] else 1


def picked_ai_propose(args: argparse.Namespace) -> int:
    repo_root = args.repo_root.resolve()
    payload = {
        "ok": True,
        "task": "sidecar-picked-ai-metadata-propose",
        "generatedAt": now_iso(),
        "result": apply_ai_metadata_proposals(repo_root, limit=args.limit, max_rung=args.max_rung),
    }
    if args.output:
        _write_json(repo_root, args.output, payload)
    _print_json(payload)
    return 0


def _read_json_file(repo_root: Path, path: Path) -> object:
    target = path if path.is_absolute() else repo_root / path
    return json.loads(target.read_text(encoding="utf-8"))


def picked_ai_vision_propose(args: argparse.Namespace) -> int:
    repo_root = args.repo_root.resolve()
    proposal_payload = _read_json_file(repo_root, args.input)
    preview_payload = _read_json_file(repo_root, args.preview_manifest) if args.preview_manifest else None
    result = apply_ai_metadata_vision_proposals(
        repo_root,
        proposal_payload,
        preview_manifest=preview_payload,
        dry_run=args.dry_run,
    )
    payload = {
        "ok": True,
        "task": "sidecar-picked-ai-metadata-vision-propose",
        "generatedAt": now_iso(),
        "result": result,
    }
    if args.output:
        _write_json(repo_root, args.output, payload)
    _print_json(payload)
    return 0


def register_uploaded_catalog(args: argparse.Namespace) -> int:
    repo_root = args.repo_root.resolve()
    result = _register_uploaded_catalog_rows(
        repo_root,
        asset_ids=args.asset_id,
        dry_run=args.dry_run,
    )
    rebuild: dict[str, object] = {}
    if (
        result.get("registeredCount")
        or result.get("removedBlockedCount")
        or result.get("sourceOriginBackfillCount")
    ) and not args.dry_run and not args.no_rebuild:
        completed = subprocess.run(
            ["node", "scripts/write_worker_catalog.mjs"],
            cwd=repo_root,
            text=True,
            capture_output=True,
            check=False,
        )
        rebuild = {
            "command": "node scripts/write_worker_catalog.mjs",
            "returnCode": completed.returncode,
            "stdout": (completed.stdout or "").strip(),
            "stderr": (completed.stderr or "").strip(),
        }
        if completed.returncode != 0:
            result["ok"] = False
    payload = {
        "ok": bool(result.get("ok")),
        "task": "sidecar-register-uploaded-catalog",
        "generatedAt": now_iso(),
        "result": result,
        "rebuild": rebuild,
    }
    if args.output:
        _write_json(repo_root, args.output, payload)
    _print_json(payload)
    return 0 if payload["ok"] else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run scheduled Sidecar maintenance tasks without opening the Sidecar UI.")
    parser.add_argument("--repo-root", type=Path, default=Path.cwd(), help="PhotosByElie repo root. Defaults to the current directory.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    photos = subparsers.add_parser("photos-index-sync", help="Refresh the local Apple Photos metadata index.")
    photos.add_argument("--limit", type=int, default=80, help="Number of rows to include in the written sync status artifact.")
    photos.add_argument("--output", type=Path, default=DEFAULT_SYNC_STATUS_PATH, help="JSON artifact path for the scheduler result.")
    photos.set_defaults(func=photos_index_sync)

    ai = subparsers.add_parser("picked-ai-plan", help="Write the picked-only AI metadata planning queue.")
    ai.add_argument("--limit", type=int, default=500, help="Maximum picked rows to include in the planning artifact.")
    ai.add_argument("--output", type=Path, default=DEFAULT_AI_PLAN_PATH, help="JSON artifact path for the scheduler result.")
    ai.set_defaults(func=picked_ai_plan)

    preview = subparsers.add_parser("picked-ai-preview-export", help="Export picked/not-approved AI review previews through the Photos Bridge app.")
    preview.add_argument("--limit", type=int, default=80, help="Maximum picked rows to include from the planning queue.")
    preview.add_argument("--max-pixel", type=int, default=900, help="Maximum preview pixel size passed to PhotoKit.")
    preview.add_argument("--timeout", type=int, default=90, help="Per-preview app launch timeout in seconds.")
    preview.add_argument("--preview-root", type=Path, default=DEFAULT_AI_PREVIEW_ROOT, help="Directory for exported preview images and contact sheet.")
    preview.add_argument("--output", type=Path, default=DEFAULT_AI_PREVIEW_PATH, help="JSON artifact path for the preview-export result.")
    preview.set_defaults(func=picked_ai_preview_export)

    propose = subparsers.add_parser("picked-ai-propose", help="Write bounded picked-only metadata proposals into Sidecar Review.")
    propose.add_argument("--limit", type=int, default=20, help="Maximum picked rows to convert from safe plan seeds into Review proposals.")
    propose.add_argument(
        "--max-rung",
        choices=["seed", "filename-gps", "geocode-context", "vision-description", "human-review"],
        default="filename-gps",
        help="Strongest AI metadata rung this non-UI proposer may use.",
    )
    propose.add_argument("--output", type=Path, help="Optional JSON artifact path for the proposal result.")
    propose.set_defaults(func=picked_ai_propose)

    vision = subparsers.add_parser("picked-ai-vision-propose", help="Write reviewed preview/vision metadata proposals into Sidecar Review.")
    vision.add_argument("--input", type=Path, default=DEFAULT_AI_VISION_PROPOSAL_INPUT_PATH, help="JSON file containing proposals/updates with assetId, title, and keywords.")
    vision.add_argument("--preview-manifest", type=Path, default=DEFAULT_AI_PREVIEW_PATH, help="Preview export manifest used to require preview-backed proposals.")
    vision.add_argument("--dry-run", action="store_true", help="Validate and report proposals without writing Sidecar Review state.")
    vision.add_argument("--output", type=Path, default=DEFAULT_AI_VISION_PROPOSAL_RESULT_PATH, help="JSON artifact path for the vision proposal result.")
    vision.set_defaults(func=picked_ai_vision_propose)

    register = subparsers.add_parser("register-uploaded-catalog", help="Register uploaded approved Sidecar videos in the public catalog.")
    register.add_argument("--asset-id", action="append", default=[], help="Limit registration to a specific Sidecar asset id; may be repeated.")
    register.add_argument("--dry-run", action="store_true", help="Report missing uploaded Sidecar catalog rows without writing SQLite.")
    register.add_argument("--no-rebuild", action="store_true", help="Do not refresh generated Worker catalog after writing catalog rows.")
    register.add_argument("--output", type=Path, default=DEFAULT_REGISTER_UPLOADED_CATALOG_PATH, help="JSON artifact path for the registration result.")
    register.set_defaults(func=register_uploaded_catalog)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except Exception as error:
        payload = {
            "ok": False,
            "task": args.command,
            "generatedAt": now_iso(),
            "error": str(error),
        }
        _print_json(payload)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
