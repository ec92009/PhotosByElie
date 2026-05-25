#!/usr/bin/env python3
"""Import private real-estate media exports for a client gallery/cloud-output workflow."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps


RAW_EXTENSIONS = {".raw", ".dng", ".nef", ".cr2", ".cr3", ".arw", ".orf", ".raf", ".rw2"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg"}
VIDEO_EXTENSIONS = {".mov", ".mp4", ".m4v"}
MEDIA_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS
DEFAULT_SOURCE_ROOT = Path("/Volumes/Saturn/Pictures/RE/Corine")
DEFAULT_OUTPUT_ROOT = Path("tmp/real-estate-import")
PDF_BATCH_SCHEMA = "photosbyelie.realEstatePdfBatch.v1"
DEFAULT_R2_ROOT = "real-estate"
ACCESS_CODE_HASH_ALGORITHM = "sha256-salt-v1"


def load_slideshow_music_policy(repo_root: Path) -> dict[str, Any]:
    path = repo_root / "assets" / "real-estate" / "slideshow-music.json"
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return {}


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "item"


def display_album_title(album: str) -> str:
    return re.sub(r"^RE\s+\d{4}\s+", "", album, flags=re.IGNORECASE).strip() or album


def image_dimensions(path: Path) -> dict[str, int]:
    with Image.open(path) as image:
        return {"width": int(image.width), "height": int(image.height)}


def is_video(path: Path) -> bool:
    return path.suffix.lower() in VIDEO_EXTENSIONS


def video_metadata(path: Path) -> dict[str, Any]:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,duration:format=duration",
        "-of",
        "json",
        str(path),
    ]
    try:
        result = subprocess.run(command, check=True, capture_output=True, text=True)
    except FileNotFoundError as error:
        raise RuntimeError("ffprobe is required to import real-estate videos.") from error
    except subprocess.CalledProcessError as error:
        raise RuntimeError(f"Could not inspect video {path}: {error.stderr.strip() or error}") from error

    payload = json.loads(result.stdout or "{}")
    stream = (payload.get("streams") or [{}])[0]
    duration = float(stream.get("duration") or (payload.get("format") or {}).get("duration") or 0)
    return {
        "width": int(stream.get("width") or 0),
        "height": int(stream.get("height") or 0),
        "durationSeconds": duration,
    }


def render_derivative(source: Path, destination: Path, max_edge: int, quality: int, force: bool) -> dict[str, Any]:
    if (
        destination.exists()
        and not force
        and destination.stat().st_mtime >= source.stat().st_mtime
    ):
        dimensions = image_dimensions(destination)
        return {
            "path": destination,
            "width": dimensions["width"],
            "height": dimensions["height"],
            "bytes": destination.stat().st_size,
            "rendered": False,
        }

    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image)
        image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        if image.mode not in {"RGB", "L"}:
            image = image.convert("RGB")
        if image.mode == "L":
            image = image.convert("RGB")
        image.save(destination, "JPEG", quality=quality, optimize=True, progressive=True)

    dimensions = image_dimensions(destination)
    return {
        "path": destination,
        "width": dimensions["width"],
        "height": dimensions["height"],
        "bytes": destination.stat().st_size,
        "rendered": True,
    }


def render_video_still_derivative(
    source: Path,
    destination: Path,
    max_edge: int,
    quality: int,
    force: bool,
    duration_seconds: float,
    percent: float = 10,
) -> dict[str, Any]:
    if (
        destination.exists()
        and not force
        and destination.stat().st_mtime >= source.stat().st_mtime
    ):
        dimensions = image_dimensions(destination)
        return {
            "path": destination,
            "width": dimensions["width"],
            "height": dimensions["height"],
            "bytes": destination.stat().st_size,
            "rendered": False,
        }

    destination.parent.mkdir(parents=True, exist_ok=True)
    seek_seconds = max(0, duration_seconds * (percent / 100))
    with tempfile.TemporaryDirectory(prefix="photosbyelie-re-video-still-") as temp_dir:
        frame_path = Path(temp_dir) / "frame.jpg"
        command = [
            "ffmpeg",
            "-y",
            "-ss",
            f"{seek_seconds:.3f}",
            "-i",
            str(source),
            "-frames:v",
            "1",
            "-q:v",
            "2",
            str(frame_path),
        ]
        try:
            subprocess.run(command, check=True, capture_output=True, text=True)
        except FileNotFoundError as error:
            raise RuntimeError("ffmpeg is required to import real-estate videos.") from error
        except subprocess.CalledProcessError as error:
            raise RuntimeError(f"Could not render video still for {source}: {error.stderr.strip() or error}") from error
        return render_derivative(frame_path, destination, max_edge, quality, force=True)


def repo_relative(path: Path, repo_root: Path) -> str:
    try:
        return path.resolve().relative_to(repo_root.resolve()).as_posix()
    except ValueError:
        return str(path)


def output_relative(path: Path, output_dir: Path) -> str:
    return path.resolve().relative_to(output_dir.resolve()).as_posix()


def key_prefix(value: str) -> str:
    return re.sub(r"/+", "/", value.strip().strip("/"))


def normalize_credential(value: str) -> str:
    return str(value or "").strip().casefold()


def access_code_hash(access_code: str, salt: str) -> str:
    normalized = normalize_credential(access_code)
    if not normalized or not salt:
        return ""
    return hashlib.sha256(f"{salt}:{normalized}".encode("utf-8")).hexdigest()


def emit_progress(enabled: bool, event: str, **payload: Any) -> None:
    if not enabled:
        return
    print(
        "PBE_IMPORT_PROGRESS " + json.dumps({"event": event, **payload}, sort_keys=True),
        flush=True,
    )


def emit_import_event(enabled: bool, kind: str, **payload: Any) -> None:
    if enabled:
        print(f"PBE_IMPORT_{kind} {json.dumps(payload, sort_keys=True)}", flush=True)


def real_estate_photo_identity(customer: str, album_name: str, source: Path) -> dict[str, str]:
    album_slug = slugify(album_name)
    photo_id = f"{slugify(customer)}-{album_slug}-{slugify(source.stem)}"
    return {
        "albumSlug": album_slug,
        "photoId": photo_id,
        "mediaType": "video" if is_video(source) else "photo",
        "relativePath": f"{album_name}/{source.name}",
    }


def scan_album_files(album_dir: Path) -> list[Path]:
    return sorted(
        path
        for path in album_dir.rglob("*")
        if path.is_file() and path.name != ".DS_Store" and path.suffix.lower() in MEDIA_EXTENSIONS
    )


def raw_files(root: Path) -> list[Path]:
    return sorted(
        path
        for path in root.rglob("*")
        if path.is_file() and path.suffix.lower() in RAW_EXTENSIONS
    )


def album_dirs(source_root: Path, requested_albums: list[str]) -> list[Path]:
    if requested_albums:
        album_paths = [source_root / album for album in requested_albums]
        missing = [album for album, path in zip(requested_albums, album_paths) if not path.is_dir()]
        existing = [path for path in album_paths if path.is_dir()]
        if missing:
            available = sorted(path.name for path in source_root.iterdir() if path.is_dir())
            available_text = ", ".join(available) if available else "none"
            missing_text = ", ".join(missing)
            print(
                f"Skipping missing property folder(s) under {source_root}: {missing_text}. "
                f"Available property folders: {available_text}.",
                file=sys.stderr,
            )
        if not existing:
            raise FileNotFoundError(f"No requested property folders were found under {source_root}.")
        return existing
    return sorted(path for path in source_root.iterdir() if path.is_dir())


def write_app_context(manifest: dict[str, Any], output_dir: Path) -> Path:
    payload = json.dumps(manifest, indent=2, sort_keys=True)
    context = f"""(() => {{
  const payload = {payload};
  const script = document.currentScript;
  const base = script?.src ? new URL("./", script.src) : new URL("./", window.location.href);
  const absoluteUrl = (value) => {{
    if (!value || /^(https?:|data:|blob:|\\/)/i.test(value)) return value || "";
    return new URL(value, base).href;
  }};
  const photos = (payload.photos || []).map((photo) => {{
    const publicPreview = photo.media?.publicPreview || {{}};
    const pdfSource = photo.cloudPdfSource || {{}};
    return {{
      ...photo,
      media: {{
        ...(photo.media || {{}}),
        publicPreview: {{
          ...publicPreview,
          galleryUrl: absoluteUrl(publicPreview.galleryUrl || photo.gallerySrc),
          detailUrl: absoluteUrl(publicPreview.detailUrl || photo.imageSrc),
          previewUrl: absoluteUrl(publicPreview.previewUrl || photo.imageSrc),
          thumbnailUrl: absoluteUrl(publicPreview.thumbnailUrl || photo.gallerySrc),
        }},
      }},
      cloudPdfSource: {{
        ...pdfSource,
        imageUrl: absoluteUrl(pdfSource.imageUrl),
      }},
    }};
  }});
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
    path = output_dir / "app-context.js"
    path.write_text(context, encoding="utf-8")
    return path


def pdf_batch_manifest_template(
    *,
    customer: str,
    gallery_key: str,
    import_generated_at: str,
) -> dict[str, Any]:
    return {
        "schema": PDF_BATCH_SCHEMA,
        "batchId": "",
        "createdAt": "",
        "galleryKey": gallery_key,
        "customer": customer,
        "sourceImportGeneratedAt": import_generated_at,
        "sourceBatchId": "",
        "pdfMode": "one-pdf-per-project",
        "projects": [
            {
                "projectId": "",
                "projectTitle": "",
                "sortIndex": 1,
                "items": [
                    {
                        "photoId": "",
                        "title": "",
                        "sortIndex": 1,
                        "mediaType": "photo",
                        "durationSeconds": None,
                        "pdfTreatment": "photo",
                        "pdfStillPercent": None,
                        "slideshowDurationPolicy": "fixed-photo-duration",
                        "slideshowDurationSeconds": 4,
                        "sourceVideoPrivateKey": "",
                        "sourceDurationSeconds": None,
                        "projectId": "",
                        "projectTitle": "",
                    }
                ],
            }
        ],
        "items": [
            {
                "photoId": "",
                "title": "",
                "sortIndex": 1,
                "mediaType": "photo",
                "durationSeconds": None,
                "pdfTreatment": "photo",
                "pdfStillPercent": None,
                "slideshowDurationPolicy": "fixed-photo-duration",
                "slideshowDurationSeconds": 4,
                "sourceVideoPrivateKey": "",
                "sourceDurationSeconds": None,
                "projectId": "",
                "projectTitle": "",
                "projectIds": [],
            }
        ],
    }


def build_manifest(
    *,
    repo_root: Path,
    source_root: Path,
    output_dir: Path,
    customer: str,
    username: str,
    email: str,
    access_code: str,
    access_code_salt: str,
    gallery_key: str,
    gallery_title: str,
    public_key_prefix: str,
    private_key_prefix: str,
    albums: list[Path],
    preview_900_max_edge: int,
    preview_1800_max_edge: int,
    preview_900_quality: int,
    preview_1800_quality: int,
    force: bool,
    progress_json: bool = False,
) -> dict[str, Any]:
    photos: list[dict[str, Any]] = []
    album_entries: list[dict[str, Any]] = []
    total_source_bytes = 0
    total_preview_900_bytes = 0
    total_preview_1800_bytes = 0
    rendered_preview_900 = 0
    rendered_preview_1800 = 0
    album_sources: list[tuple[int, Path, list[Path]]] = []

    for album_index, album_dir in enumerate(albums, start=1):
        if not album_dir.exists() or not album_dir.is_dir():
            raise FileNotFoundError(f"Album folder not found: {album_dir}")
        album_sources.append((album_index, album_dir, scan_album_files(album_dir)))

    total_media_count = sum(len(sources) for _album_index, _album_dir, sources in album_sources)
    completed_media_count = 0
    emit_import_event(
        progress_json,
        "QUEUE_START",
        seen=total_media_count,
        inspected=total_media_count,
        queued=total_media_count,
        alreadySelected=0,
        processed=0,
        active=0,
        queueDepth=total_media_count,
    )
    queued_index = 0
    for _album_index, album_dir, sources in album_sources:
        for source in sources:
            queued_index += 1
            identity = real_estate_photo_identity(customer, album_dir.name, source)
            emit_import_event(
                progress_json,
                "PHOTO",
                index=queued_index,
                photoId=identity["photoId"],
                relativePath=identity["relativePath"],
                sourcePath=str(source),
                country=slugify(customer),
                mediaType=identity["mediaType"],
                status="queued",
            )
    emit_import_event(
        progress_json,
        "SCAN_DONE",
        seen=total_media_count,
        inspected=total_media_count,
        queued=total_media_count,
        alreadySelected=0,
        processed=0,
        active=0,
        queueDepth=total_media_count,
    )
    emit_progress(
        progress_json,
        "start",
        total=total_media_count,
        completed=0,
        albumCount=len(album_sources),
    )

    for album_index, album_dir, sources in album_sources:
        album_name = album_dir.name
        album_slug = slugify(album_name)
        album_title = display_album_title(album_name)
        emit_progress(
            progress_json,
            "album",
            total=total_media_count,
            completed=completed_media_count,
            album=album_name,
            albumIndex=album_index,
            albumTotal=len(album_sources),
            albumMediaCount=len(sources),
        )
        album_entries.append({
            "title": album_name,
            "displayTitle": album_title,
            "slug": album_slug,
            "sourcePath": str(album_dir),
            "photoCount": len(sources),
            "sortIndex": album_index,
        })

        for photo_index, source in enumerate(sources, start=1):
            source_bytes = source.stat().st_size
            total_source_bytes += source_bytes
            identity = real_estate_photo_identity(customer, album_name, source)
            photo_id = identity["photoId"]
            default_title = f"{album_title} - {photo_index:02d}"
            media_type = identity["mediaType"]
            emit_import_event(
                progress_json,
                "QUEUE_PROGRESS",
                seen=total_media_count,
                inspected=total_media_count,
                queued=total_media_count,
                alreadySelected=0,
                processed=completed_media_count,
                active=1,
                queueDepth=max(0, total_media_count - completed_media_count - 1),
            )
            emit_import_event(
                progress_json,
                "PHOTO",
                index=completed_media_count + 1,
                photoId=photo_id,
                relativePath=identity["relativePath"],
                sourcePath=str(source),
                country=slugify(customer),
                mediaType=media_type,
                status="running",
            )
            emit_import_event(
                progress_json,
                "STEP",
                photoId=photo_id,
                relativePath=identity["relativePath"],
                sourcePath=str(source),
                mediaType=media_type,
                step="triplets_created",
                status="skipped",
                reason="Real Estate lane does not create private JPG triplets",
            )
            emit_import_event(
                progress_json,
                "STEP",
                photoId=photo_id,
                relativePath=identity["relativePath"],
                sourcePath=str(source),
                mediaType=media_type,
                step="triplets_uploaded",
                status="skipped",
                reason="Real Estate lane does not upload private JPG triplets",
            )
            video_info = video_metadata(source) if media_type == "video" else {}
            video_still_percent = 10
            preview_900_path = output_dir / "previews" / album_slug / f"{photo_id}_900.jpg"
            preview_1800_path = output_dir / "previews" / album_slug / f"{photo_id}_1800.jpg"
            if media_type == "video":
                duration_seconds = float(video_info.get("durationSeconds") or 0)
                preview_900_render = render_video_still_derivative(
                    source,
                    preview_900_path,
                    preview_900_max_edge,
                    preview_900_quality,
                    force,
                    duration_seconds,
                    video_still_percent,
                )
                preview_1800_render = render_video_still_derivative(
                    source,
                    preview_1800_path,
                    preview_1800_max_edge,
                    preview_1800_quality,
                    force,
                    duration_seconds,
                    video_still_percent,
                )
                original_dimensions = {
                    "width": int(video_info.get("width") or preview_1800_render["width"]),
                    "height": int(video_info.get("height") or preview_1800_render["height"]),
                }
            else:
                preview_900_render = render_derivative(source, preview_900_path, preview_900_max_edge, preview_900_quality, force)
                preview_1800_render = render_derivative(source, preview_1800_path, preview_1800_max_edge, preview_1800_quality, force)
                original_dimensions = image_dimensions(source)
            rendered_preview_900 += 1 if preview_900_render["rendered"] else 0
            rendered_preview_1800 += 1 if preview_1800_render["rendered"] else 0
            total_preview_900_bytes += int(preview_900_render["bytes"])
            total_preview_1800_bytes += int(preview_1800_render["bytes"])
            emit_import_event(
                progress_json,
                "STEP",
                photoId=photo_id,
                relativePath=identity["relativePath"],
                sourcePath=str(source),
                mediaType=media_type,
                step="previews_created",
                total=2,
                completed=2,
            )

            preview_900_rel = output_relative(preview_900_path, output_dir)
            preview_1800_rel = output_relative(preview_1800_path, output_dir)
            preview_900_key = f"{public_key_prefix}/{album_slug}/{photo_id}_900.jpg"
            preview_1800_key = f"{public_key_prefix}/{album_slug}/{photo_id}_1800.jpg"
            private_master_key = f"{private_key_prefix}/{album_slug}/{photo_id}{source.suffix.lower()}"
            metadata = [
                {"label": "Client", "value": customer},
                {"label": "Album", "value": album_name},
                {"label": "Original file", "value": source.name},
                {"label": "Original size", "value": f"{original_dimensions['width']} x {original_dimensions['height']}"},
                {"label": "Preview 900", "value": f"{preview_900_render['width']} x {preview_900_render['height']}"},
                {"label": "Preview 1800", "value": f"{preview_1800_render['width']} x {preview_1800_render['height']}"},
            ]
            if media_type == "video":
                metadata.insert(3, {"label": "Media type", "value": "Video"})
                metadata.insert(4, {"label": "Duration", "value": f"{float(video_info.get('durationSeconds') or 0):.2f} seconds"})
                metadata.append({"label": "PDF still", "value": f"{video_still_percent}% into video"})
            photos.append({
                "id": photo_id,
                "title": default_title,
                "editableTitle": default_title,
                "caption": album_title,
                "className": "real-estate-photo" + (" real-estate-video" if media_type == "video" else ""),
                "full": source.name,
                "gallerySrc": preview_900_rel,
                "imageSrc": preview_1800_rel,
                "album": album_name,
                "albumSlug": album_slug,
                "albumTitle": album_title,
                "sortIndex": len(photos) + 1,
                "metadata": metadata,
                "media": {
                    "type": media_type,
                    **({
                        "video": {
                            "durationSeconds": float(video_info.get("durationSeconds") or 0),
                            "durationPolicy": "preserve-source-duration",
                            "posterPercent": video_still_percent,
                        },
                    } if media_type == "video" else {}),
                    "publicPreview": {
                        "allowed": True,
                        "galleryKey": preview_900_key,
                        "detailKey": preview_1800_key,
                        "galleryUrl": preview_900_rel,
                        "thumbnailUrl": preview_900_rel,
                        "detailUrl": preview_1800_rel,
                        "previewUrl": preview_1800_rel,
                        "dimensions": {
                            "width": int(preview_900_render["width"]),
                            "height": int(preview_900_render["height"]),
                        },
                        "detailDimensions": {
                            "width": int(preview_1800_render["width"]),
                            "height": int(preview_1800_render["height"]),
                        },
                    },
                },
                "cloudPdfSource": {
                    "title": default_title,
                    "imageUrl": preview_1800_rel,
                    "publicKey": preview_1800_key,
                    "maxEdge": preview_1800_max_edge,
                    "mediaType": media_type,
                    **({
                        "videoStillPercent": video_still_percent,
                        "sourceVideoPrivateKey": private_master_key,
                        "sourceDurationSeconds": float(video_info.get("durationSeconds") or 0),
                    } if media_type == "video" else {}),
                    "dimensions": {
                        "width": int(preview_1800_render["width"]),
                        "height": int(preview_1800_render["height"]),
                    },
                    "bytes": int(preview_1800_render["bytes"]),
                },
                "realEstate": {
                    "customer": customer,
                    "mediaType": media_type,
                    "sourcePath": str(source),
                    "sourceBytes": source_bytes,
                    "sourceDimensions": original_dimensions,
                    **({
                        "videoDurationSeconds": float(video_info.get("durationSeconds") or 0),
                        "videoStillPercent": video_still_percent,
                    } if media_type == "video" else {}),
                    "privateMasterKey": private_master_key,
                    "preview900Path": repo_relative(preview_900_path, repo_root),
                    "preview1800Path": repo_relative(preview_1800_path, repo_root),
                    "publicPreviewKeys": {
                        "900": preview_900_key,
                        "1800": preview_1800_key,
                    },
                },
            })
            completed_media_count += 1
            emit_import_event(
                progress_json,
                "QUEUE_PROGRESS",
                seen=total_media_count,
                inspected=total_media_count,
                queued=total_media_count,
                alreadySelected=0,
                processed=completed_media_count,
                active=0,
                queueDepth=max(0, total_media_count - completed_media_count),
            )
            emit_progress(
                progress_json,
                "media",
                total=total_media_count,
                completed=completed_media_count,
                album=album_name,
                file=source.name,
                mediaType=media_type,
            )

    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    credential_hash = access_code_hash(access_code, access_code_salt)
    customer_payload = {
        "name": customer,
        "username": username or customer,
    }
    if email:
        customer_payload["email"] = email
    if credential_hash:
        customer_payload.update({
            "accessCodeHash": credential_hash,
            "accessCodeSalt": access_code_salt,
            "accessCodeAlgorithm": ACCESS_CODE_HASH_ALGORITHM,
        })

    manifest = {
        "schema": "photosbyelie.realEstateImport.v1",
        "generatedAt": generated_at,
        "customer": customer_payload,
        "sourceRoot": str(source_root),
        "outputRoot": repo_relative(output_dir, repo_root),
        "r2": {
            "publicBucket": "photosbyelie-public",
            "privateBucket": "photosbyelie-private",
            "publicPreviewPrefix": public_key_prefix,
            "privateMasterPrefix": private_key_prefix,
        },
        "gallery": {
            "key": gallery_key,
            "title": gallery_title,
            "description": "Private real-estate selection gallery for project PDF and slideshow assembly.",
            "accent": "spain",
            "deliverables": [],
            "photos": photos,
        },
        "albums": album_entries,
        "photos": photos,
        "deliverables": [],
        "cloudPdfWorkflow": {
            "titleField": "editableTitle",
            "selectionStoreKey": f"photosbyelie-real-estate-liked-{gallery_key}",
            "titleStoreKey": f"photosbyelie-real-estate-titles-{gallery_key}",
            "projectStoreKey": f"photosbyelie-real-estate-projects-{gallery_key}",
            "imageField": "cloudPdfSource.imageUrl",
            "cloudImageKeyField": "cloudPdfSource.publicKey",
            "mode": "one-output-per-project",
            "assembly": "Cloud service receives selected media ids grouped by apartment project plus edited titles, then generates one PDF or slideshow per project on demand. Slideshows choose one single-guitar cue at random, keep generated music at 0 dB, and mix source video audio 20 dB lower; videos keep source duration in slideshow output and use the 10% still frame in PDFs.",
            "slideshowMusic": load_slideshow_music_policy(repo_root),
            "batchManifest": {
                "schema": PDF_BATCH_SCHEMA,
                "batchIdFormat": "YYYYMMDDTHHMMSSZ",
                "storageKeyPattern": f"real-estate/pdf-batches/{gallery_key}/{{batchId}}.json",
                "retrievalOrder": "createdAt desc",
                "projectFields": ["projectId", "projectTitle", "sortIndex", "items"],
                "itemFields": ["photoId", "title", "sortIndex", "mediaType", "durationSeconds", "pdfTreatment", "pdfStillPercent", "slideshowDurationPolicy", "slideshowDurationSeconds", "sourceVideoPrivateKey", "sourceDurationSeconds", "projectId", "projectTitle", "projectIds", "transition", "effect", "outputTreatment"],
                "resumeBehavior": "Loading a prior batch manifest seeds the selected media IDs and edited titles by project; generating PDFs or slideshow plans from that draft writes a new timestamped batch manifest with sourceBatchId set to the prior batchId.",
                "template": pdf_batch_manifest_template(
                    customer=customer,
                    gallery_key=gallery_key,
                    import_generated_at=generated_at,
                ),
            },
            "largeFileMitigation": "Importer prepares cloud PDF/slideshow source metadata instead of final outputs; final assembly/download belongs to the cloud path so the browser does not build one huge Blob locally.",
        },
        "stats": {
            "albumCount": len(album_entries),
            "photoCount": len(photos),
            "imageCount": sum(1 for photo in photos if ((photo.get("media") or {}).get("type") == "photo")),
            "videoCount": sum(1 for photo in photos if ((photo.get("media") or {}).get("type") == "video")),
            "sourceBytes": total_source_bytes,
            "preview900Bytes": total_preview_900_bytes,
            "preview1800Bytes": total_preview_1800_bytes,
            "preview900Rendered": rendered_preview_900,
            "preview1800Rendered": rendered_preview_1800,
            "preview900MaxEdge": preview_900_max_edge,
            "preview1800MaxEdge": preview_1800_max_edge,
        },
    }
    emit_progress(progress_json, "done", total=total_media_count, completed=completed_media_count)
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build ignored Real Estate gallery/cloud-PDF source assets from customer photo/video exports."
    )
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--customer", default="Corine")
    parser.add_argument("--username", default="", help="Client username. Defaults to --customer.")
    parser.add_argument("--email", default="", help="Client email address accepted for login.")
    parser.add_argument("--access-code", default="LaConcha")
    parser.add_argument("--access-code-env", default="", help="Read the access code from this environment variable.")
    parser.add_argument("--access-code-salt", default="", help="Salt used for the public access-code hash. Defaults to a generated random salt.")
    parser.add_argument("--gallery-key", default="")
    parser.add_argument("--gallery-title", default="")
    parser.add_argument("--public-key-prefix", default="", help="R2 public preview key prefix. Default: real-estate/<gallery-key>/previews.")
    parser.add_argument("--private-key-prefix", default="", help="R2 private master key prefix. Default: real-estate/<gallery-key>/masters.")
    parser.add_argument("--album", action="append", default=[], help="Album folder name to import. Repeatable.")
    parser.add_argument("--progress-json", action="store_true", help="Emit machine-readable import progress lines.")
    parser.add_argument("--preview-900-max-edge", "--gallery-max-edge", dest="preview_900_max_edge", type=int, default=900)
    parser.add_argument("--preview-1800-max-edge", "--pdf-source-max-edge", "--pdf-max-edge", dest="preview_1800_max_edge", type=int, default=1800)
    parser.add_argument("--preview-900-quality", "--gallery-quality", dest="preview_900_quality", type=int, default=84)
    parser.add_argument("--preview-1800-quality", "--pdf-source-quality", "--pdf-quality", dest="preview_1800_quality", type=int, default=88)
    parser.add_argument("--force", action="store_true", help="Re-render existing derivatives.")
    parser.add_argument("--allow-raw-present", action="store_true", help="Do not fail when RAW/DNG/NEF files are present near the source media.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = Path.cwd()
    source_root = args.source_root.expanduser()
    if not source_root.exists() or not source_root.is_dir():
        print(f"Source root not found: {source_root}", file=sys.stderr)
        return 1

    raw_hits = raw_files(source_root)
    if raw_hits and not args.allow_raw_present:
        print("RAW/DNG/NEF files are present; refusing to import until the customer export is final JPG/video media only.", file=sys.stderr)
        for path in raw_hits[:25]:
            print(f"  {path}", file=sys.stderr)
        if len(raw_hits) > 25:
            print(f"  ... and {len(raw_hits) - 25} more", file=sys.stderr)
        return 1

    customer_slug = slugify(args.customer)
    username = args.username or args.customer
    access_code = os.environ.get(args.access_code_env, args.access_code) if args.access_code_env else args.access_code
    access_code_salt = args.access_code_salt or secrets.token_hex(16)
    gallery_key = args.gallery_key or f"{customer_slug}-real-estate"
    gallery_title = args.gallery_title or f"{args.customer} Real Estate"
    public_key_prefix = key_prefix(args.public_key_prefix or f"{DEFAULT_R2_ROOT}/{gallery_key}/previews")
    private_key_prefix = key_prefix(args.private_key_prefix or f"{DEFAULT_R2_ROOT}/{gallery_key}/masters")
    output_dir = args.output_root / customer_slug
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        albums = album_dirs(source_root, args.album)
        if not albums:
            print(f"No album folders found in {source_root}", file=sys.stderr)
            return 1

        manifest = build_manifest(
            repo_root=repo_root,
            source_root=source_root,
            output_dir=output_dir,
            customer=args.customer,
            username=username,
            email=args.email.strip(),
            access_code=access_code,
            access_code_salt=access_code_salt,
            gallery_key=gallery_key,
            gallery_title=gallery_title,
            public_key_prefix=public_key_prefix,
            private_key_prefix=private_key_prefix,
            albums=albums,
            preview_900_max_edge=args.preview_900_max_edge,
            preview_1800_max_edge=args.preview_1800_max_edge,
            preview_900_quality=args.preview_900_quality,
            preview_1800_quality=args.preview_1800_quality,
            force=args.force,
            progress_json=args.progress_json,
        )
    except (FileNotFoundError, ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    app_context_path = write_app_context(manifest, output_dir)
    batch_template_path = output_dir / "pdf-batch-template.json"
    batch_template_path.write_text(
        json.dumps(manifest["cloudPdfWorkflow"]["batchManifest"]["template"], indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    summary_path = output_dir / "summary.json"
    summary_path.write_text(json.dumps({
        "generatedAt": manifest["generatedAt"],
        "customer": manifest["customer"]["name"],
        "sourceRoot": manifest["sourceRoot"],
        "outputRoot": manifest["outputRoot"],
        "albums": manifest["albums"],
        "stats": manifest["stats"],
        "manifestPath": repo_relative(manifest_path, repo_root),
        "appContextPath": repo_relative(app_context_path, repo_root),
        "batchTemplatePath": repo_relative(batch_template_path, repo_root),
    }, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    stats = manifest["stats"]
    print(f"Imported {stats['photoCount']} media files ({stats['imageCount']} photos, {stats['videoCount']} videos) across {stats['albumCount']} albums for {args.customer}.")
    print(f"Preview 900 images: {stats['preview900Rendered']} rendered, {stats['preview900Bytes']} bytes total.")
    print(f"Preview 1800 images: {stats['preview1800Rendered']} rendered, {stats['preview1800Bytes']} bytes total.")
    print(f"Manifest: {repo_relative(manifest_path, repo_root)}")
    print(f"App context: {repo_relative(app_context_path, repo_root)}")
    print(f"PDF batch template: {repo_relative(batch_template_path, repo_root)}")
    print(f"Summary: {repo_relative(summary_path, repo_root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
