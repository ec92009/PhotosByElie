#!/usr/bin/env python3
"""Prepare verified 60-second slideshow music clips without uploading them.

The source manifest and source audio are never modified. Dry-run is the
default; ``--execute`` writes clips and a derived manifest below ``tmp/``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shlex
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = REPO_ROOT / "assets/music/slideshow-guitar/pixabay/pixabay-guitar-candidates.json"
DEFAULT_OUTPUT_ROOT = REPO_ROOT / "tmp/slideshow-music-clips"
PUBLIC_BUCKET = "photosbyelie-public"


def sha256_file(file_path: Path) -> str:
    """Return a streaming SHA-256 digest for a file."""
    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(command: list[str]) -> subprocess.CompletedProcess[bytes]:
    """Run a subprocess and include stderr in failures."""
    try:
        return subprocess.run(command, check=True, capture_output=True)
    except subprocess.CalledProcessError as error:
        detail = error.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"Command failed: {shlex.join(command)}\n{detail}") from error


def probe_audio(file_path: Path, ffprobe: str) -> dict[str, Any]:
    """Read audio duration and stream metadata with ffprobe."""
    result = run([
        ffprobe, "-v", "error", "-show_entries",
        "format=duration:stream=codec_name,codec_type,sample_rate,channels",
        "-of", "json", str(file_path),
    ])
    payload = json.loads(result.stdout.decode("utf-8"))
    streams = [item for item in payload.get("streams", []) if item.get("codec_type") == "audio"]
    if not streams:
        raise ValueError(f"No audio stream found in {file_path}")
    duration = float((payload.get("format") or {}).get("duration") or 0)
    if duration <= 0:
        raise ValueError(f"Invalid audio duration for {file_path}: {duration}")
    stream = streams[0]
    return {
        "duration": duration,
        "codec": str(stream.get("codec_name") or ""),
        "sampleRate": int(stream.get("sample_rate") or 0),
        "channels": int(stream.get("channels") or 0),
    }


def verify_fade(file_path: Path, duration: float, ffmpeg: str) -> dict[str, Any]:
    """Confirm the decoded final 100 ms is quieter than pre-fade audio."""
    window = min(1.25, duration)
    result = run([
        ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error",
        "-ss", f"{max(0.0, duration - window):.6f}", "-i", str(file_path),
        "-t", f"{window:.6f}", "-vn", "-ac", "1", "-ar", "8000",
        "-f", "f32le", "pipe:1",
    ])
    count = len(result.stdout) // 4
    if count < 800:
        raise ValueError(f"Not enough decoded samples to verify fade for {file_path}")
    samples = struct.unpack(f"<{count}f", result.stdout[: count * 4])

    def rms(values: tuple[float, ...]) -> float:
        return math.sqrt(sum(value * value for value in values) / max(1, len(values)))

    pre_count = min(1200, max(400, count // 8))
    tail_count = min(800, max(200, count // 12))
    before = rms(samples[:pre_count])
    tail = rms(samples[-tail_count:])
    verified = tail <= max(before * 0.35, 1e-5)
    if not verified:
        raise ValueError(
            f"Fade verification failed for {file_path}: pre={before:.7f}, tail={tail:.7f}"
        )
    return {"verified": True, "preFadeRms": before, "tailRms": tail}


def safe_repo_path(raw_path: str) -> Path:
    """Resolve a manifest path and reject traversal outside the repo."""
    relative = str(raw_path or "").strip().removeprefix("./")
    resolved = (REPO_ROOT / relative).resolve()
    if resolved != REPO_ROOT and REPO_ROOT not in resolved.parents:
        raise ValueError(f"Audio path escapes repository: {raw_path}")
    return resolved


def duration_label(seconds: float) -> str:
    """Return a stable path label for the configured clip duration."""
    return f"{int(seconds):03d}s" if seconds.is_integer() else f"{seconds:g}s"


def clip_r2_key(track: dict[str, Any], seconds: float) -> str:
    """Create a separate R2 key while retaining the track's original key."""
    original = str(track.get("r2Key") or track["src"]).removeprefix("./")
    asset_path = Path(original)
    if asset_path.is_absolute() or ".." in asset_path.parts:
        raise ValueError(f"Unsafe R2 audio key: {original}")
    seconds_label = duration_label(seconds)
    return str(asset_path.parent / f"clips-{seconds_label}" / f"{asset_path.stem}-clip-{seconds_label}.mp3")


