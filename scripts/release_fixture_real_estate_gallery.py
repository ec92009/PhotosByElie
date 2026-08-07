#!/usr/bin/env python3
"""Project one verified fixture delivery into a private Real Estate gallery.

The release is receipt-driven: only assets with matching verified R2 and Apple
Photos receipts are eligible. Public previews are reused from the canonical
Expo object layout, while private-master authorization is emitted separately
as a Worker-only allowlist.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import sqlite3
from typing import Any
from urllib.parse import quote


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OWNER_DB = REPO_ROOT / "assets/owner-actions/Owner.sqlite"
DEFAULT_CATALOG_DB = REPO_ROOT / "assets/catalog/photosbyelie.sqlite"
DEFAULT_CONTEXT = REPO_ROOT / "assets/real-estate/corine/app-context.js"
DEFAULT_WORKER_RELEASE = REPO_ROOT / "worker/real-estate-gallery-releases.generated.mjs"
PUBLIC_MEDIA_BASE = "https://download.photos-by-elie.com/media"


@dataclass(frozen=True)
class AlbumSpec:
    fixture_id: str
    slug: str
    title: str


LA_CONCHA_ALBUMS = (
    AlbumSpec(
        "fixture-la-concha-apartment-1",
        "la-concha-1-apt-8ab1",
        "La Concha 1 — Apt 8AB1",
    ),
    AlbumSpec(
        "fixture-la-concha-apartment-2",
        "la-concha-2-apt-8a5",
        "La Concha 2 — Apt 8A5",
    ),
)


def _readonly_connection(path: Path) -> sqlite3.Connection:
    if not path.is_file():
        raise FileNotFoundError(path)
    connection = sqlite3.connect(f"file:{quote(str(path.resolve()))}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def _media_id_for(object_key: str) -> str:
    path = Path(object_key)
    if path.parent.as_posix() != "masters" or not path.stem:
        raise ValueError(f"Unsupported canonical private-master key: {object_key}")
    return path.stem


def _receipt_rows(
    owner_db: Path,
    *,
    fixture_id: str,
    albums: tuple[AlbumSpec, ...],
) -> list[dict[str, Any]]:
    album_ids = [album.fixture_id for album in albums]
    placeholders = ",".join("?" for _ in album_ids)
    with _readonly_connection(owner_db) as connection:
        rows = connection.execute(
            f"""
            WITH delivered AS (
              SELECT r.asset_id, r.version_hash, r.object_key,
                     r.checksum_sha256, r.visibility_policy,
                     r.verified_at, r.verification_json
              FROM fixture_delivery_receipts r
              WHERE r.fixture_id = ?
                AND r.destination = 'r2'
                AND r.status = 'verified'
            ), leaf AS (
              SELECT p.asset_id, p.fixture_id
              FROM fixture_asset_placements p
              WHERE p.state = 'active'
                AND p.fixture_id IN ({placeholders})
            )
            SELECT d.asset_id, d.version_hash, d.object_key,
                   d.checksum_sha256, d.visibility_policy,
                   d.verified_at, d.verification_json,
                   leaf.fixture_id AS leaf_fixture_id,
                   a.filename, a.media_type, a.captured_at,
                   a.pixel_width, a.pixel_height,
                   COALESCE(decision.title, a.photos_title, '') AS approved_title,
                   COALESCE(decision.keywords_json, a.photos_keywords_json, '[]') AS keywords_json,
                   object.bucket, object.object_kind, object.lifecycle_state,
                   object.bytes
            FROM delivered d
            JOIN leaf ON leaf.asset_id = d.asset_id
            JOIN sidecar_assets a ON a.asset_id = d.asset_id
            LEFT JOIN sidecar_decisions decision ON decision.asset_id = d.asset_id
            LEFT JOIN r2_objects object
              ON object.object_key = d.object_key
             AND object.bucket = json_extract(d.verification_json, '$.bucket')
            WHERE EXISTS (
              SELECT 1
              FROM fixture_delivery_receipts photos
              WHERE photos.fixture_id = ?
                AND photos.asset_id = d.asset_id
                AND photos.destination = 'apple_photos'
                AND photos.status = 'verified'
            )
            ORDER BY leaf.fixture_id, a.captured_at, d.asset_id
            """,
            (fixture_id, *album_ids, fixture_id),
        ).fetchall()
        all_r2_count = connection.execute(
            """
            SELECT count(DISTINCT asset_id)
            FROM fixture_delivery_receipts
            WHERE fixture_id = ? AND destination = 'r2' AND status = 'verified'
            """,
            (fixture_id,),
        ).fetchone()[0]

    result = [dict(row) for row in rows]
    if len(result) != int(all_r2_count or 0):
        raise ValueError(
            f"Receipt projection is incomplete: {all_r2_count} verified R2 assets, "
            f"but {len(result)} have one configured leaf and a matching Apple Photos receipt."
        )
    return result


def _catalog_assets(catalog_db: Path, media_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not media_ids:
        return {}
    placeholders = ",".join("?" for _ in media_ids)
    with _readonly_connection(catalog_db) as connection:
        rows = connection.execute(
            f"""
            SELECT item.media_id, source.filename,
                   max(CASE WHEN asset_type.code = 'still_900' THEN asset.width END) AS width_900,
                   max(CASE WHEN asset_type.code = 'still_900' THEN asset.height END) AS height_900,
                   max(CASE WHEN asset_type.code = 'still_1800' THEN asset.width END) AS width_1800,
                   max(CASE WHEN asset_type.code = 'still_1800' THEN asset.height END) AS height_1800
            FROM media_items item
            JOIN source_files source ON source.source_file_id = item.source_file_id
            LEFT JOIN media_assets asset ON asset.media_id = item.media_id
            LEFT JOIN asset_types asset_type ON asset_type.asset_type_id = asset.asset_type_id
            WHERE item.media_id IN ({placeholders})
            GROUP BY item.media_id, source.filename
            """,
            media_ids,
        ).fetchall()
    return {str(row["media_id"]): dict(row) for row in rows}


def _receipt_digest(rows: list[dict[str, Any]]) -> str:
    evidence = "\n".join(
        "\t".join(
            str(row.get(field) or "")
            for field in ("asset_id", "version_hash", "object_key", "checksum_sha256")
        )
        for row in sorted(rows, key=lambda item: str(item.get("asset_id") or ""))
    )
    return hashlib.sha256(evidence.encode("utf-8")).hexdigest()


def build_release(
    owner_db: Path,
    catalog_db: Path,
    *,
    fixture_id: str = "fixture-la-concha",
    gallery_key: str = "corine-real-estate",
    expected_count: int = 121,
    albums: tuple[AlbumSpec, ...] = LA_CONCHA_ALBUMS,
) -> dict[str, Any]:
    rows = _receipt_rows(owner_db, fixture_id=fixture_id, albums=albums)
    if len(rows) != expected_count:
        raise ValueError(f"Expected {expected_count} verified assets for {fixture_id}; found {len(rows)}.")

    media_ids = [_media_id_for(str(row["object_key"])) for row in rows]
    if len(media_ids) != len(set(media_ids)):
        raise ValueError("The verified fixture receipt set contains duplicate media IDs.")
    catalog = _catalog_assets(catalog_db, media_ids)
    missing_catalog = sorted(set(media_ids) - set(catalog))
    if missing_catalog:
        raise ValueError(f"Missing {len(missing_catalog)} verified assets from the public catalog.")

    album_by_fixture = {album.fixture_id: album for album in albums}
    photos: list[dict[str, Any]] = []
    album_counts = {album.fixture_id: 0 for album in albums}
    for row, media_id in zip(rows, media_ids):
        if row["visibility_policy"] != "private":
            raise ValueError(f"Private receipt policy missing for {media_id}.")
        verification = json.loads(str(row["verification_json"] or "{}"))
        if verification.get("bucket") != "photosbyelie-private":
            raise ValueError(f"Unexpected private bucket for {media_id}.")
        if row["bucket"] != "photosbyelie-private" or row["object_kind"] != "private-master":
            raise ValueError(f"Canonical private master is missing from the R2 ledger for {media_id}.")
        if row["lifecycle_state"] != "current" or not row["checksum_sha256"]:
            raise ValueError(f"Canonical private master is not current and checksummed for {media_id}.")

        leaf_id = str(row["leaf_fixture_id"])
        album = album_by_fixture[leaf_id]
        album_counts[leaf_id] += 1
        album_index = album_counts[leaf_id]
        catalog_row = catalog[media_id]
        required_dimensions = (
            catalog_row["width_900"], catalog_row["height_900"],
            catalog_row["width_1800"], catalog_row["height_1800"],
        )
        if any(value is None or int(value) < 1 for value in required_dimensions):
            raise ValueError(f"Public preview dimensions are incomplete for {media_id}.")

        gallery_key_path = f"expo/{media_id}_900.jpg"
        detail_key_path = f"expo/{media_id}_1800.jpg"
        gallery_url = f"{PUBLIC_MEDIA_BASE}/{gallery_key_path}"
        detail_url = f"{PUBLIC_MEDIA_BASE}/{detail_key_path}"
        original_filename = str(row["filename"] or catalog_row["filename"] or f"{media_id}.jpg")
        title = str(album_index).zfill(2)
        photos.append({
            "id": media_id,
            "title": title,
            "editableTitle": title,
            "caption": album.title,
            "className": "real-estate-photo",
            "full": original_filename,
            "gallerySrc": gallery_url,
            "imageSrc": detail_url,
            "album": album.title,
            "albumSlug": album.slug,
            "albumTitle": album.title,
            "sortIndex": len(photos) + 1,
            "metadata": [
                {"label": "Client", "value": "Corine"},
                {"label": "Album", "value": album.title},
                {"label": "Original file", "value": original_filename},
                {"label": "Original size", "value": f"{row['pixel_width']} x {row['pixel_height']}"},
                {"label": "Preview 900", "value": f"{catalog_row['width_900']} x {catalog_row['height_900']}"},
                {"label": "Preview 1800", "value": f"{catalog_row['width_1800']} x {catalog_row['height_1800']}"},
            ],
            "media": {
                "type": "photo",
                "publicPreview": {
                    "allowed": True,
                    "galleryKey": gallery_key_path,
                    "detailKey": detail_key_path,
                    "galleryUrl": gallery_url,
                    "thumbnailUrl": gallery_url,
                    "detailUrl": detail_url,
                    "previewUrl": detail_url,
                    "dimensions": {"width": int(catalog_row["width_900"]), "height": int(catalog_row["height_900"])},
                    "detailDimensions": {"width": int(catalog_row["width_1800"]), "height": int(catalog_row["height_1800"])},
                },
            },
            "cloudPdfSource": {
                "title": title,
                "imageUrl": detail_url,
                "publicKey": detail_key_path,
                "maxEdge": 1800,
                "mediaType": "photo",
                "dimensions": {"width": int(catalog_row["width_1800"]), "height": int(catalog_row["height_1800"])},
            },
            "realEstate": {
                "customer": "Corine",
                "mediaType": "photo",
                "sourceBytes": int(row["bytes"] or verification.get("bytes") or 0),
                "sourceDimensions": {"width": int(row["pixel_width"]), "height": int(row["pixel_height"])},
                "publicPreviewKeys": {"900": gallery_key_path, "1800": detail_key_path},
            },
        })

    digest = _receipt_digest(rows)
    generated_at = max(str(row.get("verified_at") or "") for row in rows)
    album_payload = [
        {
            "slug": album.slug,
            "title": album.title,
            "displayTitle": album.title,
            "sortIndex": index + 1,
            "photoCount": album_counts[album.fixture_id],
        }
        for index, album in enumerate(albums)
    ]
    manifest = {
        "schema": "photosbyelie.realEstateFixtureRelease.v1",
        "generatedAt": generated_at,
        "customer": {"name": "Corine", "username": "Corine"},
        "release": {
            "fixtureId": fixture_id,
            "galleryKey": gallery_key,
            "verifiedAssetCount": len(photos),
            "receiptSetSha256": digest,
            "r2Destination": "photosbyelie-private/masters",
            "applePhotosVerified": True,
        },
        "gallery": {
            "key": gallery_key,
            "title": "La Concha",
            "description": "Private La Concha selection gallery.",
            "accent": "spain",
            "deliverables": [],
            "photos": photos,
        },
        "albums": album_payload,
        "photos": photos,
        "deliverables": [],
    }
    worker_release = {
        "fixtureId": fixture_id,
        "privateMasterLayout": "flat",
        "privateMasterPrefix": "masters",
        "allowedPhotoIds": sorted(media_ids),
        "expectedItemCount": len(media_ids),
        "receiptSetSha256": digest,
    }
    return {"manifest": manifest, "workerRelease": worker_release}


def app_context_source(manifest: dict[str, Any]) -> str:
    payload = json.dumps(manifest, indent=2, sort_keys=True)
    return f"""(() => {{
  const payload = {payload};
  const photos = payload.photos || [];
  const gallery = {{
    ...(payload.gallery || {{}}),
    photos,
  }};
  window.photosByElieRealEstateImport = {{
    ...payload,
    gallery,
    photos,
  }};
  window.photosByElieRealEstateGalleryKey = gallery.key;
  window.photosByElieData = {{
    ...(window.photosByElieData || {{}}),
    [gallery.key]: gallery,
  }};
}})();
"""


def worker_release_source(gallery_key: str, release: dict[str, Any]) -> str:
    key = json.dumps(gallery_key)
    payload = json.dumps(release, indent=2, sort_keys=True)
    return f"""// Generated by scripts/release_fixture_real_estate_gallery.py. Do not edit by hand.
