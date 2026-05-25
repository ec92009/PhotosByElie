#!/usr/bin/env python3
"""Render a local real-estate slideshow proof video with music.

The default proof pulls random still photos from the Elie real-estate context,
applies random Ken Burns-style motion, chooses one configured single-guitar cue
at random, and mixes music at 0 dB. The shared slideshow music config also
records the production rule for videos: source video audio is mixed 20 dB under
the generated music.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import random
import re
import secrets
import subprocess
import tempfile
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONTEXT = ROOT / "tmp" / "real-estate-import" / "elie" / "app-context.js"
FALLBACK_CONTEXT = ROOT / "assets" / "real-estate" / "elie" / "app-context.js"
MUSIC_CONFIG = ROOT / "assets" / "real-estate" / "slideshow-music.json"
OUTPUT_ROOT = ROOT / "tmp" / "real-estate-slideshows"
FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"
FPS = 30
SIZE = "1920x1080"
WORK_WIDTH = 2304
WORK_HEIGHT = 1296


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def ffprobe_duration(path: Path) -> float:
    result = subprocess.run(
        [
            FFPROBE,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip() or 0)


def load_context(path: Path) -> dict[str, Any]:
    text = path.read_text()
    match = re.search(r"const payload =\s*", text)
    if not match:
        raise RuntimeError(f"Could not locate payload JSON in {path}")
    start = text.find("{", match.end())
    if start < 0:
        raise RuntimeError(f"Could not locate payload object in {path}")
    depth = 0
    in_string = False
    escaped = False
    end = None
    for index, char in enumerate(text[start:], start=start):
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                end = index + 1
                break
    if end is None:
        raise RuntimeError(f"Could not find end of payload object in {path}")
    return json.loads(text[start:end])


def local_photo_path(context_path: Path, photo: dict[str, Any]) -> Path | None:
    base = context_path.parent
    candidates = [
        photo.get("imageSrc"),
        (photo.get("cloudPdfSource") or {}).get("imageUrl"),
        photo.get("gallerySrc"),
    ]
    for candidate in candidates:
        if not candidate:
            continue
        path = base / str(candidate)
        if path.exists():
            return path
    return None


def choose_photos(payload: dict[str, Any], context_path: Path, count: int, rng: random.Random) -> tuple[str, list[dict[str, Any]]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    source_photos = payload.get("gallery", {}).get("photos") or payload.get("photos", [])
    for photo in source_photos:
        media_type = str((photo.get("media") or {}).get("type") or photo.get("mediaType") or "photo").lower()
        if media_type == "video":
            continue
        path = local_photo_path(context_path, photo)
        if not path:
            continue
        item = {**photo, "_localPath": str(path)}
        groups.setdefault(photo.get("albumSlug") or photo.get("album") or "property", []).append(item)
    eligible = [(album, photos) for album, photos in groups.items() if len(photos) >= count]
    if not eligible:
        raise RuntimeError(f"No Elie real-estate album has {count} local still photos available")
    album, photos = rng.choice(eligible)
    return album, rng.sample(photos, count)


def load_music(rng: random.Random) -> tuple[dict[str, Any], dict[str, Any], Path]:
    config = json.loads(MUSIC_CONFIG.read_text())
    tracks = config.get("tracks") or []
    if not tracks:
        raise RuntimeError(f"No tracks configured in {MUSIC_CONFIG}")
    track = dict(rng.choice(tracks))
    src = str(track["src"]).replace("./", "", 1)
    path = ROOT / src
    if not path.exists():
        raise RuntimeError(f"Music track is missing: {path}")
    return config, track, path


def ken_burns_filter(effect: str, duration: int) -> str:
    frames = max(1, duration * FPS)
    denom = max(1, frames - 1)
    if effect == "slow-zoom-out":
        z = f"1.13-0.10*on/{denom}"
        x = "(iw-iw/zoom)*0.5"
        y = "(ih-ih/zoom)*0.5"
    elif effect == "pan-left":
        z = "1.10"
        x = f"(iw-iw/zoom)*(0.85-0.70*on/{denom})"
        y = "(ih-ih/zoom)*0.5"
    elif effect == "pan-right":
        z = "1.10"
        x = f"(iw-iw/zoom)*(0.15+0.70*on/{denom})"
        y = "(ih-ih/zoom)*0.5"
    elif effect == "rise-up":
        z = f"1.08+0.04*on/{denom}"
        x = "(iw-iw/zoom)*0.5"
        y = f"(ih-ih/zoom)*(0.75-0.45*on/{denom})"
    elif effect == "drift-down":
        z = f"1.08+0.04*on/{denom}"
        x = "(iw-iw/zoom)*0.5"
        y = f"(ih-ih/zoom)*(0.25+0.45*on/{denom})"
    else:
        z = f"1.02+0.11*on/{denom}"
        x = "(iw-iw/zoom)*0.5"
        y = "(ih-ih/zoom)*0.5"
    return (
        f"scale={WORK_WIDTH}:{WORK_HEIGHT}:force_original_aspect_ratio=increase,"
        f"crop={WORK_WIDTH}:{WORK_HEIGHT},"
        f"zoompan=z='{z}':x='{x}':y='{y}':d={frames}:s={SIZE}:fps={FPS},"
        "setsar=1,format=yuv420p"
    )


def render_segment(photo: dict[str, Any], output: Path, duration: int, effect: str) -> None:
    run([
        FFMPEG,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-loop",
        "1",
        "-i",
        photo["_localPath"],
        "-t",
        str(duration),
        "-vf",
        ken_burns_filter(effect, duration),
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        str(output),
    ])


def concat_segments(segments: list[Path], output: Path) -> None:
    list_path = output.with_suffix(".concat.txt")
    list_path.write_text("".join(f"file '{segment.resolve()}'\n" for segment in segments))
    run([
        FFMPEG,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(list_path),
        "-c",
        "copy",
        str(output),
    ])


def add_music(video: Path, music: Path, output: Path, total_seconds: int, music_gain_db: float) -> None:
    fade_start = max(0, total_seconds - 2)
    run([
        FFMPEG,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(video),
        "-stream_loop",
        "-1",
        "-i",
        str(music),
        "-t",
        str(total_seconds),
        "-filter_complex",
        f"[1:a]volume={music_gain_db}dB,atrim=0:{total_seconds},afade=t=out:st={fade_start}:d=2[a]",
        "-map",
        "0:v:0",
        "-map",
        "[a]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-shortest",
        str(output),
    ])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--context", type=Path, default=DEFAULT_CONTEXT if DEFAULT_CONTEXT.exists() else FALLBACK_CONTEXT)
    parser.add_argument("--count", type=int, default=10)
    parser.add_argument("--seconds", type=int, default=5)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--output", type=Path, default=None)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    seed = args.seed if args.seed is not None else secrets.randbelow(1_000_000_000)
    rng = random.Random(seed)
    payload = load_context(args.context)
    album, photos = choose_photos(payload, args.context, args.count, rng)
    config, track, music_path = load_music(rng)
    effects = ["slow-zoom-in", "slow-zoom-out", "pan-left", "pan-right", "rise-up", "drift-down"]
    chosen_effects = [rng.choice(effects) for _ in photos]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output_dir = OUTPUT_ROOT / f"elie-{album}-{stamp}"
    output_dir.mkdir(parents=True, exist_ok=True)
    output = args.output or (output_dir / f"elie-{album}-10x{args.seconds}s-music.mp4")
    total_seconds = args.count * args.seconds

    with tempfile.TemporaryDirectory(dir=output_dir) as tmp:
        tmp_path = Path(tmp)
        segments = []
        for index, (photo, effect) in enumerate(zip(photos, chosen_effects), start=1):
            segment = tmp_path / f"segment-{index:02d}.mp4"
            render_segment(photo, segment, args.seconds, effect)
            segments.append(segment)
        silent = tmp_path / "silent.mp4"
        concat_segments(segments, silent)
        add_music(silent, music_path, output, total_seconds, float(config.get("musicGainDb", 0)))

    manifest = {
        "schema": "photosbyelie.realEstateSlideshowProof.v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "seed": seed,
        "context": str(args.context),
        "album": album,
        "photoDurationSeconds": args.seconds,
        "output": str(output),
        "durationSeconds": ffprobe_duration(output),
        "music": {
            **track,
            "path": str(music_path),
            "musicGainDb": config.get("musicGainDb", 0),
        },
        "sourceVideoAudioGainDb": config.get("sourceVideoAudioGainDb", -20),
        "sourceVideoAudioLinearGain": config.get("sourceVideoAudioLinearGain", 0.1),
        "transition": config.get("transition", "random-ken-burns"),
        "photos": [
            {
                "photoId": photo.get("id"),
                "title": photo.get("editableTitle") or photo.get("title"),
                "album": photo.get("album"),
                "path": photo["_localPath"],
                "effect": effect,
            }
            for photo, effect in zip(photos, chosen_effects)
        ],
    }
    manifest_path = output.with_suffix(".json")
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(json.dumps({
        "output": str(output),
        "manifest": str(manifest_path),
        "durationSeconds": manifest["durationSeconds"],
        "album": album,
        "music": track["title"],
        "seed": seed,
    }, indent=2))


if __name__ == "__main__":
    main()