def validate_manifest(manifest_path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Validate stable identity and source paths before any writes occur."""
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    tracks = payload.get("tracks")
    if not isinstance(tracks, list) or not tracks:
        raise ValueError(f"Manifest has no tracks: {manifest_path}")
    seen: set[str] = set()
    validated: list[dict[str, Any]] = []
    for index, original in enumerate(tracks):
        if not isinstance(original, dict):
            raise ValueError(f"Track {index} is not an object in {manifest_path}")
        track = dict(original)
        track_id = str(track.get("id") or "").strip()
        if not track_id or track_id in seen:
            raise ValueError(f"Track {index} has a missing or duplicate id in {manifest_path}: {track_id!r}")
        seen.add(track_id)
        source_path = safe_repo_path(str(track.get("src") or ""))
        if not source_path.is_file():
            raise FileNotFoundError(f"Source audio is missing for {track_id}: {source_path}")
        local_file = str(track.get("localFile") or "").strip()
        if local_file and (manifest_path.parent / local_file).resolve() != source_path:
            raise ValueError(f"localFile and src disagree for {track_id}")
        validated.append({"track": track, "sourcePath": source_path})
    return payload, validated


def manifest_output_dir(output_root: Path, manifest_path: Path) -> Path:
    """Give each source manifest a stable, collision-resistant staging folder."""
    relative = manifest_path.resolve().relative_to(REPO_ROOT)
    return output_root / "__".join(relative.with_suffix("").parts)


def render_clip(
    source_path: Path,
    clip_path: Path,
    seconds: float,
    fade_seconds: float,
    ffmpeg: str,
) -> None:
    """Transcode a uniformly bounded clip with a one-second fade-out."""
    clip_path.parent.mkdir(parents=True, exist_ok=True)
    fade_start = seconds - fade_seconds
    with tempfile.NamedTemporaryFile(dir=clip_path.parent, suffix=".mp3", delete=False) as handle:
        temp_path = Path(handle.name)
    try:
        run([
            ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-stream_loop", "-1", "-i", str(source_path), "-map", "0:a:0", "-vn",
            "-t", f"{seconds:.6f}", "-af", f"afade=t=out:st={fade_start:.6f}:d={fade_seconds:.6f}",
            "-codec:a", "libmp3lame", "-b:a", "192k", "-ar", "48000", "-ac", "2",
            "-map_metadata", "-1", str(temp_path),
        ])
        os.replace(temp_path, clip_path)
    finally:
        temp_path.unlink(missing_ok=True)


def atomic_json(file_path: Path, payload: dict[str, Any]) -> None:
    """Write JSON atomically."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = file_path.with_suffix(file_path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(temp_path, file_path)


def prepare_manifest(
    manifest_path: Path,
    output_root: Path,
    seconds: float,
    fade_seconds: float,
    execute: bool,
    force: bool,
    ffmpeg: str,
    ffprobe: str,
) -> dict[str, Any]:
    """Plan or build all clips for one validated manifest."""
    payload, validated = validate_manifest(manifest_path)
    stage_dir = manifest_output_dir(output_root, manifest_path)
    prepared_tracks: list[dict[str, Any]] = []
    clip_rows: list[dict[str, Any]] = []
    for item in validated:
        track = item["track"]
        source_path = item["sourcePath"]
        source_probe = probe_audio(source_path, ffprobe)
        source_hash = sha256_file(source_path)
        key = clip_r2_key(track, seconds)
        clip_path = stage_dir / "clips" / Path(key).name
        sidecar_path = clip_path.with_suffix(".mp3.json")
        expected = {
            "sourceSha256": source_hash,
            "clipSeconds": seconds,
            "fadeOutSeconds": fade_seconds,
            "r2Key": key,
        }
        clip_meta: dict[str, Any] | None = None
        state = "planned"
        if execute and clip_path.exists() and sidecar_path.exists() and not force:
            prior = json.loads(sidecar_path.read_text(encoding="utf-8"))
            if all(prior.get(name) == value for name, value in expected.items()):
                clip_probe = probe_audio(clip_path, ffprobe)
                clip_hash = sha256_file(clip_path)
                if clip_hash == prior.get("sha256") and abs(clip_probe["duration"] - seconds) <= 0.15:
                    verify_fade(clip_path, clip_probe["duration"], ffmpeg)
                    clip_meta = prior
                    state = "reused"
            if clip_meta is None:
                raise FileExistsError(f"Prepared clip changed; rerun with --force after review: {clip_path}")
        elif execute:
            render_clip(source_path, clip_path, seconds, fade_seconds, ffmpeg)
            clip_probe = probe_audio(clip_path, ffprobe)
            if abs(clip_probe["duration"] - seconds) > 0.15:
                raise ValueError(f"Prepared duration is not {seconds:g}s for {clip_path}: {clip_probe['duration']}")
            fade = verify_fade(clip_path, clip_probe["duration"], ffmpeg)
            clip_meta = {
                **expected,
                "sha256": sha256_file(clip_path),
                "sourceDuration": source_probe["duration"],
                "duration": clip_probe["duration"],
                "codec": clip_probe["codec"],
                "sampleRate": clip_probe["sampleRate"],
                "channels": clip_probe["channels"],
                "sourceLooped": source_probe["duration"] < seconds,
                "fadeVerification": fade,
            }
            atomic_json(sidecar_path, clip_meta)
            state = "created"
        prepared_track = dict(track)
        prepared_track["preparedClip"] = clip_meta or {
            **expected,
            "sourceDuration": source_probe["duration"],
            "state": "planned",
        }
        prepared_tracks.append(prepared_track)
        clip_rows.append({
            "id": track["id"], "state": state, "source": str(source_path.relative_to(REPO_ROOT)),
            "output": str(clip_path), "r2Key": key,
        })

    derived = dict(payload)
    derived["preparedClipPolicy"] = {
        "schema": "photosbyelie.slideshowMusicPreparedClips.v1",
        "clipSeconds": seconds,
        "fadeOutSeconds": fade_seconds,
        "sourceManifest": str(manifest_path.relative_to(REPO_ROOT)),
        "sourceManifestSha256": sha256_file(manifest_path),
        "originalTrackFieldsPreserved": True,
    }
    derived["tracks"] = prepared_tracks
    prepared_manifest = stage_dir / "prepared-manifest.json"
    upload_script = stage_dir / "upload-commands.sh"
    if execute:
        atomic_json(prepared_manifest, derived)
        manifest_key = str(manifest_path.relative_to(REPO_ROOT).with_name(
            f"{manifest_path.stem}-prepared-{duration_label(seconds)}.json"
        ))
        lines = ["#!/bin/zsh", "set -euo pipefail"]
        for row in clip_rows:
            lines.append(
                f"npx wrangler r2 object put {shlex.quote(PUBLIC_BUCKET + '/' + row['r2Key'])} "
                f"--file {shlex.quote(row['output'])} --content-type audio/mpeg --remote"
            )
        lines.append(
            f"npx wrangler r2 object put {shlex.quote(PUBLIC_BUCKET + '/' + manifest_key)} "
            f"--file {shlex.quote(str(prepared_manifest))} --content-type application/json --remote"
        )
        upload_script.write_text("\n".join(lines) + "\n", encoding="utf-8")
        upload_script.chmod(0o755)
    return {
        "manifest": str(manifest_path.relative_to(REPO_ROOT)),
        "mode": "execute" if execute else "dry-run",
        "trackCount": len(clip_rows),
        "createdCount": sum(row["state"] == "created" for row in clip_rows),
        "reusedCount": sum(row["state"] == "reused" for row in clip_rows),
        "preparedManifest": str(prepared_manifest),
        "uploadScript": str(upload_script),
        "clips": clip_rows,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", action="append", type=Path, help="Source manifest; repeat for more than one.")
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
    parser.add_argument("--seconds", type=float, default=60.0)
    parser.add_argument("--fade-seconds", type=float, default=1.0)
    parser.add_argument("--execute", action="store_true", help="Write clips below tmp/. Default is dry-run.")
    parser.add_argument("--force", action="store_true", help="Replace only generated staging clips that fail reuse checks.")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if args.seconds <= 0 or args.fade_seconds <= 0 or args.fade_seconds >= args.seconds:
        parser.error("--seconds must be positive and --fade-seconds must be between zero and --seconds")
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        parser.error("ffmpeg and ffprobe must both be installed and on PATH")
    manifests = args.manifest or [DEFAULT_MANIFEST]
    try:
        reports = [
            prepare_manifest(
                item.resolve(), args.output_root.resolve(), args.seconds, args.fade_seconds,
                args.execute, args.force, ffmpeg, ffprobe,
            )
            for item in manifests
        ]
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as error:
        parser.exit(1, f"error: {error}\n")
    result = {"ok": True, "mode": "execute" if args.execute else "dry-run", "manifests": reports}
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"Slideshow music clip preparation ({result['mode']})")
        for report in reports:
            print(f"- {report['manifest']}: {report['trackCount']} tracks, "
                  f"{report['createdCount']} created, {report['reusedCount']} reused")
            print(f"  prepared manifest: {report['preparedManifest']}")
            print(f"  upload commands: {report['uploadScript']}")
        if not args.execute:
            print("No files were written. Add --execute after reviewing this plan.")
        else:
            print("No files were uploaded. Review hashes/probes, then run the generated upload script explicitly.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