export const REAL_ESTATE_GALLERY_RELEASES = Object.freeze({{
  {key}: Object.freeze({payload}),
}});
"""


def _write_if_changed(path: Path, content: str) -> bool:
    if path.exists() and path.read_text(encoding="utf-8") == content:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner-db", type=Path, default=DEFAULT_OWNER_DB)
    parser.add_argument("--catalog-db", type=Path, default=DEFAULT_CATALOG_DB)
    parser.add_argument("--fixture-id", default="fixture-la-concha")
    parser.add_argument("--gallery-key", default="corine-real-estate")
    parser.add_argument("--expected-count", type=int, default=121)
    parser.add_argument("--context-output", type=Path, default=DEFAULT_CONTEXT)
    parser.add_argument("--worker-output", type=Path, default=DEFAULT_WORKER_RELEASE)
    parser.add_argument("--write", action="store_true", help="Write the checked release artifacts.")
    parser.add_argument("--check", action="store_true", help="Fail if checked-in artifacts differ from the receipt projection.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    release = build_release(
        args.owner_db,
        args.catalog_db,
        fixture_id=args.fixture_id,
        gallery_key=args.gallery_key,
        expected_count=args.expected_count,
    )
    context = app_context_source(release["manifest"])
    worker = worker_release_source(args.gallery_key, release["workerRelease"])
    expected = ((args.context_output, context), (args.worker_output, worker))
    if args.check:
        mismatches = [str(path) for path, content in expected if not path.exists() or path.read_text(encoding="utf-8") != content]
        if mismatches:
            raise SystemExit("Fixture release artifacts are stale: " + ", ".join(mismatches))
    changed: list[str] = []
    if args.write:
        changed = [str(path) for path, content in expected if _write_if_changed(path, content)]
    summary = {
        "ok": True,
        "mode": "write" if args.write else ("check" if args.check else "dry-run"),
        "fixtureId": args.fixture_id,
        "galleryKey": args.gallery_key,
        "verifiedAssetCount": release["manifest"]["release"]["verifiedAssetCount"],
        "receiptSetSha256": release["manifest"]["release"]["receiptSetSha256"],
        "albumCounts": {item["slug"]: item["photoCount"] for item in release["manifest"]["albums"]},
        "changed": changed,
    }
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
